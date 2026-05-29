import { describe, it, expect } from "vitest";
import { accumulateSteps, newAccumulator, UNLIMITED } from "./scheduler";
import { SimClock } from "./clock";
import { Mission } from "./mission";
import { SimRng } from "./rng";
import { loadEphemeris } from "./system-data";
import { canonicalHash, mixInt } from "./state-hash";
import type { SimSnapshot } from "./save";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
import { setTimeScale, noop, KIND_SET_TIME_SCALE } from "./action";

/**
 * DETERMINISM REPLAY GOLDEN-MASTER (ticket B3 / P0-06 part 2).
 *
 * --- WHAT THIS GUARDS, AND WHY IT IS A *DIFFERENT* HASH FROM state-hash ----
 * state-hash.test.ts pins the canonical hash of the orbital TRUTH (transcendental
 * ephemeris positions). That hash is TS-native only — B1/decisions.md SD-15 found
 * the raw-bit ephemeris fold is not bit-portable across runtimes (V8 vs .NET
 * libm differ by 1-2 ULP on Math.sin/atan2/sqrt).
 *
 * This golden folds the ACTION-DRIVEN MUTABLE STATE instead — the clock tick, the
 * RNG u64 state, and the Mission director's integer/bool snapshot fields. Those
 * are exactly representable (integers, a u64, ints/bools) and bit-stable, so the
 * property "same seed + same action log → identical TS mutable state" is a clean,
 * un-fragile determinism guard. We deliberately do NOT re-pin the ephemeris hash
 * as the replay golden (see ticket notes / SD-15).
 *
 * The replay drives a SimClock + Mission (+ SimRng) through the UNLIMITED
 * accumulate-steps kernel (scheduler.ts) — the no-step-dropped path — so the
 * action log reaches a fixed end tick regardless of how the wall time was sliced.
 */

const SEED = 1234567n;

/** Canonical fixed timestep folded into the truth-layer breadcrumb hash. */
const GOLDEN_DT = 1 / 60;

/** End tick the replay always reaches (independent of frame slicing / scale). */
const END_TICK = 1800; // 30 sim-seconds at DT = 1/60.

/**
 * Fold the deterministic MUTABLE state of a replay into a u64 (bigint), reusing
 * the state-hash.ts primitives so save-state and sim-state hash with the same
 * fold. Folds, in fixed order:
 *   - the clock tick (mixInt)
 *   - the RNG internal state — the full u64 (mixInt; bigint is already u64-wide)
 *   - the Mission snapshot fields: nextId / scriptIdx as ints, nextScriptT as an
 *     int (it advances in whole SCRIPT_INTERVAL steps), occulted / booted as 0/1,
 *     and the packet's id (or -1 when no packet is in flight).
 * Everything folded here is exactly representable and bit-stable across runtimes.
 */
function replayStateHash(snap: SimSnapshot): bigint {
  let acc = mixInt(0n, BigInt(snap.tick));
  acc = mixInt(acc, snap.rngState);
  const m = snap.mission;
  acc = mixInt(acc, BigInt(m.nextId));
  acc = mixInt(acc, BigInt(m.scriptIdx));
  acc = mixInt(acc, BigInt(Math.trunc(m.nextScriptT)));
  acc = mixInt(acc, m.occulted ? 1n : 0n);
  acc = mixInt(acc, m.booted ? 1n : 0n);
  acc = mixInt(acc, BigInt(m.packet == null ? -1 : m.packet.id));
  return acc;
}

interface ReplayResult {
  tick: number;
  hash: bigint;
  snapshot: SimSnapshot;
}

/**
 * Replay a SaveGame to `endTick`, driving the clock/mission/rng one step at a
 * time through the UNLIMITED scheduler kernel over `frames` wall-frames of
 * `frameDelta` seconds at `baseScale`. `set_time_scale` actions in the log are
 * applied at their `atTick` (changing how fast the accumulator fills from then
 * on); a paused stretch is honoured. Draws one RNG value per fixed step and
 * advances the Mission to each step's sim-time. Stops emitting once `endTick` is
 * reached so every drive reaches the SAME end state.
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
  const mission = new Mission(eph);
  const rng = new SimRng(sg.seed);
  const acc = newAccumulator();

  // Index the time-scale changes by tick for O(1) lookahead. A pause is modelled
  // as scale 0 (an action with value 0).
  const scaleAt = new Map<number, number>();
  for (const a of sg.actions) {
    if (a.kind === KIND_SET_TIME_SCALE) {
      const v = a.payload.value;
      if (typeof v === "number") scaleAt.set(a.atTick, v);
    }
  }

  let scale = scaleAt.get(0) ?? baseScale;
  let tick = 0;

  for (let f = 0; f < frames && tick < endTick; f++) {
    const steps = accumulateSteps(acc, frameDelta, scale, sg.dt, UNLIMITED, false);
    for (let s = 0; s < steps && tick < endTick; s++) {
      tick += 1;
      // One RNG draw per fixed step (folds the rng state forward deterministically).
      rng.nextU64();
      // Advance the mission to this step's sim-time.
      mission.update(tick * sg.dt);
      // Apply any scale change scheduled exactly at this tick (affects the NEXT
      // accumulate). Honours pauses (value 0) too.
      const next = scaleAt.get(tick);
      if (next !== undefined) scale = next;
    }
  }

  clock.setTick(tick);
  const snapshot: SimSnapshot = {
    tick: clock.tick,
    rngState: rng.state,
    mission: mission.snapshot(),
  };
  return { tick: clock.tick, hash: replayStateHash(snapshot), snapshot };
}

/** The golden SaveGame: a seed, dt = 1/60, and an action log with scale changes. */
function goldenSave() {
  const sg = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
  addAction(sg, setTimeScale(1, 0)); // start at 1×
  addAction(sg, noop(120)); // determinism breadcrumb (no state effect)
  addAction(sg, setTimeScale(10, 600)); // accelerate at tick 600
  addAction(sg, setTimeScale(100, 1200)); // accelerate again at tick 1200
  return sg;
}

/**
 * A SaveGame WITHOUT a tick-0 set_time_scale, so the DRIVER's base scale (not a
 * pinned tick-0 action) sets the fill rate. This is what makes the
 * scale-independence test genuinely vary the drive — the previous version pinned
 * scale at tick 0, which made `baseScale` dead and the assertion vacuous.
 */
function scaleIndepSave() {
  const sg = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
  addAction(sg, noop(120)); // breadcrumb only; no scale action, so baseScale drives
  return sg;
}

// ---------------------------------------------------------------------------
// PINNED TS replay golden (action-driven mutable state). Bootstrapped by running
// the replay once and reading the actual value; pinned HERE as the TS-native
// determinism guard (mirrors state-hash.test.ts's TS_GOLDEN_PIN). Any change to
// the RNG, the Mission director, the scheduler, or the fold moves this value.
// ---------------------------------------------------------------------------
const REPLAY_GOLDEN = 14568270565844115836n;

describe("save-replay golden-master — action-driven mutable state (B3)", () => {
  it("pins the TS replay state hash for the golden SaveGame (regression guard)", () => {
    // Drive at 1× over enough frames to reach END_TICK. frameDelta * frames * 1
    // sim-seconds must cover END_TICK * dt = 30s → 300 frames of 0.1s is ample;
    // the loop stops at END_TICK regardless of surplus.
    const r = replay(goldenSave(), 1, 0.1, 400, END_TICK);
    expect(r.tick).toBe(END_TICK);
    expect(r.hash).toBe(REPLAY_GOLDEN);
  });

  it("SCALE/FRAME-SLICING INDEPENDENCE: three different drives reach the SAME end tick + hash", () => {
    // The core determinism proof (mirrors SaveReplayTests). Drive the SAME save
    // three genuinely different ways and demand identical end state. Uses a save
    // with NO tick-0 scale pin so `baseScale` actually sets the fill rate.
    const save = scaleIndepSave();
    const slow = replay(save, 1, 0.1, 4000, END_TICK); // base 1×, ~300 fine 0.1s frames
    const fast = replay(save, 10, 0.1, 4000, END_TICK); // base 10×, ~30 fine 0.1s frames
    const coarse = replay(save, 1, 5.0, 8, END_TICK); // base 1×, 8 COARSE 5s frames

    // Each drive must REACH END_TICK. The coarse drive is the teeth: only the
    // no-drop kernel emits ~300 steps per 5s frame — a wall-clamping / step-
    // dropping scheduler (the live clock clamps wall-Δ to 0.1s → 6 steps/frame)
    // would stall this drive at tick ~48, failing the assertion.
    expect(slow.tick).toBe(END_TICK);
    expect(fast.tick).toBe(END_TICK);
    expect(coarse.tick).toBe(END_TICK);

    // ...and all three land on bit-identical mutable state, because each fixed tick
    // does the same work (one rng draw + mission.update(tick·dt)) regardless of how
    // the wall time was sliced or how fast the accumulator filled.
    expect(fast.hash).toBe(slow.hash);
    expect(coarse.hash).toBe(slow.hash);
  });

  it("determinism: replaying the same SaveGame twice yields the identical hash", () => {
    const a = replay(goldenSave(), 1, 0.1, 400, END_TICK);
    const b = replay(goldenSave(), 1, 0.1, 400, END_TICK);
    expect(a.hash).toBe(b.hash);
    expect(a.tick).toBe(b.tick);
  });

  it("a DIFFERENT seed yields a DIFFERENT hash (rng state diverges)", () => {
    const base = replay(goldenSave(), 1, 0.1, 400, END_TICK);
    const other = saveGame(SEED + 1n, GOLDEN_DT, { system: "data/system.json" });
    addAction(other, setTimeScale(1, 0));
    addAction(other, setTimeScale(10, 600));
    addAction(other, setTimeScale(100, 1200));
    const r = replay(other, 1, 0.1, 400, END_TICK);
    expect(r.tick).toBe(END_TICK);
    expect(r.hash).not.toBe(base.hash);
  });

  it("a CHANGED action (a pause) yields a DIFFERENT end state at the same wall budget", () => {
    // A pause (scale 0 at tick 900) starves the accumulator: with the SAME finite
    // wall budget the drive cannot reach END_TICK, so the captured tick — and thus
    // the folded mutable state — differs from the unpaused golden.
    const paused = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
    addAction(paused, setTimeScale(1, 0));
    addAction(paused, setTimeScale(10, 600));
    addAction(paused, setTimeScale(0, 900)); // PAUSE at tick 900
    const r = replay(paused, 1, 0.1, 400, END_TICK);
    const base = replay(goldenSave(), 1, 0.1, 400, END_TICK);
    expect(r.tick).toBeLessThan(END_TICK);
    expect(r.hash).not.toBe(base.hash);
  });

  it("the SaveGame seed survives the JSON round-trip and reproduces the hash", () => {
    const sg = goldenSave();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    expect(reloaded!.seed).toBe(SEED);
    const a = replay(sg, 1, 0.1, 400, END_TICK);
    const b = replay(reloaded!, 1, 0.1, 400, END_TICK);
    expect(b.hash).toBe(a.hash);
  });

  it("breadcrumb: the B1 orbital truth hash did not drift (TS golden unchanged)", () => {
    // A 'truth layer did not drift' check: the canonical orbital hash over the
    // replay's end tick set still equals the B1 TS pin. If the ephemeris changed
    // out from under the replay, THIS fires before the replay golden does.
    const eph = loadEphemeris();
    const TS_ORBITAL_GOLDEN = 12899997400407946598n; // state-hash.test.ts TS_GOLDEN_PIN
    const h = canonicalHash(eph, [0, 3600, 86400, 2592000], GOLDEN_DT);
    expect(h).toBe(TS_ORBITAL_GOLDEN);
  });
});
