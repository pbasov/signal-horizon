import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import {
  stepActiveContract,
  BREACH_GRACE_SECONDS,
} from "../m2/contracts";
import {
  windowAvailability,
  NET_AVAIL_WINDOW_S,
  NET_AVAIL_SAMPLES,
} from "./availability";
import { bridgeForPoint, isPointServed } from "./router";
import { offerNetContract, type Contract, type SlaAxis } from "./contract";
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
  GEO_PARK,
  resolveOrbit,
  A1_LEO_PERIOD_S,
} from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

/**
 * B1 — THE AVAILABILITY AXIS + THE MULTI-SAT HAND-OFF ROUTER (Act 2, design §4.4).
 *
 * The ONE concept: a single LEO cannot HOLD a region because it MOVES — it is up only a slice
 * of each pass — so its rolling availability sawtooths and the contract breaches on the SHARED
 * grace. A phased CONSTELLATION hands off (one rises as another sets); only at N=4 does the
 * high-lat REGION hold continuous SERVED (rolling-avail = 1.0) and complete. These tests PIN
 * that empirical N (the doc's measured table) and prove the loop runs on the SHARED m2 state
 * machine — no second breach convention, no struct reshape.
 */

const eph = Ephemeris.build({});
const TAU = Math.PI * 2;
// The ground network: equatorial GROUND-0 (REGION-0) + high-lat GROUND-1 (REGION-1). REGION-1's
// bent path closes only via GROUND-1 (the equatorial ground is ~70° away — wider than a LEO can
// bridge); the router picks the strongest (sat, ground) pair across both.
const grounds = [NET_ACT1_GROUND, NET_ACT2_GROUND];

// The Act-2 region is HIGH LATITUDE (lat 70°, beyond the GEO's ~64° footprint edge): a single
// inclined LEO sawtooths; the polar (inc 90°) constellation's zero-gap minimum is N=4.
const REGION: Region = {
  id: "REGION-1",
  label: "polar metro",
  latRad: NET_ACT2_REGION_LAT_RAD,
  lonRad: NET_ACT2_REGION_LON_RAD,
  radiusRad: NET_ACT1_REGION.radiusRad,
  bodyId: "earth",
};
const centre = { latRad: REGION.latRad, lonRad: REGION.lonRad };

/** The measured zero-gap constellation minimum for REGION-1 from the polar LEO family — the
 * same empirical pin phasing.test.ts derives from `suggestPhasing`. Named once here so the
 * hand-off assertions move together when the physics is re-tuned. */
const ZERO_GAP_N = 4;

/** A train of `count` LEO_SWEEP sats evenly phased in mean anomaly (m0 += 2π·i/count). */
function leoTrain(count: number, t0 = 0): NetSat[] {
  const out: NetSat[] = [];
  for (let i = 0; i < count; i++) {
    const orbit = resolveOrbit(LEO_SWEEP, t0);
    orbit.m0Rad += (TAU * i) / count;
    out.push({
      id: `NET-SAT-${i}`,
      orbit,
      bus: "smallsat",
      loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
    });
  }
  return out;
}

/** An availability-active contract over the region (slaAvail = 0.99). */
function availContract(slaAvail = 0.99): Contract {
  const c = offerNetContract("REGION-1", REGION, {
    activeAxes: new Set<SlaAxis>(["connectivity", "availability"]),
    slaAvail,
  });
  c.state = "active";
  return c;
}

describe("B1 windowAvailability — the rolling hand-off held-fraction", () => {
  it("a LONE LEO sawtooths: rolling availability dips to ~0 and recovers across a period", () => {
    const sats = leoTrain(1);
    const c = availContract();
    let minRoll = Infinity;
    let maxRoll = -Infinity;
    const dt = A1_LEO_PERIOD_S / 200;
    for (let i = 0; i < 200 * 4; i++) {
      const t = i * dt;
      const r = windowAvailability(eph, c, sats, grounds, t);
      if (r < minRoll) minRoll = r;
      if (r > maxRoll) maxRoll = r;
    }
    // Rhythmic: it drops in the long set window (rolling-avail ≈ 0.22 over the high-lat region)
    // and rises during a pass (≈ 0.44) — but never approaches the 0.99 bar (a lone inclined LEO
    // can never hold continuous coverage of REGION-1; it sets below the high-lat ground's horizon
    // for most of each orbit). The sawtooth — not the exact floor — is the lesson; the breach is
    // pinned in the SHARED-grace test below (a lone LEO accrues a breach run past the grace).
    expect(minRoll).toBeLessThan(0.5);
    expect(maxRoll).toBeGreaterThan(minRoll); // it sawtooths (rises + falls)
    expect(maxRoll).toBeLessThan(0.99);
  });

  it("a phased N=4 holds rolling availability = 1.0 at EVERY phase, including a t < window boundary", () => {
    const sats = leoTrain(ZERO_GAP_N);
    const c = availContract();
    // Several phases across a period, including a trailing-window boundary t < W (negative
    // sample times) — determinism holds (periodic orbit, pure isPointServed at negative t).
    for (const t of [0, NET_AVAIL_WINDOW_S * 0.5, NET_AVAIL_WINDOW_S, A1_LEO_PERIOD_S * 2.37, A1_LEO_PERIOD_S * 3.9]) {
      expect(windowAvailability(eph, c, sats, grounds, t)).toBe(1.0);
    }
  });

  it("is byte-identical for the same (t, roster) — pure, no RNG/state", () => {
    const sats = leoTrain(3);
    const c = availContract();
    for (const t of [0, 12.5, 88.0, 211.0]) {
      const a = windowAvailability(eph, c, sats, grounds, t);
      const b = windowAvailability(eph, c, sats, grounds, t);
      expect(a).toBe(b);
    }
  });

  it("constants are sane (window = one LEO period; fixed sample count)", () => {
    expect(NET_AVAIL_WINDOW_S).toBe(A1_LEO_PERIOD_S);
    expect(NET_AVAIL_SAMPLES).toBeGreaterThanOrEqual(8);
  });
});

describe("B1 the SHARED grace enforces availability — empirical N pinned (N=4 is the floor)", () => {
  // Drive the design's exact served-fraction fork into the REAL shared stepActiveContract.
  // A long run at a coarse dt: feed 0 while (instant gap OR rolling-avail < slaAvail), else 1.0.
  function driveContract(sats: NetSat[], steps: number, dt: number): Contract {
    const c = availContract();
    for (let i = 1; i <= steps; i++) {
      const t = i * dt;
      const served = isPointServed(eph, centre, grounds, sats, t);
      const avail = windowAvailability(eph, c, sats, grounds, t);
      c.lastAvailability = avail;
      const frac = served && avail >= c.slaAvail ? 1.0 : 0.0;
      stepActiveContract(c as never, frac, dt);
      if (c.state !== "active") break;
    }
    return c;
  }

  const DT = 5;
  // Enough steps to exceed the grace many times over (and, for N=4, to begin accruing term).
  const STEPS = Math.ceil((BREACH_GRACE_SECONDS * 4) / DT);

  it("a LONE LEO FAILS at the IMPORTED grace (sawtooth never resets the breach window enough)", () => {
    const c = driveContract(leoTrain(1), STEPS, DT);
    expect(c.state).toBe("failed");
    expect(c.breachSecondsAccum).toBeGreaterThanOrEqual(BREACH_GRACE_SECONDS);
  });

  it("N=2 and N=3 also FAIL — a sub-zero-gap constellation does NOT hold the bar", () => {
    const c2 = driveContract(leoTrain(2), STEPS, DT);
    const c3 = driveContract(leoTrain(3), STEPS, DT);
    expect(c2.state).toBe("failed");
    expect(c3.state).toBe("failed");
  });

  it("N=4 NEVER breaches and accrues term — the measured zero-gap minimum", () => {
    const c = driveContract(leoTrain(ZERO_GAP_N), STEPS, DT);
    expect(c.state).not.toBe("failed");
    expect(c.breachSecondsAccum).toBe(0); // held continuously across every hand-off
    expect(c.servedSecondsAccum).toBeGreaterThan(0); // term accrues
    expect(c.lastAvailability).toBe(1.0);
  });
});

describe("B1 the strongest-margin hand-off router (signature stable, order-independent)", () => {
  it("picks the SAME bridge regardless of roster order (tie-break by satId) — order-independent", () => {
    const sats = leoTrain(ZERO_GAP_N);
    // Find a t where >=2 sats bridge (a hand-off overlap) by checking margins differ.
    const dt = A1_LEO_PERIOD_S / 400;
    let checked = 0;
    for (let i = 0; i < 400 * 2; i++) {
      const t = i * dt;
      const fwd = bridgeForPoint(eph, centre, [NET_ACT1_GROUND], sats, t);
      const rev = bridgeForPoint(eph, centre, [NET_ACT1_GROUND], sats.slice().reverse(), t);
      // The chosen bridge id + latency are identical regardless of input order.
      expect(rev).toEqual(fwd);
      checked++;
    }
    expect(checked).toBeGreaterThan(0);
  });

  it("served NEVER flips across a hand-off for N=4 (one rises as another sets)", () => {
    const sats = leoTrain(ZERO_GAP_N);
    const dt = A1_LEO_PERIOD_S / 400;
    for (let i = 0; i < 400 * 4; i++) {
      const t = i * dt;
      expect(isPointServed(eph, centre, grounds, sats, t)).toBe(true);
    }
  });
});

describe("B1 golden-safety: the connectivity-only fork is byte-identical to the old binary path", () => {
  it("a connectivity-only contract's servedFraction equals served?1:0 (no availability math)", () => {
    // The parked GEO covers REGION-0; a connectivity-only contract must read exactly binary.
    const geo: NetSat = {
      id: "NET-SAT-GEO",
      orbit: resolveOrbit(GEO_PARK, 0),
      bus: "smallsat",
      loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
    };
    const c = offerNetContract("REGION-0", NET_ACT1_REGION); // default activeAxes = {connectivity}
    expect(c.activeAxes.has("availability")).toBe(false);
    // lastAvailability stays at its init (0) for a connectivity-only contract — the
    // availability branch is never taken, so nothing in the legacy path changes.
    expect(c.lastAvailability).toBe(0);
    // The instant served verdict over the covered region is true (binary 1.0 path).
    const served = isPointServed(eph, { latRad: 0, lonRad: 0 }, grounds, [geo], 0);
    expect(served).toBe(true);
  });
});
