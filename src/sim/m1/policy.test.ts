import { describe, it, expect } from "vitest";
import {
  selectAutoPrefetches,
  defaultPolicy,
  type PrefetchPolicy,
  type PolicyFeedState,
} from "./policy";
import { Cache } from "./cache";
import type { Ephemeris } from "../ephemeris";

/**
 * E8 (M1-06b) — the PrefetchPolicy selection function: the pure brain of the
 * tame-it lever. These pin the rules the autopilot runs INSIDE step() — and
 * because the function is pure, replay reproduces the autopilot with no logging.
 *
 * Feasibility is driven by a FAKE ephemeris whose link is blocked iff a scripted
 * `downAt(customerId, t)` predicate is true: when down we plant the Sun on the
 * earth→customer segment midpoint (it occludes → lineOfSight false); when up we
 * park the Sun far off-axis (never occludes). Each feed gets its OWN customer body
 * placed on a distinct axis, so feasibility can differ PER FEED — needed to test a
 * feed facing a forecast blackout alongside one that is not. Cache contention is
 * expressed through distinct datasetIds + freshness.
 */
const AU = 1.496e11;
const SUN_R = 6.96e8;

/** Each customer sits far out on its own ray from Earth, so links are independent. */
const CUSTOMER_DIR: Record<string, [number, number, number]> = {
  cust_a: [1, 0, 0],
  cust_b: [0, 1, 0],
  cust_c: [0, 0, 1],
  cust_d: [1, 1, 0],
  cust_e: [1, 0, 1],
  mars: [1, 0, 0],
};

/**
 * A fake Ephemeris whose per-customer link feasibility is scripted by (cust, t).
 *
 * lineOfSight reads eph.position("sun", t) ONCE per link, but we need the Sun to
 * occlude only the specific customer's segment. Trick: customers sit on ORTHOGONAL
 * rays from Earth, so a Sun planted on customer X's midpoint occludes earth→X but
 * not earth→Y (Y's segment stays ≈1 AU from that point ≫ the Sun radius). We make
 * position("sun", t) return the midpoint of the FIRST customer that is `down` at
 * t; tests keep at most one customer down per evaluated instant. When none is
 * down the Sun parks far off every axis (all links open).
 */
function fakeEph(downAt: (customerId: string, t: number) => boolean): Ephemeris {
  const position = (id: string, t: number): number[] => {
    if (id === "earth") return [0, 0, 0];
    const dir = CUSTOMER_DIR[id];
    if (dir) return [2 * AU * dir[0], 2 * AU * dir[1], 2 * AU * dir[2]];
    if (id === "sun") {
      for (const [cust, d] of Object.entries(CUSTOMER_DIR)) {
        if (downAt(cust, t)) return [AU * d[0], AU * d[1], AU * d[2]]; // midpoint
      }
      return [0, 0, 1000 * AU]; // far off every axis → all links open
    }
    return [2 * AU, 0, 0];
  };
  return {
    position,
    hasBody: (id: string): boolean => id === "earth" || id === "sun" || id in CUSTOMER_DIR,
    radiusMeters: (id: string): number => (id === "sun" ? SUN_R : 0),
    distanceBetween(a: string, b: string, t: number): number {
      const pa = position(a, t);
      const pb = position(b, t);
      return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
    },
  } as unknown as Ephemeris;
}

/** Each feed `x` gets customer `cust_x` on its own orthogonal ray from Earth. */
function feeds(ids: string[]): PolicyFeedState[] {
  return ids.map((id) => ({
    id,
    datasetId: `ds_${id}`,
    sourceId: "earth",
    customerId: `cust_${id}`,
    inFlight: false,
  }));
}

/** A cache pre-seeded so each datasetId reads a chosen freshness at t=0. */
function cacheWith(fresh: Record<string, number>): Cache {
  const c = new Cache("mars", 8);
  for (const [ds, f] of Object.entries(fresh)) {
    if (f <= 0) continue; // leave empty → reads 0
    // freshness(0) = 2^(-age/halfLife). Pick halfLife=1000; capturedAtT = -age so
    // age(0) = age and freshness lands on f exactly.
    const halfLife = 1000;
    const age = -halfLife * Math.log2(f);
    c.store(ds, -age, halfLife, -age);
  }
  return c;
}

const linkUp = () => false; // never down → link always feasible

describe("selectAutoPrefetches — the tame-it lever's pure brain", () => {
  it("manual mode returns [] (autopilot off — only P acts)", () => {
    const p = defaultPolicy(); // mode manual
    expect(selectAutoPrefetches(p, feeds(["a", "b"]), cacheWith({}), fakeEph(linkUp), 0)).toEqual([]);
  });

  it("freshness mode tops up only feeds BELOW the floor, most-urgent first", () => {
    const p: PrefetchPolicy = { mode: "freshness", freshnessFloor: 0.6, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
    // ds_a 0.9 (above floor → skip); ds_b 0.3 (below); ds_c absent = 0 (most urgent).
    const cache = cacheWith({ ds_a: 0.9, ds_b: 0.3 });
    const out = selectAutoPrefetches(p, feeds(["a", "b", "c"]), cache, fakeEph(linkUp), 0);
    expect(out).toEqual(["c", "b"]);
  });

  it("the concurrency cap COUNTS legs already in flight (rate-limited, no €250 blast)", () => {
    const p: PrefetchPolicy = { mode: "freshness", freshnessFloor: 0.9, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
    const fs = feeds(["a", "b", "c", "d", "e"]); // all empty → all below floor
    fs[0].inFlight = true;
    fs[1].inFlight = true; // budget = 3 − 2 = 1
    const out = selectAutoPrefetches(p, fs, cacheWith({}), fakeEph(linkUp), 0);
    expect(out).toHaveLength(1);
    expect(out).not.toContain("a");
    expect(out).not.toContain("b");
  });

  it("budget 0 (cap saturated by in-flight legs) returns []", () => {
    const p: PrefetchPolicy = { mode: "freshness", freshnessFloor: 0.9, blackoutLeadS: 1200, maxConcurrentAuto: 2 };
    const fs = feeds(["a", "b", "c"]);
    fs[0].inFlight = true;
    fs[1].inFlight = true;
    expect(selectAutoPrefetches(p, fs, cacheWith({}), fakeEph(linkUp), 0)).toEqual([]);
  });

  it("an above-floor feed is NOT topped up in plain freshness mode", () => {
    const p: PrefetchPolicy = { mode: "freshness", freshnessFloor: 0.5, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
    expect(selectAutoPrefetches(p, feeds(["a"]), cacheWith({ ds_a: 0.8 }), fakeEph(linkUp), 0)).toEqual([]);
  });

  it("a feed whose link is DOWN now is ineligible", () => {
    const p: PrefetchPolicy = { mode: "freshness", freshnessFloor: 0.9, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
    expect(selectAutoPrefetches(p, feeds(["a"]), cacheWith({}), fakeEph(() => true), 0)).toEqual([]);
  });

  it("blackout mode pre-stages a feed feasible NOW but forecast DOWN within the lead window — even above the floor", () => {
    const p: PrefetchPolicy = { mode: "freshness_blackout", freshnessFloor: 0.5, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
    // Up at t=0, down at t>=1000 (inside the 1200 lead). ds_a 0.95 is above floor:
    // plain freshness would skip; blackout pre-stages it.
    const out = selectAutoPrefetches(p, feeds(["a"]), cacheWith({ ds_a: 0.95 }), fakeEph((c, t) => c === "cust_a" && t >= 1000), 0);
    expect(out).toEqual(["a"]);
  });

  it("blackout pre-stages take PRIORITY over routine floor top-ups", () => {
    const p: PrefetchPolicy = { mode: "freshness_blackout", freshnessFloor: 0.6, blackoutLeadS: 1200, maxConcurrentAuto: 1 };
    // cust_a faces a forecast blackout (t>=1000), cust_b stays up. ds_a 0.95 above
    // floor (pre-stage); ds_b 0.1 routine floor top-up. Budget 1 → the blackout wins.
    const out = selectAutoPrefetches(p, feeds(["a", "b"]), cacheWith({ ds_a: 0.95, ds_b: 0.1 }), fakeEph((c, t) => c === "cust_a" && t >= 1000), 0);
    expect(out).toEqual(["a"]);
  });

  it("blackout NOT forecast within the lead → falls back to plain floor behaviour", () => {
    const p: PrefetchPolicy = { mode: "freshness_blackout", freshnessFloor: 0.6, blackoutLeadS: 1200, maxConcurrentAuto: 3 };
    // Down only far in the future (t>=5000, outside the 1200 lead); ds_a above floor.
    expect(selectAutoPrefetches(p, feeds(["a"]), cacheWith({ ds_a: 0.95 }), fakeEph((c, t) => c === "cust_a" && t >= 5000), 0)).toEqual([]);
  });

  it("is deterministic + pure: same inputs → identical output across repeated calls", () => {
    const p: PrefetchPolicy = { mode: "freshness", freshnessFloor: 0.6, blackoutLeadS: 1200, maxConcurrentAuto: 2 };
    const cache = cacheWith({ ds_a: 0.1, ds_b: 0.2, ds_c: 0.3 });
    const eph = fakeEph(linkUp);
    const a = selectAutoPrefetches(p, feeds(["a", "b", "c"]), cache, eph, 0);
    const b = selectAutoPrefetches(p, feeds(["a", "b", "c"]), cache, eph, 0);
    expect(a).toEqual(b);
    expect(a).toEqual(["a", "b"]);
  });
});
