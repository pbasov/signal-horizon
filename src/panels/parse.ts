/**
 * THE PARSE (GDD §5 view #9, the §4.12 legible record) — the reviewable-at-rest
 * post-run analysis panel.
 *
 * §4.12 specifies the record as the floor/ceiling hinge: the per-contract post-
 * mortem (the damage-meter line item), the aggregate, and the single headline
 * efficiency with the GAP to an achievable bound — "reviewable at rest, not only
 * glanceable in the heat of play." This panel is that reviewable-at-rest face; the
 * live SYSTEM.LOG (E9) is its in-play face. It renders a {@link RunParse} — the pure
 * summary {@link parseRun} folds out of the truthful event log — so what the panel
 * shows can never disagree with what the sim recorded.
 *
 * STYLING (DD-1 "monochrome machine, living signal", GDD §8): the housing is 1-bit
 * chrome (the dashed `group` boxes + dim `legend`/`label`, the telemetry/finance
 * pattern); only the DATA carries colour, every distinction redundant on a glyph or
 * the value itself so it reads colour-off (CVD-safe). Freshness/efficiency reuse the
 * SAME warmth ramp as log-format.ts (good/watch/warn/dead → green/cyan/amber/grey),
 * so a number means the same thing here as in the log and the orrery.
 *
 * Pure DOM text: no f64→f32 crosses here (only src/orrery does that). The panel
 * holds NO sim state — main.ts hands it a RunParse to render and a "no run yet"
 * placeholder before the first parse.
 */
import type { RunParse, FeedParse, BlackoutHandling } from "../sim/m1/parse";
import type { PanelHandle } from "../wm/shell";
import type { Warmth } from "./log-format";
import { warmthOf } from "./log-format";
import { fmtDuration, fmtEuro, fmtEuroSigned, fmtPct } from "../format";
import { feedLabel } from "../orrery/readout";

/** Warmth bucket for a fresh/efficiency FRACTION in [0,1] (reuses the §8 ramp). */
function fracWarmth(frac: number): Warmth {
  return warmthOf(frac);
}

/** A human label + warmth for the blackout-handling verdict (colour-off legible). */
function blackoutVerdict(h: BlackoutHandling): { text: string; warmth: Warmth } {
  switch (h) {
    case "served_through":
      return { text: "SERVED THROUGH (pre-staged)", warmth: "good" };
    case "partial":
      return { text: "PARTIAL — some went dark", warmth: "warn" };
    case "went_dark":
      return { text: "WENT DARK — no pre-stage", warmth: "dead" };
    case "none":
      return { text: "no blackout this run", warmth: "watch" };
  }
}

export class ParsePanel implements PanelHandle {
  readonly title = "THE PARSE";
  readonly content: HTMLElement;

  /** The mounted record (rebuilt on each render); null shows the placeholder. */
  private body: HTMLElement;
  /** Mirrors the last-rendered headline efficiency for status(). */
  private efficiency = 1;
  private hasRun = false;

  constructor() {
    this.content = el("div", "telem parse");
    this.body = el("div", "parse-body");
    this.content.appendChild(this.body);
    this.renderPlaceholder();
  }

  /** Before the first run summary exists: a calm "the parse appears at rest" note. */
  private renderPlaceholder(): void {
    this.body.replaceChildren();
    const g = group("POST-RUN PARSE");
    const note = el("div", "parse-note");
    note.textContent =
      "The legible record. Run the network, then review here — per-feed post-mortem, " +
      "fresh-time vs the achievable estimate, and the one number to grind down. " +
      "Reviewable at rest (§4.12).";
    g.appendChild(note);
    this.body.appendChild(g);
  }

  /**
   * Render a {@link RunParse} into the reviewable record. Rebuilds the body in one
   * pass (this fires on a key toggle / preset switch, not per-frame, so a full
   * rebuild is fine and keeps the DOM honestly in sync with the parse).
   */
  render(parse: RunParse): void {
    this.hasRun = true;
    this.efficiency = parse.metrics.efficiency;
    this.body.replaceChildren();

    this.body.appendChild(this.headlineGroup(parse));
    this.body.appendChild(this.aggregateGroup(parse));
    this.body.appendChild(this.feedsGroup(parse));
  }

  /** THE HEADLINE: the one efficiency number + the gap to the heuristic bound. */
  private headlineGroup(parse: RunParse): HTMLElement {
    const m = parse.metrics;
    const g = group(`HEADLINE · ${fmtDuration(parse.durationSeconds)} RUN`);

    // EFFICIENCY — actual fresh-time / the achievable estimate, the number to grind.
    const effRow = row(g, "EFFICIENCY");
    const effPct = Math.round(m.efficiency * 100);
    setVal(effRow, `${effPct}%`, fracWarmth(m.efficiency));

    // FRESH-TIME vs the achievable estimate + the GAP (the optimisation hook).
    const freshRow = row(g, "FRESH-TIME");
    setVal(freshRow, fmtPct(m.freshFraction), fracWarmth(m.freshFraction));

    const achRow = row(g, parse.achievableLabel.toUpperCase());
    setVal(achRow, fmtPct(m.achievableFreshFraction), "watch");

    const gapRow = row(g, "GAP TO CLOSE");
    // The gap is the "do it better" hook: warmer (worse) the bigger it is.
    const gapWarmth: Warmth = m.freshGap <= 0.02 ? "good" : m.freshGap <= 0.1 ? "watch" : "warn";
    setVal(gapRow, `${fmtPct(m.freshGap)} fresh-time on the table`, gapWarmth);

    // The honest rationale for the bound — it is an ESTIMATE, not a proven optimum.
    const why = el("div", "parse-note");
    why.textContent = parse.achievableRationale;
    g.appendChild(why);
    return g;
  }

  /** AGGREGATE: served/missed split, prefetch timely vs wasted, blackout, net €. */
  private aggregateGroup(parse: RunParse): HTMLElement {
    const m = parse.metrics;
    const g = group("AGGREGATE · ALL FEEDS");

    // The four-band split as a single dense line (fresh/stale/miss/blackout).
    const split = row(g, "SERVE SPLIT");
    const splitText =
      `F ${fmtPct(m.freshFraction)}  S ${fmtPct(m.staleFraction)}  ` +
      `M ${fmtPct(m.missFraction)}  B ${fmtPct(m.blackoutFraction)}`;
    setVal(split, splitText, fracWarmth(m.freshFraction));

    // PREFETCH timely vs wasted + the € spent on legs that never paid off.
    const pf = row(g, "PREFETCH");
    const pfWarmth: Warmth = m.prefetchesWasted === 0 ? "good" : m.prefetchesWasted <= 2 ? "watch" : "warn";
    setVal(
      pf,
      `${m.prefetchesTimely} timely · ${m.prefetchesWasted} wasted (${fmtEuro(m.wastedPrefetchEur)})`,
      pfWarmth,
    );

    // BLACKOUT handling — the marquee §4.4 beat (served-through / went-dark).
    const bo = row(g, "BLACKOUT");
    const v = blackoutVerdict(m.blackoutHandling);
    setVal(bo, v.text, v.warmth);

    // CONTENTION — total fetches / prefetches / evictions across the run.
    const cont = row(g, "FETCHES · EVICTIONS");
    setVal(cont, `${parse.fetchesLaunched} legs · ${parse.evictions} evicted`, "watch");

    // NET € over the run + the final balance.
    const net = row(g, "NET €");
    const netRow = el("span", m.netEur >= 0 ? "v green" : "v red");
    netRow.textContent = `${fmtEuroSigned(m.netEur)}  (bal ${fmtEuro(m.finalBalance)})`;
    net.replaceChild(netRow, net.lastElementChild!);
    return g;
  }

  /** PER-FEED (per-contract) post-mortems — the §4.12 damage-meter line items. */
  private feedsGroup(parse: RunParse): HTMLElement {
    const g = group("PER-CONTRACT POST-MORTEM");
    for (const f of parse.feeds) g.appendChild(this.feedLine(f));
    return g;
  }

  /** One feed's line: label, the band split, fetches/evictions, and the called-out miss. */
  private feedLine(f: FeedParse): HTMLElement {
    const wrap = el("div", "parse-feed");

    const head = el("div", "parse-feed-head");
    const name = el("span", "ent");
    name.textContent = feedLabel(f.id);
    const fresh = el("span", `val ${fracWarmth(f.freshFraction)}`);
    fresh.textContent = `${fmtPct(f.freshFraction)} fresh`;
    const counts = el("span", "msg");
    const evTxt = f.evicted > 0 ? ` · ${f.evicted} evict` : "";
    const pfTxt = f.prefetchesLaunched > 0 ? ` · ${f.prefetchesLaunched} prefetch` : "";
    counts.textContent = `${f.fetchesLaunched} legs${pfTxt}${evTxt}`;
    head.append(name, fresh, counts);

    // The specific miss called out (the §4.12 prose) — warmth from the verdict.
    const note = el("div", "parse-feed-note");
    const noteWarmth: Warmth = f.blackedOut && !f.servedThroughBlackout ? "dead" : f.servedThroughBlackout ? "good" : f.freshFraction >= 0.5 ? "good" : "warn";
    note.classList.add(noteWarmth);
    note.textContent = f.note;

    wrap.append(head, note);
    return wrap;
  }

  /** Titlebar lamp: ok when at/near the estimate, warn on a sizeable gap, neutral before any run. */
  status(): "ok" | "warn" | "crit" {
    if (!this.hasRun) return "ok";
    return this.efficiency >= 0.85 ? "ok" : "warn";
  }

  subtitle(): string {
    return this.hasRun ? `· EFF ${Math.round(this.efficiency * 100)}%` : "· AT REST";
  }
}

// --- tiny DOM helpers (the finance.ts/telemetry.ts pattern) -----------------

function el(tag: string, className: string, text?: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function group(name: string): HTMLElement {
  const g = el("div", "group");
  const legend = el("div", "legend");
  legend.textContent = name;
  g.appendChild(legend);
  return g;
}

/** Append a label/value row to a group; returns the row so its value span can be set. */
function row(parent: HTMLElement, label: string): HTMLElement {
  const r = el("div", "row");
  const lab = el("span", "label");
  lab.textContent = label;
  const v = el("span", "v");
  r.append(lab, v);
  parent.appendChild(r);
  return r;
}

/** Set a row's value text + a freshness-warmth modifier on the `v` span. */
function setVal(r: HTMLElement, text: string, warmth: Warmth): void {
  const v = r.lastElementChild as HTMLElement;
  v.className = `v ${warmth}`;
  v.textContent = text;
}

/**
 * R3 (SD-51 follow-on) — THE NET-MODE PARSE. The REVIEW desktop in net mode shows the
 * connectivity run-at-rest: legible, honest, DERIVED ENTIRELY from the folded NetSession
 * snapshot (no new sim state, no event log — replay-identical by construction; §4.12's
 * "the parse is truthful because it reads the truth layer" holds without a fold change).
 */
export interface NetReviewContract {
  id: string;
  label: string;
  state: string;
  payPerSecond: number;
  earnedEur: number;
  servedSeconds: number;
  earnedTotalHr: number;
}

export interface NetReview {
  /** Wallet trajectory anchors. */
  openingEur: number;
  balanceEur: number;
  /** Sim-time the run has covered + the current act (cursor) + gate stamps (sim-seconds). */
  tSim: number;
  act: number;
  gateTSim: number[];
  /** The per-contract account book. */
  contracts: NetReviewContract[];
  /** Fleet totals. */
  satCount: number;
  /** Witness flags: what the run demonstrably SHOWED. */
  escalated: boolean;
  reTamed: boolean;
  faultsWeathered: number;
  overBuiltSats: number;
  reachedMars: boolean;
}

export function renderNetReview(panel: ParsePanel, v: NetReview): void {
  (panel as unknown as { hasRun: boolean }).hasRun = true;
  const body = (panel as unknown as { body: HTMLElement }).body;
  body.replaceChildren();

  // THE HEADLINE: the wallet story in one line (opening → now) + how much the hour showed.
  const hg = group("THE RUN AT REST");
  const delta = v.balanceEur - v.openingEur;
  const head = el("div", "parse-note");
  head.textContent =
    `Wallet €${v.openingEur.toLocaleString("en-US")} → €${Math.round(v.balanceEur).toLocaleString("en-US")}` +
    ` (${delta >= 0 ? "+" : "−"}€${Math.abs(Math.round(delta)).toLocaleString("en-US")}) · ` +
    `${v.satCount} sats · ${Math.floor(v.tSim / 60)}m sim`;
  hg.appendChild(head);
  body.appendChild(hg);

  // THE ACT BOOK: every beat with its gate stamp (still-open beats read as in-progress).
  const ag = group("THE ACTS");
  const ACTS = ["First light", "Hold a region that moves", "Your own success congests it", "It breaks. Does your network?", "The frontier"];
  ACTS.forEach((title, i) => {
    const line = el("div", "row");
    const gated = v.gateTSim[i] !== undefined;
    const lab = el("span", "label", `act ${i + 1} · ${title}`);
    const val = el("span", "v" + (gated ? " green" : i <= v.act ? " cyan" : ""));
    val.textContent = gated ? `gated ${Math.floor(v.gateTSim[i] / 60)}:${String(Math.floor(v.gateTSim[i] % 60)).padStart(2, "0")}` : i <= v.act ? "live" : "—";
    line.append(lab, val);
    ag.appendChild(line);
  });
  body.appendChild(ag);

  // THE ACCOUNT BOOK: per-contract pay / earned / time-on-air.
  const cg = group("THE ACCOUNT BOOK");
  if (v.contracts.length === 0) cg.appendChild(el("div", "parse-note", "No tenders seen yet."));
  for (const c of v.contracts) {
    const line = el("div", "row");
    const lab = el("span", "label", `${c.id} · ${c.state}`);
    const val = el("span", "v" + (c.earnedEur >= 0 ? " green" : " red"));
    val.textContent = `€${Math.round(c.earnedEur).toLocaleString("en-US")} · €${c.payPerSecond.toFixed(1)}/s · ${Math.round(c.servedSeconds)}s on-air`;
    line.append(lab, val);
    line.title = c.label;
    cg.appendChild(line);
  }
  body.appendChild(cg);

  // WHAT THE RUN SHOWED — the witnessed concepts (the acts are state, this is the record).
  const wg = group("WHAT THE RUN SHOWED");
  const witness = (text: string, on: boolean | number) => {
    const line = el("div", "row");
    const lab = el("span", "label", text);
    const val = el("span", "v" + (on ? " green" : ""));
    val.textContent = typeof on === "number" ? (on > 0 ? `×${on}` : "—") : on ? "yes" : "—";
    line.append(lab, val);
    wg.appendChild(line);
  };
  witness("Demand grew where you served (escalation)", v.escalated);
  witness("You re-engineered under strain (re-tame)", v.reTamed);
  witness("Faults weathered, service held", v.faultsWeathered);
  witness("Sats built past the measured need (idle capex)", v.overBuiltSats);
  witness("Reached the frontier (the Mars relay is out there)", v.reachedMars);
  body.appendChild(wg);
}
