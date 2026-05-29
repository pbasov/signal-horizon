/**
 * Analytic Keplerian ephemeris — a faithful TypeScript port of the pure orbital
 * TRUTH layer from SignalHorizon.Sim/Ephemeris.cs + OrbitalBody.cs.
 *
 * TypeScript `number` is IEEE-754 f64 natively, so this carries the same
 * precision as the C# `double` original with no special handling. The port
 * preserves the exact algorithm:
 *   - FIXED 8-iteration Newton solver for Kepler's equation (no tolerance branch
 *     → identical control flow → determinism), seeded E = M + e·sin(M).
 *   - 3-1-3 (raan, inc, argp) perifocal → ecliptic-J2000 rotation, identical
 *     matrix for position and velocity.
 *   - Mean anomaly wrapped to [-π, π] with fmod semantics (JS `%` on numbers ==
 *     C# `%` on doubles: truncated remainder, sign follows dividend).
 *   - World position composed by recursing to the parent body.
 *
 * Positions are Vec3 [x,y,z] in METRES, heliocentric ecliptic-J2000, absolute.
 * Pure function of (id, t): same inputs → same outputs. No wall-clock, no RNG.
 *
 * Units on load: data/system.json is AU/km/deg; this converts to SI/radians,
 * exactly mirroring Ephemeris.Build.
 */

export type Vec3 = [number, number, number];

/** astronomical unit in metres (IAU 2012). */
export const AU_M = 1.495978707e11;
/** kilometre in metres. */
export const KM_M = 1000.0;
/** degrees → radians. */
export const DEG_RAD = Math.PI / 180.0;
/** Newton iterations for Kepler's equation. FIXED for deterministic control flow. */
export const KEPLER_ITERS = 8;
/** Speed of light in vacuum (m/s), exact by SI definition. Mirrors SignalDelay.CLight. */
export const C_LIGHT = 299792458.0;

const TAU = Math.PI * 2; // System.Math.Tau

/** Classical Keplerian elements + physical constants for one body (SI/radians after load). */
export class OrbitalBody {
  id = "";
  parent = "";
  muParent = 0;
  muSelf = 0;
  radiusM = 0;
  a = 0;
  e = 0;
  inc = 0;
  raan = 0;
  argp = 0;
  m0 = 0;
  epoch = 0;
  n = 0;

  /** True for the root body (Sun): no orbit, position is the origin. */
  isRoot(): boolean {
    return this.parent === "" || this.a <= 0.0;
  }

  /** Recompute derived mean motion n = sqrt(muParent / a^3). Safe for the root (a==0). */
  recomputeN(): void {
    if (this.a > 0.0 && this.muParent > 0.0) {
      this.n = Math.sqrt(this.muParent / (this.a * this.a * this.a));
    } else {
      this.n = 0.0;
    }
  }

  /** Orbital period in seconds (2π / n). 0 for the root / undefined orbit. */
  periodSeconds(): number {
    if (this.n <= 0.0) return 0.0;
    return TAU / this.n;
  }
}

/** Raw shape of one body/satellite entry in data/system.json. */
interface BodySpec {
  parent?: string | null;
  mu?: number;
  radius_km?: number;
  a_au?: number;
  a_km?: number;
  e?: number;
  inc_deg?: number;
  raan_deg?: number;
  argp_deg?: number;
  m0_deg?: number;
  epoch_seconds?: number;
}

/** Raw shape of data/system.json. */
export interface SystemSpec {
  epoch_jd?: number;
  frame?: string;
  bodies?: Record<string, BodySpec>;
  satellites?: Record<string, BodySpec>;
}

export class Ephemeris {
  readonly bodies = new Map<string, OrbitalBody>();
  epochJd = 0;
  frame = "";

  /** Build from a parsed system.json object. Mirrors Ephemeris.Build exactly. */
  static build(root: SystemSpec): Ephemeris {
    const eph = new Ephemeris();
    eph.epochJd = root.epoch_jd ?? 0.0;
    eph.frame = root.frame ?? "";

    // First pass: instantiate every body/satellite. Merge "bodies" and
    // "satellites" into one flat table (same propagation), bodies first.
    const sources: Array<Record<string, BodySpec>> = [];
    if (root.bodies) sources.push(root.bodies);
    if (root.satellites) sources.push(root.satellites);

    for (const table of sources) {
      for (const id of Object.keys(table)) {
        const spec = table[id];
        if (spec == null || typeof spec !== "object") continue;
        const b = new OrbitalBody();
        b.id = id;
        b.parent = spec.parent == null ? "" : String(spec.parent);
        b.muSelf = spec.mu ?? 0.0;
        b.radiusM = (spec.radius_km ?? 0.0) * KM_M;
        b.a = Ephemeris.semiMajorM(spec);
        b.e = spec.e ?? 0.0;
        b.inc = (spec.inc_deg ?? 0.0) * DEG_RAD;
        b.raan = (spec.raan_deg ?? 0.0) * DEG_RAD;
        b.argp = (spec.argp_deg ?? 0.0) * DEG_RAD;
        b.m0 = (spec.m0_deg ?? 0.0) * DEG_RAD;
        b.epoch = spec.epoch_seconds ?? 0.0;
        eph.bodies.set(b.id, b);
      }
    }

    // Second pass: resolve muParent from each body's parent and derive n.
    for (const b of eph.bodies.values()) {
      const p = b.parent !== "" ? eph.bodies.get(b.parent) : undefined;
      b.muParent = p ? p.muSelf : 0.0;
      b.recomputeN();
    }

    return eph;
  }

  /** Pick semi-major axis from a_km (preferred for moons/sats) or a_au, in metres. */
  private static semiMajorM(spec: BodySpec): number {
    if (spec.a_km !== undefined) return spec.a_km * KM_M;
    if (spec.a_au !== undefined) return spec.a_au * AU_M;
    return 0.0;
  }

  // --- Contract API (pinned names mirroring the C# layer) -------------------

  bodyIds(): string[] {
    return [...this.bodies.keys()];
  }

  hasBody(id: string): boolean {
    return this.bodies.has(id);
  }

  parentOf(id: string): string {
    return this.bodies.get(id)?.parent ?? "";
  }

  radiusMeters(id: string): number {
    return this.bodies.get(id)?.radiusM ?? 0.0;
  }

  /**
   * Absolute world position of `id` at time `t` (sim-seconds): Vec3 metres,
   * heliocentric ecliptic-J2000. Pure function of (id, t); composes the parent
   * hierarchy by recursion.
   */
  position(id: string, t: number): Vec3 {
    const b = this.bodies.get(id);
    if (!b) return [0, 0, 0];
    if (b.isRoot()) return [0, 0, 0];
    const rel = this.relativePosition(b, t);
    const par = this.position(b.parent, t);
    return [par[0] + rel[0], par[1] + rel[1], par[2] + rel[2]];
  }

  /** Absolute world velocity of `id` at time `t` (sim-seconds), m/s. */
  velocity(id: string, t: number): Vec3 {
    const b = this.bodies.get(id);
    if (!b) return [0, 0, 0];
    if (b.isRoot()) return [0, 0, 0];
    const rel = this.relativeVelocity(b, t);
    const par = this.velocity(b.parent, t);
    return [par[0] + rel[0], par[1] + rel[1], par[2] + rel[2]];
  }

  /** Instantaneous straight-line distance between two bodies at time t (metres). */
  distanceBetween(a: string, b: string, t: number): number {
    const pa = this.position(a, t);
    const pb = this.position(b, t);
    const dx = pa[0] - pb[0];
    const dy = pa[1] - pb[1];
    const dz = pa[2] - pb[2];
    return Math.sqrt(dx * dx + dy * dy + dz * dz);
  }

  // --- Kepler propagation ---------------------------------------------------

  /**
   * Eccentric anomaly E from mean anomaly M (radians) via Newton's method with a
   * FIXED iteration count. Seed E = M + e·sin(M). Mirrors SolveEccentricAnomaly.
   */
  static solveEccentricAnomaly(meanAnom: number, e: number): number {
    let ecc = meanAnom + e * Math.sin(meanAnom);
    for (let i = 0; i < KEPLER_ITERS; i++) {
      const f = ecc - e * Math.sin(ecc) - meanAnom;
      const fp = 1.0 - e * Math.cos(ecc);
      ecc -= f / fp;
    }
    return ecc;
  }

  /** Wrap an angle into [-π, π]. fmod semantics (JS `%`), NOT IEEERemainder. */
  private static wrapPi(angle: number): number {
    let x = (angle + Math.PI) % TAU;
    if (x < 0.0) x += TAU;
    return x - Math.PI;
  }

  /** Position of `b` RELATIVE TO ITS PARENT at time t (metres) — steps 1-5. */
  private relativePosition(b: OrbitalBody, t: number): Vec3 {
    const meanAnom = Ephemeris.wrapPi(b.m0 + b.n * (t - b.epoch));
    return Ephemeris.positionFromMeanAnomaly(b, meanAnom);
  }

  /** Steps 2-5 of propagation from a mean anomaly (radians). Pure. */
  private static positionFromMeanAnomaly(b: OrbitalBody, meanAnom: number): Vec3 {
    const ecc = Ephemeris.solveEccentricAnomaly(meanAnom, b.e);
    const cosE = Math.cos(ecc);
    const sinE = Math.sin(ecc);
    const nu = Math.atan2(Math.sqrt(1.0 - b.e * b.e) * sinE, cosE - b.e);
    const r = b.a * (1.0 - b.e * cosE);
    const xOrb = r * Math.cos(nu);
    const yOrb = r * Math.sin(nu);
    return Ephemeris.rotatePerifocal(b, xOrb, yOrb);
  }

  /**
   * Sample one full closed orbit of `id` RELATIVE TO ITS PARENT (metres), as
   * `count` points evenly spaced in mean anomaly. Used by the renderer to draw
   * dashed orbit rings — a geometric sample, independent of sim-time t. Returns
   * [] for the root / element-less bodies.
   */
  sampleRelativeOrbit(id: string, count: number): Vec3[] {
    const b = this.bodies.get(id);
    if (!b || b.isRoot()) return [];
    const out: Vec3[] = [];
    for (let k = 0; k < count; k++) {
      const m = (Math.PI * 2 * k) / count - Math.PI; // span [-π, π)
      out.push(Ephemeris.positionFromMeanAnomaly(b, m));
    }
    return out;
  }

  /** Velocity of `b` RELATIVE TO ITS PARENT at time t (m/s). */
  private relativeVelocity(b: OrbitalBody, t: number): Vec3 {
    const meanAnom = Ephemeris.wrapPi(b.m0 + b.n * (t - b.epoch));
    const ecc = Ephemeris.solveEccentricAnomaly(meanAnom, b.e);
    const cosE = Math.cos(ecc);
    const sinE = Math.sin(ecc);
    const denom = 1.0 - b.e * cosE;
    const vxOrb = -(b.n * b.a / denom) * sinE;
    const vyOrb = (b.n * b.a * Math.sqrt(1.0 - b.e * b.e) / denom) * cosE;
    return Ephemeris.rotatePerifocal(b, vxOrb, vyOrb);
  }

  /**
   * Apply the 3-1-3 (raan, inc, argp) perifocal→ecliptic rotation to an in-plane
   * vector (xOrb, yOrb). Identical matrix for position and velocity.
   */
  private static rotatePerifocal(b: OrbitalBody, xOrb: number, yOrb: number): Vec3 {
    const cO = Math.cos(b.raan);
    const sO = Math.sin(b.raan);
    const ci = Math.cos(b.inc);
    const si = Math.sin(b.inc);
    const cw = Math.cos(b.argp);
    const sw = Math.sin(b.argp);
    const x = (cO * cw - sO * sw * ci) * xOrb + (-cO * sw - sO * cw * ci) * yOrb;
    const y = (sO * cw + cO * sw * ci) * xOrb + (-sO * sw + cO * cw * ci) * yOrb;
    const z = (sw * si) * xOrb + (cw * si) * yOrb;
    return [x, y, z];
  }
}
