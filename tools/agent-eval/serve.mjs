/**
 * A DEDICATED DEV SERVER PER RUN (SD-55 / AE-06).
 *
 * The harness must never share :5173. Worktrees under .claude/worktrees/ are a standing part of how
 * this repo is worked on, and a live run is fragile in a way a human session is not: when vite
 * force-reloaded the shared server ("changed tsconfig file detected … forcing full-reload", caused by
 * a concurrent session's worktree), the app re-booted mid-run and the second half of the run played
 * against a fresh world. vite.config.ts now ignores those paths, but a shared server is still shared
 * — a human pressing save, a second harness run, or any tool that touches src/ reloads it.
 *
 * So each run serves the tree it is measuring, on its own port, and tears it down after. Runs in
 * different worktrees therefore measure their own code and cannot disturb each other.
 */

import { spawn } from "node:child_process";

/** Deterministic-ish port from the run key, so parallel runs in different trees rarely collide. */
export function portFor(seedString) {
  let h = 2166136261;
  for (const ch of seedString) h = Math.imul(h ^ ch.charCodeAt(0), 16777619);
  return 41000 + (Math.abs(h) % 8000);
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
    stop() {
      child.kill("SIGTERM");
    },
    log: () => log.join(""),
  };
}
