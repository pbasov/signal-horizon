import { describe, it, expect } from "vitest";
import { loadEphemeris } from "./system-data";
import { BuildSession } from "./m2/session";

/**
 * M2-fix — THE LARGE-EPOCH SCHEDULE ANCHOR + the shock-compounding clamp (the live epoch-mismatch
 * bug). A LIVE BuildSession is driven by main.ts on the SHARED clock, which boots at the M1 scenario
 * epoch (SCENARIO.tick0 ≈ 14.5M s — the Mars-conjunction approach), but the M2 schedulers were
 * written assuming a session starts near t=0 (event generator FIRST_EVENT_AT_SECONDS = 2400, offer
 * generator first offer ~1800 s, demand-growth cadence from 0). Without the anchor, the FIRST live
 * step at t ≈ 14.5M s is ~14.5M seconds OVERDUE on every cursor, so the catch-up loops fire their
 * whole backlog at once (the event generator caps at 64), every shock compounds MULTIPLICATIVELY on
 * shared cells, and demand explodes to ~1e40 (the orrery DEMAND·GROWTH readout reads "+6.5e39%").
 *
 * The fix lazily anchors the schedulers to the session's start t on the FIRST step (first event at
 * start + FIRST_EVENT_AT_SECONDS, NOT a backlog) and clamps the compounded per-cell shock multiplier.
 * The m2-build-replay golden drives from t=0, so it is internally consistent and never saw this — these
 * tests guard the LIVE large-epoch path the golden can't.
 */

const DT = 1 / 60;
/** The M1 scenario epoch the LIVE shared clock boots at (SCENARIO.t0Seconds). */
const LARGE_EPOCH = 14_500_000;

describe("M2-fix — large-epoch schedule anchor + bounded demand", () => {
  it("a session starting at a LARGE epoch fires AT MOST a small bounded number of events on the first step (no 64-burst)", () => {
    const eph = loadEphemeris();
    const s = new BuildSession();
    const before = s.events.snapshot().events.length;
    s.step(eph, LARGE_EPOCH, DT);
    const fired = s.events.snapshot().events.length - before;
    // Pre-fix this was 64 (the event generator's hard catch-up cap). Anchored, the first event is
    // scheduled at LARGE_EPOCH + FIRST_EVENT_AT_SECONDS, so NOTHING is due on the first step.
    expect(fired).toBe(0);
    expect(fired).toBeLessThan(2); // belt: never a backlog burst, whatever the future cadence.
  });

  it("the demand total stays BOUNDED at the large epoch (no e+39 blow-up)", () => {
    const eph = loadEphemeris();
    const s = new BuildSession();
    const baseline = s.demandField.baselineTotal;
    // Step a chunk of sim-time PAST the first anchored event so any shock that DOES fire is exercised
    // — and confirm demand never explodes. The escalation cap is 3× baseline + the shock clamp adds a
    // bounded headroom, so the total stays comfortably finite and small.
    for (let i = 0; i < 4000; i++) {
      const t = LARGE_EPOCH + i * 60; // 60 s coarse steps → ~67 sim-hours past the epoch.
      s.step(eph, t, 60);
    }
    const total = s.demandField.total;
    expect(Number.isFinite(total)).toBe(true);
    // Pre-fix: ~1e40 (ratio ~1e38). Anchored + clamped: demand stays a sane small multiple of baseline.
    expect(total).toBeLessThan(baseline * 50);
    expect(total / baseline).toBeLessThan(50);
  });

  it("the per-cell shock multiplier can NEVER blow demand up even under a pathological concurrent-shock pile-up", () => {
    // Independent of the anchor: prove the clamp alone bounds compounding. Drive a session from t=0 over
    // a very long stretch so MANY demand shocks fire and overlap on shared hotspot cells. Even if a
    // pile-up compounds, the clamped multiplier (× a bounded escalation cap) keeps the total finite/sane.
    const eph = loadEphemeris();
    const s = new BuildSession();
    const baseline = s.demandField.baselineTotal;
    for (let t = 0; t <= 400000; t += 120) s.step(eph, t, 120);
    const total = s.demandField.total;
    expect(Number.isFinite(total)).toBe(true);
    expect(total).toBeLessThan(baseline * 50); // bounded: escalation cap × shock clamp, never Inf.
  });

  it("LIVE == REPLAY at a large epoch: two sessions stepped identically from the SAME large epoch reproduce bit-identically", () => {
    const eph = loadEphemeris();
    const drive = () => {
      const s = new BuildSession();
      for (let i = 0; i <= 2000; i++) s.step(eph, LARGE_EPOCH + i * 60, 60);
      return s;
    };
    const a = drive();
    const b = drive();
    expect(a.snapshot()).toEqual(b.snapshot()); // deterministic at the live epoch too.
  });

  it("the t=0 path is UNCHANGED by the anchor: a session stepped from t=0 schedules its first event at the original FIRST_EVENT_AT_SECONDS", () => {
    const eph = loadEphemeris();
    const s = new BuildSession();
    // Step just PAST FIRST_EVENT_AT_SECONDS (2400 s) — the first event must land exactly as before the
    // fix (the anchor at startT===0 reproduces the constructor cursor, so the golden t=0 fold is intact).
    let firstEventTick = -1;
    for (let tick = 0; tick <= Math.round(3600 / DT); tick++) {
      const t = tick * DT;
      const before = s.events.snapshot().events.length;
      s.step(eph, t, DT);
      if (firstEventTick < 0 && s.events.snapshot().events.length > before) firstEventTick = tick;
    }
    expect(firstEventTick).toBeGreaterThan(0);
    // The first event fires at/just-after 2400 s (FIRST_EVENT_AT_SECONDS), NOT immediately at tick 0.
    expect(firstEventTick * DT).toBeGreaterThanOrEqual(2400);
  });
});
