import { describe, it, expect } from "vitest";
import {
  NET_ACT1_REGION,
  NET_ACT1_GROUND,
  NET_ACT1_REGION_RADIUS_RAD,
  NET_MIN_ELEVATION_RAD,
  NET_SPACE_SAMPLES,
  sampleRegionPoints,
  coveredFraction,
  type RegionPoint,
} from "./endpoint";
import { MIN_ELEVATION_RAD } from "../coverage/field";
import { NET_ACT3A_CORRIDOR_REGION, NET_ACT3A_BACKHAUL_REGION } from "./scenario";

const DEG = Math.PI / 180;

/** Body-fixed unit vector for (lat,lon) — local copy of the region's convention. */
function unit(latRad: number, lonRad: number): [number, number, number] {
  const cl = Math.cos(latRad);
  return [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
}

/** Geodesic angle (radians) between two surface points. */
function geodesic(a: RegionPoint, b: { latRad: number; lonRad: number }): number {
  const ua = unit(a.latRad, a.lonRad);
  const ub = unit(b.latRad, b.lonRad);
  const dot = Math.max(-1, Math.min(1, ua[0] * ub[0] + ua[1] * ub[1] + ua[2] * ub[2]));
  return Math.acos(dot);
}

/** A coverage predicate that accepts points within `thresholdRad` of the region
 * centre — a clean knob to exercise full / clipped / empty footprints. */
function withinAngle(
  centre: { latRad: number; lonRad: number },
  thresholdRad: number,
): (p: RegionPoint) => boolean {
  return (p) => geodesic(p, centre) <= thresholdRad;
}

describe("endpoint: structs + net/ constants (re-centered equatorial)", () => {
  it("pins the sample count", () => {
    expect(NET_SPACE_SAMPLES).toBe(400);
  });

  it("the elevation floor is the net-local 10° horizon mask (NOT field.ts's 5°)", () => {
    // The coverage re-scale forked this from the M2 grid's floor: 5° is permissive anywhere
    // and absurd on a 300 km toy body, where it closed links on birds grazing the limb.
    expect(NET_MIN_ELEVATION_RAD).toBeCloseTo(10 * DEG, 15);
    expect(NET_MIN_ELEVATION_RAD).toBeGreaterThan(MIN_ELEVATION_RAD);
  });

  it("the region is the EQUATORIAL metro disc (lat 0°, lon 0°, rad 6°)", () => {
    expect(NET_ACT1_REGION.latRad).toBe(0);
    expect(NET_ACT1_REGION.lonRad).toBe(0);
    expect(NET_ACT1_REGION.radiusRad).toBe(NET_ACT1_REGION_RADIUS_RAD);
    // 6°, not the old 10°: once the globe draws EVERY live tender, 10° discs merged the
    // equatorial board into one smear. See the constant's own note.
    expect(NET_ACT1_REGION.radiusRad).toBeCloseTo(6 * DEG, 15);
    expect(NET_ACT1_REGION.bodyId).toBe("earth");
  });

  it("the equatorial tenders are separate PLACES, not one overlapping smear", () => {
    // The regression this guards: three separately-priced equatorial tenders whose 10° discs
    // all contained each other's centres. Any two region rims must clear each other.
    const rad = NET_ACT1_REGION_RADIUS_RAD;
    const lons = [
      { id: "REGION-0", lonRad: NET_ACT1_REGION.lonRad },
      { id: "REGION-2", lonRad: NET_ACT3A_CORRIDOR_REGION.lonRad },
      { id: "BACKHAUL-3", lonRad: NET_ACT3A_BACKHAUL_REGION.lonRad },
    ];
    for (let i = 0; i < lons.length; i++) {
      for (let j = i + 1; j < lons.length; j++) {
        const sep = Math.abs(lons[i].lonRad - lons[j].lonRad); // all three sit on the equator.
        expect(sep, `${lons[i].id} vs ${lons[j].id}`).toBeGreaterThan(2 * rad);
      }
    }
  });

  it("the ground network is equatorial on the same meridian (lat 0°)", () => {
    expect(NET_ACT1_GROUND.latRad).toBe(0);
    expect(NET_ACT1_GROUND.lonRad).toBe(0);
    expect(NET_ACT1_GROUND.bodyId).toBe("earth");
  });
});

describe("endpoint: Fibonacci-spiral disc sampling (deterministic, no RNG)", () => {
  it("produces exactly sampleCount points, all inside the disc radius", () => {
    const pts = sampleRegionPoints(NET_ACT1_REGION, NET_SPACE_SAMPLES);
    expect(pts.length).toBe(NET_SPACE_SAMPLES);
    for (const p of pts) {
      // Every sample lies within the disc (allow a hair of float slack).
      expect(geodesic(p, NET_ACT1_REGION)).toBeLessThanOrEqual(
        NET_ACT1_REGION.radiusRad + 1e-9,
      );
    }
  });

  it("is deterministic — same inputs give byte-identical points", () => {
    const a = sampleRegionPoints(NET_ACT1_REGION, NET_SPACE_SAMPLES);
    const b = sampleRegionPoints(NET_ACT1_REGION, NET_SPACE_SAMPLES);
    for (let i = 0; i < a.length; i++) {
      expect(a[i].latRad).toBe(b[i].latRad);
      expect(a[i].lonRad).toBe(b[i].lonRad);
    }
  });

  it("spreads near-uniformly — the mean sample sits near the disc centre", () => {
    // For an equal-area disc sample the centroid direction should point at the
    // region centre (no clustering bias toward one azimuth).
    const pts = sampleRegionPoints(NET_ACT1_REGION, NET_SPACE_SAMPLES);
    let sx = 0;
    let sy = 0;
    let sz = 0;
    for (const p of pts) {
      const u = unit(p.latRad, p.lonRad);
      sx += u[0];
      sy += u[1];
      sz += u[2];
    }
    const centroid: RegionPoint = {
      latRad: Math.asin(Math.max(-1, Math.min(1, sz / Math.hypot(sx, sy, sz)))),
      lonRad: Math.atan2(sy, sx),
    };
    // Centroid is well within 1° of the region centre.
    expect(geodesic(centroid, NET_ACT1_REGION)).toBeLessThan(1 * DEG);
  });
});

describe("endpoint: coveredFraction", () => {
  it("a footprint covering the whole disc → 1", () => {
    const f = coveredFraction(
      NET_ACT1_REGION,
      NET_SPACE_SAMPLES,
      withinAngle(NET_ACT1_REGION, NET_ACT1_REGION.radiusRad * 2), // threshold ≥ radius
    );
    expect(f).toBe(1);
  });

  it("a footprint clipping the disc edge → in (0,1)", () => {
    // Centre the footprint at the region centre but shrink it to half the disc
    // radius: the inner samples are covered, the outer annulus is not.
    const f = coveredFraction(
      NET_ACT1_REGION,
      NET_SPACE_SAMPLES,
      withinAngle(NET_ACT1_REGION, NET_ACT1_REGION.radiusRad * 0.5),
    );
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    // Equal-area sampling ⇒ a half-radius cap covers ~ the cap-area fraction.
    const fullCapArea = 1 - Math.cos(NET_ACT1_REGION.radiusRad);
    const halfCapArea = 1 - Math.cos(NET_ACT1_REGION.radiusRad * 0.5);
    expect(f).toBeCloseTo(halfCapArea / fullCapArea, 1);
  });

  it("a footprint covering nothing → 0", () => {
    const f = coveredFraction(NET_ACT1_REGION, NET_SPACE_SAMPLES, () => false);
    expect(f).toBe(0);
  });

  it("offset footprint (one edge dark) → in (0,1), monotone in offset", () => {
    // A footprint centred SOUTH of the region by 4°, radius = the region radius:
    // the north slice falls outside it (a generic clip shape).
    const southCentre = { latRad: NET_ACT1_REGION.latRad - 4 * DEG, lonRad: 0 };
    const f = coveredFraction(
      NET_ACT1_REGION,
      NET_SPACE_SAMPLES,
      withinAngle(southCentre, NET_ACT1_REGION.radiusRad),
    );
    expect(f).toBeGreaterThan(0);
    expect(f).toBeLessThan(1);
    // Pushing the footprint further south covers strictly less of the region.
    const furtherSouth = { latRad: NET_ACT1_REGION.latRad - 8 * DEG, lonRad: 0 };
    const f2 = coveredFraction(
      NET_ACT1_REGION,
      NET_SPACE_SAMPLES,
      withinAngle(furtherSouth, NET_ACT1_REGION.radiusRad),
    );
    expect(f2).toBeLessThan(f);
  });

  it("the band is stable at the pinned N=400 (vs N=800)", () => {
    const pred = withinAngle(
      { latRad: NET_ACT1_REGION.latRad - 4 * DEG, lonRad: 0 },
      NET_ACT1_REGION.radiusRad,
    );
    const f400 = coveredFraction(NET_ACT1_REGION, 400, pred);
    const f800 = coveredFraction(NET_ACT1_REGION, 800, pred);
    // The equal-area spiral converges; 400 and 800 agree to within ~2%.
    expect(Math.abs(f400 - f800)).toBeLessThan(0.02);
  });
});
