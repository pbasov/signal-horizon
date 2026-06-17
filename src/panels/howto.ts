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
  /** The act this card teaches (cursor index 0..4). */
  cursor: number;
  title: string;
  /** 1–3 short lines: name the system, then point the next action / where the control lives. */
  lines: string[];
  /** A cross-reference: which desktop / control acts on this concept. */
  xref: string;
}

/** THE FIVE CONCEPT CARDS (reuses the onboarding + objective copy). Order = scenario cursor order. */
const HOWTO_CARDS: HowtoCard[] = [
  {
    cursor: 0,
    title: "1 · SERVE A REGION",
    lines: [
      "Your job: keep regions connected — and get paid for it.",
      "Aim a sat over a region until the red gap goes GREEN, LAUNCH, then ACCEPT the contract.",
    ],
    xref: "LAUNCH desktop (key 2) → CONTRACTS desktop (key 4)",
  },
  {
    cursor: 1,
    title: "2 · COVERAGE MOVES",
    lines: [
      "One satellite can't hold a region that needs constant coverage — it orbits away.",
      "Launch a CONSTELLATION (several phased sats) so one rises as another sets.",
    ],
    xref: "LAUNCH desktop (key 2) → the PLACE SET button",
  },
  {
    cursor: 2,
    title: "3 · STRAIN",
    lines: [
      "Your success grew demand and a shared link is congesting toward breach.",
      "Re-route (prefer a different path) or launch more capacity.",
    ],
    xref: "ROUTING desktop (key 3) → LINK·LOAD + ROUTING·PREFER",
  },
  {
    cursor: 3,
    title: "4 · FAULTS",
    lines: [
      "Satellites degrade and fail. Build redundancy and watch the diagnostic.",
      "A telegraphed failure warns you before it dies.",
    ],
    xref: "ROUTING desktop (key 3) → watch LINK·LOAD",
  },
  {
    cursor: 4,
    title: "5 · DISTANCE",
    lines: [
      "Mars is minutes away at light-speed.",
      "Your real-time playbook breaks here — the signal arrives old.",
    ],
    xref: "OVERVIEW desktop (key 1) → the orrery + STATUS·BOARD",
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
