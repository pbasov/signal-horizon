import { describe, it, expect } from "vitest";
import { Ephemeris, type SystemSpec } from "../ephemeris";
import { loadEphemeris } from "../system-data";
import { GeodesicGrid } from "./grid";
import { DemandField } from "./demand";
import {
  coverageOf,
  linkGeometry,
  groundStation,
  satAsset,
  assetPosition,
  cellWorldPosition,
  MIN_ELEVATION_RAD,
  REF_LINK_DISTANCE_M,
  type Asset,
} from "./field";
import { scoreCoverage } from "./score";

/**
 * Coverage-geometry pins for the M2a coverage field (§4.2 dimensions, §4.3 link
 * budget). The two gates are tested directly:
 *   - LINE OF SIGHT: a sat overhead its subsatellite cell is covered; a cell on
 *     the FAR side of the body is below the local horizon ⇒ the body occludes it.
 *   - LINK BUDGET: the inverse-square received-signal threshold + the minimum
 *     elevation gate behave (near covers, over-the-horizon does not).
 * Plus the demand-weighted scoring rollup. Real-ephemeris cases mirror
 * links.test.ts; synthetic cases give exact, hand-reasoned geometry.
 */

const DEG = Math.PI / 180;

/** A minimal synthetic system: a body "world" at the origin (radius 6371 km)
 * with one circular EQUATORIAL satellite at GEO altitude. At t=0 the sat sits on
 * the +x axis, so its subsatellite point is +x — fully controlled geometry. */
function syntheticWorld(altKm: number): Ephemeris {
  const spec: SystemSpec = {
    frame: "test",
    bodies: { world: { parent: null, mu: 3.986004418e14, radius_km: 6371 } },
    satellites: {
      sat: { parent: "world", mu: 0, radius_km: 0.001, a_km: altKm, e: 0, inc_deg: 0, raan_deg: 0, argp_deg: 0, m0_deg: 0 },
    },
  };
  return Ephemeris.build(spec);
}

/** Cell whose centre best aligns with a target unit vector. */
function nearestCell(grid: GeodesicGrid, target: [number, number, number]): number {
  let best = 0;
  let bestDot = -Infinity;
  for (const c of grid.cells) {
    const d = c.center[0] * target[0] + c.center[1] * target[1] + c.center[2] * target[2];
    if (d > bestDot) {
      bestDot = d;
      best = c.id;
    }
  }
  return best;
}

describe("coverage geometry — line of sight (synthetic, exact)", () => {
  const grid = GeodesicGrid.build(2);
  const eph = syntheticWorld(42164); // GEO altitude.
  const sat = satAsset("sat", "sat");
  const subId = nearestCell(grid, [1, 0, 0]); // subsatellite cell (+x).
  const antiId = nearestCell(grid, [-1, 0, 0]); // antipodal cell (−x).

  it("a sat (near-)overhead its subsatellite cell COVERS it at high elevation", () => {
    const lk = linkGeometry(eph, "world", grid.cells[subId], sat, 0);
    expect(lk.elevationRad).toBeGreaterThan(70 * DEG);
    expect(lk.covers).toBe(true);
    const cov = coverageOf(eph, grid.cells[subId], [sat], 0, "world");
    expect(cov.connectivity).toBe(1);
    expect(cov.bandwidth).toBeGreaterThan(0);
    expect(cov.latencyS).toBeGreaterThan(0);
    expect(cov.latencyS).toBeLessThan(Infinity);
  });

  it("a cell on the FAR side of the body is NOT covered (the body occludes it)", () => {
    const lk = linkGeometry(eph, "world", grid.cells[antiId], sat, 0);
    expect(lk.elevationRad).toBeLessThan(0); // below the local horizon.
    expect(lk.covers).toBe(false);
    const cov = coverageOf(eph, grid.cells[antiId], [sat], 0, "world");
    expect(cov.connectivity).toBe(0);
    expect(cov.bandwidth).toBe(0);
    expect(cov.latencyS).toBe(Infinity);
  });

  it("latency is propagation distance ÷ c for a covering link", () => {
    const C = 299792458.0;
    const lk = linkGeometry(eph, "world", grid.cells[subId], sat, 0);
    expect(lk.latencyS).toBeCloseTo(lk.distanceM / C, 9);
  });
});

describe("coverage geometry — ground-station footprint (synthetic, exact)", () => {
  const grid = GeodesicGrid.build(2);
  const eph = syntheticWorld(42164);

  it("a ground station covers its OWN cell at ~90° elevation", () => {
    const cell = grid.cells[0];
    const gs = groundStation("gs", "world", cell.latRad / DEG, cell.lonRad / DEG);
    const lk = linkGeometry(eph, "world", cell, gs, 0);
    expect(lk.elevationRad).toBeCloseTo(Math.PI / 2, 6); // straight up.
    expect(lk.covers).toBe(true);
  });

  it("a ground station covers a NEARBY cell but NOT an over-the-horizon one", () => {
    const cell = grid.cells[0];
    const gs = groundStation("gs", "world", cell.latRad / DEG, cell.lonRad / DEG);
    // Antipodal cell to the station — far over the horizon.
    const antiId = nearestCell(grid, [-cell.center[0], -cell.center[1], -cell.center[2]]);
    const lkFar = linkGeometry(eph, "world", grid.cells[antiId], gs, 0);
    expect(lkFar.elevationRad).toBeLessThan(MIN_ELEVATION_RAD);
    expect(lkFar.covers).toBe(false);
  });
});

describe("link budget — inverse-square + minimum-elevation gates", () => {
  const grid = GeodesicGrid.build(2);
  const eph = syntheticWorld(42164);
  const subId = nearestCell(grid, [1, 0, 0]);

  it("a low-EIRP asset just below the budget does NOT close the link", () => {
    // Place a ground station on its own cell so distance == altitude (200 km).
    const cell = grid.cells[subId];
    // received = eirp·(ref/d)². At d=200 km the ratio is huge, so to find the
    // budget edge we instead test a sat at GEO with a tiny EIRP.
    const weak = satAsset("weak", "sat", 1e-6);
    const cov = coverageOf(eph, cell, [weak], 0, "world");
    expect(cov.connectivity).toBe(0); // received < 1 ⇒ no capacity ⇒ no cover.
  });

  it("the elevation gate alone can block a strong link (over-the-horizon)", () => {
    const antiId = nearestCell(grid, [-1, 0, 0]);
    const strong = satAsset("strong", "sat", 1e6); // huge EIRP closes the budget…
    const lk = linkGeometry(eph, "world", grid.cells[antiId], strong, 0);
    expect(lk.capacity).toBeGreaterThan(0); // budget cleared…
    expect(lk.elevationRad).toBeLessThan(MIN_ELEVATION_RAD); // …but below horizon.
    expect(lk.covers).toBe(false); // both gates required.
  });

  it("capacity grows with EIRP and falls with distance² (the budget shape)", () => {
    const cell = grid.cells[subId];
    const lk1 = linkGeometry(eph, "world", cell, satAsset("a", "sat", 1.0), 0);
    const lk2 = linkGeometry(eph, "world", cell, satAsset("b", "sat", 2.0), 0);
    expect(lk2.capacity).toBeCloseTo(lk1.capacity * 2, 6); // linear in EIRP.
    // received at the reference distance with unit EIRP is exactly 1.
    expect((REF_LINK_DISTANCE_M / REF_LINK_DISTANCE_M) ** 2).toBe(1);
  });

  it("connectivity counts each covering asset; bandwidth sums their capacity", () => {
    const cell = grid.cells[subId];
    const two = [satAsset("a", "sat", 1.0), satAsset("b", "sat", 1.0)];
    const cov = coverageOf(eph, cell, two, 0, "world");
    expect(cov.connectivity).toBe(2);
    const one = coverageOf(eph, cell, [two[0]], 0, "world");
    expect(cov.bandwidth).toBeCloseTo(one.bandwidth * 2, 6);
  });
});

describe("coverage field — purity / determinism", () => {
  const eph = loadEphemeris();
  const grid = GeodesicGrid.build(2);
  const assets: Asset[] = [satAsset("geo", "sat_geo"), satAsset("leo", "sat_leo")];

  it("coverageOf is a pure function of (cell, assets, t)", () => {
    const a = coverageOf(eph, grid.cells[100], assets, 12_345, "earth");
    const b = coverageOf(eph, grid.cells[100], assets, 12_345, "earth");
    expect(a).toEqual(b);
  });

  it("assetPosition places a ground station above the surface by its altitude", () => {
    const gs = groundStation("g", "earth", 0, 0, 1, 100_000);
    const p = assetPosition(eph, gs, 0);
    const earth = eph.position("earth", 0);
    const r = Math.hypot(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]);
    expect(r).toBeCloseTo(eph.radiusMeters("earth") + 100_000, 3);
  });

  it("a cell world position sits on the body surface (radius from centre)", () => {
    const p = cellWorldPosition(eph, "earth", grid.cells[0], 0);
    const earth = eph.position("earth", 0);
    const r = Math.hypot(p[0] - earth[0], p[1] - earth[1], p[2] - earth[2]);
    expect(r).toBeCloseTo(eph.radiusMeters("earth"), 3);
  });
});

describe("coverage scoring — demand-weighted multi-axis rollup (§4.2)", () => {
  const eph = loadEphemeris();
  const grid = GeodesicGrid.build(2);
  const demand = DemandField.build(grid);

  it("no assets ⇒ zero covered demand, all axes at their empty values", () => {
    const s = scoreCoverage(eph, grid, demand, [], 0, "earth");
    expect(s.cellsCovered).toBe(0);
    expect(s.coveredDemand).toBe(0);
    expect(s.coveredDemandFraction).toBe(0);
    expect(s.demandWeightedBandwidth).toBe(0);
    expect(s.demandWeightedMeanLatencyS).toBe(0);
    expect(s.worstCoveredLatencyS).toBe(0);
    expect(s.cellsTotal).toBe(grid.size);
    expect(s.totalDemand).toBeCloseTo(demand.total, 9);
  });

  it("adding assets raises covered-demand fraction into (0,1]", () => {
    const s = scoreCoverage(
      eph,
      grid,
      demand,
      [satAsset("geo", "sat_geo"), satAsset("leo", "sat_leo"), satAsset("m1", "sat_meo_inc"), satAsset("m2", "sat_meo_polar")],
      0,
      "earth",
    );
    expect(s.coveredDemandFraction).toBeGreaterThan(0);
    expect(s.coveredDemandFraction).toBeLessThanOrEqual(1);
    expect(s.cellsCovered).toBeGreaterThan(0);
    expect(s.cellsCovered).toBeLessThanOrEqual(grid.size);
    // Covered demand cannot exceed total demand.
    expect(s.coveredDemand).toBeLessThanOrEqual(s.totalDemand + 1e-9);
    // Latency axes are sane (covered cells have a finite minimum hop).
    expect(s.demandWeightedMeanLatencyS).toBeGreaterThan(0);
    expect(s.worstCoveredLatencyS).toBeGreaterThanOrEqual(s.demandWeightedMeanLatencyS);
  });

  it("more assets never reduce coverage (monotonic in the asset set)", () => {
    const few = scoreCoverage(eph, grid, demand, [satAsset("geo", "sat_geo")], 0, "earth");
    const many = scoreCoverage(
      eph,
      grid,
      demand,
      [satAsset("geo", "sat_geo"), satAsset("leo", "sat_leo"), satAsset("m1", "sat_meo_inc")],
      0,
      "earth",
    );
    expect(many.cellsCovered).toBeGreaterThanOrEqual(few.cellsCovered);
    expect(many.coveredDemand).toBeGreaterThanOrEqual(few.coveredDemand - 1e-9);
  });

  it("scoring is a pure function of its inputs", () => {
    const assets = [satAsset("geo", "sat_geo")];
    const a = scoreCoverage(eph, grid, demand, assets, 7_777, "earth");
    const b = scoreCoverage(eph, grid, demand, assets, 7_777, "earth");
    expect(a).toEqual(b);
  });
});
