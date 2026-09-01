/**
 * THE RUN REPORT (SD-55 / AE-09).
 *
 * Renders one bundle into something readable without the code: what the policy did, what the
 * deterministic metrics say, what it said about it afterwards, and the standing caveats — which are
 * printed on EVERY report, because a number lifted out of this file without them is a claim the
 * harness cannot support (docs/agent-eval.md §1, §11).
 */

import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { wilson } from "./metrics.mjs";

const b = (v) => (v === null || v === undefined ? "—" : v === true ? "YES" : v === false ? "no" : String(v));
const pct = (v) => (v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`);
const mmss = (s) =>
  s === null || s === undefined ? "—" : `${String(Math.floor(s / 60)).padStart(2, "0")}:${String(Math.round(s % 60)).padStart(2, "0")}`;

/** A pinned baseline run's metrics, or null when that floor/ceiling has not been measured yet. */
function loadBaseline(baselineDir, label) {
  const f = baselineDir ? join(baselineDir, `${label}.json`) : null;
  if (!f || !existsSync(f)) return null;
  try {
    return JSON.parse(readFileSync(f, "utf8"));
  } catch {
    return null;
  }
}

export function writeReport({ outDir, cfg, runJson, metrics, timeline, debrief, baselineDir = null }) {
  const random = loadBaseline(baselineDir, "random");
  const scripted = loadBaseline(baselineDir, "scripted");
  const m = metrics;
  const lines = [];
  const p = (s = "") => lines.push(s);

  p(`# AGENT-EVAL RUN — ${cfg.persona} · run ${cfg.runIndex} · build ${runJson.key.build_hash}`);
  p();
  p(`**${runJson.termination.reason.toUpperCase()}**${runJson.termination.gate ? ` — ${runJson.termination.gate}` : ""} · ` +
    `${runJson.spend.turns} turns · mission ${mmss(runJson.clock.sim_seconds_elapsed)} · ` +
    `$${runJson.spend.usd.toFixed(3)} · ${Math.round(runJson.spend.wall_ms / 1000)}s wall · clock ${runJson.clock.mode}`);
  p();
  p(`Policy: \`${runJson.key.model_id}\` · prompt \`${runJson.key.prompt_version}\` · ` +
    `withheld: ${(runJson.key.persona === "novice-floor" ? "TRACE, PARSE" : "nothing")}`);
  p();

  if (runJson.termination.reason === "reboot") {
    p(`> **THIS RUN IS UNSCORABLE.** ${runJson.termination.gate}. The metrics below describe two`);
    p(`> different worlds spliced together; read the trail, not the table.`);
    p();
  }
  p(`## What the action log says (deterministic — no judge)`);
  p();
  p(`| metric | value | random floor | scripted ceiling | human |`);
  p(`|---|---|---|---|---|`);
  // Every row carries its floor and ceiling: an agent number between them is readable, and one
  // without them is not (docs/agent-eval.md §5). "not measured" is printed, never guessed.
  const cell = (base, get) => {
    if (!base) return "not pinned for this build";
    try {
      const v = get(base.metrics);
      return v === null || v === undefined ? "—" : b(v);
    } catch {
      return "—";
    }
  };
  const row = (name, val, get = null) =>
    p(`| ${name} | ${val} | ${get ? cell(random, get) : "n/a"} | ${get ? cell(scripted, get) : "n/a"} | not measured |`);
  row("M1 committed actions in act 1", b(m.m1_committed_actions_act1), (x) => x.m1_committed_actions_act1);
  row("M2 decision surfaces touched", `${m.m2_decision_surfaces.count}/${m.m2_decision_surfaces.of} — ${m.m2_decision_surfaces.touched.join(", ") || "none"}`, (x) => `${x.m2_decision_surfaces.count}/${x.m2_decision_surfaces.of}`);
  row("M3 fork taken", `consolidate ${b(m.m3_strategy_fork.consolidate)} · split ${b(m.m3_strategy_fork.split)} (${m.m3_strategy_fork.launches} launches)`, (x) => `${x.m3_strategy_fork.launches} launches`);
  row("M4 no instruction strings on screen", b(m.m4_instruction_string_absent), (x) => x.m4_instruction_string_absent);
  row("M5 own-success strain answered", b(m.m5_responded_to_own_success_strain), (x) => x.m5_responded_to_own_success_strain);
  row("M6 no softlock, no errors", b(m.m6_completed_without_softlock), (x) => x.m6_completed_without_softlock);
  row("M7 novice floor reached", b(m.m7_novice_floor_reachable), (x) => x.m7_novice_floor_reachable);
  row("M8 invalid-action rate", pct(m.m8_invalid_action_rate), (x) => pct(x.m8_invalid_action_rate));
  row("M8b no-op action rate", pct(m.m8b_no_op_action_rate), (x) => pct(x.m8b_no_op_action_rate));
  row("M9 time to first served", m.m9_time_to_first_served_s === null ? "never served" : `${mmss(m.m9_time_to_first_served_s)} (turn ${b(m.m9b_turns_to_first_served)})`, (x) => (x.m9_time_to_first_served_s === null ? "never" : mmss(x.m9_time_to_first_served_s)));
  row("M10 hand-aimed before commit", b(m.m10_hand_aimed_before_commit), (x) => x.m10_hand_aimed_before_commit);
  row("M11 acts reached", b(m.m11_acts_reached), (x) => x.m11_acts_reached);
  row("M12 economy", `final €${b(m.m12_economy.final_eur)} · min €${b(m.m12_economy.min_eur)} · breach ${b(Math.round(m.m12_economy.breach_seconds_total))}s`, (x) => `€${b(x.m12_economy.final_eur)}`);
  row("M13 page/console errors", b(m.m13_errors), (x) => x.m13_errors);
  p();
  p(`Harness quality (NOT a reading of the build): protocol shape rejects ${m.m8c_protocol_noise.shape_rejects}, ` +
    `lenient repairs ${m.m8c_protocol_noise.shape_repairs}, ${pct(m.m8c_protocol_noise.rate)} of turns. ` +
    `Turns lost to the harness's own JSON dialect are counted here and kept out of M8.`);
  p();
  if (m.m4_leaks.length > 0) {
    p(`### LAW 2 leaks caught at runtime`);
    p();
    for (const l of m.m4_leaks.slice(0, 12)) p(`- turn ${l.turn} · **${l.panel}** · \`${l.pattern}\` near "${l.near}"`);
    p();
  }

  p(`## The trail — what it read, what it wanted, what it did`);
  p();
  for (const t of timeline) {
    const act = t.action ? `\`${t.action.do}${t.action.target ? ` ${t.action.target}` : ""}${t.action.param ? ` ${t.action.param}=${t.action.value}` : ""}${t.action.simMinutes ? ` ${t.action.simMinutes}min` : ""}\`` : "_(invalid — no action taken)_";
    const flags = [t.invalid ? "INVALID" : null, t.noop ? "NO-OP" : null].filter(Boolean).join(" ");
    p(`**${t.turn}** · ${mmss(t.missionElapsedS)} · act ${b(t.cursor)} · €${b(t.balance)} → ${act} ${flags}`);
    if (t.read) p(`  - read: ${t.read}`);
    if (t.goal) p(`  - goal: ${t.goal}`);
  }
  p();

  if (Object.keys(debrief ?? {}).length > 0) {
    p(`## The debrief (verbatim · behaviour plus four open questions, no scales)`);
    p();
    for (const [k, v] of Object.entries(debrief)) {
      p(`**${k.replace(/_/g, " ")}**`);
      p();
      p(`> ${String(v).replace(/\n/g, "\n> ")}`);
      p();
    }
    p(`_The replay answer is an exploratory signal only. The GDD §9 replay bit is measured on cold_`);
    p(`_human testers and is the user's to run; an LLM's stated preference is not that measurement._`);
    p();
  }

  p(`## Caveats — these travel with every number above`);
  p();
  p(`- **PDQ artifact.** The clock was paused while the policy thought, so real-time pressure is`);
  p(`  absent by construction: nothing could fail *while* it decided, and tempo was a free choice.`);
  p(`  LCRT (injecting the measured latency back into sim-time) is the fix, and is not built yet.`);
  p(`- **One run says almost nothing.** Rates from a five-seed battery carry Wilson intervals — at`);
  p(`  5/5 the lower bound is ${wilson(5, 5).lo.toFixed(2)}. A single run supports existence claims`);
  p(`  ("this build did X") and regression claims. It cannot rank builds, and cannot say a build passes.`);
  p(`- **This is not evidence about fun, pacing, or comprehension.** An agent has perfect text`);
  p(`  comprehension, no visual attention and infinite patience. Countable behaviour here is`);
  p(`  trustworthy; every legibility reading is a lead for human playtesting.`);
  p(`- **Text channel only.** The policy never saw the orrery; it read the numbers the panels print.`);
  p(`  A geometry defect that is only visible on the globe cannot be caught by this run.`);
  p(`- **The policy is not a novice about physics.** It knows GEO is ~35,786 km before it opens the`);
  p(`  pad. A cold human tester does not. So a fast time-to-first-served here is partly domain`);
  p(`  knowledge the target player lacks — read it as an upper bound on discoverability, never as one.`);
  p(`- **The Goodhart clause.** Nothing here justifies tuning the game so the agent does better.`);
  p();

  writeFileSync(join(outDir, "report.md"), `${lines.join("\n")}\n`);
  return join(outDir, "report.md");
}
