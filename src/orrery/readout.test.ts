import { describe, it, expect } from "vitest";
import {
  deriveReadout,
  conjunctionApproach,
  freshnessBand,
  CONJUNCTION_WATCH_RSUN,
  CONJUNCTION_CRIT_RSUN,
} from "./readout";
import type { FrameState, DemandReadout } from "../types";

/**
 * M1-10 — the glanceable readout derivation. PURE, so it is pinned here without
 * any DOM: freshness banding, the conjunction-approach ramp (the predictable-
 * blackout lead cue), and the FrameState → Readout projection.
 */

const demand = (over: Partial<DemandReadout> = {}): DemandReadout => ({
  outcome: "fresh",
  viaCache: true,
  cacheFreshness: 0.8,
  fetchInFlight: false,
  fetchCountdownSeconds: null,
  blackout: false,
  balance: 1000,
  revenueRatePerSecond: 5,
  opexRatePerSecond: 2,
  netRatePerSecond: 3,
  runway: Infinity,
  bankrupt: false,
  servedAgeSeconds: 0,
  freshnessPremium: 600,
  ...over,
});

const frame = (over: Partial<FrameState> = {}): FrameState => ({
  simSeconds: 0,
  scaleLabel: "1×",
  paused: false,
  wmPreset: "OVERVIEW",
  cameraPreset: "SYSTEM",
  focusBody: "sun",
  earthMarsDistanceM: 2.5e11,
  oneWaySeconds: 800,
  losMarginSolarRadii: 50,
  losOcculted: false,
  packet: null,
  demand: demand(),
  ...over,
});

describe("freshnessBand — the redundant colour-off channel", () => {
  it("bands fresh ≥0.5, stale in (0,0.5), empty at 0", () => {
    expect(freshnessBand(0.84)).toBe("fresh");
    expect(freshnessBand(0.5)).toBe("fresh");
    expect(freshnessBand(0.49)).toBe("stale");
    expect(freshnessBand(0.01)).toBe("stale");
    expect(freshnessBand(0)).toBe("empty");
  });
});

describe("conjunctionApproach — see the blackout coming (GDD §4.3a)", () => {
  it("is 0 when the margin is wider than the watch band", () => {
    expect(conjunctionApproach(CONJUNCTION_WATCH_RSUN + 1, false)).toBe(0);
    expect(conjunctionApproach(50, false)).toBe(0);
  });

  it("is 1 at/inside the crit band and when occulted", () => {
    expect(conjunctionApproach(CONJUNCTION_CRIT_RSUN, false)).toBe(1);
    expect(conjunctionApproach(0.5, false)).toBe(1);
    expect(conjunctionApproach(50, true)).toBe(1); // occult clamps to full
  });

  it("ramps monotonically up as the margin tightens through the watch→crit band", () => {
    const mid = (CONJUNCTION_WATCH_RSUN + CONJUNCTION_CRIT_RSUN) / 2;
    const a = conjunctionApproach(CONJUNCTION_WATCH_RSUN - 0.01, false);
    const b = conjunctionApproach(mid, false);
    const c = conjunctionApproach(CONJUNCTION_CRIT_RSUN + 0.01, false);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(1);
    expect(b).toBeCloseTo(0.5, 5);
  });

  it("treats a non-finite (no-occluder) margin as wide open", () => {
    expect(conjunctionApproach(Infinity, false)).toBe(0);
  });
});

describe("deriveReadout — FrameState projection", () => {
  it("projects freshness %, band, and clamps freshness to [0,1]", () => {
    const r = deriveReadout(frame({ demand: demand({ cacheFreshness: 0.84 }) }));
    expect(r.freshness).toBeCloseTo(0.84, 5);
    expect(r.freshnessPct).toBe(84);
    expect(r.band).toBe("fresh");

    const clamped = deriveReadout(frame({ demand: demand({ cacheFreshness: 1.7 }) }));
    expect(clamped.freshness).toBe(1);
    expect(clamped.freshnessPct).toBe(100);
  });

  it("surfaces the countdown only while a fetch is in flight", () => {
    const flying = deriveReadout(
      frame({ demand: demand({ fetchInFlight: true, fetchCountdownSeconds: 320 }) }),
    );
    expect(flying.countdownSeconds).toBe(320);

    const idle = deriveReadout(frame({ demand: demand({ fetchInFlight: false, fetchCountdownSeconds: null }) }));
    expect(idle.countdownSeconds).toBeNull();
  });

  it("carries the blackout flag and the live conjunction approach + alarm", () => {
    const occ = deriveReadout(
      frame({ losOcculted: true, losMarginSolarRadii: 0.4, demand: demand({ blackout: true, outcome: "blackout_miss" }) }),
    );
    expect(occ.blackout).toBe(true);
    expect(occ.occulted).toBe(true);
    expect(occ.approach).toBe(1);
    expect(occ.approachAlarm).toBe(true);

    const open = deriveReadout(frame({ losMarginSolarRadii: 50, losOcculted: false }));
    expect(open.approach).toBe(0);
    expect(open.approachAlarm).toBe(false);
  });
});
