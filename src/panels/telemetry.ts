/**
 * TELEMETRY — live instrument readout panel.
 *
 * A dense, single-line-per-row NOC telemetry block: cyan timestamps/scale,
 * amber light-delay values, severity-coloured LOS, and a 16-segment dithered
 * freshness gauge that drains warn→crit as the packet ages.
 *
 * M1-05 adds a DEMAND group — the live standing-request readout: the current
 * resolve outcome (FRESH/STALE/MISS·fetching NNs/BLACKOUT), the in-flight fetch
 * countdown, and the Mars cache freshness %. This is the cache-miss→fetch→
 * arrive→hit loop made legible in text (the crawling packet is the same wait in
 * the orrery); the full glanceable map is E5.
 *
 * The DOM is built ONCE in the constructor; update(state) only mutates text
 * and class names in place — no per-frame innerHTML rebuilds.
 */
import type { FrameState } from "../types";
import type { PanelHandle } from "../wm/shell";
import {
  fmtClock,
  fmtDistance,
  fmtDuration,
  fmtLightSeconds,
  fmtPct,
} from "../format";
import type { DemandReadout } from "../types";

const GAUGE_SEGS = 16;

export class Telemetry implements PanelHandle {
  readonly title = "TELEMETRY";
  readonly content: HTMLElement;

  // --- CLOCK ---
  private vSim: HTMLElement;
  private vScale: HTMLElement;

  // --- EARTH→MARS ---
  private vDistance: HTMLElement;
  private vOneWay: HTMLElement;
  private vLos: HTMLElement;

  // --- PACKET ---
  private vId: HTMLElement;
  private vProgress: HTMLElement;
  private vFreshness: HTMLElement;
  private segs: HTMLElement[] = [];

  // --- DEMAND (M1-05 standing-request loop) ---
  private vServe: HTMLElement;
  private vWait: HTMLElement;
  private vCache: HTMLElement;

  /** mirrors the last-seen occultation state for status(). */
  private occulted = false;

  constructor() {
    this.content = el("div", "telem");

    // GROUP: CLOCK
    const clock = group("CLOCK");
    this.vSim = valueOf(row(clock, "SIM"));
    this.vScale = valueOf(row(clock, "SCALE", "cyan"));

    // GROUP: EARTH→MARS
    const link = group("EARTH→MARS");
    this.vDistance = valueOf(row(link, "DISTANCE"));
    this.vOneWay = valueOf(row(link, "ONE-WAY", "amber"));
    this.vLos = valueOf(row(link, "LOS"));

    // GROUP: PACKET
    const pkt = group("PACKET");
    this.vId = valueOf(row(pkt, "ID"));
    this.vProgress = valueOf(row(pkt, "PROGRESS"));
    this.vFreshness = valueOf(row(pkt, "FRESHNESS"));

    const gauge = el("div", "gauge");
    for (let i = 0; i < GAUGE_SEGS; i++) {
      const seg = el("span", "seg");
      this.segs.push(seg);
      gauge.appendChild(seg);
    }
    pkt.appendChild(gauge);

    // GROUP: DEMAND — the live standing-request loop (mars_imagery).
    const demand = group("DEMAND · MARS_IMAGERY");
    this.vServe = valueOf(row(demand, "SERVE"));
    this.vWait = valueOf(row(demand, "WAIT", "amber"));
    this.vCache = valueOf(row(demand, "CACHE"));

    this.content.append(clock, link, pkt, demand);
  }

  update(state: FrameState): void {
    this.occulted = state.losOcculted;

    // --- CLOCK ---
    setText(this.vSim, fmtClock(state.simSeconds));
    setText(this.vScale, state.scaleLabel);

    // --- EARTH→MARS ---
    setText(this.vDistance, fmtDistance(state.earthMarsDistanceM));
    setText(
      this.vOneWay,
      `${fmtDuration(state.oneWaySeconds)} · ${fmtLightSeconds(state.oneWaySeconds)}`,
    );
    if (state.losOcculted) {
      setText(this.vLos, "OCCULT");
      setValueClass(this.vLos, "red");
    } else {
      setText(this.vLos, `${state.losMarginSolarRadii.toFixed(1)} Rsun`);
      setValueClass(this.vLos, "green");
    }

    // --- PACKET ---
    const p = state.packet;
    if (p) {
      setText(this.vId, `PKT-${String(p.id).padStart(4, "0")}`);
      setText(this.vProgress, fmtPct(p.progress));
      setText(this.vFreshness, fmtPct(p.freshness));
      this.paintGauge(p.freshness);
    } else {
      setText(this.vId, "—");
      setText(this.vProgress, "—");
      setText(this.vFreshness, "—");
      this.paintGauge(0);
    }

    // --- DEMAND ---
    this.paintDemand(state.demand);
  }

  /**
   * Paint the standing-demand readout: the SERVE outcome (coloured signal), the
   * fetch WAIT countdown (amber while crawling, "—" when idle), and the Mars
   * CACHE freshness % (green fresh / amber stale / red unusable).
   */
  private paintDemand(d: DemandReadout): void {
    // SERVE outcome — coloured per the styling split (green hit / amber wait /
    // red blackout). MISS shows the live countdown so the wait reads as gameplay.
    if (d.blackout) {
      setText(this.vServe, "BLACKOUT");
      setValueClass(this.vServe, "red");
    } else if (d.outcome === "fresh") {
      setText(this.vServe, d.viaCache ? "FRESH · cache" : "FRESH");
      setValueClass(this.vServe, "green");
    } else if (d.outcome === "stale") {
      setText(this.vServe, "STALE · cache");
      setValueClass(this.vServe, "amber");
    } else {
      // miss — fetching across the gap
      const c = d.fetchCountdownSeconds;
      setText(this.vServe, c != null ? `MISS · fetching ${fmtDuration(c)}` : "MISS · fetching");
      setValueClass(this.vServe, "amber");
    }

    // WAIT — the in-flight fetch ETA, the same number the crawling packet shows.
    if (d.fetchInFlight && d.fetchCountdownSeconds != null) {
      setText(this.vWait, `${fmtDuration(d.fetchCountdownSeconds)} · ETA`);
    } else {
      setText(this.vWait, "—");
    }

    // CACHE — Mars-relay freshness of the held copy.
    setText(this.vCache, fmtPct(d.cacheFreshness));
    setValueClass(
      this.vCache,
      d.cacheFreshness >= 0.9 ? "green" : d.cacheFreshness >= 0.5 ? "amber" : "red",
    );
  }

  status(): "ok" | "crit" {
    return this.occulted ? "crit" : "ok";
  }

  subtitle(): string {
    return "· EARTH→MARS";
  }

  private paintGauge(freshness: number): void {
    const filled = Math.ceil(freshness * GAUGE_SEGS);
    // Pick the "on" tone from the same freshness fraction: cyan healthy,
    // amber when waning, red when nearly stale.
    const tone =
      freshness < 0.17 ? "seg crit" : freshness < 0.34 ? "seg warn" : "seg on";
    for (let i = 0; i < GAUGE_SEGS; i++) {
      const cls = i < filled ? tone : "seg";
      if (this.segs[i].className !== cls) this.segs[i].className = cls;
    }
  }
}

// --- tiny DOM helpers (kept local; no per-frame allocation in update) -------

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
  const next = `v ${tone}`;
  if (node.className !== next) node.className = next;
}
