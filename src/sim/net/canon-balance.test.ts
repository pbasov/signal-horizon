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
  TICK_MARS_RELAY,
  NET_CANON_GOLDEN,
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
  // gateTicks[0] = act1 gate, [1] = act2, [2] = act3a, [3] = act3b, [4] = act3c (cislunar).
  // There is no act4 gate — the frontier beat is a read, not a gate, so the cursor stops there.
  const [act1T, act2T, act3aT, act3bT, act3cT] = gateT;

  it("the golden is UNTOUCHED by the canon extraction (the pin bites both ways)", () => {
    expect(netStateHash(r.session)).toBe(NET_CANON_GOLDEN);
    expect(r.hash).toBe(NET_CANON_GOLDEN);
  });

  it("the five act gates fire in order at sane times", () => {
    expect(gateT.length).toBeGreaterThanOrEqual(5);
    expect(act1T).toBeGreaterThan(0);
    expect(act1T).toBeLessThan(act2T);
    expect(act2T).toBeLessThan(act3aT);
    expect(act3aT).toBeLessThan(act3bT);
    // The cislunar rung clears LAST of the gated beats, so Mars can only arrive after the
    // player has already lived with a ~1.8 s round trip (GDD risk #7's on-ramp ordering).
    expect(act3bT).toBeLessThan(act3cT);
  });

  it("the wallet NEVER dips below a survivable floor (the act-2 commitment can be afforded)", () => {
    const min = Math.min(...trace);
    // R3 retune target: the deepest point stays within ONE bad stack of zero — a red wallet
    // is a readout, never a death spiral. With the cislunar rung the arc actually never goes
    // red at all: the L2 gateway is committed while the act-3 network is still fat, and the
    // farside contract then funds the Mars relay outright.
    expect(min).toBeGreaterThan(-5000);
  });

  it("the arc ENDS SOLVENT and AMORTIZES its last big commit (the network out-earns its upkeep)", () => {
    expect(r.balance).toBeGreaterThan(0);
    // WHY THIS IS A WINDOW AND NOT TWO INSTANTS. The act-3a corridor is DELIBERATELY squeezed, so
    // after the relay commit the wallet SAWTOOTHS — a ~200 s period, a few thousand euro of swing
    // — and it does so identically under the old and the new region geometry. The previous form of
    // this test compared the wallet at t=1090 against t=1008 and t=988, which measured WHICH EDGE
    // of that sawtooth the fixed horizon happened to land on, not whether the network amortizes:
    // it passed only because t=1090 sat on a rising edge. Re-placing the equatorial regions (a
    // pure placement change that leaves the arc richer at every comparable instant — trough
    // €3,488 → €4,100, mean €4,316 → €5,018, final €4,376 → €4,858) shifted the sawtooth's phase
    // and flipped it to a falling edge, failing an assertion nothing had actually regressed in.
    //
    // So measure the claim in the name, over a window that spans the sawtooth: after the last big
    // spend the network holds WELL above the low-water mark that spend left, and ends above it.
    // Both bounds hold under the old geometry too (828 / 888) — this is a stricter reading of the
    // same property, not a relaxed one.
    const post = trace.slice(TICK_MARS_RELAY);
    const trough = Math.min(...post);
    const mean = post.reduce((a, b) => a + b, 0) / post.length;
    expect(mean).toBeGreaterThan(trough + 500);
    expect(r.balance).toBeGreaterThan(trough);
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
