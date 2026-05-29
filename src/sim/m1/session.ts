/**
 * E7 (M1-04/05 plural) — M1Session: the LIVE multi-feed cache loop.
 *
 * This generalises the proven SINGLE-feed loop to N SIMULTANEOUS feeds sharing a
 * SCARCE multi-slot cache — the hand-management STRAIN that GDD §3a/§3b + plan
 * v0.2.1 make the core of M1. With fewer slots than feeds you cannot keep them all
 * cached, so the contention IS the game; the relief comes in E8's prefetch policy.
 *
 * Each feed runs its OWN copy of the proven loop against the SHARED cache:
 *
 *   MISS (its dataset is absent/stale, link open)
 *     -> START a fetch of ITS data leg Earth->Mars (its own crawling packet),
 *        recording the feed's launchT and arrivalT = launchT + oneWay(distance).
 *     -> on arrival STORE the sample into a slot, captured at the LAUNCH instant
 *        (a snapshot taken when the fetch left), so on arrival it is already
 *        one-way-light-time old (≈0.84 fresh) — physically honest. Storing into a
 *        FULL cache EVICTS the slot with the lowest current freshness (the cache's
 *        policy). A feed serves a HIT only while ITS dataset is in a slot AND fresh
 *        enough; otherwise the slot it needs may have been evicted by a rival feed
 *        — the strain.
 *
 *   BLACKOUT (link DOWN, no usable cache for that feed): no fetch starts; the feed
 *   takes the SLA penalty unless a pre-positioned slot serves it through.
 *
 * PURE + DETERMINISTIC: step() is a pure function of (eph, t, prior state). No
 * three / DOM / wall-clock / RNG. Snapshot/restore covers every feed's fetch state
 * + every cache slot + the wallet, so save/replay reproduce the whole roster.
 */
import type { Ephemeris } from "../ephemeris";
import { DT } from "../clock";
import { oneWaySeconds } from "../delay";
import { Cache } from "./cache";
import { Demand } from "./demand";
import { Level } from "./coherence";
import { M1Economy, OPENING_BALANCE, OPEX_RATE_PER_SECOND, revenueRatePerSecond } from "./economy";
import { costMultiplier } from "./coherence";
import { feasible, resolve, type ResolveOutcome } from "./resolver";
import { buildFeeds, CACHE_SLOTS } from "./feeds";

/** Per-feed mutable fetch state — one in-flight data leg per feed at most. */
interface FetchState {
  inFlight: boolean;
  launchT: number;
  arrivalT: number;
}

/** The render-facing readout for ONE feed after the latest {@link M1Session.step}. */
export interface FeedRenderState {
  /** Stable feed identity (mars_imagery, …). */
  id: string;
  /** The dataset this feed serves (the cache key). */
  datasetId: string;
  /** Latest resolve outcome ("fresh"/"stale"/"miss"/"blackout_miss"). */
  outcome: ResolveOutcome;
  /** Whether the serve came from the shared Mars cache (a hit). */
  viaCache: boolean;
  /** Current Mars cache freshness for THIS feed's dataset, in [0,1] (0 = no slot). */
  cacheFreshness: number;
  /** True while THIS feed's data-leg fetch is crawling Earth->Mars. */
  fetchInFlight: boolean;
  /** Seconds until this feed's in-flight fetch arrives, or null when none. */
  fetchCountdownSeconds: number | null;
  /** True when the link is down AND this feed has no usable cache. */
  blackout: boolean;
  /** Age (sim-seconds) of the data served this step, or null on a non-cache serve. */
  servedAgeSeconds: number | null;
  /** The € value of keeping THIS feed fresh: price(fresh) − price(min). */
  freshnessPremium: number;
}

/**
 * The render-facing state the orrery + panels read after a step: the PER-FEED
 * readouts plus the AGGREGATE economy (summed over feeds). A pure projection.
 */
export interface SessionRenderState {
  /** One readout per feed, in roster order. */
  feeds: FeedRenderState[];
  /** Occupied cache slots / total capacity (the contention readout). */
  slotsUsed: number;
  slotCapacity: number;

  // --- AGGREGATE economy (the FINANCE panel reads these) ---
  /** On-hand balance (€) after this step's accrual. */
  balance: number;
  /** Summed REVENUE RATE (€/sim-second) across all feeds (negative parts = blackout SLA). */
  revenueRatePerSecond: number;
  /** Total OPEX RATE (€/sim-second): per-slot baseline × occupied slots × coherence. */
  opexRatePerSecond: number;
  /** NET RATE (€/sim-second): summed revenue − opex. >0 earning, <0 burning. */
  netRatePerSecond: number;
  /** Sim-seconds until bankruptcy at the current net burn (+Inf when not burning). */
  runway: number;
  /** True once the balance has gone negative — the kill condition. */
  bankrupt: boolean;
  /** Total data-leg fetches crawling Earth->Mars right now (across all feeds). */
  fetchesInFlight: number;
  /** Peak cache freshness across the held slots, in [0,1] (the Mars-node saturation). */
  peakCacheFreshness: number;
}

/** JSON-safe per-feed fetch capture. */
export interface FeedFetchSnapshot {
  id: string;
  fetchInFlight: boolean;
  fetchLaunchT: number;
  fetchArrivalT: number;
}

/** JSON-safe per-slot capture. */
export interface SlotSnapshot {
  datasetId: string;
  capturedAtT: number;
  halfLifeS: number;
}

/** JSON-safe capture of the whole session's mutable state (save/restore parity). */
export interface SessionSnapshot {
  /** Per-feed fetch state, in roster order. */
  feeds: FeedFetchSnapshot[];
  /** The occupied cache slots, by value. */
  slots: SlotSnapshot[];
  /** The economy's on-hand balance, by value. */
  balance: number;
}

export class M1Session {
  /** The feed roster (default: the 5 Mars feeds from feeds.ts). */
  readonly feeds: Demand[];
  /** The SHARED multi-slot Mars-orbit relay cache (default 3 slots). */
  readonly cache: Cache;
  /** The chosen coherence level — feeds the opex cost multiplier. */
  coherence: Level;
  /** The shared wallet across all feeds. */
  readonly economy: M1Economy;

  /** Per-feed fetch state, keyed by feed id (one in-flight leg per feed). */
  private fetches = new Map<string, FetchState>();

  constructor(
    feeds: Demand[] = buildFeeds(),
    coherence: Level = Level.Eventual,
    openingBalance = OPENING_BALANCE,
    slotCapacity = CACHE_SLOTS,
  ) {
    this.feeds = feeds;
    this.cache = new Cache("mars", slotCapacity);
    this.coherence = coherence;
    this.economy = new M1Economy(openingBalance);
    for (const f of this.feeds) {
      this.fetches.set(f.id, { inFlight: false, launchT: 0, arrivalT: 0 });
    }
  }

  /** True iff ANY feed has a data leg in flight right now. */
  get isFetching(): boolean {
    for (const fs of this.fetches.values()) if (fs.inFlight) return true;
    return false;
  }

  /** The fetch state for a feed (throws on an unknown id — feeds are fixed). */
  private fetchOf(id: string): FetchState {
    const fs = this.fetches.get(id);
    if (fs === undefined) throw new Error(`unknown feed: ${id}`);
    return fs;
  }

  /** True iff THIS feed's data leg is in flight. */
  isFetchingFeed(id: string): boolean {
    return this.fetchOf(id).inFlight;
  }

  /** Arrival sim-time of THIS feed's in-flight fetch (meaningful only while in flight). */
  arrivalTOf(id: string): number {
    return this.fetchOf(id).arrivalT;
  }

  /** Launch sim-time of THIS feed's in-flight fetch (meaningful only while in flight). */
  launchTOf(id: string): number {
    return this.fetchOf(id).launchT;
  }

  /**
   * Advance ALL feeds to sim-time t over `dtSeconds` of elapsed sim-time. PURE of
   * (eph, t, prior state). Ordering, per feed: (1) land any arrival into the shared
   * cache BEFORE resolving, so the landing step is a hit; (2) resolve against the
   * cache; (3) on a miss with the link up and no leg already in flight for that
   * feed, start its fetch. After all feeds resolve, the economy accrues ONE summed
   * step: Σ revenueRate(feed band) over feeds, minus opex for the occupied slots.
   *
   * The accrual is a single fold over dtSeconds, so the balance is DT-invariant
   * (same sim-time ⇒ same balance at 1× or 1000×).
   */
  step(eph: Ephemeris, t: number, dtSeconds: number = DT): SessionRenderState {
    // 1. LAND arrivals first, across every feed, so a feed that lands its sample
    //    this step resolves to a hit immediately. Eviction (if the cache is full)
    //    is judged at the store instant t.
    for (const feed of this.feeds) {
      const fs = this.fetchOf(feed.id);
      if (fs.inFlight && t >= fs.arrivalT) {
        this.cache.store(feed.datasetId, fs.launchT, feed.freshnessHalfLifeS, t);
        fs.inFlight = false;
      }
    }

    // 2. RESOLVE every feed against the shared cache + its own link feasibility.
    const feedStates: FeedRenderState[] = [];
    let summedRevenueRate = 0;
    for (const feed of this.feeds) {
      const linkOpen = feasible(eph, t, feed.sourceId, feed.customerId, ["sun"]);
      const result = resolve(eph, t, feed, this.cache, linkOpen);
      summedRevenueRate += revenueRatePerSecond(result.outcome);

      // 3. A MISS with the link up and no leg already crawling for THIS feed starts
      //    its data leg. blackout_miss (link down) does NOT start a fetch.
      const fs = this.fetchOf(feed.id);
      if (result.outcome === "miss" && !fs.inFlight) {
        const d = eph.distanceBetween(feed.sourceId, feed.customerId, t);
        fs.launchT = t;
        fs.arrivalT = t + oneWaySeconds(d);
        fs.inFlight = true;
      }

      feedStates.push({
        id: feed.id,
        datasetId: feed.datasetId,
        outcome: result.outcome,
        viaCache: result.viaCache,
        cacheFreshness: this.cache.freshnessOf(feed.datasetId, t),
        fetchInFlight: fs.inFlight,
        fetchCountdownSeconds: fs.inFlight ? Math.max(0, fs.arrivalT - t) : null,
        blackout: result.outcome === "blackout_miss",
        servedAgeSeconds: result.servedAge >= 0 ? result.servedAge : null,
        freshnessPremium: feed.price(feed.freshFreshness) - feed.price(feed.minAcceptableFreshness),
      });
    }

    // 4. ECONOMY: one summed accrual over this step's dt. Revenue is the sum across
    //    feeds (each band's rate); opex scales with the OCCUPIED slots (you pay to
    //    run each held slot) × the coherence cost multiplier. The balance is a pure,
    //    DT-invariant fold of the deterministic step sequence.
    const opexRate = this.opexRatePerSecond();
    this.economy.apply((summedRevenueRate - opexRate) * dtSeconds);

    const netRate = summedRevenueRate - opexRate;
    return {
      feeds: feedStates,
      slotsUsed: this.cache.occupied,
      slotCapacity: this.cache.capacity,
      balance: this.economy.balance,
      revenueRatePerSecond: summedRevenueRate,
      opexRatePerSecond: opexRate,
      netRatePerSecond: netRate,
      runway: this.economy.runway(-netRate),
      bankrupt: this.economy.bankrupt(),
      fetchesInFlight: this.countFetchesInFlight(),
      peakCacheFreshness: this.peakCacheFreshness(t),
    };
  }

  /**
   * The standing opex RATE (€/sim-second): per-slot baseline × OCCUPIED slots ×
   * coherence cost multiplier. An empty cache still pays a one-slot baseline floor
   * so an idle, never-caching network is never free (it still burns) — survivable
   * per E6a's model but never a no-cost strategy.
   */
  opexRatePerSecond(): number {
    const slots = Math.max(1, this.cache.occupied); // floor of one slot's worth of opex.
    return OPEX_RATE_PER_SECOND * slots * costMultiplier(this.coherence);
  }

  /** Count feeds with a data leg in flight. */
  private countFetchesInFlight(): number {
    let n = 0;
    for (const fs of this.fetches.values()) if (fs.inFlight) n++;
    return n;
  }

  /** Highest freshness across the held slots at t, in [0,1] (0 when empty). */
  private peakCacheFreshness(t: number): number {
    let peak = 0;
    for (const s of this.cache.entries()) {
      const f = s.freshness(t);
      if (f > peak) peak = f;
    }
    return peak;
  }

  /**
   * M1-06 (plural) — PLAYER-INITIATED MANUAL PREFETCH: pre-position fresh data for
   * the MOST-URGENT eligible feed. "Urgent" = the lowest current cache freshness
   * among feeds that are ELIGIBLE: the link is up AND no leg is already in flight
   * for that feed (one leg per feed). Launches that feed's data leg and charges the
   * one-shot prefetch cost. Returns the feed id it targeted, or null when nothing
   * is eligible (every feed already fetching, or every link down).
   *
   * E8 will add the STANDING policy; this is the manual lever. Per-feed targeting
   * can refine later (the lowest-freshness pick is the simple, intuitive default).
   */
  prefetch(eph: Ephemeris, t: number): string | null {
    const target = this.pickPrefetchTarget(eph, t);
    if (target === null) return null;
    const d = eph.distanceBetween(target.sourceId, target.customerId, t);
    const fs = this.fetchOf(target.id);
    fs.launchT = t;
    fs.arrivalT = t + oneWaySeconds(d);
    fs.inFlight = true;
    this.economy.chargePrefetch();
    return target.id;
  }

  /**
   * The feed a manual prefetch would target at t: among feeds with the link UP and
   * NO leg in flight, the one with the lowest current cache freshness (an empty
   * slot reads 0 freshness → most urgent). Deterministic: ties break on roster
   * order. Returns null when no feed is eligible. PURE.
   */
  pickPrefetchTarget(eph: Ephemeris, t: number): Demand | null {
    let best: Demand | null = null;
    let bestFreshness = Number.POSITIVE_INFINITY;
    for (const feed of this.feeds) {
      if (this.fetchOf(feed.id).inFlight) continue; // already crawling a leg.
      if (!feasible(eph, t, feed.sourceId, feed.customerId, ["sun"])) continue; // link down.
      const f = this.cache.freshnessOf(feed.datasetId, t);
      if (f < bestFreshness) {
        bestFreshness = f;
        best = feed;
      }
    }
    return best;
  }

  /** Capture all mutable session state by value for a fast-load snapshot. */
  snapshot(): SessionSnapshot {
    const feeds: FeedFetchSnapshot[] = this.feeds.map((feed) => {
      const fs = this.fetchOf(feed.id);
      return { id: feed.id, fetchInFlight: fs.inFlight, fetchLaunchT: fs.launchT, fetchArrivalT: fs.arrivalT };
    });
    const slots: SlotSnapshot[] = this.cache
      .entries()
      .map((s) => ({ datasetId: s.datasetId, capturedAtT: s.capturedAtT, halfLifeS: s.halfLifeS }));
    return { feeds, slots, balance: this.economy.balance };
  }

  /** Restore all mutable session state from a snapshot (the ephemeris is unchanged). */
  restore(s: SessionSnapshot): void {
    for (const fsnap of s.feeds) {
      const fs = this.fetches.get(fsnap.id);
      if (fs === undefined) continue; // tolerate roster changes across saves.
      fs.inFlight = fsnap.fetchInFlight;
      fs.launchT = fsnap.fetchLaunchT;
      fs.arrivalT = fsnap.fetchArrivalT;
    }
    this.cache.clear();
    for (const slot of s.slots) {
      // Restore directly; capacity is honoured by the original store sequence, and
      // a saved snapshot never exceeds capacity.
      this.cache.store(slot.datasetId, slot.capturedAtT, slot.halfLifeS, slot.capturedAtT);
    }
    this.economy.balance = s.balance;
  }
}
