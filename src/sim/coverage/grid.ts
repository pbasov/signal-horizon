/**
 * M2a — the geodesic coverage grid (GDD §4.2 "Information & Coverage — The Heart").
 *
 * A roll-your-own subdivided-icosahedron tiling over a body surface — NO H3 /
 * external library dependency (implementation plan ~line 170: "roll-your-own
 * subdivided-icosahedron, no H3 dependency"). This is the TRUTH layer for
 * Tier-1 surface coverage: a near-uniform set of cells, each with a stable id,
 * a centre as a UNIT VECTOR (and lat/lon), edge-adjacency, and a solid-angle
 * AREA. M2b renders it; later tickets wire it into a session.
 *
 * --- CELL MODEL: TRIANGULAR FACES (not the Goldberg/hex dual) ---------------
 * We tile with the TRIANGULAR FACES of the subdivided icosahedron. The base
 * icosahedron has 20 faces; each subdivision splits every triangle into 4, so:
 *
 *     cellCount(level) = 20 · 4^level
 *
 * (level 0 → 20, level 1 → 80, level 2 → 320, level 3 → 1280). We pick the
 * triangular-face tiling over the hex/pent Goldberg dual because (a) the cell
 * count is an exact closed form, (b) every cell has exactly three edge
 * neighbours (no pentagon special-casing), and (c) it is the simplest thing
 * that satisfies §4.2 — a near-uniform demand grid. The dual is a later
 * refinement if we ever want hexagons for the heatmap aesthetic.
 *
 * PURITY: pure TypeScript. No three.js, no DOM, no wall-clock, no RNG. The grid
 * is built deterministically from fixed icosahedron constants + integer
 * subdivision; same level → byte-identical grid. f64 throughout (the sim never
 * returns a Vector3; centres are plain number[] unit vectors).
 */

import type { Vec3 } from "../ephemeris";

/** Default subdivision level — a one-place dial. Level 2 → 320 cells: enough to
 * read demand gradients across the globe without any perf worry, and the
 * heatmap (§5 view #2) stays legible. Tune later. */
export const DEFAULT_GRID_LEVEL = 2;

/** Triangular-face cell count at a subdivision level: 20·4^level. */
export function cellCount(level: number): number {
  return 20 * 4 ** level;
}

/** One geodesic cell: a triangular face of the subdivided icosahedron. */
export interface Cell {
  /** Stable index into {@link GeodesicGrid.cells} (also its id). Deterministic
   * for a given level: faces are emitted in a fixed subdivision order. */
  id: number;
  /** Cell centre as a UNIT VECTOR (the normalised centroid of its 3 vertices). */
  center: Vec3;
  /** Geographic latitude of the centre, radians in [-π/2, π/2]. */
  latRad: number;
  /** Geographic longitude of the centre, radians in (-π, π]. */
  lonRad: number;
  /** The three corner vertices as unit vectors (CCW seen from outside). */
  vertices: [Vec3, Vec3, Vec3];
  /** Edge-adjacent neighbour cell ids (exactly 3 for a closed triangle mesh). */
  neighbors: number[];
  /** Solid-angle area of the spherical triangle (steradians); Σ over cells ≈ 4π. */
  area: number;
}

// --- vector helpers (local, f64; the sim never returns a three Vector3) -----

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}
function len(a: Vec3): number {
  return Math.sqrt(a[0] * a[0] + a[1] * a[1] + a[2] * a[2]);
}
function normalize(a: Vec3): Vec3 {
  const l = len(a);
  return l > 0 ? [a[0] / l, a[1] / l, a[2] / l] : [0, 0, 0];
}
function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}
function cross(a: Vec3, b: Vec3): Vec3 {
  return [
    a[1] * b[2] - a[2] * b[1],
    a[2] * b[0] - a[0] * b[2],
    a[0] * b[1] - a[1] * b[0],
  ];
}

/** Unit vector → geographic (latitude, longitude) in radians. z is the polar
 * axis, x at lon 0. Pure inverse of the usual lat/lon→unit mapping. */
export function unitToLatLon(u: Vec3): { latRad: number; lonRad: number } {
  const n = normalize(u);
  return { latRad: Math.asin(Math.max(-1, Math.min(1, n[2]))), lonRad: Math.atan2(n[1], n[0]) };
}

/** Geographic (latitude, longitude) in radians → outward unit vector. */
export function latLonToUnit(latRad: number, lonRad: number): Vec3 {
  const cl = Math.cos(latRad);
  return [cl * Math.cos(lonRad), cl * Math.sin(lonRad), Math.sin(latRad)];
}

/**
 * Solid angle (steradians) of the spherical triangle with unit-vector corners
 * a, b, c, via L'Huilier's theorem. Robust + sign-free for non-degenerate
 * triangles. Returns 0 for a degenerate (collinear) triangle.
 */
export function sphericalTriangleArea(a: Vec3, b: Vec3, c: Vec3): number {
  // Side lengths are the great-circle angles between the corners.
  const sa = Math.acos(Math.max(-1, Math.min(1, dot(b, c))));
  const sb = Math.acos(Math.max(-1, Math.min(1, dot(a, c))));
  const sc = Math.acos(Math.max(-1, Math.min(1, dot(a, b))));
  const s = (sa + sb + sc) / 2;
  const t =
    Math.tan(s / 2) *
    Math.tan((s - sa) / 2) *
    Math.tan((s - sb) / 2) *
    Math.tan((s - sc) / 2);
  if (t <= 0) return 0;
  return 4 * Math.atan(Math.sqrt(t));
}

// --- base icosahedron --------------------------------------------------------

/** The 12 icosahedron vertices, golden-ratio construction, normalised to unit. */
function icosahedronVertices(): Vec3[] {
  const phi = (1 + Math.sqrt(5)) / 2;
  const raw: Vec3[] = [
    [-1, phi, 0], [1, phi, 0], [-1, -phi, 0], [1, -phi, 0],
    [0, -1, phi], [0, 1, phi], [0, -1, -phi], [0, 1, -phi],
    [phi, 0, -1], [phi, 0, 1], [-phi, 0, -1], [-phi, 0, 1],
  ];
  return raw.map(normalize);
}

/** The 20 triangular faces of the icosahedron as vertex-index triples (CCW). */
const ICOSA_FACES: Array<[number, number, number]> = [
  [0, 11, 5], [0, 5, 1], [0, 1, 7], [0, 7, 10], [0, 10, 11],
  [1, 5, 9], [5, 11, 4], [11, 10, 2], [10, 7, 6], [7, 1, 8],
  [3, 9, 4], [3, 4, 2], [3, 2, 6], [3, 6, 8], [3, 8, 9],
  [4, 9, 5], [2, 4, 11], [6, 2, 10], [8, 6, 7], [9, 8, 1],
];

/** A face triple as a vertex-index list (mutable working type). */
type Tri = [number, number, number];

/**
 * The built grid: an immutable, deterministic geodesic cell set over the unit
 * sphere at a given subdivision level. Reused for every body (the cells are on
 * the unit sphere; the body radius enters the coverage field, not the grid).
 */
export class GeodesicGrid {
  readonly level: number;
  readonly cells: Cell[];

  private constructor(level: number, cells: Cell[]) {
    this.level = level;
    this.cells = cells;
  }

  /** How many cells this grid holds (== cellCount(level)). */
  get size(): number {
    return this.cells.length;
  }

  /** Edge-adjacent neighbour ids of a cell (exactly 3 on a closed mesh). */
  neighborsOf(id: number): number[] {
    return this.cells[id].neighbors;
  }

  /**
   * Build the grid deterministically at `level`. Subdivides the icosahedron
   * `level` times (each triangle → 4), vertices are shared via a midpoint cache
   * keyed on the lower-index-first vertex pair, then projected to the unit
   * sphere. Faces are emitted in a fixed order, so the cell ids are stable.
   */
  static build(level: number = DEFAULT_GRID_LEVEL): GeodesicGrid {
    if (!Number.isInteger(level) || level < 0) {
      throw new Error(`GeodesicGrid level must be a non-negative integer, got ${level}`);
    }
    const verts: Vec3[] = icosahedronVertices();
    let faces: Tri[] = ICOSA_FACES.map((f) => [f[0], f[1], f[2]] as Tri);

    // Midpoint cache: undirected edge (i,j) → index of the shared midpoint vert.
    const midCache = new Map<number, number>();
    const edgeKey = (i: number, j: number): number => {
      const lo = Math.min(i, j);
      const hi = Math.max(i, j);
      // Pack into one integer key; vertex count stays well under 2^16.
      return lo * 65536 + hi;
    };
    const midpoint = (i: number, j: number): number => {
      const key = edgeKey(i, j);
      const hit = midCache.get(key);
      if (hit !== undefined) return hit;
      const m = normalize(scale(add(verts[i], verts[j]), 0.5));
      const idx = verts.length;
      verts.push(m);
      midCache.set(key, idx);
      return idx;
    };

    for (let s = 0; s < level; s++) {
      const next: Tri[] = [];
      for (const [a, b, c] of faces) {
        const ab = midpoint(a, b);
        const bc = midpoint(b, c);
        const ca = midpoint(c, a);
        // Four child triangles, corner CCW order preserved.
        next.push([a, ab, ca], [b, bc, ab], [c, ca, bc], [ab, bc, ca]);
      }
      faces = next;
    }

    // Build cells (centre + lat/lon + area); neighbours wired in a second pass.
    const cells: Cell[] = faces.map((f, id) => {
      const va = verts[f[0]];
      const vb = verts[f[1]];
      const vc = verts[f[2]];
      const center = normalize(add(add(va, vb), vc));
      const { latRad, lonRad } = unitToLatLon(center);
      return {
        id,
        center,
        latRad,
        lonRad,
        vertices: [va, vb, vc],
        neighbors: [],
        area: sphericalTriangleArea(va, vb, vc),
      };
    });

    // Edge adjacency: two triangles are neighbours iff they share an edge (a
    // pair of vertex indices). Symmetric by construction.
    const edgeToFaces = new Map<number, number[]>();
    faces.forEach((f, id) => {
      const edges: Array<[number, number]> = [
        [f[0], f[1]],
        [f[1], f[2]],
        [f[2], f[0]],
      ];
      for (const [i, j] of edges) {
        const key = edgeKey(i, j);
        const arr = edgeToFaces.get(key);
        if (arr) arr.push(id);
        else edgeToFaces.set(key, [id]);
      }
    });
    for (const owners of edgeToFaces.values()) {
      // A closed manifold edge has exactly two owning faces; wire them mutually.
      for (let i = 0; i < owners.length; i++) {
        for (let j = i + 1; j < owners.length; j++) {
          const a = owners[i];
          const b = owners[j];
          if (!cells[a].neighbors.includes(b)) cells[a].neighbors.push(b);
          if (!cells[b].neighbors.includes(a)) cells[b].neighbors.push(a);
        }
      }
    }
    // Keep neighbour lists in ascending id order for determinism.
    for (const c of cells) c.neighbors.sort((x, y) => x - y);

    return new GeodesicGrid(level, cells);
  }
}

// re-export the vector helpers used by the coverage field so it does not
// re-derive them (keep the geometry in one place).
export const _vec = { add, scale, len, normalize, dot, cross };
