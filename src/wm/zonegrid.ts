/**
 * DD-10 zone-grid tiling model — a TypeScript reduction of SignalHorizon.Sim.Wm
 * (ZoneGrid.cs). A constrained grid (1–3 columns × 1–3 rows per column), each
 * zone holding one panel OR a tab group, with RELATIVE weights so survivors
 * auto-expand. NOT a binary-split tree; no floating, no occlusion, no gaps.
 *
 * Spike scope: of the full op set (Swap/Tab/Split/Close/Resize) this implements
 * the two interactions the brief calls for — title-bar-drag → SWAP and
 * edge-resize — plus the always-tiled VALIDATE gate. Tab/Split/Close are modelled
 * by the data shape (hosts[]/active) but not wired to gestures in this spike.
 *
 * Op discipline mirrors the C# Clone-Mutate-Validate pattern: ops never mutate
 * in place; they return a fresh grid, or null when the result is illegal.
 */

export interface Zone {
  hosts: string[];
  active: number;
}
export interface Row {
  weight: number;
  zone: Zone;
}
export interface Column {
  weight: number;
  rows: Row[];
}
export interface ZoneGrid {
  columns: Column[];
}

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export interface Placement {
  host: string;
  hosts: string[];
  active: number;
  ci: number;
  ri: number;
  rect: Rect;
}

export interface Divider {
  kind: "col" | "row";
  /** column index this divider belongs to (for row dividers); left column index (for col dividers) */
  ci: number;
  /** for row dividers, the top row index */
  ri: number;
  rect: Rect;
}

export interface Layout {
  placements: Placement[];
  dividers: Divider[];
}

export function cloneGrid(g: ZoneGrid): ZoneGrid {
  return {
    columns: g.columns.map((c) => ({
      weight: c.weight,
      rows: c.rows.map((r) => ({
        weight: r.weight,
        zone: { hosts: [...r.zone.hosts], active: r.zone.active },
      })),
    })),
  };
}

export function allHosts(g: ZoneGrid): string[] {
  const out: string[] = [];
  for (const c of g.columns) for (const r of c.rows) out.push(...r.zone.hosts);
  return out;
}

/**
 * The always-tiled invariant gate. Mirrors ZoneGrid.Validate(): 1–3 columns,
 * 1–3 rows per column, every zone has ≥1 host, ActiveIndex in range, no
 * duplicate hosts, all weights strictly positive.
 */
export function validate(g: ZoneGrid): boolean {
  if (g.columns.length < 1 || g.columns.length > 3) return false;
  const seen = new Set<string>();
  for (const c of g.columns) {
    if (!(c.weight > 0)) return false;
    if (c.rows.length < 1 || c.rows.length > 3) return false;
    for (const r of c.rows) {
      if (!(r.weight > 0)) return false;
      const z = r.zone;
      if (z.hosts.length < 1) return false;
      if (z.active < 0 || z.active >= z.hosts.length) return false;
      for (const h of z.hosts) {
        if (seen.has(h)) return false;
        seen.add(h);
      }
    }
  }
  return true;
}

function findActiveZone(g: ZoneGrid, host: string): Zone | null {
  for (const c of g.columns) {
    for (const r of c.rows) {
      if (r.zone.hosts[r.zone.active] === host) return r.zone;
    }
  }
  return null;
}

/**
 * SWAP — exchange the two panels (the active host of each zone). Preserves all
 * zone shapes + weights; it is a pure permutation. Returns null on a no-op
 * (same host) or an unknown host, or if the result fails the invariant.
 */
export function swap(g: ZoneGrid, a: string, b: string): ZoneGrid | null {
  if (a === b) return null;
  const ng = cloneGrid(g);
  const za = findActiveZone(ng, a);
  const zb = findActiveZone(ng, b);
  if (!za || !zb) return null;
  const tmp = za.hosts[za.active];
  za.hosts[za.active] = zb.hosts[zb.active];
  zb.hosts[zb.active] = tmp;
  return validate(ng) ? ng : null;
}

/** Repartition two adjacent columns by setting the left column's share to `frac`. */
export function setColumnSplit(g: ZoneGrid, leftIndex: number, frac: number): ZoneGrid {
  const ng = cloneGrid(g);
  const c0 = ng.columns[leftIndex];
  const c1 = ng.columns[leftIndex + 1];
  if (!c0 || !c1) return ng;
  const total = c0.weight + c1.weight;
  const f = Math.max(0.12, Math.min(0.88, frac));
  c0.weight = total * f;
  c1.weight = total * (1 - f);
  return ng;
}

/** Repartition two adjacent rows within a column by setting the top row's share to `frac`. */
export function setRowSplit(g: ZoneGrid, ci: number, topIndex: number, frac: number): ZoneGrid {
  const ng = cloneGrid(g);
  const col = ng.columns[ci];
  if (!col) return ng;
  const r0 = col.rows[topIndex];
  const r1 = col.rows[topIndex + 1];
  if (!r0 || !r1) return ng;
  const total = r0.weight + r1.weight;
  const f = Math.max(0.12, Math.min(0.88, frac));
  r0.weight = total * f;
  r1.weight = total * (1 - f);
  return ng;
}

/**
 * Solve the relative-weight grid into pixel rects. Columns share width by
 * weight; rows within a column share that column's height by weight. Gutters of
 * width `g` separate adjacent zones and carry the resize dividers.
 */
export function computeLayout(g: ZoneGrid, W: number, H: number, gut: number): Layout {
  const placements: Placement[] = [];
  const dividers: Divider[] = [];
  const ncol = g.columns.length;
  const colSum = g.columns.reduce((s, c) => s + c.weight, 0) || 1;
  const availW = Math.max(0, W - gut * (ncol - 1));
  let x = 0;
  g.columns.forEach((col, ci) => {
    const cw = availW * (col.weight / colSum);
    const nrow = col.rows.length;
    const rowSum = col.rows.reduce((s, r) => s + r.weight, 0) || 1;
    const availH = Math.max(0, H - gut * (nrow - 1));
    let y = 0;
    col.rows.forEach((row, ri) => {
      const rh = availH * (row.weight / rowSum);
      placements.push({
        host: row.zone.hosts[row.zone.active],
        hosts: row.zone.hosts,
        active: row.zone.active,
        ci,
        ri,
        rect: { x, y, w: cw, h: rh },
      });
      if (ri < nrow - 1) {
        dividers.push({ kind: "row", ci, ri, rect: { x, y: y + rh, w: cw, h: gut } });
      }
      y += rh + gut;
    });
    if (ci < ncol - 1) {
      dividers.push({ kind: "col", ci, ri: 0, rect: { x: x + cw, y: 0, w: gut, h: H } });
    }
    x += cw + gut;
  });
  return { placements, dividers };
}
