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
    // MET = Mission Elapsed Time (since the scenario epoch t0) — not the raw J2000
    // sim-time, which boots at ~168 days. See scenario.ts / FrameState.
    this.vSim = valueOf(row(clock, "MET"));
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

    // GROUP: DEMAND — the live MULTI-FEED summary (E7). A compact roster digest:
    // how the 5 feeds are being served, the nearest fetch ETA, and the shared
    // cache occupancy + peak freshness. The per-feed detail lives on the orrery map.
    const demand = group("DEMAND · 5 FEEDS");
    this.vServe = valueOf(row(demand, "SERVE"));
    this.vWait = valueOf(row(demand, "NEXT ETA", "amber"));
    this.vCache = valueOf(row(demand, "CACHE"));

    this.content.append(clock, link, pkt, demand);
  }

  update(state: FrameState): void {
    this.occulted = state.losOcculted;

    // --- CLOCK --- (MISSION-ELAPSED, not the raw J2000 epoch offset — E10b: the
    // sim clock boots at the scenario epoch t0, so show time-since-start.)
    setText(this.vSim, fmtClock(state.missionElapsedSeconds));
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
   * Paint the MULTI-FEED summary (E7): a SERVE digest counting feeds by band
   * (served / fetching / blackout), the NEAREST in-flight fetch ETA, and the
   * shared cache occupancy + peak freshness. Tone follows the worst live state:
   * any blackout is red, any feed missing/fetching is amber, all-served is green.
   */
  private paintDemand(d: DemandReadout): void {
    let served = 0; // fresh or stale cache hits
    let fetching = 0; // a leg crawling for this feed
    let miss = 0; // missing with no leg (link down/just opened)
    let blackout = 0;
    let earliestEta: number | null = null;
    for (const f of d.feeds) {
      if (f.blackout) blackout++;
      else if (f.viaCache) served++;
      else if (f.fetchInFlight) fetching++;
      else miss++;
      if (f.fetchInFlight && f.fetchCountdownSeconds != null) {
        if (earliestEta == null || f.fetchCountdownSeconds < earliestEta) earliestEta = f.fetchCountdownSeconds;
      }
    }

    // SERVE digest — "Nh · Nf · Nb" (hits · fetching · blackout). Worst-state tone.
    const total = d.feeds.length;
    setText(this.vServe, `${served}/${total} hit · ${fetching} fetch · ${blackout} blk`);
    setValueClass(this.vServe, blackout > 0 ? "red" : served < total ? "amber" : "green");

    // NEXT ETA — the nearest in-flight fetch arrival across the roster.
    setText(this.vWait, earliestEta != null ? `${fmtDuration(earliestEta)} · ETA` : "—");

    // CACHE — occupancy + peak freshness of the held slots.
    const peak = d.peakCacheFreshness;
    setText(this.vCache, `${d.slotsUsed}/${d.slotCapacity} · ${fmtPct(peak)}`);
    setValueClass(this.vCache, peak >= 0.9 ? "green" : peak >= 0.5 ? "amber" : "red");

    void miss; // counted for completeness; folded into the amber "<total hit" cue.
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
