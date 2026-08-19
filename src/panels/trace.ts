/**
 * TRACE — THE ROUTING SCREEN (SD-53; docs/routing-screen.md). GDD §5 primary view #4, built.
 *
 * A two-level routing table. A **FLOW** row is a promise you made: one active contract, ranked into
 * three named bands (DARK → TIGHT → CLEAR), carrying the axis that binds it, the two raw numbers
 * that decide it, the real path the router chose, why it went dark and when — and, **on the
 * collapsed row, never behind a disclosure**, the §7.4 binding constraint and the kind of fix.
 * A **PIPE** row is one antenna and everyone riding it: its effective capacity, each rider's
 * fair share against the floor they committed to, and the **Σfloor notch** — the sum of promises
 * drawn on the bar, so the oversubscription bet is visible *before* the peak bites.
 *
 * The flow level answers WHO IS HURT; the pipe level answers WHAT IS HURTING THEM.
 *
 * --- THE LAWS THIS PANEL IS BUILT AGAINST -----------------------------------------
 * LAW 1 (facts, never verdicts): every cell is a measurement recomputed from the sim snapshot this
 * frame. The one carve-out LAW 1 grants — "solved diagnoses exist only post-hoc, about a network
 * that actually ran" — is the binding line, which appears only on a solve that ALREADY failed and
 * names a class of hardware or geometry, never an action.
 * LAW 2 (goals, never instructions): no string here names a control. All prose lives in copy.ts,
 * under the lint.
 * DD-1: the machine layer is monochrome and every colour-coded distinction is doubled on a
 * non-colour channel — bar width AND fill texture AND the integer AND the word; band hue AND the
 * ✕/▲/· glyph AND caps-vs-lowercase; starvation AND both of its operands on the same line.
 *
 * The panel holds NO sim state. main.ts hands it a pure per-frame projection; every verb leaves
 * through the injected {@link TraceActions} and is recorded as a replay-safe action there.
 *
 * @see docs/routing-screen.md §4 (the table), §5 (interaction), §6 (the levers), §8 (the copy).
 */

import type { PanelHandle } from "../wm/shell";
import {
  TRACE_BLEEDS,
  TRACE_CANDIDATES,
  TRACE_CENSUS,
  TRACE_CENSUS_BANDS,
  TRACE_CENSUS_PAUSED,
  TRACE_DARK_FOR,
  TRACE_EMPTY,
  TRACE_FRESHNESS_LEGEND,
  TRACE_IDLE_SUMMARY,
  TRACE_MARS_NO_ALTERNATIVE,
  TRACE_OVERFLOW,
  TRACE_OVERPROMISED,
  TRACE_PIPES_LEGEND,
  TRACE_REROUTED,
  TRACE_RIDER_NUMS,
  TRACE_TIP_BAND,
  TRACE_TIP_ELEV,
  TRACE_TIP_FLOOR,
  TRACE_TIP_LOSS,
  TRACE_TIP_PIPE,
  TRACE_TIP_PREFER,
} from "./copy";
import { bandGlyph, type FlowBand, type PipeState, type RiderFlag, type SlaAxisTag } from "./trace-derive";

// ── THE PROJECTION (display units only — main.ts owns every conversion) ───────────

/** The measured value and the promised value, adjacent, in that axis's own units, with the ratio
 * that needs no referent. Printing the two operands beside every derived judgement is the
 * discipline that structurally prevents the condemned "the UI lied" bug: the player can check the
 * arithmetic. */
export interface AxisRead {
  axis: SlaAxisTag;
  /** What the network is actually delivering: `"4.6 ms"` · `"0.53 u"` · `"96.2% held"` · `"7.2°"`. */
  carried: string;
  /** What was promised: `"3.0 ms budget"` · `"0.60 u"` · `"99.0% asked"` · `"5.0° gate"`. Null ⇒ `—`. */
  asked: string | null;
  /** The ratio, pre-formatted (`"153%"`), or null where a ratio would mean nothing. */
  ratio: string | null;
}

/** One contract riding one pipe — a line in the allocation ledger. */
export interface TraceRider {
  contractId: string;
  label: string;
  /** 0..5 — the identity-hue index shared with the row rule, the region fill and the bar segment. */
  hue: number;
  classTag: SlaAxisTag;
  /** Pre-formatted: what it offered, what it is getting, what it committed to (`"—"` when none). */
  offerText: string;
  shareText: string;
  floorText: string;
  flag: RiderFlag;
  /** `"94%"` — the share as a percentage of the floor. Null when there is no floor. */
  ofFloor: string | null;
  /** This rider's fraction of the bar (0..1), for its segment width. */
  frac: number;
  /** The first 3 characters printed inside a wide-enough segment (the third attribution channel). */
  tag: string;
  preferShort: boolean;
}

/** One serving antenna — the contention ledger's row. */
export interface TracePipe {
  /** `satId:slotIdx` — the machine key. Lives in `data-pipe`; never displayed. */
  pipe: string;
  satId: string;
  slotIdx: number;
  /** `"NET-SAT-2 · GATEWAY"` — the sat and the antenna, never the colon index. */
  displayId: string;
  typeGlyph: string;
  /** The beam's target REGION LABEL, or the honest absence (floodlight / unaimed). */
  targetText: string;
  /** True when the beam is aimed at a region this sat cannot currently reach. */
  blind: boolean;
  loadText: string;
  capText: string;
  /** `"(4.00 ×0.50 SICK)"` while a degradation fault derates this antenna; null otherwise. */
  derateText: string | null;
  util: number;
  pctText: string;
  /** The fixed-width text bar — width AND texture, both non-colour channels. */
  barText: string;
  state: PipeState;
  /** Σ of the committed floors riding this pipe, as a fraction of effective capacity. */
  floorNotchFrac: number;
  /** `"Σfloor 4.60 u > 4.00 u pipe"` when the promises already exceed the antenna; null otherwise. */
  overPromisedText: string | null;
  /** `"OVER +0.60 u"` when the live load exceeds capacity; null otherwise. */
  overflowText: string | null;
  riders: TraceRider[];
  /** True when any rider is under its floor — the word `STARVING` joins the state cell. */
  anyStarved: boolean;
  pointable: boolean;
  /** True while this pipe's target picker is open (exactly one is open at a time). */
  repointOpen: boolean;
  /**
   * Where this antenna COULD be pointed, each option carrying the facts that decide it — never a
   * recommendation. A blind cycle button ("click to advance the target") is a footgun: it un-serves
   * whoever the beam was on the moment you poke it out of curiosity, and it never says what you are
   * about to point at. This is the same verb with the consequence stated first.
   */
  repointOptions: RepointOption[];
}

/** One target an antenna could be pointed at, and the facts about pointing it there. */
export interface RepointOption {
  /** The region id the beam would be assigned to; `""` STOWS the beam (points it nowhere). */
  regionId: string;
  label: string;
  /** Does this satellite close a link to that region RIGHT NOW? Pointing does not bend physics. */
  sees: boolean;
  /** The consequence, stated: who is riding this pipe today, or that the target is already served
   * elsewhere, or that the beam is currently where you are hovering. */
  note: string;
  /** True for the option the beam is already on. */
  current: boolean;
}

/** One promise, ranked. */
export interface TraceFlow {
  contractId: string;
  label: string;
  /** 0 = the original signature; 1+ prints `⟲N` (a renewal generation, not a second region). */
  generation: number;
  hue: number;
  band: FlowBand;
  /**
   * The internal ordering key inside the band (headroom for a served row, an axis-and-age key for a
   * dark one). **Never rendered** — §4.10 kills the printed composite scalar and keeps only the
   * ordering it produced. It rides the state object solely so the dev probe can expose it, which is
   * what lets a playtest tell a legitimate overtake from a shuffle: the falsifier is "no row moved
   * WITHOUT earning it", and that is a claim about this number.
   */
  sortKey: number;
  /** −1 = moved up the board this frame, +1 = moved down. Drives the brief ↑/↓ glyph. */
  rankDelta: -1 | 0 | 1;
  bindsAxis: SlaAxisTag | null;
  /** True when the axis is the ROUTER's own verdict on a failed solve (caps + ✕); false when it is
   * merely the nearest axis on a healthy row (dim lowercase). */
  bindsIsVerdict: boolean;
  read: AxisRead;
  /** The router's last verdict for this contract may predate this frame (the solver re-runs on a
   * topology change, not per tick) — the `◷` glyph says so rather than letting the row imply now. */
  staleSolve: boolean;
  /** Served by a satellite that is currently faulting — the `†` cross-mark. */
  servedBySickSat: boolean;
  /** `"via NET-SAT-2 · GATEWAY → GROUND-0"`, or the stated absence. */
  pathText: string;
  /** The pipe key this flow rides (jumps to its ledger row); null when unserved or on Mars. */
  pipeKey: string | null;
  /** The pipe's live bar, echoed on the flow row so contention reads without a scroll. */
  pipeBarText: string | null;
  pipeLoadText: string | null;
  /** How many flows share this flow's pipe (`⑂×N`); 0 or 1 ⇒ no glyph. */
  shareCount: number;
  /** How many OTHER pipes could reach this region right now — the honest answer to a lever that
   * cannot move anything. */
  candidateCount: number;
  /** `"NET-SAT-2 · GATEWAY"` for a beat after this flow's path MOVED, or null. A re-route is an
   * event, and GDD §4.3 says it gets real animation budget rather than a log line: the globe
   * flashes the new path while the row says where it came from. */
  rerouteFrom: string | null;
  preferShort: boolean;
  preferEnabled: boolean;
  /** Why the lever is inert, when it is. A disabled control always states its reason. */
  preferDisabledReason: string | null;
  /** `"dark 0:47 · set below the horizon at 12:29 (×9, ~2m10s apart) · bleeds €2,400/hr while dark"` */
  whyNowText: string | null;
  /** The §7.4 binding constraint + kind of fix. DARK rows only, on the COLLAPSED row. */
  bindingText: string | null;
  /** `"!"` for a binding constraint, `"?"` for an optimisation/resilience note. */
  bindingMark: "!" | "?";
  expanded: boolean;
  /** Free-form detail lines shown while expanded (geometry, allocation, this flow's losses). */
  detail: string[];
}

/** One link+cause pair and the times it lost at — the predictability seed, grouped so the RHYTHM
 * is visible. The WIRE prints these chronologically and de-dupes the time away; this face keeps
 * every stamp, because a spacing needs more than one sample. */
export interface TraceLossGroupView {
  key: string;
  linkText: string;
  causeText: string;
  countText: string;
  timesText: string;
  /** The OBSERVED mean spacing (`"~2m10s"`), or null below three stamps. Never a forecast. */
  spacingText: string | null;
}

/** A satellite that is sick. Faults ride this view — there is no separate fault UI (M1 §5.3). */
export interface TraceNode {
  satId: string;
  glyph: string;
  kindWord: string;
  cause: string;
  detailText: string;
  carryingText: string;
}

export interface TraceState {
  /** False ⇒ the panel is not mounted in a visible tile and render() early-outs. Panels render
   * every frame even when hidden; without this gate TRACE is a permanent tax on MISSION. */
  mounted: boolean;
  paused: boolean;
  asOfText: string;
  counts: { dark: number; tight: number; clear: number };
  flows: TraceFlow[];
  /** How many CLEAR rows were collapsed into the summary line (0 ⇒ none). */
  clearCollapsed: number;
  pipes: TracePipe[];
  idle: { count: number; parkedUnits: string; expanded: boolean };
  losses: TraceLossGroupView[];
  nodes: TraceNode[];
  selectedFlowId: string | null;
  /** The four-second fact line shown after an attempt to hand-route. */
  handRouteNote: string | null;
}

export interface TraceActions {
  onSelectFlow(contractId: string): void;
  onSelectPipe(pipe: string): void;
  /** The SAME verb MISSION's tender rows already use — one action, one representation. */
  onRoute(contractId: string, pos: number): void;
  /** Open (or close) this antenna's target picker. Changes nothing about the sim. */
  onRepoint(satId: string, slotIdx: number): void;
  /** Commit the beam to a target (`""` stows it) — one `net_assign_beam`, replay-safe. */
  onRepointPick(satId: string, slotIdx: number, regionId: string): void;
  onHoverLoss(key: string | null): void;
  onHoverPipe(pipe: string | null): void;
  onToggleIdle(): void;
}

// ── tiny DOM helpers (each panel keeps its own; there is no shared module) ────────

function el(tag: string, cls?: string, text?: string): HTMLElement {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (text !== undefined) e.textContent = text;
  return e;
}

function btn(cls: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = cls;
  b.addEventListener("click", onClick);
  return b;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Show/hide without churning the class list. */
function setShown(node: HTMLElement, shown: boolean): void {
  const want = shown ? "" : "none";
  if (node.style.display !== want) node.style.display = want;
}

function group(cls: string, legend: string): { root: HTMLElement; legend: HTMLElement } {
  const g = el("div", `group ${cls}`);
  const l = el("div", "legend", legend);
  g.appendChild(l);
  return { root: g, legend: l };
}

const EMPTY_STATE: TraceState = {
  mounted: false,
  paused: false,
  asOfText: "0:00",
  counts: { dark: 0, tight: 0, clear: 0 },
  flows: [],
  clearCollapsed: 0,
  pipes: [],
  idle: { count: 0, parkedUnits: "0.00", expanded: false },
  losses: [],
  nodes: [],
  selectedFlowId: null,
  handRouteNote: null,
};

// ── per-row DOM handles (cached; rebuilt only when the row SET or order changes) ──

interface FlowRowEls {
  root: HTMLElement;
  rule: HTMLElement;
  glyph: HTMLElement;
  label: HTMLElement;
  binds: HTMLElement;
  read: HTMLElement;
  trend: HTMLElement;
  path: HTMLElement;
  pathText: HTMLElement;
  share: HTMLElement;
  bar: HTMLElement;
  load: HTMLElement;
  cands: HTMLElement;
  short: HTMLButtonElement;
  spread: HTMLButtonElement;
  whyNow: HTMLElement;
  binding: HTMLElement;
  detail: HTMLElement;
}

interface PipeRowEls {
  root: HTMLElement;
  head: HTMLElement;
  id: HTMLElement;
  target: HTMLElement;
  load: HTMLElement;
  derate: HTMLElement;
  pct: HTMLElement;
  state: HTMLElement;
  repoint: HTMLButtonElement;
  barHousing: HTMLElement;
  segs: HTMLElement;
  notch: HTMLElement;
  overflow: HTMLElement;
  riders: HTMLElement;
  riderEls: Map<string, { root: HTMLElement; label: HTMLElement; nums: HTMLElement; flag: HTMLElement }>;
  picker: HTMLElement;
}

export class Trace implements PanelHandle {
  readonly title = "TRACE";
  readonly content: HTMLElement;

  private readonly head: HTMLElement;
  private readonly headLeft: HTMLElement;
  private readonly headRight: HTMLElement;

  private readonly flowsGroup: HTMLElement;
  private readonly flowsHost: HTMLElement;
  private readonly flowsEmpty: HTMLElement;
  private readonly clearCollapsed: HTMLElement;
  private readonly handRoute: HTMLElement;

  private readonly pipesGroup: HTMLElement;
  private readonly pipesHost: HTMLElement;
  private readonly pipesIdle: HTMLButtonElement;

  private readonly lossesGroup: HTMLElement;
  private readonly lossesHost: HTMLElement;

  private readonly nodesGroup: HTMLElement;
  private readonly nodesHost: HTMLElement;

  private flowEls = new Map<string, FlowRowEls>();
  private pipeEls = new Map<string, PipeRowEls>();
  private flowSig = "";
  private pipeSig = "";
  private lossSig = "";
  private nodeSig = "";

  private lamp: "ok" | "warn" | "crit" | "idle" = "idle";
  private sub = "";
  /** Rebuild counter — `window.__panelChurn()` reads it to prove the no-churn idiom holds. */
  private rebuilds = 0;

  constructor(private readonly actions: TraceActions) {
    this.content = el("div", "telem trace");

    this.head = el("div", "trace-head");
    this.headLeft = el("span", "trace-head-l");
    this.headRight = el("span", "trace-head-r");
    this.head.title = TRACE_TIP_BAND;
    this.head.append(this.headLeft, this.headRight);
    this.content.appendChild(this.head);

    const flows = group("trace-flows", "FLOWS · WHAT BINDS");
    this.flowsGroup = flows.root;
    this.flowsEmpty = el("div", "net-hint", TRACE_EMPTY);
    this.flowsHost = el("div", "trace-rows");
    this.clearCollapsed = el("div", "trace-collapsed");
    this.handRoute = el("div", "trace-handroute");
    this.flowsGroup.append(this.flowsEmpty, this.flowsHost, this.clearCollapsed, this.handRoute);
    this.content.appendChild(this.flowsGroup);

    const pipes = group("trace-pipes", "PIPES · ALLOCATION");
    this.pipesGroup = pipes.root;
    const pipesLegend = el("div", "trace-sublegend", `${TRACE_PIPES_LEGEND} · ${TRACE_FRESHNESS_LEGEND}`);
    pipesLegend.title = TRACE_TIP_PIPE;
    this.pipesHost = el("div", "trace-pipe-rows");
    this.pipesIdle = btn("net-btn trace-idle", () => this.actions.onToggleIdle());
    this.pipesIdle.setAttribute("data-net", "trace-idle");
    this.pipesGroup.append(pipesLegend, this.pipesHost, this.pipesIdle);
    this.content.appendChild(this.pipesGroup);

    const losses = group("trace-losses", "LOSSES · BY LINK");
    this.lossesGroup = losses.root;
    this.lossesGroup.title = TRACE_TIP_LOSS;
    this.lossesHost = el("div", "trace-loss-rows");
    this.lossesGroup.append(this.lossesHost);
    this.content.appendChild(this.lossesGroup);

    const nodes = group("trace-nodes", "NODES · SICK");
    this.nodesGroup = nodes.root;
    this.nodesHost = el("div", "trace-node-rows");
    this.nodesGroup.append(this.nodesHost);
    this.content.appendChild(this.nodesGroup);

    this.render(EMPTY_STATE);
  }

  /** Rebuild count — a dev probe reads this to gate churn (docs/routing-screen.md §9.5). */
  churn(): number {
    return this.rebuilds;
  }

  render(s: TraceState): void {
    // The hidden-tile gate. Panels render every frame whether or not the WM shows them, and this
    // projection is the most expensive net panel; when TRACE is not on screen it costs one branch.
    if (!s.mounted) return;

    // ── head census ──────────────────────────────────────────────────────────────
    const total = s.counts.dark + s.counts.tight + s.counts.clear;
    setText(this.headLeft, TRACE_CENSUS(total === 1 ? "1 flow" : `${total} flows`));
    setText(
      this.headRight,
      s.paused
        ? TRACE_CENSUS_PAUSED(s.asOfText)
        : TRACE_CENSUS_BANDS(String(s.counts.dark), String(s.counts.tight), String(s.counts.clear), s.asOfText),
    );
    this.headRight.classList.toggle("paused", s.paused);

    this.renderFlows(s);
    this.renderPipes(s);
    this.renderLosses(s);
    this.renderNodes(s);

    // ── the titlebar lamp + subtitle: the across-the-room read, free signal that MISSION and
    // LEDGER·FLEET both waste. §5 forbids critical state behind a dig, and a panel swapped
    // off-screen still has to say that something is dark. ──
    const anyStarved = s.pipes.some((p) => p.anyStarved);
    const anyOver = s.pipes.some((p) => p.util >= 1);
    this.lamp =
      total === 0
        ? "idle"
        : s.counts.dark > 0 || anyStarved
          ? "crit"
          : s.counts.tight > 0 || anyOver || s.nodes.length > 0
            ? "warn"
            : "ok";
    const bits: string[] = [];
    if (s.counts.dark > 0) bits.push(`${s.counts.dark} dark`);
    if (s.counts.tight > 0) bits.push(`${s.counts.tight} tight`);
    if (anyStarved) bits.push("starving");
    this.sub = bits.length > 0 ? `· ${bits.join(" · ")}` : total > 0 ? "· clear" : "";
  }

  // ── FLOWS ──────────────────────────────────────────────────────────────────────

  private renderFlows(s: TraceState): void {
    setShown(this.flowsEmpty, s.flows.length === 0);
    setShown(this.flowsHost, s.flows.length > 0);
    setShown(this.clearCollapsed, s.clearCollapsed > 0);
    if (s.clearCollapsed > 0) {
      setText(this.clearCollapsed, `· ${s.clearCollapsed} clear`);
    }
    setShown(this.handRoute, s.handRouteNote !== null);
    if (s.handRouteNote !== null) setText(this.handRoute, s.handRouteNote);

    // Rebuild only when the row SET, their ORDER, their BAND or the expansion changes — never on a
    // number moving. `offeredLoad` oscillates every frame on the diurnal curve; a signature that
    // included it would rebuild the table sixty times a second.
    const sig = s.flows.map((f) => `${f.contractId}:${f.band}:${f.expanded ? 1 : 0}`).join("|");
    if (sig !== this.flowSig) {
      this.flowSig = sig;
      this.rebuilds++;
      this.flowsHost.replaceChildren();
      this.flowEls.clear();
      for (const f of s.flows) this.flowEls.set(f.contractId, this.buildFlowRow(f));
    }

    for (const f of s.flows) {
      const e = this.flowEls.get(f.contractId);
      if (e === undefined) continue;
      this.paintFlowRow(e, f, s.selectedFlowId === f.contractId);
    }
  }

  private buildFlowRow(f: TraceFlow): FlowRowEls {
    const root = el("div", "trace-flow");
    root.setAttribute("data-net", "trace-flow");
    root.setAttribute("data-contract", f.contractId);
    root.addEventListener("click", (ev) => {
      // The prefer buttons and the pipe jump own their own clicks.
      if ((ev.target as HTMLElement).closest("button") !== null) return;
      this.actions.onSelectFlow(f.contractId);
    });

    const rule = el("div", "trace-rule");
    const line1 = el("div", "trace-line1");
    const glyph = el("span", "trace-glyph");
    const label = el("span", "trace-label");
    const binds = el("span", "trace-binds");
    const read = el("span", "trace-read");
    const trend = el("span", "trace-trend");
    line1.append(glyph, label, binds, read, trend);

    const path = el("div", "trace-path");
    const pathText = el("span", "trace-path-text");
    const share = el("span", "trace-share");
    const bar = el("span", "trace-minibar");
    const load = el("span", "trace-miniload");
    const cands = el("span", "trace-cands");
    const short = btn("net-btn trace-prefer", () => this.actions.onRoute(f.contractId, 0));
    short.textContent = "SHORT";
    short.setAttribute("data-net", "route-short");
    short.setAttribute("data-contract", f.contractId);
    short.title = TRACE_TIP_PREFER;
    const spread = btn("net-btn trace-prefer", () => this.actions.onRoute(f.contractId, 0.5));
    spread.textContent = "SPREAD";
    spread.setAttribute("data-net", "route-spread");
    spread.setAttribute("data-contract", f.contractId);
    spread.title = TRACE_TIP_PREFER;
    const prefer = el("span", "trace-prefer-pair");
    prefer.append(short, spread);
    path.append(pathText, share, bar, load, cands, prefer);
    // Jumping from a flow to the pipe it rides is the explicit link between the two levels — the
    // player never has to correlate satellite ids by eye.
    pathText.addEventListener("click", () => {
      if (f.pipeKey !== null) this.actions.onSelectPipe(f.pipeKey);
    });

    const whyNow = el("div", "trace-whynow");
    const binding = el("div", "trace-binding");
    const detail = el("div", "trace-detail");

    root.append(rule, line1, path, whyNow, binding, detail);
    this.flowsHost.appendChild(root);
    return { root, rule, glyph, label, binds, read, trend, path, pathText, share, bar, load, cands, short, spread, whyNow, binding, detail };
  }

  private paintFlowRow(e: FlowRowEls, f: TraceFlow, selected: boolean): void {
    // Band + the two orthogonal marks (stale solve, sick carrier) all ride the one glyph cell.
    const marks =
      (f.staleSolve ? "◷" : "") + (f.servedBySickSat ? "†" : "") + (f.rankDelta === -1 ? "↑" : f.rankDelta === 1 ? "↓" : "");
    setText(e.glyph, `${bandGlyph(f.band)}${marks}`);
    e.root.className = `trace-flow band-${f.band}${selected ? " sel" : ""}`;
    e.rule.className = `trace-rule hue-${f.hue}`;
    setText(e.label, f.generation > 0 ? `${f.label} ⟲${f.generation}` : f.label);

    if (f.bindsAxis === null) {
      setText(e.binds, "—");
      e.binds.className = "trace-binds none";
    } else {
      const word = f.bindsIsVerdict ? `${axisCaps(f.bindsAxis)} ✕` : f.bindsAxis;
      setText(e.binds, word);
      e.binds.className = `trace-binds ${f.bindsIsVerdict ? "verdict" : "near"} axis-${f.bindsAxis}`;
    }

    const asked = f.read.asked ?? "—";
    setText(e.read, f.read.ratio === null ? `${f.read.carried} / ${asked}` : `${f.read.carried} / ${asked}  (${f.read.ratio})`);
    e.read.title = f.read.axis === "conn" ? TRACE_TIP_ELEV : f.read.axis === "bw" ? TRACE_TIP_FLOOR : TRACE_TIP_PIPE;
    setText(e.trend, "");

    setText(e.pathText, f.pathText);
    e.pathText.classList.toggle("jump", f.pipeKey !== null);
    if (f.pipeKey !== null) e.pathText.setAttribute("data-pipe", f.pipeKey);
    setText(e.share, f.shareCount >= 2 ? `⑂×${f.shareCount}` : "");
    setText(e.bar, f.pipeBarText ?? "");
    setText(e.load, f.pipeLoadText ?? "");
    // The candidate READ: the only honest answer to a lever that frequently cannot move anything.
    // A count of pipes whose link to this region closes right now — geometry, not a solver preview.
    setText(
      e.cands,
      f.rerouteFrom !== null
        ? TRACE_REROUTED(f.rerouteFrom)
        : f.preferEnabled
          ? TRACE_CANDIDATES(f.candidateCount)
          : "",
    );
    e.cands.classList.toggle("rerouted", f.rerouteFrom !== null);

    // The active stop INVERTS (a fill change), never merely recolours — it must read with colour off.
    e.short.classList.toggle("active", f.preferShort);
    e.spread.classList.toggle("active", !f.preferShort);
    e.short.disabled = !f.preferEnabled;
    e.spread.disabled = !f.preferEnabled;
    const reason = f.preferDisabledReason ?? TRACE_MARS_NO_ALTERNATIVE;
    e.short.title = f.preferEnabled ? TRACE_TIP_PREFER : reason;
    e.spread.title = f.preferEnabled ? TRACE_TIP_PREFER : reason;

    setShown(e.whyNow, f.whyNowText !== null);
    if (f.whyNowText !== null) setText(e.whyNow, f.whyNowText);

    // §5: no critical state behind a disclosure. The binding sentence is on the collapsed row.
    setShown(e.binding, f.bindingText !== null);
    if (f.bindingText !== null) setText(e.binding, `${f.bindingMark}  ${f.bindingText}`);

    setShown(e.detail, f.expanded && f.detail.length > 0);
    if (f.expanded && f.detail.length > 0) setText(e.detail, f.detail.join("\n"));
  }

  // ── PIPES ──────────────────────────────────────────────────────────────────────

  private renderPipes(s: TraceState): void {
    setShown(this.pipesGroup, s.pipes.length > 0 || s.idle.count > 0);
    setShown(this.pipesIdle, s.idle.count > 0);
    if (s.idle.count > 0) {
      setText(
        this.pipesIdle,
        `· ${TRACE_IDLE_SUMMARY(s.idle.count === 1 ? "1 pipe" : `${s.idle.count} pipes`, s.idle.parkedUnits)}`,
      );
    }

    const sig = s.pipes.map((p) => `${p.pipe}:${p.riders.map((r) => r.contractId).join(",")}`).join("|");
    if (sig !== this.pipeSig) {
      this.pipeSig = sig;
      this.rebuilds++;
      this.pipesHost.replaceChildren();
      this.pipeEls.clear();
      for (const p of s.pipes) this.pipeEls.set(p.pipe, this.buildPipeRow(p));
    }

    for (const p of s.pipes) {
      const e = this.pipeEls.get(p.pipe);
      if (e === undefined) continue;
      this.paintPipeRow(e, p);
    }
  }

  private buildPipeRow(p: TracePipe): PipeRowEls {
    const root = el("div", "trace-pipe");
    root.setAttribute("data-net", "trace-pipe");
    root.setAttribute("data-pipe", p.pipe);
    root.addEventListener("mouseenter", () => this.actions.onHoverPipe(p.pipe));
    root.addEventListener("mouseleave", () => this.actions.onHoverPipe(null));
    root.addEventListener("click", (ev) => {
      if ((ev.target as HTMLElement).closest("button") !== null) return;
      this.actions.onSelectPipe(p.pipe);
    });

    const head = el("div", "pipe-head");
    const id = el("span", "pipe-id");
    const target = el("span", "pipe-target");
    const load = el("span", "pipe-load");
    const derate = el("span", "pipe-derate");
    const pct = el("span", "pipe-pct");
    const state = el("span", "pipe-state");
    const repoint = btn("net-btn pipe-repoint", () => this.actions.onRepoint(p.satId, p.slotIdx));
    repoint.textContent = "REPOINT";
    repoint.setAttribute("data-net", "repoint");
    repoint.setAttribute("data-sat", p.satId);
    repoint.setAttribute("data-slot", String(p.slotIdx));
    head.append(id, target, load, derate, pct, state, repoint);

    // The bar: a 1-bit housing, one hue-tagged segment per rider, and the Σfloor notch — the
    // single most important widget here, because it draws the PROMISE line rather than the load.
    const barHousing = el("div", "pipe-bar");
    const segs = el("div", "pipe-segs");
    const notch = el("div", "pipe-floor-notch");
    notch.title = TRACE_TIP_FLOOR;
    const overflow = el("span", "pipe-overflow");
    barHousing.append(segs, notch);
    const barLine = el("div", "pipe-bar-line");
    barLine.append(barHousing, overflow);

    const riders = el("div", "pipe-riders");
    const picker = el("div", "pipe-picker");
    root.append(head, barLine, riders, picker);
    this.pipesHost.appendChild(root);
    return { root, head, id, target, load, derate, pct, state, repoint, barHousing, segs, notch, overflow, riders, riderEls: new Map(), picker };
  }

  private paintPipeRow(e: PipeRowEls, p: TracePipe): void {
    setText(e.id, `${p.displayId} ${p.typeGlyph}`);
    e.id.title = TRACE_TIP_PIPE;
    setText(e.target, p.targetText);
    e.target.classList.toggle("blind", p.blind);
    setText(e.load, `${p.loadText} / ${p.capText} u`);
    setShown(e.derate, p.derateText !== null);
    if (p.derateText !== null) setText(e.derate, p.derateText);
    setText(e.pct, p.pctText);
    setText(e.state, `${stateWord(p.state)}${p.anyStarved ? " · STARVING" : ""}`);
    e.state.className = `pipe-state ${p.state}${p.anyStarved ? " starving" : ""}`;
    setShown(e.repoint, p.pointable);
    e.repoint.classList.toggle("active", p.repointOpen);

    // Segments: one per rider, in rider-line order, each with its own dither texture so the
    // attribution survives monochrome-purist mode.
    const wantSegs = p.riders.length;
    if (e.segs.childElementCount !== wantSegs) {
      e.segs.replaceChildren();
      for (let i = 0; i < wantSegs; i++) e.segs.appendChild(el("div", "pipe-seg"));
    }
    for (let i = 0; i < wantSegs; i++) {
      const seg = e.segs.children[i] as HTMLElement;
      const r = p.riders[i];
      const pctW = `${Math.max(0, Math.min(100, r.frac * 100)).toFixed(2)}%`;
      if (seg.style.width !== pctW) seg.style.width = pctW;
      const cls = `pipe-seg hue-${r.hue} tex-${i % 3}${r.flag === "starved" ? " starved" : ""}`;
      if (seg.className !== cls) seg.className = cls;
      setText(seg, r.frac >= 0.2 ? r.tag : "");
    }

    const notchPct = `${Math.max(0, Math.min(100, p.floorNotchFrac * 100)).toFixed(2)}%`;
    if (e.notch.style.left !== notchPct) e.notch.style.left = notchPct;
    e.notch.classList.toggle("pinned", p.overPromisedText !== null);
    setText(e.overflow, p.overPromisedText ?? p.overflowText ?? "");
    e.overflow.classList.toggle("over", p.overPromisedText !== null || p.overflowText !== null);

    // Rider lines.
    const riderSig = p.riders.map((r) => r.contractId).join(",");
    if (e.riders.getAttribute("data-sig") !== riderSig) {
      e.riders.setAttribute("data-sig", riderSig);
      e.riders.replaceChildren();
      e.riderEls.clear();
      for (const r of p.riders) {
        const row = el("div", "pipe-rider");
        row.setAttribute("data-net", "trace-rider");
        row.setAttribute("data-contract", r.contractId);
        row.setAttribute("data-pipe", p.pipe);
        row.addEventListener("click", () => this.actions.onSelectFlow(r.contractId));
        const label = el("span", "rider-label");
        const nums = el("span", "rider-nums");
        const flag = el("span", "rider-flag");
        row.append(label, nums, flag);
        e.riders.appendChild(row);
        e.riderEls.set(r.contractId, { root: row, label, nums, flag });
      }
    }
    // THE TARGET PICKER — every option states what it would do before you do it.
    setShown(e.picker, p.repointOpen);
    if (p.repointOpen) {
      const sig = p.repointOptions.map((o) => `${o.regionId}:${o.sees ? 1 : 0}:${o.current ? 1 : 0}`).join("|");
      if (e.picker.getAttribute("data-sig") !== sig) {
        e.picker.setAttribute("data-sig", sig);
        e.picker.replaceChildren();
        for (const o of p.repointOptions) {
          const b = btn(`net-btn pipe-pick${o.current ? " active" : ""}${o.sees ? "" : " blind"}`, () =>
            this.actions.onRepointPick(p.satId, p.slotIdx, o.regionId),
          );
          b.setAttribute("data-net", "repoint-pick");
          b.setAttribute("data-region", o.regionId);
          b.setAttribute("data-pipe", p.pipe);
          b.textContent = `${o.label} · ${o.note}`;
          e.picker.appendChild(b);
        }
      }
    }

    for (const r of p.riders) {
      const re = e.riderEls.get(r.contractId);
      if (re === undefined) continue;
      re.root.className = `pipe-rider hue-${r.hue}`;
      setText(re.label, `▸ ${r.label}`);
      setText(re.nums, `·${r.classTag}  ${TRACE_RIDER_NUMS(r.offerText, r.shareText, r.floorText)}`);
      setText(re.flag, riderFlagText(r.flag, r.ofFloor));
      re.flag.className = `rider-flag ${r.flag}`;
    }
  }

  // ── LOSSES + NODES ─────────────────────────────────────────────────────────────

  private renderLosses(s: TraceState): void {
    setShown(this.lossesGroup, s.losses.length > 0);
    const sig = s.losses.map((l) => `${l.key}:${l.countText}`).join("|");
    if (sig === this.lossSig) return;
    this.lossSig = sig;
    this.rebuilds++;
    this.lossesHost.replaceChildren();
    for (const l of s.losses) {
      const row = el("div", "roll-row");
      row.setAttribute("data-net", "trace-loss");
      row.setAttribute("data-link", l.key);
      // Hovering a loss draws the link that ISN'T there as a dashed ghost on the globe: absence,
      // made spatial. It is also the soil the post-M1 predictive a-ha grows in — the spacing here
      // is OBSERVED, and the game never predicts the next one.
      row.addEventListener("mouseenter", () => this.actions.onHoverLoss(l.key));
      row.addEventListener("mouseleave", () => this.actions.onHoverLoss(null));
      row.append(
        el("span", "roll-link", l.linkText),
        el("span", "roll-cause", l.causeText),
        el("span", "roll-count", l.countText),
        el("span", "roll-times", l.timesText),
        el("span", "roll-gap", l.spacingText ?? ""),
      );
      this.lossesHost.appendChild(row);
    }
  }

  private renderNodes(s: TraceState): void {
    setShown(this.nodesGroup, s.nodes.length > 0);
    const sig = s.nodes.map((n) => `${n.satId}:${n.kindWord}:${n.detailText}`).join("|");
    if (sig === this.nodeSig) return;
    this.nodeSig = sig;
    this.rebuilds++;
    this.nodesHost.replaceChildren();
    for (const n of s.nodes) {
      const row = el("div", "trace-node");
      row.setAttribute("data-net", "trace-node");
      row.setAttribute("data-sat", n.satId);
      row.append(
        el("span", "node-glyph", n.glyph),
        el("span", "node-id", n.satId),
        el("span", "node-kind", `${n.kindWord} (${n.cause})`),
        el("span", "node-detail", n.detailText),
        el("span", "node-carrying", n.carryingText),
      );
      this.nodesHost.appendChild(row);
    }
  }

  status(): "ok" | "warn" | "crit" | "idle" {
    return this.lamp;
  }

  subtitle(): string {
    return this.sub;
  }
}

// ── shared little readouts ────────────────────────────────────────────────────────

function axisCaps(tag: SlaAxisTag): string {
  switch (tag) {
    case "lat":
      return "LATENCY";
    case "bw":
      return "BW";
    case "avail":
      return "AVAIL";
    case "conn":
      return "CONN";
  }
}

function stateWord(state: PipeState): string {
  switch (state) {
    case "headroom":
      return "HEADROOM";
    case "tight":
      return "TIGHT";
    case "over":
      return "OVER";
    case "idle":
      return "IDLE";
    case "blind":
      return "BLIND";
  }
}

/** The rider flag, with BOTH of its operands already on the line above it: the word restates what
 * the two numbers say, so the read survives with colour off. */
function riderFlagText(flag: RiderFlag, ofFloor: string | null): string {
  switch (flag) {
    case "starved":
      return `✕ STARVED ${ofFloor ?? ""}`.trim();
    case "tight":
      return `△ TIGHT ${ofFloor ?? ""}`.trim();
    case "ok":
      return `✓ ${ofFloor ?? ""}`.trim();
    case "none":
      return "·";
  }
}

/** Re-exported so main.ts's projection and the tests share one source for the bleed line. */
export { TRACE_BLEEDS, TRACE_DARK_FOR, TRACE_OVERFLOW, TRACE_OVERPROMISED };
