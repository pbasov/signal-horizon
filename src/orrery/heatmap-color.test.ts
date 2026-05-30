import { describe, it, expect } from "vitest";
import {
  type CellCoverageLike,
  type CoverageDimension,
  coverageCellColor,
  coverageWarmth,
  dimensionLabel,
  DIMENSION_CYCLE,
  UNCOVERED_OPACITY,
  COVERED_MIN_OPACITY,
  COVERED_MAX_OPACITY,
} from "./heatmap-color";

/**
 * M2b — the PURE coverage→colour mapping for the heatmap shell. No three/DOM, so
 * it is pinned here in isolation: the per-dimension warmth ramps, the CVD-safe
 * redundant brightness/opacity encoding, and the uncovered = dark/faint hole.
 */

const cov = (over: Partial<CellCoverageLike> = {}): CellCoverageLike => ({
  connectivity: 1,
  bandwidth: 2,
  latencyS: 0.05,
  ...over,
});

const brightness = (c: { r: number; g: number; b: number }) => c.r + c.g + c.b;

describe("dimension metadata", () => {
  it("cycles connectivity → bandwidth → latency", () => {
    expect(DIMENSION_CYCLE).toEqual(["connectivity", "bandwidth", "latency"]);
  });
  it("labels each dimension", () => {
    expect(dimensionLabel("connectivity")).toBe("CONNECTIVITY");
    expect(dimensionLabel("bandwidth")).toBe("BANDWIDTH");
    expect(dimensionLabel("latency")).toBe("LATENCY");
  });
});

describe("coverageWarmth", () => {
  const dims: CoverageDimension[] = ["connectivity", "bandwidth", "latency"];

  it("is 0 for an uncovered cell on every dimension", () => {
    const uncovered = cov({ connectivity: 0, bandwidth: 0, latencyS: Infinity });
    for (const d of dims) expect(coverageWarmth(uncovered, d)).toBe(0);
  });

  it("connectivity warmth rises with covering-asset count, clamped to 1", () => {
    expect(coverageWarmth(cov({ connectivity: 1 }), "connectivity")).toBeCloseTo(1 / 3, 5);
    expect(coverageWarmth(cov({ connectivity: 3 }), "connectivity")).toBe(1);
    expect(coverageWarmth(cov({ connectivity: 9 }), "connectivity")).toBe(1);
  });

  it("bandwidth warmth rises with summed capacity, clamped to 1", () => {
    expect(coverageWarmth(cov({ bandwidth: 0.6 }), "bandwidth")).toBeCloseTo(0.1, 5);
    expect(coverageWarmth(cov({ bandwidth: 6 }), "bandwidth")).toBe(1);
    expect(coverageWarmth(cov({ bandwidth: 100 }), "bandwidth")).toBe(1);
  });

  it("latency warmth is INVERTED — lower latency is hotter", () => {
    const near = coverageWarmth(cov({ latencyS: 0.002 }), "latency");
    const mid = coverageWarmth(cov({ latencyS: 0.05 }), "latency");
    const far = coverageWarmth(cov({ latencyS: 0.2 }), "latency");
    expect(near).toBe(1); // ≤ hot threshold ⇒ full warmth.
    expect(far).toBe(0); // ≥ cold threshold ⇒ no warmth.
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(1);
    expect(near).toBeGreaterThan(mid);
    expect(mid).toBeGreaterThan(far);
  });
});

describe("coverageCellColor — CVD-safe redundant encoding", () => {
  it("an uncovered cell is dark AND faint (a hole in the web)", () => {
    const c = coverageCellColor(cov({ connectivity: 0, bandwidth: 0, latencyS: Infinity }), "connectivity");
    expect(c.a).toBeCloseTo(UNCOVERED_OPACITY, 6);
    // Much darker + fainter than any covered cell.
    const covered = coverageCellColor(cov({ connectivity: 1 }), "connectivity");
    expect(c.a).toBeLessThan(covered.a);
    expect(brightness(c)).toBeLessThan(brightness(covered));
  });

  it("a covered cell's opacity ramps with warmth between the covered bounds", () => {
    const cold = coverageCellColor(cov({ connectivity: 1, bandwidth: 0.01 }), "bandwidth");
    const hot = coverageCellColor(cov({ connectivity: 3, bandwidth: 100 }), "bandwidth");
    expect(cold.a).toBeGreaterThanOrEqual(COVERED_MIN_OPACITY - 1e-6);
    expect(hot.a).toBeCloseTo(COVERED_MAX_OPACITY, 6);
    expect(hot.a).toBeGreaterThan(cold.a);
  });

  it("brightness AND opacity BOTH rise with warmth (the redundant channels)", () => {
    const lo = coverageCellColor(cov({ connectivity: 1 }), "connectivity"); // warmth 1/3
    const hi = coverageCellColor(cov({ connectivity: 3 }), "connectivity"); // warmth 1
    expect(brightness(hi)).toBeGreaterThan(brightness(lo));
    expect(hi.a).toBeGreaterThan(lo.a);
  });

  it("each dimension paints a distinct hue at full warmth", () => {
    const conn = coverageCellColor(cov({ connectivity: 5 }), "connectivity"); // cyan
    const band = coverageCellColor(cov({ connectivity: 5, bandwidth: 100 }), "bandwidth"); // green
    const lat = coverageCellColor(cov({ connectivity: 5, latencyS: 0.001 }), "latency"); // amber
    // cyan: green+blue dominate red; green: green dominates; amber: red dominates blue.
    expect(conn.b).toBeGreaterThan(conn.r);
    expect(band.g).toBeGreaterThan(band.r);
    expect(lat.r).toBeGreaterThan(lat.b);
  });

  it("channels stay within [0,1]", () => {
    for (const d of ["connectivity", "bandwidth", "latency"] as CoverageDimension[]) {
      const c = coverageCellColor(cov({ connectivity: 9, bandwidth: 999, latencyS: 0.0001 }), d);
      for (const v of [c.r, c.g, c.b, c.a]) {
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThanOrEqual(1);
      }
    }
  });
});
