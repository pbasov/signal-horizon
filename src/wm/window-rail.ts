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
  { host: "parse", label: "PARSE" },
  // { host: "fleet", label: "FLEET" }, // ← future M-fleet tile: drop in here.
];

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
