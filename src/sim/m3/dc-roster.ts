/**
 * M3a — THE DATACENTER ROSTER + THE FORCE-MULTIPLIER FOOTPRINT (GDD §4.5).
 *
 * The placeable {@link Datacenter} nodes the player has built — a SMALL set of strategic
 * compute nodes (Risk-5: a handful matter, NOT a base-builder). This is the M3 sibling of
 * the M2 {@link import("../m2/roster").Roster}: PURE, DETERMINISTIC, SAVEABLE state, mutated
 * only through {@link DCRoster.place} / {@link DCRoster.restore}. It folds straight into the
 * M2 BuildSession snapshot/state-hash, so the DC fleet replays bit-identically.
 *
 * The roster also owns the EDGE-COMPUTE FOOTPRINT test (GDD §4.5 "edge compute: transmit
 * conclusions not bytes"): which contracts a DC's compute reaches. A contract is in a DC's
 * footprint when its region centroid is within {@link DC_FOOTPRINT_RADIUS_RAD} of the DC's
 * sub-point on the SAME body — so an Earth-orbit DC lifts Earth-region contracts in its reach,
 * not the whole globe. The per-contract lift is the BEST (max) lift of any covering DC (a
 * region is processed by its nearest/biggest DC, not stacked), keeping the multiplier bounded.
 *
 * PURE: no three / DOM / wall-clock / RNG. The lift is a pure function of (DC roster, the
 * body geometry at t, the contract centroids).
 */

import type { Ephemeris } from "../ephemeris";
import { latLonToUnit, _vec } from "../coverage/grid";
import {
  type Datacenter,
  type DCSite,
  computeLiftMultiplier,
  resolveDCCompute,
  DC_FOOTPRINT_RADIUS_RAD,
} from "./datacenter";

const { dot } = _vec;

/** A region anchor a DC footprint test reads: a body + a centroid lat/lon (radians). A
 * contract supplies its {@link import("../m2/contracts").Contract} centre as one of these. */
export interface FootprintRegion {
  bodyId: string;
  latRad: number;
  lonRad: number;
}

/** JSON-safe capture of the DC roster (save/snapshot round-trip + state-hash parity). */
export interface DCRosterSnapshot {
  datacenters: Datacenter[];
  /** Monotonic id counter so placed DC ids never collide across a session. */
  nextId: number;
}

/**
 * The deterministic datacenter roster. Holds the player's placed DCs and answers the
 * force-multiplier question: how much does the DC fleet's edge compute lift a contract in
 * its footprint at sim-time t. Pure; mutated only through {@link place} / {@link restore}.
 */
export class DCRoster {
  private dcs: Datacenter[] = [];
  private nextId = 0;

  /** Number of placed datacenters (a handful at most matter — §4.5). */
  get count(): number {
    return this.dcs.length;
  }

  /** A stable, read-only view of the placed DCs (placement order). */
  list(): readonly Datacenter[] {
    return this.dcs;
  }

  /**
   * PLACE a datacenter at `bodyId` with the given panel/radiator areas + RTG option. Returns
   * the new DC's id. Deterministic: the id is the monotonic counter, never an RNG draw. The
   * € capex is charged by the caller (the session, via the logged capex action) — this only
   * adds the node to the roster, like {@link import("../m2/roster").Roster.deployGround}.
   */
  place(
    bodyId: DCSite,
    subLatRad: number,
    subLonRad: number,
    panelM2: number,
    radiatorM2: number,
    rtg: boolean,
  ): string {
    const id = `dc${this.nextId++}`;
    this.dcs.push({ id, bodyId, subLatRad, subLonRad, panelM2, radiatorM2, rtg });
    return id;
  }

  /**
   * THE FORCE-MULTIPLIER applied to one region at sim-time t: the BEST (max) compute-lift
   * multiplier (≥ 1.0) of any placed DC whose footprint covers the region — the DC processes
   * the region's traffic at the edge, lifting the € the same coverage earns (§4.5 "transmit
   * conclusions not bytes"). A region out of every DC's footprint gets 1.0 (no lift). MAX (not
   * sum) keeps the lift bounded by a single DC's saturating cap — no stacking runaway (Risk-5).
   *
   * Footprint test: a DC on the SAME body covers a region whose centroid is within
   * {@link DC_FOOTPRINT_RADIUS_RAD} great-circle of the DC's SUB-POINT (the region it is
   * stationed over) — so a DC over South America lifts South-America contracts, not East-Asia
   * ones, and a cross-body DC does not reach another body's regions. Placement is a real
   * strategic choice. Pure function of (the DC roster, the contract centroid, t — t only matters
   * via the DC's distance-driven compute, which sets the lift magnitude).
   */
  liftFor(eph: Ephemeris, region: FootprintRegion, t: number): number {
    if (this.dcs.length === 0) return 1.0;
    const rc = latLonToUnit(region.latRad, region.lonRad);
    const cosFoot = Math.cos(DC_FOOTPRINT_RADIUS_RAD);
    let best = 1.0;
    for (const dc of this.dcs) {
      if (dc.bodyId !== region.bodyId) continue; // a DC only reaches its own body's regions
      const dcSub = latLonToUnit(dc.subLatRad, dc.subLonRad);
      const c = Math.max(-1, Math.min(1, dot(rc, dcSub)));
      if (c < cosFoot) continue; // region centroid outside the DC footprint cap
      const compute = resolveDCCompute(eph, dc, t).computeUnits;
      const mult = computeLiftMultiplier(compute);
      if (mult > best) best = mult;
    }
    return best;
  }

  /** Capture the DC roster by value (JSON-safe deep copy) for a snapshot/save. */
  snapshot(): DCRosterSnapshot {
    return { datacenters: this.dcs.map((d) => ({ ...d })), nextId: this.nextId };
  }

  /** Restore the DC roster from a snapshot (replaces the current contents). */
  restore(s: DCRosterSnapshot): void {
    this.dcs = (s.datacenters ?? []).map((d) => ({ ...d }));
    this.nextId = s.nextId ?? this.dcs.length;
  }
}
