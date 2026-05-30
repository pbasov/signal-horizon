/**
 * M2a — the per-cell DEMAND field (GDD §4.2: "Each cell has demand
 * population/economic weight"). Demand is what makes coverage MATTER: serving a
 * high-demand cell is worth more, so the scoring (and later, contracts) weight
 * by it.
 *
 * --- PLACEHOLDER, deterministic, NO RNG -------------------------------------
 * A real telecom-region demand surface is a data product we don't have yet, so
 * this is a procedural PROXY built from FIXED constants (no runtime randomness
 * of any kind — no SimRng, no library RNG): the inhabited-Earth signal as two
 * cheap, legible components —
 *
 *   1. a LATITUDE-BAND weight (most population sits in the northern mid-
 *      latitudes; the poles and deep south are sparse), and
 *   2. a few FIXED great-circle HOTSPOTS (stand-ins for dense metros), each a
 *      smooth Gaussian-ish bump in angular distance from a pinned lat/lon.
 *
 * Output is a non-negative weight per cell (dimensionless "demand units"). It is
 * a pure function of the cell centre (a unit vector) and the fixed constants, so
 * the field is byte-identical for a given grid. TUNE LATER — swap in a data/
 * entry when we have one; the shape (DemandField over a GeodesicGrid) stays.
 */

import type { Vec3 } from "../ephemeris";
import { type Cell, type GeodesicGrid, latLonToUnit, _vec } from "./grid";

const { dot } = _vec;
const DEG = Math.PI / 180;

/** A fixed demand hotspot: a centre (lat/lon, deg) + peak weight + angular
 * falloff radius (deg). Stand-ins for dense metros — placeholders to tune. */
interface Hotspot {
  name: string;
  latDeg: number;
  lonDeg: number;
  peak: number;
  /** 1-sigma angular radius (degrees) of the Gaussian falloff. */
  sigmaDeg: number;
}

/**
 * The fixed hotspot set — coarse stand-ins for the world's dense regions. These
 * are intentionally approximate (a handful of metros, not a census). Longitudes
 * follow the lon=0 at +x convention; absolute placement only matters once we
 * pin a body-rotation frame, so treat these as "where demand clusters", tunable.
 */
const HOTSPOTS: Hotspot[] = [
  { name: "north_atlantic_eu", latDeg: 50, lonDeg: 5, peak: 1.0, sigmaDeg: 18 },
  { name: "east_asia", latDeg: 35, lonDeg: 120, peak: 1.2, sigmaDeg: 18 },
  { name: "south_asia", latDeg: 22, lonDeg: 78, peak: 1.1, sigmaDeg: 16 },
  { name: "north_america", latDeg: 40, lonDeg: -90, peak: 1.0, sigmaDeg: 18 },
  { name: "se_asia", latDeg: 5, lonDeg: 105, peak: 0.7, sigmaDeg: 14 },
  { name: "sub_saharan_africa", latDeg: 5, lonDeg: 20, peak: 0.6, sigmaDeg: 16 },
  { name: "south_america", latDeg: -15, lonDeg: -55, peak: 0.6, sigmaDeg: 16 },
];

/** Baseline weight added everywhere so no cell is exactly zero (open ocean
 * still carries some maritime/relay demand). Placeholder. */
const BASELINE = 0.05;

/** Weight of the latitude-band component relative to the hotspots. Placeholder. */
const LAT_BAND_WEIGHT = 0.4;

/**
 * Latitude-band population proxy in [0,1]: a smooth bump peaking in the northern
 * mid-latitudes (~40°N), tapering toward the poles and the deep south. Pure
 * cosine-of-offset bump, clamped non-negative. Fixed constants, no RNG.
 */
export function latitudeBandWeight(latRad: number): number {
  const peakLat = 40 * DEG; // northern mid-latitudes carry most population.
  const spread = 55 * DEG; // half-width before the bump hits zero.
  const x = (latRad - peakLat) / spread;
  const w = Math.cos(Math.min(Math.PI / 2, Math.abs(x) * (Math.PI / 2)));
  return Math.max(0, w);
}

/** Summed hotspot contribution at a cell centre (unit vector). Gaussian in the
 * great-circle angle to each hotspot centre. */
export function hotspotWeight(center: Vec3): number {
  let sum = 0;
  for (const h of HOTSPOTS) {
    const hc = latLonToUnit(h.latDeg * DEG, h.lonDeg * DEG);
    const cosAng = Math.max(-1, Math.min(1, dot(center, hc)));
    const angle = Math.acos(cosAng); // radians, [0, π]
    const sigma = h.sigmaDeg * DEG;
    sum += h.peak * Math.exp(-(angle * angle) / (2 * sigma * sigma));
  }
  return sum;
}

/** Non-negative demand weight for a single cell. Pure; placeholder constants. */
export function demandOf(cell: Cell): number {
  const w = BASELINE + LAT_BAND_WEIGHT * latitudeBandWeight(cell.latRad) + hotspotWeight(cell.center);
  return Math.max(0, w);
}

/**
 * The minimal read surface a demand-weighted scorer needs: a per-cell weight + the Σ.
 * Both the STATIC {@link DemandField} (M2a) and the M2e DYNAMIC demand overlay
 * ({@link import("./dynamic-demand").DynamicDemand}) satisfy this, so the coverage/
 * contract scorers ({@link import("./score").scoreCoverageAt} etc.) read either as a
 * drop-in CURRENT field without caring whether it grows.
 */
export interface DemandReader {
  /** Demand weight of a cell by id (non-negative). */
  of(cellId: number): number;
  /** Σ weight over all cells (the covered-demand-fraction denominator). */
  readonly total: number;
}

/**
 * The demand field over a whole grid: a non-negative weight per cell id, plus
 * the total (for demand-weighted scoring). Pure + deterministic for a grid.
 */
export class DemandField {
  /** weight[cellId] — non-negative demand units. */
  readonly weight: number[];
  /** Σ weight — the denominator for covered-demand fraction. */
  readonly total: number;

  private constructor(weight: number[], total: number) {
    this.weight = weight;
    this.total = total;
  }

  /** Build the procedural placeholder demand field for a grid. */
  static build(grid: GeodesicGrid): DemandField {
    const weight = grid.cells.map(demandOf);
    const total = weight.reduce((acc, w) => acc + w, 0);
    return new DemandField(weight, total);
  }

  /** Demand weight of a cell by id. */
  of(cellId: number): number {
    return this.weight[cellId];
  }
}
