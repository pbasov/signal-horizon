import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { earthMarsLos, lineOfSight, SOLAR_CORRIDOR_RSUN } from "../links";
import { oneWaySeconds } from "../delay";
import { feasible, resolve, DEFAULT_BLACKOUT_PENALTY } from "./resolver";
import { selectAutoPrefetches, type PolicyFeedState } from "./policy";
import { buildFeeds } from "./feeds";
import { M1Session } from "./session";
import { revenueRatePerSecond, BLACKOUT_PENALTY_RATE_PER_SECOND } from "./economy";

/**
 * E10a — THE CONJUNCTION-BLACKOUT CORRIDOR, PROVEN AGAINST THE REAL EPHEMERIS.
 *
 * This retires SD-22 properly. The §4.4/§3a MARQUEE transferable insight —
 * "pre-stage the cache before the predictable conjunction blackout and you beat
 * the light-gap" — was dormant in real play: the Earth↔Mars line of sight never
 * crosses the 1-Rsun solar disk (tightest miss ≈3.322 Rsun over a full synodic
 * period), so the old disk-occlusion blackout never fired live and
 * freshness_blackout was proven only against a FAKE ephemeris.
 *
 * Modelling the blackout as a solar-interference CORRIDOR (link dead when the
 * LOS passes within {@link SOLAR_CORRIDOR_RSUN} Rsun of the Sun centre — the
 * physically-honest small-SEP RF-noise criterion) makes the conjunction blackout
 * LIVE. These tests scan the REAL eph to FIND the conjunction, then prove the
 * full pathway end-to-end against real geometry:
 *   1. at conjunction the link is INFEASIBLE and an un-cached feed resolves
 *      blackout_miss (the SLA-penalty band);
 *   2. blackout ENTER/EXIT events bracket the corridor window;
 *   3. freshness_blackout PRE-STAGES ahead of the real conjunction, and a
 *      pre-staged feed SERVES THROUGH the blackout from cache while an un-staged
 *      feed takes blackout_miss — the marquee payoff, on real geometry.
 */

const eph = loadEphemeris();

/**
 * Scan the real ephemeris for the Earth↔Mars conjunction: the t minimising the
 * Sun-centre→LOS-segment miss distance. Coarse sweep then a fine refine. Pure of
 * the eph — no clock/RNG. Returns the epoch and the minimum margin (Rsun).
 */
function findConjunction(): { t: number; marginRsun: number } {
  let best = { t: 0, marginRsun: Infinity };
  for (let t = 0; t <= 9.0e7; t += 1000) {
    const m = earthMarsLos(eph, t).marginSolarRadii;
    if (m < best.marginRsun) best = { t, marginRsun: m };
  }
  let refined = best;
  for (let t = best.t - 1000; t <= best.t + 1000; t += 1) {
    const m = earthMarsLos(eph, t).marginSolarRadii;
    if (m < refined.marginRsun) refined = { t, marginRsun: m };
  }
  return refined;
}

/** Bracket the corridor blackout window around the conjunction at the default N. */
function findWindow(conjT: number): { enter: number; exit: number; widthS: number } {
  let enter = NaN;
  let exit = NaN;
  let inW = false;
  for (let t = conjT - 4e6; t <= conjT + 4e6; t += 50) {
    const down = !lineOfSight(eph, "earth", "mars", t, ["sun"]);
    if (down && !inW) {
      enter = t;
      inW = true;
    }
    if (!down && inW) {
      exit = t;
      inW = false;
    }
  }
  return { enter, exit, widthS: exit - enter };
}

const CONJ = findConjunction();
const WIN = findWindow(CONJ.t);

describe("conjunction epoch — found by scanning the REAL ephemeris", () => {
  it("the tightest Sun-miss over a synodic period is ≈3.322 Rsun (the SD-22 figure)", () => {
    expect(CONJ.marginRsun).toBeGreaterThan(3.3);
    expect(CONJ.marginRsun).toBeLessThan(3.34);
    // The conjunction epoch is ≈ t = 15.73e6 s (reported in the structured summary).
    expect(CONJ.t).toBeGreaterThan(15_700_000);
    expect(CONJ.t).toBeLessThan(15_760_000);
  });

  it("the default corridor opens a real, multi-day blackout WINDOW around conjunction", () => {
    expect(Number.isFinite(WIN.enter)).toBe(true);
    expect(Number.isFinite(WIN.exit)).toBe(true);
    expect(WIN.enter).toBeLessThan(CONJ.t);
    expect(WIN.exit).toBeGreaterThan(CONJ.t);
    // ≈582,650 s ≈ 6.7 days — wide enough to be a genuine, teachable stress beat.
    expect(WIN.widthS).toBeGreaterThan(500_000);
    expect(WIN.widthS / 86400).toBeGreaterThan(6); // > 6 days
  });
});

describe("the blackout pathway lights up at the real conjunction", () => {
  it("feasible() is FALSE in-corridor at conjunction but TRUE well outside it", () => {
    // Inside the corridor → infeasible. Far outside → feasible.
    expect(feasible(eph, CONJ.t, "earth", "mars")).toBe(false);
    expect(feasible(eph, CONJ.t - 2_000_000, "earth", "mars")).toBe(true);
    expect(feasible(eph, CONJ.t + 2_000_000, "earth", "mars")).toBe(true);
    // The corridor verdict matches earthMarsLos.inCorridor (the readout source).
    expect(earthMarsLos(eph, CONJ.t).inCorridor).toBe(true);
    // But the physical disk is NEVER crossed (SD-22's dormancy) — N=1 is feasible.
    expect(lineOfSight(eph, "earth", "mars", CONJ.t, ["sun"], 1)).toBe(true);
    expect(earthMarsLos(eph, CONJ.t).occulted).toBe(false);
  });

  it("an un-cached feed RESOLVES blackout_miss at conjunction (link down, empty cache)", () => {
    const feed = buildFeeds()[0]; // mars_imagery, dataset earth_imagery
    const linkOpen = feasible(eph, CONJ.t, feed.sourceId, feed.customerId);
    expect(linkOpen).toBe(false);
    const r = resolve(eph, CONJ.t, feed, null, linkOpen);
    expect(r.outcome).toBe("blackout_miss");
    // The resolver applies the SLA penalty as a NEGATIVE payout — the deepest hit.
    expect(r.payout).toBe(-DEFAULT_BLACKOUT_PENALTY);
    expect(r.viaCache).toBe(false);
  });

  it("the economy applies the SLA penalty RATE for a blackout_miss band", () => {
    // The session sums revenueRatePerSecond over feed bands; a blackout band is a
    // negative rate (the SLA penalty), so the accrual burns extra during blackout.
    expect(revenueRatePerSecond("blackout_miss")).toBe(-BLACKOUT_PENALTY_RATE_PER_SECOND);
    expect(revenueRatePerSecond("blackout_miss")).toBeLessThan(0);
  });

  it("a session stepped THROUGH the corridor emits blackout ENTER then EXIT, bracketing it", () => {
    // The session is a pure function of t, so step it at the window edges directly
    // (a coarse dt is fine — the events are edge-triggered on feasibility flips).
    // Prime prevFeasible with a pre-window step (link up), then step in-corridor
    // (enter), then post-window (exit).
    const session = new M1Session();
    const dt = 1000;
    session.step(eph, WIN.enter - 5000, dt); // link UP — primes prevFeasible=true
    session.step(eph, CONJ.t, dt); // deep IN the corridor — link flips DOWN (enter)
    session.step(eph, WIN.exit + 5000, dt); // OUT the far side — link flips UP (exit)

    const blackouts = session.events.readAll().filter((e) => e.kind === "blackout");
    expect(blackouts.length).toBeGreaterThan(0);
    // For mars_imagery: an enter (down) on the conjunction step, an exit (up) after.
    const imagery = blackouts.filter((e) => e.kind === "blackout" && e.feedId === "mars_imagery");
    expect(imagery.length).toBe(2);
    expect(imagery[0].kind === "blackout" && imagery[0].edge).toBe("enter");
    expect(imagery[1].kind === "blackout" && imagery[1].edge).toBe("exit");
    // The enter is in-corridor, the exit out of it (the bracket is geometrically true).
    expect(imagery[0].tSim).toBe(CONJ.t);
    expect(imagery[1].tSim).toBe(WIN.exit + 5000);
  });
});

describe("the marquee payoff — freshness_blackout PRE-STAGES live, then serves through", () => {
  it("selectAutoPrefetches pre-stages ahead of the REAL conjunction (feasible now, infeasible at t+lead)", () => {
    // Pick a t BEFORE the window where the link is up NOW but down within a lead
    // that exceeds the one-way light time (so the leg can land before the gap).
    const ow = oneWaySeconds(eph.distanceBetween("earth", "mars", WIN.enter));
    const lead = Math.ceil(ow) + 600; // lead > one-way so a pre-stage actually beats the gap
    // A t at which: feasible(t) true, feasible(t+lead) false (forecast blackout).
    const t = WIN.enter - Math.floor(lead / 2);
    expect(feasible(eph, t, "earth", "mars")).toBe(true);
    expect(feasible(eph, t + lead, "earth", "mars")).toBe(false);

    const feeds = buildFeeds();
    const session = new M1Session();
    session.setPolicy(
      { mode: "freshness_blackout", freshnessFloor: 0.7, blackoutLeadS: lead, maxConcurrentAuto: 5 },
      0,
      0,
    );
    // PURE selector: every eligible feed (link up, no leg) is a forecast-blackout
    // pre-stage at this t — the autopilot tops them all up before the gap.
    const pfStates: PolicyFeedState[] = feeds.map((f) => ({
      id: f.id,
      datasetId: f.datasetId,
      sourceId: f.sourceId,
      customerId: f.customerId,
      inFlight: false,
    }));
    const targets = selectAutoPrefetches(session.policy, pfStates, session.cache, eph, t);
    expect(targets.length).toBeGreaterThan(0);

    // Driving the session at this t logs the prefetch with cause "prestage".
    session.step(eph, t, 1);
    const prestages = session.events
      .readAll()
      .filter((e) => e.kind === "prefetch" && e.cause === "prestage");
    expect(prestages.length).toBeGreaterThan(0);
  });

  it("a PRE-STAGED feed serves THROUGH the blackout from cache while an UN-STAGED feed takes blackout_miss", () => {
    const feeds = buildFeeds();
    const staged = feeds.find((f) => f.id === "mars_science")!; // long half-life — survives the gap entry
    const unstaged = feeds.find((f) => f.id === "mars_weather")!;

    const session = new M1Session();
    // Pre-position ONLY the staged feed's dataset into the shared cache, captured a
    // one-way light time before the blackout opens (an honest pre-stage: the copy
    // crossed the gap before the link died). The un-staged feed has no slot.
    const ow = oneWaySeconds(eph.distanceBetween("earth", "mars", WIN.enter));
    const capturedAt = WIN.enter - ow; // launched one one-way before the gap
    session.cache.store(staged.datasetId, capturedAt, staged.freshnessHalfLifeS, capturedAt);

    // Step the session a short way INTO the blackout (the link is down — no fetch
    // can rescue the un-staged feed). Pure of t, so step directly at enter + ε.
    const tIn = WIN.enter + 500; // 500 s into the corridor
    expect(feasible(eph, tIn, "earth", "mars")).toBe(false); // link is dead

    const rs = session.step(eph, tIn, 1);
    const stagedRS = rs.feeds.find((f) => f.id === staged.id)!;
    const unstagedRS = rs.feeds.find((f) => f.id === unstaged.id)!;

    // THE PAYOFF: the pre-staged feed serves from cache (NOT a blackout_miss);
    // the un-staged feed, with the link dead and no cache, takes the SLA hit.
    expect(stagedRS.viaCache).toBe(true);
    expect(stagedRS.outcome === "fresh" || stagedRS.outcome === "stale").toBe(true);
    expect(stagedRS.blackout).toBe(false);

    expect(unstagedRS.viaCache).toBe(false);
    expect(unstagedRS.outcome).toBe("blackout_miss");
    expect(unstagedRS.blackout).toBe(true);
  });
});

describe("determinism — the corridor is a pure function of t (replay-safe)", () => {
  /** Drive a session across the window with a given dt-slicing of the SAME spans. */
  function driveAcrossWindow(stepTs: number[]): M1Session {
    const session = new M1Session();
    for (const t of stepTs) session.step(eph, t, 1);
    return session;
  }

  it("stepping the SAME in-corridor instants twice is bit-identical (state + events)", () => {
    const ts = [WIN.enter - 5000, CONJ.t, WIN.exit + 5000];
    const a = driveAcrossWindow(ts);
    const b = driveAcrossWindow(ts);
    expect(a.snapshot()).toEqual(b.snapshot());
    expect(a.events.readAll()).toEqual(b.events.readAll());
  });

  it("the corridor verdict is a pure function of (eph, t): repeated feasible() agree", () => {
    for (const t of [CONJ.t, WIN.enter, WIN.exit, WIN.enter - 1, CONJ.t + 1234]) {
      expect(feasible(eph, t, "earth", "mars")).toBe(feasible(eph, t, "earth", "mars"));
      expect(earthMarsLos(eph, t)).toEqual(earthMarsLos(eph, t));
    }
  });
});
