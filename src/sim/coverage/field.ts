/**
 * M2a — the COVERAGE FIELD (GDD §4.2 "Information & Coverage — The Heart", and
 * §4.3 link budgets). For a cell and a set of ASSETS (ground stations fixed on
 * the body surface + orbiting sats via the ephemeris), this answers: who covers
 * this cell, and how well — across the §4.2 information dimensions
 * (connectivity / bandwidth / latency).
 *
 * --- THE TWO GATES (§4.2) ----------------------------------------------------
 * An asset COVERS a cell when BOTH hold:
 *
 *   1. LINE OF SIGHT — the asset is above the cell's local horizon. The cell's
 *      outward surface normal is the cell centre (unit vector); the asset must
 *      sit at an ELEVATION angle ≥ a minimum above that horizon. Because the
 *      horizon plane is tangent to the sphere at the cell, this is exactly the
 *      "near side, not occluded by the body itself" test — a cell on the FAR
 *      side of the body has the asset below its horizon (negative elevation), so
 *      the body occludes it. This generalises the links.ts Earth-self-occlusion
 *      reasoning to a surface point rather than duplicating the segment-sphere
 *      solve (the body centre is implicit in the cell normal).
 *
 *   2. LINK BUDGET — a simplified inverse-square model (§4.3: "capacity from a
 *      simplified link-budget model … distance²"). Received signal ∝ 1/d²; an
 *      asset contributes capacity only when that received signal clears a
 *      threshold AND the elevation gate (1) is met. Capacity is the placeholder
 *      bandwidth axis; latency is propagation delay d/c.
 *
 * Pure + deterministic: coverageOf(cell, assets, t) is a function of the cell,
 * the asset set, and sim-time t (asset positions come from the ephemeris, which
 * is itself a pure function of t). No three, no DOM, no wall-clock, no RNG.
 *
 * Asset world positions: a SAT uses ephemeris.position(id, t) directly. A GROUND
 * STATION is pinned at a lat/lon on the body surface plus a small ANTENNA
 * ALTITUDE; its world position is the body centre + (radius+altitude)·(surface
 * unit vector). The altitude matters: a transmitter sitting *exactly* on the
 * surface sees every neighbouring surface cell at or below its own horizon (two
 * points on a sphere can't see each other above the tangent plane), so it would
 * cover nothing. A modest antenna/relay altitude raises the local horizon and
 * gives the station a real FOOTPRINT of nearby cells — and over-the-horizon
 * cells correctly fall below the minimum-elevation gate. NOTE: the ephemeris
 * carries no body-rotation, so the grid + ground stations live in a body-fixed
 * frame aligned to the ecliptic — good enough for the M2a truth layer; a
 * rotation frame is a later refinement and does not change this contract.
 */

import { type Ephemeris, type Vec3, C_LIGHT } from "../ephemeris";
import { type Cell, latLonToUnit, _vec } from "./grid";

const { dot, normalize } = _vec;

/** Minimum elevation angle (radians) for a usable link — the horizon mask. A
 * real ground antenna is masked near the horizon by terrain/atmosphere; 5° is a
 * common operational floor. Sats overhead a cell are at 90°. Placeholder. */
export const MIN_ELEVATION_RAD = 5 * (Math.PI / 180);

/**
 * Link-budget threshold on the inverse-square received signal, expressed as a
 * REFERENCE DISTANCE: an asset must be within {@link REF_LINK_DISTANCE_M} for a
 * unit-EIRP asset to clear the budget (received ∝ (ref/d)²·eirp ≥ 1). Set so a
 * LEO/GEO sat and a near ground station both close the link at the default
 * EIRP, but a far/over-the-horizon geometry does not. PLACEHOLDER — this is the
 * §4.3 link budget stubbed to one knob; replace with gain/band/loss terms later. */
export const REF_LINK_DISTANCE_M = 5.0e7; // 50,000 km — beyond GEO range.

/** Default antenna/relay altitude (metres) for a ground station above the body
 * surface. A transmitter exactly on the surface sees neighbouring cells at/below
 * its horizon and would cover nothing; this modest altitude raises the local
 * horizon enough to give a roughly one-ring footprint at the default grid level,
 * with over-the-horizon cells falling below MIN_ELEVATION_RAD. Placeholder. */
export const DEFAULT_GROUND_ALTITUDE_M = 2.0e5; // 200 km.

/** Kind of coverage asset. */
export type AssetKind = "ground" | "sat";

/** A coverage asset: a ground station pinned to the surface, or an orbiting sat. */
export interface Asset {
  /** Stable identity (telemetry / scoring keys). */
  id: string;
  kind: AssetKind;
  /** Effective isotropic radiated power, in units of the link budget (1 = the
   * reference asset that just closes the link at REF_LINK_DISTANCE_M). A bigger
   * dish / more power → larger EIRP → longer reach + more capacity. Placeholder. */
  eirp: number;
  /** For kind "ground": the body it sits on (ephemeris id, e.g. "earth"). */
  bodyId?: string;
  /** For kind "ground": latitude/longitude in radians on that body's surface. */
  latRad?: number;
  lonRad?: number;
  /** For kind "ground": antenna/relay altitude above the surface (metres);
   * defaults to {@link DEFAULT_GROUND_ALTITUDE_M}. */
  altitudeM?: number;
  /** For kind "sat": the ephemeris body id propagated by position(id, t). */
  ephemerisId?: string;
}

/** Convenience constructor for a ground station at a lat/lon (degrees). */
export function groundStation(
  id: string,
  bodyId: string,
  latDeg: number,
  lonDeg: number,
  eirp = 1.0,
  altitudeM = DEFAULT_GROUND_ALTITUDE_M,
): Asset {
  const DEG = Math.PI / 180;
  return { id, kind: "ground", bodyId, latRad: latDeg * DEG, lonRad: lonDeg * DEG, eirp, altitudeM };
}

/** Convenience constructor for an orbiting-sat asset bound to an ephemeris id. */
export function satAsset(id: string, ephemerisId: string, eirp = 1.0): Asset {
  return { id, kind: "sat", ephemerisId, eirp };
}

/** World position (metres, ecliptic-J2000) of an asset at sim-time t. */
export function assetPosition(eph: Ephemeris, asset: Asset, t: number): Vec3 {
  if (asset.kind === "sat") {
    return eph.position(asset.ephemerisId ?? asset.id, t);
  }
  // Ground station: body centre + (radius+altitude) · surface unit vector
  // (body-fixed). The altitude raises the local horizon so the station has a
  // real footprint of nearby cells.
  const bodyId = asset.bodyId ?? "earth";
  const c = eph.position(bodyId, t);
  const r = eph.radiusMeters(bodyId) + (asset.altitudeM ?? DEFAULT_GROUND_ALTITUDE_M);
  const u = latLonToUnit(asset.latRad ?? 0, asset.lonRad ?? 0);
  return [c[0] + u[0] * r, c[1] + u[1] * r, c[2] + u[2] * r];
}

/** Per-asset link geometry to one cell (the raw numbers the cell rolls up). */
export interface AssetLink {
  assetId: string;
  /** Elevation angle of the asset above the cell's local horizon (radians).
   * Negative ⇒ below the horizon ⇒ the body occludes the asset from the cell. */
  elevationRad: number;
  /** Straight-line distance cell→asset (metres). */
  distanceM: number;
  /** One-way propagation latency d/c (seconds). */
  latencyS: number;
  /** Link capacity (placeholder bandwidth units) from the inverse-square budget,
   * 0 if the link does not close. */
  capacity: number;
  /** True iff BOTH gates pass (elevation ≥ min AND budget cleared). */
  covers: boolean;
}

/**
 * The §4.2 information dimensions for one cell under a set of assets at time t.
 * (Observation + freshness are GDD dimensions reserved for later tickets; M2a
 * delivers connectivity / bandwidth / latency, the geometry-driven trio.)
 */
export interface CellCoverage {
  cellId: number;
  /** CONNECTIVITY — how many assets currently cover the cell (0 ⇒ a gap). */
  connectivity: number;
  /** BANDWIDTH — summed capacity from all covering assets (placeholder units). */
  bandwidth: number;
  /** LATENCY — the MINIMUM one-way propagation hop among covering assets
   * (seconds); Infinity when the cell is uncovered. */
  latencyS: number;
  /** The per-asset link geometry for every COVERING asset (for the trace view /
   * debugging). Non-covering assets are omitted. */
  links: AssetLink[];
}

/** World position of a cell's surface point on a body at sim-time t (metres). */
export function cellWorldPosition(eph: Ephemeris, bodyId: string, cell: Cell, t: number): Vec3 {
  const c = eph.position(bodyId, t);
  const r = eph.radiusMeters(bodyId);
  return [c[0] + cell.center[0] * r, c[1] + cell.center[1] * r, c[2] + cell.center[2] * r];
}

/**
 * Compute the raw link geometry from one cell (on `bodyId`) to one asset at t.
 * The elevation angle is measured against the cell's OUTWARD NORMAL (its centre
 * unit vector in the body frame): elevation = 90° − angle(normal, cell→asset).
 * An asset directly overhead is at 90°; one on the horizon is at 0°; one over
 * the horizon (occluded by the body) is negative.
 */
export function linkGeometry(
  eph: Ephemeris,
  bodyId: string,
  cell: Cell,
  asset: Asset,
  t: number,
): AssetLink {
  const cellPos = cellWorldPosition(eph, bodyId, cell, t);
  const assetPos = assetPosition(eph, asset, t);
  const d: Vec3 = [assetPos[0] - cellPos[0], assetPos[1] - cellPos[1], assetPos[2] - cellPos[2]];
  const distanceM = Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
  // Outward surface normal at the cell = the cell centre unit vector (body
  // frame); the body centre offsets cancel so the normal is frame-independent.
  const normal = cell.center;
  const dirToAsset = distanceM > 0 ? normalize(d) : ([0, 0, 0] as Vec3);
  const cosZenith = Math.max(-1, Math.min(1, dot(normal, dirToAsset)));
  const elevationRad = Math.asin(cosZenith); // 90° − zenith angle.
  const latencyS = distanceM / C_LIGHT;

  // Link budget: received signal ∝ eirp · (ref/d)². Clears at ≥ 1; capacity is
  // that ratio (placeholder bandwidth proportional to received signal).
  const elevationOk = elevationRad >= MIN_ELEVATION_RAD;
  let capacity = 0;
  if (distanceM > 0) {
    const received = asset.eirp * (REF_LINK_DISTANCE_M / distanceM) ** 2;
    if (received >= 1) capacity = received;
  }
  const covers = elevationOk && capacity > 0;
  return { assetId: asset.id, elevationRad, distanceM, latencyS, capacity, covers };
}

/**
 * Coverage of ONE cell by a set of assets at sim-time t (the §4.2 dimensions).
 * Pure: a function of (cell, assets, t) via the pure ephemeris. `bodyId` is the
 * body the grid sits on (default "earth").
 */
export function coverageOf(
  eph: Ephemeris,
  cell: Cell,
  assets: Asset[],
  t: number,
  bodyId = "earth",
): CellCoverage {
  const links: AssetLink[] = [];
  let bandwidth = 0;
  let latencyS = Infinity;
  for (const asset of assets) {
    const lk = linkGeometry(eph, bodyId, cell, asset, t);
    if (!lk.covers) continue;
    links.push(lk);
    bandwidth += lk.capacity;
    if (lk.latencyS < latencyS) latencyS = lk.latencyS;
  }
  return { cellId: cell.id, connectivity: links.length, bandwidth, latencyS, links };
}
