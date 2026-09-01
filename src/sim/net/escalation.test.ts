import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NetSession } from "./session";
import { applyNetAction } from "./apply-action";
import {
  netLaunch,
  netAccept,
  netSetPrefer,
  netAssignBeam,
  netCircularize,
  type SimAction,
} from "../action";
import { GEO_PARK, LEO_SWEEP } from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import {
  ACT1_CONTRACT_ID,
  ACT2_CONTRACT_ID,
  ACT3A_CONTRACT_ID,
  ACT3A_BACKHAUL_CONTRACT_ID,
} from "./scenario";
import { resolveOrbit } from "./world";
import {
  TICK_BATCH,
  TICK_CIRC2,
  TICK_ACCEPT2,
  TICK_FILL,
  FILL_SUBLON_RAD,
  FILL_COUNT,
  ACT2_BATCH_COUNT,
  ACT2_PHASE_SPREAD_RAD,
  CORRIDOR_SAT_IDS,
  RELIEF_SAT_ID,
  TICK_EQ_CORRIDOR,
  TICK_BEAMS,
  TICK_ACCEPT_R2,
  TICK_RELIEF,
  TICK_CIRC_RELIEF,
  TICK_PREFER,
} from "./canon";
import { NET_ACT1_GROUND, NET_ACT1_REGION } from "./endpoint";
import { offerNetContract } from "./contract";
import {
  escalateLoad,
  ESCALATION_LOAD_CEILING,
  ESCALATION_RATE_PER_S,
  ESCALATION_BANDWIDTH_AXIS_THRESHOLD,
} from "./contract";
import { solve, type RoutableContract } from "./router";

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

// The FIXED act3a arc ticks — THE CANON (identical to the net-replay golden script, R0/SD-45):
// the act2 gate fires at t ≈ 661 s; act3a offers the latency CORRIDOR (pointed ACCESS beams) and
// the latency-tolerant BACKHAUL that shares the GEO's BROADCAST pipe with REGION-0. Escalation
// grows both baselines; the asymmetric-peak fair-share squeeze dips REGION-0 near-breach
// (bandwidth-binding) at t ≈ 924 s; the relief (a parallel BROADCAST LEO + prefer-bw on REGION-0)
// splits the pipe durably and the re-tame gate fires at t ≈ 938 s.
const TICK_ACCEPT_R0 = 1440;
// The arc's shape is CANON's — imported, never re-typed. This test used to keep its own copy
// of every tick, phase offset and satellite id; when the act-2 choreography moved they drifted
// apart silently and the beams here ended up pointed at somebody else's satellites.

/** The act1 → act2 → act3a arc through the re-tame (the SAME log the net-replay golden pins). */
function act3aLog(m: Map<number, SimAction[]>): void {
  // Act 1: GEO over REGION-0 (accept after the ~18 s deploy pipeline).
  add(m, 600, netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, 600));
  add(m, TICK_ACCEPT_R0, netAccept(ACT1_CONTRACT_ID, TICK_ACCEPT_R0));
  // Act 2: the zero-gap polar batch (seeded attrition: 2 no-seps + 1 underburn), the
  // circularise burn that makes the underburned bird a ring member again, then the fill pair.
  add(m, TICK_BATCH, netLaunch({ presetId: LEO_SWEEP.id, semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: LEO_SWEEP.subLonRad, count: ACT2_BATCH_COUNT, phaseSpreadRad: ACT2_PHASE_SPREAD_RAD }, TICK_BATCH));
  add(m, TICK_CIRC2, netCircularize("NET-SAT-4", TICK_CIRC2));
  // R3: with the 480 s term, REGION-0's first generation completes mid-arc — sign the renewal
  // (phase-inherited, baseline carried) so the escalation squeeze keeps its fuel. Matches canon.
  add(m, 31200, netAccept("REGION-0+R1", 31200));
  add(m, TICK_FILL, netLaunch({ presetId: LEO_SWEEP.id, semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: FILL_SUBLON_RAD, count: FILL_COUNT, phaseSpreadRad: ACT2_PHASE_SPREAD_RAD }, TICK_FILL));
  add(m, TICK_ACCEPT2, netAccept(ACT2_CONTRACT_ID, TICK_ACCEPT2));
  // Act 3a: the corridor constellation (3 pointed ACCESS LEOs) + accept corridor + backhaul.
  add(m, TICK_EQ_CORRIDOR, netLaunch({ presetId: "EQ_LEO", semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: 1.5 * DEG, count: 3, phaseSpreadRad: (2 * Math.PI) / 3, loadout: ["ACCESS_S"] }, TICK_EQ_CORRIDOR));
  for (const id of CORRIDOR_SAT_IDS) {
    add(m, TICK_BEAMS, netAssignBeam(id, 0, ACT3A_CONTRACT_ID, TICK_BEAMS));
  }
  add(m, TICK_ACCEPT_R2, netAccept(ACT3A_CONTRACT_ID, TICK_ACCEPT_R2));
  add(m, TICK_ACCEPT_R2, netAccept(ACT3A_BACKHAUL_CONTRACT_ID, TICK_ACCEPT_R2));
  // The relief: the parallel BROADCAST LEO (underburns on this seed — circularize), then the
  // prefer-bw override on REGION-0 so the shared-pipe pair splits durably.
  add(m, TICK_RELIEF, eqLeoLaunch(-1.5, TICK_RELIEF));
  add(m, TICK_CIRC_RELIEF, netCircularize(RELIEF_SAT_ID, TICK_CIRC_RELIEF));
  add(m, TICK_PREFER, netSetPrefer(ACT1_CONTRACT_ID, 1, 50, 0, TICK_PREFER));
}

describe("C1b — escalation squeezes the shared BROADCAST pipe (binary), the player splits it, re-tamed", () => {
  it("the FULL tame → outgrow → re-tame cycle fires the act3a gate deterministically", () => {
    const m = new Map<number, SimAction[]>();
    act3aLog(m);
    // Run past the re-tame gate (tick 56303) AND the durable prefer-split (tick 56784).
    const s = drive(57200, m);

    // Escalation engaged; the corridor + backhaul were offered + accepted.
    expect(s.escalationEnabled).toBe(true);
    const r2 = s.contractById(ACT3A_CONTRACT_ID)!;
    expect(["active", "completed"]).toContain(r2.state);
    // Escalation GREW the loads above their offers and flipped the bandwidth axes on (§4.4).
    expect(r2.activeAxes.has("latency")).toBe(true); // the authored latency axis (pointed beams).
    // R3 — the customer's second generation carries the grown baseline (REGION-0 completed
    // its first 480 s term; the renewal inherits baseline + diurnal phase).
    const r0 = s.contractById("REGION-0+R1")!;
    expect(["active", "completed"]).toContain(r0.state);
    expect(r0.loadBaseline).toBeGreaterThan(1.0);
    // THE 3a GATE FIRED: REGION-0 dipped near-breach (bandwidth-binding, the shared-pipe
    // squeeze), the player re-engineered (relief LEO deployed), and it returned to fully
    // SERVED alone on its pipe with the whole board green.
    expect(s.escalationReTamed()).toBe(true);
    expect(s.cursor).toBeGreaterThanOrEqual(3);
    // THE ORDERING IS THE PROOF: the gate latched only AFTER the relief deployed (the
    // witness requires a player topology action strictly after the dip, and the sole-pipe
    // all-green split at the latch instant — both enforced inside the latch itself; the
    // instantaneous share can legitimately re-form later as the relief LEO sweeps).
    const act3aGateTick = s.snapshot().gateTicks[2];
    expect(act3aGateTick).toBeGreaterThan(TICK_RELIEF);
  }, 120000);

  it("the act3a gate does NOT fire before the near-breach dip + re-tame (state-gated, not clock-timed)", () => {
    const m = new Map<number, SimAction[]>();
    act3aLog(m);
    const s = drive(TICK_RELIEF - 1, m);
    expect(s.cursor).toBe(2); // still on act3a.
    expect(s.escalationReTamed()).toBe(false);
    // The dip is REAL: REGION-0 is accruing breach inside the asymmetric-peak window (the
    // fair-share bite on the shared GEO BROADCAST pipe).
    const r0 = s.contractById("REGION-0+R1") ?? s.contractById(ACT1_CONTRACT_ID)!;
    expect(r0.breachSecondsAccum).toBeGreaterThan(0);
  }, 120000);
});

// ── escalation only where served, only when on; the baseline freeze law ───────────

describe("C1b — escalation grows ONLY a well-served contract, ONLY when gated on", () => {
  it("with escalation OFF (Act 1/2), offeredLoad never changes (golden-safe dormancy)", () => {
    // Drive only the Act-1 opening (cursor stays before act3a so escalation is never enabled).
    const m = new Map<number, SimAction[]>();
    add(m, 600, netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, 600));
    add(m, TICK_ACCEPT_R0, netAccept(ACT1_CONTRACT_ID, TICK_ACCEPT_R0));
    const s = drive(3000, m);
    expect(s.escalationEnabled).toBe(false);
    const r0 = s.contractById(ACT1_CONTRACT_ID)!;
    expect(r0.lastServedFraction).toBe(1.0); // served well…
    expect(r0.offeredLoad).toBe(1.0); // …but the load NEVER grew (escalation dormant).
  });

  it("a contract's BASELINE freezes while it is breaching (served-fraction 0) — demand grows only where you serve well", () => {
    // SYNTHETIC (no arc): a session with escalation ON and an ACTIVE contract that has NO
    // coverage at all (no sats) — it is wholly unserved every step, so its BASELINE must
    // never grow while the bursty realized load keeps oscillating on top of it.
    const s = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
    s.addContract(offerNetContract(ACT1_CONTRACT_ID, NET_ACT1_REGION, { offeredLoad: 0.8 }));
    s.acceptContract(ACT1_CONTRACT_ID);
    s.enableEscalation();
    const c = s.contractById(ACT1_CONTRACT_ID)!;
    const baseline0 = c.loadBaseline;
    const loads = new Set<number>();
    for (let tick = 1; tick <= 3000; tick++) {
      s.step(eph, tick * DT, DT);
      loads.add(c.offeredLoad);
    }
    expect(c.lastServedFraction).toBe(0); // wholly unserved throughout.
    expect(c.loadBaseline).toBe(baseline0); // BASELINE FROZEN — no growth while breaching.
    expect(loads.size).toBeGreaterThan(10); // the bursty realized load still oscillates.
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
