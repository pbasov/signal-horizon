/**
 * Preset layouts as DATA (not hardcoded layout logic) — mirrors the
 * presets-as-data principle (data/layouts/*.json in the Godot project). Each
 * preset is an authoring spec compiled into a ZoneGrid. Switching a preset is a
 * single keystroke (1–3) that swaps the whole layout instantly.
 *
 * THE 3 MAIN LAYOUTS (the owner's "too many tiling presets — main 3" cut). The
 * earlier 7-preset set (OVERVIEW/OPS/TRACK/STREAM/SPLIT/PARSE/CONTRACTS) is RETIRED;
 * no panel is lost, because the right-edge WINDOW-SUMMON RAIL now composes any panel
 * into any tile LIVE (Shell.summonPanel). The 3 presets are just STARTING POINTS the
 * player rearranges by clicking; the rail makes the old recombinations on-demand.
 *
 *   1 · PLAY    — the working screen: the orrery large on the left, with the two
 *                 live business panels (FINANCE + CONTRACTS) stacked on the right.
 *                 Watch the link + build, see the € climb, take/decline offers — and
 *                 swap any of those right tiles to SYSTEM.LOG / TELEMETRY / PARSE with
 *                 one rail click. The default boot layout.
 *   2 · MAP     — the MONUMENT: the orrery near-full-bleed (a single zone). Watch the
 *                 physics, fly the camera, click bodies/assets, toggle the heatmap.
 *                 Summon a side panel via the rail and the grid grows a second column.
 *   3 · REVIEW  — at-rest analysis: THE PARSE wide on the left (study the run record),
 *                 with SYSTEM.LOG + FINANCE beside it — the §4.12 reviewable-at-rest face.
 *
 * Each grid keeps the DD-10 invariant: ≤3 columns × ≤3 rows per column, every host
 * UNIQUE in the grid. Panels (hosts) available: orrery, system-log, telemetry, finance,
 * parse (§4.12 reviewable record · GDD §5 view #9), contracts (the §4.9/§3 coverage-
 * revenue board). The rail (src/wm/window-rail.ts) lists exactly this host set.
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
    // PLAY (key 1) — the working screen + the default boot layout. Orrery hero on the
    // left; the live business loop (FINANCE over CONTRACTS) on the right. The rail swaps
    // either right tile to LOG/TELEMETRY/PARSE on demand (the old OVERVIEW/OPS/CONTRACTS
    // recombinations, now one click away).
    name: "PLAY",
    columns: [
      { weight: 0.62, rows: [{ weight: 1, host: "orrery" }] },
      {
        weight: 0.38,
        rows: [
          { weight: 1.0, host: "finance" },
          { weight: 1.4, host: "contracts" },
        ],
      },
    ],
  },
  {
    // MAP (key 2) — the MONUMENT, near-full-bleed. A single orrery zone: watch + fly +
    // click + heatmap. Summoning any panel via the rail grows a second column beside it
    // (the always-tiled invariant holds — no float, no occlusion).
    name: "MAP",
    columns: [{ weight: 1, rows: [{ weight: 1, host: "orrery" }] }],
  },
  {
    // REVIEW (key 3) — at-rest analysis (§4.12 / §5 view #9). THE PARSE takes the wide
    // left column to be studied; the live log + finance sit beside it so the same screen
    // carries both faces of the record (live + at-rest). Opening it folds the run summary.
    name: "REVIEW",
    columns: [
      { weight: 0.6, rows: [{ weight: 1, host: "parse" }] },
      {
        weight: 0.4,
        rows: [
          { weight: 1.4, host: "system-log" },
          { weight: 1.0, host: "finance" },
        ],
      },
    ],
  },
];

/**
 * net/ Act-1 — THE NET-MODE PRESET SET (the connectivity game's own layouts; design §3/§9). Net
 * mode is a DIFFERENT game from the M1-cache / M2 / M3 economy, so it mounts ONLY net-relevant
 * panels: the NET·LAUNCH planner (the verb), the FINANCE readout (the contract/wallet face), and
 * SYSTEM.LOG (the truthful event stream + the Act-2/3/4 beat text). The MARS-CACHE TELEMETRY feeds,
 * the M2 CONTRACTS board, and the FLEET tile DO NOT mount here — those belong to ?mode=cache. Keys
 * 1–3 swap these three layouts exactly like the cache set; the toy globe is the hero throughout.
 */
export const NET_PRESET_SPECS: PresetSpec[] = [
  {
    // PLAY (key 1) — the net working screen + the default boot layout. The toy globe is the HERO
    // (large + central — the make-or-break drag→consequence read), with the LAUNCH planner over
    // SYSTEM.LOG on the right and the FINANCE/wallet readout beneath. ONLY net-relevant panels.
    name: "PLAY",
    columns: [
      { weight: 0.66, rows: [{ weight: 1, host: "orrery" }] },
      {
        weight: 0.34,
        rows: [
          { weight: 1.7, host: "net-planner" },
          { weight: 1.0, host: "system-log" },
          { weight: 0.7, host: "finance" },
        ],
      },
    ],
  },
  {
    // MAP (key 2) — the MONUMENT, near-full-bleed: the toy globe alone so the footprint /
    // ground-track / coverage-gap fill the frame as the player drags. Summon a side panel via
    // the (net-scoped) rail to grow a second column.
    name: "MAP",
    columns: [{ weight: 1, rows: [{ weight: 1, host: "orrery" }] }],
  },
  {
    // REVIEW (key 3) — at-rest analysis: THE PARSE wide on the left, with SYSTEM.LOG + FINANCE
    // beside it (the same at-rest face as the cache set, minus the cache-only panels).
    name: "REVIEW",
    columns: [
      { weight: 0.6, rows: [{ weight: 1, host: "parse" }] },
      {
        weight: 0.4,
        rows: [
          { weight: 1.4, host: "system-log" },
          { weight: 1.0, host: "finance" },
        ],
      },
    ],
  },
];
