/**
 * net/ — THE ROUTING GRAPH: sat↔sat CROSSLINK edges and the relay closure over them.
 * This is `M1-SAT-3` (the edges) feeding `M1-SLV-1` (the solver) — the substrate SD-39
 * locked ("a deterministic shortest-path-over-time-varying-graph solver … over the
 * current line-of-sight adjacency") and which the bent-pipe Act-1 stub stood in for.
 *
 * WHAT AN EDGE IS. Two sats are adjacent at sim-time t iff both fly a CROSSLINK antenna
 * and the inter-sat budget closes BOTH ways (each end's own eirp/rangeRef) with no body
 * occlusion. There is no elevation gate in orbit — {@link evaluateInterSatLink} is the
 * predicate. Edges are UNDIRECTED and keyed with the smaller sat id first, so the
 * adjacency is a pure function of geometry and never of iteration order.
 *
 * WHY A CLOSURE AND NOT A PER-SOLVE DIJKSTRA. The relay leg between two sats does not
 * depend on WHICH contract is being routed — only on geometry, the prefer weights and
 * the load map. So it is computed once per solve as an all-pairs closure (Floyd–Warshall
 * over a handful of sats: S³ with S≈10 is ~1k relaxations) and every candidate path
 * reads it. The caller skips construction entirely when no sat flies a CROSSLINK, which
 * is why a BROADCAST-only fleet pays nothing and routes bit-identically to the stub.
 *
 * TWO COST MODES, matching the router's two comparison regimes:
 *   - `"cost"`   — additive `w_lat·latency + w_bw·congestion`, minimised (the §7.2 blend).
 *   - `"margin"` — the BOTTLENECK received along the path, maximised (the legacy
 *     max-margin regime the router uses when no prefer override and no load map engage).
 * Both compose in Floyd–Warshall (min-plus and max-min respectively).
 *
 * DETERMINISM. Sat ids are sorted; relaxation runs in that index order; a candidate
 * replaces the incumbent only on STRICT improvement, or on an exact tie broken by fewer
 * hops and then by the lexicographically smaller path. No epsilons, no float slop
 * tolerance — the same inputs always fold to the same path, which is what the replay
 * golden requires.
 *
 * THE PAIRING SEAM. `allowedPairs` filters the edge set. Absent ⇒ AUTO-MESH (SD-39's
 * model: the solver considers every geometrically feasible edge). Supplied ⇒ only the
 * pairs the player has committed are edges. This is the one hook the hand-paired
 * crosslink verb needs; nothing else in the solver changes between the two designs.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG.
 *
 * @see docs/decisions.md SD-39; docs/signal-horizon-m1.md §7.1–§7.2; GDD §4.3a.
 */

import type { Vec3 } from "../ephemeris";
import type { NetSat } from "./sat";
import { evaluateInterSatLink } from "./link-budget";
import { crosslinkPipes, pipeKey } from "./beams";
import type { PreferWeights } from "./contract";

/** One undirected CROSSLINK edge between two sats at sim-time t. */
export interface InterSatEdge {
  /** The lexicographically smaller sat id. */
  aId: string;
  /** The lexicographically larger sat id. */
  bId: string;
  /** The crosslink pipe used at the `aId` end. */
  aPipe: string;
  /** The crosslink pipe used at the `bId` end. */
  bPipe: string;
  /** One-way propagation latency across the edge (seconds). */
  latencyS: number;
  /** The bottleneck received ratio of the two directions (≥ 1 when it closes). */
  received: number;
}

/** The undirected pair key of two sat ids, smaller first. */
export function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Every CROSSLINK edge that closes at sim-time t, sorted by (aId, bId).
 *
 * `positions` supplies each sat's earth-relative world position (the caller already
 * solves these for the access/gateway legs, so nothing is propagated twice). A sat
 * absent from the map is skipped. `allowedPairs`, when supplied, restricts the edge set
 * to committed pairings — the hand-paired verb's seam.
 */
export function interSatEdges(
  sats: readonly NetSat[],
  positions: ReadonlyMap<string, Vec3>,
  allowedPairs?: ReadonlySet<string>,
): InterSatEdge[] {
  // Only sats that actually fly a relay terminal can be endpoints.
  const relayable = sats
    .filter((s) => crosslinkPipes(s).length > 0 && positions.has(s.id))
    .sort((x, y) => (x.id < y.id ? -1 : x.id > y.id ? 1 : 0));

  const out: InterSatEdge[] = [];
  for (let i = 0; i < relayable.length; i++) {
    for (let j = i + 1; j < relayable.length; j++) {
      const a = relayable[i];
      const b = relayable[j];
      if (allowedPairs !== undefined && !allowedPairs.has(pairKey(a.id, b.id))) continue;
      const pa = positions.get(a.id) as Vec3;
      const pb = positions.get(b.id) as Vec3;

      // Best terminal pairing across the two ends: the edge closes only if BOTH
      // directions close on their own antenna. Ties break to the lowest slot indices.
      let best: InterSatEdge | null = null;
      for (const ca of crosslinkPipes(a)) {
        const ab = evaluateInterSatLink(pa, pb, ca.antenna.eirp, ca.antenna.rangeRefM);
        if (!ab.closes) continue;
        for (const cb of crosslinkPipes(b)) {
          const ba = evaluateInterSatLink(pb, pa, cb.antenna.eirp, cb.antenna.rangeRefM);
          if (!ba.closes) continue;
          const received = Math.min(ab.received, ba.received);
          if (best === null || received > best.received) {
            best = {
              aId: a.id,
              bId: b.id,
              aPipe: pipeKey(a.id, ca.slotIdx),
              bPipe: pipeKey(b.id, cb.slotIdx),
              latencyS: ab.latencyS,
              received,
            };
          }
        }
      }
      if (best !== null) out.push(best);
    }
  }
  return out;
}

/** Which regime the closure optimises (mirrors the router's two comparison modes). */
export type RelayMode = "cost" | "margin";

/** The best relay leg between two sats: the sat chain, and its cost in both regimes. */
export interface RelayLeg {
  /** Sat ids from source to destination INCLUSIVE. Length 1 = the zero-hop self leg. */
  path: string[];
  /** Σ propagation latency across the relay hops (0 for the self leg). */
  latencyS: number;
  /** Σ blend cost across the relay hops (0 for the self leg). */
  cost: number;
  /** Bottleneck received across the relay hops (Infinity for the self leg). */
  margin: number;
}

/** All-pairs best relay legs. `leg(a, a)` is always the zero-hop self leg. */
export interface RelayClosure {
  leg(fromSatId: string, toSatId: string): RelayLeg | null;
  readonly edges: readonly InterSatEdge[];
}

/** The zero-hop leg — a sat reaching itself costs nothing and bottlenecks on nothing. */
function selfLeg(satId: string): RelayLeg {
  return { path: [satId], latencyS: 0, cost: 0, margin: Infinity };
}

/**
 * True iff `cand` beats `held` under `mode`, with the deterministic tie-break: fewer
 * hops first, then the lexicographically smaller sat chain. Exact comparisons only.
 */
function beats(cand: RelayLeg, held: RelayLeg, mode: RelayMode): boolean {
  if (mode === "cost") {
    if (cand.cost !== held.cost) return cand.cost < held.cost;
  } else {
    if (cand.margin !== held.margin) return cand.margin > held.margin;
  }
  if (cand.path.length !== held.path.length) return cand.path.length < held.path.length;
  return cand.path.join(",") < held.path.join(",");
}

/**
 * Build the all-pairs relay closure over `edges` by Floyd–Warshall.
 *
 * In `"cost"` mode an edge weighs `w.lat·latencyS + w.bw·(load ÷ capacity)`, matching the
 * §7.2 blend the router applies to the access and gateway legs, so a relayed path's total
 * is directly comparable with a direct bridge's. `loadByPipe` is read for the crosslink
 * pipes at both ends; until relay load accounting lands those are 0 and the term is inert,
 * leaving latency the honest discriminator between spine routes.
 */
export function relayClosure(
  satIds: readonly string[],
  edges: readonly InterSatEdge[],
  mode: RelayMode,
  prefer: PreferWeights,
  capacityOfPipe: (pipe: string) => number,
  loadByPipe?: ReadonlyMap<string, number>,
): RelayClosure {
  const ids = [...satIds].sort();
  const index = new Map<string, number>();
  ids.forEach((id, i) => index.set(id, i));
  const n = ids.length;

  const cells: (RelayLeg | null)[][] = [];
  for (let i = 0; i < n; i++) {
    const row: (RelayLeg | null)[] = new Array(n).fill(null);
    row[i] = selfLeg(ids[i]);
    cells.push(row);
  }

  const congestion = (pipe: string): number => {
    const cap = capacityOfPipe(pipe);
    if (cap <= 0) return 0;
    return (loadByPipe?.get(pipe) ?? 0) / cap;
  };

  for (const e of edges) {
    const i = index.get(e.aId);
    const j = index.get(e.bId);
    if (i === undefined || j === undefined) continue;
    // The blend cost of traversing this edge: latency plus the mean congestion of the
    // two terminals it burns (one terminal at each end carries the same traffic).
    const cost =
      prefer.lat * e.latencyS + prefer.bw * ((congestion(e.aPipe) + congestion(e.bPipe)) / 2);
    const fwd: RelayLeg = {
      path: [e.aId, e.bId],
      latencyS: e.latencyS,
      cost,
      margin: e.received,
    };
    const rev: RelayLeg = { ...fwd, path: [e.bId, e.aId] };
    if (cells[i][j] === null || beats(fwd, cells[i][j] as RelayLeg, mode)) cells[i][j] = fwd;
    if (cells[j][i] === null || beats(rev, cells[j][i] as RelayLeg, mode)) cells[j][i] = rev;
  }

  for (let k = 0; k < n; k++) {
    for (let i = 0; i < n; i++) {
      const ik = cells[i][k];
      if (ik === null || i === k) continue;
      for (let j = 0; j < n; j++) {
        if (j === k || j === i) continue;
        const kj = cells[k][j];
        if (kj === null) continue;
        const cand: RelayLeg = {
          path: [...ik.path, ...kj.path.slice(1)],
          latencyS: ik.latencyS + kj.latencyS,
          cost: ik.cost + kj.cost,
          margin: Math.min(ik.margin, kj.margin),
        };
        const held = cells[i][j];
        if (held === null || beats(cand, held, mode)) cells[i][j] = cand;
      }
    }
  }

  return {
    edges,
    leg(fromSatId: string, toSatId: string): RelayLeg | null {
      const i = index.get(fromSatId);
      const j = index.get(toSatId);
      if (i === undefined || j === undefined) return null;
      return cells[i][j];
    },
  };
}
