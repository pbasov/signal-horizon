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

export interface Readout {
  /** Mars-relay cache freshness in [0,1] — the draining colour. */
  freshness: number;
  /** Cache freshness as a whole-percent integer (for "FRESH 84%"). */
  freshnessPct: number;
  /** Banded freshness for the redundant glyph/dither channel (colour-off legible). */
  band: FreshnessBand;
  /** Seconds until the in-flight fetch lands, or null when none is crawling. */
  countdownSeconds: number | null;
  /** True when the link is down AND no usable cache — a hard blackout. */
  blackout: boolean;
  /** Sun-centre miss distance of the Earth→Mars segment, in solar radii. */
  marginSolarRadii: number;
  /** True once the solar disk actually intersects the line of sight. */
  occulted: boolean;
  /** Conjunction approach in [0,1]: 0 wide-open, 1 imminent/occulted blackout. */
  approach: number;
  /** True once approach has entered the alarm band (≤ CRIT margin). */
  approachAlarm: boolean;
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

/** Derive the full glanceable readout from a per-frame state. Pure. */
export function deriveReadout(fs: FrameState): Readout {
  const d = fs.demand;
  const freshness = Math.max(0, Math.min(1, d.cacheFreshness));
  const approach = conjunctionApproach(fs.losMarginSolarRadii, fs.losOcculted);
  return {
    freshness,
    freshnessPct: Math.round(freshness * 100),
    band: freshnessBand(freshness),
    countdownSeconds: d.fetchInFlight ? d.fetchCountdownSeconds : null,
    blackout: d.blackout,
    marginSolarRadii: fs.losMarginSolarRadii,
    occulted: fs.losOcculted,
    approach,
    approachAlarm: approach > 0 && fs.losMarginSolarRadii <= CONJUNCTION_CRIT_RSUN,
  };
}
