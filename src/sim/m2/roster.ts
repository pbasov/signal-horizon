/**
 * M2c — THE PLACEABLE-ASSET ROSTER (GDD §3 "gap → asset → integration → revenue",
 * §4.7 launch, §1/§5 the MONUMENT). M2a/M2b made the coverage field + heatmap read
 * a FIXED set of dataset sats; M2c makes the coverage a thing the player BUILDS:
 * deploy ground stations + launch satellites, pay €, and the coverage web visibly
 * GROWS.
 *
 * This module is the PURE, DETERMINISTIC, SAVEABLE state — the set of player-owned
 * assets — plus the propagation that turns a launched sat's Keplerian orbit into a
 * world position the coverage field can score. No three / DOM / wall-clock / RNG
 * (any launch randomness is drawn from the seeded splitmix64 PRNG in the session,
 * never here).
 *
 * --- WHY A PARAMETRIC ORBIT, NOT AN EPHEMERIS BODY --------------------------
 * The M2a coverage field already accepts an {@link Asset} list and reads a sat's
 * world position via `eph.position(id, t)`. A launched sat, though, is created at
 * RUNTIME from a launch preset — it is not in data/system.json. Rather than mutate
 * the shared Ephemeris (which would entangle the launch with the orbital golden +
 * every other body read), a launched sat carries its OWN Keplerian element set
 * ({@link SatOrbit}) and we propagate it PURELY here, around its parent body's
 * ephemeris position. This reuses the proven Kepler solver (same fixed-iteration
 * control flow as ephemeris.ts) so a launched sat is as deterministic as a dataset
 * body, and the roster stays a self-contained, snapshot-friendly value.
 *
 * The roster produces, for any sim-time t, the {@link Asset}[] + matching world
 * positions the coverage field scores — so the live heatmap + score read THE
 * PLAYER ROSTER and grow as assets are built.
 */

import { type Ephemeris, type Vec3, DEG_RAD } from "../ephemeris";
import { solveOrbit } from "./orbit";
import { type Asset, DEFAULT_GROUND_ALTITUDE_M } from "../coverage/field";

/** A parametric Keplerian orbit for a LAUNCHED sat, around a parent body (e.g.
 * "earth"). SI/radians, mirroring the ephemeris element convention. The launch
 * EPOCH is the sim-time the sat reached orbit; m0 is its mean anomaly at that
 * epoch, so propagation is M(t) = m0 + n·(t − epoch). */
export interface SatOrbit {
  /** Parent body id (the ephemeris body the orbit is referenced to). */
  parentId: string;
  /** Semi-major axis (metres). */
  aM: number;
  /** Eccentricity (0 = circular). */
  e: number;
  /** Inclination (radians). */
  incRad: number;
  /** Right ascension of the ascending node (radians). */
  raanRad: number;
  /** Argument of periapsis (radians). */
  argpRad: number;
  /** Mean anomaly at {@link epochS} (radians). */
  m0Rad: number;
  /** Sim-time (seconds) the sat reached orbit — the orbit's epoch. */
  epochS: number;
  /** Standard gravitational parameter of the parent (m³/s²) — drives mean motion. */
  muParent: number;
}

/** A player-owned ground station: pinned to a body surface at lat/lon (radians). */
export interface RosterGround {
  id: string;
  kind: "ground";
  bodyId: string;
  latRad: number;
  lonRad: number;
  altitudeM: number;
  eirp: number;
}

/** A player-owned LAUNCHED satellite: a parametric Keplerian orbit + EIRP. */
export interface RosterSat {
  id: string;
  kind: "sat";
  orbit: SatOrbit;
  eirp: number;
}

/** A player-owned asset in the roster (ground station OR launched sat). */
export type RosterAsset = RosterGround | RosterSat;

/** JSON-safe capture of the whole placeable roster (save/snapshot round-trip). */
export interface RosterSnapshot {
  assets: RosterAsset[];
  /** Monotonic id counter so deployed/launched ids never collide across a session. */
  nextId: number;
}

/**
 * The deterministic placeable-asset roster. Holds the player's ground stations +
 * launched sats and produces, for a sim-time t, the coverage {@link Asset}[] +
 * matching world positions the field/score read. Pure: a function of (assets, t)
 * via the pure ephemeris + the pure Kepler propagation. Mutated only through
 * {@link deployGround} / {@link launchSat} / {@link restore}.
 */
export class Roster {
  /** Player-owned assets, in deploy/launch order (the order is part of the state). */
  private assets: RosterAsset[] = [];
  /** Monotonic id counter (g0, g1 … / s0, s1 …) — deterministic, no RNG. */
  private nextId = 0;

  /** Number of placed assets (the "size of the monument" readout). */
  get count(): number {
    return this.assets.length;
  }

  /** Ground-station count. */
  get groundCount(): number {
    let n = 0;
    for (const a of this.assets) if (a.kind === "ground") n++;
    return n;
  }

  /** Launched-sat count. */
  get satCount(): number {
    let n = 0;
    for (const a of this.assets) if (a.kind === "sat") n++;
    return n;
  }

  /** A stable, read-only view of the placed assets (deploy/launch order). */
  list(): readonly RosterAsset[] {
    return this.assets;
  }

  /**
   * Deploy a GROUND STATION at lat/lon (radians) on `bodyId`. Returns the new
   * asset's id. Deterministic: the id is the monotonic counter, never an RNG draw.
   */
  deployGround(
    bodyId: string,
    latRad: number,
    lonRad: number,
    eirp = 1.0,
    altitudeM = DEFAULT_GROUND_ALTITUDE_M,
  ): string {
    const id = `g${this.nextId++}`;
    this.assets.push({ id, kind: "ground", bodyId, latRad, lonRad, altitudeM, eirp });
    return id;
  }

  /** Add a LAUNCHED sat from a fully-resolved orbit. Returns the new sat's id. */
  launchSat(orbit: SatOrbit, eirp = 1.0): string {
    const id = `s${this.nextId++}`;
    this.assets.push({ id, kind: "sat", orbit, eirp });
    return id;
  }

  /**
   * The coverage {@link Asset}[] for the field/score. Ground stations map straight
   * to the field's ground-asset shape; launched sats become field "sat" assets
   * whose positions {@link worldPositions} supplies (the field reads positions out
   * of band via {@link import("../coverage/field").coverageDimsAt}, or via
   * `assetPosition` when given an ephemeris that knows the id — see scoreRoster).
   */
  coverageAssets(): Asset[] {
    return this.assets.map((a) =>
      a.kind === "ground"
        ? {
            id: a.id,
            kind: "ground" as const,
            bodyId: a.bodyId,
            latRad: a.latRad,
            lonRad: a.lonRad,
            altitudeM: a.altitudeM,
            eirp: a.eirp,
          }
        : { id: a.id, kind: "sat" as const, ephemerisId: a.id, eirp: a.eirp },
    );
  }

  /** Per-asset EIRP, in {@link list} order (for the allocation-free coverage sweep). */
  eirps(): number[] {
    return this.assets.map((a) => a.eirp);
  }

  /**
   * World positions (metres) of every asset at sim-time t, in {@link list} order:
   * a ground station via the body surface + altitude; a launched sat via PURE
   * Kepler propagation of its orbit around its parent's ephemeris position. This
   * is the per-frame input the coverage field's allocation-free sweep wants. Pure.
   */
  worldPositions(eph: Ephemeris, t: number, out?: Vec3[]): Vec3[] {
    const result = out ?? this.assets.map(() => [0, 0, 0] as Vec3);
    for (let i = 0; i < this.assets.length; i++) {
      const a = this.assets[i];
      const p = result[i] ?? ([0, 0, 0] as Vec3);
      if (a.kind === "ground") {
        groundWorld(eph, a, t, p);
      } else {
        satWorld(eph, a.orbit, t, p);
      }
      result[i] = p;
    }
    return result;
  }

  /** Capture the roster by value (JSON-safe deep copy) for a snapshot/save. */
  snapshot(): RosterSnapshot {
    return { assets: this.assets.map(cloneAsset), nextId: this.nextId };
  }

  /** Restore the roster from a snapshot (replaces the current contents). */
  restore(s: RosterSnapshot): void {
    this.assets = s.assets.map(cloneAsset);
    this.nextId = s.nextId;
  }
}

/** Deep-copy one roster asset (no shared mutable references across snapshots). */
function cloneAsset(a: RosterAsset): RosterAsset {
  return a.kind === "ground" ? { ...a } : { ...a, orbit: { ...a.orbit } };
}

/** Ground-station world position: body centre + (radius + altitude) · surface unit.
 * Body-fixed in the ecliptic frame (no rotation in the shipped ephemeris — the same
 * simplification the M2a field documents); the body CENTRE still moves with t. */
function groundWorld(eph: Ephemeris, a: RosterGround, t: number, out: Vec3): Vec3 {
  const c = eph.position(a.bodyId, t);
  const r = eph.radiusMeters(a.bodyId) + a.altitudeM;
  const cl = Math.cos(a.latRad);
  const ux = cl * Math.cos(a.lonRad);
  const uy = cl * Math.sin(a.lonRad);
  const uz = Math.sin(a.latRad);
  out[0] = c[0] + ux * r;
  out[1] = c[1] + uy * r;
  out[2] = c[2] + uz * r;
  return out;
}

/**
 * Launched-sat world position at sim-time t: propagate the Keplerian orbit (pure)
 * to a position relative to the parent, then add the parent's ephemeris position.
 */
function satWorld(eph: Ephemeris, orbit: SatOrbit, t: number, out: Vec3): Vec3 {
  const rel = solveOrbit(orbit, t);
  const par = eph.position(orbit.parentId, t);
  out[0] = par[0] + rel[0];
  out[1] = par[1] + rel[1];
  out[2] = par[2] + rel[2];
  return out;
}

// Re-export the convenience so callers building a SatOrbit don't re-derive DEG.
export { DEG_RAD };
