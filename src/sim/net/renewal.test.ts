import { describe, it, expect } from "vitest";
import { Ephemeris } from "../ephemeris";
import { NetSession } from "./session";
import {
  offerNetContract,
  renewalOffer,
  NET_RENEWAL_PAY_GROWTH,
  NET_RENEWAL_OFFER_WINDOW_S,
} from "./contract";
import { NET_ACT1_REGION, NET_ACT1_GROUND } from "./endpoint";
import { GEO_PARK, resolveOrbit } from "./world";
import { standardLoadout } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";

/** R3 (SD-45) — RENEWALS + OFFER WINDOWS: the sustaining economy loop. */

const eph = Ephemeris.build({});
const DT = 1 / 60;

describe("R3 — a completed term spawns its renewal offer (grown demand, richer tariff, on a clock)", () => {
  it("completion → a renewal offer appears with pay ×growth and offeredLoad = the grown baseline", () => {
    const s = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
    s.launchSat({ id: "SAT-GEO", orbit: resolveOrbit(GEO_PARK, 0), bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) });
    // A SHORT term so completion lands quickly.
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION, { termSeconds: 30 }));
    s.acceptContract("REGION-0");
    for (let tick = 1; tick * DT <= 40; tick++) s.step(eph, tick * DT, DT);
    const base = s.contractById("REGION-0")!;
    expect(base.state).toBe("completed");
    const renewal = s.contractById("REGION-0+R1");
    expect(renewal).not.toBeNull();
    expect(renewal!.state).toBe("offered");
    expect(renewal!.payPerSecond).toBeCloseTo(base.payPerSecond * NET_RENEWAL_PAY_GROWTH, 9);
    expect(renewal!.offeredLoad).toBeCloseTo(base.loadBaseline, 9);
    expect(Number.isFinite(renewal!.offerExpiresAtS)).toBe(true);
  });

  it("an un-signed renewal LAPSES at its window (the shared m2 expiry)", () => {
    const s = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
    s.launchSat({ id: "SAT-GEO", orbit: resolveOrbit(GEO_PARK, 0), bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) });
    s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION, { termSeconds: 30 }));
    s.acceptContract("REGION-0");
    const horizon = 40 + NET_RENEWAL_OFFER_WINDOW_S + 10;
    for (let t = 1; t <= horizon; t++) s.step(eph, t, 1);
    const renewal = s.contractById("REGION-0+R1")!;
    expect(renewal.state).toBe("failed"); // lapsed, never signed.
  });

  it("renewals are DETERMINISTIC on replay (same steps → same board)", () => {
    const run = () => {
      const s = new NetSession(undefined, undefined, [NET_ACT1_GROUND], []);
      s.launchSat({ id: "SAT-GEO", orbit: resolveOrbit(GEO_PARK, 0), bus: "smallsat", loadout: standardLoadout(NET_REF_LINK_DISTANCE_M) });
      s.addContract(offerNetContract("REGION-0", NET_ACT1_REGION, { termSeconds: 30 }));
      s.acceptContract("REGION-0");
      for (let tick = 1; tick * DT <= 45; tick++) s.step(eph, tick * DT, DT);
      return s.snapshot();
    };
    expect(run()).toEqual(run());
  });

  it("renewalOffer is pure and generation-stable", () => {
    const base = offerNetContract("X", NET_ACT1_REGION, {});
    base.loadBaseline = 1.33;
    const r1 = renewalOffer(base, 1, 100);
    expect(r1.id).toBe("X+R1");
    expect(renewalOffer(r1, 2, 200).id).toBe("X+R2");
    expect(r1.offeredLoad).toBeCloseTo(1.33, 9);
  });
});
