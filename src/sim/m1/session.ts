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
import { oneWaySeconds, freshness as delayFreshness } from "../delay";
import { Cache } from "./cache";
import { Demand } from "./demand";
import { Level } from "./coherence";
import { M1Economy, OPENING_BALANCE, OPEX_RATE_PER_SECOND, revenueRatePerSecond } from "./economy";
import { costMultiplier } from "./coherence";
import { feasible, resolve, type ResolveOutcome } from "./resolver";
import { buildFeeds, CACHE_SLOTS } from "./feeds";
import {
  defaultPolicy,
  selectAutoPrefetches,
  type PrefetchPolicy,
  type PolicyFeedState,
} from "./policy";
import { EventLog, type PrefetchKind } from "./eventlog";
import { PREFETCH_COST } from "./economy";

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

  // --- E8 prefetch POLICY (the tame-it lever) readout ---
  /** The active policy mode the autopilot is running. */
  policyMode: PrefetchPolicy["mode"];
  /** The freshness floor the autopilot tops up to (the tunable knob), in [0,1]. */
  policyFloor: number;
  /** Feed ids the AUTOPILOT launched a leg for THIS step (the relief, firing). */
  autoPrefetched: string[];
  /** True iff at least one of this step's auto-prefetches was a blackout pre-stage. */
  autoBlackoutPrestage: boolean;
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
  /** E8 — the standing prefetch policy (so save/load round-trips the lever). */
  policy: PrefetchPolicy;
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

  /**
   * E8 — the STANDING prefetch policy (the tame-it lever). Default mode "manual"
   * so out-of-the-box behaviour is UNCHANGED (only the P key acts); the player
   * raises the unit of command to "declared intent" by switching it on. Changing
   * it is a logged player action; the autopilot's per-step choices it drives are
   * DERIVED inside step() and need no logging (the determinism contract).
   */
  policy: PrefetchPolicy = defaultPolicy();

  /**
   * E9 (M1-10b) — THE TRUTHFUL EVENT LOG (the §4.12 parse seed). An append-only,
   * deterministic stream of {@link M1Event}s emitted PURELY from this session's
   * state transitions (edge-triggered, never per-tick level). It is a DERIVED
   * side-output: kept OUT of the snapshot/state-hash (the canonical state is
   * balance/cache/fetch/policy), so the replay golden is unchanged — but because
   * the emitters fire off deterministic state transitions, the stream itself
   * replays bit-identically (proven in eventlog-replay coverage). UNBOUNDED here
   * (the recording log); the live panel reads a bounded view.
   */
  readonly events = new EventLog();

  /** Per-feed PRIOR serve band (for edge-triggered serve-transition logging). null = unseen. */
  private prevBand = new Map<string, ResolveOutcome | null>();
  /** Per-feed PRIOR link feasibility (for edge-triggered blackout enter/exit). null = unseen. */
  private prevFeasible = new Map<string, boolean | null>();
  /** PRIOR policy mode (so a CHANGE logs once, from→to). undefined = unseen. */
  private prevPolicyMode: PrefetchPolicy["mode"] | undefined = undefined;

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
      this.prevBand.set(f.id, null);
      this.prevFeasible.set(f.id, null);
    }
  }

  /**
   * Derive the integer fixed-step tick from a sim-time + this step's dt. tSim is
   * always tick·dt (the clock hands us tick·dt), so a round recovers the tick
   * exactly at the fixed DT the replay uses; at coarser live dt it still names the
   * tick the event happened on. Pure, no clock dependency.
   */
  private tickOf(t: number, dtSeconds: number): number {
    return dtSeconds > 0 ? Math.round(t / dtSeconds) : 0;
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

  /** The Demand for a feed id (throws on an unknown id — feeds are fixed). */
  private feedById(id: string): Demand {
    const f = this.feeds.find((feed) => feed.id === id);
    if (f === undefined) throw new Error(`unknown feed: ${id}`);
    return f;
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
   * (eph, t, prior state). Ordering: (1) land any arrivals into the shared cache
   * BEFORE resolving, so a landing step is a hit; (2) E8 AUTOPILOT — the standing
   * prefetch policy reacts to the freshly-landed cache and launches its top-ups
   * (a PURE function of policy + state, so replay needs no logging); (3) resolve
   * every feed against the cache; (4) on a miss with the link up and no leg already
   * in flight, start a natural miss-fetch (the autopilot's no-leg launches above
   * suppress the double-fire); (5) the economy accrues ONE summed step: Σ
   * revenueRate(feed band) over feeds, minus opex for the occupied slots.
   *
   * The accrual itself is a single fold over dtSeconds, so the per-step REVENUE/OPEX
   * is DT-invariant (the same band held for the same sim-time accrues the same € at
   * 1× or 1000×). NOTE the autopilot (step 2) is the one piece that is NOT bit-DT-
   * invariant: it evaluates once per tick, so a coarser dt samples the policy at
   * different sim-instants and launches legs at slightly different moments → a
   * different balance. That is fine for the determinism contract, which is fixed-dt:
   * REPLAY always re-steps at DT (1/60), so a recorded run is bit-identical, and
   * LIVE==REPLAY holds across all frame-slicings/scales at that fixed dt. (The
   * manual/prefetch-only path, with no per-tick autopilot, IS bit-DT-invariant.)
   */
  step(eph: Ephemeris, t: number, dtSeconds: number = DT): SessionRenderState {
    const tick = this.tickOf(t, dtSeconds);

    // 1. LAND arrivals first, across every feed, so a feed that lands its sample
    //    this step resolves to a hit immediately. Eviction (if the cache is full)
    //    is judged at the store instant t. Each landing emits the TRUTHFUL trio:
    //    fetch_arrive (the real landed freshness — replacing the old stale "0.50"
    //    flavour lie), the cache_evict it forced (which dataset, how stale), and
    //    the cache_store. Edge events, fired only when something HAPPENS.
    for (const feed of this.feeds) {
      const fs = this.fetchOf(feed.id);
      if (fs.inFlight && t >= fs.arrivalT) {
        // The freshness the just-arrived copy lands at (captured at launchT, now
        // one-way-light-time old) — the honest number, ≈0.75-and-decaying.
        const landed = delayFreshness(t - fs.launchT, feed.freshnessHalfLifeS);
        this.events.push((seq) => ({
          kind: "fetch_arrive",
          seq,
          tick,
          tSim: t,
          feedId: feed.id,
          datasetId: feed.datasetId,
          landedFreshness: landed,
        }));
        // Log the eviction this store WILL force (before it mutates the cache) so
        // the record names the victim + how stale it was — the §4.12 "evicted the
        // wrong dataset" line item.
        const victim = this.cache.evictionVictim(feed.datasetId, t);
        if (victim !== null) {
          const vf = this.cache.freshnessOf(victim, t);
          this.events.push((seq) => ({
            kind: "cache_evict",
            seq,
            tick,
            tSim: t,
            datasetId: victim,
            freshness: vf,
            forBy: feed.datasetId,
            reason: "lowest_freshness",
          }));
        }
        this.cache.store(feed.datasetId, fs.launchT, feed.freshnessHalfLifeS, t);
        fs.inFlight = false;
        this.events.push((seq) => ({
          kind: "cache_store",
          seq,
          tick,
          tSim: t,
          datasetId: feed.datasetId,
          freshness: landed,
          slotsUsed: this.cache.occupied,
          slotCapacity: this.cache.capacity,
        }));
      }
    }

    // 2. AUTOPILOT (E8 — the tame-it lever). The standing policy reacts to the
    //    FRESHLY-LANDED cache: a pure function of (policy, state, geometry, t)
    //    picks which feeds to top up THIS step, then we launch each leg + charge
    //    €50. Because the selection is PURE and happens INSIDE step(), replay
    //    reproduces these auto-prefetches with NO logging — only a CHANGE to the
    //    policy is a recorded player intent. The no-leg guard below (step 4) means
    //    a feed the autopilot just launched does not also fire a natural miss-fetch.
    const autoPrefetched: string[] = [];
    let autoBlackoutPrestage = false;
    if (this.policy.mode !== "manual") {
      const pfStates: PolicyFeedState[] = this.feeds.map((feed) => ({
        id: feed.id,
        datasetId: feed.datasetId,
        sourceId: feed.sourceId,
        customerId: feed.customerId,
        inFlight: this.fetchOf(feed.id).inFlight,
      }));
      const targets = selectAutoPrefetches(this.policy, pfStates, this.cache, eph, t);
      for (const id of targets) {
        const feed = this.feedById(id);
        const fs = this.fetchOf(id);
        // selectAutoPrefetches only returns eligible (link-up, no-leg) feeds, but
        // re-check the guard defensively so we never double-launch a leg.
        if (fs.inFlight) continue;
        // A blackout pre-stage is one where the link is up now but forecast down
        // within the lead — record it for the render cue (the relief firing).
        const isPrestage =
          this.policy.mode === "freshness_blackout" &&
          !feasible(eph, t + this.policy.blackoutLeadS, feed.sourceId, feed.customerId, ["sun"]);
        if (isPrestage) autoBlackoutPrestage = true;
        const d = eph.distanceBetween(feed.sourceId, feed.customerId, t);
        const eta = oneWaySeconds(d);
        fs.launchT = t;
        fs.arrivalT = t + eta;
        fs.inFlight = true;
        this.economy.chargePrefetch();
        autoPrefetched.push(id);
        // The autopilot fired a leg — log it as the prefetch it is (auto top-up vs
        // blackout pre-stage), carrying the leg's ETA + the €50 charged. This is
        // the §4.4 skill made legible (and later, timely-vs-wasted analysable).
        const cause: PrefetchKind = isPrestage ? "prestage" : "auto";
        this.events.push((seq) => ({
          kind: "prefetch",
          seq,
          tick,
          tSim: t,
          feedId: feed.id,
          datasetId: feed.datasetId,
          cause,
          etaSeconds: eta,
          costEur: PREFETCH_COST,
        }));
      }
    }

    // 3. RESOLVE every feed against the shared cache + its own link feasibility.
    const feedStates: FeedRenderState[] = [];
    let summedRevenueRate = 0;
    for (const feed of this.feeds) {
      const linkOpen = feasible(eph, t, feed.sourceId, feed.customerId, ["sun"]);
      const result = resolve(eph, t, feed, this.cache, linkOpen);
      summedRevenueRate += revenueRatePerSecond(result.outcome);

      // BLACKOUT enter/exit — edge-triggered on the link feasibility flip. (Per
      // SD-22 the LoS never actually occults in the shipped ephemeris, so this
      // will not fire live yet; it is wired truthfully so when E10 makes a
      // conjunction blackout live-exercisable the record already carries it.)
      const wasFeasible = this.prevFeasible.get(feed.id);
      if (wasFeasible !== null && wasFeasible !== undefined && wasFeasible !== linkOpen) {
        this.events.push((seq) => ({
          kind: "blackout",
          seq,
          tick,
          tSim: t,
          feedId: feed.id,
          edge: linkOpen ? "exit" : "enter",
        }));
      }
      this.prevFeasible.set(feed.id, linkOpen);

      // SERVE band TRANSITION — the per-contract delivery truth, edge-triggered:
      // a feed going miss→fresh on a landing, fresh→stale as it decays, served→
      // miss/blackout. Logged only when the band actually CHANGES (never per-tick).
      const prevBand = this.prevBand.get(feed.id) ?? null;
      if (result.outcome !== prevBand) {
        const sev = result.outcome; // captured for the closure (avoids re-read).
        this.events.push((seq) => ({
          kind: "serve",
          seq,
          tick,
          tSim: t,
          feedId: feed.id,
          datasetId: feed.datasetId,
          band: sev,
          from: prevBand,
          freshness: result.servedFreshness,
          viaCache: result.viaCache,
        }));
        this.prevBand.set(feed.id, result.outcome);
      }

      // 4. A MISS with the link up and no leg already crawling for THIS feed starts
      //    its data leg. blackout_miss (link down) does NOT start a fetch. The
      //    autopilot above may already have launched this feed's leg — the
      //    !fs.inFlight guard then skips the natural miss-fetch (no double-fire).
      const fs = this.fetchOf(feed.id);
      if (result.outcome === "miss" && !fs.inFlight) {
        const d = eph.distanceBetween(feed.sourceId, feed.customerId, t);
        const eta = oneWaySeconds(d);
        fs.launchT = t;
        fs.arrivalT = t + eta;
        fs.inFlight = true;
        // A natural miss-fetch leg launched — the visible light-gap wait begins.
        this.events.push((seq) => ({
          kind: "fetch_launch",
          seq,
          tick,
          tSim: t,
          feedId: feed.id,
          datasetId: feed.datasetId,
          etaSeconds: eta,
          cause: "miss",
        }));
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

    // 5. ECONOMY: one summed accrual over this step's dt. Revenue is the sum across
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
      policyMode: this.policy.mode,
      policyFloor: this.policy.freshnessFloor,
      autoPrefetched,
      autoBlackoutPrestage,
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
  prefetch(eph: Ephemeris, t: number, atTick?: number): string | null {
    const target = this.pickPrefetchTarget(eph, t);
    if (target === null) return null;
    const d = eph.distanceBetween(target.sourceId, target.customerId, t);
    const eta = oneWaySeconds(d);
    const fs = this.fetchOf(target.id);
    fs.launchT = t;
    fs.arrivalT = t + eta;
    fs.inFlight = true;
    this.economy.chargePrefetch();
    // The MANUAL prefetch (P) fired and launched a leg — log it truthfully. The
    // tick is the action's recorded atTick (so live + replay stamp the same one);
    // fall back to the DT-derived tick for direct test calls. Edge event.
    const tick = atTick ?? this.tickOf(t, DT);
    this.events.push((seq) => ({
      kind: "prefetch",
      seq,
      tick,
      tSim: t,
      feedId: target.id,
      datasetId: target.datasetId,
      cause: "manual",
      etaSeconds: eta,
      costEur: PREFETCH_COST,
    }));
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

  /**
   * E8 — set the standing prefetch policy (the tame-it lever). Knobs are clamped
   * to sane ranges so a malformed action can never put the autopilot in an
   * impossible state. Pure mutation; the caller (live or replay) applies it at the
   * same tick via the shared applySessionAction, so the DERIVED auto-prefetches
   * reproduce bit-identically.
   */
  setPolicy(p: PrefetchPolicy, atTick?: number, tSim?: number): void {
    const from = this.prevPolicyMode ?? this.policy.mode;
    this.policy = {
      mode: p.mode,
      freshnessFloor: Math.max(0, Math.min(0.95, p.freshnessFloor)),
      blackoutLeadS: Math.max(0, p.blackoutLeadS),
      maxConcurrentAuto: Math.max(0, Math.trunc(p.maxConcurrentAuto)),
    };
    // The standing policy CHANGED (a recorded player intent) — log it. The
    // autopilot's per-step prefetches it drives are logged at their own firing
    // step; this records the lever move itself (mode + floor, from→to). The tick
    // is the action's recorded atTick when known (live + replay stamp the same).
    const mode = this.policy.mode;
    const floor = this.policy.freshnessFloor;
    const tick = atTick ?? 0;
    const ts = tSim ?? tick * DT;
    this.events.push((seq) => ({
      kind: "policy",
      seq,
      tick,
      tSim: ts,
      mode,
      floor,
      from,
    }));
    this.prevPolicyMode = mode;
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
    // Capture the policy by value (a flat plain object) so save/load round-trips
    // the lever and a restored session resumes the same standing intent.
    return { feeds, slots, balance: this.economy.balance, policy: { ...this.policy } };
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
    // Restore the standing policy if the snapshot carries one (tolerate older
    // snapshots that predate E8 — they keep the current/default policy).
    if (s.policy !== undefined) this.policy = { ...s.policy };
  }
}
