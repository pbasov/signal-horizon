import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import {
  NET_ACT1_REGION,
  NET_ACT1_GROUND,
} from "./endpoint";
import { GEO_PARK, LEO_SWEEP, resolveOrbit } from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M, NET_LINK_CAPACITY_UNITS } from "./link-budget";
import {
  solve,
  topologyKey,
  resolveTick,
  NET_ROUTER_DEFAULT_PREFER,
  type RoutableContract,
} from "./router";
import type { PreferWeights } from "./contract";

/**
 * net/ C1a — THE REACTIVE COST-BLEND + the latency & bandwidth axes (design §7.2/§4.4, the
 * four ADDITIVE interface extensions E1–E4). Pins exactly what C1a builds:
 *
 *   - the MIN-COST (sat, ground) pick under cost = w_lat·latency_term + w_bw·congestion_term
 *     + w_stab·instability_term (w_stab DORMANT, contributes 0);
 *   - the LATENCY axis: a path whose latencyS > slaLatencyS does NOT satisfy a latency-active
 *     contract (bindingConstraint = "latency"); the GEO ceiling felt, a short LEO passes;
 *   - the BANDWIDTH axis (P4, §4.3): reads the contract's OWN slaBandwidth (the committed floor) —
 *     a bandwidth-active contract whose PROPORTIONAL served share over an OVER-SUBSCRIBED shared link
 *     (sharedLoad > capacity ⇒ share = capacity·ownLoad/sharedLoad) falls below its slaBandwidth
 *     breaches (bindingConstraint = "bandwidth"); a contract alone on its bridge gets its full offered
 *     load (NOT a flat sharedLoad ≥ capacity cliff);
 *   - congestion RAISES the congestion_term so a `prefer.bw` contract routes AROUND a loaded
 *     sat onto a parallel path;
 *   - BACK-COMPAT: with `prefer` defaults + no `loadBySat`, the pick + verdict are byte-identical
 *     to the legacy max-margin router (the A1/A2 tests + the net golden carry that pin).
 *
 * The net frame is earth-relative; the toy single-body router never dereferences eph.
 */

const eph = Ephemeris.build({});
const DEG = Math.PI / 180;

/** The Act-1 connectivity-only contract over the equatorial region (no prefer/SLA ⇒ defaults). */
function contract(opts?: {
  axes?: string[];
  prefer?: PreferWeights;
  slaLatencyS?: number;
  slaBandwidth?: number;
  offeredLoad?: number;
}): RoutableContract {
  return {
    id: "C",
    region: NET_ACT1_REGION,
    activeAxes: new Set((opts?.axes ?? ["connectivity"]) as never),
    prefer: opts?.prefer,
    slaLatencyS: opts?.slaLatencyS,
    slaBandwidth: opts?.slaBandwidth,
    offeredLoad: opts?.offeredLoad,
  };
}

/** A parked GEO over the equatorial region (the long path; latency ≈ 3.57 ms). */
function geoSat(t = 0): NetSat {
  return { id: "SAT-GEO", orbit: resolveOrbit(GEO_PARK, t), bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) };
}

/** An EQUATORIAL LEO (inc 0) over the region — the short path (latency ≈ 2.07 ms). The
 * LEO_SWEEP preset is POLAR (inc 90, used for the high-lat REGION-1); here we build an
 * equatorial one at the LEO semi-major axis so it bridges the equatorial REGION-0. */
function equatorialLeo(id: string, subLonDeg: number): NetSat {
  return {
    id,
    orbit: resolveOrbit({ semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: subLonDeg * DEG }, 0),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

describe("C1a cost-blend — the MIN-COST pick reduces to the legacy max-margin pick under defaults", () => {
  it("with default prefer + no loadBySat, the min-latency (= max-margin) sat wins: the short LEO over the long GEO", () => {
    const sats = [geoSat(), equatorialLeo("SAT-LEO", 0)];
    const r = solve(eph, contract(), sats, [NET_ACT1_GROUND], 0);
    expect(r.served).toBe(true);
    // The LEO path is shorter (≈2.07 ms) than the GEO path (≈3.57 ms) ⇒ lower latency ⇒ both the
    // min-cost (latency-only blend) AND the legacy max-margin pick choose the LEO.
    expect(r.path?.[1]).toBe("SAT-LEO");
  });

  it("the default prefer is lat-only with w_stab DORMANT (the §7.2 structure; M1 LOCKED)", () => {
    expect(NET_ROUTER_DEFAULT_PREFER).toEqual({ lat: 1.0, bw: 0.0, stab: 0.0 });
  });

  it("a non-default prefer / a non-empty loadBySat does NOT change the pick when it shouldn't: bw=0 ⇒ congestion ignored, min-latency still wins", () => {
    const sats = [equatorialLeo("SAT-A", 0), equatorialLeo("SAT-B", 3)];
    // Heavily load SAT-A, but prefer.bw = 0 ⇒ the congestion term has zero weight ⇒ the pick is
    // still the min-latency tie-break winner (SAT-A), proving load alone never reroutes — only an
    // explicit prefer.bw does (the §7.3 "by exception" tune).
    const load = new Map([["SAT-A", 99]]);
    const r = solve(eph, contract({ prefer: { lat: 1, bw: 0, stab: 0 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(r.path?.[1]).toBe("SAT-A");
  });
});

describe("C1a cost-blend — congestion routes AROUND a loaded sat onto a parallel path", () => {
  it("a prefer.bw contract avoids an over-capacity sat when a parallel path exists", () => {
    const sats = [equatorialLeo("SAT-A", 0), equatorialLeo("SAT-B", 3)];
    // SAT-A is the default (min-latency) pick. Load it over capacity and bias toward bandwidth ⇒
    // the congestion term on SAT-A dominates ⇒ the blend reroutes onto the un-loaded parallel SAT-B.
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 2]]);
    const r = solve(eph, contract({ prefer: { lat: 1, bw: 100, stab: 0 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(r.served).toBe(true);
    expect(r.path?.[1]).toBe("SAT-B"); // routed around the congested SAT-A.
  });

  it("the SAME congested sat is still chosen when there is NO parallel path (the blend can't conjure capacity)", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 2]]);
    // No bandwidth axis active ⇒ still served on the only path (congestion biases the pick, but a
    // single path is the only choice; the bandwidth BITE is a separate axis, tested below).
    const r = solve(eph, contract({ prefer: { lat: 1, bw: 100, stab: 0 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(r.served).toBe(true);
    expect(r.path?.[1]).toBe("SAT-A");
  });
});

describe("C1a — the LATENCY axis (the GEO ceiling, felt; activated one at a time)", () => {
  it("a latency-active contract over a too-long GEO path breaches with bindingConstraint='latency'", () => {
    const sats = [geoSat()];
    // GEO path ≈ 3.57 ms; an SLA of 3 ms can't be met by GEO.
    const r = solve(eph, contract({ axes: ["connectivity", "latency"], slaLatencyS: 0.003 }), sats, [NET_ACT1_GROUND], 0);
    expect(r.served).toBe(false);
    expect(r.bindingConstraint).toBe("latency");
    // The path is still reported (the bridge exists; it's the latency that fails) + a loss is stamped.
    expect(r.path).not.toBeNull();
    expect(r.latencyS).toBeGreaterThan(0.003);
    expect(r.losses.length).toBeGreaterThan(0);
  });

  it("the SAME contract over a short LEO path passes the latency SLA (a shorter route cuts it)", () => {
    const sats = [equatorialLeo("SAT-LEO", 0)];
    const r = solve(eph, contract({ axes: ["connectivity", "latency"], slaLatencyS: 0.003 }), sats, [NET_ACT1_GROUND], 0);
    expect(r.served).toBe(true);
    expect(r.bindingConstraint).toBeNull();
    expect(r.latencyS).toBeLessThan(0.003);
  });

  it("with the latency axis ABSENT, a too-long path still serves (slaLatencyS default Infinity ⇒ no ceiling)", () => {
    const sats = [geoSat()];
    // No "latency" in activeAxes, no slaLatencyS ⇒ Act-1/2 behaviour: connectivity only.
    const r = solve(eph, contract({ axes: ["connectivity"] }), sats, [NET_ACT1_GROUND], 0);
    expect(r.served).toBe(true);
    expect(r.bindingConstraint).toBeNull();
  });
});

describe("C1a/P4 — the BANDWIDTH axis reads the contract's OWN slaBandwidth (§4.3, not a flat cliff)", () => {
  it("a bandwidth-active contract whose served share over an OVER-SUBSCRIBED shared link falls below its slaBandwidth breaches (bindingConstraint='bandwidth')", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    // The shared peak is 2× capacity (a coincident spike from two ~equal contracts); this contract's
    // own offered load is one half (= capacity), so its PROPORTIONAL served share is
    // capacity·ownLoad/sharedLoad = capacity·cap/(2·cap) = cap/2 = 0.75 — BELOW its 1.0 committed floor.
    const sharedLoad = NET_LINK_CAPACITY_UNITS * 2;
    const load = new Map([["SAT-A", sharedLoad]]);
    const r = solve(
      eph,
      contract({ axes: ["connectivity", "bandwidth"], slaBandwidth: 1.0, offeredLoad: NET_LINK_CAPACITY_UNITS }),
      sats,
      [NET_ACT1_GROUND],
      0,
      undefined,
      load,
    );
    expect(r.served).toBe(false);
    expect(r.bindingConstraint).toBe("bandwidth");
    expect(r.path).not.toBeNull(); // the bridge exists; the over-subscribed share is what fails the floor.
    expect(r.losses.length).toBeGreaterThan(0);
  });

  it("UNDER capacity the same contract is served — the shared link honors its full offered load (≥ its floor)", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 0.5]]); // shared peak under capacity.
    const r = solve(
      eph,
      contract({ axes: ["connectivity", "bandwidth"], slaBandwidth: 1.0, offeredLoad: NET_LINK_CAPACITY_UNITS * 0.5 }),
      sats,
      [NET_ACT1_GROUND],
      0,
      undefined,
      load,
    );
    expect(r.served).toBe(true);
    expect(r.bindingConstraint).toBeNull();
  });

  it("a contract ALONE on its bridge (sole loader) is served even when its load exceeds capacity — served bw = its full offered load ≥ its floor", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    // The bursty load peaks above capacity but the contract is the SOLE loader, so its served
    // bandwidth = its full offered load (the link honors it; no one else is contending) ≥ its floor.
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 1.2]]);
    const r = solve(
      eph,
      contract({ axes: ["connectivity", "bandwidth"], slaBandwidth: 0.6, offeredLoad: NET_LINK_CAPACITY_UNITS * 1.2 }),
      sats,
      [NET_ACT1_GROUND],
      0,
      undefined,
      load,
    );
    expect(r.served).toBe(true);
    expect(r.bindingConstraint).toBeNull();
  });

  it("with the bandwidth axis ABSENT, an over-capacity load does NOT breach (the axis is un-enforced)", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 10]]);
    const r = solve(
      eph,
      contract({ axes: ["connectivity"], slaBandwidth: 1.0, offeredLoad: 5 }),
      sats,
      [NET_ACT1_GROUND],
      0,
      undefined,
      load,
    );
    expect(r.served).toBe(true);
    expect(r.bindingConstraint).toBeNull();
  });

  it("a bandwidth-active contract with NO slaBandwidth floor (0) never breaches on the bandwidth axis (no floor binds)", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 5]]);
    const r = solve(eph, contract({ axes: ["connectivity", "bandwidth"] }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(r.served).toBe(true); // slaBandwidth absent ⇒ 0 ⇒ the axis never binds.
    expect(r.bindingConstraint).toBeNull();
  });
});

describe("C1a — the w_stab instability term is DORMANT (contributes exactly 0)", () => {
  it("varying prefer.stab with bw=0 never changes the pick, the served verdict, or the latency", () => {
    const sats = [equatorialLeo("SAT-A", 0), equatorialLeo("SAT-B", 3)];
    const load = new Map([["SAT-A", 99]]);
    const r0 = solve(eph, contract({ prefer: { lat: 1, bw: 0, stab: 0 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    const r9 = solve(eph, contract({ prefer: { lat: 1, bw: 0, stab: 9999 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(r9.path?.[1]).toBe(r0.path?.[1]);
    expect(r9.served).toBe(r0.served);
    expect(r9.latencyS).toBe(r0.latencyS);
  });

  it("even with a non-zero bw weight, stab adds nothing: w_stab·instability_term = 0 regardless of stab", () => {
    const sats = [equatorialLeo("SAT-A", 0), equatorialLeo("SAT-B", 3)];
    const load = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 2]]);
    const rNoStab = solve(eph, contract({ prefer: { lat: 1, bw: 100, stab: 0 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    const rBigStab = solve(eph, contract({ prefer: { lat: 1, bw: 100, stab: 1e9 } }), sats, [NET_ACT1_GROUND], 0, undefined, load);
    expect(rBigStab.path?.[1]).toBe(rNoStab.path?.[1]);
    expect(rBigStab.latencyS).toBe(rNoStab.latencyS);
  });
});

describe("C1a — E2/E3 are signature-stable (back-compat by no-op defaults)", () => {
  it("solve with no loadBySat is byte-identical to solve with an EMPTY loadBySat (congestion_term = 0)", () => {
    const sats = [geoSat(), equatorialLeo("SAT-LEO", 0)];
    const a = solve(eph, contract(), sats, [NET_ACT1_GROUND], 0);
    const b = solve(eph, contract(), sats, [NET_ACT1_GROUND], 0, undefined, new Map());
    expect(b.served).toBe(a.served);
    expect(b.path).toEqual(a.path);
    expect(b.latencyS).toBe(a.latencyS);
    expect(b.bindingConstraint).toBe(a.bindingConstraint);
  });

  it("E3: topologyKey folds the congestion epoch; epoch 0 (absent) is BYTE-IDENTICAL to the legacy 3-field key + 0; a bump changes it", () => {
    const sats = [geoSat()];
    const c = contract();
    const legacyDefault = topologyKey(c, sats); // congestionEpoch defaults to 0.
    const explicit0 = topologyKey(c, sats, undefined, 0);
    expect(explicit0).toBe(legacyDefault);
    // The legacy 3-field shape with a trailing |0 — the fingerprint a pre-Act-3 key produces.
    expect(legacyDefault).toBe(`${c.id}|${sats.map((s) => s.id).sort().join(",")}||0`);
    // A congestion-epoch bump changes the fingerprint ⇒ forces a re-solve (the HIGH-2 fix).
    expect(topologyKey(c, sats, undefined, 1)).not.toBe(legacyDefault);
  });

  it("E3: resolveTick re-solves when the congestion epoch bumps (a rising load refreshes the cached verdict)", () => {
    const sats = [equatorialLeo("SAT-A", 0)];
    // Accept on the bandwidth axis with a committed floor (slaBandwidth 1.0); the contract's own
    // offered load is one half of the heavy shared peak below (= capacity). Epoch 0, comfortable
    // shared load (under capacity) ⇒ served (its full offered share honored ≥ its floor).
    const c = contract({ axes: ["connectivity", "bandwidth"], slaBandwidth: 1.0, offeredLoad: NET_LINK_CAPACITY_UNITS });
    const lightLoad = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 0.5]]);
    const s0 = resolveTick(eph, c, sats, [NET_ACT1_GROUND], 0, null, undefined, lightLoad, 0);
    expect(s0.result.served).toBe(true);
    // The shared peak rises to 2× capacity (a coincident spike) AND the session bumps the epoch ⇒
    // topoKey flips ⇒ full re-solve through the cache ⇒ this contract's proportional share
    // (capacity·cap/(2·cap) = 0.75) falls below its 1.0 floor ⇒ the bandwidth bite refreshes the
    // cached verdict (no stale "served").
    const heavyLoad = new Map([["SAT-A", NET_LINK_CAPACITY_UNITS * 2]]);
    const s1 = resolveTick(eph, c, sats, [NET_ACT1_GROUND], 1 / 60, s0, undefined, heavyLoad, 1);
    expect(s1.result.served).toBe(false);
    expect(s1.result.bindingConstraint).toBe("bandwidth");
    // And a STATIC load (no epoch bump) keeps the cached path — does NOT re-solve to a new verdict.
    const s2 = resolveTick(eph, c, sats, [NET_ACT1_GROUND], 2 / 60, s1, undefined, heavyLoad, 1);
    expect(s2.topoKey).toBe(s1.topoKey); // same fingerprint ⇒ cache preserved.
  });
});
