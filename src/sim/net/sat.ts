/**
 * net/ — the satellite ATOM (design §2.1). A launched sat is its orbit (the unforked
 * {@link SatOrbit}) plus a bus tier and an antenna loadout. Migrated from a1/sat.ts.
 *
 * Dropped in the migration (design §1, A0): the `A1_DISH_EIRP=1.1` "closing-lever"
 * forced-imperfection knob and its `dishLoadout`. EIRP stays a REAL antenna field
 * feeding the inverse-square link budget — never an Act-1 imperfection. Act 1 has NO
 * forced imperfection: the standard eirp 1.0 antenna covers the whole equatorial
 * region disc from the parked GEO with margin (pinned in A1).
 *
 * PURE: no three, no DOM, no wall-clock, no RNG. Reuses {@link SatOrbit} from the M2
 * roster as-is (NOT forked); orbit propagation is the unforked solveOrbit.
 *
 * Generalizes (design §2.1): more bus tiers / antenna types / slot classes drop in as
 * enum members + loadout entries; frame + pacing never change.
 *
 * @see docs/signal-horizon-m1-design.md §2.1 (sat atom).
 */

import type { SatOrbit } from "../m2/roster";

/** Bus tier — only one exists in Act 1 (deferred tiers 2–4 are named, not built). */
export type BusTier = "smallsat";

/** Antenna purpose. BROADCAST = the wide coverage beam; ACCESS = a directional link.
 * Both reuse the same field.ts inverse-square budget. */
export type AntennaType = "BROADCAST" | "ACCESS";

/** Antenna slot class — only "G" (general) in Act 1 (S-slots deferred). */
export type SlotClass = "G";

/**
 * One antenna fitted to a sat. `eirp` feeds the inverse-square link budget
 * (received ∝ eirp·(rangeRefM/d)² ≥ 1) — a real antenna field, not a knob.
 */
export interface AntennaSpec {
  type: AntennaType;
  /** Beam cone half-angle (radians) — the footprint half-angle hint. */
  coneHalfAngleRad: number;
  /** Effective isotropic radiated power (toy units; 1.0 = the standard antenna). */
  eirp: number;
  /** Reference link distance (metres) at which the budget just closes. */
  rangeRefM: number;
}

/** A launched satellite: its orbit + bus + antenna loadout. JSON-safe. */
export interface NetSat {
  id: string;
  orbit: SatOrbit;
  bus: BusTier;
  loadout: AntennaSpec[];
}

/** Standard antenna EIRP (the GEO-park default — covers the whole disc with margin). */
export const NET_STANDARD_EIRP = 1.0;

/**
 * The standard BROADCAST loadout — one {@link AntennaSpec} at the standard eirp. The
 * `rangeRefM` is supplied by the caller (the link-budget module's reference distance)
 * so this atom stays free of the link-budget import.
 */
export function standardLoadout(rangeRefM: number): AntennaSpec[] {
  return [
    {
      type: "BROADCAST",
      coneHalfAngleRad: 30 * (Math.PI / 180),
      eirp: NET_STANDARD_EIRP,
      rangeRefM,
    },
  ];
}
