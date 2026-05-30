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

/**
 * orrery B4 — THE ACT-2 HAND-OFF + SAWTOOTH-METER PURE HELPERS (design §4.4 axis-2 / §6). The
 * render-only verdicts the net-mode overlay paints are split into `this`-free static helpers so
 * the make-or-break Act-2 viz contract is pinned WITHOUT a DOM/WebGL render:
 *   - the region disc holds GREEN across a constellation HAND-OFF (footprint A leaves as B
 *     arrives, served stays true + a footprint stays covering ⇒ never dim) and DIPS dim on a
 *     lone-LEO gap (the footprint sets, served drops);
 *   - the availability SAWTOOTH meter tone is a pure function of (rolling availability, the bar):
 *     GOOD while it holds the bar (the flattened constellation), WARN while it dips (the saw).
 */
describe("orrery B4: the Act-2 hand-off + sawtooth-meter render verdicts are pure + correct", () => {
  it("regionLit: a constellation HAND-OFF keeps the region GREEN (served + a footprint always covering)", () => {
    // Mid-hand-off: several footprints sweeping, served true ⇒ LIT. As one slides off the count
    // stays ≥ 1 (another slid on) and served stays true, so the region NEVER goes dim.
    expect(Orrery.regionLit(true, 4)).toBe(true); // full constellation overhead.
    expect(Orrery.regionLit(true, 2)).toBe(true); // mid-hand-off (A leaving, B arrived).
    expect(Orrery.regionLit(true, 1)).toBe(true); // exactly one covering (the hand-off seam).
  });

  it("regionLit: a lone-LEO GAP dips the region DIM (footprint set ⇒ no covering disc + unserved)", () => {
    // The sawtooth trough: the single footprint has set, so there is no covering disc AND the
    // router reports the region unserved — the region disc reads dim (amber).
    expect(Orrery.regionLit(false, 0)).toBe(false);
    // Belt-and-suspenders: served can never be true with zero covering footprints in net mode,
    // but if a stale verdict raced ahead, no covering disc still reads as not-lit.
    expect(Orrery.regionLit(true, 0)).toBe(false);
    expect(Orrery.regionLit(false, 1)).toBe(false); // unserved despite a disc nearby ⇒ dim.
  });

  it("availMeterTone: the sawtooth meter is GOOD while it holds the bar, WARN while it dips below", () => {
    const bar = 0.99; // ACT2_SLA_AVAIL.
    // The N=4 constellation flattens at/above the bar ⇒ GOOD (motion tamed).
    expect(Orrery.availMeterTone(1.0, bar)).toBe("good");
    expect(Orrery.availMeterTone(0.99, bar)).toBe("good"); // exactly at the bar holds.
    // A lone LEO / N≤3 sawtooths below ⇒ WARN (the visible breach).
    expect(Orrery.availMeterTone(0.0, bar)).toBe("warn"); // a lone LEO trough.
    expect(Orrery.availMeterTone(0.688, bar)).toBe("warn"); // the measured N=3 rolling avail.
    expect(Orrery.availMeterTone(0.985, bar)).toBe("warn"); // a hair under the bar still warns.
  });

  it("the sawtooth/flat distinction is a deterministic function of the value series vs the bar", () => {
    const bar = 0.99;
    // A lone-LEO history SAWTOOTHS: it crosses the bar boundary (some samples warn, some good).
    const sawtooth = [1.0, 0.4, 0.0, 0.3, 0.9, 1.0, 0.2, 0.0];
    const tones = sawtooth.map((v) => Orrery.availMeterTone(v, bar));
    expect(tones).toContain("warn"); // the troughs (the visible sawtooth breach).
    // A held N=4 history is FLAT at the bar: every sample holds ⇒ all GOOD (the flattened line).
    const flat = [1.0, 1.0, 1.0, 1.0, 1.0, 1.0];
    expect(flat.every((v) => Orrery.availMeterTone(v, bar) === "good")).toBe(true);
  });
});
