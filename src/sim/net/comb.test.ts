import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { coverageComb, NET_COMB_SAMPLES } from "./comb";
import { NET_ACT1_REGION, NET_ACT1_GROUND } from "./endpoint";
import { GEO_PARK_PRESET, LEO_SWEEP_PRESET, type LaunchDraft } from "./world";

/** R1 (SD-45) — the coverage comb: facts-only LoS windows for a draft over a region. */

const eph = Ephemeris.build({});

function draftOf(base: LaunchDraft, subLonRad: number): LaunchDraft {
  return { ...base, subLonRad, loadout: base.loadout.map((a) => ({ ...a })) };
}

describe("R1 — the coverage comb (facts, never verdicts)", () => {
  it("a GEO parked OVER the region combs SOLID (duty 1.0)", () => {
    const c = coverageComb(eph, NET_ACT1_REGION, [NET_ACT1_GROUND], draftOf(GEO_PARK_PRESET.draft, 0), 0);
    expect(c.windows.length).toBe(NET_COMB_SAMPLES);
    expect(c.duty).toBe(1.0);
  });

  it("a GEO parked 90° WEST of the region combs EMPTY (duty 0) — the dead pre-aim reads", () => {
    const c = coverageComb(eph, NET_ACT1_REGION, [NET_ACT1_GROUND], draftOf(GEO_PARK_PRESET.draft, -Math.PI / 2), 0);
    expect(c.duty).toBe(0);
  });

  it("a single sweeping LEO combs STRIPED (0 < duty < 1) — the availability wall by sight", () => {
    const c = coverageComb(
      eph,
      NET_ACT1_REGION,
      [NET_ACT1_GROUND],
      { ...LEO_SWEEP_PRESET.draft, incRad: 0, subLonRad: 0, loadout: LEO_SWEEP_PRESET.draft.loadout.map((a) => ({ ...a })) },
      0,
    );
    expect(c.duty).toBeGreaterThan(0);
    expect(c.duty).toBeLessThan(1);
  });

  it("is deterministic (same inputs, same comb)", () => {
    const a = coverageComb(eph, NET_ACT1_REGION, [NET_ACT1_GROUND], draftOf(GEO_PARK_PRESET.draft, 0.3), 42);
    const b = coverageComb(eph, NET_ACT1_REGION, [NET_ACT1_GROUND], draftOf(GEO_PARK_PRESET.draft, 0.3), 42);
    expect(a).toEqual(b);
  });
});
