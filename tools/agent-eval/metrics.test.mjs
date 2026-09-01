// @ts-nocheck
import { describe, it, expect } from "vitest";
import {
  computeMetrics,
  wilson,
  strategyFork,
  respondedToOwnSuccessStrain,
  normalise,
  SURFACES,
} from "./metrics.mjs";

/**
 * SD-55 / AE-04 — the metric extractor is pure logic over an action log, so it is pinned like a sim
 * module (AGENTS.md §2). Every case here is a definition from docs/agent-eval-metrics.md: if a
 * definition changes, one of these fails, which is the point of pre-registering them.
 */

const T = 60; // ticks per sim-second (DT = 1/60)

describe("wilson intervals — never Wald", () => {
  it("5/5 admits a true rate near 0.57, so a small battery cannot claim a pass", () => {
    const w = wilson(5, 5);
    expect(w.p).toBe(1);
    expect(w.lo).toBeGreaterThan(0.55);
    expect(w.lo).toBeLessThan(0.58);
    expect(w.hi).toBe(1);
  });
  it("0/5 keeps a non-zero upper bound (Wald would give a zero-width interval)", () => {
    const w = wilson(0, 5);
    expect(w.lo).toBe(0);
    expect(w.hi).toBeGreaterThan(0.4);
  });
  it("n=0 is reported as unmeasured, not as zero", () => {
    expect(wilson(0, 0).p).toBeNull();
  });
});

describe("M1 — committed actions inside act 1", () => {
  const actions = [
    { kind: "net_launch", at_tick: 100, payload: {} },
    { kind: "net_accept", at_tick: 200, payload: { contractId: "REGION-0" } },
    { kind: "net_launch", at_tick: 9000, payload: {} },
  ];
  it("counts only what committed at or before the tick the act-1 cursor advanced", () => {
    const timeline = [
      { turn: 1, tick: 50, cursor: 0 },
      { turn: 2, tick: 300, cursor: 0 },
      { turn: 3, tick: 5000, cursor: 1 },
    ];
    expect(computeMetrics({ actions, timeline }).m1_committed_actions_act1).toBe(2);
  });
  it("counts the whole run when the act never advanced", () => {
    const timeline = [{ turn: 1, tick: 50, cursor: 0 }];
    expect(computeMetrics({ actions, timeline }).m1_committed_actions_act1).toBe(3);
  });
  it("inspection is never a decision: a pad open and a panel summon count for nothing", () => {
    const timeline = [
      { turn: 1, tick: 10, cursor: 0, action: { do: "click", target: "pad-toggle" } },
      { turn: 2, tick: 20, cursor: 0, action: { do: "click", target: "text:REVIEW" } },
    ];
    expect(computeMetrics({ actions: [], timeline }).committed_actions_total).toBe(0);
  });
});

describe("M2 — decision surfaces, touched only when the value differs from what the game seeded", () => {
  const seeded = { altKm: "535", incDeg: "0", subLonDeg: "-90", raanDeg: "0", phaseSpreadDeg: "0", slots: ["▣ BROADCAST", "▢", "▢", "▢"] };
  const launch = (payload) => [{ kind: "net_launch", at_tick: 100, payload }];
  // The commit turn is identified by the LAUNCH click, not by tick — see commitTurns().
  const turnAt = (padAtAction) => [
    { turn: 1, tick: 100, cursor: 0, padSeed: seeded, padAtAction, action: { do: "click", target: "launch" } },
  ];

  it("an untouched default launch touches no orbit surface", () => {
    const m = computeMetrics({ actions: launch({ count: 1 }), timeline: turnAt({ ...seeded }) });
    expect(m.m2_decision_surfaces.touched).toEqual([]);
    expect(m.m10_hand_aimed_before_commit).toBe(false);
  });
  it("dragging the draft home touches sub-lon and reads as hand-aimed", () => {
    const m = computeMetrics({ actions: launch({ count: 1 }), timeline: turnAt({ ...seeded, subLonDeg: "0" }) });
    expect(m.m2_decision_surfaces.touched).toContain("sub-lon");
    expect(m.m10_hand_aimed_before_commit).toBe(true);
  });
  it("a re-fitted silhouette touches antenna-cards", () => {
    const m = computeMetrics({
      actions: launch({ count: 1 }),
      timeline: turnAt({ ...seeded, slots: ["▣ ACCESS-L", "▣ GATEWAY", "▢", "▢"] }),
    });
    expect(m.m2_decision_surfaces.touched).toContain("antenna-cards");
  });
  it("the payload's own non-default markers carry bus tier and batch size", () => {
    const m = computeMetrics({ actions: launch({ count: 3, bus: "comsat" }), timeline: turnAt({ ...seeded }) });
    expect(m.m2_decision_surfaces.touched).toEqual(expect.arrayContaining(["bus-tier", "batch-size"]));
  });
  it("a reflex signature is not accept-timing; holding the offer a minute is", () => {
    const tl = [{ turn: 1, tick: 100, cursor: 0, offered: ["REGION-0"] }];
    const quick = computeMetrics({ actions: [{ kind: "net_accept", at_tick: 100 + 30 * T, payload: { contractId: "REGION-0" } }], timeline: tl });
    expect(quick.m2_decision_surfaces.touched).not.toContain("accept-timing");
    const held = computeMetrics({ actions: [{ kind: "net_accept", at_tick: 100 + 90 * T, payload: { contractId: "REGION-0" } }], timeline: tl });
    expect(held.m2_decision_surfaces.touched).toContain("accept-timing");
  });
  it("re-beaming needs a SECOND assignment of the same antenna, not just two beams", () => {
    const two = [
      { kind: "net_assign_beam", at_tick: 100, payload: { satId: "NET-SAT-0", antennaIndex: 0, regionId: "REGION-0" } },
      { kind: "net_assign_beam", at_tick: 200, payload: { satId: "NET-SAT-1", antennaIndex: 0, regionId: "REGION-1" } },
    ];
    expect(computeMetrics({ actions: two, timeline: [] }).m2_decision_surfaces.touched).not.toContain("re-beaming");
    const again = [...two, { kind: "net_assign_beam", at_tick: 300, payload: { satId: "NET-SAT-0", antennaIndex: 0, regionId: "REGION-1" } }];
    expect(computeMetrics({ actions: again, timeline: [] }).m2_decision_surfaces.touched).toContain("re-beaming");
  });
  it("an unshipped verb is unavailable, never untouched — it cannot depress the count", () => {
    const m = computeMetrics({ actions: [], timeline: [] });
    expect(m.m2_decision_surfaces.unavailable).toContain("overclock");
    expect(m.m2_decision_surfaces.untouched).not.toContain("overclock");
    expect(m.m2_decision_surfaces.of).toBe(SURFACES.length);
  });
});

describe("M2 — tempo under PDQ (amendment A-1)", () => {
  const harnessNoise = [
    { kind: "set_time_scale", at_tick: 100, payload: { scale: 0 } },
    { kind: "set_time_scale", at_tick: 200, payload: { scale: 1000 } },
  ];
  it("the harness's own pause/resume entries never count as a player tempo decision", () => {
    const m = computeMetrics({ actions: harnessNoise, timeline: [{ turn: 1, tick: 100 }] });
    expect(m.m2_decision_surfaces.touched).not.toContain("tempo");
    expect(m.tempo).toEqual({ keys: 0, distinctDwells: 0 });
  });
  it("a tempo key the AGENT pressed counts", () => {
    const timeline = [{ turn: 1, tick: 100, action: { do: "key", key: "." } }];
    expect(computeMetrics({ actions: harnessNoise, timeline }).m2_decision_surfaces.touched).toContain("tempo");
  });
  it("so does a deliberate spread of dwell lengths — the real tempo lever under PDQ", () => {
    const one = [{ turn: 1, tick: 1, action: { do: "wait", simMinutes: 5 } }, { turn: 2, tick: 2, action: { do: "wait", simMinutes: 5 } }];
    expect(computeMetrics({ actions: [], timeline: one }).m2_decision_surfaces.touched).not.toContain("tempo");
    const two = [...one, { turn: 3, tick: 3, action: { do: "wait", simMinutes: 30 } }];
    expect(computeMetrics({ actions: [], timeline: two }).m2_decision_surfaces.touched).toContain("tempo");
  });
});

describe("M10 — hand-aim survives a frozen clock (the first live run's bug)", () => {
  const seeded = { altKm: "535", incDeg: "0", subLonDeg: "-90", raanDeg: "0", phaseSpreadDeg: "0", slots: [] };
  it("finds the commit turn by its LAUNCH click even when every turn shares one tick", () => {
    // A run that never spends a wait leaves the clock stopped: all ticks identical. Tick-matching
    // picked a later pad-open whose draft equalled its seed and reported hand-aim as false.
    const timeline = [
      { turn: 1, tick: 100, padSeed: seeded, padAtAction: { ...seeded, subLonDeg: "0" }, action: { do: "click", target: "launch" } },
      { turn: 2, tick: 100, padSeed: seeded, padAtAction: { ...seeded }, action: { do: "click", target: "pad-toggle" } },
      { turn: 3, tick: 100, padSeed: seeded, padAtAction: { ...seeded }, action: { do: "click", target: "arm" } },
    ];
    const m = computeMetrics({ actions: [{ kind: "net_launch", at_tick: 100, payload: { count: 1 } }], timeline });
    expect(m.m10_hand_aimed_before_commit).toBe(true);
    expect(m.m2_decision_surfaces.touched).toContain("sub-lon");
  });
});

describe("M3 — the consolidate-vs-split fork", () => {
  it("reads a fat comsat as consolidate and a smallsat batch as split", () => {
    expect(strategyFork([{ kind: "net_launch", at_tick: 1, payload: { bus: "comsat", loadout: ["ACCESS-L", "ACCESS-L"], count: 1 } }])).toMatchObject({
      consolidate: true,
      split: false,
    });
    expect(strategyFork([{ kind: "net_launch", at_tick: 1, payload: { count: 3 } }])).toMatchObject({ consolidate: false, split: true });
  });
});

describe("M4 — LAW 2 at runtime, over game-rendered text only", () => {
  it("flags an imperative that reached the screen", () => {
    const timeline = [{ turn: 1, tick: 1, panelText: [{ title: "MISSION", text: "press L to open the pad" }] }];
    const m = computeMetrics({ actions: [], timeline });
    expect(m.m4_instruction_string_absent).toBe(false);
    expect(m.m4_leaks[0]).toMatchObject({ panel: "MISSION", pattern: "press <KEY>" });
  });
  it("passes lawful goal copy", () => {
    const timeline = [{ turn: 1, tick: 1, panelText: [{ title: "MISSION", text: "The equatorial metro is dark, and its co-op pays." }] }];
    expect(computeMetrics({ actions: [], timeline }).m4_instruction_string_absent).toBe(true);
  });
});

describe("M5 — strain answered (behaviour, never attribution)", () => {
  it("fires when a served region's ask grew and a committed action followed", () => {
    const timeline = [
      { turn: 1, tick: 100, regions: [{ id: "REGION-0", servedFrac: 0.9, ask: 1.0 }] },
      { turn: 2, tick: 200, regions: [{ id: "REGION-0", servedFrac: 0.6, ask: 1.4 }] },
    ];
    const actions = [{ kind: "net_launch", at_tick: 260, payload: {} }];
    expect(respondedToOwnSuccessStrain(timeline, actions)).toBe(true);
  });
  it("does not fire on growth the player never answered", () => {
    const timeline = [
      { turn: 1, tick: 100, regions: [{ id: "REGION-0", servedFrac: 0.9, ask: 1.0 }] },
      { turn: 2, tick: 200, regions: [{ id: "REGION-0", servedFrac: 0.6, ask: 1.4 }] },
    ];
    expect(respondedToOwnSuccessStrain(timeline, [])).toBe(false);
  });
});

describe("M6/M8 — the legibility rates and the softlock read", () => {
  const acted = (n, noop) => Array.from({ length: n }, (_, i) => ({ turn: i + 1, tick: i * 100, action: { do: "click", target: "x" }, noop }));
  it("three consecutive no-op turns is a softlock", () => {
    expect(computeMetrics({ actions: [], timeline: acted(3, true) }).m6_completed_without_softlock).toBe(false);
    expect(computeMetrics({ actions: [], timeline: acted(2, true) }).m6_completed_without_softlock).toBe(true);
  });
  it("a page error fails M6 regardless of the trajectory", () => {
    expect(computeMetrics({ actions: [], timeline: acted(1, false), meta: { errors: 1 } }).m6_completed_without_softlock).toBe(false);
  });
  it("rates count reaches-for-nothing (invalid) apart from pressed-and-nothing-happened (no-op)", () => {
    const timeline = [
      { turn: 1, tick: 1, invalid: true },
      { turn: 2, tick: 2, action: { do: "click", target: "a" }, noop: true },
      { turn: 3, tick: 3, action: { do: "click", target: "b" }, noop: false },
    ];
    const m = computeMetrics({ actions: [], timeline });
    expect(m.m8_invalid_action_rate).toBeCloseTo(1 / 3);
    expect(m.m8b_no_op_action_rate).toBeCloseTo(1 / 2);
  });
});

describe("M7/M9/M11/M12 — the run's shape", () => {
  const timeline = [
    { turn: 1, tick: 100, cursor: 0, servedAny: false, balance: 75000, missionElapsedS: 10 },
    { turn: 2, tick: 200, cursor: 0, servedAny: true, balance: 62750, missionElapsedS: 300, breachSecondsTotal: 0 },
    { turn: 3, tick: 300, cursor: 1, servedAny: true, balance: 68000, missionElapsedS: 900, breachSecondsTotal: 12 },
  ];
  it("first serve is reported in mission seconds and in turns", () => {
    const m = computeMetrics({ actions: [], timeline });
    expect(m.m9_time_to_first_served_s).toBe(300);
    expect(m.m9b_turns_to_first_served).toBe(2);
    expect(m.m11_acts_reached).toBe(1);
    expect(m.m12_economy).toMatchObject({ final_eur: 68000, min_eur: 62750, breach_seconds_total: 12, ended_net_positive: true });
  });
  it("the novice floor is only measured for the restricted persona", () => {
    expect(computeMetrics({ actions: [], timeline }).m7_novice_floor_reachable).toBeNull();
    expect(computeMetrics({ actions: [], timeline, meta: { persona: "novice-floor" } }).m7_novice_floor_reachable).toBe(true);
  });
});

describe("baseline normalisation", () => {
  it("places the agent between the random floor and the scripted ceiling", () => {
    expect(normalise(5, 1, 9)).toBeCloseTo(0.5);
    expect(normalise(5, 3, 3)).toBeNull();
  });
});

describe("M8 — protocol noise is quarantined from the legibility reading", () => {
  it("a rejected JSON shape never counts as reaching for a control that is not there", () => {
    const timeline = [
      { turn: 1, tick: 1, action: { do: "set" }, invalidShape: true },
      { turn: 2, tick: 2, action: { do: "click", target: "ghost" }, invalid: true },
      { turn: 3, tick: 3, action: { do: "click", target: "accept" }, noop: false },
    ];
    const m = computeMetrics({ actions: [], timeline });
    expect(m.m8_invalid_action_rate).toBeCloseTo(1 / 2); // one affordance miss out of one miss + one real act
    expect(m.m8c_protocol_noise.shape_rejects).toBe(1);
  });
});
