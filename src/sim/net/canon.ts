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
import { GEO_PARK, LEO_SWEEP, MARS_RELAY, A1_GEO_PERIOD_S, A1_LEO_PERIOD_S } from "./world";

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
/** ACT 2: CIRCULARIZE the underburned NET-SAT-4 (the seeded launch failure). Until this burn
 * it flies a lower, FASTER orbit — so it is not a ring member at all, it drifts through the
 * ring leaving a moving hole. Circularise before measuring anything. */
export const TICK_CIRC2 = 3600; // t = 60 s.
/** ACT 2: ACCEPT REGION-1 — deliberately LATE. Availability is a ROLLING window
 * ({@link NET_AVAIL_WINDOW_S}) so it still remembers the sky before the constellation
 * existed; signing the moment the last sat separates books a breach for a network that is
 * already holding. Sign once the window has filled. */
export const TICK_ACCEPT2 = 18000; // t = 300 s.
/** ACT 2: the FILL batch — the replacement sats for the members the launch pipeline lost,
 * aimed at the HOLES they left rather than at a fixed offset. */
export const TICK_FILL = 5400; // t = 90 s.
export const FILL_COUNT = 2;

/**
 * CO-PHASING A LATER LAUNCH WITH AN EXISTING RING.
 *
 * Sub-longitude is not a phase. A launch resolves `m0 = subLon + ω·t_launch` at its own
 * epoch, and from then on the satellite runs at its own mean motion `n`. So to put a
 * replacement at a wanted offset from a ring that launched earlier you have to undo BOTH
 * clocks — the body's spin ω AND the ring's travel n — over the gap between the launches:
 *
 *     subLon_fill = subLon_ring + offset − (ω − n)·Δt
 *
 * The old formula undid ω alone. Under the previous wide floodlights that error was
 * invisible (a footprint that big covers a mis-phased slot anyway); with real beam cones it
 * put every "fill" satellite in the wrong place, and the ring read 87% held forever.
 *
 * This is also exactly the sum no player should ever be asked to do in their head — the
 * reason the pad has to SHOW the ring and let you drop a replacement into the gap.
 */
export const FILL_PHASE_COMP_RAD =
  (TAU2 / A1_GEO_PERIOD_S - TAU2 / A1_LEO_PERIOD_S) * (TICK_FILL - TICK_BATCH) * GOLDEN_DT;

/** One slot along the ring — where the lost members were. */
export const FILL_OFFSET_RAD = TAU2 / ACT2_ZERO_GAP_N;

export const FILL_SUBLON_RAD = LEO_SWEEP.subLonRad + FILL_OFFSET_RAD - FILL_PHASE_COMP_RAD;

/** What the canonical player buys for act 2 — the measured zero-gap minimum. The arc's
 * attrition hole is closed by the FILL batch, not by over-buying up front. */
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
  addAction(sg, netCircularize("NET-SAT-4", TICK_CIRC2));
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
        phaseSpreadRad: ACT2_PHASE_SPREAD_RAD,
      },
      TICK_FILL,
    ),
  );
  // SIGN REGION-1 last — after the ring is whole AND the rolling availability window has
  // filled with a network that is already holding it (see TICK_ACCEPT2).
  addAction(sg, netAccept(ACT2_CONTRACT_ID, TICK_ACCEPT2));
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

/**
 * The act-2 arc lands: 1 GEO (NET-SAT-0), then the zero-gap batch, then the fill pair. Ids are
 * consumed by EVERY member the pipeline attempts — including the ones it loses — so the count
 * that matters is the number REQUESTED, not the number that arrived.
 */
export const CORRIDOR_FIRST_SAT_INDEX = 1 + ACT2_BATCH_COUNT + FILL_COUNT;
export const CORRIDOR_SAT_IDS = [0, 1, 2].map((i) => `NET-SAT-${CORRIDOR_FIRST_SAT_INDEX + i}`);
/** The act-3 relief bird, launched after the corridor. */
export const RELIEF_SAT_ID = `NET-SAT-${CORRIDOR_FIRST_SAT_INDEX + 3}`;

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
  // The corridor's OWN sats — the three ACCESS birds launched immediately above. Satellite
  // ids are handed out in launch order, so these move whenever an earlier act launches a
  // different number of vehicles; pointing a beam at a stale id silently aims it at somebody
  // else's satellite and the contract never gets served. `canonCorridorSatIds` derives them
  // from the launch order instead of hard-coding, and canon-balance asserts they really are
  // the equatorial ACCESS birds.
  for (const id of CORRIDOR_SAT_IDS) {
    addAction(sg, netAssignBeam(id, 0, ACT3A_CONTRACT_ID, TICK_BEAMS));
  }
  addAction(sg, netAccept(ACT3A_CONTRACT_ID, TICK_ACCEPT_R2));
  addAction(sg, netAccept(ACT3A_BACKHAUL_CONTRACT_ID, TICK_ACCEPT_R2));
  addAction(
    sg,
    netLaunch(
      { presetId: "EQ_LEO", semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: -1.5 * ACT3A_DEG_RAD, count: 1 },
      TICK_RELIEF,
    ),
  );
  addAction(sg, netCircularize(RELIEF_SAT_ID, TICK_CIRC_RELIEF));
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

// The act-4 beats FOLLOW THE ACT-4 GATE: the relay commits the instant act 4 opens, the accept
// lands 20 s later and the breadcrumb 20 s after that (+1200 / +2400 ticks at DT = 1/60).
//
// They are pinned as literals because the golden must be a fixed action log, but the offsets are
// the invariant — if the act-3b gate ever moves, these move WITH it or the arc silently derails:
// a relay launched one tick BEFORE act 4 emits is a launch into a beat that does not exist yet,
// which is exactly what happened when the equatorial regions were re-placed (the gate slid 58104 →
// 58105 and the un-moved relay pushed the gate out by a further 2060 ticks, stranding MARS-1
// unaccepted and the arc €650 poorer). Keep TICK_MARS_RELAY == the act-3b gate tick.
export const TICK_MARS_RELAY = 58105;
export const TICK_MARS_ACCEPT = 59305;
export const TICK_PLACE_CACHE = 60505;

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
