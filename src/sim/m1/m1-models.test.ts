import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { roundTripSeconds, oneWaySeconds } from "../delay";
import { Demand } from "./demand";
import { Cache } from "./cache";
import * as Coherence from "./coherence";
import { resolve, feasible, type ResolveResult } from "./resolver";

/**
 * Mirrors SignalHorizon.Sim.Tests/M1ModelTests.cs (which itself ports
 * test/test_m1_model.gd). Proves the FUN-GATE model contracts: 3-band pricing,
 * hit/stale/miss/blackout resolution, prefetch-turns-miss-into-hit (M1-06),
 * coherence cost/freshness difference, the good-vs-bad strategy solvency gap,
 * and resolve determinism.
 *
 * Pure sim layer — runs headless (no three/DOM); only the geometry (miss wait,
 * feasibility) needs the real ephemeris from data/system.json.
 *
 * The C# solvency test drives an M1Economy (ticket E3, NOT yet ported); here we
 * sum ResolveResult.payout inline to prove the same gap without it.
 */

// The resolver is a pure function of explicit inputs; only geometry needs the
// real ephemeris. Mirrors M1ModelTests.Eph.
const Eph = loadEphemeris();

// Build a demand with the bands pinned explicitly (independent of default
// tweaks), exactly like the C# MakeDemand() / GDScript _make_demand().
function makeDemand(): Demand {
  const d = new Demand("mars_imagery", "earth_imagery", 1000.0, 3600.0);
  d.minAcceptableFreshness = 0.5;
  d.freshFreshness = 0.9;
  d.stalePriceFactor = 0.4;
  return d;
}

// --- M1-01: piecewise price curve, step + ramp stale-band modes ------------
describe("M1-01 — price bands", () => {
  // "step" mode (old/faithful): flat basePrice*stalePriceFactor across stale.
  it("PriceBands_StepMode_FlatStaleBand", () => {
    const d = makeDemand();
    d.priceCurve = "step";
    expect(d.price(1.0)).toBeCloseTo(1000.0, 9); // fresh: full base_price
    expect(d.price(0.95)).toBeCloseTo(1000.0, 9); // >=0.9 still fresh band
    expect(d.price(0.7)).toBeCloseTo(400.0, 9); // mid -> flat base*0.4 (stale)
    expect(d.price(0.5)).toBeCloseTo(400.0, 9); // at min floor -> stale (inclusive)
    expect(d.price(0.3)).toBeCloseTo(0.0, 9); // below min -> 0 (unusable)
  });

  // "ramp" mode (new DEFAULT, GDD v0.7 §4.4): price scales with staleness.
  // Cliff + fresh cap unchanged; the [min, fresh) band LERPs 400 -> 1000.
  it("PriceBands_RampMode_SlopedStaleBand", () => {
    const d = makeDemand();
    expect(d.priceCurve).toBe("ramp"); // ramp is the default

    // Cliff + fresh cap identical to step mode.
    expect(d.price(1.0)).toBeCloseTo(1000.0, 9); // fresh cap: full base_price
    expect(d.price(0.95)).toBeCloseTo(1000.0, 9); // >=0.9 still fresh cap
    expect(d.price(0.3)).toBeCloseTo(0.0, 9); // below min -> hard cliff to 0

    // Slope across the stale band.
    expect(d.price(0.5)).toBeCloseTo(400.0, 9); // ramp(min) = base*factor = 400
    // Verified by computation: 400 + 600*(0.7-0.5)/(0.9-0.5) = 700.
    expect(d.price(0.7)).toBeCloseTo(700.0, 9);
    // Just below the fresh threshold approaches (but stays under) the cap.
    expect(d.price(0.89)).toBeCloseTo(400.0 + 600.0 * (0.89 - 0.5) / (0.9 - 0.5), 9);
    expect(d.price(0.89)).toBeLessThan(1000.0);
    expect(d.price(0.89)).toBeGreaterThan(975.0); // = 985, just under the cap

    // Continuity: ramp(min) meets the step value; ramp approaching fresh meets
    // the cap. The slope is (1000-400)/0.4 = 1500/unit, so at f = 0.9 - 1e-9 the
    // value is 1000 - 1500e-9 ~= 999.9999985 (continuous into the fresh cap).
    expect(d.price(0.5)).toBeCloseTo(400.0, 9);
    expect(d.price(0.9 - 1e-9)).toBeCloseTo(1000.0, 4);

    // Strictly increasing across the band.
    expect(d.price(0.6)).toBeGreaterThan(d.price(0.5));
    expect(d.price(0.7)).toBeGreaterThan(d.price(0.6));
    expect(d.price(0.8)).toBeGreaterThan(d.price(0.7));
    expect(d.price(0.89)).toBeGreaterThan(d.price(0.8));
  });

  it("Band_LabelsMatchThreeBands", () => {
    // band() labels are UNCHANGED by priceCurve — only the stale price moved.
    const d = makeDemand();
    expect(d.band(0.95)).toBe("fresh");
    expect(d.band(0.7)).toBe("stale");
    expect(d.band(0.2)).toBe("unusable");
  });
});

// --- M1-05: cache HIT, fresh serve -> full payout -------------------------
describe("M1-05 — cache fresh hit", () => {
  it("Resolve_FreshHit_FullPayoutViaCacheZeroWait", () => {
    const d = makeDemand();
    const cache = new Cache("mars");
    const t = 1000.0;
    // Captured 60s ago on a 3600s half-life -> freshness ~0.988 (>= 0.9 fresh).
    cache.store("earth_imagery", t - 60.0, 3600.0);

    const r = resolve(Eph, t, d, cache, true);

    expect(r.outcome).toBe("fresh");
    expect(r.payout).toBeCloseTo(1000.0, 9); // fresh hit pays full base_price
    expect(r.viaCache).toBe(true); // served via cache (no gap crossing)
    expect(r.waitSeconds).toBeCloseTo(0.0, 9); // fresh hit has zero wait
  });
});

// --- M1-03: cache HIT but STALE -> reduced payout -------------------------
describe("M1-03 — cache stale hit", () => {
  it("Resolve_StaleHit_ReducedPayoutStillViaCache", () => {
    const d = makeDemand();
    const cache = new Cache("mars");
    const t = 10000.0;
    // Age = one half-life (3600s) -> freshness 0.5: in [min,fresh) -> STALE.
    cache.store("earth_imagery", t - 3600.0, 3600.0);

    const r = resolve(Eph, t, d, cache, true);

    expect(r.outcome).toBe("stale");
    // f == 0.5 sits exactly at minAcceptableFreshness, where ramp(min) == the
    // flat step value (400). So the pinned 400 holds under the DEFAULT ramp
    // curve too — no priceCurve override needed to keep this test's intent.
    expect(r.payout).toBeCloseTo(400.0, 9); // stale hit pays reduced (base*0.4)
    expect(r.viaCache).toBe(true); // stale serve is still local (via cache)
    expect(r.payout).toBeLessThan(1000.0);
    expect(r.payout).toBeGreaterThan(0.0); // strictly between full and zero
  });
});

// --- M1-05: MISS schedules a fetch, wait ~ round-trip light time ----------
describe("M1-05 — miss schedules a fetch", () => {
  it("Resolve_Miss_SchedulesFetchAtRoundTripLightTime", () => {
    const d = makeDemand();
    const cache = new Cache("mars"); // empty slot
    const t = 5000.0;

    const r = resolve(Eph, t, d, cache, true);

    expect(r.outcome).toBe("miss");
    expect(r.payout).toBeCloseTo(0.0, 9); // miss event itself pays 0
    expect(r.viaCache).toBe(false); // not served from cache
    const expected = roundTripSeconds(Eph.distanceBetween("earth", "mars", t));
    expect(r.waitSeconds).toBeCloseTo(expected, 9); // wait == round-trip light time
    expect(r.waitSeconds).toBeGreaterThan(60.0); // minutes-scale (the crawling packet)
  });

  it("Resolve_DecayedBelowMin_RefetchesAsMiss", () => {
    const d = makeDemand();
    const t = 5000.0;
    // Holds the dataset but has decayed BELOW min (~0.0625) -> behaves as miss.
    const staleCache = new Cache("mars");
    staleCache.store("earth_imagery", t - 3600.0 * 4.0, 3600.0);

    const r = resolve(Eph, t, d, staleCache, true);

    expect(r.outcome).toBe("miss");
  });
});

// --- M1-03: blackout MISS -> penalty when link down & no fresh cache ------
describe("M1-03 — blackout miss", () => {
  it("Resolve_BlackoutMiss_PenaltyWhenLinkDownAndNoCache", () => {
    const d = makeDemand();
    const cache = new Cache("mars"); // empty
    const t = 5000.0;

    const r = resolve(Eph, t, d, cache, false); // link DOWN

    expect(r.outcome).toBe("blackout_miss");
    expect(r.payout).toBeLessThan(0.0); // blackout_miss applies a penalty
    expect(r.waitSeconds).toBeCloseTo(0.0, 9); // blackout has no fetch wait
  });

  it("Resolve_FreshCacheServesThroughBlackout_NoPenalty", () => {
    const d = makeDemand();
    const t = 5000.0;
    // A FRESH cache rescues a blackout: served locally, no penalty.
    const freshCache = new Cache("mars");
    freshCache.store("earth_imagery", t - 60.0, 3600.0);

    const r = resolve(Eph, t, d, freshCache, false); // link DOWN

    expect(r.outcome).toBe("fresh");
    expect(r.payout).toBeGreaterThan(0.0); // blackout-with-fresh-cache still earns
  });
});

// --- M1-06: a well-timed prefetch turns a would-be miss into a hit --------
describe("M1-06 — prefetch timing pivot", () => {
  it("Prefetch_WellTimed_TurnsMissIntoPayingHit", () => {
    const d = makeDemand();
    const tRequest = 9000.0;

    // WITHOUT prefetch: empty cache at request time -> miss.
    const empty = new Cache("mars");
    const before = resolve(Eph, tRequest, d, empty, true);
    expect(before.outcome).toBe("miss");

    // Player issues a prefetch early enough that it ARRIVES (after one-way light
    // time) still fresh when the request fires. The sample is captured at the
    // SOURCE at t_issue; it arrives one-way later.
    const oneWay = oneWaySeconds(Eph.distanceBetween("earth", "mars", tRequest));
    const tIssue = tRequest - oneWay - 30.0; // issued early; arrives ~30s before request
    const primed = new Cache("mars");
    primed.store("earth_imagery", tIssue, 3600.0);

    // Sanity: the sample must have ARRIVED by request time (arrival = issue + one_way).
    expect(tIssue + oneWay).toBeLessThanOrEqual(tRequest);

    const after = resolve(Eph, tRequest, d, primed, true);
    expect(after.outcome === "fresh" || after.outcome === "stale").toBe(true);
    expect(after.viaCache).toBe(true); // prefetched serve is local (the wait is filled)
    expect(after.payout).toBeGreaterThan(before.payout); // strictly improves over the miss
  });

  it("Prefetch_NotYetArrived_StillMiss", () => {
    const d = makeDemand();
    const tRequest = 9000.0;
    // Captured in the future (capturedAtT > t) = not arrived -> still a miss.
    const late = new Cache("mars");
    late.store("earth_imagery", tRequest + 100.0, 3600.0);

    const r = resolve(Eph, tRequest, d, late, true);

    expect(r.outcome).toBe("miss");
  });
});

// --- M1-02: feasible() is one LoS check returning a bool ------------------
describe("M1-02 — feasibility is one LoS check", () => {
  it("Feasible_ReturnsBool", () => {
    const ok = feasible(Eph, 1234.0, "earth", "mars", ["sun"]);
    expect(typeof ok).toBe("boolean"); // single LoS check, not a router
  });
});

// --- M1-07: coherence levels yield measurably different cost/freshness ----
describe("M1-07 — coherence levels differ", () => {
  it("Coherence_LevelsDiffer", () => {
    // GDD v0.7 §4.4: cheap -> mid -> premium ladder. STRICTLY MONOTONIC across
    // rising level: cost UP, freshnessFloor UP, refreshCadenceS DOWN.
    const ev = Coherence.Level.Eventual;
    const be = Coherence.Level.BestEffort;
    const st = Coherence.Level.Strong;

    // cost strictly increasing: Eventual < BestEffort < Strong.
    expect(Coherence.costMultiplier(be)).toBeGreaterThan(Coherence.costMultiplier(ev));
    expect(Coherence.costMultiplier(st)).toBeGreaterThan(Coherence.costMultiplier(be));

    // freshnessFloor strictly increasing.
    expect(Coherence.freshnessFloor(be)).toBeGreaterThan(Coherence.freshnessFloor(ev));
    expect(Coherence.freshnessFloor(st)).toBeGreaterThan(Coherence.freshnessFloor(be));

    // refreshCadenceS strictly decreasing (more aggressive sync as level rises).
    expect(Coherence.refreshCadenceS(be)).toBeLessThan(Coherence.refreshCadenceS(ev));
    expect(Coherence.refreshCadenceS(st)).toBeLessThan(Coherence.refreshCadenceS(be));

    // Pin the exact ladder values.
    expect(Coherence.costMultiplier(ev)).toBeCloseTo(1.0, 9);
    expect(Coherence.costMultiplier(be)).toBeCloseTo(3.0, 9);
    expect(Coherence.costMultiplier(st)).toBeCloseTo(6.0, 9);
    expect(Coherence.freshnessFloor(ev)).toBeCloseTo(0.5, 9);
    expect(Coherence.freshnessFloor(be)).toBeCloseTo(0.9, 9);
    expect(Coherence.freshnessFloor(st)).toBeCloseTo(0.98, 9);
    expect(Coherence.refreshCadenceS(ev)).toBeCloseTo(7200.0, 9);
    expect(Coherence.refreshCadenceS(be)).toBeCloseTo(1800.0, 9);
    expect(Coherence.refreshCadenceS(st)).toBeCloseTo(600.0, 9);

    // Names cover all three; unknown level falls back to EVENTUAL.
    expect(Coherence.nameOf(ev)).toBe("EVENTUAL");
    expect(Coherence.nameOf(be)).toBe("BEST_EFFORT");
    expect(Coherence.nameOf(st)).toBe("STRONG");
    expect(Coherence.nameOf(99)).toBe("EVENTUAL");
    expect(Coherence.costMultiplier(99)).toBeCloseTo(1.0, 9); // unknown -> Eventual
  });
});

// --- M1-08: good (prefetch) stays solvent, bad (blackout) goes broke ------
describe("M1-08 — good vs bad strategy solvency gap", () => {
  it("Economy_GoodVsBadStrategy_SolvencyGap", () => {
    const d = makeDemand();
    const startBalance = 1000.0;
    const ticks = 20;

    // Sum ResolveResult.payout inline (M1Economy is ticket E3, not ported here).
    // BAD strategy: never cache; every request during a blackout is a penalty.
    let badBalance = startBalance;
    const badCache = new Cache("mars"); // stays empty
    for (let i = 0; i < ticks; i++) {
      const t = 100.0 + i * 200.0;
      const r = resolve(Eph, t, d, badCache, false); // link DOWN (blackout)
      badBalance += r.payout;
    }
    // 20 blackout misses at -500 each, starting from 1000 -> deeply negative.
    expect(badBalance).toBeLessThan(0.0);

    // GOOD strategy: prefetch fresh data into the cache BEFORE the blackout,
    // then serve local fresh hits through the same blackout window.
    let goodBalance = startBalance;
    const goodCache = new Cache("mars");
    goodCache.store("earth_imagery", 50.0, 100000.0); // fresh & long-lived for the window
    for (let i = 0; i < ticks; i++) {
      const t = 100.0 + i * 200.0;
      const r = resolve(Eph, t, d, goodCache, false); // SAME blackout
      goodBalance += r.payout;
    }
    // Every serve is a paying fresh hit through the blackout -> stays solvent.
    expect(goodBalance).toBeGreaterThan(0.0);
    expect(goodBalance).toBeGreaterThan(badBalance); // good ends richer than bad
  });
});

// --- Determinism: resolve is a pure function of its inputs ----------------
describe("determinism — resolve is pure", () => {
  it("Resolve_IsPureFunction_SameInputsIdenticalResult", () => {
    const d = makeDemand();
    const t = 4242.0;
    const c1 = new Cache("mars");
    c1.store("earth_imagery", t - 600.0, 3600.0);
    const c2 = new Cache("mars");
    c2.store("earth_imagery", t - 600.0, 3600.0);

    const a = resolve(Eph, t, d, c1, true);
    const b = resolve(Eph, t, d, c2, true);

    expect(a.outcome).toBe(b.outcome);
    expect(a.payout).toBeCloseTo(b.payout, 9);
    expect(a.servedFreshness).toBeCloseTo(b.servedFreshness, 9);
    expect(a.waitSeconds).toBeCloseTo(b.waitSeconds, 9);
    // value equality is the strongest determinism statement (ResolveResult is a
    // plain object -> structural deep-equal).
    const _typecheck: ResolveResult = a;
    expect(_typecheck).toEqual(b);
  });
});
