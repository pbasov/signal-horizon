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
import { GEO_PARK } from "./net/world";
import { SLA_AXIS_ORDINAL, type SlaAxis } from "./net/contract";
import { ACT1_CONTRACT_ID } from "./net/scenario";

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

/** Sim-time the golden replay runs to. Comfortably past the LAUNCH + ACCEPT + the first served
 * steps, so the act1 contract is SERVED, EARNS €, and the act1 GATE has fired (served + € rising)
 * — all in the fold. 200 sim-seconds at DT=1/60 is 12 000 ticks (fast: one parked GEO, one
 * contract). In ticks: t/DT. */
const MAX_T_SECONDS = 200;
const MAX_TICK = Math.round(MAX_T_SECONDS / GOLDEN_DT);

/** LAUNCH the default GEO PARK at this tick (the pre-seeded default that already works). */
const TICK_LAUNCH = 600; // t = 10 sim-seconds.
/** ACCEPT the Act-1 contract shortly after the launch — the parked GEO is already serving the
 * whole disc, so it earns from the first served step (the launch→cover→paid chain). */
const TICK_ACCEPT = 1200; // t = 20 sim-seconds.

/**
 * The recorded Act-1 action sequence: LAUNCH the default GEO PARK (radians + SI on the wire),
 * then ACCEPT the one scenario-emitted equatorial contract. The scenario engine OFFERS the
 * contract deterministically inside step (no action), so the log is just the player's two
 * inputs — launch the default, accept the demand — exactly the Act-1 game.
 */
function act1Log() {
  const sg = saveGame(NET_RNG_SEED, GOLDEN_DT, { game: "net", act: "act1" });
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
  return sg;
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
// PINNED net/ M1 arrival-sequence replay golden (scenario emit + LAUNCH the default GEO PARK +
// ACCEPT the equatorial contract + router serve + revenue + the act1 GATE). A SEPARATE world
// from the M1 cache golden 544847093270497462n and the M2 build golden 8431658617016421069n.
// Bootstrapped by running the replay once; pinned here as the regression guard. Any change to
// the scenario table/gate, the contract/session/router model, the launch boundary, the revenue
// math, or the state-hash fold moves this value. The two existing goldens are DIFFERENT worlds
// and stay UNTOUCHED.
// ---------------------------------------------------------------------------
const NET_REPLAY_GOLDEN = 10424955607522567073n;

describe("net/ A3 — M1 arrival-sequence replay golden (scenario + launch + accept + serve)", () => {
  it("pins the net-session replay state hash for the Act-1 action log (regression guard)", () => {
    const r = replay(act1Log());
    expect(r.hash).toBe(NET_REPLAY_GOLDEN);
  });

  it("a logged Act-1 sequence is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replay(act1Log());
    const b = replay(act1Log());
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
    expect(a.session.snapshot()).toEqual(b.session.snapshot());
  });

  it("LIVE == REPLAY: stepping + applying the same actions directly reproduces the replay (deep snapshot incl. SatOrbit f64s)", () => {
    const eph = Ephemeris.build({});
    const live = new NetSession();
    const byTick = new Map<number, SimAction[]>();
    for (const a of act1Log().actions) {
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
    const replayed = replay(act1Log());
    // Deep-equal the whole snapshot (the roster's full SatOrbit f64s included) + the hash.
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.balance).toBe(replayed.balance);
    expect(netStateHash(live)).toBe(replayed.hash);
  });

  it("the net SaveGame survives the JSON round-trip and reproduces the hash", () => {
    const sg = act1Log();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_LAUNCH)).toBe(true);
    expect(reloaded!.actions.some((a) => a.kind === KIND_NET_ACCEPT)).toBe(true);
    // dt survives bit-exactly via dt_bits, so the replay reproduces the pinned hash.
    expect(reloaded!.dt).toBe(GOLDEN_DT);
    const a = replay(sg);
    const b = replay(reloaded!);
    expect(b.hash).toBe(a.hash);
    expect(b.hash).toBe(NET_REPLAY_GOLDEN);
  });

  it("THE ACT-1 LOOP CLOSES: the scenario-emitted contract is SERVED, EARNS €, and the act1 GATE fired deterministically", () => {
    const r = replay(act1Log());
    const c = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID);
    expect(c).toBeDefined();
    // Accepted → active, served the whole disc (binary 1.0), earned € (the wallet rose).
    expect(["active", "completed"]).toContain(c!.state);
    expect(c!.lastServedFraction).toBe(1.0);
    expect(c!.servedSecondsAccum).toBeGreaterThan(0);
    expect(c!.earnedEur).toBeGreaterThan(0);
    expect(r.balance).toBeGreaterThan(0);
    // THE GATE FIRED at a DETERMINISTIC tick: the cursor advanced past act1 (≥1), and the
    // recorded gate tick is the FIRST served+paid step AFTER accept. The accept lands post-step
    // on TICK_ACCEPT (step ran first, contract still offered), so the first step where it is
    // active + served (1.0) + has earnedEur>0 is the NEXT tick — the gate opens on TICK_ACCEPT+1.
    expect(r.session.cursor).toBeGreaterThanOrEqual(1);
    const snap = r.session.snapshot();
    expect(snap.gateTicks.length).toBeGreaterThanOrEqual(1);
    expect(snap.gateTicks[0]).toBe(TICK_ACCEPT + 1);
  });

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
    // The fallback surfaces the gentle "try GEO PARK" assist once past the idle window with no sat.
    const sf = s.currentShortfall(3 * 3600);
    expect(sf).not.toBeNull();
    expect(sf!.suggestPresetId).toBe("GEO_PARK");
  });

  it("the activeAxes fold is by FIXED ORDINAL — the Act-1 connectivity-only contract folds as [0]", () => {
    const r = replay(act1Log());
    const c = r.session.contracts.find((x) => x.id === ACT1_CONTRACT_ID)!;
    expect(NetSession.foldAxisOrdinals(c.activeAxes)).toEqual([SLA_AXIS_ORDINAL.connectivity]);
    // The fold key never depends on insertion order (a future axis appends with its ordinal).
    const multi = new Set<SlaAxis>();
    multi.add("bandwidth");
    multi.add("connectivity");
    expect(NetSession.foldAxisOrdinals(multi)).toEqual([0, 3]);
  });
});
