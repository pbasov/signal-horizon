import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Roster } from "./roster";
import { solveOrbit, meanMotion, orbitPeriodSeconds } from "./orbit";
import { BuildSession, BUILD_OPENING_BALANCE } from "./session";
import { GROUND_DEPLOY_COST, CANDIDATE_SITES } from "./sites";
import { LAUNCH_PRESETS, resolveLaunchOrbit, presetById, EARTH_MU } from "./launch";
import { GeodesicGrid } from "../coverage/grid";
import { DemandField } from "../coverage/demand";
import { scoreCoverageAt } from "../coverage/score";
import type { Vec3 } from "../ephemeris";

/**
 * M2c unit pins for the placeable-asset roster + the pure launched-sat orbit.
 * The replay/determinism teeth are in m2-build-replay.test.ts; this file pins the
 * geometry + the build mechanics (deploy/launch costs, the launch market, the
 * starter roster, the snapshot round-trip, and that a launched sat orbits sanely).
 */

const KM_M = 1000.0;

describe("m2c — launched-sat orbit propagation (pure Kepler)", () => {
  it("a circular orbit stays at the semi-major-axis radius around its parent", () => {
    const preset = presetById("leo_53")!;
    const orbit = resolveLaunchOrbit(preset, 0, 0);
    // Sample the relative position around one period; |r| stays ~constant = a.
    const period = orbitPeriodSeconds(orbit);
    expect(period).toBeGreaterThan(0);
    for (let k = 0; k < 8; k++) {
      const t = (period * k) / 8;
      const p = solveOrbit(orbit, t);
      const r = Math.hypot(p[0], p[1], p[2]);
      expect(r).toBeCloseTo(preset.altitudeKm * KM_M, 0);
    }
  });

  it("mean motion matches sqrt(mu/a^3) and the sat actually moves over time", () => {
    const orbit = resolveLaunchOrbit(presetById("meo_63")!, 0, 0);
    expect(meanMotion(orbit)).toBeCloseTo(Math.sqrt(EARTH_MU / orbit.aM ** 3), 12);
    const a = solveOrbit(orbit, 0);
    const b = solveOrbit(orbit, 600);
    const moved = Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]);
    expect(moved).toBeGreaterThan(0);
  });

  it("a launched sat's world position tracks its parent body (Earth moves with it)", () => {
    const eph = loadEphemeris();
    const r = new Roster();
    const orbit = resolveLaunchOrbit(presetById("geo_eq")!, 0, 0);
    r.launchSat(orbit, 1.0);
    const t = 1.0e6;
    const pos = r.worldPositions(eph, t)[0];
    const earth = eph.position("earth", t);
    const alt = Math.hypot(pos[0] - earth[0], pos[1] - earth[1], pos[2] - earth[2]);
    expect(alt).toBeCloseTo(orbit.aM, 0); // GEO radius around the (moved) Earth.
  });
});

describe("m2c — the build session (deploy + launch market)", () => {
  it("boots with a small non-empty starter roster", () => {
    const s = new BuildSession();
    expect(s.roster.count).toBeGreaterThan(0);
    expect(s.roster.groundCount).toBeGreaterThanOrEqual(1);
    expect(s.roster.satCount).toBeGreaterThanOrEqual(1);
    expect(s.balance).toBe(BUILD_OPENING_BALANCE);
  });

  it("deploying a ground station adds it + charges the deploy cost", () => {
    const s = new BuildSession();
    const before = s.roster.count;
    const bal = s.balance;
    const res = s.deployGround(0);
    expect(res.kind).toBe("ground_deployed");
    expect(res.costEur).toBe(GROUND_DEPLOY_COST);
    expect(s.roster.count).toBe(before + 1);
    expect(s.balance).toBeCloseTo(bal - GROUND_DEPLOY_COST, 6);
  });

  it("a successful launch adds a sat + charges the preset cost; balance can go negative (overspend)", () => {
    const s = new BuildSession();
    // Drain the wallet with launches; building is allowed to overspend.
    let sawSat = false;
    for (let i = 0; i < 20; i++) {
      const res = s.launchSat("leo_53", 0);
      if (res.kind === "sat_launched") sawSat = true;
    }
    expect(sawSat).toBe(true);
    expect(s.balance).toBeLessThan(0); // overspent — the build-vs-budget tension is real.
    expect(s.bankrupt).toBe(true);
  });

  it("a failed launch charges the € but adds no sat", () => {
    // Seed 7's second leo_53-class roll fails (<0.04 not hit, but meo_63 <0.07 does)
    // — drive launches and find a launch_failed, asserting the roster did not grow.
    const s = new BuildSession();
    let failed = false;
    for (let i = 0; i < 30 && !failed; i++) {
      const before = s.roster.satCount;
      const res = s.launchSat("geo_eq", 0); // 10% failure — hits within 30 tries
      if (res.kind === "launch_failed") {
        failed = true;
        expect(res.costEur).toBeGreaterThan(0);
        expect(s.roster.satCount).toBe(before); // no sat added on failure
      }
    }
    expect(failed).toBe(true);
  });

  it("an unknown launch preset is rejected (no charge, no sat)", () => {
    const s = new BuildSession();
    const bal = s.balance;
    const res = s.launchSat("not_a_preset", 0);
    expect(res.kind).toBe("rejected");
    expect(s.balance).toBe(bal);
  });

  it("the launch board exposes the LEO/MEO/GEO presets with rising cost", () => {
    expect(s_presetCosts()).toEqual([...s_presetCosts()].sort((a, b) => a - b));
    expect(LAUNCH_PRESETS.length).toBeGreaterThanOrEqual(3);
  });

  it("snapshot/restore round-trips the whole build session by value", () => {
    const s = new BuildSession();
    s.deployGround(1);
    s.launchSat("meo_63", 1000);
    const snap = s.snapshot();
    const s2 = new BuildSession();
    s2.restore(snap);
    expect(s2.snapshot()).toEqual(snap);
  });
});

describe("m2c — coverage grows as the roster grows (the monument)", () => {
  it("adding stations + a sat raises the covered-demand fraction", () => {
    const eph = loadEphemeris();
    const grid = GeodesicGrid.build();
    const demand = DemandField.build(grid);
    const t = 5000;
    const earth = eph.position("earth", t);
    const earthR = eph.radiusMeters("earth");
    const frac = (s: BuildSession) => {
      const pos: Vec3[] = s.worldPositions(eph, t);
      return scoreCoverageAt(grid, demand, s.roster.eirps(), pos, earth, earthR).coveredDemandFraction;
    };
    const s = new BuildSession();
    const start = frac(s);
    // Deploy every candidate site + launch a fan of sats — the web grows.
    for (let i = 0; i < CANDIDATE_SITES.length; i++) s.deployGround(i);
    for (let i = 0; i < 6; i++) s.launchSat("meo_63", t);
    const end = frac(s);
    expect(end).toBeGreaterThan(start);
  });
});

/** Local helper: the preset costs in board order. */
function s_presetCosts(): number[] {
  return LAUNCH_PRESETS.map((p) => p.costEur);
}
