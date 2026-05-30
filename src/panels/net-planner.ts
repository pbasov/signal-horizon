/**
 * NET · LAUNCH PLANNER (design §2.3 the consequence-preview planner, §5 the Act-1 slice,
 * §6 the make-or-break viz). The clickable face of the Act-1 loop: the offered REGION-0
 * contract + its state, the two presets (GEO PARK default + LEO SWEEP), the TRUTHFUL
 * consequence preview from {@link import("../sim/net/world").previewLaunch} (footprint
 * covered %, period, latency floor, cost), and the LAUNCH + ACCEPT buttons that append the
 * net_launch / net_accept actions main.ts applies via applyNetAction.
 *
 * This panel holds NO sim state — main.ts hands it a per-frame {@link NetPlannerRenderState}
 * projected from the live NetSession + the pure previewLaunch, and the panel paints it. The
 * buttons fire main.ts callbacks (the launch/accept appliers); the panel never touches the
 * sim directly. Same PanelHandle shape + 1-bit chrome as contracts.ts / finance.ts.
 *
 * STABLE SELECTORS (a headless click test finds the controls by these data-* attributes):
 *   - the LAUNCH button:        [data-net="launch"]
 *   - the ACCEPT button:        [data-net="accept"]
 *   - the CONSTELLATION button: [data-net="constellation"]  (Act-2 phasing assist + batch launch)
 *   - a preset button:          [data-net="preset"][data-preset-id="GEO_PARK"|"LEO_SWEEP"]
 * The selected preset button additionally carries the `.active` class.
 */
import type { PanelHandle } from "../wm/shell";
import { fmtDuration, fmtEuro, fmtPct } from "../format";

/** One preset choice the planner exposes (GEO PARK / LEO SWEEP). */
export interface NetPresetChoice {
  id: string;
  label: string;
  selected: boolean;
}

/** The Act-1 contract readout (the one offered REGION-0 demand). */
export interface NetContractReadout {
  id: string;
  label: string;
  /** OFFERED → ACTIVE (accepted) → SERVED/UNSERVED while active. */
  state: "offered" | "active" | "completed" | "failed";
  /** Whether a path region→sat→groundNet exists this instant (the lit/dim region). */
  served: boolean;
  /** € the contract has earned so far (the wallet-rising proof). */
  earnedEur: number;
}

/** The truthful consequence preview of the SELECTED preset draft at the current tick. */
export interface NetPreviewReadout {
  /** Fraction of the region disc the footprint would cover (1.0 = whole disc, the win). */
  coveredFraction: number;
  /** Orbital period (s) — GEO parks (== the day); LEO sweeps + sets. */
  periodS: number;
  /** Realized one-way latency floor (s); Infinity when the draft would not serve. */
  latencyFloorS: number;
  /** € the launch would charge. */
  costEur: number;
  /** Would the committed sat serve REGION-0 this instant (the preview verdict)? */
  served: boolean;
}

/**
 * Act-2 — THE PHASING ASSIST readout (design §3.3 / §6): the planner ASSISTS by surfacing the
 * EMPIRICALLY measured continuous-coverage minimum (`zeroGapN`) + a VIABLE-BUT-IMPERFECT
 * suggested set (`count` evenly-phased sats), with the truthful held-fraction preview. Shown
 * only on Act 2 (an availability axis live). Accepting fires ONE batch launch (the §3.4 batch).
 */
export interface NetPhasingReadout {
  /** The suggested constellation size (zeroGapN − shortfall, clamped ≥ 2 — the closable gap). */
  count: number;
  /** The MEASURED continuous-coverage minimum N (the trace pin — "you need ≈ N"). */
  zeroGapN: number;
  /** The suggested set's truthful held-fraction preview (below the bar — the closable gap). */
  estCoveredFraction: number;
  /** The SLA bar the constellation must hold (so the preview reads "X% vs bar Y%"). */
  slaAvail: number;
}

/** Everything the planner panel paints — projected per-frame from the live NetSession. */
export interface NetPlannerRenderState {
  /** On-hand € (the wallet that visibly ticks as a served contract pays). */
  balanceEur: number;
  /** The offered Act-1 contract (null before the scenario emits it). */
  contract: NetContractReadout | null;
  /** The preset buttons + which is selected. */
  presets: NetPresetChoice[];
  /** The consequence preview of the selected preset. */
  preview: NetPreviewReadout;
  /** Whether a sat has already been launched (LAUNCH stays enabled for re-launch, but the
   * face reads differently once the constellation exists). */
  launched: boolean;
  /** The gentle shortfall assist message, when the player is stuck (else null). */
  shortfall: string | null;
  /** Act-2 — the phasing assist (null in Act 1 / before an availability demand is live). When
   * present, the CONSTELLATION button is shown ("~N evenly-phased sats — place the set?"). */
  phasing: NetPhasingReadout | null;
}

/** The button callbacks main.ts wires (the launch/accept appliers + preset cursor). */
export interface NetPlannerActions {
  onSelectPreset(presetId: string): void;
  onLaunch(): void;
  onAccept(): void;
  /** Act-2 — fire ONE batch launch of the suggested phased constellation (the §3.4 batch). */
  onConstellation(): void;
}

export class NetPlanner implements PanelHandle {
  readonly title = "NET·LAUNCH";
  readonly content: HTMLElement;

  // --- WALLET + CONTRACT ---
  private vBalance: HTMLElement;
  private vContractState: HTMLElement;
  private vEarned: HTMLElement;

  // --- PRESET buttons (built once) ---
  private presetHost: HTMLElement;
  private presetButtons = new Map<string, HTMLButtonElement>();

  // --- PREVIEW (consequence-before-commit) ---
  private vCovered: HTMLElement;
  private vPeriod: HTMLElement;
  private vLatency: HTMLElement;
  private vCost: HTMLElement;

  // --- LAUNCH + ACCEPT + CONSTELLATION (Act-2 phasing assist) ---
  private launchBtn: HTMLButtonElement;
  private acceptBtn: HTMLButtonElement;
  private constellationBtn: HTMLButtonElement;
  private hint: HTMLElement;
  /** Act-2 — the phasing assist group (shown only when a phasing suggestion is present). */
  private phasingGroup: HTMLElement;
  private vZeroGap: HTMLElement;
  private vSuggest: HTMLElement;
  private vHeld: HTMLElement;

  private worst: "ok" | "warn" | "crit" = "warn";
  private servedNow = false;

  constructor(private actions: NetPlannerActions) {
    this.content = el("div", "telem");

    // GROUP: NETWORK — the wallet (CLIMBS as the served contract pays) + the one demand.
    const net = group("NETWORK · ACT 1");
    this.vBalance = valueOf(row(net, "WALLET", "green"));
    this.vContractState = valueOf(row(net, "REGION-0"));
    this.vEarned = valueOf(row(net, "EARNED", "cyan"));
    this.content.append(net);

    // GROUP: PRESET — the floor (GEO PARK default that already works) + LEO SWEEP. Buttons.
    const presetGroup = group("PRESET");
    this.presetHost = el("div", "net-presets");
    presetGroup.append(this.presetHost);
    this.content.append(presetGroup);

    // GROUP: PREVIEW — the truthful consequence of the SELECTED preset before commit.
    const preview = group("PREVIEW · BEFORE COMMIT");
    this.vCovered = valueOf(row(preview, "FOOTPRINT", "green"));
    this.vPeriod = valueOf(row(preview, "PERIOD"));
    this.vLatency = valueOf(row(preview, "LATENCY"));
    this.vCost = valueOf(row(preview, "COST", "amber"));
    this.content.append(preview);

    // GROUP: CONSTELLATION — the Act-2 phasing assist (design §3.3): the measured zero-gap N,
    // the viable-but-imperfect suggested set + its held-fraction, and a one-press batch launch.
    // Hidden in Act 1 (no availability demand); shown the moment REGION-1 needs continuous cover.
    this.phasingGroup = group("CONSTELLATION · ACT 2");
    this.vZeroGap = valueOf(row(this.phasingGroup, "NEED", "cyan"));
    this.vSuggest = valueOf(row(this.phasingGroup, "SUGGEST", "green"));
    this.vHeld = valueOf(row(this.phasingGroup, "HELD", "amber"));
    const phaseRow = el("div", "net-buttons");
    this.constellationBtn = button("PLACE SET", "constellation");
    this.constellationBtn.addEventListener("click", () => this.actions.onConstellation());
    phaseRow.append(this.constellationBtn);
    this.phasingGroup.append(phaseRow);
    this.phasingGroup.style.display = "none";
    this.content.append(this.phasingGroup);

    // GROUP: COMMIT — LAUNCH the selected preset, then ACCEPT the contract (close the loop).
    const commit = group("COMMIT");
    const btnRow = el("div", "net-buttons");
    this.launchBtn = button("LAUNCH", "launch");
    this.launchBtn.addEventListener("click", () => this.actions.onLaunch());
    this.acceptBtn = button("ACCEPT", "accept");
    this.acceptBtn.addEventListener("click", () => this.actions.onAccept());
    btnRow.append(this.launchBtn, this.acceptBtn);
    commit.append(btnRow);
    this.hint = el("div", "net-hint");
    commit.append(this.hint);
    this.content.append(commit);
  }

  render(state: NetPlannerRenderState): void {
    // WALLET — the headline € that visibly ticks up while the contract is served.
    setText(this.vBalance, fmtEuro(state.balanceEur));
    setValueClass(this.vBalance, state.balanceEur < 0 ? "red" : "green");

    // REGION-0 STATE — the lit/dim single legible state change.
    const c = state.contract;
    this.servedNow = !!c && c.state === "active" && c.served;
    if (c === null) {
      setText(this.vContractState, "— awaiting demand");
      setValueClass(this.vContractState, "");
      this.worst = "warn";
    } else if (c.state === "offered") {
      setText(this.vContractState, "OFFERED · accept to earn");
      setValueClass(this.vContractState, "cyan");
      this.worst = "warn";
    } else if (c.state === "active") {
      setText(this.vContractState, this.servedNow ? "SERVED ✓" : "UNSERVED · launch over it");
      setValueClass(this.vContractState, this.servedNow ? "green" : "amber");
      this.worst = this.servedNow ? "ok" : "warn";
    } else {
      setText(this.vContractState, c.state === "completed" ? "✓ DONE" : "✕ ENDED");
      setValueClass(this.vContractState, c.state === "completed" ? "green" : "red");
      this.worst = "ok";
    }
    setText(this.vEarned, fmtEuro(c?.earnedEur ?? 0));

    // PRESET buttons — built once, kept in id order; light the selected one.
    this.syncPresets(state.presets);

    // PREVIEW — the truthful consequence of the selected preset draft.
    const p = state.preview;
    setText(this.vCovered, `${fmtPct(p.coveredFraction)} ${p.served ? "· covers" : "· gap"}`);
    setValueClass(this.vCovered, p.served && p.coveredFraction >= 0.999 ? "green" : "amber");
    setText(this.vPeriod, `${fmtDuration(p.periodS)}${p.served ? " · parks" : " · sweeps"}`);
    setText(
      this.vLatency,
      Number.isFinite(p.latencyFloorS) ? `${(p.latencyFloorS * 1000).toFixed(1)} ms` : "—",
    );
    setText(this.vCost, fmtEuro(p.costEur));

    // CONSTELLATION (Act-2 phasing assist) — surface the measured zero-gap N + the suggested
    // viable-but-imperfect set + its truthful held-fraction; the PLACE SET button fires the
    // batch. Hidden entirely in Act 1 (no availability demand → state.phasing is null).
    const ph = state.phasing;
    if (ph) {
      this.phasingGroup.style.display = "";
      setText(this.vZeroGap, `~${ph.zeroGapN} phased LEOs`);
      setText(this.vSuggest, `${ph.count} sats · 1 launch`);
      // The suggested set HELDS below the bar (the closable gap) — the honest preview.
      setText(this.vHeld, `${fmtPct(ph.estCoveredFraction)} vs bar ${fmtPct(ph.slaAvail)}`);
      this.constellationBtn.classList.toggle("ready", true);
    } else {
      this.phasingGroup.style.display = "none";
    }

    // COMMIT — the ACCEPT button is live only while the contract is OFFERED; LAUNCH always.
    const canAccept = !!c && c.state === "offered";
    this.acceptBtn.disabled = !canAccept;
    this.acceptBtn.classList.toggle("ready", canAccept);
    // The LAUNCH button reads "READY" before the first launch (point at the default).
    this.launchBtn.classList.toggle("ready", !state.launched);

    // HINT — the gentle assist (shortfall) when stuck, else the next obvious step. In Act 2 the
    // shortfall states the fix in CONSTELLATION terms (a single sat MOVES + sets); the phasing
    // assist + PLACE SET button are how the player acts on it.
    if (state.shortfall) {
      setText(this.hint, state.shortfall);
      this.hint.className = "net-hint warn";
    } else if (ph) {
      setText(this.hint, `coverage MOVES — press PLACE SET to launch ${ph.count} phased sats, then add one to hold it`);
      this.hint.className = "net-hint";
    } else if (!state.launched) {
      setText(this.hint, "press LAUNCH on the GEO PARK default — it parks over REGION-0");
      this.hint.className = "net-hint";
    } else if (c && c.state === "offered") {
      setText(this.hint, "sat is up — press ACCEPT to start earning from REGION-0");
      this.hint.className = "net-hint";
    } else if (this.servedNow) {
      setText(this.hint, "REGION-0 SERVED · revenue ticking — Act 1 complete");
      this.hint.className = "net-hint good";
    } else {
      setText(this.hint, "");
      this.hint.className = "net-hint";
    }
  }

  /** Build the preset buttons once (in render-order), then light the selected one. */
  private syncPresets(presets: NetPresetChoice[]): void {
    for (const choice of presets) {
      let btn = this.presetButtons.get(choice.id);
      if (!btn) {
        btn = button(choice.label, "preset");
        btn.dataset.presetId = choice.id;
        btn.addEventListener("click", () => this.actions.onSelectPreset(choice.id));
        this.presetHost.append(btn);
        this.presetButtons.set(choice.id, btn);
      }
      btn.classList.toggle("active", choice.selected);
    }
  }

  status(): "ok" | "warn" | "crit" {
    return this.worst;
  }

  subtitle(): string {
    return this.servedNow ? "· SERVED" : "· place one thing";
  }
}

// --- tiny DOM helpers (mirror finance.ts / contracts.ts) --------------------

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

/** A §8 1-bit chrome button carrying the stable `data-net` selector a click test finds. */
function button(label: string, net: string): HTMLButtonElement {
  const b = document.createElement("button");
  b.type = "button";
  b.className = "net-btn";
  b.dataset.net = net;
  b.textContent = label;
  return b;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

function setValueClass(node: HTMLElement, tone: string): void {
  const next = tone ? `v ${tone}` : "v";
  if (node.className !== next) node.className = next;
}
