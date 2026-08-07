/**
 * FL-07 (SD-47) — CONTRACT TEXTURE: the offer board is a live market, not a static row.
 *
 * Pins: (1) decayedPayAtS is exact (half-life point, monotone, Infinity = flat);
 * (2) signOnBonusAtS inside/outside the window; (3) acceptContract FREEZES the decayed
 * pay, rebinds the penalty to 2× the frozen pay (asymmetry preserved), credits the bonus,
 * and consumes the bonus (no double-dip); (4) a flat tender accepts exactly as before
 * (the pre-FL-07 economics are unchanged for non-decaying offers); (5) the Act-1 tenders
 * lapse deterministically (replay-safe); (6) the economy theorem holds for the new
 * tenders — even a degenerate immediate sign of the DECAYING tender cannot out-earn its
 * own honest provisioning.
 */

import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NetSession } from "./session";
import {
  offerNetContract,
  decayedPayAtS,
  signOnBonusAtS,
  NET_DEFAULT_PAY_PER_SECOND,
  NET_DEFAULT_TERM_SECONDS,
} from "./contract";
import { NET_ACT1_REGION } from "./endpoint";
import { ACT1_SIGNON_BONUS_EUR, ACT1_SIGNON_WINDOW_S } from "./scenario";
import { GEO_PARK, launchStackCost } from "./world";
import { DT } from "../clock";

const eph = Ephemeris.build({});

function act1Session(): NetSession {
  const s = new NetSession();
  s.step(eph, DT, DT); // the act1 beat emits both tenders at t≈0
  return s;
}

describe("FL-07 — decayedPayAtS / signOnBonusAtS", () => {
  const base = offerNetContract("T", NET_ACT1_REGION, {
    payPerSecond: 2.0,
    offeredAtS: 100,
    payHalvingS: 50,
    signOnBonusEur: 500,
    signOnBonusUntilS: 160,
  });

  it("decays exactly: full at origin, half at one half-life, monotone decreasing", () => {
    expect(decayedPayAtS(base, 100)).toBe(2.0);
    expect(decayedPayAtS(base, 150)).toBeCloseTo(1.0, 12);
    expect(decayedPayAtS(base, 200)).toBeCloseTo(0.5, 12);
    expect(decayedPayAtS(base, 50)).toBe(2.0); // before origin ⇒ no grief
    expect(decayedPayAtS(base, 120)).toBeGreaterThan(decayedPayAtS(base, 140));
  });

  it("Infinity half-life = flat pay (the pre-FL-07 behaviour, byte-identical)", () => {
    const flat = offerNetContract("F", NET_ACT1_REGION, { payPerSecond: 2.0 });
    expect(flat.payHalvingS).toBe(Infinity);
    expect(decayedPayAtS(flat, 1e9)).toBe(2.0);
  });

  it("sign-on bonus inside/outside the window; zero when none offered", () => {
    expect(signOnBonusAtS(base, 160)).toBe(500);
    expect(signOnBonusAtS(base, 161)).toBe(0);
    const none = offerNetContract("N", NET_ACT1_REGION);
    expect(signOnBonusAtS(none, 0)).toBe(0);
  });
});

describe("FL-07 — acceptContract prices the signature", () => {
  it("FREEZES the decayed pay + rebinds the penalty to 2× the frozen pay + credits the bonus", () => {
    const s = act1Session();
    const c0 = s.contractById("REGION-0")!;
    // REGION-C decays; sign it after one half-life of sitting (t = 1200).
    const before = s.balance;
    for (let t = 0; t < 1200; t += DT) s.step(eph, t, DT);
    const c = s.contractById("REGION-C")!;
    const offeredPay = c.payPerSecond;
    const accepted = s.acceptContract("REGION-C", 1200)!;
    expect(accepted).toBe(c);
    expect(c.payPerSecond).toBeCloseTo(offeredPay / 2, 3); // ≈ one half-life of decay
    expect(c.penaltyPerSecond).toBeCloseTo(2 * c.payPerSecond, 12); // the 2× asymmetry invariant
    expect(c.payHalvingS).toBe(Infinity); // signed terms stop repricing
    void c0;
    expect(s.balance).toBeCloseTo(before, 6); // no bonus on REGION-C
    expect(c.signOnBonusEur).toBe(0);
  });

  it("the REGION-0 sign-on bonus lands in the wallet inside the window, lapses outside", () => {
    const s = act1Session();
    const before = s.balance;
    const c = s.contractById("REGION-0")!;
    s.acceptContract("REGION-0", 10);
    expect(s.balance).toBeCloseTo(before + ACT1_SIGNON_BONUS_EUR, 6);
    expect(c.payPerSecond).toBe(NET_DEFAULT_PAY_PER_SECOND); // flat tender: unchanged
    expect(c.penaltyPerSecond).toBeCloseTo(2 * NET_DEFAULT_PAY_PER_SECOND, 9);
    expect(signOnBonusAtS(c, 0)).toBe(0); // consumed
    const s2 = act1Session();
    s2.acceptContract("REGION-0", ACT1_SIGNON_WINDOW_S + 60);
    expect(s2.balance).toBeCloseTo(40000, 6); // the bonus lapsed
  });

  it("the market decays REGION-C on the BOARD (the unsigned pay the player sees)", () => {
    const c = act1Session().contractById("REGION-C")!;
    expect(decayedPayAtS(c, c.offeredAtS)).toBeCloseTo(NET_DEFAULT_PAY_PER_SECOND * 1.3, 9);
    expect(decayedPayAtS(c, c.offeredAtS + 1200 * 3)).toBeCloseTo((NET_DEFAULT_PAY_PER_SECOND * 1.3) / 8, 9);
  });
});

describe("FL-07 — the economy theorem holds under texture", () => {
  it("no Act-1 tender's full term out-earns its own honest provisioning", () => {
    const stack = launchStackCost("smallsat", ["BROADCAST"], GEO_PARK.semiMajorM, 1);
    const s = act1Session();
    for (const id of ["REGION-0", "REGION-C"]) {
      const c = s.contractById(id)!;
      const fullTerm = decayedPayAtS(c, c.offeredAtS) * NET_DEFAULT_TERM_SECONDS + c.signOnBonusEur;
      expect(fullTerm).toBeLessThan(stack);
    }
  });

  it("the Act-1 tenders LAPSE deterministically (the offer windows are real for act 1 too)", () => {
    const run = () => {
      const s = new NetSession();
      for (let t = DT; t <= 2 * 3600 + 120; t += DT) s.step(eph, t, DT);
      return s;
    };
    const a = run();
    const b = run();
    // Both offered tenders must be GONE (the 2 h window lapsed; stepOfferedContract failed them).
    expect(a.contracts.filter((c) => c.state === "offered")).toEqual([]);
    expect(a.contracts.map((c) => `${c.id}:${c.state}`)).toEqual(b.contracts.map((c) => `${c.id}:${c.state}`));
  });
});
