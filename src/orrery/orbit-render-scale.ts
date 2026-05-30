/**
 * THE NEAR-BODY ORBIT-RENDER DE-SQUASH (a documented honest-lie, render-only).
 *
 * SD-5's per-preset radial LOG-FOLD (orrery.compressScale) is great for fitting the
 * whole Earth↔Mars span into one shot, but it CRUSHES near-Earth orbits onto the
 * parent: a LEO sat at a ≈ 6 771 km sits at ≈ 1.06× Earth's radius, and the log-fold
 * maps that tiny radial gap to a sub-pixel separation — so the sat reads as a frozen
 * dot stuck to the Earth billboard, even though it IS orbiting (the angular motion is
 * real). The maintainer's "satellites are static / not moving at all" is exactly this:
 * the motion is there, but invisible on the view the player looks at.
 *
 * This module is the fix: a PURE radial remap that LIFTS near-body orbits OFF the parent
 * surface so they separate from the disc and from each other, and so an orbiting sat
 * visibly sweeps as the clock advances. Like the log-fold it is a VISUAL LIE on the
 * rendered RADIUS ONLY:
 *   - it preserves the ANGULAR direction exactly (it scales the radial magnitude, never
 *     the direction), so the orbit's shape + the sat's true angular position are honest;
 *   - it NEVER feeds coverage / link / light-delay math — those run on the true f64
 *     metres in src/sim (this lives in src/orrery, the only f64→f32 site).
 *
 * THE REMAP — deliberately surface-preserving + monotonic. At/below the surface it is
 * IDENTITY, so ground stations, the body billboard, and the coverage shell render
 * EXACTLY where they do today (no regression there). ABOVE the surface, inside the near
 * band, the true altitude `a ∈ [0, A]` (A = band − surface) maps to a CONCAVE visual
 * altitude `lift + (A − lift)·(a/A)^p` with `p < 1`: it expands small altitudes hard
 * (lifting LEO well clear of the disc) while still rising monotonically all the way to
 * the band edge, where it equals `A` so it joins the identity region continuously. The
 * concave curve fans LEO (≈ 400 km up), MEO, and GEO (≈ 35 800 km up) into clearly
 * separate visual radii even though all three are a hair above the surface in absolute
 * terms — exactly the separation the log-fold destroys. Outside the band
 * (`d >= bandOuterM`) it is identity, so the Moon ring, Earth↔Mars, and the whole-system
 * view are completely untouched.
 */

/**
 * Tunables for the near-body de-squash. A point's TRUE focus-relative distance `d`
 * (metres) is remapped only when it is ABOVE the surface and inside the near band
 * (`surfaceM < d < bandOuterM`). Below the surface and beyond the band it is identity.
 */
export interface OrbitRenderScale {
  /** The focus body's true radius (metres) — identity at/below this (ground/shell intact). */
  surfaceM: number;
  /** Outer edge of the near-body band (metres). Beyond this the remap is identity, so
   * the Moon / Earth↔Mars / the system view are completely untouched. */
  bandOuterM: number;
  /** A fixed visual altitude (metres) the surface shell is lifted by, so even the lowest
   * orbit (LEO) clears the parent disc rather than grazing it. Must be < (bandOuter − surface). */
  surfaceLiftM: number;
  /** Concavity exponent (0 < p < 1) of the altitude curve: smaller ⇒ near-surface orbits
   * fan out harder. The curve stays monotonic + hits the band edge exactly, so it is
   * continuous with the identity region beyond. */
  altExponent: number;
}

/**
 * Remap a TRUE focus-relative distance `d` (metres) to a VISUAL radius (metres) that
 * lifts near-body orbits off the surface, BEFORE the existing log-fold runs. Pure +
 * strictly monotonic in `d` (orbit ordering + the angular sweep are preserved):
 *   - identity for `d <= surfaceM` (ground stations + the body disc + the shell intact);
 *   - identity for `d >= bandOuterM` (the system-scale view is untouched);
 *   - inside the band, above the surface, the concave altitude curve lifts + fans the
 *     orbits, hitting the band edge exactly so it joins the identity region continuously.
 * The direction is the caller's concern — this only scales the radial magnitude.
 */
export function orbitRenderRadius(d: number, s: OrbitRenderScale): number {
  if (d <= 0) return 0;
  if (d <= s.surfaceM) return d; // identity at/below the surface — ground + shell unchanged.
  if (d >= s.bandOuterM) return d; // identity outside the near band — system scale intact.
  const A = s.bandOuterM - s.surfaceM; // the true altitude span the band covers.
  const a = d - s.surfaceM; // this point's true altitude above the surface.
  // Concave map: lift the shell by surfaceLiftM, then spread the remaining visual span
  // (A − lift) by (a/A)^p. At a==0 → surface+lift; at a==A → surface+A == bandOuterM
  // (so it is continuous with the identity region beyond). Monotonic for p > 0.
  const visualAlt = s.surfaceLiftM + (A - s.surfaceLiftM) * Math.pow(a / A, s.altExponent);
  return s.surfaceM + visualAlt;
}
