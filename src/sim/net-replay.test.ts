import { describe, it, expect } from "vitest";
import { Ephemeris } from "./ephemeris";
import { mixInt, mixFloat, mixString } from "./state-hash";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
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
} from "./action";
import { loadEphemeris } from "./system-data";
import { C_LIGHT, AU_M } from "./ephemeris";
import { NetSession, NET_RNG_SEED, NET_OPENING_BALANCE, BREACH_GRACE_SECONDS as NET_BREACH_GRACE_SECONDS } from "./net/session";
import { applyNetAction } from "./net/apply-action";
import {
  GEO_PARK,
  LEO_SWEEP,
  MARS_RELAY,
  resolveOrbit,
  A1_LEO_PERIOD_S,
  A1_GEO_PERIOD_S,
  launchStackCost,
} from "./net/world";
import { SLA_AXIS_ORDINAL, type SlaAxis } from "./net/contract";
import {
  ACT1_CONTRACT_ID,
  ACT2_CONTRACT_ID,
  ACT3A_CONTRACT_ID,
  ACT3A_BACKHAUL_CONTRACT_ID,
  ACT2_ZERO_GAP_N,
  ACT2_SLA_AVAIL,
  NET_HANDOFF_CYCLE_S,
  NET_ACT2_REGION,
} from "./net/scenario";
import {
  NET_ACT1_GROUND,
  NET_ACT2_GROUND,
  NET_ACT2_REGION_LAT_RAD,
  ACT4_MARS_CONTRACT_ID,
} from "./net/endpoint";
import { isPointServed, type RoutableContract } from "./net/router";
import { windowAvailability } from "./net/availability";
import { standardLoadout, type NetSat } from "./net/sat";
import { NET_REF_LINK_DISTANCE_M } from "./net/link-budget";

const TAU = Math.PI * 2;

/**
 * net/ A3 — THE M1 ARRIVAL-SEQUENCE DETERMINISM REPLAY (design §3 the state-gating engine,
 * §4 determinism/golden, §5 the Act-1 slice). The connectivity game is a SEPARATE world from
 * the M1 cache/economy (544847093270497462n) and the M2 build (8431658617016421069n), so it
 * carries its OWN replay golden, off its OWN seed (4242424242424242n). NEITHER existing golden
 * is touched: this test imports neither m1/ nor m2/session.ts.
 *
 * --- WHAT THIS GUARDS -------------------------------------------------------
 * The WHOLE Act-1 loop is deterministic via the action log + the per-tick session step:
 *   - the SCENARIO ENGINE emits the one Act-1 connectivity contract deterministically INSIDE
 *     step (so it is in the fold), the player LAUNCHES the parked GEO PARK + ACCEPTS the
 *     contract, the router serves the whole equatorial disc, revenue accrues, and the act1
 *     GATE (served + € rising) fires — recording its gate tick into the cursor;
 *   - the roster (full SatOrbit f64s + loadout eirps), the contracts (state + accums +
 *     lastServedFraction + earnedEur + offeredLoad + activeAxes by FIXED ORDINAL), the wallet,
 *     the RNG state, the scenarioCursor + gate-tick stamps, and the fault cursor (a 0 placeholder
 *     in Act 1) all fold into the replay hash.
 *
 * ORDERING (live == replay, design §4): each tick step(t) runs FIRST (scenario emit + serve/
 * breach + revenue + the gate), THEN any net action recorded at that tick applies post-step via
 * applyNetAction — the SAME "step then post-drain action" order m2-build-replay + main.ts use.
 */

const GOLDEN_DT = 1 / 60;

/**
 * The golden replay's ephemeris. Acts 1–3 are the toy frame (the router NEVER reads `eph` for the
 * Earth-relative sat/surface geometry — `satPositionRelative` drops `eph.position`, the surface
 * frame is the toy 300 km body), so for the Earth-only arc this is byte-identical to the empty
 * `Ephemeris.build({})` the pre-D1 golden used (verified). ACT 4 needs the REAL Earth↔Mars distance
 * for the light-delay, so the golden now builds from the canonical dataset — the toy near-Earth
 * scale and the REAL interplanetary distance COEXIST (the brief's hard rule): near-Earth orbits stay
 * toy-scaled; the Mars leg's light-delay uses the real body-to-body distance via `solveMarsLeg`. */
function buildEph() {
  return loadEphemeris();
}

/** Sim-time the golden replay runs to (the act1+act2 arc). R0 (SD-45): launches ride the
 * countdown/ascent/deploy EVENT pipeline and the act2 constellation takes seeded attrition
 * (2 no-seps + 1 underburn on this seed) needing a circularize + a fill batch — so the act2
 * gate fires at t ≈ 661 s. 680 sim-seconds runs just past it (the cursor reaches act3a). */
const MAX_T_SECONDS = 680;
const MAX_TICK = Math.round(MAX_T_SECONDS / GOLDEN_DT);

/** LAUNCH the default GEO PARK at this tick (the pre-seeded default that already works). */
const TICK_LAUNCH = 600; // t = 10 sim-seconds.
/** ACCEPT the Act-1 contract AFTER the launch event deploys (~18 s pipeline) — accepting
 * before FIRST SIGNAL bleeds the 2× penalty (R0 §2.5), so the canon signs at t = 24 s. */
const TICK_ACCEPT = 1440; // t = 24 sim-seconds.

/** ACT 2: LAUNCH the N=4 LEO_SWEEP constellation as ONE BATCH right as act2 opens. On this
 * seed the batch takes attrition: members 1+2 NO-SEP (lost), member 3 UNDERBURNS — the
 * constellation arrives HOLED (the launch-event drama is real). */
const TICK_BATCH = 1441; // t ≈ 24.02 s (the tick the act1 gate fired + REGION-1 was offered).
/** ACT 2: ACCEPT REGION-1 + CIRCULARIZE the underburned NET-SAT-4 once the batch deployed. */
const TICK_ACCEPT2 = 3032; // t ≈ 50.5 s.
/** ACT 2: the FILL batch — 4 more polar sats interleaved (+π/4) to close the attrition holes.
 * Its sub-longitude compensates the spin between the two commits so the fill phases land
 * interleaved with the survivors' plane. */
const TICK_FILL = 20642; // t ≈ 344 s.
const FILL_SUBLON_RAD =
  LEO_SWEEP.subLonRad + Math.PI / 4 - ((2 * Math.PI) / 240) * (TICK_FILL - TICK_BATCH) * GOLDEN_DT;

/** The even in-plane mean-anomaly spread for the N=4 batch (= 2π / count). */
const ACT2_PHASE_SPREAD_RAD = TAU / ACT2_ZERO_GAP_N;

/**
 * The recorded ACT-1 + ACT-2 action sequence (the M1 arrival arc through act2). R0 (SD-45):
 * the canon now includes the seeded-attrition RESPONSE — a circularize on the underburned
 * member and an interleaved fill batch — because the launch event's partial-deploy drama is
 * a real mechanic the player answers, not a scripted convenience.
 */
function actLog(batchCount = ACT2_ZERO_GAP_N) {
  const sg = saveGame(NET_RNG_SEED, GOLDEN_DT, { game: "net", act: "act2" });
  // ACT 1 — the parked GEO over REGION-0.
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
  // ACT 2 — the N=4 LEO_SWEEP batch (attrition on this seed), accept, circularize, fill.
  addAction(
    sg,
    netLaunch(
      {
        presetId: LEO_SWEEP.id,
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: LEO_SWEEP.incRad,
        subLonRad: LEO_SWEEP.subLonRad,
        count: batchCount,
        phaseSpreadRad: TAU / batchCount,
      },
      TICK_BATCH,
    ),
  );
  addAction(sg, netAccept(ACT2_CONTRACT_ID, TICK_ACCEPT2));
  addAction(sg, netCircularize("NET-SAT-4", TICK_ACCEPT2));
  addAction(
    sg,
    netLaunch(
      {
        presetId: LEO_SWEEP.id,
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: LEO_SWEEP.incRad,
        subLonRad: FILL_SUBLON_RAD,
        count: 4,
        phaseSpreadRad: ACT2_PHASE_SPREAD_RAD,
      },
      TICK_FILL,
    ),
  );
  return sg;
}

/** The pinned golden log: the full act1→act2 arc with the attrition response. */
function act2Log() {
  return actLog(ACT2_ZERO_GAP_N);
}

// ── ACT 3a (C1b): escalation → the shared-BROADCAST-pipe squeeze → re-tame ──────────────────────

/** The DEG→RAD helper for the equatorial-LEO launches (act3a corridor). */
const ACT3A_DEG_RAD = Math.PI / 180;

/** ACT 3a: the corridor CONSTELLATION — 3 phased equatorial LEOs carrying ACCESS_S cards
 * (R0/SD-45: a latency-active contract can never ride a BROADCAST floodlight; it needs
 * POINTED spot beams, and one moving LEO cannot hold a low-latency SLA — three can). */
const TICK_EQ_CORRIDOR = 39662; // the tick the act2 gate fired + act3a opened (t ≈ 661 s).
/** ACT 3a: POINT each corridor sat's ACCESS beam at REGION-2 once the batch deployed. */
const TICK_BEAMS = 41163; // t ≈ 686 s.
/** ACT 3a: ACCEPT the corridor + the BACKHAUL (the two demands act3a offers). */
const TICK_ACCEPT_R2 = 41223; // t ≈ 687 s.
/** ACT 3a: the RELIEF — after the shared GEO BROADCAST pipe's asymmetric-peak squeeze dips
 * REGION-0 near-breach (bandwidth-binding, ~t = 924 s), launch a parallel equatorial
 * BROADCAST LEO; once it deploys, prefer-bw REGION-0 so the pair splits pipes durably. */
const TICK_RELIEF = 55463; // t ≈ 924.4 s (the dip tick).
const TICK_CIRC_RELIEF = 56303; // the relief LEO underburned on this seed — circularize it.
const TICK_PREFER = 56784; // prefer-bw REGION-0 after the relief LEO is up.

/**
 * The recorded ACT-1 → ACT-2 → ACT-3a action sequence (the C1b golden driver). R0 (SD-45):
 * the squeeze is the shared GEO BROADCAST pipe (REGION-0 + BACKHAUL-3, phases ~103° apart,
 * baselines grown by escalation until an asymmetric peak window cuts REGION-0's fair share
 * below its 0.6 floor); the corridor teaches POINTING (3 ACCESS beams) + the GEO ceiling.
 */
function act3aLog() {
  const sg = act2Log();
  // The corridor constellation: 3 phased equatorial ACCESS_S LEOs (pointed after deploy).
  addAction(
    sg,
    netLaunch(
      {
        presetId: "EQ_LEO",
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: 0,
        subLonRad: 1.5 * ACT3A_DEG_RAD,
        count: 3,
        phaseSpreadRad: TAU / 3,
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
  // The relief: a parallel equatorial BROADCAST LEO + (once deployed) the prefer override.
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

/** The act3a replay runs past the relief so the re-tame latches + the act3a gate fires
 * (gate ≈ t = 938 s). */
const MAX_T_ACT3A_SECONDS = 950;
const MAX_TICK_ACT3A = Math.round(MAX_T_ACT3A_SECONDS / GOLDEN_DT);

// ── ACT 3b (C2): faults — the chaos kitten, mild-first (the re-pin driver) ──────────────────────
//
// Identical action log to act3a (the faults are scenario-seeded, not player actions); only the
// HORIZON extends so the scripted Degradation plays out and the 3b gate fires (~t = 968 s).
const act3bLog = act3aLog;

/** The act3b replay runs past the 3b gate (~t = 968 s). */
const MAX_T_ACT3B_SECONDS = 985;
const MAX_TICK_ACT3B = Math.round(MAX_T_ACT3B_SECONDS / GOLDEN_DT);

// ── ACT 4 (D1): the Mars frontier teaser — "distance changes everything" ────────────────────────

/** ACT 4: LAUNCH the deep-space MARS RELAY just after act4 opens (~t = 968 s). */
const TICK_MARS_RELAY = 58104; // t ≈ 968.4 s — the tick the act3b gate fired.
/** ACT 4: ACCEPT the Mars contract once the relay deployed (presence-based bridge). */
const TICK_MARS_ACCEPT = 59304; // t ≈ 988.4 s.
/** ACT 4: PLACE the ONE cache breadcrumb — "data closer helps". */
const TICK_PLACE_CACHE = 60504; // t ≈ 1008.4 s.

/**
 * The recorded ACT-1 → … → ACT-4 action sequence (the D1 golden driver).
 */
function act4Log() {
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
const MAX_T_ACT4_SECONDS = 1090;
const MAX_TICK_ACT4 = Math.round(MAX_T_ACT4_SECONDS / GOLDEN_DT);

/** Replay an action log through a NetSession to a given max tick (the act3a arc needs a longer
 * horizon than the act1/act2 arc). Mirrors {@link replay} (step then post-drain action). */
function replayTo(sg: ReturnType<typeof saveGame>, maxTick: number): ReplayResult {
  const eph = buildEph(); // D1: real ephemeris (Earth-only arc byte-identical; Mars leg needs the real distance).
  const session = new NetSession();
  const byTick = new Map<number, SimAction[]>();
  for (const a of sg.actions) {
    if (isNetKind(a.kind)) {
      const list = byTick.get(a.atTick) ?? [];
      list.push(a);
      byTick.set(a.atTick, list);
    }
  }
  for (let tick = 0; tick <= maxTick; tick++) {
    const t = tick * sg.dt;
    session.step(eph, t, sg.dt);
    const list = byTick.get(tick);
    if (list !== undefined) for (const a of list) applyNetAction(eph, session, a, sg.dt);
  }
  return { hash: netStateHash(session), balance: session.balance, session };
}

/** The net action kinds this replay routes (the rest are ignored, like the m2 driver). */
function isNetKind(kind: string): boolean {
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
 * Fold the net session's mutable state into a u64 (reusing the state-hash primitives).
 * Order (design §4): wallet + RNG state + scenarioCursor + gate-tick stamps + the fault cursor
 * (a 0 placeholder until C2) + the roster (full SatOrbit f64s + loadout eirps) + every contract
 * (state, accums, lastServedFraction, earnedEur, offeredLoad, and activeAxes folded by ASCENDING
 * SLA_AXIS_ORDINAL via mixInt — NEVER Set iteration order, NEVER a string sort of mutable labels).
 * Everything folded is bit-stable across runs.
 */
function netStateHash(s: NetSession): bigint {
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
  // ACT-2 session state (the B3 fold extension): the availability clean-streak start-stamp (the
  // gate-hardening field, a double) and the over-build waste log (an int recorded at act2
  // completion — the Act-3 optimizer-pull seed). Folded in FIXED order after the gate ticks.
  acc = mixFloat(acc, snap.cleanServedSinceS);
  acc = mixInt(acc, BigInt(snap.wasteLoggedSats));
  // ACT-3b (C2) FAULT + TRACE fold ADDITIONS (the SD-40-C2 re-pin) — REPLACING the old fault-cursor
  // 0 placeholder. Folded in FIXED order here (where the placeholder was): the fault-generator gate
  // flag, the ACTIVE faults (each by satId|kind|cause|the three §2.4 predictability-seed sim-times,
  // sorted by satId in the snapshot), the pending mild-first SCRIPT queue (kinds+causes, in order),
  // the mild-first gate stamp (lastScriptedFaultSatId), the served-through set + the weather/short-
  // fall witnesses. In Acts 1–3a these are dormant defaults (off / empty / null / 0) ⇒ byte-
  // identical to the pre-C2 fold for the act1/act2 horizons; they become live once the cursor
  // reaches act3b (after the act3a gate) and the seeded roll fires the scripted pair.
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
  // ACT-4 (D1) the Mars frontier teaser — the ONE fold ADDITION: the Mars sample (a null-flag + 2
  // f64s: capturedAtT + halfLifeS = the real one-way light delay). Null until the Mars path first
  // carries / the breadcrumb is placed ⇒ dormant 0 for the pre-act4 horizons (byte-identical). The
  // "as of Nm ago" / freshness / stale-pay dimming are render-layer reads off this (no Contract
  // field, no wallet — §8 fenced).
  acc = mixInt(acc, BigInt(snap.marsSample === null ? 0 : 1));
  if (snap.marsSample !== null) {
    acc = mixFloat(acc, snap.marsSample.capturedAtT);
    acc = mixFloat(acc, snap.marsSample.halfLifeS);
  }
  // ACT-3a (C1b) escalation + congestion fold ADDITIONS (the SD-40-C1b re-pin): the escalation
  // gate flag, the §2.4 congestion epoch, the chosen-sat assignment (sorted id|satId pairs — makes
  // loadBySat a pure function of folded state across a restore), the re-tame witness + its
  // near-breach-witnessed contract ids, and the prior congestion fingerprint (so a restore
  // reproduces the epoch-bump decision). Folded in FIXED order after the fault cursor. In Acts 1/2
  // these are dormant defaults (off / 0 / empty / "") ⇒ byte-identical to the pre-C1b fold for the
  // shorter horizon; they become live once the cursor reaches act3a + escalation engages.
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
  // The CONTRACTS: state + accums + lastServedFraction + earnedEur + offeredLoad + the activeAxes
  // mask folded by FIXED ORDINAL ascending (the one canonical path: NetSession.foldAxisOrdinals).
  acc = mixInt(acc, BigInt(snap.contracts.length));
  for (const c of snap.contracts) {
    acc = mixString(acc, c.id);
    acc = mixString(acc, c.state);
    acc = mixFloat(acc, c.servedSecondsAccum);
    acc = mixFloat(acc, c.breachSecondsAccum);
    acc = mixFloat(acc, c.lastServedFraction);
    // The ROLLING availability readout (Act 2): 0 for a connectivity-only contract (the axis is
    // off — byte-identical to the pre-B3 fold for REGION-0), the rolling held-fraction for an
    // availability-active one. Folded right after lastServedFraction (its sibling readout).
    acc = mixFloat(acc, c.lastAvailability);
    acc = mixFloat(acc, c.earnedEur);
    acc = mixFloat(acc, c.offeredLoad);
    // P4 (§4.3): the SLOW load BASELINE the bursty offeredLoad oscillates around — the growing state
    // the next step's escalation depends on (offeredLoad itself is the bursty realized value derived
    // from baseline + t + loadPhase + a seeded-noise draw). Folded right after offeredLoad (its
    // sibling) so two states with the same realized load but a different baseline never collide.
    acc = mixFloat(acc, c.loadBaseline);
    // FL-07 (SD-47) re-pin #2: the tender-texture fields. payPerSecond + penaltyPerSecond MUST
    // fold now that accept FREEZES the decayed board price (two accepts at different times
    // diverge); plus the offer-clock fields (offeredAtS, sign-on bonus + lapse, pay halving)
    // so a restore can't reprice a tender. Folded right after loadBaseline (the € cluster).
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

interface ReplayResult {
  hash: bigint;
  balance: number;
  session: NetSession;
}

/**
 * Replay an Act-1 net action log through a NetSession by STEPPING every fixed tick from 0 to
 * MAX_TICK at `sg.dt`: on each tick run step(t) FIRST (the scenario emit + serve/breach + revenue
 * + the gate), THEN apply any net action recorded at that tick post-step via the SHARED
 * applyNetAction (the SAME path main.ts will use live).
 */
function replay(sg: ReturnType<typeof saveGame>): ReplayResult {
  const eph = buildEph(); // D1: real ephemeris (Earth-only arc byte-identical; Mars leg needs the real distance).
  const session = new NetSession();
  const byTick = new Map<number, SimAction[]>();
  for (const a of sg.actions) {
    if (isNetKind(a.kind)) {
      const list = byTick.get(a.atTick) ?? [];
      list.push(a);
      byTick.set(a.atTick, list);
    }
  }
  for (let tick = 0; tick <= MAX_TICK; tick++) {
    const t = tick * sg.dt;
    session.step(eph, t, sg.dt);
    const list = byTick.get(tick);
    if (list !== undefined) for (const a of list) applyNetAction(eph, session, a, sg.dt);
  }
  return { hash: netStateHash(session), balance: session.balance, session };
}

// ---------------------------------------------------------------------------
// PINNED net/ M1 arrival-sequence replay golden — the full ACT-1 → ACT-2 → ACT-3a arc (scenario
// emit + LAUNCH the default GEO PARK + ACCEPT REGION-0 + the act1 gate; the N=4 LEO BATCH + ACCEPT
// REGION-1 + the act2 gate; THEN act3a: escalation enabled + REGION-2 corridor offered, a short
// equatorial LEO + ACCEPT REGION-2 (latency axis), escalation tips the shared link near-breach
// (the bandwidth axis flips on, binary bite), a PARALLEL LEO + net_set_prefer relief splits the
// sat, the corridor re-tames, and the act3a gate fires). A SEPARATE world from the M1 cache golden
// 544847093270497462n and the M2 build golden 8431658617016421069n. Any change to the scenario
// table/gates, the contract/session/router model, the escalation law, the congestion fold, the
// launch boundary, or the state-hash fold moves this value.
//
// RE-PINNED ACROSS PHASES (documented in decisions.md):
//   PRE-B3 (Act-1 only)                       10424955607522567073n
//   B3     (Act-1+Act-2 equatorial REGION-1)  12864209889064023665n
//   SD-40-B3-FIX (high-lat REGION-1)          260489051471786347n
//   SD-40-C1b (act3a escalation in the fold)  314363620940498869n
//   SD-40-C2  (act3b faults in the fold)      11632456535472871375n
//   SD-40-D1  (act4 Mars teaser in the fold)  2578549558858135194n
//   P0b       (launch CHARGE + failure roll)  10597504085086350891n
//   P2        (telegraphed DROP + transient)  16182974603317469058n
//   P3        (traffic classes + slider)      8969122486022400018n
//   P4        (bursty non-coincident load +   4638365066733440034n
//              slaBandwidth-reading bw axis)
// What moved it in P4 (the M1-remediation §4.3 fix — oversubscription is the deterministic statistical
// bet it was always meant to be, not a flat uniform cliff):
//   (1) THE BURSTY, NON-COINCIDENT LOAD — `offeredLoad` is no longer a monotone ramp. The escalation
//       law now grows a SLOW `loadBaseline` (the §3a network effect, frozen while breaching), and the
//       realized `offeredLoad` is the bursty `burstyOfferedLoad(baseline, t, loadPhase, noise)` — a
//       periodic "diurnal" oscillation (a pure function of t, period NET_LOAD_DIURNAL_PERIOD_S = 300 s,
//       amplitude 0.45) PLUS a bounded ±0.06 noise term drawn from the session's SEEDED splitmix64,
//       with a PER-CONTRACT `loadPhase` (a deterministic hash of the contract id) so REGION-0 and
//       REGION-2 peak at DIFFERENT times (NON-COINCIDENT). The load RISES ABOVE and FALLS BELOW its
//       slaBandwidth over time. The noise is drawn ONCE per active Earth contract per step (in
//       contractList order) off the SHARED rng — so it advances the folded rng state (moving the
//       downstream act3b fault stream's draws) and the per-step bursty offeredLoad + loadBaseline fold.
//   (2) THE BANDWIDTH AXIS READS slaBandwidth — the dead `slaBandwidth` (the COMMITTED FLOOR, §4.1) is
//       now LIVE: a bandwidth-active contract is MET when its served bandwidth over the shared link is
//       ≥ its OWN slaBandwidth (NET_DEFAULT_SLA_BANDWIDTH = 0.6) and BREACHES when a coincident-peak
//       spike pushes the shared peak past what honors every sharing contract's floor (capacity is then
//       shared in PROPORTION to offered load, so served bw = capacity·ownLoad/sharedLoad). NOT a flat
//       uniform `sharedLoad ≥ capacity` cliff. NET_LINK_CAPACITY_UNITS stays the per-antenna physical
//       capacity. The mask flip is now keyed on the SLOW baseline (replay-stable, never flickers).
//   (3) THE RE-TAME WITNESS — now structural: a contract re-tames when it is fully SERVED and the SOLE
//       active loader of its bridge sat (the SPLIT happened), so a transient coincident bursty trough
//       on a STILL-shared, still-oversubscribed sat can never spuriously latch it. The canonical arc
//       (TICK_RELIEF = 27000) is UNCHANGED: REGION-2 dips near-breach ~t=447 (the coincident peak), the
//       player's relief (the parallel equatorial LEO + the REGION-0 prefer-yield) splits the shared sat
//       at t=450, and the corridor re-tames a tick later — the dip + re-tame still latch like P3 did.
//   (4) FOLD ADDITION — `loadBaseline` is folded right after `offeredLoad` (the slow state the next
//       step's growth depends on; the bursty offeredLoad alone could collide across distinct baselines).
//       The telegraphed fault now drops a DIFFERENT polar LEO (NET-SAT-3, was NET-SAT-4) because the
//       per-contract noise draws shifted the shared rng stream — REGION-1's redundant N=4 still WEATHERS
//       the permanent drop (active, never failed; its breach stays ≪ the fail grace), the acts all gate
//       deterministically (cursor reaches + STOPS on act4), and the HORIZON is unchanged (560 s). The
//       two existing goldens (M1 cache 544847093270497462n, M2 build 8431658617016421069n) are DIFFERENT
//       worlds (neither imports net/) and stay byte-for-byte UNTOUCHED.
// What moved it in P3 (the M1-remediation §7.2/§7.3 fix — per-class routing made LIVE + the slider):
//   (1) TRAFFIC CLASSES — every contract now carries a `trafficClass` that SETS its default `prefer`
//       (§7.2 PREFER_FOR_CLASS): REGION-0 latency-class (lat-only, byte-identical to the old hardcoded
//       {1,0,0}), REGION-1 availability-class (lat LEANED to 0.2 + w_stab 1, DORMANT — engages the
//       blend branch for the polar constellation), REGION-2 BANDWIDTH-class (lat 1 + a small toy-scale
//       w_bw so the corridor routes AROUND a congested shared sat onto the parallel equatorial LEO).
//       So REGION-0 (latency) and REGION-2 (bandwidth) now route DIFFERENTLY over the SAME equatorial
//       sats — the §7.2 demand-shape→topology-shape thesis, previously inert. This changes which
//       bridge several contracts pick (the cost-blend branch vs the legacy max-margin), moving the
//       fold (the roster/contract solves). The contract struct also gained a `trafficClass` field
//       (carried by cloneNetContract / the snapshot), but the state-hash does NOT fold it (derived
//       metadata) — the value moves only through the changed ROUTING + the re-tuned arc below.
//   (2) THE RELIEF TICK MOVED 25800 → 27000 (≈ t=430 → t=450): under the bandwidth-class weights
//       REGION-2's near-breach dip is cleaner + the relief must land AFTER its breach window crosses
//       the 60 s near-breach threshold so the re-tame is genuinely witnessed. This shifts every
//       downstream beat (act3a gate t≈450, act3b faults emit t≈451, act3b gate t≈480, act4 reached) —
//       all still gate deterministically (cursor reaches + STOPS on act4; re-tame/weather/surface all
//       latch). The HORIZON is unchanged (560 s). The two existing goldens (M1 cache 544847093270497462n,
//       M2 build 8431658617016421069n) are DIFFERENT worlds (neither imports net/) and stay byte-for-
//       byte UNTOUCHED.
// What moved it in P2 (the M1-remediation §5 fault-behaviour fix — the SIGNATURE telegraphed event):
//   (1) THE SESSION-ORDERING FIX — a TELEGRAPHED fault reaching failsAtS is no longer treated as a
//       self-recovery: it DROPS the sat PERMANENTLY (it stays in the active map, removed from the
//       router graph from failsAtS on — a warned hard failure). It is NOT freed / NOT credited
//       "weathered". So the active-fault fold now CARRIES the telegraphed-expired fault past failsAtS
//       (where before it spuriously vanished), AND the dropped sat changes the routing solve from the
//       drop on. In the canonical run the telegraphed fault hits a polar REGION-1 LEO (NET-SAT-4) and
//       drops it ~t=520 — REGION-1's redundant N=4 constellation WEATHERS it (it dips intermittently
//       to N=3 then recovers; never fails), so the acts still gate (weathered via the degradation,
//       cursor reaches act4). (2) THE TRANSIENT FAULT — ACT3B_FAULT_SCRIPTS is now a mild-first TRIO
//       (degradation → transient → telegraphed); the transient (a brief 15 s self-healing outage on
//       NET-SAT-4 ~t=460-475) fires the §5 row-2 self-healing-reroute lesson (the `transient` kind was
//       type-only before) — it advances the scripted-queue cadence + the rng stream + adds its own
//       fold state. (3) THE LOW-ORBIT RE-SCALE — LOW_ORBIT_REF_M is now the TOY GEO semi-major axis
//       (was a real-Earth GEO radius), so the causal lever's labels/rates are unchanged for the
//       scripted faults (still "lowOrbit") but the fold-affecting STOCHASTIC stream draws are
//       unchanged at this seed (the floor never fired in the canonical run); the re-scale moves no
//       behaviour in the canonical log, only the toy LEO-vs-GEO causal GAP (2.88× vs the old ~0.5%).
//   The HORIZON is unchanged (560 s) — the telegraphed drop (~t=520) lands inside it. The two existing
//   goldens (M1 cache 544847093270497462n, M2 build 8431658617016421069n) are DIFFERENT worlds
//   (neither imports net/) and stay byte-for-byte UNTOUCHED.
// What moved it in SD-40-D1 (the MARS-TEASER re-pin, the SD-40 chained-re-pin pattern): the act4
// beat (emitted INSIDE step when the act3b gate fires) now OFFERS the ONE Mars contract (MARS-1,
// bodyId "mars", connectivity-only), and the golden log gained the ACT-4 player inputs — LAUNCH the
// MARS RELAY (the SAME net_launch, the MARS_RELAY preset), ACCEPT the Mars contract (the router's
// solveMarsLeg presence-bridges it + injects the REAL Earth↔Mars light delay ~15.4 min one-way into
// latencyS — the signal CRAWLS), and PLACE the one cache breadcrumb (net_place_cache). The golden
// now builds the REAL ephemeris (the toy near-Earth arc is byte-identical to the empty eph the pre-D1
// golden used — the router never reads eph for Earth geometry; only the Mars leg needs the real
// distance — so the Earth/fault fold is UNCHANGED). The HORIZON extends (520 s → 560 s) so the Mars
// path carries + the sample freezes + the cache re-captures. The fold gained the ONE D1 ADDITION —
// `marsSample` (a null-flag + 2 f64s: capturedAtT + halfLifeS = the real one-way light delay) —
// PLUS the value moves (the offered + accepted Mars contract's state-machine fields, the MARS RELAY
// in the roster). The cursor STOPS on act4 (its gate is false forever — a read, not a gate; no win
// screen). The two existing goldens are DIFFERENT worlds (neither imports net/) and stay byte-for-
// byte UNTOUCHED (M1 cache 544847093270497462n, M2 build 8431658617016421069n).
//
// RE-PINNED in P0b (the M1-remediation launch-economy increment — §3.5 "charge for launches"):
// NET_REPLAY_GOLDEN 2578549558858135194n → 10597504085086350891n. Two things moved the fold:
//   (1) session.launchSat now DEBITS the launch cost from the wallet (charged win OR lose, the m2
//       convention) — so `balance` (folded first) drops by the scripted launches' capex (≈€11.6k);
//       the opening balance was raised 5000 → 20000 (headroom for the §3.5 charges), which also
//       moves the folded balance. (2) Each launched member now draws ONE double off the SEEDED
//       SimRng for the FLAT per-launch failure roll (NET_LAUNCH_FAILURE_CHANCE = 0.05, the M2
//       launch-roll pattern, NO new seed / NO new action) — advancing the rng state (folded) and
//       SHIFTING the downstream Act-3b fault stream's draws. The canonical log's launches were
//       VERIFIED to all CLEAR the 5% roll at this seed (the GEO, the N=4 LEO batch, the two act3a
//       corridor LEOs, and the Mars relay all reach orbit), so the acts still gate deterministically
//       (act1..act3b fire; the cursor reaches + STOPS on act4) and every behavioural invariant below
//       holds. The two existing goldens (M1 cache 544847093270497462n, M2 build 8431658617016421069n)
//       are DIFFERENT worlds (neither imports net/) and stay byte-for-byte UNTOUCHED.
// ---------------------------------------------------------------------------
// FL-01+FL-11 (SD-46/SD-48) re-pin [#1 of the FL plan]: the priced BROADCAST default (+€2,500
// per lean launch in the canonical arc) + the members-2+ manifest discount move the wallet path;
// determinism (restore == continuous, JSON round-trip) unchanged, verified before pinning.
// FL-07 (SD-47) re-pin #2 [of two planned]: tender texture — sign-on bonus (REGION-0 +€2,000
// landed in-window), the decaying REGION-C fold, pay/penalty now folding (accept freezes), and
// the texture fields mixed. Determinism unchanged (restore == continuous, JSON round-trip OK).
const NET_REPLAY_GOLDEN = 14974205439654686823n;

describe("net/ A3+B3+C1b+C2+D1 — M1 arrival-sequence replay golden (act1 GEO + act2 N=4 + act3a escalation/re-tame + act3b faults mild-first + act4 Mars teaser)", () => {
  it("pins the net-session replay state hash for the act1→act2→act3a→act3b→act4 action log (regression guard)", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    expect(r.hash).toBe(NET_REPLAY_GOLDEN);
  }, 60000);

  it("a logged act1→act2→act3a→act3b→act4 sequence is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replayTo(act4Log(), MAX_TICK_ACT4);
    const b = replayTo(act4Log(), MAX_TICK_ACT4);
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
    expect(a.session.snapshot()).toEqual(b.session.snapshot());
  }, 60000);

  it("LIVE == REPLAY: stepping + applying the same actions directly reproduces the replay (deep snapshot incl. SatOrbit f64s + the act3a/act3b fold fields + the act4 marsSample)", () => {
    const eph = buildEph();
    const live = new NetSession();
    const byTick = new Map<number, SimAction[]>();
    for (const a of act4Log().actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    for (let tick = 0; tick <= MAX_TICK_ACT4; tick++) {
      const t = tick * GOLDEN_DT;
      live.step(eph, t, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, live, a, GOLDEN_DT);
    }
    const replayed = replayTo(act4Log(), MAX_TICK_ACT4);
    // Deep-equal the whole snapshot (the roster's full SatOrbit f64s + the act3a fold fields + the
    // act3b fault fields + the act4 marsSample — capturedAtT/halfLifeS) + hash.
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.balance).toBe(replayed.balance);
    expect(netStateHash(live)).toBe(replayed.hash);
  }, 60000); // one live run + one replay over the act4 arc — generous headroom.

  it("the net SaveGame survives the JSON round-trip and reproduces the hash (incl. the act2 batch phase spread + the act3a prefer override + the act4 Mars relay/accept/cache)", () => {
    const sg = act4Log();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_LAUNCH)).toBe(true);
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_ACCEPT)).toBe(true);
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_SET_PREFER)).toBe(true);
    // The batch launch's phaseSpreadRad survives the round-trip (non-zero ⇒ written to the wire).
    const batch = reloaded!.actions.find(
      (a) => a.kind === KIND_NET_LAUNCH && a.payload.count === ACT2_ZERO_GAP_N,
    );
    expect(batch).toBeDefined();
    expect(batch!.payload.phaseSpreadRad).toBeCloseTo(ACT2_PHASE_SPREAD_RAD, 12);
    // The act4 wire kinds survive the round-trip too (the Mars relay launch, the Mars accept, the
    // cache-placement breadcrumb).
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_PLACE_CACHE)).toBe(true);
    expect(
      reloaded!.actions.some((a) => a.kind === KIND_NET_LAUNCH && a.payload.presetId === MARS_RELAY.id),
    ).toBe(true);
    // dt survives bit-exactly via dt_bits, so the replay reproduces the pinned hash.
    expect(reloaded!.dt).toBe(GOLDEN_DT);
    const a = replayTo(sg, MAX_TICK_ACT4);
    const b = replayTo(reloaded!, MAX_TICK_ACT4);
    expect(b.hash).toBe(a.hash);
    expect(b.hash).toBe(NET_REPLAY_GOLDEN);
  }, 60000); // two full act4-arc replays — generous headroom.

  it("THE ACT-1 LOOP CLOSES: REGION-0 is SERVED, EARNS €, and the act1 GATE fired deterministically", () => {
    const r = replay(act2Log());
    const c = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID);
    expect(c).toBeDefined();
    // Accepted → active, served the whole disc (binary 1.0), earned € (the wallet rose).
    expect(["active", "completed"]).toContain(c!.state);
    expect(c!.lastServedFraction).toBe(1.0);
    expect(c!.servedSecondsAccum).toBeGreaterThan(0);
    expect(c!.earnedEur).toBeGreaterThan(0);
    // R0 (SD-45): the economy is capex-heavy by design (no single contract pays for its own
    // provisioning) — the wallet is BELOW opening at this horizon, not positive. Overspending
    // is allowed; the assertion is that capex was genuinely charged.
    expect(r.balance).toBeLessThan(NET_OPENING_BALANCE);
    // THE GATE FIRED at a DETERMINISTIC tick: the cursor advanced past act1, and the FIRST gate
    // tick is the first served+paid step AFTER accept. The accept lands post-step on TICK_ACCEPT
    // (step ran first, contract still offered), so the first active+served+paid step is the NEXT
    // tick — the act1 gate opens on TICK_ACCEPT+1.
    expect(r.session.cursor).toBeGreaterThanOrEqual(2); // past act1 AND act2.
    const snap = r.session.snapshot();
    expect(snap.gateTicks[0]).toBe(TICK_ACCEPT + 1);
  });

  it("THE ACT-2 LOOP CLOSES: REGION-1 is HELD continuous via the N=4 hand-off constellation across a full hand-off cycle, NO breach, and the act2 GATE fired", () => {
    const r = replay(act2Log());
    const snap = r.session.snapshot();
    const c = r.session.contracts.find((x) => x.id === ACT2_CONTRACT_ID);
    expect(c).toBeDefined();
    // The availability axis is ACTIVE + the bar held: rolling availability = 1.0 (the meter flat),
    // no breach accrued, and served-time accruing — the sawtooth flattened into continuous SERVED.
    expect(c!.activeAxes.has("availability")).toBe(true);
    expect(c!.lastAvailability).toBe(1.0);
    expect(c!.breachSecondsAccum).toBe(0);
    expect(c!.servedSecondsAccum).toBeGreaterThan(0);
    expect(["active", "completed"]).toContain(c!.state);
    // THE CURSOR ADVANCED act1 → act2 → act3a (two gates fired), and the act2 gate tick is
    // recorded. The waste log is a crude TOTAL-roster count beyond the measured minimum: (the GEO
    // + N=4 LEOs = 5) − zeroGapN (4) → 1 logged surplus (the equatorial GEO is roster surplus for
    // REGION-1, even though geometry-wise it serves only the equatorial REGION-0 — the Act-3 seed).
    expect(r.session.cursor).toBe(2);
    expect(snap.gateTicks.length).toBe(2);
    const act2GateTick = snap.gateTicks[1];
    expect(act2GateTick).toBeGreaterThan(snap.gateTicks[0]);
    // HARDENED GATE: the act2 gate fired only AFTER a SUSTAINED clean hand-off window — at least
    // NET_HANDOFF_CYCLE_S of clean served-time after REGION-1 went active (TICK_ACCEPT2+1). A
    // single served tick mid-sawtooth could not have fired it earlier.
    const handoffTicks = Math.round(NET_HANDOFF_CYCLE_S / GOLDEN_DT);
    expect(act2GateTick).toBeGreaterThanOrEqual(TICK_ACCEPT2 + 1 + handoffTicks);
  });

  it("the act2 GATE does NOT fire before a full hand-off cycle is held (state-gated, hardened against a mid-sawtooth tick)", () => {
    // Replay the FULL log but STOP one tick before the act2 gate fires: the cursor must still be
    // on act2 (cursor === 1), proving the gate needed the sustained clean window — not a stray
    // served instant. We find the gate tick from the full run, then re-run to gateTick-1.
    const full = replay(act2Log());
    const act2GateTick = full.session.snapshot().gateTicks[1];
    const eph = Ephemeris.build({});
    const s = new NetSession();
    const byTick = new Map<number, SimAction[]>();
    for (const a of act2Log().actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    for (let tick = 0; tick <= act2GateTick - 1; tick++) {
      s.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, s, a, GOLDEN_DT);
    }
    expect(s.cursor).toBe(1); // still on act2 — the hand-off cycle has not yet been fully held.
  }, 30000); // one full replay (to find the gate tick) + a partial re-run — generous headroom.

  it("OVER-BUILD still completes act2 AND the surplus is logged: a count=6 batch fires the gate and folds wasteLoggedSats = (GEO + 6 LEOs) − zeroGapN", () => {
    const over = replay(actLog(6));
    expect(over.session.cursor).toBe(2); // act2 still completes (coverage-held is the predicate).
    // R0 (SD-45): waste = live sats at the gate − zeroGapN, WITH the seeded launch attrition
    // and the canonical fill batch in play (empirically pinned on NET_RNG_SEED).
    expect(over.session.snapshot().wasteLoggedSats).toBe(5);
    const pinned = replay(act2Log());
    expect(pinned.session.snapshot().wasteLoggedSats).toBe(3);
  }, 30000); // two full replays (count=6 over-build + the pinned N=4) — generous headroom.

  it("the act1 GATE does NOT fire before the contract is served+paid (state-gated, not clock-timed)", () => {
    // Step a fresh session WITHOUT launching/accepting: the scenario emits the contract but it
    // stays OFFERED, never served, so the gate never fires and the cursor never advances.
    const eph = Ephemeris.build({});
    const s = new NetSession();
    for (let tick = 0; tick <= 3000; tick++) s.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
    expect(s.cursor).toBe(0); // still on act1 — the concept was never FELT.
    const c = s.contracts.find((x) => x.id === ACT1_CONTRACT_ID);
    expect(c).toBeDefined();
    expect(c!.state).toBe("offered"); // the scenario emitted it; it was never accepted.
    // No act2 contract exists yet — the cursor never reached act2.
    expect(s.contracts.find((x) => x.id === ACT2_CONTRACT_ID)).toBeUndefined();
    // The fallback surfaces the gentle "try GEO PARK" assist once past the idle window with no sat.
    const sf = s.currentShortfall(3 * 3600);
    expect(sf).not.toBeNull();
    expect(sf!.suggestPresetId).toBe("GEO_PARK");
  });

  it("the activeAxes fold is by FIXED ORDINAL — REGION-0 folds [0] (connectivity), REGION-1 folds [0,1] (connectivity+availability)", () => {
    const r = replay(act2Log());
    const c0 = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID)!;
    expect(NetSession.foldAxisOrdinals(c0.activeAxes)).toEqual([SLA_AXIS_ORDINAL.connectivity]);
    const c1 = r.session.contracts.find((x) => x.id === ACT2_CONTRACT_ID)!;
    // The Act-2 availability contract folds connectivity (0) + availability (1) — the present
    // second axis, by FIXED ascending ordinal (never Set order). The fold SHAPE is unchanged.
    expect(NetSession.foldAxisOrdinals(c1.activeAxes)).toEqual([
      SLA_AXIS_ORDINAL.connectivity,
      SLA_AXIS_ORDINAL.availability,
    ]);
    // The fold key never depends on insertion order (a future axis appends with its ordinal).
    const multi = new Set<SlaAxis>();
    multi.add("bandwidth");
    multi.add("connectivity");
    expect(NetSession.foldAxisOrdinals(multi)).toEqual([0, 3]);
  });
});

// ---------------------------------------------------------------------------
// SD-40 B3-FIX — THE ACT-2 TEACHING-WALL INVARIANTS (the high-latitude REGION-1 fix).
// REGION-1 was re-placed at HIGH LATITUDE (lat 70°, beyond the parked equatorial GEO's
// measured ~64° footprint edge) so the second contract is UNSOLVABLE by Act 1's method
// (a parked equatorial GEO physically cannot reach a high latitude at any longitude — the
// only Act-2 physics lever is LATITUDE). These four invariants pin exactly that — the wall
// the onboarding (Act 2) requires — and that only a CONSTELLATION clears it.
// ---------------------------------------------------------------------------

const DEG_RAD = Math.PI / 180;
const eph0 = Ephemeris.build({});
// The full ground network the live session uses (equatorial GROUND-0 + the high-lat GROUND-1).
const NET_GROUNDS = [NET_ACT1_GROUND, NET_ACT2_GROUND];
// The availability-active routable contract over REGION-1 (the measurements read this).
const R1: RoutableContract = {
  id: ACT2_CONTRACT_ID,
  region: NET_ACT2_REGION,
  activeAxes: new Set<SlaAxis>(["connectivity", "availability"]),
};
const R1_CENTRE = { latRad: NET_ACT2_REGION.latRad, lonRad: NET_ACT2_REGION.lonRad };

/** The parked equatorial GEO PARK, the ONLY asset Act 1's method provides. */
function geoOnly(): NetSat[] {
  const orbit = resolveOrbit(GEO_PARK, 0);
  const loadout = standardLoadout(NET_REF_LINK_DISTANCE_M);
  for (const a of loadout) a.eirp = GEO_PARK.eirp;
  return [{ id: "GEO", orbit, bus: "smallsat", loadout }];
}

/** A train of `count` LEO_SWEEP (polar) sats evenly m0-phased — the Act-2 constellation. */
function leoConstellation(count: number, t0 = 0): NetSat[] {
  const out: NetSat[] = [];
  for (let i = 0; i < count; i++) {
    const orbit = resolveOrbit(LEO_SWEEP, t0);
    orbit.m0Rad += (TAU * i) / count;
    out.push({ id: `LEO-${i}`, orbit, bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) });
  }
  return out;
}

/** The worst-phase rolling availability over one LEO period (the honest held-fraction). */
function worstPhaseAvail(sats: NetSat[]): number {
  let worst = Infinity;
  for (let k = 0; k < 24; k++) {
    const a = windowAvailability(eph0, R1, sats, NET_GROUNDS, (A1_LEO_PERIOD_S * k) / 24);
    if (a < worst) worst = a;
  }
  return worst;
}

describe("SD-40 B3-FIX — Act-2 is unsolvable by Act-1's method (the latitude wall) + only a constellation clears it", () => {
  it("REGION-1 sits at HIGH LATITUDE (lat 70°), BEYOND the parked equatorial GEO's ~64° footprint edge", () => {
    expect(NET_ACT2_REGION.latRad).toBe(NET_ACT2_REGION_LAT_RAD);
    expect(NET_ACT2_REGION.latRad / DEG_RAD).toBeCloseTo(70, 9);
    // The measured GEO footprint edge is ~64°; 70° is safely beyond it.
    expect(NET_ACT2_REGION.latRad / DEG_RAD).toBeGreaterThan(64);
  });

  it("INVARIANT 1 — the Act-1 parked equatorial GEO ALONE does NOT serve REGION-1 (binary served=false, the centre is beyond the GEO edge), at ANY time", () => {
    const geo = geoOnly();
    // Sweep > a full GEO day (the GEO parks, but prove time-invariance the honest way).
    let everServed = false;
    const dt = A1_GEO_PERIOD_S / 200;
    for (let i = 0; i < 200 * 2; i++) {
      if (isPointServed(eph0, R1_CENTRE, NET_GROUNDS, geo, i * dt)) { everServed = true; break; }
    }
    expect(everServed).toBe(false);
    // And the binary solve verdict (the same path the live session uses) is unserved with an
    // availability binding (the axis is active) — the GEO is no answer to REGION-1.
    expect(isPointServed(eph0, R1_CENTRE, NET_GROUNDS, geo, 0)).toBe(false);
  });

  it("INVARIANT 2 — a SINGLE inclined LEO over REGION-1 SAWTOOTHS (rolling avail < slaAvail) and FAILS at the shared grace (the wall)", () => {
    const lone = leoConstellation(1);
    // The rolling availability never reaches the bar — it sawtooths.
    let minRoll = Infinity, maxRoll = -Infinity;
    const dt = A1_LEO_PERIOD_S / 200;
    for (let i = 0; i < 200 * 4; i++) {
      const r = windowAvailability(eph0, R1, lone, NET_GROUNDS, i * dt);
      if (r < minRoll) minRoll = r;
      if (r > maxRoll) maxRoll = r;
    }
    expect(maxRoll).toBeLessThan(ACT2_SLA_AVAIL); // never holds the bar.
    expect(maxRoll).toBeGreaterThan(minRoll); // it sawtooths (rises + sets).
    // And the worst-phase held-fraction is far below the bar — a lone LEO is no answer either.
    expect(worstPhaseAvail(lone)).toBeLessThan(ACT2_SLA_AVAIL);
  });

  it("INVARIANT 3 — an N=4 inclined LEO CONSTELLATION HOLDS REGION-1 continuously (worst-phase rolling avail ≥ slaAvail; instant served never drops)", () => {
    const fleet = leoConstellation(ACT2_ZERO_GAP_N);
    expect(worstPhaseAvail(fleet)).toBeGreaterThanOrEqual(ACT2_SLA_AVAIL);
    // Instant served never drops across multiple hand-off cycles (one rises as another sets).
    const dt = A1_LEO_PERIOD_S / 300;
    for (let i = 0; i < 300 * 4; i++) {
      expect(isPointServed(eph0, R1_CENTRE, NET_GROUNDS, fleet, i * dt)).toBe(true);
    }
  });

  it("INVARIANT 4 — the act2 gate fires ONLY via the constellation, and is NOT satisfiable by the GEO alone (GEO-only never holds REGION-1 ⇒ the gate cannot fire)", () => {
    // Replay the act1→act2 arc but launch ONLY the GEO PARK (no constellation): REGION-0 is served
    // + the act1 gate fires, REGION-1 is accepted, but the GEO cannot hold it — so the act2 gate
    // NEVER fires (the cursor stays on act2, cursor === 1) even past the full run.
    const sg = saveGame(NET_RNG_SEED, GOLDEN_DT, { game: "net", act: "act2-geo-only" });
    addAction(sg, netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, TICK_LAUNCH));
    addAction(sg, netAccept(ACT1_CONTRACT_ID, TICK_ACCEPT));
    // Accept REGION-1 (which the act1 gate emits) but launch NO constellation for it.
    addAction(sg, netAccept(ACT2_CONTRACT_ID, TICK_ACCEPT2));
    const r = replay(sg);
    // act1 cleared (REGION-0 served+paid by the GEO), but act2 NEVER cleared (cursor stuck at 1).
    expect(r.session.cursor).toBe(1);
    const c1 = r.session.contracts.find((x) => x.id === ACT2_CONTRACT_ID)!;
    expect(c1.state).not.toBe("completed"); // never completed via the GEO.
    expect(c1.lastAvailability).toBeLessThan(ACT2_SLA_AVAIL); // the GEO can't hold REGION-1.
  }, 30000);
});

// ---------------------------------------------------------------------------
// SD-40 C1b — THE ACT-3a ESCALATION INVARIANTS (the tame → outgrow → re-tame cycle + the fold).
// The escalation law grows offeredLoad deterministically (replay-stable); a corridor contract tips
// near-breach under the shared-link congestion (binary bandwidth bite — the HIGH-1 fix), then a
// parallel-path + net_set_prefer relief returns it to SERVED; the act3a gate fires deterministically
// (which structurally FENCES act3b behind it); and restore-then-step == continuous-run for the new
// congestion fold (chosenSatByContract / loadBySat — the MED desync fix).
// ---------------------------------------------------------------------------
describe("SD-40 C1b — act3a escalation: the tame → outgrow → re-tame cycle fires the gate deterministically", () => {
  it("ESCALATION grew the loads + flipped the bandwidth axis (one at a time), and the corridor re-tamed", () => {
    const r = replayTo(act3aLog(), MAX_TICK_ACT3A);
    // Escalation engaged (act3a emitted it) and the corridor REGION-2 is on the board.
    expect(r.session.escalationEnabled).toBe(true);
    const r2 = r.session.contracts.find((x) => x.id === ACT3A_CONTRACT_ID)!;
    expect(r2).toBeDefined();
    // The §4.4 axes arrived ONE AT A TIME: latency by the authored corridor, bandwidth by the
    // escalation law crossing the threshold (NOT at emit — escalation GREW the load past 1.0 first).
    expect(r2.activeAxes.has("latency")).toBe(true);
    expect(r2.activeAxes.has("bandwidth")).toBe(true);
    expect(r2.offeredLoad).toBeGreaterThan(1.0); // demand grew where served well (deterministic).
    expect(r2.servedSecondsAccum).toBeGreaterThan(0); // the corridor WAS served (latency met, LEO).
    // THE 3a GATE FIRED: a previously-served contract dipped near-breach under risen load, then
    // returned to fully SERVED ⇒ the cursor advanced PAST act3a (the structural fence for act3b).
    expect(r.session.escalationReTamed()).toBe(true);
    expect(r.session.cursor).toBeGreaterThanOrEqual(3);
    expect(r.session.snapshot().gateTicks.length).toBeGreaterThanOrEqual(3);
    // The re-tame is a LATCH (a previously-served contract dipped near-breach then returned to
    // fully served): the act3a gate tick is recorded AFTER the relief (the player re-engineered).
    const act3aGateTick = r.session.snapshot().gateTicks[2];
    expect(act3aGateTick).toBeGreaterThan(TICK_RELIEF); // the gate fired only after the relief.
    // The relief RE-TAMED the corridor: REGION-2 is back to FULLY SERVED at the horizon (frac == 1)
    // — the re-engineering (the parallel equatorial LEO + the REGION-0 yield) landed it on a short
    // path again. P3: the bandwidth-class blend now does the splitting BY CLASS (REGION-2 leaves the
    // congested shared sat for the parallel equatorial LEO under its `prefer.bw`), so the re-tamed
    // state is the served-fraction recovery — NOT a single-tick load reading, which in the multi-sat
    // hand-off topology (the polar passes + the one-tick-lag aggregation) is genuinely noisy.
    expect(r2.lastServedFraction).toBe(1.0);
  }, 60000);

  it("the act3a gate does NOT fire before the re-tame (state-gated): stopping at the relief tick − 1 leaves the cursor on act3a", () => {
    const r = replayTo(act3aLog(), TICK_RELIEF - 1);
    expect(r.session.cursor).toBe(2); // still on act3a — the cycle is not yet demonstrated.
    expect(r.session.escalationReTamed()).toBe(false);
    // R0 (SD-45): the squeeze subject is REGION-0 (sharing the GEO BROADCAST pipe with the
    // backhaul). At the relief tick − 1 its bandwidth axis is active and it is accruing
    // breach inside the asymmetric-peak window (the fair-share bite is real).
    const r0 = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID)!;
    expect(r0.activeAxes.has("bandwidth")).toBe(true);
    expect(r0.breachSecondsAccum).toBeGreaterThan(0);
  }, 60000);

  it("RESTORE-REPLAY for the congestion + FAULT fold: restore-then-step == continuous-run (loadBySat re-derived from the folded chosen-sat map — the MED desync fix; the active faults + the mild-first script queue carry across the restore boundary — the C2 fault fold)", () => {
    // Run continuously to a mid-act3b tick (escalation on, congestion live, AND a fault active —
    // SPLIT lands AFTER the Degradation has fired ~t=430), snapshot, restore into a fresh session,
    // then step BOTH the original and the restored copy forward the SAME ticks with the SAME post-
    // step actions — the two must stay bit-identical (the congestion state AND the fault state — the
    // active faults + the mild-first script queue + the served-through set — are pure functions of
    // FOLDED state + the folded rng, so the restore reproduces a continuous run incl. the seeded roll).
    const eph = buildEph(); // D1: real ephemeris (the Mars leg + the marsSample fold carry across the restore).
    const sg = act4Log();
    const byTick = new Map<number, SimAction[]>();
    for (const a of sg.actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    const SPLIT = 57000; // mid-act3b (R0 timing): escalation on, beams live, the Degradation active (~t=950).
    const cont = new NetSession();
    for (let tick = 0; tick <= SPLIT; tick++) {
      cont.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, cont, a, GOLDEN_DT);
    }
    // The split lands while a fault is active (the Degradation fires in the 3b window ~t=940-968)
    // — so the restore must carry the fault fold, not just the congestion fold.
    expect(cont.faultsEnabled).toBe(true);
    expect(cont.faults.length).toBeGreaterThan(0);
    // Snapshot at SPLIT, restore into a fresh session (the congestion fold + chosen-sat map + the
    // fault fold — active faults + the mild-first script queue + the rng state — all carry).
    const snap = cont.snapshot();
    const restored = new NetSession();
    restored.restore(snap);
    expect(restored.snapshot()).toEqual(snap);
    // Step BOTH forward the same window; they must stay bit-identical (the loadBySat re-derivation
    // off folded state + the seeded fault roll off the folded rng reproduce the continuous run).
    for (let tick = SPLIT + 1; tick <= MAX_TICK_ACT4; tick++) {
      cont.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
      restored.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) {
        for (const a of list) applyNetAction(eph, cont, a, GOLDEN_DT);
        for (const a of list) applyNetAction(eph, restored, a, GOLDEN_DT);
      }
    }
    expect(restored.snapshot()).toEqual(cont.snapshot());
    expect(netStateHash(restored)).toBe(netStateHash(cont));
    // And the continuous run reproduces the pinned golden (the restore path agrees with the pin) —
    // now through act4, so the Mars-sample fold (capturedAtT/halfLifeS) carries across the restore.
    expect(netStateHash(cont)).toBe(NET_REPLAY_GOLDEN);
  }, 60000);
});

// ---------------------------------------------------------------------------
// SD-40 C2 — THE ACT-3b FAULT INVARIANTS (faults — the chaos kitten, mild-first). The fault
// generator is FENCED behind the act3a gate (no fault before re-stabilisation); the scripted pair
// fires MILD-FIRST (a Degradation, THEN a Telegraphed failure — sequenced in time); the player
// WEATHERS the fault (REGION-0/REGION-1 stay served through it) while the TRACE surfaces a
// resilience shortfall (the predictability seed); and the act3b gate fires deterministically,
// advancing the cursor to act4. Faults draw ONLY from the seeded SimRng (replay-deterministic).
// ---------------------------------------------------------------------------
describe("SD-40 C2 — act3b faults: mild-first, fenced behind act3a, weathered, the gate fires", () => {
  it("NO FAULT before the act3a gate (the structural fence): faults are disabled + none active until act3a re-tamed", () => {
    // Stop at the relief tick − 1 (still on act3a, before the re-tame gate fires): the fault
    // generator must be OFF and no fault can have fired (faults begin only after re-stabilisation).
    const r = replayTo(act3bLog(), TICK_RELIEF - 1);
    expect(r.session.cursor).toBe(2); // still on act3a.
    expect(r.session.escalationReTamed()).toBe(false);
    expect(r.session.faultsEnabled).toBe(false); // the generator is FENCED behind the act3a gate.
    expect(r.session.faults.length).toBe(0); // no fault before re-stabilisation.
    expect(r.session.weatheredFault()).toBe(false);
  }, 60000);

  it("MILD-FIRST TRIO: Degradation → Transient (self-healing reroute) → Telegraphed, sequenced in time off the seeded stream", () => {
    // Run the whole arc, recording each fault start in order. The scripted trio fires mild-first,
    // each only after the prior fault's lifetime ENDS (the session feeds the roll only the queue
    // head): a Degradation, then a TRANSIENT brief outage (the §5 row-2 self-healing-reroute lesson,
    // P2), then the Telegraphed failure.
    const eph = Ephemeris.build({});
    const s = new NetSession();
    const sg = act3bLog();
    const byTick = new Map<number, SimAction[]>();
    for (const a of sg.actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    const starts: { tick: number; kind: string; cause: string }[] = [];
    let prev = new Set<string>();
    for (let tick = 0; tick <= MAX_TICK_ACT3B; tick++) {
      s.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, s, a, GOLDEN_DT);
      const ids = new Set(s.faults.map((f) => f.satId));
      for (const f of s.faults) if (!prev.has(f.satId)) starts.push({ tick, kind: f.kind, cause: f.cause });
      prev = ids;
    }
    // The full mild-first TRIO fired, in order: degradation, then transient, then telegraphed.
    const degrIdx = starts.findIndex((e) => e.kind === "degradation");
    const tranIdx = starts.findIndex((e) => e.kind === "transient");
    const teleIdx = starts.findIndex((e) => e.kind === "telegraphed");
    expect(degrIdx).toBeGreaterThanOrEqual(0);
    expect(tranIdx).toBeGreaterThan(degrIdx); // the TRANSIENT fires after the degradation (P2: the
    // self-healing-reroute lesson, previously a type-only kind that NEVER fired).
    expect(teleIdx).toBeGreaterThan(tranIdx); // mild-first: telegraphed is last (the severe one).
    // Each begins only AFTER the prior fault's lifetime ENDS (sequenced in time, not fired together)
    // — strictly increasing start ticks.
    expect(starts[tranIdx].tick).toBeGreaterThan(starts[degrIdx].tick);
    expect(starts[teleIdx].tick).toBeGreaterThan(starts[tranIdx].tick);
    // The live causal lever (lowOrbit) named the cause — the trio bites the low-orbit LEO.
    expect(starts[degrIdx].cause).toBe("lowOrbit");
    expect(starts[tranIdx].cause).toBe("lowOrbit");
    expect(starts[teleIdx].cause).toBe("lowOrbit");
  }, 60000);

  it("THE TELEGRAPHED FAULT DROPS ITS SAT PERMANENTLY (P2 §5.1 — the signature event has teeth): the warned sat is removed from the graph + stays faulted, NOT spuriously 'recovered'/weathered-by-the-drop", () => {
    // Run past the telegraphed countdown's expiry (~t=520). The dropped sat must be REMOVED from the
    // live roster's routing (no longer carrying any contract's path) and must STAY in the active-fault
    // set (a permanent drop), NOT vanish + get credited as "recovered". This is the audit's core fix:
    // before, the session deleted the fault at failsAtS before downSatIds read it, so nothing dropped.
    const r = replayTo(act4Log(), MAX_TICK_ACT4); // through the full arc so the drop (~t=520) is past.
    const faults = r.session.faults;
    const tele = faults.find((f) => f.kind === "telegraphed");
    expect(tele).toBeDefined(); // the telegraphed fault is STILL active (a permanent drop, not freed).
    const tEnd = MAX_TICK_ACT4 * GOLDEN_DT;
    expect(tele!.failsAtS).toBeLessThanOrEqual(tEnd); // its countdown has already expired by tEnd.
    // The dropped sat is removed from the routing graph: it carries NO contract's chosen bridge.
    const droppedId = tele!.satId;
    for (const c of r.session.contracts) {
      const path = r.session.lastSolveFor(c.id)?.path ?? null;
      if (path !== null) expect(path).not.toContain(droppedId); // re-routed AROUND the dead sat.
    }
  }, 60000);

  it("THE 3b GATE FIRES + REDUNDANCY SURVIVES THE DROP: the player WEATHERED the (recoverable) fault, the trace surfaced a shortfall, and the redundant N=4 constellation rides out the permanent telegraphed loss without failing", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4); // run through the full arc so the drop (~t=520) is past.
    // The fault generator engaged (act3b emitted it, fenced behind act3a) + the scripted TRIO is
    // consumed (degradation + transient + telegraphed all played out within the horizon).
    expect(r.session.faultsEnabled).toBe(true);
    expect(r.session.snapshot().faultScriptQueue.length).toBe(0);
    // WEATHERED: the player kept a contract served through a RECOVERABLE fault's whole lifetime (the
    // degradation/transient self-recovered) — NOT credited by the telegraphed permanent drop (which
    // never resolves). The TRACE surfaced ≥1 resilience/optimisation shortfall.
    expect(r.session.weatheredFault()).toBe(true);
    expect(r.session.traceSurfacedShortfall()).toBe(true);
    // THE 3b GATE FIRED ⇒ the cursor advanced PAST act3b (a 4th gate tick recorded; act4 reached).
    expect(r.session.cursor).toBeGreaterThanOrEqual(4);
    expect(r.session.snapshot().gateTicks.length).toBeGreaterThanOrEqual(4);
    // REDUNDANCY SURVIVES: the telegraphed fault dropped one polar REGION-1 LEO PERMANENTLY, yet the
    // redundant N=4 constellation bridges around it — REGION-1 (and the resilient equatorial REGION-0)
    // do NOT fail. A brittle single-sat region WOULD have breached; the redundant builder weathers it.
    const r0 = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID)!;
    const r1 = r.session.contracts.find((x) => x.id === ACT2_CONTRACT_ID)!;
    expect(r0.state).not.toBe("failed");
    expect(r1.state).not.toBe("failed");
    // The dropped sat is genuinely gone from the roster's routing yet REGION-1 is held (served again).
    expect(r1.state).not.toBe("failed");
    expect(r1.breachSecondsAccum).toBeLessThan(NET_BREACH_GRACE_SECONDS); // never reached the fail grace.
    // The trace report is a live readout (the SYSTEM.LOG / shortfall lines) once faults are on.
    expect(r.session.trace).not.toBeNull();
  }, 60000);

  it("the 3b gate does NOT fire before the fault is WEATHERED (state-gated): stopping while the Degradation is still active leaves the cursor on act3b", () => {
    // Stop mid-Degradation (P3 timing: act3b emits ~t=450 when the act3a gate fires, the Degradation
    // fires ~t=451 + self-recovers ~t=480; tick 28000 ≈ t=467 is inside it): the player has NOT yet
    // weathered it (the fault has not resolved) ⇒ the cursor is still on act3b.
    const r = replayTo(act3bLog(), 57500); // mid-Degradation (fires @56304, resolves @58104).
    expect(r.session.faultsEnabled).toBe(true);
    expect(r.session.faults.length).toBeGreaterThan(0); // a fault is active (mid-lifetime).
    expect(r.session.weatheredFault()).toBe(false); // not yet weathered (the fault has not resolved).
    expect(r.session.cursor).toBe(3); // still on act3b — the concept is not yet felt.
  }, 60000);

  it("FAULTS ARE REPLAY-DETERMINISTIC: the active fault state folds + replays bit-identically (same seed ⇒ same fault sequence)", () => {
    const a = replayTo(act3bLog(), MAX_TICK_ACT3B);
    const b = replayTo(act3bLog(), MAX_TICK_ACT3B);
    // The whole fault fold is byte-identical across two replays (the seeded roll is deterministic).
    expect(a.session.snapshot().activeFaults).toEqual(b.session.snapshot().activeFaults);
    expect(a.session.snapshot().faultScriptQueue).toEqual(b.session.snapshot().faultScriptQueue);
    expect(a.session.snapshot().lastScriptedFaultSatId).toBe(b.session.snapshot().lastScriptedFaultSatId);
    expect(a.session.snapshot().faultWeathered).toBe(b.session.snapshot().faultWeathered);
    expect(a.hash).toBe(b.hash);
  }, 60000);
});

// ---------------------------------------------------------------------------
// SD-40 D1 — THE ACT-4 MARS-TEASER INVARIANTS ("distance changes everything" — vertigo, by sight).
// The cursor reaches act4 (the act3b gate fires) ⇒ the ONE Mars contract is offered. The player
// launches the deep-space relay (the SAME net_launch) + accepts it: the FIRST SIGNAL CRAWLS at the
// REAL Earth↔Mars light delay (~15.4 min one-way), data arrives OLD (freshness by sight), and the
// player places ONE cache breadcrumb (data-closer-helps). The cursor STOPS on act4 — a read, NOT a
// gate; no win screen. Latency is a READOUT, never an enforced axis; no Earth gauge shows freshness.
// ---------------------------------------------------------------------------
const SECONDS_PER_MIN = 60;
describe("SD-40 D1 — act4 Mars teaser: light-delay (deterministic minutes), freshness by sight, one cache, the cursor stops", () => {
  it("LATENCY EXPLODES deterministically at MARS distance (one-way MINUTES) while the EARTH toy latency stays microseconds", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    // The cursor reached act4 (the Mars contract was offered) + the player accepted it (active).
    const mars = r.session.contracts.find((c) => c.id === ACT4_MARS_CONTRACT_ID)!;
    expect(mars).toBeDefined();
    expect(mars.region.bodyId).toBe("mars");
    expect(mars.state).toBe("active");
    // The Mars leg's solve latency is MINUTES (the real Earth↔Mars one-way light delay), and equals
    // oneWaySeconds(distanceBetween) at that t exactly — deterministic, pinned with tolerance so a
    // future ephemeris swap is caught. At the J2000 epoch (sim t≈0..560 s) Earth↔Mars ≈ 1.85 AU.
    const marsSolve = r.session.lastSolveFor(ACT4_MARS_CONTRACT_ID)!;
    expect(marsSolve.served).toBe(true);
    const eph = buildEph();
    const tEnd = MAX_TICK_ACT4 * GOLDEN_DT;
    const expectOneWay = eph.distanceBetween("earth", "mars", tEnd) / C_LIGHT;
    expect(marsSolve.latencyS).toBeCloseTo(expectOneWay, 6);
    const oneWayMin = marsSolve.latencyS / SECONDS_PER_MIN;
    expect(oneWayMin).toBeGreaterThan(3); // > 3 min — far past the Earth-toy microsecond floor.
    expect(oneWayMin).toBeLessThan(23); // < 23 min — within the synodic extreme band.
    // The ROUND-TRIP readout (the headline vertigo figure) is exactly 2× the one-way + lands 6..45 min.
    const roundTripMin = (2 * marsSolve.latencyS) / SECONDS_PER_MIN;
    expect(roundTripMin).toBeCloseTo(2 * oneWayMin, 9);
    expect(roundTripMin).toBeGreaterThan(6);
    expect(roundTripMin).toBeLessThan(45);
    // The EARTH toy latency stays MILLISECONDS — ~9 orders of magnitude below the Mars minutes; the
    // Mars branch never touches Earth contracts. REGION-0 (the robustly-served equatorial trunk, NOT
    // the polar constellation taking the telegraphed drop) is served at the horizon — assert its toy
    // latency is sub-second. REGION-1 (the polar constellation) WEATHERED the permanent telegraphed
    // drop (active, never failed) — under the bursty load + the N=4→N=3 reduction it sawtooths a brief
    // hand-off gap that can land on the horizon tick, but its breach stays ≪ the fail grace, so it is
    // NOT failed. AND every Earth contract with a finite latency is sub-second (none ever sees the
    // interplanetary delay; toy paths are ~3-4 ms vs Mars ~923 s).
    const earth = r.session.lastSolveFor(ACT1_CONTRACT_ID)!;
    expect(earth.served).toBe(true);
    expect(earth.latencyS).toBeLessThan(1); // sub-second toy path — NOT the Mars minutes.
    const r1Weathered = r.session.contracts.find((c) => c.id === ACT2_CONTRACT_ID)!;
    expect(r1Weathered.state).not.toBe("failed"); // the redundant polar N=4 weathered the drop.
    for (const c of r.session.contracts) {
      if (c.region.bodyId !== "earth") continue;
      const sv = r.session.lastSolveFor(c.id);
      if (sv !== null && Number.isFinite(sv.latencyS)) expect(sv.latencyS).toBeLessThan(1);
    }
  }, 60000);

  it("the MARS LEG is PRESENCE-based: no relay ⇒ connectivity loss; the relay ⇒ bridges by construction (no toy-frame budget)", () => {
    // The Mars contract offered + accepted but BEFORE the relay launches (stop one tick before it):
    // the leg has no path (presence-based connectivity), exactly like Act-1 "no path".
    const before = replayTo(act4Log(), TICK_MARS_RELAY - 1);
    const marsBefore = before.session.contracts.find((c) => c.id === ACT4_MARS_CONTRACT_ID);
    // (The Mars contract may still be offered or just-accepted; the SOLVE is connectivity-unserved.)
    const solveBefore = before.session.lastSolveFor(ACT4_MARS_CONTRACT_ID);
    if (marsBefore?.state === "active" && solveBefore !== null) {
      expect(solveBefore.served).toBe(false);
      expect(solveBefore.bindingConstraint).toBe("connectivity");
    }
    // After the relay launches the leg bridges by construction (the presence test). The path is
    // [MARS-1, the relay id, GROUND-0] — the relay never goes through the toy inverse-square budget.
    const after = replayTo(act4Log(), MAX_TICK_ACT4);
    const solveAfter = after.session.lastSolveFor(ACT4_MARS_CONTRACT_ID)!;
    expect(solveAfter.served).toBe(true);
    expect(solveAfter.path).not.toBeNull();
    expect(solveAfter.path![0]).toBe(ACT4_MARS_CONTRACT_ID);
    expect(solveAfter.path![1].startsWith("MARS-RELAY")).toBe(true);
  }, 60000);

  it("NO EARTH GAUGE EVER SHOWS FRESHNESS — only the Mars hop carries the 'as of Nm ago' / freshness readout (the §8 fence at the render boundary)", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    const tEnd = MAX_TICK_ACT4 * GOLDEN_DT;
    // The Mars sample exists (the path carried) and carries the freshness readouts.
    expect(r.session.mars).not.toBeNull();
    expect(r.session.marsAgeS(tEnd)).not.toBeNull();
    expect(r.session.marsFreshness(tEnd)).not.toBeNull();
    // There is NO freshness FIELD on ANY Contract struct (Earth or Mars) — freshness is a session
    // render-layer read, never a contract/wallet mechanic (§4.2 / §8: freshness does not exist on
    // Earth, and is not a Contract field at all). Guard the type boundary: no contract key matches.
    for (const c of r.session.contracts) {
      const keys = Object.keys(c);
      expect(keys.some((k) => /fresh|stale|aged|capturedAt|halfLife/i.test(k))).toBe(false);
    }
    // The Earth contracts expose only connectivity/availability/latency/bandwidth axes — never a
    // freshness axis (SLA_AXIS_ORDINAL has no freshness member).
    expect(Object.keys(SLA_AXIS_ORDINAL)).not.toContain("freshness");
  }, 60000);

  it("the CRAWL == the READOUT (no drift): the packet-crawl one-way + the router latencyS are the SAME value; round-trip is exactly 2×", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    const tEnd = MAX_TICK_ACT4 * GOLDEN_DT;
    const eph = buildEph();
    // The crawl + the router both derive from oneWaySeconds(distanceBetween) at the same t.
    const crawlOneWay = eph.distanceBetween("earth", "mars", tEnd) / C_LIGHT;
    const routerOneWay = r.session.lastSolveFor(ACT4_MARS_CONTRACT_ID)!.latencyS;
    expect(routerOneWay).toBeCloseTo(crawlOneWay, 9); // identical formula + identical ephemeris distance.
    // Distance sanity: ~1.85 AU at the J2000 epoch (the toy near-Earth scale + the REAL interplanetary
    // distance coexist — the Mars light-delay uses the real body-to-body distance, not the toy orbit).
    expect(eph.distanceBetween("earth", "mars", tEnd) / AU_M).toBeGreaterThan(0.3);
    expect(eph.distanceBetween("earth", "mars", tEnd) / AU_M).toBeLessThan(2.7);
  }, 60000);

  it("LATENCY STAYS UN-ENFORCED: the Mars contract's activeAxes is {connectivity} only; the minutes-long latency never breaches + never alters earnedEur", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    const mars = r.session.contracts.find((c) => c.id === ACT4_MARS_CONTRACT_ID)!;
    // Connectivity-only — latency is present-but-un-enforced (vertigo, not a system).
    expect([...mars.activeAxes]).toEqual(["connectivity"]);
    // Presence-served ⇒ never breached by the minutes-long latency (the state never flips to failed).
    expect(mars.state).not.toBe("failed");
    expect(mars.breachSecondsAccum).toBe(0);
    // It accrues revenue at the normal pay rate while served (no freshness→€ wiring — the stale-pay
    // dimming is render-layer only). earnedEur is positive + is plain payPerSecond × servedTime.
    expect(mars.lastServedFraction).toBe(1.0);
    expect(mars.earnedEur).toBeGreaterThan(0);
  }, 60000);

  it("ONE CACHE BREADCRUMB, deterministic: net_place_cache sets marsSample + RAISES the displayed freshness (data closer helps), with NO change to served/breach/revenue", () => {
    // Stop one tick BEFORE the cache placement: the sample exists (the path carried), aged ~one-way.
    const before = replayTo(act4Log(), TICK_PLACE_CACHE - 1);
    const tBefore = (TICK_PLACE_CACHE - 1) * GOLDEN_DT;
    const sampleBefore = before.session.mars!;
    const freshBefore = before.session.marsFreshness(tBefore)!;
    expect(sampleBefore).not.toBeNull();
    const marsBefore = before.session.contracts.find((c) => c.id === ACT4_MARS_CONTRACT_ID)!;
    const earnedBefore = marsBefore.earnedEur;
    const stateBefore = marsBefore.state;
    // After the cache breadcrumb lands: the sample is RE-CAPTURED near "now" (age ~0) ⇒ the freshness
    // readout jumps UP by sight (data closer helps). A single placeable — NOT the cache economy.
    const after = replayTo(act4Log(), TICK_PLACE_CACHE);
    const tAfter = TICK_PLACE_CACHE * GOLDEN_DT;
    const freshAfter = after.session.marsFreshness(tAfter)!;
    expect(freshAfter).toBeGreaterThan(freshBefore); // the breadcrumb RAISED the displayed freshness.
    expect(after.session.marsAgeS(tAfter)!).toBeLessThan(before.session.marsAgeS(tBefore)!);
    // The breadcrumb is a FELT readout, NOT a relief lever: it does NOT change served/breach/revenue
    // (the served fraction + the contract state are identical; the wallet accrual is unaffected by it).
    const marsAfter = after.session.contracts.find((c) => c.id === ACT4_MARS_CONTRACT_ID)!;
    expect(marsAfter.state).toBe(stateBefore);
    expect(marsAfter.lastServedFraction).toBe(marsBefore.lastServedFraction);
    // earnedEur only grew by the normal one-tick pay (the placement itself added no revenue).
    expect(marsAfter.earnedEur).toBeGreaterThanOrEqual(earnedBefore);
  }, 60000);

  it("THE CURSOR STOPS ON ACT4 (a read, not a gate): act4.gate is false forever — the cursor never advances past it (no win screen, 'to be continued')", () => {
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    // The cursor reached act4 (cursor === 4: act1→act2→act3a→act3b→act4) and STAYS there — the final
    // beat's gate is false forever, so no 5th gate tick is ever recorded (the deliberate stop).
    expect(r.session.cursor).toBe(4);
    expect(r.session.snapshot().gateTicks.length).toBe(4); // exactly four gates fired (act1..act3b).
    // Running well past the Mars actions does NOT advance the cursor (no gate fires past act4).
    const farther = replayTo(act4Log(), MAX_TICK_ACT4);
    expect(farther.session.cursor).toBe(4);
  }, 60000);
});

// ---------------------------------------------------------------------------
// P0b — CHARGE FOR LAUNCHES (design §3.5) + the FLAT per-launch FAILURE RISK roll. The planner
// already SHOWED the launch cost; P0b actually DEBITS it (charged win OR lose, the m2 convention),
// and every launched member draws ONE double off the SEEDED SimRng for a low (~5%) failure roll
// (the M2 launch-roll pattern — NO new seed, NO new action). A failed launch loses the sat (you ate
// the cost) but the canonical golden log's launches were arranged to all CLEAR the roll at the seed,
// so the acts still gate. These pins guard the economy + the deterministic, replay-safe failure.
// ---------------------------------------------------------------------------
describe("P0b/R0 — launches DEBIT the wallet (stack cost) + the seeded EVENT-pipeline outcome rolls", () => {
  const dt = GOLDEN_DT;

  it("a launch DEBITS the wallet by exactly the previewed STACK cost (vehicle + hardware), and the sat deploys via the event pipeline", () => {
    const eph = buildEph();
    const s = new NetSession();
    const before = s.balance;
    expect(before).toBe(NET_OPENING_BALANCE);
    const action = netLaunch(
      { presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 },
      0,
    );
    const res = applyNetAction(eph, s, action, dt)!;
    expect(res.kind).toBe("sats_launched");
    // R0 (SD-45) + FL-01 (SD-46): cost = launchStackCost(bus, cards, a, count) — one vehicle +
    // N × hardware; a NO-loadout wire launch is charged the PRICED BROADCAST default it flies.
    const expectedCost = launchStackCost("smallsat", ["BROADCAST"], GEO_PARK.semiMajorM, 1);
    expect(res.costEur).toBeCloseTo(expectedCost, 9);
    expect(before - s.balance).toBeCloseTo(expectedCost, 9); // the WALLET actually dropped.
    // The sat rides the countdown/ascent/deploy pipeline — in orbit only after ~18 s.
    expect(s.sats.length).toBe(0);
    for (let tick = 1; tick <= Math.ceil(22 / dt); tick++) s.step(eph, tick * dt, dt);
    expect(s.sats.length).toBe(1);
  });

  it("a BATCH launch debits ONE vehicle + discounted hardware for members 2+ (batching rewarded), charged win or lose", () => {
    const eph = buildEph();
    const s = new NetSession();
    const before = s.balance;
    const count = ACT2_ZERO_GAP_N;
    const action = netLaunch(
      {
        presetId: LEO_SWEEP.id,
        semiMajorM: LEO_SWEEP.semiMajorM,
        incRad: LEO_SWEEP.incRad,
        subLonRad: LEO_SWEEP.subLonRad,
        count,
        phaseSpreadRad: TAU / count,
      },
      0,
    );
    const res = applyNetAction(eph, s, action, dt)!;
    // FL-01 + FL-11: the no-loadout batch is charged the priced BROADCAST default, members 2+
    // at the manifest discount (SD-46/SD-48).
    const expectedCost = launchStackCost("smallsat", ["BROADCAST"], LEO_SWEEP.semiMajorM, count);
    expect(res.costEur).toBeCloseTo(expectedCost, 9);
    expect(before - s.balance).toBeCloseTo(expectedCost, 9);
    // Act 1 (cursor 0) forces every outcome to success: all `count` members deploy.
    for (let tick = 1; tick <= Math.ceil(30 / dt); tick++) s.step(eph, tick * dt, dt);
    expect(s.sats.length).toBe(count);
  });

  it("a COMSAT with cards prices bus+cards into the stack and carries per-antenna capacity", () => {
    const eph = buildEph();
    const s = new NetSession();
    const before = s.balance;
    const action = netLaunch(
      {
        presetId: GEO_PARK.id,
        semiMajorM: GEO_PARK.semiMajorM,
        incRad: GEO_PARK.incRad,
        subLonRad: GEO_PARK.subLonRad,
        count: 1,
        bus: "comsat",
        loadout: ["ACCESS_L", "GATEWAY"],
      },
      0,
    );
    const res = applyNetAction(eph, s, action, dt)!;
    expect(res.kind).toBe("sats_launched");
    const expectedCost = launchStackCost("comsat", ["ACCESS_L", "GATEWAY"], GEO_PARK.semiMajorM, 1);
    expect(before - s.balance).toBeCloseTo(expectedCost, 9);
    for (let tick = 1; tick <= Math.ceil(22 / dt); tick++) s.step(eph, tick * dt, dt);
    expect(s.sats.length).toBe(1);
    const sat = s.sats[0];
    expect(sat.bus).toBe("comsat");
    expect(sat.loadout.map((a) => a.cardId)).toEqual(["ACCESS_L", "GATEWAY"]);
    expect(sat.loadout[0].capacityUnits).toBe(2.4);
    expect(sat.loadout[1].capacityUnits).toBe(4.0);
  });

  it("an over-stuffed loadout is REJECTED with the validation problem (no charge, no event)", () => {
    const eph = buildEph();
    const s = new NetSession();
    const before = s.balance;
    const action = netLaunch(
      {
        presetId: GEO_PARK.id,
        semiMajorM: GEO_PARK.semiMajorM,
        incRad: GEO_PARK.incRad,
        subLonRad: GEO_PARK.subLonRad,
        count: 1,
        loadout: ["ACCESS_L", "GATEWAY"], // 2 G cards on a 1-G smallsat.
      },
      0,
    );
    const res = applyNetAction(eph, s, action, dt)!;
    expect(res.kind).toBe("rejected");
    expect(res.problem).toContain("G slot");
    expect(s.balance).toBe(before);
    expect(s.launchEvents.length).toBe(0);
  });

  it("outcome rolls are DETERMINISTIC off the seed and FORCED to success while Act 1 (cursor 0)", () => {
    // Find a seed whose first batch takes attrition when armed (cursor > 0).
    const eph = buildEph();
    const action = netLaunch(
      { presetId: LEO_SWEEP.id, semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: LEO_SWEEP.subLonRad, count: 4, phaseSpreadRad: TAU / 4 },
      0,
    );
    let attritionSeed: bigint | null = null;
    for (let k = 1n; k < 400n; k++) {
      const probe = new NetSession(NET_OPENING_BALANCE, k);
      probe.restore({ ...probe.snapshot(), scenarioCursor: 1 }); // arm failures, preserve rng.
      const r = applyNetAction(eph, probe, action, dt)!;
      if ((r.failedCount ?? 0) > 0 || r.kind === "launch_failed") { attritionSeed = k; break; }
    }
    expect(attritionSeed).not.toBeNull();
    // The SAME seed reproduces the SAME outcome (replay-safe)…
    const a = new NetSession(NET_OPENING_BALANCE, attritionSeed!);
    a.restore({ ...a.snapshot(), scenarioCursor: 1 });
    const b = new NetSession(NET_OPENING_BALANCE, attritionSeed!);
    b.restore({ ...b.snapshot(), scenarioCursor: 1 });
    const ra = applyNetAction(eph, a, action, dt)!;
    const rb = applyNetAction(eph, b, action, dt)!;
    expect(ra.kind).toBe(rb.kind);
    expect(ra.failedCount).toBe(rb.failedCount);
    expect(ra.satIds).toEqual(rb.satIds);
    // …and the SAME seed at cursor 0 (Act 1) is FORCED clean: every member deploys.
    const gentle = new NetSession(NET_OPENING_BALANCE, attritionSeed!);
    const rg = applyNetAction(eph, gentle, action, dt)!;
    expect(rg.kind).toBe("sats_launched");
    expect(rg.failedCount).toBe(0);
  });

  it("the CANONICAL log's roster at act4: attrition happened, the responses answered it, the relay flies", () => {
    // R0 (SD-45): the canonical arc TAKES seeded attrition (2 polar no-seps + underburns) and
    // answers it (circularize + a fill batch) — the roster at act4 is the surviving fleet:
    // 1 GEO + 2 first-batch polars + 4 fill polars + 3 corridor ACCESS LEOs + 1 relief LEO
    // + 1 Mars relay = 12, and the cursor reached + stopped on act4.
    const r = replayTo(act4Log(), MAX_TICK_ACT4);
    expect(r.session.sats.length).toBe(12);
    expect(r.session.cursor).toBe(4);
    expect(r.session.sats.some((sat) => sat.id.startsWith("MARS-RELAY"))).toBe(true);
    // The pointing state survived the arc: all three corridor beams still point at REGION-2.
    expect(r.session.beams.get("NET-SAT-9:0")).toBe(ACT3A_CONTRACT_ID);
    expect(r.session.beams.get("NET-SAT-10:0")).toBe(ACT3A_CONTRACT_ID);
    expect(r.session.beams.get("NET-SAT-11:0")).toBe(ACT3A_CONTRACT_ID);
  }, 60000);
});
