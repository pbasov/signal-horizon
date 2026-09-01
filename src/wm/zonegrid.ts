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

/**
 * SUMMON — assign `host` into the zone that currently shows `targetHost`, replacing
 * the active host shown there. The window-summon rail's core op (DD-10 §1): it does
 * NOT add a zone or tear the grid down — it swaps the PANEL shown in one tile for
 * another, so the always-tiled invariant holds (the zone keeps exactly one active
 * host). The displaced host leaves the grid (its view is hidden, re-summonable).
 *
 * If `host` is ALREADY active somewhere in the grid this is a no-op (return null) —
 * the caller treats that as "just focus the existing tile" so a panel is never
 * duplicated. If `host` is active in some OTHER zone but we still want it here, the
 * caller should not reach this path (a visible panel is focused, not re-summoned).
 * Returns null on an unknown target, a self-summon, or an invariant failure.
 */
export function summonInto(g: ZoneGrid, targetHost: string, host: string): ZoneGrid | null {
  if (targetHost === host) return null;
  // A host already active in the grid is summon-by-focus, not a re-assign: bail so the
  // caller focuses the existing tile instead of duplicating the panel.
  if (findActiveZone(g, host)) return null;
  const ng = cloneGrid(g);
  const target = findActiveZone(ng, targetHost);
  if (!target) return null;
  target.hosts[target.active] = host;
  return validate(ng) ? ng : null;
}

/** The minimum zone edge (px) a gutter split may approach — a tile never collapses past
 * readability (the 12% weight clamp can starve a tile on small panes). */
export const MIN_ZONE_EDGE_PX = 48;

/** Repartition two adjacent columns by setting the left column's share to `frac`. */
export function setColumnSplit(g: ZoneGrid, leftIndex: number, frac: number, spanPx?: number): ZoneGrid {
  const ng = cloneGrid(g);
  const c0 = ng.columns[leftIndex];
  const c1 = ng.columns[leftIndex + 1];
  if (!c0 || !c1) return ng;
  const total = c0.weight + c1.weight;
  const f = clampSplit(frac, spanPx);
  c0.weight = total * f;
  c1.weight = total * (1 - f);
  return ng;
}

/** Repartition two adjacent rows within a column by setting the top row's share to `frac`. */
export function setRowSplit(g: ZoneGrid, ci: number, topIndex: number, frac: number, spanPx?: number): ZoneGrid {
  const ng = cloneGrid(g);
  const col = ng.columns[ci];
  if (!col) return ng;
  const r0 = col.rows[topIndex];
  const r1 = col.rows[topIndex + 1];
  if (!r0 || !r1) return ng;
  const total = r0.weight + r1.weight;
  const f = clampSplit(frac, spanPx);
  r0.weight = total * f;
  r1.weight = total * (1 - f);
  return ng;
}

/** The split clamp: the 12–88% weight band, PLUS the px floor when the caller knows the
 * pixel span (both sides ≥ MIN_ZONE_EDGE_PX when there is room). */
function clampSplit(frac: number, spanPx?: number): number {
  let lo = 0.12;
  let hi = 0.88;
  if (spanPx !== undefined && spanPx > 2 * MIN_ZONE_EDGE_PX) {
    const edge = MIN_ZONE_EDGE_PX / spanPx;
    lo = Math.max(lo, edge);
    hi = Math.min(hi, 1 - edge);
  }
  return Math.max(lo, Math.min(hi, frac));
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

/**
 * SOLO — derive a DISPLAY grid in which `host` owns its whole column (full height),
 * the column's other zones stepping aside. The pad ask (2026-09-01): "when using pad it
 * should take the whole right side of the interface, not just top right, so user doesn't
 * have to scroll" — a tall instrument needs the column, not a third of it.
 *
 * This is a pure DERIVATION, never a mutation of the player's grid: the caller keeps the
 * real grid and re-derives per layout, so closing the pad restores the exact row weights
 * the player dragged — no save/restore bookkeeping, nothing to get out of sync. Columns
 * (and therefore column dividers) are untouched, so every gesture index still maps.
 *
 * Returns the grid UNCHANGED when `host` is not an active host in it (e.g. the pad's panel
 * isn't mounted on this desktop) or when the result would fail the invariant.
 */
export function soloInColumn(g: ZoneGrid, host: string): ZoneGrid {
  const ci = g.columns.findIndex((c) => c.rows.some((r) => r.zone.hosts[r.zone.active] === host));
  if (ci < 0) return g;
  // Already alone in its column — nothing to derive (keeps the identity fast-path).
  if (g.columns[ci].rows.length === 1) return g;
  const ng = cloneGrid(g);
  ng.columns[ci].rows = [{ weight: 1, zone: { hosts: [host], active: 0 } }];
  return validate(ng) ? ng : g;
}
