/**
 * M3a — THE DATACENTER PLACEMENT CANDIDATES + the default build spec (GDD §4.5).
 *
 * Like the M2 ground-station {@link import("../m2/sites").CANDIDATE_SITES}, the place-DC
 * action is a KEYED/LIST pick (no globe-raycast yet): the player cycles a SMALL list of
 * candidate DC sites — orbital compute nodes over real demand regions on Earth/Moon/Mars —
 * and confirms one. A DC is a STRATEGIC node (Risk-5 / §4.5: a handful matter), so the list
 * is short and each is a deliberate, dear capex. Fixed lat/lons (degrees), no RNG; the place
 * action records the INDEX, and this list resolves it deterministically.
 */

import { DEG_RAD } from "../ephemeris";
import type { DCSite } from "./datacenter";

/** A candidate DC site: a body + a sub-point + a glanceable label. */
export interface DCCandidate {
  /** Glanceable label (the region / body the DC sits over). */
  label: string;
  bodyId: DCSite;
  subLatRad: number;
  subLonRad: number;
}

/** Build a candidate from lat/lon DEGREES (the authoring convention). */
function dc(label: string, bodyId: DCSite, latDeg: number, lonDeg: number): DCCandidate {
  return { label, bodyId, subLatRad: latDeg * DEG_RAD, subLonRad: lonDeg * DEG_RAD };
}

/**
 * The DC placement candidates — orbital compute nodes over real demand regions (the same
 * hotspots the M2 contracts target) + the cislunar/Mars on-ramp sites the M3 milestone adds
 * (GDD §9 M3 "first orbital datacenter"). Earth sites get full solar flux; Mars sites are
 * power-starved (~43% flux) so they want bigger panels or an RTG — the §4.5 physics surprise.
 * Ordered so the FIRST is the obvious Earth on-ramp. Placeholders to tune.
 */
export const DC_CANDIDATES: DCCandidate[] = [
  dc("EARTH · SOUTH AMERICA", "earth", -15, -55),
  dc("EARTH · EAST ASIA", "earth", 35, 120),
  dc("EARTH · NORTH AMERICA", "earth", 40, -90),
  dc("EARTH · SUB-SAHARAN AFRICA", "earth", 5, 20),
  dc("MOON · NEARSIDE", "moon", 0, 0),
  dc("MARS · ORBIT", "mars", 0, 0),
];

/** The default panel area (m²) of a placed DC. Sized with {@link DEFAULT_DC_RADIATOR_M2} so a
 * fresh Earth DC delivers a few compute units (a real, visible lift) without saturating the
 * bounded cap — building up panels/radiators/RTG is the upgrade path (deferred). Placeholder. */
export const DEFAULT_DC_PANEL_M2 = 1.5;

/** The default radiator area (m²) of a placed DC. With {@link DEFAULT_DC_PANEL_M2} at Earth
 * the THERMAL ceiling is the binding one (radiative-only cooling bites), so the DC reads as
 * thermally throttled — the §4.5 "cooling is the hard ceiling" teaching beat. Placeholder. */
export const DEFAULT_DC_RADIATOR_M2 = 1.5;

/** Whether a default-placed DC carries an RTG. Off by default (Earth DCs are solar); the
 * outer-system candidates are where an RTG would be fitted (the nuclear lever — deferred to
 * a DC-upgrade affordance). Placeholder. */
export const DEFAULT_DC_RTG = false;
