import { describe, it, expect } from "vitest";
import {
  TRACE_RANK_HYSTERESIS,
  TRACE_ROLL_LINKS,
  TRACE_ROLL_STAMPS,
  axisHeadroom,
  axisTag,
  axisWord,
  bandFor,
  bandGlyph,
  bandOrdinal,
  causeText,
  contractStem,
  degText,
  effectiveCapacity,
  eurText,
  fairShare,
  generationOf,
  hueIndexFor,
  intervalText,
  loadBarText,
  longDelayText,
  lossKey,
  meanGapS,
  mmss,
  msText,
  pctText,
  pipeContended,
  pipeState,
  pushLoss,
  rankDelta,
  rankFlows,
  riderFlag,
  sumFloors,
  unitsText,
  utilisation,
  type LossRollGroup,
  type RankInput,
} from "./trace-derive";

/**
 * SD-53 — the ROUTING SCREEN's arithmetic, pinned headlessly (docs/routing-screen.md §9.6).
 * The retired LinkLoad shipped two arithmetic bugs because its maths lived inside a render method
 * and nothing could reach it. These are the tests that would have caught both.
 */

describe("fairShare — mirrors the router's own allocation exactly", () => {
  it("under capacity every contract gets its full offer", () => {
    expect(fairShare(0.4, 1.0, 1.5)).toBe(0.4);
    expect(fairShare(1.5, 1.5, 1.5)).toBe(1.5); // exactly at capacity is still whole
  });

  it("over capacity the pipe is split in PROPORTION to offered load", () => {
    // router.ts: servedBandwidth = capacity * ownLoad / sharedLoad
    expect(fairShare(1.6, 4.6, 4.0)).toBeCloseTo((4.0 * 1.6) / 4.6, 12);
    expect(fairShare(2.6, 4.6, 4.0)).toBeCloseTo((4.0 * 2.6) / 4.6, 12);
    // the shares sum back to the capacity — no capacity is invented or lost.
    const shares = [1.6, 2.6, 0.4].map((own) => fairShare(own, 4.6, 4.0));
    expect(shares.reduce((a, b) => a + b, 0)).toBeCloseTo(4.0, 12);
  });

  it("a pipe with no capacity serves nobody (defensive, never NaN)", () => {
    expect(fairShare(1.0, 1.0, 0)).toBe(0);
  });
});

describe("effectiveCapacity — the degradation haircut, on the capacity side", () => {
  it("a healthy pipe keeps its rating", () => {
    expect(effectiveCapacity(4.0, 1)).toBe(4.0);
  });

  it("a degrading sat's pipe is derated, and the ratio matches what the ROUTER routed against", () => {
    // The sim scales LOAD up by 1/factor; raw/(cap × factor) is algebraically (raw/factor)/cap.
    const raw = 1.0;
    const factor = 0.5;
    expect(utilisation(raw, effectiveCapacity(2.0, factor))).toBeCloseTo(raw / factor / 2.0, 12);
    expect(effectiveCapacity(2.0, 0.5)).toBe(1.0);
  });

  it("a degenerate or absent factor never inflates capacity", () => {
    expect(effectiveCapacity(2.0, 0)).toBe(2.0);
    expect(effectiveCapacity(2.0, 1.5)).toBe(2.0);
  });
});

describe("pipeState + riderFlag — the WORD channel beside the bar", () => {
  it("reads headroom / tight / over off utilisation", () => {
    expect(pipeState({ load: 1.0, util: 0.5, blind: false })).toBe("headroom");
    expect(pipeState({ load: 1.0, util: 0.8, blind: false })).toBe("tight");
    expect(pipeState({ load: 1.0, util: 1.15, blind: false })).toBe("over");
  });

  it("an unloaded pipe is IDLE and an aimed-but-sightless one is BLIND", () => {
    expect(pipeState({ load: 0, util: 0, blind: false })).toBe("idle");
    expect(pipeState({ load: 0, util: 0, blind: true })).toBe("blind");
    expect(pipeState({ load: 2, util: 2, blind: true })).toBe("blind"); // blind outranks over
  });

  it("STARVED is share below the committed floor; no floor means no flag at all", () => {
    expect(riderFlag(0.53, 0.6)).toBe("starved");
    expect(riderFlag(0.65, 0.6)).toBe("tight"); // within 1.15×
    expect(riderFlag(1.39, 0.6)).toBe("ok");
    expect(riderFlag(1.0, null)).toBe("none"); // bandwidth axis inactive ⇒ absent, not greyed
    expect(riderFlag(1.0, 0)).toBe("none");
  });
});

describe("sumFloors — the Σfloor notch, the promise line", () => {
  it("sums only the committed floors", () => {
    expect(sumFloors([0.6, 2.4, 0.3])).toBeCloseTo(3.3, 12);
    expect(sumFloors([0.6, null, 0.3])).toBeCloseTo(0.9, 12);
    expect(sumFloors([])).toBe(0);
  });

  it("catches an over-promise BEFORE the peak bites (the whole point of the notch)", () => {
    const floors = [0.6, 2.4, 1.8];
    const effCap = 4.0;
    // Current load could be well under capacity while the promises already exceed it.
    expect(utilisation(2.1, effCap)).toBeLessThan(1);
    expect(sumFloors(floors)).toBeGreaterThan(effCap);
  });
});

describe("axisHeadroom — computed, ordered by, never printed", () => {
  it("connectivity: elevation above the gate, saturating at the span", () => {
    expect(axisHeadroom("conn", { carried: 5, asked: 5 })).toBe(0);
    expect(axisHeadroom("conn", { carried: 30, asked: 5 })).toBe(1);
    expect(axisHeadroom("conn", { carried: 7.2, asked: 5 })).toBeCloseTo(2.2 / 25, 12);
    expect(axisHeadroom("conn", { carried: 2, asked: 5 })).toBeLessThan(0); // below the gate
  });

  it("latency: room under the budget, negative when the path is too long", () => {
    expect(axisHeadroom("lat", { carried: 0.0015, asked: 0.003 })).toBeCloseTo(0.5, 12);
    expect(axisHeadroom("lat", { carried: 0.0046, asked: 0.003 })).toBeCloseTo((0.003 - 0.0046) / 0.003, 12);
    expect(axisHeadroom("lat", { carried: Infinity, asked: 0.003 })).toBe(-1);
  });

  it("bandwidth: the share against the floor", () => {
    expect(axisHeadroom("bw", { carried: 0.53, asked: 0.6 })).toBeLessThan(0);
    expect(axisHeadroom("bw", { carried: 1.39, asked: 0.6 })).toBe(1); // clamped
    expect(axisHeadroom("bw", { carried: 1.0, asked: null })).toBe(1); // no floor ⇒ untouched
  });

  it("availability: the room between the held fraction and the bar", () => {
    expect(axisHeadroom("avail", { carried: 1.0, asked: 0.99 })).toBe(1);
    expect(axisHeadroom("avail", { carried: 0.962, asked: 0.99 })).toBeLessThan(0);
    expect(axisHeadroom("avail", { carried: 0.995, asked: 0.99 })).toBeCloseTo(0.5, 6);
  });

  it("is never NaN, whatever the inputs", () => {
    const axes = ["conn", "avail", "lat", "bw"] as const;
    for (const a of axes) {
      for (const carried of [0, 1, Infinity, -1]) {
        for (const asked of [null, 0, 1, Infinity]) {
          expect(Number.isNaN(axisHeadroom(a, { carried, asked }))).toBe(false);
        }
      }
    }
  });
});

describe("bands — the router's verdict outranks any derived number", () => {
  it("unserved is ALWAYS dark, however healthy the headroom looks", () => {
    expect(bandFor(false, 1)).toBe("dark");
    expect(bandFor(false, -5)).toBe("dark");
  });

  it("served splits on the tight band", () => {
    expect(bandFor(true, 0.9)).toBe("clear");
    expect(bandFor(true, 0.05)).toBe("tight");
  });

  it("each band has its own glyph and a fixed ordinal (worst-first)", () => {
    expect(bandGlyph("dark")).toBe("✕");
    expect(bandGlyph("tight")).toBe("▲");
    expect(bandGlyph("clear")).toBe("·");
    expect(bandOrdinal("dark")).toBeLessThan(bandOrdinal("tight"));
    expect(bandOrdinal("tight")).toBeLessThan(bandOrdinal("clear"));
  });
});

describe("rankFlows — a stable order the diurnal load curve cannot shuffle", () => {
  const R = (id: string, band: RankInput["band"], sortKey: number): RankInput => ({ id, band, sortKey });

  it("with no history, bands come first, worst-first", () => {
    const order = rankFlows([R("a", "clear", 0.9), R("b", "dark", 0.0), R("c", "tight", 0.1)], new Map());
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("with no history, lower headroom sorts first inside a band", () => {
    const order = rankFlows([R("a", "clear", 0.9), R("b", "clear", 0.2), R("c", "clear", 0.5)], new Map());
    expect(order).toEqual(["b", "c", "a"]);
  });

  it("a sub-band wobble does NOT reorder the list", () => {
    const prev = new Map([["a", 0], ["b", 1]]);
    const wobble = TRACE_RANK_HYSTERESIS * 0.3;
    expect(rankFlows([R("a", "clear", 0.5), R("b", "clear", 0.5 - wobble)], prev)).toEqual(["a", "b"]);
  });

  it("a wobble ACROSS what used to be a bucket boundary also holds — the bug the playtest caught", () => {
    // 0.11 vs 0.09 quantise to different 0.05 buckets, so the old grid-and-tie-break flipped them
    // on a 0.02 move. A pairwise margin has no boundary to straddle.
    const prev = new Map([["a", 0], ["b", 1]]);
    expect(rankFlows([R("a", "clear", 0.11), R("b", "clear", 0.09)], prev)).toEqual(["a", "b"]);
    expect(rankFlows([R("a", "clear", 0.1251), R("b", "clear", 0.1249)], prev)).toEqual(["a", "b"]);
  });

  it("a real move of more than the band DOES overtake", () => {
    const prev = new Map([["a", 0], ["b", 1]]);
    expect(rankFlows([R("a", "clear", 0.5), R("b", "clear", 0.5 - TRACE_RANK_HYSTERESIS * 2)], prev)).toEqual(["b", "a"]);
  });

  it("a band change overtakes immediately, however small the key difference", () => {
    const prev = new Map([["a", 0], ["b", 1]]);
    expect(rankFlows([R("a", "clear", 0.5), R("b", "dark", 0.5)], prev)).toEqual(["b", "a"]);
  });

  it("survives a full oscillation without a single inversion (the playtest falsifier, headlessly)", () => {
    // Two rows whose headrooms wobble against each other, with the gap staying INSIDE the band
    // for the whole run (0.02 base ± 2×0.0125 peaks at 0.045 < 0.05) — so no overtake is earned.
    let prev = new Map<string, number>();
    let order = rankFlows([R("a", "clear", 0.30), R("b", "clear", 0.28)], prev);
    const seen = new Set<string>();
    for (let i = 0; i < 200; i++) {
      const wob = Math.sin(i / 7) * (TRACE_RANK_HYSTERESIS * 0.25);
      prev = new Map(order.map((id, idx) => [id, idx]));
      order = rankFlows([R("a", "clear", 0.30 + wob), R("b", "clear", 0.28 - wob)], prev);
      seen.add(order.join(","));
    }
    expect([...seen]).toEqual(["a,b"]);
  });

  it("…but a gap that grows PAST the band is a real move, and the list follows it", () => {
    let prev = new Map([["a", 0], ["b", 1]]);
    // b sinks steadily until it is worse than a by more than the band; then, and only then, it rises.
    let order = ["a", "b"];
    const flips: number[] = [];
    for (let i = 0; i < 40; i++) {
      const kb = 0.28 - i * 0.005;
      prev = new Map(order.map((id, idx) => [id, idx]));
      const next = rankFlows([R("a", "clear", 0.30), R("b", "clear", kb)], prev);
      if (next.join(",") !== order.join(",")) flips.push(i);
      order = next;
    }
    expect(order).toEqual(["b", "a"]);
    expect(flips).toHaveLength(1); // exactly one crossing, not a flutter
  });

  it("is deterministic and total for rows nobody has seen", () => {
    const items = [R("z", "clear", 0.5), R("a", "clear", 0.5), R("m", "clear", 0.5)];
    expect(rankFlows(items, new Map())).toEqual(["a", "m", "z"]);
    expect(rankFlows([...items].reverse(), new Map())).toEqual(["a", "m", "z"]);
  });

  it("a new DARK row reaches the top of the board even though it has no history", () => {
    const prev = new Map([["a", 0], ["b", 1], ["c", 2]]);
    const order = rankFlows(
      [R("a", "clear", 0.9), R("b", "clear", 0.8), R("c", "clear", 0.7), R("new", "dark", 0)],
      prev,
    );
    expect(order[0]).toBe("new");
  });

  it("rankDelta reports the direction of a move, and says nothing about a new row", () => {
    const prev = new Map([["a", 2]]);
    expect(rankDelta("a", 0, prev)).toBe(-1);
    expect(rankDelta("a", 4, prev)).toBe(1);
    expect(rankDelta("a", 2, prev)).toBe(0);
    expect(rankDelta("new", 0, prev)).toBe(0);
  });
});

describe("pipeContended — hysteresis on the CONTENDED bucket", () => {
  it("enters at 1.00 and does not leave until it falls under 0.94", () => {
    expect(pipeContended(0.99, false, false)).toBe(false);
    expect(pipeContended(1.0, false, false)).toBe(true);
    expect(pipeContended(0.96, false, true)).toBe(true); // still contended — inside the band
    expect(pipeContended(0.93, false, true)).toBe(false);
  });

  it("a starving rider makes a pipe contended at ANY utilisation", () => {
    expect(pipeContended(0.1, true, false)).toBe(true);
  });
});

describe("the loss roll — keeps atS, so the spacing is visible", () => {
  const roll = (): Map<string, LossRollGroup> => new Map();

  it("groups by link AND cause", () => {
    const r = roll();
    pushLoss(r, { aId: "REGION-1", bId: "GROUND-1", cause: "set_below_horizon", atS: 100 }, 5);
    pushLoss(r, { aId: "REGION-1", bId: "GROUND-1", cause: "out_of_budget", atS: 101 }, 5);
    expect(r.size).toBe(2);
    expect(r.has(lossKey("REGION-1", "GROUND-1", "set_below_horizon"))).toBe(true);
  });

  it("keeps EVERY repeat — unlike the WIRE, which drops the time and logs once", () => {
    const r = roll();
    for (const t of [100, 250, 400, 550]) {
      pushLoss(r, { aId: "R", bId: "S", cause: "set_below_horizon", atS: t }, 5);
    }
    expect(r.get(lossKey("R", "S", "set_below_horizon"))?.times).toEqual([100, 250, 400, 550]);
  });

  it("collapses a re-stamp of the SAME outage still in progress", () => {
    const r = roll();
    pushLoss(r, { aId: "R", bId: "S", cause: "set_below_horizon", atS: 100 }, 5);
    pushLoss(r, { aId: "R", bId: "S", cause: "set_below_horizon", atS: 101 }, 5); // same outage
    pushLoss(r, { aId: "R", bId: "S", cause: "set_below_horizon", atS: 104.9 }, 5);
    expect(r.get(lossKey("R", "S", "set_below_horizon"))?.times).toEqual([100]);
  });

  it("retains a bounded number of stamps per link and links per roll", () => {
    const r = roll();
    for (let i = 0; i < TRACE_ROLL_STAMPS + 4; i++) {
      pushLoss(r, { aId: "R", bId: "S", cause: "set_below_horizon", atS: i * 100 }, 5);
    }
    const times = r.get(lossKey("R", "S", "set_below_horizon"))?.times ?? [];
    expect(times).toHaveLength(TRACE_ROLL_STAMPS);
    expect(times[times.length - 1]).toBe((TRACE_ROLL_STAMPS + 3) * 100); // the newest survives

    const r2 = roll();
    for (let i = 0; i < TRACE_ROLL_LINKS + 5; i++) {
      pushLoss(r2, { aId: `R${i}`, bId: "S", cause: "set_below_horizon", atS: i }, 5);
    }
    expect(r2.size).toBeLessThanOrEqual(TRACE_ROLL_LINKS);
  });

  it("the OBSERVED spacing appears only once there is a rhythm to observe", () => {
    expect(meanGapS([100])).toBeNull();
    expect(meanGapS([100, 250])).toBeNull(); // two stamps is an anecdote
    expect(meanGapS([100, 250, 400])).toBe(150); // three is a rhythm — one LEO orbit
    expect(meanGapS([100, 250, 400, 552])).toBeCloseTo(150.67, 2);
  });
});

describe("identity — renewals keep their lineage", () => {
  it("parses the renewal generation off the contract id", () => {
    expect(generationOf("REGION-0")).toBe(0);
    expect(generationOf("REGION-0+R1")).toBe(1);
    expect(generationOf("REGION-0+R12")).toBe(12);
  });

  it("the stem survives every generation", () => {
    expect(contractStem("REGION-0+R3")).toBe("REGION-0");
    expect(contractStem("REGION-0")).toBe("REGION-0");
    expect(contractStem("MARS-1")).toBe("MARS-1");
  });

  it("a renewal keeps the identity hue its region had — the globe and the row stay in sync", () => {
    expect(hueIndexFor("REGION-0+R4", 6)).toBe(hueIndexFor("REGION-0", 6));
    expect(hueIndexFor("REGION-1", 6)).toBeGreaterThanOrEqual(0);
    expect(hueIndexFor("REGION-1", 6)).toBeLessThan(6);
  });
});

describe("formats — the enum and the raw second never reach a player", () => {
  it("phrases every geometric cause the router can stamp", () => {
    expect(causeText("set_below_horizon")).toBe("set below the horizon");
    expect(causeText("out_of_budget")).toBe("out of link budget");
    expect(causeText("occluded")).toBe("occluded by the body");
    // Whatever arrives, it never reaches the player with an underscore in it.
    for (const c of ["set_below_horizon", "out_of_budget", "occluded", "some_future_cause"]) {
      expect(causeText(c)).not.toMatch(/_/);
    }
  });

  it("mission time, intervals and long delays", () => {
    expect(mmss(0)).toBe("0:00");
    expect(mmss(47)).toBe("0:47");
    expect(mmss(761)).toBe("12:41");
    expect(mmss(-5)).toBe("0:00");
    expect(intervalText(48)).toBe("~48s");
    expect(intervalText(62)).toBe("~1m02s");
    expect(intervalText(130)).toBe("~2m10s");
    expect(longDelayText(925)).toBe("15m 25s");
  });

  it("the physical readouts", () => {
    expect(msText(0.0046)).toBe("4.6 ms");
    expect(msText(Infinity)).toBe("∞");
    expect(unitsText(4)).toBe("4.00");
    expect(pctText(1.153)).toBe("115%");
    expect(degText(18.44)).toBe("18.4°");
    expect(eurText(2400)).toBe("€2,400");
  });

  it("maps the sim's axis vocabulary onto the printed tags and words", () => {
    expect(axisTag("latency")).toBe("lat");
    expect(axisTag("bandwidth")).toBe("bw");
    expect(axisTag("availability")).toBe("avail");
    expect(axisTag("connectivity")).toBe("conn");
    expect(axisWord("lat")).toBe("LATENCY");
    expect(axisWord("bw")).toBe("BW");
  });
});

describe("loadBarText — width, texture and numeral are three separate channels", () => {
  it("an empty pipe is all empty cells", () => {
    expect(loadBarText(0)).toBe("░░░░░░░░");
  });

  it("fills proportionally, and never shows a loaded pipe as empty", () => {
    expect(loadBarText(0.5)).toBe("▓▓▓▓░░░░");
    expect(loadBarText(0.75)).toBe("▓▓▓▓▓▓░░");
    expect(loadBarText(0.01)).toBe("▓░░░░░░░"); // load exists ⇒ at least one cell
  });

  it("at or over capacity the whole bar changes MATERIAL — legible with colour off", () => {
    expect(loadBarText(1.0)).toBe("▒▒▒▒▒▒▒▒");
    expect(loadBarText(3.5)).toBe("▒▒▒▒▒▒▒▒");
  });

  it("keeps a fixed width however far past capacity it goes (the column stays aligned)", () => {
    for (const u of [0, 0.3, 0.99, 1, 12]) expect(loadBarText(u)).toHaveLength(8);
  });
});
