/**
 * Shared frontend contract — the data shapes the sim loop hands to the panels.
 * Kept dependency-free so every view module (log / telemetry / status) and the
 * main loop agree on one vocabulary.
 */

export type Severity = "info" | "warn" | "error" | "crit";

/** One SYSTEM.LOG entry, timestamped in SIM-seconds (not wall time). */
export interface LogEntry {
  /** sim-seconds since J2000 epoch when the event occurred */
  tSim: number;
  sev: Severity;
  /** entity identifier, e.g. "PKT-0007" or "EARTH→MARS" (rendered as identifier) */
  entity?: string;
  /** a value token, e.g. "1284 ls" or "0.50" (rendered in the value colour) */
  value?: string;
  msg: string;
}

/** A signal packet in flight, frozen one-way delay at launch (honest light speed). */
export interface PacketState {
  id: number;
  fromId: string;
  toId: string;
  /** sim-seconds at launch */
  launchT: number;
  /** one-way light delay (seconds), frozen at launch from Earth↔Mars distance */
  oneWay: number;
  /** 0..1 along the link; reaches 1 exactly when (now - launchT) == oneWay */
  progress: number;
  /** 0..1; 2^(-age/oneWay), so ~0.5 on arrival, draining toward machine-grey */
  freshness: number;
}

/** Resolve outcome the panels colour on. */
export type Outcome = "fresh" | "stale" | "miss" | "blackout_miss";

/**
 * E7 (M1-05 plural) — ONE feed's live resolve state. A pure projection of a
 * FeedRenderState, kept dependency-free so views read it without the sim layer.
 */
export interface FeedReadout {
  /** Stable feed identity (mars_imagery, …). */
  id: string;
  /** Latest resolve outcome for this feed. */
  outcome: Outcome;
  /** Whether this feed's serve came from the shared Mars cache (a hit). */
  viaCache: boolean;
  /** This feed's current Mars cache freshness in [0,1] (0 = no slot holds it). */
  cacheFreshness: number;
  /** True while THIS feed's data-leg fetch is crawling Earth→Mars. */
  fetchInFlight: boolean;
  /** Seconds until this feed's fetch arrives, or null when none is in flight. */
  fetchCountdownSeconds: number | null;
  /** True when the link is down AND this feed has no usable cache. */
  blackout: boolean;
  /** Age (sim-seconds) of the data served, or null on a non-cache serve. */
  servedAgeSeconds: number | null;
  /** Derived € value of freshness for this feed: price(fresh) − price(min). */
  freshnessPremium: number;
}

/**
 * E7 — the MULTI-FEED demand readout the panels + orrery surface: the per-feed
 * roster plus the AGGREGATE economy summed across feeds. A pure projection of
 * M1Session.step(), kept dependency-free.
 */
export interface DemandReadout {
  /** One readout per feed, in roster order. */
  feeds: FeedReadout[];
  /** Occupied cache slots / total capacity (the contention readout). */
  slotsUsed: number;
  slotCapacity: number;
  /** Peak cache freshness across the held slots, in [0,1] — the Mars-node saturation. */
  peakCacheFreshness: number;
  /** Total data-leg fetches crawling Earth→Mars right now (across all feeds). */
  fetchesInFlight: number;
  /** M1-08 — on-hand wallet balance (€) after the latest step's accrual. */
  balance: number;
  /** Summed REVENUE RATE (€/sim-second) across feeds. The FINANCE REVENUE row. */
  revenueRatePerSecond: number;
  /** Total OPEX RATE (€/sim-second): per-slot baseline × occupied slots × coherence. */
  opexRatePerSecond: number;
  /** NET RATE (€/sim-second): summed revenue − opex. The FINANCE NET row. */
  netRatePerSecond: number;
  /** Sim-seconds until bankruptcy at the live net burn (+Inf when not burning). */
  runway: number;
  /** True once the balance has gone negative — the kill condition. */
  bankrupt: boolean;

  // --- E8 prefetch POLICY (the tame-it lever) — surfaced for the render relief ---
  /** Active autopilot mode: "manual" | "freshness" | "freshness_blackout". */
  policyMode: "manual" | "freshness" | "freshness_blackout";
  /** The freshness floor the autopilot tops up to (the tunable knob), in [0,1]. */
  policyFloor: number;
  /** Feed ids the autopilot launched THIS step (the relief firing). */
  autoPrefetched: string[];
  /** True iff at least one of this step's auto-prefetches was a blackout pre-stage. */
  autoBlackoutPrestage: boolean;
}

/** Per-frame snapshot the panels render from. */
export interface FrameState {
  simSeconds: number;
  scaleLabel: string;
  paused: boolean;
  wmPreset: string;
  cameraPreset: string;
  focusBody: string;
  /** live straight-line Earth↔Mars distance (metres) */
  earthMarsDistanceM: number;
  /** live one-way Earth↔Mars light delay (seconds) */
  oneWaySeconds: number;
  /** Sun-centre miss distance of the Earth→Mars segment, in solar radii */
  losMarginSolarRadii: number;
  /** the live solar-interference corridor threshold in Rsun (the blackout edge) */
  losCorridorRsun: number;
  /** true when the solar disk (1 Rsun) intersects the Earth→Mars line of sight */
  losOcculted: boolean;
  /** true when the LOS is inside the solar-interference corridor (link blacked out) */
  losInCorridor: boolean;
  packet: PacketState | null;
  /** M1-05 standing-demand resolve readout (the live cache loop). */
  demand: DemandReadout;
}
