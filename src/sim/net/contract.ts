/**
 * net/ — THE CONTRACT (design §2.2): the unit of demand, the teacher. A region-disc
 * demand with ALL THREE quantitative SLA axes PRESENT in the struct from day one
 * (slaAvail / slaLatencyS / slaBandwidth) plus an `activeAxes` GATE MASK that says which
 * axes the serve/breach evaluator ENFORCES this act — so an act adds an axis with a
 * one-line mask change in the scenario table, never a struct or solver change.
 *
 * --- THE REUSE DECISION (design §2.2, pinned in docs/decisions.md) ---------------
 * This is a FRESH struct (not the m2 Contract): the m2 `Contract` is GRID-CELL-coupled
 * (its region is `cellIds: number[]` resolved against the GeodesicGrid, served via
 * `coverageDimsAt` over those cells). The net/ game's demand is a REGION/POINT geodesic
 * disc on the spinning frame, served via the router's path-existence — a grid-cell
 * contract cannot express that without dragging the whole GeodesicGrid coupling in.
 *
 * It is NOT a drift hazard, because it shares the m2 state machine VERBATIM:
 *   - the same {@link ContractState} ("offered"|"active"|"completed"|"failed"), imported
 *     from m2/contracts (the shared vocabulary, NOT re-declared here);
 *   - identical field NAMES: state / termSeconds / servedSecondsAccum / breachSecondsAccum
 *     / lastServedFraction / earnedEur;
 *   - and net/session.ts IMPORTS the m2 transition helpers (stepActiveContract /
 *     stepOfferedContract) + the single BREACH_GRACE_SECONDS — so there is ONE breach
 *     convention in the codebase, two demand geometries.
 * The one extension net/ needs is the multi-axis mask the m2 single-valued QualityAxis
 * enum left a door open for — opened here on net/'s own struct, without touching the m2 file.
 *
 * PURE: plain JSON-safe data + pure constructors. No three / DOM / wall-clock / RNG.
 *
 * @see docs/signal-horizon-m1-design.md §2.2 (the reuse decision), §4 (the fold), §5.
 */

import type { ContractState } from "../m2/contracts"; // SHARED state vocabulary (NOT re-declared)
import type { Region } from "./endpoint";

/**
 * The FIXED integer ordinal per SLA axis — the deterministic fold key (design §2.2/§4,
 * resolves the fold-ordering issue). NEVER reorder, NEVER add in the middle: the golden
 * folds `activeAxes` by iterating this map ASCENDING and mixing the ordinal of each
 * PRESENT axis (never Set iteration order, never a string sort of mutable labels), so a
 * future axis rename can never shift the hash. A new axis appends with the next ordinal.
 */
export const SLA_AXIS_ORDINAL = {
  connectivity: 0,
  availability: 1,
  latency: 2,
  bandwidth: 3,
} as const;

/** An SLA axis — the keys of {@link SLA_AXIS_ORDINAL}. Act 1 enforces only "connectivity";
 * Act 2 adds "availability"; Act 3 adds "latency" then "bandwidth" one at a time. */
export type SlaAxis = keyof typeof SLA_AXIS_ORDINAL;

/** The per-contract router PREFER weights (§7.2/§7.3): the design surface that biases the
 * link cost (latency vs bandwidth vs stability). `stab` is PRESENT but `w_stab` is dormant
 * in M1 (the cost blend is `w_lat·latencyTerm + w_bw·congestionTerm + 0·instabilityTerm`). */
export interface PreferWeights {
  lat: number;
  bw: number;
  stab: number;
}

/** A region-disc demand contract. ALL THREE SLA axes are present; `activeAxes` gates which
 * the serve/breach evaluator enforces. The state-machine fields mirror m2/contracts.ts. */
export interface Contract {
  /** Stable id (the net_accept / net_set_prefer action payloads carry this). */
  id: string;
  /** Glanceable label (the region the contract sits over). */
  label: string;
  /** The endpoint GEOMETRY: a body-fixed geodesic disc — NOT m2 grid cells. The router
   * reads this; it makes the struct a structural supertype of the router's RoutableContract. */
  region: Region;

  // --- ALL THREE QUANTITATIVE AXES PRESENT (Act 1 HIDES them via the mask) ---
  /** Min fraction of time the region must be served (0..1) — the availability bar (Act 2). */
  slaAvail: number;
  /** Max one-way latency (seconds) the path must achieve (Act 3). */
  slaLatencyS: number;
  /** Min per-user bandwidth (units) the path must carry (Act 3). */
  slaBandwidth: number;
  /** Time-varying offered demand (drives oversubscription/congestion in Act 3). */
  offeredLoad: number;

  // --- THE GATE MASK: which axes the serve/breach evaluator ENFORCES this act ---
  /** Act1 {connectivity}; Act2 +availability; Act3 +latency,+bandwidth. The UI reads this
   * to decide what to SHOW; the session reads it to decide what the router must satisfy. */
  activeAxes: ReadonlySet<SlaAxis>;

  // --- the router surface (§7.2/§7.3): per-contract prefer weights ---
  /** Per-contract prefer weights; `stab` present, w_stab dormant in M1. */
  prefer: PreferWeights;

  /** € per sim-second at FULL service (accrues while served). */
  payPerSecond: number;
  /** € per sim-second drained while ACTIVE but wholly unserved (the SLA bite). */
  penaltyPerSecond: number;

  // --- SHARED state-machine fields (SAME NAMES as m2/contracts.ts) ---
  /** Current lifecycle state (the imported {@link ContractState}). */
  state: ContractState;
  /** Sim-time the OFFER auto-expires (the m2 stepOfferedContract reads this). The net
   * contract has NO offer window in Act 1, so this is `Infinity` — the SHARED offered-step
   * helper then never expires it (a genuine, deterministic no-op), keeping ONE convention.
   * SAME field name as m2/contracts.ts. */
  offerExpiresAtS: number;
  /** Term in sim-seconds (fraction-weighted served-time must reach this to COMPLETE). */
  termSeconds: number;
  /** Accumulated served sim-seconds, weighted by served fraction (drives COMPLETION). */
  servedSecondsAccum: number;
  /** Consecutive sim-seconds currently below the bar (FAILS past the imported grace). */
  breachSecondsAccum: number;
  /** Last computed served fraction ∈ [0,1] (the readout; refreshed each step). */
  lastServedFraction: number;
  /** Total € this contract has earned (a readout; the wallet is the truth). */
  earnedEur: number;
}

// --- TUNING CONSTANTS — sane placeholders (tune later) ----------------------------

/** € per sim-second a served Act-1 connectivity contract pays. Sane placeholder on the
 * same scale as the m2 economy so the wallet reads on one currency. */
export const NET_DEFAULT_PAY_PER_SECOND = 3.0;

/** € per sim-second drained while an ACTIVE contract is wholly unserved (the SLA bite).
 * Placeholder; mirrors the m2 BREACH_PENALTY_PER_SECOND scale. */
export const NET_DEFAULT_PENALTY_PER_SECOND = 1.5;

/** Default contract term (sim-seconds) — long enough that serving is a sustained
 * commitment, not a blip. Placeholder (a chunk of an Act-1 sitting). */
export const NET_DEFAULT_TERM_SECONDS = 6 * 3600.0; // 6 sim-hours.

/** Default availability/latency/bandwidth bars carried in the struct but HIDDEN in Act 1
 * (activeAxes={connectivity}). Sane non-trivial values so Act 2/3 inherit a real bar when
 * the mask opens. Placeholders. */
export const NET_DEFAULT_SLA_AVAIL = 0.99;
export const NET_DEFAULT_SLA_LATENCY_S = 0.05; // 50 ms one-way.
export const NET_DEFAULT_SLA_BANDWIDTH = 1.0;

/** The neutral prefer weights (latency-biased, bandwidth secondary, stability dormant). */
export const NET_DEFAULT_PREFER: PreferWeights = { lat: 1.0, bw: 0.0, stab: 0.0 };

/**
 * Build an OFFERED contract over a region. Act 1 offers a connectivity-ONLY contract
 * (activeAxes = {connectivity}); the avail/latency/bandwidth fields are present but the
 * mask hides + un-enforces them. Pure: a deterministic function of its inputs (no RNG,
 * no clock). The scenario beat calls this to put the one Act-1 contract on the board.
 */
export function offerNetContract(
  id: string,
  region: Region,
  opts?: {
    label?: string;
    activeAxes?: ReadonlySet<SlaAxis>;
    payPerSecond?: number;
    penaltyPerSecond?: number;
    termSeconds?: number;
    slaAvail?: number;
    slaLatencyS?: number;
    slaBandwidth?: number;
    offeredLoad?: number;
    prefer?: PreferWeights;
  },
): Contract {
  return {
    id,
    label: opts?.label ?? region.label,
    region,
    slaAvail: opts?.slaAvail ?? NET_DEFAULT_SLA_AVAIL,
    slaLatencyS: opts?.slaLatencyS ?? NET_DEFAULT_SLA_LATENCY_S,
    slaBandwidth: opts?.slaBandwidth ?? NET_DEFAULT_SLA_BANDWIDTH,
    offeredLoad: opts?.offeredLoad ?? 1.0,
    activeAxes: opts?.activeAxes ?? new Set<SlaAxis>(["connectivity"]),
    prefer: opts?.prefer ? { ...opts.prefer } : { ...NET_DEFAULT_PREFER },
    payPerSecond: opts?.payPerSecond ?? NET_DEFAULT_PAY_PER_SECOND,
    penaltyPerSecond: opts?.penaltyPerSecond ?? NET_DEFAULT_PENALTY_PER_SECOND,
    state: "offered",
    offerExpiresAtS: Infinity, // no offer window in Act 1 (the shared offered-step never expires it).
    termSeconds: opts?.termSeconds ?? NET_DEFAULT_TERM_SECONDS,
    servedSecondsAccum: 0,
    breachSecondsAccum: 0,
    lastServedFraction: 0,
    earnedEur: 0,
  };
}

/**
 * The € revenue RATE (per sim-second) an ACTIVE contract accrues at a served fraction:
 * payPerSecond × servedFraction when served at all; a NEGATIVE penalty rate when wholly
 * unserved (servedFraction 0). Pure. Mirrors m2's contractRevenueRatePerSecond shape so
 * the two economies read identically. Only ACTIVE contracts earn/drain.
 */
export function netRevenueRatePerSecond(contract: Contract, servedFraction: number): number {
  if (contract.state !== "active") return 0;
  if (servedFraction > 0) return contract.payPerSecond * servedFraction;
  return -contract.penaltyPerSecond;
}

/** Add € earned this step to a contract's running total (the session calls this with the
 * same rate×dt it adds to the wallet, keeping the readout and the truth aligned). */
export function recordNetEarned(contract: Contract, eur: number): void {
  contract.earnedEur += eur;
}

/** Deep-copy a contract by value (a fresh `activeAxes` Set + `prefer` so a snapshot never
 * shares the mutable mask/weights with the live contract). */
export function cloneNetContract(c: Contract): Contract {
  return {
    ...c,
    activeAxes: new Set(c.activeAxes),
    prefer: { ...c.prefer },
  };
}
