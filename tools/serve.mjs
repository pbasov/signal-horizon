/**
 * A DEV SERVER YOU OWN (SD-55 / AE-06, generalised in SD-59 / X-08).
 *
 * Nothing here may share :5173. Worktrees under .claude/worktrees/ are a standing part of how this
 * repo is worked on, and a shared server is a shared fate: when vite force-reloaded the shared one
 * ("changed tsconfig file detected … forcing full-reload", caused by a concurrent session's
 * worktree), the app re-booted mid-run and the second half of an agent-eval run played against a
 * fresh world. Worse than the reload is the silence: a tool pointed at :5173 from a worktree tests
 * SOMEONE ELSE'S CODE and says green.
 *
 * So every harness serves the tree it is measuring, on that tree's own port (tools/workspace.mjs),
 * and tears it down after. Runs in different worktrees measure their own code and cannot disturb
 * each other.
 */

import { spawn } from "node:child_process";

/** Deterministic-ish port from a run key, so parallel agent-eval runs rarely collide. */
export function portFor(seedString) {
  let h = 2166136261;
  for (const ch of seedString) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 41000 + (Math.abs(h) % 8000);
}

/** Does something already answer here? Used to reuse a dev server the human already started. */
export async function isServing(base, timeoutMs = 1500) {
  try {
    const r = await fetch(base, { signal: AbortSignal.timeout(timeoutMs) });
    return r.ok;
  } catch {
    return false;
  }
}

/**
 * Start `vite` for `root` on `port` and resolve once it answers. Returns a handle with `stop()`.
 * Never rejects on a busy port without saying so — a silent fallback to someone else's server is
 * exactly the ambiguity this module exists to remove.
 */
export async function startServer({ root, port, timeoutMs = 60000 }) {
  const child = spawn("npx", ["vite", "--port", String(port), "--strictPort", "--clearScreen", "false"], {
    cwd: root,
    stdio: ["ignore", "pipe", "pipe"],
    env: { ...process.env, FORCE_COLOR: "0" },
  });
  const log = [];
  child.stdout.on("data", (d) => log.push(String(d)));
  child.stderr.on("data", (d) => log.push(String(d)));

  const base = `http://localhost:${port}`;
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (child.exitCode !== null) throw new Error(`vite exited (${child.exitCode}) on port ${port}:\n${log.join("")}`);
    try {
      const r = await fetch(base, { signal: AbortSignal.timeout(2000) });
      if (r.ok) break;
    } catch {
      /* not up yet */
    }
    if (Date.now() > deadline) {
      child.kill("SIGTERM");
      throw new Error(`vite did not come up on ${base} within ${timeoutMs}ms:\n${log.join("")}`);
    }
    await new Promise((res) => setTimeout(res, 250));
  }
  return {
    base,
    port,
    started: true,
    stop() {
      child.kill("SIGTERM");
    },
    log: () => log.join(""),
  };
}

/**
 * Reuse this tree's dev server if it is already up, otherwise start one and own it.
 *
 * The port is the TREE's port, so "already up" can only ever mean this tree's own `npm run dev` —
 * never a neighbour's. `stop()` is a no-op for a server we merely borrowed.
 */
export async function ensureServer({ root, port, log = () => {} }) {
  const base = `http://localhost:${port}`;
  if (await isServing(base)) {
    log(`▸ using the dev server already on ${base}`);
    return { base, port, started: false, stop() {}, log: () => "" };
  }
  log(`▸ starting vite on ${base}`);
  const s = await startServer({ root, port });
  return s;
}
