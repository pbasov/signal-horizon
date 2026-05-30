import { describe, it, expect } from "vitest";
import { orbitRenderRadius, type OrbitRenderScale } from "./orbit-render-scale";

const EARTH_R = 6.371e6;
const LEO_A = 6.771e6; // matches the LEO launch preset's semi-major axis
const MEO_A = 26.56e6;
const GEO_A = 42.164e6;
const MOON_A = 3.84e8;

// An Earth-near band wide enough to hold LEO..GEO but well inside the Moon distance,
// so the Moon ring + Earth↔Mars span fall in the identity region.
const SCALE: OrbitRenderScale = {
  surfaceM: EARTH_R,
  bandOuterM: 2.0e8,
  surfaceLiftM: 18e6,
  altExponent: 0.32,
};

describe("orbitRenderRadius — the near-body de-squash (render-only honest-lie)", () => {
  it("is identity at/below the surface (ground stations + the disc + the shell intact)", () => {
    expect(orbitRenderRadius(EARTH_R, SCALE)).toBe(EARTH_R);
    expect(orbitRenderRadius(EARTH_R * 0.5, SCALE)).toBe(EARTH_R * 0.5);
  });

  it("is identity outside the near band (Moon / Earth↔Mars / system untouched)", () => {
    expect(orbitRenderRadius(SCALE.bandOuterM, SCALE)).toBe(SCALE.bandOuterM);
    expect(orbitRenderRadius(MOON_A, SCALE)).toBe(MOON_A);
    expect(orbitRenderRadius(2.25e11, SCALE)).toBe(2.25e11); // ~1.5 AU, Earth↔Mars scale
  });

  it("lifts LEO clear of the surface (it no longer grazes the parent disc)", () => {
    const rLeo = orbitRenderRadius(LEO_A, SCALE);
    // LEO is only ~400 km up in truth; the lift puts it well above the surface visually.
    expect(rLeo).toBeGreaterThan(EARTH_R + SCALE.surfaceLiftM);
  });

  it("SEPARATES LEO from MEO from GEO — the gap the log-fold destroys", () => {
    const rLeo = orbitRenderRadius(LEO_A, SCALE);
    const rMeo = orbitRenderRadius(MEO_A, SCALE);
    const rGeo = orbitRenderRadius(GEO_A, SCALE);
    expect(rMeo).toBeGreaterThan(rLeo);
    expect(rGeo).toBeGreaterThan(rMeo);
    // A clearly visible radial gap (tens of thousands of km of visual radius), not the
    // sub-pixel the raw radii would yield.
    expect(rGeo - rLeo).toBeGreaterThan(5e7);
  });

  it("is monotonic in d (orbit ordering + the angular sweep are preserved)", () => {
    let prev = -1;
    for (let d = 1e5; d <= 2 * SCALE.bandOuterM; d += SCALE.bandOuterM / 80) {
      const r = orbitRenderRadius(d, SCALE);
      expect(r).toBeGreaterThanOrEqual(prev);
      prev = r;
    }
  });

  it("is continuous at the band edge (no pop as a sat or the camera crosses it)", () => {
    const inside = orbitRenderRadius(SCALE.bandOuterM - 1, SCALE);
    const outside = orbitRenderRadius(SCALE.bandOuterM + 1, SCALE);
    expect(Math.abs(outside - inside)).toBeLessThan(50); // joins the identity region cleanly
  });

  it("clamps degenerate input (zero / negative distance → 0)", () => {
    expect(orbitRenderRadius(0, SCALE)).toBe(0);
    expect(orbitRenderRadius(-5, SCALE)).toBe(0);
  });
});
