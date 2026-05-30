import { describe, it, expect } from "vitest";
import {
  GeodesicGrid,
  cellCount,
  DEFAULT_GRID_LEVEL,
  sphericalTriangleArea,
  unitToLatLon,
  latLonToUnit,
} from "./grid";

/**
 * Invariant pins for the roll-your-own subdivided-icosahedron grid (M2a, §4.2).
 * The contract is geometric + structural, not implementation detail:
 *   - cell count matches the triangular-face formula 20·4^level exactly,
 *   - cells are non-degenerate (positive area, unit-vector centres),
 *   - edge-adjacency is SYMMETRIC (a∈N(b) ⇒ b∈N(a)) and every cell has 3 of them,
 *   - the solid-angle areas SUM to ~4π (whole unit sphere),
 *   - the build is deterministic + pure (same level → byte-identical grid).
 */

const LEVELS = [0, 1, 2, 3];

describe("GeodesicGrid — cell count follows the subdivision formula 20·4^level", () => {
  for (const level of LEVELS) {
    it(`level ${level} → ${cellCount(level)} cells`, () => {
      const grid = GeodesicGrid.build(level);
      expect(grid.size).toBe(cellCount(level));
      expect(grid.cells.length).toBe(20 * 4 ** level);
    });
  }

  it("rejects a non-integer / negative level", () => {
    expect(() => GeodesicGrid.build(-1)).toThrow();
    expect(() => GeodesicGrid.build(1.5)).toThrow();
  });

  it("the default level is a modest, legible grid (tens-to-hundreds of cells)", () => {
    const grid = GeodesicGrid.build();
    expect(grid.level).toBe(DEFAULT_GRID_LEVEL);
    expect(grid.size).toBe(cellCount(DEFAULT_GRID_LEVEL));
    expect(grid.size).toBeGreaterThanOrEqual(20);
    expect(grid.size).toBeLessThanOrEqual(1000);
  });
});

describe("GeodesicGrid — no degenerate cells", () => {
  for (const level of LEVELS) {
    it(`level ${level}: every cell has unit centre, 3 distinct unit vertices, positive area`, () => {
      const grid = GeodesicGrid.build(level);
      for (const c of grid.cells) {
        // Centre is a unit vector.
        const cl = Math.hypot(c.center[0], c.center[1], c.center[2]);
        expect(cl).toBeCloseTo(1, 12);
        // Each vertex is a unit vector.
        for (const v of c.vertices) {
          expect(Math.hypot(v[0], v[1], v[2])).toBeCloseTo(1, 12);
        }
        // Positive solid-angle area (non-degenerate triangle).
        expect(c.area).toBeGreaterThan(0);
        // lat/lon are in range and consistent with the centre.
        expect(c.latRad).toBeGreaterThanOrEqual(-Math.PI / 2 - 1e-12);
        expect(c.latRad).toBeLessThanOrEqual(Math.PI / 2 + 1e-12);
        const back = latLonToUnit(c.latRad, c.lonRad);
        expect(back[0]).toBeCloseTo(c.center[0], 10);
        expect(back[1]).toBeCloseTo(c.center[1], 10);
        expect(back[2]).toBeCloseTo(c.center[2], 10);
      }
    });
  }
});

describe("GeodesicGrid — neighbour adjacency is symmetric and degree-3", () => {
  for (const level of LEVELS) {
    it(`level ${level}: a∈N(b) ⇒ b∈N(a), exactly 3 neighbours, no self-loops`, () => {
      const grid = GeodesicGrid.build(level);
      for (const c of grid.cells) {
        // Every closed-mesh triangle has exactly three edge neighbours.
        expect(c.neighbors.length).toBe(3);
        // No cell is its own neighbour; ids are valid + unique.
        expect(c.neighbors).not.toContain(c.id);
        expect(new Set(c.neighbors).size).toBe(3);
        for (const n of c.neighbors) {
          expect(n).toBeGreaterThanOrEqual(0);
          expect(n).toBeLessThan(grid.size);
          // Symmetry.
          expect(grid.neighborsOf(n)).toContain(c.id);
        }
      }
    });
  }
});

describe("GeodesicGrid — cell areas sum to ~4π (the whole unit sphere)", () => {
  for (const level of LEVELS) {
    it(`level ${level}: Σ area ≈ 4π`, () => {
      const grid = GeodesicGrid.build(level);
      const sum = grid.cells.reduce((acc, c) => acc + c.area, 0);
      expect(sum).toBeCloseTo(4 * Math.PI, 6);
    });
  }

  it("higher levels keep cells near-uniform (max/min area ratio stays bounded)", () => {
    const grid = GeodesicGrid.build(3);
    const areas = grid.cells.map((c) => c.area);
    const max = Math.max(...areas);
    const min = Math.min(...areas);
    // Subdivided-icosahedron faces vary in size but stay within a small factor.
    expect(max / min).toBeLessThan(2);
  });
});

describe("GeodesicGrid — deterministic + pure build", () => {
  it("same level → identical cell centres, neighbours, and areas", () => {
    const a = GeodesicGrid.build(2);
    const b = GeodesicGrid.build(2);
    expect(a.size).toBe(b.size);
    for (let i = 0; i < a.size; i++) {
      expect(a.cells[i].center).toEqual(b.cells[i].center);
      expect(a.cells[i].neighbors).toEqual(b.cells[i].neighbors);
      expect(a.cells[i].area).toBe(b.cells[i].area);
    }
  });
});

describe("sphericalTriangleArea + lat/lon helpers (hand-checked)", () => {
  it("an octant (3 axis corners) is 1/8 of the sphere = π/2 sr", () => {
    const area = sphericalTriangleArea([1, 0, 0], [0, 1, 0], [0, 0, 1]);
    expect(area).toBeCloseTo(Math.PI / 2, 10);
  });

  it("a degenerate (collinear) triangle has zero area", () => {
    expect(sphericalTriangleArea([1, 0, 0], [1, 0, 0], [0, 1, 0])).toBe(0);
  });

  it("unitToLatLon ∘ latLonToUnit round-trips", () => {
    const lat = 0.3;
    const lon = -1.2;
    const u = latLonToUnit(lat, lon);
    const ll = unitToLatLon(u);
    expect(ll.latRad).toBeCloseTo(lat, 12);
    expect(ll.lonRad).toBeCloseTo(lon, 12);
  });

  it("the north pole maps to lat +90°", () => {
    const ll = unitToLatLon([0, 0, 1]);
    expect(ll.latRad).toBeCloseTo(Math.PI / 2, 12);
  });
});
