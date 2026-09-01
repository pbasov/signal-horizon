import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NetSession, NET_OPENING_BALANCE } from "./session";
import { offerNetContract } from "./contract";
import { NET_ACT1_REGION } from "./endpoint";
import { standardLoadout, type NetSat } from "./sat";
import { GEO_PARK, resolveOrbit } from "./world";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import {
  DEV_ACT_IDS,
  DEV_LAST_CURSOR,
  cheatArmFences,
  cheatCircularizeAll,
  cheatClearBreach,
  cheatClearFaults,
  cheatDeployNow,
  cheatDisarmFaults,
  cheatFreezeOffers,
  cheatGrantEur,
  cheatReopenLapsed,
  cheatRewindCursor,
  cheatSafeLaunch,
  cheatSetBalance,
  devContractCounts,
  devFleetCounts,
} from "./devtools";

/**
 * SD-70 — THE CHEAT ENGINE. The console's contract with the sim is exactly one round trip:
 * `session.snapshot()` → cheat → `session.restore()`. These tests hold that contract:
 *
 *   - each cheat changes ONLY the fold fields it claims to (a real snapshot from a real
 *     session, so a new fold field can never quietly escape the cheats);
 *   - the round trip lands on the live session (restore-then-read agrees);
 *   - SKIP ACT reaches act4 through act3b's structural fence WITHOUT the fence throwing —
 *     the one thing a naive `advanceCursor` loop gets wrong;
 *   - re-offer refuses to resurrect a contract that was actually WORKED (it would erase a
 *     real outcome), and only un-lapses an untouched expired tender.
 */

const eph = Ephemeris.build({});
const DT = 1 / 60;

function geoSat(id: string, t = 0): NetSat {
  return {
    id,
    orbit: resolveOrbit(GEO_PARK, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

/** SKIP ACT exactly as the console does it: arm the fences for the target, advance one
 * beat, then step so the newly-current beat's authored `emit` actually fires. */
function skipAct(s: NetSession, t: number): void {
  const target = s.cursor + 1;
  const snap = s.snapshot();
  cheatArmFences(snap, target);
  s.restore(snap);
  s.advanceCursor(Math.round(t / DT));
  s.step(eph, t, DT);
}

describe("SD-70 cheat engine — the wallet", () => {
  it("grant + set land on the live session through the snapshot round trip", () => {
    const s = new NetSession();
    const snap = s.snapshot();
    const note = cheatGrantEur(snap, 250_000);
    s.restore(snap);
    expect(s.balance).toBe(NET_OPENING_BALANCE + 250_000);
    expect(note).toContain("wallet +");

    const snap2 = s.snapshot();
    cheatSetBalance(snap2, 0);
    s.restore(snap2);
    expect(s.balance).toBe(0);
  });

  it("a negative grant reads as a debit, not a malformed credit", () => {
    const snap = new NetSession().snapshot();
    expect(cheatGrantEur(snap, -1000)).toContain("wallet −");
    expect(snap.balance).toBe(NET_OPENING_BALANCE - 1000);
  });
});

describe("SD-70 cheat engine — SKIP ACTS (the headline verb)", () => {
  it("walks act1 → act4 through act3b's structural fence without it throwing", () => {
    const s = new NetSession();
    s.step(eph, 0, DT); // act1 emits (REGION-0 lands on the board).
    expect(s.cursor).toBe(0);

    // A NAIVE advance trips the fence: act3b's emit asserts escalationReTamed().
    const naive = new NetSession();
    naive.step(eph, 0, DT);
    while (naive.cursor < 3) naive.advanceCursor(0);
    expect(() => naive.step(eph, DT, DT)).toThrow(/act3b fence violated/);

    // The console's path arms the fence first, so every beat emits cleanly.
    for (let i = 0; i < DEV_LAST_CURSOR; i++) skipAct(s, (i + 1) * DT);
    expect(s.cursor).toBe(DEV_LAST_CURSOR);
    expect(DEV_ACT_IDS[s.cursor]).toBe("act4");

    // Each skipped beat's AUTHORED ARRIVAL actually fired — the acts' demands are on the
    // board, which is the whole reason to step between advances rather than jump the cursor.
    const ids = s.contracts.map((c) => c.id);
    for (const id of ["REGION-0", "REGION-1", "REGION-2", "BACKHAUL-3", "MARS-1"]) {
      expect(ids, `act arrival ${id} should be on the board`).toContain(id);
    }
    // act3b's emit ran, so the fault generator is armed (not merely flagged skipped).
    expect(s.faultsEnabled).toBe(true);
  });

  it("arming is idempotent and silent when the run already earned the witnesses", () => {
    const snap = new NetSession().snapshot();
    expect(cheatArmFences(snap, 2)).toBe(""); // nothing is fenced before act3b.
    expect(snap.act3aReTameWitnessed).toBe(0);

    expect(cheatArmFences(snap, 3)).toContain("re-tame witness");
    expect(snap.act3aReTameWitnessed).toBe(1);
    expect(snap.escalationOn).toBe(1);
    expect(cheatArmFences(snap, 3)).toBe(""); // second time: already armed, stays quiet.

    expect(cheatArmFences(snap, 4)).toContain("fault weathered");
    expect(snap.faultWeathered).toBe(1);
    expect(snap.surfacedShortfall).toBe(1);
  });

  it("rewind steps the cursor back and un-claims the gate ticks past it", () => {
    const s = new NetSession();
    s.step(eph, 0, DT);
    for (let i = 0; i < 3; i++) skipAct(s, (i + 1) * DT);
    expect(s.cursor).toBe(3);

    const snap = s.snapshot();
    expect(snap.gateTicks.length).toBe(3);
    const note = cheatRewindCursor(snap, 1);
    s.restore(snap);
    expect(s.cursor).toBe(1);
    expect(snap.gateTicks.length).toBe(1);
    expect(note).toBe("act rewound act3b → act2");

    // Forward is not this function's job — a same-or-higher target is a no-op.
    expect(cheatRewindCursor(snap, 3)).toBe("");
    expect(snap.scenarioCursor).toBe(1);
  });
});

describe("SD-70 cheat engine — the launch pipeline", () => {
  it("DEPLOY NOW collapses the countdown so the next step separates the batch", () => {
    const s = new NetSession();
    s.step(eph, 0, DT);
    s.launchBatch([geoSat("NET-SAT-0"), geoSat("NET-SAT-1")], 0, 0);
    expect(s.sats.length).toBe(0); // still in flight — countdown + ascent.
    expect(devFleetCounts(s.snapshot()).pending).toBe(2);

    const snap = s.snapshot();
    const note = cheatDeployNow(snap, 1.0);
    s.restore(snap);
    expect(note).toContain("2 pending member(s)");

    s.step(eph, 1.0, DT);
    expect(s.sats.length).toBe(2);
    expect(devFleetCounts(s.snapshot()).pending).toBe(0);
  });

  it("SAFE LAUNCH un-loses the vehicle and puts an underburn back on its intended orbit", () => {
    const s = new NetSession();
    s.step(eph, 0, DT);
    s.launchBatch([geoSat("NET-SAT-0")], 0, 0);

    // Force the failure states the seeded roll produces only sometimes, so the cheat is
    // tested against every branch rather than whatever this seed happened to draw.
    const broken = s.snapshot();
    broken.pendingLaunches[0].lost = 1;
    broken.pendingLaunches[0].lostAtS = 5;
    broken.pendingLaunches[0].members[0].outcome = "underburn";
    broken.pendingLaunches[0].members[0].intendedAM = 42_164_000;
    broken.pendingLaunches[0].members[0].sat.orbit.aM = 12_000_000;

    const note = cheatSafeLaunch(broken);
    expect(note).toContain("2 launch failure(s) forced clean");
    expect(broken.pendingLaunches[0].lost).toBe(0);
    expect(broken.pendingLaunches[0].members[0].outcome).toBe("ok");
    expect(broken.pendingLaunches[0].members[0].sat.orbit.aM).toBe(42_164_000);

    // And it deploys for real: restore, collapse the clock, step.
    cheatDeployNow(broken, 1.0);
    s.restore(broken);
    s.step(eph, 1.0, DT);
    expect(s.sats.map((x) => x.id)).toEqual(["NET-SAT-0"]);
    expect(s.sats[0].orbit.aM).toBe(42_164_000);

    expect(cheatSafeLaunch(s.snapshot())).toBe("nothing in flight to fix");
  });

  it("CIRCULARIZE ALL fixes every underburned roster sat for free", () => {
    const s = new NetSession();
    s.launchSat(geoSat("NET-SAT-0"));
    const snap = s.snapshot();
    snap.roster[0].orbit.aM = 12_000_000;
    snap.underburnIntended = [["NET-SAT-0", 42_164_000]];
    s.restore(snap);
    const balanceBefore = s.balance;

    const snap2 = s.snapshot();
    const note = cheatCircularizeAll(snap2);
    s.restore(snap2);
    expect(note).toBe("1 sat(s) circularized free");
    expect(s.sats[0].orbit.aM).toBe(42_164_000);
    expect(s.balance).toBe(balanceBefore); // free — the paid verb is net_circularize.
    expect(cheatCircularizeAll(s.snapshot())).toBe("no underburned sat");
  });
});

describe("SD-70 cheat engine — faults", () => {
  it("CLEAR wipes the active + queued faults; DISARM also closes the generator", () => {
    const s = new NetSession();
    s.enableFaults([{ kind: "degradation", targetSatId: null, cause: "lowOrbit" }]);
    expect(s.faultsEnabled).toBe(true);

    const snap = s.snapshot();
    expect(snap.faultScriptQueue.length).toBe(1);
    const note = cheatClearFaults(snap);
    s.restore(snap);
    expect(note).toContain("0 active + 1 queued");
    expect(s.faults.length).toBe(0);
    expect(s.faultsEnabled).toBe(true); // clear leaves the generator alone, by design.

    const snap2 = s.snapshot();
    expect(cheatDisarmFaults(snap2)).toBe("fault generator DISARMED");
    s.restore(snap2);
    expect(s.faultsEnabled).toBe(false);
  });
});

describe("SD-70 cheat engine — contracts", () => {
  it("FREEZE OFFERS stops the lapse clock and the pay decay on the board", () => {
    const s = new NetSession();
    s.addContract(
      offerNetContract("REGION-0", NET_ACT1_REGION, {
        offerWindowS: 60,
        offeredAtS: 0,
        payHalvingS: 100,
      }),
    );
    const snap = s.snapshot();
    const note = cheatFreezeOffers(snap);
    s.restore(snap);
    expect(note).toContain("1 offer(s) frozen");

    // Step well past the original 60 s window: the offer is still on the board.
    for (let tick = 1; tick <= 60 * 120; tick++) s.step(eph, tick * DT, DT);
    expect(s.contractById("REGION-0")!.state).toBe("offered");
    expect(devContractCounts(s.snapshot()).offered).toBe(1);
  });

  it("RE-OFFER un-lapses an untouched expired tender but refuses a worked one", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION, { offerWindowS: 1, offeredAtS: 0 }));
    for (let tick = 1; tick <= 120; tick++) s.step(eph, tick * DT, DT);
    expect(s.contractById("REGION-0")!.state).toBe("failed"); // lapsed unsigned.

    const snap = s.snapshot();
    const note = cheatReopenLapsed(snap, s.nowS, 7200);
    s.restore(snap);
    expect(note).toContain("1 lapsed tender(s)");
    expect(s.contractById("REGION-0")!.state).toBe("offered");

    // A contract that FAILED after being worked carries a real outcome — left alone.
    const worked = s.snapshot();
    worked.contracts[0].state = "failed";
    worked.contracts[0].earnedEur = 500;
    expect(cheatReopenLapsed(worked, 0, 7200)).toBe("no lapsed tender to re-offer");
    expect(worked.contracts[0].state).toBe("failed");
  });

  it("CLEAR BREACH zeroes the breach window and restarts the clean streak", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
    s.acceptContract("REGION-0");
    // Active with no covering sat: the breach window accumulates.
    for (let tick = 1; tick <= 600; tick++) s.step(eph, tick * DT, DT);
    expect(s.contractById("REGION-0")!.breachSecondsAccum).toBeGreaterThan(0);

    const snap = s.snapshot();
    const note = cheatClearBreach(snap, 999);
    s.restore(snap);
    expect(note).toContain("1 breach window(s) cleared");
    expect(s.contractById("REGION-0")!.breachSecondsAccum).toBe(0);
    expect(s.cleanSinceS).toBe(999);
    // Served time + € earned are a real record — never touched.
    expect(s.contractById("REGION-0")!.state).toBe("active");
  });
});

describe("SD-70 cheat engine — the console's readers", () => {
  it("fleet + contract counts read straight off the fold", () => {
    const s = new NetSession();
    s.step(eph, 0, DT); // act1 emits its tenders.
    s.launchSat(geoSat("NET-SAT-0"));
    s.launchBatch([geoSat("NET-SAT-1")], 0, 0);
    s.acceptContract("REGION-0");

    const snap = s.snapshot();
    expect(devFleetCounts(snap)).toEqual({ live: 1, pending: 1, underburn: 0 });
    const counts = devContractCounts(snap);
    expect(counts.active).toBe(1);
    expect(counts.offered + counts.active).toBe(snap.contracts.length - counts.completed - counts.failed);
  });
});
