/**
 * Line-of-sight / occlusion geometry — port of the SignalLink.cs occlusion test
 * (SegmentBlockedBySphere): a blocker sphere blocks a link only when it sits
 * BETWEEN the two endpoints, not behind either of them. Pure f64.
 */
import type { Ephemeris, Vec3 } from "./ephemeris";

function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

/** Distance from the sphere centre to the segment AB, and whether AB is blocked. */
export function segmentSphere(
  a: Vec3,
  b: Vec3,
  center: Vec3,
  radius: number,
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
  const blocked = t > 0 && t < 1 && distance < radius;
  return { distance, t, blocked };
}

export interface LosState {
  /** perpendicular miss distance of the Sun centre to the Earth→Mars segment (m) */
  missDistance: number;
  /** missDistance expressed in solar radii — the human-readable conjunction margin */
  marginSolarRadii: number;
  /** true if the real solar disk intersects the segment */
  occulted: boolean;
}

/** Earth→Mars line-of-sight margin against the Sun, at sim-time t. */
export function earthMarsLos(eph: Ephemeris, t: number): LosState {
  const earth = eph.position("earth", t);
  const mars = eph.position("mars", t);
  const sun = eph.position("sun", t);
  const sunR = eph.radiusMeters("sun");
  const seg = segmentSphere(earth, mars, sun, sunR);
  return {
    missDistance: seg.distance,
    marginSolarRadii: sunR > 0 ? seg.distance / sunR : Infinity,
    occulted: seg.blocked,
  };
}
