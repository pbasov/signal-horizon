import { describe, it, expect } from "vitest";
import { Ephemeris } from "./ephemeris";
import { mixInt, mixFloat, mixString } from "./state-hash";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
import {
  netLaunch,
  netAccept,
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
  // The FAULT cursor — 0 in Act 1 (the fault generator is fenced behind act3a/C2). Folded now
  // so enabling faults in C2 moves this value rather than reshaping the fold.
  const faultCursor = 0;
  acc = mixInt(acc, BigInt(faultCursor));
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
// PINNED net/ M1 arrival-sequence replay golden — the full ACT-1 + ACT-2 arc (scenario emit +
// LAUNCH the default GEO PARK + ACCEPT REGION-0 + the act1 gate; then the N=4 LEO BATCH + ACCEPT
// REGION-1 (availability axis) + the region held across a full hand-off cycle + the act2 gate).
// A SEPARATE world from the M1 cache golden 544847093270497462n and the M2 build golden
// 8431658617016421069n. Bootstrapped by running the replay once; pinned here as the regression
// guard. Any change to the scenario table/gates, the contract/session/router model, the launch
// boundary, the availability fold, or the state-hash fold moves this value.
//
// RE-PINNED IN B3 (the M3a precedent, documented in decisions.md):
//   PRE-B3 (Act-1 only)  10424955607522567073n
//   B3     (Act-1+Act-2 equatorial REGION-1)  12864209889064023665n
//   SD-40-B3-FIX (high-lat REGION-1)  <below>
// What moved it in B3: the Act-2 REGION-1 contract (availability axis), the lastAvailability fold,
// the cleanServedSinceS gate-hardening fold, the wasteLoggedSats fold, and the N=4 batch phase
// spread. What moved it in the SD-40 B3 FIX (the teaching-bug fix, documented in decisions.md):
// REGION-1 was re-placed from equatorial lon 5°E to HIGH LATITUDE (lat 70°, lon 5°E) — beyond the
// parked equatorial GEO's measured ~64° footprint edge, so the GEO ALONE cannot serve it (the
// latitude wall) — the LEO_SWEEP preset was re-tuned to a POLAR inclination (90°, subLon 5°), and
// a co-located high-lat ground station (GROUND-1) was added so the inclined constellation's bent
// path closes. The measured zero-gap N stays 4 (so the batch + phasing assist are unchanged); the
// REGION-1 placement + preset inclination + the second ground + the multi-ground bridge moved the
// fold. The two existing goldens are DIFFERENT worlds (neither imports net/) and stay byte-for-byte
// UNTOUCHED (M1 cache 544847093270497462n, M2 build 8431658617016421069n).
// ---------------------------------------------------------------------------
const NET_REPLAY_GOLDEN = 260489051471786347n;

describe("net/ A3+B3 — M1 arrival-sequence replay golden (act1 GEO + act2 N=4 constellation)", () => {
  it("pins the net-session replay state hash for the act1→act2 action log (regression guard)", () => {
    const r = replay(act2Log());
    expect(r.hash).toBe(NET_REPLAY_GOLDEN);
  });

  it("a logged act1→act2 sequence is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replay(act2Log());
    const b = replay(act2Log());
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
    expect(a.session.snapshot()).toEqual(b.session.snapshot());
  }, 30000); // two full 21 600-tick replays over the now-two-ground network — generous headroom.

  it("LIVE == REPLAY: stepping + applying the same actions directly reproduces the replay (deep snapshot incl. SatOrbit f64s + the new act2 fields)", () => {
    const eph = Ephemeris.build({});
    const live = new NetSession();
    const byTick = new Map<number, SimAction[]>();
    for (const a of act2Log().actions) {
      if (isNetKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    for (let tick = 0; tick <= MAX_TICK; tick++) {
      const t = tick * GOLDEN_DT;
      live.step(eph, t, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyNetAction(eph, live, a, GOLDEN_DT);
    }
    const replayed = replay(act2Log());
    // Deep-equal the whole snapshot (the roster's full SatOrbit f64s + cleanServedSinceS +
    // wasteLoggedSats + per-contract lastAvailability included) + the hash.
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.balance).toBe(replayed.balance);
    expect(netStateHash(live)).toBe(replayed.hash);
  }, 30000); // one live run + one replay over the two-ground network — generous headroom.

  it("the net SaveGame survives the JSON round-trip and reproduces the hash (incl. the act2 batch phase spread)", () => {
    const sg = act2Log();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_LAUNCH)).toBe(true);
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_ACCEPT)).toBe(true);
    // The batch launch's phaseSpreadRad survives the round-trip (non-zero ⇒ written to the wire).
    const batch = reloaded!.actions.find(
      (a) => a.kind === KIND_NET_LAUNCH && a.payload.count === ACT2_ZERO_GAP_N,
    );
    expect(batch).toBeDefined();
    expect(batch!.payload.phaseSpreadRad).toBeCloseTo(ACT2_PHASE_SPREAD_RAD, 12);
    // dt survives bit-exactly via dt_bits, so the replay reproduces the pinned hash.
    expect(reloaded!.dt).toBe(GOLDEN_DT);
    const a = replay(sg);
    const b = replay(reloaded!);
    expect(b.hash).toBe(a.hash);
    expect(b.hash).toBe(NET_REPLAY_GOLDEN);
  }, 30000); // two full replays over the two-ground network — generous headroom.

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
