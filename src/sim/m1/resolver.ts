/**
 * M1-02/03/05 — Resolver: serve / miss / stale resolution of a demand.
 *
 * Faithful TypeScript port of SignalHorizon.Sim/M1/Resolver.cs. THE PRIMARY
 * TELEMETRY TAP and the heart of M1. PURE functions of
 * (eph, t, demand, cache, linkOpen): same inputs -> identical result
 * (determinism). No three/DOM/wall-clock/RNG.
 *
 * ENGINEERING NOTE / STUB FLAG (M1-02): {@link feasible} is ONE line-of-sight
 * check on the single Earth<->Mars link. There is exactly one path in the M1
 * linear chain — not a graph router.
 */
import type { Ephemeris } from "../ephemeris";
import { roundTripSeconds } from "../delay";
import { lineOfSight } from "../links";
import type { Cache } from "./cache";
import type { Demand } from "./demand";

/** The four serve outcomes a resolve can land on (GDScript outcome strings). */
export type ResolveOutcome = "fresh" | "stale" | "miss" | "blackout_miss";

/**
 * The serialisable result of a single {@link resolve} — the primary telemetry
 * tap. Mirrors the C# ResolveResult record struct.
 */
export interface ResolveResult {
  outcome: ResolveOutcome;
  payout: number;
  servedAge: number;
  servedFreshness: number;
  viaCache: boolean;
  waitSeconds: number;
}

/**
 * Default blackout penalty (positive magnitude) for a missed request during a
 * conjunction. Applied as a NEGATIVE payout. Mirrors
 * Resolver.DefaultBlackoutPenalty.
 */
export const DEFAULT_BLACKOUT_PENALTY = 500.0;

/**
 * M1-02 — Is the source<->customer link geometrically usable at time t?
 * ONE LoS check (the Sun is the occluder during conjunction). NOT a router.
 */
export function feasible(
  eph: Ephemeris,
  t: number,
  sourceId: string,
  customerId: string,
  occluders: string[] = ["sun"],
): boolean {
  return lineOfSight(eph, sourceId, customerId, t, occluders);
}

/**
 * Round-trip light time (sim-seconds) the customer waits on a fetch at time t.
 * The SAME distance->time the orrery packet + light-delay panel use.
 */
export function fetchWaitSeconds(eph: Ephemeris, t: number, demand: Demand): number {
  const d = eph.distanceBetween(demand.sourceId, demand.customerId, t);
  return roundTripSeconds(d);
}

/**
 * M1-03/05 — Resolve a single request firing at time t.
 * `linkOpen` is passed in (the session computes it from feasible()) so the
 * resolver stays a pure function of explicit inputs and is trivially testable.
 */
export function resolve(
  eph: Ephemeris,
  t: number,
  demand: Demand,
  cache: Cache | null,
  linkOpen: boolean,
): ResolveResult {
  // --- 1. Try the local cache first (a HIT serves without crossing the gap).
  if (cache !== null && cache.holds(demand.datasetId, t)) {
    const f = cache.freshnessOf(demand.datasetId, t);
    // Still in a paying band -> serve locally. Stale-but-usable counts.
    if (f >= demand.minAcceptableFreshness) {
      // In this branch demand.band(f) is "fresh" or "stale" (never "unusable",
      // since f >= minAcceptableFreshness); narrow to ResolveOutcome.
      const outcome: ResolveOutcome = f >= demand.freshFreshness ? "fresh" : "stale";
      // holds() guarantees the slot for this dataset is present.
      const held = cache.peek(demand.datasetId)!;
      return {
        outcome,
        payout: demand.price(f),
        servedAge: held.age(t),
        servedFreshness: f,
        viaCache: true,
        waitSeconds: 0.0,
      };
    }
    // else: held copy decayed below min -> falls through to a refetch.
  }

  // --- 2. No usable cache. A fetch is needed; can the link carry it?
  if (linkOpen) {
    // MISS: schedule a fetch from Earth. The customer waits one round-trip.
    // Payout 0 for the miss event; the wait is the telemetry that
    // "waiting is gameplay".
    return {
      outcome: "miss",
      payout: 0.0,
      servedAge: -1.0,
      servedFreshness: 0.0,
      viaCache: false,
      waitSeconds: fetchWaitSeconds(eph, t, demand),
    };
  }

  // --- 3. Link DOWN and no usable cache -> blackout penalty. A fresh prefetch
  // BEFORE the link closed is what avoids this branch.
  return {
    outcome: "blackout_miss",
    payout: -DEFAULT_BLACKOUT_PENALTY,
    servedAge: -1.0,
    servedFreshness: 0.0,
    viaCache: false,
    waitSeconds: 0.0,
  };
}

/**
 * Telemetry bridge with the exact GDScript Dictionary keys (snake_case), so the
 * session can override "payout" on a blackout_miss before applying/recording.
 * Mirrors ResolveResult.ToDictionary().
 */
export function toDict(r: ResolveResult): {
  outcome: ResolveOutcome;
  payout: number;
  served_age: number;
  served_freshness: number;
  via_cache: boolean;
  wait_seconds: number;
} {
  return {
    outcome: r.outcome,
    payout: r.payout,
    served_age: r.servedAge,
    served_freshness: r.servedFreshness,
    via_cache: r.viaCache,
    wait_seconds: r.waitSeconds,
  };
}
