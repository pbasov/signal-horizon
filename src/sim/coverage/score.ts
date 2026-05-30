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

import type { Ephemeris, Vec3 } from "../ephemeris";
import type { GeodesicGrid } from "./grid";
import type { DemandReader } from "./demand";
import { type Asset, type CellCoverage, coverageOf, coverageDimsAt } from "./field";

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
  demand: DemandReader,
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

/**
 * M2d — the SERVED FRACTION of a SUBSET of cells (a contract's target region) at a
 * minimum CONNECTIVITY quality, from PRECOMPUTED asset world positions. This is the
 * coverage truth a contract's revenue is keyed on (GDD §4.9 "demand met × quality"):
 * of the region's demand, what fraction sits in a cell currently covered at/above the
 * quality bar. Reuses the SAME allocation-free gates as the heatmap render
 * ({@link coverageDimsAt}), so the € a contract earns matches the cells the heatmap
 * lights over its region.
 *
 * Returns demand-weighted [0,1]: Σ(demand of served region cells) / Σ(demand of region
 * cells). When the region has zero demand (degenerate) it falls back to the unweighted
 * served-cell fraction so a contract always has a meaningful denominator. Pure.
 *
 * `cellIds` are indices into `grid.cells` (a contract's sorted region). `out` is an
 * optional single reusable {@link CellCoverage} scratch (this evaluates one cell at a
 * time, so one scratch suffices — no per-cell allocation).
 */
export function servedFractionAt(
  grid: GeodesicGrid,
  demand: DemandReader,
  cellIds: number[],
  qualityThreshold: number,
  assetEirps: number[],
  assetPositions: Vec3[],
  bodyCenter: Vec3,
  bodyRadiusM: number,
  out?: CellCoverage,
): number {
  const scratch: CellCoverage =
    out ?? { cellId: -1, connectivity: 0, bandwidth: 0, latencyS: Infinity, links: [] };
  let regionDemand = 0;
  let servedDemand = 0;
  let regionCells = 0;
  let servedCells = 0;
  for (let i = 0; i < cellIds.length; i++) {
    const cell = grid.cells[cellIds[i]];
    if (cell === undefined) continue;
    const w = demand.of(cell.id);
    regionDemand += w;
    regionCells++;
    coverageDimsAt(cell, assetEirps, assetPositions, bodyCenter, bodyRadiusM, scratch);
    if (scratch.connectivity >= qualityThreshold) {
      servedDemand += w;
      servedCells++;
    }
  }
  if (regionCells === 0) return 0;
  return regionDemand > 0 ? servedDemand / regionDemand : servedCells / regionCells;
}

/**
 * M2e — a contract's demand-weighted SERVED FRACTION ∈ [0,1] read from a PRECOMPUTED
 * per-cell served-quality array (the {@link servedQualityAt} output) + the CURRENT demand.
 * Avoids re-sweeping the contract's cells when the whole-grid served-quality has already
 * been computed this step (the session computes it once for the demand-growth, then reads
 * each active contract's fraction off it — one coverage sweep per step, not N+1). Same
 * demand-weighted rollup + degenerate fallback as {@link servedFractionAt}. Pure.
 */
export function servedFractionFromQuality(
  demand: DemandReader,
  cellIds: number[],
  servedQuality: number[],
): number {
  let regionDemand = 0;
  let servedDemand = 0;
  let regionCells = 0;
  let servedCells = 0;
  for (let i = 0; i < cellIds.length; i++) {
    const id = cellIds[i];
    const q = servedQuality[id] ?? 0;
    const w = demand.of(id);
    regionDemand += w;
    regionCells++;
    if (q > 0) {
      servedDemand += w * q;
      servedCells += q >= 1 ? 1 : q;
    }
  }
  if (regionCells === 0) return 0;
  return regionDemand > 0 ? servedDemand / regionDemand : servedCells / regionCells;
}

/**
 * M2e — fill a per-cell SERVED-QUALITY array over the WHOLE grid from PRECOMPUTED asset
 * world positions: `out[cellId] = 1` when the cell is covered at/above `qualityThreshold`
 * (connectivity ≥ threshold), else `0`. This is the input the ESCALATION ENGINE's dynamic
 * demand grows on — a cell served well this step gains demand (GDD §3b "demand grows where
 * you serve"). It reuses the SAME allocation-free gates as the heatmap render's
 * {@link coverageDimsAt}, so the demand that grows is exactly the demand the player SEES
 * served on the heatmap. Pure; writes into the caller's reused `out` (one number per cell)
 * and a single reusable {@link CellCoverage} scratch, so the per-step whole-grid sweep
 * allocates nothing once settled.
 *
 * The served quality is a 0/1 step (the connectivity bar is a hard gate); the value is kept
 * a float in [0,1] so a finer per-cell quality (e.g. a bandwidth ramp) can replace it later
 * without reshaping the growth law. `out` is grown to the grid size if shorter.
 */
export function servedQualityAt(
  grid: GeodesicGrid,
  qualityThreshold: number,
  assetEirps: number[],
  assetPositions: Vec3[],
  bodyCenter: Vec3,
  bodyRadiusM: number,
  out: number[],
  scratch?: CellCoverage,
): void {
  const cov: CellCoverage =
    scratch ?? { cellId: -1, connectivity: 0, bandwidth: 0, latencyS: Infinity, links: [] };
  const cells = grid.cells;
  while (out.length < cells.length) out.push(0);
  out.length = cells.length;
  for (let i = 0; i < cells.length; i++) {
    coverageDimsAt(cells[i], assetEirps, assetPositions, bodyCenter, bodyRadiusM, cov);
    out[i] = cov.connectivity >= qualityThreshold ? 1 : 0;
  }
}

/**
 * M2c — score a whole grid from PRECOMPUTED asset world positions (not the
 * ephemeris). This is the score the M2c BUILD ROSTER uses: a launched sat's orbit
 * is not in the ephemeris, so its world position is computed by the roster's pure
 * Kepler propagation and handed in here alongside the body's position + radius. It
 * reuses the SAME allocation-free gates as the heatmap render's {@link coverageDimsAt}
 * (sin-elevation horizon mask + inverse-square link budget), so the score the
 * player SEES rise as they build matches the cells the heatmap lights. Pure.
 *
 * `assetEirps` + `assetPositions` are indexed alike (roster order). `out` is an
 * optional reusable per-cell scratch (one {@link CellCoverage} per cell) so a
 * per-frame score allocates nothing.
 */
export function scoreCoverageAt(
  grid: GeodesicGrid,
  demand: DemandReader,
  assetEirps: number[],
  assetPositions: Vec3[],
  bodyCenter: Vec3,
  bodyRadiusM: number,
  out?: CellCoverage[],
): CoverageScore {
  let cellsCovered = 0;
  let coveredDemand = 0;
  let demandWeightedBandwidth = 0;
  let demandLatencyAccum = 0;
  let worstCoveredLatencyS = 0;

  const cells = grid.cells;
  for (let i = 0; i < cells.length; i++) {
    const cov: CellCoverage =
      out?.[i] ?? { cellId: cells[i].id, connectivity: 0, bandwidth: 0, latencyS: Infinity, links: [] };
    coverageDimsAt(cells[i], assetEirps, assetPositions, bodyCenter, bodyRadiusM, cov);
    if (cov.connectivity <= 0) continue;
    const w = demand.of(cells[i].id);
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
