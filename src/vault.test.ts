/**
 * X-04b — WHICH SAVE DOES A REFRESH COME BACK TO?
 *
 * The vault holds several slots (the quick save the player made by hand, the autosave the
 * frame loop and the page-exit hook write). A cold boot resumes exactly ONE of them, and it
 * had better be the newest — resuming a stale slot would read to the player as work lost,
 * which is the whole bug this ticket exists to kill.
 *
 * The ordering is a pure function over the slot listing, tested here without a browser
 * (`vaultContents` itself needs localStorage; the CHOICE does not).
 */

import { describe, it, expect } from "vitest";
import { compareRecency, pickResumeSlot, type VaultEntry } from "./vault";

/** A slot headline; only the fields the ordering reads have to be meaningful. */
function entry(slot: VaultEntry["slot"], savedAtMs: number, tSim = 0): VaultEntry {
  return { slot, savedAtMs, tSim, act: 0, balanceEur: 0 };
}

describe("X-04b — pickResumeSlot", () => {
  it("an empty vault resumes NOTHING (a cold boot, not a crash)", () => {
    expect(pickResumeSlot([])).toBeNull();
  });

  it("resumes the single slot when only one holds a save", () => {
    expect(pickResumeSlot([entry("autosave", 1000)])).toBe("autosave");
  });

  it("resumes the NEWEST slot regardless of the order it was listed in", () => {
    // The player quick-saved, then played on and the autosave overtook it: resume the autosave.
    expect(pickResumeSlot([entry("quick", 1000), entry("autosave", 2000)])).toBe("autosave");
    // ...and the other way round: a quick save made after the last autosave wins.
    expect(pickResumeSlot([entry("autosave", 1000), entry("quick", 2000)])).toBe("quick");
    // Listing order must not decide it.
    expect(pickResumeSlot([entry("b", 5), entry("quick", 9), entry("a", 7)])).toBe("quick");
  });

  it("breaks a same-millisecond tie on the FURTHER-ALONG run, then deterministically", () => {
    // The page-exit hook and a quick save can land in the same millisecond. Prefer the run
    // that had covered more sim-time; never leave the choice to iteration luck.
    expect(pickResumeSlot([entry("quick", 500, 10), entry("autosave", 500, 900)])).toBe("autosave");
    // A total tie still has to be STABLE — the same vault must resume the same slot every boot.
    const tied = [entry("autosave", 500, 10), entry("quick", 500, 10)];
    expect(pickResumeSlot(tied)).toBe(pickResumeSlot([...tied].reverse()));
  });

  it("pickResumeSlot does not disturb the caller's array", () => {
    const listing = [entry("b", 1), entry("quick", 9)];
    pickResumeSlot(listing);
    expect(listing.map((e) => e.slot)).toEqual(["b", "quick"]);
  });

  it("compareRecency sorts NEWEST FIRST (the load board's order)", () => {
    const sorted = [entry("a", 100), entry("quick", 300), entry("autosave", 200)].sort(compareRecency);
    expect(sorted.map((e) => e.slot)).toEqual(["quick", "autosave", "a"]);
  });
});
