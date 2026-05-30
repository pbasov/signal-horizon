import { describe, it, expect } from "vitest";
import { loadEphemeris } from "./system-data";
import { mixInt, mixFloat, mixString } from "./state-hash";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
import {
  deployGround,
  launchSat,
  KIND_DEPLOY_GROUND,
  KIND_LAUNCH_SAT,
  type SimAction,
} from "./action";
import { BuildSession } from "./m2/session";
import { applyBuildAction } from "./m2/apply-build-action";
import { GeodesicGrid } from "./coverage/grid";
import { DemandField } from "./coverage/demand";
import { scoreCoverageAt } from "./coverage/score";
import type { Vec3 } from "./ephemeris";

/**
 * M2c BUILD-LOOP DETERMINISM REPLAY (the placeable-asset roster + launch market).
 *
 * --- WHAT THIS GUARDS -------------------------------------------------------
 * The M2c build session is a SEPARATE world from the M1 cache/economy session, so
 * it carries its OWN replay golden — the M1 golden 544847093270497462n is UNTOUCHED
 * (m1-session-replay.test.ts still pins it). This proves the build-the-monument
 * loop is deterministic via the action log: replay the same seed + dt + a log of
 * DEPLOY + LAUNCH actions through a BuildSession, and the ROSTER (every ground
 * station's lat/lon + every launched sat's orbit), the € BALANCE, and the launch
 * PRNG state reproduce bit-identically — INCLUDING a launch FAILURE (the failure
 * roll is drawn from the seeded splitmix64 PRNG, so it replays).
 *
 * The build session has no per-tick step(); it is event-driven (state changes only
 * on a logged action), so the replay applies each build action at its recorded tick
 * via the SHARED applyBuildAction — the SAME code path main.ts uses live.
 *
 * Plus the COVERAGE-GROWS invariant: the covered-demand fraction at the end of the
 * build sequence is strictly greater than at the start (the monument grew).
 */

const SEED = 1234567n;
const GOLDEN_DT = 1 / 60;

/** The recorded build sequence: deploy three stations + launch four sats (LEO/MEO/
 * GEO), at increasing ticks. One launch is engineered to FAIL on this PRNG stream
 * (asserted below) so the failure path is exercised in the golden. */
function buildLog() {
  const sg = saveGame(SEED, GOLDEN_DT, { system: "data/system.json" });
  addAction(sg, deployGround(1, 100)); // SOUTH ASIA
  addAction(sg, deployGround(3, 200)); // NORTH ATLANTIC EU
  addAction(sg, launchSat("leo_53", 300));
  addAction(sg, deployGround(5, 400)); // SUB-SAHARAN AFRICA
  addAction(sg, launchSat("meo_63", 500));
  addAction(sg, launchSat("geo_eq", 600));
  addAction(sg, launchSat("leo_53", 700));
  return sg;
}

/**
 * Fold the build session's mutable state into a u64 (reusing the state-hash
 * primitives). In a fixed order: balance (double) + launchedCount (int) + the PRNG
 * state (u64) + per-asset, in roster order, a kind tag + every numeric field (the
 * lat/lon for a ground station, the orbital elements for a sat). Everything folded
 * is bit-stable across runs.
 */
function buildStateHash(s: BuildSession): bigint {
  const snap = s.snapshot();
  let acc = mixFloat(0n, snap.balance);
  acc = mixInt(acc, BigInt(snap.launchedCount));
  acc = mixInt(acc, BigInt(snap.rngState));
  acc = mixInt(acc, BigInt(snap.roster.nextId));
  acc = mixInt(acc, BigInt(snap.roster.assets.length));
  for (const a of snap.roster.assets) {
    acc = mixString(acc, a.id);
    acc = mixString(acc, a.kind);
    if (a.kind === "ground") {
      acc = mixString(acc, a.bodyId);
      acc = mixFloat(acc, a.latRad);
      acc = mixFloat(acc, a.lonRad);
      acc = mixFloat(acc, a.altitudeM);
      acc = mixFloat(acc, a.eirp);
    } else {
      const o = a.orbit;
      acc = mixString(acc, o.parentId);
      acc = mixFloat(acc, o.aM);
      acc = mixFloat(acc, o.e);
      acc = mixFloat(acc, o.incRad);
      acc = mixFloat(acc, o.raanRad);
      acc = mixFloat(acc, o.argpRad);
      acc = mixFloat(acc, o.m0Rad);
      acc = mixFloat(acc, o.epochS);
      acc = mixFloat(acc, o.muParent);
      acc = mixFloat(acc, a.eirp);
    }
  }
  return acc;
}

interface ReplayResult {
  hash: bigint;
  balance: number;
  session: BuildSession;
}

/**
 * Replay a build action log through a BuildSession: apply each DEPLOY/LAUNCH action
 * at its recorded tick via the SHARED applyBuildAction (same path as main.ts).
 * Returns the folded state + the session itself.
 */
function replay(sg: ReturnType<typeof saveGame>): ReplayResult {
  const eph = loadEphemeris();
  const session = new BuildSession();
  // Index build actions by tick, applied in log order at that tick.
  const byTick = new Map<number, SimAction[]>();
  let maxTick = 0;
  for (const a of sg.actions) {
    if (a.kind === KIND_DEPLOY_GROUND || a.kind === KIND_LAUNCH_SAT) {
      const list = byTick.get(a.atTick) ?? [];
      list.push(a);
      byTick.set(a.atTick, list);
      if (a.atTick > maxTick) maxTick = a.atTick;
    }
  }
  for (let tick = 0; tick <= maxTick; tick++) {
    const list = byTick.get(tick);
    if (list !== undefined) for (const a of list) applyBuildAction(eph, session, a, sg.dt);
  }
  return { hash: buildStateHash(session), balance: session.balance, session };
}

/** Covered-demand fraction of a session's LIVE roster at sim-time t (the monument size). */
function coveredFraction(session: BuildSession, t: number): number {
  const eph = loadEphemeris();
  const grid = GeodesicGrid.build();
  const demand = DemandField.build(grid);
  const positions: Vec3[] = session.worldPositions(eph, t);
  const eirps = session.roster.eirps();
  const earth = eph.position("earth", t);
  const earthR = eph.radiusMeters("earth");
  return scoreCoverageAt(grid, demand, eirps, positions, earth, earthR).coveredDemandFraction;
}

// ---------------------------------------------------------------------------
// PINNED M2c build-loop replay golden (deploy + launch + failure, roster + €).
// SEPARATE from the M1 golden 544847093270497462n (a different world). Bootstrapped
// by running the replay once; pinned here as the regression guard. Any change to
// the roster shape, the launch presets, the deploy sites, the launch PRNG draw, or
// the starter roster moves this value.
// ---------------------------------------------------------------------------
const BUILD_REPLAY_GOLDEN = 2503511112643458855n;

describe("m2c build-loop replay golden — deploy + launch market + roster", () => {
  it("pins the build-session replay state hash for the golden build log (regression guard)", () => {
    const r = replay(buildLog());
    expect(r.hash).toBe(BUILD_REPLAY_GOLDEN);
  });

  it("a logged build sequence is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replay(buildLog());
    const b = replay(buildLog());
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
    expect(a.session.snapshot()).toEqual(b.session.snapshot());
  });

  it("LIVE == REPLAY: applying the same actions directly reproduces the scheduler-style replay", () => {
    const eph = loadEphemeris();
    const live = new BuildSession();
    for (const a of buildLog().actions) {
      if (a.kind === KIND_DEPLOY_GROUND || a.kind === KIND_LAUNCH_SAT) {
        applyBuildAction(eph, live, a, GOLDEN_DT);
      }
    }
    const replayed = replay(buildLog());
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.balance).toBe(replayed.balance);
  });

  it("the build log exercises a launch FAILURE deterministically (the seeded-PRNG risk)", () => {
    // Drive the launches through a fresh session, recording each outcome, and assert
    // at least one launch FAILED (and that the same seed gives the same outcomes).
    const eph = loadEphemeris();
    const s1 = new BuildSession();
    const s2 = new BuildSession();
    const outcomes1: string[] = [];
    const outcomes2: string[] = [];
    for (const a of buildLog().actions) {
      if (a.kind === KIND_LAUNCH_SAT) {
        outcomes1.push(applyBuildAction(eph, s1, a, GOLDEN_DT)!.kind);
        outcomes2.push(applyBuildAction(eph, s2, a, GOLDEN_DT)!.kind);
      } else if (a.kind === KIND_DEPLOY_GROUND) {
        applyBuildAction(eph, s1, a, GOLDEN_DT);
        applyBuildAction(eph, s2, a, GOLDEN_DT);
      }
    }
    expect(outcomes1).toEqual(outcomes2); // same seed → same failure pattern
    expect(outcomes1).toContain("launch_failed"); // a failure is exercised
    expect(outcomes1).toContain("sat_launched"); // and a success
  });

  it("COVERAGE GROWS: the covered-demand fraction rises across the build sequence (the monument)", () => {
    const t = 1000; // an arbitrary sim-time the sats have orbited to.
    const start = new BuildSession();
    const startFrac = coveredFraction(start, t);
    const r = replay(buildLog());
    const endFrac = coveredFraction(r.session, t);
    // Building deployed stations + launched sats, so the covered-demand fraction at
    // the end is strictly greater than the starter roster's (the web grew).
    expect(endFrac).toBeGreaterThan(startFrac);
    expect(endFrac).toBeGreaterThan(0);
  });

  it("a build action only mutates on a build kind; an unknown action is a no-op", () => {
    const eph = loadEphemeris();
    const session = new BuildSession();
    const before = session.snapshot();
    const noop: SimAction = { kind: "noop", atTick: 0, payload: {} };
    expect(applyBuildAction(eph, session, noop, GOLDEN_DT)).toBeNull();
    expect(session.snapshot()).toEqual(before);
  });

  it("the build SaveGame survives the JSON round-trip and reproduces the hash", () => {
    const sg = buildLog();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    expect(reloaded!.actions.some((a) => a.kind === KIND_LAUNCH_SAT)).toBe(true);
    expect(reloaded!.actions.some((a) => a.kind === KIND_DEPLOY_GROUND)).toBe(true);
    const a = replay(sg);
    const b = replay(reloaded!);
    expect(b.hash).toBe(a.hash);
  });
});
