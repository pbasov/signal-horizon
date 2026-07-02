/**
 * LEDGER·FLEET — the right rail's bottom instrument (m1-redesign.md §2.1): the wallet
 * with its live €/min flow, and the FLEET strip — one chip per sat with its tier glyph,
 * live pipe load, an underburn marker with the circularization affordance, and the
 * pointable beams (the pointing verb's home in R1: each ACCESS/GATEWAY pipe shows its
 * target and re-points on interaction, cycling the live demand regions).
 *
 * Facts only: load vs the pipe's own capacity, no verdicts.
 */

import type { PanelHandle } from "../wm/shell";

export interface FleetBeamRow {
  slot: number;
  type: string;
  /** Current target region id ("" = unassigned). */
  target: string;
  pointable: boolean;
  /** Pipe load vs capacity (display units). */
  loadU: number;
  capU: number;
  /** GEOMETRY FACT for a pointed beam: does this sat currently see its target region
   * (line-of-sight + budget, this instant)? null = not applicable (unaimed/floodlight). */
  sight: boolean | null;
}

export interface FleetChip {
  id: string;
  tier: string;
  altKm: number;
  incDeg: number;
  /** Current parked sub-longitude (deg) for a GEO-period sat — its AIM. Null = not parked. */
  parkedLonDeg: number | null;
  underburned: boolean;
  beams: FleetBeamRow[];
}

export interface LedgerFleetState {
  balanceEur: number;
  ratePerMin: number;
  chips: FleetChip[];
  /** In-flight launch events (id + phase word) for the strip's pending row. */
  pending: { id: string; phase: string }[];
}

export interface LedgerFleetActions {
  onCycleBeam(satId: string, slot: number): void;
  onCircularize(satId: string): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

export class LedgerFleet implements PanelHandle {
  readonly title = "LEDGER·FLEET";
  readonly content: HTMLElement;

  private readonly vWallet: HTMLElement;
  private readonly vRate: HTMLElement;
  private readonly chipsHost: HTMLElement;
  private sig = "";
  private live = new Map<string, { beams: Map<number, HTMLButtonElement> }>();

  constructor(private readonly actions: LedgerFleetActions) {
    this.content = el("div", "telem ledger-fleet");
    const ledger = el("div", "group");
    ledger.appendChild(el("div", "legend", "LEDGER"));
    this.vWallet = el("div", "lf-wallet", "");
    this.vRate = el("div", "lf-rate", "");
    this.vRate.title = "Net cash flow: contract revenue minus penalties minus per-satellite operating cost.";
    ledger.append(this.vWallet, this.vRate);
    this.content.appendChild(ledger);
    const fleet = el("div", "group");
    fleet.appendChild(el("div", "legend", "FLEET"));
    this.chipsHost = el("div", "lf-chips");
    fleet.appendChild(this.chipsHost);
    this.content.appendChild(fleet);
  }

  render(s: LedgerFleetState): void {
    this.vWallet.textContent = `€${Math.round(s.balanceEur).toLocaleString("en-US")}`;
    const sign = s.ratePerMin >= 0 ? "+" : "−";
    this.vRate.textContent = `${sign}€${Math.abs(Math.round(s.ratePerMin)).toLocaleString("en-US")}/min`;
    this.vRate.className = `lf-rate ${s.ratePerMin >= 0 ? "up" : "down"}`;

    const sig =
      s.chips.map((c) => `${c.id}:${c.underburned ? 1 : 0}:${c.beams.map((b) => `${b.slot}>${b.target}`).join(",")}`).join("|") +
      "||" +
      s.pending.map((p) => `${p.id}:${p.phase}`).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.chipsHost.textContent = "";
      this.live.clear();
      for (const p of s.pending) {
        this.chipsHost.appendChild(el("div", "lf-pending", `${p.id} — ${p.phase}`));
      }
      for (const c of s.chips) {
        const chip = el("div", "lf-chip");
        const head = el("div", "lf-chip-head");
        head.appendChild(el("span", "lf-chip-id", c.id));
        const orbitTxt =
          c.parkedLonDeg !== null
            ? `${c.tier} · parked over lon ${Math.round(c.parkedLonDeg)}° · ${Math.round(c.altKm)} km`
            : `${c.tier} · ${Math.round(c.altKm)} km · ${Math.round(c.incDeg)}° incl`;
        const orbitEl = el("span", "lf-chip-orbit", orbitTxt);
        orbitEl.title =
          c.parkedLonDeg !== null
            ? "This satellite's period matches the day — it PARKS over one longitude. That longitude IS its aim."
            : "A moving orbit: altitude + inclination decide which latitudes its footprint sweeps.";
        head.appendChild(orbitEl);
        chip.appendChild(head);
        if (c.underburned) {
          const fix = document.createElement("button");
          fix.type = "button";
          fix.className = "net-btn lf-fix";
          fix.textContent = "UNDERBURN — CIRCULARIZE €300";
          fix.setAttribute("data-net", "circularize");
          fix.setAttribute("data-sat", c.id);
          fix.addEventListener("click", () => this.actions.onCircularize(c.id));
          chip.appendChild(fix);
        }
        const beamsMap = new Map<number, HTMLButtonElement>();
        for (const b of c.beams) {
          if (b.pointable) {
            const beamBtn = document.createElement("button");
            beamBtn.type = "button";
            beamBtn.className = `net-btn lf-beam${b.target === "" ? " unaimed" : ""}`;
            beamBtn.setAttribute("data-net", "beam");
            beamBtn.setAttribute("data-sat", c.id);
            beamBtn.setAttribute("data-slot", String(b.slot));
            beamBtn.addEventListener("click", () => this.actions.onCycleBeam(c.id, b.slot));
            chip.appendChild(beamBtn);
            beamsMap.set(b.slot, beamBtn);
          } else {
            const fixedEl = el("div", "lf-beam-fixed", "");
            fixedEl.title =
              b.type === "BROADCAST"
                ? "A floodlight: serves every latency-tolerant demand in its footprint automatically; its pipe is shared by all riders."
                : "Sat-to-sat relay hardware — inert until relay routing arrives.";
            chip.appendChild(fixedEl);
            // Non-pointable pipes still render their live load below (via the update pass on
            // the button map being absent — the fixed row is refreshed from the sig rebuild).
          }
        }
        this.chipsHost.appendChild(chip);
        this.live.set(c.id, { beams: beamsMap });
      }
    }
    // Per-frame refresh of the live numbers on the (stable) chip DOM.
    for (const c of s.chips) {
      const entry = this.live.get(c.id);
      if (!entry) continue;
      for (const b of c.beams) {
        const beamBtn = entry.beams.get(b.slot);
        if (!beamBtn) continue;
        const sightTxt = b.sight === null ? "" : b.sight ? " · in view" : " · NO LINE OF SIGHT";
        const target = b.target === "" ? "· unaimed ·" : `→ ${b.target}`;
        beamBtn.textContent = `${b.type} ${target}${sightTxt} · ${b.loadU.toFixed(2)}/${b.capU.toFixed(1)}u`;
        beamBtn.classList.toggle("hot", b.capU > 0 && b.loadU / b.capU >= 0.8);
        beamBtn.classList.toggle("unaimed", b.target === "");
        beamBtn.classList.toggle("blind", b.sight === false);
        beamBtn.title =
          "A spot beam serves ONE region. Clicking cycles its target across the live demands (and unaimed). " +
          "'NO LINE OF SIGHT' means the beam is pointed at a region this satellite cannot currently reach — pointing does not bend physics.";
      }
    }
    // Fixed (non-pointable) pipes: repaint their text in place by walking the chips once.
    let i = 0;
    for (const chipEl of Array.from(this.chipsHost.querySelectorAll<HTMLElement>(".lf-chip"))) {
      const c = s.chips[i++];
      if (!c) break;
      const fixedEls = chipEl.querySelectorAll<HTMLElement>(".lf-beam-fixed");
      let f = 0;
      for (const b of c.beams) {
        if (b.pointable) continue;
        const elFixed = fixedEls[f++];
        if (elFixed) {
          elFixed.textContent = `${b.type} · floodlight · ${b.loadU.toFixed(2)}/${b.capU.toFixed(1)}u`;
          elFixed.classList.toggle("hot", b.capU > 0 && b.loadU / b.capU >= 0.8);
        }
      }
    }
  }
}
