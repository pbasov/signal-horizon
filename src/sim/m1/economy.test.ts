import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Demand } from "./demand";
import { Cache } from "./cache";
import * as Coherence from "./coherence";
import { resolve } from "./resolver";
import {
  M1Economy,
  OPEX_RATE_PER_SECOND,
  FRESH_REVENUE_RATE_PER_SECOND,
  STALE_REVENUE_RATE_PER_SECOND,
  MISS_REVENUE_RATE_PER_SECOND,
  BLACKOUT_PENALTY_RATE_PER_SECOND,
  OPENING_BALANCE,
  PREFETCH_COST,
  revenueRatePerSecond,
  opexRatePerSecond,
} from "./economy";

/**
 * M1-08 (reworked) — M1Economy on CONTINUOUS PER-SIM-TIME RATES.
 *
 * The economy no longer pays per TICK; it accrues (revenueRate(band) −
 * opexRate(coherence)) × elapsed sim-seconds. These tests pin: the rate ladder
 * (fresh > stale > miss > blackout), DT-INVARIANCE of the accrual, runway in
 * sim-seconds off the live net burn, and the GOOD-vs-BAD solvency gap driven
 * entirely through the rates (a fresh/stale-serving run profits or breaks even; a
 * blackout-eating run bankrupts). Pure sim layer — only the geometry (the
 * blackout) needs the real ephemeris.
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

  it("defaults to the OPENING_BALANCE", () => {
    expect(new M1Economy().balance).toBeCloseTo(OPENING_BALANCE, 9);
  });
});

// --- the rate ladder: fresh > stale > miss > blackout ----------------------
describe("M1Economy — the per-sim-second rate ladder", () => {
  it("revenue rate is highest fresh, lower stale, zero miss, NEGATIVE blackout", () => {
    expect(revenueRatePerSecond("fresh")).toBe(FRESH_REVENUE_RATE_PER_SECOND);
    expect(revenueRatePerSecond("stale")).toBe(STALE_REVENUE_RATE_PER_SECOND);
    expect(revenueRatePerSecond("miss")).toBe(MISS_REVENUE_RATE_PER_SECOND);
    expect(revenueRatePerSecond("blackout_miss")).toBe(-BLACKOUT_PENALTY_RATE_PER_SECOND);

    // Strictly ordered: fresh > stale > miss(0) > blackout(<0).
    expect(revenueRatePerSecond("fresh")).toBeGreaterThan(revenueRatePerSecond("stale"));
    expect(revenueRatePerSecond("stale")).toBeGreaterThan(revenueRatePerSecond("miss"));
    expect(revenueRatePerSecond("miss")).toBe(0);
    expect(revenueRatePerSecond("blackout_miss")).toBeLessThan(0);
  });

  it("opex rate scales with coherence (EVENTUAL 1×, BEST_EFFORT 3×, STRONG 6×)", () => {
    expect(opexRatePerSecond(Coherence.Level.Eventual)).toBeCloseTo(OPEX_RATE_PER_SECOND, 9);
    expect(opexRatePerSecond(Coherence.Level.BestEffort)).toBeCloseTo(OPEX_RATE_PER_SECOND * 3, 9);
    expect(opexRatePerSecond(Coherence.Level.Strong)).toBeCloseTo(OPEX_RATE_PER_SECOND * 6, 9);
  });

  it("net rate: fresh is POSITIVE, stale ≈ break-even/small +, miss & blackout NEGATIVE", () => {
    const e = new M1Economy();
    const ev = Coherence.Level.Eventual;
    expect(e.netRatePerSecond("fresh", ev)).toBeGreaterThan(0); // slow profit
    expect(e.netRatePerSecond("stale", ev)).toBeGreaterThanOrEqual(0); // break-even+
    expect(e.netRatePerSecond("miss", ev)).toBeLessThan(0); // pay opex, no income
    expect(e.netRatePerSecond("blackout_miss", ev)).toBeLessThan(
      e.netRatePerSecond("miss", ev),
    ); // blackout burns even deeper (penalty on top)
  });
});

// --- accrue: continuous accrual over elapsed sim-time ----------------------
describe("M1Economy — accrue scales by elapsed sim-time", () => {
  it("accrues (revenue − opex) × dtSeconds for a fresh serve", () => {
    const e = new M1Economy(1000.0);
    const dt = 10.0;
    e.accrue("fresh", true, dt, Coherence.Level.Eventual);
    const expected = (FRESH_REVENUE_RATE_PER_SECOND - OPEX_RATE_PER_SECOND) * dt;
    expect(e.balance).toBeCloseTo(1000.0 + expected, 9);
  });

  it("a miss burns opex with no income (balance falls by opex × dt)", () => {
    const e = new M1Economy(1000.0);
    e.accrue("miss", false, 10.0, Coherence.Level.Eventual);
    expect(e.balance).toBeCloseTo(1000.0 - OPEX_RATE_PER_SECOND * 10.0, 9);
  });

  it("a blackout burns opex PLUS the SLA penalty rate", () => {
    const e = new M1Economy(1000.0);
    e.accrue("blackout_miss", false, 10.0, Coherence.Level.Eventual);
    const burn = (OPEX_RATE_PER_SECOND + BLACKOUT_PENALTY_RATE_PER_SECOND) * 10.0;
    expect(e.balance).toBeCloseTo(1000.0 - burn, 9);
  });

  it("DT-INVARIANT: one big accrual == many small accruals to the same sim-time", () => {
    const total = 60.0; // sim-seconds
    const coarse = new M1Economy(1000.0);
    coarse.accrue("fresh", true, total, Coherence.Level.BestEffort);

    const fine = new M1Economy(1000.0);
    const dt = 1 / 60; // a fixed tick
    const steps = Math.round(total / dt);
    for (let i = 0; i < steps; i++) fine.accrue("fresh", true, dt, Coherence.Level.BestEffort);

    // Same elapsed sim-time ⇒ same balance, regardless of step granularity.
    expect(fine.balance).toBeCloseTo(coarse.balance, 6);
  });

  it("higher coherence burns more opex for the SAME serve + sim-time", () => {
    const ev = new M1Economy(1000.0);
    ev.accrue("stale", true, 10.0, Coherence.Level.Eventual);
    const st = new M1Economy(1000.0);
    st.accrue("stale", true, 10.0, Coherence.Level.Strong);
    expect(st.balance).toBeLessThan(ev.balance); // STRONG costs 6× the opex
  });
});

// --- chargePrefetch: one-shot pre-positioning cost -------------------------
describe("M1Economy — chargePrefetch one-shot cost", () => {
  it("charges the flat prefetch cost once", () => {
    const e = new M1Economy(1000.0);
    e.chargePrefetch();
    expect(e.balance).toBeCloseTo(1000.0 - PREFETCH_COST, 9);
  });
});

// --- runway + bankrupt (runway now in SIM-SECONDS off the net burn) --------
describe("M1Economy — runway + bankrupt", () => {
  it("runway is balance / burn-rate (sim-seconds) when burning, +Inf when not", () => {
    const e = new M1Economy(1000.0);
    expect(e.runway(10.0)).toBeCloseTo(100.0, 9); // 1000 / 10 €/s = 100 sim-s
    expect(e.runway(0.0)).toBe(Number.POSITIVE_INFINITY); // break-even
    expect(e.runway(-5.0)).toBe(Number.POSITIVE_INFINITY); // earning ⇒ never broke
  });

  it("a miss-burn runway is balance / opex-rate; a fresh serve gives +Inf runway", () => {
    const e = new M1Economy(3000.0);
    const ev = Coherence.Level.Eventual;
    // Miss burns opex with no income → finite runway.
    const missBurn = -e.netRatePerSecond("miss", ev); // = opex rate
    expect(e.runway(missBurn)).toBeCloseTo(3000.0 / OPEX_RATE_PER_SECOND, 6);
    // Fresh serve is net-positive → not burning → +Inf.
    const freshBurn = -e.netRatePerSecond("fresh", ev);
    expect(e.runway(freshBurn)).toBe(Number.POSITIVE_INFINITY);
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

// --- the solvency gap, driven entirely through the RATES -------------------
// A fresh/stale-serving network profits or breaks even; a blackout-eating
// network burns opex + the SLA penalty with no income and goes bankrupt. The
// separation is the prefetch-before-the-blackout decision.
describe("M1-08 — good vs bad strategy solvency gap (rate model)", () => {
  it("Economy_GoodVsBadStrategy_SolvencyGap", () => {
    const d = makeDemand();
    const ev = Coherence.Level.Eventual;
    const dt = 1.0; // sim-second steps
    const windowSeconds = 1800; // a 30-sim-minute stretch through a blackout

    // BAD strategy: never cache. With the link DOWN every request is a blackout
    // miss → 0 income + the SLA penalty, on top of opex. It bleeds to bankruptcy.
    const bad = new M1Economy(OPENING_BALANCE);
    const badCache = new Cache("mars"); // stays empty
    for (let s = 0; s < windowSeconds; s++) {
      const t = 5000.0 + s; // a sim-time inside a real conjunction window
      const r = resolve(Eph, t, d, badCache, false); // link DOWN (blackout)
      bad.accrue(r.outcome, r.viaCache, dt, ev);
    }
    expect(bad.bankrupt()).toBe(true); // no cache, eats blackout penalties

    // GOOD strategy: prefetch fresh data into the cache BEFORE the blackout, then
    // serve local hits through the SAME window. Pays the one-shot prefetch cost.
    const good = new M1Economy(OPENING_BALANCE);
    const goodCache = new Cache("mars");
    good.chargePrefetch(); // one-shot cost of pre-positioning
    goodCache.store("earth_imagery", 4990.0, 100000.0); // fresh & long-lived for the window
    for (let s = 0; s < windowSeconds; s++) {
      const t = 5000.0 + s;
      const r = resolve(Eph, t, d, goodCache, false); // SAME blackout
      good.accrue(r.outcome, r.viaCache, dt, ev);
    }
    expect(good.bankrupt()).toBe(false); // prefetch before blackout stays solvent
    expect(good.balance).toBeGreaterThan(bad.balance); // good ends richer than bad
    // Solvent ⇒ a fresh serve is net-positive ⇒ +Inf runway.
    expect(good.runway(-good.netRatePerSecond("fresh", ev))).toBe(Number.POSITIVE_INFINITY);
  });

  it("a well-run fresh-serving run SURVIVES a 30-min run; a starved (miss) run BANKRUPTS", () => {
    const ev = Coherence.Level.Eventual;
    const dt = 1.0;
    const thirtyMin = 30 * 60; // 1800 sim-seconds

    // WELL-RUN: serving fresh the whole time → net-positive → ends RICHER.
    const wellRun = new M1Economy(OPENING_BALANCE);
    for (let s = 0; s < thirtyMin; s++) wellRun.accrue("fresh", true, dt, ev);
    expect(wellRun.bankrupt()).toBe(false);
    expect(wellRun.balance).toBeGreaterThan(OPENING_BALANCE);

    // STARVED: never serves (perpetual miss) → pays opex with no income. With the
    // opening runway only minutes long, 30 sim-minutes of pure burn bankrupts it.
    const starved = new M1Economy(OPENING_BALANCE);
    for (let s = 0; s < thirtyMin; s++) starved.accrue("miss", false, dt, ev);
    expect(starved.bankrupt()).toBe(true);
  });
});
