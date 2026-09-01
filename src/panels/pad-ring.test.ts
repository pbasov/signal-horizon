/**
 * THE RING MODEL — the pad's claim about live state, made checkable.
 *
 * The instrument tells the player "there is a 120° hole at 80°, drop the replacement there".
 * That is a factual claim about the fleet actually in orbit, so it gets tested like sim math
 * rather than eyeballed in a screenshot.
 */

import { describe, it, expect } from "vitest";
import type { SatOrbit } from "../sim/m2/roster";
import { EARTH_MU } from "../sim/m2/launch";
import { A1_GEO_SEMI_MAJOR_M, A1_LEO_SEMI_MAJOR_M } from "../sim/net/world";
import { ringState, sameRing, widestGap, phaseDegAt, RING_ANGLE_TOLERANCE_DEG } from "./pad-ring";

const DEG = Math.PI / 180;

function orbit(opts: Partial<SatOrbit> & { m0Rad: number }): SatOrbit {
  return {
    parentId: "earth",
    aM: A1_GEO_SEMI_MAJOR_M,
    e: 0,
    incRad: 60 * DEG,
    raanRad: 0,
    argpRad: 0,
    epochS: 0,
    muParent: EARTH_MU,
    ...opts,
  };
}

const draft = { semiMajorM: A1_GEO_SEMI_MAJOR_M, incRad: 60 * DEG, raanRad: 0 };

describe("sameRing — what counts as the orbit you are aiming into", () => {
  it("accepts an identical orbit at any phase", () => {
    expect(sameRing(orbit({ m0Rad: 0 }), draft)).toBe(true);
    expect(sameRing(orbit({ m0Rad: 3 }), draft)).toBe(true);
  });

  it("rejects a different ALTITUDE", () => {
    expect(sameRing(orbit({ m0Rad: 0, aM: A1_LEO_SEMI_MAJOR_M }), draft)).toBe(false);
  });

  it("rejects a different INCLINATION", () => {
    expect(sameRing(orbit({ m0Rad: 0, incRad: 0 }), draft)).toBe(false);
  });

  it("rejects a different RAAN — same tilt in a different plane is NOT the same ring", () => {
    // The defect this pins: two satellites can share altitude and inclination and still fly
    // planes that merely cross. Counting them as one ring invents a hole that is not there
    // and hides one that is.
    expect(sameRing(orbit({ m0Rad: 0, raanRad: 90 * DEG }), draft)).toBe(false);
    expect(sameRing(orbit({ m0Rad: 0, raanRad: 30 * DEG }), draft)).toBe(false);
  });

  it("tolerates a hair of drift (a circularised underburn is still a ring member)", () => {
    const nudge = (RING_ANGLE_TOLERANCE_DEG - 1) * DEG;
    expect(sameRing(orbit({ m0Rad: 0, incRad: 60 * DEG + nudge }), draft)).toBe(true);
    expect(sameRing(orbit({ m0Rad: 0, aM: A1_GEO_SEMI_MAJOR_M * 1.02 }), draft)).toBe(true);
  });
});

describe("widestGap — where the hole is", () => {
  it("an empty ring is all hole", () => {
    expect(widestGap([]).gapDeg).toBe(360);
  });

  it("one satellite leaves a 360° hole centred opposite it", () => {
    const g = widestGap([0]);
    expect(g.gapDeg).toBe(360);
    expect(g.centreDeg).toBeCloseTo(180, 9);
  });

  it("two satellites 180° apart leave two 180° gaps", () => {
    expect(widestGap([0, 180]).gapDeg).toBeCloseTo(180, 9);
  });

  it("an evenly spaced ring of N leaves 360/N", () => {
    for (const n of [3, 4, 9]) {
      const phases = Array.from({ length: n }, (_, i) => (i * 360) / n);
      expect(widestGap(phases).gapDeg).toBeCloseTo(360 / n, 9);
    }
  });

  it("finds the ACTUAL hole in an uneven ring, and centres the wedge on it", () => {
    // A nine-slot ring that lost the members at 80° and 120° — the canonical attrition case.
    const phases = [0, 40, 160, 200, 240, 280, 320];
    const g = widestGap(phases);
    expect(g.gapDeg).toBeCloseTo(120, 9); // 40 → 160
    expect(g.centreDeg).toBeCloseTo(100, 9);
  });

  it("wraps around 0° (the hole is allowed to straddle the seam)", () => {
    const g = widestGap([10, 60, 110]);
    expect(g.gapDeg).toBeCloseTo(260, 9); // 110 → 370
    expect(g.centreDeg).toBeCloseTo(240, 9);
  });
});

describe("phaseDegAt — position along the ring, propagated to now", () => {
  it("is m0 at the epoch, normalised into [0,360)", () => {
    expect(phaseDegAt(orbit({ m0Rad: 0 }), 0)).toBeCloseTo(0, 9);
    expect(phaseDegAt(orbit({ m0Rad: Math.PI }), 0)).toBeCloseTo(180, 9);
    expect(phaseDegAt(orbit({ m0Rad: -Math.PI / 2 }), 0)).toBeCloseTo(270, 9);
  });

  it("advances by a full turn over one period, and is stable across epochs", () => {
    const o = orbit({ m0Rad: 0 });
    const period = 240; // the GEO-class period this altitude flies
    expect(phaseDegAt(o, period)).toBeCloseTo(phaseDegAt(o, 0), 6);
    // A satellite launched LATER with a matching m0 sits where the first one was at ITS epoch.
    const later = orbit({ m0Rad: 0, epochS: 1000 });
    expect(phaseDegAt(later, 1000)).toBeCloseTo(phaseDegAt(o, 0), 9);
  });
});

describe("ringState — the whole instrument reading", () => {
  const members = (phases: number[], epochS = 0) =>
    phases.map((p, i) => ({ id: `S${i}`, orbit: orbit({ m0Rad: p * DEG, epochS }) }));

  it("counts only the fleet ON this ring, and reports the hole between them", () => {
    const fleet = [
      ...members([0, 180]),
      // a decoy in a DIFFERENT plane — must not be counted, and must not close the hole
      { id: "OTHER", orbit: orbit({ m0Rad: 90 * DEG, raanRad: 90 * DEG }) },
    ];
    const s = ringState(draft, fleet, [], 0, 0);
    expect(s.members.filter((m) => !m.draft).map((m) => m.id)).toEqual(["S0", "S1"]);
    expect(s.gapDeg).toBeCloseTo(180, 9);
    expect(s.empty).toBe(false);
  });

  it("an empty ring reports empty, and the draft does not pretend otherwise", () => {
    const s = ringState(draft, [], members([0, 180]), 0, 2);
    expect(s.empty).toBe(true);
    expect(s.members.every((m) => m.draft)).toBe(true);
  });

  it("THE POINT OF THE INSTRUMENT: a replacement dropped in the hole closes it", () => {
    // Seven of nine slots flying; 80° and 120° are missing (a 120° hole).
    const fleet = members([0, 40, 160, 200, 240, 280, 320]);
    const before = ringState(draft, fleet, [], 0, 0);
    expect(before.gapDeg).toBeCloseTo(120, 9);

    // Aim the pair straight into it.
    const filled = ringState(draft, fleet, members([80, 120]), 0, 2);
    expect(filled.gapDeg).toBeCloseTo(120, 9); // the hole you are aiming INTO is unchanged...
    expect(filled.gapAfterDeg).toBeCloseTo(40, 9); // ...and committing closes it to one slot.

    // Aim them somewhere useless and the launch does NOT close the hole — the instrument has
    // to be able to say "that did not help", or it is decoration.
    const wasted = ringState(draft, fleet, members([10, 20]), 0, 2);
    expect(wasted.gapAfterDeg).toBeCloseTo(120, 9);
  });

  it("a draft in a DIFFERENT plane never closes this ring's hole", () => {
    const fleet = members([0, 40, 160, 200, 240, 280, 320]);
    const offPlane = [
      { id: "D0", orbit: orbit({ m0Rad: 80 * DEG, raanRad: 90 * DEG }) },
      { id: "D1", orbit: orbit({ m0Rad: 120 * DEG, raanRad: 90 * DEG }) },
    ];
    // The draft members are drawn (they are what this launch flies) but the fleet hole stands.
    const s = ringState(draft, fleet, offPlane, 0, 2);
    expect(s.gapDeg).toBeCloseTo(120, 9);
  });

  it("is live: the whole ring turns with time, and the gap SIZE is invariant", () => {
    const fleet = members([0, 40, 160, 200, 240, 280, 320]);
    const at0 = ringState(draft, fleet, [], 0, 0);
    const at60 = ringState(draft, fleet, [], 60, 0);
    expect(at60.gapDeg).toBeCloseTo(at0.gapDeg, 6);
    // ...but the hole has MOVED, because the constellation has moved.
    expect(at60.gapCentreDeg).not.toBeCloseTo(at0.gapCentreDeg, 3);
  });
});
