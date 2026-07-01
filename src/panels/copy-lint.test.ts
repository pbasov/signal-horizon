// @ts-nocheck — node imports are fine under vitest; the browser tsconfig has no node types.
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

/**
 * R1 (SD-45) — LAW 2 enforced: GOALS, NEVER INSTRUCTIONS. Player-facing copy (copy.ts,
 * plus the mission panels' literals) must never name a control ("press L", "click
 * ACCEPT", "hit the X button", "on CONNECTIVITY (2)"). The build fails if it does —
 * the tutorial-on-rails anti-pattern (decisions.md SD-45) cannot silently return.
 */

const here = dirname(fileURLToPath(import.meta.url));

const BANNED: { name: string; re: RegExp }[] = [
  { name: "press <KEY>", re: /\bpress\s+(the\s+)?[A-Z0-9[\]]/ },
  { name: "click <CONTROL>", re: /\bclick\s+(the\s+)?[A-Z]/ },
  { name: "hit <CONTROL>", re: /\bhit\s+(the\s+)?[A-Z]/ },
  { name: "key <K> reference", re: /\(key\s+[A-Z0-9]\)/i },
  { name: "desktop-number instruction", re: /\bon\s+[A-Z]{3,}\s*\(\d\)/ },
  { name: "the X button", re: /\b[A-Z]{2,}\s+button\b/ },
];

const FILES = ["copy.ts", "mission-top.ts", "ledger-fleet.ts"];

describe("R1 — copy lint: goals, never instructions", () => {
  for (const f of FILES) {
    it(`${f} contains no imperative control references`, () => {
      const src = readFileSync(join(here, f), "utf8");
      // Strip comments — the law governs what the PLAYER sees, not code docs.
      const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      for (const b of BANNED) {
        const m = noComments.match(b.re);
        expect(m === null ? "" : `${f}: banned pattern "${b.name}" near "${m![0]}"`).toBe("");
      }
    });
  }
});
