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

/**
 * M1-05 — the standing-demand resolve state the panels + orrery surface. A pure
 * projection of M1Session.step(), kept dependency-free so views can read it
 * without importing the sim layer.
 */
export interface DemandReadout {
  /** Latest resolve outcome: "fresh" | "stale" | "miss" | "blackout_miss". */
  outcome: "fresh" | "stale" | "miss" | "blackout_miss";
  /** Whether the serve came from the local Mars cache (a hit). */
  viaCache: boolean;
  /** Current Mars cache freshness in [0,1] (0 = no usable copy held). */
  cacheFreshness: number;
  /** True while a data-leg fetch is crawling Earth→Mars. */
  fetchInFlight: boolean;
  /** Seconds until the in-flight fetch arrives, or null when none is in flight. */
  fetchCountdownSeconds: number | null;
  /** True when the link is down AND there is no usable cache (blackout miss). */
  blackout: boolean;
  /** M1-08 — on-hand wallet balance (currency units) after the latest step. */
  balance: number;
  /** Signed payout applied to the balance this step (the resolve payout). */
  lastPayout: number;
  /** Ticks until bankruptcy at the standing per-tick burn (+Inf when not burning). */
  runway: number;
  /** True once the balance has gone negative — the kill condition. */
  bankrupt: boolean;
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
  /** true when the solar disk intersects the Earth→Mars line of sight */
  losOcculted: boolean;
  packet: PacketState | null;
  /** M1-05 standing-demand resolve readout (the live cache loop). */
  demand: DemandReadout;
}
