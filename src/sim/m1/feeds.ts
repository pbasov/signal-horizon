/**
 * E7 (M1-01 plural) — THE FEED ROSTER: the 5 simultaneous Mars demands.
 *
 * This is the data that turns the proven SINGLE-feed loop into the HAND-MANAGEMENT
 * STRAIN that GDD §3a/§3b + plan v0.2.1 make the core of M1. Five distinct
 * datasets, each with its OWN freshness half-life, base price, and min-acceptable
 * floor, so the player must TRIAGE: with only 3 cache slots you cannot keep all
 * five fresh, and they decay at different rates and pay differently, so WHICH ones
 * you keep cached is the decision. (E8's prefetch policy is the relief.)
 *
 * DESIGNER-EDITABLE: a plain data list (number/string only — no three/DOM/RNG), so
 * tuning is a one-file edit. Each entry is compiled into a {@link Demand} by
 * {@link buildFeeds}. Values are SANE PLACEHOLDERS chosen to make the triage real:
 *   - half-lives span 1800–5400s, so imagery/comms go stale fast (need frequent
 *     refresh) while science/telemetry hold value longer (cache them once, coast);
 *   - base prices vary, so the high-value feeds (imagery, science) are worth more
 *     of your scarce slots than the cheap-but-fast-staling ones;
 *   - min-acceptable floors span 0.4–0.6, so some feeds tolerate more staleness
 *     (a lower bar to clear a paying hit) than others.
 * The DEFAULT ramp price curve + the fresh cap (0.9) are inherited from Demand.
 */
import { Demand } from "./demand";

/** One designer-authored feed row: a Demand's tunable dials as plain data. */
export interface FeedConfig {
  /** Stable identity (telemetry keys / per-feed readout / action targeting). */
  id: string;
  /** Which dataset this feed wants (matched against a CachedSample datasetId). */
  datasetId: string;
  /** Full price paid for perfectly-fresh data (freshness == 1.0). */
  basePrice: number;
  /** Half-life (sim-seconds) of THIS dataset's value — how fast it goes stale. */
  halfLifeS: number;
  /** Freshness floor in [0,1]: below this the serve pays 0 (the hard cliff). */
  minAcceptableFreshness: number;
}

/**
 * The 5 Mars feeds. Order is the display order (the readout lists them top→bottom).
 * Each is a distinct dataset so they contend for the 3 shared cache slots.
 */
export const FEED_CONFIGS: readonly FeedConfig[] = [
  // High value, fast-staling: the headline imagery the customer wants current.
  { id: "mars_imagery",   datasetId: "earth_imagery",   basePrice: 1000, halfLifeS: 1800, minAcceptableFreshness: 0.5 },
  // Fast-staling weather: cheap, but it rots quickest — a constant refresh nag.
  { id: "mars_weather",   datasetId: "earth_weather",   basePrice: 600,  halfLifeS: 2400, minAcceptableFreshness: 0.6 },
  // Telemetry: mid value, mid half-life, tolerant floor — the steady middle.
  { id: "mars_telemetry", datasetId: "earth_telemetry", basePrice: 800,  halfLifeS: 3600, minAcceptableFreshness: 0.5 },
  // Science: high value, slow-staling — cache it once and it coasts for a while.
  { id: "mars_science",   datasetId: "earth_science",   basePrice: 1200, halfLifeS: 5400, minAcceptableFreshness: 0.4 },
  // Comms relay: low value, fast-staling, tolerant floor — easy to deprioritise.
  { id: "mars_comms",     datasetId: "earth_comms",     basePrice: 500,  halfLifeS: 2100, minAcceptableFreshness: 0.55 },
];

/** Compile a feed config into a live {@link Demand} (ramp curve, 0.9 fresh cap). */
export function buildFeed(cfg: FeedConfig): Demand {
  const d = new Demand(cfg.id, cfg.datasetId, cfg.basePrice, cfg.halfLifeS);
  d.minAcceptableFreshness = cfg.minAcceptableFreshness;
  return d;
}

/** Build the full roster of live demands from {@link FEED_CONFIGS}. */
export function buildFeeds(): Demand[] {
  return FEED_CONFIGS.map(buildFeed);
}

/** How many cache slots the relay has (fewer than the feed count → contention). */
export const CACHE_SLOTS = 3;
