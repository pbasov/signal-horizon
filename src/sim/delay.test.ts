import { describe, it, expect } from "vitest";
import { oneWaySeconds, roundTripSeconds, freshness } from "./delay";
import { C_LIGHT } from "./ephemeris";

/**
 * Pins SignalHorizon.Sim/SignalDelay.cs semantics. The light-delay math is exact
 * rational arithmetic (distance / C_LIGHT, where C_LIGHT = 299792458 is the SI
 * definition), so those are asserted to the bit. Freshness is 2^(-age/halfLife):
 * exact at the power-of-two grid points (age == k·halfLife), tolerance elsewhere
 * because Math.pow is transcendental.
 */
describe("oneWaySeconds — straight-line light delay (metres → seconds)", () => {
  it("divides distance by the exact SI speed of light", () => {
    // C_LIGHT is integral, so these divisions are exact doubles.
    expect(oneWaySeconds(C_LIGHT)).toBe(1);
    expect(oneWaySeconds(2 * C_LIGHT)).toBe(2);
    expect(oneWaySeconds(C_LIGHT / 2)).toBe(0.5);
  });

  it("matches d / C_LIGHT for arbitrary distances (bit-identical)", () => {
    for (const d of [0, 1, 1234.5, 1.5e11, 1e-3, 9.4607e15]) {
      expect(oneWaySeconds(d)).toBe(d / C_LIGHT);
    }
  });

  it("uses the canonical SI value 299792458 for C_LIGHT", () => {
    expect(C_LIGHT).toBe(299792458);
  });

  it("zero distance is zero delay; is sign-preserving and linear", () => {
    expect(oneWaySeconds(0)).toBe(0);
    expect(oneWaySeconds(-C_LIGHT)).toBe(-1);
    // Scaling distance scales delay by the same factor.
    expect(oneWaySeconds(3 * 1.5e11)).toBe(3 * oneWaySeconds(1.5e11));
  });
});

describe("roundTripSeconds — there-and-back delay", () => {
  it("is exactly twice the one-way delay", () => {
    for (const d of [0, 1, C_LIGHT, 1.5e11, 7777.25]) {
      expect(roundTripSeconds(d)).toBe(2 * oneWaySeconds(d));
    }
  });

  it("equals 2·d / C_LIGHT at exact grid points", () => {
    expect(roundTripSeconds(C_LIGHT)).toBe(2);
    expect(roundTripSeconds(0)).toBe(0);
  });
});

describe("freshness — 2^(-age/halfLife) decay in [0,1]", () => {
  it("is exactly 1 at age 0 (just-launched packet)", () => {
    expect(freshness(0, 100)).toBe(1);
    expect(freshness(0, 1)).toBe(1);
  });

  it("is exactly 0.5 after one half-life", () => {
    expect(freshness(100, 100)).toBe(0.5);
    expect(freshness(1, 1)).toBe(0.5);
  });

  it("halves at each successive half-life (exact powers of two)", () => {
    const hl = 50;
    expect(freshness(0, hl)).toBe(1);
    expect(freshness(hl, hl)).toBe(0.5);
    expect(freshness(2 * hl, hl)).toBe(0.25);
    expect(freshness(3 * hl, hl)).toBe(0.125);
    expect(freshness(10 * hl, hl)).toBe(2 ** -10);
  });

  it("doubles for negative age (one half-life before launch)", () => {
    // 2^(-(-hl)/hl) = 2^1 = 2 — exact power of two.
    expect(freshness(-100, 100)).toBe(2);
  });

  it("matches Math.pow(2, -age/halfLife) for non-grid ages (transcendental)", () => {
    for (const [age, hl] of [
      [37, 100],
      [250, 80],
      [0.001, 1.5e11 / 299792458],
    ]) {
      expect(freshness(age, hl)).toBeCloseTo(Math.pow(2, -age / hl), 12);
    }
  });

  it("decays monotonically toward zero as age grows", () => {
    const hl = 12;
    let prev = freshness(0, hl);
    for (let age = 1; age <= 200; age++) {
      const f = freshness(age, hl);
      expect(f).toBeLessThan(prev);
      expect(f).toBeGreaterThan(0);
      prev = f;
    }
  });

  it("stays within [0,1] for any non-negative age and half-life", () => {
    for (const age of [0, 1, 100, 1e6]) {
      for (const hl of [1, 50, 1e4]) {
        const f = freshness(age, hl);
        expect(f).toBeGreaterThanOrEqual(0);
        expect(f).toBeLessThanOrEqual(1);
      }
    }
  });

  it("underflows to exactly 0 (machine-grey) once age vastly exceeds half-life", () => {
    // 2^(-1e6) is far below the smallest positive double → flushes to 0, not NaN.
    expect(freshness(1e6, 1)).toBe(0);
  });

  describe("degenerate half-life <= 0 (mirrors C# ageSeconds <= 0 ? 1 : 0)", () => {
    it("is instantly stale (0) for positive age", () => {
      expect(freshness(1, 0)).toBe(0);
      expect(freshness(1, -5)).toBe(0);
      expect(freshness(1e-9, 0)).toBe(0);
    });

    it("is fresh (1) only when age is also <= 0", () => {
      expect(freshness(0, 0)).toBe(1);
      expect(freshness(0, -5)).toBe(1);
      expect(freshness(-1, 0)).toBe(1);
      expect(freshness(-100, -3)).toBe(1);
    });

    it("does NOT fall through to the transcendental branch (no NaN)", () => {
      // age/0 would be Infinity → guard must short-circuit first.
      expect(Number.isNaN(freshness(5, 0))).toBe(false);
      expect(freshness(5, 0)).toBe(0);
    });
  });
});

describe("delay layer consistency — same formula feeds crawl and readout", () => {
  it("freshness at one-way half-life lands at ~0.5 (packet arrives half-fresh)", () => {
    const distance = 1.5e11; // ~Earth–Sun in metres
    const ow = oneWaySeconds(distance);
    // A packet aged exactly its own one-way delay arrives at 0.5 freshness.
    expect(freshness(ow, ow)).toBe(0.5);
  });

  it("round-trip is the delay budget for an acknowledged signal", () => {
    const distance = 5.5e10;
    expect(roundTripSeconds(distance)).toBe(oneWaySeconds(distance) + oneWaySeconds(distance));
  });
});
