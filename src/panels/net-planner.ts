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
 *   - a DRAFT slider (§3.1):    [data-net="draft"][data-draft="altitude"|"inclination"|"phase"|"raan"]
 *   - the PREFER slider (§7.3): [data-net="prefer"]  (the per-contract latency↔bandwidth↔stability tune)
 *   - the PREFER select btn:    [data-net="prefer-select"]  (cycle which active contract is tuned)
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

/** §3.1 — one DRAGGABLE planner parameter projected for the slider: its current value as a
 * normalized 0..1 position within the draggable bounds + a human-readable label (e.g. "550 km",
 * "53°"). The panel paints a range slider at `pos` and shows `label`; dragging fires onEditDraft. */
export interface NetDraftParam {
  pos: number;
  label: string;
}

/** §3.1 — the four DRAGGABLE planner parameters (the ceiling): altitude + inclination are the first
 * two that matter (§3.1 "expose these first"), phase + RAAN the fine controls. Each is a slider. */
export interface NetDraftReadout {
  altitude: NetDraftParam;
  inclination: NetDraftParam;
  phase: NetDraftParam;
  raan: NetDraftParam;
}

/** The four draft slider fields, in the order the panel lays them out (altitude first — §3.1). */
export type NetDraftField = "semiMajorM" | "incRad" | "subLonRad" | "raanRad";

/**
 * net/ Act-1 — THE CURRENT OBJECTIVE (the per-act goal made explicit). Render-only text mirroring
 * the m1 doc's per-act curriculum, driven by the scenario cursor — answers "what am I trying to do
 * right now?", the gap the player hit ("no clear goals"). NOT a sim concept (no new mechanics).
 */
export interface NetObjective {
  /** "ACT 1" … "ACT 4" — the act label for the group legend. */
  actLabel: string;
  /** The one-line goal ("Serve a region and get paid"). */
  title: string;
  /** The concrete how-to ("Aim a sat over REGION-0, LAUNCH, then ACCEPT"). */
  detail: string;
}

/**
 * net/ Act-1 — ONE row of THE CONTRACTS VIEW (the "clear contracts view" the player asked for). A
 * pure projection of a net Contract: its state, the ENFORCED SLA terms (gated by activeAxes so Act 1
 * shows just "connectivity" and later acts reveal avail/latency/bandwidth), the reward rate, the live
 * served fraction + term progress, and the € earned. Offered rows expose an inline ACCEPT.
 */
export interface NetContractRow {
  id: string;
  label: string;
  state: "offered" | "active" | "completed" | "failed";
  /** The enforced SLA terms, human-readable + colour-redundant on the words (e.g. "connectivity",
   * "avail ≥ 99%", "≤ 40 ms · 50 Mbps") — only the axes in activeAxes are shown. */
  terms: string;
  /** Reward at full service, € per sim-hour (payPerSecond × 3600). */
  rewardPerHr: number;
  /** Whether a path serves it RIGHT NOW (active only). */
  served: boolean;
  /** Live served fraction ∈ [0,1] (active only). */
  servedFraction: number;
  /** Term progress ∈ [0,1] (servedSecondsAccum / termSeconds). */
  progressFraction: number;
  /** € earned so far. */
  earnedEur: number;
  /** PRICE-THE-BET (the underwrite card): the DOWNSIDE — € per sim-hour drained while ACTIVE but
   * wholly unserved (penaltyPerSecond × 3600). Accepting stakes this against the reward. */
  penaltyPerHr: number;
  /** PRICE-THE-BET: for an OFFERED contract, whether the player's CURRENT fleet would hold every
   * enforced SLA axis right now (a pure preview solve — no sim mutation). null when not offered or
   * not previewable. true = "click accept and it serves"; false = accepting takes a known penalty risk. */
  previewServable: boolean | null;
  /** PRICE-THE-BET: when {@link previewServable} is false, the binding axis that would breach
   * ("connectivity" / "availability" / "latency" / "bandwidth") — the fix to make before accepting. */
  previewBreachAxis: string | null;
  /** TRIAGE: for an ACTIVE but UNSERVED contract, the binding axis the router says is failing right now
   * — so the OVERVIEW board can say WHY it's at risk ("no path" / "over-cap" / …). null when served/offered. */
  bindingReason: string | null;
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

/**
 * §7.3 / §10 — THE PER-CONTRACT PREFER CONTROL ("the first thing the player tunes"): the SELECTED
 * active contract + its traffic CLASS + the latency ↔ bandwidth ↔ stability slider position. The
 * panel paints a contract selector (cycle through active contracts) + a single range slider; dragging
 * it appends a net_set_prefer action so the router re-solves THAT contract and its path visibly moves.
 * Null when no active contract exists (Act 1, before any accept). */
export interface NetPreferControl {
  /** The contract being tuned (the net_set_prefer payload carries this id). */
  contractId: string;
  /** The contract's glanceable label. */
  label: string;
  /** Its traffic CLASS (§7.2 — what set the default weights; shown so the player reads the intent). */
  trafficClass: "latency" | "bandwidth" | "availability";
  /** The slider position 0..1 (0 = latency, 0.5 = bandwidth, 1 = stability) for the current prefer. */
  pos: number;
  /** The current prefer weights, for the numeric readout (`stab` shown but DORMANT in M1). */
  prefer: { lat: number; bw: number; stab: number };
  /** Whether more than one active contract exists (so the SELECT button is meaningful). */
  canSelect: boolean;
  /** REROUTE PREVIEW (§7.3): the sat this contract bridges RIGHT NOW + its utilisation. null = unserved. */
  currentSat: string | null;
  currentUtil: number;
  /** Where preferring BANDWIDTH would route it instead (the congestion-relief alternative) + that
   * sat's utilisation — so the slider's effect is legible BEFORE you commit. null = no other path. */
  altSat: string | null;
  altUtil: number;
  /** True when the bandwidth-preferring route differs from the current one (the slider WOULD move it). */
  wouldReroute: boolean;
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
  /** The held-vs-size LADDER (one rung per candidate N): the coverage-vs-capex curve the player
   * reads to dial the constellation size — below the knee it sawtooths (gaps), at the knee
   * (= zeroGapN) it just holds, above it the extra sats are idle over-build. */
  ladder: { n: number; held: number; holds: boolean }[];
  /** The size the player has dialed (what PLACE SET will launch). Defaults to zeroGapN. */
  chosenN: number;
  /** Per-LEO launch cost — drives the chosen-size capex + the over-build line. */
  perSatCostEur: number;
}

/** Everything the planner panel paints — projected per-frame from the live NetSession. */
export interface NetPlannerRenderState {
  /** The current per-act OBJECTIVE (what the player is trying to do now). Null before any beat. */
  objective: NetObjective | null;
  /** ALL live contracts (offered + active + a short terminal tail), for the CONTRACTS view. */
  contracts: NetContractRow[];
  /** On-hand € (the wallet that visibly ticks as a served contract pays). */
  balanceEur: number;
  /** The offered Act-1 contract (null before the scenario emits it). */
  contract: NetContractReadout | null;
  /** The preset buttons + which is selected (none lights once the player hand-drags off a preset). */
  presets: NetPresetChoice[];
  /** §3.1 — the four DRAGGABLE parameters (the ceiling): altitude / inclination / phase / RAAN. */
  draft: NetDraftReadout;
  /** The consequence preview of the live editable draft (re-run every frame as the player drags). */
  preview: NetPreviewReadout;
  /** Whether a sat has already been launched (LAUNCH stays enabled for re-launch, but the
   * face reads differently once the constellation exists). */
  launched: boolean;
  /** The gentle shortfall assist message, when the player is stuck (else null). */
  shortfall: string | null;
  /** Act-2 — the phasing assist (null in Act 1 / before an availability demand is live). When
   * present, the CONSTELLATION button is shown ("~N evenly-phased sats — place the set?"). */
  phasing: NetPhasingReadout | null;
  /** §7.3 / §10 — the per-contract prefer control (null until ≥1 active contract). The §10 "first
   * thing the player tunes": a per-contract latency ↔ bandwidth ↔ stability slider that re-routes. */
  prefer: NetPreferControl | null;
  /** TRIAGE SUMMARY (OVERVIEW status-board): the at-a-glance network health — fleet size + the live
   * serve REVENUE rate (the rest of the glance, served/at-risk counts, is derived from `contracts`). */
  fleet: { satCount: number; revenuePerHr: number };
}

/** The button callbacks main.ts wires (the launch/accept appliers + preset cursor). */
export interface NetPlannerActions {
  onSelectPreset(presetId: string): void;
  /** §3.1 — the player DRAGGED a parameter slider to a normalized 0..1 position; main.ts maps it
   * back to SI/radians, edits the draft, and re-runs previewLaunch (the live consequence). */
  onEditDraft(field: NetDraftField, pos: number): void;
  onLaunch(): void;
  /** Accept an OFFERED contract. With no id, accepts the first offered (the headline ACCEPT button);
   * the CONTRACTS-view inline buttons pass the row's id so any offered contract can be taken. */
  onAccept(contractId?: string): void;
  /** Act-2 — fire ONE batch launch of the CHOSEN-size phased constellation (the §3.4 batch). */
  onConstellation(): void;
  /** Act-2 — the player dialed the constellation SIZE up/down (delta ±1) on the held-vs-capex
   * ladder before committing. UI-only: clamps the chosen N within the ladder's range. */
  onConstellationStep(delta: number): void;
  /** §7.3 / §10 — the player CYCLED which active contract the prefer slider tunes (when 2+ exist). */
  onSelectPreferContract(): void;
  /** §7.3 / §10 — the player DRAGGED the prefer slider to a normalized 0..1 position (0 = latency,
   * 0.5 = bandwidth, 1 = stability); main.ts maps it to weights + appends net_set_prefer, the router
   * re-solves that contract, and its path visibly re-routes (via the P1 link line on the globe). */
  onSetPrefer(contractId: string, pos: number): void;
}

export class NetPlanner implements PanelHandle {
  readonly title = "NET·LAUNCH";
  readonly content: HTMLElement;

  // --- OBJECTIVE (the per-act goal made explicit) ---
  private objectiveGroup: HTMLElement;
  private objectiveLegend: HTMLElement;
  private vObjTitle: HTMLElement;
  private vObjDetail: HTMLElement;

  // --- CONTRACTS view (all live deals + their terms/progress) ---
  private contractsGroup: HTMLElement;
  private contractsHost: HTMLElement;
  /** Per-contract row elements, rebuilt on a state-signature change, value-updated each frame. */
  private contractRows = new Map<string, { root: HTMLElement; head: HTMLElement; terms: HTMLElement; prog: HTMLElement; accept: HTMLButtonElement }>();
  private contractsSig = "";

  // --- WALLET + CONTRACT ---
  private vBalance: HTMLElement;
  private vContractState: HTMLElement;
  private vEarned: HTMLElement;

  // --- PRESET buttons (built once) ---
  private presetHost: HTMLElement;
  private presetButtons = new Map<string, HTMLButtonElement>();

  // --- §3.1 DRAFT sliders (the ceiling: altitude / inclination / phase / RAAN), built once ---
  private draftSliders = new Map<NetDraftField, HTMLInputElement>();
  private draftValues = new Map<NetDraftField, HTMLElement>();

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
  private vLadder: HTMLElement;
  private vChosen: HTMLElement;
  private vHeld: HTMLElement;
  private vOverbuild: HTMLElement;
  private lessBtn: HTMLButtonElement;
  private moreBtn: HTMLButtonElement;

  // --- §7.3 / §10 PER-CONTRACT PREFER control (the first thing the player tunes), built once ---
  private preferGroup: HTMLElement;
  private vPreferContract: HTMLElement;
  private vPreferClass: HTMLElement;
  private vPreferWeights: HTMLElement;
  private preferSelectBtn: HTMLButtonElement;
  private preferSlider: HTMLInputElement;
  /** The contract the prefer slider currently tunes (so onSetPrefer carries its id). */
  private preferContractId: string | null = null;

  private worst: "ok" | "warn" | "crit" = "warn";
  private servedNow = false;

  constructor(private actions: NetPlannerActions) {
    this.content = el("div", "telem");

    // GROUP: OBJECTIVE — what the player is trying to do RIGHT NOW (the per-act goal made explicit;
    // the "no clear goals" fix). A title line + a concrete how-to, driven by the scenario cursor.
    this.objectiveGroup = el("div", "group net-objective");
    this.objectiveLegend = el("div", "legend");
    this.objectiveLegend.textContent = "OBJECTIVE";
    this.vObjTitle = el("div", "net-obj-title");
    this.vObjDetail = el("div", "net-obj-detail");
    this.objectiveGroup.append(this.objectiveLegend, this.vObjTitle, this.vObjDetail);
    this.content.append(this.objectiveGroup);

    // GROUP: NETWORK — the wallet (CLIMBS as the served contract pays) + the headline demand.
    const net = group("NETWORK · ACT 1");
    this.vBalance = valueOf(row(net, "WALLET", "green"));
    this.vContractState = valueOf(row(net, "REGION-0"));
    this.vEarned = valueOf(row(net, "EARNED", "cyan"));
    this.content.append(net);

    // GROUP: CONTRACTS — the legible deal board (the "clear contracts view" fix): every live
    // contract with its ENFORCED SLA terms, reward, live served% + term progress, and an inline
    // ACCEPT for offered ones. Rows are rebuilt only on a state-signature change (no per-frame churn).
    this.contractsGroup = group("CONTRACTS");
    this.contractsHost = el("div", "net-contracts");
    this.contractsGroup.append(this.contractsHost);
    this.content.append(this.contractsGroup);

    // GROUP: PRESET — the floor (GEO PARK default that already works) + LEO SWEEP. Buttons.
    const presetGroup = group("PRESET · FLOOR");
    this.presetHost = el("div", "net-presets");
    presetGroup.append(this.presetHost);
    this.content.append(presetGroup);

    // GROUP: ORBIT — the CEILING (§3.1): the four DRAGGABLE parameters. Altitude + inclination are
    // the first two that matter (§3.1: expose these first — the GEO/LEO axis + which latitudes you
    // cover); phase + RAAN are the fine controls. Each is a range slider that fires onEditDraft as
    // the player drags, re-running previewLaunch so the on-globe consequence updates live.
    const orbitGroup = group("ORBIT · DRAG ME");
    // §3.1 — per-axis EFFECT captions: teach cause BEFORE effect. Altitude + inclination are the two
    // that matter first (the GEO/LEO reach axis + which latitudes); phase + RAAN are the FINE controls
    // (captioned as such so a cold player drags the right two first).
    this.buildSlider(orbitGroup, "semiMajorM", "altitude", "ALTITUDE", "higher = wider reach, more delay · GEO parks, LEO sweeps");
    this.buildSlider(orbitGroup, "incRad", "inclination", "INCLINATION", "tilt the orbit — reach higher latitudes");
    this.buildSlider(orbitGroup, "subLonRad", "phase", "PHASE", "fine · where it sits along the orbit");
    this.buildSlider(orbitGroup, "raanRad", "raan", "RAAN", "fine · rotates the orbital plane");
    this.content.append(orbitGroup);

    // GROUP: PREVIEW — the truthful consequence of the LIVE EDITABLE DRAFT before commit.
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
    // The held-vs-size LADDER — the coverage-vs-capex curve the player reads to choose the size.
    this.vLadder = valueOf(row(this.phasingGroup, "LADDER", ""));
    // SIZE stepper: − chosenN + — the constellation PLACE SET will launch (dial it on the ladder).
    const sizeRow = el("div", "row");
    const sizeLab = el("span", "label");
    sizeLab.textContent = "SIZE";
    const sizeCtl = el("span", "v net-stepper");
    this.lessBtn = button("−", "constellation-less");
    this.lessBtn.addEventListener("click", () => this.actions.onConstellationStep(-1));
    this.vChosen = el("span", "net-stepper-n");
    this.moreBtn = button("+", "constellation-more");
    this.moreBtn.addEventListener("click", () => this.actions.onConstellationStep(1));
    sizeCtl.append(this.lessBtn, this.vChosen, this.moreBtn);
    sizeRow.append(sizeLab, sizeCtl);
    this.phasingGroup.append(sizeRow);
    this.vHeld = valueOf(row(this.phasingGroup, "HELD", "amber"));
    this.vOverbuild = valueOf(row(this.phasingGroup, "CAPEX", ""));
    const phaseRow = el("div", "net-buttons");
    this.constellationBtn = button("PLACE SET", "constellation");
    this.constellationBtn.addEventListener("click", () => this.actions.onConstellation());
    phaseRow.append(this.constellationBtn);
    this.phasingGroup.append(phaseRow);
    this.phasingGroup.style.display = "none";
    this.content.append(this.phasingGroup);

    // GROUP: ROUTING — the §7.3/§10 PER-CONTRACT PREFER control (the FIRST thing the player tunes).
    // A contract selector (cycle through active contracts) + its traffic CLASS + a single latency ↔
    // bandwidth ↔ stability slider. Dragging it appends net_set_prefer → the router re-solves THAT
    // contract → its path visibly re-routes (the P1 link line on the globe moves). Hidden until ≥1
    // active contract exists. The slider carries the stable [data-net="prefer"] selector for a
    // headless click/drag test + screenshot.
    this.preferGroup = group("ROUTING · PREFER (§7.3)");
    const pRow = el("div", "row");
    const pLab = el("span", "label");
    pLab.textContent = "CONTRACT";
    this.vPreferContract = el("span", "v cyan");
    pRow.append(pLab, this.vPreferContract);
    this.preferGroup.append(pRow);
    this.vPreferClass = valueOf(row(this.preferGroup, "CLASS", "green"));
    this.vPreferWeights = valueOf(row(this.preferGroup, "WEIGHTS"));
    // The slider: a labelled lat ↔ bw ↔ stab range. Built like the orbit sliders (0..1000 → 0..1).
    const sRow = el("div", "net-slider");
    const sHead = el("div", "row");
    const sLab = el("span", "label");
    sLab.textContent = "LAT ↔ BW ↔ STAB";
    sHead.append(sLab);
    this.preferSlider = document.createElement("input");
    this.preferSlider.type = "range";
    this.preferSlider.min = "0";
    this.preferSlider.max = "1000";
    this.preferSlider.step = "1";
    this.preferSlider.className = "net-range";
    this.preferSlider.dataset.net = "prefer";
    this.preferSlider.addEventListener("input", () => {
      if (this.preferContractId !== null) {
        this.actions.onSetPrefer(this.preferContractId, Number(this.preferSlider.value) / 1000);
      }
    });
    sRow.append(sHead, this.preferSlider);
    this.preferGroup.append(sRow);
    const pBtnRow = el("div", "net-buttons");
    this.preferSelectBtn = button("SELECT CONTRACT", "prefer-select");
    this.preferSelectBtn.addEventListener("click", () => this.actions.onSelectPreferContract());
    pBtnRow.append(this.preferSelectBtn);
    this.preferGroup.append(pBtnRow);
    this.preferGroup.style.display = "none";
    this.content.append(this.preferGroup);

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

  /**
   * §3.1 — build ONE draggable parameter slider (a labelled row: NAME · value + a 0..1000 range
   * input carrying the stable `[data-net="draft"][data-draft="<key>"]` selector). The slider fires
   * onEditDraft with the normalized 0..1 position as the player drags (`input` event), so each drag
   * re-runs previewLaunch and the on-globe consequence moves live. The value cell shows the human
   * readout (km / degrees) painted from render(). Built once; the value updates per frame.
   */
  private buildSlider(parent: HTMLElement, field: NetDraftField, key: string, label: string, caption?: string): void {
    const r = el("div", "net-slider");
    const head = el("div", "row");
    const lab = el("span", "label");
    lab.textContent = label;
    const v = el("span", "v cyan");
    head.append(lab, v);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1000";
    input.step = "1";
    input.className = "net-range";
    input.dataset.net = "draft";
    input.dataset.draft = key;
    input.addEventListener("input", () => {
      this.actions.onEditDraft(field, Number(input.value) / 1000);
    });
    r.append(head, input);
    // §3.1 — the per-axis EFFECT caption (teach cause→effect): a dim one-liner under the slider.
    if (caption) {
      const cap = el("div", "net-slider-cap");
      cap.textContent = caption;
      r.append(cap);
    }
    parent.append(r);
    this.draftSliders.set(field, input);
    this.draftValues.set(field, v);
  }

  render(state: NetPlannerRenderState): void {
    // OBJECTIVE — the per-act goal (what to do now). Driven by the scenario cursor in main.ts.
    const obj = state.objective;
    if (obj) {
      this.objectiveGroup.style.display = "";
      setText(this.objectiveLegend, `OBJECTIVE · ${obj.actLabel}`);
      setText(this.vObjTitle, obj.title);
      setText(this.vObjDetail, obj.detail);
    } else {
      this.objectiveGroup.style.display = "none";
    }

    // CONTRACTS — the legible deal board (rebuilt on a state-signature change, values per frame).
    this.syncContracts(state.contracts);

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

    // §3.1 — paint the four DRAFT sliders from the live draft (position + human readout). Skip the
    // slider thumb while the player is actively dragging it (document.activeElement) so the render
    // never fights the drag; the value cell always reflects the live draft.
    this.syncSlider("semiMajorM", state.draft.altitude);
    this.syncSlider("incRad", state.draft.inclination);
    this.syncSlider("subLonRad", state.draft.phase);
    this.syncSlider("raanRad", state.draft.raan);

    // PREVIEW — the truthful consequence of the live editable draft.
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
      setText(this.vZeroGap, `~${ph.zeroGapN} phased LEOs hold the bar`);
      // LADDER — the coverage-vs-capex curve: each size's worst-phase held %, the chosen one
      // bracketed, the ones that clear the bar marked ✓. Reading it IS the decision (trim to the
      // knee, or pay for margin), not a blind count.
      const ladderTxt = ph.ladder
        .map((r) => {
          const tag = `${r.n}:${Math.round(r.held * 100)}%${r.holds ? "✓" : ""}`;
          return r.n === ph.chosenN ? `[${tag}]` : tag;
        })
        .join("  ");
      setText(this.vLadder, ladderTxt);
      setText(this.vChosen, String(ph.chosenN));
      const chosen = ph.ladder.find((r) => r.n === ph.chosenN);
      const chosenHolds = chosen?.holds ?? false;
      const chosenHeld = chosen?.held ?? ph.estCoveredFraction;
      setText(this.vHeld, `${fmtPct(chosenHeld)} vs bar ${fmtPct(ph.slaAvail)}${chosenHolds ? " ✓ holds" : " · gaps"}`);
      setValueClass(this.vHeld, chosenHolds ? "green" : "amber");
      // CAPEX — total launch spend for the chosen size + the over-build penalty (sats beyond the
      // measured minimum are idle capex), so trimming to zeroGapN is a VISIBLE optimisation.
      const total = ph.chosenN * ph.perSatCostEur;
      const over = Math.max(0, ph.chosenN - ph.zeroGapN);
      setText(
        this.vOverbuild,
        over > 0
          ? `${fmtEuro(total)} · ${over} over min = ${fmtEuro(over * ph.perSatCostEur)} idle`
          : `${fmtEuro(total)} · ${ph.chosenN < ph.zeroGapN ? "under min — will gap" : "at minimum ✓"}`,
      );
      setValueClass(this.vOverbuild, over > 0 ? "amber" : ph.chosenN < ph.zeroGapN ? "amber" : "");
      // The stepper bounds (the ladder's measured range).
      const lo = ph.ladder[0]?.n ?? ph.chosenN;
      const hi = ph.ladder[ph.ladder.length - 1]?.n ?? ph.chosenN;
      this.lessBtn.disabled = ph.chosenN <= lo;
      this.moreBtn.disabled = ph.chosenN >= hi;
      this.constellationBtn.classList.toggle("ready", chosenHolds);
    } else {
      this.phasingGroup.style.display = "none";
    }

    // ROUTING · PREFER (§7.3/§10) — the per-contract latency ↔ bandwidth ↔ stability slider. Shown
    // once ≥1 active contract exists; the slider thumb tracks the selected contract's current prefer
    // (skipped while the player is actively dragging it so render never fights the drag). Dragging it
    // appends net_set_prefer → the router re-solves → the path re-routes on the globe (the P1 link).
    const pc = state.prefer;
    if (pc) {
      this.preferGroup.style.display = "";
      this.preferContractId = pc.contractId;
      setText(this.vPreferContract, pc.label);
      setText(this.vPreferClass, `${pc.trafficClass}-class`);
      setText(
        this.vPreferWeights,
        `lat ${pc.prefer.lat.toFixed(2)} · bw ${pc.prefer.bw < 0.01 && pc.prefer.bw > 0 ? pc.prefer.bw.toExponential(0) : pc.prefer.bw.toFixed(2)} · stab ${pc.prefer.stab.toFixed(2)} (dormant)`,
      );
      if (document.activeElement !== this.preferSlider) {
        const next = String(Math.round(pc.pos * 1000));
        if (this.preferSlider.value !== next) this.preferSlider.value = next;
      }
      this.preferSelectBtn.disabled = !pc.canSelect;
      this.preferSelectBtn.classList.toggle("ready", pc.canSelect);
    } else {
      this.preferGroup.style.display = "none";
      this.preferContractId = null;
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
      {
        const chosen = ph.ladder.find((r) => r.n === ph.chosenN);
        setText(
          this.hint,
          chosen?.holds
            ? `SIZE ${ph.chosenN} HOLDS the bar — PLACE SET to launch, or trim toward the ${ph.zeroGapN} minimum to cut idle capex`
            : `coverage GAPS at SIZE ${ph.chosenN} — step it up (+) until HELD clears the bar (min ${ph.zeroGapN}), then PLACE SET`,
        );
      }
      this.hint.className = "net-hint";
    } else if (!state.launched) {
      // Coverage-aware: when the pre-aimed default already COVERS (the gentle "place one thing works"
      // cold open), invite experimentation rather than imply a gap that isn't there; when there IS a
      // gap, point at closing it. Either way the sliders read as meaningful (their captions teach why).
      if (state.preview.served && state.preview.coveredFraction >= 0.999) {
        setText(
          this.hint,
          "REGION-0 is fully covered — LAUNCH now, or drag ALTITUDE down / try LEO SWEEP to feel the tradeoff",
        );
      } else {
        setText(
          this.hint,
          "DRAG the ORBIT sliders — watch the footprint + ground-track move on the globe until the RED gap goes GREEN, then LAUNCH",
        );
      }
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

  /** §3.1 — paint ONE draft slider from its {@link NetDraftParam}: set the range thumb to the
   * normalized position (unless the player is actively dragging THIS slider, so render never fights
   * the drag) + the value cell to the human readout. The slider can also be driven from arrow-key
   * nudges in main.ts (the readout follows either input source). */
  private syncSlider(field: NetDraftField, p: NetDraftParam): void {
    const input = this.draftSliders.get(field);
    if (input && document.activeElement !== input) {
      const next = String(Math.round(p.pos * 1000));
      if (input.value !== next) input.value = next;
    }
    const v = this.draftValues.get(field);
    if (v) setText(v, p.label);
  }

  /**
   * Paint THE CONTRACTS VIEW: one row per live contract (state · terms · reward · served% · earned),
   * with an inline ACCEPT for offered ones. The row set is rebuilt only when the (id, state) signature
   * changes (so accepting / a new offer rebuilds, but per-frame value updates don't churn the DOM).
   */
  private syncContracts(contracts: NetContractRow[]): void {
    const sig = contracts.map((c) => `${c.id}:${c.state}`).join("|");
    if (sig !== this.contractsSig) {
      this.contractsSig = sig;
      this.contractsHost.replaceChildren();
      this.contractRows.clear();
      if (contracts.length === 0) {
        const empty = el("div", "net-contract-empty");
        empty.textContent = "— no contracts yet —";
        this.contractsHost.append(empty);
      }
      for (const c of contracts) {
        const root = el("div", "net-contract");
        const head = el("div", "net-contract-head");
        const terms = el("div", "net-contract-terms");
        const prog = el("div", "net-contract-prog");
        const accept = button("ACCEPT", "accept-row");
        accept.dataset.contractId = c.id;
        accept.addEventListener("click", () => this.actions.onAccept(c.id));
        root.append(head, terms, prog, accept);
        this.contractsHost.append(root);
        this.contractRows.set(c.id, { root, head, terms, prog, accept });
      }
    }
    // Per-frame value updates (no DOM churn).
    for (const c of contracts) {
      const r = this.contractRows.get(c.id);
      if (!r) continue;
      const stateWord =
        c.state === "offered" ? "OFFERED"
        : c.state === "active" ? (c.served ? "SERVED ✓" : "UNSERVED")
        : c.state === "completed" ? "✓ DONE"
        : "✕ ENDED";
      const tone =
        c.state === "offered" ? "cyan"
        : c.state === "active" ? (c.served ? "green" : "amber")
        : c.state === "completed" ? "green"
        : "red";
      r.head.className = `net-contract-head ${tone}`;
      setText(r.head, `${c.label} · ${stateWord}`);
      setText(r.terms, `${c.terms} · +€${Math.round(c.rewardPerHr)}/hr`);
      if (c.state === "active") {
        setText(r.prog, `served ${fmtPct(c.servedFraction)} · term ${fmtPct(c.progressFraction)} · earned ${fmtEuro(c.earnedEur)}`);
        r.prog.className = "net-contract-prog";
        r.prog.style.display = "";
      } else if (c.state === "offered") {
        // PRICE-THE-BET: the wager, not "click to earn" — reward vs the penalty DOWNSIDE, then whether
        // the current fleet would actually hold it (a pure preview). Accepting an un-servable contract
        // is a deliberate penalty gamble; a servable one is free money.
        const bet = `BET +€${Math.round(c.rewardPerHr)}/hr vs −€${Math.round(c.penaltyPerHr)}/hr if it FAILs`;
        const verdict =
          c.previewServable === null ? ""
          : c.previewServable ? " · fleet HOLDS this ✓ — accept"
          : ` · fleet would BREACH ${c.previewBreachAxis} — fix first, or accept the penalty risk`;
        setText(r.prog, bet + verdict);
        r.prog.className = `net-contract-prog${c.previewServable === false ? " amber" : c.previewServable ? " green" : ""}`;
        r.prog.style.display = "";
      } else {
        setText(r.prog, `earned ${fmtEuro(c.earnedEur)}`);
        r.prog.style.display = "";
      }
      r.accept.style.display = c.state === "offered" ? "" : "none";
      r.accept.classList.toggle("ready", c.state === "offered");
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

/**
 * net/ M1 — NET·LAUNCH (SD-44 PHASE 1): the LAUNCH menu, split CLEANLY from CONTRACTS. The player's
 * verbatim pain was "EXTREMELY CLEAR what you're launching and where" — so this tile opens with a
 * two-line WHAT/WHERE headline (built once, value-updated each render), then the PRESET buttons, the
 * four ORBIT sliders (cause→effect captions kept), the CONSEQUENCE PREVIEW, the Act-2 CONSTELLATION
 * sub-block (only when state.phasing != null), and a COMMIT group with ONLY the LAUNCH button. The
 * OBJECTIVE / WALLET / CONTRACTS list / ROUTING·PREFER / ACCEPT live on OTHER tiles now.
 *
 * Reads the SAME {@link NetPlannerRenderState} + {@link NetPlannerActions} the monolithic planner used
 * (no new types). Keeps every stable selector ([data-net="launch"|"preset"|"draft"|"constellation"]).
 */
export class NetLaunch implements PanelHandle {
  readonly title = "NET·LAUNCH";
  readonly content: HTMLElement;

  // --- WHAT / WHERE headline (the "what are you launching, and over where?" fix) ---
  private whatLine: HTMLElement;
  private whereLine: HTMLElement;

  // --- PRESET buttons (built once) ---
  private presetHost: HTMLElement;
  private presetButtons = new Map<string, HTMLButtonElement>();

  // --- §3.1 DRAFT sliders (altitude / inclination / phase / RAAN), built once ---
  private draftSliders = new Map<NetDraftField, HTMLInputElement>();
  private draftValues = new Map<NetDraftField, HTMLElement>();

  // --- PREVIEW (consequence-before-commit) ---
  private vCovered: HTMLElement;
  private vPeriod: HTMLElement;
  private vLatency: HTMLElement;
  private vCost: HTMLElement;

  // --- CONSTELLATION (Act-2 phasing assist) ---
  private phasingGroup: HTMLElement;
  private vZeroGap: HTMLElement;
  private vLadder: HTMLElement;
  private vChosen: HTMLElement;
  private vHeld: HTMLElement;
  private vOverbuild: HTMLElement;
  private lessBtn: HTMLButtonElement;
  private moreBtn: HTMLButtonElement;
  private constellationBtn: HTMLButtonElement;

  // --- LAUNCH (the only commit button on this tile) ---
  private launchBtn: HTMLButtonElement;
  private hint: HTMLElement;

  private worst: "ok" | "warn" | "crit" = "warn";
  private servedNow = false;

  constructor(private actions: NetPlannerActions) {
    this.content = el("div", "telem");

    // WHAT / WHERE — the dead-clear headline at the very top: WHAT preset/count/cost, then WHERE
    // (the contract region) + the truthful served verdict. Built once; value-updated each render.
    const head = el("div", "group net-launch-head");
    this.whatLine = el("div", "net-launch-what");
    this.whereLine = el("div", "net-launch-where");
    head.append(this.whatLine, this.whereLine);
    this.content.append(head);

    // GROUP: PRESET — the floor (GEO PARK default + LEO SWEEP). Buttons.
    const presetGroup = group("PRESET · FLOOR");
    this.presetHost = el("div", "net-presets");
    presetGroup.append(this.presetHost);
    this.content.append(presetGroup);

    // GROUP: ORBIT — the ceiling (§3.1): four DRAGGABLE parameters with cause→effect captions.
    const orbitGroup = group("ORBIT · DRAG ME");
    this.buildSlider(orbitGroup, "semiMajorM", "altitude", "ALTITUDE", "higher = wider reach, more delay · GEO parks, LEO sweeps");
    this.buildSlider(orbitGroup, "incRad", "inclination", "INCLINATION", "tilt the orbit — reach higher latitudes");
    this.buildSlider(orbitGroup, "subLonRad", "phase", "PHASE", "fine · where it sits along the orbit");
    this.buildSlider(orbitGroup, "raanRad", "raan", "RAAN", "fine · rotates the orbital plane");
    this.content.append(orbitGroup);

    // GROUP: PREVIEW — the truthful consequence of the LIVE EDITABLE DRAFT before commit.
    const preview = group("PREVIEW · BEFORE COMMIT");
    this.vCovered = valueOf(row(preview, "FOOTPRINT", "green"));
    this.vPeriod = valueOf(row(preview, "PERIOD"));
    this.vLatency = valueOf(row(preview, "LATENCY"));
    this.vCost = valueOf(row(preview, "COST", "amber"));
    this.content.append(preview);

    // GROUP: CONSTELLATION — the Act-2 phasing DECISION; hidden in Act 1 (state.phasing null). The
    // player reads the held-vs-capex LADDER and DIALS the constellation size (trim to the minimum
    // that holds, or pay for over-build margin) — a real trade-off, not a one-press button.
    this.phasingGroup = group("CONSTELLATION · ACT 2");
    this.vZeroGap = valueOf(row(this.phasingGroup, "NEED", "cyan"));
    this.vLadder = valueOf(row(this.phasingGroup, "LADDER", ""));
    // SIZE stepper: − chosenN + — the constellation PLACE SET will launch (dial it on the ladder).
    const sizeRow = el("div", "row");
    const sizeLab = el("span", "label");
    sizeLab.textContent = "SIZE";
    const sizeCtl = el("span", "v net-stepper");
    this.lessBtn = button("−", "constellation-less");
    this.lessBtn.addEventListener("click", () => this.actions.onConstellationStep(-1));
    this.vChosen = el("span", "net-stepper-n");
    this.moreBtn = button("+", "constellation-more");
    this.moreBtn.addEventListener("click", () => this.actions.onConstellationStep(1));
    sizeCtl.append(this.lessBtn, this.vChosen, this.moreBtn);
    sizeRow.append(sizeLab, sizeCtl);
    this.phasingGroup.append(sizeRow);
    this.vHeld = valueOf(row(this.phasingGroup, "HELD", "amber"));
    this.vOverbuild = valueOf(row(this.phasingGroup, "CAPEX", ""));
    const phaseRow = el("div", "net-buttons");
    this.constellationBtn = button("PLACE SET", "constellation");
    this.constellationBtn.addEventListener("click", () => this.actions.onConstellation());
    phaseRow.append(this.constellationBtn);
    this.phasingGroup.append(phaseRow);
    this.phasingGroup.style.display = "none";
    this.content.append(this.phasingGroup);

    // GROUP: COMMIT — ONLY the LAUNCH button (ACCEPT lives on the CONTRACTS tile now).
    const commit = group("COMMIT");
    const btnRow = el("div", "net-buttons");
    this.launchBtn = button("LAUNCH", "launch");
    this.launchBtn.addEventListener("click", () => this.actions.onLaunch());
    btnRow.append(this.launchBtn);
    commit.append(btnRow);
    this.hint = el("div", "net-hint");
    commit.append(this.hint);
    this.content.append(commit);
  }

  private buildSlider(parent: HTMLElement, field: NetDraftField, key: string, label: string, caption?: string): void {
    const r = el("div", "net-slider");
    const headRow = el("div", "row");
    const lab = el("span", "label");
    lab.textContent = label;
    const v = el("span", "v cyan");
    headRow.append(lab, v);
    const input = document.createElement("input");
    input.type = "range";
    input.min = "0";
    input.max = "1000";
    input.step = "1";
    input.className = "net-range";
    input.dataset.net = "draft";
    input.dataset.draft = key;
    input.addEventListener("input", () => {
      this.actions.onEditDraft(field, Number(input.value) / 1000);
    });
    r.append(headRow, input);
    if (caption) {
      const cap = el("div", "net-slider-cap");
      cap.textContent = caption;
      r.append(cap);
    }
    parent.append(r);
    this.draftSliders.set(field, input);
    this.draftValues.set(field, v);
  }

  render(state: NetPlannerRenderState): void {
    const p = state.preview;
    const c = state.contract;
    this.servedNow = !!c && c.state === "active" && c.served;

    // WHAT — preset label · count · cost. count = 1 (single preset launch).
    const presetLabel = state.presets.find((pp) => pp.selected)?.label ?? "CUSTOM ORBIT";
    setText(this.whatLine, `LAUNCHING: ${presetLabel} · 1× sat · ${fmtEuro(p.costEur)}`);

    // WHERE — the contract region + the truthful served verdict. Green only when it WILL fully serve.
    const willServe = p.served && p.coveredFraction >= 0.999;
    setText(
      this.whereLine,
      `OVER: ${state.contract?.label ?? "REGION-0"} · footprint ${fmtPct(p.coveredFraction)} ${p.served ? "· WILL SERVE ✓" : "· STILL A GAP"}`,
    );
    this.whereLine.className = `net-launch-where ${willServe ? "green" : "amber"}`;
    this.worst = willServe ? "ok" : "warn";

    // PRESET buttons.
    this.syncPresets(state.presets);

    // DRAFT sliders.
    this.syncSlider("semiMajorM", state.draft.altitude);
    this.syncSlider("incRad", state.draft.inclination);
    this.syncSlider("subLonRad", state.draft.phase);
    this.syncSlider("raanRad", state.draft.raan);

    // PREVIEW.
    setText(this.vCovered, `${fmtPct(p.coveredFraction)} ${p.served ? "· covers" : "· gap"}`);
    setValueClass(this.vCovered, p.served && p.coveredFraction >= 0.999 ? "green" : "amber");
    setText(this.vPeriod, `${fmtDuration(p.periodS)}${p.served ? " · parks" : " · sweeps"}`);
    setText(this.vLatency, Number.isFinite(p.latencyFloorS) ? `${(p.latencyFloorS * 1000).toFixed(1)} ms` : "—");
    setText(this.vCost, fmtEuro(p.costEur));

    // CONSTELLATION (Act-2) — the held-vs-capex LADDER + the SIZE the player has dialed.
    const ph = state.phasing;
    if (ph) {
      this.phasingGroup.style.display = "";
      setText(this.vZeroGap, `~${ph.zeroGapN} phased LEOs hold the bar`);
      const ladderTxt = ph.ladder
        .map((r) => {
          const tag = `${r.n}:${Math.round(r.held * 100)}%${r.holds ? "✓" : ""}`;
          return r.n === ph.chosenN ? `[${tag}]` : tag;
        })
        .join("  ");
      setText(this.vLadder, ladderTxt);
      setText(this.vChosen, String(ph.chosenN));
      const chosen = ph.ladder.find((r) => r.n === ph.chosenN);
      const chosenHolds = chosen?.holds ?? false;
      const chosenHeld = chosen?.held ?? ph.estCoveredFraction;
      setText(this.vHeld, `${fmtPct(chosenHeld)} vs bar ${fmtPct(ph.slaAvail)}${chosenHolds ? " ✓ holds" : " · gaps"}`);
      setValueClass(this.vHeld, chosenHolds ? "green" : "amber");
      const total = ph.chosenN * ph.perSatCostEur;
      const over = Math.max(0, ph.chosenN - ph.zeroGapN);
      setText(
        this.vOverbuild,
        over > 0
          ? `${fmtEuro(total)} · ${over} over min = ${fmtEuro(over * ph.perSatCostEur)} idle`
          : `${fmtEuro(total)} · ${ph.chosenN < ph.zeroGapN ? "under min — will gap" : "at minimum ✓"}`,
      );
      setValueClass(this.vOverbuild, over > 0 || ph.chosenN < ph.zeroGapN ? "amber" : "");
      const lo = ph.ladder[0]?.n ?? ph.chosenN;
      const hi = ph.ladder[ph.ladder.length - 1]?.n ?? ph.chosenN;
      this.lessBtn.disabled = ph.chosenN <= lo;
      this.moreBtn.disabled = ph.chosenN >= hi;
      this.constellationBtn.classList.toggle("ready", chosenHolds);
    } else {
      this.phasingGroup.style.display = "none";
    }

    // LAUNCH — reads READY before the first launch (point at the default).
    this.launchBtn.classList.toggle("ready", !state.launched);

    // HINT — gentle assist (shortfall) when stuck, else the next obvious step.
    if (state.shortfall) {
      setText(this.hint, state.shortfall);
      this.hint.className = "net-hint warn";
    } else if (ph) {
      const chosen = ph.ladder.find((r) => r.n === ph.chosenN);
      setText(
        this.hint,
        chosen?.holds
          ? `SIZE ${ph.chosenN} HOLDS the bar — PLACE SET to launch, or trim toward the ${ph.zeroGapN} minimum to cut idle capex`
          : `coverage GAPS at SIZE ${ph.chosenN} — step it up (+) until HELD clears the bar (min ${ph.zeroGapN}), then PLACE SET`,
      );
      this.hint.className = "net-hint";
    } else if (!state.launched) {
      if (p.served && p.coveredFraction >= 0.999) {
        setText(this.hint, "REGION-0 is fully covered — LAUNCH now, or drag ALTITUDE down / try LEO SWEEP to feel the tradeoff");
      } else {
        setText(this.hint, "DRAG the ORBIT sliders — watch the footprint + ground-track move on the globe until the RED gap goes GREEN, then LAUNCH");
      }
      this.hint.className = "net-hint";
    } else if (c && c.state === "offered") {
      setText(this.hint, "sat is up — open CONTRACTS (key 4) and ACCEPT to start earning");
      this.hint.className = "net-hint";
    } else if (this.servedNow) {
      setText(this.hint, "REGION-0 SERVED · revenue ticking — Act 1 complete");
      this.hint.className = "net-hint good";
    } else {
      setText(this.hint, "");
      this.hint.className = "net-hint";
    }
  }

  private syncSlider(field: NetDraftField, p: NetDraftParam): void {
    const input = this.draftSliders.get(field);
    if (input && document.activeElement !== input) {
      const next = String(Math.round(p.pos * 1000));
      if (input.value !== next) input.value = next;
    }
    const v = this.draftValues.get(field);
    if (v) setText(v, p.label);
  }

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
    return this.servedNow ? "· SERVED" : "· what & where";
  }
}

/**
 * net/ M1 — CONTRACTS (SD-44 PHASE 1): the deal board, split CLEANLY out of the launch menu. Carries
 * the OBJECTIVE banner (moved here as a header), a WALLET row, and the CONTRACTS list (one mini-card
 * per live deal with its enforced SLA terms, reward, live served% + term progress, and an inline
 * ACCEPT for offered ones). The accept machinery is moved VERBATIM — [data-net="accept"] (the headline
 * ACCEPT) + [data-net="accept-row"][data-contract-id] (the per-row buttons) live here now.
 */
export class NetContracts implements PanelHandle {
  readonly title = "CONTRACTS";
  readonly content: HTMLElement;

  // --- OBJECTIVE header ---
  private objectiveGroup: HTMLElement;
  private objectiveLegend: HTMLElement;
  private vObjTitle: HTMLElement;
  private vObjDetail: HTMLElement;

  // --- WALLET + headline ACCEPT ---
  private vBalance: HTMLElement;
  private vContractState: HTMLElement;
  private vEarned: HTMLElement;
  private acceptBtn: HTMLButtonElement;

  // --- CONTRACTS list ---
  private contractsHost: HTMLElement;
  private contractRows = new Map<string, { root: HTMLElement; head: HTMLElement; terms: HTMLElement; prog: HTMLElement; accept: HTMLButtonElement }>();
  private contractsSig = "";

  private worst: "ok" | "warn" | "crit" = "warn";
  private servedNow = false;

  constructor(private actions: NetPlannerActions) {
    this.content = el("div", "telem");

    // GROUP: OBJECTIVE — what the player is trying to do right now (the per-act goal, moved here).
    this.objectiveGroup = el("div", "group net-objective");
    this.objectiveLegend = el("div", "legend");
    this.objectiveLegend.textContent = "OBJECTIVE";
    this.vObjTitle = el("div", "net-obj-title");
    this.vObjDetail = el("div", "net-obj-detail");
    this.objectiveGroup.append(this.objectiveLegend, this.vObjTitle, this.vObjDetail);
    this.content.append(this.objectiveGroup);

    // GROUP: WALLET — the wallet (climbs as a served contract pays) + the headline REGION-0 + ACCEPT.
    const wallet = group("WALLET");
    this.vBalance = valueOf(row(wallet, "WALLET", "green"));
    this.vContractState = valueOf(row(wallet, "REGION-0"));
    this.vEarned = valueOf(row(wallet, "EARNED", "cyan"));
    const acceptRow = el("div", "net-buttons");
    this.acceptBtn = button("ACCEPT", "accept");
    this.acceptBtn.addEventListener("click", () => this.actions.onAccept());
    acceptRow.append(this.acceptBtn);
    wallet.append(acceptRow);
    this.content.append(wallet);

    // GROUP: CONTRACTS — the legible deal board (rows rebuilt only on a state-signature change).
    const contractsGroup = group("CONTRACTS");
    this.contractsHost = el("div", "net-contracts");
    contractsGroup.append(this.contractsHost);
    this.content.append(contractsGroup);
  }

  render(state: NetPlannerRenderState): void {
    // OBJECTIVE.
    const obj = state.objective;
    if (obj) {
      this.objectiveGroup.style.display = "";
      setText(this.objectiveLegend, `OBJECTIVE · ${obj.actLabel}`);
      setText(this.vObjTitle, obj.title);
      setText(this.vObjDetail, obj.detail);
    } else {
      this.objectiveGroup.style.display = "none";
    }

    // CONTRACTS list.
    this.syncContracts(state.contracts);

    // WALLET.
    setText(this.vBalance, fmtEuro(state.balanceEur));
    setValueClass(this.vBalance, state.balanceEur < 0 ? "red" : "green");

    // REGION-0 STATE.
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

    // The headline ACCEPT is live only while the contract is OFFERED.
    const canAccept = !!c && c.state === "offered";
    this.acceptBtn.disabled = !canAccept;
    this.acceptBtn.classList.toggle("ready", canAccept);
  }

  private syncContracts(contracts: NetContractRow[]): void {
    const sig = contracts.map((c) => `${c.id}:${c.state}`).join("|");
    if (sig !== this.contractsSig) {
      this.contractsSig = sig;
      this.contractsHost.replaceChildren();
      this.contractRows.clear();
      if (contracts.length === 0) {
        const empty = el("div", "net-contract-empty");
        empty.textContent = "— no contracts yet —";
        this.contractsHost.append(empty);
      }
      for (const c of contracts) {
        const root = el("div", "net-contract");
        const head = el("div", "net-contract-head");
        const terms = el("div", "net-contract-terms");
        const prog = el("div", "net-contract-prog");
        const accept = button("ACCEPT", "accept-row");
        accept.dataset.contractId = c.id;
        accept.addEventListener("click", () => this.actions.onAccept(c.id));
        root.append(head, terms, prog, accept);
        this.contractsHost.append(root);
        this.contractRows.set(c.id, { root, head, terms, prog, accept });
      }
    }
    for (const c of contracts) {
      const r = this.contractRows.get(c.id);
      if (!r) continue;
      const stateWord =
        c.state === "offered" ? "OFFERED"
        : c.state === "active" ? (c.served ? "SERVED ✓" : "UNSERVED")
        : c.state === "completed" ? "✓ DONE"
        : "✕ ENDED";
      const tone =
        c.state === "offered" ? "cyan"
        : c.state === "active" ? (c.served ? "green" : "amber")
        : c.state === "completed" ? "green"
        : "red";
      r.head.className = `net-contract-head ${tone}`;
      setText(r.head, `${c.label} · ${stateWord}`);
      setText(r.terms, `${c.terms} · +€${Math.round(c.rewardPerHr)}/hr`);
      if (c.state === "active") {
        setText(r.prog, `served ${fmtPct(c.servedFraction)} · term ${fmtPct(c.progressFraction)} · earned ${fmtEuro(c.earnedEur)}`);
        r.prog.className = "net-contract-prog";
        r.prog.style.display = "";
      } else if (c.state === "offered") {
        // PRICE-THE-BET: the wager, not "click to earn" — reward vs the penalty DOWNSIDE, then whether
        // the current fleet would actually hold it (a pure preview). Accepting an un-servable contract
        // is a deliberate penalty gamble; a servable one is free money.
        const bet = `BET +€${Math.round(c.rewardPerHr)}/hr vs −€${Math.round(c.penaltyPerHr)}/hr if it FAILs`;
        const verdict =
          c.previewServable === null ? ""
          : c.previewServable ? " · fleet HOLDS this ✓ — accept"
          : ` · fleet would BREACH ${c.previewBreachAxis} — fix first, or accept the penalty risk`;
        setText(r.prog, bet + verdict);
        r.prog.className = `net-contract-prog${c.previewServable === false ? " amber" : c.previewServable ? " green" : ""}`;
        r.prog.style.display = "";
      } else {
        setText(r.prog, `earned ${fmtEuro(c.earnedEur)}`);
        r.prog.style.display = "";
      }
      r.accept.style.display = c.state === "offered" ? "" : "none";
      r.accept.classList.toggle("ready", c.state === "offered");
    }
  }

  status(): "ok" | "warn" | "crit" {
    return this.worst;
  }

  subtitle(): string {
    return this.servedNow ? "· SERVED" : "· the deals";
  }
}

/**
 * net/ M1 — ROUTING·PREFER (SD-44 PHASE 1): the §7.3/§10 per-contract latency ↔ bandwidth ↔ stability
 * tuner, split onto its own tile. The selector + slider machinery is moved VERBATIM — [data-net="prefer"]
 * + [data-net="prefer-select"] live here now. When state.prefer == null the tile shows a dim "no traffic
 * to route yet" line instead of the controls.
 */
export class NetPrefer implements PanelHandle {
  readonly title = "ROUTING·PREFER";
  readonly content: HTMLElement;

  private preferGroup: HTMLElement;
  private emptyLine: HTMLElement;
  private vPreferContract: HTMLElement;
  private vPreferClass: HTMLElement;
  private vPreferWeights: HTMLElement;
  private vReroute: HTMLElement;
  private preferSelectBtn: HTMLButtonElement;
  private preferSlider: HTMLInputElement;
  private preferContractId: string | null = null;
  private controls: HTMLElement;

  constructor(private actions: NetPlannerActions) {
    this.content = el("div", "telem");

    this.preferGroup = group("ROUTING · PREFER (§7.3)");

    // The dim empty-state line (shown until ≥1 active contract exists).
    this.emptyLine = el("div", "net-hint");
    this.emptyLine.textContent = "no traffic to route yet — accept a contract and launch";
    this.preferGroup.append(this.emptyLine);

    // The controls (hidden until there is something to tune).
    this.controls = el("div", "net-prefer-controls");
    const pRow = el("div", "row");
    const pLab = el("span", "label");
    pLab.textContent = "CONTRACT";
    this.vPreferContract = el("span", "v cyan");
    pRow.append(pLab, this.vPreferContract);
    this.controls.append(pRow);
    this.vPreferClass = valueOf(row(this.controls, "CLASS", "green"));
    this.vPreferWeights = valueOf(row(this.controls, "WEIGHTS"));
    // REROUTE PREVIEW — the contract's current bridge + where preferring bandwidth would move it.
    this.vReroute = valueOf(row(this.controls, "REROUTE", ""));
    const sRow = el("div", "net-slider");
    const sHead = el("div", "row");
    const sLab = el("span", "label");
    sLab.textContent = "LAT ↔ BW ↔ STAB";
    sHead.append(sLab);
    this.preferSlider = document.createElement("input");
    this.preferSlider.type = "range";
    this.preferSlider.min = "0";
    this.preferSlider.max = "1000";
    this.preferSlider.step = "1";
    this.preferSlider.className = "net-range";
    this.preferSlider.dataset.net = "prefer";
    this.preferSlider.addEventListener("input", () => {
      if (this.preferContractId !== null) {
        this.actions.onSetPrefer(this.preferContractId, Number(this.preferSlider.value) / 1000);
      }
    });
    sRow.append(sHead, this.preferSlider);
    this.controls.append(sRow);
    const pBtnRow = el("div", "net-buttons");
    this.preferSelectBtn = button("SELECT CONTRACT", "prefer-select");
    this.preferSelectBtn.addEventListener("click", () => this.actions.onSelectPreferContract());
    pBtnRow.append(this.preferSelectBtn);
    this.controls.append(pBtnRow);
    this.controls.style.display = "none";
    this.preferGroup.append(this.controls);

    this.content.append(this.preferGroup);
  }

  render(state: NetPlannerRenderState): void {
    const pc = state.prefer;
    if (pc) {
      this.emptyLine.style.display = "none";
      this.controls.style.display = "";
      this.preferContractId = pc.contractId;
      setText(this.vPreferContract, pc.label);
      setText(this.vPreferClass, `${pc.trafficClass}-class`);
      setText(
        this.vPreferWeights,
        `lat ${pc.prefer.lat.toFixed(2)} · bw ${pc.prefer.bw < 0.01 && pc.prefer.bw > 0 ? pc.prefer.bw.toExponential(0) : pc.prefer.bw.toFixed(2)} · stab ${pc.prefer.stab.toFixed(2)} (dormant)`,
      );
      // REROUTE PREVIEW — make the slider's effect legible: where the contract bridges now (+ that
      // sat's load) and where preferring BANDWIDTH would move it (the congestion-relief alternative).
      const cur = pc.currentSat
        ? `${pc.currentSat} ${Math.round(pc.currentUtil * 100)}%${pc.currentUtil >= 1 ? " OVER" : ""}`
        : "unserved";
      if (pc.currentSat === null) {
        setText(this.vReroute, "unserved — launch over it first");
        setValueClass(this.vReroute, "amber");
      } else if (pc.wouldReroute && pc.altSat) {
        setText(this.vReroute, `on ${cur} → prefer bw: ${pc.altSat} ${Math.round(pc.altUtil * 100)}%`);
        setValueClass(this.vReroute, pc.altUtil < pc.currentUtil ? "green" : "");
      } else {
        setText(this.vReroute, `on ${cur} · no lighter path${pc.currentUtil >= 1 ? " — launch capacity" : ""}`);
        setValueClass(this.vReroute, pc.currentUtil >= 1 ? "amber" : "");
      }
      if (document.activeElement !== this.preferSlider) {
        const next = String(Math.round(pc.pos * 1000));
        if (this.preferSlider.value !== next) this.preferSlider.value = next;
      }
      this.preferSelectBtn.disabled = !pc.canSelect;
      this.preferSelectBtn.classList.toggle("ready", pc.canSelect);
    } else {
      this.emptyLine.style.display = "";
      this.controls.style.display = "none";
      this.preferContractId = null;
    }
  }

  subtitle(): string {
    return this.preferContractId ? "· tuning" : "· idle";
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
