/**
 * R3 — THE NET-CANON BALANCE MEASUREMENT + PINS. The canonical arrival arc (canon.ts —
 * the SAME log the replay golden drives) replayed with the wallet traced per tick, so the
 * R3 economy pass reads NUMBERS, not vibes: "does the canonical hour land wallet-positive,
 * and by how much, and where does it bleed?"
 *
 * The pins assert the TARGETS of the balance pass (not the current numbers): if a tuning
 * change lands, this file is the before/after diff. Deviating beyond the narrow bands
 * below means the economy moved — re-review, re-pin deliberately.
 */

import { describe, it, expect } from "vitest";
import {
  act4Log,
  replayCanon,
  netStateHash,
  GOLDEN_DT,
  MAX_TICK_ACT4,
  TICK_LAUNCH,
  TICK_ACCEPT,
} from "./canon";
import { saveGame, addAction } from "../save";
import { netLaunch, netAccept } from "../action";
import { GEO_PARK } from "./world";
import { ACT1_CONTRACT_ID } from "./scenario";
import { NET_RNG_SEED } from "./session";
import { NET_OPENING_BALANCE } from "./session";

/** The wallet at a sim-time (sampled from the trace; trace[i] == balance at tick i). */
function at(trace: number[], tSeconds: number): number {
  const i = Math.min(trace.length - 1, Math.round(tSeconds / GOLDEN_DT));
  return trace[i];
}

describe("R3 — the canonical-hour economy (measurement + pins)", () => {
  const r = replayCanon(act4Log(), MAX_TICK_ACT4, true);
  const trace = r.balanceTrace!;
  const gateT = r.gateTicks.map((tk) => tk * GOLDEN_DT);
  // gateTicks[0] = act1 gate, [1] = act2, [2] = act3a, [3] = act3b.
  const [act1T, act2T, act3aT, act3bT] = gateT;

  it("the golden is UNTOUCHED by the canon extraction (the pin bites both ways)", () => {
    expect(netStateHash(r.session)).toBe(17948230282099181132n);
    expect(r.hash).toBe(17948230282099181132n);
  });

  it("the four act gates fire in order at sane times", () => {
    expect(gateT.length).toBeGreaterThanOrEqual(4);
    expect(act1T).toBeGreaterThan(0);
    expect(act1T).toBeLessThan(act2T);
    expect(act2T).toBeLessThan(act3aT);
    expect(act3aT).toBeLessThan(act3bT);
  });

  it("the wallet NEVER dips below a survivable floor (the act-2 commitment can be afforded)", () => {
    const min = Math.min(...trace);
    // R3 retune target: the deepest point (the act-4 Mars relay commit) stays within ONE
    // bad stack of zero — a red wallet is a readout, never a death spiral.
    expect(min).toBeGreaterThan(-5000);
  });

  it("the arc ENDS SOLVENT and CLIMBING (the network amortizes; renewals are the margin)", () => {
    expect(r.balance).toBeGreaterThan(0);
    // After the last big spend (the act-4 relay ≈ t=968) the slope is positive: the built
    // network earns faster than it costs to keep.
    expect(r.balance).toBeGreaterThan(at(trace, 1008));
    expect(at(trace, 1008)).toBeGreaterThan(at(trace, 988));
  });

  it("act-1 pays back: the served-up REGION-0 out-earns its stall (act-1-only arc)", () => {
    // The FULL canon commits the act-2 batch at t≈24, so isolate act-1: launch + accept only.
    const sg = saveGame(NET_RNG_SEED, GOLDEN_DT, { game: "net", act: "act1-only" });
    addAction(sg, netLaunch({ presetId: GEO_PARK.id, semiMajorM: GEO_PARK.semiMajorM, incRad: GEO_PARK.incRad, subLonRad: GEO_PARK.subLonRad, count: 1 }, TICK_LAUNCH));
    addAction(sg, netAccept(ACT1_CONTRACT_ID, TICK_ACCEPT));
    const r1 = replayCanon(sg, Math.round(300 / GOLDEN_DT), true);
    const tr1 = r1.balanceTrace!;
    const at1 = (t: number) => tr1[Math.min(tr1.length - 1, Math.round(t / GOLDEN_DT))];
    // Post-launch floor (t=10) → steady serve (t=300): the GEO has earned back a real chunk.
    expect(at1(300)).toBeGreaterThan(at1(10) + 3000);
    // and the act-1 gate STILL fired in isolation.
    expect(r1.gateTicks.length).toBeGreaterThanOrEqual(1);
  });


  it("THE MEASUREMENT TABLE (read the numbers in the log — the balance review's input)", () => {
    const marks: [string, number][] = [
      ["boot", 0],
      ["post-launch (GEO committed)", 10],
      ["act1 gate", act1T],
      ["act2 gate", act2T],
      ["act3a gate", act3aT],
      ["act3b gate", act3bT],
      ["end (act4 horizon)", MAX_TICK_ACT4 * GOLDEN_DT],
    ];
    const rows = marks.map(([label, t]) => `  ${label.padEnd(34)} t=${t.toFixed(1).padStart(9)}s  wallet €${Math.round(at(trace, t)).toLocaleString("en-US")}`);
    // eslint-disable-next-line no-console
    console.log(`\n  —— THE CANONICAL HOUR, WALLET ——\n  opening €${NET_OPENING_BALANCE.toLocaleString("en-US")}\n${rows.join("\n")}\n  min €${Math.round(Math.min(...trace)).toLocaleString("en-US")}  max €${Math.round(Math.max(...trace)).toLocaleString("en-US")}\n`);
    expect(rows.length).toBe(marks.length);
  });
});
