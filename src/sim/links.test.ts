import { describe, it, expect } from "vitest";
import { segmentSphere, earthMarsLos } from "./links";
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

  it("returns the documented shape with a boolean occultation flag", () => {
    const los = earthMarsLos(eph, 20_000_000);
    expect(Object.keys(los).sort()).toEqual(["marginSolarRadii", "missDistance", "occulted"]);
    expect(typeof los.missDistance).toBe("number");
    expect(typeof los.marginSolarRadii).toBe("number");
    expect(typeof los.occulted).toBe("boolean");
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
