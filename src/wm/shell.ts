/**
 * The DOM tiling-WM shell. Renders panels into pixel rects solved from the
 * zone-grid (NOT CSS grid / flow — the engine owns geometry, so no box-model
 * feel leaks through), and wires the two interactions the brief calls for:
 *   - title-bar drag → zone SWAP, with a drop-target overlay lighting legal
 *     zones and a ghosted source panel;
 *   - edge-resize by dragging the gutter dividers (relative weights only).
 * Key 0 resets the live grid to the active preset's base.
 *
 * Panel content elements are created ONCE and reused across relayouts and
 * preset switches, so the orrery's WebGL canvas is never destroyed — it is
 * re-parented/resized in place.
 */
import {
  type ZoneGrid,
  type Layout,
  cloneGrid,
  computeLayout,
  swap,
  summonInto,
  setColumnSplit,
  setRowSplit,
} from "./zonegrid";

export interface PanelHandle {
  title: string;
  content: HTMLElement;
  status?(): "ok" | "warn" | "crit" | "idle";
  subtitle?(): string;
  onResize?(w: number, h: number): void;
}

interface PanelView {
  host: string;
  handle: PanelHandle;
  wrapper: HTMLElement;
  dot: HTMLElement;
  titleEl: HTMLElement;
  subEl: HTMLElement;
  body: HTMLElement;
  visible: boolean;
  lastW: number;
  lastH: number;
}

const GUTTER = 4;

export class Shell {
  private views = new Map<string, PanelView>();
  private grid: ZoneGrid;
  private baseGrid: ZoneGrid;
  presetName = "";
  onLayoutChange?: () => void;
  /** Fired whenever the SET of visible hosts changes (preset switch, swap, summon, reset)
   * so the window-summon rail can repaint its active state. NOT per-frame — event-driven. */
  onActivePanelsChange?: () => void;
  /** The FOCUSED tile's host — the target the window-summon rail acts on (clicking a rail
   * button summons into THIS tile). Set on a click into any tile (title bar or body); the
   * panel shows the `.focused` chrome. Null until the first click / first relayout. */
  focusedHost: string | null = null;

  private overlay: HTMLElement | null = null;
  private dividerEls: HTMLElement[] = [];
  private gestureActive = false;
  private onWindowResize = () => this.relayout();
  /** Px reserved on the RIGHT edge of the canvas for the always-docked window-summon rail,
   * so the tiles never sit under its collapsed strip. The rail's hover-expand overlays on
   * top (transient). Set by main.ts after the rail is built; relayout() honours it. */
  private reservedRightPx = 0;

  constructor(
    private canvas: HTMLElement,
    registry: Map<string, PanelHandle>,
  ) {
    // `registry` is consumed here only — panels live on as their wrapper views.
    this.grid = { columns: [] };
    this.baseGrid = { columns: [] };
    for (const [host, handle] of registry) this.createPanel(host, handle);
    window.addEventListener("resize", this.onWindowResize);
  }

  /** Tear down global listeners — the class is otherwise reusable. */
  destroy(): void {
    window.removeEventListener("resize", this.onWindowResize);
  }

  setPreset(name: string, grid: ZoneGrid): void {
    this.presetName = name;
    this.baseGrid = cloneGrid(grid);
    this.grid = cloneGrid(grid);
    this.relayout();
    this.ensureFocus();
    this.onLayoutChange?.();
    this.onActivePanelsChange?.();
  }

  reset(): void {
    this.grid = cloneGrid(this.baseGrid);
    this.relayout();
    this.ensureFocus();
    this.onLayoutChange?.();
    this.onActivePanelsChange?.();
  }

  /** The hosts currently shown in the grid (one per zone's active tab). The rail reads
   * this to light the visible panels. */
  visibleHosts(): string[] {
    const out: string[] = [];
    for (const c of this.grid.columns) for (const r of c.rows) out.push(r.zone.hosts[r.zone.active]);
    return out;
  }

  /**
   * The window-summon rail's action (DD-10 §1/§3): bring `host` into the FOCUSED tile
   * LIVE. If the panel is ALREADY visible we just move focus to it (never duplicate);
   * otherwise we {@link summonInto} the focused tile (falling back to the first/largest
   * tile when nothing is focused), swapping the panel shown there for the summoned one —
   * no teardown, the always-tiled invariant preserved (the zone keeps one host). The
   * displaced panel's view is hidden and stays re-summonable. Returns true if a panel
   * actually changed tiles (so the caller can refresh on-summon, e.g. fold THE PARSE).
   */
  summonPanel(host: string): boolean {
    if (!this.views.has(host)) return false;
    // Already on screen → focus it, no layout change (no duplication).
    if (this.visibleHosts().includes(host)) {
      this.setFocus(host);
      return false;
    }
    const target = this.resolveTargetHost();
    if (target === null) return false;
    const ng = summonInto(this.grid, target, host);
    if (!ng) return false;
    this.grid = ng;
    this.relayout();
    this.onLayoutChange?.();
    this.onActivePanelsChange?.(); // the visible SET changed (summoned in, displaced out).
    this.setFocus(host); // the newly-summoned tile takes focus (also refreshes the rail).
    return true;
  }

  /** The tile the rail acts on: the focused tile if it is still visible, else the first
   * (top-left) tile — a stable, sensible default so a rail click always lands somewhere. */
  private resolveTargetHost(): string | null {
    const visible = this.visibleHosts();
    if (this.focusedHost && visible.includes(this.focusedHost)) return this.focusedHost;
    return visible[0] ?? null;
  }

  /** Keep `focusedHost` pointing at a visible tile (after a preset switch the old focus
   * may be gone); default to the first tile. Fires the rail-state callback's caller. */
  private ensureFocus(): void {
    const visible = this.visibleHosts();
    if (!this.focusedHost || !visible.includes(this.focusedHost)) {
      this.setFocus(visible[0] ?? null);
    } else {
      this.paintFocus();
    }
  }

  /** Focus a tile by host: store it + repaint the `.focused` chrome. Notifies the rail
   * so its focus-marker follows the focused tile (event-driven, not per-frame). */
  setFocus(host: string | null): void {
    if (this.focusedHost === host) return;
    this.focusedHost = host;
    this.paintFocus();
    this.onActivePanelsChange?.();
  }

  /** Toggle the `.focused` class so exactly the focused, visible tile is highlighted. */
  private paintFocus(): void {
    for (const view of this.views.values()) {
      const on = view.visible && view.host === this.focusedHost;
      view.wrapper.classList.toggle("focused", on);
    }
  }

  private createPanel(host: string, handle: PanelHandle): void {
    const wrapper = document.createElement("div");
    wrapper.className = "panel";
    wrapper.style.display = "none";

    const bar = document.createElement("div");
    bar.className = "panel-titlebar";
    const dot = document.createElement("span");
    dot.className = "dot";
    const titleEl = document.createElement("span");
    titleEl.className = "title";
    titleEl.textContent = handle.title;
    const subEl = document.createElement("span");
    subEl.className = "sub";
    const grow = document.createElement("span");
    grow.className = "grow";
    const glyphs = document.createElement("span");
    glyphs.className = "glyphs";
    glyphs.textContent = "⛶  ✕";
    bar.append(dot, titleEl, subEl, grow, glyphs);

    const body = document.createElement("div");
    body.className = "panel-body";
    body.appendChild(handle.content);

    wrapper.append(bar, body);
    this.canvas.appendChild(wrapper);

    // Clicking anywhere in a tile FOCUSES it — that focus is the window-summon rail's
    // target (a rail click summons into the focused tile). Capture-phase so it lands
    // before the drag/orrery handlers consume the event.
    wrapper.addEventListener(
      "pointerdown",
      () => {
        if (this.focusedHost !== host) this.setFocus(host);
      },
      true,
    );
    bar.addEventListener("pointerdown", (e) => this.startDrag(host, e));

    this.views.set(host, {
      host,
      handle,
      wrapper,
      dot,
      titleEl,
      subEl,
      body,
      visible: false,
      lastW: -1,
      lastH: -1,
    });
  }

  /** Reserve `px` on the right edge for the docked window rail; re-tiles to fit. */
  setReservedRight(px: number): void {
    this.reservedRightPx = Math.max(0, px);
    this.relayout();
  }

  private currentLayout(): Layout {
    const r = this.canvas.getBoundingClientRect();
    const w = Math.max(0, r.width - this.reservedRightPx);
    return computeLayout(this.grid, w, r.height, GUTTER);
  }

  relayout(): void {
    const layout = this.currentLayout();
    const present = new Set(layout.placements.map((p) => p.host));

    // Hide panels not in the current grid.
    for (const view of this.views.values()) {
      if (!present.has(view.host) && view.visible) {
        view.wrapper.style.display = "none";
        view.visible = false;
      }
    }

    // Position the present panels.
    for (const p of layout.placements) {
      const view = this.views.get(p.host);
      if (!view) continue;
      const w = view.wrapper;
      w.style.display = "flex";
      w.style.left = `${p.rect.x}px`;
      w.style.top = `${p.rect.y}px`;
      w.style.width = `${p.rect.w}px`;
      w.style.height = `${p.rect.h}px`;
      view.visible = true;
    }

    // Notify size changes (orrery canvas, etc.) after styles settle.
    for (const p of layout.placements) {
      const view = this.views.get(p.host);
      if (!view) continue;
      const cw = view.body.clientWidth;
      const ch = view.body.clientHeight;
      if (cw !== view.lastW || ch !== view.lastH) {
        view.lastW = cw;
        view.lastH = ch;
        view.handle.onResize?.(cw, ch);
      }
    }

    this.renderDividers(layout);
    this.paintFocus();
  }

  private renderDividers(layout: Layout): void {
    for (const el of this.dividerEls) el.remove();
    this.dividerEls = [];
    for (const d of layout.dividers) {
      const el = document.createElement("div");
      el.className = `gutter ${d.kind}`;
      el.style.left = `${d.rect.x}px`;
      el.style.top = `${d.rect.y}px`;
      el.style.width = `${d.rect.w}px`;
      el.style.height = `${d.rect.h}px`;
      el.addEventListener("pointerdown", (e) => this.startResize(d.kind, d.ci, d.ri, e));
      this.canvas.appendChild(el);
      this.dividerEls.push(el);
    }
  }

  // --- chrome refresh (status dots / subtitles) ---------------------------
  tickChrome(): void {
    for (const view of this.views.values()) {
      if (!view.visible) continue;
      const s = view.handle.status?.() ?? "idle";
      view.dot.className = `dot ${s === "idle" ? "" : s}`.trim();
      const sub = view.handle.subtitle?.();
      if (sub !== undefined && view.subEl.textContent !== sub) view.subEl.textContent = sub;
    }
  }

  // --- drag → swap --------------------------------------------------------
  private startDrag(host: string, e: PointerEvent): void {
    if (e.button !== 0 || this.gestureActive) return;
    e.preventDefault();
    const view = this.views.get(host);
    if (!view) return;
    this.gestureActive = true;
    view.wrapper.classList.add("dragging");

    const layout = this.currentLayout();
    this.overlay = document.createElement("div");
    this.overlay.className = "drag-overlay";
    const targets = new Map<string, HTMLElement>();
    for (const p of layout.placements) {
      if (p.host === host) continue;
      const t = document.createElement("div");
      t.className = "drop-target";
      t.style.left = `${p.rect.x + 6}px`;
      t.style.top = `${p.rect.y + 6}px`;
      t.style.width = `${p.rect.w - 12}px`;
      t.style.height = `${p.rect.h - 12}px`;
      t.textContent = `swap → ${p.host}`;
      this.overlay.appendChild(t);
      targets.set(p.host, t);
    }
    this.canvas.appendChild(this.overlay);

    let hot: string | null = null;
    const hit = (ev: PointerEvent): string | null => {
      const r = this.canvas.getBoundingClientRect();
      const x = ev.clientX - r.left;
      const y = ev.clientY - r.top;
      // Hit-test the LIVE layout (not the pointerdown snapshot) so a relayout
      // mid-drag still resolves the swap target under the cursor correctly.
      for (const p of this.currentLayout().placements) {
        if (p.host === host) continue;
        if (x >= p.rect.x && x <= p.rect.x + p.rect.w && y >= p.rect.y && y <= p.rect.y + p.rect.h) {
          return p.host;
        }
      }
      return null;
    };

    const move = (ev: PointerEvent) => {
      const next = hit(ev);
      if (next === hot) return;
      if (hot) targets.get(hot)?.classList.remove("hot");
      hot = next;
      if (hot) targets.get(hot)?.classList.add("hot");
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.gestureActive = false;
      view.wrapper.classList.remove("dragging");
      this.overlay?.remove();
      this.overlay = null;
      if (hot && hot !== host) {
        const ng = swap(this.grid, host, hot);
        if (ng) {
          this.grid = ng;
          this.relayout();
          this.onLayoutChange?.();
        }
      }
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }

  // --- edge resize --------------------------------------------------------
  private startResize(kind: "col" | "row", ci: number, ri: number, e: PointerEvent): void {
    if (e.button !== 0 || this.gestureActive) return;
    e.preventDefault();
    this.gestureActive = true;
    const layout = this.currentLayout();

    let originPx: number;
    let spanPx: number;
    // The weight solver distributes over the gutter-EXCLUDED span, so map the
    // pointer onto that span (subtract the one intervening gutter) — otherwise the
    // divider drifts from the cursor by frac·gutter.
    if (kind === "col") {
      const left = layout.placements.filter((p) => p.ci === ci);
      const right = layout.placements.filter((p) => p.ci === ci + 1);
      const leftX = Math.min(...left.map((p) => p.rect.x));
      const rightEdge = Math.max(...right.map((p) => p.rect.x + p.rect.w));
      originPx = leftX;
      spanPx = rightEdge - leftX - GUTTER;
    } else {
      const rows = layout.placements.filter((p) => p.ci === ci);
      const top = rows.find((p) => p.ri === ri)!;
      const bottom = rows.find((p) => p.ri === ri + 1)!;
      originPx = top.rect.y;
      spanPx = bottom.rect.y + bottom.rect.h - top.rect.y - GUTTER;
    }

    const move = (ev: PointerEvent) => {
      const r = this.canvas.getBoundingClientRect();
      const pos = kind === "col" ? ev.clientX - r.left : ev.clientY - r.top;
      const frac = (pos - originPx) / spanPx;
      this.grid = kind === "col" ? setColumnSplit(this.grid, ci, frac) : setRowSplit(this.grid, ci, ri, frac);
      this.relayout();
    };
    const up = () => {
      window.removeEventListener("pointermove", move);
      window.removeEventListener("pointerup", up);
      this.gestureActive = false;
      this.onLayoutChange?.();
    };
    window.addEventListener("pointermove", move);
    window.addEventListener("pointerup", up);
  }
}
