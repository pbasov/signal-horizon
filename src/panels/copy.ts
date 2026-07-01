/**
 * ALL player-facing MISSION copy lives here — objectives, briefings, tender fiction —
 * under two structural laws (m1-redesign.md §1, enforced by copy-lint.test.ts):
 *
 *   LAW 2 — GOALS, NEVER INSTRUCTIONS. Copy names a want ("the metro is dark and
 *   paying"), never a control ("press L", "click ACCEPT"). The world teaches; the
 *   instruments show consequences. Control legends live in the status strip, not here.
 *
 *   The lint bans imperative control references in THIS file. Add new player-facing
 *   prose HERE so it stays under the lint.
 */

/** Per-act GOALS (not instructions). Keyed by scenario cursor. */
export const MISSION_OBJECTIVES: readonly { title: string; detail: string }[] = [
  {
    title: "First light",
    detail:
      "The equatorial metro is dark, and its co-op pays €2/s for a broadcast feed while signal reaches it. " +
      "Your wallet is finite; a signed deal that goes unserved bleeds €4/s.",
  },
  {
    title: "Hold a region that moves",
    detail:
      "The polar metro needs holding, not touching — 99% of the time, as satellites rise and set. " +
      "One moving satellite cannot hold it alone.",
  },
  {
    title: "Your own success congests it",
    detail:
      "Demand grows where you serve well. Two deals now share one pipe, and their peaks don't care about your margins. " +
      "The corridor metro pays for low latency no floodlight can carry — spot beams point at one region at a time.",
  },
  {
    title: "It breaks. Does your network?",
    detail:
      "Hardware degrades, links drop, and one warned failure is counting down. A network that survives is one you shaped that way.",
  },
  {
    title: "The frontier",
    detail:
      "Mars pays for a relay. Light takes minutes each way — watch your first signal crawl and decide what 'now' even means out there.",
  },
];

/** The Act-1 cold-open line (one sentence, no lecture). */
export const MISSION_WELCOME =
  "You run a satellite ISP. Dark regions pay when signal reaches them; hardware and physics decide whether it does.";

/** Tender-row verdict fragments (facts about the OFFER, never solved answers). */
export const TENDER_BET = (payPerHr: string, penaltyPerHr: string): string =>
  `pays ${payPerHr} while served · bleeds ${penaltyPerHr} while signed and dark`;

/** The launch-event WIRE beats (diegetic, no controls). */
export const WIRE_COUNTDOWN = (id: string): string => `${id} — terminal count`;
export const WIRE_LIFTOFF = (id: string): string => `${id} — liftoff`;
export const WIRE_DEPLOY = (satId: string): string => `${satId} separation confirmed`;
export const WIRE_NOSEP = (satId: string): string => `${satId} NO SEP — the slot in your phasing is real`;
export const WIRE_UNDERBURN = (satId: string): string =>
  `${satId} underburn — parked low; a circularization burn would raise it`;
export const WIRE_VEHICLE_LOST = (id: string): string => `${id} VEHICLE LOST — range safety`;
export const WIRE_FIRST_SIGNAL = (satId: string, regionLabel: string): string =>
  `${satId} first signal — ${regionLabel} lit`;
