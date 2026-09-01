/**
 * FL-05 — the antenna-truthful footprint preview (SD-46). The draft disc on the globe
 * used to be sized off the REGION radius (a fiction); it is now sized off the DRAFTED
 * ANTENNAS: BROADCAST reads the full LoS horizon cap at the elevation floor (the gate the
 * link budget actually enforces), spot beams read their cone clipped by the horizon, and
 * higher altitude always reaches MORE sky (strictly monotone). Also: the consequence-truth
 * invariant extended to a comsat + ACCESS draft — preview == post-commit solve.
 */

import { describe, it, expect } from "vitest";
import { standardLoadout, resolveLoadout, antennaCardById, suggestLoadout, validateLoadout } from "./sat";
import { horizonReachRad, coneReachRad, footprintRadiusRad, previewLaunch, draftToSat, timeToServiceS, GEO_PARK, LEO_SWEEP, A1_GEO_SEMI_MAJOR_M, A1_BODY_RADIUS_M, A1_LEO_PERIOD_S } from "./world";
import { NET_ACT1_REGION, NET_ACT1_GROUND } from "./endpoint";
import { Ephemeris } from "../ephemeris";
import { solve } from "./router";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

const eph = Ephemeris.build({});

const geoAlt = A1_GEO_SEMI_MAJOR_M - A1_BODY_RADIUS_M;
const leoAlt = LEO_SWEEP.semiMajorM - A1_BODY_RADIUS_M;
const BROADCAST = standardLoadout(NET_REF_LINK_DISTANCE_M);
const ACCESS_S = resolveLoadout(["ACCESS_S"], NET_REF_LINK_DISTANCE_M);
const CONE_ACCESS_S = antennaCardById("ACCESS_S")!.coneHalfAngleRad;
const CONE_BROADCAST = antennaCardById("BROADCAST")!.coneHalfAngleRad;

describe("FL-05 — horizonReachRad / footprintRadiusRad", () => {
  it("the horizon cap grows monotonically with altitude (GEO reaches more sky than LEO)", () => {
    expect(horizonReachRad(geoAlt)).toBeGreaterThan(horizonReachRad(leoAlt));
    expect(horizonReachRad(geoAlt)).toBeLessThanOrEqual(Math.PI / 2);
    let prev = -Infinity;
    for (let alt = 20_000; alt <= geoAlt; alt += 25_000) {
      const h = horizonReachRad(alt);
      expect(h).toBeGreaterThan(prev);
      prev = h;
    }
  });

  it("a beam's footprint is its cone PROJECTED to the surface, clipped by the horizon", () => {
    // A cone half-angle is an angle at the SATELLITE; a footprint is a central angle at the
    // BODY. The two are different numbers, and conflating them is what made a "spot beam"
    // paint a third of the planet. coneReachRad does the projection; the horizon still caps.
    // Even the floodlight is cone-limited now — that is the whole point of the re-scale.
    const wide = footprintRadiusRad(BROADCAST, geoAlt);
    expect(wide).toBeCloseTo(coneReachRad(CONE_BROADCAST, geoAlt), 12);
    expect(wide).toBeLessThan(horizonReachRad(geoAlt));

    // A narrow spot beam is cone-limited well inside the horizon, and its footprint is the
    // PROJECTED angle — strictly larger than the raw cone, and nothing like the horizon cap.
    expect(footprintRadiusRad(ACCESS_S, geoAlt)).toBeCloseTo(coneReachRad(CONE_ACCESS_S, geoAlt), 12);
    expect(footprintRadiusRad(ACCESS_S, geoAlt)).toBeLessThan(horizonReachRad(geoAlt));
    expect(footprintRadiusRad(ACCESS_S, leoAlt)).toBeCloseTo(coneReachRad(CONE_ACCESS_S, leoAlt), 12);

    // THE ALTITUDE LEVER: the same antenna paints more ground from higher up.
    expect(footprintRadiusRad(ACCESS_S, geoAlt)).toBeGreaterThan(footprintRadiusRad(ACCESS_S, leoAlt));

    // an ACCESS fit NEVER out-promises a BROADCAST fit at the same altitude.
    expect(footprintRadiusRad(ACCESS_S, geoAlt)).toBeLessThanOrEqual(footprintRadiusRad(BROADCAST, geoAlt));
    expect(footprintRadiusRad(ACCESS_S, leoAlt)).toBeLessThanOrEqual(footprintRadiusRad(BROADCAST, leoAlt));
  });

  it("coneReachRad projects the cone onto the ball and saturates past the limb", () => {
    // Monotone in altitude, and a cone that over-reaches the limb reports the 90° saturation
    // the caller mins against the horizon (never a NaN from asin out of domain).
    let prev = -Infinity;
    for (let alt = 20_000; alt <= geoAlt; alt += 25_000) {
      const r = coneReachRad(CONE_ACCESS_S, alt);
      expect(Number.isFinite(r)).toBe(true);
      expect(r).toBeGreaterThan(prev);
      prev = r;
    }
    // A cone wide enough to over-reach the limb reports the 90° saturation the caller mins
    // against the horizon (never a NaN out of asin's domain).
    expect(coneReachRad(50 * (Math.PI / 180), geoAlt)).toBe(Math.PI / 2);
    expect(coneReachRad(0, geoAlt)).toBe(0);
  });

  it("an S-only relay fit has no surface footprint promise (horizon-capped, drawn elsewhere)", () => {
    const relay = resolveLoadout(["CROSSLINK"], NET_REF_LINK_DISTANCE_M);
    expect(footprintRadiusRad(relay, geoAlt)).toBeCloseTo(horizonReachRad(geoAlt), 12);
  });
});

describe("FL-05 — consequence truth extended: comsat + ACCESS draft", () => {
  it("preview == post-commit solve for a non-smallsat, non-BROADCAST design", () => {
    const t = 3600;
    const draft = {
      semiMajorM: GEO_PARK.semiMajorM,
      incRad: 0,
      subLonRad: NET_ACT1_REGION.lonRad,
      bus: "comsat" as const,
      loadout: resolveLoadout(["ACCESS_S", "ACCESS_S"], NET_REF_LINK_DISTANCE_M),
      count: 1,
    };
    const preview = previewLaunch(eph, { contracts: [{ id: "REGION-0", region: NET_ACT1_REGION }], grounds: [NET_ACT1_GROUND] }, draft, t);
    const sat = draftToSat(draft, t);
    expect(sat.bus).toBe("comsat");
    expect(sat.loadout.map((a) => a.cardId)).toEqual(["ACCESS_S", "ACCESS_S"]);
    // The post-commit truth: would-be sat alone, same router.
    const post = solve(eph, { id: "REGION-0", region: NET_ACT1_REGION }, [sat], [NET_ACT1_GROUND], t);
    const slice = preview.contracts.find((c) => c.contractId === "REGION-0")!;
    expect(slice.served).toBe(post.served);
    expect(slice.latencyFloorS).toBe(post.latencyS);
    expect(slice.bindingConstraint).toBe(post.bindingConstraint);
  });
});

// ── FL-06 — suggestLoadout: viable, NEVER optimal (the locked planner rule) ────────
describe("FL-06 — suggestLoadout: greedy legality, never the answer", () => {
  it("always validates on every bus", () => {
    for (const bus of ["smallsat", "comsat"] as const) {
      for (const needs of [
        { latency: false, bandwidth: false },
        { latency: true, bandwidth: false },
        { latency: false, bandwidth: true },
        { latency: true, bandwidth: true },
      ]) {
        expect(validateLoadout(bus, suggestLoadout(bus, needs))).toBeNull();
      }
    }
  });

  it("a latency-active SLA ⇒ includes a spot beam (BROADCAST can never carry latency)", () => {
    const fit = suggestLoadout("smallsat", { latency: true, bandwidth: false });
    expect(fit).toContain("ACCESS_S");
    expect(fit).not.toContain("BROADCAST");
  });

  it("connectivity-only ⇒ the standard floodlight (the simplest legal fit)", () => {
    expect(suggestLoadout("comsat", { latency: false, bandwidth: false })).toEqual(["BROADCAST"]);
  });

  it("never returns GATEWAY (headroom past ACCESS-L is the player's ceiling, not the assist)", () => {
    for (const needs of [
      { latency: false, bandwidth: true },
      { latency: true, bandwidth: true },
    ]) {
      expect(suggestLoadout("comsat", needs)).not.toContain("GATEWAY");
    }
    // and it never fills more than ONE slot — the rest are the player's to design.
    expect(suggestLoadout("comsat", { latency: true, bandwidth: true }).length).toBe(1);
  });
});

// ── FL-12 — timeToServiceS: when the draft first serves ────────────────────────────
describe("FL-12 — timeToServiceS", () => {
  const grounds = [NET_ACT1_GROUND];
  const centre = { latRad: NET_ACT1_REGION.latRad, lonRad: NET_ACT1_REGION.lonRad };

  it("a parked GEO over the region serves NOW (0 s)", () => {
    const draft = { semiMajorM: GEO_PARK.semiMajorM, incRad: 0, subLonRad: 0, loadout: BROADCAST, count: 1 };
    expect(timeToServiceS(eph, draft, centre, grounds, 0, 600)).toBe(0);
  });

  it("a mis-aimed GEO NEVER serves inside the horizon (Infinity)", () => {
    const draft = { semiMajorM: GEO_PARK.semiMajorM, incRad: 0, subLonRad: Math.PI / 2, loadout: BROADCAST, count: 1 };
    expect(timeToServiceS(eph, draft, centre, grounds, 0, 600)).toBe(Infinity);
  });

  it("a LEO aimed AT the region serves within one orbit; one aimed away does not (the wall)", () => {
    // Aimed at it: the pass arrives and the beam paints the region — motion is the answer.
    const onTarget = { semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: 0, loadout: BROADCAST, count: 1 };
    const hit = timeToServiceS(eph, onTarget, centre, grounds, 0, A1_LEO_PERIOD_S, 1);
    expect(hit).toBeGreaterThanOrEqual(0);
    expect(hit).toBeLessThanOrEqual(A1_LEO_PERIOD_S);

    // Aimed a third of the way around the world, it simply never paints this region on this
    // orbit. Before the re-scale a single beam covered so much sky that almost any aim
    // "worked" eventually; now WHERE you put it is the decision, which is the wall act 2 is
    // built on — and the reason a lone bird cannot hold a region at all.
    const offTarget = { semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: Math.PI / 3, loadout: BROADCAST, count: 1 };
    expect(timeToServiceS(eph, offTarget, centre, grounds, 0, A1_LEO_PERIOD_S, 2)).toBe(Infinity);
  });
});
