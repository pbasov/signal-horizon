/**
 * net/scenario — ACT 3c, the cislunar on-ramp beat.
 *
 * Two things are asserted here, and they are different in kind:
 *
 *   1. THE ARC ORDER. The GDD requires cislunar BEFORE Mars (§2 tier 2, milestone 3, and risk
 *      #7's mitigation: teach light-delay at ~1.3 s before Mars makes it bite). Until this beat
 *      existed the arc went straight from Earth milliseconds to Mars minutes. The order is now
 *      part of the test surface so it cannot silently regress — and every pre-existing cursor
 *      index must be UNCHANGED, because saves, state and other tests reason about them.
 *   2. THE BEAT ITSELF. Its emit puts exactly the farside contract on the board; its gate is a
 *      real hold (not a clock); its fallback names the structural fact without doing the work.
 */

import { describe, it, expect } from "vitest";
import { NetSession } from "./session";
import { M1_SCENARIO, NET_ACT3C_HOLD_S } from "./scenario";
import {
  ACT3C_LUNA_CONTRACT_ID,
  ACT4_MARS_CONTRACT_ID,
  NET_ACT3C_GATE_ID_STEM,
  NET_ACT3C_FARSIDE_REGION,
} from "./endpoint";
import { LUNA_GATE, NET_PRESETS } from "./world";
import { loadEphemeris } from "../system-data";
import { applyNetAction } from "./apply-action";
import { netLaunch } from "../action";

const eph = loadEphemeris();
const DT = 1 / 60;

function beat(id: string) {
  const b = M1_SCENARIO.find((x) => x.id === id);
  if (b === undefined) throw new Error(`no beat ${id}`);
  return b;
}

describe("the arrival arc — cislunar comes BEFORE Mars", () => {
  it("steps act1 → act2 → act3a → act3b → act3c → act4", () => {
    expect(M1_SCENARIO.map((b) => b.id)).toEqual([
      "act1",
      "act2",
      "act3a",
      "act3b",
      "act3c",
      "act4",
    ]);
  });

  it("puts the cislunar rung strictly before the Mars frontier", () => {
    const iLuna = M1_SCENARIO.findIndex((b) => b.id === "act3c");
    const iMars = M1_SCENARIO.findIndex((b) => b.id === "act4");
    expect(iLuna).toBeGreaterThan(-1);
    expect(iMars).toBeGreaterThan(iLuna);
  });

  it("leaves every PRE-EXISTING cursor index exactly where it was", () => {
    // act3c was appended at index 4 precisely so these do not move. Saves, persisted state
    // and the escalation tests all reason about these numbers.
    expect(M1_SCENARIO[0].id).toBe("act1");
    expect(M1_SCENARIO[1].id).toBe("act2");
    expect(M1_SCENARIO[2].id).toBe("act3a");
    expect(M1_SCENARIO[3].id).toBe("act3b");
  });

  it("offers a cislunar launch preset alongside the Earth and Mars ones", () => {
    expect(NET_PRESETS.map((p) => p.id)).toContain(LUNA_GATE.id);
  });
});

describe("act3c — the beat", () => {
  it("emits exactly the lunar farside contract, and nothing else", () => {
    const s = new NetSession();
    expect(s.contracts.length).toBe(0);
    beat("act3c").emit(s, 0);
    expect(s.contracts.map((c) => c.id)).toEqual([ACT3C_LUNA_CONTRACT_ID]);
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    expect(c?.region.bodyId).toBe("moon");
    expect(c?.region.lonRad).toBeCloseTo(Math.PI, 12); // the farside, by construction.
  });

  it("does NOT emit the Mars contract — the frontier stays behind its own beat", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    expect(s.contractById(ACT4_MARS_CONTRACT_ID)).toBeNull();
  });

  it("enforces connectivity only — the player is never breached over light-delay", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    expect(c?.activeAxes.has("connectivity")).toBe(true);
    expect(c?.activeAxes.has("latency")).toBe(false);
    expect(c?.activeAxes.has("availability")).toBe(false);
  });

  it("is re-emit safe (the cursor may re-enter the beat)", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    beat("act3c").emit(s, 10);
    expect(s.contracts.filter((c) => c.id === ACT3C_LUNA_CONTRACT_ID).length).toBe(1);
  });
});

describe("act3c — the gate is a HOLD, not a clock", () => {
  it("stays shut while the contract is merely offered", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    expect(beat("act3c").gate(s, 0)).toBe(false);
    // …and stays shut however much SIM TIME passes with nothing served.
    expect(beat("act3c").gate(s, 100_000)).toBe(false);
  });

  it("opens only once the farside has been HELD for a full ground-segment rotation", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    if (c === null) throw new Error("no contract");
    c.state = "active";
    c.servedSecondsAccum = NET_ACT3C_HOLD_S - 1;
    expect(beat("act3c").gate(s, 0)).toBe(false);
    c.servedSecondsAccum = NET_ACT3C_HOLD_S;
    expect(beat("act3c").gate(s, 0)).toBe(true);
  });

  it("a contract that is not ACTIVE never opens it, however much it accrued", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    if (c === null) throw new Error("no contract");
    c.servedSecondsAccum = NET_ACT3C_HOLD_S * 10;
    expect(c.state).not.toBe("active");
    expect(beat("act3c").gate(s, 0)).toBe(false);
  });
});

describe("act3c — the fallback names the fact and points, never places", () => {
  function activeSession(): NetSession {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    if (c === null) throw new Error("no contract");
    c.state = "active";
    return s;
  }

  it("with NO gateway, explains that this is structural, not a scheduling gap", () => {
    const s = activeSession();
    const sf = beat("act3c").fallback?.(s, 0);
    expect(sf).not.toBeNull();
    expect(sf?.subjectId).toBe(ACT3C_LUNA_CONTRACT_ID);
    expect(sf?.suggestPresetId).toBe(LUNA_GATE.id);
    // It must say the quiet part: waiting and launching more will never work.
    expect(sf?.message).toMatch(/ALWAYS|always/);
    expect(sf?.message).toMatch(/L2/);
  });

  it("with a gateway up but the hold incomplete, it stops saying 'launch something'", () => {
    const s = activeSession();
    // Launch the gateway through the REAL verb and run the deploy pipeline, so this also
    // proves a LUNA_GATE launch actually produces a node the beat recognises.
    applyNetAction(
      eph,
      s,
      netLaunch(
        {
          presetId: LUNA_GATE.id,
          semiMajorM: LUNA_GATE.semiMajorM,
          incRad: LUNA_GATE.incRad,
          subLonRad: LUNA_GATE.subLonRad,
          count: 1,
        },
        0,
      ),
      DT,
    );
    for (let i = 0; i < 4000 && s.sats.length === 0; i++) s.step(eph, i * DT, DT);
    expect(s.sats.length).toBe(1);
    expect(s.sats[0].id.startsWith(NET_ACT3C_GATE_ID_STEM)).toBe(true);
    // Stepping ran the contract too; re-clear the accrual so we are testing the incomplete-hold
    // branch specifically, not whatever the hold happened to reach.
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    if (c === null) throw new Error("no contract");
    c.state = "active";
    c.servedSecondsAccum = 0;
    const sf = beat("act3c").fallback?.(s, 0);
    expect(sf).not.toBeNull();
    expect(sf?.message).toMatch(/HOLDING|holding/);
    // The "you have no relay" advice must be GONE — it would be wrong and confusing now.
    expect(sf?.message).not.toMatch(/far side/);
  });

  it("goes quiet once the hold is met — no nagging after the concept lands", () => {
    const s = activeSession();
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    if (c === null) throw new Error("no contract");
    c.servedSecondsAccum = NET_ACT3C_HOLD_S;
    expect(beat("act3c").fallback?.(s, 0) ?? null).toBeNull();
  });

  it("says nothing at all before the contract is signed", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    expect(beat("act3c").fallback?.(s, 0) ?? null).toBeNull();
  });
});

describe("act3c — the farside region is the one the router routes", () => {
  it("the emitted contract carries NET_ACT3C_FARSIDE_REGION verbatim", () => {
    const s = new NetSession();
    beat("act3c").emit(s, 0);
    const c = s.contractById(ACT3C_LUNA_CONTRACT_ID);
    expect(c?.region.id).toBe(NET_ACT3C_FARSIDE_REGION.id);
    expect(c?.region.latRad).toBe(NET_ACT3C_FARSIDE_REGION.latRad);
    expect(c?.region.lonRad).toBe(NET_ACT3C_FARSIDE_REGION.lonRad);
    expect(c?.region.bodyId).toBe("moon");
  });
});
