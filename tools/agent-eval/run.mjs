#!/usr/bin/env node
/**
 * THE AGENT-EVAL DRIVER (SD-55 / AE-06).
 *
 * Drives the real game in headless chromium with a policy that has never read the design docs, and
 * writes the artifact bundle docs/agent-eval-artifacts.md describes. The loop is PDQ — Paused During
 * Query (docs/agent-eval.md §3): pause → observe → think → act → let the world run for the dwell the
 * policy chose. Declared as an artifact, not hidden: it deletes real-time pressure from the
 * measurement, and the run key records the mode so PDQ and LCRT runs can never be pooled.
 *
 * Fast-forward is done by PLAYING at the top time scale, never by seeking. seekSim would skip
 * intermediate ticks and the recorded action log would stop being replayable, which would cost us
 * the one input the metrics trust.
 *
 * Usage:
 *   node tools/agent-eval/run.mjs [--persona=optimizer] [--turns=24] [--usd=2] [--wall=1200]
 *                                 [--policy=llm|random|scripted] [--baseline=random|scripted]
 *                                 [--model=claude-sonnet-5] [--run=1]
 *                                 [--base=http://localhost:5173] [--headful]
 */

import { chromium } from "playwright-core";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { makeCtx } from "../ctx.mjs";
import { observe, probeAll, digest, render, WITHHOLD, OBS_SCHEMA_VERSION } from "./observe.mjs";
import { makeBrain } from "./brain.mjs";
import { PROTOCOL, PROTOCOL_VERSION } from "./protocol.mjs";
import { computeMetrics } from "./metrics.mjs";
import { normalizeAction } from "./action-shape.mjs";
import { scriptedPolicy } from "./scripted-policy.mjs";
import { writeReport } from "./report.mjs";
import { startServer, portFor } from "./serve.mjs";

const HERE = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(HERE, "../..");

const arg = (name, dflt) => {
  const hit = process.argv.slice(2).find((a) => a.startsWith(`--${name}=`));
  return hit ? hit.slice(name.length + 3) : dflt;
};
const flag = (name) => process.argv.slice(2).includes(`--${name}`);

const CFG = {
  persona: arg("persona", "optimizer"),
  policy: arg("policy", "llm"),
  model: arg("model", "claude-sonnet-5"),
  maxTurns: Number(arg("turns", 24)),
  maxUsd: Number(arg("usd", 2)),
  maxWallMs: Number(arg("wall", 1200)) * 1000,
  runIndex: Number(arg("run", 1)),
  // No shared server by default. Several agents work this repo at once, each in its own worktree,
  // and a shared :5173 is a shared fate: one save, one worktree, one second harness run and every
  // client reloads. Pass --base=<url> to opt into an existing server, knowing that risk.
  base: arg("base", null),
  headless: !flag("headful"),
};

// The keys the seat may press. Not a list of what they DO — the game prints its own hints on screen.
const KEY_WHITELIST = new Set([
  " ", ",", ".", "0", "1", "2", "3", "4", "5", "l", "L", "r", "R", "c", "C", "m", "M", "u", "U",
  "v", "V", "g", "G", "[", "]", "{", "}", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "Escape", "Enter",
]);
const FF_SCALE_PRESSES = 3; // '.' three times reaches the top scale; further presses are no-ops
const FF_REAL_TIMEOUT_MS = 45000;

/**
 * The build key is a hash of the GAME's own sources — not git HEAD, and not the working tree.
 *
 * Keying on HEAD (or on `git status --porcelain`) made every harness edit invalidate the pinned
 * baselines: the floor and ceiling were measured against `bf46a5e9-dirty`, and the next commit made
 * them unreadable for a build whose game code had not changed by one byte. What a baseline must
 * track is the thing being measured. So: content hash over src/, index.html, data/ and the vite
 * config. Harness churn no longer invalidates a baseline; a real game change always does.
 */
function gameHash() {
  const files = [];
  const walk = (dir) => {
    for (const e of readdirSync(dir, { withFileTypes: true })) {
      const full = join(dir, e.name);
      if (e.isDirectory()) walk(full);
      else if (/\.(ts|css|html|json)$/.test(e.name) && !e.name.endsWith(".test.ts")) files.push(full);
    }
  };
  walk(join(ROOT, "src"));
  walk(join(ROOT, "data"));
  const h = createHash("sha256");
  for (const f of [...files.sort(), join(ROOT, "index.html"), join(ROOT, "vite.config.ts")]) {
    h.update(f.replace(ROOT, ""));
    h.update(readFileSync(f));
  }
  return h.digest("hex").slice(0, 8);
}

const buildHash = gameHash();
const gitSha = (() => {
  try {
    return execFileSync("git", ["rev-parse", "--short=8", "HEAD"], { cwd: ROOT }).toString().trim();
  } catch {
    return "nogit";
  }
})();

const personaText = readFileSync(join(HERE, "personas", `${CFG.persona}.md`), "utf8").trim();
const systemPrompt = `${PROTOCOL}\n\nHow you play:\n${personaText}`;
const promptVersion = createHash("sha256")
  .update(`${personaText}|protocol${PROTOCOL_VERSION}|obs${OBS_SCHEMA_VERSION}`)
  .digest("hex")
  .slice(0, 12);

// Parallel runs must not land in one bundle. Same key + already finished → take the next free slot,
// and say which one in run.json, rather than interleaving two runs' jsonl streams.
let outDir = join(HERE, "runs", buildHash, CFG.persona, String(CFG.runIndex));
for (let n = 2; existsSync(join(outDir, "run.json")) || existsSync(join(outDir, "transcript.jsonl")); n++) {
  outDir = join(HERE, "runs", buildHash, CFG.persona, `${CFG.runIndex}-${n}`);
}
mkdirSync(join(outDir, "shots"), { recursive: true });
const sink = (name) => (obj) => appendFileSync(join(outDir, name), `${JSON.stringify(obj)}\n`);
const writeObs = sink("observations.jsonl");
const writeProbe = sink("probes.jsonl");
const writeTranscript = sink("transcript.jsonl");

// ── the run's own dev server, unless the caller pointed us at one ───────────────────────────────
let server = null;
if (!CFG.base) {
  const first = portFor(`${buildHash}|${CFG.persona}|${CFG.runIndex}|${CFG.policy}`);
  let lastErr = null;
  for (let i = 0; i < 8 && !server; i++) {
    try {
      server = await startServer({ root: ROOT, port: first + i });
    } catch (e) {
      lastErr = e;
    }
  }
  if (!server) throw new Error(`could not start a dev server for this run: ${lastErr}`);
  CFG.base = server.base;
  console.log(`   serving ${ROOT} at ${CFG.base} (this run only)`);
}
process.on("exit", () => server?.stop());
process.on("SIGINT", () => {
  server?.stop();
  process.exit(130);
});

const browserArgs = CFG.headless
  ? ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
  : ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-gpu"];
const browser = await chromium.launch({
  executablePath: process.env.CHROMIUM_BIN ?? "/usr/bin/chromium",
  headless: CFG.headless,
  args: browserArgs,
});
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
const pageErrors = [];
page.on("pageerror", (e) => pageErrors.push(`pageerror: ${e.message}`));
page.on("console", (m) => {
  if (m.type() === "error") pageErrors.push(`console.error: ${m.text()}`);
});

const ctx = makeCtx({ page, base: CFG.base, shotsDir: join(outDir, "shots"), tag: "turn" });
const withhold = WITHHOLD[CFG.persona] ?? [];

let brain = CFG.policy === "llm" ? makeBrain({ systemPrompt, model: CFG.model }) : null;
const rng = mulberry32(CFG.runIndex * 7919 + 13); // the random baseline is seeded, so it replays

const timeline = [];
const t0 = Date.now();
let harnessTempoPresses = 0;
let injectedLatencyMs = 0; // stays 0 in PDQ; the field exists so LCRT runs are never pooled with these
let termination = { reason: "budget", gate: "turns", stalls: 0 };
let stalls = 0;
let feedback = null;
let padSeed = null;
let padWasOpen = false;

await page.goto(CFG.base, { waitUntil: "networkidle", timeout: 45000 });
await ctx.settle(2500);
await ensurePaused();

for (let turn = 1; turn <= CFG.maxTurns; turn++) {
  const obs = await observe(ctx, { withhold });
  const probes = await probeAll(ctx, obs);
  const before = digest(obs, probes);
  await ctx.shot(String(turn).padStart(2, "0"));

  // The pad's seeded draft: captured the moment it opens, so "hand-aimed" compares the numbers the
  // player changed against the numbers the game handed them (metrics M10).
  if (obs.padOpen && !padWasOpen) padSeed = { ...obs.pad, slots: obs.slots ?? [] };
  padWasOpen = obs.padOpen;

  const rendered = render(obs, turn);
  writeObs({ turn, missionElapsedS: obs.missionElapsedS, clock: obs.clock, rendered, obs });
  writeProbe({ turn, ...probes });

  // A second guard on the same PDQ leak: if the world has not moved for three turns and the policy
  // has never spent a wait, restate the harness fact. Protocol, never gameplay advice.
  const neverWaited = !timeline.some((t) => t.action?.do === "wait");
  const frozenFor = timeline.slice(-3).filter((t) => t.missionElapsedS === obs.missionElapsedS).length;
  const timeNudge =
    neverWaited && frozenFor >= 3
      ? 'Nothing in the program has moved because the clock is still held. Spend {"do":"wait","simMinutes":N} to let it run.'
      : null;

  const prompt = [feedback, timeNudge, rendered].filter(Boolean).join("\n\n");
  feedback = null;

  let reply = null;
  let brainRec = null;
  if (CFG.policy === "llm") {
    try {
      brainRec = await brain.turn(prompt);
      reply = brainRec.reply;
    } catch (e) {
      termination = { reason: "error", gate: `brain: ${String(e).slice(0, 200)}`, stalls };
      break;
    }
    writeTranscript({
      turn,
      prompt,
      raw: brainRec.text,
      reply,
      usd: brainRec.usd,
      usage: brainRec.usage,
      latencyMs: brainRec.latencyMs,
      repaired: Boolean(brainRec.repaired),
    });
  } else if (CFG.policy === "scripted") {
    reply = scriptedPolicy(turn - 1);
    writeTranscript({ turn, prompt, reply, policy: "scripted" });
  } else {
    reply = randomPolicy(obs, rng);
    writeTranscript({ turn, prompt, reply, policy: "random" });
  }

  const { action, shapeFixed } = normalizeAction(reply?.action ?? null);
  const check = validate(action, obs);
  let executed = null;
  let noop = false;

  if (!check.ok) {
    // The fallback: say what was wrong, do not advance the world, and count it (metrics M8 for a
    // control that is not there, m8c for the harness's own JSON shape — never pooled).
    feedback =
      check.kind === "shape"
        ? `Your reply could not be used: ${check.why}`
        : `That control was not available: ${check.why}. Use only the CONTROLS and FIELDS shown.`;
  } else {
    executed = action;
    await perform(action);
    await ctx.settle(400);
    if (action.do !== "wait") {
      const obsAfter = await observe(ctx, { withhold });
      const probesAfter = await probeAll(ctx, obsAfter);
      noop = digest(obsAfter, probesAfter) === before;
    }
  }

  // A RE-BOOTED PAGE MAKES A RUN UNSCORABLE — detect it, never score through it. The sim's tick and
  // its action log are both monotonic within a session, so either going backwards means the app
  // re-initialised under us (it happened: an unrelated worktree made vite force a full reload, and
  // the second half of the run was played against a fresh world with the first half's history
  // discarded). Scoring that silently would have reported a reset as a player's choices.
  const lastRec = timeline.at(-1);
  const rebooted =
    lastRec &&
    ((obs.clock?.tick ?? 0) < (lastRec.tick ?? 0) || (probes.actions?.length ?? 0) < (lastRec.actionCount ?? 0));

  const ns = probes.netState;
  timeline.push({
    actionCount: probes.actions?.length ?? 0,
    turn,
    tick: obs.clock?.tick ?? null,
    missionElapsedS: obs.missionElapsedS,
    cursor: ns?.cursor ?? null,
    balance: ns?.balance ?? null,
    offered: (ns?.contracts ?? []).filter((c) => c.state === "offered").map((c) => c.id),
    servedAny: (ns?.contracts ?? []).some((c) => (c.servedFrac ?? 0) > 0),
    regions: regionRows(probes),
    breachSecondsTotal: Object.values(probes.regions ?? {}).reduce((s, r) => s + (r?.breachS ?? 0), 0),
    panelText: obs.panels,
    padSeed,
    padAtAction: executed ? { ...obs.pad, slots: obs.slots ?? [] } : null,
    action: executed,
    invalid: !check.ok && check.kind === "affordance",
    invalidShape: !check.ok && check.kind === "shape",
    shapeFixed,
    noop,
    read: reply?.read ?? null,
    goal: reply?.goal ?? null,
    digest: before,
  });

  if (rebooted) {
    termination = {
      reason: "reboot",
      gate: `the page re-initialised between turns ${lastRec.turn} and ${turn} — run unscorable`,
      stalls,
    };
    break;
  }

  if (executed?.do === "done") {
    termination = { reason: "complete", gate: executed.reason ?? null, stalls };
    break;
  }

  // Stall escalation — distinct strategies, never the same prompt into the same context.
  if (noop) {
    stalls += 1;
    if (stalls === 1) feedback = "Your last action changed nothing on screen.";
    else if (stalls === 2 && CFG.policy === "llm") {
      feedback =
        "Your last two actions changed nothing on screen. You are starting fresh with no memory of what you tried; look at the screen again from scratch.";
      brain = makeBrain({ systemPrompt, model: CFG.model }); // cold context, level-2 escalation
      writeTranscript({ turn, event: "escalation", level: 2, note: "history dropped, new brain session" });
    } else if (stalls >= 3) {
      termination = { reason: "stall", gate: "3 consecutive no-op turns", stalls };
      break;
    }
  } else stalls = 0;

  const usd = brain?.totals.usd ?? 0;
  if (usd > CFG.maxUsd) {
    termination = { reason: "budget", gate: `usd ${usd.toFixed(2)} > ${CFG.maxUsd}`, stalls };
    break;
  }
  if (Date.now() - t0 > CFG.maxWallMs) {
    termination = { reason: "budget", gate: "wall clock", stalls };
    break;
  }
  if (turn === CFG.maxTurns) termination = { reason: "budget", gate: "turns", stalls };
}

// ── the debrief: behaviour plus four open questions (GDD §9.7 — no scales, ever) ──────────────
const debrief = {};
if (CFG.policy === "llm") {
  const QUESTIONS = {
    what_you_did: "The session is over. In your own words, what were you doing in there?",
    what_confused: "What, if anything, confused you?",
    what_differently: "If you did it again, what would you do differently?",
    what_is_it_for: "What do you think this program is for?",
    // Exploratory only, never gating: the GDD's replay bit belongs to human testers.
    replay_offer: "You can stop here, or start again from the beginning. Which would you rather do, and why?",
  };
  for (const [k, q] of Object.entries(QUESTIONS)) {
    try {
      debrief[k] = await brain.askFreeform(q);
    } catch (e) {
      debrief[k] = `(unanswered: ${String(e).slice(0, 120)})`;
    }
  }
  writeTranscript({ event: "debrief", debrief });
}

const finalProbes = await probeAll(ctx, null).catch(() => ({ actions: [] }));
const actions = finalProbes.actions ?? [];
writeFileSync(join(outDir, "actions.jsonl"), actions.map((a) => JSON.stringify(a)).join("\n"));

const metrics = computeMetrics({
  actions,
  timeline,
  meta: { persona: CFG.persona, withheld: withhold, errors: pageErrors.length },
});

const runJson = {
  key: {
    build_hash: buildHash, // content hash of the GAME's sources — see gameHash()
    git_sha: gitSha, //  provenance only; harness commits do not move build_hash
    seed: `scenario-fixed/run-${CFG.runIndex}`,
    model_id: CFG.policy === "llm" ? CFG.model : "random-policy",
    model_version: CFG.policy === "llm" ? CFG.model : "n/a",
    params_hash: createHash("sha256").update(JSON.stringify(CFG)).digest("hex").slice(0, 12),
    prompt_version: promptVersion,
    persona: CFG.persona,
    clock_mode: "PDQ",
  },
  server: server ? { own: true, base: CFG.base, root: ROOT } : { own: false, base: CFG.base },
  clock: {
    mode: "PDQ",
    injected_latency_ms_total: injectedLatencyMs,
    sim_seconds_elapsed: timeline.at(-1)?.missionElapsedS ?? 0,
    harness_tempo_presses: harnessTempoPresses,
  },
  budgets: { max_turns: CFG.maxTurns, max_wall_ms: CFG.maxWallMs, max_usd: CFG.maxUsd },
  spend: {
    turns: timeline.length,
    wall_ms: Date.now() - t0,
    usd: Number((brain?.totals.usd ?? 0).toFixed(4)),
    brain_latency_ms: brain?.totals.latencyMs ?? 0,
    input_tokens: brain?.totals.inputTokens ?? 0,
    output_tokens: brain?.totals.outputTokens ?? 0,
  },
  termination,
  page_errors: pageErrors,
  baselines: { random: "tools/agent-eval/baselines (policy=random)", scripted: "tools/playtest.mjs", human: "not measured" },
};
writeFileSync(join(outDir, "run.json"), `${JSON.stringify(runJson, null, 2)}\n`);
writeFileSync(join(outDir, "metrics.json"), `${JSON.stringify(metrics, null, 2)}\n`);

// AE-08 — the baselines the scoreboard is read against (docs/agent-eval.md §5). A baseline run is
// an ordinary run with a label: same loop, same metrics, so the numbers are comparable by
// construction rather than by assertion. --baseline=random pins the floor; the scripted ceiling is
// pinned from the authored scenes by tools/agent-eval/baseline-scripted.mjs.
const baselineLabel = arg("baseline", null);
if (baselineLabel) {
  const dir = join(HERE, "baselines", buildHash);
  mkdirSync(dir, { recursive: true });
  writeFileSync(
    join(dir, `${baselineLabel}.json`),
    `${JSON.stringify({ label: baselineLabel, key: runJson.key, termination, metrics }, null, 2)}\n`,
  );
}
writeFileSync(join(outDir, "debrief.json"), `${JSON.stringify(debrief, null, 2)}\n`);
writeReport({ outDir, cfg: CFG, runJson, metrics, timeline, debrief, baselineDir: join(HERE, "baselines", buildHash) });

await browser.close();
server?.stop();

console.log(`\n══ AGENT-EVAL ${CFG.persona} run ${CFG.runIndex} · ${termination.reason.toUpperCase()} (${termination.gate ?? "-"}) ══`);
console.log(`   bundle: ${outDir}`);
console.log(
  `   turns ${timeline.length} · mission ${Math.round((timeline.at(-1)?.missionElapsedS ?? 0) / 60)} min · ` +
    `$${(brain?.totals.usd ?? 0).toFixed(3)} · errors ${pageErrors.length}`,
);
console.log(
  `   act ${metrics.m11_acts_reached} · committed ${metrics.committed_actions_total} · surfaces ${metrics.m2_decision_surfaces.count}/${metrics.m2_decision_surfaces.of} · ` +
    `served ${metrics.m9_time_to_first_served_s === null ? "never" : `${Math.round(metrics.m9_time_to_first_served_s)}s`} · invalid ${pct(metrics.m8_invalid_action_rate)} · no-op ${pct(metrics.m8b_no_op_action_rate)}`,
);
process.exit(pageErrors.length > 0 || termination.reason === "error" || termination.reason === "reboot" ? 1 : 0);

// ── helpers ───────────────────────────────────────────────────────────────────────────────────

function pct(v) {
  return v === null || v === undefined ? "—" : `${Math.round(v * 100)}%`;
}

function regionRows(probes) {
  const asked = new Map((probes.trace?.order ?? []).map((f) => [f.id, f.asked]));
  return Object.values(probes.regions ?? {})
    .filter(Boolean)
    .map((r) => ({ id: r.id, servedFrac: r.servedFrac, ask: asked.get(r.id) ?? null, breachS: r.breachS }));
}

function validate(action, obs) {
  const SHAPES =
    '{"do":"click","target":"<id>"} · {"do":"key","key":"<key>"} · {"do":"set","param":"<name>","value":<number>} · {"do":"wait","simMinutes":<number>} · {"do":"done","reason":"..."}';
  if (!action || typeof action.do !== "string" || action.do === "")
    return { ok: false, kind: "shape", why: `no action in the reply. The forms are: ${SHAPES}` };
  switch (action.do) {
    case "click": {
      if (!action.target) return { ok: false, kind: "shape", why: `a click is {"do":"click","target":"<id from the CONTROLS list>"}` };
      const hit = obs.affordances.find((a) => a.target === action.target);
      if (!hit) return { ok: false, kind: "affordance", why: `"${action.target}" is not a control on screen` };
      if (!hit.enabled) return { ok: false, kind: "affordance", why: `"${action.target}" is disabled` };
      return { ok: true };
    }
    case "key":
      if (!action.key) return { ok: false, kind: "shape", why: `a keypress is {"do":"key","key":"<key>"}` };
      return KEY_WHITELIST.has(action.key)
        ? { ok: true }
        : { ok: false, kind: "affordance", why: `the key "${action.key}" does nothing here` };
    case "set": {
      if (!action.param || action.value === undefined || action.value === null)
        return { ok: false, kind: "shape", why: `setting a field is {"do":"set","param":"<name from the FIELDS list>","value":<number>}` };
      const field = obs.affordances.find((a) => a.kind === "field" && a.target === `param-${action.param}`);
      if (!field) return { ok: false, kind: "affordance", why: `"${action.param}" is not a field on screen` };
      if (!Number.isFinite(Number(action.value))) return { ok: false, kind: "shape", why: "that field takes a number" };
      return { ok: true };
    }
    case "wait":
      return Number.isFinite(Number(action.simMinutes)) && Number(action.simMinutes) > 0
        ? { ok: true }
        : { ok: false, kind: "shape", why: `waiting is {"do":"wait","simMinutes":<positive number>}` };
    case "done":
      return { ok: true };
    default:
      return { ok: false, kind: "shape", why: `"${action.do}" is not an action form. The forms are: ${SHAPES}` };
  }
}


async function perform(action) {
  if (action.do === "click") {
    if (action.target.startsWith("text:")) await ctx.clickLabel(action.target.slice(5));
    else await ctx.click(`[data-net=${action.target}]`);
  } else if (action.do === "key") {
    await ctx.key(action.key);
  } else if (action.do === "set") {
    await ctx.setParam(action.param, Number(action.value));
  } else if (action.do === "wait") {
    await fastForward(Math.min(Number(action.simMinutes), 120) * 60);
  }
}

async function ensurePaused() {
  const c = await ctx.probe("clock");
  if (c && !c.paused) {
    await ctx.key(" ");
    harnessTempoPresses += 1;
    await ctx.settle(120);
  }
}

/**
 * Let the world run for `simSeconds` by PLAYING at the top time scale, then stop the clock again.
 * The presses are the harness's, so metrics reads tempo from the agent's own turns instead of from
 * the action log (docs/agent-eval-metrics.md amendment A-1).
 */
async function fastForward(simSeconds) {
  const c0 = await ctx.probe("clock");
  const startSec = c0?.seconds ?? 0;
  if (c0?.paused) {
    await ctx.key(" ");
    harnessTempoPresses += 1;
  }
  for (let i = 0; i < FF_SCALE_PRESSES; i++) await ctx.key(".");
  harnessTempoPresses += FF_SCALE_PRESSES;
  const deadline = Date.now() + FF_REAL_TIMEOUT_MS;
  for (;;) {
    const c = await ctx.probe("clock");
    if ((c?.seconds ?? 0) - startSec >= simSeconds) break;
    if (Date.now() > deadline) break;
    await ctx.wait(120);
  }
  await ensurePaused();
}

/**
 * The RANDOM FLOOR (docs/agent-eval.md §5), run through the same loop as the agent so the numbers
 * are comparable. Seeded, so a baseline run replays. It clicks and types blind — the point is what a
 * policy with no comprehension at all achieves, which is the bottom of the scale every LLM number
 * is read against.
 */
function randomPolicy(obs, rand) {
  const buttons = obs.affordances.filter((a) => a.kind === "button" && a.enabled);
  const fields = obs.affordances.filter((a) => a.kind === "field");
  const roll = rand();
  if (roll < 0.55 && buttons.length > 0) {
    const b = buttons[Math.floor(rand() * buttons.length)];
    return { read: "(random policy)", goal: "(random policy)", action: { do: "click", target: b.target } };
  }
  if (roll < 0.75 && fields.length > 0) {
    const f = fields[Math.floor(rand() * fields.length)];
    return {
      read: "(random policy)",
      goal: "(random policy)",
      action: { do: "set", param: f.target.replace(/^param-/, ""), value: Math.round(rand() * 800) },
    };
  }
  return { read: "(random policy)", goal: "(random policy)", action: { do: "wait", simMinutes: 1 + Math.floor(rand() * 10) } };
}

function mulberry32(a) {
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
