import { describe, it, expect } from "vitest";
// Import the coverage source files as raw text (Vite's ?raw, typed by
// vite/client). This keeps the purity scan dependency-free — no node:fs, no
// @types/node — and works identically under Vitest and the Vite build.
import gridSrc from "./grid.ts?raw";
import demandSrc from "./demand.ts?raw";
import dynamicDemandSrc from "./dynamic-demand.ts?raw";
import fieldSrc from "./field.ts?raw";
import scoreSrc from "./score.ts?raw";

/**
 * Purity guard for the M2a coverage module group (AGENTS.md §5 / the sim/render
 * contract): src/sim is PURE TypeScript — no three.js, no DOM, no wall-clock
 * time source, no pseudo-random generator. This scans the coverage source files
 * (not the tests) and asserts none of those forbidden dependencies appear. A
 * failure here means a non-deterministic / render-coupled import crept in.
 */

const SOURCES: Array<[string, string]> = [
  ["grid.ts", gridSrc],
  ["demand.ts", demandSrc],
  ["dynamic-demand.ts", dynamicDemandSrc],
  ["field.ts", fieldSrc],
  ["score.ts", scoreSrc],
];

describe("coverage modules are pure (no three / DOM / wall-clock / RNG)", () => {
  for (const [name, src] of SOURCES) {
    it(`${name} imports no forbidden dependency`, () => {
      // No three.js import.
      expect(src).not.toMatch(/from\s+["']three["']/);
      expect(src).not.toMatch(/require\(\s*["']three["']\s*\)/);
      // No DOM (document/window) usage.
      expect(src).not.toMatch(/\bdocument\./);
      expect(src).not.toMatch(/\bwindow\./);
      // No wall-clock time source.
      expect(src).not.toMatch(/\bDate\.now\b/);
      expect(src).not.toMatch(/\bperformance\.now\b/);
      expect(src).not.toMatch(/new\s+Date\b/);
      // No pseudo-random generator (deterministic constants only).
      expect(src).not.toMatch(/\bMath\.random\b/);
    });
  }
});
