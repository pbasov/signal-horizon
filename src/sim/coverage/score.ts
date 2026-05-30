/**
 * M2a — the MULTI-AXIS SCORING STUB (GDD §4.2 "Multi-axis scoring — the
 * optimisation spine, not a footnote"; the M1 multi-axis-scoring stub promoted).
 * A demand-weighted rollup of the coverage field over the whole grid: the seed
 * of the §4.12/§4.2 scoring the post-run parse + contracts will read.
 *
 * The headline axis is COVERED-DEMAND FRACTION — of all the demand on the body,
 * what fraction sits in a cell that at least one asset covers right now. That is
 * the "does it work?" bar (§3a). The other axes (bandwidth served, mean/worst
 * latency on covered demand) are the "how close to optimal?" texture. There is
 * deliberately NO single scalar score — §4.2: "a solution is rated on competing
 * axes … no single right build, just elegant trade-offs."
 *
 * Pure + deterministic: a function over the grid, the demand field, and the
 * coverage field (each itself pure). No three, no DOM, no wall-clock, no RNG.
 */

import type { Ephemeris } from "../ephemeris";
import type { GeodesicGrid } from "./grid";
import type { DemandField } from "./demand";
import { type Asset, type CellCoverage, coverageOf } from "./field";

/** The multi-axis coverage score (a demand-weighted rollup; no single scalar). */
export interface CoverageScore {
  /** Number of cells with connectivity ≥ 1. */
  cellsCovered: number;
  /** Total cells in the grid. */
  cellsTotal: number;
  /** Σ demand over covered cells. */
  coveredDemand: number;
  /** Σ demand over ALL cells (the denominator). */
  totalDemand: number;
  /** COVERED-DEMAND FRACTION ∈ [0,1] — the headline "does it work?" axis. */
  coveredDemandFraction: number;
  /** Demand-weighted total bandwidth: Σ demand·bandwidth over covered cells.
   * (Bandwidth axis — how much capacity reaches where it is wanted.) */
  demandWeightedBandwidth: number;
  /** Demand-weighted MEAN one-way latency over covered cells (seconds), or 0
   * when nothing is covered. (Latency axis.) */
  demandWeightedMeanLatencyS: number;
  /** WORST one-way latency among covered cells (seconds), or 0 when none. */
  worstCoveredLatencyS: number;
}

/**
 * Score a whole grid at sim-time t: sweep coverageOf over every cell, then roll
 * up the demand-weighted axes. `bodyId` is the body the grid sits on.
 */
export function scoreCoverage(
  eph: Ephemeris,
  grid: GeodesicGrid,
  demand: DemandField,
  assets: Asset[],
  t: number,
  bodyId = "earth",
): CoverageScore {
  let cellsCovered = 0;
  let coveredDemand = 0;
  let demandWeightedBandwidth = 0;
  let demandLatencyAccum = 0; // Σ demand·latency over covered cells.
  let worstCoveredLatencyS = 0;

  for (const cell of grid.cells) {
    const cov: CellCoverage = coverageOf(eph, cell, assets, t, bodyId);
    if (cov.connectivity <= 0) continue;
    const w = demand.of(cell.id);
    cellsCovered++;
    coveredDemand += w;
    demandWeightedBandwidth += w * cov.bandwidth;
    demandLatencyAccum += w * cov.latencyS;
    if (cov.latencyS > worstCoveredLatencyS) worstCoveredLatencyS = cov.latencyS;
  }

  const totalDemand = demand.total;
  return {
    cellsCovered,
    cellsTotal: grid.size,
    coveredDemand,
    totalDemand,
    coveredDemandFraction: totalDemand > 0 ? coveredDemand / totalDemand : 0,
    demandWeightedBandwidth,
    demandWeightedMeanLatencyS: coveredDemand > 0 ? demandLatencyAccum / coveredDemand : 0,
    worstCoveredLatencyS,
  };
}
