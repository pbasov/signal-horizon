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
 *     -> when t >= fetchArrivalT: STORE the sample, captured at the LAUNCH
 *        instant (a snapshot of Earth taken when the fetch left). It travelled
 *        one-way to Mars, so on arrival it is already one-way-light-time old:
 *        freshness == 2^(-oneWay/halfLife) ≈ 0.84 — physically honest, not 1.0.
 *        Subsequent resolves HIT for a real window (≈ 0.84 decaying to the 0.5
 *        floor ≈ 44 min) during which NO fetch is in flight ...
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
import { M1Economy } from "./economy";
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
  /** On-hand balance (currency units) after this step's payout + opex. */
  balance: number;
  /** The signed payout applied to the balance THIS step (resolve payout). */
  lastPayout: number;
  /** Ticks until bankruptcy at the current per-tick burn (+Inf when not burning). */
  runway: number;
  /** True once the balance has gone negative — the kill condition. */
  bankrupt: boolean;
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
  /** The economy's on-hand balance (currency units), copied by value. */
  balance: number;
}

export class M1Session {
  /** The standing demand (default mars_imagery, ramp price curve). */
  readonly demand: Demand;
  /** The one-slot Mars-orbit relay cache. */
  readonly cache: Cache;
  /** The chosen coherence level — feeds the per-tick opex cost multiplier (E3). */
  coherence: Level;
  /** The wallet: balance fed by served payouts, opex burn, and prefetch cost. */
  readonly economy: M1Economy;

  /** Whether a data-leg fetch is currently in flight (the crawling packet). */
  private fetchInFlight = false;
  /** Sim-time the in-flight fetch launched. */
  private fetchLaunchT = 0;
  /** Sim-time the in-flight fetch arrives at Mars (one-way data-leg ETA). */
  private fetchArrivalT = 0;

  constructor(
    demand: Demand = new Demand(),
    coherence: Level = Level.Eventual,
    openingBalance = 1000.0,
  ) {
    this.demand = demand;
    this.cache = new Cache(demand.customerId);
    this.coherence = coherence;
    this.economy = new M1Economy(openingBalance);
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
   * the very step it lands the demand resolves to a cache HIT (a one-way-old copy
   * lands at ≈ 0.84 freshness — a usable, stale-band hit; see step 1 below).
   *
   * ECONOMY (E3): each step charges one tick of cache opex (scaled by the chosen
   * coherence level's costMultiplier) and credits the served payout — so the
   * wallet breathes with the loop. A blackout_miss applies its NEGATIVE payout
   * (the -500 penalty); a fresh/stale hit credits the price; a miss pays 0.
   */
  step(eph: Ephemeris, t: number): SessionRenderState {
    // 1. Land any in-flight fetch that has crossed the light-gap by t. The
    //    sample is a SNAPSHOT OF EARTH taken at the fetch's LAUNCH instant, so
    //    its captured-at time is fetchLaunchT — NOT the arrival instant. On
    //    arrival the copy is already one-way-light-time old (it travelled the
    //    gap), so freshness(arrivalT) == 2^(-oneWay/halfLife) ≈ 0.84 for the
    //    ~923s Earth→Mars leg at the 3600s half-life — physically honest, not a
    //    free 1.0. This gives a real fresh-hit window (~0.84 decaying to the 0.5
    //    floor ≈ 44 min) during which NO fetch is in flight, so the loop
    //    BREATHES and the prefetch lever is available.
    if (this.fetchInFlight && t >= this.fetchArrivalT) {
      this.cache.store(this.demand.datasetId, this.fetchLaunchT, this.demand.freshnessHalfLifeS);
      this.fetchInFlight = false;
    }

    // 2. Evaluate the standing demand at t. linkOpen is computed here (the Sun
    //    is the conjunction occluder) so the resolver stays a pure function.
    const linkOpen = feasible(eph, t, this.demand.sourceId, this.demand.customerId, ["sun"]);
    const result = resolve(eph, t, this.demand, this.cache, linkOpen);

    // 3. Economy: burn one tick of cache opex (× coherence cost multiplier) for
    //    the one Mars-relay cache, then credit the served payout. Both go
    //    through the economy's single mutation point, so the balance is a pure
    //    fold of the (deterministic) step sequence.
    this.economy.chargeOpex(1, this.coherence);
    this.economy.applyPayout(result);

    // 4. A MISS with the link up and no fetch already crawling starts the data
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
      balance: this.economy.balance,
      lastPayout: result.payout,
      // Runway off the baseline per-tick opex burn (the standing cost floor).
      runway: this.economy.runway(this.economy.cacheOpexPerTick),
      bankrupt: this.economy.bankrupt(),
    };
  }

  /**
   * M1-06 — PLAYER-INITIATED PREFETCH: pre-position fresh data into the Mars
   * cache BEFORE the demand asks for it. When no fetch is already in flight,
   * this launches a data-leg fetch (Earth->Mars, the SAME crawl as a miss-driven
   * fetch) and charges the one-shot prefetch cost.
   *
   * TIMING IS THE GAME (M1-06): like a miss-fetch, the sample is captured at the
   * LAUNCH instant and lands one-way light time later already ≈ 0.84 fresh (NOT a
   * freshness boost — a prefetch's data is one-way old too). Its value is TIMING /
   * COVERAGE: an EARLY prefetch lands a copy the cache holds, and — issued before
   * a conjunction — that copy serves THROUGH the blackout (no -500 penalty).
   * Issued too LATE the demand misses before the prefetch lands; issued
   * WASTEFULLY early the € is spent for a copy that decays before it is needed.
   *
   * GATED against spamming: a prefetch is a no-op (no fetch launched, NO charge)
   * while a fetch is already crawling — exactly one fetch in flight at a time.
   * Returns true iff it actually launched a fetch (and charged).
   */
  prefetch(eph: Ephemeris, t: number): boolean {
    if (this.fetchInFlight) return false; // one fetch in flight — gate the spam.
    const d = eph.distanceBetween(this.demand.sourceId, this.demand.customerId, t);
    this.fetchLaunchT = t;
    this.fetchArrivalT = t + oneWaySeconds(d);
    this.fetchInFlight = true;
    this.economy.chargePrefetch();
    return true;
  }

  /** Capture mutable session state by value for a fast-load snapshot. */
  snapshot(): SessionSnapshot {
    const s = this.cache.sample;
    return {
      fetchInFlight: this.fetchInFlight,
      fetchLaunchT: this.fetchLaunchT,
      fetchArrivalT: this.fetchArrivalT,
      cache: s == null ? null : { datasetId: s.datasetId, capturedAtT: s.capturedAtT, halfLifeS: s.halfLifeS },
      balance: this.economy.balance,
    };
  }

  /** Restore mutable session state from a snapshot (the ephemeris is unchanged). */
  restore(s: SessionSnapshot): void {
    this.fetchInFlight = s.fetchInFlight;
    this.fetchLaunchT = s.fetchLaunchT;
    this.fetchArrivalT = s.fetchArrivalT;
    if (s.cache == null) this.cache.clear();
    else this.cache.store(s.cache.datasetId, s.cache.capturedAtT, s.cache.halfLifeS);
    this.economy.balance = s.balance;
  }
}
