/**
 * M2c — the GROUND-STATION CANDIDATE SITES + the STARTER ROSTER (the build inputs).
 *
 * The deploy action is a KEYED/LIST pick (not a globe-raycast UI — that is later
 * polish per the M2c brief): the player cycles a small fixed list of candidate
 * sites and confirms one. The sites are pinned over the demand HOTSPOTS (the
 * demand.ts metros) so a deploy visibly FILLS a coverage gap over real demand — the
 * monument grows where it matters. Fixed lat/lons (degrees), no RNG; the deploy
 * action records the INDEX, and this list resolves it deterministically.
 *
 * The STARTER roster boots the session non-empty (so the heatmap reads as a working
 * network at boot) but small enough that building still matters: a couple of ground
 * stations + one LEO sat.
 */

import { DEG_RAD } from "../ephemeris";
import { EARTH_MU } from "./launch";
import type { SatOrbit } from "./roster";
import { DEFAULT_GROUND_ALTITUDE_M } from "../coverage/field";

const KM_M = 1000.0;

/** € to deploy one ground station — cheap + instant, the small coverage lever
 * (a launch is the big one). Placeholder; tune later. */
export const GROUND_DEPLOY_COST = 250.0;

/** EIRP of a deployed ground station (the M2a field reference: 1.0 just closes the
 * link at REF_LINK_DISTANCE_M). A ground station's footprint is a small near ring. */
export const GROUND_EIRP = 1.0;

/** A candidate deploy site: a fixed lat/lon on a body + an antenna altitude. */
export interface CandidateSite {
  /** Glanceable label (the metro it sits over). */
  label: string;
  bodyId: string;
  latRad: number;
  lonRad: number;
  altitudeM: number;
}

/** Build a candidate site from lat/lon DEGREES (the authoring convention). */
function site(label: string, latDeg: number, lonDeg: number): CandidateSite {
  return {
    label,
    bodyId: "earth",
    latRad: latDeg * DEG_RAD,
    lonRad: lonDeg * DEG_RAD,
    altitudeM: DEFAULT_GROUND_ALTITUDE_M,
  };
}

/**
 * The candidate ground-station sites — pinned over the demand.ts hotspots so a
 * deploy fills coverage over real demand. Ordered so the FIRST few are the biggest
 * uncovered metros (the player cycles + confirms). Placeholders to tune.
 */
export const CANDIDATE_SITES: CandidateSite[] = [
  site("EAST ASIA", 35, 120),
  site("SOUTH ASIA", 22, 78),
  site("NORTH AMERICA", 40, -90),
  site("NORTH ATLANTIC EU", 50, 5),
  site("SE ASIA", 5, 105),
  site("SUB-SAHARAN AFRICA", 5, 20),
  site("SOUTH AMERICA", -15, -55),
];

/** A circular Earth orbit preset for the starter roster (no launch roll — given). */
function starterOrbit(altKm: number, incDeg: number, raanDeg: number, m0Deg: number, eirp: number): SatOrbit & { eirp: number } {
  return {
    parentId: "earth",
    aM: altKm * KM_M,
    e: 0,
    incRad: incDeg * DEG_RAD,
    raanRad: raanDeg * DEG_RAD,
    argpRad: 0,
    m0Rad: m0Deg * DEG_RAD,
    epochS: 0,
    muParent: EARTH_MU,
    eirp,
  };
}

/**
 * The STARTER roster: a non-empty-but-small network at boot. Two ground stations
 * over the two biggest demand metros + one LEO sat — enough that the heatmap reads
 * as a working web, little enough that deploying/launching visibly grows it.
 */
export const STARTER: {
  grounds: CandidateSite[];
  sats: Array<SatOrbit & { eirp: number }>;
} = {
  grounds: [CANDIDATE_SITES[0], CANDIDATE_SITES[2]], // EAST ASIA + NORTH AMERICA
  sats: [starterOrbit(6771, 53, 0, 0, 1.0)], // one LEO 53° bird
};
