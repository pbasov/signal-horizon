/**
 * M-fleet — THE FLEET TILE (GDD §5 legible-at-a-glance + direct interaction; §4.2 the
 * network). Click-to-focus a celestial body in the orrery (SD-35 selection) and this
 * panel turns that into FLEET MANAGEMENT: it lists the satellite constellation around
 * the focused body — the dataset sats whose parent is that body PLUS the player's
 * launched roster sats orbiting it. Select Earth → its LEO/MEO/GEO fleet; launch a sat
 * → it appears; click Mars → its (different) fleet. Render/read-only — it renders the
 * pure {@link Fleet} projection (src/sim/m2/fleet.ts) main.ts builds each frame from the
 * orrery's focused body + the live roster + the dataset sats. NO sim state here.
 *
 * STYLING (DD-1 "monochrome machine, living signal", §8 1-bit chrome, CVD-safe): the
 * housing is the shared .telem dashed-group chrome; only the DATA carries colour, every
 * colour distinction REDUNDANT on a glyph/word so it reads colour-off:
 *   - KIND — LAUNCHED (a filled ▲ glyph + green) vs DATASET (a hollow △ glyph + cyan).
 *     The GLYPH is the channel; colour reinforces (CVD-safe — never hue-only).
 *   - ORBIT CLASS — the LEO/MEO/GEO/HEO WORD is the channel; a cool→warm tone ramp
 *     (LEO cyan → MEO green → GEO amber → HEO violet) reinforces the regime.
 *   - The sat id is the §8 ENTITY token (the bright label).
 * The header shows the focused body + the count ("FLEET · EARTH", "6 sats · 2 launched").
 * A calm placeholder shows when no body is selected or the body has no fleet.
 *
 * The header is built ONCE; the per-sat rows are rebuilt only when the fleet's glanceable
 * SIGNATURE changes (X-02 — a cheap compare), so a steady fleet costs nothing per frame.
 */
import type { Fleet, FleetSat } from "../sim/m2/fleet";
import type { PanelHandle } from "../wm/shell";

export class FleetPanel implements PanelHandle {
  readonly title = "FLEET";
  readonly content: HTMLElement;

  // --- HEADER (built once) ---
  private vBody: HTMLElement;
  private vCount: HTMLElement;
  /** The scrolling list host the per-sat rows are rebuilt into. */
  private listHost: HTMLElement;

  /** Last-rendered signature of the fleet rows (skip the rebuild when unchanged). */
  private lastSig = "";
  /** Mirror of the focused body + counts for the titlebar subtitle. */
  private bodyId: string | null = null;
  private total = 0;

  constructor() {
    this.content = el("div", "telem");

    // GROUP: FOCUS — the focused body + the fleet size at a glance. The body is the
    // headline (it follows the orrery click-to-focus selection); the count is the
    // "size of the constellation" readout.
    const summary = group("FLEET · FOCUS");
    this.vBody = valueOf(row(summary, "BODY", "cyan"));
    this.vCount = valueOf(row(summary, "SATS"));
    this.content.append(summary);

    // GROUP: CONSTELLATION — the per-sat rows (rebuilt on change).
    const board = group("CONSTELLATION");
    this.listHost = el("div", "fleet-list");
    board.append(this.listHost);
    this.content.append(board);
  }

  render(fleet: Fleet): void {
    this.bodyId = fleet.bodyId;
    this.total = fleet.total;

    // --- HEADER. BODY first — the focused target the fleet belongs to.
    setText(this.vBody, fleet.bodyId === null ? "— none —" : fleet.bodyId.toUpperCase());
    setValueClass(this.vBody, fleet.bodyId === null ? "" : "cyan");
    setText(
      this.vCount,
      fleet.total === 0 ? "0" : `${fleet.total} · ${fleet.launchedCount} launched · ${fleet.datasetCount} dataset`,
    );

    // --- LIST: rebuild the per-sat rows only when the glanceable view changed (X-02).
    const sig = signature(fleet);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.rebuildList(fleet);
    }
  }

  private rebuildList(fleet: Fleet): void {
    this.listHost.replaceChildren();
    if (fleet.sats.length === 0) {
      const empty = el("div", "fleet-empty");
      empty.textContent =
        fleet.bodyId === null
          ? "no fleet — click a body in the orrery to focus it"
          : `no fleet around ${fleet.bodyId.toUpperCase()} — launch a sat (L) or focus another body`;
      this.listHost.append(empty);
      return;
    }
    for (const s of fleet.sats) this.listHost.append(this.rowFor(s));
  }

  /** One sat row: a head line (kind glyph · id · CLASS) + a detail line
   * (alt · period · incl · EIRP), in the §8 1-bit chrome with the data coloured. */
  private rowFor(s: FleetSat): HTMLElement {
    const card = el("div", "fleet-card");

    const head = el("div", "fleet-head");
    // KIND glyph — the colour-off channel (▲ launched / △ dataset), tone-reinforced.
    const glyph = el("span", `fleet-kind ${kindTone(s)}`);
    glyph.textContent = kindGlyph(s);
    glyph.title = s.kind === "LAUNCHED" ? "launched (player)" : "dataset";
    const label = el("span", "fleet-label");
    label.textContent = s.label;
    const cls = el("span", `fleet-class ${classTone(s)}`);
    cls.textContent = s.orbitClass;
    head.append(glyph, label, cls);

    const detail = el("div", "fleet-detail");
    detail.textContent = detailText(s);

    card.append(head, detail);
    return card;
  }

  /** Titlebar lamp: idle when nothing focused / empty; ok when a fleet is listed. */
  status(): "ok" | "warn" | "crit" | "idle" {
    return this.total > 0 ? "ok" : "idle";
  }

  subtitle(): string {
    if (this.bodyId === null) return "· select a body";
    if (this.total === 0) return `· ${this.bodyId.toUpperCase()} · no fleet`;
    return `· ${this.bodyId.toUpperCase()} · ${this.total} sats`;
  }
}

// --- per-sat presentation (pure helpers) ------------------------------------

/** The KIND glyph — the colour-off channel (filled = launched, hollow = dataset). */
function kindGlyph(s: FleetSat): string {
  return s.kind === "LAUNCHED" ? "▲" : "△";
}

/** The kind tone (reinforces the glyph; never the sole channel). */
function kindTone(s: FleetSat): string {
  return s.kind === "LAUNCHED" ? "green" : "cyan";
}

/** The orbit-class tone ramp (cool→warm by regime; the CLASS WORD is the real channel). */
function classTone(s: FleetSat): string {
  switch (s.orbitClass) {
    case "LEO":
      return "cyan";
    case "MEO":
      return "green";
    case "GEO":
      return "amber";
    case "HEO":
      return "violet";
    case "SURFACE":
      return "";
  }
}

/** The detail line: altitude · period · inclination · EIRP — the orbit at a glance. */
function detailText(s: FleetSat): string {
  const alt = `${fmtKm(s.altitudeKm)} km`;
  const per = `${fmtPeriod(s.periodMin)}`;
  const inc = `${s.inclinationDeg.toFixed(s.inclinationDeg % 1 === 0 ? 0 : 1)}°`;
  const eirp = `EIRP ${s.eirp.toFixed(1)}`;
  return `${alt} · ${per} · incl ${inc} · ${eirp}`;
}

/** Altitude formatter: thousands-grouped integer km (a clean glance figure). */
function fmtKm(km: number): string {
  return Math.round(km).toLocaleString("en-US");
}

/** Period formatter: minutes under 100, else hours.h (GEO ≈ 24.0h, LEO ≈ 92 min). */
function fmtPeriod(min: number): string {
  if (min <= 0) return "—";
  if (min < 100) return `${Math.round(min)} min`;
  return `${(min / 60).toFixed(1)} h`;
}

/**
 * A cheap glanceable signature so the row DOM is rebuilt only on a visible change (X-02):
 * the focused body + each sat's id, class, kind, and the rounded orbit figures. A fleet
 * that just propagates (positions change, elements don't) does NOT change the signature,
 * so the rows are NOT rebuilt; a launch / a focus change / a new sat does.
 */
function signature(fleet: Fleet): string {
  let s = `${fleet.bodyId ?? "∅"}|`;
  for (const x of fleet.sats) {
    s +=
      `${x.id}:${x.kind[0]}:${x.orbitClass}:` +
      `${Math.round(x.altitudeKm)}:${Math.round(x.periodMin)}:` +
      `${Math.round(x.inclinationDeg)}:${Math.round(x.eirp * 10)};`;
  }
  return s;
}

// --- tiny DOM helpers (kept local; mirror the contracts/finance/telemetry pattern) -----

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function group(name: string): HTMLElement {
  const g = el("div", "group");
  const legend = el("div", "legend");
  legend.textContent = name;
  g.appendChild(legend);
  return g;
}

function row(parent: HTMLElement, label: string, valueClass = ""): HTMLElement {
  const r = el("div", "row");
  const lab = el("span", "label");
  lab.textContent = label;
  const v = el("span", valueClass ? `v ${valueClass}` : "v");
  r.append(lab, v);
  parent.appendChild(r);
  return r;
}

function valueOf(r: HTMLElement): HTMLElement {
  return r.lastElementChild as HTMLElement;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setValueClass(node: HTMLElement, tone: string): void {
  const next = tone ? `v ${tone}` : "v";
  if (node.className !== next) node.className = next;
}
