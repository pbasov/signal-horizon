import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NetSession, NET_NEAR_BREACH_GRACE_FRACTION } from "./session";
import { applyNetAction } from "./apply-action";
import {
  netLaunch,
  netAccept,
  netSetPrefer,
  type SimAction,
} from "../action";
import { GEO_PARK, LEO_SWEEP } from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M, NET_LINK_CAPACITY_UNITS } from "./link-budget";
import {
  ACT1_CONTRACT_ID,
  ACT2_CONTRACT_ID,
  ACT3A_CONTRACT_ID,
} from "./scenario";
import { resolveOrbit } from "./world";
import { NET_ACT1_GROUND, NET_ACT1_REGION } from "./endpoint";
import {
  escalateLoad,
  ESCALATION_LOAD_CEILING,
  ESCALATION_RATE_PER_S,
  ESCALATION_BANDWIDTH_AXIS_THRESHOLD,
} from "./contract";
import { solve, type RoutableContract } from "./router";
import { BREACH_GRACE_SECONDS } from "../m2/contracts";

/**
 * net/ C1b — THE ESCALATION LAW + OVERSUBSCRIPTION + the 3a re-tame (design §3a / C1.1-C1.6).
 * "Your own success congests it": a well-served region's offeredLoad RISES, shared links ride
 * near capacity, a peak tips a comfortable contract toward breach (binary — the HIGH-1 fix), the
 * player re-engineers (a parallel path + a per-contract net_set_prefer override by exception) and
 * re-tames. The latency axis (the GEO ceiling) arrives by an authored contract; the bandwidth
 * axis by escalation crossing capacity — ONE AT A TIME (§4.4).
 */

const DT = 1 / 60;
const DEG = Math.PI / 180;
const eph = Ephemeris.build({});

// ── the escalation growth law (pure, DT-invariant, bounded) ──────────────────────

describe("C1b — the escalation growth law (closed-form logistic, DT-invariant, bounded)", () => {
  it("grows offeredLoad toward the ceiling under sustained service", () => {
    let load = 1.0;
    for (let i = 0; i < 100000; i++) load = escalateLoad(load, 1.0);
    expect(load).toBeGreaterThan(1.0);
    expect(load).toBeLessThanOrEqual(ESCALATION_LOAD_CEILING);
    expect(load).toBeCloseTo(ESCALATION_LOAD_CEILING, 6); // asymptotes to the cap.
  });

  it("is DT-INVARIANT: fine (dt=1) vs coarse (dt=10) steps to the same sim-time converge", () => {
    let fine = 1.0;
    for (let i = 0; i < 1000; i++) fine = escalateLoad(fine, 1.0);
    let coarse = 1.0;
    for (let i = 0; i < 100; i++) coarse = escalateLoad(coarse, 10.0);
    expect(coarse).toBeCloseTo(fine, 9);
    // A single big step equals composing two halves (the closed-form semigroup).
    const oneStep = escalateLoad(1.0, 600.0);
    let twoSteps = escalateLoad(1.0, 300.0);
    twoSteps = escalateLoad(twoSteps, 300.0);
    expect(twoSteps).toBeCloseTo(oneStep, 9);
  });

  it("never overshoots the ceiling (a single clamp — no shock-compounding) and is a no-op at/above it", () => {
    expect(escalateLoad(ESCALATION_LOAD_CEILING, 1e9)).toBe(ESCALATION_LOAD_CEILING);
    expect(escalateLoad(ESCALATION_LOAD_CEILING + 5, 1.0)).toBe(ESCALATION_LOAD_CEILING);
    expect(escalateLoad(1.0, 1e12)).toBeLessThanOrEqual(ESCALATION_LOAD_CEILING);
    expect(ESCALATION_RATE_PER_S).toBeGreaterThan(0);
    expect(ESCALATION_BANDWIDTH_AXIS_THRESHOLD).toBeLessThan(ESCALATION_LOAD_CEILING);
  });

  it("does NOT escalate a non-positive load or a non-positive dt", () => {
    expect(escalateLoad(0, 100)).toBe(0);
    expect(escalateLoad(1.0, 0)).toBe(1.0);
    expect(escalateLoad(1.0, -5)).toBe(1.0);
  });
});

// ── the driven arc (the tame → outgrow → re-tame cycle) — a FIXED action log ──────

/** A driver that steps a session tick-by-tick, applying actions scheduled by tick (the SAME
 * step-then-post-drain order main.ts + the replay use). Returns the session. */
function drive(maxTick: number, schedule: Map<number, SimAction[]>): NetSession {
  const s = new NetSession();
  for (let tick = 0; tick <= maxTick; tick++) {
    const t = tick * DT;
    s.step(eph, t, DT);
    const list = schedule.get(tick);
    if (list !== undefined) for (const a of list) applyNetAction(eph, s, a, DT);
  }
  return s;
}

function add(m: Map<number, SimAction[]>, tick: number, a: SimAction): void {
  const l = m.get(tick) ?? [];
  l.push(a);
  m.set(tick, l);
}

/** Launch one EQUATORIAL LEO (inc 0) at sub-longitude `subLonDeg` — the short equatorial path the
 * latency corridor + the parallel-path relief need (LEO_SWEEP is polar; this is its equatorial
 * sibling, launched via net_launch with incRad 0). */
function eqLeoLaunch(subLonDeg: number, tick: number): SimAction {
  return netLaunch({ presetId: "EQ_LEO", semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: subLonDeg * DEG, count: 1 }, tick);
}

// The FIXED act3a arc ticks (matching the net-replay golden): the cursor reaches act3a at
// ~tick 19401, the player launches an equatorial LEO + accepts the corridor, escalation strains
// the shared link, and at the fixed RELIEF tick the player adds a parallel LEO + re-prioritises
// the latency-tolerant trunk (REGION-0) to be bandwidth-share-aware so it YIELDS the short path.
const TICK_EQ_LEO_1 = 19461;
const TICK_ACCEPT_R2 = 19521;
const TICK_RELIEF = 25800;

/** The act1 → act2 → act3a arc through the re-tame (the SAME log the net-replay golden pins). */
function act3aLog(m: Map<number, SimAction[]>): void {
  // Act 1: GEO over REGION-0.
  add(m, 600, netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, 600));
  add(m, 1200, netAccept(ACT1_CONTRACT_ID, 1200));
  // Act 2: polar N=4 over REGION-1.
  add(m, 1300, netLaunch({ presetId: LEO_SWEEP.id, semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: LEO_SWEEP.subLonRad, count: 4, phaseSpreadRad: (2 * Math.PI) / 4 }, 1300));
  add(m, 1400, netAccept(ACT2_CONTRACT_ID, 1400));
  // Act 3a: the short equatorial path for the latency corridor + accept REGION-2 (the corridor).
  add(m, TICK_EQ_LEO_1, eqLeoLaunch(1.5, TICK_EQ_LEO_1));
  add(m, TICK_ACCEPT_R2, netAccept(ACT3A_CONTRACT_ID, TICK_ACCEPT_R2));
  // The relief BY EXCEPTION (after escalation tips the shared link near-breach): a PARALLEL
  // equatorial LEO + a net_set_prefer on the latency-tolerant trunk REGION-0 (bw-share-aware) so
  // it yields the short corridor path to the latency-critical REGION-2 — splitting the shared sat.
  add(m, TICK_RELIEF, eqLeoLaunch(-1.5, TICK_RELIEF));
  add(m, TICK_RELIEF, netSetPrefer(ACT1_CONTRACT_ID, 1, 50, 0, TICK_RELIEF));
}

describe("C1b — escalation tips a shared link to breach (binary), then a parallel path + prefer re-tames", () => {
  it("the FULL tame → outgrow → re-tame cycle fires the act3a gate deterministically", () => {
    const m = new Map<number, SimAction[]>();
    act3aLog(m);
    // Run a touch past the relief so the re-tame latches + the gate fires.
    const s = drive(27000, m);

    // Escalation engaged; the corridor was offered + accepted.
    expect(s.escalationEnabled).toBe(true);
    const r2 = s.contractById(ACT3A_CONTRACT_ID)!;
    expect(r2).toBeDefined();
    expect(["active", "completed"]).toContain(r2.state);
    // Escalation GREW the loads above the initial 1.0 and flipped the bandwidth axis on (the §4.4
    // escalation-triggered mask flip — NOT present at emit; one at a time after the latency axis).
    expect(r2.offeredLoad).toBeGreaterThan(1.0);
    expect(r2.activeAxes.has("latency")).toBe(true); // the authored latency axis.
    expect(r2.activeAxes.has("bandwidth")).toBe(true); // the escalation-triggered bandwidth axis.
    // THE 3a GATE FIRED: a previously-served contract dipped near-breach under risen load, then
    // returned to fully SERVED (the re-tame) ⇒ the cursor advanced past act3a (the act3b fence).
    expect(s.escalationReTamed()).toBe(true);
    expect(s.cursor).toBeGreaterThanOrEqual(3);
    // After the relief, the shared link is SPLIT: the corridor REGION-2 rides its own short path
    // under capacity (re-tamed).
    expect(r2.lastServedFraction).toBe(1.0);
    const r2Sat = s.lastSolveFor(r2.id)!.path![1];
    expect(s.loadOnSat(r2Sat)).toBeLessThan(NET_LINK_CAPACITY_UNITS);
  }, 60000);

  it("the act3a gate does NOT fire before the near-breach dip + re-tame (state-gated, not clock-timed)", () => {
    // The SAME log but stop BEFORE the relief lands: the cursor must still be on act3a (cursor 2) —
    // the cycle is not yet demonstrated. (Escalation is on + the bandwidth axis bit, but no re-tame.)
    const m = new Map<number, SimAction[]>();
    act3aLog(m);
    const s = drive(TICK_RELIEF - 1, m);
    expect(s.cursor).toBe(2); // still on act3a.
    expect(s.escalationReTamed()).toBe(false);
    // The dip was real: the corridor accrued breach past the near-breach threshold under congestion.
    const r2 = s.contractById(ACT3A_CONTRACT_ID)!;
    expect(r2.breachSecondsAccum).toBeGreaterThanOrEqual(
      NET_NEAR_BREACH_GRACE_FRACTION * BREACH_GRACE_SECONDS,
    );
  }, 60000);
});

// ── escalation only where served, only when on; congestion forces a re-solve ──────

describe("C1b — escalation grows ONLY a well-served contract, ONLY when gated on", () => {
  it("with escalation OFF (Act 1/2), offeredLoad never changes (golden-safe dormancy)", () => {
    // Drive only the Act-1 opening (cursor stays before act3a so escalation is never enabled).
    const m = new Map<number, SimAction[]>();
    add(m, 600, netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, 600));
    add(m, 1200, netAccept(ACT1_CONTRACT_ID, 1200));
    const s = drive(3000, m);
    expect(s.escalationEnabled).toBe(false);
    const r0 = s.contractById(ACT1_CONTRACT_ID)!;
    expect(r0.lastServedFraction).toBe(1.0); // served well…
    expect(r0.offeredLoad).toBe(1.0); // …but the load NEVER grew (escalation dormant).
  });

  it("a contract's load FREEZES while it is breaching (served-fraction 0) — demand grows only where you serve well", () => {
    // The full arc, sampled just AFTER the bandwidth bite drives the corridor to a sustained breach
    // but BEFORE the relief: while the corridor is unserved (lastServedFraction 0), the escalation
    // law does NOT grow its offeredLoad (the §3a "where you serve well" rule). We assert the load is
    // PINNED at the ceiling-or-below value it had reached when it was last served — it does not
    // climb further while breaching.
    const m = new Map<number, SimAction[]>();
    act3aLog(m);
    const early = drive(24000, m); // mid-breach (after the bite, before the relief).
    const r2early = early.contractById(ACT3A_CONTRACT_ID)!;
    expect(r2early.lastServedFraction).toBe(0); // breaching under the shared-link congestion.
    const loadAtBreachStart = r2early.offeredLoad;
    // 1000 more ticks of breach: the load must NOT have grown (it is frozen while unserved).
    const m2 = new Map<number, SimAction[]>();
    act3aLog(m2);
    const later = drive(25000, m2);
    const r2later = later.contractById(ACT3A_CONTRACT_ID)!;
    expect(r2later.lastServedFraction).toBe(0); // still breaching (pre-relief).
    expect(r2later.offeredLoad).toBe(loadAtBreachStart); // FROZEN — no growth while unserved.
  }, 60000);
});

// ── back-compat: the router blend is dormant when escalation is off ───────────────

describe("C1b — router back-compat (the congestion blend is a no-op with no loadBySat)", () => {
  it("solve over the equatorial region with no loadBySat is byte-identical with/without an empty map", () => {
    const sats: NetSat[] = [
      { id: "SAT-GEO", orbit: resolveOrbit(GEO_PARK, 0), bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) },
    ];
    const c: RoutableContract = { id: ACT1_CONTRACT_ID, region: NET_ACT1_REGION, activeAxes: new Set(["connectivity"]) };
    const a = solve(eph, c, sats, [NET_ACT1_GROUND], 0);
    const b = solve(eph, c, sats, [NET_ACT1_GROUND], 0, undefined, new Map());
    expect(b.served).toBe(a.served);
    expect(b.path).toEqual(a.path);
    expect(b.latencyS).toBe(a.latencyS);
  });
});
