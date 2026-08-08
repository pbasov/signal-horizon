import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { BREACH_GRACE_SECONDS as M2_BREACH_GRACE_SECONDS } from "../m2/contracts";
import {
  NetSession,
  NET_OPENING_BALANCE,
  BREACH_GRACE_SECONDS as NET_BREACH_GRACE_SECONDS,
} from "./session";
import { offerNetContract } from "./contract";
import { applyNetAction } from "./apply-action";
import { NET_ACT1_REGION } from "./endpoint";
import { standardLoadout, BUS_SPECS, type NetSat } from "./sat";
import { GEO_PARK, resolveOrbit } from "./world";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import { netLaunch, netAccept, netSetPrefer, simAction } from "../action";

/**
 * A2 — THE CONTRACT + SESSION + APPLY-ACTION, on the SHARED m2 state machine (design §2.2
 * / §4 / §5). This proves the Act-1 loop CLOSES on the net/ session built atop the IMPORTED
 * m2 serve/breach transitions:
 *   - accept → serve → revenue closes in-session on ONE state machine;
 *   - revenue is DT-INVARIANT (1× vs a coarse dt within float tolerance — the m2 pattern);
 *   - applyNetAction no-ops on an unknown kind (and round-trips launch/accept/prefer);
 *   - the breach grace IS the IMPORTED m2 BREACH_GRACE_SECONDS (no net/ copy).
 * The net/ frame is earth-relative + single-body, so a minimal pure ephemeris suffices.
 */

const eph = Ephemeris.build({});
const DT = 1 / 60;

/** The parked GEO PARK sat at sim-time t (covers the whole equatorial disc — A1's pin). */
function geoSat(id: string, t = 0): NetSat {
  return {
    id,
    orbit: resolveOrbit(GEO_PARK, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

describe("A2 net session — accept → serve → revenue closes on the shared m2 state machine", () => {
  it("ONE state machine: an ACCEPTED contract over a covered region accrues € while served", () => {
    const s = new NetSession();
    // Launch the parked GEO (covers the whole disc) + put the Act-1 contract on the board.
    s.launchSat(geoSat("SAT-GEO", 0));
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));

    // Before accept: no contract revenue — but the launched sat's OPEX drains (R0 §2.5:
    // owning hardware costs €/s), so the balance dips by exactly opex×dt.
    s.step(eph, 0, DT);
    expect(s.balance).toBeCloseTo(NET_OPENING_BALANCE - BUS_SPECS.smallsat.opexPerSecond * DT, 9);

    // Accept → ACTIVE, then step a stretch: it is SERVED (parked GEO) and EARNS €.
    const accepted = s.acceptContract("REGION-0");
    expect(accepted).not.toBeNull();
    expect(accepted!.state).toBe("active");

    for (let tick = 1; tick <= 600; tick++) s.step(eph, tick * DT, DT);

    const c = s.contractById("REGION-0")!;
    expect(c.lastServedFraction).toBe(1.0); // binary served (Act 1 connectivity axis)
    expect(c.servedSecondsAccum).toBeGreaterThan(0); // term accrues via the SHARED helper
    expect(c.earnedEur).toBeGreaterThan(0); // revenue accrues while served
    // The wallet = opening + earned − the sat's opex over the stepped span (R0 §2.5).
    const steppedS = 601 * DT; // ticks 0..600 inclusive each advanced dt.
    const opex = BUS_SPECS.smallsat.opexPerSecond * steppedS;
    expect(s.balance - NET_OPENING_BALANCE).toBeCloseTo(c.earnedEur - opex, 6);
    expect(c.earnedEur).toBeCloseTo(c.payPerSecond * c.servedSecondsAccum, 6);
  });

  it("UNSERVED while active drains via the penalty path (the SLA bite) — no sat on the board", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
    s.acceptContract("REGION-0");
    // No sat launched ⇒ the router returns unserved ⇒ the penalty drains the wallet.
    for (let tick = 1; tick <= 300; tick++) s.step(eph, tick * DT, DT);
    const c = s.contractById("REGION-0")!;
    expect(c.lastServedFraction).toBe(0.0);
    expect(c.breachSecondsAccum).toBeGreaterThan(0);
    expect(s.balance).toBeLessThan(NET_OPENING_BALANCE); // drained by the penalty
  });

  it("the breach grace IS the IMPORTED m2 BREACH_GRACE_SECONDS — no net/ copy", () => {
    // The session re-exports the SAME binding it imports from m2/contracts (identity), and
    // a sustained breach fails EXACTLY at the m2 grace — so there is ONE convention.
    expect(NET_BREACH_GRACE_SECONDS).toBe(M2_BREACH_GRACE_SECONDS);

    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
    s.acceptContract("REGION-0");
    // Coarse-step well past the grace with no coverage: the SHARED stepActiveContract must
    // FAIL it at the imported grace, not at any net/-local value.
    const STEP = 60;
    let t = 0;
    while (t < M2_BREACH_GRACE_SECONDS + STEP) {
      t += STEP;
      s.step(eph, t, STEP);
    }
    const c = s.contractById("REGION-0")!;
    expect(c.state).toBe("failed");
    // It survived up to the grace and failed once breachSecondsAccum crossed it.
    expect(c.breachSecondsAccum).toBeGreaterThanOrEqual(M2_BREACH_GRACE_SECONDS);
  });

  it("DT-INVARIANT revenue: stepping to the same sim-time at 1× vs a coarse dt yields the same €", () => {
    const make = () => {
      const s = new NetSession();
      s.launchSat(geoSat("SAT-GEO", 0));
      s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
      s.acceptContract("REGION-0");
      return s;
    };
    // R3: terms now CYCLE (480 s) — a completed contract stops accruing, and fine/coarse
    // completions boundary-quantize slightly differently. The DT-invariance being pinned is the
    // REVENUE STEPPING, so measure INSIDE one term (no completion in window).
    const T = 240; // 4 sim-min — well within the (retuned) term, no completion.

    const fine = make();
    for (let tick = 1; tick * DT <= T; tick++) fine.step(eph, tick * DT, DT);

    const coarse = make();
    const DT_COARSE = 60;
    for (let t = DT_COARSE; t <= T; t += DT_COARSE) coarse.step(eph, t, DT_COARSE);

    const cf = fine.contractById("REGION-0")!;
    const cc = coarse.contractById("REGION-0")!;
    // Same sim-time served ⇒ same € to a tight tolerance (independent of tick rate).
    expect(cc.earnedEur).toBeCloseTo(cf.earnedEur, 2);
    expect(coarse.balance).toBeCloseTo(fine.balance, 2);
    expect(cf.earnedEur).toBeGreaterThan(0);
  });
});

describe("A2 applyNetAction — the shared live==replay applier", () => {
  it("net_launch (radians+SI) adds the sat; the launched orbit serves the region", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
    // Launch the GEO PARK draft at tick 10 via the applier (radians + SI on the wire).
    const launchTick = 10;
    const res = applyNetAction(
      eph,
      s,
      netLaunch(
        { presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 },
        launchTick,
      ),
      DT,
    );
    expect(res).not.toBeNull();
    expect(res!.kind).toBe("sats_launched");
    expect(res!.satIds!.length).toBe(1);
    // R0: the launch is an EVENT — the sat rides the countdown/ascent/deploy pipeline
    // (~18 sim-seconds), it does NOT teleport into the roster.
    expect(s.sats.length).toBe(0);
    expect(s.launchEvents.length).toBe(1);

    // Accept + step from the launch instant onward: after the deploy instant the
    // (epoch-correct) GEO enters the roster and serves.
    applyNetAction(eph, s, netAccept("REGION-0", launchTick), DT);
    const pastDeployTicks = launchTick + Math.ceil(20 / DT); // past countdown+ascent+deploy.
    // Step well past deploy: the accepted contract bled penalty while the vehicle flew
    // (accepting before FIRST SIGNAL costs you), then out-earns it once served.
    for (let tick = launchTick + 1; tick <= pastDeployTicks + 3600; tick++) s.step(eph, tick * DT, DT);
    expect(s.sats.length).toBe(1);
    const c = s.contractById("REGION-0")!;
    expect(c.lastServedFraction).toBe(1.0);
    expect(c.earnedEur).toBeGreaterThan(0);
  });

  it("net_accept activates an offered contract; net_set_prefer updates the weights", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));

    const acc = applyNetAction(eph, s, netAccept("REGION-0", 0), DT);
    expect(acc!.kind).toBe("contract_accepted");
    expect(s.contractById("REGION-0")!.state).toBe("active");

    const pref = applyNetAction(eph, s, netSetPrefer("REGION-0", 0.2, 0.7, 0.1, 0), DT);
    expect(pref!.kind).toBe("prefer_set");
    const c = s.contractById("REGION-0")!;
    expect(c.prefer).toEqual({ lat: 0.2, bw: 0.7, stab: 0.1 });
  });

  it("net_accept / net_set_prefer reject an unknown contract id (no mutation)", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
    expect(applyNetAction(eph, s, netAccept("NOPE", 0), DT)!.kind).toBe("rejected");
    expect(applyNetAction(eph, s, netSetPrefer("NOPE", 1, 0, 0, 0), DT)!.kind).toBe("rejected");
    // The real contract is untouched (still offered, neutral prefer would be unchanged).
    expect(s.contractById("REGION-0")!.state).toBe("offered");
  });

  it("applyNetAction NO-OPS on an unknown kind (returns null, no state change)", () => {
    const s = new NetSession();
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
    const before = s.snapshot();
    const noop = simAction("noop", 0, {});
    expect(applyNetAction(eph, s, noop, DT)).toBeNull();
    // A non-net kind (a real m2 kind) is also a no-op for the net applier.
    const m2kind = simAction("launch_sat", 0, { presetId: "geo_eq" });
    expect(applyNetAction(eph, s, m2kind, DT)).toBeNull();
    expect(s.snapshot()).toEqual(before);
  });

  it("LIVE == REPLAY: step-then-post-drain reproduces a recorded launch+accept", () => {
    // Accept AFTER the ~18 s deploy pipeline lands (tick 10 + 20 s of ticks) — accepting
    // an unserved contract now bleeds real penalty (R0 §2.5), so the recorded intent is
    // the sane play: launch, wait for FIRST SIGNAL, then sign.
    const acceptTick = 10 + Math.ceil(20 / DT);
    const log = [
      netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, 10),
      netAccept("REGION-0", acceptTick),
    ];
    const drive = () => {
      const s = new NetSession();
      s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION));
      const byTick = new Map<number, typeof log>();
      for (const a of log) {
        const list = byTick.get(a.atTick) ?? [];
        list.push(a);
        byTick.set(a.atTick, list);
      }
      for (let tick = 0; tick <= acceptTick + 600; tick++) {
        const t = tick * DT;
        s.step(eph, t, DT); // step FIRST
        const list = byTick.get(tick);
        if (list) for (const a of list) applyNetAction(eph, s, a, DT); // then post-drain
      }
      return s;
    };
    const a = drive();
    const b = drive();
    expect(a.snapshot()).toEqual(b.snapshot()); // deterministic
    expect(a.contractById("REGION-0")!.earnedEur).toBeGreaterThan(0); // the loop closed
  });

  it("the activeAxes fold is by FIXED ORDINAL (never Set order) — connectivity-only ⇒ [0]", () => {
    const c = offerNetContract("REGION-0", NET_ACT1_REGION);
    expect(NetSession.foldAxisOrdinals(c.activeAxes)).toEqual([0]);
    // A multi-axis mask folds ascending by ordinal regardless of insertion order.
    const multi = new Set<import("./contract").SlaAxis>();
    multi.add("bandwidth"); // ordinal 3 inserted first
    multi.add("connectivity"); // ordinal 0
    multi.add("availability"); // ordinal 1
    expect(NetSession.foldAxisOrdinals(multi)).toEqual([0, 1, 3]);
  });
});
