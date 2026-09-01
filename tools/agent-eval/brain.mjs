/**
 * THE BRAIN SEAT (SD-55 / AE-05) — a tool-less `claude -p` subprocess.
 *
 * Why a subprocess and not the Agent SDK (docs/agent-eval.md §2, SD-55 decision 4): this agent needs
 * no tools. The driver is the actuator; the brain's whole job is to read a screen and emit one JSON
 * action. Running it with `--tools ""` `--setting-sources ""` and an empty MCP config makes the
 * design-free boundary STRUCTURAL — the brain physically cannot read the repo, the GDD, the act
 * script or the golden path, so nothing has to be trusted to deny it. It also costs 309 input tokens
 * on the opening turn instead of the 11k+ a default Claude Code seat carries.
 *
 * Memory across turns is the CLI's own session: `--session-id` on the first turn, `--resume` after,
 * which is also what keeps the prompt cache warm. Cost and latency are recorded from the CLI's own
 * JSON — the harness never models spend, it reports measured spend.
 */

import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

const CLAUDE = process.env.CLAUDE_BIN ?? "claude";

/**
 * THE BLINDNESS FIX — the seat runs in an EMPTY DIRECTORY, never in the repo.
 *
 * Found by reading the first live run's debrief, which named this harness's own files
 * ("protocol.mjs, brain.mjs, action-shape.mjs, personas") and concluded it was being evaluated.
 * `--tools ""` does stop the brain from READING anything, but Claude Code puts the working
 * directory, the project context and git status into its dynamic prompt sections, so a seat spawned
 * inside the repo is simply TOLD what project it is in. Reproduced directly: asked its own cwd, a
 * seat in the repo answered "/home/basov/Games/signal-horizon — a ... signal-horizon project (…M1
 * mechanics, orbit sim game)"; the identical seat in an empty tmpdir answered that it cannot tell.
 *
 * So the cwd is a fresh empty temp dir per run. Blind by construction now means blind.
 */
function scratchCwd() {
  return mkdtempSync(join(tmpdir(), "agent-eval-seat-"));
}

/**
 * @param {object} o
 * @param {string} o.systemPrompt   persona + protocol; the ONLY standing context the brain gets
 * @param {string} [o.model]
 * @param {number} [o.timeoutMs]
 */
export function makeBrain({ systemPrompt, model = "claude-sonnet-5", timeoutMs = 180000 }) {
  const sessionId = randomUUID();
  const cwd = scratchCwd();
  let started = false;
  const totals = { turns: 0, usd: 0, inputTokens: 0, outputTokens: 0, cacheReadTokens: 0, latencyMs: 0 };

  async function ask(prompt) {
    const args = started
      ? ["-p", "--resume", sessionId]
      : ["-p", "--session-id", sessionId, "--system-prompt", systemPrompt];
    args.push(
      "--model", model,
      "--tools", "",
      "--strict-mcp-config",
      "--mcp-config", '{"mcpServers":{}}',
      "--setting-sources", "",
      "--disable-slash-commands",
      "--output-format", "json",
      prompt,
    );
    const t0 = Date.now();
    const stdout = await new Promise((resolve, reject) => {
      execFile(CLAUDE, args, { cwd, maxBuffer: 64 * 1024 * 1024, timeout: timeoutMs }, (err, out, errOut) =>
        err && !out ? reject(new Error(`${err.message}\n${errOut}`)) : resolve(out),
      );
    });
    const latencyMs = Date.now() - t0;
    started = true;
    let env;
    try {
      env = JSON.parse(stdout);
    } catch {
      throw new Error(`brain returned non-JSON envelope: ${String(stdout).slice(0, 400)}`);
    }
    const u = env.usage ?? {};
    totals.turns += 1;
    totals.usd += env.total_cost_usd ?? 0;
    totals.inputTokens += u.input_tokens ?? 0;
    totals.outputTokens += u.output_tokens ?? 0;
    totals.cacheReadTokens += u.cache_read_input_tokens ?? 0;
    totals.latencyMs += latencyMs;
    return { text: String(env.result ?? ""), usd: env.total_cost_usd ?? 0, usage: u, latencyMs, sessionId };
  }

  return {
    sessionId,
    cwd,
    totals,
    /** One turn. Returns the parsed reply, or `{ parseError }` after one repair attempt. */
    async turn(prompt) {
      const first = await ask(prompt);
      const parsed = extractJson(first.text);
      if (parsed) return { ...first, reply: parsed };
      // One repair attempt, and it is a DIFFERENT prompt — never the same text into the same
      // context, which is the loop that burns a budget without moving.
      const repair = await ask(
        'Your last reply could not be parsed. Reply with ONLY a JSON object, no prose and no code fence, in exactly this shape: {"read":"...","goal":"...","action":{...}}',
      );
      const reparsed = extractJson(repair.text);
      return {
        ...repair,
        usd: first.usd + repair.usd,
        latencyMs: first.latencyMs + repair.latencyMs,
        reply: reparsed,
        repaired: true,
        ...(reparsed ? {} : { parseError: first.text.slice(0, 500) }),
      };
    },
    /** A question whose answer is recorded verbatim and never scored by the harness. */
    async askFreeform(prompt) {
      const r = await ask(prompt);
      return r.text.trim();
    },
  };
}

/** Pull the first balanced JSON object out of a reply, code fences and stray prose included. */
export function extractJson(text) {
  if (!text) return null;
  const body = text.replace(/```(?:json)?/gi, "");
  const start = body.indexOf("{");
  if (start < 0) return null;
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const c = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (c === "\\") esc = true;
      else if (c === '"') inStr = false;
      continue;
    }
    if (c === '"') inStr = true;
    else if (c === "{") depth++;
    else if (c === "}" && --depth === 0) {
      try {
        return JSON.parse(body.slice(start, i + 1));
      } catch {
        return null;
      }
    }
  }
  return null;
}
