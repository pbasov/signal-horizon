/**
 * net/ — THE CONSTELLATION PHASING ASSIST (§3.3 the assist seam, Act 2). The planner ASSISTS:
 * it derives — EMPIRICALLY, never assumed — the zero-gap constellation minimum N for holding a
 * region under continuous coverage from a LEO orbit family, then hands back a VIABLE-BUT-IMPERFECT
 * set (one short of zero-gap, clamped ≥ a real constellation). Closing the final hand-off gap (the
 * last sat) stays the player's act (§3.2/§3.3). One launch = several phased sats into a plane (§3.4).
 *
 * --- WHY A SEPARATE FILE (not world.ts) ------------------------------------------------------
 * The assist needs BOTH the orbit builders/presets (world.ts) AND the rolling availability verdict
 * (availability.ts). But availability.ts already depends on world.ts (it reads A1_LEO_PERIOD_S for
 * its window length), so importing availability.ts back into world.ts would form an init-time
 * import CYCLE (world's top-level constant would be in the TDZ when availability.ts reads it). This
 * file sits ABOVE both — it imports world.ts + availability.ts, and neither imports it — so the
 * cycle never forms. (The design allowed "world.ts OR net/phasing.ts"; the cycle picks phasing.ts.)
 *
 * PURE: fixed sample counts + fixed phase offsets ⇒ a deterministic function of (region, preset,
 * slaAvail, t). No three / DOM / wall-clock / unseeded RNG. The empirical probe reuses the SAME
 * builders the live applier commits (resolveOrbit + the standard loadout), so a measured set is
 * byte-truthful to what a batch launch lands.
 *
 * @see docs/signal-horizon-m1.md Part II §3.3 (the assist), §3.4 (launch-as-a-batch), §3.2 (LOCKED).
 */

import type { Ephemeris } from "../ephemeris";
import type { NetSat } from "./sat";
import { standardLoadout } from "./sat";
import type { Region, GroundNet } from "./endpoint";
import { type RoutableContract, type RouterAxis } from "./router";
import { windowAvailability } from "./availability";
import {
  type LaunchDraft,
  type NetPreset,
  resolveOrbit,
  A1_LEO_PERIOD_S,
} from "./world";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

const TAU = Math.PI * 2;

/**
 * The shortfall the assist deliberately leaves UNCLOSED: the suggestion is
 * `zeroGapN − NET_PHASING_ASSIST_SHORTFALL` (clamped ≥ 2 — always a real constellation).
 * The planner ASSISTS but the final sat (closing the last hand-off gap) stays the player's
 * act (§3.2/§3.3 — a viable-but-imperfect result the player completes). 1 ⇒ the assist
 * hands the player the N=3 constellation (a measured 68.8% rolling availability, a real
 * sat-to-sat hand-off with a small, visible gap) for the shipped LEO_SWEEP/REGION-1.
 */
export const NET_PHASING_ASSIST_SHORTFALL = 1;

/** The floor the assist never drops below: a CONSTELLATION hands off, so the suggestion is
 * always ≥ 2 sats (never a degenerate lone LEO, even if a future preset has zeroGapN = 2). */
export const NET_PHASING_MIN_CONSTELLATION = 2;

/** The largest N the empirical search probes for the zero-gap minimum (a safety cap so the
 * search always terminates; the shipped LEO_SWEEP/REGION-1 crosses the bar at N=4). */
export const NET_PHASING_MAX_PROBE_N = 12;

/** Phases sampled across one LEO period when measuring a candidate constellation's HELD
 * fraction (the worst-phase rolling availability must clear the bar for a true zero-gap). */
export const NET_PHASING_PROBE_PHASES = 16;

/**
 * A constellation phasing suggestion (§3.3): a set of evenly in-plane-phased {@link LaunchDraft}s
 * the planner offers for CONTINUOUS coverage of a region from one orbit family. `count` is the
 * VIABLE-BUT-IMPERFECT assist size (`zeroGapN − shortfall`, clamped ≥ 2); `zeroGapN` is the
 * EMPIRICALLY MEASURED continuous-coverage minimum the trace surfaces. Closing the gap from
 * `count` to `zeroGapN` stays the player's act.
 */
export interface PhasingSuggestion {
  /** The suggested constellation size (= `zeroGapN − NET_PHASING_ASSIST_SHORTFALL`, clamped
   * ≥ {@link NET_PHASING_MIN_CONSTELLATION}). Deliberately short of zero-gap — the closable gap. */
  count: number;
  /** The even in-plane mean-anomaly spread between adjacent members (= 2π / count). */
  phaseSpreadRad: number;
  /** One draft per suggested member, same plane, m0 spread evenly by `i · phaseSpreadRad`. */
  drafts: LaunchDraft[];
  /** The orbit family the assist phases (the seeding preset id, e.g. "LEO_SWEEP"). */
  basePresetId: string;
  /** A truthful preview of the SUGGESTED set's rolling availability (≈ the closable gap;
   * measured ~0.69 at the shipped N=3 — below `slaAvail`, markedly above a lone LEO). */
  estCoveredFraction: number;
  /** The MEASURED continuous-coverage minimum N (the empirical pin; 4 for LEO_SWEEP/REGION-1).
   * Surfaced for the trace ("you need ≈ zeroGapN evenly-phased sats"). */
  zeroGapN: number;
}

/**
 * Build a candidate constellation of `count` LEO-family sats evenly phased in mean anomaly
 * (member `i` is the preset orbit with `m0 += i · 2π/count`) at sim-time `t`. The SAME
 * builders the live applier uses (resolveOrbit + the standard loadout), so a measurement of
 * this train is byte-truthful to what a batch launch commits. Pure.
 */
function phasedTrain(preset: NetPreset, count: number, t: number): NetSat[] {
  const spread = TAU / Math.max(1, count);
  const out: NetSat[] = [];
  for (let i = 0; i < count; i++) {
    const orbit = resolveOrbit(preset, t);
    orbit.m0Rad += i * spread;
    const loadout = standardLoadout(NET_REF_LINK_DISTANCE_M);
    for (const a of loadout) a.eirp = preset.eirp;
    out.push({ id: `PHASE-${i}`, orbit, bus: "smallsat", loadout });
  }
  return out;
}

/**
 * The WORST-phase rolling availability of a candidate constellation over a region: sample
 * {@link windowAvailability} at {@link NET_PHASING_PROBE_PHASES} evenly-spaced phases across
 * one LEO period and return the MINIMUM. A true zero-gap constellation holds the bar at EVERY
 * phase (worst-phase ≥ slaAvail), so the min — not an instantaneous reading — is the honest
 * "is the region held across the whole hand-off cycle?" measure. Pure.
 */
function worstPhaseAvailability(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  grounds: GroundNet[],
  t: number,
): number {
  const W = A1_LEO_PERIOD_S;
  let worst = Infinity;
  for (let k = 0; k < NET_PHASING_PROBE_PHASES; k++) {
    const tt = t + (W * k) / NET_PHASING_PROBE_PHASES;
    const a = windowAvailability(eph, contract, sats, grounds, tt);
    if (a < worst) worst = a;
  }
  return Number.isFinite(worst) ? worst : 0;
}

/**
 * THE PHASING ASSIST (§3.3, Act 2). Suggest a phased constellation that DELIVERS continuous
 * coverage of `region` from a LEO orbit family — deriving the zero-gap minimum N EMPIRICALLY
 * (never assumed): probe increasing N (evenly m0-spread trains, the SAME builders the applier
 * uses) and take the smallest N whose WORST-phase rolling availability crosses `slaAvail` as
 * `zeroGapN`. The returned suggestion is `zeroGapN − {@link NET_PHASING_ASSIST_SHORTFALL}`
 * (clamped ≥ {@link NET_PHASING_MIN_CONSTELLATION}) — a viable-but-imperfect constellation that
 * hands off but leaves the player the last gap to close (§3.2/§3.3).
 *
 * `count = 1, phaseSpread = 0` never arises here (the suggestion is always ≥ 2). The drafts
 * are spread by `2π/count` in mean anomaly so a single batch launch (the B2 batch wire) places
 * the whole set into one plane. Pure: a deterministic function of (region, preset, slaAvail, t).
 */
export function suggestPhasing(
  eph: Ephemeris,
  region: Region,
  preset: NetPreset,
  slaAvail: number,
  t: number,
  grounds: GroundNet[],
): PhasingSuggestion {
  // The availability-active routable contract over the region (the SAME shape the live solve
  // + windowAvailability read; only the geometry + active axes matter to the measurement).
  const contract: RoutableContract = {
    id: region.id,
    region,
    activeAxes: new Set<RouterAxis>(["connectivity", "availability"]),
  };

  // Empirically derive the zero-gap minimum: the smallest N whose worst-phase rolling
  // availability clears the bar. Cap the probe so the search always terminates.
  let zeroGapN = NET_PHASING_MAX_PROBE_N;
  for (let n = NET_PHASING_MIN_CONSTELLATION; n <= NET_PHASING_MAX_PROBE_N; n++) {
    const train = phasedTrain(preset, n, t);
    if (worstPhaseAvailability(eph, contract, train, grounds, t) >= slaAvail) {
      zeroGapN = n;
      break;
    }
  }

  // The viable-but-imperfect assist: one short of zero-gap, but never below a constellation.
  const count = Math.max(
    NET_PHASING_MIN_CONSTELLATION,
    zeroGapN - NET_PHASING_ASSIST_SHORTFALL,
  );
  const phaseSpreadRad = TAU / count;

  // The drafts the planner would commit as ONE batch launch (member i is m0-spread by i·spread).
  const loadout = standardLoadout(NET_REF_LINK_DISTANCE_M);
  for (const a of loadout) a.eirp = preset.eirp;
  const drafts: LaunchDraft[] = [];
  for (let i = 0; i < count; i++) {
    drafts.push({
      semiMajorM: preset.semiMajorM,
      incRad: preset.incRad,
      // The base sub-longitude + an even in-plane phase offset. resolveOrbit maps subLonRad
      // into m0 (= subLon + ω·t), so adding i·phaseSpreadRad here is an even m0 spread — the
      // SAME phasing the batch applier reproduces via the phaseSpreadRad wire term.
      subLonRad: preset.subLonRad + i * phaseSpreadRad,
      loadout: loadout.map((a) => ({ ...a })),
      count: 1,
    });
  }

  // A truthful preview of the SUGGESTED set's held-fraction (the worst-phase rolling
  // availability — the closable gap the player sees: below slaAvail, above a lone LEO).
  const suggestedTrain = phasedTrain(preset, count, t);
  const estCoveredFraction = worstPhaseAvailability(eph, contract, suggestedTrain, grounds, t);

  return { count, phaseSpreadRad, drafts, basePresetId: preset.id, estCoveredFraction, zeroGapN };
}
