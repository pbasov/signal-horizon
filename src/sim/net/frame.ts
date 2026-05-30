/**
 * net/ — the spinning-Earth rotation frame (Decision A; the heart of the connectivity
 * game's geometry). Migrated UNCHANGED from a1/frame-a1.ts (re-pointing the world import).
 *
 * The single home of the spin convention. PURE scalar/vector helpers — no three, no
 * DOM, no wall-clock, no RNG. This file does NOT import `solveOrbit` and does NOT touch
 * orbit propagation: propagation stays inertial and unforked. Rotation affects exactly
 * two things — the inertial↔body-fixed mapping of SURFACE points (here) and the render
 * of the surface (orrery, scoped to net mode).
 *
 * Convention (LOCKED, pinned by frame.test.ts):
 *   - Earth spins about the +Z axis (ecliptic north — the axis solveOrbit uses for z;
 *     the ephemeris is obliquity-free so +Z matches an inc=0 orbit normal).
 *   - θ(t) = θ0 + ω·(t − t0), with t0 = 0, θ0 = 0, ω = +A1_EARTH_OMEGA_RAD_PER_S
 *     (positive = prograde / counter-clockwise viewed from +Z). This sign matches the
 *     equatorial sub-longitude advance (+n·t), so a GEO with the same sense parks.
 *   - Rz(θ)·[x,y,z] = [x·cosθ − y·sinθ, x·sinθ + y·cosθ, z]  (right-handed about +Z).
 *
 * @see docs/signal-horizon-m1-design.md §2.1 (frame), §5 (Act-1 slice).
 */

import type { Vec3 } from "../ephemeris";
import { A1_EARTH_OMEGA_RAD_PER_S } from "./world";

/** Body-fixed surface unit direction for (lat,lon) — the SAME convention roster.ts /
 * field.ts use: [cosLat·cosLon, cosLat·sinLon, sinLat]. The spin is an added Rz. */
function latLonToUnit(latRad: number, lonRad: number): Vec3 {
  const cl = Math.cos(latRad);
  return [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
}

/** Earth spin angle at sim-time t: θ(t) = ω·t (θ0 = 0, t0 = 0). */
export function earthThetaAt(t: number): number {
  return A1_EARTH_OMEGA_RAD_PER_S * t;
}

/** Rotate a vector by θ about +Z (prograde): [x·cosθ − y·sinθ, x·sinθ + y·cosθ, z]. */
export function rotZ(v: Vec3, theta: number): Vec3 {
  const c = Math.cos(theta);
  const s = Math.sin(theta);
  return [v[0] * c - v[1] * s, v[0] * s + v[1] * c, v[2]];
}

/** Body-fixed (lat,lon) → inertial UNIT direction at sim-time t: Rz(θ(t))·u(lat,lon). */
export function bodyFixedToInertialDir(latRad: number, lonRad: number, t: number): Vec3 {
  return rotZ(latLonToUnit(latRad, lonRad), earthThetaAt(t));
}

/** Inertial direction → body-fixed at sim-time t: Rz(−θ(t))·v. Inverse of the above. */
export function inertialDirToBodyFixed(v: Vec3, t: number): Vec3 {
  return rotZ(v, -earthThetaAt(t));
}

/**
 * World position (metres) of a body-fixed surface point at sim-time t:
 *   bodyCenter + bodyRadiusM · Rz(θ(t)) · u(lat,lon).
 * The link-budget check and the render both use this so the region/ground ride θ(t).
 */
export function surfacePointInertial(
  latRad: number,
  lonRad: number,
  t: number,
  bodyCenter: Vec3,
  bodyRadiusM: number,
): Vec3 {
  const d = bodyFixedToInertialDir(latRad, lonRad, t);
  return [
    bodyCenter[0] + d[0] * bodyRadiusM,
    bodyCenter[1] + d[1] * bodyRadiusM,
    bodyCenter[2] + d[2] * bodyRadiusM,
  ];
}
