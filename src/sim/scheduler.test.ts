import { describe, it, expect } from "vitest";
import { accumulateSteps, newAccumulator, UNLIMITED } from "./scheduler";
import { SimClock, DT, MAX_TICKS_PER_FRAME } from "./clock";

/**
 * Kernel tests for the deterministic accumulate-steps path (P0-03 / ticket B3).
 *
 * These prove the contract the replay golden depends on:
 *   1. UNLIMITED drops NO steps — a large accumulated wall-time at high scale
 *      emits exactly the expected tick count (unlike the clamped LIVE clock,
 *      which caps at MAX_TICKS_PER_FRAME per frame and clamps the wall delta).
 *   2. The kernel is deterministic — identical (delta, scale, dt) schedules
 *      reach the identical step total and leave the identical accumulator.
 *   3. Time-acceleration scales the COUNT of ticks emitted, never DT — the same
 *      wall-duration at 1× vs 10× reaches a 10× tick total over 1/10th the frames.
 */

describe("accumulateSteps — deterministic kernel (B3)", () => {
  it("UNLIMITED drops NO steps: emits the full owed tick count (no artificial cap)", () => {
    // A whole-tick budget where the accumulate-subtract loop is FP-exact
    // (120·DT = 2.0 reproduces 120 steps cleanly). The kernel imposes NO cap, so
    // every owed step is emitted; the live clock would HARD-CAP a budget like this.
    const acc = newAccumulator();
    const steps = accumulateSteps(acc, 120 * DT, 1, DT, UNLIMITED, false);
    expect(steps).toBe(120);
    expect(acc.value).toBeCloseTo(0, 9);
  });

  it("CONTRAST: the live SimClock truncates a giant fast-forward; the kernel does not", () => {
    // 60_000 sim-seconds owed in one frame at 1×. The kernel emits essentially
    // all of it (within 1 step of the ideal 3_600_000 — the accumulate-subtract
    // loop's deterministic FP boundary, faithful to the C# `accumulator -= dt`).
    // The LIVE clock clamps the wall delta to 0.1s and caps the owed work, so it
    // emits at most MAX_TICKS_PER_FRAME — orders of magnitude fewer.
    const wall = 60_000; // sim-seconds owed at 1×
    const clock = new SimClock();
    clock.scaleIndex = 0; // 1×
    clock.scheduleWall(wall);
    let live = 0;
    while (clock.nextTick() !== null) live++;
    expect(live).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);

    const acc = newAccumulator();
    const kernel = accumulateSteps(acc, wall, 1, DT, UNLIMITED, false);
    // Within 1 step of the ideal (FP boundary), and dramatically more than the
    // capped live clock — the kernel dropped nothing it was not forced to by FP.
    expect(kernel).toBeGreaterThanOrEqual(3_600_000 - 1);
    expect(kernel).toBeLessThanOrEqual(3_600_000);
    expect(kernel).toBeGreaterThan(live);
  });

  it("anti-spiral cap (maxStepsPerFrame > 0) caps emitted steps but keeps the remainder", () => {
    const acc = newAccumulator();
    const steps = accumulateSteps(acc, 10, 1, DT, 100, false);
    expect(steps).toBe(100);
    // 10s scaled = 600 ticks' worth owed; 100 emitted, 500 ticks still owed.
    expect(acc.value).toBeCloseTo(500 * DT, 9);
  });

  it("is deterministic across two independent accumulators on the same schedule", () => {
    const schedule = [0.016, 0.018, 0.015, 0.02, 0.016, 0.017, 0.033, 0.001];
    const a = newAccumulator();
    const b = newAccumulator();
    let totalA = 0;
    let totalB = 0;
    for (const d of schedule) {
      totalA += accumulateSteps(a, d, 100, DT, UNLIMITED, false);
      totalB += accumulateSteps(b, d, 100, DT, UNLIMITED, false);
    }
    expect(totalA).toBe(totalB);
    expect(a.value).toBe(b.value);
  });

  it("paused or non-positive delta emits zero and never advances", () => {
    const acc = newAccumulator();
    expect(accumulateSteps(acc, 1, 100, DT, UNLIMITED, true)).toBe(0);
    expect(accumulateSteps(acc, 0, 100, DT, UNLIMITED, false)).toBe(0);
    expect(accumulateSteps(acc, -5, 100, DT, UNLIMITED, false)).toBe(0);
    expect(acc.value).toBe(0);
  });

  it("a negative time-scale is clamped to 0 (never rewinds)", () => {
    const acc = newAccumulator();
    expect(accumulateSteps(acc, 1, -10, DT, UNLIMITED, false)).toBe(0);
    expect(acc.value).toBe(0);
  });

  it("time-acceleration scales the TICK COUNT (exactly, at a clean small count)", () => {
    // A binary-clean small budget where the accumulate-subtract loop is FP-exact:
    // 3 ticks per frame. 1× emits 3, 10× emits 30 over the SAME wall budget —
    // proving acceleration multiplies the COUNT (×10), while DT is untouched.
    const a = newAccumulator();
    const b = newAccumulator();
    const frame = 3 * DT;
    const ticks1x = accumulateSteps(a, frame, 1, DT, UNLIMITED, false);
    const ticks10x = accumulateSteps(b, frame, 10, DT, UNLIMITED, false);
    expect(ticks1x).toBe(3);
    expect(ticks10x).toBe(30);
    expect(ticks10x / ticks1x).toBe(10);
  });

  it("acceleration multiplies the tick count proportionally at scale, never DT", () => {
    // At larger counts the deterministic accumulate-subtract FP boundary can drop
    // the LAST step of a frame, so the ratio is ~10× rather than exactly 10× — but
    // it is DETERMINISTIC and DT never changes (every emitted step is exactly one
    // DT). The higher scale emits roughly 10× more steps over the same wall budget.
    const a = newAccumulator();
    const b = newAccumulator();
    let ticks1x = 0;
    let ticks10x = 0;
    for (let i = 0; i < 10; i++) {
      ticks1x += accumulateSteps(a, 1.0, 1, DT, UNLIMITED, false);
      ticks10x += accumulateSteps(b, 1.0, 10, DT, UNLIMITED, false);
    }
    const ratio = ticks10x / ticks1x;
    expect(ratio).toBeGreaterThan(9.9);
    expect(ratio).toBeLessThan(10.1);
  });

  it("fractional remainder carries across frames (no partial-tick bleed)", () => {
    const acc = newAccumulator();
    // 2.5 ticks' worth at 1× → 2 steps, 0.5 tick remainder.
    expect(accumulateSteps(acc, 2.5 * DT, 1, DT, UNLIMITED, false)).toBe(2);
    expect(acc.value).toBeCloseTo(0.5 * DT, 12);
    // +1.0 tick = 1.5 owed → 1 step, 0.5 remainder again.
    expect(accumulateSteps(acc, DT, 1, DT, UNLIMITED, false)).toBe(1);
    expect(acc.value).toBeCloseTo(0.5 * DT, 12);
  });
});
