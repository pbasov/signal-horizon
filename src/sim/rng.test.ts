import { describe, it, expect } from "vitest";
import { SimRng } from "./rng";

/**
 * Golden values cross-verified against SignalHorizon.Sim/SimRng.cs (C# ulong
 * splitmix64). Same seed → identical NextU64() stream. The bigint arithmetic
 * in JS is spec-defined, so these golden values are portable across all engines.
 *
 * C# verification command (see /tmp/rng_check/):
 *   new SimRng(0).NextU64() × 5 → 16294208416658607535, 7960286522194355700, …
 */
const GOLDEN_SEED_0 = [
  16294208416658607535n,
  7960286522194355700n,
  487617019471545679n,
  17909611376780542444n,
  1961750202426094747n,
] as const;

const GOLDEN_SEED_12345 = [
  2454886589211414944n,
  3778200017661327597n,
  2205171434679333405n,
  3248800117070709450n,
  9350289611492784363n,
] as const;

describe("SimRng — splitmix64 seeded PRNG", () => {
  it("seed 0 produces the golden output stream (C# cross-verified)", () => {
    const rng = new SimRng(0n);
    for (const expected of GOLDEN_SEED_0) {
      expect(rng.nextU64()).toBe(expected);
    }
  });

  it("seed 12345 produces the golden output stream (C# cross-verified)", () => {
    const rng = new SimRng(12345n);
    for (const expected of GOLDEN_SEED_12345) {
      expect(rng.nextU64()).toBe(expected);
    }
  });

  it("same seed → bit-identical stream (1000 draws)", () => {
    const a = new SimRng(42n);
    const b = new SimRng(42n);
    for (let i = 0; i < 1000; i++) {
      expect(a.nextU64()).toBe(b.nextU64());
    }
  });

  it("different seeds → different first output", () => {
    expect(new SimRng(1n).nextU64()).not.toBe(new SimRng(2n).nextU64());
  });

  it("nextDouble() returns values in [0, 1)", () => {
    const rng = new SimRng(7n);
    for (let i = 0; i < 1000; i++) {
      const d = rng.nextDouble();
      expect(d).toBeGreaterThanOrEqual(0);
      expect(d).toBeLessThan(1);
    }
  });

  it("nextDoubleRange() returns values in [from, to)", () => {
    const rng = new SimRng(7n);
    for (let i = 0; i < 1000; i++) {
      const d = rng.nextDoubleRange(-5, 10);
      expect(d).toBeGreaterThanOrEqual(-5);
      expect(d).toBeLessThan(10);
    }
  });

  it("nextIntRange() returns values in [from, to]", () => {
    const rng = new SimRng(7n);
    for (let i = 0; i < 1000; i++) {
      const n = rng.nextIntRange(1, 6);
      expect(n).toBeGreaterThanOrEqual(1);
      expect(n).toBeLessThanOrEqual(6);
      expect(Number.isInteger(n)).toBe(true);
    }
  });

  it("fork() produces a deterministic independent stream", () => {
    const parent = new SimRng(100n);
    const child = parent.fork(999n);
    const parent2 = new SimRng(100n);
    const child2 = parent2.fork(999n);
    expect(child.nextU64()).toBe(child2.nextU64());
  });

  it("fork() with different labels diverges", () => {
    const parent = new SimRng(100n);
    const child1 = parent.fork(1n);
    const parent2 = new SimRng(100n);
    const child2 = parent2.fork(2n);
    expect(child1.nextU64()).not.toBe(child2.nextU64());
  });

  it("state getter/setter round-trips for save/load", () => {
    const rng = new SimRng(42n);
    rng.nextU64();
    rng.nextU64();
    const savedState = rng.state;

    const rng2 = new SimRng();
    rng2.state = savedState;
    expect(rng.nextU64()).toBe(rng2.nextU64());
    expect(rng.nextU64()).toBe(rng2.nextU64());
  });

  it("constructor accepts number seeds", () => {
    const rng = new SimRng(12345);
    expect(typeof rng.nextU64()).toBe("bigint");
  });
});
