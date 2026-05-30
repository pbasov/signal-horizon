/**
 * Line-of-sight / occlusion geometry — port of the SignalLink.cs occlusion test
 * (SegmentBlockedBySphere): a blocker sphere blocks a link only when it sits
 * BETWEEN the two endpoints, not behind either of them. Pure f64.
 *
 * E10a — SOLAR-INTERFERENCE CORRIDOR (retires SD-22). A real Mars solar
 * conjunction is NOT a literal disk occultation: it is a comms blackout caused
 * by solar RF interference when the Sun–Earth–probe angle is small (NASA stops
 * commanding Mars craft at SEP ≲ 2°, degraded from ~2–5°). So the blackout is
 * modelled as a CORRIDOR: the Earth↔Mars link is dead when its line of sight
 * passes within {@link SOLAR_CORRIDOR_RSUN} solar radii of the Sun CENTRE — a
 * generalisation of the old 1-Rsun disk test (which is just the N=1 case). The
 * tightest real Sun-miss over a full synodic period is ≈3.322 Rsun, so the
 * default N=5 yields a real ~6.7-day blackout window around the conjunction.
 */
import type { Ephemeris, Vec3 } from "./ephemeris";

/**
 * THE ONE-PLACE DIAL for the solar-interference blackout corridor (E10a). The
 * Earth↔Mars link blacks out when its line of sight passes within this many
 * solar radii of the Sun centre. Default 5: with the tightest real approach at
 * ≈3.322 Rsun this opens a genuine blackout window at conjunction (≈6.7 days
 * wide), so the §4.4/§3a "pre-stage before the predictable blackout" insight is
 * live against the REAL ephemeris. N=1 reduces to the old physical-disk
 * occultation. PLACEHOLDER — tune to taste (a wider corridor = a longer, more
 * teachable blackout; a tighter one shortens it toward the bare disk).
 */
export const SOLAR_CORRIDOR_RSUN = 5;

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/**
 * Distance from the sphere centre to the segment AB, and whether AB is blocked.
 *
 * `radius` is the GEOMETRY radius (the physical disk) used for the `distance`
 * read and the default block test; `blockRadius` (default = `radius`) is the
 * effective BLOCKING radius — the corridor. The Earth↔Mars blackout uses a
 * `blockRadius` of N·Rsun (the solar-interference corridor) while keeping the
 * true 1-Rsun disk available for the physical-occult flag. "Blocked" still
 * requires the centre to project STRICTLY between the endpoints (0 < t < 1) — so
 * a Sun on the NEAR side of both bodies (t ≤ 0 or t ≥ 1) never blacks out.
 */
export function segmentSphere(
  a: Vec3,
  b: Vec3,
  center: Vec3,
  radius: number,
  blockRadius: number = radius,
): { distance: number; t: number; blocked: boolean } {
  const ab: Vec3 = [b[0] - a[0], b[1] - a[1], b[2] - a[2]];
  const ac: Vec3 = [center[0] - a[0], center[1] - a[1], center[2] - a[2]];
  const abLen2 = dot(ab, ab);
  let t = abLen2 > 0 ? dot(ac, ab) / abLen2 : 0;
  // Clamp the closest-point parameter to the segment for the distance read,
  // but "blocked" requires the centre to project strictly BETWEEN endpoints.
  const tc = Math.max(0, Math.min(1, t));
  const closest: Vec3 = [a[0] + ab[0] * tc, a[1] + ab[1] * tc, a[2] + ab[2] * tc];
  const dx = closest[0] - center[0];
  const dy = closest[1] - center[1];
  const dz = closest[2] - center[2];
  const distance = Math.sqrt(dx * dx + dy * dy + dz * dz);
  const blocked = t > 0 && t < 1 && distance < blockRadius;
  return { distance, t, blocked };
}

/**
 * Clear line of sight from `a` to `b` at time t, given candidate occluders.
 * Generalised from the SignalLink.LineOfSight disk-occlusion port: returns false
 * if ANY occluder body's CORRIDOR blocks the segment. The endpoints themselves
 * (a/b) are skipped so a body never occludes its own link, as are unknown bodies
 * and zero-radius bodies. "Blocked" uses {@link segmentSphere}: the occluder's
 * closest-approach parameter must lie STRICTLY in (0,1) AND the perpendicular
 * Sun-centre distance must be < `corridorRsun · radius`.
 *
 * `corridorRsun` scales each occluder's effective blocking radius (E10a's
 * solar-interference corridor). It defaults to {@link SOLAR_CORRIDOR_RSUN} so
 * the live blackout fires at conjunction; pass 1 for the bare physical-disk
 * occultation (the historical behaviour / unit cases).
 */
export function lineOfSight(
  eph: Ephemeris,
  a: string,
  b: string,
  t: number,
  occluders: string[],
  corridorRsun: number = SOLAR_CORRIDOR_RSUN,
): boolean {
  const pa = eph.position(a, t);
  const pb = eph.position(b, t);
  for (const occ of occluders) {
    if (occ === a || occ === b) continue;
    if (!eph.hasBody(occ)) continue;
    const r = eph.radiusMeters(occ);
    if (r <= 0.0) continue;
    const center = eph.position(occ, t);
    if (segmentSphere(pa, pb, center, r, r * corridorRsun).blocked) return false;
  }
  return true;
}

export interface LosState {
  /** perpendicular miss distance of the Sun centre to the Earth→Mars segment (m) */
  missDistance: number;
  /** missDistance expressed in solar radii — the human-readable conjunction margin */
  marginSolarRadii: number;
  /** true if the real solar disk (1 Rsun) intersects the segment */
  occulted: boolean;
  /**
   * The solar-interference corridor threshold in Rsun (E10a). The margin reads
   * BLACKOUT once {@link marginSolarRadii} ≤ this AND the Sun is between the
   * endpoints — the same condition that makes the link infeasible.
   */
  corridorRsun: number;
  /**
   * True when the line of sight is inside the solar-interference corridor (the
   * Sun is between Earth and Mars AND the Sun-miss margin ≤ corridorRsun) — i.e.
   * the Earth↔Mars link is BLACKED OUT. The render/readout reads this; the
   * resolver reaches the same verdict via {@link feasible}/lineOfSight.
   */
  inCorridor: boolean;
}

/**
 * Earth→Mars line-of-sight margin against the Sun, at sim-time t. `corridorRsun`
 * (default {@link SOLAR_CORRIDOR_RSUN}) is the blackout corridor the readout and
 * resolver share; the returned `occulted` flag stays the true 1-Rsun disk test,
 * while `inCorridor` is the corridor blackout verdict.
 */
export function earthMarsLos(eph: Ephemeris, t: number, corridorRsun: number = SOLAR_CORRIDOR_RSUN): LosState {
  const earth = eph.position("earth", t);
  const mars = eph.position("mars", t);
  const sun = eph.position("sun", t);
  const sunR = eph.radiusMeters("sun");
  // One segment solve: distance + the strict near-side (0<t<1) check, with the
  // corridor as the blocking radius. The disk-occult flag re-reads the same
  // distance against the bare 1-Rsun disk (margin < 1).
  const seg = segmentSphere(earth, mars, sun, sunR, sunR * corridorRsun);
  const margin = sunR > 0 ? seg.distance / sunR : Infinity;
  return {
    missDistance: seg.distance,
    marginSolarRadii: margin,
    occulted: seg.t > 0 && seg.t < 1 && margin < 1,
    corridorRsun,
    inCorridor: seg.blocked,
  };
}
