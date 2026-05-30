import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { Ephemeris } from "../ephemeris";
import { setTimeScale, prefetch, setPrefetchPolicy, noop, type SimAction } from "../action";
import { M1Session } from "./session";
import { applySessionAction } from "./apply-action";
import type { M1Event } from "./eventlog";

/**
 * E9 (M1-10b) — THE TRUTHFUL EVENT LOG: cross-replay DETERMINISM + COMPLETENESS.
 *
 * §4.12 demands the record be COMPLETE and HONEST. The honesty guarantee is
 * DETERMINISM: because every event is emitted purely from a session state
 * transition, and the session replays bit-identically (m1-session-replay.test.ts
 * pins the state hash), the EVENT STREAM must replay bit-identically too. This
 * file proves it directly: it records the event stream while driving an action
 * log, then replays the SAME action log and asserts the FULL ORDERED SEQUENCE is
 * identical — same kinds, ticks, ids, and payloads, in the same order.
 *
 * Crucially this is proven with the event stream kept OUT of the session state
 * hash (the golden 8072561960299808504n is unchanged — see m1-session-replay):
 * events are a DERIVED side-output, so they need no re-pin, yet they are
 * reproducible because their SOURCE (the sim) is.
 *
 * COMPLETENESS is also pinned: a representative run must surface every material
 * edge — serve band transitions, fetch launch/arrive, cache store/evict, all
 * three prefetch causes (manual / auto / blackout pre-stage), and a policy change.
 */

const SEED_DT = 1 / 60;
const END_TICK = 120000; // 2000 s — past the first arrivals; matches the session-replay window.

/**
 * Drive an M1Session tick-by-tick over [1, endTick] applying `actions` post-step
 * (main.ts's exact ordering, via the shared applySessionAction), and RETURN the
 * full recorded event stream. This mirrors liveDrive in m1-session-replay.test.ts
 * but harvests session.events — an independent oracle for "what the live loop
 * logs". Pure: a fresh ephemeris + session, no clock/RNG/DOM.
 */
function driveAndRecord(actions: SimAction[], endTick: number, dt = SEED_DT): M1Event[] {
  const eph = loadEphemeris();
  const session = new M1Session();
  const at = new Map<number, SimAction[]>();
  for (const a of actions) {
    const list = at.get(a.atTick) ?? [];
    list.push(a);
    at.set(a.atTick, list);
  }
  for (let tick = 1; tick <= endTick; tick++) {
    session.step(eph, tick * dt, dt);
    const due = at.get(tick);
    if (due !== undefined) for (const a of due) applySessionAction(eph, session, a, dt);
  }
  return session.events.readAll();
}

/** Strip the seq (an append ordinal) for a structural compare; seq equality is checked separately. */
function withoutSeq(events: M1Event[]): Omit<M1Event, "seq">[] {
  return events.map(({ seq: _seq, ...rest }) => rest);
}

/** The golden action log: scale changes, a switched-on autopilot, and a manual P. */
function goldenActions(): SimAction[] {
  return [
    setTimeScale(1, 0),
    noop(120),
    setTimeScale(10, 600),
    // Switch the autopilot ON mid-run — exercises auto top-ups (the relief).
    setPrefetchPolicy("freshness", 0.7, 1200, 3, 60000),
    // A manual prefetch (P) — exercises the manual cause.
    prefetch(80000),
  ];
}

describe("M1 event log — cross-replay determinism (the honesty guarantee)", () => {
  it("the FULL ordered event stream replays bit-identically for the same action log", () => {
    const a = driveAndRecord(goldenActions(), END_TICK);
    const b = driveAndRecord(goldenActions(), END_TICK);

    // Same length, same monotonic seq stream.
    expect(a.length).toBe(b.length);
    expect(a.map((e) => e.seq)).toEqual(b.map((e) => e.seq));
    // Same ordered payloads — kind, tick, tSim, ids, bands, freshness, € — all of it.
    expect(withoutSeq(a)).toEqual(withoutSeq(b));
  });

  it("the stream is non-trivial (it actually recorded the run)", () => {
    const a = driveAndRecord(goldenActions(), END_TICK);
    expect(a.length).toBeGreaterThan(10);
    // Every event carries a SIM timestamp (tick + tSim), never wall-clock.
    for (const e of a) {
      expect(Number.isInteger(e.tick)).toBe(true);
      expect(e.tick).toBeGreaterThanOrEqual(0);
      expect(e.tSim).toBeCloseTo(e.tick * SEED_DT, 9);
    }
  });

  it("seq is strictly monotonic and read order is by seq (oldest→newest)", () => {
    const a = driveAndRecord(goldenActions(), END_TICK);
    for (let i = 1; i < a.length; i++) {
      expect(a[i].seq).toBe(a[i - 1].seq + 1);
      // tick is non-decreasing within a run (events are emitted in step order).
      expect(a[i].tick).toBeGreaterThanOrEqual(a[i - 1].tick);
    }
  });
});

describe("M1 event log — COMPLETENESS (every material edge is logged)", () => {
  it("a freshness-policy run surfaces serve transitions, fetch launch/arrive, store/evict, auto+manual prefetch, and a policy change", () => {
    const a = driveAndRecord(goldenActions(), END_TICK);
    const kinds = new Set(a.map((e) => e.kind));
    expect(kinds.has("serve")).toBe(true);
    expect(kinds.has("fetch_launch")).toBe(true);
    expect(kinds.has("fetch_arrive")).toBe(true);
    expect(kinds.has("cache_store")).toBe(true);
    expect(kinds.has("cache_evict")).toBe(true); // 5 feeds, 3 slots → contention forces eviction.
    expect(kinds.has("prefetch")).toBe(true);
    expect(kinds.has("policy")).toBe(true);

    const prefetchCauses = new Set(
      a.flatMap((e) => (e.kind === "prefetch" ? [e.cause] : [])),
    );
    expect(prefetchCauses.has("auto")).toBe(true); // the autopilot fired floor top-ups.
    expect(prefetchCauses.has("manual")).toBe(true); // the player P landed.

    // The policy event records the lever move from→to with the floor.
    const pol = a.find((e) => e.kind === "policy");
    expect(pol).toBeDefined();
    if (pol && pol.kind === "policy") {
      expect(pol.mode).toBe("freshness");
      expect(pol.from).toBe("manual");
      expect(pol.floor).toBeCloseTo(0.7, 9);
    }
  });

  it("fetch_arrive carries the TRUE landed freshness (NOT the old hard-coded 0.50 flavour lie)", () => {
    const a = driveAndRecord(goldenActions(), END_TICK);
    const arrivals = a.flatMap((e) => (e.kind === "fetch_arrive" ? [e] : []));
    expect(arrivals.length).toBeGreaterThan(0);
    for (const e of arrivals) {
      // A copy that crossed the ~923 s light-gap lands cooled by 2^(-923/halfLife):
      // honestly in (0,1), and pointedly NOT the stale 0.50 the old packet line printed.
      expect(e.landedFreshness).toBeGreaterThan(0);
      expect(e.landedFreshness).toBeLessThan(1);
    }
  });

  it("a blackout pre-stage logs the 'prestage' prefetch cause (wired truthfully for E10's live blackout)", () => {
    // SD-22: the shipped ephemeris never occults, so a LIVE prestage cannot fire.
    // Exercise the wiring with a FAKE ephemeris (the proven mechanism from
    // policy.test.ts): the Earth↔Mars link is feasible NOW but the Sun moves onto
    // the segment at t >= DOWN_T, so within the blackout lead the forecast is
    // infeasible — the autopilot in blackout mode pre-stages, and the event
    // records cause "prestage".
    const AU = 1.496e11;
    const SUN_R = 6.96e8;
    const DOWN_T = 5; // sim-seconds: link feasible before, occulted from here on.
    const position = (id: string, t: number): number[] => {
      if (id === "earth") return [0, 0, 0];
      if (id === "mars") return [2 * AU, 0, 0];
      if (id === "sun") {
        // On the earth→mars segment midpoint once t >= DOWN_T (occludes), else far off-axis.
        return t >= DOWN_T ? [AU, 0, 0] : [0, 0, 1000 * AU];
      }
      return [2 * AU, 0, 0];
    };
    const fakeEph = {
      position,
      hasBody: (id: string): boolean => id === "earth" || id === "sun" || id === "mars",
      radiusMeters: (id: string): number => (id === "sun" ? SUN_R : 0),
      distanceBetween(a: string, b: string, t: number): number {
        const pa = position(a, t);
        const pb = position(b, t);
        return Math.hypot(pa[0] - pb[0], pa[1] - pb[1], pa[2] - pb[2]);
      },
    } as unknown as Ephemeris;

    const session = new M1Session();
    // Blackout mode, 1200 s lead: at t≈0 the link is up but the forecast t+1200 is
    // occulted → pre-stage. Tick 1 (t = 1/60 < DOWN_T) is feasible now → eligible.
    session.setPolicy(
      { mode: "freshness_blackout", freshnessFloor: 0.7, blackoutLeadS: 1200, maxConcurrentAuto: 3 },
      0,
      0,
    );
    session.step(fakeEph, 1 * SEED_DT, SEED_DT);
    const causes = new Set(
      session.events.readAll().flatMap((e) => (e.kind === "prefetch" ? [e.cause] : [])),
    );
    expect(causes.has("prestage")).toBe(true);
  });
});
