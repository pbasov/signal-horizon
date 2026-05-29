import { describe, it, expect } from "vitest";
import { SimClock, DT, MAX_TICKS_PER_FRAME } from "./clock";

describe("SimClock — fixed-tick determinism", () => {
  it("seconds() is always tick * DT", () => {
    const clock = new SimClock();
    expect(clock.tick).toBe(0);
    expect(clock.seconds).toBe(0);

    clock.scaleIndex = 0;
    for (let i = 0; i < 10; i++) {
      clock.scheduleWall(0.016);
      while (clock.nextTick() !== null) {}
    }
    expect(clock.tick).toBeGreaterThan(0);
    expect(clock.seconds).toBeCloseTo(clock.tick * DT, 15);
  });

  it("deterministic: same frame schedule produces same final tick", () => {
    // Two clocks fed the exact same frame schedule end at the same tick.
    // That's the guarantee: reproducibility, not frame-split independence.
    const schedule = [0.016, 0.018, 0.015, 0.020, 0.016, 0.017];

    const a = new SimClock();
    a.scaleIndex = 0;
    const b = new SimClock();
    b.scaleIndex = 0;

    for (const dt of schedule) {
      a.scheduleWall(dt);
      while (a.nextTick() !== null) {}
      b.scheduleWall(dt);
      while (b.nextTick() !== null) {}
    }

    expect(a.tick).toBe(b.tick);
    expect(a.seconds).toBe(b.seconds);
  });

  it("time-acceleration scales tick count, not DT", () => {
    const clock1x = new SimClock();
    clock1x.scaleIndex = 0;
    const clock10x = new SimClock();
    clock10x.scaleIndex = 1;

    for (let i = 0; i < 10; i++) {
      clock1x.scheduleWall(0.016);
      while (clock1x.nextTick() !== null) {}
      clock10x.scheduleWall(0.016);
      while (clock10x.nextTick() !== null) {}
    }

    // 10× should produce roughly 10× more ticks (within 20% — fractional
    // accumulation means it's not exactly 10× for small frame counts)
    const ratio = clock10x.tick / clock1x.tick;
    expect(ratio).toBeGreaterThan(8);
    expect(ratio).toBeLessThan(12);
  });

  it("pause prevents any tick advancement", () => {
    const clock = new SimClock();
    clock.togglePause();
    clock.scheduleWall(0.016);
    while (clock.nextTick() !== null) {}
    expect(clock.tick).toBe(0);
    expect(clock.seconds).toBe(0);
  });

  it("setTick() restores exact state for save/load", () => {
    const clock = new SimClock();
    clock.scaleIndex = 0;
    for (let i = 0; i < 50; i++) {
      clock.scheduleWall(0.016);
      while (clock.nextTick() !== null) {}
    }

    const savedTick = clock.tick;
    const savedSeconds = clock.seconds;

    const clock2 = new SimClock();
    clock2.setTick(savedTick);
    expect(clock2.tick).toBe(savedTick);
    expect(clock2.seconds).toBe(savedSeconds);
  });

  it("death-spiral clamp: pathological delta is capped", () => {
    const clock = new SimClock();
    clock.scaleIndex = 3; // 1000×
    clock.scheduleWall(60); // Tab backgrounded for 60s
    let count = 0;
    while (clock.nextTick() !== null) count++;
    expect(count).toBeLessThanOrEqual(MAX_TICKS_PER_FRAME);
  });

  it("no partial-tick bleed: accumulator drains exactly", () => {
    const clock = new SimClock();
    clock.scaleIndex = 0;
    clock.scheduleWall(3 * DT); // Exactly 3 ticks
    let count = 0;
    while (clock.nextTick() !== null) count++;
    expect(count).toBe(3);
    expect(clock.nextTick()).toBeNull();
  });

  it("accumulator carries fractional remainder correctly", () => {
    const clock = new SimClock();
    clock.scaleIndex = 0;
    clock.scheduleWall(2.5 * DT);
    let count = 0;
    while (clock.nextTick() !== null) count++;
    expect(count).toBe(2);

    // 0.5 remainder + 1.0 new = 1.5 DT → 1 tick, 0.5 left
    clock.scheduleWall(DT);
    count = 0;
    while (clock.nextTick() !== null) count++;
    expect(count).toBe(1);
  });

  it("DT is exactly 1/60", () => {
    expect(DT).toBe(1 / 60);
  });

  it("scale() returns 0 when paused, correct multiplier otherwise", () => {
    const clock = new SimClock();
    clock.scaleIndex = 2;
    expect(clock.scale).toBe(100);
    clock.togglePause();
    expect(clock.scale).toBe(0);
    clock.togglePause();
    expect(clock.scale).toBe(100);
  });

  it("faster/slower cycle through TIME_SCALES", () => {
    const clock = new SimClock();
    expect(clock.scaleIndex).toBe(2);
    clock.faster();
    expect(clock.scaleIndex).toBe(3);
    clock.faster();
    expect(clock.scaleIndex).toBe(3); // clamped
    clock.slower();
    clock.slower();
    clock.slower();
    expect(clock.scaleIndex).toBe(0);
    clock.slower();
    expect(clock.scaleIndex).toBe(0);
  });

  it("determinism: two clocks fed identical schedules end at the same tick", () => {
    const a = new SimClock();
    const b = new SimClock();
    a.scaleIndex = 2;
    b.scaleIndex = 2;

    for (let i = 0; i < 100; i++) {
      const dt = 0.010 + 0.005 * Math.sin(i);
      a.scheduleWall(dt);
      b.scheduleWall(dt);
      while (a.nextTick() !== null) {}
      while (b.nextTick() !== null) {}
    }

    expect(a.tick).toBe(b.tick);
    expect(a.seconds).toBe(b.seconds);
  });
});
