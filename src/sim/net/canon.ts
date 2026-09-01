/**
 * net/ — THE CANONICAL ARRIVAL ARC (the one scripted "good playthrough" of the M1 hour).
 *
 * Pure data + pure drivers, extracted from net-replay.test.ts (2026-08-08, R3 balance work)
 * so TWO consumers share ONE canon: the replay golden (net-replay.test.ts pins the hash)
 * and the ECONOMY MEASUREMENT (canon-balance.test.ts prints + pins the wallet trajectory).
 * Moving code here changed NO behaviour — the golden pin is identical.
 *
 * NO vitest imports: this is a sim-adjacent module (purity-linted with the rest of net/).
 */

import type { Ephemeris } from "../ephemeris";
import { mixInt, mixFloat, mixString } from "../state-hash";
import { saveGame, addAction, type SaveGame } from "../save";
import {
  netLaunch,
  netAccept,
  netSetPrefer,
  netPlaceCache,
  netAssignBeam,
  netCircularize,
  KIND_NET_LAUNCH,
  KIND_NET_ACCEPT,
  KIND_NET_SET_PREFER,
  KIND_NET_PLACE_CACHE,
  KIND_NET_ASSIGN_BEAM,
  KIND_NET_CIRCULARIZE,
  type SimAction,
} from "../action";
import { loadEphemeris } from "../system-data";
import { NetSession, NET_RNG_SEED } from "./session";
import { applyNetAction } from "./apply-action";
import { GEO_PARK, LEO_SWEEP, MARS_RELAY } from "./world";

import {
  ACT1_CONTRACT_ID,
  ACT2_CONTRACT_ID,
  ACT3A_CONTRACT_ID,
  ACT3A_BACKHAUL_CONTRACT_ID,
  ACT2_ZERO_GAP_N,
} from "./scenario";
import { ACT4_MARS_CONTRACT_ID } from "./endpoint";

export const TAU2 = Math.PI * 2;
export const GOLDEN_DT = 1 / 60;

/** The golden replay's ephemeris (real dataset; Earth arc is byte-identical to empty). */
export function buildCanonEph(): Ephemeris {
  return loadEphemeris();
}

/** Sim-time the golden replay runs to (the act1+act2 arc). */
export const MAX_T_SECONDS = 680;
export const MAX_TICK = Math.round(MAX_T_SECONDS / GOLDEN_DT);

/** LAUNCH the default GEO PARK at this tick (the pre-seeded default that already works). */
export const TICK_LAUNCH = 600; // t = 10 sim-seconds.
/** ACCEPT the Act-1 contract AFTER the launch event deploys (~18 s pipeline). */
export const TICK_ACCEPT = 1440; // t = 24 sim-seconds.

/** ACT 2: LAUNCH the zero-gap LEO_SWEEP constellation as ONE BATCH right as act2 opens. */
export const TICK_BATCH = 1441;
/** ACT 2: ACCEPT REGION-1 + CIRCULARIZE the underburned NET-SAT-4. */
export const TICK_ACCEPT2 = 3032;
/** ACT 2: the FILL batch — more polar sats INTERLEAVED between the first batch's slots to
 * close the attrition holes. The interleave offset is HALF a slot (π/N, not a fixed π/4): it
 * has to follow the constellation's actual spacing, and the spacing changed with the beam
 * geometry. A fixed offset lands the fill sats on top of the survivors instead of between
 * them, which is why the arc read 87% held — close, and never closing. */
export const TICK_FILL = 20642;
export const FILL_COUNT = 4;
export const FILL_SUBLON_RAD =
  LEO_SWEEP.subLonRad +
  Math.PI / ACT2_ZERO_GAP_N -
  (TAU2 / 240) * (TICK_FILL - TICK_BATCH) * GOLDEN_DT;

/** What the canonical player buys for act 2 — the measured zero-gap minimum. The arc's
 * attrition hole is closed by the FILL batch below, not by over-buying up front. */
export const ACT2_BATCH_COUNT = ACT2_ZERO_GAP_N;

/** The even in-plane mean-anomaly spread for the zero-gap batch (= 2π / N). */
export const ACT2_PHASE_SPREAD_RAD = TAU2 / ACT2_ZERO_GAP_N;

/** R3 (balance): with the term at 480 sim-s, renewals CYCLE inside the hour — sign REGION-0's
 * first renewal just after its term completes (~t = 520). The renewal carries the GROWN demand
 * baseline (the act3a squeeze keeps its fuel) at +15% pay. */
export const TICK_ACCEPT_R0_R1 = 31200; // t = 520 s.

/** The recorded ACT-1 + ACT-2 action sequence. */
export function actLog(batchCount = ACT2_BATCH_COUNT): SaveGame {
  const sg = saveGame(NET_RNG_SEED, GOLDEN_DT, { game: "net", act: "act2" });
  addAction(
    sg,
    netLaunch(
      {
        presetId: GEO_PARK.id,
        semiMajorM: GEO_PARK.semiMajorM,
        incRad: GEO_PARK.incRad,
        subLonRad: GEO_PARK.subLonRad,
        count: 1,
      },
      TICK_LAUNCH,
    ),
  );
  addAction(sg, netAccept(ACT1_CONTRACT_ID, TICK_ACCEPT));
  addAction(
    sg,
    netLaunch(
      {
        presetId: LEO_SWEEP.id,
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: LEO_SWEEP.incRad,
        subLonRad: LEO_SWEEP.subLonRad,
        count: batchCount,
        phaseSpreadRad: TAU2 / batchCount,
      },
      TICK_BATCH,
    ),
  );
  addAction(sg, netAccept(ACT2_CONTRACT_ID, TICK_ACCEPT2));
  addAction(sg, netCircularize("NET-SAT-4", TICK_ACCEPT2));
  // R3 balance (term 480s ⇒ renewals actually CYCLE inside the hour): sign REGION-0's
  // renewal once it lands — the sustaining loop IS the economy lesson, and its grown baseline
  // keeps the act3a shared-pipe squeeze fueled.
  addAction(sg, netAccept("REGION-0+R1", TICK_ACCEPT_R0_R1));
  addAction(
    sg,
    netLaunch(
      {
        presetId: LEO_SWEEP.id,
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: LEO_SWEEP.incRad,
        subLonRad: FILL_SUBLON_RAD,
        count: FILL_COUNT,
        phaseSpreadRad: TAU2 / FILL_COUNT,
      },
      TICK_FILL,
    ),
  );
  return sg;
}

/** The pinned golden log: the full act1→act2 arc with the attrition response. */
export function act2Log(): SaveGame {
  return actLog(ACT2_BATCH_COUNT);
}

// ── ACT 3a (C1b): escalation → the shared-BROADCAST-pipe squeeze → re-tame ──────────

const ACT3A_DEG_RAD = Math.PI / 180;
export const TICK_EQ_CORRIDOR = 39662;
export const TICK_BEAMS = 41163;
export const TICK_ACCEPT_R2 = 41223;
export const TICK_RELIEF = 55463;
export const TICK_CIRC_RELIEF = 56303;
export const TICK_PREFER = 56784;

/** The recorded ACT-1 → ACT-2 → ACT-3a action sequence. */
export function act3aLog(): SaveGame {
  const sg = act2Log();
  addAction(
    sg,
    netLaunch(
      {
        presetId: "EQ_LEO",
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: 0,
        subLonRad: 1.5 * ACT3A_DEG_RAD,
        count: 3,
        phaseSpreadRad: TAU2 / 3,
        loadout: ["ACCESS_S"],
      },
      TICK_EQ_CORRIDOR,
    ),
  );
  addAction(sg, netAssignBeam("NET-SAT-9", 0, ACT3A_CONTRACT_ID, TICK_BEAMS));
  addAction(sg, netAssignBeam("NET-SAT-10", 0, ACT3A_CONTRACT_ID, TICK_BEAMS));
  addAction(sg, netAssignBeam("NET-SAT-11", 0, ACT3A_CONTRACT_ID, TICK_BEAMS));
  addAction(sg, netAccept(ACT3A_CONTRACT_ID, TICK_ACCEPT_R2));
  addAction(sg, netAccept(ACT3A_BACKHAUL_CONTRACT_ID, TICK_ACCEPT_R2));
  addAction(
    sg,
    netLaunch(
      { presetId: "EQ_LEO", semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: -1.5 * ACT3A_DEG_RAD, count: 1 },
      TICK_RELIEF,
    ),
  );
  addAction(sg, netCircularize("NET-SAT-12", TICK_CIRC_RELIEF));
  addAction(sg, netSetPrefer(ACT1_CONTRACT_ID, 1, 50, 0, TICK_PREFER));
  return sg;
}

/** The act3a replay runs past the relief so the re-tame latches + the act3a gate fires. */
export const MAX_T_ACT3A_SECONDS = 950;
export const MAX_TICK_ACT3A = Math.round(MAX_T_ACT3A_SECONDS / GOLDEN_DT);

/** Identical action log for 3b (faults are scenario-seeded, not player actions). */
export const act3bLog = act3aLog;
export const MAX_T_ACT3B_SECONDS = 985;
export const MAX_TICK_ACT3B = Math.round(MAX_T_ACT3B_SECONDS / GOLDEN_DT);

// ── ACT 4 (D1): the Mars frontier teaser ───────────────────────────────────────────

export const TICK_MARS_RELAY = 58104;
export const TICK_MARS_ACCEPT = 59304;
export const TICK_PLACE_CACHE = 60504;

/** The recorded ACT-1 → … → ACT-4 action sequence (the D1 golden driver). */
export function act4Log(): SaveGame {
  const sg = act3bLog();
  addAction(
    sg,
    netLaunch(
      { presetId: MARS_RELAY.id, semiMajorM: MARS_RELAY.semiMajorM, incRad: MARS_RELAY.incRad, subLonRad: MARS_RELAY.subLonRad, count: 1 },
      TICK_MARS_RELAY,
    ),
  );
  addAction(sg, netAccept(ACT4_MARS_CONTRACT_ID, TICK_MARS_ACCEPT));
  addAction(sg, netPlaceCache(TICK_PLACE_CACHE));
  return sg;
}

/** The act4 replay runs past the relay + accept + breadcrumb: t = 1090 s. */
export const MAX_T_ACT4_SECONDS = 1090;
export const MAX_TICK_ACT4 = Math.round(MAX_T_ACT4_SECONDS / GOLDEN_DT);

// ── the replay driver ─────────────────────────────────────────────────────────────

export interface CanonReplayResult {
  hash: bigint;
  balance: number;
  session: NetSession;
  /** Balance sampled every tick (economy measurement; null when not sampled). */
  balanceTrace: number[] | null;
  /** gate ticks (act completion stamps) for the trajectory table. */
  gateTicks: number[];
}

/** The net action kinds this replay routes (the rest are ignored). */
export function isNetKind(kind: string): boolean {
  return (
    kind === KIND_NET_ASSIGN_BEAM ||
    kind === KIND_NET_CIRCULARIZE ||
    kind === KIND_NET_LAUNCH ||
    kind === KIND_NET_ACCEPT ||
    kind === KIND_NET_SET_PREFER ||
    kind === KIND_NET_PLACE_CACHE
  );
}

/**
 * Replay an action log through a NetSession: at every tick run step(t) FIRST (scenario emit
 * + serve/breach + revenue + the gate), THEN apply any net action recorded at that tick
 * post-step via applyNetAction — the SAME order m2-build-replay + main.ts use.
 * Set `sampleBalance` to also trace the wallet (the balance measurement harness).
 */
export function replayCanon(sg: SaveGame, maxTick: number, sampleBalance = false): CanonReplayResult {
  const eph = buildCanonEph();
  const session = new NetSession();
  const byTick = new Map<number, SimAction[]>();
  for (const a of sg.actions) {
    if (isNetKind(a.kind)) {
      const list = byTick.get(a.atTick) ?? [];
      list.push(a);
      byTick.set(a.atTick, list);
    }
  }
  const trace: number[] | null = sampleBalance ? [] : null;
  for (let tick = 0; tick <= maxTick; tick++) {
    const t = tick * sg.dt;
    session.step(eph, t, sg.dt);
    const list = byTick.get(tick);
    if (list !== undefined) for (const a of list) applyNetAction(eph, session, a, sg.dt);
    trace?.push(session.balance);
  }
  return {
    hash: netStateHash(session),
    balance: session.balance,
    session,
    balanceTrace: trace,
    gateTicks: [...session.snapshot().gateTicks],
  };
}

/**
 * Fold the net session's mutable state into a u64 (reusing the state-hash primitives).
 * Everything folded is bit-stable across runs (see the fold comments).
 */
export function netStateHash(s: NetSession): bigint {
  const snap = s.snapshot();
  // Wallet + RNG (the determinism anchor).
  let acc = mixFloat(0n, snap.balance);
  acc = mixInt(acc, BigInt(snap.rngState));
  acc = mixInt(acc, BigInt(snap.launchedCount));
  acc = mixFloat(acc, snap.lastStepS);
  // The SCENARIO cursor + the recorded gate-tick stamps (the arrival sequence's progress).
  acc = mixInt(acc, BigInt(snap.scenarioCursor));
  acc = mixInt(acc, BigInt(snap.gateTicks.length));
  for (const gt of snap.gateTicks) acc = mixInt(acc, BigInt(gt));
  // ACT-2 session state: clean-streak start-stamp + over-build waste log.
  acc = mixFloat(acc, snap.cleanServedSinceS);
  acc = mixInt(acc, BigInt(snap.wasteLoggedSats));
  // ACT-3b (C2) FAULT + TRACE fold (see net-replay.test.ts history for the re-pin chain).
  acc = mixInt(acc, BigInt(snap.faultsOn));
  acc = mixInt(acc, BigInt(snap.activeFaults.length));
  for (const f of snap.activeFaults) {
    acc = mixString(acc, f.satId);
    acc = mixString(acc, f.kind);
    acc = mixString(acc, f.cause);
    acc = mixFloat(acc, f.startedAtS);
    acc = mixFloat(acc, f.degradedCapacityFactor);
    acc = mixFloat(acc, f.failsAtS);
    acc = mixFloat(acc, f.recoversAtS);
  }
  acc = mixInt(acc, BigInt(snap.faultScriptQueue.length));
  for (const sc of snap.faultScriptQueue) {
    acc = mixString(acc, sc.kind);
    acc = mixString(acc, sc.cause);
    acc = mixString(acc, sc.targetSatId ?? "");
  }
  acc = mixString(acc, snap.lastScriptedFaultSatId ?? "");
  acc = mixInt(acc, BigInt(snap.servedThroughFault.length));
  for (const id of snap.servedThroughFault) acc = mixString(acc, id);
  acc = mixInt(acc, BigInt(snap.faultWeathered));
  acc = mixInt(acc, BigInt(snap.surfacedShortfall));
  // ACT-4 (D1) the Mars frontier teaser fold.
  acc = mixInt(acc, BigInt(snap.marsSample === null ? 0 : 1));
  if (snap.marsSample !== null) {
    acc = mixFloat(acc, snap.marsSample.capturedAtT);
    acc = mixFloat(acc, snap.marsSample.halfLifeS);
  }
  // ACT-3a (C1b) escalation + congestion fold.
  acc = mixInt(acc, BigInt(snap.escalationOn));
  acc = mixInt(acc, BigInt(snap.congestionEpoch));
  acc = mixInt(acc, BigInt(snap.act3aReTameWitnessed));
  acc = mixInt(acc, BigInt(snap.chosenPipeByContract.length));
  for (const [cid, pipe] of snap.chosenPipeByContract) {
    acc = mixString(acc, cid);
    acc = mixString(acc, pipe);
  }
  acc = mixInt(acc, BigInt(snap.nearBreachWitnessed.length));
  for (const [id, dipAtS] of snap.nearBreachWitnessed) {
    acc = mixString(acc, id);
    acc = mixFloat(acc, dipAtS);
  }
  acc = mixFloat(acc, snap.playerTopoActionS ?? -1);
  acc = mixString(acc, snap.congestionFingerprint);
  // The ROSTER: each sat's full SatOrbit f64s + loadout eirps.
  acc = mixInt(acc, BigInt(snap.roster.length));
  for (const sat of snap.roster) {
    acc = mixString(acc, sat.id);
    acc = mixString(acc, sat.bus);
    const o = sat.orbit;
    acc = mixString(acc, o.parentId);
    acc = mixFloat(acc, o.aM);
    acc = mixFloat(acc, o.e);
    acc = mixFloat(acc, o.incRad);
    acc = mixFloat(acc, o.raanRad);
    acc = mixFloat(acc, o.argpRad);
    acc = mixFloat(acc, o.m0Rad);
    acc = mixFloat(acc, o.epochS);
    acc = mixFloat(acc, o.muParent);
    acc = mixInt(acc, BigInt(sat.loadout.length));
    for (const a of sat.loadout) acc = mixFloat(acc, a.eirp);
  }
  // The CONTRACTS: state + accums + lastServedFraction + earnedEur + offeredLoad + the
  // activeAxes mask folded by FIXED ORDINAL ascending.
  acc = mixInt(acc, BigInt(snap.contracts.length));
  for (const c of snap.contracts) {
    acc = mixString(acc, c.id);
    acc = mixString(acc, c.state);
    acc = mixFloat(acc, c.servedSecondsAccum);
    acc = mixFloat(acc, c.breachSecondsAccum);
    acc = mixFloat(acc, c.lastServedFraction);
    acc = mixFloat(acc, c.lastAvailability);
    acc = mixFloat(acc, c.earnedEur);
    acc = mixFloat(acc, c.offeredLoad);
    acc = mixFloat(acc, c.loadBaseline);
    // FL-07 (SD-47) re-pin #2: the tender-texture fields (pay/penalty fold — accept freezes).
    acc = mixFloat(acc, c.payPerSecond);
    acc = mixFloat(acc, c.penaltyPerSecond);
    acc = mixFloat(acc, c.offeredAtS);
    acc = mixFloat(acc, c.signOnBonusEur);
    acc = mixFloat(acc, c.signOnBonusUntilS);
    acc = mixFloat(acc, c.payHalvingS);
    // activeAxes by ASCENDING ordinal (connectivity=0…bandwidth=3) — never Set order.
    const ordinals = NetSession.foldAxisOrdinals(c.activeAxes);
    acc = mixInt(acc, BigInt(ordinals.length));
    for (const ord of ordinals) acc = mixInt(acc, BigInt(ord));
  }
  return acc;
}
