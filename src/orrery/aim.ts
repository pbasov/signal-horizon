/**
 * THE AIM ANGLES — the pure camera-pointing math behind "click a mission, look at the
 * region it asks you to cover".
 *
 * The orrery's body-anchored orbit camera is two numbers (az, el) and a distance; the
 * focus body sits at the scene origin and the camera looks at it from
 *
 *   p = dist · (cos el · sin az,  sin el,  cos el · cos az)
 *
 * So framing a point ON that body is one inversion: take the point's body-relative
 * direction, push it through the SAME axis swap the renderer uses (world (x,y,z) →
 * scene (x, z, −y) — see `Orrery.writeRenderPoint`), and read the angles straight off
 * the unit vector. The camera then sits on the outward normal of that surface point,
 * which is exactly "looking down at it".
 *
 * PURE + engine-free (no three, no DOM) so the inversion is unit-testable on its own —
 * the orrery only feeds it a vector and copies the two numbers into its target frame.
 */

/** The two camera angles (radians) that put a body-relative direction dead centre. */
export interface AimAngles {
  azRad: number;
  elRad: number;
}

/**
 * The (az, el) that frames the body-relative direction `rel` (metres or unit — only the
 * direction is read). Returns null for a degenerate zero-length input (nothing to aim at).
 *
 * `elRad` is CLAMPED to ±88° to match the orbit camera's own pole guard, so a polar
 * region (REGION-1 at lat 70° is fine, but a pole-adjacent one would not be) never asks
 * the camera for a gimbal-locked frame it immediately clips back out of.
 */
export function aimAnglesForRelDir(rel: readonly [number, number, number]): AimAngles | null {
  const [x, y, z] = rel;
  const m = Math.hypot(x, y, z);
  if (!(m > 0)) return null;
  // World → scene axis swap (x, z, −y), the renderer's own convention.
  const sx = x / m;
  const sy = z / m;
  const sz = -y / m;
  const cap = (88 * Math.PI) / 180;
  const elRad = Math.max(-cap, Math.min(cap, Math.asin(Math.max(-1, Math.min(1, sy)))));
  return { azRad: Math.atan2(sx, sz), elRad };
}

/**
 * The SHORTEST-WAY-AROUND azimuth: `want` unwrapped into the turn nearest `current`, so a
 * camera at az = 3.10 rad asked to look at az = −3.10 swings 0.08 rad the short way
 * instead of 6.2 rad the long way. The orrery lerps toward the returned value.
 */
export function unwrapAz(current: number, want: number): number {
  const TAU = Math.PI * 2;
  let d = (want - current) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return current + d;
}
