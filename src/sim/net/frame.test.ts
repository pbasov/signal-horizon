import { describe, it, expect } from "vitest";
import type { Vec3 } from "../ephemeris";
import { solveOrbit } from "../m2/orbit";
import {
  earthThetaAt,
  rotZ,
  bodyFixedToInertialDir,
  inertialDirToBodyFixed,
  surfacePointInertial,
} from "./frame";
import {
  A1_BODY_RADIUS_M,
  A1_GEO_SEMI_MAJOR_M,
  A1_GEO_PERIOD_S,
  A1_EARTH_OMEGA_RAD_PER_S,
  resolveOrbit,
} from "./world";

const DEG = Math.PI / 180;

function wrapPi(a: number): number {
  const TAU = Math.PI * 2;
  let x = (a + Math.PI) % TAU;
  if (x < 0) x += TAU;
  return x - Math.PI;
}

describe("frame: Decision A spin convention (+Z, θ0=0, t0=0, prograde)", () => {
  it("at t=0 the spin is the identity (θ=0)", () => {
    expect(earthThetaAt(0)).toBe(0);
    const d = bodyFixedToInertialDir(30 * DEG, 17 * DEG, 0);
    // u(lat,lon) directly — no rotation at t=0.
    const cl = Math.cos(30 * DEG);
    expect(d[0]).toBeCloseTo(cl * Math.cos(17 * DEG), 15);
    expect(d[1]).toBeCloseTo(cl * Math.sin(17 * DEG), 15);
    expect(d[2]).toBeCloseTo(Math.sin(30 * DEG), 15);
  });

  it("rotates about +Z: an equatorial lon=0 point at t=period/4 sits at +90°", () => {
    const t = A1_GEO_PERIOD_S / 4; // θ = ω·t = π/2
    expect(earthThetaAt(t)).toBeCloseTo(Math.PI / 2, 12);
    const d = bodyFixedToInertialDir(0, 0, t); // u=[1,0,0] → Rz(90°) → [0,1,0]
    expect(d[0]).toBeCloseTo(0, 12);
    expect(d[1]).toBeCloseTo(1, 12);
    expect(d[2]).toBeCloseTo(0, 12);
  });

  it("rotZ is a pure +Z rotation (z unchanged, xy CCW)", () => {
    const v: Vec3 = [1, 0, 5];
    const r = rotZ(v, Math.PI / 2);
    expect(r[0]).toBeCloseTo(0, 12);
    expect(r[1]).toBeCloseTo(1, 12);
    expect(r[2]).toBe(5);
  });

  it("round-trip inertial → body-fixed → inertial is identity to 1e-12", () => {
    const samples: Array<[number, number, number]> = [
      [0, 0, 0],
      [30 * DEG, 0, 37],
      [-12 * DEG, 200 * DEG, 91.3],
      [89 * DEG, -45 * DEG, 240],
      [0, 123.4 * DEG, 1000.7],
    ];
    for (const [lat, lon, t] of samples) {
      const v = bodyFixedToInertialDir(lat, lon, t);
      const back = inertialDirToBodyFixed(v, t);
      const reInertial = rotZ(back, earthThetaAt(t));
      expect(reInertial[0]).toBeCloseTo(v[0], 12);
      expect(reInertial[1]).toBeCloseTo(v[1], 12);
      expect(reInertial[2]).toBeCloseTo(v[2], 12);
      // body-fixed recovers the original unit direction too.
      const cl = Math.cos(lat);
      expect(back[0]).toBeCloseTo(cl * Math.cos(lon), 12);
      expect(back[1]).toBeCloseTo(cl * Math.sin(lon), 12);
      expect(back[2]).toBeCloseTo(Math.sin(lat), 12);
    }
  });

  it("surfacePointInertial places the point on the toy sphere, riding θ(t)", () => {
    const center: Vec3 = [1e6, -2e6, 3e6];
    const t = 53.2;
    const p = surfacePointInertial(30 * DEG, 0, t, center, A1_BODY_RADIUS_M);
    const dx = p[0] - center[0];
    const dy = p[1] - center[1];
    const dz = p[2] - center[2];
    const r = Math.sqrt(dx * dx + dy * dy + dz * dz);
    expect(r).toBeCloseTo(A1_BODY_RADIUS_M, 4);
    // direction equals the rotated body-fixed unit vector.
    const d = bodyFixedToInertialDir(30 * DEG, 0, t);
    expect(dx / r).toBeCloseTo(d[0], 12);
    expect(dy / r).toBeCloseTo(d[1], 12);
    expect(dz / r).toBeCloseTo(d[2], 12);
  });
});

describe("frame × world: non-zero-epoch park (MED fix — Decision A)", () => {
  it("requesting sub-lon 45° at epoch 37 s parks at body-fixed 45° (NOT −10.5°)", () => {
    const desiredSubLon = 45 * DEG;
    const epoch = 37;
    const orbit = resolveOrbit(
      { semiMajorM: A1_GEO_SEMI_MAJOR_M, incRad: 0, subLonRad: desiredSubLon },
      epoch,
    );
    // Propagate over a full GEO period from the commit epoch; de-rotate to body-fixed.
    const N = 64;
    for (let k = 0; k <= N; k++) {
      const t = epoch + (A1_GEO_PERIOD_S * k) / N;
      const rel = solveOrbit(orbit, t); // inertial position relative to earth
      const inertialSubLon = Math.atan2(rel[1], rel[0]);
      const bodyFixedSubLon = wrapPi(inertialSubLon - earthThetaAt(t));
      // Parks at the requested 45° at every instant (it is geostationary).
      expect(bodyFixedSubLon).toBeCloseTo(desiredSubLon, 9);
    }
  });

  it("the naive m0 = desired would have parked at −10.5° (documents the bug fixed)", () => {
    // Sanity: ω·epoch in degrees is the offset the epoch term cancels.
    const epoch = 37;
    const naiveOffsetDeg = (A1_EARTH_OMEGA_RAD_PER_S * epoch) / DEG;
    expect(45 - naiveOffsetDeg).toBeCloseTo(-10.5, 1);
  });
});
