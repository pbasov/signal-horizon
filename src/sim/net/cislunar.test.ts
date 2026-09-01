/**
 * net/cislunar — the geometric claims the Act-3c on-ramp rests on, asserted rather than
 * asserted-in-prose. The act is only honest if THREE things are true of the real dataset
 * at EVERY sim-time, not just the one the designer happened to look at:
 *
 *   1. TIDAL LOCK. Lunar longitude 0 always faces Earth; longitude π always faces away.
 *   2. THE FARSIDE IS STRUCTURALLY DARK. Earth never sees longitude π — not "rarely",
 *      NEVER — so no Earth-orbit topology can ever close the contract. This is the act's
 *      whole premise; if a farside pass existed anywhere in the month the act would be a
 *      scheduling puzzle wearing a costume.
 *   3. THE HALO IS LOAD-BEARING. The L2 GATEWAY sees the farside AND Earth at once, and
 *      the bare collinear L2 point does NOT (it is inside the Moon's shadow) — so the
 *      halo is real physics, not decoration.
 *
 * Sampling spans a full lunar month (27.3 d) so a claim of "always" is tested against the
 * Moon's whole circuit, including the perigee/apogee swing that moves the shadow geometry.
 */

import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { C_LIGHT, type Vec3 } from "../ephemeris";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M, segmentOccludedByBody } from "./link-budget";
import {
  MOON_BODY_ID,
  LUNA_GATE_ID_STEM,
  LUNA_ORBIT_ID_STEM,
  EML2_HALO_RADIUS_M,
  cislunarNodePosition,
  cislunarOneWayLightS,
  earthMoonDistanceM,
  eml2FractionBeyondMoon,
  eml2PointRelative,
  eml2Relative,
  eml2StationOrbit,
  isCislunarNodeId,
  isLunaGateId,
  lunarBasis,
  lunarSurfaceNormal,
  lunarSurfacePointRelative,
  moonCentreRelative,
  moonRadiusM,
  segmentOccludedByMoon,
} from "./cislunar";

const eph = loadEphemeris();

/** A full synodic-ish sweep: 32 samples across 27.3 days, plus the session-scale ticks. */
const MONTH_S = 27.32 * 86400;
const MONTH_SAMPLES: number[] = Array.from({ length: 32 }, (_, i) => (i * MONTH_S) / 32);
const SESSION_SAMPLES: number[] = [0, 60, 300, 900, 1800, 3600];
const ALL_SAMPLES: number[] = [...MONTH_SAMPLES, ...SESSION_SAMPLES];

function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}
function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
const EARTH_CENTRE: Vec3 = [0, 0, 0];

describe("cislunar — the lunar frame is orthonormal and tidally locked", () => {
  it("the basis is a right-handed orthonormal triad at every sampled time", () => {
    for (const t of ALL_SAMPLES) {
      const { x, y, z } = lunarBasis(eph, t);
      expect(norm(x)).toBeCloseTo(1, 12);
      expect(norm(y)).toBeCloseTo(1, 12);
      expect(norm(z)).toBeCloseTo(1, 12);
      expect(dot(x, y)).toBeCloseTo(0, 10);
      expect(dot(x, z)).toBeCloseTo(0, 10);
      expect(dot(y, z)).toBeCloseTo(0, 10);
      // Right-handed: x × y = z.
      const cross: Vec3 = [
        x[1] * y[2] - x[2] * y[1],
        x[2] * y[0] - x[0] * y[2],
        x[0] * y[1] - x[1] * y[0],
      ];
      expect(dot(cross, z)).toBeCloseTo(1, 10);
    }
  });

  it("longitude 0 is the SUB-EARTH point and longitude π the farside, at every time", () => {
    for (const t of ALL_SAMPLES) {
      const near = lunarSurfacePointRelative(eph, 0, 0, t);
      const far = lunarSurfacePointRelative(eph, 0, Math.PI, t);
      const centreDist = earthMoonDistanceM(eph, t);
      const R = moonRadiusM(eph);
      // The near point is exactly one lunar radius closer to Earth than the centre; the
      // far point exactly one radius further. That IS tidal lock, stated numerically.
      expect(norm(near)).toBeCloseTo(centreDist - R, 1);
      expect(norm(far)).toBeCloseTo(centreDist + R, 1);
    }
  });

  it("no lunar longitude is nearer to Earth than the sub-Earth point", () => {
    for (const t of SESSION_SAMPLES) {
      const near = norm(lunarSurfacePointRelative(eph, 0, 0, t));
      for (let k = 1; k < 36; k++) {
        const lon = (k * 2 * Math.PI) / 36;
        expect(norm(lunarSurfacePointRelative(eph, 0, lon, t))).toBeGreaterThan(near - 1);
      }
    }
  });

  it("the surface normal at (lat,lon) points from the Moon's centre through the point", () => {
    for (const t of SESSION_SAMPLES) {
      for (const [lat, lon] of [
        [0, 0],
        [0, Math.PI],
        [0.5, 1.2],
        [-0.8, 4.0],
      ]) {
        const p = lunarSurfacePointRelative(eph, lat, lon, t);
        const c = moonCentreRelative(eph, t);
        const outward = sub(p, c);
        const n = lunarSurfaceNormal(eph, lat, lon, t);
        expect(norm(outward)).toBeCloseTo(moonRadiusM(eph), 1);
        expect(dot(outward, n) / norm(outward)).toBeCloseTo(1, 10);
      }
    }
  });
});

describe("cislunar — the ~1.3 s light delay is read off the ephemeris, never faked", () => {
  it("one-way Earth↔Moon light time is the GDD's ~1.3 s across the month", () => {
    for (const t of ALL_SAMPLES) {
      const ow = cislunarOneWayLightS(eph, t);
      // Perigee/apogee swing keeps it inside a narrow band around 1.28–1.40 s.
      expect(ow).toBeGreaterThan(1.2);
      expect(ow).toBeLessThan(1.45);
      expect(ow).toBeCloseTo(earthMoonDistanceM(eph, t) / C_LIGHT, 12);
    }
  });

  it("is ~1.33 s at t=0 for the shipped dataset", () => {
    expect(cislunarOneWayLightS(eph, 0)).toBeCloseTo(1.334, 2);
  });
});

describe("cislunar — THE FARSIDE IS STRUCTURALLY DARK (the act's premise)", () => {
  it("Earth NEVER has line of sight to the farside centre, across a full lunar month", () => {
    for (const t of ALL_SAMPLES) {
      const far = lunarSurfacePointRelative(eph, 0, Math.PI, t);
      expect(segmentOccludedByMoon(eph, EARTH_CENTRE, far, t)).toBe(true);
    }
  });

  it("no point in ALL of Earth's orbital space sees the farside centre", () => {
    // Sweep a shell of candidate Earth-orbit positions far wider than anything the player
    // can launch (the net game's assets all sit inside ~1.2 GEO ≈ 1,000 km). If not one of
    // them closes, "launch more satellites" is provably not an answer.
    const t = 1800;
    const far = lunarSurfacePointRelative(eph, 0, Math.PI, t);
    let sawIt = 0;
    for (const rM of [1e6, 1e7, 5e7]) {
      for (let i = 0; i < 24; i++) {
        const a = (i * 2 * Math.PI) / 24;
        for (const incl of [0, 0.6, -0.6]) {
          const p: Vec3 = [
            rM * Math.cos(a) * Math.cos(incl),
            rM * Math.sin(a) * Math.cos(incl),
            rM * Math.sin(incl),
          ];
          if (!segmentOccludedByMoon(eph, p, far, t)) sawIt++;
        }
      }
    }
    expect(sawIt).toBe(0);
  });

  it("the NEARSIDE centre, by contrast, IS visible from Earth — the frame is not just always-dark", () => {
    for (const t of ALL_SAMPLES) {
      const near = lunarSurfacePointRelative(eph, 0, 0, t);
      expect(segmentOccludedByMoon(eph, EARTH_CENTRE, near, t)).toBe(false);
    }
  });
});

describe("cislunar — the L2 GATEWAY halo is load-bearing physics, not decoration", () => {
  it("the BARE collinear L2 point is inside the Moon's shadow — it cannot see Earth", () => {
    for (const t of ALL_SAMPLES) {
      const bare = eml2PointRelative(eph, t);
      expect(segmentOccludedByMoon(eph, bare, EARTH_CENTRE, t)).toBe(true);
    }
  });

  it("the HALO station sees Earth at every sampled time", () => {
    for (const t of ALL_SAMPLES) {
      const gate = eml2Relative(eph, t);
      expect(segmentOccludedByMoon(eph, gate, EARTH_CENTRE, t)).toBe(false);
    }
  });

  it("the HALO station ALSO sees the lunar farside at every sampled time", () => {
    for (const t of ALL_SAMPLES) {
      const gate = eml2Relative(eph, t);
      const far = lunarSurfacePointRelative(eph, 0, Math.PI, t);
      expect(segmentOccludedByMoon(eph, gate, far, t)).toBe(false);
    }
  });

  it("the farside station sees the gateway high overhead, not skimming its horizon", () => {
    for (const t of ALL_SAMPLES) {
      const far = lunarSurfacePointRelative(eph, 0, Math.PI, t);
      const n = lunarSurfaceNormal(eph, 0, Math.PI, t);
      const toGate = sub(eml2Relative(eph, t), far);
      const elevSin = dot(toGate, n) / norm(toGate);
      // ≥ 70° elevation: the link is robustly overhead, so the act never depends on a
      // marginal grazing geometry that a small tuning change could silently break.
      expect(elevSin).toBeGreaterThan(Math.sin((70 * Math.PI) / 180));
    }
  });

  it("the halo clears the Moon's projected shadow cylinder by a wide margin", () => {
    const t = 0;
    const R = moonRadiusM(eph);
    const rEM = earthMoonDistanceM(eph, t);
    const rL2 = norm(eml2PointRelative(eph, t));
    const shadowRadius = R * (rL2 / rEM);
    expect(EML2_HALO_RADIUS_M).toBeGreaterThan(shadowRadius * 3);
  });

  it("sits beyond the Moon on the anti-Earth side, ~0.16 of the Earth–Moon separation out", () => {
    const f = eml2FractionBeyondMoon(eph);
    expect(f).toBeGreaterThan(0.14);
    expect(f).toBeLessThan(0.18);
    for (const t of SESSION_SAMPLES) {
      // Further from Earth than the Moon, and along the same ray (angle ≈ 0).
      const c = moonCentreRelative(eph, t);
      const p = eml2PointRelative(eph, t);
      expect(norm(p)).toBeGreaterThan(norm(c));
      expect(dot(c, p) / (norm(c) * norm(p))).toBeCloseTo(1, 12);
    }
  });

  it("the EARTH body never occludes the gateway from the earth-relative origin", () => {
    // Sanity: the toy Earth sphere must not be spuriously eating the cislunar leg.
    for (const t of SESSION_SAMPLES) {
      expect(segmentOccludedByBody(EARTH_CENTRE, eml2Relative(eph, t))).toBe(false);
    }
  });
});

describe("cislunar — node position dispatch", () => {
  function sat(id: string, orbit: NetSat["orbit"]): NetSat {
    return { id, orbit, bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) };
  }

  it("recognises the two cislunar id stems and nothing else", () => {
    expect(isCislunarNodeId(`${LUNA_GATE_ID_STEM}-3`)).toBe(true);
    expect(isCislunarNodeId(`${LUNA_ORBIT_ID_STEM}-1`)).toBe(true);
    expect(isCislunarNodeId("NET-SAT-4")).toBe(false);
    expect(isCislunarNodeId("MARS-RELAY-2")).toBe(false);
    expect(isLunaGateId(`${LUNA_GATE_ID_STEM}-0`)).toBe(true);
    expect(isLunaGateId(`${LUNA_ORBIT_ID_STEM}-0`)).toBe(false);
  });

  it("a LUNA-GATE node resolves to the halo station, ignoring its recorded elements", () => {
    const s = sat(`${LUNA_GATE_ID_STEM}-0`, eml2StationOrbit(eph, 0));
    for (const t of SESSION_SAMPLES) {
      const p = cislunarNodePosition(eph, s, t) as Vec3;
      expect(p).not.toBeNull();
      const expected = eml2Relative(eph, t);
      expect(norm(sub(p, expected))).toBeLessThan(1e-6);
    }
  });

  it("a moon-parented orbit resolves to a real Kepler propagation about the Moon", () => {
    const aM = moonRadiusM(eph) + 200e3;
    const s = sat(`${LUNA_ORBIT_ID_STEM}-0`, {
      parentId: MOON_BODY_ID,
      aM,
      e: 0,
      incRad: 0,
      raanRad: 0,
      argpRad: 0,
      m0Rad: 0,
      epochS: 0,
      muParent: 4.9048695e12,
    });
    for (const t of SESSION_SAMPLES) {
      const p = cislunarNodePosition(eph, s, t) as Vec3;
      // It orbits the MOON: its distance from the Moon's centre is the semi-major axis.
      expect(norm(sub(p, moonCentreRelative(eph, t)))).toBeCloseTo(aM, 0);
    }
  });

  it("an ordinary Earth-orbit sat is NOT claimed by the cislunar dispatch", () => {
    const s = sat("NET-SAT-2", {
      parentId: "earth",
      aM: 834_000,
      e: 0,
      incRad: 0,
      raanRad: 0,
      argpRad: 0,
      m0Rad: 0,
      epochS: 0,
      muParent: 3.986004418e14,
    });
    expect(cislunarNodePosition(eph, s, 100)).toBeNull();
  });
});

/**
 * SD-66 — THE BASIS STAYS FINITE EVEN WITH NO SEPARATION.
 *
 * `lunarBasis` divided by the Earth→Moon distance without guarding it, so a zero-length separation
 * produced `-0/0` = NaN across all three components of x̂ — and from there through ŷ/ẑ into
 * `eml2Relative`, `lunarSurfacePointRelative` and the L2 station's recorded orbit. The render layer
 * then wrote NaN vertices into the served-link polyline and the gateway's orbit ring, and Three
 * answered "computeBoundingSphere(): Computed radius is NaN".
 *
 * This is not a theoretical input: Earth and Moon read as coincident on an early frame before the
 * ephemeris is primed, so every act-3c boot with a gateway up hit it briefly. The guarded triad must
 * stay finite AND orthonormal — a fallback that returns garbage would only move the failure.
 */
describe("SD-66 — lunarBasis survives a degenerate Earth–Moon separation", () => {
  /** An ephemeris stub whose Earth and Moon sit at exactly the same point. */
  const coincident = {
    position: () => [0, 0, 0] as Vec3,
    // `eml2FractionBeyondMoon` reads self-mus off this; an empty map exercises its own zero guard.
    bodies: new Map<string, { muSelf: number }>(),
    radiusMeters: () => 1_737_400,
  } as unknown as Parameters<typeof lunarBasis>[0];

  it("returns a finite triad instead of NaN", () => {
    const { x, y, z } = lunarBasis(coincident, 0);
    for (const v of [x, y, z]) for (const k of v) expect(Number.isFinite(k)).toBe(true);
  });

  it("keeps the triad ORTHONORMAL, so callers still get a usable frame", () => {
    const { x, y, z } = lunarBasis(coincident, 0);
    const dot = (a: Vec3, b: Vec3) => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
    const len = (a: Vec3) => Math.hypot(a[0], a[1], a[2]);
    for (const v of [x, y, z]) expect(len(v)).toBeCloseTo(1, 12);
    expect(dot(x, y)).toBeCloseTo(0, 12);
    expect(dot(y, z)).toBeCloseTo(0, 12);
    expect(dot(z, x)).toBeCloseTo(0, 12);
  });

  it("keeps every position built on the basis finite (the NaN's actual blast radius)", () => {
    expect(eml2Relative(coincident, 0).every(Number.isFinite)).toBe(true);
    expect(lunarSurfacePointRelative(coincident, 0, Math.PI, 0).every(Number.isFinite)).toBe(true);
    expect(lunarSurfaceNormal(coincident, 0, Math.PI, 0).every(Number.isFinite)).toBe(true);
  });
});
