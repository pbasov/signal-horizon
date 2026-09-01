/**
 * net/ — BEAMS: the pointing verb's substrate (m1-redesign.md §2.3). Sats do not serve
 * automatically: an ACCESS/GATEWAY antenna is a SPOT BEAM that must be ASSIGNED to
 * exactly one region to serve it (the `net_assign_beam` action); a BROADCAST antenna
 * floodlights its footprint — it serves any LATENCY-TOLERANT contract in view with no
 * pointing (its down-only asymmetry identity, spec §1.2). CROSSLINK is S-slot relay
 * substrate — never a SERVING pipe, but since M1-SAT-3 it is a live graph EDGE: it
 * carries traffic between sats so a region can be served from one place and landed in
 * another (see graph.ts).
 *
 * A PIPE is one antenna on one sat, keyed `${satId}:${slotIdx}` (slotIdx = the index
 * into the sat's loadout). Load aggregation, fair-share, and the congestion term are all
 * denominated per-PIPE against that antenna's own `capacityUnits` — this is where "the
 * bandwidth of each satellite is part of the gameplay" becomes sim truth.
 *
 * RE-BEAMING is instant and free but un-serves whoever the beam left — the free,
 * non-capex intervention lever between launches.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG.
 *
 * @see docs/m1-redesign.md §2.3/§2.4; docs/signal-horizon-m1.md Part I §1.2.
 */

import type { AntennaSpec, NetSat } from "./sat";

/** The stable key of one pipe (one antenna on one sat). */
export function pipeKey(satId: string, slotIdx: number): string {
  return `${satId}:${slotIdx}`;
}

/** Split a pipe key back into (satId, slotIdx). Tolerates satIds containing ":" by
 * splitting on the LAST colon. Returns null on a malformed key. */
export function parsePipeKey(key: string): { satId: string; slotIdx: number } | null {
  const i = key.lastIndexOf(":");
  if (i <= 0) return null;
  const slotIdx = Number(key.slice(i + 1));
  if (!Number.isInteger(slotIdx) || slotIdx < 0) return null;
  return { satId: key.slice(0, i), slotIdx };
}

/** The beam-assignment table: pipeKey → regionId. Only ACCESS/GATEWAY pipes appear here
 * (BROADCAST never needs assignment; CROSSLINK is never assignable). */
export type BeamMap = ReadonlyMap<string, string>;

/** Whether this antenna TYPE is a pointable spot beam (must be assigned to serve). */
export function isPointable(a: AntennaSpec): boolean {
  return a.type === "ACCESS" || a.type === "GATEWAY";
}

/** Whether this antenna type can serve a region AT ALL (CROSSLINK cannot — an S-slot
 * relay terminal faces other sats, never the surface; it is an EDGE, not a pipe). */
export function isServingType(a: AntennaSpec): boolean {
  return a.type === "BROADCAST" || a.type === "ACCESS" || a.type === "GATEWAY";
}

/** Whether this antenna type is an inter-sat RELAY link (the M1-SAT-3 graph edge). */
export function isCrosslinkType(a: AntennaSpec): boolean {
  return a.type === "CROSSLINK";
}

/** Every CROSSLINK (slotIdx, antenna) on a sat — the sat-facing relay terminals it can
 * form graph edges with. Empty for a sat that flies no S-slot card. */
export function crosslinkPipes(sat: NetSat): { slotIdx: number; antenna: AntennaSpec }[] {
  const out: { slotIdx: number; antenna: AntennaSpec }[] = [];
  for (let i = 0; i < sat.loadout.length; i++) {
    if (isCrosslinkType(sat.loadout[i])) out.push({ slotIdx: i, antenna: sat.loadout[i] });
  }
  return out;
}

/**
 * Every GATEWAY (slotIdx, antenna) on a sat — the TRUNK-LANDING pipes a relayed path may
 * descend through to reach the ground net.
 *
 * A landing pipe needs NO beam assignment: it is not serving a region, it is landing
 * trunk traffic that arrived over the relay spine. This is what finally distinguishes
 * GATEWAY from "a fat ACCESS" — the role its name always claimed (sat.ts: "its trunk
 * landing role matures with crosslink relaying"). BROADCAST is deliberately excluded: a
 * down-only floodlight is not a trunk landing.
 */
export function landingPipes(sat: NetSat): { slotIdx: number; antenna: AntennaSpec }[] {
  const out: { slotIdx: number; antenna: AntennaSpec }[] = [];
  for (let i = 0; i < sat.loadout.length; i++) {
    if (sat.loadout[i].type === "GATEWAY") out.push({ slotIdx: i, antenna: sat.loadout[i] });
  }
  return out;
}

/**
 * Whether pipe (sat, slotIdx) is ELIGIBLE to serve a contract over `regionId`:
 *   - BROADCAST: eligible iff the contract is latency-TOLERANT (`latencyActive` false) —
 *     a floodlight cannot carry a low-latency bidirectional SLA (the asymmetry identity).
 *   - ACCESS/GATEWAY: eligible iff the beam is ASSIGNED to this region.
 *   - CROSSLINK: never.
 * Geometry (LoS/elevation/budget) is the router's job; this is pure eligibility.
 */
export function pipeEligible(
  sat: NetSat,
  slotIdx: number,
  regionId: string,
  latencyActive: boolean,
  beams: BeamMap,
): boolean {
  const a = sat.loadout[slotIdx];
  if (a === undefined || !isServingType(a)) return false;
  if (a.type === "BROADCAST") return !latencyActive;
  return beams.get(pipeKey(sat.id, slotIdx)) === regionId;
}

/** Every eligible (slotIdx, antenna) pipe on a sat for a contract over `regionId`. */
export function eligiblePipes(
  sat: NetSat,
  regionId: string,
  latencyActive: boolean,
  beams: BeamMap,
): { slotIdx: number; antenna: AntennaSpec }[] {
  const out: { slotIdx: number; antenna: AntennaSpec }[] = [];
  for (let i = 0; i < sat.loadout.length; i++) {
    if (pipeEligible(sat, i, regionId, latencyActive, beams)) {
      out.push({ slotIdx: i, antenna: sat.loadout[i] });
    }
  }
  return out;
}

/** Validate a beam assignment: the pipe must exist and be pointable. `regionId` empty
 * string means UNASSIGN (always valid on a pointable pipe). Returns a problem string or
 * null when valid. Pure (the applier + the UI share the rule). */
export function validateBeamAssign(
  sats: readonly NetSat[],
  satId: string,
  slotIdx: number,
  regionId: string,
): string | null {
  const sat = sats.find((s) => s.id === satId);
  if (sat === undefined) return `unknown sat "${satId}"`;
  const a = sat.loadout[slotIdx];
  if (a === undefined) return `sat ${satId} has no antenna slot ${slotIdx}`;
  if (!isPointable(a)) return `${a.type} is not a pointable beam`;
  void regionId; // any region id (or "" = unassign) is acceptable; geometry decides service.
  return null;
}
