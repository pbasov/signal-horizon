/**
 * M2d — CONTRACTS + COVERAGE REVENUE (GDD §4.9 economy, §3 the loop, §4.2 scoring).
 *
 * This is the piece that CLOSES the §3 loop: M2c lets the player BUILD coverage and
 * SPEND € (deploy/launch capex); M2d PAYS the player for the coverage they SERVE, so
 * building has a purpose and the wallet earns its capex back. GDD §4.9: revenue =
 * demand met × quality × tariff − cost-to-serve; §3: gap → asset → integration →
 * REVENUE → bigger gap.
 *
 * A {@link Contract} is a DEMAND FOR COVERAGE of a TARGET REGION (a fixed set of grid
 * cell ids over a demand hotspot) at a minimum QUALITY (a coverage-dimension threshold
 * — here connectivity ≥ 1 per cell, i.e. the cell is reached at all) at a € TARIFF per
 * sim-second when served, over a TERM. Its state machine:
 *
 *     OFFERED ──player ACCEPTS──▶ ACTIVE ──term elapsed while served──▶ COMPLETED
 *        │                          │
 *   (auto-expire on offer           └──sustained under-quality past a GRACE──▶ FAILED
 *    deadline, no action)              (or the term elapsed never served — also FAILED)
 *
 * --- PURITY / DETERMINISM ---------------------------------------------------
 * Pure data + pure transition functions: a contract advances as a function of
 * (its state, the live SERVED FRACTION of its region, the elapsed sim-time). NO
 * three / DOM / wall-clock; any randomness is the SEEDED splitmix64 SimRng the
 * session owns (the offer GENERATOR draws from it), never the unseeded JS random.
 * The served fraction is computed by the session from the live roster coverage
 * ({@link import("../coverage/field").coverageDimsAt} over the region cells), so a
 * contract's accrual + transitions reproduce on replay. Everything a contract holds
 * is bit-stable (ids, doubles, integer cell lists) so it folds into the state-hash.
 *
 * Numbers are SANE PLACEHOLDERS (tune later); named constants keep the dials here.
 */

import type { GeodesicGrid } from "../coverage/grid";
import type { DemandReader } from "../coverage/demand";
import { latLonToUnit, _vec } from "../coverage/grid";

const { dot } = _vec;

/** A contract's lifecycle state (the pure state machine). */
export type ContractState = "offered" | "active" | "completed" | "failed";

/**
 * The minimum-QUALITY axis a contract demands. M2d ships the geometry-driven
 * connectivity bar (a cell counts as SERVED when ≥1 asset covers it); the enum keeps
 * the door open for bandwidth/latency-threshold contracts later without reshaping the
 * model.
 */
export type QualityAxis = "connectivity";

/** A demand HOTSPOT a contract can target (mirrors a demand.ts metro). The session's
 * offer generator picks from these so accepting a contract over a dense metro is the
 * lucrative-but-demanding choice (more cells, higher tariff, harder to fully serve). */
export interface ContractTarget {
  /** Glanceable label (the metro the region sits over). */
  label: string;
  /** Hotspot centre latitude/longitude (radians) — the region is the cells near it. */
  latRad: number;
  lonRad: number;
  /** Angular radius (radians): a cell is IN the target region when its centre is
   * within this great-circle angle of the hotspot centre. */
  radiusRad: number;
}

/** A coverage-demand contract: a region + a quality bar + a tariff + a term. */
export interface Contract {
  /** Stable id (the accept/decline action payload carries this). */
  id: string;
  /** The metro this contract serves (for the panel). */
  label: string;
  /** The TARGET REGION's hotspot CENTRE (radians) — the great-circle anchor the region was
   * resolved around. Carried so an M3a datacenter's edge-compute footprint can test region
   * membership with a cheap great-circle angle (no grid re-sweep). Pure data. */
  centerLatRad: number;
  centerLonRad: number;
  /** The TARGET REGION: a sorted, de-duplicated set of grid cell ids the contract
   * demands coverage of. Resolved once from the grid at offer time (deterministic),
   * so the served fraction is a stable denominator over the contract's life. */
  cellIds: number[];
  /** Σ demand over the region cells — the demand the contract represents (drives the
   * tariff scale: a denser region is worth more). */
  regionDemand: number;
  /** The minimum-quality axis (connectivity for M2d). */
  qualityAxis: QualityAxis;
  /** The quality THRESHOLD per cell (connectivity ≥ this counts the cell as served). */
  qualityThreshold: number;
  /** € per sim-second at FULL service (the whole region served at/above quality). A
   * partially-served region accrues pro-rata by the served fraction. */
  tariffPerSecond: number;
  /** The contract TERM in sim-seconds (how long it must be served to COMPLETE). */
  termSeconds: number;
  /** Current state in the lifecycle. */
  state: ContractState;
  /** Sim-time (seconds) the contract was OFFERED. */
  offeredAtS: number;
  /** Sim-time the OFFER expires if not accepted (auto-decline, no action needed). */
  offerExpiresAtS: number;
  /** Sim-time the contract became ACTIVE (accepted), or -1 while still offered. */
  activatedAtS: number;
  /** Accumulated sim-seconds SERVED at/above quality so far (drives COMPLETION when
   * it reaches termSeconds). Integrated continuously, weighted by served fraction. */
  servedSecondsAccum: number;
  /** Consecutive sim-seconds CURRENTLY below the quality bar (a breach builds here;
   * reset to 0 whenever the region is served at all). FAILS past {@link BREACH_GRACE_SECONDS}. */
  breachSecondsAccum: number;
  /** Last computed served fraction ∈ [0,1] (for the panel readout; refreshed by the
   * session each step). NOT folded into the term math directly — the accums are. */
  lastServedFraction: number;
  /** Total € earned by this contract so far (a readout; the wallet is the truth). */
  earnedEur: number;
}

// --- TUNING CONSTANTS — sane placeholders, tune later ------------------------

/** € per sim-second per UNIT of region demand at full service. A region's tariff =
 * regionDemand × this, so a denser metro pays proportionally more (and is harder to
 * cover fully). Tuned so a well-served metro contract (regionDemand ≈ 10–15 over its
 * cells) earns a few €/sim-second at full service — the SAME scale as the M1 fresh-
 * serve rate (SD-20), so the two economies read on one currency, and a built-out
 * network earns its capex back over a sitting without dwarfing it. Placeholder. */
export const TARIFF_PER_DEMAND_PER_SECOND = 0.3;

/** A breach (region under the quality bar) tolerates this many consecutive sim-seconds
 * before the contract FAILS — a grace window so a sat briefly dipping below the horizon
 * does not instantly kill a contract. Placeholder. */
export const BREACH_GRACE_SECONDS = 600.0; // 10 sim-minutes.

/** The PENALTY rate (€ per sim-second) while an ACTIVE contract is in breach (region
 * served below the quality bar): a money-OUT drain on top of zero income, so dropping
 * a region you signed for HURTS (the §4.9 cost-to-serve / SLA bite). Applied for the
 * sim-seconds the contract sits unserved while active. Placeholder. */
export const BREACH_PENALTY_PER_SECOND = 1.5;

/** Default contract TERM (sim-seconds). Long enough that a contract spans a chunk of a
 * sitting at 1000× (≈ a few real-minutes), so serving it is a sustained commitment, not
 * a blip. Placeholder. */
export const DEFAULT_TERM_SECONDS = 6 * 3600.0; // 6 sim-hours.

/** How long an OFFER stands before auto-expiring if not accepted (sim-seconds). */
export const DEFAULT_OFFER_WINDOW_SECONDS = 4 * 3600.0; // 4 sim-hours.

/** Default angular radius (degrees) of a contract target region around its hotspot
 * centre — sized to grab roughly the hotspot's core cells at the default grid level. */
export const DEFAULT_TARGET_RADIUS_DEG = 22.0;

/**
 * Resolve a target region (hotspot centre + angular radius) to the SORTED set of grid
 * cell ids whose centres fall within the radius, and the Σ demand over them. Pure +
 * deterministic for a given grid/demand: the same target always yields the same cells.
 * Falls back to the single nearest cell if the radius grabs none (never an empty
 * region — a contract always has a denominator).
 */
export function resolveTargetCells(
  grid: GeodesicGrid,
  demand: DemandReader,
  target: ContractTarget,
): { cellIds: number[]; regionDemand: number } {
  const center = latLonToUnit(target.latRad, target.lonRad);
  const cosRadius = Math.cos(target.radiusRad);
  const cellIds: number[] = [];
  let regionDemand = 0;
  let nearestId = 0;
  let nearestCos = -Infinity;
  for (const cell of grid.cells) {
    const c = Math.max(-1, Math.min(1, dot(center, cell.center)));
    if (c > nearestCos) {
      nearestCos = c;
      nearestId = cell.id;
    }
    if (c >= cosRadius) {
      cellIds.push(cell.id);
      regionDemand += demand.of(cell.id);
    }
  }
  if (cellIds.length === 0) {
    cellIds.push(nearestId);
    regionDemand = demand.of(nearestId);
  }
  cellIds.sort((a, b) => a - b);
  return { cellIds, regionDemand };
}

/**
 * Build an OFFERED contract over a target region at sim-time `offeredAtS`. Pure: the
 * cell set + tariff + term are derived deterministically from the target, the grid,
 * and the demand field. The tariff scales with the region's demand so a dense metro
 * is the lucrative-but-demanding choice (§3 escalation seed).
 */
export function offerContract(
  id: string,
  grid: GeodesicGrid,
  demand: DemandReader,
  target: ContractTarget,
  offeredAtS: number,
  termSeconds = DEFAULT_TERM_SECONDS,
  offerWindowSeconds = DEFAULT_OFFER_WINDOW_SECONDS,
): Contract {
  const { cellIds, regionDemand } = resolveTargetCells(grid, demand, target);
  return {
    id,
    label: target.label,
    centerLatRad: target.latRad,
    centerLonRad: target.lonRad,
    cellIds,
    regionDemand,
    qualityAxis: "connectivity",
    qualityThreshold: 1,
    tariffPerSecond: regionDemand * TARIFF_PER_DEMAND_PER_SECOND,
    termSeconds,
    state: "offered",
    offeredAtS,
    offerExpiresAtS: offeredAtS + offerWindowSeconds,
    activatedAtS: -1,
    servedSecondsAccum: 0,
    breachSecondsAccum: 0,
    lastServedFraction: 0,
    earnedEur: 0,
  };
}

/** The € revenue rate (per sim-second) an ACTIVE contract accrues at a served fraction:
 * tariff × servedFraction when served at all; a NEGATIVE breach-penalty rate when the
 * region is wholly under the quality bar (servedFraction 0). Pure. */
export function contractRevenueRatePerSecond(contract: Contract, servedFraction: number): number {
  if (contract.state !== "active") return 0;
  if (servedFraction > 0) return contract.tariffPerSecond * servedFraction;
  return -BREACH_PENALTY_PER_SECOND;
}

/**
 * Advance ONE OFFERED contract over `dtSeconds`: auto-expire to FAILED if its offer
 * window elapsed unaccepted. (An offered contract earns nothing; it only ages.) Pure
 * mutation in place; returns true if it just transitioned (for the caller's log).
 */
export function stepOfferedContract(contract: Contract, nowS: number): boolean {
  if (contract.state !== "offered") return false;
  if (nowS >= contract.offerExpiresAtS) {
    contract.state = "failed";
    return true;
  }
  return false;
}

/**
 * Advance ONE ACTIVE contract over `dtSeconds` of elapsed sim-time given its current
 * `servedFraction` ∈ [0,1] (from the live roster coverage). Pure mutation in place:
 *
 *   - integrate served sim-time weighted by the served fraction (a fully-served step
 *     adds dt; half-served adds dt/2) into {@link Contract.servedSecondsAccum};
 *   - track the consecutive-breach window: reset to 0 if served at all this step, else
 *     accumulate dt (a sustained under-coverage builds toward FAILED);
 *   - COMPLETE when the accumulated served-time reaches the term;
 *   - FAIL when the breach window exceeds the grace.
 *
 * The € is accrued by the SESSION (it sums the rate across all contracts into the one
 * wallet for DT-invariance); this function only advances the state machine + the
 * served/breach accums. `earnedEur` is bumped by the session via {@link recordEarned}.
 * Returns the new state if it TRANSITIONED this step (for the caller's log), else null.
 */
export function stepActiveContract(
  contract: Contract,
  servedFraction: number,
  dtSeconds: number,
): ContractState | null {
  if (contract.state !== "active") return null;
  contract.lastServedFraction = servedFraction;
  if (servedFraction > 0) {
    contract.servedSecondsAccum += dtSeconds * servedFraction;
    contract.breachSecondsAccum = 0;
  } else {
    contract.breachSecondsAccum += dtSeconds;
  }
  // COMPLETE: the term's worth of (fraction-weighted) service has been delivered.
  if (contract.servedSecondsAccum >= contract.termSeconds) {
    contract.state = "completed";
    return "completed";
  }
  // FAIL: the region sat under the quality bar past the grace period.
  if (contract.breachSecondsAccum >= BREACH_GRACE_SECONDS) {
    contract.state = "failed";
    return "failed";
  }
  return null;
}

/** Add € earned this step to a contract's running total (the session calls this with
 * the same rate×dt it adds to the wallet, keeping the readout and the truth aligned). */
export function recordEarned(contract: Contract, eur: number): void {
  contract.earnedEur += eur;
}

/** Deep-copy a contract by value (no shared mutable cell-list across snapshots). */
export function cloneContract(c: Contract): Contract {
  return { ...c, cellIds: c.cellIds.slice() };
}
