/**
 * M-fleet — THE PURE FLEET-DERIVATION (GDD §5 legible-at-a-glance + direct
 * interaction; §4.2 the network). Click-to-focus a celestial body and the FLEET tile
 * shows that body's CONSTELLATION: the dataset satellites whose parent IS that body
 * PLUS the player's launched roster sats whose orbit parent IS that body. This is the
 * pure, deterministic core the FLEET panel renders — given a focused body id + the two
 * sat sources (dataset + roster), it returns the per-sat rows with their orbit class,
 * altitude, period, inclination, EIRP, kind and status.
 *
 * --- WHY A PURE HELPER (testable, render-free) -----------------------------
 * The panel is render/read-only (NO sim change — both replay goldens stay), but the
 * DERIVATION — which sat orbits which body, what orbit CLASS an altitude band implies —
 * is logic worth unit-testing in isolation. So this module is pure TypeScript with zero
 * DOM / Three.js / Ephemeris-class dependency: it takes plain element descriptors
 * ({@link FleetDatasetSat} for the data/system.json sats, {@link RosterSat} for the
 * launched ones) and returns plain {@link FleetSat} rows. main.ts (orchestration) reads
 * the live Ephemeris + roster into these descriptors per frame; the panel reads the
 * rows out. No sim state is created or mutated here — this is a SELECT over existing
 * truth, exactly like the contracts/parse projections.
 *
 * Orbit CLASS is derived from the SEMI-MAJOR-AXIS altitude bands (LEO/MEO/GEO), the
 * standard regime split, so a launched LEO sat and the dataset sat_leo classify the
 * same way. Altitude is semi-major-axis − parent radius (the orbit height above the
 * surface); period is the Kepler period in minutes.
 */

/** Orbit regime, derived from the altitude band. The §8 class token + colour. */
export type OrbitClass = "LEO" | "MEO" | "GEO" | "HEO" | "SURFACE";

/** Where the sat came from: a fixed dataset body or a player launch (the §8 kind glyph). */
export type FleetKind = "DATASET" | "LAUNCHED";

/** A live status for the row (all currently "active" — the orrery propagates every sat
 * each frame; the field exists so a future de-orbit / failure surfaces without a reshape). */
export type FleetStatus = "active";

/**
 * One dataset satellite's element descriptor (a plain read of an Ephemeris body — no
 * Ephemeris-class dependency in this pure module). main.ts fills these from the live
 * ephemeris for every body whose parent is a real body (the dataset sats).
 */
export interface FleetDatasetSat {
  /** The ephemeris id (e.g. "sat_leo") — the stable entity token. */
  id: string;
  /** Parent body id (the body it orbits). */
  parentId: string;
  /** Semi-major axis (metres). */
  aM: number;
  /** Eccentricity. */
  e: number;
  /** Inclination (radians). */
  incRad: number;
  /** Orbital period (seconds); 0 for a degenerate/element-less body. */
  periodS: number;
  /** Parent body radius (metres) — to turn semi-major axis into an altitude. */
  parentRadiusM: number;
}

/**
 * One launched roster sat's element descriptor. Mirrors the fields the pure
 * derivation needs from a {@link import("./roster").RosterSat} (the orbit + EIRP),
 * decoupled from the Roster class so the helper unit-tests with plain objects.
 */
export interface FleetRosterSat {
  /** The roster id (e.g. "s3") — the stable entity token. */
  id: string;
  /** Parent body id the SatOrbit is referenced to. */
  parentId: string;
  /** Semi-major axis (metres). */
  aM: number;
  /** Eccentricity. */
  e: number;
  /** Inclination (radians). */
  incRad: number;
  /** Orbital period (seconds). */
  periodS: number;
  /** Parent body radius (metres). */
  parentRadiusM: number;
  /** Link-budget EIRP (the footprint lever). */
  eirp: number;
}

/** One derived fleet row — a single satellite around the focused body. */
export interface FleetSat {
  /** Stable label / entity token (the sat id, upper-cased for the §8 entity look). */
  label: string;
  /** The raw id (kept for selection / signature). */
  id: string;
  /** Orbit regime from the altitude band. */
  orbitClass: OrbitClass;
  /** Altitude above the parent surface (km) = (semi-major axis − parent radius) / 1000. */
  altitudeKm: number;
  /** Orbital period (minutes). */
  periodMin: number;
  /** Inclination (degrees). */
  inclinationDeg: number;
  /** Link-budget EIRP. Dataset sats also carry an EIRP (their coverage weight). */
  eirp: number;
  /** Where the sat came from (the kind glyph: dataset vs launched). */
  kind: FleetKind;
  /** Live status (active). */
  status: FleetStatus;
}

/** The whole derived fleet for one focused body — what the FLEET panel renders. */
export interface Fleet {
  /** The focused body id (null = nothing selected). */
  bodyId: string | null;
  /** The per-sat rows orbiting that body (dataset + launched), in a stable order. */
  sats: FleetSat[];
  /** Convenience counts (the header "N sats · M launched"). */
  total: number;
  datasetCount: number;
  launchedCount: number;
}

const RAD_DEG = 180 / Math.PI;

/**
 * Classify an orbit by its altitude above the parent surface (km), the standard regime
 * split. Bands (Earth-scaled, the canonical LEO/MEO/GEO breakpoints):
 *   - SURFACE: at/below the surface (a degenerate or sub-surface a — defensive only).
 *   - LEO: ≤ 2000 km.
 *   - MEO: 2000 .. 35 000 km (the navigation/medium band; sat_meo_* land here at ~20 200 km).
 *   - GEO: 35 000 .. 50 000 km (the geostationary belt at ~35 786 km).
 *   - HEO: above 50 000 km (high / beyond-GEO — e.g. a lunar-distance orbit).
 * Pure: a function of altitude alone, so a launched LEO sat and the dataset sat_leo
 * classify identically.
 */
export function classifyOrbit(altitudeKm: number): OrbitClass {
  if (altitudeKm <= 0) return "SURFACE";
  if (altitudeKm <= 2000) return "LEO";
  if (altitudeKm <= 35000) return "MEO";
  if (altitudeKm <= 50000) return "GEO";
  return "HEO";
}

/** Build one fleet row from a sat's elements + kind (the shared dataset/roster path). */
function rowOf(
  id: string,
  aM: number,
  incRad: number,
  periodS: number,
  parentRadiusM: number,
  eirp: number,
  kind: FleetKind,
): FleetSat {
  const altitudeKm = (aM - parentRadiusM) / 1000;
  return {
    label: id.toUpperCase(),
    id,
    orbitClass: classifyOrbit(altitudeKm),
    altitudeKm,
    periodMin: periodS / 60,
    inclinationDeg: incRad * RAD_DEG,
    eirp,
    kind,
    status: "active",
  };
}

/**
 * THE PURE FLEET DERIVATION. Given a focused body id + the two sat sources (the dataset
 * sats from the ephemeris + the launched roster sats), return the {@link Fleet} of every
 * sat orbiting THAT body — dataset sats whose parent is the body, then launched sats
 * whose orbit parent is the body (the deploy/launch order is preserved within each
 * source). No cross-body leakage: a sat whose parent is a different body is excluded.
 *
 * `bodyId === null` (nothing selected) → an empty fleet. A body with no sats → an empty
 * fleet (the panel shows the calm placeholder). Pure + deterministic.
 */
export function deriveFleet(
  bodyId: string | null,
  datasetSats: readonly FleetDatasetSat[],
  rosterSats: readonly FleetRosterSat[],
): Fleet {
  if (bodyId === null) {
    return { bodyId: null, sats: [], total: 0, datasetCount: 0, launchedCount: 0 };
  }
  const sats: FleetSat[] = [];
  let datasetCount = 0;
  let launchedCount = 0;
  // Dataset sats whose parent is the focused body (their EIRP is the coverage weight; the
  // dataset descriptors don't carry one, so a dataset sat reads EIRP 1.0 — its nominal weight).
  for (const d of datasetSats) {
    if (d.parentId !== bodyId) continue;
    sats.push(rowOf(d.id, d.aM, d.incRad, d.periodS, d.parentRadiusM, 1.0, "DATASET"));
    datasetCount++;
  }
  // Player launched sats whose orbit parent is the focused body.
  for (const r of rosterSats) {
    if (r.parentId !== bodyId) continue;
    sats.push(rowOf(r.id, r.aM, r.incRad, r.periodS, r.parentRadiusM, r.eirp, "LAUNCHED"));
    launchedCount++;
  }
  return { bodyId, sats, total: sats.length, datasetCount, launchedCount };
}
