/**
 * THE RING MODEL — who is actually on the orbit you are aiming into, and where the hole is.
 *
 * Pure: orbits in, ring state out. No DOM, no three, no wall-clock. It lives apart from the
 * widget that draws it (pad-instruments.ts) so the arithmetic that decides "there is a 120°
 * hole at 80°" can be tested directly — this readout is a claim about the live fleet, and a
 * claim about live state has to be checkable.
 *
 * WHAT COUNTS AS "THE SAME RING". A satellite shares your ring only if it shares your ORBITAL
 * PLANE and your altitude: same semi-major axis, same inclination, AND the same RAAN. That
 * last one is not a detail — two satellites at identical altitude and tilt but different RAAN
 * fly in different planes that merely cross, and treating them as one ring reports a hole that
 * is not there and hides one that is.
 *
 * WHAT "PHASE" MEANS. For the circular orbits the planner flies (e = 0, argp = 0) the position
 * along the ring is the argument of latitude — the mean anomaly propagated to now:
 *
 *     phase(t) = m0 + n · (t − epoch)
 *
 * Two satellites' phases are only comparable when they share a plane, which is exactly what
 * the plane match guarantees. Angles are normalised to [0, 360).
 */

import type { SatOrbit } from "../sim/m2/roster";
import { orbitPeriodSeconds } from "../sim/m2/orbit";

const DEG = 180 / Math.PI;
const TAU = Math.PI * 2;

/** How close two orbits must be to count as the same ring. TUNABLE, deliberately loose enough
 * to survive a circularised underburn and tight enough not to sweep in a neighbouring plane. */
export const RING_ALT_TOLERANCE = 0.08; // fractional difference in semi-major axis
export const RING_ANGLE_TOLERANCE_DEG = 8;

/** One satellite drawn on the ring. */
export interface RingMember {
  id: string;
  /** Position along the ring, degrees [0, 360). */
  phaseDeg: number;
  /** True for the satellites THIS launch would add; false for the ones already flying. */
  draft: boolean;
}

export interface RingState {
  members: RingMember[];
  /** The widest gap between the satellites ALREADY FLYING — the hole you are aiming into. */
  gapDeg: number;
  /** Where that hole is centred, degrees. */
  gapCentreDeg: number;
  /** The widest gap AFTER this launch — the consequence of committing the current draft. */
  gapAfterDeg: number;
  /** How many satellites this launch carries. */
  count: number;
  /** True when nothing you own is on this ring yet (so there is no hole to fill). */
  empty: boolean;
}

/** Normalise an angle in radians to degrees in [0, 360). */
function normDeg(rad: number): number {
  const d = (rad * DEG) % 360;
  return d < 0 ? d + 360 : d;
}

/** Smallest absolute difference between two angles in degrees, accounting for wrap. */
function angleDeltaDeg(aDeg: number, bDeg: number): number {
  const d = Math.abs(((aDeg - bDeg) % 360) + 360) % 360;
  return d > 180 ? 360 - d : d;
}

/** Does `o` fly the same ring as `draft` — same altitude AND the same plane (inc AND RAAN)? */
export function sameRing(o: SatOrbit, draft: { semiMajorM: number; incRad: number; raanRad?: number }): boolean {
  const altOk =
    Math.abs(o.aM - draft.semiMajorM) / Math.max(1, draft.semiMajorM) < RING_ALT_TOLERANCE;
  if (!altOk) return false;
  const incOk = angleDeltaDeg(o.incRad * DEG, draft.incRad * DEG) < RING_ANGLE_TOLERANCE_DEG;
  if (!incOk) return false;
  // RAAN: the plane's swing around the pole. Same altitude + same tilt + DIFFERENT RAAN is a
  // different plane, not a neighbour on the same ring.
  return angleDeltaDeg(o.raanRad * DEG, (draft.raanRad ?? 0) * DEG) < RING_ANGLE_TOLERANCE_DEG;
}

/** Where a satellite sits along its ring at sim-time `t`, degrees [0, 360). */
export function phaseDegAt(o: SatOrbit, t: number): number {
  const per = orbitPeriodSeconds(o);
  const n = per > 0 ? TAU / per : 0;
  return normDeg(o.m0Rad + n * (t - o.epochS));
}

/** The widest gap between a set of phases, and where it is centred. A single satellite leaves
 * a 360° hole (everywhere except itself); an empty set is all hole. */
export function widestGap(phasesDeg: readonly number[]): { gapDeg: number; centreDeg: number } {
  if (phasesDeg.length === 0) return { gapDeg: 360, centreDeg: 0 };
  if (phasesDeg.length === 1) return { gapDeg: 360, centreDeg: (phasesDeg[0] + 180) % 360 };
  const p = [...phasesDeg].sort((a, b) => a - b);
  let gapDeg = 0;
  let centreDeg = 0;
  for (let i = 0; i < p.length; i++) {
    const a = p[i];
    const b = i === p.length - 1 ? p[0] + 360 : p[i + 1];
    const g = b - a;
    if (g > gapDeg) {
      gapDeg = g;
      centreDeg = ((a + g / 2) % 360 + 360) % 360;
    }
  }
  return { gapDeg, centreDeg };
}

/**
 * Build the ring the pad draws: the satellites already flying this exact orbit, the ones the
 * current draft would add, the hole between the flying ones, and the hole that would remain
 * once the draft is committed.
 */
export function ringState(
  draft: { semiMajorM: number; incRad: number; raanRad?: number },
  fleet: readonly { id: string; orbit: SatOrbit }[],
  draftMembers: readonly { id: string; orbit: SatOrbit }[],
  t: number,
  count: number,
): RingState {
  const members: RingMember[] = [];
  for (const sat of fleet) {
    if (sameRing(sat.orbit, draft)) {
      members.push({ id: sat.id, phaseDeg: phaseDegAt(sat.orbit, t), draft: false });
    }
  }
  const flying = members.map((m) => m.phaseDeg);
  for (const m of draftMembers) {
    members.push({ id: m.id, phaseDeg: phaseDegAt(m.orbit, t), draft: true });
  }
  const now = widestGap(flying);
  const after = widestGap(members.map((m) => m.phaseDeg));
  return {
    members,
    gapDeg: now.gapDeg,
    gapCentreDeg: now.centreDeg,
    gapAfterDeg: after.gapDeg,
    count,
    empty: flying.length === 0,
  };
}
