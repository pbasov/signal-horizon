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
 *   - REVENUE / OPEX — a credit prints "+€…" (green, leading +), a charge "−€…"
 *     (red, leading −): the +/− glyph IS the channel, colour merely reinforces it.
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
import { DT } from "../sim/clock";
import { fmtDuration, fmtEuro, fmtEuroSigned } from "../format";

/** Below this many sim-seconds of runway, the runway reads AMBER (cash is short). */
const RUNWAY_WARN_SECONDS = 30 * 60; // 30 sim-minutes

export class Finance implements PanelHandle {
  readonly title = "NETWORK·FINANCE";
  readonly content: HTMLElement;

  // --- WALLET ---
  private vBalance: HTMLElement;
  private vRunway: HTMLElement;

  // --- FLOW (money in vs money out) ---
  private vRevenue: HTMLElement;
  private vOpex: HTMLElement;

  // --- VALUE ---
  private vPremium: HTMLElement;
  private vAsOf: HTMLElement;

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

    // GROUP: FLOW — money in (per-serve payout) vs money out (cache opex burn).
    const flow = group("FLOW · PER TICK");
    this.vRevenue = valueOf(row(flow, "REVENUE", "green"));
    this.vOpex = valueOf(row(flow, "OPEX", "red"));

    // GROUP: VALUE — the derived worth of freshness + the served data's age.
    const value = group("VALUE · MARS_IMAGERY");
    this.vPremium = valueOf(row(value, "FRESHNESS PREMIUM", "cyan"));
    this.vAsOf = valueOf(row(value, "AS-OF"));

    this.content.append(wallet, flow, value);
  }

  update(state: FrameState): void {
    const d = state.demand;
    this.bankrupt = d.bankrupt;
    this.runwaySeconds = d.runway * DT; // runway is in TICKS; DT sim-seconds each.

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

    // --- REVENUE — the per-serve payout this step. A credit reads "+€…" (green),
    // a penalty (blackout_miss) "−€…" (red); a 0-payout miss is a neutral "€0".
    // The leading +/− glyph is the colour-off channel.
    setText(this.vRevenue, fmtEuroSigned(d.lastPayout));
    setValueClass(this.vRevenue, d.lastPayout > 0 ? "green" : d.lastPayout < 0 ? "red" : "");

    // --- OPEX — the standing money-out burn (cache opex × coherence). Always a
    // charge, so always "−€…" red (the − glyph is redundant with the colour).
    setText(this.vOpex, fmtEuroSigned(-d.opexPerTick));
    setValueClass(this.vOpex, "red");

    // --- FRESHNESS PREMIUM — the DERIVED € gap (price(fresh) − price(min)). The
    // real number from the live demand's price curve, never a hardcoded string.
    setText(this.vPremium, fmtEuro(d.freshnessPremium));

    // --- AS-OF — the served data's age (the universal artifact). Only meaningful
    // on a cache serve; a miss/blackout has no served sample → "—".
    setText(
      this.vAsOf,
      d.servedAgeSeconds != null ? fmtDuration(d.servedAgeSeconds) : "—",
    );

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
    return "· MARS_IMAGERY";
  }
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
