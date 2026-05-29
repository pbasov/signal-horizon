/**
 * M1-01 — Demand: a Mars customer's standing request for a dataset.
 *
 * Diverges from the faithful C# port per GDD v0.7 §4.4: a cache hit carries "a
 * freshness penalty if the contract demands currency" — a penalty that SCALES
 * with staleness. The stale band's price is therefore selectable via
 * {@link Demand.priceCurve}:
 *   "step" — the old/faithful flat basePrice*stalePriceFactor (A/B comparison).
 *   "ramp" — the new DEFAULT: a continuous LERP across the stale band.
 *
 * PURE data + functions (no three/DOM/wall-clock/RNG): plain number/string.
 *
 * The price curve ({@link Demand.price}) is the whole economic signal of M1 —
 * the resolver reads it directly to label a serve fresh/stale/below-min. In
 * BOTH modes the hard cliff (f < min -> 0) and the fresh cap (f >= fresh ->
 * basePrice) hold; only the [min, fresh) band differs. Floors are INCLUSIVE
 * (freshness == 0.5 lands in the stale band).
 */

/** Which band label a freshness lands in. Mirrors the C# Band() string. */
export type Band = "fresh" | "stale" | "unusable";

/**
 * How the stale band [minAcceptableFreshness, freshFreshness) is priced:
 *   "step" — flat basePrice*stalePriceFactor (old/faithful, for A/B).
 *   "ramp" — continuous LERP from basePrice*stalePriceFactor up to basePrice.
 */
export type PriceCurve = "step" | "ramp";

export class Demand {
  /** Stable identity (telemetry keys / action targeting). */
  id = "mars_imagery";

  /** Who pays (the cache node also lives here in M1's single linear chain). */
  customerId = "mars";

  /** Where fresh data is born (the fetch endpoint across the light-gap). */
  sourceId = "earth";

  /** Which dataset this demand wants (matched against a CachedSample datasetId). */
  datasetId = "earth_imagery";

  /**
   * How often (sim-seconds) the customer fires a fresh request. Informational
   * for the session loop; the resolver itself is stateless w.r.t. cadence.
   */
  requestPeriodS = 3600.0;

  /** Half-life (sim-seconds) of THIS dataset's value — how fast it goes stale. */
  freshnessHalfLifeS = 3600.0;

  /** Full price paid for perfectly-fresh data (freshness == 1.0). */
  basePrice = 1000.0;

  /** Freshness floor in [0,1]. Below this the data is worthless (payout 0). */
  minAcceptableFreshness = 0.5;

  /** Fraction of basePrice paid in the middle "stale-but-usable" band. */
  stalePriceFactor = 0.4;

  /** At/above this freshness the customer pays FULL basePrice (the "fresh" band). */
  freshFreshness = 0.9;

  /**
   * How the stale band is priced. DEFAULT "ramp" (price scales with staleness,
   * GDD v0.7 §4.4). "step" keeps the old flat behaviour for A/B comparison.
   */
  priceCurve: PriceCurve = "ramp";

  constructor(
    id = "mars_imagery",
    datasetId = "earth_imagery",
    basePrice = 1000.0,
    halfLifeS = 3600.0,
  ) {
    this.id = id;
    this.datasetId = datasetId;
    this.basePrice = basePrice;
    this.freshnessHalfLifeS = halfLifeS;
  }

  /**
   * PIECEWISE price curve (M1-01). The cliff and fresh cap are identical in both
   * modes; only the stale band [minAcceptableFreshness, freshFreshness) differs.
   *   freshness >= freshFreshness          -> basePrice           (FRESH cap)
   *   minAcceptableFreshness <= f < fresh   -> stale band (see priceCurve)
   *   freshness <  minAcceptableFreshness   -> 0                   (BELOW-MIN cliff)
   * Floors are inclusive (0.5 -> stale).
   *
   * Stale band, by priceCurve:
   *   "step" — flat basePrice * stalePriceFactor (= 400 at defaults).
   *   "ramp" — continuous LERP from basePrice*stalePriceFactor at
   *            f=minAcceptableFreshness UP to basePrice as f -> freshFreshness:
   *              base*factor + (base - base*factor) * (f - min) / (fresh - min)
   *            This is continuous with both endpoints (ramp(min)=base*factor,
   *            ramp(fresh^-)->base) and strictly increasing across the band.
   */
  price(freshness: number): number {
    if (freshness >= this.freshFreshness) return this.basePrice;
    if (freshness >= this.minAcceptableFreshness) {
      const stalePrice = this.basePrice * this.stalePriceFactor;
      if (this.priceCurve === "step") return stalePrice;
      // "ramp": LERP stalePrice -> basePrice across [min, fresh).
      const span = this.freshFreshness - this.minAcceptableFreshness;
      const tBand = (freshness - this.minAcceptableFreshness) / span;
      return stalePrice + (this.basePrice - stalePrice) * tBand;
    }
    return 0.0;
  }

  /**
   * Which band label a freshness lands in ("fresh"/"stale"/"unusable").
   * The resolver uses this so band logic lives in ONE place.
   */
  band(freshness: number): Band {
    if (freshness >= this.freshFreshness) return "fresh";
    if (freshness >= this.minAcceptableFreshness) return "stale";
    return "unusable";
  }
}
