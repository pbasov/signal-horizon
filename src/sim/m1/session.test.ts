import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Ephemeris } from "../ephemeris";
import { oneWaySeconds } from "../delay";
import { M1Session, type FeedRenderState } from "./session";
import { Demand } from "./demand";
import { buildFeeds, FEED_CONFIGS, CACHE_SLOTS } from "./feeds";
import { PREFETCH_COST } from "./economy";

/**
 * E7 (M1-04/05 plural) — M1Session: the LIVE multi-feed cache loop.
 *
 * PURE + DETERMINISTIC: every assertion is a function of the explicit t handed to
 * step() and the prior state. No wall-clock, no RNG. Geometry uses the real
 * (deterministic) Kepler ephemeris; the BLACKOUT cases use a minimal occluding
 * ephemeris (Earth and Mars opposite the Sun) since a real conjunction never
 * occurs within a play-length window.
 *
 * These tests pin: the single-feed loop still breathes (now as ONE feed of the
 * roster), PLURALITY (5 feeds resolve independently), MULTI-SLOT EVICTION (storing
 * into a full cache drops the most-stale; a feed without a slot misses), AGGREGATE
 * economy (summed revenue − per-slot opex), PREFETCH TARGETING (most-urgent
 * eligible feed), and snapshot/restore over the whole roster.
 */

const eph = loadEphemeris();

/** One-way data-leg ETA the session freezes for a fetch launched at t. */
function expectedOneWay(t: number): number {
  return oneWaySeconds(eph.distanceBetween("earth", "mars", t));
}

/** A standing blackout system: Earth & Mars 180° apart at the same radius. */
function occludingEph(): Ephemeris {
  return Ephemeris.build({
    epoch_jd: 0,
    frame: "test",
    bodies: {
      sun: { mu: 1.327e20, radius_km: 696000 },
      earth: { parent: "sun", a_au: 1.0, e: 0, m0_deg: 0, radius_km: 6371 },
      mars: { parent: "sun", a_au: 1.0, e: 0, m0_deg: 180, radius_km: 3389 },
    },
  });
}

/** A single-feed session for the focused loop tests (one feed of the roster). */
function singleFeedSession(): { s: M1Session; feed: Demand } {
  const feed = new Demand("mars_imagery", "earth_imagery", 1000, 3600);
  feed.minAcceptableFreshness = 0.5;
  const s = new M1Session([feed], undefined, undefined, 1); // 1 slot, EVENTUAL
  return { s, feed };
}

/** Find a feed's render line by id. */
function lineOf(feeds: FeedRenderState[], id: string): FeedRenderState {
  const f = feeds.find((x) => x.id === id);
  if (!f) throw new Error(`no feed ${id}`);
  return f;
}

describe("M1Session — single-feed loop still breathes (one feed of the roster)", () => {
  it("an empty cache with the link up resolves MISS and starts exactly one fetch", () => {
    const { s } = singleFeedSession();
    const r = s.step(eph, 0);
    const f = lineOf(r.feeds, "mars_imagery");

    expect(f.outcome).toBe("miss");
    expect(f.viaCache).toBe(false);
    expect(f.blackout).toBe(false);
    expect(f.fetchInFlight).toBe(true);
    expect(f.cacheFreshness).toBe(0);
    expect(r.fetchesInFlight).toBe(1);
    expect(s.arrivalTOf("mars_imagery")).toBeCloseTo(expectedOneWay(0), 9);
    expect(f.fetchCountdownSeconds).toBeCloseTo(expectedOneWay(0), 9);
  });

  it("does NOT start a second fetch while one is already in flight", () => {
    const { s } = singleFeedSession();
    s.step(eph, 0);
    const arrival = s.arrivalTOf("mars_imagery");
    const r = s.step(eph, arrival / 2);
    const f = lineOf(r.feeds, "mars_imagery");
    expect(f.outcome).toBe("miss");
    expect(f.fetchInFlight).toBe(true);
    expect(s.arrivalTOf("mars_imagery")).toBe(arrival); // not relaunched
  });

  it("on arrival stores a ONE-WAY-OLD sample and the next resolve is a HIT", () => {
    const { s, feed } = singleFeedSession();
    s.step(eph, 0);
    const arrival = s.arrivalTOf("mars_imagery");
    const oneWay = expectedOneWay(0);

    const r = s.step(eph, arrival);
    const f = lineOf(r.feeds, "mars_imagery");
    expect(f.viaCache).toBe(true);
    expect(f.fetchInFlight).toBe(false);
    expect(f.fetchCountdownSeconds).toBeNull();
    const expectedFreshness = Math.pow(2, -oneWay / feed.freshnessHalfLifeS);
    expect(f.cacheFreshness).toBeCloseTo(expectedFreshness, 12);
    expect(f.cacheFreshness).toBeCloseTo(0.837, 3);
    expect(f.outcome).toBe("stale");
    expect(f.cacheFreshness).toBeGreaterThan(feed.minAcceptableFreshness);
  });

  it("a held sample decaying below min produces the NEXT miss + a new fetch", () => {
    const { s, feed } = singleFeedSession();
    s.step(eph, 0);
    s.step(eph, s.arrivalTOf("mars_imagery")); // first stale hit

    // Captured at launch (t=0), so it hits the 0.5 floor at t = halfLife.
    const atFloor = feed.freshnessHalfLifeS;
    const rFloor = s.step(eph, atFloor);
    expect(lineOf(rFloor.feeds, "mars_imagery").cacheFreshness).toBeCloseTo(0.5, 9);
    expect(lineOf(rFloor.feeds, "mars_imagery").outcome).toBe("stale");

    const past = feed.freshnessHalfLifeS + 60;
    const rPast = s.step(eph, past);
    expect(lineOf(rPast.feeds, "mars_imagery").outcome).toBe("miss");
    expect(lineOf(rPast.feeds, "mars_imagery").fetchInFlight).toBe(true);
    expect(s.arrivalTOf("mars_imagery")).toBeCloseTo(past + expectedOneWay(past), 9);
  });
});

describe("M1Session — PLURALITY: all 5 feeds resolve independently", () => {
  it("the default roster is the 5 designer feeds and each one misses + fetches at boot", () => {
    const s = new M1Session();
    const r = s.step(eph, 0);
    expect(r.feeds).toHaveLength(5);
    expect(r.feeds.map((f) => f.id)).toEqual(FEED_CONFIGS.map((c) => c.id));
    // Empty shared cache → every feed misses and launches its own leg.
    for (const f of r.feeds) {
      expect(f.outcome).toBe("miss");
      expect(f.fetchInFlight).toBe(true);
    }
    expect(r.fetchesInFlight).toBe(5);
    expect(r.slotCapacity).toBe(CACHE_SLOTS);
  });

  it("feeds carry their OWN half-life: a fast feed stales before a slow one", () => {
    // Two feeds, 2 slots so both can be held; different half-lives.
    const fast = new Demand("mars_fast", "ds_fast", 1000, 1800);
    const slow = new Demand("mars_slow", "ds_slow", 1000, 5400);
    fast.minAcceptableFreshness = 0.5;
    slow.minAcceptableFreshness = 0.5;
    const s = new M1Session([fast, slow], undefined, undefined, 2);

    // Pre-load both, captured at t=0, fresh enough to start above min.
    s.cache.store("ds_fast", 0, 1800);
    s.cache.store("ds_slow", 0, 5400);

    // At t = 1800 the fast feed is at its half-life floor (0.5); the slow feed is
    // still well above it. The fast feed stales first — distinct decay per feed.
    const r = s.step(eph, 1800);
    const fastF = lineOf(r.feeds, "mars_fast");
    const slowF = lineOf(r.feeds, "mars_slow");
    expect(fastF.cacheFreshness).toBeCloseTo(0.5, 6);
    expect(slowF.cacheFreshness).toBeGreaterThan(fastF.cacheFreshness);
  });
});

describe("M1Session — MULTI-SLOT cache + lowest-freshness eviction", () => {
  it("a feed with NO slot misses while feeds that hold slots hit", () => {
    // 3 feeds, 1 slot. Only one dataset can be cached at a time.
    const a = new Demand("mars_a", "ds_a", 1000, 100000);
    const b = new Demand("mars_b", "ds_b", 1000, 100000);
    const c = new Demand("mars_c", "ds_c", 1000, 100000);
    for (const d of [a, b, c]) d.minAcceptableFreshness = 0.5;
    const s = new M1Session([a, b, c], undefined, undefined, 1);

    // Hold ds_a fresh. The link is up, so b/c (no slot) miss; a hits.
    s.cache.store("ds_a", 0, 100000);
    const r = s.step(eph, 10);
    expect(lineOf(r.feeds, "mars_a").viaCache).toBe(true);
    expect(lineOf(r.feeds, "mars_b").viaCache).toBe(false);
    expect(lineOf(r.feeds, "mars_b").outcome).toBe("miss");
    expect(lineOf(r.feeds, "mars_c").outcome).toBe("miss");
    expect(r.slotsUsed).toBe(1);
  });

  it("storing into a FULL cache evicts the slot with the lowest current freshness", () => {
    const cap = 2;
    const a = new Demand("mars_a", "ds_a", 1000, 3600);
    const b = new Demand("mars_b", "ds_b", 1000, 3600);
    const c = new Demand("mars_c", "ds_c", 1000, 3600);
    for (const d of [a, b, c]) d.minAcceptableFreshness = 0.1;
    const s = new M1Session([a, b, c], undefined, undefined, cap);

    // ds_a captured early (older → staler), ds_b captured late (fresher). Cache full.
    s.cache.store("ds_a", 0, 3600);
    s.cache.store("ds_b", 1000, 3600);
    expect(s.cache.occupied).toBe(2);

    // Store ds_c at t=1000: judged at t, ds_a (age 1000) is staler than ds_b (age 0),
    // so ds_a is EVICTED, not ds_b.
    s.cache.store("ds_c", 1000, 3600, 1000);
    expect(s.cache.occupied).toBe(2);
    expect(s.cache.holds("ds_a", 1000)).toBe(false); // evicted (was stalest)
    expect(s.cache.holds("ds_b", 1000)).toBe(true); // survived
    expect(s.cache.holds("ds_c", 1000)).toBe(true); // inserted
  });

  it("3 feeds contend for 1 slot through the live loop: the loser keeps missing", () => {
    const a = new Demand("mars_a", "ds_a", 1000, 100000);
    const b = new Demand("mars_b", "ds_b", 1000, 100000);
    for (const d of [a, b]) d.minAcceptableFreshness = 0.5;
    const s = new M1Session([a, b], undefined, undefined, 1);

    // Both miss at t=0 and launch legs (same Earth→Mars geometry → same ETA).
    s.step(eph, 0);
    const arrival = s.arrivalTOf("mars_a");
    expect(s.arrivalTOf("mars_b")).toBeCloseTo(arrival, 9);

    // On arrival BOTH legs land into the 1-slot cache; the second store evicts the
    // first. So at most one feed holds the slot — the other is back to missing.
    const r = s.step(eph, arrival);
    const held = r.feeds.filter((f) => f.viaCache).length;
    const missing = r.feeds.filter((f) => !f.viaCache).length;
    expect(s.cache.occupied).toBe(1); // one slot, one survivor
    expect(held).toBe(1);
    expect(missing).toBe(1);
  });
});

describe("M1Session — AGGREGATE economy (summed revenue − per-slot opex)", () => {
  it("revenue sums across serving feeds and opex scales with occupied slots", () => {
    const a = new Demand("mars_a", "ds_a", 1000, 100000);
    const b = new Demand("mars_b", "ds_b", 1000, 100000);
    for (const d of [a, b]) {
      d.minAcceptableFreshness = 0.5;
      d.freshFreshness = 0.9;
    }
    const s = new M1Session([a, b], undefined, undefined, 2);
    // Hold both fresh (captured now → freshness ~1.0 → fresh band).
    s.cache.store("ds_a", 0, 100000);
    s.cache.store("ds_b", 0, 100000);

    const r = s.step(eph, 1);
    // Both serve fresh → summed fresh revenue (2 feeds), opex for 2 occupied slots.
    expect(r.feeds.every((f) => f.outcome === "fresh")).toBe(true);
    expect(r.slotsUsed).toBe(2);
    // Net rate is summed revenue − opex; with two fresh feeds it should be positive.
    expect(r.netRatePerSecond).toBeGreaterThan(0);
    expect(r.revenueRatePerSecond).toBeGreaterThan(0);
    expect(r.opexRatePerSecond).toBeGreaterThan(0);
  });

  it("an all-blackout roster burns (negative net) and is the deepest loss", () => {
    const blk = occludingEph();
    const s = new M1Session(); // 5 feeds, empty cache, link down everywhere
    const r = s.step(blk, 0);
    expect(r.feeds.every((f) => f.blackout)).toBe(true);
    expect(r.netRatePerSecond).toBeLessThan(0);
    expect(r.revenueRatePerSecond).toBeLessThan(0); // SLA penalties across feeds
  });

  it("balance is DT-invariant: stepping in pieces equals one big step to the same t", () => {
    const mk = () => {
      const a = new Demand("mars_a", "ds_a", 1000, 100000);
      a.minAcceptableFreshness = 0.5;
      const s = new M1Session([a], undefined, undefined, 1);
      s.cache.store("ds_a", 0, 100000); // fresh, long-lived → steady fresh serve
      return s;
    };
    const direct = mk();
    direct.step(eph, 0, 0);
    direct.step(eph, 60, 60); // one 60s accrual

    const pieced = mk();
    for (let i = 0; i < 60; i++) pieced.step(eph, i + 1, 1); // 60 × 1s accruals

    expect(pieced.economy.balance).toBeCloseTo(direct.economy.balance, 6);
  });
});

describe("M1Session — MANUAL PREFETCH targets the most-urgent eligible feed", () => {
  it("prefetch picks the LOWEST-freshness eligible feed and charges € once", () => {
    const a = new Demand("mars_a", "ds_a", 1000, 100000);
    const b = new Demand("mars_b", "ds_b", 1000, 100000);
    const c = new Demand("mars_c", "ds_c", 1000, 100000);
    for (const d of [a, b, c]) d.minAcceptableFreshness = 0.5;
    const s = new M1Session([a, b, c], undefined, undefined, 3);

    // Hold ds_a fresh and ds_b stale-ish; ds_c has NO slot (freshness 0 → most urgent).
    s.cache.store("ds_a", 0, 100000); // ~1.0
    s.cache.store("ds_b", -50000, 100000); // older → lower freshness, but > 0
    const balanceBefore = s.economy.balance;

    const target = s.prefetch(eph, 10);
    expect(target).toBe("mars_c"); // empty slot (0 freshness) is the most urgent
    expect(s.isFetchingFeed("mars_c")).toBe(true);
    expect(balanceBefore - s.economy.balance).toBeCloseTo(PREFETCH_COST, 9);
  });

  it("prefetch skips feeds that already have a leg in flight", () => {
    const s = new M1Session(); // 5 feeds
    // Boot: every feed misses → every feed has a leg in flight → nothing eligible.
    s.step(eph, 0);
    const balanceBefore = s.economy.balance;
    const target = s.prefetch(eph, 1);
    expect(target).toBeNull();
    expect(s.economy.balance).toBe(balanceBefore); // not charged
  });

  it("prefetch returns null when every link is down (blackout)", () => {
    const blk = occludingEph();
    const a = new Demand("mars_a", "ds_a", 1000, 100000);
    a.minAcceptableFreshness = 0.5;
    const s = new M1Session([a], undefined, undefined, 1);
    expect(s.prefetch(blk, 0)).toBeNull();
  });

  it("a well-timed prefetch lands a slot that serves THROUGH a blackout (no penalty)", () => {
    const blk = occludingEph();
    const a = new Demand("mars_a", "ds_a", 1000, 3600);
    a.minAcceptableFreshness = 0.5;
    const s = new M1Session([a], undefined, undefined, 1);

    // Prefetch while the link is up; it lands one-way later ≈0.84 fresh.
    expect(s.prefetch(eph, 0)).toBe("mars_a");
    const arrival = s.arrivalTOf("mars_a");
    s.step(eph, arrival); // sample lands

    // Link closes; the held copy serves locally — no blackout for that feed.
    const r = s.step(blk, arrival + 60);
    const f = lineOf(r.feeds, "mars_a");
    expect(f.blackout).toBe(false);
    expect(f.viaCache).toBe(true);
    expect(f.cacheFreshness).toBeGreaterThanOrEqual(a.minAcceptableFreshness);
  });
});

describe("M1Session — snapshot/restore covers feeds + slots + balance", () => {
  it("round-trips the whole roster + cache + balance and continues identically", () => {
    const original = new M1Session();
    original.step(eph, 0);
    original.step(eph, original.arrivalTOf("mars_imagery") * 0.5);
    // Also land a couple of arrivals so slots are populated.
    original.step(eph, original.arrivalTOf("mars_science"));

    const snap = original.snapshot();
    const restored = new M1Session();
    restored.restore(snap);

    expect(restored.snapshot()).toEqual(snap);
    // Continue both to a later t → identical render state + balance.
    const t = 4000;
    const a = original.step(eph, t);
    const b = restored.step(eph, t);
    expect(b).toEqual(a);
    expect(restored.economy.balance).toBe(original.economy.balance);
  });

  it("path-independent resolve state: pieces vs straight-to-t agree per feed", () => {
    const arrival = expectedOneWay(0);
    const buildAndDrive = (pieces: number[]) => {
      const s = new M1Session();
      s.step(eph, 0);
      for (const p of pieces) s.step(eph, p);
      return s.step(eph, arrival);
    };
    const direct = buildAndDrive([]);
    const pieced = buildAndDrive([arrival * 0.3, arrival * 0.7]);
    // Compare the resolve-facing per-feed fields (balance is not path-independent).
    const strip = (r: typeof direct) =>
      r.feeds.map((f) => ({
        id: f.id,
        outcome: f.outcome,
        viaCache: f.viaCache,
        cacheFreshness: f.cacheFreshness,
        fetchInFlight: f.fetchInFlight,
      }));
    expect(strip(pieced)).toEqual(strip(direct));
  });
});

describe("M1Session — feeds roster builder", () => {
  it("buildFeeds yields 5 distinct demands with varied half-lives + prices", () => {
    const feeds = buildFeeds();
    expect(feeds).toHaveLength(5);
    const halfLives = new Set(feeds.map((f) => f.freshnessHalfLifeS));
    expect(halfLives.size).toBeGreaterThan(1); // varied decay rates
    for (const f of feeds) {
      expect(f.freshnessHalfLifeS).toBeGreaterThanOrEqual(1800);
      expect(f.freshnessHalfLifeS).toBeLessThanOrEqual(5400);
      expect(f.minAcceptableFreshness).toBeGreaterThanOrEqual(0.4);
      expect(f.minAcceptableFreshness).toBeLessThanOrEqual(0.6);
    }
  });
});
