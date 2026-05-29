import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Demand } from "./demand";
import { Cache } from "./cache";
import * as Coherence from "./coherence";
import { resolve } from "./resolver";
import { M1Economy, CACHE_OPEX_PER_TICK, PREFETCH_COST } from "./economy";

/**
 * M1-08 — M1Economy: balance + burn fed by resolve payouts, opex, and prefetch.
 *
 * Mirrors SignalHorizon.Sim.Tests' M1Economy coverage AND the
 * Economy_GoodVsBadStrategy_SolvencyGap test, now driven through the REAL ported
 * economy (replacing the inline payout-sum that m1-models.test.ts used while the
 * economy was unported). Pure sim layer — only the geometry (miss wait,
 * feasibility) needs the real ephemeris.
 */

const Eph = loadEphemeris();

function makeDemand(): Demand {
  const d = new Demand("mars_imagery", "earth_imagery", 1000.0, 3600.0);
  d.minAcceptableFreshness = 0.5;
  d.freshFreshness = 0.9;
  d.stalePriceFactor = 0.4;
  return d;
}

// --- balance + apply: the single mutation point ----------------------------
describe("M1Economy — balance + apply", () => {
  it("starts from a configurable opening balance and applies signed deltas", () => {
    const e = new M1Economy(1000.0);
    expect(e.balance).toBeCloseTo(1000.0, 9);
    e.apply(250.0);
    expect(e.balance).toBeCloseTo(1250.0, 9);
    e.apply(-300.0);
    expect(e.balance).toBeCloseTo(950.0, 9);
  });

  it("defaults to a zero opening balance", () => {
    expect(new M1Economy().balance).toBeCloseTo(0.0, 9);
  });
});

// --- applyPayout: credits a resolve result (incl. the -500 blackout) -------
describe("M1Economy — applyPayout consumes ResolveResult.payout", () => {
  it("credits a fresh hit's full payout", () => {
    const d = makeDemand();
    const cache = new Cache("mars");
    const t = 1000.0;
    cache.store("earth_imagery", t - 60.0, 3600.0); // fresh
    const r = resolve(Eph, t, d, cache, true);

    const e = new M1Economy(0.0);
    e.applyPayout(r);
    expect(e.balance).toBeCloseTo(r.payout, 9);
    expect(e.balance).toBeCloseTo(1000.0, 9);
  });

  it("applies the NEGATIVE blackout penalty (-500) on a blackout miss", () => {
    const d = makeDemand();
    const cache = new Cache("mars"); // empty
    const r = resolve(Eph, 5000.0, d, cache, false); // link DOWN

    const e = new M1Economy(1000.0);
    e.applyPayout(r);
    expect(r.payout).toBeCloseTo(-500.0, 9);
    expect(e.balance).toBeCloseTo(500.0, 9);
  });
});

// --- chargeOpex: per-tick burn scaled by coherence.costMultiplier ----------
describe("M1Economy — chargeOpex burns scaled by coherence cost", () => {
  it("burns the flat baseline at EVENTUAL (cost multiplier 1.0)", () => {
    const e = new M1Economy(100.0);
    e.chargeOpex(1, Coherence.Level.Eventual);
    expect(e.balance).toBeCloseTo(100.0 - CACHE_OPEX_PER_TICK * 1 * 1.0, 9);
    expect(e.balance).toBeCloseTo(99.0, 9);
  });

  it("burns more at richer coherence levels (BEST_EFFORT 3x, STRONG 6x)", () => {
    const ev = new M1Economy(100.0);
    ev.chargeOpex(1, Coherence.Level.Eventual);
    const be = new M1Economy(100.0);
    be.chargeOpex(1, Coherence.Level.BestEffort);
    const st = new M1Economy(100.0);
    st.chargeOpex(1, Coherence.Level.Strong);

    // Higher coherence ⇒ deeper burn ⇒ lower balance.
    expect(be.balance).toBeLessThan(ev.balance);
    expect(st.balance).toBeLessThan(be.balance);
    expect(be.balance).toBeCloseTo(100.0 - 3.0, 9);
    expect(st.balance).toBeCloseTo(100.0 - 6.0, 9);
  });

  it("scales with cacheCount", () => {
    const e = new M1Economy(100.0);
    e.chargeOpex(4, Coherence.Level.Eventual);
    expect(e.balance).toBeCloseTo(100.0 - 4.0, 9);
  });
});

// --- chargePrefetch: one-shot pre-positioning cost -------------------------
describe("M1Economy — chargePrefetch one-shot cost", () => {
  it("charges the flat prefetch cost once", () => {
    const e = new M1Economy(1000.0);
    e.chargePrefetch();
    expect(e.balance).toBeCloseTo(1000.0 - PREFETCH_COST, 9);
    expect(e.balance).toBeCloseTo(950.0, 9);
  });
});

// --- runway + bankrupt -----------------------------------------------------
describe("M1Economy — runway + bankrupt", () => {
  it("runway is balance / burn when burning, +Inf when not", () => {
    const e = new M1Economy(1000.0);
    expect(e.runway(10.0)).toBeCloseTo(100.0, 9);
    expect(e.runway(0.0)).toBe(Number.POSITIVE_INFINITY);
    expect(e.runway(-5.0)).toBe(Number.POSITIVE_INFINITY); // earning ⇒ never broke
  });

  it("bankrupt() flips true exactly when the balance goes negative", () => {
    const e = new M1Economy(10.0);
    expect(e.bankrupt()).toBe(false);
    e.apply(-10.0);
    expect(e.balance).toBeCloseTo(0.0, 9);
    expect(e.bankrupt()).toBe(false); // zero is NOT bankrupt (< 0 is the cliff)
    e.apply(-0.01);
    expect(e.bankrupt()).toBe(true);
  });
});

// --- M1-08: good (prefetch) stays solvent, bad (blackout) goes broke -------
// Mirrors M1ModelTests.Economy_GoodVsBadStrategy_SolvencyGap, now driven
// through the REAL economy (charge opex, apply payouts, charge prefetch).
describe("M1-08 — good vs bad strategy solvency gap (REAL economy)", () => {
  it("Economy_GoodVsBadStrategy_SolvencyGap", () => {
    const d = makeDemand();
    const startBalance = 1000.0;
    const ticks = 20;
    const eventual = Coherence.Level.Eventual;

    // BAD strategy: never cache; every request during a blackout is a penalty.
    const bad = new M1Economy(startBalance);
    const badCache = new Cache("mars"); // stays empty
    for (let i = 0; i < ticks; i++) {
      const t = 100.0 + i * 200.0;
      bad.chargeOpex(1, eventual);
      const r = resolve(Eph, t, d, badCache, false); // link DOWN (blackout)
      bad.applyPayout(r);
    }
    expect(bad.bankrupt()).toBe(true); // no cache, eats blackout penalties

    // GOOD strategy: prefetch fresh data into the cache BEFORE the blackout,
    // then serve local fresh hits through the same blackout window.
    const good = new M1Economy(startBalance);
    const goodCache = new Cache("mars");
    good.chargePrefetch(); // one-shot cost of pre-positioning
    goodCache.store("earth_imagery", 50.0, 100000.0); // fresh & long-lived for the window
    for (let i = 0; i < ticks; i++) {
      const t = 100.0 + i * 200.0;
      good.chargeOpex(1, eventual);
      const r = resolve(Eph, t, d, goodCache, false); // SAME blackout
      good.applyPayout(r);
    }
    expect(good.bankrupt()).toBe(false); // prefetch before blackout stays solvent
    expect(good.balance).toBeGreaterThan(bad.balance); // good ends richer than bad
    expect(good.runway(1.0)).toBeGreaterThan(0.0); // solvent ⇒ positive runway
  });
});
