/**
 * net/ — CISLUNAR GEOMETRY: the tidally-locked Moon frame, the Earth–Moon L2 station,
 * and the lunar occlusion test. The substrate the Act-3c on-ramp routes over.
 *
 * --- WHY CISLUNAR IS A DIFFERENT PROBLEM, NOT A BIGGER NUMBER --------------------
 * Acts 1–3 are all solved the same way: the geometry OPENS and CLOSES as the body spins,
 * so every shortfall is a scheduling problem — launch more, phase them, aim a beam, wait
 * for the pass. The lunar FARSIDE is the first demand where that is not true. The Moon is
 * TIDALLY LOCKED: its rotation period equals its orbital period, so it keeps ONE face to
 * Earth forever. A station at lunar longitude 180° has Earth permanently below its horizon
 * — not intermittently, STRUCTURALLY. No Earth-orbit constellation, at any size, phase, or
 * inclination, ever sees it. The only answer is a node standing where NEITHER endpoint is:
 * the Earth–Moon L2 point beyond the far limb, which sees the farside AND Earth at once.
 * That is the GDD §2 tier-2 lesson ("relay placement") as a geometric fact, not a tuning.
 *
 * The ~1.3 s light-delay rides along for free and HONESTLY: the module never fakes a
 * distance, so the delay the router stamps is `|path| / c` over the real ephemeris
 * Earth↔Moon separation (~399,900 km ⇒ 1.334 s one way). That is the GDD's "first real
 * light-delay (~1.3 s)" on-ramp — felt by sight before Mars makes it bite (GDD risk #7).
 *
 * --- THE FRAME (the one convention this file owns) --------------------------------
 * The lunar body-fixed basis is built from the Earth→Moon direction at t, so tidal lock is
 * STRUCTURAL rather than a rotation constant that could drift out of sync:
 *   x̂ = unit(earth − moon)   — the SUB-EARTH direction; lunar longitude 0 BY DEFINITION.
 *   ẑ = unit(+Z ⊥ x̂)         — ecliptic north, Gram–Schmidt'd against x̂.
 *   ŷ = ẑ × x̂                — completes the right-handed triad.
 * So lon 0 always faces Earth and lon π (the farside) always faces away — the invariant
 * the whole act rests on, true at every t by construction. The Moon's 6.7° axial tilt and
 * physical libration are OMITTED: the shipped ephemeris is obliquity-free (m2a documents
 * the same simplification for Earth), and libration would only nibble at the limb, never
 * open the farside. The lie would be claiming a farside pass exists; we make none.
 *
 * Every vector here is EARTH-RELATIVE metres, matching the rest of net/ (the router's
 * `positions` map, link-budget's `segmentOccludedByBody`, the orrery's rebase input).
 *
 * PURE: no three, no DOM, no wall-clock, no RNG. Pure functions of (eph, t).
 *
 * @see docs/signal-horizon-gdd.md §2 tier 2 (cislunar), §risk 7 (the onboarding wall).
 */

import type { Ephemeris, Vec3 } from "../ephemeris";
import { C_LIGHT } from "../ephemeris";
import { type SatOrbit } from "../m2/roster";
import { solveOrbit } from "../m2/orbit";
import type { NetSat } from "./sat";

/** The body id of the Moon in the shipped dataset (parent "earth", real elements). */
export const MOON_BODY_ID = "moon";

/** The body's OWN gravitational parameter (m³/s²) from the dataset — `muParent` is the
 * PARENT's, so the collinear-point derivation reads `muSelf` directly. */
function muSelfOf(eph: Ephemeris, id: string): number {
  return eph.bodies.get(id)?.muSelf ?? 0;
}

/** The id stem of an EARTH–MOON L2 GATEWAY node (the halo relay that sees both faces).
 * Its position is the analytic L2 point, NOT a Kepler propagation — see {@link eml2Relative}. */
export const LUNA_GATE_ID_STEM = "LUNA-GATE";

/** The id stem of a LUNAR ORBITER (a genuine Kepler orbit about the Moon, parentId "moon"). */
export const LUNA_ORBIT_ID_STEM = "LUNA-ORB";

/** True iff `id` names a node whose position is resolved in the cislunar frame. */
export function isCislunarNodeId(id: string): boolean {
  return id.startsWith(LUNA_GATE_ID_STEM) || id.startsWith(LUNA_ORBIT_ID_STEM);
}

/** True iff `id` names an Earth–Moon L2 gateway node. */
export function isLunaGateId(id: string): boolean {
  return id.startsWith(LUNA_GATE_ID_STEM);
}

/** Earth-relative position (metres) of the Moon's CENTRE at sim-time t. */
export function moonCentreRelative(eph: Ephemeris, t: number): Vec3 {
  const e = eph.position("earth", t);
  const m = eph.position(MOON_BODY_ID, t);
  return [m[0] - e[0], m[1] - e[1], m[2] - e[2]];
}

/** The Moon's physical radius (metres) — the real dataset value (1,737.4 km). */
export function moonRadiusM(eph: Ephemeris): number {
  return eph.radiusMeters(MOON_BODY_ID);
}

/** Earth↔Moon centre separation (metres) at sim-time t. */
export function earthMoonDistanceM(eph: Ephemeris, t: number): number {
  const c = moonCentreRelative(eph, t);
  return Math.hypot(c[0], c[1], c[2]);
}

/** One-way light time (seconds) across the Earth↔Moon centre separation — the GDD's
 * "~1.3 s" on-ramp number, read straight off the ephemeris (never a constant). */
export function cislunarOneWayLightS(eph: Ephemeris, t: number): number {
  return earthMoonDistanceM(eph, t) / C_LIGHT;
}

/** An orthonormal right-handed lunar body-fixed basis at sim-time t (see the header).
 * `x` is the SUB-EARTH direction (lunar lon 0), `z` is ecliptic north ⊥ x, `y = z × x`. */
export function lunarBasis(eph: Ephemeris, t: number): { x: Vec3; y: Vec3; z: Vec3 } {
  const c = moonCentreRelative(eph, t);
  const r = Math.hypot(c[0], c[1], c[2]);
  // x̂ points FROM the Moon TOWARD Earth — the sub-Earth point, lunar longitude 0.
  const x: Vec3 = [-c[0] / r, -c[1] / r, -c[2] / r];
  // Gram–Schmidt ecliptic north against x̂ so the triad is exactly orthonormal.
  const d = x[2]; // = dot([0,0,1], x)
  let zx = -d * x[0];
  let zy = -d * x[1];
  let zz = 1 - d * x[2];
  const zn = Math.hypot(zx, zy, zz);
  // Degenerate only if the Moon sat exactly on the ecliptic pole from Earth (never in
  // this dataset — inc 5.145°); fall back to +X so the basis stays defined.
  if (zn <= 1e-12) {
    zx = 1;
    zy = 0;
    zz = 0;
  }
  const z: Vec3 = zn > 1e-12 ? [zx / zn, zy / zn, zz / zn] : [1, 0, 0];
  const y: Vec3 = [
    z[1] * x[2] - z[2] * x[1],
    z[2] * x[0] - z[0] * x[2],
    z[0] * x[1] - z[1] * x[0],
  ];
  return { x, y, z };
}

/**
 * Earth-relative position (metres) of a point on the lunar surface at body-fixed
 * (lat, lon), at sim-time t. Longitude 0 is the sub-Earth point; longitude π is the
 * centre of the farside — permanently hidden from Earth, by construction.
 */
export function lunarSurfacePointRelative(
  eph: Ephemeris,
  latRad: number,
  lonRad: number,
  t: number,
): Vec3 {
  const c = moonCentreRelative(eph, t);
  const { x, y, z } = lunarBasis(eph, t);
  const R = moonRadiusM(eph);
  const cl = Math.cos(latRad);
  const ux = cl * Math.cos(lonRad);
  const uy = cl * Math.sin(lonRad);
  const uz = Math.sin(latRad);
  return [
    c[0] + R * (ux * x[0] + uy * y[0] + uz * z[0]),
    c[1] + R * (ux * x[1] + uy * y[1] + uz * z[1]),
    c[2] + R * (ux * x[2] + uy * y[2] + uz * z[2]),
  ];
}

/** The outward surface NORMAL (unit, earth-relative) at a lunar body-fixed (lat, lon). */
export function lunarSurfaceNormal(
  eph: Ephemeris,
  latRad: number,
  lonRad: number,
  t: number,
): Vec3 {
  const { x, y, z } = lunarBasis(eph, t);
  const cl = Math.cos(latRad);
  const ux = cl * Math.cos(lonRad);
  const uy = cl * Math.sin(lonRad);
  const uz = Math.sin(latRad);
  return [
    ux * x[0] + uy * y[0] + uz * z[0],
    ux * x[1] + uy * y[1] + uz * z[1],
    ux * x[2] + uy * y[2] + uz * z[2],
  ];
}

/**
 * The Earth–Moon L2 distance beyond the Moon, as a FRACTION of the Earth–Moon separation.
 *
 * Derived from the dataset's own gravitational parameters, never hardcoded: for the
 * circular restricted three-body problem the collinear L2 point sits at
 *   Δ ≈ R · (μ₂ / 3(μ₁ + μ₂))^(1/3)
 * beyond the smaller body. With the shipped μ values (Earth 3.986e14, Moon 4.905e12) this
 * is ≈ 0.1595 R ≈ 63,800 km — the real EML2 standoff (~61,500 km) to within the accuracy
 * this game needs. The Hill-sphere form is used rather than a Newton solve of the quintic
 * because the difference (~4%) is far below anything the player can perceive, and it keeps
 * the whole file closed-form and allocation-free.
 */
export function eml2FractionBeyondMoon(eph: Ephemeris): number {
  const muE = muSelfOf(eph, "earth");
  const muM = muSelfOf(eph, MOON_BODY_ID);
  if (muE + muM <= 0) return 0;
  return Math.cbrt(muM / (3 * (muE + muM)));
}

/** Earth-relative position (metres) of the bare collinear L2 POINT at sim-time t — the
 * point on the Earth→Moon ray, `eml2FractionBeyondMoon` further out than the Moon. This is
 * the halo's CENTRE, not where the station flies: see {@link eml2Relative}. */
export function eml2PointRelative(eph: Ephemeris, t: number): Vec3 {
  const c = moonCentreRelative(eph, t);
  const k = 1 + eml2FractionBeyondMoon(eph);
  return [c[0] * k, c[1] * k, c[2] * k];
}

/**
 * HALO AMPLITUDE (metres) — why the gateway is NOT parked on the L2 point.
 *
 * The collinear L2 point lies exactly on the Earth→Moon ray, i.e. squarely inside the
 * Moon's radio shadow: a station sitting ON it can see the farside perfectly and can
 * never see Earth at all, which is useless. This is not a modelling artefact, it is the
 * real reason every actual EML2 relay (Queqiao, 2018) flies a HALO about the point rather
 * than occupying it.
 *
 * The clearance the halo must beat: the Moon's disc (radius 1,737 km at ~400,000 km)
 * projected out to the L2 standoff (~464,000 km from Earth) is a shadow cylinder of
 * radius ≈ 1737 · (464/400) ≈ 2,015 km. Anything further off-axis than that has line of
 * sight to Earth. 13,000 km is the Queqiao-class amplitude and clears it ~6×, with the
 * same margin holding across the Moon's perigee/apogee swing.
 */
export const EML2_HALO_RADIUS_M = 1.3e7;

/** HALO PERIOD (seconds) — a Queqiao-class ~14-day circuit about the L2 point. Over a
 * play session this is very nearly static, which is the POINT: the station's job is
 * boring, continuous double visibility, not a pass to be timed. Its phase is therefore
 * never a lever the player schedules against; it is modelled because it is true, not
 * because it is a mechanic. */
export const EML2_HALO_PERIOD_S = 14 * 86400;

/**
 * Earth-relative position (metres) of the EARTH–MOON L2 GATEWAY STATION at sim-time t: a
 * circular halo of radius {@link EML2_HALO_RADIUS_M} about the collinear L2 point, swept
 * in the plane PERPENDICULAR to the Earth–Moon line (spanned by the lunar frame's ŷ, ẑ).
 *
 * The halo is what buys the station its defining property — continuous view of the lunar
 * farside AND of Earth at the same time — because it holds the node permanently clear of
 * the Moon's shadow cylinder while keeping it high over the far limb. Both halves of that
 * claim are asserted geometrically in `cislunar.test.ts` across a full lunar month, so the
 * game never merely promises the relay works.
 */
export function eml2Relative(eph: Ephemeris, t: number): Vec3 {
  const p = eml2PointRelative(eph, t);
  const { y, z } = lunarBasis(eph, t);
  const phase = (2 * Math.PI * t) / EML2_HALO_PERIOD_S;
  const cy = EML2_HALO_RADIUS_M * Math.cos(phase);
  const cz = EML2_HALO_RADIUS_M * Math.sin(phase);
  return [
    p[0] + cy * y[0] + cz * z[0],
    p[1] + cy * y[1] + cz * z[1],
    p[2] + cy * y[2] + cz * z[2],
  ];
}

/**
 * True iff the straight segment from→to passes strictly through the MOON's sphere — the
 * lunar analogue of link-budget's `segmentOccludedByBody` (which tests the Earth at the
 * earth-relative origin). Both endpoints are earth-relative metres.
 *
 * Endpoints ON the sphere (a lunar surface station is exactly on it) must NOT self-occlude,
 * so the same "nearest approach strictly inside the open segment" test is used, with the
 * identical epsilon of slack that lets a grazing horizon tangent pass.
 */
export function segmentOccludedByMoon(
  eph: Ephemeris,
  from: Vec3,
  to: Vec3,
  t: number,
): boolean {
  const m = moonCentreRelative(eph, t);
  const R = moonRadiusM(eph);
  const dx = to[0] - from[0];
  const dy = to[1] - from[1];
  const dz = to[2] - from[2];
  const segLen2 = dx * dx + dy * dy + dz * dz;
  if (segLen2 <= 0) return false;
  const fx = from[0] - m[0];
  const fy = from[1] - m[1];
  const fz = from[2] - m[2];
  // Parameter s ∈ (0,1) of the closest point on the segment to the Moon's centre.
  const s = -(fx * dx + fy * dy + fz * dz) / segLen2;
  if (s <= 0 || s >= 1) return false;
  const cx = fx + s * dx;
  const cy = fy + s * dy;
  const cz = fz + s * dz;
  const closest2 = cx * cx + cy * cy + cz * cz;
  // A hair of slack so a tangent grazing the limb is not called occlusion (mirrors
  // link-budget's convention exactly).
  return closest2 < R * R - 1e-3;
}

/**
 * Earth-relative position (metres) of a CISLUNAR node at sim-time t, or null when `sat`
 * is an ordinary Earth-orbit asset (the caller then falls back to plain propagation).
 *
 * Two node classes, dispatched so each is resolved the honest way:
 *   - LUNA-GATE: the analytic Earth–Moon L2 point ({@link eml2Relative}). It flies no
 *     Kepler orbit — station-keeping IS its definition — so its recorded `orbit` is never
 *     propagated for position.
 *   - LUNA-ORB (or any orbit whose `parentId` is the Moon): a GENUINE Kepler propagation
 *     about the Moon, translated into the earth-relative frame by adding the Moon's centre.
 */
export function cislunarNodePosition(eph: Ephemeris, sat: NetSat, t: number): Vec3 | null {
  if (isLunaGateId(sat.id)) return eml2Relative(eph, t);
  if (sat.orbit.parentId === MOON_BODY_ID) {
    const rel = solveOrbit(sat.orbit, t);
    const c = moonCentreRelative(eph, t);
    return [c[0] + rel[0], c[1] + rel[1], c[2] + rel[2]];
  }
  return null;
}

/** Build the recorded {@link SatOrbit} for an L2 gateway node. Its elements are a plausible
 * lunar-centred record (so the orrery draws a ring about the Moon and nothing keys off a
 * body the ephemeris lacks), but position is ALWAYS taken from {@link eml2Relative}. */
export function eml2StationOrbit(eph: Ephemeris, t: number): SatOrbit {
  const aM = earthMoonDistanceM(eph, t) * eml2FractionBeyondMoon(eph);
  return {
    parentId: MOON_BODY_ID,
    aM,
    e: 0,
    incRad: 0,
    raanRad: 0,
    argpRad: 0,
    m0Rad: 0,
    epochS: t,
    muParent: muSelfOf(eph, MOON_BODY_ID),
  };
}
