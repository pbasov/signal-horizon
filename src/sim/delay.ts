/**
 * Light-delay + freshness — port of SignalHorizon.Sim/SignalDelay.cs semantics.
 *
 * "Speed of light stays REAL even under time-compression — the sim compresses
 * time, never the physics." The number the packet freezes at launch and the
 * number the status strip prints derive from this identical formula + the same
 * Ephemeris distance, so the on-screen crawl and the readout cannot drift.
 */
import { C_LIGHT } from "./ephemeris";

/** One-way light delay (seconds) over a straight-line distance in metres. */
export function oneWaySeconds(distanceM: number): number {
  return distanceM / C_LIGHT;
}

/** Round-trip light delay (seconds). */
export function roundTripSeconds(distanceM: number): number {
  return 2.0 * oneWaySeconds(distanceM);
}

/**
 * Freshness in [0,1]: 2^(-age/halfLife). With halfLife = one-way delay, a packet
 * arrives at ~0.5 freshness and drains toward machine-grey (0) as it ages.
 * Mirrors SignalDelay.Freshness(age, halfLife).
 */
export function freshness(ageSeconds: number, halfLifeSeconds: number): number {
  // Match C# SignalDelay.Freshness: a degenerate (<=0) half-life is "instantly
  // stale unless age is also 0", NOT unconditionally fresh.
  if (halfLifeSeconds <= 0) return ageSeconds <= 0 ? 1.0 : 0.0;
  return Math.pow(2, -ageSeconds / halfLifeSeconds);
}
