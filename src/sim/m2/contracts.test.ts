import { describe, it, expect } from "vitest";
import { GeodesicGrid } from "../coverage/grid";
import { DemandField } from "../coverage/demand";
import { SimRng } from "../rng";
import {
  type ContractTarget,
  BREACH_GRACE_SECONDS,
  BREACH_PENALTY_PER_SECOND,
  TARIFF_PER_DEMAND_PER_SECOND,
  contractRevenueRatePerSecond,
  offerContract,
  resolveTargetCells,
  stepActiveContract,
  stepOfferedContract,
} from "./contracts";
import { ContractGenerator, CONTRACT_TARGETS, MAX_OPEN_OFFERS, openOfferCount } from "./contract-generator";

/**
 * M2d — the PURE contracts state machine + the deterministic offer generator.
 *
 * Guards the contract model independent of the session wiring: the target region
 * resolves deterministically off the grid; the tariff scales with region demand; the
 * OFFERED → ACTIVE → COMPLETED / FAILED transitions fire on the right (servedFraction,
 * sim-time) inputs; the revenue rate is pro-rata to the served fraction with a breach
 * penalty; and the generator's offers come off the seeded SimRng in a reproducible
 * timeline (same seed ⇒ same offers at the same ticks).
 */

const DEG = Math.PI / 180;
const grid = GeodesicGrid.build();
const demand = DemandField.build(grid);

function tgt(label: string, latDeg: number, lonDeg: number, radiusDeg = 22): ContractTarget {
  return { label, latRad: latDeg * DEG, lonRad: lonDeg * DEG, radiusRad: radiusDeg * DEG };
}

describe("contracts — target resolution + offer shape", () => {
  it("resolves a target region to a stable, sorted, non-empty cell set with positive demand", () => {
    const a = resolveTargetCells(grid, demand, tgt("EAST ASIA", 35, 120));
    const b = resolveTargetCells(grid, demand, tgt("EAST ASIA", 35, 120));
    expect(a.cellIds).toEqual(b.cellIds); // deterministic
    expect(a.cellIds.length).toBeGreaterThan(0);
    // sorted ascending, no duplicates.
    for (let i = 1; i < a.cellIds.length; i++) expect(a.cellIds[i]).toBeGreaterThan(a.cellIds[i - 1]);
    expect(a.regionDemand).toBeGreaterThan(0);
  });

  it("never returns an empty region — a tiny radius falls back to the single nearest cell", () => {
    const r = resolveTargetCells(grid, demand, tgt("PINPOINT", 0, 0, 0.001));
    expect(r.cellIds.length).toBe(1);
    expect(r.regionDemand).toBeGreaterThanOrEqual(0);
  });

  it("offer tariff scales with region demand (a denser metro is worth more)", () => {
    const eastAsia = offerContract("c0", grid, demand, tgt("EAST ASIA", 35, 120), 0);
    const ocean = offerContract("c1", grid, demand, tgt("S PACIFIC", -40, -150), 0);
    expect(eastAsia.tariffPerSecond).toBeCloseTo(eastAsia.regionDemand * TARIFF_PER_DEMAND_PER_SECOND, 9);
    expect(eastAsia.regionDemand).toBeGreaterThan(ocean.regionDemand);
    expect(eastAsia.tariffPerSecond).toBeGreaterThan(ocean.tariffPerSecond);
    expect(eastAsia.state).toBe("offered");
  });
});

describe("contracts — the pure state machine", () => {
  it("an OFFERED contract auto-expires to FAILED past its offer window (no action)", () => {
    const c = offerContract("c0", grid, demand, tgt("EAST ASIA", 35, 120), 0);
    expect(stepOfferedContract(c, c.offerExpiresAtS - 1)).toBe(false);
    expect(c.state).toBe("offered");
    expect(stepOfferedContract(c, c.offerExpiresAtS)).toBe(true);
    expect(c.state).toBe("failed");
  });

  it("an ACTIVE contract COMPLETES once the served-time reaches the term", () => {
    const c = offerContract("c0", grid, demand, tgt("EAST ASIA", 35, 120), 0);
    c.state = "active";
    c.termSeconds = 100;
    // Served fully (fraction 1) for 99s — not yet done.
    expect(stepActiveContract(c, 1.0, 99)).toBeNull();
    expect(c.state).toBe("active");
    // One more second crosses the term.
    expect(stepActiveContract(c, 1.0, 1)).toBe("completed");
    expect(c.state).toBe("completed");
  });

  it("partial service integrates pro-rata: half-served takes twice the wall-time to complete", () => {
    const c = offerContract("c0", grid, demand, tgt("EAST ASIA", 35, 120), 0);
    c.state = "active";
    c.termSeconds = 100;
    // Half-served for 199s accumulates 99.5s of served-time — not yet complete.
    expect(stepActiveContract(c, 0.5, 199)).toBeNull();
    expect(c.servedSecondsAccum).toBeCloseTo(99.5, 6);
    expect(stepActiveContract(c, 0.5, 2)).toBe("completed"); // crosses 100
  });

  it("an ACTIVE contract FAILS after a sustained breach past the grace, and a serve resets it", () => {
    const c = offerContract("c0", grid, demand, tgt("EAST ASIA", 35, 120), 0);
    c.state = "active";
    c.termSeconds = 1e9; // far away so the failure is the breach, not completion.
    // Breach just under the grace — still active.
    expect(stepActiveContract(c, 0.0, BREACH_GRACE_SECONDS - 1)).toBeNull();
    expect(c.state).toBe("active");
    // A serve resets the breach window.
    expect(stepActiveContract(c, 1.0, 1)).toBeNull();
    expect(c.breachSecondsAccum).toBe(0);
    // A fresh sustained breach reaches the grace → FAILED.
    expect(stepActiveContract(c, 0.0, BREACH_GRACE_SECONDS)).toBe("failed");
    expect(c.state).toBe("failed");
  });

  it("the revenue rate is tariff×fraction served, a breach penalty when wholly unserved, 0 when not active", () => {
    const c = offerContract("c0", grid, demand, tgt("EAST ASIA", 35, 120), 0);
    expect(contractRevenueRatePerSecond(c, 1.0)).toBe(0); // not active yet
    c.state = "active";
    expect(contractRevenueRatePerSecond(c, 1.0)).toBeCloseTo(c.tariffPerSecond, 9);
    expect(contractRevenueRatePerSecond(c, 0.5)).toBeCloseTo(c.tariffPerSecond * 0.5, 9);
    expect(contractRevenueRatePerSecond(c, 0.0)).toBe(-BREACH_PENALTY_PER_SECOND);
  });
});

describe("contract generator — deterministic offers off the seeded PRNG", () => {
  it("offers the same contracts at the same sim-times for the same seed", () => {
    const run = () => {
      const gen = new ContractGenerator();
      const rng = new SimRng(7n);
      const contracts: ReturnType<typeof offerContract>[] = [];
      const offeredAt: number[] = [];
      for (let t = 0; t <= 30 * 3600; t += 1800) {
        const newly = gen.step(contracts, rng, grid, demand, t);
        for (const c of newly) offeredAt.push(c.offeredAtS);
      }
      return { ids: contracts.map((c) => c.id), labels: contracts.map((c) => c.label), offeredAt };
    };
    const a = run();
    const b = run();
    expect(a.ids).toEqual(b.ids);
    expect(a.labels).toEqual(b.labels);
    expect(a.offeredAt).toEqual(b.offeredAt);
    expect(a.ids.length).toBeGreaterThan(0); // some offers actually fired
    for (const l of a.labels) expect(CONTRACT_TARGETS.map((t) => t.label)).toContain(l);
  });

  it("never exceeds the open-offer cap while none are accepted/declined", () => {
    const gen = new ContractGenerator();
    const rng = new SimRng(7n);
    const contracts: ReturnType<typeof offerContract>[] = [];
    for (let t = 0; t <= 100 * 3600; t += 600) {
      gen.step(contracts, rng, grid, demand, t);
      expect(openOfferCount(contracts)).toBeLessThanOrEqual(MAX_OPEN_OFFERS);
    }
  });
});
