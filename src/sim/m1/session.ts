/**
 * M1-05 — M1Session: the LIVE cache-miss → fetch → arrive → hit loop.
 *
 * This is the hinge of the fun-gate. The proven-but-inert M1 models (Demand,
 * Cache, Coherence, Resolver) are stitched into ONE standing demand that is
 * evaluated continuously on SIM time, so the player can WATCH the loop breathe:
 *
 *   MISS (cache empty/stale, link open)
 *     -> START a fetch of the data leg Earth->Mars (the crawling packet)
 *        record fetchLaunchT = t, fetchArrivalT = t + oneWay(distance @ t)
 *     -> when t >= fetchArrivalT: STORE a fresh sample captured at the arrival
 *        instant; subsequent resolves HIT (fresh) ...
 *     -> ... until cache freshness decays below the demand's min-acceptable,
 *        which produces the NEXT miss -> the loop BREATHES.
 *
 *   BLACKOUT (link DOWN and no usable cache): do NOT start a fetch — expose a
 *   blackout flag (the fresh prefetch BEFORE the link closed is what avoids it).
 *
 * PURE + DETERMINISTIC: a pure function of (eph, t, prior state). No three / DOM
 * / wall-clock / RNG. The resolver computes the round-trip economic waitSeconds;
 * for E2 the VISIBLE countdown is driven off the one-way DATA-LEG arrival — the
 * leg the player actually watches crawl Earth->Mars. {@link step} mutates this
 * object's state and returns the render-facing snapshot.
 */
import type { Ephemeris } from "../ephemeris";
import { oneWaySeconds } from "../delay";
import { Cache } from "./cache";
import { Demand } from "./demand";
import { Level } from "./coherence";
import { feasible, resolve, type ResolveOutcome } from "./resolver";

/**
 * The render-facing state the orrery + panels read. A pure projection of the
 * session's internal state after the latest {@link M1Session.step}.
 */
export interface SessionRenderState {
  /** Latest resolve outcome at this instant ("fresh"/"stale"/"miss"/"blackout_miss"). */
  outcome: ResolveOutcome;
  /** Whether the serve came from the local Mars cache (a hit). */
  viaCache: boolean;
  /** Current Mars cache freshness for the demanded dataset, in [0,1] (0 = no usable copy). */
  cacheFreshness: number;
  /** True while a data-leg fetch is crawling Earth->Mars. */
  fetchInFlight: boolean;
  /**
   * Seconds until the in-flight fetch arrives (fetchArrivalT - t), clamped >= 0,
   * or null when no fetch is in flight. THE visible countdown.
   */
  fetchCountdownSeconds: number | null;
  /** True when the link is down AND there is no usable cache (a blackout miss). */
  blackout: boolean;
}

/** JSON-safe capture of the session's mutable fetch state (for save/restore parity). */
export interface SessionSnapshot {
  /** Whether a data-leg fetch is currently crawling Earth->Mars. */
  fetchInFlight: boolean;
  /** Sim-time the in-flight fetch launched (meaningful only when fetchInFlight). */
  fetchLaunchT: number;
  /** Sim-time the in-flight fetch arrives (meaningful only when fetchInFlight). */
  fetchArrivalT: number;
  /** The cache sample, copied by value, or null when the slot is empty. */
  cache: { datasetId: string; capturedAtT: number; halfLifeS: number } | null;
}

export class M1Session {
  /** The standing demand (default mars_imagery, ramp price curve). */
  readonly demand: Demand;
  /** The one-slot Mars-orbit relay cache. */
  readonly cache: Cache;
  /** The chosen coherence level (informational for E2; economy lands in E3). */
  coherence: Level;

  /** Whether a data-leg fetch is currently in flight (the crawling packet). */
  private fetchInFlight = false;
  /** Sim-time the in-flight fetch launched. */
  private fetchLaunchT = 0;
  /** Sim-time the in-flight fetch arrives at Mars (one-way data-leg ETA). */
  private fetchArrivalT = 0;

  constructor(demand: Demand = new Demand(), coherence: Level = Level.Eventual) {
    this.demand = demand;
    this.cache = new Cache(demand.customerId);
    this.coherence = coherence;
  }

  /** True iff a data-leg fetch is crawling Earth->Mars right now. */
  get isFetching(): boolean {
    return this.fetchInFlight;
  }

  /** Sim-time the in-flight fetch arrives (only meaningful while {@link isFetching}). */
  get arrivalT(): number {
    return this.fetchArrivalT;
  }

  /** Sim-time the in-flight fetch launched (only meaningful while {@link isFetching}). */
  get launchT(): number {
    return this.fetchLaunchT;
  }

  /**
   * Advance the standing demand to sim-time t. PURE of (eph, t, prior state):
   * the same inputs from the same prior state always produce the same mutation
   * and the same render snapshot.
   *
   * Ordering matters: a fetch that arrives AT t is stored BEFORE the resolve, so
   * the very step it lands the demand resolves to a fresh HIT.
   */
  step(eph: Ephemeris, t: number): SessionRenderState {
    // 1. Land any in-flight fetch that has crossed the light-gap by t. The
    //    sample is captured at the ARRIVAL instant (freshness == 1 at arrival),
    //    using the demand's half-life so age->freshness is the shared curve.
    if (this.fetchInFlight && t >= this.fetchArrivalT) {
      this.cache.store(this.demand.datasetId, this.fetchArrivalT, this.demand.freshnessHalfLifeS);
      this.fetchInFlight = false;
    }

    // 2. Evaluate the standing demand at t. linkOpen is computed here (the Sun
    //    is the conjunction occluder) so the resolver stays a pure function.
    const linkOpen = feasible(eph, t, this.demand.sourceId, this.demand.customerId, ["sun"]);
    const result = resolve(eph, t, this.demand, this.cache, linkOpen);

    // 3. A MISS with the link up and no fetch already crawling starts the data
    //    leg: the packet the player watches. Its one-way ETA is the countdown.
    if (result.outcome === "miss" && !this.fetchInFlight) {
      const d = eph.distanceBetween(this.demand.sourceId, this.demand.customerId, t);
      this.fetchLaunchT = t;
      this.fetchArrivalT = t + oneWaySeconds(d);
      this.fetchInFlight = true;
    }
    // blackout_miss (link down, no usable cache) does NOT start a fetch.

    return {
      outcome: result.outcome,
      viaCache: result.viaCache,
      cacheFreshness: this.cache.freshnessOf(this.demand.datasetId, t),
      fetchInFlight: this.fetchInFlight,
      fetchCountdownSeconds: this.fetchInFlight ? Math.max(0, this.fetchArrivalT - t) : null,
      blackout: result.outcome === "blackout_miss",
    };
  }

  /** Capture mutable session state by value for a fast-load snapshot. */
  snapshot(): SessionSnapshot {
    const s = this.cache.sample;
    return {
      fetchInFlight: this.fetchInFlight,
      fetchLaunchT: this.fetchLaunchT,
      fetchArrivalT: this.fetchArrivalT,
      cache: s == null ? null : { datasetId: s.datasetId, capturedAtT: s.capturedAtT, halfLifeS: s.halfLifeS },
    };
  }

  /** Restore mutable session state from a snapshot (the ephemeris is unchanged). */
  restore(s: SessionSnapshot): void {
    this.fetchInFlight = s.fetchInFlight;
    this.fetchLaunchT = s.fetchLaunchT;
    this.fetchArrivalT = s.fetchArrivalT;
    if (s.cache == null) this.cache.clear();
    else this.cache.store(s.cache.datasetId, s.cache.capturedAtT, s.cache.halfLifeS);
  }
}
