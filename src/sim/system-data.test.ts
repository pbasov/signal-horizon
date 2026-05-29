import { describe, it, expect } from "vitest";
import { loadEphemeris, SYSTEM } from "./system-data";

/**
 * LOADER pins for system-data.ts: SYSTEM (the parsed data/system.json spec) and
 * loadEphemeris() (= Ephemeris.build(SYSTEM)). These assert the dataset wiring
 * the loader is responsible for — the right bodies, counts and parent links —
 * NOT Kepler propagation (that is golden-mastered in ephemeris.test.ts).
 *
 * The canonical dataset is the vendored data/system.json: 4 bodies
 * (sun, earth, mars, moon) + 4 satellites (sat_leo, sat_geo, sat_meo_inc,
 * sat_meo_polar), all flattened into one ephemeris body table on load.
 */

const EXPECTED_BODY_IDS = ["earth", "mars", "moon", "sun"];
const EXPECTED_SAT_IDS = ["sat_geo", "sat_leo", "sat_meo_inc", "sat_meo_polar"];
const EXPECTED_ALL_IDS = [...EXPECTED_BODY_IDS, ...EXPECTED_SAT_IDS].sort();

describe("system-data — SYSTEM spec shape (parsed data/system.json)", () => {
  it("parses the epoch and frame header fields", () => {
    expect(SYSTEM.epoch_jd).toBe(2451545.0);
    expect(SYSTEM.frame).toBe("ecliptic_j2000");
  });

  it("splits the spec into a `bodies` table and a `satellites` table", () => {
    expect(SYSTEM.bodies).toBeDefined();
    expect(SYSTEM.satellites).toBeDefined();
    expect(Object.keys(SYSTEM.bodies!).sort()).toEqual(EXPECTED_BODY_IDS);
    expect(Object.keys(SYSTEM.satellites!).sort()).toEqual(EXPECTED_SAT_IDS);
  });

  it("declares the Sun as the parent-less root in the raw spec", () => {
    // Raw spec uses null for the root parent; the loader normalises it to "".
    expect(SYSTEM.bodies!.sun.parent).toBeNull();
  });

  it("declares every satellite as a child of earth in the raw spec", () => {
    for (const id of EXPECTED_SAT_IDS) {
      expect(SYSTEM.satellites![id].parent).toBe("earth");
    }
  });
});

describe("system-data — loadEphemeris() body table", () => {
  it("loads EXACTLY the eight expected bodies (bodies + satellites merged)", () => {
    const eph = loadEphemeris();
    expect(eph.bodies.size).toBe(8);
    expect(eph.bodyIds().sort()).toEqual(EXPECTED_ALL_IDS);
  });

  it("merges the four satellites into the same flat body table as the planets", () => {
    const eph = loadEphemeris();
    for (const id of EXPECTED_ALL_IDS) {
      expect(eph.hasBody(id)).toBe(true);
    }
    // No stray entries beyond the merged 4 + 4.
    expect(eph.bodyIds()).toHaveLength(8);
  });

  it("each loaded id matches its own body record id", () => {
    const eph = loadEphemeris();
    for (const id of EXPECTED_ALL_IDS) {
      expect(eph.bodies.get(id)!.id).toBe(id);
    }
  });
});

describe("system-data — loadEphemeris() parent wiring", () => {
  it("wires the planetary hierarchy: sun is root, earth/mars→sun, moon→earth", () => {
    const eph = loadEphemeris();
    // null parent in the spec is normalised to the empty-string root sentinel.
    expect(eph.parentOf("sun")).toBe("");
    expect(eph.parentOf("earth")).toBe("sun");
    expect(eph.parentOf("mars")).toBe("sun");
    expect(eph.parentOf("moon")).toBe("earth");
  });

  it("wires every satellite to earth", () => {
    const eph = loadEphemeris();
    for (const id of EXPECTED_SAT_IDS) {
      expect(eph.parentOf(id)).toBe("earth");
    }
  });

  it("gives exactly one root (the Sun) and parents the rest to a loaded body", () => {
    const eph = loadEphemeris();
    const roots = eph.bodyIds().filter((id) => eph.bodies.get(id)!.isRoot());
    expect(roots).toEqual(["sun"]);
    for (const id of eph.bodyIds()) {
      if (id === "sun") continue;
      // Every non-root parent must itself resolve to a loaded body.
      expect(eph.hasBody(eph.parentOf(id))).toBe(true);
    }
  });

  it("resolves muParent from the parent body so non-root mean motions are positive", () => {
    const eph = loadEphemeris();
    // Loader's second pass links muParent → derived n. Sun (root) stays at 0.
    expect(eph.bodies.get("sun")!.n).toBe(0);
    for (const id of eph.bodyIds()) {
      if (id === "sun") continue;
      expect(eph.bodies.get(id)!.muParent).toBeGreaterThan(0);
      expect(eph.bodies.get(id)!.n).toBeGreaterThan(0);
    }
  });
});

describe("system-data — loader determinism & SYSTEM consistency", () => {
  it("builds a fresh, independent Ephemeris on each call", () => {
    const a = loadEphemeris();
    const b = loadEphemeris();
    expect(a).not.toBe(b);
    expect(a.bodyIds().sort()).toEqual(b.bodyIds().sort());
  });

  it("propagates the SYSTEM header onto the built Ephemeris", () => {
    const eph = loadEphemeris();
    expect(eph.epochJd).toBe(SYSTEM.epoch_jd);
    expect(eph.frame).toBe(SYSTEM.frame);
  });

  it("loads one body per raw spec entry (bodies + satellites count)", () => {
    const eph = loadEphemeris();
    const rawCount =
      Object.keys(SYSTEM.bodies!).length + Object.keys(SYSTEM.satellites!).length;
    expect(eph.bodies.size).toBe(rawCount);
  });
});
