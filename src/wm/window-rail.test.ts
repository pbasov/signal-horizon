import { describe, it, expect } from "vitest";
import { RAIL_PANELS, NET_RAIL_PANELS } from "./window-rail";
import { PRESET_SPECS, NET_PRESET_SPECS, buildGrid } from "./presets";
import { allHosts } from "./zonegrid";
import { CAMERA_PRESETS } from "../orrery/orrery";

describe("window-summon rail — the panel list", () => {
  it("lists one button per available panel (the registry host set)", () => {
    expect(RAIL_PANELS.map((p) => p.host)).toEqual([
      "orrery",
      "system-log",
      "finance",
      "telemetry",
      "contracts",
      // net/ Act-1 — the LAUNCH planner (host "net-planner", labelled LAUNCH on the rail).
      "net-planner",
      "parse",
      "fleet",
    ]);
  });

  it("covers every host any preset can show (so a preset's panel always has a rail button)", () => {
    const railHosts = new Set(RAIL_PANELS.map((p) => p.host));
    for (const spec of PRESET_SPECS) {
      for (const host of allHosts(buildGrid(spec))) {
        expect(railHosts.has(host), `${host} (in ${spec.name}) must have a rail button`).toBe(true);
      }
    }
  });

  it("has no duplicate hosts (a panel is summoned, never duplicated)", () => {
    const hosts = RAIL_PANELS.map((p) => p.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });
});

/**
 * SD-53 — the NET-side rail/preset coverage, which did not exist. The block above pins CACHE mode
 * only, so a net panel that a preset mounts with no rail button — or a rail host no registry entry
 * answers — passed `npm test` silently. These are the assertions that make that impossible.
 */
describe("net-mode rail — every net preset host is reachable, and TRACE is on the rail", () => {
  it("covers every host any NET preset can show", () => {
    const railHosts = new Set(NET_RAIL_PANELS.map((p) => p.host));
    for (const spec of NET_PRESET_SPECS) {
      for (const host of allHosts(buildGrid(spec))) {
        expect(railHosts.has(host), `${host} (in net preset ${spec.name}) must have a rail button`).toBe(true);
      }
    }
  });

  it("has no duplicate hosts", () => {
    const hosts = NET_RAIL_PANELS.map((p) => p.host);
    expect(new Set(hosts).size).toBe(hosts.length);
  });

  it("carries TRACE — the routing screen ships panel-first, so the rail IS its only mount point", () => {
    expect(NET_RAIL_PANELS.map((p) => p.host)).toContain("trace");
    expect(NET_RAIL_PANELS.find((p) => p.host === "trace")?.label).toBe("TRACE");
  });

  it("every NET preset validates against the DD-10 zone-grid ceiling", () => {
    for (const spec of NET_PRESET_SPECS) {
      expect(spec.columns.length, `${spec.name} columns`).toBeLessThanOrEqual(3);
      for (const col of spec.columns) {
        expect(col.rows.length, `${spec.name} rows`).toBeLessThanOrEqual(3);
        for (const r of col.rows) expect(r.weight).toBeGreaterThan(0);
      }
      const hosts = allHosts(buildGrid(spec));
      expect(new Set(hosts).size, `${spec.name} hosts are unique`).toBe(hosts.length);
    }
  });
});

describe("camera-preset buttons — the SD-35 EARTH/CISLUNAR/ORBITS/SYSTEM/TOP-DOWN set", () => {
  it("is the 5 SD-35 presets in E/C/O/S/T order (the button order == the hotkey index)", () => {
    // The on-canvas buttons are built in CAMERA_PRESETS order; the E/C/O/S/T hotkeys map
    // to indices 0..4 (main.ts). A button click and its hotkey must hit the SAME index.
    expect(CAMERA_PRESETS.map((p) => p.name)).toEqual([
      "EARTH",
      "CISLUNAR",
      "ORBITS",
      "SYSTEM",
      "TOP-DOWN",
    ]);
  });

  it("EARTH is the boot default at index 0 (the E hotkey / first button)", () => {
    expect(CAMERA_PRESETS[0].name).toBe("EARTH");
  });
});
