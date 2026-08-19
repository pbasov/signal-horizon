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

const FILES = [
  // FL-02: the lint covers EVERY panel that can render player-facing copy — the retired
  // SD-44 panels included (they still mount in ?mode=cache). Add new panels HERE.
  "copy.ts",
  "mission-top.ts",
  "trace.ts",
  "trace-derive.ts",
  "ledger-fleet.ts",
  "howto.ts",
  "onboarding.ts",
  "status-board.ts",
  "coverage-roster.ts",
  "link-load.ts",
  "net-planner.ts",
  "contracts.ts",
  "finance.ts",
  "fleet.ts",
  "log.ts",
  "log-format.ts",
  "parse.ts",
  "status.ts",
  "telemetry.ts",
];

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

/** Sim files whose strings can reach the player (the scenario's fallback SHORTFALL
 * messages render on the MISSION book face). The copy law applies there too — and they must
 * never leak internal API names (\bnet_*  means the sim's wire format is talking to the player). */
const SIM_FILES = [
  "../sim/net/scenario.ts",
  // SD-53: trace.ts's shortfall messages ARE player copy — main.ts drains them into SYSTEM.LOG
  // today and the ROUTING SCREEN renders their fix clauses. They were outside the law until now;
  // the "set prefer-bw on X" tail (a solver parameter, named at the player) is what found the gap.
  "../sim/net/trace.ts",
];
const SIM_BANNED: { name: string; re: RegExp }[] = [
  ...BANNED,
  { name: "internal API name in player-facing copy", re: /`[^`]*\bnet_[a-z]/ },
];

for (const f of SIM_FILES) {
  it(`${f} shortfall copy stays lawful (no instructions / no API names)`, () => {
    const src = readFileSync(join(here, f), "utf8");
    const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
    for (const b of SIM_BANNED) {
      const m = noComments.match(b.re);
      expect(m === null ? "" : `${f}: banned pattern \"${b.name}\" near \"${m![0].slice(0, 60)}\"`).toBe("");
    }
  });
}

// ── FL-02 — the TOKENS-ONLY chrome law (GDD §8 / DD-1): panels never hardcode a hex
// colour; tone lives in style.css custom properties (--cyan, --amber, …). The allowlist
// below is the day-one baseline of pre-existing violations — FL-15a shrinks it to EMPTY;
// any NEW hardcoded hex fails the build. ──
const HEX_RE = /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b/g;
/** file → exact hex literals grandfathered in (FL-15a must empty this, never grow it). */
const HEX_ALLOWLIST: Record<string, string[]> = {};

describe("FL-02 — chrome colour lint: panels use tokens, never hardcoded hex", () => {
  for (const f of FILES) {
    it(`${f} introduces no new hardcoded hex colours`, () => {
      const src = readFileSync(join(here, f), "utf8");
      const noComments = src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/[^\n]*/g, "");
      const found = (noComments.match(HEX_RE) ?? []).map((h) => h.toLowerCase());
      const allowed = new Set(HEX_ALLOWLIST[f] ?? []);
      const novel = found.filter((h) => !allowed.has(h.toLowerCase()));
      expect(novel.length === 0 ? "" : `${f}: new hardcoded hex ${novel.join(", ")} — use a --* token`).toBe("");
      // The allowlist may only SHRINK: entries that are gone from the file fail too.
      const stale = [...allowed].filter((h) => !found.includes(h) && !found.includes(h.toLowerCase()));
      expect(stale.length === 0 ? "" : `${f}: allowlist entries no longer present — remove them: ${stale.join(", ")}`).toBe("");
    });
  }
});
