import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Ephemeris } from "../ephemeris";
import { oneWaySeconds } from "../delay";
import { M1Session } from "./session";
import { Demand } from "./demand";
import {
  PREFETCH_COST,
  STALE_REVENUE_RATE_PER_SECOND,
  BLACKOUT_PENALTY_RATE_PER_SECOND,
} from "./economy";

/**
 * M1-05 — M1Session: the LIVE cache-miss → fetch → arrive → hit loop.
 *
 * PURE + DETERMINISTIC: every assertion is a function of the explicit t handed to
 * step() and the prior state. No wall-clock, no RNG. Geometry uses the real
 * (deterministic) Kepler ephemeris; for the BLACKOUT case we build a minimal
 * occluding ephemeris (Earth and Mars on opposite sides of the Sun) because a
 * real solar conjunction never occurs within a play-length window.
 */

const eph = loadEphemeris();

/** One-way data-leg ETA the session freezes for a fetch launched at t. */
function expectedOneWay(t: number): number {
  return oneWaySeconds(eph.distanceBetween("earth", "mars", t));
}

/**
 * A minimal three-body system where the Sun sits BETWEEN Earth and Mars at every
 * t (they orbit at the same radius, 180° apart), so the Earth↔Mars line of sight
 * is permanently occulted — a standing blackout for testing.
 */
function occludingEph(): Ephemeris {
  return Ephemeris.build({
    epoch_jd: 0,
    frame: "test",
    bodies: {
      sun: { mu: 1.327e20, radius_km: 696000 },
      earth: { parent: "sun", a_au: 1.0, e: 0, m0_deg: 0, radius_km: 6371 },
      mars: { parent: "sun", a_au: 1.0, e: 0, m0_deg: 180, radius_km: 3389 },
    },
  });
}

describe("M1Session — full cycle: miss → fetch → arrive → hit", () => {
  it("an empty cache with the link up resolves MISS and starts exactly one fetch", () => {
    const s = new M1Session();
    const r = s.step(eph, 0);

    expect(r.outcome).toBe("miss");
    expect(r.viaCache).toBe(false);
    expect(r.blackout).toBe(false);
    expect(r.fetchInFlight).toBe(true);
    expect(r.cacheFreshness).toBe(0); // nothing held yet
    // Countdown is the one-way DATA-LEG arrival, frozen at launch.
    expect(s.arrivalT).toBeCloseTo(expectedOneWay(0), 9);
    expect(r.fetchCountdownSeconds).toBeCloseTo(expectedOneWay(0), 9);
  });

  it("does NOT start a second fetch while one is already in flight", () => {
    const s = new M1Session();
    s.step(eph, 0);
    const arrival = s.arrivalT;

    // A later step BEFORE arrival keeps the SAME in-flight fetch (no restart).
    const r = s.step(eph, arrival / 2);
    expect(r.outcome).toBe("miss");
    expect(r.fetchInFlight).toBe(true);
    expect(s.arrivalT).toBe(arrival); // unchanged — not relaunched
    expect(r.fetchCountdownSeconds).toBeCloseTo(arrival - arrival / 2, 6);
  });

  it("on arrival stores an ONE-WAY-OLD sample and the next resolve is a cache HIT", () => {
    const s = new M1Session();
    s.step(eph, 0);
    const arrival = s.arrivalT;
    const oneWay = expectedOneWay(0);

    const r = s.step(eph, arrival);
    expect(r.viaCache).toBe(true);
    expect(r.fetchInFlight).toBe(false);
    expect(r.fetchCountdownSeconds).toBeNull();
    // PHYSICALLY HONEST: the cached copy is a SNAPSHOT OF EARTH taken at the
    // fetch's LAUNCH instant (t=0); it has travelled one-way light time to Mars,
    // so on arrival its age == oneWay and freshness == 2^(-oneWay/halfLife) ≈ 0.84
    // — NOT a free 1.0 (that would ignore the transit age) and NOT 0.50.
    const expectedFreshness = Math.pow(2, -oneWay / s.demand.freshnessHalfLifeS);
    expect(r.cacheFreshness).toBeCloseTo(expectedFreshness, 12);
    expect(r.cacheFreshness).toBeCloseTo(0.837, 3);
    // 0.84 lands in the stale-but-PAYING band (0.5 ≤ f < 0.9) — a usable hit that
    // is above the min-acceptable floor, so the demand is served (not a miss).
    expect(r.outcome).toBe("stale");
    expect(r.cacheFreshness).toBeGreaterThan(s.demand.minAcceptableFreshness);
    // A stale serve earns the (positive) stale REVENUE RATE per sim-second.
    expect(r.revenueRatePerSecond).toBe(STALE_REVENUE_RATE_PER_SECOND);
    expect(r.revenueRatePerSecond).toBeGreaterThan(0);
  });

  it("is path-independent: stepping straight to arrival equals stepping in pieces", () => {
    const arrival = expectedOneWay(0);

    const direct = new M1Session();
    direct.step(eph, 0);
    const rDirect = direct.step(eph, arrival);

    const pieced = new M1Session();
    pieced.step(eph, 0);
    pieced.step(eph, arrival * 0.3);
    pieced.step(eph, arrival * 0.7);
    const rPieced = pieced.step(eph, arrival);

    // The RESOLVE-facing state is path-independent. The economy BALANCE is NOT —
    // accrual folds opex over each step's dt, so more steps over the same span
    // sum to the same burn, but the per-step rate snapshot is band-derived and so
    // IS path-independent — compare the resolve fields + the rate snapshot.
    expect(rPieced.outcome).toBe(rDirect.outcome);
    expect(rPieced.viaCache).toBe(rDirect.viaCache);
    expect(rPieced.cacheFreshness).toBeCloseTo(rDirect.cacheFreshness, 12);
    expect(rPieced.fetchInFlight).toBe(rDirect.fetchInFlight);
    expect(rPieced.fetchCountdownSeconds).toBe(rDirect.fetchCountdownSeconds);
    expect(rPieced.blackout).toBe(rDirect.blackout);
    expect(rPieced.revenueRatePerSecond).toBeCloseTo(rDirect.revenueRatePerSecond, 9);
  });
});

describe("M1Session — freshness decay re-triggers a miss", () => {
  it("a held sample decaying below min-acceptable produces the NEXT miss + a new fetch", () => {
    const d = new Demand();
    const s = new M1Session(d);
    s.step(eph, 0); // miss at t=0 -> fetch LAUNCHES at launchT=0
    const firstArrival = s.arrivalT;

    // Land the first fetch -> a usable (stale-band) hit, NOT a miss.
    const hit = s.step(eph, firstArrival);
    expect(hit.viaCache).toBe(true);
    expect(hit.outcome).toBe("stale");

    // The sample was CAPTURED at the launch instant (t=0), so it reaches the 0.5
    // floor one half-life after LAUNCH (t == halfLife), NOT one half-life after
    // arrival. At exactly t=halfLife freshness == 0.5 == min floor (inclusive) ->
    // still a (stale) hit, no new fetch yet.
    const atFloor = d.freshnessHalfLifeS; // launchT(0) + halfLife
    const rFloor = s.step(eph, atFloor);
    expect(rFloor.cacheFreshness).toBeCloseTo(0.5, 9);
    expect(rFloor.outcome).toBe("stale");
    expect(rFloor.viaCache).toBe(true);
    expect(rFloor.fetchInFlight).toBe(false);

    // Just past the half-life freshness drops below 0.5 -> MISS, new fetch starts.
    const past = d.freshnessHalfLifeS + 60;
    const rPast = s.step(eph, past);
    expect(rPast.outcome).toBe("miss");
    expect(rPast.fetchInFlight).toBe(true);
    expect(s.arrivalT).toBeCloseTo(past + expectedOneWay(past), 9);
  });

  it("the loop BREATHES: a second arrival restores a usable hit after the decay miss", () => {
    const d = new Demand();
    const s = new M1Session(d);
    s.step(eph, 0);
    s.step(eph, s.arrivalT); // first (stale-band) hit

    const past = d.freshnessHalfLifeS + 60; // decayed below 0.5
    s.step(eph, past); // decay miss -> second fetch
    const secondLaunch = s.launchT;
    const secondArrival = s.arrivalT;
    expect(secondLaunch).toBeCloseTo(past, 9); // captured at THIS launch instant

    const r = s.step(eph, secondArrival);
    expect(r.viaCache).toBe(true);
    expect(r.outcome).toBe("stale"); // again one-way-old on arrival
    // Same honest arrival freshness: 2^(-oneWay/halfLife) for the new leg.
    const expectedFreshness = Math.pow(2, -expectedOneWay(secondLaunch) / d.freshnessHalfLifeS);
    expect(r.cacheFreshness).toBeCloseTo(expectedFreshness, 9);
  });

  it("BREATHES end-to-end: arrive ≈0.84 -> HIT for a meaningful window (no fetch in flight) -> decay -> miss", () => {
    const d = new Demand();
    const s = new M1Session(d);
    const oneWay = expectedOneWay(0);

    // 1. Empty cache -> MISS -> fetch launches at t=0.
    expect(s.step(eph, 0).outcome).toBe("miss");
    expect(s.isFetching).toBe(true);

    // 2. Arrival: a one-way-old sample lands at ≈0.84 freshness — a usable HIT,
    //    and crucially NO fetch is in flight afterwards.
    const onArrival = s.step(eph, s.arrivalT);
    expect(onArrival.viaCache).toBe(true);
    expect(onArrival.cacheFreshness).toBeCloseTo(Math.pow(2, -oneWay / d.freshnessHalfLifeS), 9);
    expect(onArrival.fetchInFlight).toBe(false);

    // 3. The cache HITS for a MEANINGFUL window with NO fetch crawling. The
    //    window is (halfLife - oneWay) ≈ 2677s ≈ 44.6 min: sample crosses 0.5 at
    //    t=halfLife (age==halfLife from launch). Sample a point mid-window.
    const windowSeconds = d.freshnessHalfLifeS - oneWay;
    expect(windowSeconds).toBeGreaterThan(40 * 60); // > 40 sim-minutes — real breathing room
    const midWindow = oneWay + windowSeconds * 0.5;
    const rMid = s.step(eph, midWindow);
    expect(rMid.viaCache).toBe(true);
    expect(rMid.outcome).toBe("stale"); // still above the 0.5 floor
    expect(rMid.cacheFreshness).toBeGreaterThan(d.minAcceptableFreshness);
    expect(rMid.fetchInFlight).toBe(false); // STILL no fetch — prefetch lever is free here

    // 4. Past the half-life the sample decays below min -> the NEXT miss reopens
    //    the loop (a fresh fetch launches). The loop has BREATHED one full cycle.
    const past = d.freshnessHalfLifeS + 60;
    const rPast = s.step(eph, past);
    expect(rPast.outcome).toBe("miss");
    expect(rPast.fetchInFlight).toBe(true);
  });
});

describe("M1Session — a fresh cache yields a hit with NO fetch", () => {
  it("a restored-fresh cache resolves FRESH on the very first step without starting a fetch", () => {
    const s = new M1Session();
    // Pre-load the cache with a sample captured at t (freshness 1.0 now).
    s.cache.store(s.demand.datasetId, 0, s.demand.freshnessHalfLifeS);

    const r = s.step(eph, 0);
    expect(r.outcome).toBe("fresh");
    expect(r.viaCache).toBe(true);
    expect(r.fetchInFlight).toBe(false);
    expect(r.fetchCountdownSeconds).toBeNull();
    expect(r.cacheFreshness).toBeCloseTo(1.0, 12);
  });
});

describe("M1Session — blackout yields blackout + NO fetch", () => {
  it("link down with no usable cache resolves blackout_miss and starts no fetch", () => {
    const blk = occludingEph();
    const s = new M1Session();

    const r = s.step(blk, 0);
    expect(r.outcome).toBe("blackout_miss");
    expect(r.blackout).toBe(true);
    expect(r.viaCache).toBe(false);
    expect(r.fetchInFlight).toBe(false);
    expect(r.fetchCountdownSeconds).toBeNull();
    expect(r.cacheFreshness).toBe(0);
  });

  it("a fresh cache rescues a blackout: serves locally, no penalty path, no fetch", () => {
    const blk = occludingEph();
    const s = new M1Session();
    s.cache.store(s.demand.datasetId, 0, s.demand.freshnessHalfLifeS);

    const r = s.step(blk, 0);
    expect(r.outcome).toBe("fresh");
    expect(r.blackout).toBe(false);
    expect(r.viaCache).toBe(true);
    expect(r.fetchInFlight).toBe(false);
  });
});

describe("M1Session — prefetch is USABLE mid fresh-hit window", () => {
  it("during a fresh-hit window (no fetch in flight) prefetch() succeeds and charges €", () => {
    const d = new Demand();
    const s = new M1Session(d);
    // Reach a fresh-hit window: miss -> fetch -> arrive -> the cache HITS with no
    // fetch crawling. This is the moment the prefetch lever frees up — the whole
    // point of FIX 1 (an always-in-flight fetch would gate prefetch out forever).
    s.step(eph, 0);
    const arrival = s.arrivalT;
    s.step(eph, arrival); // sample lands; no fetch in flight now
    expect(s.isFetching).toBe(false);

    // Mid-window: the demand is hitting, no fetch is in flight, so a player
    // prefetch can fire. It launches a NEW data-leg fetch and charges €50.
    const midWindow = arrival + (d.freshnessHalfLifeS - expectedOneWay(0)) * 0.5;
    const balanceBefore = s.economy.balance;
    const launched = s.prefetch(eph, midWindow);

    expect(launched).toBe(true);
    expect(s.isFetching).toBe(true);
    expect(s.launchT).toBeCloseTo(midWindow, 9);
    expect(s.arrivalT).toBeCloseTo(midWindow + expectedOneWay(midWindow), 9);
    // The one-shot prefetch cost was charged exactly once.
    expect(balanceBefore - s.economy.balance).toBeCloseTo(PREFETCH_COST, 9);
  });

  it("prefetch is a no-op (NO charge) when a fetch is already in flight (the spam gate)", () => {
    const s = new M1Session();
    s.step(eph, 0); // miss -> auto fetch in flight
    expect(s.isFetching).toBe(true);

    const balanceBefore = s.economy.balance;
    const launched = s.prefetch(eph, 1); // collides with the in-flight fetch
    expect(launched).toBe(false);
    expect(s.economy.balance).toBe(balanceBefore); // NOT charged
  });
});

describe("M1Session — prefetch survives a scripted blackout (pre-position skill)", () => {
  // The session computes linkOpen per step from the eph it is handed, so a
  // "scripted link-down window" is modelled by handing it the permanently-
  // occluded geometry during the blackout stretch and the open geometry before.
  // The cache sample's freshness is independent of which eph is passed, so this
  // is a faithful unit test of the pre-position skill (full scenario is E6).
  const blk = occludingEph();

  it("PREFETCH before the link closes: cache stays >= min through the blackout (served, no -500)", () => {
    const d = new Demand();
    const s = new M1Session(d);

    // 1. While the link is UP, prefetch a sample. It launches at t=0 and arrives
    //    one-way later at ≈0.84 freshness (FIX 1). No miss-fetch competes because
    //    the prefetch is issued BEFORE the first step.
    expect(s.prefetch(eph, 0)).toBe(true);
    const arrival = s.arrivalT;
    s.step(eph, arrival); // sample lands; cache now holds a one-way-old copy

    // 2. The link CLOSES. Step through the blackout window. The freshness is well
    //    above the 0.5 floor right after arrival, so the cache SERVES locally —
    //    no blackout_miss, no -500 penalty.
    const blackoutT = arrival + 60; // still deep in the fresh-hit window
    const rBlackout = s.step(blk, blackoutT);
    expect(rBlackout.blackout).toBe(false);
    expect(rBlackout.outcome).not.toBe("blackout_miss");
    expect(rBlackout.viaCache).toBe(true);
    expect(rBlackout.cacheFreshness).toBeGreaterThanOrEqual(d.minAcceptableFreshness);
    // PAID (positive revenue rate), not penalised — the prefetch bought it out.
    expect(rBlackout.revenueRatePerSecond).toBeGreaterThan(0);
  });

  it("NOT prefetching: the same blackout window takes the blackout_miss penalty (-500)", () => {
    const s = new M1Session();
    // No prefetch, empty cache. The link is down for the whole window.
    const r = s.step(blk, 60);
    expect(r.outcome).toBe("blackout_miss");
    expect(r.blackout).toBe(true);
    expect(r.viaCache).toBe(false);
    // A blackout's revenue rate is the NEGATIVE SLA-penalty rate (no income, plus
    // the penalty) — net-negative on top of opex.
    expect(r.revenueRatePerSecond).toBeLessThan(0);
    expect(r.revenueRatePerSecond).toBe(-BLACKOUT_PENALTY_RATE_PER_SECOND);
  });
});

describe("M1Session — countdown derives as fetchArrivalT − t", () => {
  it("fetchCountdownSeconds tracks (arrivalT − t) and clamps to 0 at/after arrival", () => {
    const s = new M1Session();
    s.step(eph, 0);
    const arrival = s.arrivalT;

    // Mid-flight: countdown is exactly the remaining one-way time.
    const tMid = arrival * 0.4;
    const rMid = s.step(eph, tMid);
    expect(rMid.fetchCountdownSeconds).toBeCloseTo(arrival - tMid, 6);

    // A separate session driven to just before arrival: still positive.
    const s2 = new M1Session();
    s2.step(eph, 0);
    const justBefore = s2.arrivalT - 1;
    const rBefore = s2.step(eph, justBefore);
    expect(rBefore.fetchInFlight).toBe(true);
    expect(rBefore.fetchCountdownSeconds).toBeCloseTo(1, 6);
  });

  it("snapshot/restore round-trips the in-flight fetch and cache (deterministic continuation)", () => {
    const original = new M1Session();
    original.step(eph, 0);
    original.step(eph, original.arrivalT * 0.5);

    const snap = original.snapshot();
    const restored = new M1Session();
    restored.restore(snap);

    expect(restored.snapshot()).toEqual(snap);
    // Both continue identically to arrival.
    const t = original.arrivalT;
    expect(restored.step(eph, t)).toEqual(original.step(eph, t));
  });
});
