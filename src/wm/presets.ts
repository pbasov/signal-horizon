/**
 * Preset layouts as DATA (not hardcoded layout logic) — mirrors the
 * presets-as-data principle (data/layouts/*.json in the Godot project). Each
 * preset is an authoring spec compiled into a ZoneGrid. Switching a preset is a
 * single keystroke that swaps the whole layout instantly.
 *
 * OVERVIEW and OPS are the two designed presets the brief asks for. TRACK /
 * STREAM / SPLIT fill keys 3–5 to exercise data-driven instant switching and
 * the 3-column ceiling — recombinations of the same panels.
 *
 * OPS (key 2) is the finance-forward preset: it carries the FINANCE dashboard
 * (NETWORK·FINANCE) in its right column alongside the orrery + telemetry, so the
 * solvency loop is glanceable while you watch the link. Each grid keeps the
 * DD-10 invariant: ≤3 columns × ≤3 rows per column, every host UNIQUE in the grid.
 *
 * Panels (hosts) available in this spike: orrery, system-log, telemetry, finance.
 */
import type { ZoneGrid } from "./zonegrid";

export interface PresetSpec {
  name: string;
  columns: { weight: number; rows: { weight: number; host: string }[] }[];
}

export function buildGrid(spec: PresetSpec): ZoneGrid {
  return {
    columns: spec.columns.map((c) => ({
      weight: c.weight,
      rows: c.rows.map((r) => ({ weight: r.weight, zone: { hosts: [r.host], active: 0 } })),
    })),
  };
}

export const PRESET_SPECS: PresetSpec[] = [
  {
    name: "OVERVIEW",
    columns: [
      { weight: 0.62, rows: [{ weight: 1, host: "orrery" }] },
      {
        weight: 0.38,
        rows: [
          { weight: 1.0, host: "telemetry" },
          { weight: 2.0, host: "system-log" },
        ],
      },
    ],
  },
  {
    name: "OPS",
    columns: [
      { weight: 0.58, rows: [{ weight: 1, host: "system-log" }] },
      {
        weight: 0.42,
        rows: [
          { weight: 1.4, host: "orrery" },
          { weight: 1.0, host: "telemetry" },
          { weight: 1.2, host: "finance" },
        ],
      },
    ],
  },
  {
    name: "TRACK",
    columns: [
      { weight: 0.72, rows: [{ weight: 1, host: "orrery" }] },
      {
        weight: 0.28,
        rows: [
          { weight: 1.0, host: "telemetry" },
          { weight: 1.4, host: "system-log" },
        ],
      },
    ],
  },
  {
    name: "STREAM",
    columns: [
      { weight: 0.34, rows: [{ weight: 1, host: "telemetry" }] },
      {
        weight: 0.66,
        rows: [
          { weight: 1.7, host: "orrery" },
          { weight: 1.0, host: "system-log" },
        ],
      },
    ],
  },
  {
    name: "SPLIT",
    columns: [
      { weight: 0.42, rows: [{ weight: 1, host: "orrery" }] },
      { weight: 0.3, rows: [{ weight: 1, host: "telemetry" }] },
      { weight: 0.28, rows: [{ weight: 1, host: "system-log" }] },
    ],
  },
];
