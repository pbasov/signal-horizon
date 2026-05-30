/**
 * net/ — THE SELF-DIAGNOSING DIAGNOSTIC / TRACE VIEW (design §2.6 / §7.4 — M1 NECESSITY).
 *
 * The ONE job: turn *"the solver says no"* into *"I launch THAT."* The trace is the SINGLE
 * legibility surface (§5.3 — one system, double duty): it carries the binding-constraint +
 * kind-of-fix readout, the optimisation/resilience shortfalls (over-provisioned links + single
 * points of failure), the active fault state, AND the PREDICTABILITY SEED (every link loss
 * stamped with its geometric cause + the sim-time it happened). It NEVER does the fix for the
 * player — it names the binding constraint and the KIND of fix and stops.
 *
 * --- READ-OVER-SNAPSHOT, PURE (design §2.6 / §7.4) -------------------------------
 * `diagnose` is a PURE function of a SNAPSHOT: the per-contract last {@link SolveResult}
 * (the session exposes `lastSolveFor(id)`), the {@link Contract} demand, the live sat
 * {@link NetSat} roster, the active {@link FaultState}s, and the aggregate shared load. It
 * RE-DERIVES nothing from physics (no eph, no solver re-run): it reads the verdict the router
 * already produced + the roster/paths it routed over. So it is trivially replay-safe and adds
 * NO new fold state — the session folds only the BOOLEANS it sets from the report
 * (`surfacedShortfall`), never the report.
 *
 * --- THE FOUR FACES (design C2.5 / §7.4 / §7.5) ----------------------------------
 *   1. BINDING-CONSTRAINT + KIND-OF-FIX — from each unserved contract's `bindingConstraint`:
 *        connectivity → "no path; launch a covering sat"           ({@link "addCoveringSat"})
 *        availability → "availability breaks ~N/orbit; phase a sat" ({@link "addPhasedSat"})
 *        latency      → "latency floor {ms}ms; a shorter route cuts it" ({@link "shorterRoute"})
 *        bandwidth    → "trunk via [sat] saturated by N; parallel path/prefer-bw" ({@link "addParallelPath"})
 *   2. OPTIMISATION/RESILIENCE — the §3a optimizer pull (the act3b gate's layer-1 target):
 *        OVER-PROVISION (waste) → a sat running far under capacity while another contract
 *          breaches ({@link "shareIdleCapacity"}).
 *        SPOF (risk) → a SERVED contract whose only bridging sat is one (no redundant bridge in
 *          the roster/paths) ({@link "addRedundantPath"}).
 *   3. FAULT STATE — each active {@link FaultState} as a SYSTEM.LOG line (degradation amber
 *      pulse + est. recovery; telegraphed countdown "fails in {n}").
 *   4. THE PREDICTABILITY SEED (§7.5 REQUIRED) — every {@link SolveResult.losses} entry stamped
 *      "link [aId]↔[bId] lost: [cause] at [atS]". The router already carries it ({@link LossStamp}
 *      aligned with the router {@link LinkLossStamp}); the trace renders it verbatim.
 *
 * --- PARALLELISM (design §C2 / the brief) ----------------------------------------
 * trace.ts is STANDALONE: it imports ONLY the shared {@link import("./fault-types")} types +
 * the router's {@link SolveResult}/{@link LinkLossStamp}/{@link RouterAxis} as TYPES (they erase
 * at compile — no runtime edge) + {@link Contract}/{@link NetSat} as types. It does NOT import
 * fault.ts (a sibling builds that in parallel; the shared seam is the {@link FaultState} TYPE,
 * declared in fault-types.ts). It draws NO rng + touches NO session — a pure view.
 *
 * PURE: no three / DOM / wall-clock / unseeded-random. Minimal + stable.
 *
 * @see docs/signal-horizon-m1-act3-act4-design.md (ACT 3, C2.5 — trace.ts / §7.4 / §7.5).
 * @see docs/signal-horizon-m1-onboarding.md (Act 3, sub-beat 3B).
 */

import type { Contract } from "./contract";
import type { NetSat } from "./sat";
// TYPE-ONLY imports from the router (erase at compile — no runtime coupling to the solver impl).
import type { SolveResult, LinkLossStamp, RouterAxis } from "./router";
// The SHARED fault-types seam (parallel-build with fault.ts — type + pure-data surface only).
import type {
  FaultState,
  TraceReport,
  TraceShortfall,
  ShortfallFixKind,
  LossStamp,
} from "./fault-types";
import { telegraphedCountdownRemainingS } from "./fault-types";
import { NET_LINK_CAPACITY_UNITS } from "./link-budget";

/** The fraction of {@link NET_LINK_CAPACITY_UNITS} below which a sat that is BRIDGING a served
 * contract is flagged OVER-PROVISIONED (idle capacity) — surfaced ONLY when ANOTHER contract is
 * concurrently unserved/breaching (the design's "capacity idle WHILE another breaches"). Sized
 * so a sat carrying a single ~1.0-load contract (well under the 1.5 capacity) reads as idle when
 * a neighbour breaches; tune later. Placeholder. */
export const TRACE_OVERPROVISION_FRACTION = 0.5;

/** One ROUTER SOLVE the trace reads, paired with its contract (the read-over-snapshot input: the
 * session's `lastSolveFor(contract.id)`). A null `solve` means the contract was never solved this
 * sitting (offered, not active) — the trace skips it. */
export interface ContractSolve {
  /** The contract demand (its region/label/active axes + the latency SLA the readout quotes). */
  contract: Contract;
  /** The router's LAST verdict for this contract (path / latency / binding / losses), or null. */
  solve: SolveResult | null;
}

/** The pure read-over-snapshot INPUT for {@link diagnose} (one step). Everything is a value the
 * session already holds — the trace re-derives nothing from physics. */
export interface TraceInput {
  /** Each contract + its last router verdict (the session's `contracts` × `lastSolveFor`). */
  solves: ContractSolve[];
  /** The live launched-sat roster (for the SPOF/over-provision parse over the roster+paths). */
  sats: readonly NetSat[];
  /** The active fault states this step (the SYSTEM.LOG face). Empty/absent before act3b. */
  faults?: readonly FaultState[];
  /** The aggregate shared load `satId → Σ offeredLoad` this step (the over-provision parse +
   * the bandwidth "carries N contracts" readout). Absent/empty before act3a ⇒ no congestion face. */
  loadBySat?: ReadonlyMap<string, number>;
  /** Sim-time of the step (the countdown/recovery readouts + the loss-stamp wording). */
  t: number;
}

// ── kind-of-fix mapping (the §7.4 binding-constraint → fix vocabulary) ────────────

/** Map a failing SLA {@link RouterAxis} to the discriminated {@link ShortfallFixKind} the UI
 * affordance keys on (design C2.5/§7.4). Pure total mapping. */
function fixKindForAxis(axis: RouterAxis): ShortfallFixKind {
  switch (axis) {
    case "connectivity":
      return "addCoveringSat";
    case "availability":
      return "addPhasedSat";
    case "latency":
      return "shorterRoute";
    case "bandwidth":
      return "addParallelPath";
  }
}

/**
 * Render the §7.4 binding-constraint + kind-of-fix MESSAGE for an unserved contract on a failing
 * axis. Names the fix, never does it. Pure (a function of the contract + its solve + t).
 *   - connectivity → "no path; launch a covering sat"
 *   - availability → "availability breaks ~each orbit; add a phased sat in this plane"
 *   - latency      → "latency floor {ms}ms via this path; a shorter LEO/relay route cuts it"
 *   - bandwidth    → "trunk via [sat] saturated by N shared contracts; add a parallel path / prefer-bw"
 */
function bindingConstraintMessage(
  contract: Contract,
  solve: SolveResult,
  axis: RouterAxis,
  loadBySat: ReadonlyMap<string, number> | undefined,
): string {
  switch (axis) {
    case "connectivity":
      return `${contract.label}: no path to the ground network — launch a covering sat.`;
    case "availability":
      return (
        `${contract.label}: availability breaks ~each orbit (the region sets between passes) — ` +
        `add ≥1 more phased sat in this plane so one rises as another sets.`
      );
    case "latency": {
      const ms = Number.isFinite(solve.latencyS) ? (solve.latencyS * 1000).toFixed(1) : "∞";
      const slaMs = Number.isFinite(contract.slaLatencyS)
        ? (contract.slaLatencyS * 1000).toFixed(1)
        : "∞";
      return (
        `${contract.label}: latency floor too high — this path is ${ms}ms (the ${slaMs}ms SLA ` +
        `binds); a shorter LEO/relay route cuts it.`
      );
    }
    case "bandwidth": {
      // The chosen bridging sat is path[1] (region → sat → ground). The shared count is how many
      // contracts the aggregate routed over it (the "trunk saturated by N" readout).
      const satId = solve.path?.[1] ?? null;
      const carried = satId !== null ? (loadBySat?.get(satId) ?? contract.offeredLoad) : contract.offeredLoad;
      const via = satId !== null ? ` via ${satId}` : "";
      return (
        `${contract.label}: trunk${via} saturated — combined load ${carried.toFixed(2)} exceeds ` +
        `capacity ${NET_LINK_CAPACITY_UNITS.toFixed(2)}; add a parallel path or set prefer-bw on ${contract.label}.`
      );
    }
  }
}

/**
 * Render the §7.5 PREDICTABILITY-SEED stamp for ONE link loss: "link [aId]↔[bId] lost: [cause]
 * at [atS]." The geometric cause + the sim-time — the "information that was always there" the M2
 * forecast later surfaces. Pure. Exposed so the test can pin the wording. */
export function renderLossStamp(loss: LossStamp): string {
  return `link ${loss.aId}↔${loss.bId} lost: ${loss.cause} at ${loss.atS}`;
}

/**
 * Render ONE active {@link FaultState} as a SYSTEM.LOG line (design §5.3). Pure (a function of the
 * fault + t):
 *   - degradation → "[sat] DEGRADED: bandwidth −{1-mult}%, est. recovery in {recoversAtS-t}"
 *   - transient   → "[sat] TRANSIENT OUTAGE: recovery in {recoversAtS-t}"
 *   - telegraphed → "[sat] FAILURE WARNING: fails in {failsAtS-t}" (the watch-and-act countdown)
 *   - hard        → "[sat] HARD FAILURE: permanent" */
export function renderFaultLine(fault: FaultState, t: number): string {
  switch (fault.kind) {
    case "degradation": {
      const dropPct = Math.round((1 - fault.degradedCapacityFactor) * 100);
      const recoverIn = Math.max(0, fault.recoversAtS - t);
      const recoverTxt = Number.isFinite(recoverIn) ? recoverIn.toFixed(0) : "∞";
      return `${fault.satId} DEGRADED (${fault.cause}): bandwidth −${dropPct}%, est. recovery in ${recoverTxt}s.`;
    }
    case "transient": {
      const recoverIn = Math.max(0, fault.recoversAtS - t);
      const recoverTxt = Number.isFinite(recoverIn) ? recoverIn.toFixed(0) : "∞";
      return `${fault.satId} TRANSIENT OUTAGE (${fault.cause}): recovery in ${recoverTxt}s.`;
    }
    case "telegraphed": {
      const failsIn = telegraphedCountdownRemainingS(fault, t);
      const failsTxt = Number.isFinite(failsIn) ? failsIn.toFixed(0) : "∞";
      return `${fault.satId} FAILURE WARNING (${fault.cause}): fails in ${failsTxt}s — re-route or launch a replacement.`;
    }
    case "hard":
      return `${fault.satId} HARD FAILURE (${fault.cause}): permanent.`;
  }
}

/**
 * THE SELF-DIAGNOSING VIEW (design §2.6 / §7.4 / C2.5). Pure read-over-snapshot: turn the
 * router's verdicts + the roster/paths + the fault state into the single {@link TraceReport}
 * legibility surface — the binding-constraint + kind-of-fix shortfalls, the optimisation/
 * resilience shortfalls (over-provision + SPOF), the active fault SYSTEM.LOG, and the flat
 * predictability-seed loss roll. Re-derives nothing from physics; folds nothing (the session
 * folds only the booleans it sets from this).
 */
export function diagnose(input: TraceInput): TraceReport {
  // `input.t` is part of the snapshot (the SYSTEM.LOG / loss-stamp wording the session renders via
  // renderFaultLine/renderLossStamp at the same t), but diagnose itself passes the fault states +
  // losses through verbatim — it does not need t for the parse, so it is not destructured here.
  const { solves, sats, faults, loadBySat } = input;
  const shortfalls: TraceShortfall[] = [];
  const losses: LossStamp[] = [];

  // Is ANY contract concurrently unserved/breaching? (Gates the over-provision "while another
  // breaches" surface — idle capacity is only a shortfall when someone else is short.)
  const anyUnserved = solves.some((s) => s.solve !== null && s.contract.state === "active" && !s.solve.served);

  // ── (1) BINDING-CONSTRAINT + KIND-OF-FIX, per unserved contract; collect the loss stamps. ──
  for (const { contract, solve } of solves) {
    if (solve === null) continue;
    // The predictability seed: every loss stamp this solve, gathered into the flat roll AND
    // carried on the per-contract shortfall (the §7.5 cause + time).
    const myLosses: LossStamp[] = solve.losses.map((l: LinkLossStamp) => ({ ...l }));
    for (const l of myLosses) losses.push(l);

    if (contract.state !== "active") continue;
    if (solve.served) continue; // a served contract has no binding-constraint shortfall.

    const axis: RouterAxis = solve.bindingConstraint ?? "connectivity";
    shortfalls.push({
      subjectId: contract.id,
      message: bindingConstraintMessage(contract, solve, axis, loadBySat),
      kindOfFix: fixKindForAxis(axis),
      bindingConstraint: axis,
      losses: myLosses,
    });
  }

  // ── (2a) OVER-PROVISION (waste) — a bridging sat running far under capacity WHILE another ──
  // contract breaches (the §3a optimizer pull). Surfaced per under-loaded sat carrying a served
  // contract. Reads the roster+paths+loadBySat; re-derives nothing.
  if (loadBySat !== undefined && anyUnserved) {
    const idleThreshold = TRACE_OVERPROVISION_FRACTION * NET_LINK_CAPACITY_UNITS;
    const reported = new Set<string>();
    for (const { solve } of solves) {
      if (solve === null || !solve.served) continue;
      const satId = solve.path?.[1] ?? null;
      if (satId === null || reported.has(satId)) continue;
      const load = loadBySat.get(satId) ?? 0;
      if (load < idleThreshold) {
        reported.add(satId);
        const pct = Math.round((load / NET_LINK_CAPACITY_UNITS) * 100);
        shortfalls.push({
          subjectId: satId,
          message:
            `${satId} runs at ${pct}% of capacity — idle headroom while another contract breaches; ` +
            `this contract could SHARE it (re-route / prefer-bw).`,
          kindOfFix: "shareIdleCapacity",
          bindingConstraint: null,
        });
      }
    }
  }

  // ── (2b) SPOF (risk) — a SERVED contract whose only bridging sat is one (no redundant bridge ──
  // in the roster/paths). Surfaced from the roster+paths: the contract is served via path[1], and
  // it is the SINGLE sat carrying that contract while the roster offers no peer in the same role
  // (≥2 sats would give the redundant builder a second bridge). Reflect fault state: a SPOF whose
  // single sat is itself faulting is the brittle-builder warning.
  const faultedSatIds = new Set<string>((faults ?? []).map((f) => f.satId));
  for (const { contract, solve } of solves) {
    if (solve === null || !solve.served) continue;
    if (contract.state !== "active") continue;
    const satId = solve.path?.[1] ?? null;
    if (satId === null) continue;
    // Redundancy heuristic over the roster+paths: a contract whose served path rides ONE sat and
    // whose roster offers no SECOND sat that could carry it (≤1 sat in the roster) has no redundant
    // bridge — one fault drops it. (≥2 sats ⇒ assume a redundant builder, no SPOF surfaced.) The
    // session's richer re-run-excluding-the-sat check refines this when it wires the trace; the
    // pure view flags the unmistakable single-sat case the act3b gate's layer-1 target needs.
    const isSpof = sats.length <= 1;
    const faulting = faultedSatIds.has(satId);
    if (isSpof || faulting) {
      shortfalls.push({
        subjectId: contract.id,
        message:
          `${contract.label}: no redundant path — served only via ${satId}` +
          (faulting ? " (now faulting)" : "") +
          `; one sat fault drops it. Add a phased sat / parallel orbit.`,
        kindOfFix: "addRedundantPath",
        bindingConstraint: null,
      });
    }
  }

  // ── (3) FAULT STATE — the active faults pass through verbatim (the SYSTEM.LOG face renders
  // them via renderFaultLine; the report carries the states so the session folds off them). ──
  const faultStates: FaultState[] = (faults ?? []).map((f) => ({ ...f }));

  return { shortfalls, faults: faultStates, losses };
}
