/**
 * THE CAST (SD-60) — who is buying, and why they care.
 *
 * `docs/signal-horizon-beats.md` §2 + §8: the tender reason line is the PRIMARY narrative
 * channel. One line, in the customer's voice, saying why the number matters. It NEVER states
 * the number (the card already does), never advises, never thanks, and never explains a
 * mechanic. A player who reads none of these loses nothing mechanical — that is the hard cap.
 *
 * WHY THIS LIVES IN panels/ AND NOT sim/: the reason line is pure presentation. The sim holds
 * only a stable `clientId` string (folded, replay-safe); the copy is looked up here. That keeps
 * the sim headless and puts every player-facing word under `copy-lint.test.ts`.
 *
 * Naming rules (setting §7): dry, institutional, plausible. No real agencies or companies —
 * legal risk, and it dates the game. Recurrence does the worldbuilding: the same underwriter
 * across forty tenders builds more world than any codex entry would.
 */

export interface ClientVoice {
  /** The institution's name, as it appears on the tender head. */
  name: string;
  /** One line: why this customer needs this. Never the number, never advice. */
  reason: string;
}

/**
 * Keyed by the contract's `clientId`. Each entry is matched to the SLA axis its tender
 * actually enforces — an availability customer talks about holes in a series, a latency
 * customer talks about being first. The fiction never claims a constraint the sim does not
 * simulate.
 */
export const CLIENTS: Readonly<Record<string, ClientVoice>> = {
  /** Act 1 — connectivity-only opener over an equatorial metro. Needs a link to exist at all. */
  halden: {
    name: "HALDEN MARINE UNDERWRITING",
    reason: "A hull claim closes this week. We need a link to the yard that is there when we call it.",
  },
  /** Act 2 — the 62°N availability wall. Continuity, not coverage. */
  thule: {
    name: "THULE POLAR PROGRAMME",
    reason: "Two hundred days of ice cores are worth nothing if the series has a hole in it. We are at sixty-two north, and we are not moving.",
  },
  /** Act 3a corridor — the latency axis arrives. Paid to be first. */
  verity: {
    name: "VERITY WIRE",
    reason: "We are paid to be first. Second is free, and worth exactly that.",
  },
  /** Act 3a backhaul — bulk, latency-tolerant, shares the pipe with Act 1 (the squeeze). */
  sable: {
    name: "SABLE LINE",
    reason: "Fourteen hulls, and none of them in the same place twice. We buy continuity, not coverage.",
  },
  /** Act 4 — the Mars teaser. Eleven people and four hundred instruments. */
  tharsis: {
    name: "THARSIS SURVEY OFFICE",
    reason: "We are eleven people and four hundred instruments. The instruments do not stop when the link does. They just stop being worth anything.",
  },
};

/** The client's display name, or "" when the contract carries no client (tests, renewals). */
export function clientName(clientId: string): string {
  return CLIENTS[clientId]?.name ?? "";
}

/** The client's reason line, or "" when unknown. Absent copy must degrade to nothing shown. */
export function clientReason(clientId: string): string {
  return CLIENTS[clientId]?.reason ?? "";
}
