/**
 * net/ — the demand GEOMETRY: a target {@link Region} (geodesic disc, body-fixed) and a
 * real {@link GroundNet} ground-network endpoint, plus the decoupled region-coverage
 * sampler (region/point, not an M2 grid). Migrated from a1/region.ts (geometry half).
 *
 * A region is a geodesic disc on the toy body: a body-fixed centre (lat,lon) plus an
 * angular radius. `coveredFraction` samples the disc with a deterministic Fibonacci
 * spiral (NO RNG) and returns the fraction of sample points a caller-supplied
 * `isCoveredAt(point) => boolean` predicate accepts. The predicate is injected so this
 * file stays free of the link-budget/router import — both compose on top of it.
 *
 * Dropped in the migration (design §1, A0): the co-located A1Ground (reworked here into
 * a real GroundNet endpoint), the `windowCoverage`/`minFraction`/`meanFraction` layer,
 * and the `A1_AVAILABILITY_BAR` — the 0.802/0.85 forced-imperfection machinery. Act 1
 * has NO forced imperfection (design §5).
 *
 * RE-CENTERED (design §5 must-fix): the Act-1 region is now EQUATORIAL (lat 0) so the
 * parked equatorial GEO sits at its nadir and covers the WHOLE disc with margin. The
 * elevation floor defaults to field.ts's real MIN_ELEVATION_RAD = 5°.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG. The Fibonacci spiral is a fixed
 * function of (centre, radius, sampleCount, index) — same inputs → byte-identical
 * sample set, so the coverage check is reproducible.
 *
 * @see docs/signal-horizon-m1.md Part II §1 (endpoint), §2.2 (demand geometry), §5.
 */

import { MIN_ELEVATION_RAD } from "../coverage/field";

const DEG_RAD = Math.PI / 180;

/**
 * Angular radius (radians) of a demand region disc. 6°.
 *
 * Was 10°, from a time when the globe drew exactly ONE region. Once the whole board is drawn
 * (the orrery paints every live tender), 10° discs MERGE: the equatorial tenders are 20° and
 * 35° apart, and at 10° each they were one continuous smear of coastline instead of three
 * places you can tell apart and aim at. 6° leaves a clear gap between the nearest pair
 * (20° apart ⇒ 8° of empty ocean between their rims).
 *
 * The router never reads this: `served` is the bridge to the region CENTRE, so the radius sizes
 * the drawn disc, the Fibonacci sample set and the coverage-gap overlay's covered fraction, and
 * gates nothing. The parked equatorial GEO still covers the whole disc with enormous margin —
 * shrinking it only widens that margin (the §5 WHOLE-DISC must-fix stays satisfied a fortiori).
 */
export const NET_ACT1_REGION_RADIUS_RAD = 6 * DEG_RAD;

/**
 * Minimum elevation angle (radians) for a usable net link — the horizon mask.
 *
 * THE COVERAGE RE-SCALE: raised 5° → 10°. 5° is permissive anywhere and absurd on a 300 km
 * toy body, where it closed links on satellites grazing the limb and helped every orbit paint
 * a near-hemisphere. 10° is still generous by real ground-station standards and it costs the
 * rim of every footprint — which is exactly where the old geometry was least honest.
 *
 * field.ts keeps its own 5° for the M2 coverage grid, which is why this constant is a
 * net/-local fork rather than a re-export. TUNABLE.
 */
export const NET_MIN_ELEVATION_RAD = 10 * DEG_RAD;
void MIN_ELEVATION_RAD; // field.ts's 5° stays the M2 grid's floor — deliberately not shared.

/** The body a net endpoint rides. Acts 1–3 are all `"earth"` (the toy frame); Act 3c (the
 * cislunar on-ramp) adds `"moon"`, read in the TIDALLY-LOCKED lunar frame (cislunar.ts);
 * Act 4 (the Mars teaser) adds `"mars"` — served over the REAL interplanetary hop (router
 * solveMarsLeg), never the toy inverse-square budget. */
export type BodyId = "earth" | "moon" | "mars";

/** A target region: a geodesic disc on the toy body, body-fixed (rides θ(t)). */
export interface Region {
  id: string;
  label: string;
  /** Disc-centre latitude (radians). */
  latRad: number;
  /** Disc-centre longitude (radians). */
  lonRad: number;
  /** Angular radius of the disc (radians). */
  radiusRad: number;
  /** The body the region rides ("earth" for Acts 1–3; "moon" for the Act-3c cislunar
   * on-ramp; "mars" for the Act-4 teaser). For "moon" the (lat,lon) are read in the
   * TIDALLY-LOCKED lunar frame (cislunar.ts): lon 0 faces Earth, lon π is the farside. */
  bodyId: BodyId;
}

/** A ground-network endpoint — a body-fixed surface station the path terminates at. */
export interface GroundNet {
  id: string;
  /** Station latitude (radians). */
  latRad: number;
  /** Station longitude (radians). */
  lonRad: number;
  /** Antenna altitude above the toy surface (metres) — raises the local horizon. */
  altitudeM: number;
  /** The body the station rides ("earth"). The Act-4 Mars data comes BACK to Earth's
   * network, so the ground endpoint is always Earth-side. */
  bodyId: BodyId;
}

/** Number of Fibonacci-spiral disc sample points. */
export const NET_SPACE_SAMPLES = 400;

/** The Act-1 equatorial region offered (design §5): lat 0°, lon 0°, rad 10°. The
 * parked equatorial GEO sits at its nadir and covers the WHOLE disc (binary SERVED). */
export const NET_ACT1_REGION: Region = {
  id: "REGION-0",
  label: "equatorial metro",
  latRad: 0,
  lonRad: 0,
  radiusRad: NET_ACT1_REGION_RADIUS_RAD,
  bodyId: "earth",
};

/** FL-07 (SD-47) — the SECOND Act-1 tender: an equatorial transit metro at 5°E whose pay
 * DECAYS on the board (the market re-prices an unsigned deal). One smallsat can serve both
 * metros from one floodlight — or the player chooses. Same disc geometry as REGION-0. */
export const NET_ACT1B_REGION: Region = {
  id: "REGION-C",
  label: "equatorial transit",
  latRad: 0,
  lonRad: (5 * Math.PI) / 180,
  radiusRad: NET_ACT1_REGION_RADIUS_RAD,
  bodyId: "earth",
};

/** R2e (SD-45) — THE LAUNCH SITE (render + launch-arc origin; NOT a comms endpoint):
 * Cape Canaveral, 28.4° N, 80.6° W. Rockets rise from here; the comms ground network
 * below is a separate concern (real-world split: launch pads ≠ ground stations). */
export const NET_LAUNCH_SITE = {
  id: "CANAVERAL",
  label: "CAPE CANAVERAL",
  latRad: 28.4 * DEG_RAD,
  lonRad: -80.6 * DEG_RAD,
};

/** The Act-1 ground-network endpoint (design §5): equatorial, same meridian as the
 * region, with a modest antenna altitude so the local horizon clears. */
export const NET_ACT1_GROUND: GroundNet = {
  id: "GROUND-0",
  latRad: 0,
  lonRad: 0,
  altitudeM: 0,
  bodyId: "earth",
};

/** Latitude (radians) the Act-2 high-latitude region (and its co-located ground) sit at —
 * BEYOND the parked equatorial GEO's measured footprint edge. The GEO over lon 0 serves a
 * region centre out to ~lat 64° (the worst disc-edge point sets below the 5° gate past that,
 * MEASURED empirically in _measure); 70° sits safely beyond it, so the equatorial GEO ALONE
 * physically CANNOT reach REGION-1 at any longitude — the latitude wall that forces an
 * inclined constellation (Act-2 variant (a), pure geometry; latency is not a lever until
 * Act 3). The bent path region→sat→ground only closes for REGION-1 via the co-located
 * high-lat {@link NET_ACT2_GROUND}, not the equatorial GROUND-0. */
export const NET_ACT2_REGION_LAT_RAD = 70 * DEG_RAD;

/** Longitude (radians) of the Act-2 high-latitude region + its ground (5° E). */
export const NET_ACT2_REGION_LON_RAD = 5 * DEG_RAD;

/** The Act-2 ground-network endpoint: a SECOND ground station co-located under REGION-1's
 * high latitude (the ground network GROWS in Act 2 to support the new region). The bent path
 * region→sat→ground spans ~70° from the equatorial GROUND-0 — wider than a LEO can bridge —
 * so REGION-1 is only reachable via THIS high-lat ground. The equatorial GEO cannot downlink
 * to it either (it is ~70° from the GEO's nadir, beyond the GEO footprint), so adding it does
 * NOT let the GEO serve REGION-1 (Act-2 invariant 1). REGION-0 keeps terminating at GROUND-0. */
export const NET_ACT2_GROUND: GroundNet = {
  id: "GROUND-1",
  latRad: NET_ACT2_REGION_LAT_RAD,
  lonRad: NET_ACT2_REGION_LON_RAD,
  altitudeM: 0,
  bodyId: "earth",
};

// ── ACT 3c (the CISLUNAR on-ramp — "some places can never see you") ──────────────

/** The Act-3c contract id — the lunar FARSIDE station. The replay action log accepts THIS
 * id (net_accept + the L2 gateway launch). */
export const ACT3C_LUNA_CONTRACT_ID = "LUNA-1";

/** The EARTH–MOON L2 GATEWAY id stem the Act-3c relay launch commits (mirrors the Act-4
 * Mars relay stem). The router's lunar leg recognises a node by THIS stem, and cislunar.ts
 * resolves its position to the halo station rather than a Kepler propagation. */
export const NET_ACT3C_GATE_ID_STEM = "LUNA-GATE";

/** Angular radius (radians) of the lunar farside station's disc. Deliberately SMALL (4°):
 * a farside research outpost is a pinpoint, not a metro, and the whole disc sits far inside
 * the gateway's overhead footprint — so the act never turns on disc-edge margin, which is
 * an Act-1/2 concern already taught and not what this one is about. */
export const NET_ACT3C_REGION_RADIUS_RAD = 4 * DEG_RAD;

/**
 * THE DEEP-SPACE GROUND SEGMENT — three equatorial 70 m-class dishes at 120° longitude
 * spacing, the Earth-side half of reaching another body.
 *
 * WHY IT EXISTS. The gateway can hold the farside continuously, but the leg still has to
 * come DOWN, and the toy Earth turns once every 240 s: a single station has the Moon below
 * its horizon for roughly half of every day, and Acts 1–2's two stations sit on nearly the
 * same meridian so they rise and set together. Three stations 120° apart put the sub-lunar
 * meridian within 60° of one of them at ALL times, which (the Moon never straying more than
 * ~5° off this frame's equator) means at least 30° elevation always. That is not a
 * contrivance: it is exactly why the real Deep Space Network is three complexes at Goldstone,
 * Madrid and Canberra, spaced the same way, for the same reason.
 *
 * WHY THEY ARE A SEPARATE CLASS, not additions to `groundNets`. A deep-space dish tracks one
 * distant target across the sky; it is not a comms teleport that can land LEO metro traffic.
 * Keeping them out of the Act-1–3 ground list is therefore both honest AND the reason the
 * Earth acts are untouched by this work — no new landing sites appear under the Earth
 * regions, so their routing (and the replay golden) is byte-identical.
 *
 * They ARRIVE with the Act-3c contract rather than being placed by the player: the act's ONE
 * decision is where the relay goes, and making the ground segment a second placement puzzle
 * would teach the same lesson twice. A player-built ground segment is a real future verb; it
 * is deliberately not this increment's.
 */
export const NET_DEEP_SPACE_GROUND: readonly GroundNet[] = [
  { id: "DSN-0", latRad: 0, lonRad: 0, altitudeM: 0, bodyId: "earth" },
  { id: "DSN-1", latRad: 0, lonRad: (120 * Math.PI) / 180, altitudeM: 0, bodyId: "earth" },
  { id: "DSN-2", latRad: 0, lonRad: (240 * Math.PI) / 180, altitudeM: 0, bodyId: "earth" },
];

/** NET_ACT3C_FARSIDE_REGION — the Act-3c data source on the LUNAR FARSIDE (bodyId "moon",
 * lat 0, lon 180°: the anti-Earth point, dead centre of the face Earth never sees).
 *
 * This is the ONE region in the game no Earth-orbit topology can reach at ANY time, by
 * tidal lock rather than by tuning — `cislunar.test.ts` asserts that invariant across a
 * full lunar month AND over a wide shell of Earth orbital positions, so "launch more" is
 * provably not an answer. Reaching it needs a node where NEITHER endpoint is: the Earth–Moon
 * L2 gateway. That is GDD §2 tier-2's "relay placement"; the ~1.3 s light-delay the leg
 * stamps is GDD risk #7's on-ramp — light-delay taught by sight BEFORE Mars makes it bite. */
export const NET_ACT3C_FARSIDE_REGION: Region = {
  id: ACT3C_LUNA_CONTRACT_ID,
  label: "farside station",
  latRad: 0,
  lonRad: Math.PI,
  radiusRad: NET_ACT3C_REGION_RADIUS_RAD,
  bodyId: "moon",
};

// ── ACT 4 (the Mars frontier teaser — "distance changes everything") ──────────────

/** The Act-4 Mars contract id the act4 beat emits (the ONE region on another body). The
 * replay action log accepts THIS id (net_accept + the Mars relay launch + net_place_cache). */
export const ACT4_MARS_CONTRACT_ID = "MARS-1";

/** The deep-space RELAY sat id the player launches to reach Mars — connectivity on the
 * Mars leg is PRESENCE-BASED (the relay in the roster ⇒ the leg bridges by construction;
 * the design's Blocker-2 resolution), so the relay never goes through the toy-frame budget.
 * The Mars-launch preset (`world.ts` MARS_RELAY) commits a sat carrying THIS id stem. */
export const NET_ACT4_RELAY_ID_STEM = "MARS-RELAY";

/** NET_ACT4_MARS_REGION — the Act-4 data source on MARS (bodyId "mars"). Its lat/lon is
 * COSMETIC: Act 4 asserts neither whole-disc coverage nor a toy-frame budget on this region
 * (it is connectivity-by-relay-presence over an interplanetary hop). The light-delay on the
 * Earth↔Mars leg is the REAL ephemeris distance / c (minutes), injected by the router's
 * solveMarsLeg branch — NOT the toy 300 km-body geometry. The disc shape mirrors REGION-0
 * only so the render has a node to draw; the router never samples it through the toy frame. */
export const NET_ACT4_MARS_REGION: Region = {
  id: ACT4_MARS_CONTRACT_ID,
  label: "Mars colony",
  latRad: 0,
  lonRad: 0,
  radiusRad: NET_ACT1_REGION_RADIUS_RAD,
  bodyId: "mars",
};

/** A single body-fixed disc sample point (lat,lon in radians). */
export interface RegionPoint {
  latRad: number;
  lonRad: number;
}

/** The golden angle (radians) — the irrational turn that gives the Fibonacci
 * spiral its near-uniform, gap-free angular spread. */
const GOLDEN_ANGLE = Math.PI * (3 - Math.sqrt(5));

/**
 * Deterministic Fibonacci-spiral sample of `sampleCount` body-fixed (lat,lon)
 * points filling the geodesic disc of angular radius `region.radiusRad` centred
 * on the region. NO RNG — purely a function of (region, sampleCount, index).
 *
 * Construction: for sample i the geodesic offset angle ψ_i from the centre is
 * chosen so cos(ψ) is uniform in [cos(radius), 1] — i.e. EQUAL-AREA on the
 * sphere-cap (each annulus carries the same number of points per area), and the
 * azimuth φ_i = i · goldenAngle. The offset is then rotated onto the sphere about
 * an orthonormal basis built at the region-centre direction, and the resulting
 * unit vector is mapped back to (lat,lon).
 */
export function sampleRegionPoints(
  region: { latRad: number; lonRad: number; radiusRad: number },
  sampleCount: number,
): RegionPoint[] {
  const out: RegionPoint[] = [];
  if (sampleCount <= 0) return out;

  // Centre direction + an orthonormal tangent basis (e1, e2) at the centre.
  const centre = latLonToUnit(region.latRad, region.lonRad);
  // Pick a reference not parallel to centre, then Gram–Schmidt for e1, e2.
  const ref: [number, number, number] =
    Math.abs(centre[2]) < 0.9 ? [0, 0, 1] : [1, 0, 0];
  const e1 = normalize(cross(ref, centre));
  const e2 = cross(centre, e1); // already unit (centre ⟂ e1, both unit)

  const cosR = Math.cos(region.radiusRad);

  for (let i = 0; i < sampleCount; i++) {
    // Equal-area radial: cos(ψ) uniform in [cosR, 1]. The (i+0.5)/N midpoint
    // avoids placing a point exactly at the centre or the rim edge.
    const cosPsi = 1 - ((i + 0.5) / sampleCount) * (1 - cosR);
    const sinPsi = Math.sqrt(Math.max(0, 1 - cosPsi * cosPsi));
    const phi = i * GOLDEN_ANGLE;
    const cp = Math.cos(phi);
    const sp = Math.sin(phi);
    // point = cos(ψ)·centre + sin(ψ)·(cosφ·e1 + sinφ·e2)
    const ux = cosPsi * centre[0] + sinPsi * (cp * e1[0] + sp * e2[0]);
    const uy = cosPsi * centre[1] + sinPsi * (cp * e1[1] + sp * e2[1]);
    const uz = cosPsi * centre[2] + sinPsi * (cp * e1[2] + sp * e2[2]);
    const ll = unitToLatLon(ux, uy, uz);
    out.push({ latRad: ll.latRad, lonRad: ll.lonRad });
  }
  return out;
}

/**
 * The fraction of the region disc that is covered, evaluated at a single instant:
 * sample the disc with the deterministic Fibonacci spiral and count the fraction of
 * sample points the injected `isCoveredAt` predicate accepts. The predicate is the
 * generic edge predicate (a point is covered iff the router/link-budget reaches it
 * at the bound instant). Returns a value in [0, 1].
 */
export function coveredFraction(
  region: { latRad: number; lonRad: number; radiusRad: number },
  sampleCount: number,
  isCoveredAt: (p: RegionPoint) => boolean,
): number {
  if (sampleCount <= 0) return 0;
  const points = sampleRegionPoints(region, sampleCount);
  let covered = 0;
  for (const p of points) {
    if (isCoveredAt(p)) covered++;
  }
  return covered / points.length;
}

// ── small local helpers (inlined; keeps the import surface minimal + the file
//    trivially pure) ────────────────────────────────────────────────────────────

/** Body-fixed (lat,lon) → outward unit vector — the SAME convention frame.ts /
 * roster.ts / field.ts use: [cosLat·cosLon, cosLat·sinLon, sinLat]. */
function latLonToUnit(latRad: number, lonRad: number): [number, number, number] {
  const cl = Math.cos(latRad);
  return [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
}

/** Outward unit vector → (lat,lon) in radians. Inverse of latLonToUnit. */
function unitToLatLon(
  x: number,
  y: number,
  z: number,
): { latRad: number; lonRad: number } {
  const m = Math.hypot(x, y, z) || 1;
  const nz = Math.max(-1, Math.min(1, z / m));
  return { latRad: Math.asin(nz), lonRad: Math.atan2(y, x) };
}

function cross(
  a: readonly [number, number, number],
  b: readonly [number, number, number],
): [number, number, number] {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

function normalize(
  v: readonly [number, number, number],
): [number, number, number] {
  const m = Math.hypot(v[0], v[1], v[2]) || 1;
  return [v[0] / m, v[1] / m, v[2] / m];
}
