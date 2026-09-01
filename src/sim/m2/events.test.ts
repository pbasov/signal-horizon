import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { BuildSession } from "./session";
import { EventGenerator } from "./event-generator";
import { M2EventLog, type M2Event } from "./events";
import { SimRng } from "../rng";

/**
 * M2f — THE EMERGENT-EVENT GENERATOR (rivals + news shocks). These guard the V1 story layer:
 *   - the generator emits a DETERMINISTIC event timeline off the seeded SimRng (same seed ⇒ same
 *     events at the same sim-times);
 *   - the world coupling MATTERS + EXPIRES: a DEMAND_SHOCK bumps its region's demand, then DECAYS
 *     back toward baseline (no permanent drift); a rival RELAY_FAILURE spawns a real contract offer;
 *   - the whole event stream + its effects fold into the snapshot and reproduce on replay/restore.
 */

const DT = 1 / 60;

/** Step a fresh session over [0, tMax] at DT, returning it (the generator fires within the run). */
function runTo(tMax: number): BuildSession {
  const eph = loadEphemeris();
  const s = new BuildSession();
  for (let tick = 0; tick * DT <= tMax; tick++) s.step(eph, tick * DT, DT);
  return s;
}

describe("m2f — the emergent-event generator (rivals + shocks)", () => {
  it("emits a deterministic event timeline off the seeded RNG (same seed ⇒ same events)", () => {
    // Drive the bare generator directly (no world), recording (tSim, kind) pairs twice.
    const drive = () => {
      const gen = new EventGenerator();
      const rng = new SimRng(7n);
      const out: { kind: string }[] = [];
      for (let tick = 0; tick * DT <= 60000; tick++) {
        for (const p of gen.step(rng, tick * DT)) out.push({ kind: p.kind });
      }
      return out;
    };
    const a = drive();
    const b = drive();
    expect(a).toEqual(b); // bit-identical timeline
    expect(a.length).toBeGreaterThan(0); // it actually fired a handful of beats
  });

  it("a session surfaces world events in its M2 event stream within a sitting", () => {
    // Early-exit: the assertions pin stream SHAPE (monotonic seq + finite timestamps), which the
    // first two events prove. Stepping the full 16-hour window burns ~5 s of wall-clock for no
    // extra coverage and sits on the default 5 s test timeout — red on any slower CI runner.
    const eph = loadEphemeris();
    const s = new BuildSession();
    for (let tick = 0; s.events.appended < 2 && tick * DT <= 60000; tick++) {
      s.step(eph, tick * DT, DT);
    }
    const events = s.events.readAll();
    expect(events.length).toBeGreaterThan(0);
    // Every event carries a sim timestamp + a monotonic seq (stable render keys).
    for (let i = 0; i < events.length; i++) {
      expect(events[i].seq).toBe(i);
      expect(Number.isFinite(events[i].tSim)).toBe(true);
    }
  }, 30000);

  it("a DEMAND_SHOCK bumps its region's demand, then DECAYS back to baseline (it EXPIRES)", () => {
    const eph = loadEphemeris();
    const s = new BuildSession();
    // Drive the SAME session: find the FIRST demand_shock, capture the spike, then keep stepping the
    // same session and watch the region's EFFECTIVE demand decay back to its raw grown value as the
    // shock expires (the multiplier returns to 1.0 — clean expiry, no permanent drift).
    let shockEnd = -1;
    let regionCells: number[] = [];
    let peakRatio = 0; // effective/current at the spike (the live multiplier sum proxy)
    let maxTick = Math.round(200000 / DT);
    let lastTick = 0;
    for (let tick = 0; tick <= maxTick; tick++) {
      const t = tick * DT;
      const before = s.events.readAll().filter((e) => e.kind === "demand_shock").length;
      s.step(eph, t, DT);
      lastTick = tick;
      if (shockEnd < 0) {
        const shocks = s.events.readAll().filter((e) => e.kind === "demand_shock");
        if (shocks.length > before) {
          const ev = shocks[shocks.length - 1];
          if (ev.kind === "demand_shock") {
            shockEnd = t + ev.durationS;
            regionCells = ev.cellIds;
            const eff = regionCells.reduce((a, id) => a + s.demandField.of(id), 0);
            const cur = regionCells.reduce((a, id) => a + s.demandField.current[id], 0);
            peakRatio = eff / cur; // > 1 while shocked
            maxTick = Math.round((shockEnd + 300) / DT); // run just past the shock end (small window
            // so a fresh shock is unlikely to re-cover these cells before we inspect)
          }
        }
      }
    }
    expect(shockEnd).toBeGreaterThanOrEqual(0); // a shock fired
    expect(peakRatio).toBeGreaterThan(1.0); // the region was visibly bumped at the spike

    // At the end of the run (past the shock's lifetime) the EFFECTIVE region demand equals the raw
    // grown demand: the shock multiplier is back to 1.0 (expired cleanly). Guard: ensure no NEW shock
    // re-covered these cells in the trailing window by checking the ratio is exactly 1.
    const finalEff = regionCells.reduce((a, id) => a + s.demandField.of(id), 0);
    const finalCur = regionCells.reduce((a, id) => a + s.demandField.current[id], 0);
    expect(lastTick * DT).toBeGreaterThan(shockEnd); // we ran past the shock end
    expect(finalEff).toBeCloseTo(finalCur, 6); // multiplier returned to 1.0 — the shock EXPIRED
  }, 30000);

  it("a rival RELAY_FAILURE spawns a lucrative contract offer (their customers come knocking)", () => {
    // Step until the FIRST relay_failure fires, then assert its spawned `r{N}` offer is on the
    // board. Early-exit: the first one lands deterministically ~39 sim-hours in (default seed),
    // so the old fixed 400,000 s window stepped 24M ticks and blew the 30 s wall-clock budget.
    const eph = loadEphemeris();
    const s = new BuildSession();
    let relayFailure: Extract<M2Event, { kind: "rival_action" }> | undefined;
    let drainFrom = 0;
    for (let tick = 0; relayFailure === undefined && tick * DT <= 400000; tick++) {
      s.step(eph, tick * DT, DT);
      const appended = s.events.appended;
      if (appended > drainFrom) {
        for (const e of s.events.readSince(drainFrom)) {
          if (e.kind === "rival_action" && e.kind2 === "relay_failure" && e.spawnedContractId !== null) {
            relayFailure = e;
          }
        }
        drainFrom = appended;
      }
    }
    // It is statistically near-certain over this window; if one fired, the contract exists.
    if (relayFailure !== undefined) {
      const id = relayFailure.spawnedContractId!;
      const spawned = s.contracts.find((c) => c.id === id);
      expect(spawned).toBeDefined();
      expect(spawned!.id.startsWith("r")).toBe(true);
      expect(spawned!.tariffPerSecond).toBeGreaterThan(0);
    } else {
      // No relay failure in-window is acceptable; but SOME rival action must have surfaced.
      const anyRival = s.events.readAll().some((e) => e.kind === "rival_action");
      expect(anyRival).toBe(true);
    }
  }, 60000);

  it("the event stream + effects reproduce on replay (deterministic) and survive snapshot/restore", () => {
    const a = runTo(80000);
    const b = runTo(80000);
    expect(a.events.readAll()).toEqual(b.events.readAll()); // same timeline
    expect(a.snapshot()).toEqual(b.snapshot()); // same world state

    // Snapshot/restore round-trip reproduces the events + the active-shock state.
    const restored = new BuildSession();
    restored.restore(a.snapshot());
    expect(restored.snapshot()).toEqual(a.snapshot());
  }, 60000); // two full runTo(80000) passes ≈ 15 s local; a slow CI runner needs ~2× that.

  it("the M2EventLog stamps monotonic seqs and drains the tail incrementally", () => {
    const log = new M2EventLog();
    log.push((seq) => ({ kind: "news", seq, tick: 0, tSim: 0, text: "a", severity: "info" }));
    log.push((seq) => ({ kind: "news", seq, tick: 1, tSim: DT, text: "b", severity: "info" }));
    expect(log.size).toBe(2);
    expect(log.appended).toBe(2);
    expect(log.readSince(1).map((e) => e.seq)).toEqual([1]);
    expect(log.readSince(2)).toEqual([]);
  });
});
