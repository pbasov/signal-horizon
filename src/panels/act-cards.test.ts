/**
 * SD-64 — THE PLAYER-FACING CARD DECKS TRACK THE SCENARIO.
 *
 * Two decks of copy are keyed by SCENARIO CURSOR INDEX, not by beat id:
 *   1. the onboarding briefing (`ONBOARDING_CONCEPTS_IN_BEAT_ORDER`, indexed by cursor in main.ts)
 *   2. the HOW IT WORKS reference cards (`HOWTO_CARDS`, matched to the live beat by `cursor`)
 *
 * Index-keyed decks fail SILENTLY when a beat is INSERTED rather than appended. SD-62 appended act3c
 * at index 4, ahead of act4, and nothing caught it: the Mars briefing fired on the LUNAR act, Mars
 * itself (cursor 5) fired nothing, the HOW IT WORKS panel showed the Mars card as LIVE during the
 * Moon act, and on the real final beat NO card was live at all. The whole suite was green — neither
 * deck had a single test.
 *
 * These pins are deliberately about CORRESPONDENCE, not content: one entry per beat, in beat order.
 * Any future inserted beat breaks the build here instead of quietly mis-briefing the player.
 */
import { describe, it, expect } from "vitest";
import { M1_SCENARIO } from "../sim/net/scenario";
import { ONBOARDING_CONCEPTS_IN_BEAT_ORDER } from "./onboarding";
import { HOWTO_CARDS } from "./howto";

describe("SD-64 — the onboarding deck covers every scenario beat, in beat order", () => {
  it("names exactly the M1_SCENARIO beats, in the same order", () => {
    // The list is indexed BY CURSOR, so identity of ORDER is the whole contract.
    expect(ONBOARDING_CONCEPTS_IN_BEAT_ORDER).toEqual(M1_SCENARIO.map((b) => b.id));
  });

  it("gives the FINAL beat a card (the cursor stops there — an undefined read shows nothing, forever)", () => {
    const lastCursor = M1_SCENARIO.length - 1;
    expect(ONBOARDING_CONCEPTS_IN_BEAT_ORDER[lastCursor]).toBe(M1_SCENARIO[lastCursor].id);
  });

  it("has no duplicate concept (a repeat would silently shadow a beat)", () => {
    expect(new Set(ONBOARDING_CONCEPTS_IN_BEAT_ORDER).size).toBe(ONBOARDING_CONCEPTS_IN_BEAT_ORDER.length);
  });
});

describe("SD-64 — the HOW IT WORKS deck covers every scenario beat", () => {
  it("carries one card per beat, at the cursor index of that beat", () => {
    expect(HOWTO_CARDS.map((c) => c.cursor)).toEqual(M1_SCENARIO.map((_b, i) => i));
  });

  it("leaves no beat without a LIVE card — every cursor 0..N-1 matches exactly one card", () => {
    for (let cursor = 0; cursor < M1_SCENARIO.length; cursor++) {
      const live = HOWTO_CARDS.filter((c) => c.cursor === cursor);
      expect(live.length, `beat ${M1_SCENARIO[cursor].id} (cursor ${cursor}) has ${live.length} cards`).toBe(1);
    }
  });

  it("titles the cards in reading order (1..N) so the numbering matches the deck", () => {
    HOWTO_CARDS.forEach((c, i) => {
      expect(c.title.startsWith(`${i + 1} · `), `card ${i} title "${c.title}" should open "${i + 1} · "`).toBe(true);
    });
  });

  it("says something on every card (a beat with an empty card is a beat with no teaching)", () => {
    for (const c of HOWTO_CARDS) {
      expect(c.lines.length).toBeGreaterThan(0);
      expect(c.xref.length).toBeGreaterThan(0);
    }
  });
});
