/**
 * M2d — CONTRACTS (GDD §4.9 economy, §3 the loop): the offer board + the earn.
 *
 * This panel surfaces the M2d coverage-revenue loop made glanceable: the live contract
 * offers (region / quality / tariff / term), the ACTIVE contracts with their SERVED
 * fraction + earned €, and the network's current contract-revenue rate. It is the face
 * of "building coverage now PAYS" — the wallet climbs as the served coverage clears the
 * quality bar of accepted contracts (the §3 gap → asset → integration → REVENUE loop).
 *
 * STYLING (DD-1 "monochrome machine, living signal", §8 1-bit chrome): the housing is
 * the shared .telem dashed-group chrome; only the DATA carries colour, every colour
 * distinction REDUNDANT on a glyph/word so it reads colour-off (CVD-safe, §8):
 *   - STATE — OFFERED (cyan, "OFFER"), ACTIVE (green, served%-driven), COMPLETED
 *     (green "✓ DONE"), FAILED (red "✕"); the WORD is the channel, colour reinforces.
 *   - SERVED % — green (≥ full) / amber (partial) / red (breaching), redundant on the
 *     number + a BREACH word when the grace clock is ticking.
 *   - EARNED — cyan info €; the number is the signal.
 * The SELECTED contract row (the accept/decline target) carries a leading ▸ marker + a
 * highlight class — a position/glyph channel independent of colour.
 *
 * The header is built ONCE; the per-contract rows are rebuilt only when the contract
 * set or its glanceable fields CHANGE (a cheap signature compare), so a quiet board
 * costs nothing per frame. Pure DOM text — no f64→f32 crosses here (only src/orrery).
 */
import type { ContractReadout, ContractsRenderState } from "../types";
import type { PanelHandle } from "../wm/shell";
import { fmtDuration, fmtEuro, fmtPct } from "../format";

export class Contracts implements PanelHandle {
  readonly title = "CONTRACTS";
  readonly content: HTMLElement;

  // --- SUMMARY (built once) ---
  private vBalance: HTMLElement;
  private vRevenue: HTMLElement;
  private vEarned: HTMLElement;
  private vBoard: HTMLElement;
  /** The scrolling list host the per-contract rows are rebuilt into. */
  private listHost: HTMLElement;

  /** Last-rendered signature of the contract rows (skip the rebuild when unchanged). */
  private lastSig = "";
  /** Mirror of the worst live state for the titlebar lamp. */
  private worst: "ok" | "warn" | "crit" = "ok";
  private activeCount = 0;

  constructor() {
    this.content = el("div", "telem");

    // GROUP: NETWORK — the BUILD wallet + the contract income at a glance. WALLET is the
    // headline: it CLIMBS as coverage serves accepted contracts (the loop closing).
    const summary = group("NETWORK · CONTRACTS");
    this.vBalance = valueOf(row(summary, "WALLET", "green"));
    this.vRevenue = valueOf(row(summary, "REVENUE", "green"));
    this.vEarned = valueOf(row(summary, "EARNED", "cyan"));
    this.vBoard = valueOf(row(summary, "BOARD"));
    this.content.append(summary);

    // GROUP: BOARD — the per-contract rows (rebuilt on change).
    const board = group("OFFERS + ACTIVE");
    this.listHost = el("div", "contract-list");
    board.append(this.listHost);
    this.content.append(board);
  }

  render(state: ContractsRenderState): void {
    // --- SUMMARY rows. WALLET first — the build € that pays capex + earns from serving.
    setText(this.vBalance, fmtEuro(state.balanceEur));
    setValueClass(this.vBalance, state.balanceEur < 0 ? "red" : "green");
    const revPerHr = state.revenueRatePerSecond * 3600;
    setText(this.vRevenue, revPerHr === 0 ? "€0/hr" : `+${fmtEuro(revPerHr)}/hr`);
    setValueClass(this.vRevenue, revPerHr > 0 ? "green" : revPerHr < 0 ? "red" : "");
    setText(this.vEarned, fmtEuro(state.totalEarnedEur));
    setText(this.vBoard, `${state.offeredCount} offered · ${state.activeCount} active`);
    this.activeCount = state.activeCount;

    // --- BOARD: rebuild the per-contract rows only when the glanceable view changed.
    const sig = signature(state.contracts);
    if (sig !== this.lastSig) {
      this.lastSig = sig;
      this.rebuildList(state.contracts);
    }

    // --- titlebar lamp: crit if a breach is building / a fail just landed; warn if a
    // contract is offered + awaiting a decision; else ok.
    this.worst = "ok";
    for (const c of state.contracts) {
      if (c.state === "active" && c.breachSecondsAccum > 0) this.worst = "crit";
      else if (c.state === "offered" && this.worst === "ok") this.worst = "warn";
    }
  }

  private rebuildList(contracts: ContractReadout[]): void {
    this.listHost.replaceChildren();
    // Show the live board: OFFERED + ACTIVE first (the actionable ones), then the most
    // recent terminal outcomes (completed/failed) as a short tail.
    const live = contracts.filter((c) => c.state === "offered" || c.state === "active");
    const done = contracts.filter((c) => c.state === "completed" || c.state === "failed").slice(-3);
    const rows = [...live, ...done];
    if (rows.length === 0) {
      const empty = el("div", "contract-empty");
      empty.textContent = "no contracts on offer yet — coverage demand builds over time";
      this.listHost.append(empty);
      return;
    }
    for (const c of rows) this.listHost.append(this.cardFor(c));
  }

  /** One contract card: a head line (▸ marker · region · STATE) + a detail line
   * (tariff/term/served% or earned), in the §8 1-bit chrome with the data coloured. */
  private cardFor(c: ContractReadout): HTMLElement {
    const card = el("div", c.selected ? "contract-card sel" : "contract-card");

    const head = el("div", "contract-head");
    const mark = el("span", "contract-mark");
    mark.textContent = c.selected ? "▸" : " ";
    const label = el("span", "contract-label");
    label.textContent = c.label;
    const st = el("span", `contract-state ${stateTone(c)}`);
    st.textContent = stateWord(c);
    head.append(mark, label, st);

    const detail = el("div", "contract-detail");
    detail.textContent = detailText(c);
    detail.className = `contract-detail ${detailTone(c)}`;

    card.append(head, detail);
    return card;
  }

  /** Titlebar lamp: crit on a breaching contract, warn on a pending offer, else ok. */
  status(): "ok" | "warn" | "crit" {
    return this.worst;
  }

  subtitle(): string {
    return this.activeCount > 0 ? `· ${this.activeCount} earning` : "· awaiting demand";
  }
}

// --- per-contract presentation (pure helpers) -------------------------------

/** The state WORD shown on the card (the colour-off channel). */
function stateWord(c: ContractReadout): string {
  switch (c.state) {
    case "offered":
      return `OFFER ${fmtDuration(c.offerSecondsLeft)}`;
    case "active":
      return c.breachSecondsAccum > 0 ? `BREACH ${fmtDuration(c.breachSecondsAccum)}` : `SERVE ${fmtPct(c.servedFraction)}`;
    case "completed":
      return "✓ DONE";
    case "failed":
      return "✕ ENDED";
  }
}

/** The colour tone for the state word (redundant with the word). */
function stateTone(c: ContractReadout): string {
  switch (c.state) {
    case "offered":
      return "cyan";
    case "active":
      return c.breachSecondsAccum > 0 ? "red" : c.servedFraction >= 0.999 ? "green" : "amber";
    case "completed":
      return "green";
    case "failed":
      return "red";
  }
}

/** The detail line: the deal terms for an offer, the live earn for an active one. */
function detailText(c: ContractReadout): string {
  const tariffPerHr = c.tariffPerSecond * 3600;
  if (c.state === "offered") {
    return `${c.cellCount} cells · conn≥1 · +${fmtEuro(tariffPerHr)}/hr · term ${fmtDuration(c.termSeconds)}`;
  }
  if (c.state === "active") {
    const pct = c.termSeconds > 0 ? c.servedSecondsAccum / c.termSeconds : 0;
    return `served ${fmtPct(c.servedFraction)} · earned ${fmtEuro(c.earnedEur)} · term ${fmtPct(pct)}`;
  }
  return `earned ${fmtEuro(c.earnedEur)} · ${c.cellCount} cells`;
}

/** The detail line tone (cyan info for offers + done; warmth for active serve%). */
function detailTone(c: ContractReadout): string {
  if (c.state !== "active") return "cyan";
  if (c.breachSecondsAccum > 0) return "red";
  return c.servedFraction >= 0.999 ? "green" : "amber";
}

/** A cheap glanceable signature so the row DOM is rebuilt only on a visible change. */
function signature(contracts: ContractReadout[]): string {
  let s = "";
  for (const c of contracts) {
    if (c.state === "completed" || c.state === "failed") {
      // terminal: only id+state matter (and we only show the last few).
      s += `${c.id}:${c.state};`;
      continue;
    }
    s +=
      `${c.id}:${c.state}:${c.selected ? 1 : 0}:` +
      `${Math.round(c.servedFraction * 20)}:${Math.round(c.earnedEur)}:` +
      `${Math.round(c.offerSecondsLeft / 60)}:${Math.round(c.breachSecondsAccum / 30)}:` +
      `${Math.round(c.servedSecondsAccum / 60)};`;
  }
  return s;
}

// --- tiny DOM helpers (kept local; mirror the finance/telemetry pattern) -----

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
