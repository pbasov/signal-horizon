/**
 * E10c (M1-GATE) — THE POST-RUN PARSE (GDD §4.12, the M1-era form).
 *
 * §3a names the mastery fun as OPTIMISING AGAINST A RECORD, and §4.12 specifies
 * that record — the "combat log for information delivery." §9 sharpens the M1 gate
 * to its truest question: "does the player finish a 30-min run wanting to look at
 * what happened and do it BETTER?" This module is what makes that question
 * answerable: a complete, HONEST summary of the E9 truthful event log
 * ({@link EventLog}), surfaced as a per-feed post-mortem + an aggregate + a single
 * headline efficiency with the GAP to a heuristic achievable bound.
 *
 * --- PURE READ OF THE TRUTHFUL LOG ------------------------------------------
 * The §4.12 honesty precondition is that the record cannot lie or hide. We honour
 * it by making the parse a PURE FUNCTION of the event stream (plus the run's start/
 * end ticks + the feed roster's labels, which carry no judgement) — NO three / DOM /
 * wall-clock / RNG, and crucially NO independent re-derivation of "what happened":
 * every number the parse reports is folded straight out of the E9 events the sim
 * already emitted. A parse that disagreed with the log would defeat the whole point.
 * That also makes it DETERMINISTIC (same log → same parse) and unit-testable by
 * feeding a known event sequence and asserting the summary.
 *
 * --- SCOPE HONESTY (§4.12 "Scope honesty") ----------------------------------
 * The FULL post-run parse with a SOLVER-PROVEN achievable optimum is M2+ (the
 * solver is not mature enough). This is the M1-ERA parse: a faithful summary plus a
 * SIMPLE, DEFENSIBLE HEURISTIC achievable bound, labelled honestly as an ESTIMATE
 * (see {@link RunParse.achievableLabel}) — NOT a proven optimum. The gap between
 * actual and this estimate is the optimisation hook the §9 gate wants the player to
 * see and want to close.
 */
import type { ServeBand } from "./eventlog";
import { EventLog } from "./eventlog";
import { CACHE_SLOTS } from "./feeds";

/** The four serve bands, in display/scoring order (best → worst). */
export const SERVE_BANDS: readonly ServeBand[] = ["fresh", "stale", "miss", "blackout_miss"];

/** A feed's identity + label for the per-contract line (carried as run context). */
export interface FeedContext {
  /** Stable feed id (mars_imagery, …). */
  id: string;
  /** The dataset this feed serves (the cache key the log keys evictions/stores on). */
  datasetId: string;
}

/** Minimal run context the parse needs beyond the event log itself. */
export interface RunContext {
  /** The feed roster (ids + datasetIds), in display order. */
  feeds: readonly FeedContext[];
  /** Sim-tick the run began (the scenario boot tick). */
  startTick: number;
  /** Sim-tick the run ended (the last tick stepped). */
  endTick: number;
  /** Sim-seconds the run began (startTick · DT). */
  startTSim: number;
  /** Sim-seconds the run ended (endTick · DT). */
  endTSim: number;
  /** Opening wallet balance (€). */
  openingBalance: number;
  /** Final wallet balance (€) at run end. */
  closingBalance: number;
  /** Cache slot capacity (the contention denominator for the bound). Default {@link CACHE_SLOTS}. */
  slotCapacity?: number;
}

/**
 * PER-FEED (per-contract) post-mortem — the §4.12 damage-meter line item. Time is
 * in SIM-SECONDS, attributed to the band each feed HELD across the run (derived by
 * integrating the edge-triggered serve transitions between t and the next).
 */
export interface FeedParse {
  id: string;
  datasetId: string;
  /** Sim-seconds this feed spent serving FRESH (the paying-best band). */
  freshSeconds: number;
  /** Sim-seconds spent STALE (usable but discounted). */
  staleSeconds: number;
  /** Sim-seconds spent MISS (link up, nothing cached/fresh enough). */
  missSeconds: number;
  /** Sim-seconds spent BLACKOUT (link physically down, no usable cache). */
  blackoutSeconds: number;
  /** Total observed seconds for this feed (the four above; the run span once seen). */
  totalSeconds: number;
  /** Fresh proportion of the feed's observed time, in [0,1]. */
  freshFraction: number;
  /** Data-leg fetches launched for this feed (natural miss-fetches + prefetch legs). */
  fetchesLaunched: number;
  /** Prefetch legs launched for this feed (manual + auto + pre-stage). */
  prefetchesLaunched: number;
  /** Times this feed's dataset was evicted from a slot to make room for a rival. */
  evicted: number;
  /** True iff this feed entered a conjunction blackout at some point in the run. */
  blackedOut: boolean;
  /** True iff the feed SERVED THROUGH a blackout (a viaCache serve while blacked out). */
  servedThroughBlackout: boolean;
  /** The single specific miss called out where cheaply knowable (the §4.12 prose). */
  note: string;
}

/** How the conjunction blackout was handled across the roster (the marquee §4.4 beat). */
export type BlackoutHandling =
  | "none" // no blackout occurred in this run.
  | "served_through" // every blacked-out feed served through from a pre-staged cache.
  | "partial" // some feeds served through, some went dark.
  | "went_dark"; // every blacked-out feed took the SLA hit (no pre-stage landed).

/**
 * GATE TELEMETRY (M1-GATE) — the structured run summary that answers the §9 gate
 * and feeds the parse headline. The SAME pure summary the parse renders; exposed
 * as its own object so playtest instrumentation can read it directly.
 */
export interface GateMetrics {
  /** Overall FRESH-time proportion across the roster, in [0,1] (served + missed). */
  freshFraction: number;
  /** Overall STALE proportion, in [0,1]. */
  staleFraction: number;
  /** Overall MISS proportion (link up, not served), in [0,1]. */
  missFraction: number;
  /** Overall BLACKOUT proportion (link down, no usable cache), in [0,1]. */
  blackoutFraction: number;
  /** Total feed·seconds observed (the denominator of the fractions). */
  feedSecondsTotal: number;
  /** Prefetch legs that CONVERTED to a fresh-via-cache serve later in the run. */
  prefetchesTimely: number;
  /** Prefetch legs that never converted to a fresh serve (€ spent, no fresh payoff). */
  prefetchesWasted: number;
  /** € spent on prefetch legs that never paid off (wasted · the per-leg cost). */
  wastedPrefetchEur: number;
  /** How the conjunction blackout was handled. */
  blackoutHandling: BlackoutHandling;
  /** True iff a blackout occurred AND no blacked-out feed went dark (served through). */
  blackoutHandled: boolean;
  /** Net € over the run (closing − opening balance). */
  netEur: number;
  /** Final wallet balance (€). */
  finalBalance: number;
  /** THE HEADLINE: efficiency in [0,1] = actual fresh-fraction / the heuristic bound. */
  efficiency: number;
  /** The heuristic achievable fresh-fraction bound, in [0,1] (an ESTIMATE, not proven). */
  achievableFreshFraction: number;
  /** The optimisation hook: achievable − actual fresh-fraction (the gap to close), ≥0. */
  freshGap: number;
}

/** The whole post-run parse: one record, the §4.12 forms, M1-era. */
export interface RunParse {
  /** Run span in sim-seconds (endTSim − startTSim). */
  durationSeconds: number;
  /** Per-feed (per-contract) post-mortems, in roster order. */
  feeds: FeedParse[];
  /** The aggregate gate telemetry (the headline lives here). */
  metrics: GateMetrics;
  /** A short honest label for the bound, e.g. "achievable (est.)". */
  achievableLabel: string;
  /** Why the bound is what it is (the one-line rationale, shown beside the gap). */
  achievableRationale: string;
  /** Total data-leg fetches launched across the run (all causes). */
  fetchesLaunched: number;
  /** Total prefetch legs launched across the run (manual + auto + pre-stage). */
  prefetchesLaunched: number;
  /** Total cache evictions across the run (the contention cost). */
  evictions: number;
}

/** The one-shot € a prefetch leg costs (mirrors economy.PREFETCH_COST; kept local for purity tests). */
const PREFETCH_COST_EUR = 50;

/** Honest label for the heuristic bound — it is an ESTIMATE, not a proven optimum (M2+). */
export const ACHIEVABLE_LABEL = "achievable (est.)";

/** A serve band counts as a PAYING/served band for the "served vs missed" split. */
function isServed(band: ServeBand): boolean {
  return band === "fresh" || band === "stale";
}

/** Per-feed running accumulator while folding the event stream. */
interface FeedAcc {
  ctx: FeedContext;
  /** Current band (null until the first serve event for the feed). */
  band: ServeBand | null;
  /** Sim-seconds at which the current band began (the last transition's tSim). */
  bandSince: number;
  fresh: number;
  stale: number;
  miss: number;
  blackout: number;
  fetches: number;
  prefetches: number;
  evicted: number;
  /** Saw at least one blackout_miss band (the feed actually went dark at some point). */
  blackedOut: boolean;
  /** Saw a blackout ENTER edge — the feed was inside a conjunction-blackout window at all. */
  sawBlackoutWindow: boolean;
  /** Saw a viaCache serve (fresh/stale) WHILE the link was in the blackout window. */
  servedThroughBlackout: boolean;
  /** True while this feed is inside a conjunction-blackout window (between enter/exit). */
  inBlackoutWindow: boolean;
  /** Prefetch leg ticks awaiting a fresh-via-cache conversion (timely vs wasted). */
  pendingPrefetchSeqs: number[];
  /** Prefetch legs that converted to a later fresh-via-cache serve. */
  prefetchesTimely: number;
}

/** Add `dt` sim-seconds to the band a feed currently holds (skip negative spans). */
function accrueBand(acc: FeedAcc, band: ServeBand | null, dt: number): void {
  if (dt <= 0 || band === null) return;
  switch (band) {
    case "fresh":
      acc.fresh += dt;
      break;
    case "stale":
      acc.stale += dt;
      break;
    case "miss":
      acc.miss += dt;
      break;
    case "blackout_miss":
      acc.blackout += dt;
      break;
  }
}

/**
 * Summarise an {@link EventLog} into a {@link RunParse}. PURE: a deterministic
 * fold over the (already-sorted-by-seq) event stream, attributing held-band time by
 * integrating the edge-triggered serve transitions, counting fetches/prefetches/
 * evictions, classifying each prefetch leg as timely (converted to a later fresh-
 * via-cache serve) or wasted, and computing a heuristic achievable bound. Same log
 * + context → same parse.
 */
export function parseRun(log: EventLog, ctx: RunContext): RunParse {
  const events = log.readAll(); // a COPY; we never mutate the record.
  const slotCapacity = ctx.slotCapacity ?? CACHE_SLOTS;

  const accs = new Map<string, FeedAcc>();
  for (const f of ctx.feeds) {
    accs.set(f.id, {
      ctx: f,
      band: null,
      bandSince: ctx.startTSim,
      fresh: 0,
      stale: 0,
      miss: 0,
      blackout: 0,
      fetches: 0,
      prefetches: 0,
      evicted: 0,
      blackedOut: false,
      sawBlackoutWindow: false,
      servedThroughBlackout: false,
      inBlackoutWindow: false,
      pendingPrefetchSeqs: [],
      prefetchesTimely: 0,
    });
  }
  // datasetId → feed id, so eviction events (keyed by dataset) attribute to a feed.
  const datasetToFeed = new Map<string, string>();
  for (const f of ctx.feeds) datasetToFeed.set(f.datasetId, f.id);

  let prefetchesTimely = 0;
  let prefetchesWasted = 0;

  for (const ev of events) {
    switch (ev.kind) {
      case "serve": {
        const acc = accs.get(ev.feedId);
        if (acc === undefined) break;
        // Close out the band the feed HELD up to this transition's instant.
        accrueBand(acc, acc.band, ev.tSim - acc.bandSince);
        acc.band = ev.band;
        acc.bandSince = ev.tSim;
        if (ev.band === "blackout_miss") acc.blackedOut = true;
        // A viaCache serve (fresh/stale) WHILE inside the blackout window is a
        // "served through" — the marquee §4.4 pre-stage payoff, read from the log.
        if (ev.viaCache && isServed(ev.band) && acc.inBlackoutWindow) {
          acc.servedThroughBlackout = true;
        }
        // A fresh-via-cache serve CONVERTS every still-pending prefetch leg for this
        // feed into a TIMELY one (the prefetch paid off as a later fresh serve).
        if (ev.viaCache && ev.band === "fresh" && acc.pendingPrefetchSeqs.length > 0) {
          acc.prefetchesTimely += acc.pendingPrefetchSeqs.length;
          prefetchesTimely += acc.pendingPrefetchSeqs.length;
          acc.pendingPrefetchSeqs.length = 0;
        }
        break;
      }
      case "fetch_launch": {
        const acc = accs.get(ev.feedId);
        if (acc !== undefined) acc.fetches += 1;
        break;
      }
      case "prefetch": {
        const acc = accs.get(ev.feedId);
        if (acc !== undefined) {
          acc.fetches += 1; // a prefetch IS a launched data leg.
          acc.prefetches += 1;
          acc.pendingPrefetchSeqs.push(ev.seq);
        }
        break;
      }
      case "cache_evict": {
        const feedId = datasetToFeed.get(ev.datasetId);
        if (feedId !== undefined) {
          const acc = accs.get(feedId);
          if (acc !== undefined) acc.evicted += 1;
        }
        break;
      }
      case "blackout": {
        const acc = accs.get(ev.feedId);
        if (acc !== undefined) {
          acc.inBlackoutWindow = ev.edge === "enter";
          if (ev.edge === "enter") acc.sawBlackoutWindow = true;
        }
        break;
      }
      // fetch_arrive / cache_store / policy carry no band/count the parse folds.
      default:
        break;
    }
  }

  // Close every feed's final band out to run end, and finalise the per-feed parse.
  const feeds: FeedParse[] = [];
  let fresh = 0;
  let stale = 0;
  let miss = 0;
  let blackout = 0;
  let totalFetches = 0;
  let totalPrefetches = 0;
  let totalEvictions = 0;
  let anyBlackout = false;
  let anyWentDark = false;
  let anyServedThrough = false;

  for (const f of ctx.feeds) {
    const acc = accs.get(f.id)!;
    accrueBand(acc, acc.band, ctx.endTSim - acc.bandSince);
    // Any prefetch leg still pending at run end never converted → wasted.
    prefetchesWasted += acc.pendingPrefetchSeqs.length;

    const total = acc.fresh + acc.stale + acc.miss + acc.blackout;
    const note = feedNote(acc);
    // A blackout "occurred" for this feed if it entered the window at all (whether
    // it served through or went dark). "Went dark" = it took the SLA hit and did
    // NOT serve through from a pre-stage.
    const sawBlackout = acc.sawBlackoutWindow || acc.blackedOut;
    const wentDark = acc.blackedOut && !acc.servedThroughBlackout;
    if (sawBlackout) anyBlackout = true;
    if (wentDark) anyWentDark = true;
    if (acc.servedThroughBlackout) anyServedThrough = true;

    feeds.push({
      id: f.id,
      datasetId: f.datasetId,
      freshSeconds: acc.fresh,
      staleSeconds: acc.stale,
      missSeconds: acc.miss,
      blackoutSeconds: acc.blackout,
      totalSeconds: total,
      freshFraction: total > 0 ? acc.fresh / total : 0,
      fetchesLaunched: acc.fetches,
      prefetchesLaunched: acc.prefetches,
      evicted: acc.evicted,
      blackedOut: acc.blackedOut,
      servedThroughBlackout: acc.servedThroughBlackout,
      note,
    });

    fresh += acc.fresh;
    stale += acc.stale;
    miss += acc.miss;
    blackout += acc.blackout;
    totalFetches += acc.fetches;
    totalPrefetches += acc.prefetches;
    totalEvictions += acc.evicted;
  }

  const feedSecondsTotal = fresh + stale + miss + blackout;
  const freshFraction = feedSecondsTotal > 0 ? fresh / feedSecondsTotal : 0;
  const staleFraction = feedSecondsTotal > 0 ? stale / feedSecondsTotal : 0;
  const missFraction = feedSecondsTotal > 0 ? miss / feedSecondsTotal : 0;
  const blackoutFraction = feedSecondsTotal > 0 ? blackout / feedSecondsTotal : 0;

  // --- THE HEURISTIC ACHIEVABLE BOUND (M1-era, NOT a solver) ----------------
  // Two physical facts cap how fresh the roster could have been held:
  //  (1) SLOT SCARCITY: with `slotCapacity` (3) slots < `feeds` (5), at most
  //      slotCapacity feeds can be held fresh at once, so the aggregate fresh-time
  //      ceiling over the roster is slotCapacity/feeds of the LINK-UP time — even a
  //      perfect player cannot keep all five fresh simultaneously.
  //  (2) BLACKOUT: while the link is physically down, fresh service is only possible
  //      from a PRE-STAGED slot, which itself consumes one of the (1) slots. We keep
  //      the bound honest and simple: blackout time is excluded from the achievable-
  //      fresh denominator (you cannot fetch fresh through a dead link), so the
  //      ceiling is applied to the SERVED-link time only. This is a heuristic upper
  //      ESTIMATE, not a proven optimum (that is M2+).
  const linkUpSeconds = feedSecondsTotal - blackout; // fresh + stale + miss.
  const feedCount = ctx.feeds.length || 1;
  const slotShare = Math.min(1, slotCapacity / feedCount);
  // Achievable fresh-fraction of the WHOLE observed time: the slot-share ceiling
  // over the link-up portion (blackout time can serve from a pre-stage but cannot be
  // freshly fetched, so it is conservatively not counted toward achievable fresh).
  const achievableFreshFraction =
    feedSecondsTotal > 0 ? (slotShare * linkUpSeconds) / feedSecondsTotal : 0;
  const freshGap = Math.max(0, achievableFreshFraction - freshFraction);
  // Efficiency: how close the actual fresh-time came to the heuristic ceiling. 1.0 =
  // hit the estimate; the gap below 1.0 is the optimisation hook the §9 gate wants.
  const efficiency =
    achievableFreshFraction > 0 ? Math.min(1, freshFraction / achievableFreshFraction) : 0;

  // --- BLACKOUT HANDLING (the marquee §4.4 beat) ----------------------------
  let blackoutHandling: BlackoutHandling;
  if (!anyBlackout) blackoutHandling = "none";
  else if (anyWentDark && anyServedThrough) blackoutHandling = "partial";
  else if (anyServedThrough) blackoutHandling = "served_through";
  else blackoutHandling = "went_dark";
  const blackoutHandled = anyBlackout && !anyWentDark;

  const netEur = ctx.closingBalance - ctx.openingBalance;

  const metrics: GateMetrics = {
    freshFraction,
    staleFraction,
    missFraction,
    blackoutFraction,
    feedSecondsTotal,
    prefetchesTimely,
    prefetchesWasted,
    wastedPrefetchEur: prefetchesWasted * PREFETCH_COST_EUR,
    blackoutHandling,
    blackoutHandled,
    netEur,
    finalBalance: ctx.closingBalance,
    efficiency,
    achievableFreshFraction,
    freshGap,
  };

  return {
    durationSeconds: Math.max(0, ctx.endTSim - ctx.startTSim),
    feeds,
    metrics,
    achievableLabel: ACHIEVABLE_LABEL,
    achievableRationale: `${slotCapacity} slots < ${feedCount} feeds ⇒ at most ${Math.round(
      slotShare * 100,
    )}% fresh at once; blackout time excluded (no fresh fetch through a dead link). Heuristic, not a proven optimum.`,
    fetchesLaunched: totalFetches,
    prefetchesLaunched: totalPrefetches,
    evictions: totalEvictions,
  };
}

/**
 * The single specific miss called out for a feed (the §4.12 prose line item),
 * derived purely from the folded counts. Priority orders the most actionable
 * insight first: went-dark blackout > served-through > heavy eviction churn >
 * stale-bound > clean. Cheaply knowable from the log alone.
 */
function feedNote(acc: FeedAcc): string {
  if (acc.blackedOut && !acc.servedThroughBlackout) {
    return "went dark for the conjunction — no pre-stage landed";
  }
  if (acc.servedThroughBlackout) {
    return "pre-staged and served through the blackout";
  }
  if (acc.evicted >= 3) {
    return `evicted ${acc.evicted}× — lost its slot to rival feeds`;
  }
  const served = acc.fresh + acc.stale;
  if (served > 0 && acc.stale > acc.fresh) {
    return "served mostly STALE — kept too cool to pay full";
  }
  if (acc.miss > acc.fresh + acc.stale && acc.fetches > 0) {
    return "missed more than it served — fetches lagged demand";
  }
  if (acc.fresh > 0) return "held fresh for most of the run";
  return "no paying serve recorded";
}
