import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import {
  NET_ACT1_GROUND,
  NET_ACT2_GROUND,
  NET_ACT1_REGION,
  NET_ACT2_REGION_LAT_RAD,
  NET_ACT2_REGION_LON_RAD,
  type Region,
} from "./endpoint";
import {
  LEO_SWEEP,
  GEO_PARK_PRESET,
  resolveOrbit,
  type LaunchDraft,
} from "./world";
import {
  suggestPhasing,
  phasingLadder,
  NET_PHASING_ASSIST_SHORTFALL,
  NET_PHASING_MIN_CONSTELLATION,
} from "./phasing";
import { windowAvailability } from "./availability";
import { isPointServed, type RoutableContract } from "./router";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import { applyNetAction } from "./apply-action";
import { netLaunch } from "../action";
import { NetSession } from "./session";

/**
 * B2 — THE CONSTELLATION PHASING ASSIST + BATCH LAUNCH (Act 2, design §3.3 / §3.4).
 *
 * The planner ASSISTS (it does not place for you): `suggestPhasing` derives the zero-gap
 * minimum N EMPIRICALLY (probes increasing N against the REAL windowAvailability) and hands
 * back a VIABLE-BUT-IMPERFECT constellation — one short of zero-gap (clamped ≥ 2). Closing the
 * last hand-off gap (the final sat) stays the player's act. A single BATCH launch
 * (`count > 1, phaseSpreadRad = 2π/count`) places N distinct phased sats into one plane; an
 * Act-1 launch (`count = 1, phaseSpread = 0`) is byte-identical to the pre-Act-2 single launch.
 */

const eph = Ephemeris.build({});
const TAU = Math.PI * 2;
// The ground network: equatorial GROUND-0 (REGION-0) + high-lat GROUND-1 (REGION-1). The router
// bridges via the strongest (sat, ground) pair across all grounds; REGION-1 only closes via
// GROUND-1 (the equatorial ground is ~70° away — wider than a LEO can bridge).
const grounds = [NET_ACT1_GROUND, NET_ACT2_GROUND];

// The Act-2 region is HIGH LATITUDE (lat 70°, beyond the GEO's ~64° edge): a single inclined LEO
// sawtooths; an N=4 polar constellation is the measured zero-gap minimum (via the high-lat ground).
const REGION: Region = {
  id: "REGION-1",
  label: "polar metro",
  latRad: NET_ACT2_REGION_LAT_RAD,
  lonRad: NET_ACT2_REGION_LON_RAD,
  radiusRad: NET_ACT1_REGION.radiusRad,
  bodyId: "earth",
};
const centre = { latRad: REGION.latRad, lonRad: REGION.lonRad };
const SLA_AVAIL = 0.99;

/** The availability-active routable contract over the region (the measurement reads this). */
const availContract: RoutableContract = {
  id: REGION.id,
  region: REGION,
  activeAxes: new Set(["connectivity", "availability"]),
};

/** A train of `count` LEO_SWEEP sats evenly m0-phased (the SAME shape the batch applier builds). */
function leoTrain(count: number, t0 = 0): NetSat[] {
  const out: NetSat[] = [];
  const spread = TAU / count;
  for (let i = 0; i < count; i++) {
    const orbit = resolveOrbit(LEO_SWEEP, t0);
    orbit.m0Rad += i * spread;
    out.push({ id: `T-${i}`, orbit, bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) });
  }
  return out;
}

/** The worst-phase rolling availability over a period (the honest held-fraction measure). */
function worstPhaseAvail(sats: NetSat[], t = 0): number {
  let worst = Infinity;
  for (let k = 0; k < 16; k++) {
    const tt = t + (150 * k) / 16;
    const a = windowAvailability(eph, availContract, sats, grounds, tt);
    if (a < worst) worst = a;
  }
  return worst;
}

describe("B2 suggestPhasing — empirically derives the zero-gap N + a viable-but-imperfect assist", () => {
  it("derives zeroGapN === 4 for LEO_SWEEP / REGION-1 (the EMPIRICAL pin — fails loudly if the physics shifts)", () => {
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    expect(s.zeroGapN).toBe(4);
  });

  it("suggests count === 3 (= zeroGapN − shortfall), always ≥ a real constellation (≥ 2)", () => {
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    expect(s.count).toBe(s.zeroGapN - NET_PHASING_ASSIST_SHORTFALL);
    expect(s.count).toBe(3);
    expect(s.count).toBeGreaterThanOrEqual(NET_PHASING_MIN_CONSTELLATION);
    expect(s.basePresetId).toBe("LEO_SWEEP");
  });

  it("the suggestion is VIABLE-BUT-IMPERFECT: estCoveredFraction below slaAvail BUT well above a lone LEO", () => {
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    const lone = worstPhaseAvail(leoTrain(1));
    expect(s.estCoveredFraction).toBeLessThan(SLA_AVAIL); // a real, closable gap (not optimal).
    expect(s.estCoveredFraction).toBeGreaterThan(lone + 0.3); // markedly above a single sat.
    // The closable gap matches the measured N=3 worst-phase rolling availability (~0.69).
    expect(s.estCoveredFraction).toBeCloseTo(worstPhaseAvail(leoTrain(3)), 12);
  });

  it("returns `count` drafts evenly m0-spread by 2π/count into ONE plane (a constellation that hands off)", () => {
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    expect(s.drafts.length).toBe(s.count);
    expect(s.phaseSpreadRad).toBeCloseTo(TAU / s.count, 12);
    // Each draft shares the plane (a / inc) but is offset in sub-longitude by i·phaseSpread.
    for (let i = 0; i < s.drafts.length; i++) {
      const d = s.drafts[i];
      expect(d.semiMajorM).toBe(LEO_SWEEP.semiMajorM);
      expect(d.incRad).toBe(LEO_SWEEP.incRad);
      expect(d.subLonRad).toBeCloseTo(LEO_SWEEP.subLonRad + i * s.phaseSpreadRad, 12);
      expect(d.count).toBe(1);
    }
  });

  it("is PURE: byte-identical for the same (region, preset, slaAvail, t)", () => {
    const a = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    const b = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    expect(b).toEqual(a);
  });
});

describe("B2 the assist set is near-continuous-but-imperfect; ONE more sat reaches continuous", () => {
  it("the suggested N=3 set raises availability far above a lone LEO but stays < slaAvail (the gap to close)", () => {
    const lone = worstPhaseAvail(leoTrain(1));
    const assist = worstPhaseAvail(leoTrain(3));
    expect(assist).toBeGreaterThan(lone + 0.3);
    expect(assist).toBeLessThan(SLA_AVAIL);
    // The assist set is a REAL constellation: at least one sat covers most of the cycle (not ~0).
    expect(assist).toBeGreaterThan(0.5);
  });

  it("adding exactly ONE more sat (→ zeroGapN = 4) crosses slaAvail and holds continuous SERVED", () => {
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    const closed = leoTrain(s.zeroGapN); // = N=4, the player's closing act.
    expect(worstPhaseAvail(closed)).toBeGreaterThanOrEqual(SLA_AVAIL);
    // Continuous SERVED across a full hand-off cycle (no instant gap once the gap is closed).
    const dt = 150 / 200;
    for (let i = 0; i < 200 * 2; i++) {
      expect(isPointServed(eph, centre, grounds, closed, i * dt)).toBe(true);
    }
  });
});

describe("B2 phasingLadder — the coverage-vs-capex curve the player dials the constellation size on", () => {
  it("returns one rung per N across the requested range, each held byte-truthful to an even N-train", () => {
    const ladder = phasingLadder(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds, 2, 6);
    expect(ladder.map((r) => r.n)).toEqual([2, 3, 4, 5, 6]);
    for (const rung of ladder) {
      expect(rung.held).toBeCloseTo(worstPhaseAvail(leoTrain(rung.n)), 12);
      expect(rung.holds).toBe(rung.held >= SLA_AVAIL);
    }
  });

  it("the FIRST holding rung is exactly zeroGapN (the ladder + suggestPhasing agree on the knee)", () => {
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds);
    const ladder = phasingLadder(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds, 2, 8);
    const firstHold = ladder.find((r) => r.holds);
    expect(firstHold?.n).toBe(s.zeroGapN);
    // Below the knee every rung is a real gap; at/above the knee every rung holds (monotone bar-cross).
    for (const r of ladder) expect(r.holds).toBe(r.n >= s.zeroGapN);
  });

  it("held is non-decreasing in N (more evenly-phased sats never lower the worst-phase floor)", () => {
    const ladder = phasingLadder(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds, 2, 7);
    for (let i = 1; i < ladder.length; i++) {
      expect(ladder[i].held).toBeGreaterThanOrEqual(ladder[i - 1].held - 1e-9);
    }
  });

  it("clamps the lower bound to a real constellation (≥ NET_PHASING_MIN_CONSTELLATION)", () => {
    const ladder = phasingLadder(eph, REGION, LEO_SWEEP, SLA_AVAIL, 0, grounds, 1, 3);
    expect(ladder[0].n).toBe(NET_PHASING_MIN_CONSTELLATION);
  });
});

describe("B2 batch launch — count>1 resolves N distinct phased orbits; count=1/spread=0 byte-identical", () => {
  const DT = 0.25; // the net replay dt (seconds per tick).

  function freshSession(): NetSession {
    // An empty-scenario session so the test drives launches directly (no beat side-effects).
    return new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
  }

  it("a batch (count=4, phaseSpreadRad=2π/4) launches 4 sats with DISTINCT, evenly-spaced m0", () => {
    const session = freshSession();
    const atTick = 40;
    const action = netLaunch(
      { presetId: "LEO_SWEEP", semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: LEO_SWEEP.subLonRad, count: 4, phaseSpreadRad: TAU / 4 },
      atTick,
    );
    const res = applyNetAction(eph, session, action, DT);
    expect(res?.kind).toBe("sats_launched");
    expect(res?.satIds?.length).toBe(4);
    expect(session.sats.length).toBe(4);
    // The base orbit at the commit epoch (member 0), then each member is +i·spread in m0.
    const base = resolveOrbit(LEO_SWEEP, atTick * DT);
    const spread = TAU / 4;
    for (let i = 0; i < 4; i++) {
      const o = session.sats[i].orbit;
      expect(o.aM).toBe(base.aM);
      expect(o.incRad).toBe(base.incRad);
      expect(o.m0Rad).toBeCloseTo(base.m0Rad + i * spread, 12);
    }
    // The four m0 are pairwise distinct (a genuine spread, not a stacked plane).
    const m0s = session.sats.map((s) => s.orbit.m0Rad);
    expect(new Set(m0s).size).toBe(4);
  });

  it("count=1, phaseSpread=0 is BYTE-IDENTICAL to the pre-Act-2 single launch (golden guard)", () => {
    const session = freshSession();
    const atTick = 40;
    // The Act-1 single launch (no phaseSpread — default 0).
    const action = netLaunch(
      { presetId: "GEO_PARK", semiMajorM: GEO_PARK_PRESET.draft.semiMajorM, incRad: GEO_PARK_PRESET.draft.incRad, subLonRad: GEO_PARK_PRESET.draft.subLonRad, count: 1 },
      atTick,
    );
    // The default carries no phaseSpreadRad on the wire — the Act-1 dict shape is unchanged.
    expect(action.payload.phaseSpreadRad).toBeUndefined();
    applyNetAction(eph, session, action, DT);
    expect(session.sats.length).toBe(1);
    // The committed orbit is EXACTLY the pre-Act-2 resolveOrbit (no phase term at all).
    const expected = resolveOrbit(GEO_PARK_PRESET.draft, atTick * DT);
    expect(session.sats[0].orbit).toEqual(expected);
  });

  it("an explicit phaseSpreadRad=0 batch (count=3) stacks the plane — identical orbits (the +0 m0 term)", () => {
    const session = freshSession();
    const atTick = 12;
    const action = netLaunch(
      { presetId: "LEO_SWEEP", semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: LEO_SWEEP.subLonRad, count: 3, phaseSpreadRad: 0 },
      atTick,
    );
    applyNetAction(eph, session, action, DT);
    expect(session.sats.length).toBe(3);
    const expected = resolveOrbit(LEO_SWEEP, atTick * DT);
    for (const s of session.sats) expect(s.orbit).toEqual(expected);
  });
});

describe("B2 consequence-truth: the batch applier commits the EXACT orbits suggestPhasing previews", () => {
  it("each suggested draft resolves to the orbit a batch launch commits at the same epoch", () => {
    const atTick = 80;
    const t = atTick * 0.25;
    const s = suggestPhasing(eph, REGION, LEO_SWEEP, SLA_AVAIL, t, grounds);
    // The batch the planner would fire from the suggestion (count + even spread).
    const session = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
    const action = netLaunch(
      { presetId: "LEO_SWEEP", semiMajorM: LEO_SWEEP.semiMajorM, incRad: LEO_SWEEP.incRad, subLonRad: LEO_SWEEP.subLonRad, count: s.count, phaseSpreadRad: s.phaseSpreadRad },
      atTick,
    );
    applyNetAction(eph, session, action, 0.25);
    expect(session.sats.length).toBe(s.count);
    // Each suggested draft, resolved at the commit epoch, equals the committed sat's orbit.
    for (let i = 0; i < s.count; i++) {
      const d: LaunchDraft = s.drafts[i];
      const draftOrbit = resolveOrbit(d, t);
      expect(session.sats[i].orbit.m0Rad).toBeCloseTo(draftOrbit.m0Rad, 12);
      expect(session.sats[i].orbit.aM).toBe(draftOrbit.aM);
      expect(session.sats[i].orbit.incRad).toBe(draftOrbit.incRad);
    }
  });
});
