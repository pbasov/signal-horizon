import { describe, it, expect } from "vitest";
import {
  classifyOrbit,
  deriveFleet,
  type FleetDatasetSat,
  type FleetRosterSat,
} from "./fleet";

const DEG = Math.PI / 180;
const EARTH_R = 6_371_000; // m (matches data/system.json earth.radius_km order)
const MARS_R = 3_389_500;

// --- dataset descriptors (mirror data/system.json sats, parent = earth) -------
function ds(id: string, parentId: string, aKm: number, incDeg: number, periodMin: number): FleetDatasetSat {
  return {
    id,
    parentId,
    aM: aKm * 1000,
    e: 0,
    incRad: incDeg * DEG,
    periodS: periodMin * 60,
    parentRadiusM: parentId === "earth" ? EARTH_R : MARS_R,
  };
}

function rs(id: string, parentId: string, aKm: number, incDeg: number, periodMin: number, eirp = 1): FleetRosterSat {
  return {
    id,
    parentId,
    aM: aKm * 1000,
    e: 0,
    incRad: incDeg * DEG,
    periodS: periodMin * 60,
    parentRadiusM: parentId === "earth" ? EARTH_R : MARS_R,
    eirp,
  };
}

// The four shipped dataset sats (all parent = earth).
const DATASET: FleetDatasetSat[] = [
  ds("sat_leo", "earth", 6771, 53, 92.4),
  ds("sat_geo", "earth", 42164, 0, 1436),
  ds("sat_meo_inc", "earth", 26560, 63.4, 717),
  ds("sat_meo_polar", "earth", 26560, 90, 717),
];

describe("classifyOrbit — the altitude-band regime split", () => {
  it("classifies the canonical Earth bands by altitude above the surface", () => {
    expect(classifyOrbit(400)).toBe("LEO"); // ~sat_leo
    expect(classifyOrbit(2000)).toBe("LEO"); // band edge inclusive
    expect(classifyOrbit(20200)).toBe("MEO"); // ~sat_meo
    expect(classifyOrbit(35786)).toBe("GEO"); // geostationary belt
    expect(classifyOrbit(60000)).toBe("HEO"); // beyond GEO
  });

  it("treats at/below-surface altitudes as SURFACE (defensive)", () => {
    expect(classifyOrbit(0)).toBe("SURFACE");
    expect(classifyOrbit(-10)).toBe("SURFACE");
  });
});

describe("deriveFleet — N dataset + M launched, no cross-body leakage", () => {
  it("lists exactly N dataset + M launched sats for the focused body, correct classes", () => {
    const roster: FleetRosterSat[] = [
      rs("s0", "earth", 6771, 53, 92.4, 1.0), // LEO launch
      rs("s1", "earth", 42164, 0, 1436, 1.8), // GEO launch
    ];
    const fleet = deriveFleet("earth", DATASET, roster);
    expect(fleet.bodyId).toBe("earth");
    expect(fleet.datasetCount).toBe(4); // all 4 dataset sats orbit earth
    expect(fleet.launchedCount).toBe(2);
    expect(fleet.total).toBe(6); // N + M = 4 + 2

    // Dataset rows come first (in source order), then launched (in launch order).
    expect(fleet.sats.map((s) => s.id)).toEqual([
      "sat_leo",
      "sat_geo",
      "sat_meo_inc",
      "sat_meo_polar",
      "s0",
      "s1",
    ]);

    // Correct classes derived from altitude bands.
    const byId = new Map(fleet.sats.map((s) => [s.id, s]));
    expect(byId.get("sat_leo")!.orbitClass).toBe("LEO");
    expect(byId.get("sat_geo")!.orbitClass).toBe("GEO");
    expect(byId.get("sat_meo_inc")!.orbitClass).toBe("MEO");
    expect(byId.get("s0")!.orbitClass).toBe("LEO");
    expect(byId.get("s1")!.orbitClass).toBe("GEO");

    // Kind + status tagged correctly.
    expect(byId.get("sat_leo")!.kind).toBe("DATASET");
    expect(byId.get("s0")!.kind).toBe("LAUNCHED");
    expect(fleet.sats.every((s) => s.status === "active")).toBe(true);

    // Derived altitude / period / inclination read straight from elements.
    expect(byId.get("sat_leo")!.altitudeKm).toBeCloseTo((6771000 - EARTH_R) / 1000, 6);
    expect(byId.get("sat_geo")!.periodMin).toBeCloseTo(1436, 6);
    expect(byId.get("sat_meo_polar")!.inclinationDeg).toBeCloseTo(90, 6);

    // Launched EIRP is carried through; dataset sats read the nominal 1.0 weight.
    expect(byId.get("s1")!.eirp).toBe(1.8);
    expect(byId.get("sat_leo")!.eirp).toBe(1.0);
  });

  it("does NOT leak sats from a different body (a Mars launch is absent from EARTH's fleet)", () => {
    const roster: FleetRosterSat[] = [
      rs("s0", "earth", 6771, 53, 92.4),
      rs("s1", "mars", 4000, 25, 120), // a sat around Mars — must NOT appear under earth
    ];
    const earthFleet = deriveFleet("earth", DATASET, roster);
    expect(earthFleet.sats.map((s) => s.id)).not.toContain("s1");
    expect(earthFleet.total).toBe(5); // 4 dataset + s0 only

    const marsFleet = deriveFleet("mars", DATASET, roster);
    // No dataset sats orbit Mars in the shipped data; only the launched s1.
    expect(marsFleet.datasetCount).toBe(0);
    expect(marsFleet.launchedCount).toBe(1);
    expect(marsFleet.sats.map((s) => s.id)).toEqual(["s1"]);
  });

  it("a body with no fleet yields an empty fleet (the panel placeholder case)", () => {
    const fleet = deriveFleet("moon", DATASET, []);
    expect(fleet.bodyId).toBe("moon");
    expect(fleet.total).toBe(0);
    expect(fleet.sats).toEqual([]);
    expect(fleet.datasetCount).toBe(0);
    expect(fleet.launchedCount).toBe(0);
  });

  it("a null focus (nothing selected) yields an empty fleet", () => {
    const fleet = deriveFleet(null, DATASET, [rs("s0", "earth", 6771, 53, 92.4)]);
    expect(fleet.bodyId).toBeNull();
    expect(fleet.total).toBe(0);
    expect(fleet.sats).toEqual([]);
  });

  it("is deterministic — same inputs, same rows", () => {
    const roster = [rs("s0", "earth", 6771, 53, 92.4)];
    const a = deriveFleet("earth", DATASET, roster);
    const b = deriveFleet("earth", DATASET, roster);
    expect(a).toEqual(b);
  });
});
