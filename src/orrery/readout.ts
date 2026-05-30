/**
 * GLANCEABLE READOUT (M1-10) — pure derivation for the orrery corner overlay.
 *
 * The make-or-break VISUALIZATION pillar (GDD §5) demands the network's health
 * be legible AT A GLANCE with no submenu-diving. This module turns the raw
 * {@link FrameState} demand/LOS fields into the small set of glanceable readings
 * the overlay paints — kept PURE (no DOM, no three) so it is unit-testable and so
 * the orrery presentation stays a thin painter over it.
 *
 * The signature skill it surfaces is conjunction pre-staging (GDD §4.3a:
 * "blackouts are geometrically predictable"). The CONJUNCTION-APPROACH gauge maps
 * the already-computed Earth→Mars Sun-miss margin (solarRadii) into a 0..1
 * "approach" so the player can SEE a blackout coming from across the room and
 * pre-position the cache — skill expression, not luck.
 */
import type { FrameState } from "../types";

/**
 * Conjunction-approach band, in solar radii of Sun-centre miss distance:
 *  - at/below WATCH the gauge starts filling (the link is getting tight);
 *  - at/below CRIT it is in the alarm zone (a blackout is imminent);
 *  - occulted clamps approach to 1 (full).
 * The Earth→Mars LOS only grazes the Sun near a real conjunction, so these are
 * deliberately generous so the cue leads the event (you see it coming).
 */
export const CONJUNCTION_WATCH_RSUN = 8;
export const CONJUNCTION_CRIT_RSUN = 2;

/** A demand-freshness band for the redundant (CVD-safe) shape/dither channel. */
export type FreshnessBand = "fresh" | "stale" | "empty";

/** A compact, glanceable state glyph code for one feed's current outcome. */
export type FeedGlyphState = "fresh" | "stale" | "fetching" | "miss" | "blackout";

/** E7 — one feed's glanceable line in the orrery map readout. */
export interface FeedReadoutLine {
  /** Stable feed id (mars_imagery, …); the readout shows a short suffix label. */
  id: string;
  /** Short display label (the part after "mars_", uppercased: IMAGERY, …). */
  label: string;
  /** Cache freshness in [0,1]. */
  freshness: number;
  /** Cache freshness as a whole-percent integer. */
  freshnessPct: number;
  /** Banded freshness for the redundant glyph/dither channel. */
  band: FreshnessBand;
  /** Compact at-a-glance state for the redundant glyph (the Mini-Metro cue). */
  state: FeedGlyphState;
  /** Seconds until this feed's fetch arrives, or null when no leg is in flight. */
  countdownSeconds: number | null;
  /** Packet crawl progress in [0,1] for the per-feed orrery packet (null when idle). */
  packetProgress: number | null;
}

export interface Readout {
  /** Mars-relay PEAK cache freshness in [0,1] — the draining Mars-node saturation. */
  freshness: number;
  /** Peak cache freshness as a whole-percent integer. */
  freshnessPct: number;
  /** Banded peak freshness for the redundant glyph/dither channel (colour-off legible). */
  band: FreshnessBand;
  /** E7 — per-feed glanceable lines (the multi-feed Mini-Metro at-a-glance map). */
  feeds: FeedReadoutLine[];
  /** Occupied cache slots / total capacity (the contention readout). */
  slotsUsed: number;
  slotCapacity: number;
  /** Total fetches crawling Earth→Mars right now (across all feeds). */
  fetchesInFlight: number;
  /** Earliest in-flight fetch ETA across feeds, or null when none is crawling. */
  countdownSeconds: number | null;
  /** True when ANY feed is in a hard blackout (link down, no usable cache). */
  blackout: boolean;
  /** Sun-centre miss distance of the Earth→Mars segment, in solar radii. */
  marginSolarRadii: number;
  /** True once the solar disk actually intersects the line of sight. */
  occulted: boolean;
  /** Conjunction approach in [0,1]: 0 wide-open, 1 imminent/occulted blackout. */
  approach: number;
  /** True once approach has entered the alarm band (≤ CRIT margin). */
  approachAlarm: boolean;

  // --- E8 prefetch POLICY (the tame-it lever) glanceable readout ---
  /** Active autopilot mode. */
  policyMode: "manual" | "freshness" | "freshness_blackout";
  /** A short policy label: "MANUAL" / "AUTO @ 70%" / "AUTO+BLK @ 70%". */
  policyLabel: string;
  /** True iff the autopilot launched at least one leg this step (firing). */
  policyFiring: boolean;
  /** True iff a blackout pre-stage fired this step (the marquee relief). */
  policyPrestaging: boolean;
}

/** Banded freshness for the redundant, colour-off channel. */
export function freshnessBand(freshness: number): FreshnessBand {
  if (freshness <= 0) return "empty";
  // 0.5 is the arrival floor (a one-way-old copy lands ≈0.84 and decays to 0.5);
  // below it the held copy is into the stale band the demand will start rejecting.
  return freshness >= 0.5 ? "fresh" : "stale";
}

/**
 * Map the Sun-miss margin (solar radii) to a 0..1 conjunction-approach value.
 * Linear inside [CRIT, WATCH]; clamps to 1 when occulted or inside CRIT, to 0
 * when wider than WATCH. Monotonic non-increasing in margin, so a tightening
 * margin always grows the gauge.
 */
export function conjunctionApproach(marginSolarRadii: number, occulted: boolean): number {
  if (occulted) return 1;
  if (!Number.isFinite(marginSolarRadii)) return 0;
  if (marginSolarRadii <= CONJUNCTION_CRIT_RSUN) return 1;
  if (marginSolarRadii >= CONJUNCTION_WATCH_RSUN) return 0;
  return (CONJUNCTION_WATCH_RSUN - marginSolarRadii) / (CONJUNCTION_WATCH_RSUN - CONJUNCTION_CRIT_RSUN);
}

/** Short display label for a feed id: the part after "mars_", uppercased. */
export function feedLabel(id: string): string {
  return id.replace(/^mars_/, "").toUpperCase();
}

/**
 * Short glanceable label for the prefetch policy (the tame-it lever): "MANUAL"
 * when the autopilot is off, else "AUTO @ NN%" (or "AUTO+BLK @ NN%" in blackout
 * pre-staging mode) — the floor the autopilot tops the cache up to.
 */
export function policyLabel(
  mode: "manual" | "freshness" | "freshness_blackout",
  floor: number,
): string {
  if (mode === "manual") return "MANUAL";
  const pct = Math.round(Math.max(0, Math.min(1, floor)) * 100);
  return `${mode === "freshness_blackout" ? "AUTO+BLK" : "AUTO"} @ ${pct}%`;
}

/** The compact at-a-glance state for one feed's current readout. */
export function feedGlyphState(
  outcome: "fresh" | "stale" | "miss" | "blackout_miss",
  fetchInFlight: boolean,
): FeedGlyphState {
  if (outcome === "blackout_miss") return "blackout";
  if (outcome === "fresh") return "fresh";
  if (outcome === "stale") return "stale";
  // a miss: distinguish "fetching" (a leg is crawling) from a bare miss.
  return fetchInFlight ? "fetching" : "miss";
}

/**
 * Derive the full glanceable MULTI-FEED readout from a per-frame state. Pure.
 *
 * The Mars-node saturation reads the PEAK cache freshness (the best-held slot), so
 * a network with at least one fresh feed still glows. Per-feed packet progress is
 * derived from the feed's fetch countdown over the current one-way light time (all
 * feeds share the Earth→Mars geometry), so the orrery can crawl a packet per feed.
 */
export function deriveReadout(fs: FrameState): Readout {
  const d = fs.demand;
  const oneWay = fs.oneWaySeconds;
  const peak = Math.max(0, Math.min(1, d.peakCacheFreshness));
  const approach = conjunctionApproach(fs.losMarginSolarRadii, fs.losOcculted);

  let earliestEta: number | null = null;
  let anyBlackout = false;
  const feeds: FeedReadoutLine[] = d.feeds.map((f) => {
    const freshness = Math.max(0, Math.min(1, f.cacheFreshness));
    const countdown = f.fetchInFlight ? f.fetchCountdownSeconds : null;
    if (countdown != null && (earliestEta == null || countdown < earliestEta)) earliestEta = countdown;
    if (f.blackout) anyBlackout = true;
    // packet crawl 0..1: 1 − remaining/oneWay, clamped. null when no leg in flight.
    let packetProgress: number | null = null;
    if (f.fetchInFlight && countdown != null && oneWay > 0) {
      packetProgress = Math.max(0, Math.min(1, 1 - countdown / oneWay));
    }
    return {
      id: f.id,
      label: feedLabel(f.id),
      freshness,
      freshnessPct: Math.round(freshness * 100),
      band: freshnessBand(freshness),
      state: feedGlyphState(f.outcome, f.fetchInFlight),
      countdownSeconds: countdown,
      packetProgress,
    };
  });

  return {
    freshness: peak,
    freshnessPct: Math.round(peak * 100),
    band: freshnessBand(peak),
    feeds,
    slotsUsed: d.slotsUsed,
    slotCapacity: d.slotCapacity,
    fetchesInFlight: d.fetchesInFlight,
    countdownSeconds: earliestEta,
    blackout: anyBlackout,
    marginSolarRadii: fs.losMarginSolarRadii,
    occulted: fs.losOcculted,
    approach,
    approachAlarm: approach > 0 && fs.losMarginSolarRadii <= CONJUNCTION_CRIT_RSUN,
    policyMode: d.policyMode,
    policyLabel: policyLabel(d.policyMode, d.policyFloor),
    policyFiring: d.autoPrefetched.length > 0,
    policyPrestaging: d.autoBlackoutPrestage,
  };
}
