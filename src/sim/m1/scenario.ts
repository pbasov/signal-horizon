/**
 * E10b (M1-12) — THE STRAIN-TUNED 30-MIN SCENARIO. The one-place dial that places
 * the M1 session SHORTLY BEFORE the real Earth↔Mars conjunction so the whole
 * STRAIN → RELIEF → APPROACH → BLACKOUT arc (GDD §9) fits a single ~30-minute
 * sitting against the REAL vendored ephemeris.
 *
 * --- WHY AN EPOCH AT ALL (GDD Risk-6 resolved) ------------------------------
 * The core tension: light-delay (~one-way 21 min near conjunction) needs a SLOW
 * scale to be FELT, but the conjunction is ~182 days out from t=0 and needs a
 * FAST scale to be REACHED — ~5 orders of magnitude apart. The resolution is NOT
 * to fake the physics (the speed of light stays real — AGENTS §4) but to MOVE THE
 * START: begin the mission a little under 11 days BEFORE a real conjunction so the
 * macro-timeline is short, and let the player bridge scales with the existing
 * 1×..1000× time controls — the "waiting" between scales filled by prefetch
 * decisions (GDD §3 "waiting is decisions"). Near conjunction Mars is on the FAR
 * side of the Sun (~2.59 AU), so one-way light is at its WORST (~21.5 min) — the
 * most dramatic light-delay teaching moment, and exactly when the blackout looms.
 *
 * --- HOW SIM-TIME MAPS TO EPHEMERIS-TIME ------------------------------------
 * The simplest honest mapping: THE SIM CLOCK *IS* EPHEMERIS TIME. The clock boots
 * at {@link SCENARIO.tick0} = round(t0 / DT) so every position/LOS read uses the
 * true ephemeris epoch with zero translation. The only adaptation is presentation:
 * the readout shows MISSION-ELAPSED time ({@link missionElapsedSeconds}) so the
 * clock reads "0d 00:00:00" at boot rather than the raw "167d". Pure: no DOM, no
 * three, no wall-clock, no RNG. The mapping is a single subtraction, so live and
 * replay agree trivially.
 *
 * --- THE NUMBERS (computed against the REAL ephemeris; see scenario.test.ts) --
 * With the default solar-interference corridor (links.SOLAR_CORRIDOR_RSUN = 5):
 *   - conjunction at  t ≈ 15,731,438 s, tightest Sun-miss ≈ 3.322 Rsun;
 *   - blackout WINDOW (link dead in-corridor):
 *       enter ≈ 15,439,238 s, exit ≈ 16,021,848 s  (≈ 582,610 s ≈ 6.74 days);
 *   - chosen START EPOCH t0 = 14,500,000 s:
 *       starting Sun-miss margin ≈ 15.93 Rsun — SAFE/green, well above the watch
 *       band edge (1.8 × corridor = 9 Rsun), so the player starts safe and watches
 *       it tighten green → watch → warn → BLACKOUT;
 *       Earth↔Mars distance ≈ 2.589 AU, one-way light ≈ 1292 s ≈ 21.5 min.
 *
 * Real-time from t0 to the blackout, by sustained time scale (start → blackout =
 * enter − t0 = 939,238 sim-s ≈ 10.87 sim-days):
 *       1×    ≈ 15,654 real-min   (unreachable — the light-delay teaching scale)
 *      10×    ≈  1,565 real-min
 *     100×    ≈    156 real-min   (the default boot scale; strain is felt here)
 *    1000×    ≈   15.7 real-min to ENTER, 25.4 to EXIT → ≈ 9.7 real-min of dwell.
 * So at a sustained 1000× the blackout is entered inside the ~15–20 real-minute
 * target, leaving the first third for strain + policy discovery at a lower scale,
 * and minutes to DWELL inside the blackout. The early first-fetch wait (one-way
 * ≈ 1292 s) is ≈ 12.9 real-s at the 100× default — felt, not instant.
 */

import { DT } from "../clock";

/**
 * THE ONE-PLACE SCENARIO DIAL (E10b). Placeholder-tuned values; re-tune here and
 * NOWHERE else. {@link tick0} is derived from {@link t0Seconds} so the integer
 * fixed-step clock boots exactly on the epoch.
 */
export interface ScenarioConfig {
  /** Stable id (for save metadata / future scenario selection). */
  readonly id: string;
  /**
   * START EPOCH t0 in ephemeris-seconds since J2000 — the sim clock's `seconds`
   * at boot. Chosen ≈ 10.87 days before the real conjunction-blackout window so
   * the player starts SAFE (margin ≈ 15.93 Rsun) and the full arc fits ~30 min.
   */
  readonly t0Seconds: number;
}

/**
 * The shipped M1 scenario. t0 = 14,500,000 s ≈ 167.8 days since J2000, ≈ 10.87
 * days before the corridor blackout opens. See the module header for the full
 * real-ephemeris arc table. PLACEHOLDER — tune t0 (earlier = more lead/strain
 * runway, later = a tighter dash to the blackout) here only.
 */
export const SCENARIO: ScenarioConfig & { readonly tick0: number } = {
  id: "m1-conjunction-approach",
  t0Seconds: 14_500_000,
  /** The boot tick: round(t0 / DT) so the clock starts exactly on the epoch. */
  get tick0(): number {
    return Math.round(this.t0Seconds / DT);
  },
};

/**
 * Mission-elapsed seconds at a given ephemeris-sim-time: simSeconds − t0. Clamped
 * at 0 so a pre-epoch read never goes negative. PURE — the only sim↔readout time
 * adaptation, so the clock can boot on a non-zero epoch yet read "0d 00:00:00".
 */
export function missionElapsedSeconds(simSeconds: number, scenario: ScenarioConfig = SCENARIO): number {
  return Math.max(0, simSeconds - scenario.t0Seconds);
}
