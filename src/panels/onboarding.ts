/**
 * NET ONBOARDING POPUPS (M1) — the briefing cards (the UX-cold floor, design onboarding §1–§4).
 *
 * The cold player has no chance against the M1 net game's UX without a nudge: this surfaces ONE
 * short, dismissible INFO CARD per CORE CONCEPT, fired when that concept is INTRODUCED off the
 * existing scenario beats (act1 at the cold open; act2/act3a/act3b/act4 when the scenario cursor
 * reaches that beat). The tone is MACHINE / MISSION-CONTROL — it is the network briefing you — and
 * the chrome is the SAME 1-bit panel housing the rest of the shell uses (a bordered card, a legend
 * title, a GOT IT button), styled in style.css.
 *
 * This is DELIBERATELY NOT a coach-mark framework, NOT a persistent strip, and does NO highlighting
 * (the user explicitly overrode the onboarding script's "no tutorial layer" fence ONLY for these
 * basic dismissible cards). Each card:
 *   - is shown ONCE per session (a `shown` set keyed by concept id);
 *   - is DISMISSIBLE via the GOT IT button, the Esc key, or a click on the backdrop (click-out);
 *   - NEVER blocks the sim/clock more than the player wants — dismiss to proceed (the clock keeps
 *     running underneath; the card is a transient overlay, not a modal gate on the fold).
 *
 * RENDER/UI ONLY — it holds NO sim state, draws NO sim math, and is wired in NET MODE ONLY (never
 * in ?mode=cache). It is driven from main.ts's frame loop, which calls {@link Onboarding.trigger}
 * with the concept id when its beat is first entered/emitted; trigger de-dupes via the shown set.
 *
 * HEADLESS DRIVABILITY (the screenshot step): the card root carries the stable selector
 * `[data-onboarding="card"]` with `data-concept="<id>"`; the dismiss button carries
 * `[data-onboarding="dismiss"]`. The Act-1 card fires at the cold open (boot), so a headless shot
 * lands on it immediately; `Escape` / a backdrop click / a click on the dismiss button all close it.
 */

/** The six M1 core concepts, one card each — the stable concept id keys the shown-once set.
 * One entry per M1_SCENARIO beat, in beat order; `act-cards.test.ts` pins that correspondence, because
 * main.ts indexes the concept list BY CURSOR and a missing entry silently mis-fires a card (SD-64). */
export type OnboardingConcept = "act1" | "act2" | "act3a" | "act3b" | "act3c" | "act4";

/** One authored briefing card: a title + 1–3 short lines (system, then the next action). */
interface OnboardingCard {
  /** The stable concept id (the scenario beat it fires off). */
  id: OnboardingConcept;
  /** The card title (the concept name, machine-voiced). */
  title: string;
  /** 1–3 short lines: what the system is, then where to point the next action. */
  lines: string[];
}

/**
 * THE SIX CONCEPT CARDS (design onboarding — one ONE-concept card per act). The wording is short +
 * concrete: the first line(s) name the SYSTEM, the last points the NEXT ACTION (the diegetic "here
 * is the next thing"). Machine / mission-control tone — the NETWORK is briefing the operator.
 */
const ONBOARDING_CARDS: Record<OnboardingConcept, OnboardingCard> = {
  act1: {
    id: "act1",
    // EASIER COLD OPEN — not a 3-step lecture on top of the planner. ONE welcoming, non-imperative
    // line that ORIENTS the player to the persistent surfaces (the OBJECTIVE goal + the globe) that
    // now carry the step-by-step.
    //
    // This comment used to end "The planner is pre-aimed, so the very first move is just LAUNCH."
    // That is the OPPOSITE of the design (corrected 2026-09-02, found by playing the opener cold).
    // The boot draft is a DEAD PRE-AIM parked 90° W: the comb reads 0 %, the region sits visibly
    // outside the ring, and the chip says "never serves the target" until the player aims it by hand.
    // That is deliberate and load-bearing — decisions.md records it as "the Act-1 hand-aim criterion
    // is structural now", and it exists precisely because the condemned build's first sin was
    // "Act 1's default launch was pre-aimed at the target (press L, click ACCEPT — 90 seconds, no
    // slider touched) … the game solved itself". A stale comment claiming the opposite is how that
    // gets "fixed" back in by someone acting in good faith, so it is corrected rather than deleted.
    title: "WELCOME, OPERATOR",
    lines: [
      "Your job: keep regions connected — and get paid for it.",
      "The green OBJECTIVE up top always says your next move; the globe shows your coverage.",
    ],
  },
  act2: {
    id: "act2",
    title: "COVERAGE MOVES",
    lines: [
      "One satellite can't hold a region that needs constant coverage — it orbits away.",
      "Launch a CONSTELLATION (several phased sats) so one rises as another sets.",
    ],
  },
  act3a: {
    id: "act3a",
    title: "STRAIN",
    lines: [
      "Your success grew demand and a shared link is congesting toward breach.",
      "Re-route (prefer a different path) or launch more capacity.",
    ],
  },
  act3b: {
    id: "act3b",
    title: "FAULTS",
    lines: [
      "Satellites degrade and fail. Build redundancy and watch the diagnostic.",
      "A telegraphed failure warns you before it dies.",
    ],
  },
  act3c: {
    id: "act3c",
    title: "SOME PLACES CAN NEVER SEE YOU",
    lines: [
      "The Moon keeps one face toward Earth, so its farside never sees you — no orbit and no number of satellites can change that.",
      "A relay parked out past the far limb, at Earth–Moon L2, holds both ends in view at once.",
    ],
  },
  act4: {
    id: "act4",
    title: "DISTANCE",
    lines: [
      "Mars is minutes away at light-speed.",
      "Your real-time playbook breaks here — the signal arrives old.",
    ],
  },
};

/**
 * THE CONCEPTS IN M1_SCENARIO BEAT ORDER. main.ts indexes this BY CURSOR to fire the card for the
 * beat the player just reached, so it must carry ONE entry per beat, in beat order. It used to live
 * in main.ts as a bare literal, which is how SD-62's new act3c beat slipped past it: the list still
 * had five entries, so act4's card fired on the LUNAR act and Mars (cursor 5) read `undefined` and
 * showed nothing at all. It lives HERE now, beside the cards it names, and `act-cards.test.ts` pins
 * it against M1_SCENARIO so the next inserted beat fails the build instead of mis-firing a card.
 */
export const ONBOARDING_CONCEPTS_IN_BEAT_ORDER: OnboardingConcept[] = [
  "act1",
  "act2",
  "act3a",
  "act3b",
  "act3c",
  "act4",
];

/**
 * The onboarding popup overlay (render/UI only). Mounts a backdrop + a single card into the host
 * (main.ts hands it the app root). {@link trigger} shows the concept's card ONCE; any dismiss path
 * (GOT IT / Esc / click-out) hides it. The clock keeps running underneath — never a sim gate.
 */
export class Onboarding {
  /** The full-window backdrop (transparent, catches the click-out); hidden when no card is up. */
  private readonly backdrop: HTMLElement;
  /** The card root (1-bit chrome housing). Rebuilt per concept. */
  private readonly card: HTMLElement;
  private readonly titleEl: HTMLElement;
  private readonly bodyEl: HTMLElement;
  private readonly dismissBtn: HTMLButtonElement;

  /** Concepts already shown this session (shown-once). Persists for the page lifetime. */
  private readonly shown = new Set<OnboardingConcept>();
  /** The concept currently on screen (null when nothing is up). */
  private current: OnboardingConcept | null = null;

  constructor(host: HTMLElement) {
    this.backdrop = document.createElement("div");
    this.backdrop.className = "onboarding-backdrop";
    this.backdrop.dataset.onboarding = "backdrop";

    this.card = document.createElement("div");
    this.card.className = "onboarding-card";
    this.card.dataset.onboarding = "card";

    const legend = document.createElement("div");
    legend.className = "onboarding-legend";
    legend.textContent = "NETWORK BRIEFING";

    this.titleEl = document.createElement("div");
    this.titleEl.className = "onboarding-title";

    this.bodyEl = document.createElement("div");
    this.bodyEl.className = "onboarding-body";

    this.dismissBtn = document.createElement("button");
    this.dismissBtn.type = "button";
    this.dismissBtn.className = "onboarding-dismiss";
    this.dismissBtn.dataset.onboarding = "dismiss";
    this.dismissBtn.textContent = "GOT IT";
    this.dismissBtn.addEventListener("click", () => this.dismiss());

    this.card.append(legend, this.titleEl, this.bodyEl, this.dismissBtn);
    this.backdrop.appendChild(this.card);
    this.backdrop.style.display = "none";
    host.appendChild(this.backdrop);

    // DISMISS ON CLICK-OUT: a click on the backdrop (NOT the card) closes the card. The card
    // stops propagation so a click inside it never counts as click-out.
    this.backdrop.addEventListener("click", () => this.dismiss());
    this.card.addEventListener("click", (e) => e.stopPropagation());
    // DISMISS ON ESC: a window-level key listener (captured here so the card need not be focused).
    window.addEventListener("keydown", (e) => {
      if (e.key === "Escape" && this.current !== null) {
        e.preventDefault();
        this.dismiss();
      }
    });
  }

  /**
   * Show the concept's card if it has not been shown yet this session AND nothing else is currently
   * up (so two beats firing close together never stack — the first holds the screen, the second's
   * trigger no-ops because its concept is still un-shown and re-trigger next frame finds the screen
   * free). De-duped by the shown set: the FIRST trigger of a concept marks it shown and paints it.
   * A no-op (returns false) when the concept was already shown, or another card is on screen.
   */
  trigger(concept: OnboardingConcept): boolean {
    if (this.shown.has(concept)) return false;
    if (this.current !== null) return false; // a card is up — let it finish; re-trigger later.
    this.shown.add(concept);
    this.current = concept;
    const card = ONBOARDING_CARDS[concept];
    this.titleEl.textContent = card.title;
    this.bodyEl.replaceChildren(
      ...card.lines.map((line) => {
        const p = document.createElement("div");
        p.className = "onboarding-line";
        p.textContent = line;
        return p;
      }),
    );
    this.card.dataset.concept = concept;
    this.backdrop.style.display = "";
    return true;
  }

  /** Dismiss the current card (the GOT IT button / Esc / click-out path). The clock is untouched —
   * the sim kept running underneath; this only hides the transient overlay. No-op when nothing up. */
  dismiss(): void {
    if (this.current === null) return;
    this.current = null;
    this.backdrop.style.display = "none";
  }

  /** Whether a card is currently on screen (the headless verify / a caller reads this). */
  get visible(): boolean {
    return this.current !== null;
  }
}
