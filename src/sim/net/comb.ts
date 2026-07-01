/**
 * net/ — THE COVERAGE COMB (m1-redesign.md §2.2 phase 2): for a focused region, the
 * truthful line-of-sight windows a DRAFT orbit produces over one orbital period. Facts
 * only (LAW 1): geometry windows computed with the draft's own antenna physics via the
 * SAME link-budget the live router runs — never a verdict, never a suggestion.
 *
 * The comb answers "when does THIS orbit see THAT region (and a ground station)?" — a
 * solid comb parks (GEO), a striped comb sweeps (LEO). What the player does with that
 * fact is their game.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG.
 */

import type { Ephemeris } from "../ephemeris";
import type { Region, GroundNet, RegionPoint } from "./endpoint";
import type { LaunchDraft } from "./world";
import { draftToSat } from "./world";
import { orbitPeriodSeconds } from "../m2/orbit";
import { A1_GEO_PERIOD_S } from "./world";
import { bridgeForPoint } from "./router";

/** One comb: fixed-count boolean windows across one orbital period from `t0`. */
export interface CoverageComb {
  /** Sample verdicts: does the draft bridge region→sat→ground at sample k's instant? */
  windows: boolean[];
  /** The sampled span (seconds) — one draft period (a GEO's equals the toy day). */
  spanS: number;
  /** Duty fraction ∈ [0,1] — the fraction of samples that bridge. */
  duty: number;
}

/** Fixed sample count across the comb (pure; a render hint, not physics). */
export const NET_COMB_SAMPLES = 48;

/**
 * Compute the comb for a draft over a region at commit-time `t0`. Each sample asks the
 * REAL bridge predicate (elevation + inverse-square + LoS, with the draft's antenna)
 * whether the would-be sat carries region→ground at that instant — permissive on
 * eligibility (the comb is geometry truth; pointing happens after launch).
 */
export function coverageComb(
  eph: Ephemeris,
  region: Region,
  grounds: GroundNet[],
  draft: LaunchDraft,
  t0: number,
): CoverageComb {
  const sat = draftToSat(draft, t0);
  const periodS = orbitPeriodSeconds(sat.orbit);
  const spanS = periodS > 0 ? periodS : A1_GEO_PERIOD_S;
  const centre: RegionPoint = { latRad: region.latRad, lonRad: region.lonRad };
  const windows: boolean[] = [];
  let up = 0;
  for (let k = 0; k < NET_COMB_SAMPLES; k++) {
    const t = t0 + (spanS * k) / NET_COMB_SAMPLES;
    const bridged = bridgeForPoint(eph, centre, grounds, [sat], t).satId !== null;
    windows.push(bridged);
    if (bridged) up++;
  }
  return { windows, spanS, duty: up / NET_COMB_SAMPLES };
}
