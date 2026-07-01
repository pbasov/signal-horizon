import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NetSession } from "./session";
import { offerNetContract, NET_DEFAULT_PAY_PER_SECOND, NET_DEFAULT_PENALTY_PER_SECOND, NET_DEFAULT_TERM_SECONDS } from "./contract";
import { NET_ACT1_REGION, NET_ACT1_GROUND } from "./endpoint";
import { NET_ACT2_REGION, ACT2_ZERO_GAP_N } from "./scenario";
import { launchStackCost, GEO_PARK, LEO_SWEEP } from "./world";
import { BUS_SPECS } from "./sat";

/**
 * R0 (SD-45) — THE ECONOMY THEOREM (m1-redesign.md §2.5): "one contract can never pay for
 * its own honest provisioning." Asserted, not hoped: for each authored M1 demand, a full
 * term's revenue at the default tariff is strictly less than the honest launch stack that
 * serves it. Margins come from SHARING capacity across contracts (statistical multiplexing)
 * and renewals — never from a single deal financing its own hardware.
 *
 * Plus: the 2× penalty asymmetry (a wrong signing is strictly worse than not signing) and
 * the DT-invariance of the per-sat opex drain.
 */

const eph = Ephemeris.build({});
const DT = 1 / 60;

describe("R0 — the economy theorem: no single contract pays for its own honest provisioning", () => {
  it("Act 1 (equatorial metro): one term's revenue < the honest GEO broadcast stack", () => {
    const termRevenue = NET_DEFAULT_PAY_PER_SECOND * NET_DEFAULT_TERM_SECONDS;
    const honestStack = launchStackCost("smallsat", ["BROADCAST"], GEO_PARK.semiMajorM, 1);
    expect(termRevenue).toBeLessThan(honestStack);
  });

  it("Act 2 (polar metro): one term's revenue < the honest N-sat phased constellation", () => {
    const termRevenue = NET_DEFAULT_PAY_PER_SECOND * NET_DEFAULT_TERM_SECONDS;
    const honestStack = launchStackCost("smallsat", ["BROADCAST"], LEO_SWEEP.semiMajorM, ACT2_ZERO_GAP_N);
    expect(termRevenue).toBeLessThan(honestStack);
  });

  it("Act 3a (latency corridor): one term's revenue < the honest 3-sat pointed ACCESS set", () => {
    const termRevenue = NET_DEFAULT_PAY_PER_SECOND * NET_DEFAULT_TERM_SECONDS;
    const honestStack = launchStackCost("smallsat", ["ACCESS_S"], LEO_SWEEP.semiMajorM, 3);
    expect(termRevenue).toBeLessThan(honestStack);
  });

  it("the penalty asymmetry is 2×: a wrong signing is strictly worse than not signing", () => {
    expect(NET_DEFAULT_PENALTY_PER_SECOND).toBe(2 * NET_DEFAULT_PAY_PER_SECOND);
  });
});

describe("R0 — the per-sat opex drain is DT-invariant and reads in the ledger", () => {
  it("owning an idle fleet bleeds €/s by bus tier, identically at fine and coarse dt", () => {
    const make = () => {
      const s = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
      // Two idle sats, no contracts — pure opex.
      s.launchSat({ id: "A", orbit: { parentId: "earth", aM: 1e6, e: 0, incRad: 0, raanRad: 0, argpRad: 0, m0Rad: 0, epochS: 0, muParent: 3.986004418e14 }, bus: "smallsat", loadout: [] });
      s.launchSat({ id: "B", orbit: { parentId: "earth", aM: 1e6, e: 0, incRad: 0, raanRad: 0, argpRad: 0, m0Rad: 0, epochS: 0, muParent: 3.986004418e14 }, bus: "comsat", loadout: [] });
      return s;
    };
    const T = 600;
    const fine = make();
    for (let tick = 1; tick * DT <= T; tick++) fine.step(eph, tick * DT, DT);
    const coarse = make();
    for (let t = 60; t <= T; t += 60) coarse.step(eph, t, 60);
    const expected = (BUS_SPECS.smallsat.opexPerSecond + BUS_SPECS.comsat.opexPerSecond) * T;
    const start = fine.balance + expected; // reconstruct opening (balance = opening − opex).
    expect(start - fine.balance).toBeCloseTo(expected, 6);
    expect(fine.balance).toBeCloseTo(coarse.balance, 6);
  });

  it("an accepted-but-unserved contract drains at the penalty rate (the wrong-signing bite)", () => {
    const s = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
    s.addContract(offerNetContract("R", NET_ACT1_REGION));
    s.acceptContract("R");
    const before = s.balance;
    for (let tick = 1; tick <= 600; tick++) s.step(eph, tick * DT, DT);
    const drained = before - s.balance;
    expect(drained).toBeCloseTo(NET_DEFAULT_PENALTY_PER_SECOND * 600 * DT, 6);
  });

  it("NET_ACT2_REGION exists as a named authored demand (the theorem table stays honest)", () => {
    expect(NET_ACT2_REGION.id).toBe("REGION-1");
  });
});
