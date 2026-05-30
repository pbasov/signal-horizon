import { describe, it, expect } from "vitest";
import { loadEphemeris } from "./system-data";
import { mixInt, mixFloat, mixString } from "./state-hash";
import { saveGame, addAction, saveFromJSON, saveToJSON } from "./save";
import {
  deployGround,
  launchSat,
  acceptContract,
  declineContract,
  KIND_DEPLOY_GROUND,
  KIND_LAUNCH_SAT,
  KIND_ACCEPT_CONTRACT,
  KIND_DECLINE_CONTRACT,
  type SimAction,
} from "./action";
import { BuildSession } from "./m2/session";
import { applyBuildAction } from "./m2/apply-build-action";
import { GeodesicGrid } from "./coverage/grid";
import { scoreCoverageAt } from "./coverage/score";
import type { Vec3 } from "./ephemeris";

/**
 * M2 BUILD-LOOP DETERMINISM REPLAY (placeable-asset roster + launch market + M2d
 * contracts + coverage revenue — the loop CLOSES here).
 *
 * --- WHAT THIS GUARDS -------------------------------------------------------
 * The M2 build session is a SEPARATE world from the M1 cache/economy session, so it
 * carries its OWN replay golden — the M1 golden 544847093270497462n is UNTOUCHED
 * (m1-session-replay.test.ts still pins it). This proves the WHOLE build-the-monument
 * loop is deterministic via the action log + the per-tick economy step:
 *   - DEPLOY + LAUNCH (incl. a seeded launch FAILURE) reproduce the ROSTER + the
 *     launch PRNG state bit-identically (the M2c guarantee, preserved);
 *   - M2d: the per-tick BuildSession.step() OFFERS contracts deterministically off the
 *     SAME seeded PRNG, accrues coverage revenue into the wallet (DT-invariant), and
 *     advances each contract's state machine — so the CONTRACTS + the BALANCE + the
 *     generator cursor all fold into the replay hash.
 *
 * ORDERING (live == replay): each tick step(t) runs first (offers/expires + accrues),
 * THEN any build/contract action recorded at that tick applies post-step — the SAME
 * "step then post-drain action" order main.ts uses live.
 */

const GOLDEN_DT = 1 / 60;

/** Sim-time the golden replay runs to: past the FIRST deterministic offer on this PRNG
 * stream (after the launch rolls) — c0 @ t≈1800 s — with a margin to ACCEPT it and let
 * the per-tick economy accrue real coverage revenue. In ticks: t/DT. (DECLINE is
 * exercised in a dedicated test below so the golden window stays fast; the second offer
 * c1 only fires ~t12254 s, far past this window.) */
const MAX_T_SECONDS = 7000;
const MAX_TICK = Math.round(MAX_T_SECONDS / GOLDEN_DT);

const TICK_DEPLOY_1 = 100;
const TICK_DEPLOY_SA = 150; // SOUTH AMERICA — covers c0's target region (see below)
const TICK_DEPLOY_2 = 200;
const TICK_DEPLOY_NA = 250; // NORTH AMERICA — broadens the western coverage
const TICK_LAUNCH_1 = 300;
const TICK_DEPLOY_3 = 400;
const TICK_LAUNCH_2 = 500;
const TICK_LAUNCH_3 = 600;
const TICK_LAUNCH_4 = 700;
/** Accept c0 shortly after the first offer (t≈1800 s) — the deterministic first offer
 * this seed's stream produces with the launches. c0 targets SOUTH AMERICA (RNG-chosen);
 * the build deploys a station over it (site 6) so the accepted contract is genuinely
 * SERVED and EARNS across the window. */
const TICK_ACCEPT = Math.round(1850 / GOLDEN_DT);

/**
 * The recorded build sequence: deploy stations over real demand (incl. SOUTH AMERICA +
 * NORTH AMERICA so the accepted contract's region is covered) + launch four sats
 * (LEO/MEO/GEO, one engineered to FAIL on this PRNG stream), then — once the
 * deterministic offer generator has put c0 on the board — ACCEPT it (which then accrues
 * real coverage revenue across the window).
 */
function buildLog() {
  const sg = saveGame(1234567n, GOLDEN_DT, { system: "data/system.json" });
  addAction(sg, deployGround(1, TICK_DEPLOY_1)); // SOUTH ASIA
  addAction(sg, deployGround(6, TICK_DEPLOY_SA)); // SOUTH AMERICA (serves c0)
  addAction(sg, deployGround(3, TICK_DEPLOY_2)); // NORTH ATLANTIC EU
  addAction(sg, deployGround(2, TICK_DEPLOY_NA)); // NORTH AMERICA
  addAction(sg, launchSat("leo_53", TICK_LAUNCH_1));
  addAction(sg, deployGround(5, TICK_DEPLOY_3)); // SUB-SAHARAN AFRICA
  addAction(sg, launchSat("meo_63", TICK_LAUNCH_2));
  addAction(sg, launchSat("geo_eq", TICK_LAUNCH_3));
  addAction(sg, launchSat("leo_53", TICK_LAUNCH_4));
  addAction(sg, acceptContract("c0", TICK_ACCEPT));
  return sg;
}

/**
 * Fold the build session's mutable state into a u64 (reusing the state-hash
 * primitives). Order: balance + launchedCount + PRNG state + roster (every numeric
 * field per asset) + the M2d contract economy (generator cursor + every contract's
 * state/accums/earned). Everything folded is bit-stable across runs.
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
  // M2e — the ESCALATION ENGINE's dynamic demand (every per-cell current value + the
  // growth-cadence cursors), folded so the growing demand is IN the replay hash.
  acc = mixFloat(acc, snap.lastGrowthAtS);
  acc = mixFloat(acc, snap.nextGrowthAtS);
  acc = mixInt(acc, BigInt(snap.demand.length));
  for (const d of snap.demand) acc = mixFloat(acc, d);
  // M2d — the contract economy.
  acc = mixFloat(acc, snap.lastStepS);
  acc = mixFloat(acc, snap.generator.nextOfferAtS);
  acc = mixInt(acc, BigInt(snap.generator.offeredCount));
  acc = mixInt(acc, BigInt(snap.contracts.length));
  for (const c of snap.contracts) {
    acc = mixString(acc, c.id);
    acc = mixString(acc, c.state);
    acc = mixInt(acc, BigInt(c.cellIds.length));
    for (const id of c.cellIds) acc = mixInt(acc, BigInt(id));
    acc = mixFloat(acc, c.regionDemand);
    acc = mixFloat(acc, c.tariffPerSecond);
    acc = mixFloat(acc, c.termSeconds);
    acc = mixFloat(acc, c.offeredAtS);
    acc = mixFloat(acc, c.offerExpiresAtS);
    acc = mixFloat(acc, c.activatedAtS);
    acc = mixFloat(acc, c.servedSecondsAccum);
    acc = mixFloat(acc, c.breachSecondsAccum);
    acc = mixFloat(acc, c.earnedEur);
  }
  return acc;
}

interface ReplayResult {
  hash: bigint;
  balance: number;
  session: BuildSession;
}

/**
 * Replay a build action log through a BuildSession by STEPPING every fixed tick from 0
 * to MAX_TICK at `sg.dt`: on each tick run step(t) FIRST (the per-tick contract economy
 * — offers/expires + revenue accrual), THEN apply any build/contract action recorded at
 * that tick post-step via the SHARED applyBuildAction (the SAME path main.ts uses live).
 */
function replay(sg: ReturnType<typeof saveGame>): ReplayResult {
  const eph = loadEphemeris();
  const session = new BuildSession();
  const byTick = new Map<number, SimAction[]>();
  for (const a of sg.actions) {
    if (isBuildKind(a.kind)) {
      const list = byTick.get(a.atTick) ?? [];
      list.push(a);
      byTick.set(a.atTick, list);
    }
  }
  for (let tick = 0; tick <= MAX_TICK; tick++) {
    const t = tick * sg.dt;
    session.step(eph, t, sg.dt);
    const list = byTick.get(tick);
    if (list !== undefined) for (const a of list) applyBuildAction(eph, session, a, sg.dt);
  }
  return { hash: buildStateHash(session), balance: session.balance, session };
}

function isBuildKind(kind: string): boolean {
  return (
    kind === KIND_DEPLOY_GROUND ||
    kind === KIND_LAUNCH_SAT ||
    kind === KIND_ACCEPT_CONTRACT ||
    kind === KIND_DECLINE_CONTRACT
  );
}

/** Covered-demand fraction of a session's LIVE roster at sim-time t (the monument size).
 * Reads the session's CURRENT (M2e dynamic) demand so it reflects any growth. */
function coveredFraction(session: BuildSession, t: number): number {
  const eph = loadEphemeris();
  const grid = GeodesicGrid.build();
  const positions: Vec3[] = session.worldPositions(eph, t);
  const eirps = session.roster.eirps();
  const earth = eph.position("earth", t);
  const earthR = eph.radiusMeters("earth");
  return scoreCoverageAt(grid, session.demandField, eirps, positions, earth, earthR).coveredDemandFraction;
}

/** TIME-AVERAGED covered-demand fraction over [t0,t1] (n samples) against the session's
 * CURRENT demand — averaging across the moving constellation's orbital phase kills the
 * per-instant coverage oscillation so the M2e escalation TREND is read cleanly. */
function avgCoveredFraction(session: BuildSession, t0: number, t1: number, n: number): number {
  const eph = loadEphemeris();
  const grid = GeodesicGrid.build();
  const earthR = eph.radiusMeters("earth");
  const eirps = session.roster.eirps();
  let sum = 0;
  for (let k = 0; k < n; k++) {
    const t = t0 + ((t1 - t0) * k) / n;
    const positions: Vec3[] = session.worldPositions(eph, t);
    const earth = eph.position("earth", t);
    sum += scoreCoverageAt(grid, session.demandField, eirps, positions, earth, earthR).coveredDemandFraction;
  }
  return sum / n;
}

// ---------------------------------------------------------------------------
// PINNED M2 build-loop replay golden (deploy + launch + failure + M2d contracts +
// coverage revenue + M2e ESCALATION-ENGINE demand growth). SEPARATE from the M1 golden
// 544847093270497462n (a different world). Bootstrapped by running the replay once; pinned
// here as the regression guard. Any change to the roster shape, the launch presets/sites,
// the launch PRNG draw, the starter roster, the contract model, the offer generator, the
// revenue math, OR the M2e demand-growth law/cadence (now folded into the state hash via
// the per-cell dynamic demand) moves this value.
// ---------------------------------------------------------------------------
const BUILD_REPLAY_GOLDEN = 15734905161678697793n;

/** A generous per-test timeout for the heavy multi-replay tests: M2e advances the
 * ESCALATION-ENGINE demand growth on a per-tick whole-grid coverage sweep, so a single
 * 7000-sim-second replay at DT=1/60 (≈420k ticks) is a few seconds; tests that run two
 * replays (round-trip / live==replay / determinism) need headroom past the 5s default. */
const HEAVY_MS = 30000;

describe("m2 build-loop replay golden — deploy + launch + M2d contracts + revenue", () => {
  it("pins the build-session replay state hash for the golden build log (regression guard)", () => {
    const r = replay(buildLog());
    expect(r.hash).toBe(BUILD_REPLAY_GOLDEN);
  }, HEAVY_MS);

  it("a logged build sequence is deterministic: replaying the same log twice is bit-identical", () => {
    const a = replay(buildLog());
    const b = replay(buildLog());
    expect(a.hash).toBe(b.hash);
    expect(a.balance).toBe(b.balance);
    expect(a.session.snapshot()).toEqual(b.session.snapshot());
  }, HEAVY_MS);

  it("LIVE == REPLAY: stepping + applying the same actions directly reproduces the replay", () => {
    const eph = loadEphemeris();
    const live = new BuildSession();
    const byTick = new Map<number, SimAction[]>();
    for (const a of buildLog().actions) {
      if (isBuildKind(a.kind)) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
    }
    for (let tick = 0; tick <= MAX_TICK; tick++) {
      const t = tick * GOLDEN_DT;
      live.step(eph, t, GOLDEN_DT);
      const list = byTick.get(tick);
      if (list !== undefined) for (const a of list) applyBuildAction(eph, live, a, GOLDEN_DT);
    }
    const replayed = replay(buildLog());
    expect(live.snapshot()).toEqual(replayed.session.snapshot());
    expect(live.balance).toBe(replayed.balance);
  }, HEAVY_MS);

  it("the build log exercises a launch FAILURE deterministically (the seeded-PRNG risk)", () => {
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
    expect(endFrac).toBeGreaterThan(startFrac);
    expect(endFrac).toBeGreaterThan(0);
  }, HEAVY_MS);

  it("M2d — the LOOP CLOSES: an accepted contract goes ACTIVE, accrues €, and the wallet EARNS it back", () => {
    const r = replay(buildLog());
    const accepted = r.session.contracts.find((c) => c.id === "c0");
    expect(accepted).toBeDefined();
    // c0 was accepted → active (or completed if its term elapsed in-window).
    expect(["active", "completed"]).toContain(accepted!.state);
    // The accepted contract served real coverage and EARNED € (the loop pays back).
    expect(accepted!.servedSecondsAccum).toBeGreaterThan(0);
    expect(accepted!.earnedEur).toBeGreaterThan(2000);
    // THE LOOP CLOSES: the build spent ~€5,600 of capex (six deploys + four launches,
    // one of which FAILED — € lost), bottoming the wallet near −€600; the accepted
    // contract's sustained coverage revenue lifted it back to clearly SOLVENT (> €1,500
    // and climbing) over the window — build → serve → REVENUE offsetting the capex.
    expect(r.balance).toBeGreaterThan(1500);
    // And the contract revenue exceeds the M2c capex it offsets (earned > a launch's €).
    expect(accepted!.earnedEur).toBeGreaterThan(1800);
  }, HEAVY_MS);

  it("M2e — THE ESCALATION ENGINE: served demand GROWS, the covered fraction ERODES under fixed capacity, and adding capacity RESTORES it", () => {
    // A worked before/after of the §3b loop ("demand grows where you serve → it outgrows the
    // capacity you built → your covered fraction erodes → you must expand"). Build a FIXED
    // network over real demand, run a long served stretch, and prove the three legs:
    //   (1) total demand GROWS substantially (the escalation engine ran — demand grew where
    //       the network serves), and is BOUNDED (finite, well under the global cap);
    //   (2) the TIME-AVERAGED covered-demand fraction is LOWER late than early — the fixed
    //       roster covers a smaller FRACTION as demand balloons past it (the BITE);
    //   (3) ADDING CAPACITY (a swarm of sats) lifts the covered fraction back ABOVE the early
    //       level — the loop renews one size larger (the bigger demand now grows from a higher
    //       base, so the next gap re-opens bigger — the OpenTTD cycle).
    const eph = loadEphemeris();
    const s = new BuildSession();
    s.deployGround(1); // SOUTH ASIA
    s.deployGround(3); // NORTH ATLANTIC EU
    s.deployGround(5); // SUB-SAHARAN AFRICA
    s.deployGround(2); // NORTH AMERICA
    s.deployGround(6); // SOUTH AMERICA
    s.launchSat("leo_53", 0);
    s.launchSat("meo_63", 0);
    s.launchSat("geo_eq", 0);

    const baselineTotal = s.demandField.baselineTotal;
    // EARLY: time-average the covered fraction over ~2 LEO orbits before demand has grown.
    const earlyFraction = avgCoveredFraction(s, 0, 11000, 64);

    // Run a long served stretch with the FIXED roster (the escalation engine grows demand).
    const RUN_T = 150000; // ≈ 41 sim-hours — many orbits, demand saturates well up.
    for (let tick = 0; tick * GOLDEN_DT <= RUN_T; tick++) s.step(eph, tick * GOLDEN_DT, GOLDEN_DT);

    // (1) Demand GREW where served — and stayed bounded/finite.
    const grownTotal = s.demandField.total;
    expect(grownTotal).toBeGreaterThan(baselineTotal * 1.5); // a perceptible, real increase
    expect(Number.isFinite(grownTotal)).toBe(true);
    expect(grownTotal).toBeLessThan(baselineTotal * 3); // bounded under the global cap (3×)

    // (2) The covered FRACTION eroded under the fixed capacity (averaged across orbital phase).
    const erodedFraction = avgCoveredFraction(s, RUN_T, RUN_T + 11000, 64);
    expect(erodedFraction).toBeLessThan(earlyFraction); // the fixed roster lost ground

    // (3) ADDING CAPACITY restores it (and then some) — the player expands, the loop renews.
    for (let i = 0; i < 6; i++) s.launchSat("leo_53", RUN_T);
    for (let i = 0; i < 6; i++) s.launchSat("meo_63", RUN_T);
    const restoredFraction = avgCoveredFraction(s, RUN_T, RUN_T + 11000, 64);
    expect(restoredFraction).toBeGreaterThan(earlyFraction); // expansion re-solves the bigger demand
    expect(restoredFraction).toBeGreaterThan(erodedFraction);
  }, HEAVY_MS);

  it("M2d — DECLINE: an offered contract declined via the shared applier retires (live==replay)", () => {
    // Step a fresh session to the first offer, then DECLINE it through applyBuildAction
    // (the SAME path main.ts uses) and assert it leaves the open-offer board.
    const eph = loadEphemeris();
    const drive = () => {
      const s = new BuildSession();
      let declineTick = -1;
      for (let tick = 0; tick <= MAX_TICK; tick++) {
        const t = tick * GOLDEN_DT;
        s.step(eph, t, GOLDEN_DT);
        if (declineTick < 0 && s.contracts.some((c) => c.state === "offered")) {
          declineTick = tick + 1; // decline on the next tick (post-step, like a keypress)
        }
        if (tick === declineTick) {
          const offered = s.contracts.find((c) => c.state === "offered")!;
          const res = applyBuildAction(eph, s, declineContract(offered.id, tick), GOLDEN_DT);
          expect(res!.kind).toBe("contract_declined");
        }
      }
      return s;
    };
    const a = drive();
    const b = drive();
    // The declined contract is retired (failed = not taken) and the result reproduces.
    expect(a.contracts.some((c) => c.state === "failed")).toBe(true);
    expect(a.snapshot()).toEqual(b.snapshot()); // deterministic
  }, HEAVY_MS);

  it("M2d — DT-INVARIANT revenue: stepping to the same sim-time at 1× vs a coarse dt yields the same €", () => {
    const eph = loadEphemeris();
    // A built session with one ACTIVE contract; accrue to the SAME sim-time two ways.
    const make = () => {
      const s = new BuildSession();
      // Deploy + launch coverage at t=0 so the region is served from the start.
      s.deployGround(1);
      s.deployGround(3);
      s.deployGround(5);
      s.launchSat("leo_53", 0);
      s.launchSat("meo_63", 0);
      s.launchSat("geo_eq", 0);
      return s;
    };
    const T = 7200; // 2 sim-hours — well within a contract term, no completion.
    // FINE: step at DT for the whole window (offers fire + we accept the first).
    const fine = make();
    let acceptedFine = false;
    for (let tick = 0; tick * GOLDEN_DT <= T; tick++) {
      const t = tick * GOLDEN_DT;
      fine.step(eph, t, GOLDEN_DT);
      if (!acceptedFine && fine.contracts.some((c) => c.state === "offered")) {
        const first = fine.contracts.find((c) => c.state === "offered")!;
        fine.acceptContract(first.id, t);
        acceptedFine = true;
      }
    }
    // COARSE: step in big 60 s chunks to the same T, accepting the same first offer.
    const coarse = make();
    let acceptedCoarse = false;
    const DT_COARSE = 60;
    for (let t = 0; t <= T; t += DT_COARSE) {
      coarse.step(eph, t, DT_COARSE);
      if (!acceptedCoarse && coarse.contracts.some((c) => c.state === "offered")) {
        const first = coarse.contracts.find((c) => c.state === "offered")!;
        coarse.acceptContract(first.id, t);
        acceptedCoarse = true;
      }
    }
    // Both accepted the SAME deterministic first offer (same id) and served the same
    // sim-time of coverage, so the earned € + balance match to a tight tolerance
    // (independent of the tick rate — the SD-20 DT-invariance contract).
    const cf = fine.contracts.find((c) => c.state === "active")!;
    const cc = coarse.contracts.find((c) => c.state === "active")!;
    expect(cc.id).toBe(cf.id);
    expect(cc.earnedEur).toBeCloseTo(cf.earnedEur, 2);
    expect(coarse.balance).toBeCloseTo(fine.balance, 2);
    expect(cf.earnedEur).toBeGreaterThan(0);
  }, HEAVY_MS);

  it("a build/contract action only mutates on a known kind; an unknown action is a no-op", () => {
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
    expect(reloaded!.actions.some((a) => a.kind === KIND_ACCEPT_CONTRACT)).toBe(true);
    const a = replay(sg);
    const b = replay(reloaded!);
    expect(b.hash).toBe(a.hash);
  }, HEAVY_MS);
});
