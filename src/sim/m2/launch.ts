/**
 * M2c — THE LAUNCH MARKET (GDD §4.7 "Launch Capabilities", light Tier-1 cut).
 *
 * §4.7: "early game you BUY launches on the market … priced in € per kg to a given
 * orbit, with a launch WINDOW (transfer geometry) and a FAILURE PROBABILITY." This
 * is that, minimal: a small set of ORBIT PRESETS (LEO/MEO/GEO inclinations), each a
 * fixed € cost + a deterministic failure chance. The €→coverage lever — a launch is
 * the pricier, BIGGER coverage move (a sat lights up a whole footprint of cells); a
 * ground station (deployed elsewhere) is the cheaper, instant, smaller lever.
 *
 * --- DETERMINISM ------------------------------------------------------------
 * Pure data + functions. The launch FAILURE roll is DRAWN FROM THE SEEDED
 * splitmix64 PRNG passed in by the caller (the session draws one u64 per launch),
 * NEVER from the unseeded JS pseudo-random source — so a recorded launch (success
 * or failure) replays bit-identically. A failed launch costs the € but adds NO sat (you ate the
 * loss — the §4.7 risk). The numbers are sane placeholders to tune later.
 *
 * The preset resolves to a {@link import("./roster").SatOrbit} at the LAUNCH EPOCH:
 * the sat reaches orbit at sim-time t with mean anomaly m0 = the preset's phase, so
 * its position is deterministic from (preset, t) onward.
 */

import { DEG_RAD } from "../ephemeris";
import type { Ephemeris } from "../ephemeris";
import type { SimRng } from "../rng";
import type { SatOrbit } from "./roster";

/** Earth's standard gravitational parameter (m³/s²) — the launch parent. Mirrors
 * data/system.json earth.mu; pinned here so a launch needs no ephemeris element read.
 * (The ephemeris carries the same value; this avoids reaching into its private map.) */
export const EARTH_MU = 3.986004418e14;
/** km → m, local (avoids an extra import). */
const KM_M = 1000.0;

/** A buyable orbit preset: an orbital regime at a € cost + a failure chance. */
export interface LaunchPreset {
  /** Stable key (the action payload carries this). */
  id: string;
  /** Glanceable label for the launch board. */
  label: string;
  /** Semi-major axis (km) of the circular target orbit. */
  altitudeKm: number;
  /** Target inclination (degrees). */
  incDeg: number;
  /** RAAN spread (degrees) — successive launches into a preset fan the node so a
   * constellation spreads rather than stacking on one ground track. Phased by the
   * sat index the session passes in. */
  raanStepDeg: number;
  /** € cost to buy this launch (charged whether or not it succeeds). */
  costEur: number;
  /** EIRP of the delivered sat (a bigger/heavier bird at a higher orbit reaches
   * further — the link-budget lever). */
  eirp: number;
  /** Deterministic launch-failure probability ∈ [0,1] (drawn from the seeded PRNG). */
  failureChance: number;
}

/**
 * The Tier-1 launch board (GDD §4.7). LEO is cheap + reliable + a tight footprint;
 * GEO is dear + the widest single-sat footprint; MEO sits between. Placeholders —
 * tune later. Costs are scaled so a launch is a real budget decision against the
 * M1 opening balance (~€3000) while a ground station is loose change.
 */
export const LAUNCH_PRESETS: LaunchPreset[] = [
  {
    id: "leo_53",
    label: "LEO 53°",
    altitudeKm: 6771, // ~400 km altitude (matches sat_leo)
    incDeg: 53,
    raanStepDeg: 60,
    costEur: 600,
    eirp: 1.0,
    failureChance: 0.04,
  },
  {
    id: "meo_63",
    label: "MEO 63°",
    altitudeKm: 26560,
    incDeg: 63.4,
    raanStepDeg: 90,
    costEur: 1100,
    eirp: 1.4,
    failureChance: 0.07,
  },
  {
    id: "geo_eq",
    label: "GEO 0°",
    altitudeKm: 42164,
    incDeg: 0,
    raanStepDeg: 30, // GEO: the "raan step" fans the longitude slot
    costEur: 1800,
    eirp: 1.8,
    failureChance: 0.10,
  },
];

/** Look up a preset by id (or null when the id is unknown — a hand-edited save). */
export function presetById(id: string): LaunchPreset | null {
  return LAUNCH_PRESETS.find((p) => p.id === id) ?? null;
}

/**
 * Resolve a launch preset to a concrete {@link SatOrbit} reaching orbit at sim-time
 * `t`. `index` fans the RAAN + mean-anomaly phase so successive launches into the
 * same preset spread around the globe (a crude constellation) rather than stacking.
 * Pure: the orbit is a function of (preset, index, t). The parent is "earth".
 */
export function resolveLaunchOrbit(preset: LaunchPreset, index: number, t: number): SatOrbit {
  return {
    parentId: "earth",
    aM: preset.altitudeKm * KM_M,
    e: 0,
    incRad: preset.incDeg * DEG_RAD,
    raanRad: (preset.raanStepDeg * index) * DEG_RAD,
    argpRad: 0,
    // Phase the mean anomaly too so two sats at the same node aren't co-located.
    m0Rad: ((preset.raanStepDeg * index) % 360) * DEG_RAD,
    epochS: t,
    muParent: EARTH_MU,
  };
}

/** The outcome of a launch roll: whether the sat reached orbit (deterministic). */
export interface LaunchRoll {
  /** True iff the launch SUCCEEDED (the failure roll cleared the preset's chance). */
  ok: boolean;
  /** The [0,1) roll value drawn from the seeded PRNG (for telemetry/inspection). */
  roll: number;
}

/**
 * Roll a launch's success against its failure chance, drawing ONE double from the
 * SEEDED splitmix64 PRNG (advances `rng` by one u64). Deterministic: same rng state
 * → same roll → same outcome on replay. `ok = roll >= failureChance`.
 */
export function rollLaunch(rng: SimRng, preset: LaunchPreset): LaunchRoll {
  const roll = rng.nextDouble();
  return { ok: roll >= preset.failureChance, roll };
}

/** Reserved hook: validate a launch WINDOW against geometry. M2c launches are
 * always "in window" (no transfer-geometry gate yet); §4.7 windows land at M4 with
 * the patched-conic planner. Kept pure + signature-stable for that upgrade. */
export function launchWindowOpen(_eph: Ephemeris, _t: number, _preset: LaunchPreset): boolean {
  return true;
}
