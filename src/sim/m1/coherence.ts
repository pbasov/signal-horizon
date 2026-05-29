/**
 * M1-07 — Coherence levels: how aggressively a cache is kept fresh.
 *
 * Faithful TypeScript port of SignalHorizon.Sim/M1/Coherence.cs. PURE data +
 * functions. Two discrete points only:
 *   EVENTUAL    — refresh rarely, cheap, tolerates more staleness.
 *   BEST_EFFORT — refresh often, costs more, holds a higher freshness floor.
 *
 * Each level maps to three scalars the economy + resolver read. The enum keeps
 * explicit int values — scenario JSON stores initial_level as an int.
 */

/** Discrete coherence levels with explicit numeric values (matches scenario JSON). */
export enum Level {
  Eventual = 0,
  BestEffort = 1,
}

/** Human-readable name; unknown level falls back to EVENTUAL. */
export function nameOf(level: number): string {
  return level === Level.BestEffort ? "BEST_EFFORT" : "EVENTUAL";
}

/**
 * How often (sim-seconds) the chosen policy would re-prefetch.
 * EVENTUAL 7200 (~2h), BEST_EFFORT 1800 (~30m, 4x more often).
 */
export function refreshCadenceS(level: number): number {
  return level === Level.BestEffort ? 1800.0 : 7200.0;
}

/**
 * Multiplies the per-tick opex of running the cache.
 * EVENTUAL 1.0 (baseline), BEST_EFFORT 3.0.
 */
export function costMultiplier(level: number): number {
  return level === Level.BestEffort ? 3.0 : 1.0;
}

/**
 * Freshness the policy promises to keep the cache at (BEST_EFFORT > EVENTUAL).
 * EVENTUAL 0.5 (min band), BEST_EFFORT 0.9 (fresh band).
 */
export function freshnessFloor(level: number): number {
  return level === Level.BestEffort ? 0.9 : 0.5;
}
