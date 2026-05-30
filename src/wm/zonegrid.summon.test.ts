import { describe, it, expect } from "vitest";
import { type ZoneGrid, summonInto, validate, allHosts } from "./zonegrid";

/** A two-column grid: [orrery | finance / contracts] — the PLAY-shaped layout. */
function playGrid(): ZoneGrid {
  return {
    columns: [
      { weight: 0.6, rows: [{ weight: 1, zone: { hosts: ["orrery"], active: 0 } }] },
      {
        weight: 0.4,
        rows: [
          { weight: 1, zone: { hosts: ["finance"], active: 0 } },
          { weight: 1, zone: { hosts: ["contracts"], active: 0 } },
        ],
      },
    ],
  };
}

/** The active host shown in each zone, flattened — what the user sees on screen. */
function visible(g: ZoneGrid): string[] {
  const out: string[] = [];
  for (const c of g.columns) for (const r of c.rows) out.push(r.zone.hosts[r.zone.active]);
  return out;
}

describe("summonInto — the window-rail panel→tile assignment (DD-10)", () => {
  it("swaps the panel shown in the target tile for the summoned one (no teardown)", () => {
    const g = playGrid();
    // Summon SYSTEM.LOG into the FINANCE tile.
    const ng = summonInto(g, "finance", "system-log");
    expect(ng).not.toBeNull();
    // The finance tile now shows system-log; finance left the grid; contracts/orrery untouched.
    expect(visible(ng!)).toEqual(["orrery", "system-log", "contracts"]);
    // The grid shape is unchanged (still 2 cols, 1+2 rows) — a panel swap, not a relayout.
    expect(ng!.columns.map((c) => c.rows.length)).toEqual([1, 2]);
  });

  it("preserves the always-tiled invariant (every zone keeps exactly one host)", () => {
    const ng = summonInto(playGrid(), "orrery", "telemetry");
    expect(validate(ng!)).toBe(true);
    // No empty void: the host count equals the zone count.
    expect(allHosts(ng!)).toHaveLength(3);
  });

  it("refuses to summon a panel that is ALREADY visible (no duplication) → null", () => {
    // contracts is already on screen; summoning it returns null so the caller just
    // focuses the existing tile instead of duplicating the panel.
    expect(summonInto(playGrid(), "finance", "contracts")).toBeNull();
  });

  it("returns null on a self-summon and on an unknown target tile", () => {
    expect(summonInto(playGrid(), "finance", "finance")).toBeNull();
    expect(summonInto(playGrid(), "no-such-tile", "telemetry")).toBeNull();
  });

  it("does not mutate the input grid (Clone-Mutate-Validate)", () => {
    const g = playGrid();
    const before = visible(g);
    summonInto(g, "finance", "parse");
    expect(visible(g)).toEqual(before);
  });
});
