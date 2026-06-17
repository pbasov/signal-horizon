/**
 * net/ M1 — COVERAGE·ROSTER (SD-44 PHASE 1, FIRST VERSION): the launched-sat manifest + the
 * coverage-gap glance for the CONNECTIVITY desktop. One row per launched satellite (its id, an orbit
 * CLASS word LEO/GEO, and a "covers REGION-x / —" note), plus a "DARK: <regions>" line listing any
 * active contract NOT served right now (the at-a-glance "what is uncovered?"). Holds no sim state:
 * main.ts hands it a per-frame {@link CoverageRosterState} projected as a PURE read of the live
 * NetSession (sats + contracts + lastSolveFor); the panel paints it.
 *
 * DD-1: 1-bit MACHINE chrome; COLOUR only on DATA, every distinction redundant on a word (the DARK
 * line names the dark regions in words; the orbit CLASS is the LEO/GEO token, not a colour).
 */
import type { PanelHandle } from "../wm/shell";

/** One launched satellite, projected for a roster row. */
export interface CoverageRosterSat {
  id: string;
  /** Orbit CLASS token (LEO / GEO / MEO) derived from altitude — the glanceable word. */
  orbitClass: string;
  /** A human note: "covers REGION-0" when it bridges an active region, else "—". */
  covers: string;
  /** True when this sat currently bridges at least one active contract (the lit/dim cue). */
  active: boolean;
  /** Orbit altitude above the surface (km) — the fleet-management detail (which shell it's in). */
  altKm: number;
  /** Orbit inclination (degrees) — how far off the equator it reaches. */
  incDeg: number;
}

/** The COVERAGE·ROSTER render state (a pure projection of the live net session). */
export interface CoverageRosterState {
  /** Every launched sat, in roster order. */
  sats: CoverageRosterSat[];
  /** The labels of every ACTIVE contract that is NOT served right now (the dark regions). */
  dark: string[];
}

export class CoverageRoster implements PanelHandle {
  readonly title = "COVERAGE·ROSTER";
  readonly content: HTMLElement;

  // --- sat roster rows (rebuilt on an id-signature change) ---
  private rowsHost: HTMLElement;
  private rows = new Map<string, { root: HTMLElement; id: HTMLElement; cls: HTMLElement; covers: HTMLElement; meta: HTMLElement }>();
  private sig = "";

  // --- DARK line (active-but-unserved regions) ---
  private darkLine: HTMLElement;

  private worst: "ok" | "warn" = "ok";

  constructor() {
    this.content = el("div", "telem");

    const rosterGroup = group("ROSTER · LAUNCHED");
    this.rowsHost = el("div", "roster-rows");
    rosterGroup.append(this.rowsHost);
    this.content.append(rosterGroup);

    const darkGroup = group("COVERAGE");
    this.darkLine = el("div", "roster-dark");
    darkGroup.append(this.darkLine);
    this.content.append(darkGroup);
  }

  render(state: CoverageRosterState): void {
    const sig = state.sats.map((s) => s.id).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.rowsHost.replaceChildren();
      this.rows.clear();
      if (state.sats.length === 0) {
        const empty = el("div", "net-contract-empty");
        empty.textContent = "— no satellites launched —";
        this.rowsHost.append(empty);
      }
      for (const s of state.sats) {
        const root = el("div", "roster-row");
        const top = el("div", "roster-row-top");
        const id = el("span", "roster-id");
        const cls = el("span", "v cyan");
        const covers = el("span", "roster-covers");
        top.append(id, cls, covers);
        // The orbit detail sub-line — which shell + how far off the equator (the fleet-management read).
        const meta = el("div", "roster-meta");
        root.append(top, meta);
        this.rowsHost.append(root);
        this.rows.set(s.id, { root, id, cls, covers, meta });
      }
    }

    for (const s of state.sats) {
      const r = this.rows.get(s.id);
      if (!r) continue;
      setText(r.id, s.id);
      setText(r.cls, s.orbitClass);
      setText(r.covers, s.covers);
      r.covers.className = `roster-covers ${s.active ? "green" : "dim"}`;
      setText(r.meta, `${Math.round(s.altKm).toLocaleString()} km · ${Math.round(s.incDeg)}° incl${s.active ? "" : " · idle"}`);
    }

    // DARK line — name the active-but-unserved regions in WORDS (the colour-off channel).
    if (state.dark.length === 0) {
      setText(this.darkLine, state.sats.length === 0 ? "no coverage yet" : "all active regions covered ✓");
      this.darkLine.className = state.sats.length === 0 ? "roster-dark dim" : "roster-dark green";
      this.worst = "ok";
    } else {
      setText(this.darkLine, `DARK: ${state.dark.join(" · ")}`);
      this.darkLine.className = "roster-dark amber";
      this.worst = "warn";
    }
  }

  status(): "ok" | "warn" | "crit" {
    return this.worst;
  }

  subtitle(): string {
    return this.worst === "warn" ? "· a gap" : "· covered";
  }
}

// --- tiny DOM helpers -------------------------------------------------------

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

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
