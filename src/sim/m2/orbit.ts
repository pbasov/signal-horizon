/**
 * M2c — PURE Keplerian propagation for a LAUNCHED sat's parametric orbit.
 *
 * A launched sat is created at runtime (not in data/system.json), so it cannot be
 * read through `Ephemeris.position(id, t)`. This module propagates a {@link SatOrbit}
 * to a position RELATIVE TO ITS PARENT at sim-time t, using the SAME algorithm the
 * ephemeris uses for a dataset body:
 *   - mean motion n = sqrt(muParent / a³),
 *   - mean anomaly M(t) = wrapPi(m0 + n·(t − epoch)),
 *   - the FIXED 8-iteration Newton solve for E (identical control flow → determinism),
 *   - the 3-1-3 (raan, inc, argp) perifocal → ecliptic rotation.
 *
 * Keeping it a small pure function (no Ephemeris mutation, no three/DOM/wall-clock/
 * RNG) means a launched sat is exactly as deterministic + snapshot-friendly as a
 * dataset body, and the orbital golden is untouched (nothing here is added to the
 * shared ephemeris). The roster adds the parent's ephemeris position to get the
 * world position the coverage field scores.
 */

import type { Vec3 } from "../ephemeris";
import { KEPLER_ITERS } from "../ephemeris";
import type { SatOrbit } from "./roster";

const TAU = Math.PI * 2;

/** Wrap an angle into [-π, π] — fmod semantics (JS `%`), mirroring Ephemeris.wrapPi. */
function wrapPi(angle: number): number {
  let x = (angle + Math.PI) % TAU;
  if (x < 0.0) x += TAU;
  return x - Math.PI;
}

/** Eccentric anomaly from mean anomaly via the fixed-iteration Newton solve (the
 * ephemeris's exact control flow, so a launched sat propagates identically). */
function solveEccentricAnomaly(meanAnom: number, e: number): number {
  let ecc = meanAnom + e * Math.sin(meanAnom);
  for (let i = 0; i < KEPLER_ITERS; i++) {
    const f = ecc - e * Math.sin(ecc) - meanAnom;
    const fp = 1.0 - e * Math.cos(ecc);
    ecc -= f / fp;
  }
  return ecc;
}

/** Mean motion (rad/s) for an orbit: sqrt(muParent / a³); 0 for a degenerate orbit. */
export function meanMotion(orbit: SatOrbit): number {
  if (orbit.aM > 0 && orbit.muParent > 0) {
    return Math.sqrt(orbit.muParent / (orbit.aM * orbit.aM * orbit.aM));
  }
  return 0;
}

/** Orbital period (seconds) of a launched orbit; 0 for a degenerate orbit. */
export function orbitPeriodSeconds(orbit: SatOrbit): number {
  const n = meanMotion(orbit);
  return n > 0 ? TAU / n : 0;
}

/**
 * Position of a launched sat RELATIVE TO ITS PARENT at sim-time t (metres),
 * heliocentric-ecliptic axes (same frame as the ephemeris's relative positions).
 * Pure function of (orbit, t). The caller adds the parent's ephemeris position.
 */
export function solveOrbit(orbit: SatOrbit, t: number): Vec3 {
  const n = meanMotion(orbit);
  const meanAnom = wrapPi(orbit.m0Rad + n * (t - orbit.epochS));
  const ecc = solveEccentricAnomaly(meanAnom, orbit.e);
  const cosE = Math.cos(ecc);
  const sinE = Math.sin(ecc);
  const nu = Math.atan2(Math.sqrt(1.0 - orbit.e * orbit.e) * sinE, cosE - orbit.e);
  const r = orbit.aM * (1.0 - orbit.e * cosE);
  const xOrb = r * Math.cos(nu);
  const yOrb = r * Math.sin(nu);
  // 3-1-3 (raan, inc, argp) perifocal → ecliptic, identical to Ephemeris.rotatePerifocal.
  const cO = Math.cos(orbit.raanRad);
  const sO = Math.sin(orbit.raanRad);
  const ci = Math.cos(orbit.incRad);
  const si = Math.sin(orbit.incRad);
  const cw = Math.cos(orbit.argpRad);
  const sw = Math.sin(orbit.argpRad);
  const x = (cO * cw - sO * sw * ci) * xOrb + (-cO * sw - sO * cw * ci) * yOrb;
  const y = (sO * cw + cO * sw * ci) * xOrb + (-sO * sw + cO * cw * ci) * yOrb;
  const z = sw * si * xOrb + cw * si * yOrb;
  return [x, y, z];
}
