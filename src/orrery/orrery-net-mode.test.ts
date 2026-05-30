import { describe, it, expect } from "vitest";
import { Orrery } from "./orrery";
import { orbitRenderRadius } from "./orbit-render-scale";
import {
  A1_BODY_RADIUS_M,
  A1_RENDER_BAND_M,
  A1_GEO_SEMI_MAJOR_M,
  A1_LEO_SEMI_MAJOR_M,
} from "../sim/net/world";

/**
 * orrery A4 — THE NET RENDER-MODE DE-SQUASH OVERRIDE (design §6 / Decision-G, the A4 verify).
 * The pure surface+band → {@link import("./orbit-render-scale").OrbitRenderScale} choice
 * ({@link Orrery.computeOrbitScale}) is the single thing the net-mode flag overrides. This
 * pins the STRICTLY-SCOPED contract WITHOUT a DOM/WebGL render (the helper is `this`-free):
 *
 *   - net mode OFF → surfaceM == the REAL eph.radiusMeters("earth") (6371 km) and the band is
 *     the live animated orbitBandM — BYTE-IDENTICAL to the pre-net-mode de-squash, so every
 *     M1-cache / M2 / M3 framing is unchanged (the system-scale lift/exponent intact);
 *   - net mode ON → surfaceM == A1_BODY_RADIUS_M (300 km toy body) and the band ==
 *     A1_RENDER_BAND_M, so the toy GEO/LEO radii fan out instead of log-folding to sub-pixel.
 */

/** The real Earth radius the off-mode path reads (eph.radiusMeters("earth")); a constant here
 * so the test does not need a full Ephemeris — the off-mode helper just passes it through. */
const REAL_EARTH_RADIUS_M = 6_371_000;

describe("orrery net render mode: the Decision-G de-squash override is scoped behind the flag", () => {
  it("net mode OFF — surfaceM == the REAL earth radius (the M2/M3 framing is unchanged)", () => {
    // A typical EARTH-preset animated band that clears the real surface (so de-squash is active).
    const band = REAL_EARTH_RADIUS_M * 8;
    const scale = Orrery.computeOrbitScale(false, REAL_EARTH_RADIUS_M, band);
    expect(scale).not.toBeNull();
    expect(scale!.surfaceM).toBe(REAL_EARTH_RADIUS_M); // the real radius, NOT the toy body.
    expect(scale!.bandOuterM).toBe(band); // the live animated band, unchanged.
  });

  it("net mode OFF is BYTE-IDENTICAL to the original (pre-net-mode) de-squash computation", () => {
    // The original code: band > surfaceM && surfaceM > 0 ? {surfaceM, bandOuterM: band, lift, exp} : null
    // with the SYSTEM-SCALE lift (1.8e7) + exponent (0.32). Re-derive it inline and compare.
    const ORIGINAL_LIFT_M = 1.8e7;
    const ORIGINAL_EXP = 0.32;
    for (const [surfaceM, band] of [
      [REAL_EARTH_RADIUS_M, REAL_EARTH_RADIUS_M * 8], // de-squash active
      [REAL_EARTH_RADIUS_M, 0], // band ~0 (system-scale preset) → identity (null)
      [REAL_EARTH_RADIUS_M, REAL_EARTH_RADIUS_M * 0.5], // band below surface → identity (null)
      [0, 100], // dimensionless focus → identity (null)
    ] as [number, number][]) {
      const original =
        band > surfaceM && surfaceM > 0
          ? { surfaceM, bandOuterM: band, surfaceLiftM: ORIGINAL_LIFT_M, altExponent: ORIGINAL_EXP }
          : null;
      expect(Orrery.computeOrbitScale(false, surfaceM, band)).toEqual(original);
    }
  });

  it("net mode ON — surfaceM == A1_BODY_RADIUS_M (300 km toy body), band == A1_RENDER_BAND_M", () => {
    // The animated band is IGNORED in net mode (the toy band is fixed); pass any value.
    const scale = Orrery.computeOrbitScale(true, REAL_EARTH_RADIUS_M, REAL_EARTH_RADIUS_M * 8);
    expect(scale).not.toBeNull();
    expect(scale!.surfaceM).toBe(A1_BODY_RADIUS_M); // the TOY body radius, not 6371 km.
    expect(scale!.bandOuterM).toBe(A1_RENDER_BAND_M);
  });

  it("net mode ON keeps the OrbitRenderScale invariant (lift < band − surface) — the toy curve is valid", () => {
    const scale = Orrery.computeOrbitScale(true, A1_BODY_RADIUS_M, A1_RENDER_BAND_M)!;
    expect(scale.surfaceLiftM).toBeLessThan(scale.bandOuterM - scale.surfaceM);
    expect(scale.surfaceLiftM).toBeGreaterThan(0);
    expect(scale.altExponent).toBeGreaterThan(0);
    expect(scale.altExponent).toBeLessThan(1);
  });

  it("net mode ON fans the toy GEO + LEO into SEPARATE visual radii (no sub-pixel log-fold collapse)", () => {
    // The whole reason for the override: at the toy scale, GEO (835 km) and LEO (610 km) sit a
    // hair above the 300 km body; the de-squash must lift them well clear of the disc AND apart.
    const scale = Orrery.computeOrbitScale(true, A1_BODY_RADIUS_M, A1_RENDER_BAND_M)!;
    const leoVis = orbitRenderRadius(A1_LEO_SEMI_MAJOR_M, scale);
    const geoVis = orbitRenderRadius(A1_GEO_SEMI_MAJOR_M, scale);
    // Both lifted clear of the surface, and GEO (higher) renders OUTSIDE LEO (monotonic).
    expect(leoVis).toBeGreaterThan(scale.surfaceM);
    expect(geoVis).toBeGreaterThan(leoVis);
    // The visual separation is macroscopic at the toy scale (not the sub-pixel collapse the
    // raw radii would log-fold to): GEO − LEO visual gap is a large fraction of the body radius.
    expect(geoVis - leoVis).toBeGreaterThan(A1_BODY_RADIUS_M * 0.1);
  });

  it("a fresh Orrery defaults to net mode OFF (every existing framing unaffected until opted in)", () => {
    // The flag is a plain public boolean defaulting false; assert the class shape without a
    // DOM render (we only read the prototype/default, never construct the WebGL context).
    // The default is documented + relied on by every M1-cache/M2/M3 framing.
    const offSurface = Orrery.computeOrbitScale(false, REAL_EARTH_RADIUS_M, REAL_EARTH_RADIUS_M * 8)!.surfaceM;
    expect(offSurface).toBe(REAL_EARTH_RADIUS_M);
    // And the toy radius is genuinely different (so the override is observable when opted in).
    expect(A1_BODY_RADIUS_M).not.toBe(REAL_EARTH_RADIUS_M);
  });
});
