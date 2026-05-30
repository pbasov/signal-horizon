/**
 * M2f — THE DETERMINISTIC EMERGENT-EVENT GENERATOR (GDD §3 the story generator, Risk-7).
 *
 * Emits {@link M2Event}s over sim-time off the SESSION's seeded splitmix64 {@link SimRng} (never
 * the unseeded JS random), so the SAME seed ⇒ the SAME event timeline at the SAME ticks on replay.
 * The cadence is a CURSOR + an RNG-jittered interval (the same pattern as the M2d contract offer
 * generator): a handful of events per session, irregular but deterministic. The cursor + the
 * monotonic event counter fold into the session snapshot (alongside the RNG state) so a saved game
 * resumes the same schedule.
 *
 * --- WHAT IT EMITS + HOW IT COUPLES TO THE WORLD ----------------------------
 * Each fire draws a TYPE from the RNG, then the type's payload:
 *   - DEMAND_SHOCK   pick a region hotspot + a multiplier + a duration → resolve the region's grid
 *                    cells. The session rides this on the M2e dynamic demand as a TEMPORARY
 *                    multiplier that DECAYS to baseline over the duration (the world coupling — a
 *                    served region's value spikes, straining capacity, then returns; no drift).
 *   - RIVAL_ACTION   pick a named rival + a kind (undercut / peer / relay_failure). A relay_failure
 *                    means "their customers come knocking": the session spawns a lucrative CONTRACT
 *                    OFFER over the region (a real board offer, not flavour).
 *   - NEWS           a flavour/outage headline (truthful cadence narration; no world effect of its own).
 *
 * The generator OWNS the schedule + the RNG draws; it does NOT own the world. It returns an
 * {@link EmitPlan} per fire that the SESSION turns into reality (register a shock / spawn a
 * contract / append the truthful log line) — keeping this module a pure deterministic emitter and
 * the coupling auditable in one place ({@link import("./session").BuildSession.step}).
 *
 * PURE: no three / DOM / wall-clock; randomness only via the passed-in SimRng. Numbers are sane
 * placeholders; named constants keep the dials here.
 */

import { DEG_RAD } from "../ephemeris";
import type { SimRng } from "../rng";
import { RIVALS } from "./rivals";
import type { M2EventSeverity, RivalActionKind } from "./events";

/** First emergent event lands at this sim-time after boot (a short ramp so the network exists
 * before the first thing happens to it). Placeholder. */
export const FIRST_EVENT_AT_SECONDS = 2400.0; // 40 sim-minutes.

/** Mean interval between successive emergent events (sim-seconds); the RNG jitters around it. A
 * handful per long sitting at 1000× — frequent enough to feel alive, sparse enough to read as a
 * "story beat", not noise (the §3 cadence). Placeholder. */
export const EVENT_INTERVAL_MEAN_SECONDS = 4 * 3600.0; // 4 sim-hours.
/** Jitter half-range on the event interval (sim-seconds). */
export const EVENT_INTERVAL_JITTER_SECONDS = 2 * 3600.0;

/** A DEMAND_SHOCK's multiplier range (× baseline region demand while active). A spike worth
 * reacting to but bounded (so a shocked region doesn't dwarf the rest). Placeholder. */
export const SHOCK_MULTIPLIER_MIN = 1.6;
export const SHOCK_MULTIPLIER_MAX = 2.6;
/** A DEMAND_SHOCK's lifetime (sim-seconds) — how long it rides before fully decaying to baseline.
 * Long enough to strain capacity over a chunk of a sitting, short enough to clearly EXPIRE. */
export const SHOCK_DURATION_MIN_SECONDS = 3 * 3600.0; // 3 sim-hours.
export const SHOCK_DURATION_MAX_SECONDS = 6 * 3600.0; // 6 sim-hours.

/** A region a shock / rival action can concern. Mirrors the demand.ts hotspots + the M2d contract
 * targets (same lat/lon metros), so a shock overlays REAL demand + a spawned contract sits over a
 * real region. Fixed data; the generator picks an INDEX from the seeded RNG. */
export interface EventRegion {
  label: string;
  latRad: number;
  lonRad: number;
  /** A short cause word for a shock over this region (e.g. a Mars-style dust storm flavour). */
  shockCause: string;
}

function region(label: string, latDeg: number, lonDeg: number, shockCause: string): EventRegion {
  return { label, latRad: latDeg * DEG_RAD, lonRad: lonDeg * DEG_RAD, shockCause };
}

/** The region pool (mirrors the demand hotspots / contract targets). */
export const EVENT_REGIONS: EventRegion[] = [
  region("EAST ASIA", 35, 120, "FLAGSHIP LAUNCH"),
  region("SOUTH ASIA", 22, 78, "MONSOON DEMAND"),
  region("NORTH AMERICA", 40, -90, "SPECTRUM AUCTION"),
  region("NORTH ATLANTIC EU", 50, 5, "FLAGSHIP LAUNCH"),
  region("SE ASIA", 5, 105, "DUST STORM"),
  region("SUB-SAHARAN AFRICA", 5, 20, "RELIEF SURGE"),
  region("SOUTH AMERICA", -15, -55, "DUST STORM"),
];

/** A few flavour/outage NEWS headlines (truthful cadence narration). Picked by the RNG. */
export const NEWS_HEADLINES: { text: string; severity: M2EventSeverity }[] = [
  { text: "spectrum regulator opens a Ka-band auction window", severity: "info" },
  { text: "solar activity advisory — minor link-margin watch", severity: "warn" },
  { text: "industry consortium ratifies an inter-operator peering standard", severity: "info" },
  { text: "ground-segment maintenance window announced for next cycle", severity: "info" },
];

/** What ONE emit wants the session to do — the world-coupling plan (the session executes it). */
export interface EmitPlan {
  /** "demand_shock": register a temporary region demand multiplier (decays over durationS). */
  kind: "demand_shock" | "rival_action" | "news";
  /** For demand_shock + rival_action: the region concerned. */
  region?: EventRegion;
  /** For demand_shock: the multiplier + duration to ride. */
  multiplier?: number;
  durationS?: number;
  /** For rival_action: the rival + the action kind. */
  rivalId?: string;
  rivalKind?: RivalActionKind;
  /** For news: the headline. */
  newsText?: string;
  newsSeverity?: "info" | "warn" | "error" | "crit";
}

/** JSON-safe capture of the generator's schedule cursor (folds into the snapshot). */
export interface EventGeneratorSnapshot {
  /** Sim-time the next event is due. */
  nextEventAtS: number;
  /** Monotonic count of events ever emitted (for any id stream the session derives). */
  emittedCount: number;
}

/**
 * The deterministic emergent-event generator. Owns the schedule cursor + the monotonic counter;
 * draws every choice (interval, type, region, multiplier, duration, rival, kind, headline) from
 * the SESSION's SimRng in a FIXED order so the same stream yields the same timeline. It does NOT
 * own the RNG (the session does — one stream so the snapshot is single-sourced) and it does NOT
 * own the world (it returns {@link EmitPlan}s the session executes).
 */
export class EventGenerator {
  private nextEventAtS = FIRST_EVENT_AT_SECONDS;
  private emittedCount = 0;

  /**
   * Advance the schedule to sim-time `nowS`, returning the ordered list of {@link EmitPlan}s that
   * came due this step (usually 0; rarely 1; more only if a huge dt jumped several intervals). For
   * each, draw the type + payload from `rng` and re-arm the cursor with an RNG-jittered interval.
   * Pure given (rng state, nowS): the same stream yields the same plans. A bounded loop (each fire
   * advances the cursor by ≥ a positive interval) so it always terminates.
   */
  step(rng: SimRng, nowS: number): EmitPlan[] {
    const out: EmitPlan[] = [];
    // Guard against a pathological burst if a colossal dt is passed: cap the catch-up.
    let guard = 0;
    while (nowS >= this.nextEventAtS && guard < 64) {
      out.push(this.draw(rng));
      this.emittedCount++;
      this.nextEventAtS += this.nextInterval(rng);
      guard++;
    }
    return out;
  }

  /** Draw ONE event's type + payload off the RNG (fixed draw order ⇒ deterministic). */
  private draw(rng: SimRng): EmitPlan {
    // Type roll: 0 = demand_shock, 1 = rival_action, 2 = news (weighted toward the two that MATTER).
    const roll = rng.nextIntRange(0, 9);
    if (roll <= 3) {
      // DEMAND_SHOCK (40%).
      const reg = EVENT_REGIONS[rng.nextIntRange(0, EVENT_REGIONS.length - 1)];
      const multiplier = rng.nextDoubleRange(SHOCK_MULTIPLIER_MIN, SHOCK_MULTIPLIER_MAX);
      const durationS = rng.nextDoubleRange(SHOCK_DURATION_MIN_SECONDS, SHOCK_DURATION_MAX_SECONDS);
      return { kind: "demand_shock", region: reg, multiplier, durationS };
    }
    if (roll <= 7) {
      // RIVAL_ACTION (40%).
      const rival = RIVALS[rng.nextIntRange(0, RIVALS.length - 1)];
      const reg = EVENT_REGIONS[rng.nextIntRange(0, EVENT_REGIONS.length - 1)];
      const kindRoll = rng.nextIntRange(0, 2);
      const rivalKind: RivalActionKind = kindRoll === 0 ? "undercut" : kindRoll === 1 ? "peer" : "relay_failure";
      return { kind: "rival_action", region: reg, rivalId: rival.id, rivalKind };
    }
    // NEWS (20%).
    const news = NEWS_HEADLINES[rng.nextIntRange(0, NEWS_HEADLINES.length - 1)];
    return { kind: "news", newsText: news.text, newsSeverity: news.severity };
  }

  /** Next event interval (sim-seconds): the mean ± an RNG jitter, floored positive. */
  private nextInterval(rng: SimRng): number {
    const jitter = rng.nextDoubleRange(-EVENT_INTERVAL_JITTER_SECONDS, EVENT_INTERVAL_JITTER_SECONDS);
    return Math.max(60.0, EVENT_INTERVAL_MEAN_SECONDS + jitter);
  }

  /** Monotonic count of events emitted so far (the session derives spawned-contract ids from it). */
  get count(): number {
    return this.emittedCount;
  }

  /** Capture the schedule cursor (for the session snapshot). */
  snapshot(): EventGeneratorSnapshot {
    return { nextEventAtS: this.nextEventAtS, emittedCount: this.emittedCount };
  }

  /** Restore the schedule cursor from a snapshot. */
  restore(s: EventGeneratorSnapshot): void {
    this.nextEventAtS = s.nextEventAtS;
    this.emittedCount = s.emittedCount;
  }
}
