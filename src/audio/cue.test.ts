import { describe, it, expect } from "vitest";
import {
  CueBus,
  emitCueTransition,
  type CueEvent,
  type CueDemandSlice,
} from "./cue";

/**
 * M1-11 — the one-way audio event bus, tested WITHOUT real sound. The Web Audio
 * synth (AudioCue) needs a browser AudioContext and is not exercised here; what
 * IS pinned is the sim→render seam the brief asks for: the bus drains in order,
 * a cue callback fires per event, and the pure transition-detector emits the
 * right cue on the right edge (so "a cache hit is an audible event" — and only
 * on the edge, never on a steady state).
 */

const slice = (over: Partial<CueDemandSlice> = {}): CueDemandSlice => ({
  fetchInFlight: false,
  viaCache: false,
  outcome: "miss",
  ...over,
});

describe("CueBus — the one-way drain", () => {
  it("drains queued cues in emit order into the sink callback, then empties", () => {
    const bus = new CueBus();
    bus.emit("fetch_arrival", 10);
    bus.emit("cache_hit", 11);
    expect(bus.pending).toBe(2);

    const seen: CueEvent[] = [];
    const n = bus.drain((e) => seen.push(e));

    expect(n).toBe(2);
    expect(seen.map((e) => e.kind)).toEqual(["fetch_arrival", "cache_hit"]);
    expect(seen.map((e) => e.tSim)).toEqual([10, 11]);
    expect(bus.pending).toBe(0);
  });

  it("a second drain after no emits fires the callback zero times", () => {
    const bus = new CueBus();
    bus.emit("cache_hit", 1);
    bus.drain(() => {});
    let calls = 0;
    const n = bus.drain(() => calls++);
    expect(n).toBe(0);
    expect(calls).toBe(0);
  });

  it("bounds the backlog to the cap, dropping the oldest cues", () => {
    const bus = new CueBus(3);
    for (let i = 0; i < 5; i++) bus.emit("cache_hit", i);
    const seen: number[] = [];
    bus.drain((e) => seen.push(e.tSim));
    // Only the 3 most-recent survive (oldest 0,1 dropped).
    expect(seen).toEqual([2, 3, 4]);
  });
});

describe("emitCueTransition — cue on the edge, silent on steady state", () => {
  it("fires fetch_arrival when an in-flight fetch lands (fetchInFlight true → false)", () => {
    const bus = new CueBus();
    const prev = slice({ fetchInFlight: true, outcome: "miss" });
    const next = slice({ fetchInFlight: false, viaCache: true, outcome: "fresh" });
    emitCueTransition(bus, prev, next, 42);
    const seen: CueEvent[] = [];
    bus.drain((e) => seen.push(e));
    // arrival AND the cache_hit edge both fire on the landing step.
    expect(seen.map((e) => e.kind)).toContain("fetch_arrival");
    expect(seen.map((e) => e.kind)).toContain("cache_hit");
    expect(seen.every((e) => e.tSim === 42)).toBe(true);
  });

  it("fires cache_hit only on the rising edge into serving-from-cache", () => {
    const bus = new CueBus();
    // miss → hit: a cache_hit edge.
    emitCueTransition(bus, slice({ viaCache: false }), slice({ viaCache: true, outcome: "fresh" }), 1);
    // hit → hit (steady): NO new cache_hit.
    emitCueTransition(
      bus,
      slice({ viaCache: true, outcome: "fresh" }),
      slice({ viaCache: true, outcome: "fresh" }),
      2,
    );
    const seen: CueEvent[] = [];
    bus.drain((e) => seen.push(e));
    expect(seen.filter((e) => e.kind === "cache_hit")).toHaveLength(1);
  });

  it("fires stale on entry into the stale band, and blackout on entry into blackout_miss", () => {
    const bus = new CueBus();
    emitCueTransition(bus, slice({ outcome: "fresh", viaCache: true }), slice({ outcome: "stale", viaCache: true }), 5);
    emitCueTransition(bus, slice({ outcome: "stale" }), slice({ outcome: "blackout_miss" }), 6);
    const seen: CueEvent[] = [];
    bus.drain((e) => seen.push(e));
    expect(seen.map((e) => e.kind)).toContain("stale");
    expect(seen.map((e) => e.kind)).toContain("blackout");
  });

  it("emits nothing on a steady miss (no edges)", () => {
    const bus = new CueBus();
    emitCueTransition(bus, slice({ outcome: "miss" }), slice({ outcome: "miss" }), 7);
    expect(bus.pending).toBe(0);
  });

  it("treats a null prior state as the first observation (fires the present edges)", () => {
    const bus = new CueBus();
    emitCueTransition(bus, null, slice({ viaCache: true, outcome: "fresh" }), 0);
    const seen: CueEvent[] = [];
    bus.drain((e) => seen.push(e));
    expect(seen.map((e) => e.kind)).toEqual(["cache_hit"]);
  });
});
