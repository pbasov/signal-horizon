/**
 * net/ — SHARED net-action application: the ONE place that turns a recorded
 * {@link SimAction} into a mutation of a {@link NetSession}. Both the LIVE loop (main.ts)
 * and the REPLAY driver call this, so the two paths cannot drift in WHEN or HOW a launch /
 * accept / prefer-change lands — the SAME determinism contract the m2 applyBuildAction holds.
 *
 * ORDERING (live == replay, design §4): each tick `session.step(t)` runs FIRST (serve/breach
 * + revenue + the scenario gate + the fault rolls), THEN any net action recorded at that tick
 * applies post-step via this applier. Identical to the m2-build-replay + main.ts order.
 *
 * THE BOUNDARY IS RADIANS + SI METRES (design §4): net_launch carries `semiMajorM` (metres),
 * `incRad`/`subLonRad` (radians), and `count` (the batch size, 1 in Act 1). The epoch-correct
 * `m0 = subLon + ω·t` is recomputed at apply time from `t = atTick·dt`, so the parked
 * body-fixed longitude is exact at any commit tick (the world.ts resolveOrbit invariant).
 *
 * PURE + DETERMINISTIC: a function of (eph, session, action, dt). No three / DOM / wall-clock;
 * any RNG is the session's seeded splitmix64 (faults, Act 3b — absent here). Returns the
 * outcome (or null for a non-net action) for the live caller's feedback + record decision.
 *
 * @see docs/signal-horizon-m1-design.md §4 (action kinds + apply order), §2.3 (the planner).
 */

import type { Ephemeris } from "../ephemeris";
import {
  KIND_NET_LAUNCH,
  KIND_NET_ACCEPT,
  KIND_NET_SET_PREFER,
  KIND_NET_PLACE_CACHE,
  type SimAction,
  type JsonValue,
} from "../action";
import type { NetSession } from "./session";
import type { NetSat } from "./sat";
import { standardLoadout } from "./sat";
import { resolveOrbit, MARS_RELAY } from "./world";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

/** The outcome of applying a net action (for the live caller's feedback + log). */
export interface NetActionResult {
  /** What happened: a launch, a contract accept, a prefer change, a cache placement, or rejected. */
  kind: "sats_launched" | "contract_accepted" | "prefer_set" | "cache_placed" | "rejected";
  /** The new sat ids when a launch added some (batch ⇒ one per `count`). */
  satIds?: string[];
  /** € charged by this action (0 for accept/prefer; the launch cost for a launch). */
  costEur: number;
  /** For an accept/prefer: the affected contract id (for the live caller's feedback). */
  contractId?: string;
}

/** Coerce a JSON payload value to a finite number (0 on a non-number/NaN). */
function num(v: JsonValue | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/**
 * Apply a net action recorded at `action.atTick` to `session`. The launch needs the sim-time
 * the sat reaches orbit, derived from the recorded tick: `t = atTick·dt` (the SAME instant
 * main.ts launches at live), so the orbit epoch — and the epoch-correct `m0 = subLon + ω·t`
 * — is reproducible. Returns the {@link NetActionResult}, or null for a non-net action
 * (the unknown-kind no-op, asserted in the A2 test). Pure + deterministic.
 */
export function applyNetAction(
  eph: Ephemeris,
  session: NetSession,
  action: SimAction,
  dt: number,
): NetActionResult | null {
  if (action.kind === KIND_NET_LAUNCH) {
    const semiMajorM = num(action.payload.semiMajorM);
    const incRad = num(action.payload.incRad);
    const subLonRad = num(action.payload.subLonRad);
    // count is the batch size (1 in Act 1); clamp to ≥1 so a missing/0 count still launches one.
    const count = Math.max(1, Math.trunc(num(action.payload.count) || 1));
    // The even in-plane mean-anomaly spread between adjacent batch members (Act 2 §3.4). Absent
    // (= 0) ⇒ Act-1 identical-plane behaviour: member i's m0 += 0, so the orbit is byte-identical.
    const phaseSpreadRad = num(action.payload.phaseSpreadRad);
    // ACT 4 — the "launch toward Mars" verb is the SAME net_launch; the Mars-relay PRESET makes
    // the launched sat carry the deep-space relay id (so the router's solveMarsLeg presence test
    // recognises it). Earth launches keep the monotonic NET-SAT-N id (byte-identical, golden-safe).
    const isRelay = action.payload.presetId === MARS_RELAY.id;
    const t = action.atTick * dt;
    const satIds: string[] = [];
    for (let i = 0; i < count; i++) {
      const id = isRelay ? session.nextRelaySatId() : session.nextSatId();
      // Each member is the SAME plane (a/inc/subLon), phase-shifted by i·phaseSpreadRad in mean
      // anomaly. resolveOrbit sets m0 = subLon + ω·t; the phase offset adds onto that m0, so one
      // launch places `count` evenly-phased sats — a constellation that hands off (§3.4). With
      // phaseSpreadRad = 0 the offset is 0 ⇒ bit-identical to the pre-Act-2 single launch.
      const orbit = resolveOrbit({ semiMajorM, incRad, subLonRad }, t);
      orbit.m0Rad += i * phaseSpreadRad;
      const sat: NetSat = {
        id,
        orbit,
        bus: "smallsat",
        loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
      };
      satIds.push(session.launchSat(sat));
    }
    return { kind: "sats_launched", satIds, costEur: 0 };
  }
  if (action.kind === KIND_NET_ACCEPT) {
    const id = typeof action.payload.contractId === "string" ? action.payload.contractId : "";
    const c = session.acceptContract(id);
    if (c === null) return { kind: "rejected", costEur: 0 };
    return { kind: "contract_accepted", costEur: 0, contractId: c.id };
  }
  if (action.kind === KIND_NET_SET_PREFER) {
    const id = typeof action.payload.contractId === "string" ? action.payload.contractId : "";
    const c = session.setPrefer(id, num(action.payload.lat), num(action.payload.bw), num(action.payload.stab));
    if (c === null) return { kind: "rejected", costEur: 0 };
    return { kind: "prefer_set", costEur: 0, contractId: c.id };
  }
  if (action.kind === KIND_NET_PLACE_CACHE) {
    // ACT 4 (D1) — place the ONE cache breadcrumb ("data closer helps"). Deterministic, no roll:
    // re-captures the Mars sample at t (age 0 ⇒ the freshness readout jumps up by sight). It does
    // NOT change served/breach or revenue (a felt breadcrumb, NOT a relief lever; §8 fenced).
    const t = action.atTick * dt;
    session.placeMarsCache(eph, t);
    return { kind: "cache_placed", costEur: 0 };
  }
  return null;
}
