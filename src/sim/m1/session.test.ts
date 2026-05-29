import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Ephemeris } from "../ephemeris";
import { oneWaySeconds } from "../delay";
import { M1Session } from "./session";
import { Demand } from "./demand";

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

  it("on arrival stores a fresh sample and the next resolve is a FRESH cache HIT", () => {
    const s = new M1Session();
    s.step(eph, 0);
    const arrival = s.arrivalT;

    const r = s.step(eph, arrival);
    expect(r.outcome).toBe("fresh");
    expect(r.viaCache).toBe(true);
    expect(r.fetchInFlight).toBe(false);
    expect(r.fetchCountdownSeconds).toBeNull();
    // Sample captured AT the arrival instant -> freshness 1.0 right then.
    expect(r.cacheFreshness).toBeCloseTo(1.0, 12);
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

    expect(rPieced).toEqual(rDirect);
  });
});

describe("M1Session — freshness decay re-triggers a miss", () => {
  it("a held sample decaying below min-acceptable produces the NEXT miss + a new fetch", () => {
    const d = new Demand();
    const s = new M1Session(d);
    s.step(eph, 0);
    const firstArrival = s.arrivalT;

    // Land the first fetch -> FRESH hit.
    const hit = s.step(eph, firstArrival);
    expect(hit.outcome).toBe("fresh");

    // After one half-life the sample is exactly at freshness 0.5 == min floor
    // (inclusive) -> still a (stale) hit, no new fetch yet.
    const atFloor = firstArrival + d.freshnessHalfLifeS;
    const rFloor = s.step(eph, atFloor);
    expect(rFloor.cacheFreshness).toBeCloseTo(0.5, 9);
    expect(rFloor.outcome).toBe("stale");
    expect(rFloor.viaCache).toBe(true);
    expect(rFloor.fetchInFlight).toBe(false);

    // Just past the half-life freshness drops below 0.5 -> MISS, new fetch starts.
    const past = firstArrival + d.freshnessHalfLifeS + 60;
    const rPast = s.step(eph, past);
    expect(rPast.outcome).toBe("miss");
    expect(rPast.fetchInFlight).toBe(true);
    expect(s.arrivalT).toBeCloseTo(past + expectedOneWay(past), 9);
  });

  it("the loop BREATHES: a second arrival restores a fresh hit after the decay miss", () => {
    const d = new Demand();
    const s = new M1Session(d);
    s.step(eph, 0);
    s.step(eph, s.arrivalT); // first fresh hit

    const past = s.arrivalT + d.freshnessHalfLifeS + 60;
    s.step(eph, past); // decay miss -> second fetch
    const secondArrival = s.arrivalT;

    const r = s.step(eph, secondArrival);
    expect(r.outcome).toBe("fresh");
    expect(r.viaCache).toBe(true);
    expect(r.cacheFreshness).toBeCloseTo(1.0, 12);
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
