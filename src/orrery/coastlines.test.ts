import { describe, expect, it } from "vitest";

import {
  COASTLINES,
  COASTLINE_POLYLINE_COUNT,
  COASTLINE_VERTEX_COUNT,
} from "./coastlines";

describe("COASTLINES", () => {
  it("is a non-empty set of polylines", () => {
    expect(COASTLINES.length).toBeGreaterThan(0);
  });

  it("gives every polyline at least 2 points", () => {
    for (const line of COASTLINES) {
      expect(line.length).toBeGreaterThanOrEqual(2);
    }
  });

  it("keeps every coordinate within valid lon/lat bounds", () => {
    for (const line of COASTLINES) {
      for (const [lon, lat] of line) {
        expect(Number.isFinite(lon)).toBe(true);
        expect(Number.isFinite(lat)).toBe(true);
        expect(lon).toBeGreaterThanOrEqual(-180);
        expect(lon).toBeLessThanOrEqual(180);
        expect(lat).toBeGreaterThanOrEqual(-90);
        expect(lat).toBeLessThanOrEqual(90);
      }
    }
  });

  it("exposes count helpers that agree with the data", () => {
    expect(COASTLINE_POLYLINE_COUNT).toBe(COASTLINES.length);
    const vertices = COASTLINES.reduce((sum, line) => sum + line.length, 0);
    expect(COASTLINE_VERTEX_COUNT).toBe(vertices);
  });
});
