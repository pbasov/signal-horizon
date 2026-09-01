/**
 * THE WINDOW-SUMMON RAIL (the owner's core ask: "vertical BUTTONS ON THE RIGHT to
 * summon windows into current tiles LIVE"). A vertical button rail docked on the RIGHT
 * edge of the WM canvas, §8 1-bit chrome, one button per available panel. Clicking a
 * button SUMMONS that panel into the FOCUSED tile live (Shell.summonPanel) — it swaps
 * the panel shown in the focused tile for the clicked one, no teardown, the always-tiled
 * invariant preserved (DD-10). The 3 presets are starting points; the player composes
 * the workspace by clicking the rail.
 *
 * THE MECHANISM (DD-10-consistent, documented here + in decisions.md DD-10):
 *   - The rail acts on the FOCUSED tile (Shell.focusedHost — the last tile you clicked).
 *     With nothing focused it falls back to the first/top-left tile, so a click always
 *     lands somewhere sensible.
 *   - A panel ALREADY visible is MOVED-to-focus (no duplicate): clicking its rail button
 *     just focuses that tile. Otherwise it replaces the focused tile's panel via the pure
 *     zonegrid `summonInto` op (Clone-Mutate-Validate; reuses SD-6 zone machinery).
 *   - ACTIVE STATE: a button is lit `on` while its panel is visible in the grid; the
 *     FOCUSED tile's button additionally reads `focus`. Repainted only when the visible
 *     set / focus changes (Shell.onActivePanelsChange) — event-driven, never per-frame (X-02).
 *
 * Built ONCE (X-02). A clean seam for the future FLEET tile: add its host to RAIL_PANELS
 * and register the panel in main.ts — the rail picks it up with no other change.
 */
import type { Shell } from "./shell";

/** One rail entry: a panel host + the short §8 label shown on its button. ORDER is the
 * rail's top-to-bottom order. Add FLEET here (+ register the panel) when it lands. */
export interface RailPanel {
  host: string;
  label: string;
}

export const RAIL_PANELS: RailPanel[] = [
  { host: "orrery", label: "ORRERY" },
  { host: "system-log", label: "SYSTEM.LOG" },
  { host: "finance", label: "FINANCE" },
  { host: "telemetry", label: "TELEMETRY" },
  { host: "contracts", label: "CONTRACTS" },
  // net/ Act-1 — THE LAUNCH PLANNER (design §2.3/§5): the offered REGION-0 contract + the
  // presets + the consequence preview + the LAUNCH/ACCEPT buttons, summoned like any panel.
  { host: "net-planner", label: "LAUNCH" },
  { host: "parse", label: "PARSE" },
  // M-fleet — THE FLEET TILE (the focused body's constellation), summoned into the
  // focused tile like any other panel via the SD-36 mechanism.
  { host: "fleet", label: "FLEET" },
];

/**
 * net/ M1 — THE NET-MODE RAIL SET (SD-44 PHASE 1; design §3/§9). The mission-control SUPER-SET: every
 * net desktop's tile is summonable into the focused tile so the player can recompose any of the FIVE
 * presets by hand. ORDER is the mission-control reading order (the verb chain first, then the readouts,
 * then the at-rest record). The MARS-CACHE feeds / M2 CONTRACTS board / FLEET tile belong to ?mode=cache
 * (where {@link RAIL_PANELS} is used) — they are NOT summonable here.
 */
export const NET_RAIL_PANELS: RailPanel[] = [
  { host: "orrery", label: "ORRERY" },
  { host: "mission-top", label: "MISSION" },
  { host: "ledger-fleet", label: "LEDGER·FLEET" },
  { host: "finance", label: "FINANCE" },
  { host: "system-log", label: "WIRE" },
  // SD-53 — THE ROUTING SCREEN. Summonable into any tile (its natural home is the LEDGER·FLEET
  // zone on MISSION); it deliberately has no desktop of its own before the M1 gate.
  { host: "trace", label: "TRACE" },
  // SD-53 (found by the new net-side coverage test): the REVIEW desktop mounts THE PARSE, but the
  // net rail never listed it — so the parse could only be reached by switching desktops, and could
  // not be composed beside anything. The cache rail has always carried it; this closes the gap.
  { host: "parse", label: "PARSE" },
  // R1 (SD-45): the SD-44 dashboard panels (net-launch/net-contracts/net-prefer/status-board/
  // coverage-roster/link-load/howto) are RETIRED from net mode — the loop lives on MISSION.
];

/**
 * SD-56 — THE DEV CONSOLE's rail entry. Kept OUT of both rail sets above and appended by
 * `main.ts` only when the console is enabled (`import.meta.env.DEV` or `?dev=1`), so a
 * production rail has no dead button and the shipped bundle carries no cheat surface.
 */
export const DEV_RAIL_PANEL: RailPanel = { host: "devtools", label: "DEV" };


export class WindowRail {
  readonly element: HTMLElement;
  private buttons = new Map<string, HTMLButtonElement>();

  /**
   * @param shell    the WM shell the rail summons into
   * @param panels   the rail entries (defaults to RAIL_PANELS)
   * @param onSummon optional hook fired after a panel is summoned LIVE (true = a tile
   *                 actually changed) — main.ts uses it to fold THE PARSE on summon.
   */
  constructor(
    private shell: Shell,
    private panels: RailPanel[] = RAIL_PANELS,
    private onSummon?: (host: string, changed: boolean) => void,
  ) {
    this.element = document.createElement("div");
    this.element.className = "window-rail";

    const cap = document.createElement("div");
    cap.className = "rail-cap";
    cap.textContent = "WIN";
    this.element.appendChild(cap);

    for (const p of this.panels) {
      const btn = document.createElement("button");
      btn.className = "rail-btn";
      btn.type = "button";
      btn.title = `summon ${p.label} into the focused tile`;
      btn.dataset.host = p.host;
      // Vertical glyph + the panel label (the §8 token). The label is short by design.
      btn.innerHTML = `<span class="rail-glyph">▸</span><span class="rail-label">${p.label}</span>`;
      btn.addEventListener("click", () => {
        const changed = this.shell.summonPanel(p.host);
        this.onSummon?.(p.host, changed);
      });
      this.element.appendChild(btn);
      this.buttons.set(p.host, btn);
    }

    // Event-driven repaint: whenever the shell's visible-panel set (or focus) changes.
    this.shell.onActivePanelsChange = () => this.refresh();
    this.refresh();
  }

  /** Programmatic summon (keyboard parity, e.g. the G key for PARSE): summon a host into
   * the focused tile via the SAME path a button click uses, firing the onSummon hook. */
  summon(host: string): void {
    const changed = this.shell.summonPanel(host);
    this.onSummon?.(host, changed);
  }

  /** Convenience for the G key: summon THE PARSE (§4.12 reviewable record) into the focus. */
  summonParse(): void {
    this.summon("parse");
  }

  /** Repaint active/focus state from the shell's current visible set (event-driven). */
  refresh(): void {
    const visible = new Set(this.shell.visibleHosts());
    const focused = this.shell.focusedHost;
    for (const [host, btn] of this.buttons) {
      btn.classList.toggle("on", visible.has(host));
      btn.classList.toggle("focus", host === focused && visible.has(host));
    }
  }
}
