/**
 * M1-04 — Cache + CachedSample: the Mars-orbit relay store.
 *
 * E7 generalises the original ONE-slot store into a MULTI-SLOT cache keyed by
 * datasetId, with a lowest-current-freshness EVICTION policy: storing a new
 * dataset into a FULL cache drops the slot whose held copy is the most stale RIGHT
 * NOW. Fewer slots than feeds ⇒ you cannot keep them all cached, so the cache is a
 * scarce, contended resource and the triage IS the strain (GDD §3a/§3b).
 *
 * BACK-COMPAT: the default capacity is 1, so a `new Cache("mars")` behaves exactly
 * like the original single-slot store (the resolver + the M1-model/economy tests
 * keep their single-slot semantics). The E7 session builds a {@link Cache} with
 * capacity 3.
 *
 * PURE data + functions (no three/DOM/wall-clock/RNG). Freshness is delegated to
 * {@link freshness} (delay.ts) so age→freshness is the SAME curve the light-delay
 * panel and demand pricing use.
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

  /** How many distinct datasets the cache can hold at once. Default 1 (back-compat). */
  readonly capacity: number;

  /**
   * The held slots, keyed by datasetId — at most {@link capacity} entries. Map
   * iteration order is insertion order, but eviction picks by freshness, not age
   * of insertion, so the order is irrelevant to the policy.
   */
  private slots = new Map<string, CachedSample>();

  constructor(nodeId = "mars", capacity = 1) {
    this.nodeId = nodeId;
    this.capacity = Math.max(1, Math.trunc(capacity));
  }

  /**
   * Back-compat single-slot accessor: the held sample when the cache holds exactly
   * one dataset, else null. The original single-slot tests + the snapshot path
   * read this; multi-slot callers use {@link peek} / {@link entries}.
   */
  get sample(): CachedSample | null {
    if (this.slots.size !== 1) return null;
    for (const s of this.slots.values()) return s;
    return null;
  }

  /** The sample held for `datasetId`, or null when no slot holds it. */
  peek(datasetId: string): CachedSample | null {
    return this.slots.get(datasetId) ?? null;
  }

  /** All held samples (for the render readout / eviction inspection). */
  entries(): CachedSample[] {
    return Array.from(this.slots.values());
  }

  /** Number of occupied slots — the OPEX driver (opex scales with held slots). */
  get occupied(): number {
    return this.slots.size;
  }

  /**
   * True if the cache currently holds an ARRIVED sample of `datasetId` at time t.
   * A prefetch that has not yet crossed the light-gap (capturedAtT > t) is NOT
   * yet a hit — this is what makes prefetch timing matter (M1-06).
   */
  holds(datasetId: string, t: number): boolean {
    const s = this.slots.get(datasetId);
    return s !== undefined && s.age(t) >= 0.0;
  }

  /**
   * Freshness of the held dataset at time t, or 0.0 if no slot holds it / it has
   * not arrived yet.
   */
  freshnessOf(datasetId: string, t: number): number {
    const s = this.slots.get(datasetId);
    if (s === undefined || s.age(t) < 0.0) return 0.0;
    return s.freshness(t);
  }

  /**
   * Store a sample for `datasetId`. If a slot already holds that dataset it is
   * OVERWRITTEN in place (a refresh — no eviction). Otherwise, when the cache is
   * full, EVICT the slot with the lowest CURRENT freshness at time t before
   * inserting (the simple, intuitive policy: drop the most-stale copy).
   *
   * `evictNowT` is the sim-time the freshness is judged at (the store instant).
   * It defaults to `capturedAtT` so the legacy single-slot signature still works,
   * but multi-slot callers pass the actual store time so eviction compares the
   * held copies' freshness AT STORE TIME (a just-arrived ≈0.84 copy never evicts a
   * fresher resident than itself by accident).
   */
  store(datasetId: string, capturedAtT: number, halfLifeS: number, evictNowT = capturedAtT): void {
    if (!this.slots.has(datasetId) && this.slots.size >= this.capacity) {
      this.evictStalest(evictNowT);
    }
    this.slots.set(datasetId, new CachedSample(datasetId, capturedAtT, halfLifeS));
  }

  /**
   * Evict the slot with the lowest freshness at time t. Deterministic: ties break
   * on the FIRST-inserted matching slot (Map iteration is insertion order), so the
   * choice is a pure function of the slot contents + t.
   */
  private evictStalest(t: number): void {
    let victim: string | null = null;
    let lowest = Number.POSITIVE_INFINITY;
    for (const [id, s] of this.slots) {
      const f = s.freshness(t);
      if (f < lowest) {
        lowest = f;
        victim = id;
      }
    }
    if (victim !== null) this.slots.delete(victim);
  }

  /** Drop the slot holding `datasetId` (no-op if absent). Pure. */
  evict(datasetId: string): void {
    this.slots.delete(datasetId);
  }

  /** Clear all slots (used by tests / blackout-eviction experiments). Pure. */
  clear(): void {
    this.slots.clear();
  }
}
