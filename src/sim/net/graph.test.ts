import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { interSatEdges, relayClosure, pairKey } from "./graph";
import {
  bridgeForPoint,
  buildRelayClosure,
  satPositionRelative,
  solve,
  NET_ROUTER_DEFAULT_PREFER,
  type PipeContext,
} from "./router";
import { pipeKey } from "./beams";
import { antennaCardById, antennaFromCard, type NetSat, type AntennaSpec } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import { A1_GEO_SEMI_MAJOR_M, resolveOrbit } from "./world";
import { NET_ACT1_REGION, NET_ACT1_GROUND, type GroundNet, type Region } from "./endpoint";

/**
 * M1-SAT-3 + M1-SLV-1 — the CROSSLINK graph and the relay closure over it (SD-39's
 * "shortest-path-over-time-varying-graph solver", which the bent-pipe stub stood in for).
 *
 * TOY SCALE MATTERS HERE: body radius 300 km, GEO a ≈ 835 km, and the link-budget
 * reference distance is 50,000 km — so the inverse-square budget essentially never binds
 * between two sats and OCCLUSION BY THE BODY is the real gate. Two GEO sats see each
 * other while their chord clears the body: cos(Δlon/2) > 300/835, i.e. up to ~137° apart.
 * Every fixture below is built on that fact.
 */

const eph = Ephemeris.build({});

function card(id: string): AntennaSpec {
  const c = antennaCardById(id);
  if (c === null) throw new Error(`no card ${id}`);
  return antennaFromCard(c, NET_REF_LINK_DISTANCE_M);
}

/** A GEO parked at `subLonDeg` carrying `cards`. */
function geoSat(id: string, subLonDeg: number, cards: string[], t = 0): NetSat {
  return {
    id,
    orbit: resolveOrbit(
      { semiMajorM: A1_GEO_SEMI_MAJOR_M, incRad: 0, subLonRad: (subLonDeg * Math.PI) / 180 },
      t,
    ),
    bus: "comsat",
    loadout: cards.map(card),
  };
}

function positionsOf(sats: NetSat[], t = 0): Map<string, [number, number, number]> {
  const m = new Map<string, [number, number, number]>();
  for (const s of sats) m.set(s.id, satPositionRelative(eph, s, t));
  return m;
}

const CAP = (sats: NetSat[]) => (pipe: string): number => {
  const i = pipe.lastIndexOf(":");
  const sat = sats.find((s) => s.id === pipe.slice(0, i));
  return sat?.loadout[Number(pipe.slice(i + 1))]?.capacityUnits ?? 0;
};

describe("M1-SAT-3 — the CROSSLINK edge set", () => {
  it("two sats flying CROSSLINK, 90° apart, are ADJACENT", () => {
    const sats = [geoSat("A", 0, ["CROSSLINK"]), geoSat("B", 90, ["CROSSLINK"])];
    const edges = interSatEdges(sats, positionsOf(sats));
    expect(edges.length).toBe(1);
    expect([edges[0].aId, edges[0].bId]).toEqual(["A", "B"]);
    expect(edges[0].latencyS).toBeGreaterThan(0);
    expect(edges[0].received).toBeGreaterThanOrEqual(1);
  });

  it("ANTIPODAL sats are NOT adjacent — the body occludes the chord", () => {
    const sats = [geoSat("A", 0, ["CROSSLINK"]), geoSat("C", 180, ["CROSSLINK"])];
    expect(interSatEdges(sats, positionsOf(sats))).toEqual([]);
  });

  it("a sat with NO CROSSLINK card is never an endpoint (the terminal is the edge)", () => {
    const sats = [geoSat("A", 0, ["CROSSLINK"]), geoSat("B", 90, ["BROADCAST"])];
    expect(interSatEdges(sats, positionsOf(sats))).toEqual([]);
  });

  it("edges are UNDIRECTED and id-sorted, so adjacency never depends on roster order", () => {
    const a = geoSat("A", 0, ["CROSSLINK"]);
    const b = geoSat("B", 90, ["CROSSLINK"]);
    expect(interSatEdges([a, b], positionsOf([a, b]))).toEqual(
      interSatEdges([b, a], positionsOf([b, a])),
    );
  });

  it("THE PAIRING SEAM: `allowedPairs` filters the mesh down to committed pairs", () => {
    const sats = [
      geoSat("A", 0, ["CROSSLINK"]),
      geoSat("B", 90, ["CROSSLINK"]),
      geoSat("C", 180, ["CROSSLINK"]),
    ];
    const pos = positionsOf(sats);
    expect(interSatEdges(sats, pos).length).toBe(2); // A-B and B-C (A-C is occluded).
    const only = new Set([pairKey("B", "C")]);
    const filtered = interSatEdges(sats, pos, only);
    expect(filtered.length).toBe(1);
    expect([filtered[0].aId, filtered[0].bId]).toEqual(["B", "C"]);
  });
});

describe("M1-SLV-1 — the relay closure", () => {
  const chain = () => [
    geoSat("A", 0, ["CROSSLINK"]),
    geoSat("B", 90, ["CROSSLINK"]),
    geoSat("C", 180, ["CROSSLINK"]),
  ];

  function closureOf(sats: NetSat[], mode: "cost" | "margin" = "cost") {
    return relayClosure(
      sats.map((s) => s.id),
      interSatEdges(sats, positionsOf(sats)),
      mode,
      NET_ROUTER_DEFAULT_PREFER,
      CAP(sats),
    );
  }

  it("routes A→C through B when A→C is occluded — a REAL multi-hop path", () => {
    const leg = closureOf(chain()).leg("A", "C");
    expect(leg).not.toBeNull();
    expect(leg?.path).toEqual(["A", "B", "C"]);
  });

  it("the multi-hop latency is the SUM of its hops (no free teleport)", () => {
    const c = closureOf(chain());
    const ab = c.leg("A", "B");
    const bc = c.leg("B", "C");
    const ac = c.leg("A", "C");
    expect(ac?.latencyS).toBeCloseTo((ab?.latencyS ?? 0) + (bc?.latencyS ?? 0), 12);
  });

  it("the self leg is free and bottlenecks on nothing", () => {
    const leg = closureOf(chain()).leg("B", "B");
    expect(leg).toEqual({ path: ["B"], latencyS: 0, cost: 0, margin: Infinity });
  });

  it("margin mode reports the BOTTLENECK of the chain, not the sum", () => {
    const sats = chain();
    const c = closureOf(sats, "margin");
    const ab = c.leg("A", "B");
    const bc = c.leg("B", "C");
    const ac = c.leg("A", "C");
    expect(ac?.margin).toBe(Math.min(ab?.margin ?? 0, bc?.margin ?? 0));
  });

  it("an unreachable sat returns null (a partitioned spine stays partitioned)", () => {
    const sats = [geoSat("A", 0, ["CROSSLINK"]), geoSat("C", 180, ["CROSSLINK"])];
    expect(closureOf(sats).leg("A", "C")).toBeNull();
  });

  it("is DETERMINISTIC — identical inputs fold to an identical closure", () => {
    const one = closureOf(chain()).leg("A", "C");
    const two = closureOf(chain()).leg("A", "C");
    expect(one).toEqual(two);
  });
});

describe("M1-SLV-1 — the router routes over the spine", () => {
  /** A ground net antipodal to the region: no single sat can both serve and land. */
  const FAR_GROUND: GroundNet = {
    id: "GROUND-FAR",
    latRad: 0,
    lonRad: Math.PI,
    altitudeM: 0,
    bodyId: "earth",
  };
  const REGION: Region = NET_ACT1_REGION;

  /** Serve at lon 0, cross the spine, land at lon 180 through a GATEWAY. */
  function spineFleet(): NetSat[] {
    return [
      geoSat("SAT-A", 0, ["ACCESS_L", "CROSSLINK"]),
      geoSat("SAT-B", 90, ["CROSSLINK"]),
      geoSat("SAT-C", 180, ["GATEWAY", "CROSSLINK"]),
    ];
  }

  const ctxFor = (sats: NetSat[]): PipeContext => ({
    regionId: REGION.id,
    latencyActive: false,
    beams: new Map([[pipeKey(sats[0].id, 0), REGION.id]]),
  });

  it("WITHOUT the spine the region is UNREACHABLE — the bent pipe cannot span the body", () => {
    const sats = spineFleet();
    const b = bridgeForPoint(eph, REGION, [FAR_GROUND], sats, 0, undefined, undefined, ctxFor(sats));
    expect(b.satId).toBeNull();
  });

  it("WITH the spine it is SERVED, and the path names every hop", () => {
    const sats = spineFleet();
    const relay = buildRelayClosure(eph, sats, 0);
    expect(relay).toBeDefined();
    const b = bridgeForPoint(
      eph,
      REGION,
      [FAR_GROUND],
      sats,
      0,
      undefined,
      undefined,
      ctxFor(sats),
      relay,
    );
    expect(b.satId).toBe("SAT-A"); // the SERVING end — what the beam points.
    if (b.satId === null) throw new Error("unreachable");
    expect(b.satPath).toEqual(["SAT-A", "SAT-B", "SAT-C"]);
    expect(b.landingPipe).toBe(pipeKey("SAT-C", 0)); // the GATEWAY, not the access beam.
    expect(b.groundId).toBe("GROUND-FAR");
  });

  it("`solve` emits the full multi-hop path region→…→ground", () => {
    const sats = spineFleet();
    const r = solve(
      eph,
      { id: "C-1", region: REGION, activeAxes: new Set(["connectivity"] as const) },
      sats,
      [FAR_GROUND],
      0,
      undefined,
      undefined,
      new Map([[pipeKey("SAT-A", 0), REGION.id]]),
    );
    expect(r.served).toBe(true);
    expect(r.path).toEqual(["REGION-0", "SAT-A", "SAT-B", "SAT-C", "GROUND-FAR"]);
    expect(r.pipe).toBe(pipeKey("SAT-A", 0));
    expect(r.latencyS).toBeGreaterThan(0);
  });

  it("a landing sat with NO GATEWAY cannot land trunk traffic (BROADCAST is not a landing)", () => {
    const sats = [
      geoSat("SAT-A", 0, ["ACCESS_L", "CROSSLINK"]),
      geoSat("SAT-B", 90, ["CROSSLINK"]),
      geoSat("SAT-C", 180, ["BROADCAST", "CROSSLINK"]),
    ];
    const b = bridgeForPoint(
      eph,
      REGION,
      [FAR_GROUND],
      sats,
      0,
      undefined,
      undefined,
      ctxFor(sats),
      buildRelayClosure(eph, sats, 0),
    );
    expect(b.satId).toBeNull();
  });
});

describe("golden neutrality — a fleet with no relay terminal is untouched", () => {
  it("buildRelayClosure returns undefined for a BROADCAST-only fleet (the zero-cost path)", () => {
    const sats = [geoSat("GEO", 0, ["BROADCAST"])];
    expect(buildRelayClosure(eph, sats, 0)).toBeUndefined();
  });

  it("the direct bridge is IDENTICAL with and without the relay argument", () => {
    const sats = [geoSat("GEO", 0, ["BROADCAST"]), geoSat("GEO-2", 30, ["BROADCAST"])];
    const ctx: PipeContext = {
      regionId: NET_ACT1_REGION.id,
      latencyActive: false,
      beams: new Map(),
    };
    for (const t of [0, 37, 123.5]) {
      const before = bridgeForPoint(
        eph,
        NET_ACT1_REGION,
        [NET_ACT1_GROUND],
        sats,
        t,
        undefined,
        undefined,
        ctx,
      );
      const after = bridgeForPoint(
        eph,
        NET_ACT1_REGION,
        [NET_ACT1_GROUND],
        sats,
        t,
        undefined,
        undefined,
        ctx,
        buildRelayClosure(eph, sats, t),
      );
      expect(after).toEqual(before);
    }
  });

  it("a DIRECT bridge still reports satPath = [servingSat] and landingPipe = pipe", () => {
    const sats = [geoSat("GEO", 0, ["BROADCAST"])];
    const b = bridgeForPoint(eph, NET_ACT1_REGION, [NET_ACT1_GROUND], sats, 0, undefined, undefined, {
      regionId: NET_ACT1_REGION.id,
      latencyActive: false,
      beams: new Map(),
    });
    if (b.satId === null) throw new Error("expected the Act-1 GEO to bridge");
    expect(b.satPath).toEqual(["GEO"]);
    expect(b.landingPipe).toBe(b.pipe);
  });
});
