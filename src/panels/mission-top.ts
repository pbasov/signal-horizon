/**
 * MISSION·TOP — the right rail's top instrument (m1-redesign.md §2.1/§2.2). Two faces,
 * one panel, swapped in place (the loop never leaves the MISSION desktop):
 *
 *   BOOK — the tender board: the current objective (a GOAL, never an instruction —
 *   copy.ts under the lint) + every live tender/contract with its SLA pips, the honest
 *   bet (pays X while served / bleeds Y while signed and dark), term progress, and an
 *   ACCEPT affordance per offered row.
 *
 *   PAD — the vehicle builder + typed aim: bus tier, antenna cards (per-card capacity
 *   and price — capacity design IS loadout design), batch size, typed orbit numbers
 *   (altitude/inclination/sub-lon/RAAN/phase — first-class, before drag lands in R2),
 *   the COVERAGE COMB (facts: the LoS windows this exact draft produces), the itemized
 *   stack cost, and a two-step ARM → LAUNCH commit.
 *
 * LAW 1 (facts, never verdicts): the pad shows physics (comb, period, latency, cost) —
 * no WILL-SERVE, no NEED-N, no pre-computed answers. Every value is recomputed from the
 * sim snapshot each frame by main.ts; this panel renders what it is handed.
 */

import type { PanelHandle } from "../wm/shell";
import type { NetContractRow } from "./net-planner";
import { ANTENNA_CARDS, BUS_SPECS, type BusTier } from "../sim/net/sat";
import { MISSION_OBJECTIVES, TENDER_BET } from "./copy";

/** The typed orbit numbers (display units; main.ts owns SI/radians). */
export interface PadDraftReadout {
  altKm: number;
  incDeg: number;
  subLonDeg: number;
  raanDeg: number;
  phaseSpreadDeg: number;
}

export interface MissionTopState {
  mode: "book" | "pad";
  /** Scenario cursor (indexes MISSION_OBJECTIVES; -1 before the first beat). */
  act: number;
  tenders: NetContractRow[];
  balanceEur: number;
  // --- PAD ---
  bus: BusTier;
  cards: string[];
  count: number;
  draft: PadDraftReadout;
  /** Itemized stack: one vehicle + count × hardware. */
  stack: { vehicleEur: number; hardwareEur: number; totalEur: number };
  /** Physics facts of the draft (period; parks flag; one-way latency to the comb region). */
  facts: { periodS: number; parks: boolean; latencyMs: number | null };
  comb: { windows: boolean[]; duty: number } | null;
  combRegionLabel: string;
  armed: boolean;
  /** Loadout validation problem (null = valid). */
  problem: string | null;
}

export interface MissionTopActions {
  onMode(mode: "book" | "pad"): void;
  onAccept(contractId: string): void;
  onBus(bus: BusTier): void;
  onToggleCard(cardId: string): void;
  onCount(delta: number): void;
  onParam(name: keyof PadDraftReadout, value: number): void;
  onArm(): void;
  onLaunch(): void;
}

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(label: string, cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

const AXIS_PIPS: { key: "latency" | "availability" | "bandwidth"; glyph: string }[] = [
  { key: "latency", glyph: "LAT" },
  { key: "availability", glyph: "AVL" },
  { key: "bandwidth", glyph: "BW" },
];

export class MissionTop implements PanelHandle {
  readonly title = "MISSION";
  readonly content: HTMLElement;

  private readonly vLegend: HTMLElement;
  private readonly modeBtn: HTMLButtonElement;

  // BOOK face
  private readonly bookFace: HTMLElement;
  private readonly vObjTitle: HTMLElement;
  private readonly vObjDetail: HTMLElement;
  private readonly tendersHost: HTMLElement;
  private tenderSig = "";
  private tenderEls = new Map<string, { state: HTMLElement; served: HTMLElement }>();

  // PAD face
  private readonly padFace: HTMLElement;
  private busBtns = new Map<BusTier, HTMLButtonElement>();
  private cardBtns = new Map<string, HTMLButtonElement>();
  private readonly vSlots: HTMLElement;
  private readonly vCount: HTMLElement;
  private paramInputs = new Map<string, HTMLInputElement>();
  private readonly combCanvas: HTMLCanvasElement;
  private readonly vCombLabel: HTMLElement;
  private readonly vFacts: HTMLElement;
  private readonly vStack: HTMLElement;
  private readonly vProblem: HTMLElement;
  private readonly armBtn: HTMLButtonElement;
  private readonly launchBtn: HTMLButtonElement;

  constructor(private readonly actions: MissionTopActions) {
    this.content = el("div", "telem mission-top");

    // Header: mode toggle (BOOK ⇄ PAD) + wallet legend.
    const head = el("div", "group mission-head");
    this.modeBtn = btn("OPEN PAD", "net-btn mission-mode", () => {
      this.actions.onMode(this.lastMode === "pad" ? "book" : "pad");
    });
    this.modeBtn.setAttribute("data-net", "pad-toggle");
    this.vLegend = el("div", "legend", "");
    head.append(this.vLegend, this.modeBtn);
    this.content.appendChild(head);

    // --- BOOK face ---
    this.bookFace = el("div", "mission-book");
    const objGroup = el("div", "group net-objective");
    this.vObjTitle = el("div", "net-obj-title", "");
    this.vObjDetail = el("div", "net-obj-detail", "");
    objGroup.append(this.vObjTitle, this.vObjDetail);
    this.tendersHost = el("div", "group mission-tenders");
    this.bookFace.append(objGroup, this.tendersHost);
    this.content.appendChild(this.bookFace);

    // --- PAD face ---
    this.padFace = el("div", "mission-pad");

    const busGroup = el("div", "group");
    busGroup.appendChild(el("div", "legend", "BUS"));
    const busRow = el("div", "mission-row");
    for (const tier of ["smallsat", "comsat"] as BusTier[]) {
      const spec = BUS_SPECS[tier];
      const b = btn(`${spec.label} ${spec.gSlots}G+${spec.sSlots}S €${spec.priceEur}`, "net-btn mission-bus", () =>
        this.actions.onBus(tier),
      );
      b.setAttribute("data-net", `bus-${tier}`);
      this.busBtns.set(tier, b);
      busRow.appendChild(b);
    }
    busGroup.appendChild(busRow);
    this.vSlots = el("div", "mission-hint", "");
    busGroup.appendChild(this.vSlots);
    this.padFace.appendChild(busGroup);

    const cardsGroup = el("div", "group");
    cardsGroup.appendChild(el("div", "legend", "ANTENNA CARDS"));
    const cardsGrid = el("div", "mission-cards-grid");
    for (const card of ANTENNA_CARDS) {
      const row = btn(
        `${card.label} ${card.capacityUnits.toFixed(1)}u €${card.priceEur}`,
        "net-btn mission-card",
        () => this.actions.onToggleCard(card.id),
      );
      row.setAttribute("data-net", `card-${card.id}`);
      this.cardBtns.set(card.id, row);
      cardsGrid.appendChild(row);
    }
    cardsGroup.appendChild(cardsGrid);
    this.padFace.appendChild(cardsGroup);

    const orbitGroup = el("div", "group");
    orbitGroup.appendChild(el("div", "legend", "ORBIT · TYPED"));
    const mkParam = (label: string, name: keyof PadDraftReadout, step: number) => {
      const row = el("div", "mission-param");
      row.appendChild(el("span", "mission-param-label", label));
      const input = document.createElement("input");
      input.type = "number";
      input.step = String(step);
      input.className = "mission-input";
      input.setAttribute("data-net", `param-${name}`);
      input.addEventListener("change", () => this.actions.onParam(name, Number(input.value)));
      this.paramInputs.set(name, input);
      row.appendChild(input);
      orbitGroup.appendChild(row);
    };
    mkParam("ALTITUDE km", "altKm", 5);
    mkParam("INCLINATION °", "incDeg", 5);
    mkParam("SUB-LON °", "subLonDeg", 5);
    mkParam("RAAN °", "raanDeg", 5);
    mkParam("PHASE SPREAD °", "phaseSpreadDeg", 15);
    const countRow = el("div", "mission-param");
    countRow.appendChild(el("span", "mission-param-label", "BATCH"));
    const minus = btn("−", "net-btn mission-step", () => this.actions.onCount(-1));
    minus.setAttribute("data-net", "count-minus");
    this.vCount = el("span", "mission-count", "1");
    const plus = btn("+", "net-btn mission-step", () => this.actions.onCount(1));
    plus.setAttribute("data-net", "count-plus");
    countRow.append(minus, this.vCount, plus);
    orbitGroup.appendChild(countRow);
    this.padFace.appendChild(orbitGroup);

    const combGroup = el("div", "group");
    this.vCombLabel = el("div", "legend", "COVERAGE COMB");
    combGroup.appendChild(this.vCombLabel);
    this.combCanvas = document.createElement("canvas");
    this.combCanvas.className = "mission-comb";
    this.combCanvas.width = 288;
    this.combCanvas.height = 18;
    combGroup.appendChild(this.combCanvas);
    this.vFacts = el("div", "mission-hint", "");
    combGroup.appendChild(this.vFacts);
    this.padFace.appendChild(combGroup);

    const commitGroup = el("div", "group");
    this.vStack = el("div", "mission-stack", "");
    this.vProblem = el("div", "mission-problem", "");
    this.armBtn = btn("ARM", "net-btn mission-arm", () => this.actions.onArm());
    this.armBtn.setAttribute("data-net", "arm");
    this.launchBtn = btn("LAUNCH", "net-btn mission-launch", () => this.actions.onLaunch());
    this.launchBtn.setAttribute("data-net", "launch");
    commitGroup.append(this.vStack, this.vProblem, this.armBtn, this.launchBtn);
    this.padFace.appendChild(commitGroup);

    this.content.appendChild(this.padFace);
  }

  private lastMode: "book" | "pad" = "book";

  render(s: MissionTopState): void {
    this.lastMode = s.mode;
    this.vLegend.textContent = `€${Math.round(s.balanceEur).toLocaleString("en-US")}`;
    this.modeBtn.textContent = s.mode === "pad" ? "BACK TO BOOK" : "OPEN PAD";
    this.bookFace.style.display = s.mode === "book" ? "" : "none";
    this.padFace.style.display = s.mode === "pad" ? "" : "none";

    if (s.mode === "book") this.renderBook(s);
    else this.renderPad(s);
  }

  private renderBook(s: MissionTopState): void {
    const obj = MISSION_OBJECTIVES[Math.max(0, Math.min(s.act, MISSION_OBJECTIVES.length - 1))];
    this.vObjTitle.textContent = obj.title;
    this.vObjDetail.textContent = obj.detail;

    // Rebuild tender rows only on a signature change; refresh live numbers in place.
    const sig = s.tenders.map((t) => `${t.id}:${t.state}:${t.terms}`).join("|");
    if (sig !== this.tenderSig) {
      this.tenderSig = sig;
      this.tendersHost.textContent = "";
      this.tenderEls.clear();
      for (const t of s.tenders) {
        const row = el("div", "mission-tender");
        const head = el("div", "mission-tender-head");
        head.appendChild(el("span", "mission-tender-label", t.label));
        const state = el("span", "mission-tender-state", t.state.toUpperCase());
        head.appendChild(state);
        row.appendChild(head);
        const pips = el("div", "mission-pips");
        for (const p of AXIS_PIPS) {
          const on = t.terms.toLowerCase().includes(p.key === "latency" ? "ms" : p.key === "availability" ? "avail" : "bps");
          pips.appendChild(el("span", `mission-pip${on ? " on" : ""}`, p.glyph));
        }
        pips.appendChild(el("span", "mission-terms", t.terms));
        row.appendChild(pips);
        row.appendChild(
          el("div", "mission-tender-bet", TENDER_BET(`€${Math.round(t.rewardPerHr).toLocaleString("en-US")}/hr`, `€${Math.round(t.penaltyPerHr).toLocaleString("en-US")}/hr`)),
        );
        const served = el("div", "mission-tender-served", "");
        row.appendChild(served);
        if (t.state === "offered") {
          const accept = btn("SIGN", "net-btn mission-accept", () => this.actions.onAccept(t.id));
          accept.setAttribute("data-net", "accept");
          accept.setAttribute("data-contract", t.id);
          row.appendChild(accept);
        }
        this.tendersHost.appendChild(row);
        this.tenderEls.set(t.id, { state, served });
      }
    }
    for (const t of s.tenders) {
      const els = this.tenderEls.get(t.id);
      if (!els) continue;
      els.state.textContent = t.state.toUpperCase();
      els.state.className = `mission-tender-state ${t.state}${t.state === "active" && !t.served ? " dark" : ""}`;
      els.served.textContent =
        t.state === "active"
          ? `${t.served ? "carrying" : "DARK"} · served ${(t.servedFraction * 100).toFixed(0)}% · term ${(t.progressFraction * 100).toFixed(0)}% · €${Math.round(t.earnedEur).toLocaleString("en-US")}`
          : t.state === "offered"
            ? ""
            : `€${Math.round(t.earnedEur).toLocaleString("en-US")}`;
    }
  }

  private renderPad(s: MissionTopState): void {
    for (const [tier, b] of this.busBtns) b.classList.toggle("active", tier === s.bus);
    const spec = BUS_SPECS[s.bus];
    const gUsed = s.cards.filter((c) => ANTENNA_CARDS.find((k) => k.id === c)?.slot === "G").length;
    const sUsed = s.cards.length - gUsed;
    this.vSlots.textContent = `slots — G ${gUsed}/${spec.gSlots} · S ${sUsed}/${spec.sSlots}`;
    for (const [id, b] of this.cardBtns) b.classList.toggle("active", s.cards.includes(id));

    this.vCount.textContent = String(s.count);
    const d = s.draft;
    const set = (name: string, v: number) => {
      const input = this.paramInputs.get(name)!;
      if (document.activeElement !== input) input.value = String(Math.round(v * 10) / 10);
    };
    set("altKm", d.altKm);
    set("incDeg", d.incDeg);
    set("subLonDeg", d.subLonDeg);
    set("raanDeg", d.raanDeg);
    set("phaseSpreadDeg", d.phaseSpreadDeg);

    // The comb strip: solid = the region sees this draft; dark = it does not.
    this.vCombLabel.textContent = `COVERAGE COMB · ${s.combRegionLabel}`;
    const ctx = this.combCanvas.getContext("2d");
    if (ctx && s.comb) {
      const w = this.combCanvas.width;
      const h = this.combCanvas.height;
      ctx.clearRect(0, 0, w, h);
      const n = s.comb.windows.length;
      const cell = w / n;
      for (let i = 0; i < n; i++) {
        ctx.fillStyle = s.comb.windows[i] ? "#49d7c8" : "#1a2430";
        ctx.fillRect(i * cell, 2, Math.ceil(cell) - 1, h - 4);
      }
    } else if (ctx) {
      ctx.clearRect(0, 0, this.combCanvas.width, this.combCanvas.height);
    }
    const dutyPct = s.comb ? Math.round(s.comb.duty * 100) : 0;
    const lat = s.facts.latencyMs === null ? "—" : `${s.facts.latencyMs.toFixed(1)} ms`;
    this.vFacts.textContent = `in view ${dutyPct}% of the orbit · period ${Math.round(s.facts.periodS)}s${s.facts.parks ? " · PARKS" : ""} · one-way ${lat}`;

    this.vStack.textContent = `vehicle €${Math.round(s.stack.vehicleEur).toLocaleString("en-US")} + hardware €${Math.round(s.stack.hardwareEur).toLocaleString("en-US")} × ${s.count} = €${Math.round(s.stack.totalEur).toLocaleString("en-US")}`;
    this.vProblem.textContent = s.problem ?? "";
    this.vProblem.style.display = s.problem ? "" : "none";
    this.armBtn.classList.toggle("active", s.armed);
    this.armBtn.textContent = s.armed ? "ARMED" : "ARM";
    const ready = s.armed && s.problem === null;
    this.launchBtn.classList.toggle("ready", ready);
    (this.launchBtn as HTMLButtonElement).disabled = !ready;
  }
}
