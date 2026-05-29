/**
 * M1-07 — Coherence levels: how aggressively a cache is kept fresh.
 *
 * Diverges from the faithful C# 2-level port per GDD v0.7 §4.4 ("Coherence
 * cost"): the player chooses a consistency level, each with its own € and
 * latency profile. M1 exposes a cheap -> mid -> premium LADDER:
 *   EVENTUAL    — refresh rarely, cheapest, tolerates the most staleness.
 *   BEST_EFFORT — refresh often, mid cost, holds a higher freshness floor.
 *   STRONG      — refresh aggressively, premium cost, near-perfect floor.
 *
 * Ordering is the in-game cheap->expensive ladder Eventual < BestEffort <
 * Strong (NOT distributed-systems strictness naming). The ladder is STRICTLY
 * MONOTONIC: as level rises, costMultiplier UP, freshnessFloor UP,
 * refreshCadenceS DOWN.
 *
 * PURE data + functions. The enum keeps explicit int values — scenario JSON
 * stores initial_level as an int (Eventual=0, BestEffort=1 unchanged for
 * back-compat; Strong=2 added).
 */

/** Discrete coherence levels with explicit numeric values (matches scenario JSON). */
export enum Level {
  Eventual = 0,
  BestEffort = 1,
  Strong = 2,
}

/**
 * Per-level scalar profile the economy + resolver read. A single lookup table
 * keyed by Level keeps the ladder in one place (vs. stacked ternaries) and
 * makes the strict monotonicity auditable at a glance.
 */
interface LevelProfile {
  readonly name: string;
  /** How often (sim-seconds) the policy would re-prefetch. Lower = more aggressive. */
  readonly refreshCadenceS: number;
  /** Multiplies the per-tick opex of running the cache. */
  readonly costMultiplier: number;
  /** Freshness the policy promises to hold the cache at, in [0,1]. */
  readonly freshnessFloor: number;
}

/**
 * The cheap -> mid -> premium ladder. STRICTLY MONOTONIC across rising level:
 *   cost          1.0  -> 3.0  -> 6.0   (up)
 *   freshnessFloor 0.5 -> 0.9  -> 0.98  (up)
 *   refreshCadence 7200 -> 1800 -> 600  (down)
 */
const TABLE: Readonly<Record<Level, LevelProfile>> = {
  [Level.Eventual]: {
    name: "EVENTUAL",
    refreshCadenceS: 7200.0,
    costMultiplier: 1.0,
    freshnessFloor: 0.5,
  },
  [Level.BestEffort]: {
    name: "BEST_EFFORT",
    refreshCadenceS: 1800.0,
    costMultiplier: 3.0,
    freshnessFloor: 0.9,
  },
  [Level.Strong]: {
    name: "STRONG",
    refreshCadenceS: 600.0,
    costMultiplier: 6.0,
    freshnessFloor: 0.98,
  },
};

/** Resolve a (possibly unknown) level to its profile; unknown falls back to EVENTUAL. */
function profileOf(level: number): LevelProfile {
  return TABLE[level as Level] ?? TABLE[Level.Eventual];
}

/** Human-readable name; unknown level falls back to EVENTUAL. */
export function nameOf(level: number): string {
  return profileOf(level).name;
}

/**
 * How often (sim-seconds) the chosen policy would re-prefetch.
 * EVENTUAL 7200 (~2h), BEST_EFFORT 1800 (~30m), STRONG 600 (~10m).
 */
export function refreshCadenceS(level: number): number {
  return profileOf(level).refreshCadenceS;
}

/**
 * Multiplies the per-tick opex of running the cache.
 * EVENTUAL 1.0 (baseline), BEST_EFFORT 3.0, STRONG 6.0 (premium).
 */
export function costMultiplier(level: number): number {
  return profileOf(level).costMultiplier;
}

/**
 * Freshness the policy promises to keep the cache at (STRONG > BEST_EFFORT > EVENTUAL).
 * EVENTUAL 0.5 (min band), BEST_EFFORT 0.9 (fresh band), STRONG 0.98 (near-perfect).
 */
export function freshnessFloor(level: number): number {
  return profileOf(level).freshnessFloor;
}
