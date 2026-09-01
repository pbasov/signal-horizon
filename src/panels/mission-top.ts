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
import {
  ScrubNumber,
  AltitudeProfile,
  InclinationDial,
  PhaseRing,
  CompareTable,
  type CompareRow,
  type PhaseRingState,
} from "./pad-instruments";
import type { NetContractRow } from "./net-planner";
import { ANTENNA_CARDS, BUS_SPECS, type BusTier } from "../sim/net/sat";
import { MISSION_OBJECTIVES, TENDER_BET, TENDER_SIGNON_BONUS, TENDER_PAY_DECAY, TENDER_BREACH_GRACE, STACK_BATCH_DISCOUNT, SLOT_G_LABEL, SLOT_S_LABEL } from "./copy";
import { NET_BATCH_MEMBER_DISCOUNT } from "../sim/net/world";

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
  /** FL-04 — the slot-indexed fit (G slots first, then S): what the silhouette renders. */
  slots: readonly (string | null)[];
  count: number;
  draft: PadDraftReadout;
  /** Itemized stack: one vehicle + count × hardware. */
  stack: { vehicleEur: number; hardwareEur: number; totalEur: number };
  /** Physics facts of the draft (period; parks flag; one-way latency to the comb region;
   * FL-12 time-to-service — sim-seconds until first serve; Infinity = never this horizon). */
  facts: { periodS: number; parks: boolean; latencyMs: number | null; timeToServeS: number };
  comb: { windows: boolean[]; duty: number } | null;
  /** The FLEET's live windows over the same span (null = no fleet yet) — the gaps row. */
  combFleet: { windows: boolean[]; duty: number } | null;
  combRegionLabel: string;
  armed: boolean;
  /** Loadout validation problem (null = valid). */
  problem: string | null;
  /** A physics/eligibility RULES FACT about the current design vs the target tender
   * (LAW 1: facts the player needs, never solved answers). Null = nothing to say. */
  padFact: string | null;
  /** FL-10 — the honest launch-risk line (null while failures are dark: act 1 + maiden). */
  riskBand: string | null;
  /** R3 — the live SCENARIO FALLBACK (the stuck-assist): a fact-shortfall string surfaced by
   * the current beat while the player is stuck (null = nothing to assist). Lives on the BOOK
   * face, right under the objective — the formerly homeless assist strings. */
  shortfall: string | null;

  // ── the launch-interface rewrite ────────────────────────────────────────────────
  /** WHO THIS LAUNCH IS FOR — pinned across the top of the pad the whole time you aim.
   * Opening the pad used to REPLACE the tender board, so the thing you were aiming at was
   * the one thing you could not see. Null when no demand is on the board yet. */
  padTarget: {
    label: string;
    state: string;
    terms: string;
    payPerHr: number;
    penaltyPerHr: number;
    /** The region's latitude (deg) — the inclination dial marks it. */
    latDeg: number | null;
  } | null;
  /** Draft-versus-requirement rows: your number beside the tender's, on a shared bar. */
  compare: CompareRow[];
  /** Surface half-angle (deg) the drafted loadout paints from the drafted altitude. */
  footprintDeg: number;
  /** The altitude band the pad allows + the parking altitude, for the profile instrument. */
  band: { minKm: number; maxKm: number; parkKm: number };
  /** The ring this launch joins — what you already fly, what this adds, where the hole is. */
  ring: PhaseRingState;
}

export interface MissionTopActions {
  onMode(mode: "book" | "pad"): void;
  onAccept(contractId: string): void;
  /** §7.3 — route bias for an ACTIVE tender: pos 0 = shortest path, 0.5 = spread around
   * congestion. The first thing the player tunes. */
  onRoute(contractId: string, pos: number): void;
  /** Act 4 — commit the deep-space relay toward the Mars tender (one verb, one click). */
  onMarsRelay(): void;
  /** SD-53 — THE PULL to the routing screen. The behavioural falsifier for TRACE is whether a
   * tester opens it BEFORE a shortfall fires, and that cannot even be measured if there is no path
   * to the screen. The shortfall line is the hand-off from "a red thing appeared" to "here is why":
   * it summons TRACE into the focused tile. MISSION keeps the line either way — TRACE deepens the
   * read, it never gates it (GDD §5: no critical state should require digging). */
  onOpenTrace?(): void;
  onBus(bus: BusTier): void;
  /** FL-04 — write (or clear, cardId=null) ONE named slot of the bus silhouette. The
   * flat toggle set is gone: capacity design is slot assignment, visibly physical. */
  onSlotCard(slot: number, cardId: string | null): void;
  /** FL-06 — fit the planner's VIABLE-BUT-IMPERFECT suggestion (spec §3.2: the assist
   * solves legality, never the puzzle). Clears the player's fit and fills from the axes. */
  onFit(): void;
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

const CARD_TIPS: Record<string, string> = {
  BROADCAST:
    "BROADCAST — a down-only floodlight: serves EVERY latency-tolerant tender inside its footprint, no pointing needed. Cannot carry a latency SLA. Pipe capacity is shared by all riders.",
  ACCESS_S:
    "ACCESS-S — a small spot beam: serves EXACTLY ONE region and must be POINTED at it after deploy (fleet strip). Carries latency SLAs.",
  ACCESS_L:
    "ACCESS-L — a large spot beam: one region at a time, pointed after deploy. Twice the pipe of ACCESS-S.",
  GATEWAY: "GATEWAY — the fat symmetric pipe. Pointed like a spot beam; the biggest single pipe you can fly.",
  CROSSLINK: "CROSSLINK — sat-to-sat relay hardware (S slot). Inert for now; relay routing arrives with the solver depth.",
};

const PARAM_TIPS: Record<string, string> = {
  altKm: "Altitude above the toy surface. Low = small fast-moving footprint, short light path. High (535 km = GEO) = huge footprint that PARKS over one longitude, longer light path.",
  incDeg: "Orbital tilt. 0° stays over the equator; higher inclinations reach higher latitudes.",
  subLonDeg: "The longitude the orbit is anchored over at commit (a parked GEO stays there). THE aim.",
  raanDeg: "Rotates the orbital plane around the pole — slides where an inclined ground-track crosses.",
  phaseSpreadDeg: "How far apart batch members ride along the SAME orbit. 0° stacks them uselessly; 360°/count spaces them evenly for hand-offs.",
};

const AXIS_PIPS: { key: "latency" | "availability" | "bandwidth"; glyph: string }[] = [
  { key: "latency", glyph: "LAT" },
  { key: "availability", glyph: "AVL" },
  { key: "bandwidth", glyph: "BW" },
];

/** FL-15a — canvas-fills read TOKENS (never raw hex): resolved from :root custom props,
 * memoized per frame-call is overkill — cache the getter and resolve on demand. */
let combTokCache: { bg: string; cellOff: string; fleetDim: string; cyan: string } | null = null;
function combTokenColors(): { bg: string; cellOff: string; fleetDim: string; cyan: string } {
  if (combTokCache === null) {
    const cs = getComputedStyle(document.documentElement);
    const tok = (name: string, fallback: string) => cs.getPropertyValue(name).trim() || fallback;
    combTokCache = {
      bg: tok("--bg", "black"),
      cellOff: tok("--bg-2", "black"),
      fleetDim: tok("--cyan-dim", "teal"),
      cyan: tok("--cyan", "aqua"),
    };
  }
  return combTokCache;
}

export class MissionTop implements PanelHandle {
  readonly title = "MISSION";
  readonly content: HTMLElement;

  private readonly vLegend: HTMLElement;
  private readonly modeBtn: HTMLButtonElement;

  // BOOK face
  private readonly bookFace: HTMLElement;
  private readonly vObjTitle: HTMLElement;
  private readonly vObjDetail: HTMLElement;
  private readonly vObjNext: HTMLElement;
  private readonly vShortfall: HTMLElement;
  private readonly tendersHost: HTMLElement;
  private tenderSig = "";
  private tenderEls = new Map<string, { state: HTMLElement; served: HTMLElement; facts: HTMLElement; bet: HTMLElement }>();

  // PAD face
  private readonly padFace: HTMLElement;
  private busBtns = new Map<BusTier, HTMLButtonElement>();
  /** FL-04 — the bus silhouette: one button per SLOT (up to 4 across the two buses),
   * plus the per-slot chooser row rendered under them for the selected slot. */
  private slotBtns: HTMLButtonElement[] = [];
  private readonly slotClassLegend: HTMLElement;
  private readonly slotChooser: HTMLElement;
  /** UI-only: which slot the chooser is open for (−1 = closed). */
  private selectedSlot = -1;
  private readonly vCount: HTMLElement;
  // The launch instruments (pad-instruments.ts) — the pictures that replaced the five
  // spinner boxes of raw orbital elements.
  private readonly vTargetHead: HTMLElement;
  private readonly vTargetTerms: HTMLElement;
  private readonly vTargetBet: HTMLElement;
  private readonly compare = new CompareTable();
  private readonly profile: AltitudeProfile;
  private readonly incDial: InclinationDial;
  private readonly phaseRing: PhaseRing;
  private readonly scrubs = new Map<keyof PadDraftReadout, ScrubNumber>();
  private readonly combCanvas: HTMLCanvasElement;
  private readonly vCombLabel: HTMLElement;
  private readonly vFacts: HTMLElement;
  private readonly vStack: HTMLElement;
  private readonly vProblem: HTMLElement;
  private readonly vRisk: HTMLElement;
  private readonly vPadFact: HTMLElement;
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
    this.vObjNext = el("div", "mission-next", "");
    objGroup.appendChild(this.vObjNext);
    // R3 — the SHORTFALL line: the stuck-assist (facts that name the shortfall, LAW 1/2),
    // right under the objective where a stuck player is already looking.
    this.vShortfall = el("div", "mission-shortfall", "");
    this.vShortfall.setAttribute("data-net", "mission-shortfall");
    this.vShortfall.addEventListener("click", () => this.actions.onOpenTrace?.());
    objGroup.appendChild(this.vShortfall);
    this.tendersHost = el("div", "group mission-tenders");
    this.bookFace.append(objGroup, this.tendersHost);
    this.content.appendChild(this.bookFace);

    // --- PAD face ---
    this.padFace = el("div", "mission-pad");

    // WHO THIS IS FOR — pinned at the top of the pad for the whole aim. The pad used to
    // swap the tender board away, hiding the requirement while you designed against it.
    const targetGroup = el("div", "group pad-target");
    this.vTargetHead = el("div", "pad-target-head", "");
    this.vTargetTerms = el("div", "pad-target-terms", "");
    this.vTargetBet = el("div", "pad-target-bet", "");
    targetGroup.append(this.vTargetHead, this.vTargetTerms, this.vTargetBet);
    targetGroup.appendChild(this.compare.root);
    this.padFace.appendChild(targetGroup);

    const busGroup = el("div", "group");
    busGroup.appendChild(el("div", "legend", "BUS"));
    const busRow = el("div", "mission-row");
    for (const tier of ["smallsat", "comsat"] as BusTier[]) {
      const spec = BUS_SPECS[tier];
      const b = btn(`${spec.label} ${spec.gSlots}G+${spec.sSlots}S €${spec.priceEur}`, "net-btn mission-bus", () =>
        this.actions.onBus(tier),
      );
      b.title =
        tier === "smallsat"
          ? "T1 SMALLSAT — one ground-facing (G) slot, one sat-facing (S) slot. Cheap, one pipe, one place."
          : "T2 COMSAT — two G slots + two S slots. More pipes on one launch (cheaper per unit), but one orbit position and one fault domain.";
      b.setAttribute("data-net", `bus-${tier}`);
      this.busBtns.set(tier, b);
      busRow.appendChild(b);
    }
    busGroup.appendChild(busRow);
    // FL-04 — THE SILHOUETTE: named slots (G1 … S2) you write cards into. A click on a slot
    // opens the chooser for that slot's class; a card click assigns it THERE (duplicates
    // across slots are legal — two ACCESS-S is a design). Occupied slots read ▣, empty ▢ —
    // shape + label, never colour alone (§8 CVD).
    const slotRow = el("div", "mission-slots");
    for (let i = 0; i < 4; i++) {
      const b = btn("", "net-btn mission-slot", () => this.pickSlot(i));
      b.setAttribute("data-net", `slot-${i}`);
      this.slotBtns.push(b);
      slotRow.appendChild(b);
    }
    busGroup.appendChild(slotRow);
    this.slotClassLegend = el("div", "mission-hint", "");
    busGroup.appendChild(this.slotClassLegend);
    // FL-06 — the FIT assist: fills the silhouette with the viable-but-imperfect suggestion
    // for the target tender's axes (greedy legality; the optimal fit is never handed over).
    const fitBtn = btn("FIT", "net-btn mission-fit", () => this.actions.onFit());
    fitBtn.setAttribute("data-net", "fit");
    fitBtn.title =
      "A safe, legal fit for the standing terms — never the best one. What it leaves empty (extra slots, spare capacity, bigger pipes) is yours to decide.";
    busGroup.appendChild(fitBtn);
    this.slotChooser = el("div", "mission-slotchooser");
    busGroup.appendChild(this.slotChooser);
    this.padFace.appendChild(busGroup);

    // ── HOW HIGH — the altitude profile: a side-on cut with the beam drawn onto the
    // surface, so the footprint visibly opens out as the orbit climbs.
    const altGroup = el("div", "group pad-instrument");
    altGroup.appendChild(el("div", "legend", "ALTITUDE"));
    this.profile = new AltitudeProfile((km) => this.actions.onParam("altKm", km));
    altGroup.appendChild(this.profile.root as unknown as HTMLElement);
    const altScrub = new ScrubNumber({
      label: "",
      unit: "km",
      min: 10,
      max: 535,
      perPx: 1.5,
      step: 1,
      title: PARAM_TIPS.altKm,
      dataNet: "param-altKm",
      onChange: (v) => this.actions.onParam("altKm", v),
    });
    this.scrubs.set("altKm", altScrub);
    altGroup.appendChild(altScrub.root);
    this.padFace.appendChild(altGroup);

    // ── HOW FAR NORTH — the inclination dial, marked with the customer's latitude.
    const incGroup = el("div", "group pad-instrument");
    incGroup.appendChild(el("div", "legend", "INCLINATION"));
    this.incDial = new InclinationDial((deg) => this.actions.onParam("incDeg", deg));
    incGroup.appendChild(this.incDial.root as unknown as HTMLElement);
    const incScrub = new ScrubNumber({
      label: "",
      unit: "°",
      min: 0,
      max: 90,
      perPx: 0.5,
      step: 1,
      title: PARAM_TIPS.incDeg,
      dataNet: "param-incDeg",
      onChange: (v) => this.actions.onParam("incDeg", v),
    });
    this.scrubs.set("incDeg", incScrub);
    incGroup.appendChild(incScrub.root);
    this.padFace.appendChild(incGroup);

    // ── WHERE — the aim. The globe is the primary control (click a place); the number is
    // the exact readout you can also scrub.
    const whereGroup = el("div", "group pad-instrument");
    whereGroup.appendChild(el("div", "legend", "WHERE IT SITS"));
    const aimHint = el("div", "mission-hint", "click anywhere on the globe to aim this launch there");
    whereGroup.appendChild(aimHint);
    const lonScrub = new ScrubNumber({
      label: "SUB-LON",
      unit: "°",
      min: -180,
      max: 180,
      perPx: 0.5,
      step: 1,
      title: PARAM_TIPS.subLonDeg,
      dataNet: "param-subLonDeg",
      onChange: (v) => this.actions.onParam("subLonDeg", v),
    });
    this.scrubs.set("subLonDeg", lonScrub);
    whereGroup.appendChild(lonScrub.root);
    const raanScrub = new ScrubNumber({
      label: "RAAN",
      unit: "°",
      min: 0,
      max: 360,
      perPx: 0.5,
      step: 1,
      title: PARAM_TIPS.raanDeg,
      dataNet: "param-raanDeg",
      onChange: (v) => this.actions.onParam("raanDeg", v),
    });
    this.scrubs.set("raanDeg", raanScrub);
    whereGroup.appendChild(raanScrub.root);
    this.padFace.appendChild(whereGroup);

    // ── THE RING — what you already fly on this orbit, what this launch adds, and the hole
    // between them. This is the answer to "one of my three died, where does the new one go".
    const ringGroup = el("div", "group pad-instrument");
    ringGroup.appendChild(el("div", "legend", "THE RING"));
    this.phaseRing = new PhaseRing();
    ringGroup.appendChild(this.phaseRing.root as unknown as HTMLElement);
    const countRow = el("div", "mission-param");
    countRow.appendChild(el("span", "mission-param-label", "BATCH"));
    const minus = btn("−", "net-btn mission-step", () => this.actions.onCount(-1));
    minus.setAttribute("data-net", "count-minus");
    this.vCount = el("span", "mission-count", "1");
    const plus = btn("+", "net-btn mission-step", () => this.actions.onCount(1));
    plus.setAttribute("data-net", "count-plus");
    countRow.append(minus, this.vCount, plus);
    ringGroup.appendChild(countRow);
    const spreadScrub = new ScrubNumber({
      label: "PHASE SPREAD",
      unit: "°",
      min: 0,
      max: 360,
      perPx: 1,
      step: 5,
      title: PARAM_TIPS.phaseSpreadDeg,
      dataNet: "param-phaseSpreadDeg",
      onChange: (v) => this.actions.onParam("phaseSpreadDeg", v),
    });
    this.scrubs.set("phaseSpreadDeg", spreadScrub);
    ringGroup.appendChild(spreadScrub.root);
    this.padFace.appendChild(ringGroup);

    const combGroup = el("div", "group");
    this.vCombLabel = el("div", "legend", "COVERAGE COMB");
    combGroup.appendChild(this.vCombLabel);
    this.combCanvas = document.createElement("canvas");
    this.combCanvas.className = "mission-comb";
    this.combCanvas.title =
      "The coverage comb, one draft-orbit left to right. TOP row: your CURRENT fleet's line-of-sight windows over the target (the gaps are the dark cells). BOTTOM row: fleet + THIS launch together — aim until the bottom row is solid where the top row gapped.";
    this.combCanvas.width = 288;
    this.combCanvas.height = 34;
    combGroup.appendChild(this.combCanvas);
    this.vFacts = el("div", "mission-hint", "");
    this.vFacts.title = "Physics of the draft: how much of one orbit the target sees it, the orbital period, whether it PARKS (period == day), and the one-way light time to the target.";
    combGroup.appendChild(this.vFacts);
    this.padFace.appendChild(combGroup);

    const commitGroup = el("div", "group");
    this.vStack = el("div", "mission-stack", "");
    this.vRisk = el("div", "mission-hint", "");
    this.vProblem = el("div", "mission-problem", "");
    this.vPadFact = el("div", "mission-fact", "");
    this.armBtn = btn("ARM", "net-btn mission-arm", () => this.actions.onArm());
    this.armBtn.setAttribute("data-net", "arm");
    this.armBtn.title = "Two-step commit: ARM, then LAUNCH. The stack price is charged win or lose.";
    this.launchBtn = btn("LAUNCH", "net-btn mission-launch", () => this.actions.onLaunch());
    this.launchBtn.setAttribute("data-net", "launch");
    commitGroup.append(this.vStack, this.vRisk, this.vPadFact, this.vProblem, this.armBtn, this.launchBtn);
    this.padFace.appendChild(commitGroup);

    this.content.appendChild(this.padFace);
  }

  private lastMode: "book" | "pad" = "book";

  /** FL-04 — (de)select a slot: reselect closes the chooser; select opens its class menu.
   * UI-only state; the slot write goes through actions.onSlotCard. */
  private pickSlot(i: number): void {
    this.selectedSlot = this.selectedSlot === i ? -1 : i;
    this.rebuildSlotChrome();
  }

  /** Rebuild the slot buttons + the (possibly closed) chooser from the last pad state. */
  private rebuildSlotChrome(): void {
    if (!this.lastPad) return;
    const s = this.lastPad;
    const spec = BUS_SPECS[s.bus];
    const n = spec.gSlots + spec.sSlots;
    this.slotBtns.forEach((b, i) => {
      if (i >= n) {
        b.style.display = "none";
        return;
      }
      b.style.display = "";
      const cls = i < spec.gSlots ? "G" : "S";
      const cardId = s.slots[i] ?? null;
      const card = cardId === null ? null : ANTENNA_CARDS.find((c) => c.id === cardId) ?? null;
      b.textContent = `${cls}${(i < spec.gSlots ? i : i - spec.gSlots) + 1} ${card ? "▣ " + card.label : "▢ —"}`;
      b.title =
        (cls === "G" ? SLOT_G_LABEL : SLOT_S_LABEL) +
        " slot" +
        (card ? ` — fitted: ${card.label}. ${CARD_TIPS[card.id] ?? ""}` : " — empty. An unfitted sat flies the standard BROADCAST (charged for it).");
      b.classList.toggle("filled", card !== null);
      b.classList.toggle("sel", this.selectedSlot === i);
    });
    this.slotClassLegend.textContent = `${spec.label} · ${spec.gSlots} ${SLOT_G_LABEL} · ${spec.sSlots} ${SLOT_S_LABEL}`;
    // The chooser for the selected slot's class (or none).
    this.slotChooser.textContent = "";
    if (this.selectedSlot >= 0 && this.selectedSlot < n) {
      const cls = this.selectedSlot < spec.gSlots ? "G" : "S";
      for (const card of ANTENNA_CARDS.filter((c) => c.slot === cls)) {
        const b = btn(
          `${card.label} ${card.capacityUnits.toFixed(1)}u €${card.priceEur}`,
          "net-btn mission-card",
          () => {
            this.actions.onSlotCard(this.selectedSlot, card.id);
          },
        );
        b.setAttribute("data-net", `card-${card.id}`);
        b.title = CARD_TIPS[card.id] ?? "";
        b.classList.toggle("active", s.slots[this.selectedSlot] === card.id);
        this.slotChooser.appendChild(b);
      }
      const clear = btn("EMPTY", "net-btn mission-card", () => {
        this.actions.onSlotCard(this.selectedSlot, null);
      });
      clear.setAttribute("data-net", "card-clear");
      this.slotChooser.appendChild(clear);
    }
  }

  /** The last pad state (the chooser re-renders off it after a slot pick). */
  private lastPad: MissionTopState | null = null;

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
    // NEXT: the next act by name. The sequence makes sense (each is "the next thing you'd
    // want if you'd won this"); reading ahead tells you what you'd have TODAY if you were
    // already on the far side of the gate.
    const nextObj = MISSION_OBJECTIVES[s.act + 1];
    this.vObjNext.textContent = nextObj ? `next — ${nextObj.title.toLowerCase()}` : "";
    this.vObjNext.style.display = nextObj ? "" : "none";
    this.vShortfall.textContent = s.shortfall ?? "";
    this.vShortfall.style.display = s.shortfall ? "" : "none";

    // Rebuild tender rows only on a signature change; refresh live numbers in place.
    const sig = s.tenders.map((t) => `${t.id}:${t.state}:${t.terms}`).join("|");
    if (sig !== this.tenderSig) {
      this.tenderSig = sig;
      this.tendersHost.textContent = "";
      this.tenderEls.clear();
      // FL-UX: history is a STRIP, not a row — FAILED (and completed) tenders collapse to
      // one dim line ("equatorial metro — FAILED · lapsed unsigned after 2h"); the parse is
      // where history lives in detail. The FACE of the book is the live market only.
      const historyRows = s.tenders.filter((t) => t.state === "failed" || t.state === "completed");
      const liveRows = s.tenders.filter((t) => t.state !== "failed" && t.state !== "completed");
      if (historyRows.length > 0) {
        const strip = el(
          "div",
          "mission-history",
          historyRows.map((t) => `${t.id} ${t.state.toUpperCase()}`).join("  ·  "),
        );
        strip.title = "Past tenders (contract ids; labels collide across renewals — the id is the identity). Detail lives in THE PARSE (REVIEW).";
        this.tendersHost.appendChild(strip);
      }
      for (const t of liveRows) {
        const row = el("div", "mission-tender");
        const head = el("div", "mission-tender-head");
        head.appendChild(el("span", "mission-tender-label", t.label));
        const state = el("span", "mission-tender-state", t.state.toUpperCase());
        head.appendChild(state);
        row.appendChild(head);
        const pips = el("div", "mission-pips");
        pips.title = "SLA axes this tender enforces: LAT = a latency ceiling · AVL = held continuously as sats move · BW = a committed bandwidth floor on a shared pipe.";
        for (const p of AXIS_PIPS) {
          const on = t.terms.toLowerCase().includes(p.key === "latency" ? "ms" : p.key === "availability" ? "avail" : "bps");
          pips.appendChild(el("span", `mission-pip${on ? " on" : ""}`, p.glyph));
        }
        pips.appendChild(el("span", "mission-terms", t.terms));
        row.appendChild(pips);
        // FL-08: an offered tender shows the BOARD price (the pay a signature would
        // freeze at NOW — decayed, live) not the full-fat headline.
        const bet = el("div", "mission-tender-bet", "");
        row.appendChild(bet);
        // FL-08 — the tender FACTS row (bonus countdown / decay tempo / breach grace).
        // Facts only (LAW 1); updated live (the bonus clock ticks) so it survives the
        // signature-gated rebuild as an in-place text refresh.
        const facts = el("div", "mission-tender-facts", "");
        row.appendChild(facts);
        const served = el("div", "mission-tender-served", "");
        row.appendChild(served);
        if (t.state === "offered") {
          if (t.id.startsWith("MARS")) {
            const relay = btn("LAUNCH DEEP-SPACE RELAY", "net-btn mission-accept", () => this.actions.onMarsRelay());
            relay.setAttribute("data-net", "mars-relay");
            relay.title = "Commits a relay vehicle toward Mars. Its signal will take minutes each way — watch it crawl.";
            row.appendChild(relay);
          }
          const accept = btn("SIGN", "net-btn mission-accept", () => this.actions.onAccept(t.id));
          accept.setAttribute("data-net", "accept");
          accept.setAttribute("data-contract", t.id);
          row.appendChild(accept);
        }
        if (t.state === "active") {
          const routeRow = el("div", "mission-route");
          routeRow.title =
            "Route bias for this tender's traffic: SHORT chases the lowest-latency pipe; SPREAD leaves a congested pipe for a parallel one. A fact of preference — the solver still picks the path.";
          routeRow.appendChild(el("span", "mission-param-label", "ROUTE"));
          const short = btn("SHORT", "net-btn mission-route-btn", () => this.actions.onRoute(t.id, 0));
          short.setAttribute("data-net", "route-short");
          short.setAttribute("data-contract", t.id);
          const spread = btn("SPREAD", "net-btn mission-route-btn", () => this.actions.onRoute(t.id, 0.5));
          spread.setAttribute("data-net", "route-spread");
          spread.setAttribute("data-contract", t.id);
          routeRow.append(short, spread);
          row.appendChild(routeRow);
        }
        this.tendersHost.appendChild(row);
        this.tenderEls.set(t.id, { state, served, facts, bet });
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
            ? t.expiresInS !== null
              ? `tender lapses in ${Math.floor(t.expiresInS / 60)}m ${Math.floor(t.expiresInS % 60)}s`
              : ""
            : `€${Math.round(t.earnedEur).toLocaleString("en-US")}`;
      // FL-08 — facts + board price live-update per frame (the bonus clock + decay tick).
      els.bet.textContent = TENDER_BET(
        `€${Math.round(t.state === "offered" ? t.boardPayPerHr : t.rewardPerHr).toLocaleString("en-US")}/hr`,
        `€${Math.round(t.penaltyPerHr).toLocaleString("en-US")}/hr`,
      );
      if (t.state === "offered") {
        const mmss = (sec: number) => `${Math.floor(sec / 60)}m ${String(Math.floor(sec % 60)).padStart(2, "0")}s`;
        const parts: string[] = [];
        if (t.bonusEur !== null && t.bonusLapsesInS !== null)
          parts.push(TENDER_SIGNON_BONUS(Math.round(t.bonusEur).toLocaleString("en-US"), mmss(t.bonusLapsesInS)));
        if (t.decayHalvingS !== null) parts.push(TENDER_PAY_DECAY(mmss(t.decayHalvingS)));
        parts.push(TENDER_BREACH_GRACE(mmss(t.graceS)));
        els.facts.textContent = parts.join("  ·  ");
      } else {
        els.facts.textContent = "";
      }
    }
  }

  private renderPad(s: MissionTopState): void {
    this.lastPad = s;
    for (const [tier, b] of this.busBtns) b.classList.toggle("active", tier === s.bus);
    if (this.selectedSlot >= s.slots.length) this.selectedSlot = -1; // a bus switch shrank the silhouette
    this.rebuildSlotChrome();

    this.vCount.textContent = String(s.count);
    const d = s.draft;

    // WHO THIS LAUNCH IS FOR.
    if (s.padTarget === null) {
      this.vTargetHead.textContent = "NO DEMAND ON THE BOARD YET";
      this.vTargetTerms.textContent = "";
      this.vTargetBet.textContent = "";
    } else {
      this.vTargetHead.textContent = `SERVING · ${s.padTarget.label.toUpperCase()}  ·  ${s.padTarget.state.toUpperCase()}`;
      this.vTargetTerms.textContent = s.padTarget.terms;
      this.vTargetBet.textContent = TENDER_BET(
        `€${Math.round(s.padTarget.payPerHr).toLocaleString("en-US")}/hr`,
        `€${Math.round(s.padTarget.penaltyPerHr).toLocaleString("en-US")}/hr`,
      );
    }
    this.compare.render(s.compare);

    // THE INSTRUMENTS.
    this.profile.render({
      altKm: d.altKm,
      minKm: s.band.minKm,
      maxKm: s.band.maxKm,
      parkKm: s.band.parkKm,
      footprintDeg: s.footprintDeg,
      latencyMs: s.facts.latencyMs,
    });
    this.incDial.render({
      incDeg: d.incDeg,
      targetLatDeg: s.padTarget?.latDeg ?? null,
      targetLabel: s.padTarget?.label ?? "",
      footprintDeg: s.footprintDeg,
    });
    this.phaseRing.render(s.ring);

    this.scrubs.get("altKm")?.render(d.altKm);
    this.scrubs.get("incDeg")?.render(d.incDeg);
    this.scrubs.get("subLonDeg")?.render(d.subLonDeg);
    this.scrubs.get("raanDeg")?.render(d.raanDeg);
    this.scrubs.get("phaseSpreadDeg")?.render(d.phaseSpreadDeg);

    // A control that cannot do anything RIGHT NOW says so, instead of sitting there looking
    // like a number you got wrong. (On a single equatorial satellite — the very first launch
    // — RAAN and phase spread are both inert, which is a third of the old pad's controls.)
    this.scrubs
      .get("raanDeg")
      ?.setInert(
        d.incDeg < 0.5
          ? "RAAN turns the orbital plane around the pole. An orbit with no tilt has no plane to turn — give it some inclination first."
          : null,
      );
    this.scrubs
      .get("phaseSpreadDeg")
      ?.setInert(
        s.count < 2 ? "How far apart the members of a BATCH ride. This launch carries one satellite." : null,
      );

    // The comb strip: solid = the region sees this draft; dark = it does not.
    this.vCombLabel.textContent = `ONE ORBIT OVER ${s.combRegionLabel.toUpperCase()}`;
    const ctx = this.combCanvas.getContext("2d");
    if (ctx && s.comb) {
      const w = this.combCanvas.width;
      const h = this.combCanvas.height;
      ctx.clearRect(0, 0, w, h);
      const rowH = (h - 6) / 2;
      // FL-15a — tokens only, even in the canvas (resolved once per frame from the custom
      // properties; they never change at runtime, but a theme could).
      const toks = combTokenColors();
      const drawRow = (windows: boolean[] | null, y: number, onColor: string) => {
        if (windows === null) {
          ctx.fillStyle = toks.bg;
          ctx.fillRect(0, y, w, rowH);
          return;
        }
        const n = windows.length;
        const cell = w / n;
        for (let i = 0; i < n; i++) {
          ctx.fillStyle = windows[i] ? onColor : toks.cellOff;
          ctx.fillRect(i * cell, y, Math.ceil(cell) - 1, rowH);
        }
      };
      // TOP: the fleet as it stands (dim cyan — the gaps are the dark cells).
      drawRow(s.combFleet?.windows ?? null, 2, toks.fleetDim);
      // BOTTOM: fleet + this launch (bright — aim until it fills the top row's gaps).
      drawRow(s.comb.windows, 4 + rowH, toks.cyan);
    } else if (ctx) {
      ctx.clearRect(0, 0, this.combCanvas.width, this.combCanvas.height);
    }
    const dutyPct = s.comb ? Math.round(s.comb.duty * 100) : 0;
    const fleetPct = s.combFleet ? `fleet holds ${Math.round(s.combFleet.duty * 100)}% · ` : "";
    const lat = s.facts.latencyMs === null ? "—" : `${s.facts.latencyMs.toFixed(1)} ms`;
    const tts = Number.isFinite(s.facts.timeToServeS)
      ? s.facts.timeToServeS <= 0.5
        ? "serving NOW"
        : `first serve in ${Math.round(s.facts.timeToServeS)}s`
      : "never served on this orbit";
    this.vFacts.textContent = `${fleetPct}with this launch ${dutyPct}% · period ${Math.round(s.facts.periodS)}s${s.facts.parks ? " · PARKS" : ""} · one-way ${lat} · ${tts}`;

    this.vStack.textContent = `vehicle €${Math.round(s.stack.vehicleEur).toLocaleString("en-US")} + hardware €${Math.round(s.stack.hardwareEur).toLocaleString("en-US")} × ${s.count} = €${Math.round(s.stack.totalEur).toLocaleString("en-US")} · wallet €${Math.round(s.balanceEur).toLocaleString("en-US")}`;
    // FL-11 — the manifest discount is a fact on the stack when batching.
    if (s.count > 1)
      this.vStack.textContent += ` · ${STACK_BATCH_DISCOUNT(`${Math.round(NET_BATCH_MEMBER_DISCOUNT * 100)}%`)}`;
    this.vStack.classList.toggle("over", s.stack.totalEur > s.balanceEur);
    this.vProblem.textContent = s.problem ?? "";
    this.vProblem.style.display = s.problem ? "" : "none";
    // FL-10 — the risk band: honest silence in act 1 (absent node, never "0%").
    this.vRisk.textContent = s.riskBand ?? "";
    this.vRisk.style.display = s.riskBand ? "" : "none";
    this.vPadFact.textContent = s.padFact ?? "";
    this.vPadFact.style.display = s.padFact ? "" : "none";
    this.armBtn.classList.toggle("active", s.armed);
    this.armBtn.textContent = s.armed ? "ARMED" : "ARM";
    const ready = s.armed && s.problem === null;
    this.launchBtn.classList.toggle("ready", ready);
    (this.launchBtn as HTMLButtonElement).disabled = !ready;
  }
}
