/**
 * net/ M1 — HOW IT WORKS (SD-44 PHASE 1): the REFERENCE desktop's static explainer. One card per CORE
 * CONCEPT (reusing the onboarding briefing copy + the NET_OBJECTIVES "next move" line), keyed on the
 * live scenario cursor: the card for the current act reads LIVE, earlier acts read normal (already
 * learned), and later acts read DIM / "LOCKED" with a cross-reference to where the control lives. A
 * reference page the player can open any time (key 5) without losing the run — render/UI only, no sim.
 *
 * DD-1: 1-bit MACHINE chrome (bordered cards, dim labels); the only colour is the LIVE card's cyan
 * title, and "LOCKED" is a word, not a colour, so the locked state reads colour-off too.
 */
import type { PanelHandle } from "../wm/shell";

/** One authored explainer card (mirrors the onboarding cards + the objective "next move" line). */
interface HowtoCard {
  /** The act this card teaches (a cursor index into M1_SCENARIO). */
  cursor: number;
  title: string;
  /** 1–3 short lines: name the system, then point the next action / where the control lives. */
  lines: string[];
  /** A cross-reference: which desktop / control acts on this concept. */
  xref: string;
}

/** THE SIX CONCEPT CARDS (reuses the onboarding + objective copy). Order = scenario cursor order —
 * ONE card per M1_SCENARIO beat, since `render()` matches a card to the LIVE beat by cursor index.
 * A missing beat leaves the final act with no LIVE card at all; `act-cards.test.ts` pins it (SD-64). */
export const HOWTO_CARDS: HowtoCard[] = [
  {
    cursor: 0,
    title: "1 · SERVE A REGION — & THE BET",
    lines: [
      "Keep regions connected and get paid. Every contract is a WAGER: a reward/hr staked against a penalty/hr it bleeds if you breach its SLA.",
      "Aim the orbit until the preview reads WILL SERVE, then launch. The co-op's deal waits on the contracts board — it pays only while signal actually reaches them.",
    ],
    xref: "the launch pad ↔ the contracts board · the overview flags what's at risk",
  },
  {
    cursor: 1,
    title: "2 · COVERAGE MOVES — SIZE THE SET",
    lines: [
      "A region that needs CONTINUOUS coverage can't be held by one LEO — it orbits away and the link sawtooths.",
      "On CONNECTIVITY (2) dial the CONSTELLATION SIZE on the held-vs-capex ladder: add phased sats until HELD crosses the bar (the measured minimum), but every sat past it is idle capex — trim to the minimum.",
    ],
    xref: "CONNECTIVITY (2) → the SIZE stepper + PLACE SET",
  },
  {
    cursor: 2,
    title: "3 · STRAIN — WHO STARVES",
    lines: [
      "Your success grows demand. When two contracts share one sat and their peaks collide, the link over-subscribes and can no longer honor every floor.",
      "On ROUTING (3) read the LINK·LOAD allocation ledger — it shows each contract's share vs its floor and flags the STARVED one. PREFER bandwidth to reroute the one you protect onto a lighter sat, or launch more capacity.",
    ],
    xref: "ROUTING (3) → LINK·LOAD ledger + the PREFER reroute preview",
  },
  {
    cursor: 3,
    title: "4 · FAULTS — REDUNDANCY",
    lines: [
      "Satellites degrade and fail; a telegraphed fault warns you before it drops.",
      "Build redundancy so a served region survives the outage — launch a backup over it before the countdown ends; OVERVIEW (1) flags the region the moment it's at risk.",
    ],
    xref: "CONNECTIVITY (2) launch a backup · OVERVIEW (1) triage",
  },
  {
    cursor: 4,
    title: "5 · SOME PLACES CAN NEVER SEE YOU",
    lines: [
      "The Moon is tidally locked — one face toward Earth, forever — so the lunar farside is the first demand no Earth orbit can EVER reach. More satellites do not help, and neither does a better orbit.",
      "The answer is a relay parked where NEITHER end sits: the Earth–Moon L2 halo, which holds the farside and Earth in view at once. Light costs about 1.3 s each way there — the frontier's first real bite.",
    ],
    xref: "the launch pad → the cislunar gateway · the orrery → the Earth–Moon pair",
  },
  {
    cursor: 5,
    title: "6 · DISTANCE — THE FRONTIER",
    lines: [
      "Mars is minutes away at light-speed — your real-time playbook breaks here, and the signal arrives old.",
      "A teaser: connectivity by relay presence, latency by the REAL light delay. To be continued.",
    ],
    xref: "OVERVIEW (1) → the orrery + the Earth↔Mars span",
  },
];

export class Howto implements PanelHandle {
  readonly title = "HOW IT WORKS";
  readonly content: HTMLElement;

  private cards: { root: HTMLElement; cursor: number }[] = [];
  private lastCursor = -1;

  constructor() {
    this.content = el("div", "telem");

    const intro = group("HOW IT WORKS");
    const lead = el("div", "net-obj-detail");
    lead.textContent = "The connectivity loop, one concept at a time. The LIVE card is your current act; LOCKED cards unlock as you progress.";
    intro.append(lead);
    this.content.append(intro);

    for (const c of HOWTO_CARDS) {
      const root = el("div", "howto-card");
      const title = el("div", "howto-card-title");
      title.textContent = c.title;
      root.append(title);
      for (const line of c.lines) {
        const l = el("div", "howto-card-line");
        l.textContent = line;
        root.append(l);
      }
      const xref = el("div", "howto-xref");
      xref.textContent = `↳ ${c.xref}`;
      root.append(xref);
      this.content.append(root);
      this.cards.push({ root, cursor: c.cursor });
    }
  }

  /** Re-tone the cards for the live scenario cursor: past = normal, current = LIVE (cyan), future =
   * LOCKED (dim). Cheap; only repaints when the cursor changes. */
  render(cursor: number): void {
    if (cursor === this.lastCursor) return;
    this.lastCursor = cursor;
    for (const card of this.cards) {
      const locked = card.cursor > cursor;
      const live = card.cursor === cursor;
      card.root.className = `howto-card${locked ? " locked" : ""}${live ? " live" : ""}`;
    }
  }

  subtitle(): string {
    return "· reference";
  }
}

// --- tiny DOM helpers -------------------------------------------------------

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
