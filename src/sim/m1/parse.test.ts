import { describe, it, expect } from "vitest";
import { EventLog, type M1Event } from "./eventlog";
import { parseRun, type RunContext, ACHIEVABLE_LABEL } from "./parse";

/**
 * E10c (M1-GATE) — THE POST-RUN PARSE, unit-tested against a KNOWN event sequence.
 *
 * The §4.12 honesty precondition is that the parse is a PURE READ of the truthful
 * event log: same events → same summary, and every number folded straight out of
 * the stream (never re-derived). These tests build a hand-authored {@link M1Event}
 * sequence (the kind {@link M1Session.step} emits) and assert the per-feed
 * post-mortem, the aggregate gate telemetry, the timely/wasted prefetch split, the
 * blackout-handling verdict, and the heuristic achievable bound + gap.
 */

/**
 * A seq-less event: a DISTRIBUTIVE omit over the discriminated union so each
 * variant keeps its own fields (a bare `Omit<M1Event,"seq">` collapses the union to
 * its common keys, dropping feedId/datasetId/etc.). The naked type parameter `T`
 * in the conditional is what makes the omit distribute per-variant.
 */
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;
type SeqlessEvent = DistributiveOmit<M1Event, "seq">;

/** Build an EventLog from a plain list, stamping seq in order (mirrors EventLog.push). */
function logOf(events: SeqlessEvent[]): EventLog {
  const log = new EventLog();
  for (const e of events) log.push((seq) => ({ ...e, seq }) as M1Event);
  return log;
}

type Band = "fresh" | "stale" | "miss" | "blackout_miss";

/** A serve transition event (the band-time spine). */
function serve(
  feedId: string,
  datasetId: string,
  band: Band,
  tSim: number,
  viaCache: boolean,
): SeqlessEvent {
  return {
    kind: "serve",
    tick: Math.round(tSim * 60),
    tSim,
    feedId,
    datasetId,
    band,
    from: null,
    freshness: viaCache ? 0.8 : 0,
    viaCache,
  };
}

const TWO_FEEDS: RunContext["feeds"] = [
  { id: "f_a", datasetId: "d_a" },
  { id: "f_b", datasetId: "d_b" },
];

describe("parseRun — band-time attribution (per-contract post-mortem)", () => {
  it("integrates edge-triggered serve transitions into held-band seconds", () => {
    // f_a: fresh [0,40) then stale [40,100]. f_b: miss [0,100].
    const log = logOf([
      serve("f_a", "d_a", "fresh", 0, true),
      serve("f_b", "d_b", "miss", 0, false),
      serve("f_a", "d_a", "stale", 40, true),
    ]);
    const ctx: RunContext = {
      feeds: TWO_FEEDS,
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 1500,
      slotCapacity: 1, // 1 slot < 2 feeds ⇒ 50% fresh ceiling.
    };
    const p = parseRun(log, ctx);

    const a = p.feeds.find((f) => f.id === "f_a")!;
    expect(a.freshSeconds).toBeCloseTo(40, 6);
    expect(a.staleSeconds).toBeCloseTo(60, 6);
    expect(a.totalSeconds).toBeCloseTo(100, 6);
    expect(a.freshFraction).toBeCloseTo(0.4, 6);

    const b = p.feeds.find((f) => f.id === "f_b")!;
    expect(b.missSeconds).toBeCloseTo(100, 6);
    expect(b.freshSeconds).toBe(0);

    // Aggregate: fresh 40 of 200 feed·seconds = 20%.
    expect(p.metrics.feedSecondsTotal).toBeCloseTo(200, 6);
    expect(p.metrics.freshFraction).toBeCloseTo(0.2, 6);
    expect(p.metrics.missFraction).toBeCloseTo(0.5, 6);
    expect(p.metrics.netEur).toBe(500);
  });

  it("the heuristic achievable bound caps fresh at slots/feeds of link-up time, gap ≥ 0", () => {
    // All link-up, no blackout. 1 slot / 2 feeds ⇒ achievable fresh = 50%.
    const log = logOf([
      serve("f_a", "d_a", "fresh", 0, true),
      serve("f_b", "d_b", "miss", 0, false),
    ]);
    const ctx: RunContext = {
      feeds: TWO_FEEDS,
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 1000,
      slotCapacity: 1,
    };
    const p = parseRun(log, ctx);
    // f_a fresh [0,100], f_b miss [0,100] ⇒ actual fresh 50%.
    expect(p.metrics.freshFraction).toBeCloseTo(0.5, 6);
    // Bound: slotShare 0.5 × linkUp(200)/total(200) = 0.5.
    expect(p.metrics.achievableFreshFraction).toBeCloseTo(0.5, 6);
    expect(p.metrics.freshGap).toBeCloseTo(0, 6);
    expect(p.metrics.efficiency).toBeCloseTo(1, 6);
    expect(p.achievableLabel).toBe(ACHIEVABLE_LABEL);
  });
});

describe("parseRun — prefetch timely vs wasted (the € on wasted legs)", () => {
  it("a prefetch that converts to a later fresh-via-cache serve is TIMELY", () => {
    const log = logOf([
      {
        kind: "prefetch",
        tick: 0,
        tSim: 0,
        feedId: "f_a",
        datasetId: "d_a",
        cause: "manual",
        etaSeconds: 900,
        costEur: 50,
      },
      // The pre-staged copy lands and serves FRESH from cache → the leg paid off.
      serve("f_a", "d_a", "fresh", 20, true),
    ]);
    const ctx: RunContext = {
      feeds: [{ id: "f_a", datasetId: "d_a" }],
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 1000,
    };
    const p = parseRun(log, ctx);
    expect(p.metrics.prefetchesTimely).toBe(1);
    expect(p.metrics.prefetchesWasted).toBe(0);
    expect(p.metrics.wastedPrefetchEur).toBe(0);
    expect(p.feeds[0].prefetchesLaunched).toBe(1);
    expect(p.feeds[0].fetchesLaunched).toBe(1); // a prefetch IS a launched leg.
  });

  it("a prefetch that NEVER converts to a fresh serve is WASTED (€ counted)", () => {
    const log = logOf([
      {
        kind: "prefetch",
        tick: 0,
        tSim: 0,
        feedId: "f_a",
        datasetId: "d_a",
        cause: "auto",
        etaSeconds: 900,
        costEur: 50,
      },
      // Only ever served STALE — the prefetch never became a fresh serve.
      serve("f_a", "d_a", "stale", 30, true),
    ]);
    const ctx: RunContext = {
      feeds: [{ id: "f_a", datasetId: "d_a" }],
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 950,
    };
    const p = parseRun(log, ctx);
    expect(p.metrics.prefetchesTimely).toBe(0);
    expect(p.metrics.prefetchesWasted).toBe(1);
    expect(p.metrics.wastedPrefetchEur).toBe(50);
  });
});

describe("parseRun — blackout handling (the marquee §4.4 beat)", () => {
  it("a feed that serves through the blackout from cache is 'served through'", () => {
    const log = logOf([
      { kind: "blackout", tick: 0, tSim: 10, feedId: "f_a", edge: "enter" },
      // A viaCache fresh serve WHILE in the window = served through.
      serve("f_a", "d_a", "fresh", 12, true),
      { kind: "blackout", tick: 0, tSim: 40, feedId: "f_a", edge: "exit" },
    ]);
    const ctx: RunContext = {
      feeds: [{ id: "f_a", datasetId: "d_a" }],
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 1000,
    };
    const p = parseRun(log, ctx);
    expect(p.feeds[0].servedThroughBlackout).toBe(true);
    expect(p.metrics.blackoutHandling).toBe("served_through");
    expect(p.metrics.blackoutHandled).toBe(true);
    expect(p.feeds[0].note).toMatch(/served through/i);
  });

  it("a feed that goes blackout_miss with no pre-stage WENT DARK", () => {
    const log = logOf([
      { kind: "blackout", tick: 0, tSim: 10, feedId: "f_a", edge: "enter" },
      serve("f_a", "d_a", "blackout_miss", 10, false),
      { kind: "blackout", tick: 0, tSim: 40, feedId: "f_a", edge: "exit" },
    ]);
    const ctx: RunContext = {
      feeds: [{ id: "f_a", datasetId: "d_a" }],
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 700,
    };
    const p = parseRun(log, ctx);
    expect(p.feeds[0].blackedOut).toBe(true);
    expect(p.feeds[0].servedThroughBlackout).toBe(false);
    expect(p.metrics.blackoutHandling).toBe("went_dark");
    expect(p.metrics.blackoutHandled).toBe(false);
    expect(p.feeds[0].note).toMatch(/went dark/i);
  });

  it("'partial' when some feeds serve through and others go dark", () => {
    const log = logOf([
      { kind: "blackout", tick: 0, tSim: 10, feedId: "f_a", edge: "enter" },
      { kind: "blackout", tick: 0, tSim: 10, feedId: "f_b", edge: "enter" },
      serve("f_a", "d_a", "fresh", 12, true), // a served-through.
      serve("f_b", "d_b", "blackout_miss", 12, false), // a went-dark.
    ]);
    const ctx: RunContext = {
      feeds: TWO_FEEDS,
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 900,
    };
    const p = parseRun(log, ctx);
    expect(p.metrics.blackoutHandling).toBe("partial");
    expect(p.metrics.blackoutHandled).toBe(false); // a feed went dark.
  });

  it("'none' when no blackout occurred", () => {
    const log = logOf([serve("f_a", "d_a", "fresh", 0, true)]);
    const ctx: RunContext = {
      feeds: [{ id: "f_a", datasetId: "d_a" }],
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 1000,
    };
    const p = parseRun(log, ctx);
    expect(p.metrics.blackoutHandling).toBe("none");
    expect(p.metrics.blackoutHandled).toBe(false);
  });
});

describe("parseRun — purity + counts", () => {
  it("is a PURE read: the same log parsed twice is deeply equal, and the log is unchanged", () => {
    const events: SeqlessEvent[] = [
      serve("f_a", "d_a", "fresh", 0, true),
      { kind: "fetch_launch", tick: 0, tSim: 5, feedId: "f_b", datasetId: "d_b", etaSeconds: 900, cause: "miss" },
      {
        kind: "cache_evict",
        tick: 0,
        tSim: 6,
        datasetId: "d_a",
        freshness: 0.3,
        forBy: "d_b",
        reason: "lowest_freshness",
      },
    ];
    const log = logOf(events);
    const before = log.readAll();
    const ctx: RunContext = {
      feeds: TWO_FEEDS,
      startTick: 0,
      endTick: 6000,
      startTSim: 0,
      endTSim: 100,
      openingBalance: 1000,
      closingBalance: 1000,
    };
    const p1 = parseRun(log, ctx);
    const p2 = parseRun(log, ctx);
    expect(p2).toEqual(p1);
    // The record is untouched (readAll returns a copy; the parse never mutates).
    expect(log.readAll()).toEqual(before);
    // Counts fold straight from the stream.
    expect(p1.fetchesLaunched).toBe(1);
    expect(p1.evictions).toBe(1);
    expect(p1.feeds.find((f) => f.id === "f_a")!.evicted).toBe(1);
  });
});
