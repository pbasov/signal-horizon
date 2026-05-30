import { describe, it, expect } from "vitest";
import { accumulateSteps, newAccumulator, UNLIMITED } from "./scheduler";
import { SimClock } from "./clock";
import { SimRng } from "./rng";
import { loadEphemeris } from "./system-data";
import { mixInt, mixFloat } from "./state-hash";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
import {
  setTimeScale,
  prefetch,
  noop,
  setPrefetchPolicy,
  KIND_SET_TIME_SCALE,
  KIND_PREFETCH,
  KIND_SET_PREFETCH_POLICY,
  type SimAction,
} from "./action";
import { M1Session } from "./m1/session";
import { applySessionAction } from "./m1/apply-action";

/**
 * M1-SESSION DETERMINISM REPLAY (ticket E3 / M1-06).
 *
 * --- WHAT THIS GUARDS -------------------------------------------------------
 * save-replay.test.ts pins the action-driven mutable state of the clock + RNG +
 * Mission director. This file extends that proof to the LIVE M1 ECONOMY LOOP: it
 * replays a SaveGame action log that INCLUDES A PREFETCH ACTION through an
 * M1Session (+ clock + rng) and folds the session's mutable state — the economy
 * BALANCE, the CACHE sample, and the FETCH state — alongside the clock tick and
 * rng u64. The property proven: a player's prefetch is deterministic VIA THE LOG
 * — replay the same seed + dt + action log and the wallet/cache/fetch reproduce
 * bit-identically. A prefetch's effect (its € charge + the sample it positions)
 * is fully captured by recording WHEN it happened.
 *
 * The session step is a pure fold of (eph, tick·dt, prior state); applying a
 * prefetch at its recorded atTick AFTER that tick's step (post-drain, the SAME
 * ordering main.ts's keypress uses, via the shared applySessionAction)
 * reproduces the exact cache + balance trajectory the live loop produces. Folded
 * fields (balance is a double via mixFloat; cache capture time + the fetch
 * arrival are doubles; tick + rng are ints/u64) are bit-stable; the geometry
 * that feeds them is the same deterministic Kepler ephemeris on both runs, so
 * the fold is reproducible.
 */

const SEED = 1234567n;
const GOLDEN_DT = 1 / 60;

/**
 * End tick the replay reaches. E7: the REALISTIC empty-cache session now has FIVE
 * feeds breathing on their own timelines against a SHARED 3-slot cache. step(0)
 * misses on every feed → five auto-miss legs launch (one-way Earth→Mars ≈ 923s) →
 * they ARRIVE at tick ≈ 55383; only 3 datasets survive the 3-slot eviction so the
 * 2 losers re-miss + re-launch, and the cache breathes per-feed thereafter.
 * END_TICK sits after the first arrivals so the LOGGED player prefetch (tick
 * {@link PREFETCH_TICK}) finds an eligible feed (the cached ones have legs idle),
 * actually launches a leg + charges €, materially moving the fold.
 */
const END_TICK = 120000; // 2000 sim-seconds at DT = 1/60 (≈ 33 min).

/**
 * Tick at which the golden log issues the player prefetch: ≈ t=1333s, AFTER the
 * first arrivals (≈ tick 55383), when at least one cached feed has no leg in flight
 * and the link is up — so the most-urgent-eligible prefetch is USABLE (it launches
 * a data-leg fetch and charges €50).
 */
const PREFETCH_TICK = 80000;

/**
 * Fold the session's mutable state into a u64, reusing the state-hash primitives.
 * E7: the state now covers the WHOLE ROSTER — every feed's fetch state and every
 * occupied cache slot — so the fold extends accordingly. Folds, in fixed order:
 *   - clock tick (int) and rng u64 (the shared replay anchor);
 *   - economy BALANCE (double, via mixFloat — it folds opex per step + any
 *     prefetch charge, so it captures the action's € effect);
 *   - PER FEED, in roster order: in-flight flag (0/1) + launch + arrival times;
 *   - PER SLOT, in cache order: a dataset-id hash + capture time + half-life.
 * Everything folded is bit-stable across runs (the doubles come from the same
 * deterministic ephemeris geometry on every drive).
 */
function strHash(s: string): bigint {
  // A tiny deterministic FNV-1a over the dataset id so the slot identity folds.
  let h = 1469598103934665603n;
  for (let i = 0; i < s.length; i++) {
    h ^= BigInt(s.charCodeAt(i));
    h = (h * 1099511628211n) & 0xffffffffffffffffn;
  }
  return h;
}

function sessionStateHash(tick: number, rngState: bigint, s: M1Session): bigint {
  const snap = s.snapshot();
  let acc = mixInt(0n, BigInt(tick));
  acc = mixInt(acc, rngState);
  acc = mixFloat(acc, s.economy.balance);
  for (const f of snap.feeds) {
    acc = mixInt(acc, f.fetchInFlight ? 1n : 0n);
    acc = mixFloat(acc, f.fetchLaunchT);
    acc = mixFloat(acc, f.fetchArrivalT);
  }
  acc = mixInt(acc, BigInt(snap.slots.length));
  for (const slot of snap.slots) {
    acc = mixInt(acc, strHash(slot.datasetId));
    acc = mixFloat(acc, slot.capturedAtT);
    acc = mixFloat(acc, slot.halfLifeS);
  }
  // E8 — fold the standing prefetch policy so a logged policy CHANGE moves the
  // hash (the lever's state is part of the save). mode → id hash; the knobs are
  // doubles via mixFloat.
  acc = mixInt(acc, strHash(snap.policy.mode));
  acc = mixFloat(acc, snap.policy.freshnessFloor);
  acc = mixFloat(acc, snap.policy.blackoutLeadS);
  acc = mixFloat(acc, snap.policy.maxConcurrentAuto);
  return acc;
}

interface ReplayResult {
  tick: number;
  hash: bigint;
  balance: number;
  session: M1Session;
}

/**
 * Replay a SaveGame to `endTick`, driving an M1Session one fixed step at a time
 * through the UNLIMITED scheduler kernel over `frames` wall-frames of
 * `frameDelta` seconds at `baseScale`. `set_time_scale` actions change the fill
 * rate from their `atTick`; a `prefetch` action is applied AFTER that tick's step
 * (post-drain) via the SHARED {@link applySessionAction} — the SAME ordering and
 * code path main.ts uses for the live keypress, so the two cannot diverge. One
 * rng draw per step keeps the rng anchor in lockstep with the clock.
 *
 * REALISTIC EMPTY CACHE: the session starts EMPTY (no pre-loaded fresh sample),
 * exactly as a real post-boot session does. So step(0) misses and starts the
 * auto-miss fetch; the loop breathes (arrive ≈ 0.84 → decay → miss → refetch);
 * and a logged prefetch is exercised as it actually occurs live — including the
 * adversarial case where step(at_tick) itself starts a miss-fetch.
 */
function replay(
  sg: ReturnType<typeof saveGame>,
  baseScale: number,
  frameDelta: number,
  frames: number,
  endTick: number,
): ReplayResult {
  const eph = loadEphemeris();
  const clock = new SimClock();
  const rng = new SimRng(sg.seed);
  const session = new M1Session();
  const acc = newAccumulator();

  // Index actions by the tick they apply at. Session-mutating actions (prefetch
  // AND set_prefetch_policy) are applied POST-step via the SHARED
  // applySessionAction, so live + replay cannot drift; scale changes act on the
  // clock fill rate (handled separately).
  const scaleAt = new Map<number, number>();
  const sessionActionsAt = new Map<number, SimAction[]>();
  for (const a of sg.actions) {
    if (a.kind === KIND_SET_TIME_SCALE) {
      const v = a.payload.value;
      if (typeof v === "number") scaleAt.set(a.atTick, v);
    } else if (a.kind === KIND_PREFETCH || a.kind === KIND_SET_PREFETCH_POLICY) {
      const list = sessionActionsAt.get(a.atTick) ?? [];
      list.push(a);
      sessionActionsAt.set(a.atTick, list);
    }
  }

  let scale = scaleAt.get(0) ?? baseScale;
  let tick = 0;

  for (let f = 0; f < frames && tick < endTick; f++) {
    const steps = accumulateSteps(acc, frameDelta, scale, sg.dt, UNLIMITED, false);
    for (let st = 0; st < steps && tick < endTick; st++) {
      tick += 1;
      const tSeconds = tick * sg.dt;
      // One rng draw per fixed step (shared anchor with the clock).
      rng.nextU64();
      // Advance the live cache/economy loop one fixed step. The economy accrues
      // over THIS step's dt (sg.dt) — the per-sim-time rate model is DT-invariant.
      session.step(eph, tSeconds, sg.dt);
      // Apply a prefetch recorded at THIS tick AFTER the step (post-drain), via
      // the SAME shared helper main.ts uses — so the launched fetch + the €
      // charge land exactly as they did live, even when step() just started its
      // own miss-fetch (the one-in-flight gate then makes the prefetch a no-op
      // identically in both paths).
      const sas = sessionActionsAt.get(tick);
      if (sas !== undefined) for (const sa of sas) applySessionAction(eph, session, sa, sg.dt);
      // A scale change scheduled at this tick affects the NEXT accumulate.
      const next = scaleAt.get(tick);
      if (next !== undefined) scale = next;
    }
  }

  clock.setTick(tick);
  return {
    tick: clock.tick,
    hash: sessionStateHash(clock.tick, rng.state, session),
    balance: session.economy.balance,
    session,
  };
}

/** The golden SaveGame: a seed, dt = 1/60, scale changes, AND a prefetch action. */
function goldenSave() {
  const sg = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
  addAction(sg, setTimeScale(1, 0)); // start at 1×
  addAction(sg, noop(120)); // determinism breadcrumb (no state effect)
  addAction(sg, setTimeScale(10, 600)); // accelerate at tick 600
  addAction(sg, prefetch(PREFETCH_TICK)); // PLAYER PREFETCH at tick 80000 (mid-window)
  return sg;
}

/** The same log with NO prefetch — isolates the prefetch's effect on the fold. */
function noPrefetchSave() {
  const sg = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
  addAction(sg, setTimeScale(1, 0));
  addAction(sg, noop(120));
  addAction(sg, setTimeScale(10, 600));
  return sg;
}

/**
 * A reference "LIVE" drive that mirrors main.ts's frame loop ORDERING exactly:
 * each fixed tick runs session.step() (the drain), and a player prefetch fires
 * POST-DRAIN at the current tick via the SAME shared {@link applySessionAction}.
 * No scheduler/scale slicing — it ticks 1..endTick directly — so it is an
 * independent oracle for "what the live loop produces", to compare against the
 * scheduler-driven {@link replay}. The prefetch ticks are applied after step().
 */
function liveDrive(
  prefetchTicks: number[],
  endTick: number,
  dt = GOLDEN_DT,
  policyActions: SimAction[] = [],
): M1Session {
  const eph = loadEphemeris();
  const session = new M1Session();
  const pref = new Set(prefetchTicks);
  // Index any standing-policy changes by the tick they apply at (post-drain).
  const policyAt = new Map<number, SimAction[]>();
  for (const a of policyActions) {
    const list = policyAt.get(a.atTick) ?? [];
    list.push(a);
    policyAt.set(a.atTick, list);
  }
  for (let tick = 1; tick <= endTick; tick++) {
    const tSeconds = tick * dt;
    session.step(eph, tSeconds, dt); // the frame's drain (accrue over this step's dt)
    // Post-drain keypresses, at the current tick — main.ts's exact ordering. Policy
    // changes apply via the SAME shared helper as a prefetch.
    const pa = policyAt.get(tick);
    if (pa !== undefined) for (const a of pa) applySessionAction(eph, session, a, dt);
    if (pref.has(tick)) {
      applySessionAction(eph, session, prefetch(tick), dt);
    }
  }
  return session;
}

// ---------------------------------------------------------------------------
// PINNED M1-session replay golden (action-driven economy + cache + fetch state).
// Bootstrapped by running the replay once and reading the actual value; pinned
// HERE as the regression guard. Any change to the economy fold, the session
// loop, the prefetch action, the rng, or the scheduler moves this value.
// ---------------------------------------------------------------------------
// E10b re-pin: the default policy's blackoutLeadS retuned 1200 → 1800 (so a
// default-mode pre-stage beats the Earth↔Mars light-gap near conjunction). The
// session boots with defaultPolicy(), and the replay fold folds policy.blackoutLeadS,
// so the golden moves by exactly that field. Determinism is unchanged — the
// same-log-twice, scale/frame-slicing, and LIVE==REPLAY tests still pass; only
// the pinned value moved. (Prior E10a golden: 8072561960299808504n.)
const REPLAY_GOLDEN = 544847093270497462n;

describe("m1-session replay golden — action-driven economy + cache + fetch (E3)", () => {
  it("pins the M1-session replay state hash for the golden SaveGame (regression guard)", () => {
    const r = replay(goldenSave(), 1, 0.1, 40000, END_TICK);
    expect(r.tick).toBe(END_TICK);
    expect(r.hash).toBe(REPLAY_GOLDEN);
  });

  it("a logged PREFETCH is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replay(goldenSave(), 1, 0.1, 40000, END_TICK);
    const b = replay(goldenSave(), 1, 0.1, 40000, END_TICK);
    expect(a.tick).toBe(b.tick);
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
  });

  it("SCALE/FRAME-SLICING INDEPENDENCE: three different drives reach the SAME end state", () => {
    // Drive the SAME save three genuinely different ways (fine vs coarse frames,
    // different base scales) and demand identical end state — the prefetch lands
    // at the same tick regardless of how wall time is sliced.
    const save = goldenSave();
    const slow = replay(save, 1, 0.1, 40000, END_TICK); // base 1×, fine 0.1s frames
    const fast = replay(save, 10, 0.1, 40000, END_TICK); // base 10×, fine frames
    const coarse = replay(save, 1, 5.0, 500, END_TICK); // base 1×, COARSE 5s frames

    expect(slow.tick).toBe(END_TICK);
    expect(fast.tick).toBe(END_TICK);
    expect(coarse.tick).toBe(END_TICK);
    expect(fast.hash).toBe(slow.hash);
    expect(coarse.hash).toBe(slow.hash);
  });

  it("LIVE == REPLAY: the scheduler-driven replay reproduces the live-loop ordering exactly", () => {
    // The independent live-loop oracle (drain step(), then post-drain prefetch)
    // must land on the SAME session state the scheduler-driven replay produces.
    // This is the determinism the ordering fix guarantees: both apply the
    // prefetch AFTER step(at_tick), via the shared applySessionAction.
    const replayed = replay(goldenSave(), 1, 0.1, 40000, END_TICK);
    const live = liveDrive([PREFETCH_TICK], END_TICK);
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.economy.balance).toBe(replayed.balance);
  });

  it("ADVERSARIAL competing case: a prefetch at a tick where step() starts a miss-fetch — live == replay", () => {
    // Tick 1: the empty cache misses and step(1·dt) STARTS the auto-miss fetch.
    // A prefetch recorded at tick 1 is applied POST-step in BOTH paths, so the
    // one-fetch-in-flight gate makes it a no-op IDENTICALLY — no double-charge,
    // no divergence. (Applying the prefetch BEFORE step here was the old bug: the
    // prefetch would win the race in replay but lose it live, diverging by €50.)
    const COMPETE_TICK = 1;
    const adversarial = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
    addAction(adversarial, setTimeScale(1, 0));
    addAction(adversarial, prefetch(COMPETE_TICK)); // collides with step(1)'s miss-fetch
    const endTick = 600; // short: the auto-miss fetch is still crawling throughout

    const replayed = replay(adversarial, 1, 0.1, 4000, endTick);
    const live = liveDrive([COMPETE_TICK], endTick);

    // live == replay: identical session state.
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.economy.balance).toBe(replayed.balance);
    // And the competing prefetch was correctly GATED: at tick 1 every feed already
    // launched its own auto-miss leg (the empty cache misses on ALL feeds), so the
    // most-urgent-eligible prefetch has NO eligible feed and is a no-op (no €50
    // charge) — the same run with NO prefetch action ends on the identical balance.
    const noPrefetch = liveDrive([], endTick);
    expect(live.economy.balance).toBe(noPrefetch.economy.balance);
    // Every feed has its auto-miss leg in flight — the prefetch started none extra.
    expect(live.snapshot().feeds.every((f) => f.fetchInFlight)).toBe(true);
  });

  it("the PREFETCH action materially changes the folded state (balance + fetch state differ)", () => {
    const withP = replay(goldenSave(), 1, 0.1, 40000, END_TICK);
    const without = replay(noPrefetchSave(), 1, 0.1, 40000, END_TICK);
    // Same end tick. The prefetch (tick 80000) targets the most-urgent ELIGIBLE
    // feed and launches its data leg + charges €50, so the balance and the per-feed
    // fetch state — and thus the fold — diverge from the no-prefetch run.
    expect(withP.tick).toBe(without.tick);
    expect(withP.hash).not.toBe(without.hash);
    expect(withP.balance).not.toBe(without.balance);
    // The prefetch is exactly €50 cheaper than the no-prefetch run (the one-shot
    // cost). The leg it launched arrives one-way light time later (well past
    // END_TICK), so no slot contents change up to END_TICK; €50 is the ONLY balance
    // difference (every per-step payout up to END_TICK is otherwise identical).
    expect(without.balance - withP.balance).toBeCloseTo(50.0, 6);
    // The fold differs in more than just the balance: the prefetch relaunched its
    // target feed's leg at a different instant, so the per-feed fetch launch/arrival
    // times in the snapshot differ from the no-prefetch run (the fold is sensitive
    // to WHICH feed's leg launched WHEN, not just the count).
    expect(withP.session.snapshot().feeds).not.toEqual(without.session.snapshot().feeds);
  });

  it("E8: a run that TOGGLES the prefetch POLICY mid-run replays bit-identically (logged-intent / derived-automation split)", () => {
    // This is the determinism teeth for E8's tame-it lever: the AUTOPILOT's
    // per-step prefetches are a PURE function of (policy, state) run INSIDE step(),
    // so they are NEVER logged — only the CHANGE of policy is a player action. A
    // log that flips the policy to freshness mid-run must therefore replay
    // bit-identically (the derived auto-prefetches reproduce with no extra log).
    const POLICY_TICK = 60000; // ~1000 s — well after the first arrivals.
    const sg = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
    addAction(sg, setTimeScale(1, 0));
    addAction(sg, setTimeScale(10, 600));
    // Switch the autopilot ON mid-run: blackout mode, 0.6 floor, 1200 s lead, cap 3.
    addAction(sg, setPrefetchPolicy("freshness_blackout", 0.6, 1200, 3, POLICY_TICK));

    const a = replay(sg, 1, 0.1, 40000, END_TICK);
    const b = replay(sg, 1, 0.1, 40000, END_TICK);
    // Same log twice → identical state (the autopilot is deterministic).
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);

    // And LIVE == REPLAY: the independent live-loop oracle, fed the SAME policy
    // action post-drain, lands on the identical session state.
    const live = liveDrive([], END_TICK, GOLDEN_DT, [
      setPrefetchPolicy("freshness_blackout", 0.6, 1200, 3, POLICY_TICK),
    ]);
    expect(live.snapshot()).toEqual(a.session.snapshot());
    expect(live.economy.balance).toBe(a.balance);

    // The policy actually CHANGED the trajectory: turning the autopilot on spends
    // €50/auto-prefetch and reshapes the cache, so the end balance differs from a
    // run that left the policy at the default "manual".
    const manual = replay(noPrefetchSave(), 1, 0.1, 40000, END_TICK);
    expect(a.balance).not.toBe(manual.balance);
    // The restored session carries the switched-on policy (save/load round-trips it).
    expect(a.session.snapshot().policy.mode).toBe("freshness_blackout");
  });

  it("the SaveGame (incl. the prefetch action) survives the JSON round-trip and reproduces the hash", () => {
    const sg = goldenSave();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    // The prefetch action survives the wire round-trip.
    expect(reloaded!.actions.some((a) => a.kind === KIND_PREFETCH)).toBe(true);
    const a = replay(sg, 1, 0.1, 40000, END_TICK);
    const b = replay(reloaded!, 1, 0.1, 40000, END_TICK);
    expect(b.hash).toBe(a.hash);
  });
});
