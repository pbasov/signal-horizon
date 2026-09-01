/**
 * SOLO — the pad's "take the whole right side" derivation (zonegrid.soloInColumn).
 *
 * The behaviour that matters: the soloed panel owns its column's full height, its column
 * keeps its width (the globe beside it does NOT move), the OTHER columns are untouched, and
 * because the op derives from an unmutated grid the restore is exact — including row weights
 * the player dragged before opening the pad.
 */
import { describe, it, expect } from "vitest";
import { buildGrid, NET_PRESET_SPECS } from "./presets";
import { soloInColumn, computeLayout, setRowSplit, validate, cloneGrid } from "./zonegrid";

const MISSION = NET_PRESET_SPECS.find((p) => p.name === "MISSION")!;

describe("soloInColumn — the open pad takes its whole column", () => {
  it("gives the soloed host the full column height, and hides its column-mates", () => {
    const g = buildGrid(MISSION);
    const solo = soloInColumn(g, "mission-top");
    const W = 1600;
    const H = 900;
    const before = computeLayout(g, W, H, 4);
    const after = computeLayout(solo, W, H, 4);

    const padBefore = before.placements.find((p) => p.host === "mission-top")!;
    const padAfter = after.placements.find((p) => p.host === "mission-top")!;
    // Same column, same width, same left edge — the globe beside it does not move.
    expect(padAfter.rect.x).toBeCloseTo(padBefore.rect.x, 6);
    expect(padAfter.rect.w).toBeCloseTo(padBefore.rect.w, 6);
    // ...but the whole height, which is the point (no more scrolling past INCLINATION).
    expect(padAfter.rect.y).toBe(0);
    expect(padAfter.rect.h).toBe(H);
    expect(padAfter.rect.h).toBeGreaterThan(padBefore.rect.h * 1.5);
    // The column-mate is off the wall while the pad is open.
    expect(after.placements.map((p) => p.host)).not.toContain("ledger-fleet");
    // The other column is untouched — the globe + the wire keep their exact boxes.
    for (const host of ["orrery", "system-log"]) {
      const b = before.placements.find((p) => p.host === host)!;
      const a = after.placements.find((p) => p.host === host)!;
      expect(a.rect).toEqual(b.rect);
    }
  });

  it("never mutates the source grid, so closing the pad restores dragged row weights exactly", () => {
    // The player drags the MISSION/LEDGER split before opening the pad.
    const dragged = setRowSplit(buildGrid(MISSION), 1, 0, 0.75);
    const snapshot = JSON.stringify(dragged);
    const solo = soloInColumn(dragged, "mission-top");
    expect(JSON.stringify(dragged)).toBe(snapshot); // pure derivation, no in-place mutation
    expect(solo).not.toBe(dragged);
    // Closing the pad = simply stopping the derivation; the drag survives.
    const restored = computeLayout(dragged, 1600, 900, 4);
    const pad = restored.placements.find((p) => p.host === "mission-top")!;
    const ledger = restored.placements.find((p) => p.host === "ledger-fleet")!;
    expect(pad.rect.h / (pad.rect.h + ledger.rect.h)).toBeCloseTo(0.75, 2);
  });

  it("keeps the DD-10 invariant (the derived wall is still a legal always-tiled grid)", () => {
    expect(validate(soloInColumn(buildGrid(MISSION), "mission-top"))).toBe(true);
    expect(validate(soloInColumn(buildGrid(MISSION), "orrery"))).toBe(true);
  });

  it("is a no-op for a host that isn't on this desktop, or that already owns its column", () => {
    const review = buildGrid(NET_PRESET_SPECS.find((p) => p.name === "REVIEW")!);
    // The pad isn't mounted on REVIEW: the solo is remembered but changes nothing.
    expect(soloInColumn(review, "mission-top")).toBe(review);
    // THE PARSE is already alone in its column — identity, no needless clone.
    expect(soloInColumn(review, "parse")).toBe(review);
  });

  it("solos whichever column the host is in, leaving column WIDTHS alone", () => {
    const g = buildGrid(MISSION);
    const solo = soloInColumn(g, "orrery");
    const after = computeLayout(solo, 1600, 900, 4);
    expect(after.placements.map((p) => p.host)).toEqual(["orrery", "mission-top", "ledger-fleet"]);
    expect(after.placements[0].rect.h).toBe(900);
    // The right column still splits into two rows.
    expect(after.placements[1].rect.h + after.placements[2].rect.h).toBeCloseTo(900 - 4, 6);
    // Column weights untouched.
    expect(solo.columns.map((c) => c.weight)).toEqual(cloneGrid(g).columns.map((c) => c.weight));
  });
});
