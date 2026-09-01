/**
 * net/router — THE CISLUNAR LEG (Act 3c). The geometric claims live in cislunar.test.ts;
 * this file asserts what the GAME does with them:
 *
 *   - The farside contract is UNSERVED by any Earth network, however large or well phased.
 *     That is the act's premise; if a big enough Earth constellation could quietly close it,
 *     the act would be a tuning exercise wearing a costume.
 *   - ONE Earth–Moon L2 gateway closes it, and the path reads region → gateway → ground.
 *   - The stamped latency is the HONEST two-hop light time (~1.8 s one way), and it is
 *     strictly MORE than the 1.33 s centre-to-centre — reaching the far face costs extra.
 *   - A gateway knocked out by a fault takes the leg down with it.
 *   - Nothing about the Earth acts changes.
 */

import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { solve, type RoutableContract } from "./router";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import {
  NET_ACT1_GROUND,
  NET_ACT2_GROUND,
  NET_ACT1_REGION,
  NET_ACT3C_FARSIDE_REGION,
  NET_ACT3C_GATE_ID_STEM,
  NET_DEEP_SPACE_GROUND,
  ACT3C_LUNA_CONTRACT_ID,
} from "./endpoint";
import {
  A1_GEO_SEMI_MAJOR_M,
  A1_LEO_SEMI_MAJOR_M,
  NET_CISLUNAR_REF_LINK_DISTANCE_M,
  resolveOrbit,
} from "./world";
import { cislunarOneWayLightS, eml2StationOrbit } from "./cislunar";

const eph = loadEphemeris();
const GROUNDS = [NET_ACT1_GROUND, NET_ACT2_GROUND];

/** Sim-times spanning several toy-Earth "days" (240 s each) so the ground-station geometry
 * sweeps through every phase, not just the one that happens to work. */
const TICKS = [0, 30, 60, 90, 120, 150, 180, 210, 240, 400, 700, 1500, 3600];

function lunaContract(): RoutableContract {
  return {
    id: ACT3C_LUNA_CONTRACT_ID,
    region: NET_ACT3C_FARSIDE_REGION,
    activeAxes: new Set(["connectivity"]),
  } as RoutableContract;
}

function gateway(n = 0, t = 0): NetSat {
  return {
    id: `${NET_ACT3C_GATE_ID_STEM}-${n}`,
    orbit: eml2StationOrbit(eph, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_CISLUNAR_REF_LINK_DISTANCE_M),
  };
}

/** A conventional Earth-orbit asset with ordinary Earth-orbit terminals. */
function earthSat(n: number, aM: number, incRad: number, subLonRad: number, t = 0): NetSat {
  return {
    id: `NET-SAT-${n}`,
    orbit: resolveOrbit({ semiMajorM: aM, incRad, subLonRad }, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

describe("the cislunar leg — no Earth network can reach the farside", () => {
  it("an EMPTY roster leaves the farside dark", () => {
    for (const t of TICKS) {
      const r = solve(eph, lunaContract(), [], GROUNDS, t);
      expect(r.served).toBe(false);
      expect(r.latencyS).toBe(Infinity);
      expect(r.bindingConstraint).toBe("connectivity");
    }
  });

  it("a LARGE, well-phased Earth constellation still leaves it dark at every time", () => {
    // 24 assets across GEO + LEO, spread over every longitude and both inclinations — far
    // more than the act's economy could ever fund, and it makes no difference whatsoever.
    const fleet: NetSat[] = [];
    for (let i = 0; i < 12; i++) {
      const lon = (i * 2 * Math.PI) / 12;
      fleet.push(earthSat(i, A1_GEO_SEMI_MAJOR_M, 0, lon));
      fleet.push(earthSat(100 + i, A1_LEO_SEMI_MAJOR_M, Math.PI / 2, lon));
    }
    for (const t of TICKS) {
      const r = solve(eph, lunaContract(), fleet, GROUNDS, t);
      expect(r.served).toBe(false);
    }
  });

  it("reports a geometric cause, and never a bandwidth or latency excuse", () => {
    const r = solve(eph, lunaContract(), [earthSat(0, A1_GEO_SEMI_MAJOR_M, 0, 0)], GROUNDS, 100);
    expect(r.served).toBe(false);
    expect(r.bindingConstraint).toBe("connectivity");
    expect(r.losses.length).toBeGreaterThan(0);
    expect(r.losses[0].aId).toBe(ACT3C_LUNA_CONTRACT_ID);
  });
});

describe("the cislunar leg — ONE L2 gateway closes it", () => {
  it("serves the farside at every sampled time, on the region → gateway → ground path", () => {
    for (const t of TICKS) {
      const r = solve(eph, lunaContract(), [gateway()], GROUNDS, t);
      expect(r.served).toBe(true);
      expect(r.path).not.toBeNull();
      expect(r.path?.length).toBe(3);
      expect(r.path?.[0]).toBe(ACT3C_LUNA_CONTRACT_ID);
      expect(r.path?.[1]).toBe(`${NET_ACT3C_GATE_ID_STEM}-0`);
      expect(NET_DEEP_SPACE_GROUND.map((g) => g.id)).toContain(r.path?.[2]);
      expect(r.bindingConstraint).toBeNull();
    }
  });

  it("still closes with the gateway ALONE — the Earth fleet is not secretly required", () => {
    for (const t of TICKS) {
      expect(solve(eph, lunaContract(), [gateway()], [NET_ACT1_GROUND], t).served).toBe(true);
    }
  });

  it("holds CONTINUOUSLY across several toy-Earth days — no diurnal dropout", () => {
    // The point of a three-station deep-space segment: sample every 2 s across five full
    // 240 s rotations and find not one gap. A single station would be dark for half of each.
    let gaps = 0;
    for (let t = 0; t <= 1200; t += 2) {
      if (!solve(eph, lunaContract(), [gateway()], GROUNDS, t).served) gaps++;
    }
    expect(gaps).toBe(0);
  });

  it("the landing site HANDS OFF between the three dishes as the Earth turns", () => {
    // Continuity is not one dish getting lucky — it is a rotating handover. All three must
    // take a turn across a day, or the 120° spacing is not doing the work claimed for it.
    const used = new Set<string>();
    for (let t = 0; t <= 240; t += 2) {
      const r = solve(eph, lunaContract(), [gateway()], GROUNDS, t);
      if (r.served && r.path) used.add(r.path[2]);
    }
    expect(used.size).toBe(3);
  });

  it("a FAULTED gateway takes the farside down — the relay is a real single point", () => {
    const faults = new Set([`${NET_ACT3C_GATE_ID_STEM}-0`]);
    for (const t of TICKS) {
      const r = solve(eph, lunaContract(), [gateway()], GROUNDS, t, faults);
      expect(r.served).toBe(false);
      expect(r.bindingConstraint).toBe("connectivity");
    }
  });

  it("an Earth fleet ALONGSIDE the gateway does not change the chosen path", () => {
    const fleet = [gateway(), earthSat(1, A1_GEO_SEMI_MAJOR_M, 0, 0), earthSat(2, A1_LEO_SEMI_MAJOR_M, 1, 2)];
    for (const t of TICKS) {
      const r = solve(eph, lunaContract(), fleet, GROUNDS, t);
      expect(r.served).toBe(true);
      expect(r.path?.[1]).toBe(`${NET_ACT3C_GATE_ID_STEM}-0`);
    }
  });
});

describe("the cislunar leg — the light delay is honest", () => {
  it("stamps ~1.8 s one way, and MORE than the centre-to-centre 1.33 s", () => {
    for (const t of TICKS) {
      const r = solve(eph, lunaContract(), [gateway()], GROUNDS, t);
      expect(r.served).toBe(true);
      // Going around the far side of the Moon is strictly longer than the direct
      // Earth↔Moon centre separation — the extra is the L2 standoff, and it is REAL.
      expect(r.latencyS).toBeGreaterThan(cislunarOneWayLightS(eph, t));
      expect(r.latencyS).toBeGreaterThan(1.5);
      expect(r.latencyS).toBeLessThan(2.3);
    }
  });

  it("is 400× the Earth-act latency scale — the on-ramp gap the GDD asks for", () => {
    const earthContract = {
      id: NET_ACT1_REGION.id,
      region: NET_ACT1_REGION,
      activeAxes: new Set(["connectivity"]),
    } as RoutableContract;
    const earth = solve(eph, earthContract, [earthSat(0, A1_GEO_SEMI_MAJOR_M, 0, 0)], GROUNDS, 0);
    const luna = solve(eph, lunaContract(), [gateway()], GROUNDS, 0);
    expect(earth.served).toBe(true);
    expect(luna.served).toBe(true);
    // Earth acts run in single-digit milliseconds; cislunar is seconds. Two orders of
    // magnitude of headroom between them, and still four orders short of Mars.
    expect(earth.latencyS).toBeLessThan(0.01);
    expect(luna.latencyS / earth.latencyS).toBeGreaterThan(100);
  });
});

describe("the cislunar leg — the Earth acts are untouched", () => {
  it("an Earth region still solves exactly as before, with a GEO overhead", () => {
    const earthContract = {
      id: NET_ACT1_REGION.id,
      region: NET_ACT1_REGION,
      activeAxes: new Set(["connectivity"]),
    } as RoutableContract;
    const r = solve(eph, earthContract, [earthSat(0, A1_GEO_SEMI_MAJOR_M, 0, 0)], GROUNDS, 0);
    expect(r.served).toBe(true);
    expect(r.path?.[0]).toBe(NET_ACT1_REGION.id);
    expect(r.latencyS).toBeLessThan(0.01);
  });

  it("a gateway in the roster does NOT let it serve an Earth region it should not", () => {
    // The gateway is 460,000 km away; it must not become a magic Earth asset just because
    // its terminals are big. The Earth region must still be unserved with only a gateway.
    const earthContract = {
      id: NET_ACT1_REGION.id,
      region: NET_ACT1_REGION,
      activeAxes: new Set(["connectivity"]),
    } as RoutableContract;
    const r = solve(eph, earthContract, [gateway()], GROUNDS, 0);
    expect(r.served).toBe(false);
  });
});
