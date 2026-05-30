import { describe, it, expect } from "vitest";
// Raw-text import (Vite ?raw) keeps the purity scan dependency-free.
import worldSrc from "./world.ts?raw";
import frameSrc from "./frame.ts?raw";
import satSrc from "./sat.ts?raw";
import endpointSrc from "./endpoint.ts?raw";
import linkBudgetSrc from "./link-budget.ts?raw";
import routerSrc from "./router.ts?raw";
import availabilitySrc from "./availability.ts?raw";
import phasingSrc from "./phasing.ts?raw";
import contractSrc from "./contract.ts?raw";
import sessionSrc from "./session.ts?raw";
import applyActionSrc from "./apply-action.ts?raw";
import scenarioSrc from "./scenario.ts?raw";

/**
 * Purity guard for the net/ sim module group (design §4 / the sim/render contract):
 * src/sim is PURE TypeScript — no three.js, no DOM, no wall-clock time source, and any
 * randomness ONLY via the seeded splitmix64 SimRng, never the unseeded JS Math.random.
 * This scans the net/ sources (not the tests) and asserts none of those forbidden
 * dependencies appear. Modeled on m2/purity.test.ts. Later increments append their new
 * sources (contract.ts, session.ts, scenario.ts, …) to SOURCES.
 */

const SOURCES: Array<[string, string]> = [
  ["world.ts", worldSrc],
  ["frame.ts", frameSrc],
  ["sat.ts", satSrc],
  ["endpoint.ts", endpointSrc],
  ["link-budget.ts", linkBudgetSrc],
  ["router.ts", routerSrc],
  ["availability.ts", availabilitySrc],
  ["phasing.ts", phasingSrc],
  ["contract.ts", contractSrc],
  ["session.ts", sessionSrc],
  ["apply-action.ts", applyActionSrc],
  ["scenario.ts", scenarioSrc],
];

describe("net modules are pure (no three / DOM / wall-clock / unseeded RNG)", () => {
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
