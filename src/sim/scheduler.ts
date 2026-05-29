/**
 * Pure fixed-timestep accumulator KERNEL (P0-03 / ticket B3) — the deterministic
 * arithmetic that decides how many whole fixed `dt` steps a real-frame delta
 * produces. A faithful port of SignalHorizon.Sim/SimScheduler.AccumulateSteps.
 *
 * --- WHY THIS EXISTS SEPARATELY FROM clock.ts -----------------------------
 * The LIVE clock (clock.ts SimClock.scheduleWall / nextTick) is correct for
 * RENDERING: it CLAMPS a pathological wall delta to 0.1s and CAPS the owed work
 * at MAX_TICKS_PER_FRAME (600) per frame, deliberately DROPPING steps so a
 * backgrounded tab that refocuses after minutes doesn't death-spiral. That
 * step-dropping is exactly WRONG for a deterministic replay / fast-forward,
 * where every accumulated step must run so the same action log reaches the same
 * tick regardless of how the wall time was sliced into frames.
 *
 * This kernel provides the UNCLAMPED drive path: `maxStepsPerFrame = 0`
 * (UNLIMITED) means no anti-spiral cap and — critically — NO wall-delta clamp.
 * Accumulated scaled wall-time is converted into a complete, no-step-dropped
 * sequence of fixed ticks. Time-acceleration changes how fast the accumulator
 * fills (how MANY steps emit); it never changes `dt`, so fast-forward stays a
 * pure replay of fixed steps.
 *
 * Pure: imports NOTHING from `three` or the DOM, uses no wall-clock time and no
 * nondeterministic RNG. Integer step counts; `dt` is the fixed timestep from
 * clock.ts. clock.ts's external behaviour is untouched — this is the kernel used
 * by the replay / fast-forward path, not the live render loop.
 */

import { DT } from "./clock";

/** Unlimited cap sentinel for {@link accumulateSteps} (deterministic / no-drop path). */
export const UNLIMITED = 0;

/**
 * A mutable accumulator of fractional scaled wall-time that has not yet consumed
 * a whole fixed step. The kernel reads and writes `value` (the C# `ref double
 * accumulator`). Hold one of these per driven clock across frames.
 */
export interface StepAccumulator {
  value: number;
}

/** Construct a fresh, drained accumulator. */
export function newAccumulator(): StepAccumulator {
  return { value: 0 };
}

/**
 * Advance `acc` by `realDelta` wall-seconds scaled by `timeScale`, returning the
 * whole number of fixed `dt` steps that fit (subtracting each from `acc.value`).
 * Mirrors SignalHorizon.Sim.SimScheduler.AccumulateSteps exactly:
 *
 *   - `paused` or `realDelta <= 0` → no advance, returns 0.
 *   - `timeScale` is clamped to >= 0 (a negative scale never rewinds).
 *   - `maxStepsPerFrame <= 0` (UNLIMITED) → no anti-spiral cap: EVERY accumulated
 *     step is emitted. This is the deterministic replay / fast-forward path —
 *     it must not drop steps, and it does NOT clamp the wall delta either (unlike
 *     clock.ts's live `scheduleWall`, which caps at 0.1s and MAX_TICKS_PER_FRAME).
 *   - `maxStepsPerFrame > 0` → anti-spiral cap for a live driver that prefers to
 *     drop steps over stalling; leftover accumulator is preserved (not discarded).
 *
 * Time-acceleration scales the COUNT of steps emitted, never `dt`. So replaying
 * the same wall-duration at scale 1 vs 10 reaches the same tick (10× the scale
 * over 1/10th the frames), with bit-identical per-step state.
 */
export function accumulateSteps(
  acc: StepAccumulator,
  realDelta: number,
  timeScale: number,
  dt: number = DT,
  maxStepsPerFrame: number = UNLIMITED,
  paused = false,
): number {
  if (paused || realDelta <= 0) return 0;

  const scale = Math.max(0, timeScale);
  acc.value += realDelta * scale;

  let steps = 0;
  while (acc.value >= dt) {
    if (maxStepsPerFrame > 0 && steps >= maxStepsPerFrame) break;
    acc.value -= dt;
    steps += 1;
  }
  return steps;
}
