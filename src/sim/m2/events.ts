/**
 * M2f — THE EMERGENT-EVENT MODEL (GDD §3 the story generator + Risk-7 the Football Manager test).
 *
 * GDD §3 names the manager-sim "stories" hook: the network must not be an inert optimisation, so
 * Signal Horizon needs a STORY GENERATOR — "breaking data-events (a Mars dust storm spikes
 * observation demand; a science flagship launches and needs backbone now; a rival's relay fails
 * and their customers come knocking), rival operators with names and personalities, and outages
 * with consequences". These are "cheap to author and turn a graph into a place where things
 * happen to you". Risk-7 / §10 set the bar: does the generator produce enough stories to give
 * the spreadsheet a soul?
 *
 * This module is the PURE event model: a discriminated union of M2 world events the
 * {@link import("./event-generator").EventGenerator} emits over sim-time, plus a small append-only
 * {@link M2EventLog} buffer. The events MATTER (they are not flavour masquerading as state, the
 * §4.12 honesty precondition): a DEMAND_SHOCK is applied to the world (a temporary region demand
 * multiplier the session rides on the M2e dynamic demand), and a rival RELAY_FAILURE spawns a real
 * lucrative CONTRACT OFFER ("their customers come knocking"). The session surfaces these in the
 * SYSTEM.LOG as TRUTHFUL §8-highlighted lines (a shock line means the demand actually bumped).
 *
 * --- PURITY / DETERMINISM ---------------------------------------------------
 * Pure data only — no three / DOM / wall-clock; the only randomness is the SEEDED splitmix64
 * SimRng the generator draws from (never the unseeded JS random). Every event carries a SIM
 * timestamp (`tick` + `tSim = tick·DT`, never wall-clock) + a monotonic `seq`, so the rendered
 * feed has stable keys and same-tick ties keep a deterministic order. The generator cursor + the
 * active shocks + the rival event log all fold into the BuildSession snapshot/state-hash, so the
 * event STREAM + its WORLD EFFECTS reproduce bit-identically on replay.
 *
 * Numbers/text are sane placeholders (tune later); named constants keep the dials in the generator.
 */

/** Severity for the §8 syntax-highlighting ramp (mirrors the M1 event vocabulary 1:1 so the
 * render layer needs no translation table). */
export type M2EventSeverity = "info" | "warn" | "error" | "crit";

/** The kinds of RIVAL action the story generator attributes to a named operator (§3). For V1
 * these are the EVENT SOURCE (deep competition AI is deferred — see {@link import("./rivals").RIVALS}):
 *   - "undercut"      a rival cuts price in a region (market-pressure flavour);
 *   - "peer"          a rival opens a peering interconnect (cooperative flavour);
 *   - "relay_failure" a rival's relay fails — "their customers come knocking" (spawns a CONTRACT OFFER). */
export type RivalActionKind = "undercut" | "peer" | "relay_failure";

/**
 * The discriminated union of M2 world events. Each carries a SIM timestamp + monotonic `seq`.
 *
 *   - DEMAND_SHOCK  a region's demand spikes temporarily (a Mars/region dust storm, a flagship
 *                   launch needing backbone NOW). Applied as a TEMPORARY multiplier on the region's
 *                   cells that DECAYS/expires after `durationS` (the world coupling — coverage/
 *                   contracts/score react, then it returns toward baseline; no permanent drift).
 *   - RIVAL_ACTION  a named rival operator does something (undercut / peer / relay_failure). A
 *                   relay_failure spawns a lucrative contract offer ("customers come knocking").
 *   - NEWS          a flavour / outage headline (a spectrum auction, a maintenance window) — surfaced
 *                   truthfully in the log; no world effect of its own (it narrates real cadence).
 */
export type M2Event =
  | {
      kind: "demand_shock";
      seq: number;
      tick: number;
      tSim: number;
      /** Glanceable region label (the metro/hotspot the shock hit — e.g. "EAST ASIA"). */
      regionLabel: string;
      /** Hotspot centre (radians) the shock's cell set was resolved around (for re-resolve on restore). */
      latRad: number;
      lonRad: number;
      /** The grid cell ids the shock multiplies (resolved deterministically at emit, sorted). */
      cellIds: number[];
      /** The demand MULTIPLIER applied to the region while active (> 1 = a spike). */
      multiplier: number;
      /** How long the shock rides before it has fully decayed back to baseline (sim-seconds). */
      durationS: number;
      /** A short human cause (e.g. "DUST STORM", "FLAGSHIP LAUNCH") for the log prose. */
      cause: string;
    }
  | {
      kind: "rival_action";
      seq: number;
      tick: number;
      tSim: number;
      /** The named rival operator this is attributed to ({@link import("./rivals").Rival.id}). */
      rivalId: string;
      kind2: RivalActionKind;
      /** The region the action concerns (for the prose + a relay_failure's spawned-contract target). */
      regionLabel: string;
      /** For relay_failure: the id of the CONTRACT OFFER spawned ("customers come knocking"), else null. */
      spawnedContractId: string | null;
    }
  | {
      kind: "news";
      seq: number;
      tick: number;
      tSim: number;
      /** The headline text (truthful flavour — narrates real cadence, never fakes state). */
      text: string;
      severity: M2EventSeverity;
    };

/** Every M2Event kind has these common fields. */
export type M2EventBase = Pick<M2Event, "kind" | "seq" | "tick" | "tSim">;

/** JSON-safe capture of one event (folds into the session snapshot — every field is bit-stable). */
export type M2EventSnapshot = M2Event;

/**
 * An append-only, deterministic M2 world-event buffer (the sibling of the M1
 * {@link import("../m1/eventlog").EventLog}, kept SEPARATE — the M2 build session is its own
 * world). The generator pushes events; the panel drains the tail by `seq`. Stamps `seq`
 * monotonically (never reused, survives the cap drop), so even after a drop a surviving event
 * carries its original ordinal — stable render keys + a truthful "event #N" identity.
 *
 * Unlike the M1 EventLog, this buffer DOES fold into the snapshot/state-hash (it carries the
 * world events whose effects are live — active shocks + spawned contracts are reconstructed from
 * the active-shock list the session holds, but the visible event stream itself is part of the
 * saved state so a restored game shows the same history + reproduces the same hash).
 */
export class M2EventLog {
  /** Max retained events; Infinity = unbounded (the recording/replay log). */
  readonly cap: number;
  private events: M2Event[] = [];
  private nextSeq = 0;

  constructor(cap = Number.POSITIVE_INFINITY) {
    this.cap = cap > 0 ? cap : Number.POSITIVE_INFINITY;
  }

  /** Events CURRENTLY retained (after any cap drops). */
  get size(): number {
    return this.events.length;
  }

  /** The next ordinal that will be stamped (== total appended so far). */
  get appended(): number {
    return this.nextSeq;
  }

  /**
   * Append an event built by `make`, which receives the ordinal `seq` to stamp. Stamps `seq`
   * deterministically, pushes, drops the oldest if over `cap`. Returns the appended event.
   */
  push(make: (seq: number) => M2Event): M2Event {
    const ev = make(this.nextSeq);
    this.nextSeq++;
    this.events.push(ev);
    if (this.events.length > this.cap) this.events.shift();
    return ev;
  }

  /** All retained events, oldest→newest (a COPY — callers cannot mutate the record). */
  readAll(): M2Event[] {
    return this.events.slice();
  }

  /** Events with `seq >= sinceSeq`, oldest→newest — the incremental tail the panel drains. */
  readSince(sinceSeq: number): M2Event[] {
    if (this.events.length === 0) return [];
    let i = 0;
    while (i < this.events.length && this.events[i].seq < sinceSeq) i++;
    return this.events.slice(i);
  }

  /** JSON-safe capture (the whole retained stream + the seq cursor) for the session snapshot. */
  snapshot(): { events: M2Event[]; nextSeq: number } {
    return { events: this.events.map(cloneM2Event), nextSeq: this.nextSeq };
  }

  /** Restore the stream + the seq cursor from a snapshot. */
  restore(s: { events: M2Event[]; nextSeq: number }): void {
    this.events = (s.events ?? []).map(cloneM2Event);
    this.nextSeq = s.nextSeq ?? this.events.length;
  }
}

/** Deep-copy an event by value (no shared mutable cell-list across snapshots). */
export function cloneM2Event(e: M2Event): M2Event {
  if (e.kind === "demand_shock") return { ...e, cellIds: e.cellIds.slice() };
  return { ...e };
}
