/**
 * SD-56 — THE DEV CONSOLE'S CHEAT ENGINE. Pure snapshot surgery: every cheat is a
 * function over a {@link NetSnapshot} that the caller obtained from
 * `session.snapshot()` and hands back through `session.restore()`.
 *
 * WHY A SNAPSHOT AND NOT NEW SESSION METHODS. {@link NetSnapshot} is already the
 * COMPLETE fold of the net session — the wallet, the roster, the contracts, the
 * scenario cursor, every act witness, the launch pipeline, the fault map. So the
 * snapshot IS the cheat surface: it is public, typed, by-value, and exhaustive.
 * Going through it means `session.ts` gains NOT ONE debug field, NOT ONE debug
 * branch, and no cheat can ever reach a private the fold does not already carry.
 * The replay harness builds its own session from the golden action log and never
 * imports this module, so THE THREE GOLDENS ARE PROVABLY UNTOUCHED by anything here.
 *
 * A cheat is NOT a player action: nothing in this file is recorded to the
 * SaveGame action log, so a cheated run is not replayable — that is the point, and
 * the console says so on its face. Cheats mutate the snapshot IN PLACE (it is a
 * by-value capture the caller owns) and return the one-line WIRE note the console
 * logs, so every cheat leaves a trace in SYSTEM.LOG and can never be mistaken for
 * real play.
 *
 * PURE: no DOM, no three, no wall-clock, no RNG. Tested like any sim module.
 *
 * @see docs/decisions.md SD-56
 */
import { NetSession, type NetSnapshot } from "./session";
import { M1_SCENARIO } from "./scenario";
import type { Contract } from "./contract";
import type { PendingLaunch } from "./session";

/** The scenario beat ids, by cursor index (mirrors `M1_SCENARIO`'s order). */
export const DEV_ACT_IDS = ["act1", "act2", "act3a", "act3b", "act4"] as const;

/** Short console labels for the jump buttons, by cursor index. */
export const DEV_ACT_LABELS = ["1 SERVE", "2 COVER", "3a STRAIN", "3b FAULTS", "4 MARS"] as const;

/** The last cursor index (act4 — the frontier read the cursor stops on). */
export const DEV_LAST_CURSOR = DEV_ACT_IDS.length - 1;

/** € formatting for the console's WIRE notes — space-grouped and locale-independent, so
 * the note reads identically in every browser. */
function eur(n: number): string {
  return `€${Math.round(n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

// --- wallet ------------------------------------------------------------------

/** Add (or, with a negative amount, remove) € from the wallet. */
export function cheatGrantEur(snap: NetSnapshot, amountEur: number): string {
  snap.balance += amountEur;
  return `wallet ${amountEur >= 0 ? "+" : "−"}${eur(Math.abs(amountEur))} → ${eur(snap.balance)}`;
}

/** Set the wallet to an exact € figure (a floor test: how does the loop read broke?). */
export function cheatSetBalance(snap: NetSnapshot, balanceEur: number): string {
  snap.balance = balanceEur;
  return `wallet set → ${eur(snap.balance)}`;
}

// --- the scenario cursor (the headline ask: SKIP ACTS) ------------------------

/**
 * ARM the witnesses the beats up to `targetCursor` would otherwise have to EARN, so a
 * jump does not trip a beat's own fence. Two fences live in `scenario.ts`:
 *
 *   - `act3b.emit` THROWS unless `escalationReTamed()` — faults are structurally fenced
 *     behind act3a's re-tame gate. Reaching act3b (cursor 3) therefore needs the re-tame
 *     witness latched (and escalation on, which act3a's own emit would have done).
 *   - `act3b.gate` needs `weatheredFault() && traceSurfacedShortfall()`. Those are not a
 *     fence on the emit, but a jump PAST act3b (cursor 4) that left them false would leave
 *     the console lying about why the act advanced — latch them too.
 *
 * Arming a witness the run already earned is a no-op. Returns "" when nothing needed
 * arming, so the console stays quiet on an ordinary one-act step.
 */
export function cheatArmFences(snap: NetSnapshot, targetCursor: number): string {
  const armed: string[] = [];
  if (targetCursor >= 3) {
    if (snap.escalationOn !== 1) {
      snap.escalationOn = 1;
      armed.push("escalation");
    }
    if (snap.act3aReTameWitnessed !== 1) {
      snap.act3aReTameWitnessed = 1;
      armed.push("re-tame witness");
    }
  }
  if (targetCursor >= 4) {
    if (snap.faultWeathered !== 1) {
      snap.faultWeathered = 1;
      armed.push("fault weathered");
    }
    if (snap.surfacedShortfall !== 1) {
      snap.surfacedShortfall = 1;
      armed.push("trace shortfall");
    }
  }
  return armed.length === 0 ? "" : `fences armed · ${armed.join(" · ")}`;
}

/**
 * REWIND the cursor to `cursor` (a lower beat), so a gate can be re-driven by hand.
 * Forward moves are NOT done here — those go through `session.advanceCursor()` + a step
 * so each beat's authored `emit` actually fires (the contracts arrive). Trims the gate-tick
 * stamps past the new cursor so the record does not claim gates that have been un-fired.
 * A no-op (returns "") when `cursor` is not strictly behind the snapshot's cursor.
 */
export function cheatRewindCursor(snap: NetSnapshot, cursor: number): string {
  const target = Math.max(0, Math.min(DEV_LAST_CURSOR, Math.trunc(cursor)));
  if (target >= snap.scenarioCursor) return "";
  const from = snap.scenarioCursor;
  snap.scenarioCursor = target;
  snap.gateTicks.length = Math.min(snap.gateTicks.length, target);
  return `act rewound ${DEV_ACT_IDS[from] ?? from} → ${DEV_ACT_IDS[target]}`;
}

// --- the launch pipeline -----------------------------------------------------

/**
 * DEPLOY NOW — collapse the countdown/ascent/deploy pipeline so every in-flight batch
 * member separates on the next step: pull each undeployed member's `deployAtS` back to
 * `tS` and un-lose the vehicle. Does NOT touch a member's success/failure outcome (that is
 * {@link cheatSafeLaunch}) — a no-sep still no-seps, instantly.
 */
export function cheatDeployNow(snap: NetSnapshot, tS: number): string {
  let members = 0;
  for (const ev of snap.pendingLaunches) {
    if (ev.lost === 1) {
      ev.lost = 0;
      ev.lostAtS = 0;
    }
    for (const m of ev.members) {
      if (m.deployed === 1) continue;
      m.deployAtS = tS;
      members++;
    }
  }
  return members === 0 ? "no launch in flight" : `${members} pending member(s) deploying now`;
}

/**
 * SAFE LAUNCH — force every in-flight batch member to the clean `ok` outcome: un-lose the
 * vehicle, clear a no-sep, and restore an underburned member's INTENDED semi-major axis
 * (an underburn is stamped into `m.sat.orbit.aM` at commit time, so the fix is to put the
 * intended value back before the member deploys). Sats already on the roster are handled by
 * {@link cheatCircularizeAll}.
 */
export function cheatSafeLaunch(snap: NetSnapshot): string {
  let fixed = 0;
  for (const ev of snap.pendingLaunches) {
    if (ev.lost === 1) {
      ev.lost = 0;
      ev.lostAtS = 0;
      fixed++;
    }
    for (const m of ev.members) {
      if (m.outcome === "ok") continue;
      if (m.outcome === "underburn") m.sat.orbit.aM = m.intendedAM;
      m.outcome = "ok";
      fixed++;
    }
  }
  return fixed === 0 ? "nothing in flight to fix" : `${fixed} launch failure(s) forced clean`;
}

/**
 * CIRCULARIZE ALL — free, instant: put every underburned ROSTER sat back on its intended
 * semi-major axis and drop the pending-burn book. The paid verb is `net_circularize`
 * (one sat, one fee); this is the debug bulk form.
 */
export function cheatCircularizeAll(snap: NetSnapshot): string {
  if (snap.underburnIntended.length === 0) return "no underburned sat";
  const intended = new Map(snap.underburnIntended);
  let n = 0;
  for (const sat of snap.roster) {
    const aM = intended.get(sat.id);
    if (aM === undefined) continue;
    sat.orbit.aM = aM;
    n++;
  }
  snap.underburnIntended = [];
  return `${n} sat(s) circularized free`;
}

// --- faults ------------------------------------------------------------------

/** CLEAR FAULTS — wipe the active fault map + the scripted queue and reset the mild-first
 * cursor. Leaves the generator flag alone (that is {@link cheatDisarmFaults}) so "clear it
 * and let the roll run again" is one click. */
export function cheatClearFaults(snap: NetSnapshot): string {
  const had = snap.activeFaults.length;
  const queued = snap.faultScriptQueue.length;
  snap.activeFaults = [];
  snap.faultScriptQueue = [];
  snap.lastScriptedFaultSatId = null;
  snap.servedThroughFault = [];
  return had === 0 && queued === 0 ? "no fault active" : `${had} active + ${queued} queued fault(s) cleared`;
}

/** DISARM the fault generator (the inverse of the act3b emit's `enableFaults`) and clear
 * what it already rolled — a fault-free bench at any cursor, one click. */
export function cheatDisarmFaults(snap: NetSnapshot): string {
  snap.faultsOn = 0;
  cheatClearFaults(snap);
  return "fault generator DISARMED";
}

// --- contracts ---------------------------------------------------------------

/**
 * FREEZE OFFERS — stop the tender clock on every OFFERED contract: the offer never lapses
 * and the pay stops decaying. The single most useful cheat while poking at the pad, because
 * a two-sim-hour offer window lapses long before a hand-driven experiment finishes.
 */
export function cheatFreezeOffers(snap: NetSnapshot): string {
  let n = 0;
  for (const c of snap.contracts) {
    if (c.state !== "offered") continue;
    c.offerExpiresAtS = Infinity;
    c.payHalvingS = Infinity;
    // The SIGN-ON window is deliberately left ticking. Freezing it buys nothing (the bonus is
    // €2,000 against a cheat that can mint millions) and it puts the contract in a state the
    // board has no honest way to draw — an un-clocked bonus is a countdown with no end.
    n++;
  }
  return n === 0 ? "no offer on the board" : `${n} offer(s) frozen · no lapse, no decay`;
}

/**
 * RE-OFFER LAPSED — put a tender that expired UNSIGNED back on the board with a fresh
 * window. A lapsed offer is `state: "failed"` with nothing earned and no served time
 * (`stepOfferedContract` flips it), which is exactly the discriminator used here — a
 * contract that FAILED after being worked (served time or € earned) is left alone, because
 * re-offering it would erase a real outcome.
 */
export function cheatReopenLapsed(snap: NetSnapshot, tS: number, windowS: number): string {
  let n = 0;
  for (const c of snap.contracts) {
    if (c.state !== "failed") continue;
    if (c.servedSecondsAccum > 0 || c.earnedEur > 0) continue;
    c.state = "offered";
    c.offeredAtS = tS;
    c.offerExpiresAtS = tS + windowS;
    c.breachSecondsAccum = 0;
    n++;
  }
  return n === 0 ? "no lapsed tender to re-offer" : `${n} lapsed tender(s) back on the board`;
}

/**
 * CLEAR BREACH — zero the consecutive-breach window on every ACTIVE contract and restart
 * the availability clean-streak clock at `tS`. Undoes the damage of fiddling with the pad
 * while a contract was live, without touching served time or € earned.
 */
export function cheatClearBreach(snap: NetSnapshot, tS: number): string {
  let n = 0;
  for (const c of snap.contracts) {
    if (c.state !== "active" || c.breachSecondsAccum === 0) continue;
    c.breachSecondsAccum = 0;
    n++;
  }
  snap.cleanServedSinceS = tS;
  return n === 0 ? "clean streak restarted" : `${n} breach window(s) cleared · clean streak restarted`;
}

// --- SANDBOX: the standing "just let me look at it" mode ---------------------

/** What the sandbox tops the wallet up TO. Large enough that money stops being a variable
 * at all — the point of the mode is to look at missions, not to run an economy. */
export const DEV_SANDBOX_BANKROLL_EUR = 10_000_000;

/** The sandbox only touches the wallet once it drops BELOW this. A floor rather than a
 * per-frame "hold at exactly X" matters for real: writing the wallet means a
 * `restore()`, and restore clears the router's solve cache — so a naive every-frame
 * top-up would force a full re-solve on every frame of the run. With a floor this far
 * below the bankroll, the write happens approximately never. */
export const DEV_SANDBOX_FLOOR_EUR = 1_000_000;

/**
 * Does the sandbox have anything to do right now? A pure predicate over the LIVE read-only
 * views, so the caller can skip taking a snapshot at all on the overwhelming majority of
 * frames. This is the cheap gate in front of the expensive write path (snapshot deep-copies
 * the roster + contracts; restore wipes the router cache).
 */
export function sandboxNeedsWork(contracts: readonly Contract[], balanceEur: number): boolean {
  if (balanceEur < DEV_SANDBOX_FLOOR_EUR) return true;
  for (const c of contracts) {
    if (c.state === "offered" && (Number.isFinite(c.offerExpiresAtS) || Number.isFinite(c.payHalvingS))) return true;
    if (c.state === "active" && c.breachSecondsAccum > 0) return true;
  }
  return false;
}

/** The same cheap gate for the launch-failure lock: is there anything in flight to fix? */
export function safeLaunchNeedsWork(events: readonly PendingLaunch[]): boolean {
  for (const ev of events) {
    if (ev.lost === 1) return true;
    for (const m of ev.members) if (m.deployed === 0 && m.outcome !== "ok") return true;
  }
  return false;
}

/**
 * SANDBOX — the standing enforcement, applied whenever {@link sandboxNeedsWork} says so.
 * Three holds, and nothing else:
 *
 *   1. NO EXPIRY — every offer's lapse clock and pay decay are set to Infinity, including
 *      offers that arrive later (this runs every frame the mode is on, not once).
 *   2. NO BREACH-OUT — an ACTIVE contract's consecutive-breach window is held at zero, so a
 *      signed mission cannot FAIL out from under you while you are looking at it. The breach
 *      is still computed and still shown; it just never reaches the grace limit.
 *   3. MONEY — the wallet is topped back up to the bankroll below the floor.
 *
 * Deliberately NOT held: contract COMPLETION. Reaching the end of a term is a success and a
 * thing worth seeing; only the ways a mission dies are suppressed.
 */
export function cheatSandbox(snap: NetSnapshot, tS: number): string {
  const notes: string[] = [];
  let frozen = 0;
  let unbreached = 0;
  for (const c of snap.contracts) {
    if (c.state === "offered" && (Number.isFinite(c.offerExpiresAtS) || Number.isFinite(c.payHalvingS))) {
      c.offerExpiresAtS = Infinity;
      c.payHalvingS = Infinity;
      // The sign-on window keeps ticking — see the note in cheatFreezeOffers.
      frozen++;
    }
    if (c.state === "active" && c.breachSecondsAccum > 0) {
      c.breachSecondsAccum = 0;
      unbreached++;
    }
  }
  if (snap.balance < DEV_SANDBOX_FLOOR_EUR) {
    snap.balance = DEV_SANDBOX_BANKROLL_EUR;
    notes.push(`wallet topped to ${eur(DEV_SANDBOX_BANKROLL_EUR)}`);
  }
  snap.cleanServedSinceS = Math.min(snap.cleanServedSinceS, tS);
  if (frozen > 0) notes.push(`${frozen} offer(s) frozen`);
  if (unbreached > 0) notes.push(`${unbreached} breach window(s) held`);
  return notes.join(" · ");
}

// --- the mission catalogue (derived, never hand-listed) ----------------------

/** What one authored beat's `emit` actually puts on the board, and what else it turns on. */
export interface BeatDescription {
  /** The beat's cursor index. */
  cursor: number;
  /** The stable beat id ("act1" … "act4"). */
  actId: string;
  /** Contract ids this beat's emit offers (empty for act3b, which offers no demand). */
  contractIds: string[];
  /** Those contracts' player-facing labels ("equatorial metro", …). */
  labels: string[];
  /** Side effects beyond demand ("escalation", "faults"), in the order detected. */
  effects: string[];
}

/**
 * DERIVE what every scenario beat emits, by RUNNING each beat's own `emit` on a throwaway
 * session and diffing. Nothing here is hand-listed, so the console's mission browser cannot
 * drift from `scenario.ts` — add a demand to a beat and the browser names it on the next
 * boot, with no edit here.
 *
 * Each beat gets its OWN fresh session (so ids do not accumulate across beats), with the
 * fences armed first, because `act3b.emit` throws unless the act3a re-tame witness is set.
 *
 * PURE and deterministic: fresh sessions, no ephemeris, no stepping — `emit` is defined to
 * touch only session state, never physics. Call it once and cache; it is not free.
 */
export function describeBeats(): BeatDescription[] {
  const out: BeatDescription[] = [];
  for (let i = 0; i < M1_SCENARIO.length; i++) {
    const beat = M1_SCENARIO[i];
    const probe = new NetSession();
    const armed = probe.snapshot();
    cheatArmFences(armed, i);
    probe.restore(armed);
    const before = new Set(probe.contracts.map((c) => c.id));
    const escalationBefore = probe.escalationEnabled;
    const faultsBefore = probe.faultsEnabled;
    beat.emit(probe, 0);
    const fresh = probe.contracts.filter((c) => !before.has(c.id));
    const effects: string[] = [];
    if (!escalationBefore && probe.escalationEnabled) effects.push("escalation");
    if (!faultsBefore && probe.faultsEnabled) effects.push("faults");
    out.push({
      cursor: i,
      actId: beat.id,
      contractIds: fresh.map((c) => c.id),
      labels: fresh.map((c) => c.label),
      effects,
    });
  }
  return out;
}

// --- pure readers (the console's state block) --------------------------------

/** Fleet counts off the fold: sats on the roster, members still in flight, sats awaiting a
 * circularization burn. */
export function devFleetCounts(snap: NetSnapshot): { live: number; pending: number; underburn: number } {
  let pending = 0;
  for (const ev of snap.pendingLaunches) {
    if (ev.lost === 1) continue;
    for (const m of ev.members) if (m.deployed === 0) pending++;
  }
  return { live: snap.roster.length, pending, underburn: snap.underburnIntended.length };
}

/** Contract counts by lifecycle state, off the fold. */
export function devContractCounts(snap: NetSnapshot): {
  offered: number;
  active: number;
  completed: number;
  failed: number;
} {
  const out = { offered: 0, active: 0, completed: 0, failed: 0 };
  for (const c of snap.contracts) out[c.state]++;
  return out;
}
