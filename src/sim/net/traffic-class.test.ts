import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NET_ACT1_REGION, NET_ACT1_GROUND } from "./endpoint";
import { LEO_SWEEP, resolveOrbit } from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M, NET_LINK_CAPACITY_UNITS } from "./link-budget";
import { solve, type RoutableContract } from "./router";
import {
  PREFER_FOR_CLASS,
  preferForClass,
  offerNetContract,
  type TrafficClass,
} from "./contract";

/**
 * net/ P3 — THE TRAFFIC CLASS (§7.2 — "demand-shape produces topology-shape"). Pins that:
 *   - a contract's trafficClass SETS its default prefer (PREFER_FOR_CLASS), and offerNetContract
 *     applies it;
 *   - a latency-class contract and a bandwidth-class contract, over the SAME two equatorial sats
 *     with one of them CONGESTED, route DIFFERENTLY — the latency contract clings to the short
 *     (congested) sat, the bandwidth contract leaves it for the parallel less-loaded one;
 *   - the availability class leans OFF latency (low w_lat) with w_stab DORMANT (its routing is
 *     unaffected by stab — the M1 lock).
 */

const eph = Ephemeris.build({});
const DEG = Math.PI / 180;

function equatorialLeo(id: string, subLonDeg: number): NetSat {
  return {
    id,
    orbit: resolveOrbit({ semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: subLonDeg * DEG }, 0),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

function classed(id: string, trafficClass: TrafficClass): RoutableContract {
  const c = offerNetContract(id, NET_ACT1_REGION, { trafficClass });
  return { id: c.id, region: c.region, activeAxes: c.activeAxes, prefer: c.prefer, slaLatencyS: c.slaLatencyS };
}

describe("P3 traffic class — the class sets the default prefer (§7.2)", () => {
  it("PREFER_FOR_CLASS: latency is lat-only, bandwidth keeps w_lat=1 + adds w_bw, availability leans off latency", () => {
    expect(PREFER_FOR_CLASS.latency).toEqual({ lat: 1.0, bw: 0.0, stab: 0.0 });
    expect(PREFER_FOR_CLASS.bandwidth.lat).toBe(1.0);
    expect(PREFER_FOR_CLASS.bandwidth.bw).toBeGreaterThan(0); // w_bw BITES under congestion.
    expect(PREFER_FOR_CLASS.availability.lat).toBeLessThan(1.0); // leans OFF latency.
    expect(PREFER_FOR_CLASS.availability.stab).toBeGreaterThan(0); // w_stab set (DORMANT in M1).
  });

  it("offerNetContract applies the class default; preferForClass returns a fresh copy (no aliasing)", () => {
    const c = offerNetContract("X", NET_ACT1_REGION, { trafficClass: "bandwidth" });
    expect(c.trafficClass).toBe("bandwidth");
    expect(c.prefer).toEqual(PREFER_FOR_CLASS.bandwidth);
    const a = preferForClass("latency");
    a.lat = 999; // mutate the copy
    expect(PREFER_FOR_CLASS.latency.lat).toBe(1.0); // the table is untouched.
  });

  it("an explicit prefer opt still wins over the class default (the §7.3 hand override)", () => {
    const c = offerNetContract("X", NET_ACT1_REGION, { trafficClass: "bandwidth", prefer: { lat: 1, bw: 0, stab: 0 } });
    expect(c.trafficClass).toBe("bandwidth");
    expect(c.prefer).toEqual({ lat: 1, bw: 0, stab: 0 }); // the override, not the class default.
  });
});

describe("P3 traffic class — demand-shape produces topology-shape (the §7.2 thesis, LIVE)", () => {
  it("a LATENCY contract and a BANDWIDTH contract route DIFFERENTLY over the SAME two equatorial sats when one is congested", () => {
    // Two parallel equatorial LEOs, both short (latency ≈ 2 ms). SAT-A is the min-latency tie-break
    // winner; load it OVER capacity. The shared aggregate carries A's congestion.
    const sats = [equatorialLeo("SAT-A", 0), equatorialLeo("SAT-B", 3)];
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 2]]);
    // The LATENCY-class contract ignores congestion (w_bw = 0) ⇒ clings to the min-latency SAT-A.
    const lat = solve(eph, classed("LAT", "latency"), sats, [NET_ACT1_GROUND], 0, undefined, load);
    // The BANDWIDTH-class contract weighs the congestion term ⇒ leaves the congested SAT-A for the
    // parallel less-loaded SAT-B (same physical sats, DIFFERENT path — demand-shape → topology-shape).
    const bw = solve(eph, classed("BW", "bandwidth"), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(lat.path?.[1]).toBe("SAT-A");
    expect(bw.path?.[1]).toBe("SAT-B");
    expect(lat.path?.[1]).not.toBe(bw.path?.[1]); // the SAME two sats, routed DIFFERENTLY.
  });

  it("the availability class's w_stab is DORMANT: varying it never changes the pick (M1 LOCKED)", () => {
    const sats = [equatorialLeo("SAT-A", 0), equatorialLeo("SAT-B", 3)];
    const load = new Map([["SAT-A", 99]]);
    const c0 = classed("AV", "availability");
    const c9: RoutableContract = { ...c0, prefer: { ...preferForClass("availability"), stab: 9999 } };
    const r0 = solve(eph, c0, sats, [NET_ACT1_GROUND], 0, undefined, load);
    const r9 = solve(eph, c9, sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(r9.path?.[1]).toBe(r0.path?.[1]); // stab contributes 0 — the pick is unchanged.
    expect(r9.latencyS).toBe(r0.latencyS);
  });
});
