/**
 * E9 (M1-10b) — THE TRUTHFUL EVENT LOG (the parse seed).
 *
 * GDD §4.12 makes the LEGIBLE RECORD the spine-level hinge between taming-to-
 * functional and optimising-to-optimal, and names two preconditions it cannot
 * fudge: the record must be COMPLETE and HONEST (every served/missed/stale serve,
 * every cache hit/miss, every prefetch timely-or-wasted, every link drop — all
 * timestamped, truthful), and it is CHEAP here because the sim IS the truth layer
 * — "the record is just the sim's own event stream, surfaced." A record that lied
 * or hid things would make analysis worthless.
 *
 * This module is that event stream's PURE core: a typed, append-only, deterministic
 * sequence of {@link M1Event}s plus an {@link EventLog} buffer. ZERO three / DOM /
 * wall-clock / RNG — the events are emitted purely from {@link M1Session} state
 * transitions, so the stream is a PURE function of (eph, the recorded action log,
 * dt) and REPLAYS BIT-IDENTICALLY. That replay-identity IS the honesty guarantee:
 * the §4.12 parse can trust the record because the sim that produced it is
 * deterministic (see m1-session-replay.test.ts + eventlog.test.ts).
 *
 * EDGE-TRIGGERED, NOT LEVEL. We log when something HAPPENS — a serve band
 * TRANSITION, a fetch launch/arrival, a cache store/evict, a prefetch firing, a
 * policy change, a blackout enter/exit — never per-tick state. Logging 5 feeds'
 * level every tick would flood the record and be useless for the parse; the
 * transition is the analysable unit ("when did this feed go stale?", "which
 * prefetch fired late?").
 *
 * The events are a DERIVED SIDE-OUTPUT: the canonical session state is
 * balance/cache/fetch/policy, and the event stream is kept OUT of the replay
 * state-hash (the golden 8072561960299808504n is unchanged). The stream is proven
 * deterministic separately, by recording it on a run and on a replay of the same
 * action log and asserting the ordered sequences are identical.
 */

/** The serve bands a feed delivery can land on (mirrors ResolveOutcome 1:1). */
export type ServeBand = "fresh" | "stale" | "miss" | "blackout_miss";

/** Why a prefetch leg was launched — the §4.12 "timely or wasted" distinction's source. */
export type PrefetchKind =
  | "manual" // the player pressed P (a logged prefetch action).
  | "auto" // the standing policy topped a feed up below its freshness floor.
  | "prestage"; // the standing policy pre-staged ahead of a forecast blackout (the §4.4 skill).

/** Why a cache slot was dropped (the eviction policy's reason, for the parse). */
export type EvictReason = "lowest_freshness"; // the only policy today (Cache.evictStalest).

/**
 * Severity for the §8 syntax-highlighting ramp. Mirrors the panel's
 * {@link import("../../types").Severity} vocabulary so the render layer maps
 * 1:1 with no translation table.
 */
export type EventSeverity = "info" | "warn" | "error" | "crit";

/**
 * The discriminated union of material M1 events. Every variant carries a SIM
 * timestamp — `tick` (the integer fixed-step clock) and `tSim` (sim-seconds =
 * tick·DT) — NOT wall-clock. `seq` is a monotonic per-log ordinal the {@link
 * EventLog} stamps on append, so the render layer can key DOM rows stably and ties
 * at the same tick keep a deterministic order.
 *
 * Payloads are typed (no `any`): feed/dataset ids, the band, freshness in [0,1],
 * € deltas, slot info, policy mode/floor. These ARE the parse's raw rows.
 */
export type M1Event =
  | {
      kind: "serve";
      seq: number;
      tick: number;
      tSim: number;
      /** The feed whose delivery band changed. */
      feedId: string;
      datasetId: string;
      /** The band it transitioned INTO this step (edge-triggered). */
      band: ServeBand;
      /** The band it held BEFORE (null on the very first observation of the feed). */
      from: ServeBand | null;
      /** Freshness of the served copy in [0,1] (0 on a miss/blackout). */
      freshness: number;
      /** True iff the serve came from the shared cache (a hit). */
      viaCache: boolean;
    }
  | {
      kind: "fetch_launch";
      seq: number;
      tick: number;
      tSim: number;
      feedId: string;
      datasetId: string;
      /** One-way Earth→Mars ETA (sim-seconds) frozen at launch. */
      etaSeconds: number;
      /** Why this leg launched: a natural miss-fetch, or which prefetch path. */
      cause: "miss" | PrefetchKind;
    }
  | {
      kind: "fetch_arrive";
      seq: number;
      tick: number;
      tSim: number;
      feedId: string;
      datasetId: string;
      /** The TRUE landed freshness of the stored copy at arrival (≈0.75 fresh cap, then decaying). */
      landedFreshness: number;
    }
  | {
      kind: "cache_store";
      seq: number;
      tick: number;
      tSim: number;
      datasetId: string;
      /** Freshness of the copy at the store instant, in [0,1]. */
      freshness: number;
      /** Occupied slots / capacity AFTER the store (the contention readout). */
      slotsUsed: number;
      slotCapacity: number;
    }
  | {
      kind: "cache_evict";
      seq: number;
      tick: number;
      tSim: number;
      /** The dataset whose slot was dropped to make room. */
      datasetId: string;
      /** Freshness of the evicted copy at the eviction instant (the "how stale was it" the parse wants). */
      freshness: number;
      /** The dataset whose incoming store forced the eviction. */
      forBy: string;
      reason: EvictReason;
    }
  | {
      kind: "prefetch";
      seq: number;
      tick: number;
      tSim: number;
      feedId: string;
      datasetId: string;
      /** Manual (P) / auto floor top-up / blackout pre-stage. */
      cause: PrefetchKind;
      /** One-way Earth→Mars ETA (sim-seconds) of the leg this prefetch launched. */
      etaSeconds: number;
      /** The one-shot € cost charged (positive magnitude). */
      costEur: number;
    }
  | {
      kind: "policy";
      seq: number;
      tick: number;
      tSim: number;
      /** The mode the standing policy changed TO. */
      mode: "manual" | "freshness" | "freshness_blackout";
      /** The freshness floor the autopilot tops up to, in [0,1]. */
      floor: number;
      /** The mode it changed FROM (null on the first policy observation). */
      from: "manual" | "freshness" | "freshness_blackout" | null;
    }
  | {
      kind: "blackout";
      seq: number;
      tick: number;
      tSim: number;
      feedId: string;
      /** "enter" = link feasible→infeasible; "exit" = back. */
      edge: "enter" | "exit";
    };

/** Every M1Event kind has these common fields — handy for the render layer. */
export type M1EventBase = Pick<M1Event, "kind" | "seq" | "tick" | "tSim">;

/**
 * An append-only, deterministic event buffer.
 *
 * CAP / DROP POLICY (documented determinism contract): an EventLog can be bounded
 * (a ring that DROPS THE OLDEST event once `cap` is exceeded) or unbounded
 * (`cap === Infinity`, the default). The drop is purely a function of insertion
 * order, so a bounded log's contents are themselves deterministic — but a bounded
 * log is for the LIVE PANEL only (it shows the recent tail). The determinism test
 * records the session into an UNBOUNDED log so it can compare the FULL ordered
 * sequence run-vs-replay; the render panel reads from a bounded view without
 * affecting that recorded sequence.
 *
 * `seq` is stamped on append (monotonic from 0) and survives drops, so even a
 * bounded log's surviving events carry their original ordinal — stable DOM keys,
 * and a truthful "this is event #N" identity.
 */
export class EventLog {
  /** Max retained events; Infinity = unbounded (the recording log). */
  readonly cap: number;
  /** The retained events, oldest→newest. A plain array (no per-append realloc storm at these sizes). */
  private events: M1Event[] = [];
  /** Monotonic ordinal stamped on the NEXT append (never reused, survives drops). */
  private nextSeq = 0;

  constructor(cap = Number.POSITIVE_INFINITY) {
    this.cap = cap > 0 ? cap : Number.POSITIVE_INFINITY;
  }

  /** Number of events CURRENTLY retained (after any drops). */
  get size(): number {
    return this.events.length;
  }

  /** The next ordinal that will be stamped — equals the TOTAL appended so far. */
  get appended(): number {
    return this.nextSeq;
  }

  /**
   * Append an event built by `make`, which receives the ordinal `seq` to stamp.
   * Stamps `seq` deterministically, pushes, and drops the oldest if over `cap`.
   * Returns the appended event (with its stamped `seq`).
   */
  push(make: (seq: number) => M1Event): M1Event {
    const ev = make(this.nextSeq);
    this.nextSeq++;
    this.events.push(ev);
    if (this.events.length > this.cap) {
      // Drop oldest. At these volumes a shift is fine; the ring stays small for
      // the live panel and the recording log never drops (cap === Infinity).
      this.events.shift();
    }
    return ev;
  }

  /** All retained events, oldest→newest. Returns a COPY so callers cannot mutate the record. */
  readAll(): M1Event[] {
    return this.events.slice();
  }

  /**
   * Events with `seq >= sinceSeq`, oldest→newest — the INCREMENTAL tail the render
   * panel drains so it appends only NEW rows (no per-frame full-list rebuild).
   * Because `seq` is monotonic and the array is ordered, this is a suffix slice.
   */
  readSince(sinceSeq: number): M1Event[] {
    if (this.events.length === 0) return [];
    // Find the first retained event with seq >= sinceSeq. The array is sorted by
    // seq, so a linear scan from the front is fine for the small live tail; the
    // common case (sinceSeq === appended) returns [] immediately.
    let i = 0;
    while (i < this.events.length && this.events[i].seq < sinceSeq) i++;
    return this.events.slice(i);
  }

  /** Drop every event (test setup / a fresh session). Resets retention but NOT the ordinal stream? */
  clear(): void {
    this.events.length = 0;
    // Keep nextSeq monotonic across clears would be surprising for tests; reset it
    // so a cleared log starts a fresh, reproducible ordinal stream from 0.
    this.nextSeq = 0;
  }
}
