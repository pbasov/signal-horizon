import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { solveOrbit } from "../m2/orbit";
import {
  NET_ACT1_REGION,
  NET_ACT1_GROUND,
  NET_MIN_ELEVATION_RAD,
  NET_SPACE_SAMPLES,
  coveredFraction,
  sampleRegionPoints,
  type RegionPoint,
} from "./endpoint";
import {
  GEO_PARK,
  LEO_SWEEP,
  A1_GEO_PERIOD_S,
  A1_LEO_PERIOD_S,
  resolveOrbit,
} from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M, surfacePointRelative, surfaceNormalRelative, evaluateLink } from "./link-budget";
import {
  solve,
  isPointServed,
  resolveTick,
  satPositionRelative,
  type RoutableContract,
} from "./router";

/**
 * THE ACT-1 MAKE-OR-BREAK PIN (design §5 / §7 A1, the HIGH must-fix): retargeted from
 * the dropped a1/reachability.winnable.test.ts. The bent-pipe stub is gone; this pins
 * the REAL router + link budget.
 *
 *   1. The parked equatorial GEO serves the WHOLE equatorial disc at eirp 1.0:
 *      coveredFraction(region, N, isCoveredAt) === 1.0 — every Fibonacci sample, no clip.
 *   2. A WORST-SAMPLE MARGIN (the disc edge): worst elevation ≥ floor + headroom, worst
 *      received ≥ 1 + headroom — so a future constant nudge cannot silently re-introduce
 *      an edge clip.
 *   3. A single LEO is NOT served (it sets) and re-solves to UNSERVED via the horizon
 *      event, with a link-loss stamp recording the geometric cause + time.
 */

const DEG = Math.PI / 180;

/** A minimal pure ephemeris — the toy single-body net frame is earth-relative, so the
 * router never dereferences eph (the earth-centre offset cancels in every edge). */
const eph = Ephemeris.build({});

function geoSat(t = 0): NetSat {
  return {
    id: "SAT-GEO",
    orbit: resolveOrbit(GEO_PARK, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

function leoSat(t = 0): NetSat {
  return {
    id: "SAT-LEO",
    orbit: resolveOrbit(LEO_SWEEP, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

const contract: RoutableContract = {
  id: "C-ACT1",
  region: NET_ACT1_REGION,
  activeAxes: new Set(["connectivity"]),
};

describe("router winnable: the parked GEO covers the WHOLE equatorial disc (no clip)", () => {
  it("coveredFraction === 1.0 at eirp 1.0 over every Fibonacci sample", () => {
    const sats = [geoSat(0)];
    const f = coveredFraction(NET_ACT1_REGION, NET_SPACE_SAMPLES, (p: RegionPoint) =>
      isPointServed(eph, p, [NET_ACT1_GROUND], sats, 0),
    );
    expect(f).toBe(1.0); // WHOLE disc, no forced imperfection, no edge clip.
  });

  it("stays whole-disc-covered across a full GEO period (the GEO parks, never sets)", () => {
    const N = 16;
    for (let k = 0; k <= N; k++) {
      const t = (A1_GEO_PERIOD_S * k) / N;
      const sats = [geoSat(0)]; // launched at epoch 0; its orbit is fixed thereafter.
      const f = coveredFraction(NET_ACT1_REGION, NET_SPACE_SAMPLES, (p: RegionPoint) =>
        isPointServed(eph, p, [NET_ACT1_GROUND], sats, t),
      );
      expect(f).toBe(1.0);
    }
  });

  it("WORST-SAMPLE MARGIN: worst elevation ≥ floor + headroom, worst received ≥ 1 + headroom", () => {
    // The parked GEO sits at the region nadir, so the worst disc point is the rim. Walk
    // every Fibonacci sample's uplink geometry and take the worst of each.
    const sat = geoSat(0);
    const satPos = satPositionRelative(eph, sat, 0);
    const { eirp, rangeRefM } = { eirp: sat.loadout[0].eirp, rangeRefM: sat.loadout[0].rangeRefM };
    let worstElevRad = Infinity;
    let worstReceived = Infinity;
    for (const p of sampleRegionPoints(NET_ACT1_REGION, NET_SPACE_SAMPLES)) {
      const from = surfacePointRelative(p.latRad, p.lonRad, 0);
      const normal = surfaceNormalRelative(p.latRad, p.lonRad, 0);
      const lk = evaluateLink(from, normal, satPos, eirp, rangeRefM);
      if (lk.elevationRad < worstElevRad) worstElevRad = lk.elevationRad;
      if (lk.received < worstReceived) worstReceived = lk.received;
    }
    // Headroom: the worst (rim) elevation is ~74.5° vs the 5° floor — DOCUMENTED ≥ 60°
    // of headroom; the worst received is ~8500× the budget — DOCUMENTED ≥ 100× headroom.
    const ELEV_HEADROOM_RAD = 60 * DEG;
    const RECEIVED_HEADROOM = 100;
    expect(worstElevRad).toBeGreaterThanOrEqual(NET_MIN_ELEVATION_RAD + ELEV_HEADROOM_RAD);
    expect(worstReceived).toBeGreaterThanOrEqual(1 + RECEIVED_HEADROOM);
    // Report the actual worst values (visible in the run log).
    expect(worstElevRad / DEG).toBeGreaterThan(74);
    expect(worstReceived).toBeGreaterThan(8000);
  });

  it("solve() returns the trivial region→sat→groundNet path, served, finite latency", () => {
    const res = solve(eph, contract, [geoSat(0)], [NET_ACT1_GROUND], 0);
    expect(res.served).toBe(true);
    expect(res.path).toEqual([NET_ACT1_REGION.id, "SAT-GEO", NET_ACT1_GROUND.id]);
    expect(res.latencyS).toBeGreaterThan(0);
    expect(Number.isFinite(res.latencyS)).toBe(true);
    expect(res.bindingConstraint).toBeNull();
    expect(res.losses).toEqual([]);
  });
});

describe("router winnable: a single LEO SETS — unserved + horizon re-solve + loss stamp", () => {
  it("the LEO covers at t=0 but SETS within its pass (a non-covering orbit)", () => {
    const sat = leoSat(0);
    // At launch the LEO is overhead → served.
    expect(isPointServed(eph, { latRad: 0, lonRad: 0 }, [NET_ACT1_GROUND], [sat], 0)).toBe(true);
    // Sweep the pass: find a time it has set (unserved).
    let setTime = -1;
    const N = 600;
    for (let k = 0; k <= N; k++) {
      const t = (A1_LEO_PERIOD_S * k) / N;
      if (!isPointServed(eph, { latRad: 0, lonRad: 0 }, [NET_ACT1_GROUND], [sat], t)) {
        setTime = t;
        break;
      }
    }
    expect(setTime).toBeGreaterThan(0); // it does set within one pass.
  });

  it("solve() at a set time is UNSERVED with a set_below_horizon loss stamp", () => {
    const sat = leoSat(0);
    // Find the first set time.
    let setTime = -1;
    const N = 600;
    for (let k = 0; k <= N; k++) {
      const t = (A1_LEO_PERIOD_S * k) / N;
      if (!isPointServed(eph, { latRad: 0, lonRad: 0 }, [NET_ACT1_GROUND], [sat], t)) {
        setTime = t;
        break;
      }
    }
    const res = solve(eph, contract, [sat], [NET_ACT1_GROUND], setTime);
    expect(res.served).toBe(false);
    expect(res.path).toBeNull();
    expect(res.latencyS).toBe(Infinity);
    expect(res.bindingConstraint).toBe("connectivity");
    expect(res.losses.length).toBe(1);
    const stamp = res.losses[0];
    expect(stamp.cause).toBe("set_below_horizon"); // the geometric cause.
    expect(stamp.atS).toBe(setTime); // stamped with the time.
    expect(stamp.aId).toBe(NET_ACT1_REGION.id);
    expect(stamp.bId).toBe(NET_ACT1_GROUND.id);
  });

  it("the LEO RE-SOLVES served→UNSERVED via the horizon event (the re-solve split)", () => {
    const sat = leoSat(0);
    // Drive the per-tick re-solve split across the pass. The full search re-runs only on
    // the launch (first tick) and on the horizon set event; in between it cheaply re-evals.
    let state = resolveTick(eph, contract, [sat], [NET_ACT1_GROUND], 0, null);
    expect(state.result.served).toBe(true); // launched overhead, served.
    const t0Solve = state.solvedAtS;

    let observedSet = false;
    let resolveTickRanFullSearchAtSet = false;
    const dt = A1_LEO_PERIOD_S / 600;
    let prevServed = true;
    for (let k = 1; k <= 600; k++) {
      const t = dt * k;
      const before = state;
      state = resolveTick(eph, contract, [sat], [NET_ACT1_GROUND], t, before);
      if (prevServed && !state.result.served) {
        observedSet = true;
        // On the set tick the full search re-ran (solvedAtS advanced to this tick) and
        // stamped the geometric loss.
        if (state.solvedAtS === t) resolveTickRanFullSearchAtSet = true;
        expect(state.result.losses.some((l) => l.cause === "set_below_horizon")).toBe(true);
        break;
      }
      prevServed = state.result.served;
    }
    expect(observedSet).toBe(true);
    expect(resolveTickRanFullSearchAtSet).toBe(true);
    // The launch full-search happened at t=0, before the set event re-search.
    expect(t0Solve).toBe(0);
  });

  it("the parked GEO produces NO horizon event — re-solves only on the launch", () => {
    // After the launch tick, every subsequent resolveTick keeps the SAME solvedAtS
    // (no full re-search) because a parked GEO's served verdict never flips.
    const sats = [geoSat(0)];
    let state = resolveTick(eph, contract, sats, [NET_ACT1_GROUND], 0, null);
    const launchSolveAtS = state.solvedAtS;
    const dt = A1_GEO_PERIOD_S / 200;
    for (let k = 1; k <= 200; k++) {
      const t = dt * k;
      state = resolveTick(eph, contract, sats, [NET_ACT1_GROUND], t, state);
      expect(state.result.served).toBe(true);
      // solvedAtS stays at the launch tick: the cached path is never invalidated by a
      // horizon event (parked GEO geometry is time-invariant).
      expect(state.solvedAtS).toBe(launchSolveAtS);
    }
    expect(launchSolveAtS).toBe(0);
  });

  it("no sat ⇒ unserved with a connectivity binding (defensive empty graph)", () => {
    const res = solve(eph, contract, [], [NET_ACT1_GROUND], 0);
    expect(res.served).toBe(false);
    expect(res.bindingConstraint).toBe("connectivity");
  });
});

describe("link budget: the gate + budget shapes (reused field.ts formulas)", () => {
  it("a near-overhead sat closes; a below-horizon target sets", () => {
    const from = surfacePointRelative(0, 0, 0);
    const normal = surfaceNormalRelative(0, 0, 0);
    // Overhead (along the surface normal, within REF) → closes.
    const overhead = [from[0] * 2, from[1] * 2, from[2] * 2] as [number, number, number];
    const okLink = evaluateLink(from, normal, overhead, 1.0, NET_REF_LINK_DISTANCE_M);
    expect(okLink.closes).toBe(true);
    expect(okLink.elevationRad).toBeCloseTo(Math.PI / 2, 9);
    // A point on the far side of the body (negative elevation) → set_below_horizon.
    const farSide = [-from[0] * 2, -from[1] * 2, -from[2] * 2] as [number, number, number];
    const setLink = evaluateLink(from, normal, farSide, 1.0, NET_REF_LINK_DISTANCE_M);
    expect(setLink.closes).toBe(false);
    expect(setLink.cause).toBe("set_below_horizon");
  });

  it("out_of_budget: an overhead sat beyond the reference distance fails the budget, not the gate", () => {
    const from = surfacePointRelative(0, 0, 0);
    const normal = surfaceNormalRelative(0, 0, 0);
    // 10× the reference distance straight up: elevation 90° (gate OK) but received = 0.01 < 1.
    const dir = normal;
    const far = [
      from[0] + dir[0] * NET_REF_LINK_DISTANCE_M * 10,
      from[1] + dir[1] * NET_REF_LINK_DISTANCE_M * 10,
      from[2] + dir[2] * NET_REF_LINK_DISTANCE_M * 10,
    ] as [number, number, number];
    const lk = evaluateLink(from, normal, far, 1.0, NET_REF_LINK_DISTANCE_M);
    expect(lk.closes).toBe(false);
    expect(lk.cause).toBe("out_of_budget");
  });

  it("satPositionRelative matches solveOrbit (earth-relative, eph-independent)", () => {
    const sat = geoSat(0);
    const p = satPositionRelative(eph, sat, 12.3);
    const q = solveOrbit(sat.orbit, 12.3);
    expect(p).toEqual(q);
  });
});
