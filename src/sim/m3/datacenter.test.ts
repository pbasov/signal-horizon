import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import {
  type Datacenter,
  resolveDCCompute,
  computeLiftMultiplier,
  bodyDistanceAU,
  MAX_COMPUTE_LIFT,
  RADIATOR_W_PER_M2,
  THERMAL_W_PER_UNIT,
  COMPUTE_W_PER_UNIT,
  RTG_POWER_W,
} from "./datacenter";
import { DCRoster } from "./dc-roster";
import { BuildSession } from "../m2/session";

/**
 * M3a — THE ORBITAL DATACENTER + THERMAL/POWER MODEL (GDD §4.5). Proves the §4.5 physics is
 * real (each ceiling bites) and the force-multiplier is wired into the loop + BOUNDED (Risk-5).
 */

const GOLDEN_DT = 1 / 60;

/** A balanced Earth DC (thermal-limited at 1 AU) — the default-spec node. */
function earthDC(over: Partial<Datacenter> = {}): Datacenter {
  return { id: "dc0", bodyId: "earth", subLatRad: 0, subLonRad: 0, panelM2: 1.5, radiatorM2: 1.5, rtg: false, ...over };
}

describe("M3a datacenter — the §4.5 power/thermal/compute model", () => {
  it("POWER falls off as 1/distance²: an Earth DC is far more power-rich than a Mars DC", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    const earthAU = bodyDistanceAU(eph, "earth", t);
    const marsAU = bodyDistanceAU(eph, "mars", t);
    expect(earthAU).toBeGreaterThan(0.9);
    expect(earthAU).toBeLessThan(1.1);
    expect(marsAU).toBeGreaterThan(1.3); // Mars is further out

    const earth = resolveDCCompute(eph, earthDC(), t);
    const mars = resolveDCCompute(eph, earthDC({ bodyId: "mars" }), t);
    // Solar power scales 1/d²: the ratio of solar powers equals the inverse-square of distances.
    expect(earth.solarPowerW / mars.solarPowerW).toBeCloseTo(
      (marsAU * marsAU) / (earthAU * earthAU),
      6,
    );
    expect(mars.solarPowerW).toBeLessThan(earth.solarPowerW); // outer-system is power-starved
    // The flux fraction is exactly 1/d².
    expect(earth.fluxFraction).toBeCloseTo(1 / (earthAU * earthAU), 9);
  });

  it("the THERMAL ceiling bites: a panel-rich, radiator-poor Earth DC is thermally throttled", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    // Huge panels, tiny radiator → power is plentiful but heat can't be shed.
    const c = resolveDCCompute(eph, earthDC({ panelM2: 50, radiatorM2: 0.5 }), t);
    expect(c.thermalLimited).toBe(true);
    expect(c.computeUnits).toBe(c.thermalLimitedCompute); // min() picked the thermal ceiling
    expect(c.computeUnits).toBeLessThan(c.powerLimitedCompute); // power was the looser ceiling
    // The thermal compute is exactly rejectableHeat / THERMAL_W_PER_UNIT.
    expect(c.rejectableHeatW).toBeCloseTo(0.5 * RADIATOR_W_PER_M2, 9);
    expect(c.thermalLimitedCompute).toBeCloseTo(c.rejectableHeatW / THERMAL_W_PER_UNIT, 9);
  });

  it("the POWER ceiling bites: a radiator-rich, panel-poor or far DC is power-limited", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    // Big radiators, small panels → can shed lots of heat but can't generate the power.
    const c = resolveDCCompute(eph, earthDC({ panelM2: 0.5, radiatorM2: 50 }), t);
    expect(c.thermalLimited).toBe(false);
    expect(c.computeUnits).toBe(c.powerLimitedCompute);
    expect(c.computeUnits).toBeLessThan(c.thermalLimitedCompute);
    expect(c.powerLimitedCompute).toBeCloseTo(c.powerW / COMPUTE_W_PER_UNIT, 9);
  });

  it("COMPUTE BUDGET = min(power-limited, thermal-limited): both ceilings are honoured", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    const c = resolveDCCompute(eph, earthDC(), t);
    expect(c.computeUnits).toBe(Math.min(c.powerLimitedCompute, c.thermalLimitedCompute));
    expect(c.computeUnits).toBeGreaterThan(0);
  });

  it("an RTG rescues a power-starved Mars DC (constant power, distance-independent)", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    const solar = resolveDCCompute(eph, earthDC({ bodyId: "mars", panelM2: 0.5, radiatorM2: 50 }), t);
    const withRtg = resolveDCCompute(eph, earthDC({ bodyId: "mars", panelM2: 0.5, radiatorM2: 50, rtg: true }), t);
    // Solar-only Mars DC is power-starved; the RTG adds a constant floor that lifts compute.
    expect(withRtg.rtgPowerW).toBeCloseTo(RTG_POWER_W, 9);
    expect(solar.rtgPowerW).toBe(0);
    expect(withRtg.powerW - solar.powerW).toBeCloseTo(RTG_POWER_W, 6);
    expect(withRtg.computeUnits).toBeGreaterThan(solar.computeUnits);
    // The RTG power does NOT depend on distance: the same DC at Earth has the same RTG term.
    const earthRtg = resolveDCCompute(eph, earthDC({ panelM2: 0.5, radiatorM2: 50, rtg: true }), t);
    expect(earthRtg.rtgPowerW).toBeCloseTo(withRtg.rtgPowerW, 9);
  });

  it("the force-multiplier is BOUNDED + diminishing-returns (Risk-5: no runaway)", () => {
    // Zero compute → no lift. More compute → more lift, but strictly under the cap, forever.
    expect(computeLiftMultiplier(0)).toBe(1.0);
    expect(computeLiftMultiplier(10)).toBeGreaterThan(1.0);
    expect(computeLiftMultiplier(1e9)).toBeLessThan(1 + MAX_COMPUTE_LIFT);
    expect(computeLiftMultiplier(1e9)).toBeGreaterThan(1 + MAX_COMPUTE_LIFT * 0.99);
    // Monotone increasing + concave (diminishing returns): each extra unit adds less.
    const a = computeLiftMultiplier(2) - computeLiftMultiplier(1);
    const b = computeLiftMultiplier(11) - computeLiftMultiplier(10);
    expect(a).toBeGreaterThan(b);
    expect(b).toBeGreaterThan(0);
  });
});

describe("M3a DC roster — the edge-compute footprint force-multiplier", () => {
  it("a DC lifts a contract IN its footprint, and leaves an out-of-footprint region untouched", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    const roster = new DCRoster();
    // A DC over South America (-15°, -55°).
    roster.place("earth", -15 * (Math.PI / 180), -55 * (Math.PI / 180), 1.5, 1.5, false);
    const south = { bodyId: "earth", latRad: -15 * (Math.PI / 180), lonRad: -55 * (Math.PI / 180) };
    const eastAsia = { bodyId: "earth", latRad: 35 * (Math.PI / 180), lonRad: 120 * (Math.PI / 180) };
    const mars = { bodyId: "mars", latRad: -15 * (Math.PI / 180), lonRad: -55 * (Math.PI / 180) };
    expect(roster.liftFor(eph, south, t)).toBeGreaterThan(1.0); // in footprint → lifted
    expect(roster.liftFor(eph, eastAsia, t)).toBe(1.0); // far region → no lift
    expect(roster.liftFor(eph, mars, t)).toBe(1.0); // different body → no reach
  });

  it("the lift is the MAX over DCs (not summed) — stacking can't break the bound", () => {
    const eph = loadEphemeris();
    const t = 1_000_000;
    const roster = new DCRoster();
    const region = { bodyId: "earth", latRad: 0, lonRad: 0 };
    roster.place("earth", 0, 0, 1.5, 1.5, false);
    const one = roster.liftFor(eph, region, t);
    roster.place("earth", 0, 0, 1.5, 1.5, false); // a second co-located DC
    const two = roster.liftFor(eph, region, t);
    expect(two).toBe(one); // MAX, not SUM → still one DC's bounded lift
    expect(two).toBeLessThan(1 + MAX_COMPUTE_LIFT);
  });

  it("an empty roster applies no lift", () => {
    const eph = loadEphemeris();
    expect(new DCRoster().liftFor(eph, { bodyId: "earth", latRad: 0, lonRad: 0 }, 0)).toBe(1.0);
  });
});

describe("M3a — the DC is wired into the BuildSession economy + folds into the snapshot", () => {
  it("placing a DC over a served contract's region lifts the € it earns (force-multiplier)", () => {
    const eph = loadEphemeris();
    const MAX_TICK = Math.round(7000 / GOLDEN_DT);

    // Drive two identical built sessions to a served, accepted contract; one ALSO places a DC
    // over the contract's region. The DC session must earn MORE on the same coverage.
    const drive = (placeDC: boolean) => {
      const s = new BuildSession();
      s.deployGround(1); // SOUTH ASIA
      s.deployGround(6); // SOUTH AMERICA (covers c0)
      s.deployGround(2); // NORTH AMERICA
      s.launchSat("leo_53", 0);
      s.launchSat("meo_63", 0);
      s.launchSat("geo_eq", 0);
      let acceptedId: string | null = null;
      for (let tick = 0; tick <= MAX_TICK; tick++) {
        const t = tick * GOLDEN_DT;
        s.step(eph, t, GOLDEN_DT);
        if (acceptedId === null) {
          const offer = s.contracts.find((c) => c.state === "offered");
          if (offer) {
            // Place the DC over the SAME region the contract serves (its centroid), then accept
            // it — so the contract is genuinely in the DC's edge-compute footprint. Uses the
            // roster directly so the placement is over the RNG-chosen region (the candidate-list
            // place path is exercised by the snapshot test below).
            if (placeDC) s.dcRoster.place("earth", offer.centerLatRad, offer.centerLonRad, 1.5, 1.5, false);
            s.acceptContract(offer.id, t);
            acceptedId = offer.id;
          }
        }
      }
      return s.contracts.find((c) => c.id === acceptedId)!;
    };

    const noDC = drive(false);
    const withDC = drive(true);
    expect(noDC.id).toBe(withDC.id); // same deterministic offer accepted
    expect(noDC.servedSecondsAccum).toBeGreaterThan(0);
    expect(withDC.earnedEur).toBeGreaterThan(noDC.earnedEur); // the DC force-multiplied the €
    // …but BOUNDED: the lift can't more than ~MAX_COMPUTE_LIFT the revenue.
    expect(withDC.earnedEur).toBeLessThan(noDC.earnedEur * (1 + MAX_COMPUTE_LIFT) + 1);
  });

  it("the DC roster folds into the snapshot and round-trips through restore", () => {
    const a = new BuildSession();
    a.placeDatacenter(0);
    a.placeDatacenter(5); // MARS · ORBIT
    const snap = a.snapshot();
    expect(snap.datacenters.datacenters.length).toBe(2);
    expect(snap.datacenters.datacenters[0].bodyId).toBe("earth");
    expect(snap.datacenters.datacenters[1].bodyId).toBe("mars");

    const b = new BuildSession();
    b.restore(snap);
    expect(b.snapshot()).toEqual(snap); // bit-identical round-trip
    expect(b.dcRoster.count).toBe(2);
  });
});
