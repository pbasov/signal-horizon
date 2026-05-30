import { describe, it, expect } from "vitest";
// Raw-text import (Vite ?raw) keeps the purity scan dependency-free.
import rosterSrc from "./roster.ts?raw";
import orbitSrc from "./orbit.ts?raw";
import launchSrc from "./launch.ts?raw";
import sessionSrc from "./session.ts?raw";
import sitesSrc from "./sites.ts?raw";
import applySrc from "./apply-build-action.ts?raw";

/**
 * Purity guard for the M2c build-loop module group (AGENTS.md §5 / the sim/render
 * contract): src/sim is PURE TypeScript — no three.js, no DOM, no wall-clock time
 * source, and any randomness ONLY via the seeded splitmix64 SimRng, never the
 * unseeded JS Math.random. This scans the M2 sources (not the tests) and asserts
 * none of those forbidden dependencies appear.
 */

const SOURCES: Array<[string, string]> = [
  ["roster.ts", rosterSrc],
  ["orbit.ts", orbitSrc],
  ["launch.ts", launchSrc],
  ["session.ts", sessionSrc],
  ["sites.ts", sitesSrc],
  ["apply-build-action.ts", applySrc],
];

describe("m2 build modules are pure (no three / DOM / wall-clock / unseeded RNG)", () => {
  for (const [name, src] of SOURCES) {
    it(`${name} imports no forbidden dependency`, () => {
      expect(src).not.toMatch(/from\s+["']three["']/);
      expect(src).not.toMatch(/require\(\s*["']three["']\s*\)/);
      expect(src).not.toMatch(/\bdocument\./);
      expect(src).not.toMatch(/\bwindow\./);
      expect(src).not.toMatch(/\bDate\.now\b/);
      expect(src).not.toMatch(/\bperformance\.now\b/);
      expect(src).not.toMatch(/new\s+Date\b/);
      // The seeded SimRng is allowed; the unseeded JS random is NOT.
      expect(src).not.toMatch(/\bMath\.random\b/);
    });
  }
});
