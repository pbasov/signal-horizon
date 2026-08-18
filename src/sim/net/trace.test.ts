import { describe, it, expect } from "vitest";
import {
  diagnose,
  renderLossStamp,
  renderFaultLine,
  FIX_CLAUSE,
  TRACE_OVERPROVISION_FRACTION,
  type ContractSolve,
} from "./trace";
import type { SolveResult, RouterAxis } from "./router";
import type { Contract, SlaAxis } from "./contract";
import { offerNetContract } from "./contract";
import type { FaultState, LossStamp, ShortfallFixKind } from "./fault-types";
import { NET_ACT1_REGION, NET_ACT2_REGION_LAT_RAD, type Region } from "./endpoint";
import { NET_LINK_CAPACITY_UNITS, NET_REF_LINK_DISTANCE_M } from "./link-budget";
import type { NetSat } from "./sat";
import { standardLoadout } from "./sat";
import { GEO_PARK, resolveOrbit } from "./world";

/**
 * net/ C2.5 — THE TRACE (self-diagnosing diagnostic view). PURE read-over-snapshot: pins exactly
 * what trace.ts builds — the right BINDING CONSTRAINT + KIND-OF-FIX per shortfall kind (connectivity
 * / availability / latency / bandwidth), the OVER-PROVISION + SPOF resilience shortfalls, the
 * PREDICTABILITY-SEED loss stamp wording (geometric cause + time), and the fault-state SYSTEM.LOG
 * lines. The trace re-derives nothing from physics — it reads SolveResults the router already
 * produced — so the test constructs SolveResult snapshots directly (read-over-snapshot).
 *
 * Standalone: imports the SHARED fault-types + router TYPES only (no fault.ts, no session).
 */

const REGION_2: Region = {
  id: "REGION-2",
  label: "corridor metro",
  latRad: 0,
  lonRad: 3 * (Math.PI / 180),
  radiusRad: NET_ACT1_REGION.radiusRad,
  bodyId: "earth",
};

const REGION_1: Region = {
  id: "REGION-1",
  label: "polar metro",
  latRad: NET_ACT2_REGION_LAT_RAD,
  lonRad: 5 * (Math.PI / 180),
  radiusRad: NET_ACT1_REGION.radiusRad,
  bodyId: "earth",
};

/** An ACTIVE contract over a region, with the given active axes. */
function activeContract(
  id: string,
  region: Region,
  axes: SlaAxis[],
  opts?: { slaLatencyS?: number; offeredLoad?: number },
): Contract {
  const c = offerNetContract(id, region, {
    activeAxes: new Set<SlaAxis>(axes),
    slaLatencyS: opts?.slaLatencyS,
    offeredLoad: opts?.offeredLoad,
  });
  c.state = "active";
  return c;
}

/** A SERVED solve result (a path region→sat→ground). */
function served(region: string, satId: string, latencyS = 0.002): SolveResult {
  return {
    served: true,
    path: [region, satId, "GROUND-0"],
    pipe: `${satId}:0`,
    latencyS,
    bindingConstraint: null,
    losses: [],
  };
}

/** An UNSERVED solve result on a binding axis, with an optional loss stamp. */
function unserved(opts: {
  region: string;
  axis: RouterAxis;
  path?: string[] | null;
  latencyS?: number;
  losses?: LossStamp[];
}): SolveResult {
  return {
    served: false,
    path: opts.path ?? null,
    pipe: opts.path && opts.path.length > 1 ? `${opts.path[1]}:0` : null,
    latencyS: opts.latencyS ?? Infinity,
    bindingConstraint: opts.axis,
    losses: opts.losses ?? [],
  };
}

function sat(id: string): NetSat {
  return {
    id,
    orbit: resolveOrbit(GEO_PARK, 0),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

const solveOf = (contract: Contract, solve: SolveResult | null): ContractSolve => ({ contract, solve });

describe("trace.diagnose — binding constraint + kind-of-fix per shortfall kind", () => {
  it("CONNECTIVITY: no path → addCoveringSat", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const r = diagnose({
      solves: [solveOf(c, unserved({ region: "REGION-0", axis: "connectivity" }))],
      sats: [sat("SAT-A"), sat("SAT-B")],
      t: 10,
    });
    expect(r.shortfalls).toHaveLength(1);
    const s = r.shortfalls[0];
    expect(s.subjectId).toBe("REGION-0");
    expect(s.kindOfFix).toBe("addCoveringSat");
    expect(s.bindingConstraint).toBe("connectivity");
    expect(s.message).toMatch(/no path/i);
    expect(s.message).toMatch(/covering sat/i);
  });

  it("AVAILABILITY: breaks each orbit → addPhasedSat", () => {
    const c = activeContract("REGION-1", REGION_1, ["connectivity", "availability"]);
    const r = diagnose({
      solves: [solveOf(c, unserved({ region: "REGION-1", axis: "availability" }))],
      sats: [sat("SAT-A"), sat("SAT-B")],
      t: 10,
    });
    const s = r.shortfalls[0];
    expect(s.kindOfFix).toBe("addPhasedSat");
    expect(s.bindingConstraint).toBe("availability");
    expect(s.message).toMatch(/availability breaks/i);
    expect(s.message).toMatch(/phased/i);
  });

  it("LATENCY: floor too high → shorterRoute, quotes the ms floor + the SLA", () => {
    // A GEO-ish path latency 3.57 ms vs a 3 ms SLA — the GEO ceiling felt.
    const c = activeContract("REGION-2", REGION_2, ["connectivity", "latency"], { slaLatencyS: 0.003 });
    const r = diagnose({
      solves: [
        solveOf(
          c,
          unserved({ region: "REGION-2", axis: "latency", path: ["REGION-2", "SAT-GEO", "GROUND-0"], latencyS: 0.00357 }),
        ),
      ],
      sats: [sat("SAT-GEO")],
      t: 10,
    });
    const s = r.shortfalls[0];
    expect(s.kindOfFix).toBe("shorterRoute");
    expect(s.bindingConstraint).toBe("latency");
    expect(s.message).toMatch(/latency floor too high/i);
    expect(s.message).toMatch(/3\.6ms/); // 0.00357 * 1000 = 3.57 → "3.6"
    expect(s.message).toMatch(/3\.0ms SLA/); // the 3 ms SLA quoted
    expect(s.message).toMatch(/shorter/i);
  });

  it("BANDWIDTH: trunk saturated → addParallelPath, names the sat + the combined load", () => {
    const c = activeContract("REGION-2", REGION_2, ["connectivity", "bandwidth"], { offeredLoad: 1.4 });
    const load = new Map<string, number>([["SAT-LEO", 2.8]]); // two contracts over one sat, over capacity.
    const r = diagnose({
      solves: [
        solveOf(
          c,
          unserved({ region: "REGION-2", axis: "bandwidth", path: ["REGION-2", "SAT-LEO", "GROUND-0"] }),
        ),
      ],
      sats: [sat("SAT-LEO")],
      loadBySat: load,
      t: 10,
    });
    const s = r.shortfalls[0];
    expect(s.kindOfFix).toBe("addParallelPath");
    expect(s.bindingConstraint).toBe("bandwidth");
    expect(s.message).toMatch(/SAT-LEO/);
    expect(s.message).toMatch(/2\.80/); // combined load
    expect(s.message).toMatch(/parallel path|prefer-bw/i);
    expect(s.message).toContain(NET_LINK_CAPACITY_UNITS.toFixed(2));
  });
});

describe("trace.diagnose — the predictability seed (every loss stamped with cause + time)", () => {
  it("carries the loss stamp wording: link [a]↔[b] lost: [cause] at [t]", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const loss: LossStamp = { aId: "REGION-0", bId: "SAT-LEO", cause: "set_below_horizon", atS: 132 };
    const r = diagnose({
      solves: [solveOf(c, unserved({ region: "REGION-0", axis: "connectivity", losses: [loss] }))],
      sats: [sat("SAT-LEO")],
      t: 132,
    });
    // The flat predictability-seed roll carries the stamp.
    expect(r.losses).toHaveLength(1);
    expect(r.losses[0]).toMatchObject({ aId: "REGION-0", bId: "SAT-LEO", cause: "set_below_horizon", atS: 132 });
    // The per-contract shortfall ALSO carries it (the §7.5 cause + time on the subject).
    expect(r.shortfalls[0].losses).toHaveLength(1);
    // The rendered wording carries the geometric cause + the time.
    const text = renderLossStamp(r.losses[0]);
    expect(text).toBe("link REGION-0↔SAT-LEO lost: set_below_horizon at 132");
    expect(text).toMatch(/set_below_horizon/);
    expect(text).toMatch(/132/);
  });
});

describe("trace.diagnose — SPOF + over-provision are flagged on the right topologies", () => {
  it("SPOF: a served single-sat contract is flagged addRedundantPath", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-ONLY"))],
      sats: [sat("SAT-ONLY")], // exactly one sat in the roster ⇒ no redundant bridge.
      t: 10,
    });
    const spof = r.shortfalls.find((s) => s.kindOfFix === "addRedundantPath");
    expect(spof).toBeDefined();
    expect(spof?.subjectId).toBe("REGION-0");
    expect(spof?.message).toMatch(/no redundant path/i);
    expect(spof?.message).toMatch(/SAT-ONLY/);
    expect(spof?.bindingConstraint).toBeNull();
  });

  it("REDUNDANT builder: a served contract with ≥2 sats is NOT flagged SPOF", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-A"))],
      sats: [sat("SAT-A"), sat("SAT-B")], // a peer in the roster ⇒ redundancy assumed.
      t: 10,
    });
    expect(r.shortfalls.find((s) => s.kindOfFix === "addRedundantPath")).toBeUndefined();
  });

  it("SPOF reflects fault state: a served contract whose single bridging sat is FAULTING is flagged", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const fault: FaultState = {
      satId: "SAT-A",
      kind: "telegraphed",
      cause: "lowOrbit",
      startedAtS: 5,
      degradedCapacityFactor: 1.0,
      failsAtS: 50,
      recoversAtS: Infinity,
    };
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-A"))],
      sats: [sat("SAT-A"), sat("SAT-B")], // ≥2 sats, but the bridging one is faulting.
      faults: [fault],
      t: 10,
    });
    const spof = r.shortfalls.find((s) => s.kindOfFix === "addRedundantPath");
    expect(spof).toBeDefined();
    expect(spof?.message).toMatch(/faulting/i);
  });

  it("OVER-PROVISION: an idle bridging sat is flagged shareIdleCapacity ONLY when another breaches", () => {
    const servedC = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const breachC = activeContract("REGION-2", REGION_2, ["connectivity"]);
    const idleLoad = TRACE_OVERPROVISION_FRACTION * NET_LINK_CAPACITY_UNITS - 0.1; // below the idle threshold.
    const load = new Map<string, number>([["SAT-IDLE", idleLoad]]);

    // With a concurrent breach ⇒ the idle sat is surfaced.
    const withBreach = diagnose({
      solves: [
        solveOf(servedC, served("REGION-0", "SAT-IDLE")),
        solveOf(breachC, unserved({ region: "REGION-2", axis: "connectivity" })),
      ],
      sats: [sat("SAT-IDLE"), sat("SAT-PEER")],
      loadBySat: load,
      t: 10,
    });
    const op = withBreach.shortfalls.find((s) => s.kindOfFix === "shareIdleCapacity");
    expect(op).toBeDefined();
    expect(op?.subjectId).toBe("SAT-IDLE");
    expect(op?.message).toMatch(/idle/i);
    expect(op?.bindingConstraint).toBeNull();

    // Without any breach (the served contract alone) ⇒ no over-provision surfaced (idle is fine
    // when nobody is short).
    const noBreach = diagnose({
      solves: [solveOf(servedC, served("REGION-0", "SAT-IDLE"))],
      sats: [sat("SAT-IDLE"), sat("SAT-PEER")],
      loadBySat: load,
      t: 10,
    });
    expect(noBreach.shortfalls.find((s) => s.kindOfFix === "shareIdleCapacity")).toBeUndefined();
  });
});

describe("trace.diagnose — fault-state SYSTEM.LOG lines + report shape", () => {
  it("carries the active faults; renderFaultLine surfaces the degradation %, the countdown", () => {
    const degr: FaultState = {
      satId: "SAT-D",
      kind: "degradation",
      cause: "age",
      startedAtS: 0,
      degradedCapacityFactor: 0.5,
      failsAtS: Infinity,
      recoversAtS: 30,
    };
    const tele: FaultState = {
      satId: "SAT-T",
      kind: "telegraphed",
      cause: "lowOrbit",
      startedAtS: 0,
      degradedCapacityFactor: 1.0,
      failsAtS: 45,
      recoversAtS: Infinity,
    };
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-D"))],
      sats: [sat("SAT-D"), sat("SAT-T")],
      faults: [degr, tele],
      t: 10,
    });
    expect(r.faults).toHaveLength(2);

    const degrLine = renderFaultLine(degr, 10);
    expect(degrLine).toMatch(/SAT-D/);
    expect(degrLine).toMatch(/DEGRADED/);
    expect(degrLine).toMatch(/−50%/); // 1 - 0.5 = 50%
    expect(degrLine).toMatch(/recovery in 20s/); // 30 - 10 = 20

    const teleLine = renderFaultLine(tele, 10);
    expect(teleLine).toMatch(/FAILURE WARNING/);
    expect(teleLine).toMatch(/fails in 35s/); // 45 - 10 = 35
  });

  it("a SERVED contract with no fault + ≥2 sats yields NO shortfalls (clean network)", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-A"))],
      sats: [sat("SAT-A"), sat("SAT-B")],
      t: 10,
    });
    expect(r.shortfalls).toHaveLength(0);
    expect(r.faults).toHaveLength(0);
    expect(r.losses).toHaveLength(0);
  });

  it("an OFFERED (not active) contract with a null solve is skipped", () => {
    const c = offerNetContract("REGION-9", NET_ACT1_REGION, { activeAxes: new Set<SlaAxis>(["connectivity"]) });
    const r = diagnose({
      solves: [solveOf(c, null)],
      sats: [sat("SAT-A")],
      t: 10,
    });
    expect(r.shortfalls).toHaveLength(0);
  });
});

// ── SD-53 (P0) — the pure sim fixes the ROUTING SCREEN depends on ─────────────────────
// docs/routing-screen.md §9.3. Three of them close real divergences between what the ROUTER
// computed and what the TRACE said about it; the fourth is the shared fix-clause vocabulary.

describe("SD-53 S1 — capacity is denominated PER PIPE when the caller can say so", () => {
  it("a GATEWAY pipe at 3.00u against its own 4.00u antenna reads 4.00, not the uniform 1.50", () => {
    const c = activeContract("REGION-2", REGION_2, ["connectivity", "bandwidth"], { offeredLoad: 1.4 });
    const solve = unserved({ region: "REGION-2", axis: "bandwidth", path: ["REGION-2", "SAT-GW", "GROUND-0"] });
    const r = diagnose({
      solves: [solveOf(c, solve)],
      sats: [sat("SAT-GW")],
      loadByPipe: new Map([["SAT-GW:0", 3.0]]),
      capByPipe: new Map([["SAT-GW:0", 4.0]]),
      t: 10,
    });
    const s = r.shortfalls[0];
    expect(s.kindOfFix).toBe("addParallelPath");
    expect(s.message).toContain("3.00"); // the pipe's own load…
    expect(s.message).toContain("4.00"); // …against the pipe's own capacity.
    // The bug this closes: the message used to state 1.50 for every antenna in the game.
    expect(s.message).not.toContain(NET_LINK_CAPACITY_UNITS.toFixed(2));
  });

  it("with no pipe maps the wording is byte-identical to the pre-SD-53 fallback", () => {
    const c = activeContract("REGION-2", REGION_2, ["connectivity", "bandwidth"], { offeredLoad: 1.4 });
    const solve = unserved({ region: "REGION-2", axis: "bandwidth", path: ["REGION-2", "SAT-LEO", "GROUND-0"] });
    const r = diagnose({
      solves: [solveOf(c, solve)],
      sats: [sat("SAT-LEO")],
      loadBySat: new Map([["SAT-LEO", 2.8]]),
      t: 10,
    });
    expect(r.shortfalls[0].message).toContain(NET_LINK_CAPACITY_UNITS.toFixed(2));
    expect(r.shortfalls[0].message).toContain("2.80");
  });

  it("the OVER-PROVISION threshold is a fraction of THAT antenna, not of 1.50", () => {
    // 0.70u on a 4.00u GATEWAY is idle (17%); the same 0.70u on a 1.20u ACCESS-S is not (58%).
    const idle = activeContract("REGION-2", REGION_2, ["connectivity"]);
    const dark = activeContract("REGION-1", REGION_1, ["connectivity"]);
    const mk = (cap: number) =>
      diagnose({
        solves: [
          solveOf(idle, served("REGION-2", "SAT-BIG")),
          solveOf(dark, unserved({ region: "REGION-1", axis: "connectivity" })),
        ],
        sats: [sat("SAT-BIG")],
        loadByPipe: new Map([["SAT-BIG:0", 0.7]]),
        capByPipe: new Map([["SAT-BIG:0", cap]]),
        t: 10,
      }).shortfalls.find((s) => s.kindOfFix === "shareIdleCapacity");
    expect(mk(4.0)).toBeDefined();
    expect(mk(4.0)?.message).toMatch(/18% of capacity/); // 0.7 / 4.0
    expect(mk(1.2)).toBeUndefined();
  });
});

describe("SD-53 S3 — the SPOF face is exact when the caller supplies the redundancy set", () => {
  const twelveSats = Array.from({ length: 12 }, (_, i) => sat(`SAT-${i}`));

  it("a big fleet where only ONE bird reaches the region IS flagged (the coarse heuristic is not)", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const base = { solves: [solveOf(c, served("REGION-0", "SAT-3"))], sats: twelveSats, t: 10 };
    // Coarse fallback (sats.length <= 1): silent on a twelve-sat fleet — the shipped blind spot.
    expect(diagnose(base).shortfalls.find((s) => s.kindOfFix === "addRedundantPath")).toBeUndefined();
    // Exact: the caller says "REGION-0 has no second bridge right now".
    const exact = diagnose({ ...base, redundantById: new Set<string>() });
    const spof = exact.shortfalls.find((s) => s.kindOfFix === "addRedundantPath");
    expect(spof).toBeDefined();
    expect(spof?.subjectId).toBe("REGION-0");
    expect(spof?.message).toMatch(/SAT-3/);
  });

  it("a contract WITH a second bridge is silent even on a one-sat roster", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-ONLY"))],
      sats: [sat("SAT-ONLY")], // the coarse heuristic WOULD fire here…
      redundantById: new Set([c.id]), // …but the caller knows better.
      t: 10,
    });
    expect(r.shortfalls.find((s) => s.kindOfFix === "addRedundantPath")).toBeUndefined();
  });

  it("a faulting bridge still reads as brittle even when a redundant path exists", () => {
    const c = activeContract("REGION-0", NET_ACT1_REGION, ["connectivity"]);
    const fault: FaultState = {
      satId: "SAT-SICK",
      kind: "degradation",
      cause: "lowOrbit",
      startedAtS: 0,
      degradedCapacityFactor: 0.5,
      failsAtS: Infinity,
      recoversAtS: 30,
    };
    const r = diagnose({
      solves: [solveOf(c, served("REGION-0", "SAT-SICK"))],
      sats: [sat("SAT-SICK"), sat("SAT-B")],
      faults: [fault],
      redundantById: new Set([c.id]),
      t: 10,
    });
    expect(r.shortfalls.find((s) => s.kindOfFix === "addRedundantPath")?.message).toMatch(/faulting/i);
  });
});

describe("SD-53 S4 — FIX_CLAUSE is one canonical clause per fix kind", () => {
  it("covers every ShortfallFixKind and names hardware/geometry, never a control", () => {
    const kinds: ShortfallFixKind[] = [
      "addCoveringSat",
      "addPhasedSat",
      "shorterRoute",
      "addParallelPath",
      "shareIdleCapacity",
      "addRedundantPath",
    ];
    for (const k of kinds) {
      const clause = FIX_CLAUSE[k];
      expect(clause.length).toBeGreaterThan(10);
      // LAW 2: a fix clause never names a control, a key, or a button.
      expect(clause).not.toMatch(/\bpress\b|\bclick\b|\bbutton\b|\bkey\b|prefer-bw|net_/i);
    }
  });
});

describe("SD-53 S2 — the shortfall copy never names a solver parameter at the player", () => {
  it("the bandwidth tail asks for hardware, not for a control setting", () => {
    const c = activeContract("REGION-2", REGION_2, ["connectivity", "bandwidth"], { offeredLoad: 1.4 });
    const r = diagnose({
      solves: [
        solveOf(c, unserved({ region: "REGION-2", axis: "bandwidth", path: ["REGION-2", "SAT-LEO", "GROUND-0"] })),
      ],
      sats: [sat("SAT-LEO")],
      loadBySat: new Map([["SAT-LEO", 2.8]]),
      t: 10,
    });
    for (const s of r.shortfalls) expect(s.message).not.toMatch(/prefer-bw/i);
    expect(r.shortfalls[0].message).toMatch(/wider antenna/);
  });
});
