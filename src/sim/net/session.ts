/**
 * net/ — THE NET SESSION (design §2.2 / §4): the live mutable world of the network game,
 * the connectivity sibling of {@link import("../m2/session").BuildSession}. A PURE,
 * deterministic, SAVEABLE state: the launched-sat roster + the region-disc contracts + a
 * € wallet + a SEEDED splitmix64 RNG + a scenario cursor. It owns NO render concern; the
 * render layer reads a {@link NetSnapshot}.
 *
 * --- THE SHARED STATE MACHINE (design §2.2 — the reuse decision) -----------------
 * The contract is a net/ fresh region-disc struct ({@link Contract}), but its serve/breach
 * advance is the SAME state machine the m2 build session uses: this file IMPORTS the m2
 * transition helpers {@link stepActiveContract} / {@link stepOfferedContract} and the single
 * {@link BREACH_GRACE_SECONDS} from m2/contracts.ts. There is ONE breach convention in the
 * codebase, two demand geometries — net/ computes the scalar servedFraction from the ROUTER
 * (path-existence over the spinning frame) instead of from m2's grid-cell coverage, then
 * passes it into the IMPORTED `stepActiveContract(contract, servedFraction, dt)`.
 *
 * --- THE PER-TICK LOOP (step) ----------------------------------------------------
 * Each tick `step(eph, t, dt)`:
 *   1. for each contract, run the §2.4 re-solve split ({@link resolveTick}) to get the
 *      current SolveResult cheaply (cached path re-eval; full search only on a topology
 *      change or a horizon rise/set);
 *   2. derive the scalar servedFraction (Act 1: 1.0 if served else 0.0 — the binary axis);
 *   3. accrue payPerSecond×fraction×dt (or −penalty×dt when wholly unserved) — SUMMED into
 *      ONE wallet add per step, so revenue is DT-INVARIANT (same sim-time ⇒ same €);
 *   4. advance the contract state machine via the IMPORTED stepActiveContract /
 *      stepOfferedContract + the IMPORTED grace.
 * Mirrors BuildSession.step's "one summed apply for DT-invariance" shape.
 *
 * PURE: no three / DOM / wall-clock. The ONLY randomness is the seeded {@link SimRng}
 * (faults will draw from it in Act 3b; absent here). The wallet is a plain number (net/
 * imports NEITHER m1/ NOR m2/session.ts — only the axis-agnostic m2/contracts helpers).
 *
 * @see docs/signal-horizon-m1-design.md §2.2 (session + reuse), §4 (determinism/fold), §5.
 */

import type { Ephemeris } from "../ephemeris";
import { SimRng } from "../rng";
import {
  stepActiveContract as m2StepActiveContract,
  stepOfferedContract as m2StepOfferedContract,
  type ContractState,
} from "../m2/contracts";
import type { NetSat } from "./sat";
import { type GroundNet, NET_ACT1_GROUND, NET_ACT2_GROUND } from "./endpoint";
import {
  type Contract,
  type SlaAxis,
  SLA_AXIS_ORDINAL,
  netRevenueRatePerSecond,
  recordNetEarned,
  cloneNetContract,
  escalateLoad,
  ESCALATION_SERVE_THRESHOLD,
  ESCALATION_BANDWIDTH_AXIS_THRESHOLD,
} from "./contract";
import { NET_LINK_CAPACITY_UNITS } from "./link-budget";
import { BREACH_GRACE_SECONDS as NET_BREACH_GRACE_SECONDS } from "../m2/contracts";
import {
  type SolveResult,
  type RouterState,
  resolveTick,
} from "./router";
import { windowAvailability } from "./availability";
import { M1_SCENARIO, type Beat, type Shortfall } from "./scenario";

/** The re-exported grace, so a caller (and the A2 test) can assert net/ uses the SHARED
 * m2 constant — there is NO net/ copy of the breach grace. */
export { BREACH_GRACE_SECONDS } from "../m2/contracts";

/**
 * THE SHARED-STATE-MACHINE LENS (design §2.2). The m2 serve/breach helpers are typed against
 * the m2 grid-cell Contract, but they are AXIS-AGNOSTIC: they only read/write the state-machine
 * fields below (a scalar servedFraction + dt advance — they never touch grid cells). This lens
 * is exactly the field subset each helper touches, and the net {@link Contract} has every one of
 * them (same names), so a net contract is a structural supertype of the lens. We bind the
 * imported helpers to lens-typed references ONCE here — the only adapter between the two demand
 * geometries — so net/session calls the IMPORTED transitions (not a net/ copy): ONE breach
 * convention, two geometries. (The cast is a function-type narrowing the helpers' grid fields
 * out; it is sound because they are never dereferenced for a scalar-fraction advance.)
 */
interface SharedStateMachineContract {
  state: ContractState;
  offerExpiresAtS: number;
  termSeconds: number;
  servedSecondsAccum: number;
  breachSecondsAccum: number;
  lastServedFraction: number;
}

/** Advance an ACTIVE contract via the IMPORTED m2 transition (servedFraction, dt). */
const stepActiveContract = m2StepActiveContract as unknown as (
  c: SharedStateMachineContract,
  servedFraction: number,
  dtSeconds: number,
) => ContractState | null;

/** Expire a stale OFFER via the IMPORTED m2 transition (nowS). */
const stepOfferedContract = m2StepOfferedContract as unknown as (
  c: SharedStateMachineContract,
  nowS: number,
) => boolean;

/** Opening € for a net session — enough that launching the GEO PARK default is affordable
 * and a served contract earns the capex back over a sitting. Placeholder. */
export const NET_OPENING_BALANCE = 5000.0;

/** Seed for the net session's splitmix64 RNG (the determinism anchor; faults draw from it
 * in Act 3b — absent in Act 1). Distinct from the m1/m2 anchors. The replay golden (A3)
 * is bootstrapped from this. */
export const NET_RNG_SEED = 4242424242424242n;

/** The QUANTIZATION BUCKET WIDTH (offeredLoad units) the congestion epoch is keyed on (E3): a
 * sat's aggregate shared load is bucketed `floor(load / bucket)`, and the {@link NetSession}'s
 * `congestionEpoch` bumps whenever ANY sat's bucket changes between steps. Folding the QUANTIZED
 * epoch (an int) into the §2.4 topologyKey — never the raw float — forces a re-solve on a
 * meaningful congestion change (the HIGH-2 fix) while a glacial sub-bucket drift preserves the
 * cache (it would otherwise re-solve every tick). Sized a fraction of NET_LINK_CAPACITY_UNITS so
 * the approach-to-capacity is resolved in several buckets. Placeholder. */
export const NET_CONGESTION_BUCKET_UNITS = NET_LINK_CAPACITY_UNITS / 4;

/** The NEAR-BREACH fraction of the shared grace a contract's `breachSecondsAccum` must reach
 * (while escalation is on) to be WITNESSED as having "dipped near-breach under risen load" — the
 * first half of the act3a tame→outgrow→re-tame gate (design §3a / onboarding line 120). A sustained
 * dip to this depth of the grace (then a return to fully SERVED) demonstrates the concept WITHOUT
 * requiring an actual FAILED contract (the full grace). 0.1 of the 600 s grace = 60 s of breach —
 * a real, sustained near-breach the player must re-engineer out of, comfortably below the FAIL
 * threshold so a re-tame is reachable. Placeholder. */
export const NET_NEAR_BREACH_GRACE_FRACTION = 0.1;

/** JSON-safe capture of the whole net session (save/restore + state-hash parity). */
export interface NetSnapshot {
  /** The launched-sat roster, by value. */
  roster: NetSat[];
  /** The € wallet balance. */
  balance: number;
  /** The splitmix64 RNG state (a u64) — string (JSON has no bigint). */
  rngState: string;
  /** How many sats have been LAUNCHED (drives ids + the constellation phase later). */
  launchedCount: number;
  /** Every contract (offered/active/completed/failed), by value, in offer order. */
  contracts: Contract[];
  /** The scenario cursor (which beat is current) + the recorded gate-tick stamps. */
  scenarioCursor: number;
  gateTicks: number[];
  /** The sim-time the session has been STEPPED to (so revenue resumes seamlessly). */
  lastStepS: number;
  /** Sim-time of the LAST availability-axis breach reset (a step that fed served-fraction 0
   * for an availability-active contract). The Act-2 gate (§3.3) requires a SUSTAINED clean
   * hand-off window — `nowS − cleanServedSinceS ≥ NET_HANDOFF_CYCLE_S` — so a single served tick
   * mid-sawtooth cannot spuriously fire it. Initialised to 0 (the session epoch). */
  cleanServedSinceS: number;
  /** Over-build waste (sats beyond the measured zero-gap minimum) recorded at the moment the
   * act2 gate fired — surfaced for the Act-3 optimizer pull (onboarding line 86). 0 until act2
   * completes; the gate's predicate is coverage-held (not a sat cap), so over-build still
   * completes and the surplus is SILENTLY logged here. Folded into the golden. */
  wasteLoggedSats: number;

  // --- ACT-3a (C1b) escalation + congestion fold state -----------------------------
  /** Whether the escalation law is GATED ON (0/1) — set true by the act3a beat's emit. While
   * on, a well-served contract's `offeredLoad` grows logistically each step (design §3a). */
  escalationOn: number;
  /** The §2.4 CONGESTION EPOCH (E3): a monotone int that bumps whenever any sat's quantized
   * shared-load bucket changes. Fed into the router topologyKey so a rising load forces a
   * re-solve through the cache (the HIGH-2 fix). Folds into the golden. */
  congestionEpoch: number;
  /** The chosen bridging sat per ACTIVE contract id (the two-pass aggregation's Pass-A result),
   * as `[contractId, satId]` pairs. Folded (sorted by contractId) so `loadBySat` is a pure
   * function of folded state across a restore boundary (the MED desync fix). */
  chosenSatByContract: [string, string][];
  /** Whether the act3a tame→outgrow→re-tame cycle has been WITNESSED (0/1): a previously-served
   * contract dipped near-breach under risen load, then returned to fully SERVED. The act3a gate
   * returns this. Folds into the golden. */
  act3aReTameWitnessed: number;
  /** Contract ids that have DIPPED near-breach while escalation was on (the first half of the
   * re-tame witness), so a later return to fully-served can complete the cycle. Folds (sorted). */
  nearBreachWitnessed: string[];
  /** The quantized congestion fingerprint of the LAST step's shared-load aggregate (E3): the
   * congestion epoch bumps when the current step's fingerprint differs from this. Folded as a
   * string so a restore reproduces the epoch-bump decision of a continuous run (replay-safe). */
  congestionFingerprint: string;
}

export class NetSession {
  /** The launched-sat roster (the player's constellation). */
  private readonly satList: NetSat[] = [];
  /** The € wallet — a plain number (net/ does not import the m1 economy). */
  private walletBalance: number;
  /** The seeded splitmix64 RNG (faults draw from it in Act 3b; absent in Act 1). */
  private rng: SimRng;
  /** Successful launches so far — fans sat ids + (later) constellation phase. */
  private launchedCount = 0;

  /** Every contract this session has seen, in offer order. */
  private readonly contractList: Contract[] = [];
  /** The ground-network endpoints the router terminates paths at (Act 1: one). */
  private readonly groundNets: GroundNet[];

  /** The §2.4 re-solve cache, one {@link RouterState} per contract id (keyed by id so a
   * contract keeps its cached path across ticks; the cheap re-eval avoids a full search
   * unless the topology changes or a horizon rise/set flips the served verdict). */
  private readonly routerStates = new Map<string, RouterState>();
  /** The last SolveResult per contract id (the readout: path / latency / losses / binding). */
  private readonly lastSolve = new Map<string, SolveResult>();

  /** The scenario cursor (which beat is current). Driven by the A3 scenario engine in
   * `step`; the session owns the integer so it folds into the replay hash. */
  private scenarioCursor = 0;
  /** The recorded gate-tick stamps (the tick each beat's gate first fired). */
  private readonly gateTicks: number[] = [];
  /** The authored arrival sequence (design §3). The session DRIVES it in `step`: it emits
   * the current beat once, then calls gate() each tick and advances on the first true. */
  private readonly scenario: Beat[];
  /** The cursor whose beat's emit() has already fired (-1 = none yet). Distinct from
   * scenarioCursor so the FIRST beat (act1) emits before its gate is ever checked, and a
   * re-restore re-emits no beat (emit is idempotent + de-duped by id anyway). NOT folded:
   * it is fully derived from scenarioCursor (every beat ≤ cursor has emitted), so it adds
   * no new outcome state — the contracts the emits produced ARE folded. */
  private emittedCursor = -1;

  /** Sim-time the session has been STEPPED to (for snapshot-resume continuity). */
  private lastStepS = 0;

  /** Sim-time of the last availability-axis breach reset — the START of the current clean
   * hand-off streak (§3.3, the gate-hardening field). Stamped to `t` every step that feeds a
   * 0 served-fraction for an availability-active contract; the Act-2 gate fires only once
   * `nowS − cleanServedSinceS ≥ NET_HANDOFF_CYCLE_S` (a SUSTAINED clean window). Folds into the
   * snapshot/golden. Initialised to 0 (the session epoch). */
  private cleanServedSinceS = 0;

  /** Over-build waste (sats beyond the measured zero-gap minimum) recorded when the act2 gate
   * fired — seeds the Act-3 optimizer pull (onboarding line 86). 0 until act2 completes. */
  private wasteLoggedSats = 0;

  // --- ACT-3a (C1b) escalation + congestion state ----------------------------------
  /** The escalation law gate (folded as int 0/1): set true by {@link enableEscalation}. */
  private escalationOn = false;
  /** The §2.4 congestion epoch (E3) — bumps on a quantized shared-load bucket change. Folded. */
  private congestionEpoch = 0;
  /** The chosen bridging sat per ACTIVE contract id (Pass A of the two-pass aggregation). Folded
   * as sorted `id|satId` pairs so {@link loadBySatFromState} is a pure function of folded state
   * across a restore boundary; the live `loadBySat` map is re-derived each step, never stored. */
  private readonly chosenSatByContract = new Map<string, string>();
  /** The act3a re-tame witness (folded int 0/1): a previously-served contract dipped near-breach
   * under risen load, then returned to fully SERVED. {@link escalationReTamed} returns this. */
  private act3aReTameWitnessed = false;
  /** Contract ids that have DIPPED near-breach while escalation was on (the first half of the
   * re-tame witness). A later return to fully-served completes the cycle. Folded (sorted). */
  private readonly nearBreachWitnessed = new Set<string>();
  /** The quantized congestion fingerprint of the last step's shared-load aggregate (E3) — the
   * epoch bumps when this step's fingerprint differs. Folded so a restore reproduces the bump. */
  private prevCongestionFingerprint = "";

  constructor(
    openingBalance = NET_OPENING_BALANCE,
    seed: bigint = NET_RNG_SEED,
    // The ground network: the equatorial GROUND-0 (Act 1, serves REGION-0) PLUS the high-lat
    // GROUND-1 (Act 2, the only ground REGION-1's inclined constellation can downlink to — the
    // equatorial GEO cannot reach it either, so it does NOT let the GEO serve REGION-1). The
    // router bridges via the strongest (sat, ground) pair across all grounds, so REGION-0 keeps
    // its byte-identical GROUND-0 bridge (golden-safe) and REGION-1 terminates at GROUND-1.
    groundNets: GroundNet[] = [NET_ACT1_GROUND, NET_ACT2_GROUND],
    scenario: Beat[] = M1_SCENARIO,
  ) {
    this.walletBalance = openingBalance;
    this.rng = new SimRng(seed);
    this.groundNets = groundNets.map((g) => ({ ...g }));
    this.scenario = scenario;
  }

  /** On-hand € balance. */
  get balance(): number {
    return this.walletBalance;
  }

  /** A read-only view of the launched-sat roster (the render reads this). */
  get sats(): readonly NetSat[] {
    return this.satList;
  }

  /** A read-only view of every contract, in offer order (the panel reads this). */
  get contracts(): readonly Contract[] {
    return this.contractList;
  }

  /** A read-only view of the ground-network endpoints. */
  get grounds(): readonly GroundNet[] {
    return this.groundNets;
  }

  /** The current scenario cursor (which beat is live). */
  get cursor(): number {
    return this.scenarioCursor;
  }

  /** The sim-time the session has been STEPPED to (the END of the last step). The Act-2 gate
   * reads this against {@link cleanServedSinceS} to require a sustained clean hand-off streak. */
  get nowS(): number {
    return this.lastStepS;
  }

  /** The START of the current availability clean streak — the last sim-time a step fed a 0
   * served-fraction for an availability-active contract (the gate-hardening stamp, §3.3). */
  get cleanSinceS(): number {
    return this.cleanServedSinceS;
  }

  /** Over-build waste recorded at act2 completion (sats beyond the measured zero-gap minimum). */
  get wasteSats(): number {
    return this.wasteLoggedSats;
  }

  /** Record over-build waste at the moment the act2 gate fires (the scenario beat calls this).
   * Idempotent in spirit — the gate fires once, so this is written once per act2 completion. */
  recordWasteSats(n: number): void {
    this.wasteLoggedSats = Math.max(0, Math.trunc(n));
  }

  // --- mutation surface (driven by applyNetAction; pure + deterministic) -----------

  /**
   * LAUNCH a satellite into the given orbit at sim-time `t`, with a BROADCAST loadout. The
   * sat joins the roster immediately (its coverage starts at `t`). Returns the new sat id.
   * Act 1 has no failure roll (the default GEO PARK simply works); the seeded RNG is held
   * for the Act-3b fault stream. Pure + deterministic.
   */
  launchSat(sat: NetSat): string {
    this.satList.push(sat);
    this.launchedCount++;
    // A launch is a topology change: invalidate every cached router path so the next step
    // does a full re-search (the §2.4 launch/commit event).
    this.routerStates.clear();
    return sat.id;
  }

  /** The next launched-sat id (monotonic, stable across replay). */
  nextSatId(): string {
    return `NET-SAT-${this.launchedCount}`;
  }

  /** Add a contract to the board (the scenario beat's emit() calls this). De-duplicated by
   * id so a beat re-emit is idempotent. */
  addContract(contract: Contract): void {
    if (this.contractList.some((c) => c.id === contract.id)) return;
    this.contractList.push(contract);
  }

  /** Find a contract by id (null if unknown). */
  contractById(id: string): Contract | null {
    return this.contractList.find((c) => c.id === id) ?? null;
  }

  /**
   * ACCEPT an OFFERED contract by id, moving it OFFERED → ACTIVE so it begins accruing
   * revenue from the live router coverage. Returns the affected contract, or null if the
   * id is unknown or not OFFERED. Pure + deterministic.
   */
  acceptContract(contractId: string): Contract | null {
    const c = this.contractById(contractId);
    if (c === null || c.state !== "offered") return null;
    c.state = "active";
    return c;
  }

  /**
   * Set a contract's per-contract PREFER weights (the §7.3 tune-by-exception, first used
   * in Act 3). Returns the affected contract, or null if unknown. Pure.
   */
  setPrefer(contractId: string, lat: number, bw: number, stab: number): Contract | null {
    const c = this.contractById(contractId);
    if (c === null) return null;
    c.prefer = { lat, bw, stab };
    return c;
  }

  /** ENABLE the escalation law (the act3a beat's emit calls this; idempotent). While on, a
   * well-served contract's `offeredLoad` grows logistically each step (design §3a — "your
   * success congests it"). Pure flag flip — it never touches physics (the §3 emit contract). */
  enableEscalation(): void {
    this.escalationOn = true;
  }

  /** Whether the escalation law is gated on (the readout + the trace face). */
  get escalationEnabled(): boolean {
    return this.escalationOn;
  }

  /** The current §2.4 congestion epoch (E3) — the readout the topologyKey is keyed on. */
  get congestion(): number {
    return this.congestionEpoch;
  }

  /** Whether the act3a tame→outgrow→re-tame cycle has been witnessed (the act3a gate's
   * predicate): a previously-served contract dipped near-breach under risen load, then returned
   * to fully SERVED. State-gated (the concept demonstrated), not clock-timed. */
  escalationReTamed(): boolean {
    return this.act3aReTameWitnessed;
  }

  /** The aggregate shared load routed over a sat id this step (the trace/readout reads this) —
   * re-derived from the folded chosen-sat assignment + each contract's offeredLoad. */
  loadOnSat(satId: string): number {
    return this.loadBySatFromState().get(satId) ?? 0;
  }

  /** Advance the scenario cursor + stamp the gate tick (the A3 engine calls this when a
   * beat's gate first fires). Idempotent-ish: records the tick for the current beat. */
  advanceCursor(gateTick: number): void {
    this.gateTicks[this.scenarioCursor] = gateTick;
    this.scenarioCursor++;
  }

  /** A read-only view of the last solve per contract id (the trace/render reads this). */
  lastSolveFor(contractId: string): SolveResult | null {
    return this.lastSolve.get(contractId) ?? null;
  }

  /**
   * The scalar servedFraction ∈ [0,1] for a contract this instant, from the router's verdict
   * over the contract's ACTIVE axes. Two regimes, gated purely by the `activeAxes` mask:
   *
   *   - CONNECTIVITY-ONLY (Act 1): BINARY — 1.0 if a path region→sat→groundNet exists this
   *     instant, else 0.0. BYTE-IDENTICAL to the old body (golden-safe for REGION-0).
   *   - AVAILABILITY ACTIVE (Act 2): the region must be HELD across the hand-off window, not
   *     merely reachable this instant. We compute the ROLLING {@link windowAvailability} and
   *     feed a fraction that drops to 0 while availability is in breach — an instantaneous gap
   *     (the sawtooth trough) OR a sustained rolling shortfall (avail < slaAvail). A lone LEO
   *     sawtooths + rolling-avail ≈ 0 ⇒ feeds 0 ⇒ the SHARED grace breaches it on schedule; a
   *     phased N=4 holds served continuously + avail = 1.0 ⇒ feeds 1.0 ⇒ completes. ONE breach
   *     convention (the imported `stepActiveContract`), no second state machine, no reshape.
   *
   * Pure; reuses the cached {@link RouterState} for the instant verdict + the pure
   * {@link windowAvailability} for the rolling held-fraction. `lastAvailability` is a readout.
   */
  private servedFractionFor(
    eph: Ephemeris,
    contract: Contract,
    t: number,
    loadBySat?: ReadonlyMap<string, number>,
  ): number {
    const prev = this.routerStates.get(contract.id) ?? null;
    // E2/E3 (Act 3a): the shared-load aggregate + the congestion epoch are forwarded into the
    // §2.4 re-solve split. Absent/empty (Acts 1–2) ⇒ congestion_term 0 + epoch 0 ⇒ byte-identical
    // routing + the same topologyKey, so the pre-Act-3 fold is untouched (golden-safe).
    const next = resolveTick(
      eph,
      contract,
      this.satList,
      this.groundNets,
      t,
      prev,
      undefined, // faults? — Act 3b (fenced behind act3a); absent here.
      loadBySat,
      this.congestionEpoch,
    );
    this.routerStates.set(contract.id, next);
    this.lastSolve.set(contract.id, next.result);
    // Act 1 (connectivity-only): binary served fraction — the byte-identical legacy path.
    if (!contract.activeAxes.has("availability")) {
      return next.result.served ? 1.0 : 0.0;
    }
    // Act 2 (availability active): the held-fraction over the trailing hand-off cycle.
    const avail = windowAvailability(eph, contract, this.satList, this.groundNets, t);
    contract.lastAvailability = avail; // the sawtooth-meter readout (set each step).
    if (!next.result.served) return 0.0; // instant gap (a sawtooth trough) → 0.
    return avail >= contract.slaAvail ? 1.0 : 0.0; // sustained shortfall → 0; held → 1.0.
  }

  /**
   * THE TWO-PASS CONGESTION AGGREGATION (Act 3a / C1b — Pass A + Aggregate). REPLAY-SAFE: built
   * ENTIRELY from FOLDED state (`offeredLoad` + the prior-tick `chosenSatByContract`), never a
   * separate cached map, so a restore-then-step reproduces a continuous run (the MED desync fix).
   *
   * {@link loadBySatFromState} rebuilds the shared-load aggregate `satId → Σ offeredLoad` from the
   * LAST step's chosen-sat assignment (Pass A's one-tick lag — deterministic + bounded). The live
   * `step` then runs the contract solves against THIS map, records each contract's freshly-chosen
   * sat back into {@link chosenSatByContract}, and bumps {@link congestionEpoch} when a quantized
   * bucket changed — so next step's aggregate reflects this step's routing. Pure.
   */
  private loadBySatFromState(): Map<string, number> {
    const load = new Map<string, number>();
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      const satId = this.chosenSatByContract.get(c.id);
      if (satId === undefined) continue;
      load.set(satId, (load.get(satId) ?? 0) + c.offeredLoad);
    }
    return load;
  }

  /** The quantized congestion FINGERPRINT of the current `loadBySat` (E3): each sat's bucket
   * `floor(load / NET_CONGESTION_BUCKET_UNITS)` plus a flag for whether it crossed the bandwidth
   * capacity, folded into a sorted string. A change between steps ⇒ the congestion epoch bumps ⇒
   * the topologyKey flips ⇒ a re-solve through the cache. Pure. */
  private congestionFingerprint(load: ReadonlyMap<string, number>): string {
    const parts: string[] = [];
    for (const [satId, l] of load) {
      const bucket = Math.floor(l / NET_CONGESTION_BUCKET_UNITS);
      const overCap = l >= NET_LINK_CAPACITY_UNITS ? 1 : 0;
      parts.push(`${satId}:${bucket}:${overCap}`);
    }
    parts.sort();
    return parts.join("|");
  }

  /**
   * THE act3a RE-TAME WITNESS (design §3a / onboarding line 120 — the tame→outgrow→re-tame gate).
   * Two halves, both folded:
   *   1. DIP — an active contract whose `breachSecondsAccum` crossed the near-breach threshold
   *      (NET_NEAR_BREACH_GRACE_FRACTION of the shared grace) while escalation was on: it dipped
   *      near-breach under risen load. (Reachable because the bandwidth axis bites BINARY — the
   *      HIGH-1 fix — so the shared grace actually accrues.) Recorded in `nearBreachWitnessed`.
   *   2. RE-TAME — a witnessed contract back to fully SERVED (`servedFraction == 1.0`): the player
   *      re-engineered (a parallel path / a net_set_prefer override) and re-tamed it ⇒ the cycle
   *      is demonstrated, set `act3aReTameWitnessed`. State-gated, not clock-timed. Pure.
   */
  private updateReTameWitness(contract: Contract, servedFraction: number): void {
    if (this.act3aReTameWitnessed) return; // once witnessed, latched (idempotent).
    const nearBreach =
      contract.breachSecondsAccum >= NET_NEAR_BREACH_GRACE_FRACTION * NET_BREACH_GRACE_SECONDS;
    if (nearBreach) this.nearBreachWitnessed.add(contract.id);
    else if (this.nearBreachWitnessed.has(contract.id) && servedFraction >= ESCALATION_SERVE_THRESHOLD) {
      // A dipped-then-re-tamed contract: the act3a concept (your success congests it, you
      // re-engineer, it re-tames) is FELT. Latch the witness (the gate reads it).
      this.act3aReTameWitnessed = true;
    }
  }

  /**
   * THE ESCALATION LAW (design §3a / onboarding line 99). For each ACTIVE contract served WELL
   * the prior step (`lastServedFraction >= ESCALATION_SERVE_THRESHOLD`), grow its `offeredLoad`
   * by the EXACT CLOSED-FORM LOGISTIC FLOW toward the ceiling over `dtSeconds` (the M2
   * dynamic-demand semigroup — DT-INVARIANT, bounded, no shock-compounding). Once a served
   * contract's grown load crosses ESCALATION_BANDWIDTH_AXIS_THRESHOLD, the BANDWIDTH axis is
   * added to its `activeAxes` (the §4.4 escalation-triggered mask flip — one-line mask add, NO
   * struct reshape) so the shared-link limit can bite. Pure; no RNG. Folds via offeredLoad +
   * activeAxes (both already in netStateHash).
   */
  private stepEscalation(dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      // Grow demand only where served WELL the prior step (lastServedFraction set by the m2
      // transition above) — a breaching/under-served contract does not escalate.
      if (c.lastServedFraction < ESCALATION_SERVE_THRESHOLD) continue;
      c.offeredLoad = escalateLoad(c.offeredLoad, dtSeconds);
      // The §4.4 escalation-triggered BANDWIDTH-axis mask flip (deterministic in step). Add the
      // axis ONCE the load crosses the threshold; idempotent (Set add of an already-present axis).
      if (c.offeredLoad >= ESCALATION_BANDWIDTH_AXIS_THRESHOLD && !c.activeAxes.has("bandwidth")) {
        c.activeAxes = new Set<SlaAxis>([...c.activeAxes, "bandwidth"]);
      }
    }
  }

  /**
   * THE PER-TICK LOOP (the loop closes). Advance the session over `dtSeconds` of elapsed
   * sim-time at sim-time `t` (the END of the step). It:
   *   1. expires stale OFFERS via the IMPORTED {@link stepOfferedContract} (Act 1 offers do
   *      not auto-expire — there is no offer window on the net contract — so this is a no-op
   *      placeholder that keeps the SAME imported convention the m2 session uses);
   *   2. for each ACTIVE contract, derives its servedFraction from the router, accrues
   *      payPerSecond×fraction×dt (or −penalty×dt when wholly unserved) — SUMMED into ONE
   *      wallet add for DT-invariance — and advances the state machine via the IMPORTED
   *      {@link stepActiveContract} (which uses the IMPORTED {@link BREACH_GRACE_SECONDS}).
   *
   * Pure + deterministic: a function of (eph, t, dt) over the seeded RNG + the live roster.
   * The single summed wallet add is the DT-invariance guarantee. Call once per fixed tick.
   */
  step(eph: Ephemeris, t: number, dtSeconds: number): void {
    // (0) THE SCENARIO ENGINE (design §3) — emit the CURRENT beat once, BEFORE serve/breach,
    // so the Act-1 contract is on the board before its first solve. The emit is the only
    // authored arrival; it adds demand / flips a mask / enables a fault gen — never physics.
    this.emitCurrentBeat(t);

    // (1) Expire stale offers via the SHARED helper (the SAME breach/offer convention as
    // m2; on a net contract there is no offer window, so this is a safe no-op here). Using
    // the imported helper — not a net/ copy — keeps ONE convention in the codebase.
    for (const c of this.contractList) {
      if (c.state === "offered") stepOfferedContract(c, t);
    }

    // (2a) The AVAILABILITY clean-streak reset for a not-yet-ACTIVE availability contract
    // (§3.3, the gate-hardening field): while an availability-active demand is still OFFERED
    // (not yet accepted), the clean hand-off streak cannot have started — pin it to `t` so the
    // streak measures only sustained-clean time AFTER the contract is live (a freshly accepted
    // contract must still hold a full hand-off cycle before the gate fires, never from t=0).
    for (const c of this.contractList) {
      if (c.state !== "active" && c.activeAxes.has("availability")) this.cleanServedSinceS = t;
    }

    // (1b) THE TWO-PASS CONGESTION AGGREGATION (Act 3a / C1b — Pass A + Aggregate). Run ONLY when
    // escalation is gated ON (Acts 1–2: escalationOn=false ⇒ NO loadBySat, NO epoch bump ⇒ the
    // serve loop passes `undefined` ⇒ congestion_term 0 + epoch 0 ⇒ byte-identical routing + the
    // pre-Act-3 topologyKey, so Act-1/Act-2 + their fold are UNTOUCHED — golden-safe). When on:
    // rebuild the shared-load aggregate from the FOLDED prior chosen-sat map + current offeredLoad
    // (Pass A's one-tick lag, fully re-derivable across a restore — the MED desync fix), and bump
    // the congestion epoch when its quantized fingerprint changed (E3: a rising load ⇒ a re-solve
    // through the cache; a static load preserves it). The serve loop below is Pass B (the truth).
    let loadBySat: ReadonlyMap<string, number> | undefined;
    if (this.escalationOn) {
      loadBySat = this.loadBySatFromState();
      const fp = this.congestionFingerprint(loadBySat);
      if (fp !== this.prevCongestionFingerprint) {
        this.congestionEpoch++;
        this.prevCongestionFingerprint = fp;
      }
    }

    // (2) Accrue revenue + advance ACTIVE contract state machines (Pass B — the truth this tick).
    // One summed wallet add. Each contract's freshly-chosen bridging sat is recorded back into
    // chosenSatByContract so NEXT step's aggregate reflects THIS step's routing.
    let netDelta = 0;
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      const frac = this.servedFractionFor(eph, c, t, loadBySat);
      // Record the chosen bridging sat (path[1]) for the two-pass aggregation; clear it when the
      // contract has no path this tick (so a dropped contract no longer loads a sat).
      const chosen = this.lastSolve.get(c.id)?.path?.[1];
      if (chosen !== undefined) this.chosenSatByContract.set(c.id, chosen);
      else this.chosenSatByContract.delete(c.id);
      // The AVAILABILITY clean-streak stamp (§3.3, the gate-hardening field): whenever an
      // availability-active contract feeds a 0 served-fraction (a breach reset — an instant gap
      // OR a rolling shortfall), the clean hand-off streak RESTARTS at this sim-time. The Act-2
      // gate fires only once the streak has run ≥ NET_HANDOFF_CYCLE_S, so a single served tick
      // mid-sawtooth cannot spuriously satisfy it. Pure (a function of t + the served fraction).
      if (frac <= 0 && c.activeAxes.has("availability")) this.cleanServedSinceS = t;
      // The € rate from the net contract's pay/penalty at this served fraction.
      const earned = netRevenueRatePerSecond(c, frac) * dtSeconds;
      netDelta += earned;
      recordNetEarned(c, earned);
      // The IMPORTED m2 transition (servedFraction, dt) — NO net/ copy. It advances the
      // served/breach accums + completes on term / fails past the IMPORTED grace.
      stepActiveContract(c, frac, dtSeconds);
      // THE act3a RE-TAME WITNESS (design §3a / onboarding line 120) — only while escalation is on.
      // FIRST half: a contract whose breach window crossed the near-breach threshold (it dipped
      // near-breach under risen load). SECOND half: a witnessed contract back to fully SERVED
      // (re-tamed) ⇒ the tame→outgrow→re-tame cycle is demonstrated (act3aReTameWitnessed=true).
      if (this.escalationOn) this.updateReTameWitness(c, frac);
    }
    if (netDelta !== 0) this.walletBalance += netDelta;

    // (2c) THE ESCALATION LAW (design §3a / onboarding line 99 — "demand grows where you serve").
    // After serve/breach + revenue (so the step's € is keyed on the load at the START of the step
    // — DT-invariant, mirroring the M2 dynamic-demand cadence), grow each well-served contract's
    // offeredLoad logistically toward the ceiling, and flip the bandwidth axis on once it crosses
    // the escalation threshold (the §4.4 escalation-triggered mask add). Gated ON by act3a.
    if (this.escalationOn) this.stepEscalation(dtSeconds);

    // (3) THE GATE (design §3) — AFTER serve/breach + revenue, so a contract that just got
    // served+paid THIS tick can open the next beat THIS tick. On the first true: record the
    // gate tick, advance the cursor, and emit the next beat — all deterministically in step
    // (so the whole arrival sequence is in the fold + replays bit-identically). The gate is
    // evaluated at most once per step; the cursor never moves more than one beat per tick.
    this.evaluateGate(t, dtSeconds);

    this.lastStepS = t;
  }

  /** Emit the current beat's authored arrival ONCE (design §3): the first emit puts the
   * Act-1 contract on the board; each subsequent beat emits when the cursor reaches it via
   * {@link evaluateGate}. Idempotent (the contract add is de-duped by id), and only fires
   * when a beat newly becomes current — so a restore re-emits nothing already past. Pure. */
  private emitCurrentBeat(t: number): void {
    if (this.emittedCursor >= this.scenarioCursor) return;
    const beat = this.scenario[this.scenarioCursor];
    if (beat !== undefined) beat.emit(this, t);
    this.emittedCursor = this.scenarioCursor;
  }

  /** Evaluate the current beat's completion predicate (design §3). On the FIRST true:
   * record the gate tick (tick = round(t/dt) at the fixed step), advance the cursor, and
   * emit the next beat — all inside step, so the transition is in the fold. The final beat
   * (act4) has a never-true gate (a read, not a gate), so the cursor stops there. Pure. */
  private evaluateGate(t: number, dtSeconds: number): void {
    const beat = this.scenario[this.scenarioCursor];
    if (beat === undefined) return; // cursor past the last beat: nothing to gate.
    if (!beat.gate(this, t)) return;
    const gateTick = dtSeconds > 0 ? Math.round(t / dtSeconds) : 0;
    this.advanceCursor(gateTick);
    // Emit the now-current (next) beat deterministically in the same step.
    this.emitCurrentBeat(t);
  }

  /** The current beat's gentle failure-to-progress assist (design §3 fallback / §2.6), or
   * null when the player is progressing. The render/trace reads this to surface the Act-1
   * "footprint does not reach [region]; try this preset" without doing it for the player. */
  currentShortfall(t: number): Shortfall | null {
    const beat = this.scenario[this.scenarioCursor];
    if (beat === undefined || beat.fallback === undefined) return null;
    return beat.fallback(this, t);
  }

  /** Capture the whole net session by value (save/snapshot/state-hash). */
  snapshot(): NetSnapshot {
    return {
      roster: this.satList.map((s) => ({
        ...s,
        orbit: { ...s.orbit },
        loadout: s.loadout.map((a) => ({ ...a })),
      })),
      balance: this.walletBalance,
      rngState: this.rng.state.toString(),
      launchedCount: this.launchedCount,
      contracts: this.contractList.map(cloneNetContract),
      scenarioCursor: this.scenarioCursor,
      gateTicks: this.gateTicks.slice(),
      lastStepS: this.lastStepS,
      cleanServedSinceS: this.cleanServedSinceS,
      wasteLoggedSats: this.wasteLoggedSats,
      // ACT-3a (C1b) escalation + congestion fold state. chosenSatByContract is captured as sorted
      // [id, satId] pairs so loadBySat is a pure function of folded state across a restore.
      escalationOn: this.escalationOn ? 1 : 0,
      congestionEpoch: this.congestionEpoch,
      chosenSatByContract: [...this.chosenSatByContract.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      ),
      act3aReTameWitnessed: this.act3aReTameWitnessed ? 1 : 0,
      nearBreachWitnessed: [...this.nearBreachWitnessed].sort(),
      congestionFingerprint: this.prevCongestionFingerprint,
    };
  }

  /** Restore the whole net session from a snapshot (the ephemeris is unchanged). */
  restore(s: NetSnapshot): void {
    this.satList.length = 0;
    for (const sat of s.roster) {
      this.satList.push({
        ...sat,
        orbit: { ...sat.orbit },
        loadout: sat.loadout.map((a) => ({ ...a })),
      });
    }
    this.walletBalance = s.balance;
    this.rng.state = BigInt(s.rngState);
    this.launchedCount = s.launchedCount;
    this.contractList.length = 0;
    for (const c of s.contracts) this.contractList.push(cloneNetContract(c));
    this.scenarioCursor = s.scenarioCursor;
    // Every beat up to the restored cursor has already emitted (its contracts are in the
    // restored list), so mark them emitted — a restored session re-emits nothing past.
    this.emittedCursor = s.scenarioCursor;
    this.gateTicks.length = 0;
    for (const gt of s.gateTicks) this.gateTicks.push(gt);
    this.lastStepS = s.lastStepS;
    this.cleanServedSinceS = s.cleanServedSinceS;
    this.wasteLoggedSats = s.wasteLoggedSats;
    // ACT-3a (C1b) escalation + congestion fold state. Nullish-coalesced so a pre-C1b snapshot
    // restores to the dormant defaults (escalation off, epoch 0, empty maps) — byte-identical to
    // the Act-1/Act-2 fold. chosenSatByContract + prevCongestionFingerprint make loadBySat a pure
    // function of folded state across the restore boundary (restore-then-step == continuous-run).
    this.escalationOn = (s.escalationOn ?? 0) === 1;
    this.congestionEpoch = s.congestionEpoch ?? 0;
    this.chosenSatByContract.clear();
    for (const [id, satId] of s.chosenSatByContract ?? []) this.chosenSatByContract.set(id, satId);
    this.act3aReTameWitnessed = (s.act3aReTameWitnessed ?? 0) === 1;
    this.nearBreachWitnessed.clear();
    for (const id of s.nearBreachWitnessed ?? []) this.nearBreachWitnessed.add(id);
    this.prevCongestionFingerprint = s.congestionFingerprint ?? "";
    // The cached router paths are derived; the next step() rebuilds them on a full search
    // (the topology key for a restored roster differs from the empty initial state).
    this.routerStates.clear();
    this.lastSolve.clear();
  }

  /**
   * Fold the `activeAxes` mask of a contract by the FIXED INTEGER ORDINAL (design §4): a
   * caller's state-hash uses this so the fold NEVER depends on Set iteration order or a
   * string sort of mutable labels. Returns the present axes' ordinals, ASCENDING. Exposed
   * here so the A3 golden test folds the mask through the one canonical path.
   */
  static foldAxisOrdinals(activeAxes: ReadonlySet<SlaAxis>): number[] {
    const out: number[] = [];
    // Iterate the ordinal map ASCENDING (connectivity=0, …, bandwidth=3); push present ones.
    const axes = Object.keys(SLA_AXIS_ORDINAL) as SlaAxis[];
    axes.sort((a, b) => SLA_AXIS_ORDINAL[a] - SLA_AXIS_ORDINAL[b]);
    for (const ax of axes) {
      if (activeAxes.has(ax)) out.push(SLA_AXIS_ORDINAL[ax]);
    }
    return out;
  }
}
