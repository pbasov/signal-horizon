/**
 * net/ — the satellite ATOM v2 (m1-redesign.md §2.2/§2.4). A launched sat is its orbit
 * (the unforked {@link SatOrbit}) plus a BUS TIER (which fixes its antenna slots) and an
 * ANTENNA LOADOUT chosen at design time — **capacity lives in the antennas, not in a
 * hidden constant**: each antenna card carries its own `capacityUnits` pipe rating, so
 * loadout composition IS capacity design (the per-satellite-bandwidth directive, SD-45).
 *
 * THE CARD CATALOG is the purchasable design space the vehicle builder shows:
 *   - BROADCAST — down-only floodlight (its asymmetry identity, spec §1.2): covers every
 *     latency-tolerant contract in its footprint, no pointing needed. The Act-1 default.
 *   - ACCESS-S / ACCESS-L — symmetric SPOT BEAMS: must be POINTED (beam-assigned) at
 *     exactly one region to serve it (m1-redesign.md §2.3). Small = cheap and thin;
 *     large = headroom.
 *   - GATEWAY — the fat symmetric pipe; also a pointable spot beam in M1 (its trunk
 *     landing role matures with crosslink relaying, R3).
 *   - CROSSLINK — the S-slot relay substrate. PRESENT-BUT-INERT in R0/R1 routing (the
 *     M1-SLV relay epic consumes it); the builder shows it, the router ignores it.
 *
 * PURE: no three, no DOM, no wall-clock, no RNG. Reuses {@link SatOrbit} unforked.
 *
 * @see docs/m1-redesign.md §2.2 (the builder), §2.4 (per-sat bandwidth); spec Part I §1.
 */

import type { SatOrbit } from "../m2/roster";

/** Bus tier — the purchasable sizes (T3/T4 are named in the spec, locked past M1). */
export type BusTier = "smallsat" | "comsat";

/** Antenna purpose (spec §1.2 — the five types; LASER is T3/T4-locked, not in M1). */
export type AntennaType = "BROADCAST" | "ACCESS" | "GATEWAY" | "CROSSLINK";

/** Antenna slot class: G (ground-facing — BROADCAST/ACCESS/GATEWAY) or S (sat-facing —
 * CROSSLINK). The bus tier fixes how many of each a sat carries. */
export type SlotClass = "G" | "S";

/**
 * One antenna fitted to a sat. `eirp` + `rangeRefM` feed the inverse-square link budget
 * (real physics fields); `capacityUnits` is THIS pipe's throughput rating on the
 * contract `offeredLoad` scale — the per-antenna capacity the router's fair-share and
 * congestion terms are denominated in (there is NO uniform capacity constant any more).
 */
export interface AntennaSpec {
  type: AntennaType;
  /** The card id this antenna was built from (readout/fold; "" for legacy/standard). */
  cardId: string;
  /** Beam cone half-angle (radians) — the footprint half-angle hint. */
  coneHalfAngleRad: number;
  /** Effective isotropic radiated power (toy units; 1.0 = the standard antenna). */
  eirp: number;
  /** Reference link distance (metres) at which the budget just closes. */
  rangeRefM: number;
  /** THIS antenna's pipe capacity (offeredLoad units) — per-antenna, never uniform. */
  capacityUnits: number;
}

/** A launched satellite: its orbit + bus + antenna loadout. JSON-safe. */
export interface NetSat {
  id: string;
  orbit: SatOrbit;
  bus: BusTier;
  loadout: AntennaSpec[];
}

/** Standard antenna EIRP (covers the whole Act-1 disc from the parked GEO with margin). */
export const NET_STANDARD_EIRP = 1.0;

// ── the bus-tier table (spec §1.1 shape; numbers TUNABLE) ───────────────────────────

/** One bus tier: its slot counts, mass (drives launch cost), and hardware price. */
export interface BusSpec {
  tier: BusTier;
  label: string;
  gSlots: number;
  sSlots: number;
  massKg: number;
  /** Bus hardware price (€), before antennas + launch. */
  priceEur: number;
  /** Per-sat operating drain (€/sim-second) — the standing cost of owning it. */
  opexPerSecond: number;
}

/** The purchasable bus tiers. T1 SMALLSAT 1G+1S; T2 COMSAT 2G+2S (spec §1.1 LOCKED
 * shape; masses/prices TUNABLE). The consolidate-vs-split bet lives here: a comsat
 * carries two G pipes on one launch (cheaper per unit, one fault domain, one place at a
 * time); two smallsats cost more but spread across phases and fault domains. */
export const BUS_SPECS: Readonly<Record<BusTier, BusSpec>> = {
  smallsat: {
    tier: "smallsat",
    label: "T1 SMALLSAT",
    gSlots: 1,
    sSlots: 1,
    massKg: 150,
    priceEur: 2000,
    opexPerSecond: 0.1,
  },
  comsat: {
    tier: "comsat",
    label: "T2 COMSAT",
    gSlots: 2,
    sSlots: 2,
    massKg: 700,
    priceEur: 6000,
    opexPerSecond: 0.35,
  },
};

// ── the antenna card catalog (the builder's purchasable cards; numbers TUNABLE) ──────

/** One purchasable antenna card: the slot it fits, its physics, its pipe capacity, and
 * its price. The builder drops these into bus slots; the launch action carries card ids. */
export interface AntennaCard {
  id: string;
  label: string;
  type: AntennaType;
  slot: SlotClass;
  capacityUnits: number;
  priceEur: number;
  coneHalfAngleRad: number;
  eirp: number;
}

const DEG = Math.PI / 180;

/**
 * BEAM WIDTHS — the antenna half-angles, and with them the whole coverage economy.
 *
 * These used to all be 30° and purely decorative (the router never looked at them), which
 * made every antenna a floodlight over its whole visible hemisphere. Now the cone is
 * enforced in the link budget, so this table IS the footprint table: the spot a card paints
 * is `coneReachRad(cone, altitude)` clipped by the horizon, which means the CARD chooses how
 * much ground you cover and the ALTITUDE chooses how much that card is worth.
 *
 * The spread is deliberate. ACCESS-S is a true spot — cheap, narrow, and from a low pass it
 * covers less than a metro, so it wants height or company. ACCESS-L trades price for a spot
 * wide enough to hold a metro from low orbit. GATEWAY sits between them carrying far more
 * capacity, so its scarcity is the pipe, not the paint. BROADCAST is the widest and the
 * dumbest: down-only, latency-incapable, shared capacity — cheap ground per euro, but you
 * cannot aim it and everyone under it shares one pipe. TUNABLE.
 */
const CONE_BROADCAST = 18 * DEG;
const CONE_ACCESS_S = 10 * DEG;
const CONE_ACCESS_L = 24 * DEG;
const CONE_GATEWAY = 14 * DEG;
/** CROSSLINK never paints ground (S-slot relay substrate); the value is inert. */
const CONE_CROSSLINK = 30 * DEG;

/** The M1 card catalog. Capacities are on the contract offeredLoad scale (an Act-1
 * contract offers ~1.0 at baseline, swinging ±45% diurnally; escalation grows the
 * baseline toward 1.4). BROADCAST is down-only (serves latency-tolerant demand with no
 * pointing); ACCESS/GATEWAY are pointed spot beams; CROSSLINK is inert relay substrate. */
export const ANTENNA_CARDS: readonly AntennaCard[] = [
  {
    id: "BROADCAST",
    label: "BROADCAST",
    type: "BROADCAST",
    slot: "G",
    capacityUnits: 1.5,
    priceEur: 2500,
    coneHalfAngleRad: CONE_BROADCAST,
    eirp: NET_STANDARD_EIRP,
  },
  {
    id: "ACCESS_S",
    label: "ACCESS-S",
    type: "ACCESS",
    slot: "G",
    capacityUnits: 1.2,
    priceEur: 1200,
    coneHalfAngleRad: CONE_ACCESS_S,
    eirp: NET_STANDARD_EIRP,
  },
  {
    id: "ACCESS_L",
    label: "ACCESS-L",
    type: "ACCESS",
    slot: "G",
    capacityUnits: 2.4,
    priceEur: 2800,
    coneHalfAngleRad: CONE_ACCESS_L,
    eirp: NET_STANDARD_EIRP,
  },
  {
    id: "GATEWAY",
    label: "GATEWAY",
    type: "GATEWAY",
    slot: "G",
    capacityUnits: 4.0,
    priceEur: 4500,
    coneHalfAngleRad: CONE_GATEWAY,
    eirp: NET_STANDARD_EIRP,
  },
  {
    id: "CROSSLINK",
    label: "CROSSLINK",
    type: "CROSSLINK",
    slot: "S",
    capacityUnits: 1.6,
    priceEur: 1800,
    coneHalfAngleRad: CONE_CROSSLINK,
    eirp: NET_STANDARD_EIRP,
  },
];

/** Look up a card by id (null when unknown — the applier falls back to the default). */
export function antennaCardById(id: string): AntennaCard | null {
  return ANTENNA_CARDS.find((c) => c.id === id) ?? null;
}

/** Build the {@link AntennaSpec} a card resolves to (the applier + builder share this,
 * so the previewed loadout is byte-identical to the committed one). */
export function antennaFromCard(card: AntennaCard, rangeRefM: number): AntennaSpec {
  return {
    type: card.type,
    cardId: card.id,
    coneHalfAngleRad: card.coneHalfAngleRad,
    eirp: card.eirp,
    rangeRefM,
    capacityUnits: card.capacityUnits,
  };
}

/** Validate a loadout (card ids) against a bus tier's slots: each G card consumes a G
 * slot, each S card an S slot; over-filling a class rejects. Returns the offending
 * problem string or null when valid. Pure (the builder + the applier share the rule). */
export function validateLoadout(bus: BusTier, cardIds: readonly string[]): string | null {
  const spec = BUS_SPECS[bus];
  let g = 0;
  let s = 0;
  for (const id of cardIds) {
    const card = antennaCardById(id);
    if (card === null) return `unknown antenna card "${id}"`;
    if (card.slot === "G") g++;
    else s++;
  }
  if (g > spec.gSlots) return `${spec.label} carries ${spec.gSlots} G slot(s); ${g} G cards fitted`;
  if (s > spec.sSlots) return `${spec.label} carries ${spec.sSlots} S slot(s); ${s} S cards fitted`;
  if (g + s === 0) return "no antennas fitted — the sat would fly deaf";
  return null;
}

/** Hardware price (€) of a sat design: the bus + every fitted card. Launch cost (mass ×
 * altitude) is priced separately in world.ts. Pure. */
export function hardwarePriceEur(bus: BusTier, cardIds: readonly string[]): number {
  let sum = BUS_SPECS[bus].priceEur;
  for (const id of cardIds) sum += antennaCardById(id)?.priceEur ?? 0;
  return sum;
}

/** THE WIRE-DEFAULT LOADOUT (FL-01): the card ids a launch with an absent/empty wire
 * loadout is fitted with — AND charged for. The applier defaults to this BEFORE
 * validation + pricing, so a defaulted launch pays for the BROADCAST it flies (no free
 * antenna via a lean wire dict). */
export const DEFAULT_LOADOUT_CARD_IDS: readonly string[] = ["BROADCAST"];

/**
 * The standard DEFAULT loadout — one BROADCAST card. This is what a launch action that
 * carries no explicit loadout resolves to (back-compat: every pre-R0 recorded launch was
 * a broadcast smallsat), and the Act-1 builder's safe suggestion. `rangeRefM` is supplied
 * by the caller (the link-budget module's reference distance).
 */
export function standardLoadout(rangeRefM: number): AntennaSpec[] {
  const card = antennaCardById(DEFAULT_LOADOUT_CARD_IDS[0]);
  return card ? [antennaFromCard(card, rangeRefM)] : [];
}

/** Resolve a loadout of card ids into {@link AntennaSpec}s (unknown ids are skipped —
 * the applier validates first; this keeps the resolve total). Empty ⇒ the standard
 * BROADCAST loadout, preserving the pre-R0 wire default. Pure. */
export function resolveLoadout(cardIds: readonly string[] | undefined, rangeRefM: number): AntennaSpec[] {
  if (!cardIds || cardIds.length === 0) return standardLoadout(rangeRefM);
  const out: AntennaSpec[] = [];
  for (const id of cardIds) {
    const card = antennaCardById(id);
    if (card !== null) out.push(antennaFromCard(card, rangeRefM));
  }
  return out.length > 0 ? out : standardLoadout(rangeRefM);
}

/**
 * FL-06 (SD-46) — the planner's FIT suggestion: a VIABLE-BUT-IMPERFECT loadout for the
 * target tender's active SLA axes, never the optimal one (the locked planner rule, spec
 * §3.2 / m1-redesign: "a planner that solves the puzzle is a vending machine"). Greedy
 * legality only:
 *   - latency-axis live  ⇒ a spot beam is REQUIRED (BROADCAST is down-only and can never
 *     carry a latency SLA) — ACCESS-S, the cheapest legal spot;
 *   - bandwidth-axis live ⇒ upsize the spot to ACCESS-L (headroom, not optimisation —
 *     GATEWAY-level provisioning is the player's job);
 *   - otherwise           ⇒ the standard BROADCAST floodlight.
 * Always slot-legal on the given bus (T1's 1G accepts any of these singles). Excess slots
 * are left EMPTY — filling them is the player's ceiling. Pure.
 */
export function suggestLoadout(
  bus: BusTier,
  needs: { latency: boolean; bandwidth: boolean },
): string[] {
  void bus; // every suggestion below is legal on every bus (one G card max) — by design.
  if (needs.latency || needs.bandwidth) return [needs.bandwidth ? "ACCESS_L" : "ACCESS_S"];
  return [...DEFAULT_LOADOUT_CARD_IDS];
}
