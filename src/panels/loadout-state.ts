/**
 * FL-03 (SD-46) — THE SLOT-INDEXED LOADOUT STATE. The sat's antenna fit is a fixed
 * number of NAMED SLOTS on the bus (G1, G2, … then S1, S2, …), each holding a card id
 * or null — NOT a flat toggle set. This module is the PURE half (no DOM): the PAD
 * editor (FL-04) renders it, main.ts keeps `netDraft.loadout` synced FROM it (an edit
 * re-runs previewLaunch ⇒ the comb/footprint react to the antennas, not just the orbit).
 *
 * INVARIANTS (test-pinned):
 *  - slots are ordered G-slots first, then S-slots; length == bus spec's gSlots + sSlots.
 *  - a card may occupy multiple slots (two ACCESS-S in two G slots is a legal design).
 *  - switching bus RE-SLOTS the same cards into the new bus's slots, truncating overflow
 *    (never silently produces an illegal fit).
 *  - the card list view drops nulls, preserving slot order.
 */

import { BUS_SPECS, antennaCardById, type BusTier } from "../sim/net/sat";

/** The slot-indexed loadout: bus + one entry per slot (card id or null). */
export interface LoadoutState {
  bus: BusTier;
  /** slots[0..gSlots) are G-slots, slots[gSlots..) are S-slots. */
  slots: (string | null)[];
}

/** Total slot count for a bus (G then S). */
export function slotCount(bus: BusTier): number {
  const spec = BUS_SPECS[bus];
  return spec.gSlots + spec.sSlots;
}

/** The slot class of an index (G first, then S). */
export function slotClassAt(bus: BusTier, index: number): "G" | "S" {
  return index < BUS_SPECS[bus].gSlots ? "G" : "S";
}

/** Build a slot state from a bus + an unordered card list (the pre-FL-03 model): cards
 * fill their class's slots in order, overflow is dropped, unknown ids dropped. */
export function fromCards(bus: BusTier, cards: readonly string[]): LoadoutState {
  const state: LoadoutState = { bus, slots: new Array(slotCount(bus)).fill(null) };
  let g = 0;
  let s = BUS_SPECS[bus].gSlots;
  for (const id of cards) {
    const card = antennaCardById(id);
    if (card === null) continue;
    if (card.slot === "G" && g < BUS_SPECS[bus].gSlots) state.slots[g++] = id;
    else if (card.slot === "S" && s < slotCount(bus)) state.slots[s++] = id;
  }
  return state;
}

/** The flat card list view (slot order, nulls dropped) — what the wire + pricing read. */
export function cardsOf(state: LoadoutState): string[] {
  return state.slots.filter((c): c is string => c !== null);
}

/** Set (or clear, id === null) one slot. Returns a NEW state, or null when the card
 * cannot legally sit in that slot (class mismatch / unknown id / index out of range). */
export function setSlot(state: LoadoutState, index: number, id: string | null): LoadoutState | null {
  if (index < 0 || index >= state.slots.length) return null;
  if (id !== null) {
    const card = antennaCardById(id);
    if (card === null) return null;
    if (card.slot !== slotClassAt(state.bus, index)) return null;
  }
  const slots = state.slots.slice();
  slots[index] = id;
  return { bus: state.bus, slots };
}

/** Switch the bus: the SAME cards re-slot into the new bus (overflow truncates legally). */
export function withBus(state: LoadoutState, bus: BusTier): LoadoutState {
  return fromCards(bus, cardsOf(state));
}

/** Which cards MAY go into a slot (its class's catalog, unknowns already excluded) —
 * the slot chooser's menu source. */
export function cardsForSlot(bus: BusTier, index: number, catalog: readonly { id: string; slot: "G" | "S" }[]): string[] {
  const cls = slotClassAt(bus, index);
  return catalog.filter((c) => c.slot === cls).map((c) => c.id);
}

/** A short human label per slot (G1, G2, S1, …) — redundant with the class word; the
 * SILHOUETTE uses these (shape + label, never colour alone). */
export function slotLabels(bus: BusTier): string[] {
  const spec = BUS_SPECS[bus];
  const out: string[] = [];
  for (let i = 0; i < spec.gSlots; i++) out.push(`G${i + 1}`);
  for (let i = 0; i < spec.sSlots; i++) out.push(`S${i + 1}`);
  return out;
}
