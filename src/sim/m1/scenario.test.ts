import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { DT } from "../clock";
import { earthMarsLos, lineOfSight, SOLAR_CORRIDOR_RSUN } from "../links";
import { oneWaySeconds } from "../delay";
import { CONJUNCTION_WATCH_FACTOR } from "../../orrery/readout";
import { feasible } from "./resolver";
import { selectAutoPrefetches, defaultPolicy, type PolicyFeedState } from "./policy";
import { buildFeeds } from "./feeds";
import { M1Session } from "./session";
import { SCENARIO, missionElapsedSeconds, defaultScale } from "./scenario";
import { TIME_SCALES } from "../clock";

/**
 * E10b (M1-12) — THE STRAIN-TUNED 30-MIN SCENARIO, PROVEN AGAINST THE REAL EPH.
 *
 * GDD §9 sharpened the M1 gate: a ~30-minute run must contain a full STRAIN →
 * RELIEF arc that ends in the predictable conjunction BLACKOUT, so the §4.4/§3a
 * pre-staging insight is exercised as SKILL, not luck. E10a made the blackout
 * live; E10b places the START EPOCH t0 shortly before a real conjunction so the
 * macro-timeline is short enough that the player can bridge the light-delay ↔
 * conjunction scale gap (Risk-6) with the 1×..1000× controls.
 *
 * These tests assert the whole arc against the REAL ephemeris:
 *   1. at t0 the link is FEASIBLE and the Sun-miss margin is in the SAFE band
 *      (above the watch edge) — the player starts green;
 *   2. stepping forward, the margin MONOTONICALLY tightens (green → watch → warn)
 *      and ENTERS the corridor — a predictable, foreshadowed approach;
 *   3. the run fits ~30 min: enter − t0 is reachable inside ~15–20 real-min @1000×;
 *   4. with the RETUNED default lead (1800 s), a DEFAULT-mode freshness_blackout
 *      pre-stage launches BEFORE the gap and a pre-staged feed SERVES THROUGH the
 *      blackout while an unprepared feed misses — the marquee payoff, and the fix
 *      for the E10a minor (the old 1200 s lead landed AFTER the gap).
 */

const eph = loadEphemeris();
const CORRIDOR = SOLAR_CORRIDOR_RSUN; // 5
const WATCH = CORRIDOR * CONJUNCTION_WATCH_FACTOR; // 9 Rsun — the foreshadow edge
const t0 = SCENARIO.t0Seconds;

/** Scan the real eph for the conjunction (min Sun-miss) — pure, coarse→fine. */
function findConjunction(): { t: number; marginRsun: number } {
  let best = { t: 0, marginRsun: Infinity };
  for (let t = t0; t <= t0 + 4e6; t += 1000) {
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

/** Bracket the corridor blackout window (link down) around the conjunction. */
function findWindow(conjT: number): { enter: number; exit: number; widthS: number } {
  let enter = NaN;
  let exit = NaN;
  let inW = false;
  for (let t = conjT - 4e6; t <= conjT + 4e6; t += 10) {
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

describe("scenario module — the one-place epoch dial + sim↔ephemeris mapping", () => {
  it("the boot tick is round(t0 / DT) so the integer clock starts exactly on the epoch", () => {
    expect(SCENARIO.tick0).toBe(Math.round(t0 / DT));
    // tick0·DT recovers t0 (the clock's seconds at boot is the epoch).
    expect(SCENARIO.tick0 * DT).toBeCloseTo(t0, 3);
  });

  it("mission-elapsed time is sim-time minus t0, clamped at zero (reads 0 at boot)", () => {
    expect(missionElapsedSeconds(t0)).toBe(0);
    expect(missionElapsedSeconds(t0 + 3600)).toBe(3600);
    // A pre-epoch read never goes negative (the readout floors at 0d).
    expect(missionElapsedSeconds(t0 - 5000)).toBe(0);
  });
});

describe("epoch placement — the player starts SAFE, well before the blackout", () => {
  it("at t0 the Earth↔Mars link is FEASIBLE (no blackout) and the cache loop runs", () => {
    expect(feasible(eph, t0, "earth", "mars")).toBe(true);
    expect(earthMarsLos(eph, t0).inCorridor).toBe(false);
  });

  it("the starting Sun-miss margin is in the SAFE/green band — above the watch edge", () => {
    const m = earthMarsLos(eph, t0).marginSolarRadii;
    // Safe means well above the watch edge (1.8 × corridor = 9 Rsun): the gauge
    // reads 0 (green) at t0, so the foreshadow is a CHANGE the player watches.
    expect(m).toBeGreaterThan(WATCH);
    // The shipped value is ≈15.93 Rsun — comfortably clear of watch (a fat lead).
    expect(m).toBeGreaterThan(15);
    expect(m).toBeLessThan(17);
  });

  it("t0 is BEFORE the blackout window opens, with multi-day of approach runway", () => {
    expect(t0).toBeLessThan(WIN.enter);
    const leadDays = (WIN.enter - t0) / 86400;
    expect(leadDays).toBeGreaterThan(10); // ≈10.87 sim-days of approach
    expect(leadDays).toBeLessThan(12);
  });

  it("near conjunction the one-way light is at its WORST (~21 min) — the teaching moment", () => {
    const owT0 = oneWaySeconds(eph.distanceBetween("earth", "mars", t0));
    const owConj = oneWaySeconds(eph.distanceBetween("earth", "mars", CONJ.t));
    expect(owT0 / 60).toBeGreaterThan(21); // already ~21.5 min at the start
    expect(owConj / 60).toBeGreaterThan(21);
    expect(owConj).toBeGreaterThan(owT0); // it grows toward conjunction
  });
});

describe("the approach FORESHADOWS — the margin tightens monotonically into the corridor", () => {
  it("the Sun-miss margin tightens monotonically from t0 to the window edge", () => {
    let prev = Infinity;
    let monotone = true;
    for (let t = t0; t <= WIN.enter; t += 5000) {
      const m = earthMarsLos(eph, t).marginSolarRadii;
      if (m > prev + 1e-6) monotone = false;
      prev = m;
    }
    expect(monotone).toBe(true);
    // It crosses each band on the way down: starts > watch (9), passes the warn
    // region, and reaches the corridor (5) at the window edge.
    expect(earthMarsLos(eph, t0).marginSolarRadii).toBeGreaterThan(WATCH);
    expect(earthMarsLos(eph, WIN.enter).marginSolarRadii).toBeLessThanOrEqual(CORRIDOR + 1e-6);
  });

  it("the WATCH band (margin ≤ 9 Rsun) opens partway through the approach — a lead cue", () => {
    // Find when the foreshadow gauge first leaves green (margin ≤ watch).
    let watchT = NaN;
    for (let t = t0; t <= WIN.enter; t += 100) {
      if (earthMarsLos(eph, t).marginSolarRadii <= WATCH) {
        watchT = t;
        break;
      }
    }
    expect(Number.isFinite(watchT)).toBe(true);
    expect(watchT).toBeGreaterThan(t0); // green at boot, watch later (it LEADS)
    expect(watchT).toBeLessThan(WIN.enter); // and warns before the blackout
  });

  it("stepping a session forward ENTERS the corridor blackout (link flips down)", () => {
    // Pure-of-t session: prime link-up at t0, then step in-corridor (enter).
    const session = new M1Session();
    session.step(eph, t0, 1000); // link UP — primes prevFeasible=true
    session.step(eph, CONJ.t, 1000); // deep in-corridor — link flips DOWN
    const blackouts = session.events.readAll().filter((e) => e.kind === "blackout");
    expect(blackouts.some((e) => e.kind === "blackout" && e.edge === "enter")).toBe(true);
    // And the link really is dead at conjunction.
    expect(feasible(eph, CONJ.t, "earth", "mars")).toBe(false);
  });
});

describe("the arc fits ~30 minutes — reachable at the existing time scales", () => {
  it("at sustained 1000× the blackout is ENTERED inside ~15–20 real-minutes", () => {
    const simToEnter = WIN.enter - t0; // sim-seconds to the blackout
    const realMinAt1000x = simToEnter / 1000 / 60;
    expect(realMinAt1000x).toBeGreaterThan(14);
    expect(realMinAt1000x).toBeLessThan(20); // leaves the first third for strain
  });

  it("the blackout is DWELLABLE for minutes at 1000× (you sit inside it)", () => {
    const dwellRealMin = WIN.widthS / 1000 / 60;
    expect(dwellRealMin).toBeGreaterThan(5); // ≈9.7 real-min inside the corridor
  });
});

describe("the RETUNED default lead (1800 s) beats the light-gap — fixes the E10a minor", () => {
  it("the default policy lead now EXCEEDS the max one-way light over the approach", () => {
    const lead = defaultPolicy().blackoutLeadS;
    expect(lead).toBe(1800);
    // The worst one-way light from the start through the blackout exit.
    let maxOw = 0;
    for (let t = t0; t <= WIN.exit; t += 2000) {
      const ow = oneWaySeconds(eph.distanceBetween("earth", "mars", t));
      if (ow > maxOw) maxOw = ow;
    }
    expect(lead).toBeGreaterThan(maxOw); // 1800 > ~1305 — the fix
  });

  it("a leg launched at the forecast boundary LANDS BEFORE the gap (new 1800 vs old 1200)", () => {
    const ow = (t: number) => oneWaySeconds(eph.distanceBetween("earth", "mars", t));
    // The policy first fires at enter − lead (link up, forecast down within lead).
    const newLead = 1800;
    const oldLead = 1200;
    const newFire = WIN.enter - newLead;
    const oldFire = WIN.enter - oldLead;
    expect(feasible(eph, newFire, "earth", "mars")).toBe(true);
    expect(feasible(eph, newFire + newLead, "earth", "mars")).toBe(false);
    // NEW: the earliest pre-stage lands BEFORE the gap opens (it beats the gap).
    expect(newFire + ow(newFire)).toBeLessThan(WIN.enter);
    // OLD: the 1200 s lead launched too late — its leg landed AFTER the gap (miss).
    expect(oldFire + ow(oldFire)).toBeGreaterThan(WIN.enter);
  });

  it("a DEFAULT-mode freshness_blackout pre-stage fires before the gap (real eph)", () => {
    const feeds = buildFeeds();
    const session = new M1Session();
    // The default-tuned blackout policy (lead 1800), switched ON.
    const dp = defaultPolicy();
    session.setPolicy(
      { mode: "freshness_blackout", freshnessFloor: dp.freshnessFloor, blackoutLeadS: dp.blackoutLeadS, maxConcurrentAuto: 5 },
      0,
      0,
    );
    // At t = enter − lead/2 the link is up now but forecast down within the lead.
    const t = WIN.enter - Math.floor(dp.blackoutLeadS / 2);
    expect(feasible(eph, t, "earth", "mars")).toBe(true);
    expect(feasible(eph, t + dp.blackoutLeadS, "earth", "mars")).toBe(false);

    const pfStates: PolicyFeedState[] = feeds.map((f) => ({
      id: f.id,
      datasetId: f.datasetId,
      sourceId: f.sourceId,
      customerId: f.customerId,
      inFlight: false,
    }));
    const targets = selectAutoPrefetches(session.policy, pfStates, session.cache, eph, t);
    expect(targets.length).toBeGreaterThan(0);

    // Driving the session logs the prefetch as a "prestage" (the relief firing).
    session.step(eph, t, 1);
    const prestages = session.events
      .readAll()
      .filter((e) => e.kind === "prefetch" && e.cause === "prestage");
    expect(prestages.length).toBeGreaterThan(0);
  });

  it("a pre-staged feed SERVES THROUGH the blackout; an unprepared feed MISSES", () => {
    const feeds = buildFeeds();
    const staged = feeds.find((f) => f.id === "mars_science")!; // long half-life
    const unstaged = feeds.find((f) => f.id === "mars_weather")!;
    const session = new M1Session();

    // Honest pre-stage: the staged feed's copy crossed the gap one one-way light
    // BEFORE the blackout opened (a default-lead pre-stage launched at enter−1800
    // lands ≈enter−500, comfortably before the gap — so storing at enter−ow models
    // a copy that genuinely made it through).
    const ow = oneWaySeconds(eph.distanceBetween("earth", "mars", WIN.enter));
    const capturedAt = WIN.enter - ow;
    session.cache.store(staged.datasetId, capturedAt, staged.freshnessHalfLifeS, capturedAt);

    const tIn = WIN.enter + 500; // 500 s into the corridor — the link is dead
    expect(feasible(eph, tIn, "earth", "mars")).toBe(false);
    const rs = session.step(eph, tIn, 1);
    const stagedRS = rs.feeds.find((f) => f.id === staged.id)!;
    const unstagedRS = rs.feeds.find((f) => f.id === unstaged.id)!;

    // THE PAYOFF: pre-staged serves from cache; unprepared takes the SLA hit.
    expect(stagedRS.viaCache).toBe(true);
    expect(stagedRS.blackout).toBe(false);
    expect(unstagedRS.outcome).toBe("blackout_miss");
    expect(unstagedRS.blackout).toBe(true);
  });
});

describe("E10c — the onboarding default-scale dial (a passive player completes the arc)", () => {
  it("the scenario asks the live clock to boot at 1000× so a hands-off run reaches the blackout", () => {
    expect(SCENARIO.defaultScaleIndex).toBe(TIME_SCALES.indexOf(1000));
    expect(defaultScale()).toBe(1000);
  });

  it("at the default boot scale the blackout window ENTERS inside the ~30-min sitting", () => {
    // enter − t0 sim-seconds, ÷ the default scale, ÷ 60 = real-minutes hands-off.
    const simToEnter = WIN.enter - t0;
    const realMin = simToEnter / defaultScale() / 60;
    expect(realMin).toBeGreaterThan(10);
    expect(realMin).toBeLessThan(20); // a passive player reaches it without ramping
  });

  it("the dial is clamped to a valid TIME_SCALES index (defensive)", () => {
    // A sane index resolves to a real scale; out-of-range would clamp, never throw.
    expect(defaultScale({ id: "x", t0Seconds: 0, defaultScaleIndex: 99 })).toBe(
      TIME_SCALES[TIME_SCALES.length - 1],
    );
    expect(defaultScale({ id: "x", t0Seconds: 0, defaultScaleIndex: -5 })).toBe(TIME_SCALES[0]);
  });
});
