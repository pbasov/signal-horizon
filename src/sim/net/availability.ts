/**
 * net/ — THE AVAILABILITY VERDICT (design §4.4 / Act 2): the rolling served-fraction of a
 * region's CENTRE over a trailing HAND-OFF WINDOW. This is the per-axis-over-TIME template:
 * Act 1's connectivity is a per-instant predicate; the availability axis measures whether the
 * region is HELD across a full rise→set→rise hand-off cycle (a single LEO cannot — it is up
 * only ~29% of each pass; a phased constellation holds 1.0). Acts 3's latency/bandwidth axes
 * reuse this same "sample the router across the window, take the held-fraction" shape.
 *
 * --- WHY A ROLLING WINDOW, NOT INSTANTANEOUS PATH-EXISTENCE (the load-bearing decision) ---
 * The SHARED m2 `stepActiveContract` resets the breach window on ANY served step
 * (servedFraction > 0). A lone LEO is up ~29% of each pass, so feeding instantaneous
 * path-existence as the served fraction would reset the breach window every pass and the
 * contract would NEVER breach via the shared grace. Instead the session feeds a fraction that
 * drops to 0 while availability is in breach (rolling-avail < slaAvail), so the SINGLE
 * BREACH_GRACE_SECONDS is the one breach convention — no second state machine, no struct
 * reshape. A lone LEO's rolling availability sits at ~0 and the contract breaches on schedule;
 * a phased N=4 holds the region continuously, rolling-avail = 1.0, and completes.
 *
 * PURE: fixed window length + fixed sample count + fixed phase offsets ⇒ byte-identical per
 * (t, roster). No state, no cross-tick accumulation — recomputed from the roster each call
 * (so snapshot/restore needs nothing new; like the router cache it is rebuilt, not stored).
 * The orbit is periodic and {@link import("./router").isPointServed} is pure even at negative
 * t (trailing-window boundaries t < W), so determinism holds at every phase. Reuses
 * `isPointServed` at each sampled instant — the SAME machinery, sampled across TIME instead of
 * across the disc.
 *
 * @see docs/signal-horizon-m1.md Part II §4.4 (the SLA-axis ramp / availability), §2.2, §4.
 */

import type { Ephemeris } from "../ephemeris";
import type { NetSat } from "./sat";
import type { GroundNet, RegionPoint } from "./endpoint";
import { isPointServed, type RoutableContract } from "./router";
import { A1_LEO_PERIOD_S } from "./world";

/** The trailing hand-off window length (seconds) the rolling availability spans: ONE LEO
 * period — long enough to cover a full rise→set→rise hand-off cycle (measured sufficient: a
 * phased N=4 holds 1.0 across it; a lone LEO dips to ~0). The availability axis asks "was the
 * region held across the LAST hand-off window?", not "is there a path this instant?". */
export const NET_AVAIL_WINDOW_S = A1_LEO_PERIOD_S;

/** Fixed sample count across the window — pure, no RNG. Even spacing of 32 phases resolves a
 * ~5 s gap inside the 150 s window, which is finer than the breach grace cares about. */
export const NET_AVAIL_SAMPLES = 32;

/**
 * The rolling served-fraction of a region's CENTRE over the trailing window
 * [t − {@link NET_AVAIL_WINDOW_S}, t]: sample {@link NET_AVAIL_SAMPLES} fixed phases across
 * the window and return the fraction at which the region centre bridges to the ground net
 * ({@link isPointServed} true). A pure function of (eph, contract, sats, grounds, t, faults?).
 *
 * Returns 0 with no sats / no ground net. The window is sampled inclusive of both endpoints
 * (k = 0 … SAMPLES-1 over [t−W, t]); with the periodic orbit + the pure point-served check the
 * result is byte-identical for the same (t, roster), at every phase including t < W.
 */
export function windowAvailability(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  grounds: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): number {
  if (sats.length === 0 || grounds.length === 0) return 0;
  const centre: RegionPoint = {
    latRad: contract.region.latRad,
    lonRad: contract.region.lonRad,
  };
  const W = NET_AVAIL_WINDOW_S;
  const denom = NET_AVAIL_SAMPLES - 1;
  let up = 0;
  for (let k = 0; k < NET_AVAIL_SAMPLES; k++) {
    const tt = t - W + (W * k) / denom;
    if (isPointServed(eph, centre, grounds, sats, tt, faults)) up++;
  }
  return up / NET_AVAIL_SAMPLES;
}
