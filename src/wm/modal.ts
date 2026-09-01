/**
 * THE OVERLAY LAYER — a panel raised ON TOP of the tiling wall (the owner's ask,
 * 2026-09-01: "tiling WM is cool, but cumbersome sometimes, i think we have to add
 * overlay modals for important pieces of gameplay to pop up on top of the main screen").
 *
 * DD-10's always-tiled invariant is about the WALL: no floating tiles, no occlusion, no
 * gaps, every pixel of the grid occupied. It is not violated here, because an overlay is
 * not a tile — the wall underneath keeps its exact shape and comes back untouched when the
 * overlay closes. What the overlay buys is the thing the wall cannot give: a screen-sized
 * reading surface for the two panels that are genuinely too big for a third of a column
 * (THE PARSE's run record, TRACE's routing chain) WITHOUT evicting the panel you were
 * working in. Before this, reading either one meant displacing MISSION or the globe.
 *
 * THE RULES (deliberately narrow, so this never becomes a floating-window manager):
 *   - ONE overlay at a time. No stack, no z-fighting, no window list to manage.
 *   - It NEVER gates the sim. The clock keeps running underneath and the wall keeps
 *     painting — same contract as the onboarding briefing cards (§4.12 honesty: you can
 *     always see the world while you read about it).
 *   - The panel's content element is BORROWED, not rebuilt: it is re-parented into the
 *     overlay and returned to its exact original parent on close (the same discipline that
 *     lets the shell re-tile the orrery's WebGL canvas without destroying it). A tile that
 *     lends its content shows a stub saying where the content went.
 *   - Escape closes; so does the backdrop, the ✕, and the lending tile's stub.
 */

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** How much of the viewport an overlay claims. `wide` is the reading surface (PARSE/TRACE);
 * `compact` is for short, decision-shaped content (a confirm, a briefing). */
export type ModalSize = "wide" | "compact";

/** Px kept clear on every side so the overlay reads as ON TOP of the wall, never AS the wall
 * (you can always see the tiles breathing around it). */
const MARGIN_PX = 28;

const SIZES: Record<ModalSize, { maxW: number; maxH: number; fracW: number; fracH: number; minW: number; minH: number }> = {
  wide: { maxW: 1320, maxH: 900, fracW: 0.9, fracH: 0.86, minW: 480, minH: 260 },
  compact: { maxW: 620, maxH: 560, fracW: 0.5, fracH: 0.6, minW: 360, minH: 200 },
};

/**
 * Solve the overlay's centred rect for a viewport. Pure geometry (the engine owns layout
 * here exactly as it does for tiles — no box-model flow decides where a window lands), so
 * it is unit-testable without a DOM.
 */
export function modalRect(vw: number, vh: number, size: ModalSize): Rect {
  const s = SIZES[size];
  const availW = Math.max(0, vw - 2 * MARGIN_PX);
  const availH = Math.max(0, vh - 2 * MARGIN_PX);
  // Clamp to the viewport BEFORE the min, so a small window yields a small overlay rather
  // than one hanging off the screen edge.
  const w = Math.max(Math.min(s.minW, availW), Math.min(s.maxW, Math.min(availW, vw * s.fracW)));
  const h = Math.max(Math.min(s.minH, availH), Math.min(s.maxH, Math.min(availH, vh * s.fracH)));
  return { x: Math.round((vw - w) / 2), y: Math.round((vh - h) / 2), w: Math.round(w), h: Math.round(h) };
}

/** What the layer needs to raise a panel. Structurally a subset of {@link PanelHandle}, so
 * any registered panel can be raised with no extra bookkeeping. */
export interface ModalEntry {
  host: string;
  title: string;
  content: HTMLElement;
  size?: ModalSize;
  subtitle?(): string;
  onResize?(w: number, h: number): void;
}

export class ModalLayer {
  /** The backdrop; mounted once, hidden while nothing is raised. */
  readonly element: HTMLElement;
  private readonly win: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly subEl: HTMLElement;
  private readonly body: HTMLElement;
  /** The tile stub left behind while a visible tile lends its content. */
  private stub: HTMLElement | null = null;

  private entry: ModalEntry | null = null;
  private lentParent: HTMLElement | null = null;
  private lentNext: ChildNode | null = null;
  private lastW = -1;
  private lastH = -1;

  /** Fired after an overlay closes (host that was raised) — callers repaint rail state. */
  onClose?: (host: string) => void;
  /** Fired after an overlay opens — callers repaint rail state / refresh the panel. */
  onOpen?: (host: string) => void;

  constructor(private readonly mount: HTMLElement) {
    this.element = document.createElement("div");
    this.element.className = "modal-backdrop";
    this.element.style.display = "none";
    // Click-out closes — but only on the backdrop itself, never on a click that started
    // inside the window (a drag-scrub released outside must not close the overlay).
    this.element.addEventListener("pointerdown", (e) => {
      if (e.target === this.element) this.close();
    });

    this.win = document.createElement("div");
    this.win.className = "modal-window";

    const bar = document.createElement("div");
    bar.className = "modal-titlebar";
    const dot = document.createElement("span");
    dot.className = "dot";
    this.titleEl = document.createElement("span");
    this.titleEl.className = "title";
    this.subEl = document.createElement("span");
    this.subEl.className = "sub";
    const grow = document.createElement("span");
    grow.className = "grow";
    const esc = document.createElement("span");
    esc.className = "modal-esc";
    esc.textContent = "ESC";
    const close = document.createElement("button");
    close.className = "modal-close";
    close.type = "button";
    close.title = "close the overlay (Esc)";
    close.textContent = "✕";
    close.addEventListener("click", () => this.close());
    bar.append(dot, this.titleEl, this.subEl, grow, esc, close);

    this.body = document.createElement("div");
    this.body.className = "modal-body";

    this.win.append(bar, this.body);
    this.element.appendChild(this.win);
    this.mount.appendChild(this.element);

    window.addEventListener("keydown", this.onKey, true);
    window.addEventListener("resize", this.onResize);
  }

  destroy(): void {
    window.removeEventListener("keydown", this.onKey, true);
    window.removeEventListener("resize", this.onResize);
    this.close();
  }

  /** The raised host, or null. */
  get host(): string | null {
    return this.entry?.host ?? null;
  }

  isOpen(): boolean {
    return this.entry !== null;
  }

  /** Raise `entry`. Raising the host that is already up is a no-op (never a re-mount, so a
   * repeated key/click never churns the panel's DOM). Any other host replaces it. */
  open(entry: ModalEntry): void {
    if (this.entry?.host === entry.host) return;
    if (this.entry) this.close();
    this.entry = entry;

    // Borrow the content: remember exactly where it sat so close() can put it back.
    this.lentParent = entry.content.parentElement;
    this.lentNext = entry.content.nextSibling;
    // Only a VISIBLE tile gets a stub: a panel that wasn't on the wall (the usual case —
    // TRACE/PARSE are summonable hosts with no tile of their own) lends from a hidden
    // wrapper, and stubbing that would be a note nobody can read.
    const lenderVisible =
      this.lentParent !== null && (this.lentParent.offsetWidth > 0 || this.lentParent.offsetHeight > 0);
    if (this.lentParent !== null && lenderVisible) {
      // The lender is a live tile — say so in its place rather than leaving a black hole. It
      // is a LABEL, not a button: the overlay covers the wall, so a click target here could
      // never be reached, and a control you cannot click is the affordance lie 15c deleted.
      this.stub = document.createElement("div");
      this.stub.className = "panel-popped";
      this.stub.textContent = "▣ RAISED ON TOP · ESC RETURNS IT HERE";
      this.lentParent.insertBefore(this.stub, this.lentNext);
    }
    this.body.appendChild(entry.content);

    this.titleEl.textContent = entry.title;
    this.subEl.textContent = entry.subtitle?.() ?? "";
    this.element.style.display = "flex";
    this.lastW = -1;
    this.lastH = -1;
    this.place();
    this.onOpen?.(entry.host);
  }

  /** Lower the overlay and return the borrowed content to its tile. Safe to call when
   * nothing is raised. */
  close(): void {
    const entry = this.entry;
    if (!entry) return;
    this.entry = null;
    this.element.style.display = "none";
    if (this.lentParent !== null) {
      this.lentParent.insertBefore(entry.content, this.stub ?? this.lentNext);
    } else if (entry.content.parentElement === this.body) {
      entry.content.remove();
    }
    this.stub?.remove();
    this.stub = null;
    this.lentParent = null;
    this.lentNext = null;
    // The panel is back in a tile-sized box: tell it, so canvases/instruments re-fit. A
    // 0×0 box means the tile is hidden — stay quiet and let the shell notify when it next
    // shows the panel (the shell dirty-checks against ITS OWN cached size, so a 0 written
    // from here would be invisible to it and strand the panel at zero).
    const back = entry.content.parentElement;
    if (back !== null && back.clientWidth > 0 && back.clientHeight > 0) {
      entry.onResize?.(back.clientWidth, back.clientHeight);
    }
    this.onClose?.(entry.host);
  }

  /** Raise `entry` if it isn't up, lower it if it is. The key-press contract. */
  toggle(entry: ModalEntry): void {
    if (this.entry?.host === entry.host) this.close();
    else this.open(entry);
  }

  /** Per-frame chrome refresh (subtitle only — the panel paints its own body). Costs
   * nothing while nothing is raised. */
  tickChrome(): void {
    if (!this.entry) return;
    const sub = this.entry.subtitle?.();
    if (sub !== undefined && this.subEl.textContent !== sub) this.subEl.textContent = sub;
  }

  private onKey = (e: KeyboardEvent): void => {
    if (!this.entry || e.key !== "Escape") return;
    e.preventDefault();
    e.stopPropagation();
    this.close();
  };

  private onResize = (): void => {
    if (this.entry) this.place();
  };

  /** Size + centre the window from the mount's box, then notify the panel of its new box. */
  private place(): void {
    const r = this.mount.getBoundingClientRect();
    const rect = modalRect(r.width, r.height, this.entry?.size ?? "wide");
    this.win.style.left = `${rect.x}px`;
    this.win.style.top = `${rect.y}px`;
    this.win.style.width = `${rect.w}px`;
    this.win.style.height = `${rect.h}px`;
    const cw = this.body.clientWidth;
    const ch = this.body.clientHeight;
    if (cw !== this.lastW || ch !== this.lastH) {
      this.lastW = cw;
      this.lastH = ch;
      this.entry?.onResize?.(cw, ch);
    }
  }
}
