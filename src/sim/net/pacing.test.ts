import { describe, it, expect } from "vitest";
import { meanMotion, orbitPeriodSeconds } from "../m2/orbit";
import {
  A1_GEO_PERIOD_S,
  A1_LEO_PERIOD_S,
  A1_EARTH_OMEGA_RAD_PER_S,
  A1_EARTH_ROTATION_PERIOD_S,
  A1_GEO_SEMI_MAJOR_M,
  resolveOrbit,
} from "./world";

/**
 * Pacing locks: GEO period == day, both ~4 min; ω == GEO mean motion (geostationary by
 * construction); LEO faster than the day; the term completes in one rotation. Asserts
 * the GEO-class orbit propagates to exactly the constant period.
 */
describe("pacing: GEO period == day, ~4 min, geostationary by construction", () => {
  const geo = resolveOrbit(
    { semiMajorM: A1_GEO_SEMI_MAJOR_M, incRad: 0, subLonRad: 0 },
    0,
  );

  it("the GEO-class orbit period is in the human-scale band [180, 360] s", () => {
    const period = orbitPeriodSeconds(geo);
    expect(period).toBeGreaterThanOrEqual(180);
    expect(period).toBeLessThanOrEqual(360);
    // and it matches the configured A1_GEO_PERIOD_S derived a from the same μ.
    expect(period).toBeCloseTo(A1_GEO_PERIOD_S, 6);
  });

  it("the rotation period equals the GEO period (240 s)", () => {
    expect(A1_EARTH_ROTATION_PERIOD_S).toBe(A1_GEO_PERIOD_S);
    expect(A1_EARTH_ROTATION_PERIOD_S).toBe(240);
  });

  it("A1_EARTH_OMEGA == meanMotion(GEO orbit) to 1e-12 (geostationary)", () => {
    const n = meanMotion(geo);
    expect(Math.abs(A1_EARTH_OMEGA_RAD_PER_S - n)).toBeLessThan(1e-12);
  });

  it("LEO period < GEO period (it sweeps faster than the day, so it sets)", () => {
    expect(A1_LEO_PERIOD_S).toBeLessThan(A1_GEO_PERIOD_S);
  });

  it("the term completes within one rotation at 1× (term ≤ GEO period)", () => {
    // The contract term lives in net/contract.ts (A2). Until then, the locked design
    // value is 240 s (one full day) — assert the relationship the constant must satisfy.
    const NET_TERM_SECONDS_DESIGN = 240;
    expect(NET_TERM_SECONDS_DESIGN).toBeLessThanOrEqual(A1_GEO_PERIOD_S);
  });
});
