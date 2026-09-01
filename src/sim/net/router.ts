/**
 * net/ — the ROUTING SOLVER, pipe-aware (m1-redesign.md §2.3/§2.4; spec §7). The M1
 * graph is still the bent pipe region → sat → groundNet, but the serving edge is now a
 * PIPE — one specific antenna on one sat — and each pipe carries its OWN capacity:
 *
 *   - ELIGIBILITY (beams.ts): BROADCAST floodlights latency-tolerant demand with no
 *     pointing; ACCESS/GATEWAY must be beam-ASSIGNED to the region; CROSSLINK is inert.
 *   - GEOMETRY: the link-budget predicate (elevation + inverse-square + LoS on the
 *     spinning frame) evaluated with THAT antenna's eirp/rangeRef, up and down.
 *   - CAPACITY: congestion + the bandwidth bite are denominated per-pipe against the
 *     antenna's own `capacityUnits` (per-satellite bandwidth as sim truth, SD-45).
 *
 * --- THE RE-SOLVE SPLIT (unchanged, design §2.4) -----------------------------------
 * Full search only on a discrete TOPOLOGY CHANGE — launch, fault, demand epoch, BEAM
 * REASSIGNMENT (the new one: pointing is a topology change) or a horizon rise/set; every
 * other tick cheaply re-evaluates the cached path's predicates.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG.
 *
 * @see docs/m1-redesign.md §2.3-§2.4; docs/signal-horizon-m1.md Part II §2.4, §7.
 */

import type { Ephemeris, Vec3 } from "../ephemeris";
import { solveOrbit } from "../m2/orbit";
import { A1_BODY_RADIUS_M } from "./world";
import type { NetSat, AntennaSpec } from "./sat";
import type { Region, GroundNet, RegionPoint } from "./endpoint";
import {
  type LinkCause,
  type BeamAim,
  evaluateLink,
  surfacePointRelative,
  surfaceNormalRelative,
  interBodyOneWayLatencyS,
} from "./link-budget";
import { NET_ACT4_RELAY_ID_STEM } from "./endpoint";
import type { PreferWeights } from "./contract";
import { type BeamMap, pipeKey, eligiblePipes, isServingType } from "./beams";

/** A stamped record of a link that LOST (the predictability seed, design §2.4/§2.6). */
export interface LinkLossStamp {
  aId: string;
  bId: string;
  cause: Exclude<LinkCause, "ok">;
  atS: number;
}

/** The active SLA axis a solve binds against. */
export type RouterAxis = "connectivity" | "availability" | "latency" | "bandwidth";

/** What the solver returns for one contract at sim-time t. */
export interface SolveResult {
  /** True iff a path region→…→groundNet carries the link this instant. */
  served: boolean;
  /** Node ids region→…→groundNet, or null when unserved. */
  path: string[] | null;
  /** The SERVING PIPE key (`satId:slotIdx`) the path rides, or null (unserved / Mars). */
  pipe: string | null;
  /** Realized one-way latency along the path (seconds); Infinity when unserved. */
  latencyS: number;
  /** Which active axis fails (feeds the trace); null when served. */
  bindingConstraint: RouterAxis | null;
  /** Every link that lost this solve — the predictability seed. */
  losses: LinkLossStamp[];
}

/** The minimal contract surface the router needs (structural supertype of Contract). */
export interface RoutableContract {
  id: string;
  region: Region;
  activeAxes?: ReadonlySet<RouterAxis>;
  prefer?: PreferWeights;
  slaLatencyS?: number;
  /** The contract's COMMITTED bandwidth FLOOR (§4.3); absent ⇒ 0 (never binds). */
  slaBandwidth?: number;
  /** The contract's bursty REALIZED offered load THIS instant; absent ⇒ 0. */
  offeredLoad?: number;
}

/** The router's default PREFER weights when a contract carries none. */
export const NET_ROUTER_DEFAULT_PREFER: PreferWeights = { lat: 1.0, bw: 0.0, stab: 0.0 };

/** THE PIPE CONTEXT: what the geometry search needs to know about WHO is being served,
 * so eligibility (beams.ts) filters the pipes. Absent ⇒ PERMISSIVE (every serving-type
 * antenna eligible, latency treated as tolerant) — the coverage-preview / legacy read. */
export interface PipeContext {
  regionId: string;
  latencyActive: boolean;
  beams: BeamMap;
  /** WHERE A POINTED BEAM LOOKS: the body-fixed centre of the region this pipe is serving.
   * A steerable ACCESS/GATEWAY antenna is aimed here, and its cone is measured from that
   * boresight — so a spot smaller than the region covers only part of the disc and the
   * contract reads a partial `servedFraction`. Omitted ⇒ the beam is treated as unpointed
   * and only the horizon gates it, which is the permissive "could ANY pipe here serve if it
   * were pointed?" question the coverage preview asks. */
  aimLatRad?: number;
  aimLonRad?: number;
}

const EMPTY_BEAMS: BeamMap = new Map();

/** Earth-relative world position (metres) of a launched sat at sim-time t. */
export function satPositionRelative(eph: Ephemeris, sat: NetSat, t: number): Vec3 {
  void eph;
  return solveOrbit(sat.orbit, t);
}

/** The pipes of `sat` eligible to serve under `ctx` (permissive when ctx is absent):
 * with no context every serving-type antenna is a candidate (coverage semantics — "could
 * ANY pipe here serve a latency-tolerant demand if pointed?"). */
function candidatePipes(
  sat: NetSat,
  ctx: PipeContext | undefined,
): { slotIdx: number; antenna: AntennaSpec }[] {
  if (ctx === undefined) {
    const out: { slotIdx: number; antenna: AntennaSpec }[] = [];
    for (let i = 0; i < sat.loadout.length; i++) {
      if (isServingType(sat.loadout[i])) out.push({ slotIdx: i, antenna: sat.loadout[i] });
    }
    return out;
  }
  return eligiblePipes(sat, ctx.regionId, ctx.latencyActive, ctx.beams ?? EMPTY_BEAMS);
}

/** How far along the gate chain each failure cause sits — the ordering the reported cause is
 * maximised over, so the diagnosis never depends on roster order. */
const CAUSE_DEPTH: Record<Exclude<LinkCause, "ok">, number> = {
  set_below_horizon: 0,
  outside_beam: 1,
  out_of_budget: 2,
  occluded: 3,
};

/** The chosen bridge: which sat, which PIPE on it, which ground, at what latency. */
export interface Bridge {
  satId: string;
  slotIdx: number;
  pipe: string;
  groundId: string;
  latencyS: number;
}

/**
 * Does the surface point (lat,lon) connect to a ground net via SOME eligible PIPE at
 * sim-time t? The bent path point→(sat pipe)→groundNet closes iff the up-link (point→sat,
 * measured with the pipe's antenna) AND the down-link (ground→sat, same antenna) both
 * close. Among all closing (ground, sat, pipe) candidates we pick:
 *
 *   - LEGACY MAX-MARGIN (no prefer override, no load map): the strongest
 *     `min(up.received, down.received)` — a pure function of geometry, so a re-solve on
 *     a rise/set deterministically hands off to the rising sat.
 *   - THE §7.2 BLEND (engaged by a non-default prefer OR a non-empty load map):
 *     `cost = w_lat·latencyS + w_bw·(loadOnPipe / pipeCapacity)`, minimised.
 *
 * Ties break satId ASC, then slotIdx ASC, then groundId ASC — order-independent. Pure.
 */
export function bridgeForPoint(
  eph: Ephemeris,
  point: RegionPoint,
  groundNets: GroundNet[],
  sats: NetSat[],
  t: number,
  prefer?: PreferWeights,
  loadByPipe?: ReadonlyMap<string, number>,
  ctx?: PipeContext,
): Bridge | { satId: null; cause: Exclude<LinkCause, "ok"> } {
  const from = surfacePointRelative(point.latRad, point.lonRad, t);
  const normal = surfaceNormalRelative(point.latRad, point.lonRad, t);

  const w = prefer ?? NET_ROUTER_DEFAULT_PREFER;
  const blendEngaged =
    (loadByPipe !== undefined && loadByPipe.size > 0) ||
    w.lat !== NET_ROUTER_DEFAULT_PREFER.lat ||
    w.bw !== NET_ROUTER_DEFAULT_PREFER.bw ||
    w.stab !== NET_ROUTER_DEFAULT_PREFER.stab;

  // THE REPORTED CAUSE, order-independently. Candidates are visited in roster order, so
  // "whichever gate the last candidate hit" would make the diagnosis depend on the order the
  // satellites happen to sit in the array — two identical rosters could explain the same
  // failure differently. Instead keep the FURTHEST gate any candidate reached: a pipe that
  // cleared the horizon and missed the beam is a more informative answer than "everything was
  // below the horizon", and the maximum over a set has no order.
  let worstCause: Exclude<LinkCause, "ok"> = "set_below_horizon";
  const noteCause = (c: Exclude<LinkCause, "ok">): void => {
    if (CAUSE_DEPTH[c] > CAUSE_DEPTH[worstCause]) worstCause = c;
  };
  let best: Bridge | null = null;
  let bestMargin = -Infinity;
  let bestCost = Infinity;

  const better = (cand: Bridge, margin: number, cost: number): boolean => {
    if (best === null) return true;
    if (blendEngaged) {
      if (cost !== bestCost) return cost < bestCost;
    } else {
      if (margin !== bestMargin) return margin > bestMargin;
    }
    // Deterministic tie-break: satId ASC, slotIdx ASC, groundId ASC.
    if (cand.satId !== best.satId) return cand.satId < best.satId;
    if (cand.slotIdx !== best.slotIdx) return cand.slotIdx < best.slotIdx;
    return cand.groundId < best.groundId;
  };

  for (const groundNet of groundNets) {
    const groundR = groundRadiusM(groundNet);
    const gd = surfaceNormalRelative(groundNet.latRad, groundNet.lonRad, t);
    const gto: Vec3 = [gd[0] * groundR, gd[1] * groundR, gd[2] * groundR];
    for (const sat of sats) {
      const pipes = candidatePipes(sat, ctx);
      if (pipes.length === 0) continue;
      const satPos = satPositionRelative(eph, sat, t);
      for (const { slotIdx, antenna } of pipes) {
        // THE BEAM GATE, on the USER side only. The up-link is the one that has to arrive
        // inside the antenna's spot; the sat→ground feeder is a separate dish pointed at
        // the ground station, so cone-gating it too would demand the station sit inside the
        // user beam — which no real bent-pipe requires and which would strand every region
        // that is not co-located with a ground site.
        const beam = beamAimFor(antenna, satPos, t, ctx);
        const up = evaluateLink(from, normal, satPos, antenna.eirp, antenna.rangeRefM, beam);
        if (!up.closes) {
          if (up.cause !== "ok") noteCause(up.cause);
          continue;
        }
        const down = evaluateLink(gto, gd, satPos, antenna.eirp, antenna.rangeRefM);
        if (!down.closes) {
          if (down.cause !== "ok") noteCause(down.cause);
          continue;
        }
        const latencyS = up.latencyS + down.latencyS;
        const key = pipeKey(sat.id, slotIdx);
        const cand: Bridge = { satId: sat.id, slotIdx, pipe: key, groundId: groundNet.id, latencyS };
        let margin = 0;
        let cost = 0;
        if (blendEngaged) {
          const load = loadByPipe?.get(key) ?? 0;
          const congestionTerm = antenna.capacityUnits > 0 ? load / antenna.capacityUnits : 0;
          cost = w.lat * latencyS + w.bw * congestionTerm; // w_stab·instability = 0 (M1 LOCKED).
        } else {
          margin = Math.min(up.received, down.received);
        }
        if (better(cand, margin, cost)) {
          best = cand;
          bestMargin = margin;
          bestCost = cost;
        }
      }
    }
  }
  if (best !== null) return best;
  return { satId: null, cause: worstCause };
}

/**
 * Where this antenna is pointed at sim-time `t`, or `undefined` for "unpointed — horizon
 * only". Two kinds of pointing, matching the two kinds of antenna:
 *
 *   - BROADCAST floodlights straight DOWN. Its boresight is nadir (sat → body centre), so
 *     its spot is the cap under the satellite and it serves whatever happens to sit there.
 *   - ACCESS / GATEWAY are STEERED. They look at the region their beam is assigned to, so
 *     the spot follows the target — the assignment decides where the capacity lands, which
 *     is the whole point of the pointing verb.
 *
 * Without an aim point a steerable beam is left unpointed (the coverage-preview read).
 */
function beamAimFor(
  antenna: AntennaSpec,
  satPos: Vec3,
  t: number,
  ctx: PipeContext | undefined,
): BeamAim | undefined {
  const m = Math.sqrt(satPos[0] * satPos[0] + satPos[1] * satPos[1] + satPos[2] * satPos[2]);
  if (m <= 0) return undefined;
  if (antenna.type === "BROADCAST") {
    return {
      axis: [-satPos[0] / m, -satPos[1] / m, -satPos[2] / m],
      coneHalfAngleRad: antenna.coneHalfAngleRad,
    };
  }
  if (ctx === undefined || ctx.aimLatRad === undefined || ctx.aimLonRad === undefined) return undefined;
  const target = surfacePointRelative(ctx.aimLatRad, ctx.aimLonRad, t);
  const ax = target[0] - satPos[0];
  const ay = target[1] - satPos[1];
  const az = target[2] - satPos[2];
  const am = Math.sqrt(ax * ax + ay * ay + az * az);
  if (am <= 0) return undefined;
  return { axis: [ax / am, ay / am, az / am], coneHalfAngleRad: antenna.coneHalfAngleRad };
}

/** Ground-net world radius (toy body radius + antenna altitude), earth-relative. */
function groundRadiusM(groundNet: GroundNet): number {
  return A1_BODY_RADIUS_M + groundNet.altitudeM;
}

/** The pipe capacity (units) of a bridge — the chosen antenna's own rating. 0 when the
 * sat/slot no longer exists (a defensive read; the caller treats 0 as "no capacity"). */
export function pipeCapacityOf(sats: readonly NetSat[], pipe: string): number {
  const i = pipe.lastIndexOf(":");
  if (i <= 0) return 0;
  const satId = pipe.slice(0, i);
  const slotIdx = Number(pipe.slice(i + 1));
  const sat = sats.find((s) => s.id === satId);
  const a = sat?.loadout[slotIdx];
  return a ? a.capacityUnits : 0;
}

/**
 * Is the region SERVED at sim-time t? Path-existence over the eligible pipes; the Act-3
 * quantitative axes bite BINARY on top (latency ceiling; the per-pipe fair-share
 * bandwidth floor). `beams` is the session's assignment table (the pointing state).
 */
export function solve(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
  loadByPipe?: ReadonlyMap<string, number>,
  beams?: BeamMap,
): SolveResult {
  // ACT 4 (the Mars frontier teaser) — presence-based, unchanged.
  if (contract.region.bodyId === "mars") {
    return solveMarsLeg(eph, contract, sats, groundNets, t, faults);
  }
  const losses: LinkLossStamp[] = [];
  if (groundNets.length === 0 || sats.length === 0) {
    return {
      served: false,
      path: null,
      pipe: null,
      latencyS: Infinity,
      bindingConstraint: "connectivity",
      losses,
    };
  }
  const live = faults && faults.size ? sats.filter((s) => !faults.has(s.id)) : sats;

  const ctx: PipeContext = {
    regionId: contract.region.id,
    latencyActive: contract.activeAxes?.has("latency") ?? false,
    beams: beams ?? EMPTY_BEAMS,
    // A steered beam looks at the region it serves — its cone is measured from here.
    aimLatRad: contract.region.latRad,
    aimLonRad: contract.region.lonRad,
  };
  const centre: RegionPoint = { latRad: contract.region.latRad, lonRad: contract.region.lonRad };
  const bridge = bridgeForPoint(eph, centre, groundNets, live, t, contract.prefer, loadByPipe, ctx);
  if (bridge.satId === null) {
    losses.push({ aId: contract.region.id, bId: groundNets[0].id, cause: bridge.cause, atS: t });
    const enforcesAvail = contract.activeAxes?.has("availability") ?? false;
    return {
      served: false,
      path: null,
      pipe: null,
      latencyS: Infinity,
      bindingConstraint: enforcesAvail ? "availability" : "connectivity",
      losses,
    };
  }

  // LATENCY (§4.4) — the GEO ceiling, felt.
  const slaLatencyS = contract.slaLatencyS ?? Infinity;
  if ((contract.activeAxes?.has("latency") ?? false) && bridge.latencyS > slaLatencyS) {
    losses.push({ aId: contract.region.id, bId: bridge.satId, cause: "out_of_budget", atS: t });
    return {
      served: false,
      path: [contract.region.id, bridge.satId, bridge.groundId],
      pipe: bridge.pipe,
      latencyS: bridge.latencyS,
      bindingConstraint: "latency",
      losses,
    };
  }

  // BANDWIDTH (§4.3) — the per-PIPE fair-share floor. The pipe carries the shared load
  // Σ offeredLoad of every contract riding it; while the shared peak is at/under the
  // pipe's OWN capacity every floor is honored. Over capacity, capacity is shared in
  // proportion to offered load; this contract breaches iff its share falls below its
  // committed slaBandwidth floor.
  if (contract.activeAxes?.has("bandwidth") ?? false) {
    const slaBandwidth = contract.slaBandwidth ?? 0;
    const sharedLoad = loadByPipe?.get(bridge.pipe) ?? 0;
    const capacity = pipeCapacityOf(live, bridge.pipe);
    if (slaBandwidth > 0 && capacity > 0 && sharedLoad > capacity) {
      const ownLoad = contract.offeredLoad ?? 0;
      const servedBandwidth = (capacity * ownLoad) / sharedLoad;
      if (servedBandwidth < slaBandwidth) {
        losses.push({ aId: bridge.satId, bId: bridge.groundId, cause: "out_of_budget", atS: t });
        return {
          served: false,
          path: [contract.region.id, bridge.satId, bridge.groundId],
          pipe: bridge.pipe,
          latencyS: bridge.latencyS,
          bindingConstraint: "bandwidth",
          losses,
        };
      }
    }
  }

  return {
    served: true,
    path: [contract.region.id, bridge.satId, bridge.groundId],
    pipe: bridge.pipe,
    latencyS: bridge.latencyS,
    bindingConstraint: null,
    losses,
  };
}

/** ACT 4 — the Mars leg (presence-based; unchanged from pre-R0). */
function solveMarsLeg(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): SolveResult {
  const losses: LinkLossStamp[] = [];
  const relay = sats.find(
    (s) => s.id.startsWith(NET_ACT4_RELAY_ID_STEM) && !(faults?.has(s.id) ?? false),
  );
  const groundId = groundNets.length > 0 ? groundNets[0].id : "GROUND-0";
  if (relay === undefined) {
    losses.push({ aId: contract.region.id, bId: groundId, cause: "set_below_horizon", atS: t });
    return {
      served: false,
      path: null,
      pipe: null,
      latencyS: Infinity,
      bindingConstraint: "connectivity",
      losses,
    };
  }
  const latencyS = interBodyOneWayLatencyS(eph, "earth", "mars", t);
  return {
    served: true,
    path: [contract.region.id, relay.id, groundId],
    pipe: null,
    latencyS,
    bindingConstraint: null,
    losses,
  };
}

/** A coverage predicate: a disc sample point is COVERED iff some eligible pipe bridges
 * it to the ground net at sim-time t. Pass `ctx` for contract-true eligibility (beams +
 * latency); omit it for the permissive "could any pipe here reach this point" read. */
export function isPointServed(
  eph: Ephemeris,
  point: RegionPoint,
  groundNets: GroundNet[],
  sats: NetSat[],
  t: number,
  faults?: ReadonlySet<string>,
  ctx?: PipeContext,
): boolean {
  if (groundNets.length === 0 || sats.length === 0) return false;
  const live = faults && faults.size ? sats.filter((s) => !faults.has(s.id)) : sats;
  return bridgeForPoint(eph, point, groundNets, live, t, undefined, undefined, ctx).satId !== null;
}

// ── the re-solve split: cached path + topology fingerprint (design §2.4) ─────────

/** The router's cached state for the cheap per-tick re-eval. */
export interface RouterState {
  result: SolveResult;
  solvedAtS: number;
  topoKey: string;
  wasServed: boolean;
}

/** A cheap topology fingerprint: which sats exist + which are faulted + the contract id
 * + the quantized CONGESTION EPOCH + the BEAMS KEY (a beam reassignment is a topology
 * change — pointing rewires the graph). */
export function topologyKey(
  contract: RoutableContract,
  sats: NetSat[],
  faults?: ReadonlySet<string>,
  congestionEpoch = 0,
  beamsKey = "",
): string {
  const ids = sats.map((s) => s.id).sort();
  const faulted = faults && faults.size ? [...faults].sort() : [];
  return `${contract.id}|${ids.join(",")}|${faulted.join(",")}|${congestionEpoch}|${beamsKey}`;
}

/** A stable key of the whole beam table (sorted entries). The session computes it once
 * per step and threads it into every contract's {@link topologyKey}. */
export function beamsKeyOf(beams: BeamMap): string {
  if (beams.size === 0) return "";
  const parts: string[] = [];
  for (const [k, v] of beams) parts.push(`${k}>${v}`);
  parts.sort();
  return parts.join(",");
}

/**
 * The §2.4 re-solve split, one tick (shape unchanged; beams threaded through).
 */
export function resolveTick(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  prev: RouterState | null,
  faults?: ReadonlySet<string>,
  loadByPipe?: ReadonlyMap<string, number>,
  congestionEpoch = 0,
  beams?: BeamMap,
): RouterState {
  const topoKey = topologyKey(contract, sats, faults, congestionEpoch, beamsKeyOf(beams ?? EMPTY_BEAMS));

  if (!prev || prev.topoKey !== topoKey) {
    const result = solve(eph, contract, sats, groundNets, t, faults, loadByPipe, beams);
    return { result, solvedAtS: t, topoKey, wasServed: result.served };
  }

  const nowServed = isRegionServed(eph, contract, sats, groundNets, t, faults, beams);
  if (nowServed !== prev.wasServed) {
    const result = solve(eph, contract, sats, groundNets, t, faults, loadByPipe, beams);
    return { result, solvedAtS: t, topoKey, wasServed: result.served };
  }

  if (!nowServed) {
    return {
      result: { ...prev.result, served: false },
      solvedAtS: prev.solvedAtS,
      topoKey,
      wasServed: false,
    };
  }
  const refreshed = solve(eph, contract, sats, groundNets, t, faults, loadByPipe, beams);
  return { result: refreshed, solvedAtS: prev.solvedAtS, topoKey, wasServed: true };
}

/** The binary region-served predicate used by the cheap re-eval (eligibility-true). */
function isRegionServed(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
  beams?: BeamMap,
): boolean {
  if (contract.region.bodyId === "mars") {
    return sats.some(
      (s) => s.id.startsWith(NET_ACT4_RELAY_ID_STEM) && !(faults?.has(s.id) ?? false),
    );
  }
  const ctx: PipeContext = {
    regionId: contract.region.id,
    latencyActive: contract.activeAxes?.has("latency") ?? false,
    beams: beams ?? EMPTY_BEAMS,
    // A steered beam looks at the region it serves — its cone is measured from here.
    aimLatRad: contract.region.latRad,
    aimLonRad: contract.region.lonRad,
  };
  const centre: RegionPoint = { latRad: contract.region.latRad, lonRad: contract.region.lonRad };
  return isPointServed(eph, centre, groundNets, sats, t, faults, ctx);
}
