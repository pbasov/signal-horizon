/**
 * FL-03 — the slot-indexed loadout reducer (pure, no DOM). Pins the invariants the PAD
 * editor + the netDraft sync rely on: slot ordering (G then S), duplicate cards legal,
 * bus switches truncate legally, class-mismatched writes rejected.
 */

import { describe, it, expect } from "vitest";
import {
  fromCards,
  cardsOf,
  setSlot,
  withBus,
  slotClassAt,
  slotLabels,
  slotCount,
} from "./loadout-state";

describe("FL-03 — slot-indexed loadout state", () => {
  it("fromCards fills G-slots then S-slots in catalog order", () => {
    const s = fromCards("comsat", ["ACCESS_S", "CROSSLINK", "ACCESS_L"]);
    expect(s.slots).toEqual(["ACCESS_S", "ACCESS_L", "CROSSLINK", null]);
    expect(cardsOf(s)).toEqual(["ACCESS_S", "ACCESS_L", "CROSSLINK"]);
  });

  it("DUPLICATES are legal (two ACCESS-S in two G slots — a real design)", () => {
    const s = fromCards("comsat", ["ACCESS_S", "ACCESS_S"]);
    expect(s.slots[0]).toBe("ACCESS_S");
    expect(s.slots[1]).toBe("ACCESS_S");
    expect(cardsOf(s)).toEqual(["ACCESS_S", "ACCESS_S"]);
  });

  it("setSlot rejects a class mismatch (a CROSSLINK can never sit in a G slot)", () => {
    const s = fromCards("smallsat", ["BROADCAST"]);
    expect(setSlot(s, 0, "CROSSLINK")).toBeNull();
    expect(setSlot(s, 1, "BROADCAST")).toBeNull();
  });

  it("setSlot writes + clears; out-of-range indices reject", () => {
    const s = fromCards("smallsat", []);
    const t = setSlot(s, 0, "BROADCAST");
    expect(t).not.toBeNull();
    expect(t!.slots).toEqual(["BROADCAST", null]);
    expect(setSlot(t!, 0, null)!.slots).toEqual([null, null]);
    expect(setSlot(s, 2, "BROADCAST")).toBeNull();
    expect(setSlot(s, -1, "BROADCAST")).toBeNull();
    expect(setSlot(s, 0, "NOT_A_CARD")).toBeNull();
  });

  it("switching bus RE-SLOTS the same cards, truncating overflow legally", () => {
    const full = fromCards("comsat", ["ACCESS_L", "ACCESS_S", "CROSSLINK", "CROSSLINK"]);
    expect(cardsOf(full).length).toBe(4);
    const down = withBus(full, "smallsat");
    // smallsat is 1G+1S: two G cards → one survives; two S cards → one survives.
    expect(down.slots).toEqual(["ACCESS_L", "CROSSLINK"]);
    const up = withBus(fromCards("smallsat", ["BROADCAST"]), "comsat");
    expect(up.slots).toEqual(["BROADCAST", null, null, null]);
  });

  it("slot geometry matches the bus spec (labels: G1.. then S1..)", () => {
    expect(slotCount("smallsat")).toBe(2);
    expect(slotCount("comsat")).toBe(4);
    expect(slotLabels("comsat")).toEqual(["G1", "G2", "S1", "S2"]);
    expect(slotClassAt("comsat", 0)).toBe("G");
    expect(slotClassAt("comsat", 1)).toBe("G");
    expect(slotClassAt("comsat", 2)).toBe("S");
    expect(slotClassAt("comsat", 3)).toBe("S");
  });
});
