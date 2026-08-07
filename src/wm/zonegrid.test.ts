/**
 * FL-15c — zonegrid split-floor pins (the px floor under the weight clamps).
 */

import { describe, it, expect } from "vitest";
import { type ZoneGrid, setColumnSplit, computeLayout } from "./zonegrid";

// ── FL-15c — the px floor under the weight clamps ────────────────────────────────
describe("FL-15c — the 48px zone-edge floor under the 12/88% clamp", () => {
  // minimal 2-col grid helper
  const twoCol = (): ZoneGrid => ({
    columns: [
      { weight: 1, rows: [{ weight: 1, zone: { hosts: ["a"], active: 0 } }] },
      { weight: 1, rows: [{ weight: 1, zone: { hosts: ["b"], active: 0 } }] },
    ],
  });
  it("a tiny pane can't starve a zone below MIN_ZONE_EDGE_PX", () => {
    // span 100 px: the 12% clamp would give 12 px — the px floor insists on 48.
    const g = setColumnSplit(twoCol(), 0, 0.12, 100);
    const layout = computeLayout(g, 104, 100, 4);
    expect(layout.placements[0].rect.w).toBeGreaterThanOrEqual(47); // ~48 (gutter excluded)
  });
  it("no spanPx ⇒ legacy behaviour (12/88) exactly", () => {
    const g = setColumnSplit(twoCol(), 0, 0.01);
    const layout = computeLayout(g, 1004, 100, 4);
    expect(layout.placements[0].rect.w).toBeCloseTo(1000 * 0.12, 6);
  });
  it("the always-tiled invariant holds at the floor (placements tile the span)", () => {
    const g = setColumnSplit(twoCol(), 0, 0.04, 400);
    const layout = computeLayout(g, 404, 200, 4);
    const wSum = layout.placements.reduce((s, p) => s + p.rect.w, 0);
    expect(wSum + 4).toBeCloseTo(404, 6); // every pixel accounted for (one gutter)
  });
});
