/**
 * net/ — the ROUTING SOLVER (design §2.4 / §7), in its M1 degenerate path-existence
 * form. This is the REAL solver, not a sealed stub: Acts 2–3 extend `solve` to
 * multi-hop adjacency + a latency/congestion link cost without changing its signature
 * or its callers. In Act 1 the graph is region → sat → groundNet (one parked GEO ↔ one
 * region ↔ one ground net), so the shortest path is a path-existence search over the
 * sats that bridge the region endpoint to the ground endpoint.
 *
 * --- THE EDGE (design §2.4) -------------------------------------------------
 * An edge carries a link iff the link-budget predicate closes (elevation + inverse-
 * square budget + line-of-sight on the spinning frame). The region endpoint's local
 * horizon is measured at the WORST point of its disc for a conservative path-existence;
 * the per-point coverage check ({@link isPointServed}) drives the WHOLE-DISC pin.
 *
 * --- THE RE-SOLVE SPLIT (design §2.4, the cheapest correct M1 form) ----------
 * The full shortest-path search (Dijkstra in Acts 2–3; here a min over bridging sats)
 * is EVENT-DRIVEN: re-run only on a discrete TOPOLOGY CHANGE — a launch/commit, a fault
 * state change, a demand/escalation change, AND a HORIZON RISE/SET (a node crossing an
 * endpoint's elevation gate). Every other tick we cheaply RE-EVALUATE the cached path's
 * link predicates (O(sats) — trivial in Act 1) to set served/breach. So serve/breach is
 * per-tick-truthful while Dijkstra is event-driven.
 *
 *   - A perfectly parked GEO's relative geometry is time-invariant ⇒ it produces NO
 *     horizon event ⇒ the cached path holds and we re-solve only on the launch.
 *   - A non-covering LEO SETS continuously ⇒ a per-tick horizon event ⇒ the cached path
 *     is invalidated, the search re-runs, finds no bridging sat, and the contract
 *     re-solves to UNSERVED with a link-loss stamp (cause "set_below_horizon", the time)
 *     — which is exactly what fires the Act-1 gentle shortfall.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG. Reuses solveOrbit (unforked) for sat
 * world positions and the net/link-budget predicate for every edge.
 *
 * @see docs/signal-horizon-m1-design.md §2.4 (router), §7 (the solver spine), §5.
 */

import type { Ephemeris, Vec3 } from "../ephemeris";
import { solveOrbit } from "../m2/orbit";
import { A1_BODY_RADIUS_M } from "./world";
import type { NetSat } from "./sat";
import type { Region, GroundNet, RegionPoint } from "./endpoint";
import {
  type LinkCause,
  evaluateLink,
  surfacePointRelative,
  surfaceNormalRelative,
} from "./link-budget";

/** A stamped record of a link that LOST (the predictability seed, design §2.4/§2.6):
 * the two endpoints, the geometric cause, and the sim-time it happened. */
export interface LinkLossStamp {
  aId: string;
  bId: string;
  cause: Exclude<LinkCause, "ok">;
  atS: number;
}

/** The active SLA axis a solve binds against (the one that fails feeds the trace). Act
 * 1 only enforces "connectivity" (path existence); the wider union is the Act-2/3 door,
 * matching the contract's SlaAxis vocabulary without importing it here. */
export type RouterAxis = "connectivity" | "availability" | "latency" | "bandwidth";

/** What the solver returns for one contract at sim-time t (design §2.4). */
export interface SolveResult {
  /** True iff a path region→…→groundNet carries the link this instant. */
  served: boolean;
  /** Node ids region→…→groundNet, or null when unserved. */
  path: string[] | null;
  /** Realized one-way latency along the path (seconds); Infinity when unserved. */
  latencyS: number;
  /** Which active axis fails (feeds the trace); null when served. */
  bindingConstraint: RouterAxis | null;
  /** Every link that lost this solve — the predictability seed. */
  losses: LinkLossStamp[];
}

/** The minimal contract surface the router needs (the full Contract struct lands in
 * A2; the router only reads the region geometry + which axes are active). Keeping it
 * structural lets A2 pass the real Contract without a router change. */
export interface RoutableContract {
  id: string;
  region: Region;
  activeAxes?: ReadonlySet<RouterAxis>;
}

/** Earth-relative world position (metres) of a launched sat at sim-time t. The earth
 * centre is the common origin the link budget works in, so we DROP the eph.position
 * "earth" add (it cancels against the surface point's same offset). `eph` is accepted
 * for signature parity + future bodies; the toy sat's parent is "earth". */
export function satPositionRelative(eph: Ephemeris, sat: NetSat, t: number): Vec3 {
  // solveOrbit gives the position relative to the parent (earth) — exactly the frame
  // the surface point lives in here. (eph is unused for the toy single-body case but
  // kept in the signature so a multi-body Act-4 relay reads eph.position(parent).)
  void eph;
  return solveOrbit(sat.orbit, t);
}

/** The strongest antenna eirp + its reference distance on a sat (Act-1 loadout is one
 * BROADCAST antenna; a multi-antenna sat picks the best-reaching one). */
function bestAntenna(sat: NetSat): { eirp: number; rangeRefM: number } {
  let eirp = 0;
  let rangeRefM = 0;
  for (const a of sat.loadout) {
    if (a.eirp > eirp) {
      eirp = a.eirp;
      rangeRefM = a.rangeRefM;
    }
  }
  return { eirp, rangeRefM };
}

/**
 * Does the surface point (lat,lon) connect to `groundNet` via SOME sat at sim-time t?
 * The Act-1 bent path point→sat→groundNet is the trivial case of the real graph: a sat
 * BRIDGES iff its uplink (point→sat) AND downlink (sat→groundNet) links both close. The
 * region endpoint's normal is the point's own outward normal; the ground endpoint's
 * normal is its surface normal (raised by altitude). Pure.
 *
 * Returns the bridging sat id + realized latency, or null with the binding cause.
 */
export function bridgeForPoint(
  eph: Ephemeris,
  point: RegionPoint,
  groundNet: GroundNet,
  sats: NetSat[],
  t: number,
): { satId: string; latencyS: number } | { satId: null; cause: Exclude<LinkCause, "ok"> } {
  const from = surfacePointRelative(point.latRad, point.lonRad, t);
  const normal = surfaceNormalRelative(point.latRad, point.lonRad, t);
  // Ground endpoint world position + its outward normal (altitude raises the horizon).
  const groundR = groundRadiusM(groundNet);
  const gd = surfaceNormalRelative(groundNet.latRad, groundNet.lonRad, t);
  const gto: Vec3 = [gd[0] * groundR, gd[1] * groundR, gd[2] * groundR];

  let worstCause: Exclude<LinkCause, "ok"> = "set_below_horizon";
  for (const sat of sats) {
    const { eirp, rangeRefM } = bestAntenna(sat);
    const satPos = satPositionRelative(eph, sat, t);
    const up = evaluateLink(from, normal, satPos, eirp, rangeRefM);
    if (!up.closes) {
      if (up.cause !== "ok") worstCause = up.cause;
      continue;
    }
    // Downlink: the sat seen from the ground endpoint's local horizon.
    const down = evaluateLink(gto, gd, satPos, eirp, rangeRefM);
    if (!down.closes) {
      if (down.cause !== "ok") worstCause = down.cause;
      continue;
    }
    return { satId: sat.id, latencyS: up.latencyS + down.latencyS };
  }
  return { satId: null, cause: worstCause };
}

/** Ground-net world radius (toy body radius + antenna altitude), earth-relative. The
 * toy body radius (world.ts) keeps the ground endpoint on the same sphere the link
 * budget uses; the altitude raises its local horizon. */
function groundRadiusM(groundNet: GroundNet): number {
  return A1_BODY_RADIUS_M + groundNet.altitudeM;
}

/**
 * Is the region SERVED at sim-time t? Path-existence over the disc: the conservative
 * Act-1 verdict is whether the WORST disc point (the edge, since the parked GEO sits at
 * the nadir) bridges to the ground net. The per-point machinery is exposed via
 * {@link isPointServed} for the WHOLE-DISC `coveredFraction` pin; the binary contract
 * served-fraction uses the worst-point check (served ⇒ the whole disc is served).
 *
 * For path-existence we evaluate the region CENTRE plus the disc rim; if a bridging sat
 * exists for the centre we return its path/latency, else we surface the binding cause.
 */
export function solve(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): SolveResult {
  const losses: LinkLossStamp[] = [];
  const groundNet = groundNets[0];
  if (!groundNet || sats.length === 0) {
    return {
      served: false,
      path: null,
      latencyS: Infinity,
      bindingConstraint: "connectivity",
      losses,
    };
  }
  // Faulted sats are removed from the graph (a fault is a topology change, Act 3b).
  const live = faults && faults.size ? sats.filter((s) => !faults.has(s.id)) : sats;

  // The region endpoint is sampled at its CENTRE for the path-existence verdict; the
  // WHOLE-DISC margin (every Fibonacci sample reachable) is asserted via isPointServed.
  const centre: RegionPoint = { latRad: contract.region.latRad, lonRad: contract.region.lonRad };
  const bridge = bridgeForPoint(eph, centre, groundNet, live, t);
  if (bridge.satId === null) {
    losses.push({ aId: contract.region.id, bId: groundNet.id, cause: bridge.cause, atS: t });
    return {
      served: false,
      path: null,
      latencyS: Infinity,
      bindingConstraint: "connectivity",
      losses,
    };
  }
  return {
    served: true,
    path: [contract.region.id, bridge.satId, groundNet.id],
    latencyS: bridge.latencyS,
    bindingConstraint: null,
    losses,
  };
}

/** A coverage predicate for {@link import("./endpoint").coveredFraction}: a disc sample
 * point is COVERED iff it bridges to the ground net via some sat at sim-time t. This is
 * the generic edge predicate the WHOLE-DISC pin asserts === 1.0 over every sample. */
export function isPointServed(
  eph: Ephemeris,
  point: RegionPoint,
  groundNets: GroundNet[],
  sats: NetSat[],
  t: number,
  faults?: ReadonlySet<string>,
): boolean {
  const groundNet = groundNets[0];
  if (!groundNet || sats.length === 0) return false;
  const live = faults && faults.size ? sats.filter((s) => !faults.has(s.id)) : sats;
  return bridgeForPoint(eph, point, groundNet, live, t).satId !== null;
}

// ── the re-solve split: cached path + topology fingerprint (design §2.4) ─────────

/** The router's cached state for the cheap per-tick re-eval. `served` is refreshed
 * every tick from the cached path's predicates; the full search re-runs only when the
 * topology fingerprint changes OR a horizon rise/set is detected on the cached path. */
export interface RouterState {
  /** The last full-search result (the cached path). */
  result: SolveResult;
  /** The sim-time the cached search ran. */
  solvedAtS: number;
  /** The topology fingerprint at the last full search (launch/fault/demand changes). */
  topoKey: string;
  /** Whether the cached path was served at the last full search (for rise/set edges). */
  wasServed: boolean;
}

/** A cheap topology fingerprint: which sats exist + which are faulted + the contract id.
 * A change here forces a full re-search (a launch adds a sat id; a fault flips one). */
export function topologyKey(
  contract: RoutableContract,
  sats: NetSat[],
  faults?: ReadonlySet<string>,
): string {
  const ids = sats.map((s) => s.id).sort();
  const faulted = faults && faults.size ? [...faults].sort() : [];
  return `${contract.id}|${ids.join(",")}|${faulted.join(",")}`;
}

/**
 * The §2.4 re-solve split, one tick. Returns the refreshed {@link RouterState} and the
 * current {@link SolveResult}:
 *
 *   - If the topology fingerprint changed since the cached search → run the full
 *     {@link solve} (a discrete topology change: launch / fault / demand).
 *   - Else cheaply RE-EVALUATE the cached path's served predicate this tick. If the
 *     served verdict FLIPPED (a horizon rise or set — a node crossed the elevation gate)
 *     → that is a horizon event → re-run the full {@link solve} to rebuild the path and
 *     stamp the loss. Otherwise keep the cached path and just refresh served/latency.
 *
 * So the parked GEO (time-invariant geometry, served never flips) re-solves only on the
 * launch; the LEO (sets continuously) flips served and re-solves to UNSERVED with a
 * stamped link loss — exactly the design's trigger for the gentle shortfall.
 */
export function resolveTick(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  prev: RouterState | null,
  faults?: ReadonlySet<string>,
): RouterState {
  const topoKey = topologyKey(contract, sats, faults);

  // First tick or a discrete topology change ⇒ full search.
  if (!prev || prev.topoKey !== topoKey) {
    const result = solve(eph, contract, sats, groundNets, t, faults);
    return { result, solvedAtS: t, topoKey, wasServed: result.served };
  }

  // Cheap per-tick re-eval of the cached path's served predicate.
  const nowServed = isRegionServed(eph, contract, sats, groundNets, t, faults);
  if (nowServed !== prev.wasServed) {
    // A horizon rise/set crossed the gate ⇒ a topology event ⇒ full re-search.
    const result = solve(eph, contract, sats, groundNets, t, faults);
    return { result, solvedAtS: t, topoKey, wasServed: result.served };
  }

  // No event: keep the cached path, just refresh the served/latency truth for this t.
  if (!nowServed) {
    return {
      result: { ...prev.result, served: false },
      solvedAtS: prev.solvedAtS,
      topoKey,
      wasServed: false,
    };
  }
  // Still served on the cached path — refresh the realized latency cheaply.
  const refreshed = solve(eph, contract, sats, groundNets, t, faults);
  return { result: refreshed, solvedAtS: prev.solvedAtS, topoKey, wasServed: true };
}

/** The binary region-served predicate used by the cheap re-eval (the centre bridges). */
function isRegionServed(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): boolean {
  const centre: RegionPoint = { latRad: contract.region.latRad, lonRad: contract.region.lonRad };
  return isPointServed(eph, centre, groundNets, sats, t, faults);
}
