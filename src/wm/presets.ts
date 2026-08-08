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
 * net/ M1 — THE NET-MODE MISSION-CONTROL DESKTOPS (SD-44 PHASE 1; design §3/§9). Net mode is a
 * DIFFERENT game from the M1-cache / M2 / M3 economy: instead of one crammed NET·LAUNCH panel it now
 * presents FIVE virtual-desktop layouts (keys 1–5), each a focused mission-control wall. The LAUNCH
 * menu is split CLEANLY from CONTRACTS, the orrery stays the hero on the operating desktops, and boot
 * lands on the OVERVIEW triage wall ("is anything wrong now?"). The MARS-CACHE TELEMETRY feeds and the
 * M2 CONTRACTS board / FLEET tile do NOT mount here — those belong to ?mode=cache.
 *
 * Each grid keeps the ≤3col × ≤3row invariant and hosts are UNIQUE WITHIN EACH GRID (validate runs
 * per-preset, so a host appearing in two different desktops — e.g. finance on OVERVIEW + BUSINESS —
 * is fine). Keys:
 *   1 OVERVIEW     — triage wall: orrery hero + the STATUS·BOARD + FINANCE. "Is anything wrong now?"
 *   2 CONNECTIVITY — the LAUNCH desktop: orrery hero + NET·LAUNCH + the COVERAGE·ROSTER.
 *   3 ROUTING      — the traffic desktop: orrery (ORBITS cam) + LINK·LOAD + ROUTING·PREFER.
 *   4 BUSINESS     — the deals desktop: CONTRACTS hero + FINANCE + SYSTEM.LOG (no orrery).
 *   5 REFERENCE    — the help/at-rest desktop: HOW-IT-WORKS + TELEMETRY + PARSE (no orrery).
 */
export const NET_PRESET_SPECS: PresetSpec[] = [
  {
    // MISSION (key 1) — THE game screen (m1-redesign.md §2.1): 90% of play happens here and
    // the loop never leaves it. The orrery is the input device on the left; the right rail
    // stacks the MISSION book/pad (tenders ⇄ vehicle builder), the WIRE (SYSTEM.LOG), and
    // the LEDGER·FLEET strip (wallet + per-sat pipes/beams).
    name: "MISSION",
    columns: [
      { weight: 0.64, rows: [{ weight: 1, host: "orrery" }] },
      {
        weight: 0.36,
        rows: [
          { weight: 2.3, host: "mission-top" },
          { weight: 0.7, host: "system-log" },
          { weight: 0.8, host: "ledger-fleet" },
        ],
      },
    ],
  },
  {
    // REVIEW (key 2) — the at-rest reading room: THE PARSE wide on the left beside the WIRE + the
    // finance ledger (the §4.12 record where it belongs). Was "the parse's future home"; homed, R3.
    name: "REVIEW",
    columns: [
      { weight: 0.5, rows: [{ weight: 1, host: "parse" }] },
      {
        weight: 0.5,
        rows: [
          { weight: 1.0, host: "system-log" },
          { weight: 1.0, host: "finance" },
        ],
      },
    ],
  },
];

