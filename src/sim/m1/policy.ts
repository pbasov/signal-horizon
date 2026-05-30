/**
 * E8 (M1-06b) — PrefetchPolicy: the TAME-IT lever (the relief in the strain→relief arc).
 *
 * E7 made the strain real: 3 cache slots < 5 feeds, held copies decay, so you
 * provably cannot hand-keep all five fresh by mashing P (GDD §9 "you feel it
 * getting away from you"). E8 is the RELIEF: a STANDING policy the system
 * executes for you, so the unit of command RISES from "asset" (a manual P per
 * feed) to "declared intent" (a rule the autopilot runs) — the first rung of the
 * §4.11 leverage curve, the §3a taming-to-FUNCTIONAL moment.
 *
 * The marquee transferable insight it realises (GDD §4.4 + §3a): "pre-stage the
 * cache before the predictable conjunction blackout and you beat the light-gap."
 *
 * PURE + DETERMINISTIC. {@link selectAutoPrefetches} is a pure function of
 * (policy, feed states, cache, eph, t): no three / DOM / wall-clock / RNG. That
 * purity is the determinism contract: the autopilot's choices are DERIVED inside
 * M1Session.step(), so replay reproduces them with NO extra logging — only a
 * CHANGE to the policy is a player intent that gets recorded as a SimAction.
 */
import type { Ephemeris } from "../ephemeris";
import type { Cache } from "./cache";
import { feasible } from "./resolver";

/**
 * How the autopilot decides what to prefetch:
 *   "manual"             — autopilot OFF; only the P key acts (the E7 default).
 *   "freshness"          — top up any feed whose cache freshness has fallen below
 *                          {@link PrefetchPolicy.freshnessFloor}, most-urgent first.
 *   "freshness_blackout" — the above PLUS pre-stage a feed whose link is up NOW
 *                          but forecast DOWN within {@link PrefetchPolicy.blackoutLeadS}
 *                          (top the cache up before the link dies — the §4.4 skill).
 */
export type PrefetchMode = "manual" | "freshness" | "freshness_blackout";

/** The standing prefetch policy: a declared intent the session executes each step. */
export interface PrefetchPolicy {
  mode: PrefetchMode;
  /**
   * In "freshness"/"freshness_blackout": refill a feed whose CURRENT cache
   * freshness is below this floor (0..1). Empty slot reads 0 → always below.
   * Too HIGH → constant churn/eviction-thrash + wasted €50 fetches (lower net);
   * too LOW → starvation (miss/blackout bands, lower net). There is a sweet spot.
   */
  freshnessFloor: number;
  /**
   * Pre-stage lead time (sim-seconds) for "freshness_blackout": if a feed's link
   * is feasible NOW but NOT feasible at t + blackoutLeadS, prefetch now even when
   * above the floor — top the cache up before the conjunction blackout closes it.
   */
  blackoutLeadS: number;
  /**
   * Cap on data legs the autopilot will have crawling at once. The cap COUNTS
   * legs already in flight, so the policy is naturally rate-limited — it never
   * fires a 5×€50 = €250 instant blast; it tops up as legs land.
   */
  maxConcurrentAuto: number;
}

/**
 * The default policy: autopilot OFF (mode "manual"), so default session behaviour
 * is UNCHANGED. The default freshnessFloor 0.7 is the MEASURED economic sweet-spot
 * (a probe over the shipped 5-feed/3-slot roster put the net-balance peak at
 * ≈0.70, beating both lower floors — wasted fetches — and higher floors —
 * eviction churn), so when the player switches the autopilot on it starts at a
 * good value to then tune around. PLACEHOLDER — re-tune if the rates change.
 */
export function defaultPolicy(): PrefetchPolicy {
  return { mode: "manual", freshnessFloor: 0.7, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
}

/** The minimal per-feed view {@link selectAutoPrefetches} needs (decoupled from Demand). */
export interface PolicyFeedState {
  /** Stable feed id (the autopilot returns these to launch). */
  id: string;
  /** The dataset key the cache holds for this feed. */
  datasetId: string;
  /** Link source endpoint (for the feasibility forecast). */
  sourceId: string;
  /** Link customer endpoint (for the feasibility forecast). */
  customerId: string;
  /** True iff this feed already has a data leg crawling (one leg per feed). */
  inFlight: boolean;
}

/** A candidate the policy ranks before applying the concurrency cap. */
interface Candidate {
  id: string;
  /** Lower sorts first. Blackout pre-stages get a negative key so they win. */
  key: number;
}

/**
 * Decide which feeds the autopilot should launch a data leg for THIS step. PURE.
 *
 * Returns an ORDERED list of feed ids (most-urgent first), already trimmed to the
 * concurrency budget. The session launches a leg + charges €50 for each.
 *
 * Rules (see {@link PrefetchMode}):
 *  - eligibility: link UP now (feasible) AND no leg already in flight for the feed.
 *  - "freshness": among eligible feeds with cache freshness < floor, most-urgent
 *    first (lowest freshness; empty slot reads 0 → most urgent).
 *  - "freshness_blackout": ALSO pre-stage an eligible feed feasible(now) but
 *    NOT feasible(t + blackoutLeadS) — even above the floor. Blackout pre-stages
 *    take PRIORITY over routine floor top-ups (they have a hard deadline).
 *  - the concurrency cap COUNTS legs already in flight: budget =
 *    maxConcurrentAuto − legsAlreadyInFlight, so the policy rate-limits itself.
 *  - "manual": returns [] (autopilot off).
 *
 * Ties break on roster order (the input order of `feedStates`), so the choice is
 * a deterministic pure function of (policy, state, geometry).
 */
export function selectAutoPrefetches(
  policy: PrefetchPolicy,
  feedStates: PolicyFeedState[],
  cache: Cache,
  eph: Ephemeris,
  t: number,
): string[] {
  if (policy.mode === "manual") return [];

  // The cap counts EXISTING in-flight legs, so the autopilot tops up as legs land
  // rather than blasting the whole roster at once (no €250 instant spend).
  let legsInFlight = 0;
  for (const f of feedStates) if (f.inFlight) legsInFlight++;
  const budget = policy.maxConcurrentAuto - legsInFlight;
  if (budget <= 0) return [];

  const wantBlackout = policy.mode === "freshness_blackout";
  const candidates: Candidate[] = [];

  for (const f of feedStates) {
    if (f.inFlight) continue; // already crawling a leg.
    if (!feasible(eph, t, f.sourceId, f.customerId, ["sun"])) continue; // link down now.

    const fresh = cache.freshnessOf(f.datasetId, t);

    // Blackout pre-stage: feasible NOW, forecast NOT feasible within the lead
    // window → top up before the link dies, even if above the floor. These have a
    // hard deadline, so they outrank routine floor top-ups (a −1 base on the key).
    if (
      wantBlackout &&
      !feasible(eph, t + policy.blackoutLeadS, f.sourceId, f.customerId, ["sun"])
    ) {
      // Negative key: blackout pre-stages sort ahead of ALL floor top-ups; among
      // themselves the stalest (lowest freshness) goes first.
      candidates.push({ id: f.id, key: -1 - (1 - fresh) });
      continue;
    }

    // Routine floor top-up: only feeds below the freshness floor. Most-urgent
    // first = lowest freshness (the key is the freshness itself, ascending).
    if (fresh < policy.freshnessFloor) {
      candidates.push({ id: f.id, key: fresh });
    }
  }

  // Stable sort by key ascending (blackout pre-stages first, then stalest floor
  // top-ups). Array.prototype.sort is stable in modern engines, so equal keys
  // keep roster order — the deterministic tie-break.
  candidates.sort((a, b) => a.key - b.key);

  const out: string[] = [];
  for (let i = 0; i < candidates.length && out.length < budget; i++) {
    out.push(candidates[i].id);
  }
  return out;
}
