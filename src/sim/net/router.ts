/**
 * net/ — the ROUTING SOLVER (m1-redesign.md §2.3/§2.4; spec §7; SD-39). The graph is
 * region → serving sat → [CROSSLINK relay hops] → landing sat → groundNet; the bent pipe
 * the Act-1 stub could produce is now just its ONE-HOP case (M1-SLV-1). The serving edge
 * is a PIPE — one specific antenna on one sat — and each pipe carries its OWN capacity:
 *
 *   - ELIGIBILITY (beams.ts): BROADCAST floodlights latency-tolerant demand with no
 *     pointing; ACCESS/GATEWAY must be beam-ASSIGNED to the region; CROSSLINK never
 *     serves a region but forms the sat↔sat EDGES a path may traverse (graph.ts).
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
import {
  NET_ACT4_RELAY_ID_STEM,
  NET_ACT3C_GATE_ID_STEM,
  NET_DEEP_SPACE_GROUND,
} from "./endpoint";
import {
  cislunarNodePosition,
  lunarSurfacePointRelative,
  lunarSurfaceNormal,
  segmentOccludedByMoon,
} from "./cislunar";
import type { PreferWeights } from "./contract";
import {
  type BeamMap,
  pipeKey,
  eligiblePipes,
  isServingType,
  crosslinkPipes,
  landingPipes,
} from "./beams";
import { type RelayClosure, interSatEdges, relayClosure } from "./graph";

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

/** Earth-relative world position (metres) of a launched sat at sim-time t.
 *
 * CISLUNAR nodes are resolved first: an L2 gateway flies a halo about a point that is not
 * an orbit of anything, and a lunar orbiter's Kepler elements are about the MOON, so
 * neither can come from a plain earth-parented propagation. Everything else — every Earth
 * asset in Acts 1–3 — takes the unchanged path, so this dispatch adds nothing to the hot
 * loop for the rosters that dominate it. */
export function satPositionRelative(eph: Ephemeris, sat: NetSat, t: number): Vec3 {
  const cis = cislunarNodePosition(eph, sat, t);
  if (cis !== null) return cis;
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

/** The chosen bridge: which sat, which PIPE on it, which ground, at what latency.
 *
 * `satPath` and `landingPipe` carry the M1-SLV-1 relay generalisation. A DIRECT bridge
 * (the only shape the bent-pipe stub could produce) has `satPath = [satId]` and
 * `landingPipe === pipe` — one antenna both serves the region and lands the traffic.
 * A RELAYED bridge chains `satPath` from the serving sat across CROSSLINK hops to a
 * landing sat whose GATEWAY pipe descends to the ground net. `satId`/`pipe` always name
 * the SERVING end: that is what the beam points, what `loadByPipe` is keyed on, and what
 * the bandwidth axis is denominated against. */
export interface Bridge {
  satId: string;
  slotIdx: number;
  pipe: string;
  groundId: string;
  latencyS: number;
  /** Serving sat → landing sat, inclusive. Length 1 = a direct bridge. */
  satPath: string[];
  /** The pipe the path lands through; equals `pipe` when direct. */
  landingPipe: string;
}

/**
 * Does the surface point (lat,lon) connect to a ground net at sim-time t, and by which
 * path? Two shapes are searched, and the second is what M1-SLV-1 added:
 *
 *   - DIRECT (the bent pipe): point→(sat pipe)→groundNet, closing iff the up-link
 *     (point→sat, measured with the pipe's antenna) AND the down-link (ground→sat, SAME
 *     antenna) both close. One antenna serves and lands.
 *   - RELAYED (the spine): point→(serving pipe)→[CROSSLINK hops]→(GATEWAY pipe)→groundNet.
 *     The serving sat need never see the ground at all — which is the whole point, and the
 *     first path shape in this game with a middle.
 *
 * Among all closing candidates we pick:
 *
 *   - LEGACY MAX-MARGIN (no prefer override, no load map): the strongest bottleneck
 *     `min(up.received, relay.margin, down.received)` — a pure function of geometry, so a
 *     re-solve on a rise/set deterministically hands off to the rising sat.
 *   - THE §7.2 BLEND (engaged by a non-default prefer OR a non-empty load map):
 *     `cost = w_lat·latencyS + w_bw·(loadOnPipe / pipeCapacity)` summed along the path,
 *     minimised.
 *
 * Ties break satId ASC, slotIdx ASC, groundId ASC — the three that fully separate any two
 * DIRECT candidates, so with no relay closure this is exactly the pre-M1-SLV-1 search —
 * then hop count ASC, landing pipe ASC, chain ASC. Order-independent. Pure.
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
  relay?: RelayClosure,
): Bridge | { satId: null; cause: Exclude<LinkCause, "ok"> } {
  const from = surfacePointRelative(point.latRad, point.lonRad, t);
  const normal = surfaceNormalRelative(point.latRad, point.lonRad, t);

  const w = prefer ?? NET_ROUTER_DEFAULT_PREFER;
  const blendEngaged = blendIsEngaged(prefer, loadByPipe);

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
    // Deterministic tie-break: satId ASC, slotIdx ASC, groundId ASC — the three that
    // fully separate any two DIRECT candidates, so this pass is unchanged from the stub.
    if (cand.satId !== best.satId) return cand.satId < best.satId;
    if (cand.slotIdx !== best.slotIdx) return cand.slotIdx < best.slotIdx;
    if (cand.groundId !== best.groundId) return cand.groundId < best.groundId;
    // Relay-only separators: prefer the shorter chain, then the smaller landing pipe,
    // then the lexicographically smaller chain. Unreachable for two direct candidates.
    if (cand.satPath.length !== best.satPath.length) {
      return cand.satPath.length < best.satPath.length;
    }
    if (cand.landingPipe !== best.landingPipe) return cand.landingPipe < best.landingPipe;
    return cand.satPath.join(",") < best.satPath.join(",");
  };

  // ── PASS 1 — the DIRECT bridge (one antenna serves AND lands): the one-hop case, and
  // the only shape that existed before M1-SLV-1. Unchanged by the relay work. ────────
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
        const cand: Bridge = {
          satId: sat.id,
          slotIdx,
          pipe: key,
          groundId: groundNet.id,
          latencyS,
          satPath: [sat.id],
          landingPipe: key,
        };
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

  // ── PASS 2 — RELAYED bridges (M1-SLV-1): serve here, cross the CROSSLINK spine, land
  // through a GATEWAY somewhere else. Purely ADDITIVE — it can only offer candidates the
  // direct pass could never see, and it never touches `worstCause` (a relay that fails to
  // close must not rewrite the geometric cause the player is shown for the direct leg).
  // Skipped entirely when no sat flies a relay terminal, which is why a BROADCAST-only
  // fleet routes exactly as it did before this epic. ──────────────────────────────────
  if (relay !== undefined && relay.edges.length > 0) {
    for (const sat of sats) {
      const pipes = candidatePipes(sat, ctx);
      if (pipes.length === 0) continue;
      const satPos = satPositionRelative(eph, sat, t);
      for (const { slotIdx, antenna } of pipes) {
        // THE BEAM GATE, exactly as PASS 1 applies it: the user side is cone-gated, the
        // feeder is not. Relaying extends where traffic can be LANDED; it never widens the
        // spot the serving antenna paints, so a region outside the beam stays dark no
        // matter how good the spine behind it is.
        const beam = beamAimFor(antenna, satPos, t, ctx);
        const up = evaluateLink(from, normal, satPos, antenna.eirp, antenna.rangeRefM, beam);
        if (!up.closes) continue;
        const servingPipe = pipeKey(sat.id, slotIdx);
        const servingCongestion =
          antenna.capacityUnits > 0
            ? (loadByPipe?.get(servingPipe) ?? 0) / antenna.capacityUnits
            : 0;

        for (const landingSat of sats) {
          if (landingSat.id === sat.id) continue;
          const leg = relay.leg(sat.id, landingSat.id);
          if (leg === null || leg.path.length < 2) continue;
          const landingPos = satPositionRelative(eph, landingSat, t);

          for (const land of landingPipes(landingSat)) {
            const landPipe = pipeKey(landingSat.id, land.slotIdx);
            const landCongestion =
              land.antenna.capacityUnits > 0
                ? (loadByPipe?.get(landPipe) ?? 0) / land.antenna.capacityUnits
                : 0;

            for (const groundNet of groundNets) {
              const groundR = groundRadiusM(groundNet);
              const gd = surfaceNormalRelative(groundNet.latRad, groundNet.lonRad, t);
              const gto: Vec3 = [gd[0] * groundR, gd[1] * groundR, gd[2] * groundR];
              const down = evaluateLink(
                gto,
                gd,
                landingPos,
                land.antenna.eirp,
                land.antenna.rangeRefM,
              );
              if (!down.closes) continue;

              const latencyS = up.latencyS + leg.latencyS + down.latencyS;
              const cand: Bridge = {
                satId: sat.id,
                slotIdx,
                pipe: servingPipe,
                groundId: groundNet.id,
                latencyS,
                satPath: leg.path,
                landingPipe: landPipe,
              };
              let margin = 0;
              let cost = 0;
              if (blendEngaged) {
                // w_lat·(access + relay + gateway latency) + w_bw·(every pipe's congestion).
                // `leg.cost` already carries the relay hops' latency and congestion terms.
                cost =
                  w.lat * (up.latencyS + down.latencyS) +
                  w.bw * (servingCongestion + landCongestion) +
                  leg.cost;
              } else {
                margin = Math.min(up.received, leg.margin, down.received);
              }
              if (better(cand, margin, cost)) {
                best = cand;
                bestMargin = margin;
                bestCost = cost;
              }
            }
          }
        }
      }
    }
  }

  if (best !== null) return best;
  return { satId: null, cause: worstCause };
}

/** Whether the §7.2 BLEND regime is engaged (a non-default prefer, or a live load map);
 * otherwise the router is in the legacy MAX-MARGIN regime. Shared by the bridge search
 * and the relay closure so both optimise the same thing. */
export function blendIsEngaged(
  prefer: PreferWeights | undefined,
  loadByPipe: ReadonlyMap<string, number> | undefined,
): boolean {
  const w = prefer ?? NET_ROUTER_DEFAULT_PREFER;
  return (
    (loadByPipe !== undefined && loadByPipe.size > 0) ||
    w.lat !== NET_ROUTER_DEFAULT_PREFER.lat ||
    w.bw !== NET_ROUTER_DEFAULT_PREFER.bw ||
    w.stab !== NET_ROUTER_DEFAULT_PREFER.stab
  );
}

/**
 * Build the relay closure for this solve, or `undefined` when no live sat flies a
 * CROSSLINK — the zero-cost fast path that keeps a BROADCAST-only fleet exactly as fast
 * and exactly as deterministic as the bent-pipe stub was.
 *
 * `allowedPairs` is the hand-paired verb's seam (see graph.ts): absent ⇒ auto-mesh.
 */
export function buildRelayClosure(
  eph: Ephemeris,
  sats: readonly NetSat[],
  t: number,
  prefer?: PreferWeights,
  loadByPipe?: ReadonlyMap<string, number>,
  allowedPairs?: ReadonlySet<string>,
): RelayClosure | undefined {
  if (!sats.some((s) => crosslinkPipes(s).length > 0)) return undefined;
  const positions = new Map<string, Vec3>();
  for (const s of sats) positions.set(s.id, satPositionRelative(eph, s, t));
  const edges = interSatEdges(sats, positions, allowedPairs);
  if (edges.length === 0) return undefined;
  return relayClosure(
    sats.map((s) => s.id),
    edges,
    blendIsEngaged(prefer, loadByPipe) ? "cost" : "margin",
    prefer ?? NET_ROUTER_DEFAULT_PREFER,
    (pipe) => pipeCapacityOf(sats, pipe),
    loadByPipe,
  );
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
  // ACT 3c (the cislunar on-ramp) — REAL geometry: occlusion + inverse-square, no presence.
  if (contract.region.bodyId === "moon") {
    return solveLunarLeg(eph, contract, sats, groundNets, t, faults);
  }
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
  // M1-SLV-1: the CROSSLINK spine, built once per solve (undefined for a fleet that flies
  // no relay terminal — the stub's exact fast path).
  const relay = buildRelayClosure(eph, live, t, contract.prefer, loadByPipe);
  const bridge = bridgeForPoint(
    eph,
    centre,
    groundNets,
    live,
    t,
    contract.prefer,
    loadByPipe,
    ctx,
    relay,
  );
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
      path: [contract.region.id, ...bridge.satPath, bridge.groundId],
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
          path: [contract.region.id, ...bridge.satPath, bridge.groundId],
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
    path: [contract.region.id, ...bridge.satPath, bridge.groundId],
    pipe: bridge.pipe,
    latencyS: bridge.latencyS,
    bindingConstraint: null,
    losses,
  };
}

/**
 * ACT 3c — THE CISLUNAR LEG. Unlike the Mars leg, this one is NOT presence-based: it runs
 * the same real occlusion + inverse-square physics the Earth acts do, just over the lunar
 * frame. That is deliberate — the act's whole lesson is a GEOMETRIC fact (the farside can
 * never see Earth), and a presence test would assert that lesson instead of enforcing it.
 *
 * The path is the familiar bent pipe, one body further out: `region → gateway → ground`.
 *   1. THE ACCESS HOP. The lunar surface point must see the gateway above its LOCAL lunar
 *      horizon, with the Moon itself not cutting the chord, and the budget must close.
 *      For a farside region this is the hop no Earth-orbit asset can ever supply.
 *   2. THE LANDING HOP. The gateway must be above an Earth ground station's horizon, with
 *      NEITHER the Earth nor the Moon occluding the segment, and the budget must close.
 *      This is what makes the leg breathe: the toy Earth turns once every 240 s, so a given
 *      station holds the Moon for roughly half of that, and a second station widens it.
 * Latency is the honest sum of the two segment light-times (≈1.8 s one way — MORE than the
 * 1.33 s centre-to-centre, because reaching the far face means going around the Moon).
 *
 * Candidates are compared on latency and tie-broken on id, so the result never depends on
 * roster order. Only gateway-stemmed nodes are eligible: a lunar orbiter could serve the
 * access hop but cannot hold the Earth link, and offering it as a near-miss would teach the
 * wrong lesson at the exact moment the act is trying to teach placement.
 */
function solveLunarLeg(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): SolveResult {
  const losses: LinkLossStamp[] = [];
  const region = contract.region;
  const groundFallbackId = groundNets.length > 0 ? groundNets[0].id : "GROUND-0";
  // The cislunar leg lands on the DEEP-SPACE ground segment, never on the Act-1–3 metro
  // stations: a 70 m dish tracking the Moon and a teleport landing LEO traffic are
  // different assets. Keeping the two lists disjoint is why no Earth-act route changes.
  const landing = NET_DEEP_SPACE_GROUND;

  const gates = sats.filter(
    (s) => s.id.startsWith(NET_ACT3C_GATE_ID_STEM) && !(faults?.has(s.id) ?? false),
  );
  if (gates.length === 0 || landing.length === 0) {
    // No gateway at all: the farside is dark. "set_below_horizon" is the honest cause —
    // Earth is, permanently, below that station's horizon.
    losses.push({
      aId: region.id,
      bId: groundFallbackId,
      cause: "set_below_horizon",
      atS: t,
    });
    return {
      served: false,
      path: null,
      pipe: null,
      latencyS: Infinity,
      bindingConstraint: "connectivity",
      losses,
    };
  }

  const from = lunarSurfacePointRelative(eph, region.latRad, region.lonRad, t);
  const normal = lunarSurfaceNormal(eph, region.latRad, region.lonRad, t);

  let worstCause: Exclude<LinkCause, "ok"> = "set_below_horizon";
  const noteCause = (c: Exclude<LinkCause, "ok">): void => {
    if (CAUSE_DEPTH[c] > CAUSE_DEPTH[worstCause]) worstCause = c;
  };

  let best: { gateId: string; pipe: string; groundId: string; latencyS: number } | null = null;
  const better = (latencyS: number, gateId: string, groundId: string): boolean => {
    if (best === null) return true;
    if (latencyS !== best.latencyS) return latencyS < best.latencyS;
    if (gateId !== best.gateId) return gateId < best.gateId;
    return groundId < best.groundId;
  };

  for (const gate of gates) {
    const gatePos = satPositionRelative(eph, gate, t);
    const pipes = candidatePipes(gate, undefined);
    if (pipes.length === 0) continue;

    for (const { slotIdx, antenna } of pipes) {
      // 1. THE ACCESS HOP — lunar surface → gateway. `evaluateLink` gates on the local
      // horizon and the inverse-square budget; the Moon's own sphere is tested separately
      // because that helper only knows about the body at the earth-relative origin.
      const up = evaluateLink(from, normal, gatePos, antenna.eirp, antenna.rangeRefM);
      if (!up.closes) {
        if (up.cause !== "ok") noteCause(up.cause);
        continue;
      }
      if (segmentOccludedByMoon(eph, from, gatePos, t)) {
        noteCause("occluded");
        continue;
      }

      // 2. THE LANDING HOP — gateway → a deep-space ground station.
      for (const groundNet of landing) {
        const groundR = groundRadiusM(groundNet);
        const gd = surfaceNormalRelative(groundNet.latRad, groundNet.lonRad, t);
        const gto: Vec3 = [gd[0] * groundR, gd[1] * groundR, gd[2] * groundR];
        const down = evaluateLink(gto, gd, gatePos, antenna.eirp, antenna.rangeRefM);
        if (!down.closes) {
          if (down.cause !== "ok") noteCause(down.cause);
          continue;
        }
        // The Moon can eclipse the downlink too — that is exactly what puts the bare L2
        // point out of business and is the reason the station flies a halo.
        if (segmentOccludedByMoon(eph, gto, gatePos, t)) {
          noteCause("occluded");
          continue;
        }
        const latencyS = up.latencyS + down.latencyS;
        if (better(latencyS, gate.id, groundNet.id)) {
          best = { gateId: gate.id, pipe: pipeKey(gate.id, slotIdx), groundId: groundNet.id, latencyS };
        }
      }
    }
  }

  if (best === null) {
    losses.push({ aId: region.id, bId: groundFallbackId, cause: worstCause, atS: t });
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

  // LATENCY is a READOUT on the cislunar leg unless the contract explicitly enforces it.
  // Act 3c never does: 1.8 s is a fact of the universe, not a shortfall the player can
  // engineer away, and breaching them on it would be punishing them for physics.
  const slaLatencyS = contract.slaLatencyS ?? Infinity;
  if ((contract.activeAxes?.has("latency") ?? false) && best.latencyS > slaLatencyS) {
    losses.push({ aId: region.id, bId: best.gateId, cause: "out_of_budget", atS: t });
    return {
      served: false,
      path: [region.id, best.gateId, best.groundId],
      pipe: best.pipe,
      latencyS: best.latencyS,
      bindingConstraint: "latency",
      losses,
    };
  }

  return {
    served: true,
    path: [region.id, best.gateId, best.groundId],
    pipe: best.pipe,
    latencyS: best.latencyS,
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
  relay?: RelayClosure,
): boolean {
  if (groundNets.length === 0 || sats.length === 0) return false;
  const live = faults && faults.size ? sats.filter((s) => !faults.has(s.id)) : sats;
  return (
    bridgeForPoint(eph, point, groundNets, live, t, undefined, undefined, ctx, relay).satId !== null
  );
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
  // The cislunar leg has no cheap presence shortcut — its whole point is that the geometry,
  // not the roster, decides. It is cheap anyway (a handful of gateways × ground stations),
  // and running the same solver here keeps the fast re-eval and the full solve from ever
  // disagreeing about whether the farside is up.
  if (contract.region.bodyId === "moon") {
    return solveLunarLeg(eph, contract, sats, groundNets, t, faults).served;
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
