import { describe, it, expect } from "vitest";
// Raw-text import (Vite ?raw) keeps the purity scan dependency-free.
import datacenterSrc from "./datacenter.ts?raw";
import dcRosterSrc from "./dc-roster.ts?raw";
import dcSitesSrc from "./dc-sites.ts?raw";

/**
 * Purity guard for the M3a datacenter module group (AGENTS.md §5 / the sim/render
 * contract): src/sim is PURE TypeScript — no three.js, no DOM, no wall-clock time
 * source, and any randomness ONLY via the seeded splitmix64 SimRng, never the unseeded
 * JS Math.random. The DC power/thermal/compute model + the force-multiplier are pure
 * functions of (placement, ephemeris geometry); this scans the sources (not the tests).
 */

const SOURCES: Array<[string, string]> = [
  ["datacenter.ts", datacenterSrc],
  ["dc-roster.ts", dcRosterSrc],
  ["dc-sites.ts", dcSitesSrc],
];

describe("m3 datacenter modules are pure (no three / DOM / wall-clock / unseeded RNG)", () => {
  for (const [name, src] of SOURCES) {
    it(`${name} imports no forbidden dependency`, () => {
      expect(src).not.toMatch(/from\s+["']three["']/);
      expect(src).not.toMatch(/require\(\s*["']three["']\s*\)/);
      expect(src).not.toMatch(/\bdocument\./);
      expect(src).not.toMatch(/\bwindow\./);
      expect(src).not.toMatch(/\bDate\.now\b/);
      expect(src).not.toMatch(/\bperformance\.now\b/);
      expect(src).not.toMatch(/new\s+Date\b/);
      expect(src).not.toMatch(/\bMath\.random\b/);
    });
  }
});
