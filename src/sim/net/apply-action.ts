/**
 * net/ — SHARED net-action application: the ONE place that turns a recorded
 * {@link SimAction} into a mutation of a {@link NetSession}. Both the LIVE loop (main.ts)
 * and the REPLAY driver call this, so the two paths cannot drift in WHEN or HOW a launch /
 * accept / beam / prefer-change lands.
 *
 * R0 (SD-45): the launch verb carries the sat DESIGN (bus tier + antenna-card loadout) and
 * commits a LAUNCH EVENT (countdown → ascent → deploy pipeline; seeded vehicle-loss /
 * underburn / no-sep rolls at commit) instead of teleporting sats into orbit. Two new verbs:
 * `net_assign_beam` (the pointing verb) and `net_circularize` (the underburn fix).
 *
 * ORDERING (live == replay, design §4): each tick `session.step(t)` runs FIRST, THEN any
 * net action recorded at that tick applies post-step via this applier.
 *
 * PURE + DETERMINISTIC: a function of (eph, session, action, dt). No three / DOM /
 * wall-clock; all RNG is the session's seeded splitmix64.
 *
 * @see docs/m1-redesign.md §2.2-§2.3; docs/signal-horizon-m1.md Part II §4.
 */

import type { Ephemeris } from "../ephemeris";
import {
  KIND_NET_LAUNCH,
  KIND_NET_ACCEPT,
  KIND_NET_SET_PREFER,
  KIND_NET_PLACE_CACHE,
  KIND_NET_ASSIGN_BEAM,
  KIND_NET_CIRCULARIZE,
  type SimAction,
  type JsonValue,
} from "../action";
import type { NetSession } from "./session";
import { NET_CIRCULARIZE_COST_EUR } from "./session";
import type { NetSat, BusTier } from "./sat";
import { resolveLoadout, validateLoadout, DEFAULT_LOADOUT_CARD_IDS } from "./sat";
import { resolveOrbit, MARS_RELAY, launchStackCost } from "./world";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

/** The outcome of applying a net action (for the live caller's feedback + log). */
export interface NetActionResult {
  /** What happened. "sats_launched" = the launch event is committed and ≥1 member will
   * deploy; "launch_failed" = the vehicle was lost / every member failed separation. */
  kind:
    | "sats_launched"
    | "launch_failed"
    | "contract_accepted"
    | "prefer_set"
    | "beam_assigned"
    | "circularized"
    | "cache_placed"
    | "rejected";
  /** The committed member sat ids that WILL deploy (empty on a lost vehicle). */
  satIds?: string[];
  /** € charged by this action (launch stack / circularization burn; 0 otherwise). */
  costEur: number;
  /** How many members will NOT deploy (no-sep, or the whole batch on a lost vehicle). */
  failedCount?: number;
  /** For an accept/prefer: the affected contract id. */
  contractId?: string;
  /** For a rejected design/beam action: the human-readable problem. */
  problem?: string;
}

/** Coerce a JSON payload value to a finite number (0 on a non-number/NaN). */
function num(v: JsonValue | undefined): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

/** Coerce a JSON payload value to a string ("" on a non-string). */
function str(v: JsonValue | undefined): string {
  return typeof v === "string" ? v : "";
}

/**
 * Apply a net action recorded at `action.atTick` to `session`. Pure + deterministic;
 * returns the {@link NetActionResult}, or null for a non-net action.
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
    const raanRad = num(action.payload.raanRad);
    const count = Math.max(1, Math.trunc(num(action.payload.count) || 1));
    const phaseSpreadRad = num(action.payload.phaseSpreadRad);
    const isRelay = action.payload.presetId === MARS_RELAY.id;
    const t = action.atTick * dt;

    // R0 (SD-45): the sat DESIGN on the wire. Absent/empty bus/loadout ⇒ the standard
    // broadcast smallsat (the pre-R0 default), so a lean legacy wire dict still resolves.
    // FL-01: the default is applied BEFORE validation + pricing — a defaulted launch is
    // CHARGED for the BROADCAST it flies (the free-card exploit is closed; SD-46).
    const bus: BusTier = str(action.payload.bus) === "comsat" ? "comsat" : "smallsat";
    const rawLoadout = action.payload.loadout;
    const filtered: string[] = Array.isArray(rawLoadout)
      ? rawLoadout.filter((v): v is string => typeof v === "string")
      : [];
    const cardIds: string[] = filtered.length > 0 ? filtered : [...DEFAULT_LOADOUT_CARD_IDS];
    const problem = validateLoadout(bus, cardIds);
    if (problem !== null) return { kind: "rejected", costEur: 0, problem };

    // THE COST (m1-redesign §2.5): one vehicle (base + bus-tier lift to the target
    // altitude) + count × (bus + cards) hardware — the SAME function the builder previews.
    const costEur = launchStackCost(bus, cardIds, semiMajorM, count);

    // Build the batch members (epoch-correct orbits; ids consumed at commit).
    const members: NetSat[] = [];
    for (let i = 0; i < count; i++) {
      const orbit = resolveOrbit({ semiMajorM, incRad, subLonRad, raanRad }, t);
      orbit.m0Rad += i * phaseSpreadRad;
      members.push({
        id: session.consumeSatId(isRelay),
        orbit,
        bus,
        loadout: resolveLoadout(cardIds, NET_REF_LINK_DISTANCE_M),
      });
    }

    // COMMIT the launch event: charge + seeded rolls + the deploy pipeline (§2.2 phase 3).
    const ev = session.launchBatch(members, costEur, t);
    const okIds = ev.lost === 1
      ? []
      : ev.members.filter((m) => m.outcome !== "no_sep").map((m) => m.sat.id);
    const failedCount = ev.lost === 1
      ? count
      : ev.members.filter((m) => m.outcome === "no_sep").length;
    return {
      kind: okIds.length > 0 ? "sats_launched" : "launch_failed",
      satIds: okIds,
      costEur,
      failedCount,
    };
  }
  if (action.kind === KIND_NET_ACCEPT) {
    const id = str(action.payload.contractId);
    const c = session.acceptContract(id);
    if (c === null) return { kind: "rejected", costEur: 0 };
    return { kind: "contract_accepted", costEur: 0, contractId: c.id };
  }
  if (action.kind === KIND_NET_SET_PREFER) {
    const id = str(action.payload.contractId);
    const c = session.setPrefer(id, num(action.payload.lat), num(action.payload.bw), num(action.payload.stab));
    if (c === null) return { kind: "rejected", costEur: 0 };
    return { kind: "prefer_set", costEur: 0, contractId: c.id };
  }
  if (action.kind === KIND_NET_ASSIGN_BEAM) {
    const satId = str(action.payload.satId);
    const slotIdx = Math.trunc(num(action.payload.slotIdx));
    const regionId = str(action.payload.regionId);
    const problem = session.assignBeam(satId, slotIdx, regionId);
    if (problem !== null) return { kind: "rejected", costEur: 0, problem };
    return { kind: "beam_assigned", costEur: 0, satIds: [satId] };
  }
  if (action.kind === KIND_NET_CIRCULARIZE) {
    const satId = str(action.payload.satId);
    const ok = session.circularize(satId);
    if (!ok) return { kind: "rejected", costEur: 0 };
    return { kind: "circularized", costEur: NET_CIRCULARIZE_COST_EUR, satIds: [satId] };
  }
  if (action.kind === KIND_NET_PLACE_CACHE) {
    const t = action.atTick * dt;
    session.placeMarsCache(eph, t);
    return { kind: "cache_placed", costEur: 0 };
  }
  return null;
}
