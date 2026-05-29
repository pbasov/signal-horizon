/**
 * M1-04 — Cache + CachedSample: the one-slot Mars-orbit relay store.
 *
 * Faithful TypeScript port of SignalHorizon.Sim/M1/Cache.cs. PURE data +
 * functions. Freshness is delegated to {@link freshness} (delay.ts) so
 * age->freshness is the SAME curve the light-delay panel and demand pricing use.
 *
 * STUB FLAG (M1-04): exactly ONE sample slot. No capacity, no eviction policy,
 * no multi-dataset map. A second prefetch overwrites the slot.
 */
import { freshness as delayFreshness } from "../delay";

/**
 * A single held copy of a dataset, captured at an absolute sim-time.
 * Mirrors the nested C# Cache.CachedSample.
 */
export class CachedSample {
  datasetId: string;
  capturedAtT: number;
  halfLifeS: number;

  constructor(datasetId = "", capturedAtT = 0.0, halfLifeS = 3600.0) {
    this.datasetId = datasetId;
    this.capturedAtT = capturedAtT;
    this.halfLifeS = halfLifeS;
  }

  /**
   * Age (sim-seconds) of this sample at time t. Negative if t precedes capture
   * (a not-yet-arrived prefetch); callers treat <0 as "not present".
   */
  age(t: number): number {
    return t - this.capturedAtT;
  }

  /**
   * Freshness in [0,1] at time t via the shared half-life decay. A sample that
   * has not arrived yet (age<0) reads as 0 freshness (unavailable).
   */
  freshness(t: number): number {
    const a = this.age(t);
    if (a < 0.0) return 0.0;
    return delayFreshness(a, this.halfLifeS);
  }
}

export class Cache {
  /** The cache node (a Mars-orbit relay). */
  nodeId = "mars";

  /** One optional sample. null when the slot is empty. */
  sample: CachedSample | null = null;

  constructor(nodeId = "mars") {
    this.nodeId = nodeId;
  }

  /**
   * True if the cache currently holds an ARRIVED sample of `datasetId` at time t.
   * A prefetch that has not yet crossed the light-gap (capturedAtT > t) is NOT
   * yet a hit — this is what makes prefetch timing matter (M1-06).
   */
  holds(datasetId: string, t: number): boolean {
    return (
      this.sample !== null &&
      this.sample.datasetId === datasetId &&
      this.sample.age(t) >= 0.0
    );
  }

  /**
   * Freshness of the held dataset at time t, or 0.0 if the slot is empty /
   * holds a different dataset / has not arrived yet.
   */
  freshnessOf(datasetId: string, t: number): number {
    if (!this.holds(datasetId, t)) return 0.0;
    // holds() guarantees sample is non-null.
    return this.sample!.freshness(t);
  }

  /**
   * Overwrite the single slot with a sample. STUB: no eviction; this just
   * replaces whatever was there (M1-04).
   */
  store(datasetId: string, capturedAtT: number, halfLifeS: number): void {
    this.sample = new CachedSample(datasetId, capturedAtT, halfLifeS);
  }

  /** Clear the slot (used by tests / blackout-eviction experiments). Pure. */
  clear(): void {
    this.sample = null;
  }
}
