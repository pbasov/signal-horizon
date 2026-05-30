import { describe, it, expect } from "vitest";
import { GeodesicGrid } from "./grid";
import { DemandField, demandOf, latitudeBandWeight, hotspotWeight } from "./demand";

/**
 * Pins for the procedural placeholder demand field (M2a, §4.2: "each cell has
 * demand"). The contract is: non-negative everywhere, deterministic (fixed
 * constants, no RNG), and gradient-bearing (high near the pinned hotspots / the
 * inhabited latitude band, low at the poles) so coverage MATTERS.
 */

describe("DemandField — non-negative and deterministic", () => {
  it("every cell weight is finite and ≥ 0", () => {
    const grid = GeodesicGrid.build(2);
    const field = DemandField.build(grid);
    expect(field.weight.length).toBe(grid.size);
    for (const w of field.weight) {
      expect(Number.isFinite(w)).toBe(true);
      expect(w).toBeGreaterThanOrEqual(0);
    }
  });

  it("the total is the sum of cell weights and is positive", () => {
    const grid = GeodesicGrid.build(2);
    const field = DemandField.build(grid);
    const sum = field.weight.reduce((a, w) => a + w, 0);
    expect(field.total).toBeCloseTo(sum, 9);
    expect(field.total).toBeGreaterThan(0);
  });

  it("is byte-identical across rebuilds (no RNG, fixed constants)", () => {
    const grid = GeodesicGrid.build(2);
    const a = DemandField.build(grid);
    const b = DemandField.build(grid);
    expect(a.weight).toEqual(b.weight);
    expect(a.total).toBe(b.total);
  });

  it("of(id) returns the cell's weight", () => {
    const grid = GeodesicGrid.build(2);
    const field = DemandField.build(grid);
    expect(field.of(0)).toBe(field.weight[0]);
    expect(field.of(grid.size - 1)).toBe(field.weight[grid.size - 1]);
  });
});

describe("demand components carry a legible gradient (placeholder shape)", () => {
  it("the latitude band peaks in the northern mid-latitudes and tapers to the poles", () => {
    const mid = latitudeBandWeight(40 * (Math.PI / 180));
    const northPole = latitudeBandWeight(Math.PI / 2);
    const southPole = latitudeBandWeight(-Math.PI / 2);
    expect(mid).toBeGreaterThan(northPole);
    expect(mid).toBeGreaterThan(southPole);
    expect(northPole).toBeGreaterThanOrEqual(0);
    expect(southPole).toBeGreaterThanOrEqual(0);
  });

  it("hotspot weight is highest at a hotspot centre and falls off with angle", () => {
    const DEG = Math.PI / 180;
    const eastAsia: [number, number, number] = [
      Math.cos(35 * DEG) * Math.cos(120 * DEG),
      Math.cos(35 * DEG) * Math.sin(120 * DEG),
      Math.sin(35 * DEG),
    ];
    const antipode: [number, number, number] = [-eastAsia[0], -eastAsia[1], -eastAsia[2]];
    expect(hotspotWeight(eastAsia)).toBeGreaterThan(hotspotWeight(antipode));
    expect(hotspotWeight(antipode)).toBeGreaterThanOrEqual(0);
  });

  it("a high-demand cell really outweighs a sparse one (coverage matters)", () => {
    const grid = GeodesicGrid.build(3);
    const weights = grid.cells.map(demandOf);
    const max = Math.max(...weights);
    const min = Math.min(...weights);
    // The hotspots/latitude band create a real spread, not a flat field.
    expect(max).toBeGreaterThan(min * 3);
  });
});
