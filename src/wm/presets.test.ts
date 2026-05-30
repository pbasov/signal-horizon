import { describe, it, expect } from "vitest";
import { PRESET_SPECS, buildGrid } from "./presets";
import { validate, allHosts } from "./zonegrid";

describe("WM presets — the 3 main layouts (the 7→3 cut)", () => {
  it("is exactly THREE presets: PLAY · MAP · REVIEW", () => {
    expect(PRESET_SPECS.map((p) => p.name)).toEqual(["PLAY", "MAP", "REVIEW"]);
  });

  it("the retired 7-preset names are GONE (no dangling presets)", () => {
    const names = new Set(PRESET_SPECS.map((p) => p.name));
    for (const retired of ["OVERVIEW", "OPS", "TRACK", "STREAM", "SPLIT", "PARSE", "CONTRACTS"]) {
      expect(names.has(retired)).toBe(false);
    }
  });

  it("every preset compiles into a VALID DD-10 grid (always-tiled invariant)", () => {
    for (const spec of PRESET_SPECS) {
      const g = buildGrid(spec);
      expect(validate(g), `${spec.name} must be a legal grid`).toBe(true);
      // No duplicate host within a grid (validate enforces this, but assert it reads).
      const hosts = allHosts(g);
      expect(new Set(hosts).size).toBe(hosts.length);
    }
  });

  it("PLAY is the orrery-hero working layout (orrery + finance + contracts)", () => {
    const play = buildGrid(PRESET_SPECS[0]);
    const hosts = new Set(allHosts(play));
    expect(hosts).toEqual(new Set(["orrery", "finance", "contracts"]));
    // The orrery is the hero (left column, full height).
    expect(play.columns[0].rows[0].zone.hosts).toEqual(["orrery"]);
  });

  it("MAP is the near-full-bleed monument (a single orrery zone)", () => {
    const map = buildGrid(PRESET_SPECS[1]);
    expect(map.columns).toHaveLength(1);
    expect(map.columns[0].rows).toHaveLength(1);
    expect(allHosts(map)).toEqual(["orrery"]);
  });

  it("REVIEW is the at-rest analysis layout (parse hero + log + finance)", () => {
    const review = buildGrid(PRESET_SPECS[2]);
    expect(new Set(allHosts(review))).toEqual(new Set(["parse", "system-log", "finance"]));
    // THE PARSE is the hero (wide left column).
    expect(review.columns[0].rows[0].zone.hosts).toEqual(["parse"]);
  });
});
