import { describe, it, expect } from "vitest";
import { Ephemeris } from "./ephemeris";
import { mixInt, mixFloat, mixString } from "./state-hash";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
import {
  netLaunch,
  netAccept,
  netSetPrefer,
  KIND_NET_LAUNCH,
  KIND_NET_ACCEPT,
  KIND_NET_SET_PREFER,
  type SimAction,
} from "./action";
import { NetSession, NET_RNG_SEED } from "./net/session";
import { applyNetAction } from "./net/apply-action";
import { GEO_PARK, LEO_SWEEP, resolveOrbit, A1_LEO_PERIOD_S, A1_GEO_PERIOD_S } from "./net/world";
import { SLA_AXIS_ORDINAL, type SlaAxis } from "./net/contract";
import {
  ACT1_CONTRACT_ID,
  ACT2_CONTRACT_ID,
  ACT3A_CONTRACT_ID,
  ACT2_ZERO_GAP_N,
  ACT2_SLA_AVAIL,
  NET_HANDOFF_CYCLE_S,
  NET_ACT2_REGION,
} from "./net/scenario";
import {
  NET_ACT1_GROUND,
  NET_ACT2_GROUND,
  NET_ACT2_REGION_LAT_RAD,
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

/** Sim-time the golden replay runs to. Comfortably past the Act-1 LAUNCH+ACCEPT+gate AND the
 * full Act-2 arc: the second demand (REGION-1) is emitted on the act1 gate, the N=4 LEO
 * constellation is launched as a BATCH + accepted, and the act2 gate fires after the region is
 * held SERVED across ≥1 full hand-off cycle (NET_HANDOFF_CYCLE_S = 300 s). The act2 gate fires at
 * t≈323 s; 360 sim-seconds = 21 600 ticks runs comfortably past it (the cursor reaches act3a).
 * In ticks: t/DT. */
const MAX_T_SECONDS = 360;
const MAX_TICK = Math.round(MAX_T_SECONDS / GOLDEN_DT);

/** LAUNCH the default GEO PARK at this tick (the pre-seeded default that already works). */
const TICK_LAUNCH = 600; // t = 10 sim-seconds.
/** ACCEPT the Act-1 contract shortly after the launch — the parked GEO is already serving the
 * whole disc, so it earns from the first served step (the launch→cover→paid chain). */
const TICK_ACCEPT = 1200; // t = 20 sim-seconds.

/** ACT 2: LAUNCH the N=4 LEO_SWEEP constellation as ONE BATCH (the §3.4 launch-as-a-batch verb)
 * shortly after the act1 gate emits REGION-1 (at TICK_ACCEPT+1). count = ACT2_ZERO_GAP_N (the
 * measured zero-gap minimum), evenly m0-phased (phaseSpreadRad = 2π/count) so one sat rises as
 * another sets — the hand-off constellation. */
const TICK_BATCH = 1300; // t ≈ 21.7 sim-seconds.
/** ACT 2: ACCEPT REGION-1 (availability axis active+visible) just after the batch is up, so the
 * constellation holds it SERVED from the first active step (its rolling availability = 1.0). */
const TICK_ACCEPT2 = 1400; // t ≈ 23.3 sim-seconds.

/** The even in-plane mean-anomaly spread for the N=4 batch (= 2π / count) — the phasing that makes
 * the constellation hand off (the B2 batch wire term). */
const ACT2_PHASE_SPREAD_RAD = TAU / ACT2_ZERO_GAP_N;

/**
 * The recorded ACT-1 + ACT-2 action sequence (the M1 arrival arc through act2):
 *   ACT 1 — LAUNCH the default GEO PARK (radians + SI on the wire), ACCEPT the scenario-emitted
 *           equatorial REGION-0; the parked GEO serves it, it earns €, and the act1 gate fires
 *           (which deterministically emits REGION-1 inside the same step).
 *   ACT 2 — LAUNCH the N=4 LEO_SWEEP constellation as ONE BATCH (count = ACT2_ZERO_GAP_N, evenly
 *           m0-phased), then ACCEPT REGION-1 (availability axis active). The constellation holds
 *           REGION-1 SERVED across a full hand-off cycle and the act2 gate fires.
 *
 * The scenario engine OFFERS both contracts deterministically inside step (no action), so the log
 * is just the player's inputs — launch, accept, batch-launch, accept. `batchCount` parameterises
 * the act2 batch so a lone-LEO / over-build run reuses the same builder.
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
  // ACT 2 — the N=4 LEO_SWEEP constellation as ONE batch (the hand-off constellation), then accept
  // the availability-axis REGION-1. The batch member i is m0-phased by i·(2π/count).
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
  return sg;
}

/** The pinned golden log: the full act1→act2 arc with the measured zero-gap N=4 batch. */
function act2Log() {
  return actLog(ACT2_ZERO_GAP_N);
}

// ── ACT 3a (C1b): the escalation → oversubscription → re-tame arc (the re-pin driver) ──────────

/** The DEG→RAD helper for the equatorial-LEO launches (act3a corridor). */
const ACT3A_DEG_RAD = Math.PI / 180;

/** ACT 3a: the player launches a short EQUATORIAL LEO (inc 0) for the latency corridor at this
 * tick (the parked GEO can't meet REGION-2's low latency SLA; a short LEO route does). */
const TICK_EQ_LEO_1 = 19461; // shortly after the act2 gate fires (cursor reaches act3a ~t=323).
/** ACT 3a: ACCEPT the REGION-2 corridor (latency axis active) just after its short path is up. */
const TICK_ACCEPT_R2 = 19521;
/** ACT 3a: the RELIEF BY EXCEPTION after escalation tips the shared link near-breach — a PARALLEL
 * equatorial LEO + a net_set_prefer on the latency-tolerant trunk REGION-0 (made bandwidth-share-
 * aware) so it YIELDS the short corridor path to the latency-critical REGION-2, splitting the
 * shared sat. Fixed tick (the dip is witnessed by ~t=429; this lands just after). */
const TICK_RELIEF = 25800;

/**
 * The recorded ACT-1 → ACT-2 → ACT-3a action sequence (the M1 arrival arc THROUGH the act3a
 * re-tame — the C1b golden driver):
 *   ACT 1/2 — as {@link actLog} (GEO over REGION-0; the polar N=4 over REGION-1; both gates fire).
 *   ACT 3a — the act3a beat (emitted inside step when the act2 gate fires) enables ESCALATION +
 *            offers REGION-2 (the equatorial latency corridor). The player launches a short
 *            equatorial LEO + ACCEPTS REGION-2 (latency met — the GEO ceiling felt, a LEO passes);
 *            escalation grows the shared-link load past capacity (the bandwidth axis flips on),
 *            the corridor dips near-breach (binary bite — breachSecondsAccum accrues), and the
 *            player RE-ENGINEERS BY EXCEPTION (a parallel LEO + net_set_prefer on REGION-0) to
 *            split the shared sat ⇒ re-tamed ⇒ the act3a gate fires.
 */
function act3aLog() {
  const sg = act2Log();
  // The short equatorial LEO for the latency corridor (inc 0; LEO_SWEEP is polar).
  addAction(
    sg,
    netLaunch(
      { presetId: "EQ_LEO", semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: 1.5 * ACT3A_DEG_RAD, count: 1 },
      TICK_EQ_LEO_1,
    ),
  );
  addAction(sg, netAccept(ACT3A_CONTRACT_ID, TICK_ACCEPT_R2));
  // The relief: a parallel equatorial LEO + the prefer override on the latency-tolerant trunk.
  addAction(
    sg,
    netLaunch(
      { presetId: "EQ_LEO", semiMajorM: LEO_SWEEP.semiMajorM, incRad: 0, subLonRad: -1.5 * ACT3A_DEG_RAD, count: 1 },
      TICK_RELIEF,
    ),
  );
  addAction(sg, netSetPrefer(ACT1_CONTRACT_ID, 1, 50, 0, TICK_RELIEF));
  return sg;
}

/** The act3a replay runs past the relief so the re-tame latches + the act3a gate fires (t ≈ 470 s,
 * 28 200 ticks). The act3a-SPECIFIC invariant sub-tests stop here (escalation grew, the gate is
 * state-gated, the congestion-fold restore) — the act3b faults that begin at t≈430 are dormant
 * enough at this horizon that those behaviours hold; the GOLDEN itself is pinned at the longer
 * act3b horizon below. */
const MAX_T_ACT3A_SECONDS = 470;
const MAX_TICK_ACT3A = Math.round(MAX_T_ACT3A_SECONDS / GOLDEN_DT);

// ── ACT 3b (C2): faults — the chaos kitten, mild-first (the re-pin driver) ──────────────────────
//
// The act3b beat (emitted INSIDE step when the act3a gate fires, FENCED behind it) ENABLES the
// seeded fault generator + seeds the MILD-FIRST scripted pair: a Degradation (self-recovers,
// unwarned), THEN a Telegraphed failure (warning + countdown). The faults draw off the SAME seeded
// SimRng the session already owns (the M2 launch-failure-roll pattern — NO new action, NO new
// seed), so the whole spectrum folds + replays bit-stably. The action log is IDENTICAL to the
// act3a arc (the faults are scenario-seeded, not player actions); only the HORIZON extends so both
// scripted faults play out (the Degradation fires ~t=430 + self-recovers by ~t=460 ⇒ the 3b gate
// fires; the Telegraphed then begins ~t=460 + drops by ~t=505). We run to t=520 so the whole arc
// is in the fold + the network has weathered both.
const act3bLog = act3aLog;

/** The act3b replay runs past BOTH scripted faults (the Degradation self-recovers ~t=460 ⇒ the 3b
 * gate fires; the Telegraphed countdown begins ~t=460 + drops ~t=505): t = 520 s, 31 200 ticks. */
const MAX_T_ACT3B_SECONDS = 520;
const MAX_TICK_ACT3B = Math.round(MAX_T_ACT3B_SECONDS / GOLDEN_DT);

/** Replay an action log through a NetSession to a given max tick (the act3a arc needs a longer
 * horizon than the act1/act2 arc). Mirrors {@link replay} (step then post-drain action). */
function replayTo(sg: ReturnType<typeof saveGame>, maxTick: number): ReplayResult {
  const eph = Ephemeris.build({});
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
  return kind === KIND_NET_LAUNCH || kind === KIND_NET_ACCEPT || kind === KIND_NET_SET_PREFER;
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
  acc = mixInt(acc, BigInt(snap.chosenSatByContract.length));
  for (const [cid, satId] of snap.chosenSatByContract) {
    acc = mixString(acc, cid);
    acc = mixString(acc, satId);
  }
  acc = mixInt(acc, BigInt(snap.nearBreachWitnessed.length));
  for (const id of snap.nearBreachWitnessed) acc = mixString(acc, id);
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
  const eph = Ephemeris.build({});
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
// What moved it in SD-40-C2 (the FAULT re-pin, the SD-40 chained-re-pin pattern): the act3b beat
// (emitted INSIDE step when the act3a gate fires, FENCED behind it) now ENABLES the seeded fault
// generator + seeds the MILD-FIRST scripted pair (a Degradation, then a Telegraphed failure) drawn
// off the SAME seeded SimRng (the M2 launch-failure-roll pattern — NO new action / NO new seed).
// The golden log is IDENTICAL to the act3a arc (the faults are scenario-seeded, not actions); only
// the HORIZON extends (470 s → 520 s) so both scripted faults play out (the Degradation self-
// recovers ~t=460 ⇒ the 3b gate fires; the Telegraphed countdown begins ~t=460 + drops ~t=505). The
// fold gained the C2 ADDITIONS — faultsOn (int), the active FaultState[] (satId|kind|cause|the three
// predictability-seed sim-times + the degraded-capacity factor), the pending mild-first script queue,
// the mild-first gate stamp (lastScriptedFaultSatId), the served-through set, and the weather +
// surfaced-shortfall witnesses (ints) — REPLACING the old fault-cursor 0 placeholder — PLUS the
// value moves already in the fold (the degraded sat congesting REGION-2, the longer horizon's
// escalated loads + accrued served-time, the cursor advancing to act4 + the new gate tick). The
// two existing goldens are DIFFERENT worlds (neither imports net/) and stay byte-for-byte UNTOUCHED
// (M1 cache 544847093270497462n, M2 build 8431658617016421069n).
// ---------------------------------------------------------------------------
const NET_REPLAY_GOLDEN = 11632456535472871375n;

describe("net/ A3+B3+C1b+C2 — M1 arrival-sequence replay golden (act1 GEO + act2 N=4 + act3a escalation/re-tame + act3b faults mild-first)", () => {
  it("pins the net-session replay state hash for the act1→act2→act3a→act3b action log (regression guard)", () => {
    const r = replayTo(act3bLog(), MAX_TICK_ACT3B);
    expect(r.hash).toBe(NET_REPLAY_GOLDEN);
  }, 60000);

  it("a logged act1→act2→act3a→act3b sequence is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replayTo(act3bLog(), MAX_TICK_ACT3B);
    const b = replayTo(act3bLog(), MAX_TICK_ACT3B);
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
    expect(a.session.snapshot()).toEqual(b.session.snapshot());
  }, 60000);

  it("LIVE == REPLAY: stepping + applying the same actions directly reproduces the replay (deep snapshot incl. SatOrbit f64s + the act3a + act3b fold fields)", () => {
    const eph = Ephemeris.build({});
    const live = new NetSession();
    const byTick = new Map<number, SimAction[]>();
    for (const a of act3bLog().actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    for (let tick = 0; tick <= MAX_TICK_ACT3B; tick++) {
      const t = tick * GOLDEN_DT;
      live.step(eph, t, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, live, a, GOLDEN_DT);
    }
    const replayed = replayTo(act3bLog(), MAX_TICK_ACT3B);
    // Deep-equal the whole snapshot (the roster's full SatOrbit f64s + the act3a fold fields +
    // the act3b fault fields — faultsOn / activeFaults / the script queue / the witnesses) + hash.
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.balance).toBe(replayed.balance);
    expect(netStateHash(live)).toBe(replayed.hash);
  }, 60000); // one live run + one replay over the act3b arc — generous headroom.

  it("the net SaveGame survives the JSON round-trip and reproduces the hash (incl. the act2 batch phase spread + the act3a prefer override)", () => {
    const sg = act3bLog();
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
    // dt survives bit-exactly via dt_bits, so the replay reproduces the pinned hash.
    expect(reloaded!.dt).toBe(GOLDEN_DT);
    const a = replayTo(sg, MAX_TICK_ACT3B);
    const b = replayTo(reloaded!, MAX_TICK_ACT3B);
    expect(b.hash).toBe(a.hash);
    expect(b.hash).toBe(NET_REPLAY_GOLDEN);
  }, 60000); // two full act3b-arc replays — generous headroom.

  it("THE ACT-1 LOOP CLOSES: REGION-0 is SERVED, EARNS €, and the act1 GATE fired deterministically", () => {
    const r = replay(act2Log());
    const c = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID);
    expect(c).toBeDefined();
    // Accepted → active, served the whole disc (binary 1.0), earned € (the wallet rose).
    expect(["active", "completed"]).toContain(c!.state);
    expect(c!.lastServedFraction).toBe(1.0);
    expect(c!.servedSecondsAccum).toBeGreaterThan(0);
    expect(c!.earnedEur).toBeGreaterThan(0);
    expect(r.balance).toBeGreaterThan(0);
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
    // 7 sats (1 GEO + 6 LEOs) − ACT2_ZERO_GAP_N (4) = 3 surplus, silently logged for Act 3.
    expect(over.session.snapshot().wasteLoggedSats).toBe(7 - ACT2_ZERO_GAP_N);
    // The pinned N=4 run logs exactly (1 GEO + 4 LEOs) − 4 = 1 surplus (the GEO).
    const pinned = replay(act2Log());
    expect(pinned.session.snapshot().wasteLoggedSats).toBe(5 - ACT2_ZERO_GAP_N);
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
    // The relief SPLIT the shared sat: the corridor REGION-2's load alone sits under capacity (the
    // re-tamed steady state — measured off its currently-chosen sat, which carries only its load).
    const r2Sat = r.session.lastSolveFor(r2.id)?.path?.[1];
    if (r2Sat !== undefined) expect(r.session.loadOnSat(r2Sat)).toBeLessThan(1.5); // capacity.
  }, 60000);

  it("the act3a gate does NOT fire before the re-tame (state-gated): stopping at the relief tick − 1 leaves the cursor on act3a", () => {
    const r = replayTo(act3aLog(), TICK_RELIEF - 1);
    expect(r.session.cursor).toBe(2); // still on act3a — the cycle is not yet demonstrated.
    expect(r.session.escalationReTamed()).toBe(false);
    // The dip is REAL: the corridor accrued breach past the near-breach threshold under congestion
    // (binary bandwidth bite — proving breachSecondsAccum actually accrues, the HIGH-1 fix).
    const r2 = r.session.contracts.find((x) => x.id === ACT3A_CONTRACT_ID)!;
    expect(r2.activeAxes.has("bandwidth")).toBe(true);
    expect(r2.breachSecondsAccum).toBeGreaterThan(0);
  }, 60000);

  it("RESTORE-REPLAY for the congestion + FAULT fold: restore-then-step == continuous-run (loadBySat re-derived from the folded chosen-sat map — the MED desync fix; the active faults + the mild-first script queue carry across the restore boundary — the C2 fault fold)", () => {
    // Run continuously to a mid-act3b tick (escalation on, congestion live, AND a fault active —
    // SPLIT lands AFTER the Degradation has fired ~t=430), snapshot, restore into a fresh session,
    // then step BOTH the original and the restored copy forward the SAME ticks with the SAME post-
    // step actions — the two must stay bit-identical (the congestion state AND the fault state — the
    // active faults + the mild-first script queue + the served-through set — are pure functions of
    // FOLDED state + the folded rng, so the restore reproduces a continuous run incl. the seeded roll).
    const eph = Ephemeris.build({});
    const sg = act3bLog();
    const byTick = new Map<number, SimAction[]>();
    for (const a of sg.actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    const SPLIT = 26000; // mid-act3b: escalation on, REGION-2 routing live, the Degradation active.
    const cont = new NetSession();
    for (let tick = 0; tick <= SPLIT; tick++) {
      cont.step(eph, tick * GOLDEN_DT, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, cont, a, GOLDEN_DT);
    }
    // The split lands while a fault is active (the Degradation fired ~t=430) — so the restore must
    // carry the fault fold, not just the congestion fold.
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
    for (let tick = SPLIT + 1; tick <= MAX_TICK_ACT3B; tick++) {
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
    // And the continuous run reproduces the pinned golden (the restore path agrees with the pin).
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

  it("MILD-FIRST: a Degradation fires FIRST (self-recovers), THEN a Telegraphed failure (sequenced in time, scripted off the seeded stream)", () => {
    // Run the whole arc, recording each fault start in order. The first scripted fault is the
    // Degradation; the Telegraphed begins only AFTER the Degradation resolves (the mild-first gate).
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
    // At least the scripted pair fired, in MILD-FIRST order: degradation, then telegraphed.
    const degrIdx = starts.findIndex((e) => e.kind === "degradation");
    const teleIdx = starts.findIndex((e) => e.kind === "telegraphed");
    expect(degrIdx).toBeGreaterThanOrEqual(0);
    expect(teleIdx).toBeGreaterThan(degrIdx); // mild-first: degradation precedes telegraphed.
    // The Telegraphed begins only AFTER the Degradation self-recovers (sequenced in time, not
    // fired together) — its start tick is strictly later than the degradation's.
    expect(starts[teleIdx].tick).toBeGreaterThan(starts[degrIdx].tick);
    // The live causal lever (lowOrbit) named the cause — the scripted pair bites the LEO.
    expect(starts[degrIdx].cause).toBe("lowOrbit");
  }, 60000);

  it("THE 3b GATE FIRES: the player WEATHERED the fault (REGION-0/REGION-1 stayed served through it) + the TRACE surfaced a resilience shortfall ⇒ the cursor advances to act4", () => {
    const r = replayTo(act3bLog(), MAX_TICK_ACT3B);
    // The fault generator engaged (act3b emitted it, fenced behind act3a) + the scripted pair is
    // consumed (both faults played out within the horizon).
    expect(r.session.faultsEnabled).toBe(true);
    expect(r.session.snapshot().faultScriptQueue.length).toBe(0);
    // WEATHERED: the player kept a contract served through a fault's whole lifetime; the TRACE
    // surfaced ≥1 resilience/optimisation shortfall (the predictability seed + the kind-of-fix).
    expect(r.session.weatheredFault()).toBe(true);
    expect(r.session.traceSurfacedShortfall()).toBe(true);
    // THE 3b GATE FIRED ⇒ the cursor advanced PAST act3b to act4 (the final beat), and a 4th gate
    // tick is recorded.
    expect(r.session.cursor).toBeGreaterThanOrEqual(4);
    expect(r.session.snapshot().gateTicks.length).toBeGreaterThanOrEqual(4);
    // The network WEATHERED it: the resilient equatorial REGION-0 + the polar REGION-1 stayed
    // served through the fault (the redundant builder sails through — neither failed).
    const r0 = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID)!;
    const r1 = r.session.contracts.find((x) => x.id === ACT2_CONTRACT_ID)!;
    expect(r0.state).not.toBe("failed");
    expect(r1.state).not.toBe("failed");
    // The trace report is a live readout (the SYSTEM.LOG / shortfall lines) once faults are on.
    expect(r.session.trace).not.toBeNull();
  }, 60000);

  it("the 3b gate does NOT fire before the fault is WEATHERED (state-gated): stopping while the Degradation is still active leaves the cursor on act3b", () => {
    // Stop mid-Degradation (it fires ~t=430 + self-recovers ~t=460; tick 27000 ≈ t=450 is inside it):
    // the player has NOT yet weathered it (the fault has not resolved) ⇒ the cursor is still on act3b.
    const r = replayTo(act3bLog(), 27000);
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
