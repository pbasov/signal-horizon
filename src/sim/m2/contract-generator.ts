/**
 * M2d — the DETERMINISTIC CONTRACT OFFER GENERATOR (GDD §3 escalation seed, §4.9).
 *
 * Contracts are OFFERED over sim-time deterministically so replay reproduces the exact
 * same offers at the same ticks. The generator keeps a small number of contracts ON
 * OFFER at once (a few), targeting the demand HOTSPOTS (so accepting a contract over a
 * dense metro is the lucrative-but-demanding choice — the §3 "served regions demand
 * more" seed). It draws from the SESSION's seeded splitmix64 SimRng (never the unseeded
 * JS random): which target, the term, and the next offer interval are all rolled from
 * that stream, so the offer schedule is a pure function of (seed, sim-time).
 *
 * --- HOW THE SCHEDULE IS PINNED ---------------------------------------------
 * The generator advances on the session's per-tick step over `dtSeconds`. It holds a
 * `nextOfferAtS` cursor; once sim-time passes it AND there is a free offer slot, it
 * draws a contract (target + term from the RNG), assigns the monotonic id, and sets the
 * next cursor (current time + an RNG-jittered interval). Because every roll comes off
 * the seeded SimRng in a fixed order, the same seed + dt + accept/decline log yields a
 * bit-identical offer timeline. The cursor + a monotonic offer counter are part of the
 * session snapshot (alongside the RNG state) so a saved game resumes the same schedule.
 *
 * PURE: no three / DOM / wall-clock; randomness only via the passed-in SimRng. Numbers
 * are sane placeholders; named constants keep the dials here.
 */

import { DEG_RAD } from "../ephemeris";
import type { SimRng } from "../rng";
import type { GeodesicGrid } from "../coverage/grid";
import type { DemandReader } from "../coverage/demand";
import {
  type Contract,
  type ContractTarget,
  offerContract,
  DEFAULT_TARGET_RADIUS_DEG,
  DEFAULT_TERM_SECONDS,
} from "./contracts";

/** Max contracts ON OFFER at once (a few — the player picks among them). */
export const MAX_OPEN_OFFERS = 3;

/** First offer lands at this sim-time after a session boots (a short ramp so the player
 * sees the network before the first demand arrives). Placeholder. */
export const FIRST_OFFER_AT_SECONDS = 1800.0; // 30 sim-minutes.

/** Mean interval between successive offers (sim-seconds); the RNG jitters around it so
 * the cadence is irregular but deterministic. Placeholder. */
export const OFFER_INTERVAL_MEAN_SECONDS = 3 * 3600.0; // 3 sim-hours.
/** Jitter half-range on the offer interval (sim-seconds). */
export const OFFER_INTERVAL_JITTER_SECONDS = 1.5 * 3600.0;

/** Term jitter half-range (sim-seconds) around {@link DEFAULT_TERM_SECONDS}. */
export const TERM_JITTER_SECONDS = 2 * 3600.0;

/**
 * The pool of demand-hotspot targets a contract can be offered over. Mirrors the
 * demand.ts metros (the same lat/lon hotspots), so a contract region overlays real
 * demand and serving it draws on the coverage the player builds there. Fixed data, no
 * RNG; the generator picks an INDEX from the seeded SimRng.
 */
export const CONTRACT_TARGETS: ContractTarget[] = [
  target("EAST ASIA", 35, 120),
  target("SOUTH ASIA", 22, 78),
  target("NORTH AMERICA", 40, -90),
  target("NORTH ATLANTIC EU", 50, 5),
  target("SE ASIA", 5, 105),
  target("SUB-SAHARAN AFRICA", 5, 20),
  target("SOUTH AMERICA", -15, -55),
];

/** Build a contract target from lat/lon DEGREES + the default angular radius. */
function target(label: string, latDeg: number, lonDeg: number): ContractTarget {
  return {
    label,
    latRad: latDeg * DEG_RAD,
    lonRad: lonDeg * DEG_RAD,
    radiusRad: DEFAULT_TARGET_RADIUS_DEG * DEG_RAD,
  };
}

/** JSON-safe capture of the generator's schedule cursor (folds into the snapshot). */
export interface GeneratorSnapshot {
  /** Sim-time the next offer is due. */
  nextOfferAtS: number;
  /** Monotonic count of contracts ever offered (drives the contract ids c0, c1 …). */
  offeredCount: number;
}

/**
 * The deterministic offer generator. Owns the schedule cursor + the monotonic offer
 * counter; draws targets/terms from the SESSION's SimRng (passed into {@link step}).
 * It does NOT own the RNG (the session does — one stream so the snapshot is single-
 * sourced) and it does NOT own the contracts array (the session holds + mutates it).
 */
export class ContractGenerator {
  private nextOfferAtS = FIRST_OFFER_AT_SECONDS;
  private offeredCount = 0;

  /**
   * Advance the schedule to sim-time `nowS`. While an offer is DUE and there is a free
   * offer slot (fewer than {@link MAX_OPEN_OFFERS} currently OFFERED), draw + push a
   * new OFFERED contract onto `contracts` and re-arm the cursor with an RNG-jittered
   * interval. Pure given (rng state, nowS, the contracts' open count): the same stream
   * yields the same offers. Returns the contracts newly offered this step (for logging).
   */
  step(
    contracts: Contract[],
    rng: SimRng,
    grid: GeodesicGrid,
    demand: DemandReader,
    nowS: number,
  ): Contract[] {
    const offered: Contract[] = [];
    // A bounded loop: catch up if several offers came due in one big dt (time-compression),
    // but never exceed the open-offer cap. The cap check makes this terminate.
    while (nowS >= this.nextOfferAtS && openOfferCount(contracts) < MAX_OPEN_OFFERS) {
      const c = this.draw(rng, grid, demand, this.nextOfferAtS);
      contracts.push(c);
      offered.push(c);
      this.nextOfferAtS += this.nextInterval(rng);
    }
    // If the offer board is full when an offer comes due, slide the cursor forward so
    // we don't fire a burst the instant a slot frees — re-arm from NOW. (Deterministic:
    // the RNG draw for the interval still happens in stream order only when we offer.)
    if (nowS >= this.nextOfferAtS && openOfferCount(contracts) >= MAX_OPEN_OFFERS) {
      this.nextOfferAtS = nowS + this.nextInterval(rng);
    }
    return offered;
  }

  /** Draw one OFFERED contract: an RNG-picked target + an RNG-jittered term. */
  private draw(rng: SimRng, grid: GeodesicGrid, demand: DemandReader, offeredAtS: number): Contract {
    const idx = rng.nextIntRange(0, CONTRACT_TARGETS.length - 1);
    const tgt = CONTRACT_TARGETS[idx];
    const term = DEFAULT_TERM_SECONDS + rng.nextDoubleRange(-TERM_JITTER_SECONDS, TERM_JITTER_SECONDS);
    const id = `c${this.offeredCount++}`;
    return offerContract(id, grid, demand, tgt, offeredAtS, term);
  }

  /** Next offer interval (sim-seconds): the mean ± an RNG jitter, floored positive. */
  private nextInterval(rng: SimRng): number {
    const jitter = rng.nextDoubleRange(-OFFER_INTERVAL_JITTER_SECONDS, OFFER_INTERVAL_JITTER_SECONDS);
    return Math.max(60.0, OFFER_INTERVAL_MEAN_SECONDS + jitter);
  }

  /** Capture the schedule cursor (for the session snapshot). */
  snapshot(): GeneratorSnapshot {
    return { nextOfferAtS: this.nextOfferAtS, offeredCount: this.offeredCount };
  }

  /** Restore the schedule cursor from a snapshot. */
  restore(s: GeneratorSnapshot): void {
    this.nextOfferAtS = s.nextOfferAtS;
    this.offeredCount = s.offeredCount;
  }
}

/** Count contracts currently in the OFFERED state (the open-offer slots in use). */
export function openOfferCount(contracts: Contract[]): number {
  let n = 0;
  for (const c of contracts) if (c.state === "offered") n++;
  return n;
}
