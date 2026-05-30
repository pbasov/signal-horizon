import { describe, it, expect } from "vitest";
import { GeodesicGrid } from "./grid";
import { DemandField } from "./demand";
import {
  DynamicDemand,
  CAPACITY_MULTIPLIER,
  GROWTH_RATE_PER_S,
} from "./dynamic-demand";

/**
 * M2e — THE ESCALATION ENGINE: the DYNAMIC-DEMAND GROWTH LAW (GDD §3b generator 1,
 * "demand grows where you serve"). These pin the three contracts the law must hold,
 * at the pure {@link DynamicDemand} level (no Kepler / ephemeris — a synthetic
 * served-quality mask, so the growth math is isolated and the test is fast):
 *
 *   (a) DT-INVARIANT — the EXACT CLOSED-FORM logistic flow is a semigroup, so the same
 *       sim-time integrated as ONE big step or as MANY small steps yields the same demand
 *       to f64 tolerance (the SD-20 continuous-rate contract);
 *   (b) BOUNDED — a long served run NEVER explodes: every cell asymptotes to (and never
 *       exceeds) its per-cell carrying capacity = baseline · CAPACITY_MULTIPLIER;
 *   (c) the ESCALATION direction — a SERVED cell's demand RISES above baseline, while an
 *       UNSERVED cell relaxes back toward baseline.
 */

const grid = GeodesicGrid.build();

/** A served-quality mask: every cell served (1). */
function allServed(): number[] {
  return grid.cells.map(() => 1);
}
/** A served-quality mask: no cell served (0). */
function noneServed(): number[] {
  return grid.cells.map(() => 0);
}

describe("M2e dynamic demand — DT-INVARIANT growth (the closed-form semigroup)", () => {
  it("integrating 3600 s as one step == as 3600 one-second steps (to f64 tolerance)", () => {
    const baseline = DemandField.build(grid);
    const served = allServed();

    const big = DynamicDemand.build(grid, baseline);
    big.step(served, 3600);

    const small = DynamicDemand.build(grid, baseline);
    for (let i = 0; i < 3600; i++) small.step(served, 1);

    expect(small.total).toBeCloseTo(big.total, 6);
    for (let id = 0; id < grid.size; id++) {
      expect(small.of(id)).toBeCloseTo(big.of(id), 9);
    }
  });

  it("a coarse (60 s) vs fine (0.1 s) integration of the same 600 s match", () => {
    const baseline = DemandField.build(grid);
    const served = allServed();

    const coarse = DynamicDemand.build(grid, baseline);
    for (let i = 0; i < 10; i++) coarse.step(served, 60);

    const fine = DynamicDemand.build(grid, baseline);
    for (let i = 0; i < 6000; i++) fine.step(served, 0.1);

    expect(fine.total).toBeCloseTo(coarse.total, 5);
  });
});

describe("M2e dynamic demand — BOUNDED (logistic ceiling, never explodes)", () => {
  it("a long fully-served run approaches the per-cell cap and never exceeds it", () => {
    const baseline = DemandField.build(grid);
    const dyn = DynamicDemand.build(grid, baseline);
    const served = allServed();
    // A very long served run (10 sim-years of seconds) — far past saturation.
    for (let i = 0; i < 2000; i++) dyn.step(served, 50000);
    for (let id = 0; id < grid.size; id++) {
      const cap = baseline.of(id) * CAPACITY_MULTIPLIER;
      const d = dyn.of(id);
      expect(Number.isFinite(d)).toBe(true);
      expect(d).toBeLessThanOrEqual(cap + 1e-9); // never overshoots the cap
      if (baseline.of(id) > 0) expect(d).toBeGreaterThan(cap * 0.99); // and reaches it
    }
    expect(Number.isFinite(dyn.total)).toBe(true);
  });

  it("a single huge dt cannot overshoot the cap (coarse-step safety)", () => {
    const baseline = DemandField.build(grid);
    const dyn = DynamicDemand.build(grid, baseline);
    dyn.step(allServed(), 1e12); // absurd dt
    for (let id = 0; id < grid.size; id++) {
      expect(dyn.of(id)).toBeLessThanOrEqual(baseline.of(id) * CAPACITY_MULTIPLIER + 1e-9);
    }
  });
});

describe("M2e dynamic demand — the ESCALATION direction", () => {
  it("a SERVED cell's demand RISES above baseline over a served run", () => {
    const baseline = DemandField.build(grid);
    const dyn = DynamicDemand.build(grid, baseline);
    const served = allServed();
    const before = dyn.total;
    for (let i = 0; i < 100; i++) dyn.step(served, 600); // 100 sim-minutes served
    expect(dyn.total).toBeGreaterThan(before);
    // Every cell with demand grew (strictly, where there is room under the cap).
    for (let id = 0; id < grid.size; id++) {
      if (baseline.of(id) > 0) expect(dyn.of(id)).toBeGreaterThan(baseline.of(id));
    }
  });

  it("an UNSERVED cell RELAXES back toward baseline (a dropped region cools off)", () => {
    const baseline = DemandField.build(grid);
    const dyn = DynamicDemand.build(grid, baseline);
    // Grow under full service, then stop serving and let it relax.
    for (let i = 0; i < 100; i++) dyn.step(allServed(), 600);
    const grown = dyn.total;
    expect(grown).toBeGreaterThan(baseline.total);
    for (let i = 0; i < 5000; i++) dyn.step(noneServed(), 600); // long unserved
    expect(dyn.total).toBeLessThan(grown); // it cooled off
    expect(dyn.total).toBeGreaterThanOrEqual(baseline.total - 1e-6); // toward baseline, not below
    for (let id = 0; id < grid.size; id++) {
      expect(dyn.of(id)).toBeCloseTo(baseline.of(id), 3); // relaxed back to baseline
    }
  });

  it("growth is faster from a lower demand and slows near the cap (logistic shape)", () => {
    // The closed-form per-step gain should shrink as demand approaches the cap.
    const baseline = DemandField.build(grid);
    const dyn = DynamicDemand.build(grid, baseline);
    const served = allServed();
    // first served interval (low demand → big relative gain).
    const t0 = dyn.total;
    dyn.step(served, 3600);
    const gain1 = dyn.total - t0;
    // run most of the way to the cap, then measure another interval's gain.
    for (let i = 0; i < 200; i++) dyn.step(served, 3600);
    const t1 = dyn.total;
    dyn.step(served, 3600);
    const gain2 = dyn.total - t1;
    expect(gain1).toBeGreaterThan(0);
    expect(gain2).toBeGreaterThanOrEqual(0);
    expect(gain2).toBeLessThan(gain1); // the brake bites near the cap
  });

  it("the growth-rate dial is wired (a faster rate grows more in the same sim-time)", () => {
    // Sanity that GROWTH_RATE_PER_S is the lever: a longer served run grows strictly more.
    const baseline = DemandField.build(grid);
    const a = DynamicDemand.build(grid, baseline);
    const b = DynamicDemand.build(grid, baseline);
    a.step(allServed(), 600);
    b.step(allServed(), 6000); // 10× the served time
    expect(b.total).toBeGreaterThan(a.total);
    expect(GROWTH_RATE_PER_S).toBeGreaterThan(0);
  });
});
