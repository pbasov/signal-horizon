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
import { DT } from "../clock";
import { oneWaySeconds } from "../delay";
import { Cache } from "./cache";
import { Demand } from "./demand";
import { Level } from "./coherence";
import { M1Economy, OPENING_BALANCE } from "./economy";
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
  /** On-hand balance (€) after this step's continuous accrual. */
  balance: number;
  /**
   * REVENUE RATE (€ per SIM-SECOND) for the current serve band — the money-IN
   * rate the FINANCE panel's REVENUE row reads. Positive while serving
   * (fresh/stale), 0 on a miss, and NEGATIVE during a blackout (the SLA penalty
   * rate). NOT a per-tick payout — a continuous per-sim-time rate.
   */
  revenueRatePerSecond: number;
  /**
   * OPEX RATE (€ per SIM-SECOND) to run the cache at the chosen coherence level
   * (baseline × costMultiplier) — the standing money-OUT rate. The FINANCE
   * panel's OPEX row.
   */
  opexRatePerSecond: number;
  /**
   * NET RATE (€ per SIM-SECOND): revenueRate − opexRate. >0 earning, <0 burning.
   * The FINANCE panel's NET row and the source of the runway.
   */
  netRatePerSecond: number;
  /** Sim-seconds until bankruptcy at the current net burn (+Inf when not burning). */
  runway: number;
  /** True once the balance has gone negative — the kill condition. */
  bankrupt: boolean;
  /**
   * Age (sim-seconds) of the data that was served this step, or null when the
   * serve did not come from the cache (a miss/blackout has no served sample).
   * The "AS-OF" universal-artifact stamp reads this.
   */
  servedAgeSeconds: number | null;
  /**
   * The DERIVED € value of keeping data fresh: the price gap between a fresh serve
   * and a bottom-of-band (min-acceptable) serve for THIS demand —
   * price(freshFreshness) − price(minAcceptableFreshness) (= €600 at defaults).
   * NOT a hardcoded flavour string; the live demand's own price curve produces it.
   */
  freshnessPremium: number;
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
    openingBalance = OPENING_BALANCE,
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
   * ECONOMY (reworked): the wallet accrues on CONTINUOUS PER-SIM-TIME RATES, not
   * per-tick payouts. Each step accrues (revenueRate(band) − opexRate(coherence))
   * × `dtSeconds` of elapsed sim-time, so the balance is DT-INVARIANT — running to
   * the same sim-time at 1× or 1000× yields the same balance. A fresh serve is
   * net-positive, stale ≈ break-even, a miss pays no income (net-negative on opex
   * alone), and a blackout adds an SLA penalty rate (the deepest burn).
   *
   * `dtSeconds` is the step's elapsed sim-time (defaults to one fixed {@link DT}
   * step). The live loop and replay pass the clock's dt so the accrual matches
   * the sim-time the step advanced.
   */
  step(eph: Ephemeris, t: number, dtSeconds: number = DT): SessionRenderState {
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

    // 3. Economy: accrue this step's net flow over its elapsed sim-time —
    //    (revenueRate(band) − opexRate(coherence)) × dtSeconds — through the
    //    economy's single mutation point. The balance is a pure, DT-invariant
    //    fold of the (deterministic) step sequence: same sim-time ⇒ same balance,
    //    independent of the tick rate.
    this.economy.accrue(result.outcome, result.viaCache, dtSeconds, this.coherence);

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
      // The continuous per-sim-second rates the FINANCE panel reads. Revenue is
      // keyed by the current band (negative during a blackout: the SLA penalty);
      // opex is the standing cost at the chosen coherence level.
      revenueRatePerSecond: this.economy.revenueRate(result.outcome),
      opexRatePerSecond: this.economy.opexRate(this.coherence),
      netRatePerSecond: this.economy.netRatePerSecond(result.outcome, this.coherence),
      // Runway off the LIVE net burn (positive = losing money): balance / burn,
      // in sim-seconds. +Inf when breaking even or earning.
      runway: this.economy.runway(-this.economy.netRatePerSecond(result.outcome, this.coherence)),
      bankrupt: this.economy.bankrupt(),
      // servedAge is -1 on a miss/blackout (no served sample); surface null then.
      servedAgeSeconds: result.servedAge >= 0 ? result.servedAge : null,
      // The value of freshness, DERIVED from this demand's own price curve.
      freshnessPremium:
        this.demand.price(this.demand.freshFreshness) -
        this.demand.price(this.demand.minAcceptableFreshness),
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
