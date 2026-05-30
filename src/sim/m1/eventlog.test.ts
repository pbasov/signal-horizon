import { describe, it, expect } from "vitest";
import { EventLog, type M1Event } from "./eventlog";

/**
 * E9 (M1-10b) — EventLog unit tests: the PURE core of the truthful event log.
 *
 * These pin the buffer's contract independent of the session: APPEND/READ
 * ORDERING (oldest→newest, stable seq), the CAP/DROP policy (bounded ring drops
 * the OLDEST while seq stays monotonic), PAYLOAD INTEGRITY (readAll returns a copy
 * — the record cannot be mutated by a caller), and PURITY (no DOM/three/clock —
 * this file imports only the module under test).
 *
 * The session-level COMPLETENESS + HONESTY + cross-replay DETERMINISM of the
 * stream is proven in eventlog-replay.test.ts (a recorded run vs a replay of the
 * same action log produce the identical ordered sequence).
 */

/** A tiny serve event factory for the buffer tests (payload shape is incidental here). */
function serveAt(tick: number, feedId: string): (seq: number) => M1Event {
  return (seq) => ({
    kind: "serve",
    seq,
    tick,
    tSim: tick / 60,
    feedId,
    datasetId: `${feedId}_data`,
    band: "fresh",
    from: null,
    freshness: 0.8,
    viaCache: true,
  });
}

describe("EventLog — append / read ordering", () => {
  it("retains events oldest→newest and stamps a monotonic seq from 0", () => {
    const log = new EventLog();
    log.push(serveAt(1, "a"));
    log.push(serveAt(2, "b"));
    log.push(serveAt(3, "c"));

    const all = log.readAll();
    expect(all.map((e) => e.seq)).toEqual([0, 1, 2]);
    expect(all.map((e) => (e.kind === "serve" ? e.feedId : ""))).toEqual(["a", "b", "c"]);
    expect(log.size).toBe(3);
    expect(log.appended).toBe(3);
  });

  it("push returns the appended event carrying its stamped seq", () => {
    const log = new EventLog();
    const first = log.push(serveAt(1, "a"));
    const second = log.push(serveAt(2, "b"));
    expect(first.seq).toBe(0);
    expect(second.seq).toBe(1);
  });
});

describe("EventLog — cap / drop-oldest policy", () => {
  it("a bounded ring drops the OLDEST once over cap, but seq stays monotonic across drops", () => {
    const log = new EventLog(3); // cap 3
    for (let i = 0; i < 5; i++) log.push(serveAt(i, `f${i}`));

    const all = log.readAll();
    // Only the last 3 survive; their ORIGINAL seq (2,3,4) is preserved — a dropped
    // event never makes a surviving event lie about its ordinal.
    expect(all.map((e) => e.seq)).toEqual([2, 3, 4]);
    expect(log.size).toBe(3);
    // appended counts the TOTAL ever pushed, including dropped ones.
    expect(log.appended).toBe(5);
  });

  it("an unbounded log (default) never drops", () => {
    const log = new EventLog();
    for (let i = 0; i < 1000; i++) log.push(serveAt(i, "x"));
    expect(log.size).toBe(1000);
    expect(log.readAll()[0].seq).toBe(0);
  });

  it("a non-positive cap is treated as unbounded (never silently drops the record)", () => {
    const log = new EventLog(0);
    for (let i = 0; i < 10; i++) log.push(serveAt(i, "x"));
    expect(log.size).toBe(10);
  });
});

describe("EventLog — incremental read (the render drain)", () => {
  it("readSince returns only the suffix with seq >= sinceSeq", () => {
    const log = new EventLog();
    for (let i = 0; i < 5; i++) log.push(serveAt(i, `f${i}`));
    expect(log.readSince(0).map((e) => e.seq)).toEqual([0, 1, 2, 3, 4]);
    expect(log.readSince(3).map((e) => e.seq)).toEqual([3, 4]);
    // The common steady-state case: caller is caught up → empty tail, no work.
    expect(log.readSince(5)).toEqual([]);
  });

  it("readSince on a bounded log returns surviving events with seq >= sinceSeq", () => {
    const log = new EventLog(3);
    for (let i = 0; i < 6; i++) log.push(serveAt(i, `f${i}`)); // seqs 3,4,5 survive
    expect(log.readSince(0).map((e) => e.seq)).toEqual([3, 4, 5]); // 0..2 already dropped
    expect(log.readSince(4).map((e) => e.seq)).toEqual([4, 5]);
  });
});

describe("EventLog — payload integrity + purity", () => {
  it("readAll returns a COPY: mutating the result cannot corrupt the record", () => {
    const log = new EventLog();
    log.push(serveAt(1, "a"));
    const snap = log.readAll();
    snap.pop();
    snap.push(serveAt(99, "evil")(99));
    // The internal record is untouched.
    expect(log.size).toBe(1);
    expect(log.readAll().map((e) => e.seq)).toEqual([0]);
  });

  it("clear() resets retention AND the ordinal stream to a fresh, reproducible 0", () => {
    const log = new EventLog();
    log.push(serveAt(1, "a"));
    log.push(serveAt(2, "b"));
    log.clear();
    expect(log.size).toBe(0);
    expect(log.appended).toBe(0);
    const e = log.push(serveAt(3, "c"));
    expect(e.seq).toBe(0);
  });
});
