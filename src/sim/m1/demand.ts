/**
 * M1-01 — Demand: a Mars customer's standing request for a dataset.
 *
 * Faithful TypeScript port of SignalHorizon.Sim/M1/Demand.cs. PURE data +
 * functions (no three/DOM/wall-clock/RNG): plain number/string.
 *
 * The 3-band STEP price curve ({@link Demand.price}) is the whole economic
 * signal of M1 — the resolver reads it directly to label a serve
 * fresh/stale/below-min. The bands are a step curve, NOT a ramp, and the floors
 * are INCLUSIVE (freshness == 0.5 lands in the stale band).
 */

/** Which band label a freshness lands in. Mirrors the C# Band() string. */
export type Band = "fresh" | "stale" | "unusable";

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
   * PIECEWISE 3-band price curve (M1-01). A step curve, not a ramp:
   *   freshness >= freshFreshness          -> basePrice           (FRESH)
   *   minAcceptableFreshness <= f < fresh   -> basePrice * factor  (STALE)
   *   freshness <  minAcceptableFreshness   -> 0                   (BELOW-MIN)
   * Floors are inclusive (0.5 -> stale).
   */
  price(freshness: number): number {
    if (freshness >= this.freshFreshness) return this.basePrice;
    if (freshness >= this.minAcceptableFreshness) {
      return this.basePrice * this.stalePriceFactor;
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
