import { describe, it, expect } from "vitest";
import { segmentSphere, earthMarsLos, lineOfSight, SOLAR_CORRIDOR_RSUN } from "./links";
import type { Vec3 } from "./ephemeris";
import { loadEphemeris } from "./system-data";

/**
 * Behaviour/invariant pins for the line-of-sight occlusion geometry
 * (port of SignalLink.cs SegmentBlockedBySphere).
 *
 * The contract is geometric, not implementation-detail:
 *   - "blocked" requires the sphere centre to project STRICTLY BETWEEN the
 *     endpoints (0 < t < 1) AND lie within `radius` of the segment.
 *   - A sphere behind an endpoint or beyond the far endpoint is NEVER blocked,
 *     no matter how large its radius.
 *   - distance/t are exact for hand-checked synthetic vectors.
 *
 * The earthMarsLos cases load the REAL vendored ephemeris (no synthetic
 * positions) and assert shape + the margin/occult relationship at a sim-time
 * whose geometry is reasoned about explicitly.
 */

describe("segmentSphere — closest-point geometry (hand-checked unit cases)", () => {
  // Canonical setup: segment A=(0,0,0) → B=(10,0,0) along +x.
  // For centre C, the closest-point parameter is t = (C·AB)/|AB|² = Cx/10,
  // the clamped closest point is (clamp(Cx,0,10), 0, 0), and the miss distance
  // is hypot(perpendicular offset). These are all computed by hand below.
  const A: Vec3 = [0, 0, 0];
  const B: Vec3 = [10, 0, 0];

  it("returns the exact closest-point parameter and miss distance", () => {
    // C=(3,4,0): t = 3/10 = 0.3, closest point (3,0,0), distance = 4.
    const r = segmentSphere(A, B, [3, 4, 0], 5);
    expect(r.t).toBeCloseTo(0.3, 12);
    expect(r.distance).toBeCloseTo(4, 12);
  });

  it("blocks when the centre projects between the endpoints AND is within radius", () => {
    // distance 4 < radius 5, t=0.3 ∈ (0,1) → blocked.
    expect(segmentSphere(A, B, [3, 4, 0], 5).blocked).toBe(true);
  });

  it("does NOT block when between the endpoints but the disk is missed (distance > radius)", () => {
    // Same geometry, smaller radius: distance 4 > radius 3 → grazes past, no block.
    const r = segmentSphere(A, B, [3, 4, 0], 3);
    expect(r.distance).toBeCloseTo(4, 12);
    expect(r.t).toBeCloseTo(0.3, 12);
    expect(r.blocked).toBe(false);
  });

  it("does NOT block a sphere behind the start endpoint, even with a huge radius", () => {
    // C=(-5,1,0): t = -0.5 < 0 → the Sun is "behind" A, not between A and B.
    // Radius 100 would trivially overlap A, but the projection is off-segment.
    const r = segmentSphere(A, B, [-5, 1, 0], 100);
    expect(r.t).toBeLessThan(0);
    expect(r.blocked).toBe(false);
  });

  it("does NOT block a sphere beyond the far endpoint, even with a huge radius", () => {
    // C=(15,1,0): t = 1.5 > 1 → beyond B. Off-segment ⇒ never blocked.
    const r = segmentSphere(A, B, [15, 1, 0], 100);
    expect(r.t).toBeGreaterThan(1);
    expect(r.blocked).toBe(false);
  });

  it("treats the open interval as strict: t exactly at an endpoint is not blocked", () => {
    // Centre sitting on A (t=0) with a generous radius: 0<t<1 is FALSE at t=0.
    const atA = segmentSphere(A, B, [0, 0, 0], 5);
    expect(atA.t).toBe(0);
    expect(atA.distance).toBe(0);
    expect(atA.blocked).toBe(false);
    // Centre on B (t=1) likewise.
    const atB = segmentSphere(A, B, [10, 0, 0], 5);
    expect(atB.t).toBe(1);
    expect(atB.blocked).toBe(false);
  });

  it("handles a degenerate zero-length segment without dividing by zero", () => {
    // a == b: t falls back to 0, distance is |centre - a|, never blocked.
    const r = segmentSphere([2, 2, 2], [2, 2, 2], [5, 6, 2], 10);
    expect(r.t).toBe(0);
    expect(r.distance).toBeCloseTo(5, 12); // hypot(3,4,0)
    expect(r.blocked).toBe(false);
  });

  it("never reports a negative distance and keeps results pure (same input → same output)", () => {
    const once = segmentSphere(A, B, [7, -2, 3], 1.5);
    const twice = segmentSphere(A, B, [7, -2, 3], 1.5);
    expect(once).toEqual(twice);
    expect(once.distance).toBeGreaterThanOrEqual(0);
  });
});

describe("earthMarsLos — Earth→Mars line-of-sight margin against the Sun (real ephemeris)", () => {
  const eph = loadEphemeris();

  it("returns the documented shape with boolean occult + corridor flags", () => {
    const los = earthMarsLos(eph, 20_000_000);
    expect(Object.keys(los).sort()).toEqual([
      "corridorRsun",
      "inCorridor",
      "marginSolarRadii",
      "missDistance",
      "occulted",
    ]);
    expect(typeof los.missDistance).toBe("number");
    expect(typeof los.marginSolarRadii).toBe("number");
    expect(typeof los.occulted).toBe("boolean");
    expect(typeof los.inCorridor).toBe("boolean");
    expect(los.corridorRsun).toBe(SOLAR_CORRIDOR_RSUN);
  });

  it("expresses the margin as missDistance in solar radii (margin = miss / sunR)", () => {
    const sunR = eph.radiusMeters("sun");
    expect(sunR).toBeGreaterThan(0);
    const los = earthMarsLos(eph, 20_000_000);
    expect(los.marginSolarRadii).toBeCloseTo(los.missDistance / sunR, 6);
  });

  it("is NOT occulted when the line clears the solar disk by a wide margin", () => {
    // At t=20e6 the Sun (at the origin) projects ~0.38 of the way along the
    // Earth→Mars segment — strictly BETWEEN the endpoints, so the occlusion
    // branch is geometrically live — yet the line misses the disk by tens of
    // solar radii. margin > 1 ⇒ disk not crossed ⇒ occulted must be false.
    const los = earthMarsLos(eph, 20_000_000);
    expect(los.marginSolarRadii).toBeGreaterThan(1);
    expect(los.occulted).toBe(false);
  });

  it("upholds the occult/margin relationship: an occultation implies margin < 1", () => {
    // Invariant across the dataset's geometry: the disk can only be crossed
    // (occulted) when the miss distance is inside one solar radius.
    for (let t = 0; t <= 80_000_000; t += 2_000_000) {
      const los = earthMarsLos(eph, t);
      if (los.occulted) expect(los.marginSolarRadii).toBeLessThan(1);
      else expect(los.marginSolarRadii).toBeGreaterThanOrEqual(0);
    }
  });

  it("is a pure function of (eph, t): repeated calls are identical", () => {
    expect(earthMarsLos(eph, 12_345_678)).toEqual(earthMarsLos(eph, 12_345_678));
  });
});

describe("solar-interference corridor — the blackout generalisation (E10a, retires SD-22)", () => {
  // Canonical setup: Earth at the origin, Mars 10 along +x, Sun centred at
  // (5, 4, 0) — projecting to the segment MIDPOINT, 4 units off-axis. With a
  // "Sun radius" of 1 the disk is missed (4 > 1) but a 5× corridor catches it
  // (4 < 5). This is the corridor in miniature, away from the real eph.
  const A: Vec3 = [0, 0, 0];
  const B: Vec3 = [10, 0, 0];
  const SUN: Vec3 = [5, 4, 0];

  it("segmentSphere separates the GEOMETRY radius (distance) from the BLOCK radius (corridor)", () => {
    // distance is the true miss (4); blocked keys off the (larger) block radius.
    const disk = segmentSphere(A, B, SUN, 1); // blockRadius defaults to radius=1
    expect(disk.distance).toBeCloseTo(4, 12);
    expect(disk.blocked).toBe(false); // 4 > 1 → disk missed

    const corridor = segmentSphere(A, B, SUN, 1, 5); // blockRadius=5 (N=5 Rsun)
    expect(corridor.distance).toBeCloseTo(4, 12); // SAME geometry distance
    expect(corridor.blocked).toBe(true); // 4 < 5 → inside the corridor
  });

  it("a corridor blocks only when the Sun is BETWEEN the endpoints (near-side never blacks out)", () => {
    // Sun behind the start (t<0): even a vast corridor cannot block it.
    const behind = segmentSphere(A, B, [-3, 1, 0], 1, 100);
    expect(behind.t).toBeLessThan(0);
    expect(behind.blocked).toBe(false);
    // Sun beyond the far endpoint (t>1): likewise never blocks.
    const beyond = segmentSphere(A, B, [13, 1, 0], 1, 100);
    expect(beyond.t).toBeGreaterThan(1);
    expect(beyond.blocked).toBe(false);
  });

  describe("on the REAL ephemeris", () => {
    const eph = loadEphemeris();
    // The conjunction epoch (the t minimising the Sun-LOS miss); found by scan.
    const CONJ_T = 15_731_438;

    it("the tightest real Sun-miss is ≈3.32 Rsun — so N=1 (disk) NEVER fires but N=5 DOES", () => {
      const los = earthMarsLos(eph, CONJ_T);
      expect(los.marginSolarRadii).toBeGreaterThan(3.3);
      expect(los.marginSolarRadii).toBeLessThan(3.4);
      // The bare disk (N=1) is never crossed — SD-22's dormancy.
      expect(lineOfSight(eph, "earth", "mars", CONJ_T, ["sun"], 1)).toBe(true);
      // The default corridor (N=5) DOES black it out — the live blackout.
      expect(lineOfSight(eph, "earth", "mars", CONJ_T, ["sun"], SOLAR_CORRIDOR_RSUN)).toBe(false);
      expect(earthMarsLos(eph, CONJ_T).inCorridor).toBe(true);
    });

    it("N=1 corridor reduces EXACTLY to the physical-disk occultation (clean generalisation)", () => {
      for (let t = 0; t <= 30_000_000; t += 500_000) {
        const occulted = earthMarsLos(eph, t).occulted;
        const n1Blocked = !lineOfSight(eph, "earth", "mars", t, ["sun"], 1);
        expect(n1Blocked).toBe(occulted);
      }
    });

    it("the corridor opens a real blackout WINDOW that brackets the conjunction", () => {
      // Far from conjunction the link is open; in the window it is blacked out;
      // the window is centred on (contains) the conjunction epoch.
      expect(lineOfSight(eph, "earth", "mars", CONJ_T - 2_000_000, ["sun"])).toBe(true);
      expect(lineOfSight(eph, "earth", "mars", CONJ_T, ["sun"])).toBe(false);
      expect(lineOfSight(eph, "earth", "mars", CONJ_T + 2_000_000, ["sun"])).toBe(true);
    });
  });
});
