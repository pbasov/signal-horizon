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
import { horizonReachRad, footprintRadiusRad, previewLaunch, draftToSat, GEO_PARK, LEO_SWEEP, A1_GEO_SEMI_MAJOR_M, A1_BODY_RADIUS_M } from "./world";
import { NET_ACT1_REGION, NET_ACT1_GROUND } from "./endpoint";
import { Ephemeris } from "../ephemeris";
import { solve } from "./router";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

const eph = Ephemeris.build({});

const geoAlt = A1_GEO_SEMI_MAJOR_M - A1_BODY_RADIUS_M;
const leoAlt = LEO_SWEEP.semiMajorM - A1_BODY_RADIUS_M;
const BROADCAST = standardLoadout(NET_REF_LINK_DISTANCE_M);
const ACCESS_S = resolveLoadout(["ACCESS_S"], NET_REF_LINK_DISTANCE_M);
const CONE_30 = antennaCardById("ACCESS_S")!.coneHalfAngleRad;

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

  it("BROADCAST reads the horizon cap; a spot beam reads its cone clipped by the horizon", () => {
    expect(footprintRadiusRad(BROADCAST, geoAlt)).toBeCloseTo(horizonReachRad(geoAlt), 12);
    // GEO: the 30° cone is INSIDE the GEO horizon cap ⇒ the cone is the footprint.
    expect(footprintRadiusRad(ACCESS_S, geoAlt)).toBeCloseTo(CONE_30, 12);
    // LEO: the horizon cap is tighter than the cone ⇒ the horizon clips it.
    if (horizonReachRad(leoAlt) < CONE_30) {
      expect(footprintRadiusRad(ACCESS_S, leoAlt)).toBeCloseTo(horizonReachRad(leoAlt), 12);
    } else {
      expect(footprintRadiusRad(ACCESS_S, leoAlt)).toBeCloseTo(CONE_30, 12);
    }
    // an ACCESS fit NEVER out-promises a BROADCAST fit at the same altitude.
    expect(footprintRadiusRad(ACCESS_S, geoAlt)).toBeLessThanOrEqual(footprintRadiusRad(BROADCAST, geoAlt));
    expect(footprintRadiusRad(ACCESS_S, leoAlt)).toBeLessThanOrEqual(footprintRadiusRad(BROADCAST, leoAlt));
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
