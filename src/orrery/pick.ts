/**
 * CLICK-TO-FOCUS PICK MATH (pure, render-free) — GDD §5 direct interaction.
 *
 * The orrery draws constant-screen-size dithered billboards (bodies, placed assets,
 * datacenters). For constant-screen-size sprites, the robust pick is SCREEN-SPACE
 * NEAREST-PROJECTED-CENTRE within a pixel tolerance — not a mesh raycast (the quads
 * are camera-facing and tiny, so a ray rarely threads a 9 px disc, and depth is
 * meaningless once everything is a billboard). This module is that pure pick: project
 * is the orrery's job (it owns the camera); here we just choose the nearest candidate
 * to the cursor whose projected centre is on-screen and inside the tolerance.
 *
 * Kept PURE (no three / DOM) so it is unit-testable and the orrery stays a thin
 * painter over it. Raycast/pick is called ON CLICK ONLY (never per frame) — X-02.
 */

/** A pick candidate: an id + its projected SCREEN position (px) + whether it is in
 * front of the camera (NDC z within [-1,1]; behind-camera points are not pickable). */
export interface PickCandidate {
  id: string;
  /** Screen-space x (px from the left of the canvas). */
  sx: number;
  /** Screen-space y (px from the top of the canvas). */
  sy: number;
  /** False when the candidate is behind the camera / clipped (never pickable). */
  onScreen: boolean;
}

/**
 * The nearest candidate to the click within `tolerancePx`, or null if none qualifies.
 * Pure: a function of (candidates, click, tolerance). Off-screen candidates are
 * skipped; ties resolve to the FIRST candidate at the minimum distance (stable, so a
 * deterministic draw order gives a deterministic pick).
 */
export function pickNearest(
  candidates: readonly PickCandidate[],
  clickX: number,
  clickY: number,
  tolerancePx: number,
): string | null {
  const tol2 = tolerancePx * tolerancePx;
  let bestId: string | null = null;
  let bestD2 = Infinity;
  for (const c of candidates) {
    if (!c.onScreen) continue;
    const dx = c.sx - clickX;
    const dy = c.sy - clickY;
    const d2 = dx * dx + dy * dy;
    if (d2 > tol2) continue; // outside the pick tolerance — not a hit.
    if (d2 < bestD2) {
      // Strictly-closer wins; ties keep the FIRST (earlier in draw order) candidate.
      bestD2 = d2;
      bestId = c.id;
    }
  }
  return bestId;
}
