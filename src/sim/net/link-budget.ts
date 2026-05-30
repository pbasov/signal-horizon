/**
 * net/ — the LINK BUDGET (design §2.4 / §7 / the §5 WHOLE-DISC must-fix). The physics
 * an edge of the routing graph must satisfy to carry a link at sim-time t:
 *
 *   1. ELEVATION GATE — the asset sits at or above the surface point's local horizon
 *      mask: sin(elevation) = normal · dirToAsset ≥ sin(NET_MIN_ELEVATION_RAD). The
 *      outward surface normal at a body-fixed (lat,lon) IS that point's unit direction
 *      (the body-centre offset cancels), so this is exactly field.ts's gate.
 *   2. INVERSE-SQUARE BUDGET — received ∝ eirp · (REF/d)² ≥ 1 (field.ts's stub link
 *      budget, one reference distance). A unit-EIRP asset closes the link within REF.
 *   3. LINE OF SIGHT — the segment surfacePoint→asset is not occluded by the toy body.
 *      For a surface→space link the elevation gate (1) already implies near-side LoS
 *      (an asset below the local horizon is, by construction, occluded by the body);
 *      the explicit segment-sphere test is carried so a sat→sat / surface→surface edge
 *      in Acts 2–3 reuses the SAME predicate without a special case.
 *
 * THE SPINNING FRAME (design §2.1): surface endpoints (regions, ground nets) ride θ(t)
 * via net/frame `surfacePointInertial`; orbits stay inertial and unforked (solveOrbit).
 * The earth-centre offset is common to both the surface point and the sat world
 * position, so this module works in the EARTH-RELATIVE frame (subtract nothing, add
 * nothing): the surface point is bodyRadius·Rz(θ)·u and the sat is solveOrbit(orbit,t)
 * — the difference is identical to the absolute-frame difference but avoids the
 * large-magnitude cancellation of adding then subtracting eph.position("earth", t).
 *
 * PURE: no three, no DOM, no wall-clock, no RNG. Reuses the field.ts FORMULAS
 * (C_LIGHT for latency; the elevation + inverse-square shapes) with net/-local
 * constants (NET_MIN_ELEVATION_RAD, the per-antenna eirp + rangeRefM). It does NOT
 * import the field.ts grid/cell machinery — only the speed of light + the constants.
 *
 * @see docs/signal-horizon-m1-design.md §2.4 (router edges), §5 (the WHOLE-DISC pin).
 */

import { type Vec3, C_LIGHT } from "../ephemeris";
import { REF_LINK_DISTANCE_M } from "../coverage/field";
import { rotZ, earthThetaAt } from "./frame";
import { A1_BODY_RADIUS_M } from "./world";
import { NET_MIN_ELEVATION_RAD } from "./endpoint";

/** sin of the net elevation floor, precomputed (the gate uses sin(el) ≥ this). */
export const NET_SIN_MIN_ELEVATION = Math.sin(NET_MIN_ELEVATION_RAD);

/** The link-budget reference distance (metres) the net game uses — the unforked
 * field.ts REF_LINK_DISTANCE_M. A unit-eirp antenna closes the budget within this
 * range. Re-exported so the sat loadout's `rangeRefM` is sourced from ONE place. */
export const NET_REF_LINK_DISTANCE_M = REF_LINK_DISTANCE_M;

/**
 * E4 (Act 3a) — PER-ANTENNA LINK CAPACITY (units matching {@link import("./contract").Contract}.offeredLoad).
 * The shared-load aggregate a single standard antenna's bridge can carry before it is
 * CONGESTED: the §7.2 congestion term is `sharedLoadOnSat / NET_LINK_CAPACITY_UNITS`, and
 * the bandwidth axis bites BINARY when that term reaches 1 (`sharedLoadOnSat ≥ capacity`).
 *
 * UNIFORM per standard antenna in C1 (one bus, no overclock). C2 introduces a degradation
 * HAIRCUT (a per-sat capacity multiplier in (0,1)) which scales THIS base, so the constant
 * stays the single source of truth and the haircut composes on top of it without a reshape.
 * A PLAYTEST KNOB — the value is a tuned placeholder on the same `offeredLoad` scale
 * (default contract `offeredLoad = 1.0`), chosen so one contract sits comfortably under
 * capacity and two contracts sharing one sat after escalation tip over it. */
export const NET_LINK_CAPACITY_UNITS = 1.5;

/** Why a link does NOT close (the geometric cause stamped into the predictability
 * seed). `ok` carries the successful case so the trace can read a single enum. */
export type LinkCause = "ok" | "set_below_horizon" | "out_of_budget" | "occluded";

/** The raw geometry + verdict of one candidate edge between two world points, where
 * `from` is the point whose LOCAL HORIZON the elevation gate is measured against (the
 * surface endpoint for a surface→sat link). All vectors are in the earth-relative
 * frame (so the body centre is the origin). */
export interface LinkBudget {
  /** Straight-line distance from→to (metres). */
  distanceM: number;
  /** Elevation of `to` above `from`'s local horizon (radians); negative ⇒ occluded. */
  elevationRad: number;
  /** Received signal ratio eirp·(REF/d)² (≥ 1 closes the budget). */
  received: number;
  /** One-way propagation latency d/c (seconds). */
  latencyS: number;
  /** True iff ALL THREE gates pass. */
  closes: boolean;
  /** The binding geometric cause when it does not close ("ok" when it does). */
  cause: LinkCause;
}

/**
 * Earth-relative world position (metres) of a body-fixed surface point at sim-time t:
 * bodyRadius · Rz(θ(t)) · u(lat,lon). This is `surfacePointInertial` with the body
 * centre at the origin (the offset cancels in every edge difference). Uses the TOY
 * body radius — never the real ephemeris radius — so the toy geometry holds.
 */
export function surfacePointRelative(latRad: number, lonRad: number, t: number): Vec3 {
  const cl = Math.cos(latRad);
  const u: Vec3 = [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
  const d = rotZ(u, earthThetaAt(t));
  return [d[0] * A1_BODY_RADIUS_M, d[1] * A1_BODY_RADIUS_M, d[2] * A1_BODY_RADIUS_M];
}

/** Outward surface normal (unit) at a body-fixed (lat,lon) at sim-time t — the rotated
 * surface unit direction. The elevation gate measures `to` against this. */
export function surfaceNormalRelative(latRad: number, lonRad: number, t: number): Vec3 {
  const cl = Math.cos(latRad);
  const u: Vec3 = [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
  return rotZ(u, earthThetaAt(t));
}

/**
 * Evaluate the link budget for an edge from a SURFACE point (with an outward `normal`)
 * to a target world point `to` carrying antenna `eirp` + `rangeRefM`. Both `from`/`to`
 * are earth-relative. Pure.
 *
 * The three gates, in the order their CAUSE is most informative:
 *   - elevation < floor ⇒ "set_below_horizon" (the LEO-sweep set; the trace's geometry)
 *   - else budget < 1   ⇒ "out_of_budget"
 *   - else LoS occluded  ⇒ "occluded" (defensive; the elevation gate already covers a
 *     surface→space link, but the explicit test future-proofs sat↔sat / surface↔surface)
 */
export function evaluateLink(
  from: Vec3,
  normal: Vec3,
  to: Vec3,
  eirp: number,
  rangeRefM: number,
): LinkBudget {
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const distanceM = Math.sqrt(dx * dx + dy * dy + dz * dz);
  if (distanceM <= 0) {
    return {
      distanceM: 0,
      elevationRad: Math.PI / 2,
      received: Infinity,
      latencyS: 0,
      closes: false,
      cause: "occluded",
    };
  }
  const sinEl = (normal[0] * dx + normal[1] * dy + normal[2] * dz) / distanceM;
  const sinElClamped = Math.max(-1, Math.min(1, sinEl));
  const elevationRad = Math.asin(sinElClamped);
  const ratio = rangeRefM / distanceM;
  const received = eirp * ratio * ratio;
  const latencyS = distanceM / C_LIGHT;

  let cause: LinkCause = "ok";
  if (sinEl < NET_SIN_MIN_ELEVATION) cause = "set_below_horizon";
  else if (received < 1) cause = "out_of_budget";
  else if (segmentOccludedByBody(from, to)) cause = "occluded";
  const closes = cause === "ok";
  return { distanceM, elevationRad, received, latencyS, closes, cause };
}

/**
 * True iff the straight segment from→to passes through the toy body sphere (centred at
 * the earth-relative origin, radius {@link A1_BODY_RADIUS_M}) STRICTLY between the two
 * endpoints — i.e. the body occludes the line of sight. Endpoints sitting on/inside the
 * sphere (a surface point is on it) do not count as occlusion by themselves; the test
 * is the classic ray–sphere nearest-approach inside the [0,1] segment parameter.
 */
export function segmentOccludedByBody(from: Vec3, to: Vec3): boolean {
  const R = A1_BODY_RADIUS_M;
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const segLen2 = dx * dx + dy * dy + dz * dz;
  if (segLen2 <= 0) return false;
  // Parameter s ∈ [0,1] of the closest point on the segment to the body centre (origin).
  const s = -(from[0] * dx + from[1] * dy + from[2] * dz) / segLen2;
  if (s <= 0 || s >= 1) return false; // nearest approach is outside the open segment.
  const cx = from[0] + s * dx;
  const cy = from[1] + s * dy;
  const cz = from[2] + s * dz;
  const closest2 = cx * cx + cy * cy + cz * cz;
  // Occluded only if the line dips strictly inside the body (a hair of slack so a
  // grazing surface tangent — the horizon — is not spuriously called occlusion).
  return closest2 < R * R - 1e-3;
}
