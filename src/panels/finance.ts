/**
 * FINANCE — the one excellent M1 view (GDD §5): the solvency loop made glanceable.
 *
 * This panel surfaces the economy E3 folds into FrameState — balance, runway,
 * the money-in/money-out flows, and the DERIVED value of keeping data fresh — so
 * the player can read "am I winning or burning?" at a glance.
 *
 * STYLING (DD-1 "monochrome machine, living signal"): the housing is 1-bit chrome
 * (the dashed group boxes, the dim labels — pure telemetry.ts pattern); only the
 * DATA carries colour, and every colour distinction has a REDUNDANT channel so it
 * reads colour-off (CVD-safe, GDD §8):
 *   - BALANCE — green solvent / red insolvent, redundant on the sign glyph (a
 *     negative balance prints "€-…", and a ✕ marker precedes a sub-zero balance).
 *   - RUNWAY — green ample / amber short / red bankrupt, redundant on the value
 *     itself (a duration shrinking toward "BANKRUPT" / "0s").
 *   - REVENUE / OPEX / NET — continuous RATES (€ per hour of SIM-time, not
 *     per-tick): a money-in rate prints "+€…/hr" (green, leading +), a money-out
 *     rate "−€…/hr" (red, leading −): the +/− glyph IS the channel, colour
 *     reinforces it. NET is the live earn/burn rate that drives RUNWAY.
 *   - FRESHNESS PREMIUM — cyan info value; the number itself is the signal.
 * The BANKRUPT banner appears only while balance < 0 (structural, like the status
 * strip's occult alarm) — a fourth, position-based redundant cue.
 *
 * The DOM is built ONCE in the constructor; update(state) only mutates text and
 * class names in place — no per-frame innerHTML rebuilds (telemetry.ts pattern).
 *
 * Pure DOM text: no f64→f32 crosses here (only src/orrery does that).
 */
import type { FrameState } from "../types";
import type { PanelHandle } from "../wm/shell";
import { fmtDuration, fmtEuro, fmtEuroSigned } from "../format";

/** Below this many sim-seconds of runway, the runway reads AMBER (cash is short). */
const RUNWAY_WARN_SECONDS = 30 * 60; // 30 sim-minutes

/** Sim-seconds per hour — the FLOW rates are shown per SIM-HOUR for readability. */
const SECONDS_PER_HOUR = 3600;

export class Finance implements PanelHandle {
  readonly title = "NETWORK·FINANCE";
  readonly content: HTMLElement;

  // --- WALLET ---
  private vBalance: HTMLElement;
  private vRunway: HTMLElement;

  // --- FLOW (money-in vs money-out RATES, € per sim-hour) ---
  private vRevenue: HTMLElement;
  private vOpex: HTMLElement;
  private vNet: HTMLElement;

  // --- VALUE ---
  private vPremium: HTMLElement;
  private vSlots: HTMLElement;

  // --- BANKRUPT banner (created/removed dynamically, like the occult alarm) ---
  private bankruptBanner: HTMLElement | null = null;

  /** Mirrors the last-seen bankrupt state for status(). */
  private bankrupt = false;
  /** Mirrors the last-seen runway (sim-seconds) for status(). */
  private runwaySeconds = Number.POSITIVE_INFINITY;

  constructor() {
    this.content = el("div", "telem"); // reuse the telemetry housing styles

    // GROUP: WALLET — where you stand and how long you last.
    const wallet = group("WALLET");
    this.vBalance = valueOf(row(wallet, "BALANCE", "green"));
    this.vRunway = valueOf(row(wallet, "RUNWAY", "green"));

    // GROUP: FLOW — continuous RATES (€ per sim-hour): revenue in, opex out, and
    // the NET earn/burn that drives the runway. Rates, never per-tick.
    const flow = group("FLOW · €/HR (SIM)");
    this.vRevenue = valueOf(row(flow, "REVENUE", "green"));
    this.vOpex = valueOf(row(flow, "OPEX", "red"));
    this.vNet = valueOf(row(flow, "NET", "green"));

    // GROUP: VALUE — the derived worth of freshness across the roster + the cache
    // contention (occupied / total slots, the E7 strain readout).
    const value = group("VALUE · ALL FEEDS");
    this.vPremium = valueOf(row(value, "FRESHNESS PREMIUM", "cyan"));
    this.vSlots = valueOf(row(value, "CACHE SLOTS"));

    this.content.append(wallet, flow, value);
  }

  update(state: FrameState): void {
    const d = state.demand;
    this.bankrupt = d.bankrupt;
    this.runwaySeconds = d.runway; // runway is already in SIM-SECONDS (rate model).

    // --- BALANCE — solvent green / insolvent red, redundant on the sign glyph.
    // A sub-zero balance prints a leading ✕ AND "€-…" so the loss reads colour-off.
    const insolvent = d.balance < 0;
    setText(this.vBalance, insolvent ? `✕ ${fmtEuro(d.balance)}` : fmtEuro(d.balance));
    setValueClass(this.vBalance, insolvent ? "red" : "green");

    // --- RUNWAY — time to bankruptcy at the standing burn (fmtDuration), with
    // "∞" when not burning and "—" once bankrupt. Green ample / amber short / red
    // bankrupt; the value itself (shrinking duration → BANKRUPT) is the redundant
    // channel.
    if (this.bankrupt) {
      setText(this.vRunway, "BANKRUPT");
      setValueClass(this.vRunway, "red");
    } else if (!Number.isFinite(this.runwaySeconds)) {
      setText(this.vRunway, "∞"); // not burning (or net-earning)
      setValueClass(this.vRunway, "green");
    } else {
      setText(this.vRunway, fmtDuration(this.runwaySeconds));
      setValueClass(this.vRunway, this.runwaySeconds < RUNWAY_WARN_SECONDS ? "amber" : "green");
    }

    // --- REVENUE — the money-IN RATE (€ per sim-hour) for the current band. A
    // serving rate reads "+€…/hr" (green); a blackout's SLA-penalty rate reads
    // "−€…/hr" (red); a 0-income miss is a neutral "€0/hr". Leading +/− is the
    // colour-off channel.
    const revPerHr = d.revenueRatePerSecond * SECONDS_PER_HOUR;
    setText(this.vRevenue, fmtRatePerHour(revPerHr));
    setValueClass(this.vRevenue, revPerHr > 0 ? "green" : revPerHr < 0 ? "red" : "");

    // --- OPEX — the standing money-OUT RATE (€ per sim-hour) to run the cache
    // (baseline × coherence). Always a charge, so always "−€…/hr" red (the −
    // glyph is redundant with the colour).
    const opexPerHr = d.opexRatePerSecond * SECONDS_PER_HOUR;
    setText(this.vOpex, fmtRatePerHour(-opexPerHr));
    setValueClass(this.vOpex, "red");

    // --- NET — the live earn/burn RATE (€ per sim-hour): revenue − opex. Green
    // "+€…/hr" when earning, red "−€…/hr" when burning; the +/− glyph is the
    // colour-off channel. This is the rate that drives RUNWAY.
    const netPerHr = d.netRatePerSecond * SECONDS_PER_HOUR;
    setText(this.vNet, fmtRatePerHour(netPerHr));
    setValueClass(this.vNet, netPerHr > 0 ? "green" : netPerHr < 0 ? "red" : "");

    // --- FRESHNESS PREMIUM — the DERIVED € gap (price(fresh) − price(min)) SUMMED
    // across the roster: the total € on the table if every feed were kept fresh
    // vs. bottom-of-band. Real numbers from each feed's price curve, never flavour.
    let premium = 0;
    for (const f of d.feeds) premium += f.freshnessPremium;
    setText(this.vPremium, fmtEuro(premium));

    // --- CACHE SLOTS — occupied / capacity, the E7 contention readout. Amber when
    // the cache is full (every slot is a held copy you are paying opex to keep).
    setText(this.vSlots, `${d.slotsUsed} / ${d.slotCapacity}`);
    setValueClass(this.vSlots, d.slotsUsed >= d.slotCapacity ? "amber" : "green");

    // --- BANKRUPT banner — structural, only present while balance < 0.
    if (this.bankrupt && !this.bankruptBanner) {
      this.bankruptBanner = el("div", "finance-bankrupt");
      this.bankruptBanner.textContent = "✕ BANKRUPT · NETWORK INSOLVENT";
      this.content.appendChild(this.bankruptBanner);
    } else if (!this.bankrupt && this.bankruptBanner) {
      this.bankruptBanner.remove();
      this.bankruptBanner = null;
    }
  }

  /** Titlebar lamp: crit while bankrupt, warn while runway is short, else ok. */
  status(): "ok" | "warn" | "crit" {
    if (this.bankrupt) return "crit";
    if (Number.isFinite(this.runwaySeconds) && this.runwaySeconds < RUNWAY_WARN_SECONDS) {
      return "warn";
    }
    return "ok";
  }

  subtitle(): string {
    return "· ALL FEEDS";
  }
}

/**
 * A signed € RATE per sim-hour: "+€18,000/hr", "−€7,200/hr", "€0/hr". Reuses the
 * signed-euro glyphs (the +/− is the colour-off channel) and appends the "/hr"
 * unit so a rate is never mistaken for a balance.
 */
function fmtRatePerHour(amountPerHour: number): string {
  return `${fmtEuroSigned(amountPerHour)}/hr`;
}

// --- tiny DOM helpers (kept local; no per-frame allocation in update) --------

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

/** Append a row to a group; returns the row so its value span can be grabbed. */
function row(parent: HTMLElement, label: string, valueClass = ""): HTMLElement {
  const r = el("div", "row");
  const lab = el("span", "label");
  lab.textContent = label;
  const v = el("span", valueClass ? `v ${valueClass}` : "v");
  r.append(lab, v);
  parent.appendChild(r);
  return r;
}

/** The value span is always the last child of a row built by row(). */
function valueOf(r: HTMLElement): HTMLElement {
  return r.lastElementChild as HTMLElement;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Swap the colour modifier on a `v` span without disturbing the base class. */
function setValueClass(node: HTMLElement, tone: string): void {
  const next = tone ? `v ${tone}` : "v";
  if (node.className !== next) node.className = next;
}
