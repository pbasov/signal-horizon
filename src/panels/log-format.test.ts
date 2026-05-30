import { describe, it, expect } from "vitest";
import { formatEvent, warmthOf } from "./log-format";
import type { M1Event } from "../sim/m1/eventlog";

/**
 * E9 (M1-10b) — the SYSTEM.LOG render formatter. Pure (DOM-free) mapping from a
 * truthful M1Event to §8-syntax-highlighted tokens. These pin: the freshness ramp
 * buckets, the per-kind severity + token slots, and that the formatter never
 * invents data (every token comes from the event payload).
 */

const base = { seq: 7, tick: 600, tSim: 10 } as const;

describe("warmthOf — the §8 freshness ramp buckets", () => {
  it("warm when fresh, cooling as it stales, dead when gone", () => {
    expect(warmthOf(0.9)).toBe("good");
    expect(warmthOf(0.75)).toBe("good");
    expect(warmthOf(0.6)).toBe("watch");
    expect(warmthOf(0.3)).toBe("warn");
    expect(warmthOf(0)).toBe("dead");
  });
});

describe("formatEvent — per-token highlighting", () => {
  it("a serve transition carries the band words and (when via cache) a warmth-bucketed freshness value", () => {
    const ev: M1Event = {
      kind: "serve",
      ...base,
      feedId: "mars_imagery",
      datasetId: "earth_imagery",
      band: "stale",
      from: "fresh",
      freshness: 0.6,
      viaCache: true,
    };
    const row = formatEvent(ev);
    expect(row.sev).toBe("warn"); // stale → warn colour
    expect(row.tokens.find((t) => t.slot === "ent")?.text).toBe("mars_imagery");
    const val = row.tokens.find((t) => t.slot === "val");
    expect(val?.text).toBe("60%");
    expect(val?.cls).toBe("watch"); // 0.6 → watch bucket
    expect(row.tokens.find((t) => t.slot === "msg")?.text).toBe("FRESH → STALE");
  });

  it("a blackout_miss serve is critical and has no via-cache freshness value", () => {
    const ev: M1Event = {
      kind: "serve",
      ...base,
      feedId: "mars_comms",
      datasetId: "earth_comms",
      band: "blackout_miss",
      from: "miss",
      freshness: 0,
      viaCache: false,
    };
    const row = formatEvent(ev);
    expect(row.sev).toBe("crit");
    expect(row.tokens.some((t) => t.slot === "val")).toBe(false);
    expect(row.tokens.find((t) => t.slot === "msg")?.text).toBe("MISS → BLACKOUT");
  });

  it("fetch_arrive surfaces the TRUE landed freshness (the old 0.50 lie's replacement)", () => {
    const ev: M1Event = {
      kind: "fetch_arrive",
      ...base,
      feedId: "mars_science",
      datasetId: "earth_science",
      landedFreshness: 0.82,
    };
    const row = formatEvent(ev);
    const val = row.tokens.find((t) => t.slot === "val");
    expect(val?.text).toBe("82%");
    expect(val?.cls).toBe("good");
    expect(row.tokens.find((t) => t.slot === "msg")?.text).toContain("landed freshness");
  });

  it("a cache_evict names the victim, its staleness, and what forced it", () => {
    const ev: M1Event = {
      kind: "cache_evict",
      ...base,
      datasetId: "earth_weather",
      freshness: 0.2,
      forBy: "earth_imagery",
      reason: "lowest_freshness",
    };
    const row = formatEvent(ev);
    expect(row.sev).toBe("warn");
    expect(row.tokens.find((t) => t.slot === "ent")?.text).toBe("earth_weather");
    expect(row.tokens.find((t) => t.slot === "val")?.cls).toBe("warn"); // 0.2 cooling
    expect(row.tokens.find((t) => t.slot === "msg")?.text).toContain("for earth_imagery");
  });

  it("prefetch distinguishes manual / auto / prestage and shows the € charge", () => {
    const mk = (cause: "manual" | "auto" | "prestage"): M1Event => ({
      kind: "prefetch",
      ...base,
      feedId: "mars_telemetry",
      datasetId: "earth_telemetry",
      cause,
      etaSeconds: 900,
      costEur: 50,
    });
    expect(formatEvent(mk("manual")).tokens.find((t) => t.slot === "msg")?.text).toContain("MANUAL");
    const auto = formatEvent(mk("auto"));
    expect(auto.tokens.find((t) => t.slot === "msg")?.text).toContain("AUTO");
    expect(auto.tokens.find((t) => t.slot === "val")?.text).toBe("−€50");
    const pre = formatEvent(mk("prestage"));
    expect(pre.sev).toBe("warn"); // pre-stage is the relief firing ahead of a blackout
    expect(pre.tokens.find((t) => t.slot === "msg")?.text).toContain("PRE-STAGE");
  });

  it("a policy change records from→to and the floor", () => {
    const ev: M1Event = {
      kind: "policy",
      ...base,
      mode: "freshness_blackout",
      floor: 0.7,
      from: "manual",
    };
    const row = formatEvent(ev);
    expect(row.tokens.find((t) => t.slot === "ent")?.text).toBe("AUTOPILOT");
    expect(row.tokens.find((t) => t.slot === "val")?.text).toBe("70%");
    expect(row.tokens.find((t) => t.slot === "msg")?.text).toContain("manual → freshness_blackout");
  });

  it("a blackout enter is critical; exit is info", () => {
    const enter: M1Event = { kind: "blackout", ...base, feedId: "mars_imagery", edge: "enter" };
    const exit: M1Event = { kind: "blackout", ...base, feedId: "mars_imagery", edge: "exit" };
    expect(formatEvent(enter).sev).toBe("crit");
    expect(formatEvent(enter).tokens.find((t) => t.slot === "msg")?.text).toContain("LINK LOST");
    expect(formatEvent(exit).sev).toBe("info");
  });

  it("every row leads with a timestamp token and a severity glyph", () => {
    const ev: M1Event = {
      kind: "fetch_launch",
      ...base,
      feedId: "mars_imagery",
      datasetId: "earth_imagery",
      etaSeconds: 900,
      cause: "miss",
    };
    const row = formatEvent(ev);
    expect(row.tokens[0].slot).toBe("ts");
    expect(row.tokens[1].slot).toBe("sev");
  });
});
