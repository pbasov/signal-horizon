import { describe, it, expect } from "vitest";
import {
  deriveReadout,
  conjunctionApproach,
  freshnessBand,
  feedGlyphState,
  feedLabel,
  policyLabel,
  CONJUNCTION_WATCH_FACTOR,
} from "./readout";
import { SOLAR_CORRIDOR_RSUN } from "../sim/links";
import type { FrameState, DemandReadout, FeedReadout } from "../types";

/** The corridor threshold the live readout keys off (the default blackout edge). */
const CORRIDOR = SOLAR_CORRIDOR_RSUN;
/** The watch band the gauge starts filling at: factor × corridor. */
const WATCH = SOLAR_CORRIDOR_RSUN * CONJUNCTION_WATCH_FACTOR;

/**
 * M1-10 / E7 — the glanceable MULTI-FEED readout derivation. PURE, so it is pinned
 * here without any DOM: freshness banding, the per-feed glyph/label mapping, the
 * conjunction-approach ramp (the predictable-blackout lead cue), and the
 * FrameState → Readout projection over the roster.
 */

/** One feed readout line with overridable fields. */
const feed = (over: Partial<FeedReadout> = {}): FeedReadout => ({
  id: "mars_imagery",
  outcome: "fresh",
  viaCache: true,
  cacheFreshness: 0.8,
  fetchInFlight: false,
  fetchCountdownSeconds: null,
  blackout: false,
  servedAgeSeconds: 0,
  freshnessPremium: 600,
  ...over,
});

/** A multi-feed demand readout; defaults to a single fresh feed. */
const demand = (over: Partial<DemandReadout> = {}): DemandReadout => ({
  feeds: [feed()],
  slotsUsed: 1,
  slotCapacity: 3,
  peakCacheFreshness: 0.8,
  fetchesInFlight: 0,
  balance: 1000,
  revenueRatePerSecond: 5,
  opexRatePerSecond: 2,
  netRatePerSecond: 3,
  runway: Infinity,
  bankrupt: false,
  policyMode: "manual",
  policyFloor: 0.7,
  autoPrefetched: [],
  autoBlackoutPrestage: false,
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
  losCorridorRsun: CORRIDOR,
  losOcculted: false,
  losInCorridor: false,
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
    expect(conjunctionApproach(WATCH + 1, false, CORRIDOR)).toBe(0);
    expect(conjunctionApproach(50, false, CORRIDOR)).toBe(0);
  });

  it("is 1 at/inside the corridor and when blacked out", () => {
    expect(conjunctionApproach(CORRIDOR, false, CORRIDOR)).toBe(1); // at the edge
    expect(conjunctionApproach(CORRIDOR - 0.5, false, CORRIDOR)).toBe(1); // inside
    expect(conjunctionApproach(50, true, CORRIDOR)).toBe(1); // blacked out clamps to full
  });

  it("ramps monotonically up as the margin tightens through the watch→corridor band", () => {
    const mid = (WATCH + CORRIDOR) / 2;
    const a = conjunctionApproach(WATCH - 0.01, false, CORRIDOR);
    const b = conjunctionApproach(mid, false, CORRIDOR);
    const c = conjunctionApproach(CORRIDOR + 0.01, false, CORRIDOR);
    expect(a).toBeGreaterThan(0);
    expect(b).toBeGreaterThan(a);
    expect(c).toBeGreaterThan(b);
    expect(c).toBeLessThanOrEqual(1);
    expect(b).toBeCloseTo(0.5, 5);
  });

  it("a tighter corridor pulls the whole ramp in (the dial moves the cue)", () => {
    // At a fixed margin of 6 Rsun: with the default corridor (5) it is just past
    // the edge (low approach); shrink the corridor to 2 and 6 Rsun is wide open.
    expect(conjunctionApproach(6, false, 5)).toBeGreaterThan(0);
    expect(conjunctionApproach(6, false, 2)).toBe(0); // 6 > 2×1.8=3.6 watch → open
  });

  it("treats a non-finite (no-occluder) margin as wide open", () => {
    expect(conjunctionApproach(Infinity, false, CORRIDOR)).toBe(0);
  });
});

describe("feedGlyphState + feedLabel — the per-feed Mini-Metro cues", () => {
  it("maps each outcome to a compact state code", () => {
    expect(feedGlyphState("fresh", false)).toBe("fresh");
    expect(feedGlyphState("stale", false)).toBe("stale");
    expect(feedGlyphState("blackout_miss", false)).toBe("blackout");
    expect(feedGlyphState("miss", true)).toBe("fetching"); // a leg crawling
    expect(feedGlyphState("miss", false)).toBe("miss"); // bare miss, no leg
  });

  it("labels a feed id by its suffix, uppercased", () => {
    expect(feedLabel("mars_imagery")).toBe("IMAGERY");
    expect(feedLabel("mars_telemetry")).toBe("TELEMETRY");
  });
});

describe("deriveReadout — MULTI-FEED projection", () => {
  it("Mars-node saturation reads PEAK cache freshness, clamped to [0,1]", () => {
    const r = deriveReadout(frame({ demand: demand({ peakCacheFreshness: 0.84 }) }));
    expect(r.freshness).toBeCloseTo(0.84, 5);
    expect(r.freshnessPct).toBe(84);
    expect(r.band).toBe("fresh");

    const clamped = deriveReadout(frame({ demand: demand({ peakCacheFreshness: 1.7 }) }));
    expect(clamped.freshness).toBe(1);
    expect(clamped.freshnessPct).toBe(100);
  });

  it("projects one line per feed with band, state, and freshness %", () => {
    const r = deriveReadout(
      frame({
        demand: demand({
          feeds: [
            feed({ id: "mars_imagery", outcome: "fresh", cacheFreshness: 0.95 }),
            feed({ id: "mars_comms", outcome: "miss", viaCache: false, cacheFreshness: 0, fetchInFlight: true, fetchCountdownSeconds: 400 }),
          ],
        }),
      }),
    );
    expect(r.feeds).toHaveLength(2);
    expect(r.feeds[0].label).toBe("IMAGERY");
    expect(r.feeds[0].state).toBe("fresh");
    expect(r.feeds[0].freshnessPct).toBe(95);
    expect(r.feeds[1].label).toBe("COMMS");
    expect(r.feeds[1].state).toBe("fetching");
    expect(r.feeds[1].freshnessPct).toBe(0);
    expect(r.feeds[1].packetProgress).not.toBeNull(); // a leg crawls → packet shows
  });

  it("surfaces the EARLIEST in-flight fetch ETA across feeds (else null)", () => {
    const flying = deriveReadout(
      frame({
        demand: demand({
          feeds: [
            feed({ id: "mars_a", outcome: "miss", viaCache: false, fetchInFlight: true, fetchCountdownSeconds: 500 }),
            feed({ id: "mars_b", outcome: "miss", viaCache: false, fetchInFlight: true, fetchCountdownSeconds: 320 }),
          ],
          fetchesInFlight: 2,
        }),
      }),
    );
    expect(flying.countdownSeconds).toBe(320); // the nearest leg
    expect(flying.fetchesInFlight).toBe(2);

    const idle = deriveReadout(frame({ demand: demand({ feeds: [feed({ fetchInFlight: false })] }) }));
    expect(idle.countdownSeconds).toBeNull();
  });

  it("blackout is true when ANY feed is in blackout; carries conjunction approach", () => {
    // In-corridor conjunction: the LOS is inside the solar-interference corridor
    // (margin ≤ threshold) so the link is dead. The gauge is full + alarmed and
    // the per-feed blackout_miss lights the aggregate blackout.
    const blk = deriveReadout(
      frame({
        losInCorridor: true,
        losMarginSolarRadii: 3.3, // inside the default 5-Rsun corridor
        demand: demand({ feeds: [feed({ blackout: true, outcome: "blackout_miss", viaCache: false })] }),
      }),
    );
    expect(blk.blackout).toBe(true);
    expect(blk.inCorridor).toBe(true);
    expect(blk.approach).toBe(1);
    expect(blk.approachAlarm).toBe(true);

    const open = deriveReadout(frame({ losMarginSolarRadii: 50, losInCorridor: false }));
    expect(open.approach).toBe(0);
    expect(open.approachAlarm).toBe(false);
    expect(open.blackout).toBe(false);
  });

  it("carries the slot occupancy readout", () => {
    const r = deriveReadout(frame({ demand: demand({ slotsUsed: 2, slotCapacity: 3 }) }));
    expect(r.slotsUsed).toBe(2);
    expect(r.slotCapacity).toBe(3);
  });

  it("E8 — surfaces the prefetch POLICY (the tame-it lever) on the readout", () => {
    const manual = deriveReadout(frame({ demand: demand({ policyMode: "manual" }) }));
    expect(manual.policyLabel).toBe("MANUAL");
    expect(manual.policyFiring).toBe(false);
    expect(manual.policyPrestaging).toBe(false);

    const auto = deriveReadout(
      frame({ demand: demand({ policyMode: "freshness", policyFloor: 0.7, autoPrefetched: ["mars_comms"] }) }),
    );
    expect(auto.policyLabel).toBe("AUTO @ 70%");
    expect(auto.policyFiring).toBe(true);

    const blk = deriveReadout(
      frame({ demand: demand({ policyMode: "freshness_blackout", policyFloor: 0.6, autoBlackoutPrestage: true }) }),
    );
    expect(blk.policyLabel).toBe("AUTO+BLK @ 60%");
    expect(blk.policyPrestaging).toBe(true);
  });
});

describe("policyLabel — the glanceable tame-it lever label", () => {
  it("reads MANUAL when the autopilot is off", () => {
    expect(policyLabel("manual", 0.7)).toBe("MANUAL");
  });
  it("reads AUTO @ floor% in freshness mode", () => {
    expect(policyLabel("freshness", 0.7)).toBe("AUTO @ 70%");
    expect(policyLabel("freshness", 0.55)).toBe("AUTO @ 55%");
  });
  it("reads AUTO+BLK @ floor% in blackout pre-staging mode", () => {
    expect(policyLabel("freshness_blackout", 0.6)).toBe("AUTO+BLK @ 60%");
  });
});
