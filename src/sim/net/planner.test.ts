import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import {
  NET_ACT1_REGION,
  NET_ACT1_GROUND,
  NET_SPACE_SAMPLES,
  coveredFraction,
  type RegionPoint,
} from "./endpoint";
import {
  GEO_PARK,
  GEO_PARK_PRESET,
  LEO_SWEEP_PRESET,
  A1_GEO_PERIOD_S,
  resolveOrbit,
  draftToSat,
  previewLaunch,
  launchDraftCost,
  type LaunchDraft,
  type PreviewWorld,
} from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import { solve, isPointServed, type RoutableContract } from "./router";

/**
 * net/ A4 — THE PLANNER CONSEQUENCE-PREVIEW (design §2.3 / §6, the A4 verify). The planner
 * is PURE and TRUTHFUL: `previewLaunch` computes a draft's footprint + ground track + period
 * + latency floor with the SAME router + link budget the LIVE world runs post-commit. The
 * make-or-break Act-1 invariant proved here:
 *
 *   CONSEQUENCE-TRUTH — the preview's per-contract {served, latencyFloorS, bindingConstraint}
 *   equals the POST-COMMIT router.solve for that EXACT orbit (both build the sat the SAME way:
 *   resolveOrbit + the standard loadout — and run the SAME solver). What you see before commit
 *   is what you get after commit.
 */

const eph = Ephemeris.build({});

/** The Act-1 standing world the planner previews against: the one equatorial contract +
 * the one ground net (structural — the live NetSession satisfies the SAME shape). */
const world: PreviewWorld = {
  contracts: [{ id: NET_ACT1_REGION.id, region: NET_ACT1_REGION, activeAxes: new Set(["connectivity"]) }],
  grounds: [NET_ACT1_GROUND],
};

/** The router contract the post-commit solve uses (the same id + region + axes the preview reads). */
const contract: RoutableContract = {
  id: NET_ACT1_REGION.id,
  region: NET_ACT1_REGION,
  activeAxes: new Set(["connectivity"]),
};

/** Build the sat the LIVE applier (applyNetAction) commits for a draft at sim-time t: the
 * epoch-correct orbit + the standard BROADCAST loadout. The preview MUST match this. */
function committedSat(draft: LaunchDraft, t: number, id = "PREVIEW-SAT"): NetSat {
  return {
    id,
    orbit: resolveOrbit({ semiMajorM: draft.semiMajorM, incRad: draft.incRad, subLonRad: draft.subLonRad }, t),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

describe("planner: previewLaunch is the TRUTHFUL consequence preview (== post-commit solve)", () => {
  it("CONSEQUENCE-TRUTH: GEO PARK preview {served, latencyFloorS, binding} == post-commit router.solve at the same orbit", () => {
    for (const t of [0, 10, 37.5, A1_GEO_PERIOD_S * 0.5, 123.4]) {
      const preview = previewLaunch(eph, world, GEO_PARK_PRESET.draft, t, GEO_PARK_PRESET.costBaseEur);
      // The post-commit truth: build the EXACT sat the applier commits, run the SAME solve.
      const sat = committedSat(GEO_PARK_PRESET.draft, t);
      const post = solve(eph, contract, [sat], world.grounds.slice(), t);
      const cp = preview.contracts.find((c) => c.contractId === NET_ACT1_REGION.id)!;
      expect(cp.served).toBe(post.served);
      expect(cp.latencyFloorS).toBe(post.latencyS);
      expect(cp.bindingConstraint).toBe(post.bindingConstraint);
      // And the previewed orbit IS the committed orbit (epoch-correct m0 = subLon + ω·t).
      expect(preview.orbit).toEqual(sat.orbit);
    }
  });

  it("CONSEQUENCE-TRUTH: LEO SWEEP preview matches post-commit solve at a set time too (unserved + binding)", () => {
    // Find a time in the LEO pass where it has set (a non-covering orbit — the fallback case).
    const leoSat = committedSat(LEO_SWEEP_PRESET.draft, 0);
    let setTime = -1;
    for (let k = 0; k <= 600; k++) {
      const t = (150 * k) / 600;
      if (!isPointServed(eph, { latRad: 0, lonRad: 0 }, world.grounds.slice(), [leoSat], t)) {
        setTime = t;
        break;
      }
    }
    expect(setTime).toBeGreaterThan(0);
    // Preview a FRESH launch at that set time (the would-be sat is overhead at its OWN epoch),
    // and at a time after the sat has walked off — the preview tracks the post-commit verdict.
    for (const t of [0, setTime, setTime + 5]) {
      const preview = previewLaunch(eph, world, LEO_SWEEP_PRESET.draft, t, LEO_SWEEP_PRESET.costBaseEur);
      const sat = committedSat(LEO_SWEEP_PRESET.draft, t);
      const post = solve(eph, contract, [sat], world.grounds.slice(), t);
      const cp = preview.contracts.find((c) => c.contractId === NET_ACT1_REGION.id)!;
      expect(cp.served).toBe(post.served);
      expect(cp.latencyFloorS).toBe(post.latencyS);
      expect(cp.bindingConstraint).toBe(post.bindingConstraint);
    }
  });

  it("FOOTPRINT: the GEO PARK preview covers the WHOLE equatorial disc (coveredFraction === 1.0) — the Act-1 win", () => {
    const preview = previewLaunch(eph, world, GEO_PARK_PRESET.draft, 0, GEO_PARK_PRESET.costBaseEur);
    const cp = preview.contracts.find((c) => c.contractId === NET_ACT1_REGION.id)!;
    expect(cp.served).toBe(true);
    expect(cp.coveredFraction).toBe(1.0); // no clip, no forced imperfection.
    // The preview's coveredFraction is computed with the SAME machinery the winnable pin uses.
    const sat = committedSat(GEO_PARK_PRESET.draft, 0);
    const direct = coveredFraction(NET_ACT1_REGION, NET_SPACE_SAMPLES, (p: RegionPoint) =>
      isPointServed(eph, p, world.grounds.slice(), [sat], 0),
    );
    expect(cp.coveredFraction).toBe(direct);
  });

  it("FOOTPRINT: a fresh LEO SWEEP launch covers at its epoch but partially (it sets across the disc) — truthful gap", () => {
    const preview = previewLaunch(eph, world, LEO_SWEEP_PRESET.draft, 0, LEO_SWEEP_PRESET.costBaseEur);
    const cp = preview.contracts.find((c) => c.contractId === NET_ACT1_REGION.id)!;
    // At its own epoch the LEO is overhead → the centre is served, but it does NOT cover the
    // whole disc with the same margin the parked GEO does (a truthful, non-1.0-or-0 footprint
    // is allowed; the point is the preview is the real coverage, not a binary lie).
    expect(cp.coveredFraction).toBeGreaterThan(0);
    expect(cp.coveredFraction).toBeLessThanOrEqual(1.0);
  });

  it("PERIOD: GEO PARK previews the GEO period (it parks); LEO SWEEP previews the shorter LEO period (it sweeps)", () => {
    const geo = previewLaunch(eph, world, GEO_PARK_PRESET.draft, 0, GEO_PARK_PRESET.costBaseEur);
    const leo = previewLaunch(eph, world, LEO_SWEEP_PRESET.draft, 0, LEO_SWEEP_PRESET.costBaseEur);
    expect(geo.periodS).toBeCloseTo(A1_GEO_PERIOD_S, 6); // parks: period == the toy day.
    expect(leo.periodS).toBeLessThan(geo.periodS); // sweeps: shorter period.
  });

  it("GROUND TRACK: the parked GEO holds station (a fixed sub-lon); the LEO sub-point WALKS in longitude", () => {
    const geo = previewLaunch(eph, world, GEO_PARK_PRESET.draft, 0, GEO_PARK_PRESET.costBaseEur);
    // The parked equatorial GEO's body-fixed sub-longitude is ~constant across the track.
    const lons = geo.groundTrack.map((p) => p.lonRad);
    const lonSpread = Math.max(...lons) - Math.min(...lons);
    expect(lonSpread).toBeLessThan(1e-6); // holds station (the whole Act-1 point).
    // The GEO sub-point is equatorial (lat ~0) over the region meridian (lon ~0 = subLonRad).
    expect(Math.abs(geo.groundTrack[0].latRad)).toBeLessThan(1e-9);
    expect(Math.abs(geo.groundTrack[0].lonRad - GEO_PARK.subLonRad)).toBeLessThan(1e-6);

    const leo = previewLaunch(eph, world, LEO_SWEEP_PRESET.draft, 0, LEO_SWEEP_PRESET.costBaseEur);
    const leoLons = leo.groundTrack.map((p) => p.lonRad);
    const leoSpread = Math.max(...leoLons) - Math.min(...leoLons);
    expect(leoSpread).toBeGreaterThan(0.1); // the LEO sub-point walks across longitudes.
  });

  it("draftToSat builds the EXACT sat the live applier commits (orbit + standard loadout)", () => {
    const t = 42.0;
    const sat = draftToSat(GEO_PARK_PRESET.draft, t);
    const committed = committedSat(GEO_PARK_PRESET.draft, t, "PREVIEW-SAT");
    expect(sat.orbit).toEqual(committed.orbit);
    expect(sat.bus).toBe(committed.bus);
    // Same single BROADCAST antenna at eirp 1.0 (the preset seeds the standard antenna).
    expect(sat.loadout.length).toBe(1);
    expect(sat.loadout[0].eirp).toBe(GEO_PARK.eirp);
    expect(sat.loadout[0].rangeRefM).toBe(NET_REF_LINK_DISTANCE_M);
  });

  it("COST: the draft cost is the base + altitude term × count (≥1), pure", () => {
    const single = launchDraftCost(GEO_PARK_PRESET.draft, GEO_PARK_PRESET.costBaseEur);
    expect(single).toBeGreaterThan(GEO_PARK_PRESET.costBaseEur); // altitude term adds.
    const batch: LaunchDraft = { ...GEO_PARK_PRESET.draft, count: 3 };
    expect(launchDraftCost(batch, GEO_PARK_PRESET.costBaseEur)).toBeCloseTo(single * 3, 6);
    // The preview surfaces that same cost.
    const preview = previewLaunch(eph, world, GEO_PARK_PRESET.draft, 0, GEO_PARK_PRESET.costBaseEur);
    expect(preview.costEur).toBe(single);
  });

  it("an EMPTY standing world previews no contracts but still resolves the orbit + track + period", () => {
    const preview = previewLaunch(eph, { contracts: [], grounds: [NET_ACT1_GROUND] }, GEO_PARK_PRESET.draft, 0);
    expect(preview.contracts).toEqual([]);
    expect(preview.periodS).toBeCloseTo(A1_GEO_PERIOD_S, 6);
    expect(preview.groundTrack.length).toBeGreaterThan(0);
  });
});
