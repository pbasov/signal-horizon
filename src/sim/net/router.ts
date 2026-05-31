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
  interBodyOneWayLatencyS,
  NET_LINK_CAPACITY_UNITS,
} from "./link-budget";
import { NET_ACT4_RELAY_ID_STEM } from "./endpoint";
import type { PreferWeights } from "./contract";

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
 * structural lets A2 pass the real Contract without a router change.
 *
 * --- E1 (Act 3a, additive + signature-stable) ------------------------------------
 * The §7.2 reactive cost-blend reads the per-contract `prefer.{lat,bw,stab}` weights and
 * the `latency` axis reads `slaLatencyS`. The full {@link import("./contract").Contract}
 * is a structural supertype that supplies both at runtime — but the TYPE must surface
 * them so the router can read them off a RoutableContract. BOTH are OPTIONAL with no-op
 * defaults so Act-1/Act-2 callers (and the A1/A2/golden paths) are byte-identical when
 * absent: `prefer` absent ⇒ {@link NET_ROUTER_DEFAULT_PREFER} (lat-only, w_bw = w_stab = 0);
 * `slaLatencyS` absent ⇒ Infinity (no latency ceiling ever binds). */
export interface RoutableContract {
  id: string;
  region: Region;
  activeAxes?: ReadonlySet<RouterAxis>;
  /** E1: per-contract §7.2/§7.3 prefer weights; absent ⇒ lat-only default (no-op blend). */
  prefer?: PreferWeights;
  /** E1: max one-way latency (s) the path must achieve; absent ⇒ Infinity (no ceiling). */
  slaLatencyS?: number;
  /** P4 (§4.3): the contract's COMMITTED bandwidth FLOOR — the bandwidth axis is MET when this
   * contract's served bandwidth over the shared link is ≥ this; absent ⇒ 0 (no floor ever binds). */
  slaBandwidth?: number;
  /** P4 (§4.3): the contract's bursty REALIZED offered load THIS instant (its share of the shared
   * link is proportional to this); absent ⇒ 0 (it asks for nothing, so its floor is trivially met). */
  offeredLoad?: number;
}

/** The router's default PREFER weights when a contract carries none (E1 back-compat). The
 * SAME shape as {@link import("./contract").NET_DEFAULT_PREFER}: latency-biased, bandwidth
 * secondary, stability DORMANT (w_stab = 0 — the cost-blend STRUCTURE is the real §7.2 blend
 * so M2 turns on the predictive/stability term with no reshape; in M1 it contributes 0). With
 * these defaults + no `loadBySat`, the blend's cost reduces to the bare latency term, which is
 * a monotone function of path distance — so it picks the SAME bridge the legacy max-margin
 * (closest/highest-above-horizon) pick did. Restated here so the router needs no value import. */
export const NET_ROUTER_DEFAULT_PREFER: PreferWeights = { lat: 1.0, bw: 0.0, stab: 0.0 };

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
 * --- THE HAND-OFF PRIMITIVE (Act 2 / design §4.4) --------------------------------
 * With N sats over a region (the constellation), SEVERAL may bridge at once during a
 * hand-off (one rising as another sets). We pick the STRONGEST-MARGIN bridge — the sat
 * with the largest `min(up.received, down.received)` — tie-broken by `satId` ASCENDING.
 * Because `received ∝ 1/d²` and the inverse-square budget never binds at these orbits
 * (only the 5° elevation gate does), the strongest-margin sat is the one HIGHEST above
 * the local horizon: a pure function of geometry + t, INDEPENDENT of roster order. So a
 * re-solve on a rise/set deterministically picks the rising sat as the setting one drops
 * — and a batch launched in any order yields the same bridge. (This is also the seed for
 * the Act-3 cost-weighted Dijkstra: today's max-margin is the degenerate one-hop case.)
 *
 * --- THE GROUND NETWORK (Act 2, the high-lat region) -----------------------------
 * The ground network is a SET of stations (Act 1: one equatorial GROUND-0; Act 2 adds a
 * high-lat GROUND-1 under REGION-1). A region bridges iff SOME (sat, ground) pair closes
 * both hops; we pick the strongest-margin pair across ALL grounds, the margin folding in
 * the downlink too — so an equatorial region keeps terminating at GROUND-0 (the only ground
 * its sats can downlink to) and the high-lat region terminates at GROUND-1 (the equatorial
 * ground is ~70° away, beyond a LEO's bridge span). The cross-ground tie-break is by satId
 * ascending then groundId ascending — order-independent, pure. An EQUATORIAL region with one
 * reachable ground gets a byte-identical bridge to the single-ground form (golden-safe).
 *
 * --- THE REACTIVE COST-BLEND (Act 3a / §7.2 — the min-cost pick, E1+E2) -----------
 * Instead of the FIRST bridging sat (the pre-Act-3 critique target), we pick the MIN-COST
 * (sat, ground) bridge under the §7.2 reactive blend (still O(sats·grounds) — the degenerate
 * Dijkstra the header promises). For each candidate:
 *   cost = w_lat·latency_term + w_bw·congestion_term + w_stab·instability_term
 *     latency_term     = up.latencyS + down.latencyS            (the realized path length / c)
 *     congestion_term  = sharedLoadOnSat / NET_LINK_CAPACITY_UNITS   (∝ 1 / available bandwidth)
 *     instability_term = 0                                       (w_stab DORMANT — M1 LOCKED)
 *     w_lat = prefer.lat,  w_bw = prefer.bw,  w_stab = prefer.stab
 * `sharedLoadOnSat = loadBySat.get(satId) ?? 0`.
 *
 * BYTE-IDENTITY (the back-compat guarantee): when `loadBySat` is absent/empty AND `prefer`
 * is the lat-only default ({@link NET_ROUTER_DEFAULT_PREFER}), the cost is the bare latency
 * term — and because every candidate's latency is a monotone function of its distance while
 * `received ∝ 1/d²`, the min-latency sat IS the max-margin sat the legacy path picked. To
 * make the result BIT-identical (latency_term and margin agree on the winner but the tie-break
 * differs in shape), the default branch takes the EXISTING max-margin comparison VERBATIM; the
 * cost-blend branch activates ONLY when a non-default prefer or a non-empty `loadBySat` is
 * supplied (Act 3a). So Act-1/Act-2 routing + the golden are untouched.
 *
 * Returns the bridging sat id + realized latency, or null with the binding cause.
 */
export function bridgeForPoint(
  eph: Ephemeris,
  point: RegionPoint,
  groundNets: GroundNet[],
  sats: NetSat[],
  t: number,
  prefer?: PreferWeights,
  loadBySat?: ReadonlyMap<string, number>,
): { satId: string; groundId: string; latencyS: number } | { satId: null; cause: Exclude<LinkCause, "ok"> } {
  const from = surfacePointRelative(point.latRad, point.lonRad, t);
  const normal = surfaceNormalRelative(point.latRad, point.lonRad, t);

  // The §7.2 blend is engaged ONLY when a non-default prefer or a non-empty shared-load map is
  // supplied (Act 3a). Otherwise the LEGACY max-margin pick runs VERBATIM (byte-identical Act-1/2).
  const w = prefer ?? NET_ROUTER_DEFAULT_PREFER;
  const blendEngaged =
    (loadBySat !== undefined && loadBySat.size > 0) ||
    w.lat !== NET_ROUTER_DEFAULT_PREFER.lat ||
    w.bw !== NET_ROUTER_DEFAULT_PREFER.bw ||
    w.stab !== NET_ROUTER_DEFAULT_PREFER.stab;

  let worstCause: Exclude<LinkCause, "ok"> = "set_below_horizon";
  // The best (sat, ground) bridge so far. In the LEGACY path the score is margin (maximise);
  // in the BLEND path the score is cost (minimise). Ties break by satId ascending then groundId
  // ascending in BOTH paths — order-independent across roster + grounds.
  let bestSatId: string | null = null;
  let bestGroundId: string | null = null;
  let bestLatencyS = Infinity;
  let bestMargin = -Infinity;
  let bestCost = Infinity;
  for (const groundNet of groundNets) {
    // Ground endpoint world position + its outward normal (altitude raises the horizon).
    const groundR = groundRadiusM(groundNet);
    const gd = surfaceNormalRelative(groundNet.latRad, groundNet.lonRad, t);
    const gto: Vec3 = [gd[0] * groundR, gd[1] * groundR, gd[2] * groundR];
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
      const latencyS = up.latencyS + down.latencyS;
      let better: boolean;
      if (blendEngaged) {
        // §7.2 cost = w_lat·latency_term + w_bw·congestion_term + w_stab·0. Lower is better.
        const sharedLoad = loadBySat?.get(sat.id) ?? 0;
        const congestionTerm = sharedLoad / NET_LINK_CAPACITY_UNITS;
        const cost = w.lat * latencyS + w.bw * congestionTerm; // w_stab·instability_term = 0.
        better =
          cost < bestCost ||
          (cost === bestCost &&
            bestSatId !== null &&
            (sat.id < bestSatId ||
              (sat.id === bestSatId && bestGroundId !== null && groundNet.id < bestGroundId)));
        if (better) bestCost = cost;
      } else {
        // LEGACY max-margin pick (VERBATIM): margin = min(up.received, down.received), higher better.
        const margin = Math.min(up.received, down.received);
        better =
          margin > bestMargin ||
          (margin === bestMargin &&
            bestSatId !== null &&
            (sat.id < bestSatId ||
              (sat.id === bestSatId && bestGroundId !== null && groundNet.id < bestGroundId)));
        if (better) bestMargin = margin;
      }
      if (better) {
        bestSatId = sat.id;
        bestGroundId = groundNet.id;
        bestLatencyS = latencyS;
      }
    }
  }
  if (bestSatId !== null && bestGroundId !== null) {
    return { satId: bestSatId, groundId: bestGroundId, latencyS: bestLatencyS };
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
  loadBySat?: ReadonlyMap<string, number>,
): SolveResult {
  // ACT 4 (the Mars frontier teaser) — the ONE special-cased branch. A region on MARS does NOT
  // route through the toy-frame budget (no toy 300 km geometry at 1 AU, no fake EIRP); it is
  // solved by PRESENCE-based connectivity + a REAL-ephemeris light-delay injection. Earth
  // contracts (the rest of the file) are untouched — they keep the full toy-frame bridgeForPoint.
  if (contract.region.bodyId === "mars") {
    return solveMarsLeg(eph, contract, sats, groundNets, t, faults);
  }
  const losses: LinkLossStamp[] = [];
  if (groundNets.length === 0 || sats.length === 0) {
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
  // WHOLE-DISC margin (every Fibonacci sample reachable) is asserted via isPointServed. The
  // bent path closes via the MIN-COST (sat, ground) bridge across ALL ground stations (the
  // §7.2 reactive blend over prefer+loadBySat; the legacy max-margin pick when both default —
  // golden-safe). Act 2 adds the high-lat GROUND-1 for REGION-1.
  const centre: RegionPoint = { latRad: contract.region.latRad, lonRad: contract.region.lonRad };
  const bridge = bridgeForPoint(eph, centre, groundNets, live, t, contract.prefer, loadBySat);
  if (bridge.satId === null) {
    losses.push({ aId: contract.region.id, bId: groundNets[0].id, cause: bridge.cause, atS: t });
    // When the contract ENFORCES the availability axis, an instantaneous gap (the sat set
    // with no riser) reads as an AVAILABILITY shortfall (a region that needs continuous
    // coverage is not held this instant) — drives the Act-2 trace wording. Without the axis
    // (Act 1) the same gap is a plain CONNECTIVITY shortfall ("no path"). The verdict bit is
    // identical; only the named binding axis differs, so callers/goldens stay stable.
    const enforcesAvail = contract.activeAxes?.has("availability") ?? false;
    return {
      served: false,
      path: null,
      latencyS: Infinity,
      bindingConstraint: enforcesAvail ? "availability" : "connectivity",
      losses,
    };
  }

  // A bridge exists. The Act-3 quantitative axes bite BINARY (HIGH-1: a pro-rata fraction never
  // accrues breach under the shared state machine), enforced ONE AT A TIME via `activeAxes`:
  //
  //   LATENCY (§4.4) — the GEO ceiling, felt: a path whose realized one-way latency exceeds the
  //   contract's `slaLatencyS` does NOT satisfy a latency-active contract (a ~340 ms GEO path
  //   fails a low-latency SLA; a short LEO/relay hop passes). bindingConstraint = "latency".
  const slaLatencyS = contract.slaLatencyS ?? Infinity;
  if ((contract.activeAxes?.has("latency") ?? false) && bridge.latencyS > slaLatencyS) {
    losses.push({ aId: contract.region.id, bId: bridge.satId, cause: "out_of_budget", atS: t });
    return {
      served: false,
      path: [contract.region.id, bridge.satId, bridge.groundId],
      latencyS: bridge.latencyS,
      bindingConstraint: "latency",
      losses,
    };
  }

  //   BANDWIDTH (§4.3) — the shared-link limit, felt via the contract's OWN committed FLOOR (P4):
  //   the shared bridge carries `sharedLoad = Σ offeredLoad` over the per-antenna physical capacity
  //   NET_LINK_CAPACITY_UNITS. While the shared peak is AT OR UNDER capacity the link HONORS every
  //   sharing contract's full offered load — so it is bandwidth-MET (a low-demand contract under its
  //   own floor is still met: the link delivers everything it asked for). It is ONLY when a
  //   COINCIDENT-PEAK spike pushes the shared peak OVER capacity that the link can no longer honor
  //   every floor: capacity is then shared in PROPORTION to each contract's offered load, so this
  //   contract's served bandwidth is `capacity · offeredLoad / sharedLoad`. It BREACHES iff that
  //   over-subscribed share falls below its OWN `slaBandwidth` (the committed floor — NOT a flat
  //   uniform cliff). The router already routed AROUND congestion (the cost-blend prefers a less-
  //   loaded parallel path), so this bites only when the chosen — already the cheapest — path's peak
  //   still over-subscribes this contract below its floor. binding = "bandwidth".
  if (contract.activeAxes?.has("bandwidth") ?? false) {
    const slaBandwidth = contract.slaBandwidth ?? 0;
    const sharedLoad = loadBySat?.get(bridge.satId) ?? 0;
    // ONLY an OVER-SUBSCRIBED link (shared peak strictly over capacity) can starve a contract below
    // its floor; under capacity the link honors all offered load (always met). Guard slaBandwidth ≤ 0
    // (no floor binds) + the degenerate sharedLoad ≤ 0.
    if (slaBandwidth > 0 && sharedLoad > NET_LINK_CAPACITY_UNITS && sharedLoad > 0) {
      const ownLoad = contract.offeredLoad ?? 0;
      // The proportional fair share of the over-subscribed link (sharedLoad ≥ ownLoad whenever this
      // contract loads the sat, so the share is well-defined).
      const servedBandwidth = (NET_LINK_CAPACITY_UNITS * ownLoad) / sharedLoad;
      if (servedBandwidth < slaBandwidth) {
        losses.push({ aId: bridge.satId, bId: bridge.groundId, cause: "out_of_budget", atS: t });
        return {
          served: false,
          path: [contract.region.id, bridge.satId, bridge.groundId],
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
    latencyS: bridge.latencyS,
    bindingConstraint: null,
    losses,
  };
}

/**
 * ACT 4 — the Mars leg (the frontier teaser, "distance changes everything"). The interplanetary
 * hop is NOT a toy-frame `evaluateLink` close (the design's Blocker-2 resolution): the toy
 * 300 km body geometry + inverse-square budget cannot meaningfully close at ~1 AU, and forcing it
 * would need a physically-meaningless EIRP in the fold. Instead:
 *
 *   - CONNECTIVITY is PRESENCE-based — the Mars contract bridges by construction once the player
 *     has launched the deep-space RELAY (a sat whose id begins {@link NET_ACT4_RELAY_ID_STEM},
 *     not faulted). No relay ⇒ `bindingConstraint = "connectivity"` (exactly like Act 1's "no
 *     path"). The relay's antenna spec is cosmetic — it is never run through the toy budget.
 *   - LATENCY is the REAL one-way light delay `interBodyOneWayLatencyS(eph,"earth","mars",t)`
 *     (the SAME value the packet-crawl uses; minutes), injected into the unchanged `latencyS`
 *     field. It is a READOUT, never an enforced axis — the Mars contract's `activeAxes` is
 *     `{connectivity}` only, so the minutes-long latency never breaches (vertigo, not a system).
 *
 * The `SolveResult` shape is unchanged. `path = [marsRegion.id, relay.id, groundNet.id]`. Pure.
 */
function solveMarsLeg(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): SolveResult {
  const losses: LinkLossStamp[] = [];
  // The deep-space relay must be present (launched) AND not faulted to bridge the Mars leg.
  const relay = sats.find(
    (s) => s.id.startsWith(NET_ACT4_RELAY_ID_STEM) && !(faults?.has(s.id) ?? false),
  );
  const groundId = groundNets.length > 0 ? groundNets[0].id : "GROUND-0";
  if (relay === undefined) {
    // No relay launched (or it faulted) ⇒ the interplanetary path does not exist (presence-based).
    losses.push({ aId: contract.region.id, bId: groundId, cause: "set_below_horizon", atS: t });
    return { served: false, path: null, latencyS: Infinity, bindingConstraint: "connectivity", losses };
  }
  // The honest interplanetary one-way light delay (minutes) — a READOUT, never an enforced axis.
  const latencyS = interBodyOneWayLatencyS(eph, "earth", "mars", t);
  return {
    served: true,
    path: [contract.region.id, relay.id, groundId],
    latencyS,
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
  if (groundNets.length === 0 || sats.length === 0) return false;
  const live = faults && faults.size ? sats.filter((s) => !faults.has(s.id)) : sats;
  return bridgeForPoint(eph, point, groundNets, live, t).satId !== null;
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

/** A cheap topology fingerprint: which sats exist + which are faulted + the contract id +
 * (E3, Act 3a) a quantized CONGESTION EPOCH. A change here forces a full re-search.
 *
 * --- E3 (the HIGH-2 fix) — the congestion fingerprint ----------------------------
 * The session calls `resolveTick` (not `solve`), which re-solves ONLY on a topologyKey change.
 * A rising `offeredLoad` is neither a launch nor a fault, so without this the cached verdict
 * would go STALE on congestion (design §2.4 requires "a demand/escalation change triggers a
 * re-solve"). The session keeps a per-step integer `congestionEpoch` that bumps whenever any
 * sat's quantized shared-load bucket changes OR a contract crosses the bandwidth-axis threshold;
 * folding it into the key means a congestion change ⇒ epoch bumps ⇒ fingerprint changes ⇒ full
 * re-solve through the cached path. We fold the QUANTIZED epoch (an int), NEVER the raw float
 * load (raw floats would re-solve every tick and defeat the cache). Absent (= 0) ⇒ the key is
 * BYTE-IDENTICAL to the pre-Act-3 fingerprint (golden-safe). */
export function topologyKey(
  contract: RoutableContract,
  sats: NetSat[],
  faults?: ReadonlySet<string>,
  congestionEpoch = 0,
): string {
  const ids = sats.map((s) => s.id).sort();
  const faulted = faults && faults.size ? [...faults].sort() : [];
  return `${contract.id}|${ids.join(",")}|${faulted.join(",")}|${congestionEpoch}`;
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
  loadBySat?: ReadonlyMap<string, number>,
  congestionEpoch = 0,
): RouterState {
  const topoKey = topologyKey(contract, sats, faults, congestionEpoch);

  // First tick or a discrete topology change (launch / fault / CONGESTION EPOCH bump) ⇒ full
  // search. E3: a rising `offeredLoad` that bumps `congestionEpoch` flips topoKey here, so the
  // cached verdict refreshes for congestion (the HIGH-2 fix) — `loadBySat` is forwarded so the
  // re-solve actually consumes the shared load + the latency/bandwidth axes.
  if (!prev || prev.topoKey !== topoKey) {
    const result = solve(eph, contract, sats, groundNets, t, faults, loadBySat);
    return { result, solvedAtS: t, topoKey, wasServed: result.served };
  }

  // Cheap per-tick re-eval of the cached path's served predicate.
  const nowServed = isRegionServed(eph, contract, sats, groundNets, t, faults);
  if (nowServed !== prev.wasServed) {
    // A horizon rise/set crossed the gate ⇒ a topology event ⇒ full re-search.
    const result = solve(eph, contract, sats, groundNets, t, faults, loadBySat);
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
  // Still served on the cached path — refresh the realized latency + the axis verdicts cheaply.
  const refreshed = solve(eph, contract, sats, groundNets, t, faults, loadBySat);
  return { result: refreshed, solvedAtS: prev.solvedAtS, topoKey, wasServed: true };
}

/** The binary region-served predicate used by the cheap re-eval (the centre bridges). For an
 * Act-4 MARS region this is the PRESENCE test (a live relay in the roster) — NOT the toy-frame
 * bridge, which can never close at interplanetary range. A parked relay's presence is
 * time-invariant, so the cheap re-eval keeps the cached Mars path (no spurious horizon flip). */
function isRegionServed(
  eph: Ephemeris,
  contract: RoutableContract,
  sats: NetSat[],
  groundNets: GroundNet[],
  t: number,
  faults?: ReadonlySet<string>,
): boolean {
  if (contract.region.bodyId === "mars") {
    return sats.some(
      (s) => s.id.startsWith(NET_ACT4_RELAY_ID_STEM) && !(faults?.has(s.id) ?? false),
    );
  }
  const centre: RegionPoint = { latRad: contract.region.latRad, lonRad: contract.region.lonRad };
  return isPointServed(eph, centre, groundNets, sats, t, faults);
}
