/**
 * A CROSS-WORKTREE MUTEX (SD-59 / X-08).
 *
 * Several agents work this repo at once, each in its own worktree under .claude/worktrees/, and the
 * expensive things they do are not tree-local: a playtest launches chromium, drives a dev server and
 * writes screenshots, and two of them at once fight over the GPU, the display and each other's
 * timing. Isolating ports (tools/workspace.mjs) stops trees from driving each other's app; it does
 * not stop them from running at the same time.
 *
 * So: one advisory lock, held in the MAIN repo's .git (shared by every worktree, never inside a
 * working tree, therefore never committed). Acquisition is an atomic O_EXCL create — the filesystem
 * arbitrates, not us. A holder that died without releasing is reaped: dead pid, or older than the
 * stale window.
 *
 * Advisory, not enforced. `SH_NO_LOCK=1` opts out for anyone who knows they are alone.
 */

import { openSync, writeSync, closeSync, readFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import { hostname } from "node:os";
import { sharedDir, treeName, ROOT } from "./workspace.mjs";

const STALE_MS = 45 * 60 * 1000; // longer than any real playtest; short enough to unwedge a session
const POLL_MS = 500;

const lockPath = (name) => join(sharedDir(), `${name}.lock`);

/** Is that pid still around? EPERM means alive-but-not-ours, which still counts as alive. */
function alive(pid) {
  if (!Number.isInteger(pid) || pid <= 0) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return e.code === "EPERM";
  }
}

/** Read a holder record, or null if the file is gone/garbage (garbage is treated as reapable). */
function readHolder(path) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (e) {
    if (e.code === "ENOENT") return null;
    return { pid: 0, corrupt: true, at: 0 };
  }
}

export function describeHolder(h) {
  if (!h) return "nobody";
  const age = h.at ? `${Math.round((Date.now() - h.at) / 1000)}s` : "unknown age";
  return `${h.tree ?? "?"} (pid ${h.pid ?? "?"} on ${h.host ?? "?"}, held ${age})${h.what ? ` — ${h.what}` : ""}`;
}

/**
 * One attempt. Returns a handle on success, or the current holder record on failure.
 * Reaps a dead or stale holder and retries once, so a crashed run never wedges the repo.
 */
function tryAcquire(name, what, staleMs) {
  const path = lockPath(name);
  const token = `${process.pid}-${treeName()}`;
  for (let attempt = 0; attempt < 2; attempt++) {
    let fd;
    try {
      fd = openSync(path, "wx");
    } catch (e) {
      if (e.code !== "EEXIST") throw e;
      const holder = readHolder(path);
      if (holder === null) continue; // released between open and read — race, just retry
      const stale = !alive(holder.pid) || Date.now() - (holder.at ?? 0) > staleMs;
      if (!stale) return { held: holder };
      try {
        unlinkSync(path);
      } catch {
        /* someone else reaped it first; the retry will find out */
      }
      continue;
    }
    writeSync(fd, JSON.stringify({ token, pid: process.pid, host: hostname(), tree: treeName(), root: ROOT, what, at: Date.now() }));
    closeSync(fd);
    return { handle: makeHandle(path, token) };
  }
  return { held: readHolder(path) ?? { pid: 0, at: Date.now() } };
}

// Every lock this process holds, released together if we die. One set of handlers, not one pair per
// handle — a long playtest acquires a few, and Node starts warning at eleven listeners.
const held = new Set();
let handlersInstalled = false;
function installHandlers() {
  if (handlersInstalled) return;
  handlersInstalled = true;
  process.on("exit", () => {
    for (const h of [...held]) h.release();
  });
  for (const sig of ["SIGINT", "SIGTERM", "SIGHUP"]) {
    process.on(sig, () => {
      for (const h of [...held]) h.release();
      process.exit(130);
    });
  }
}

function makeHandle(path, token) {
  let released = false;
  const handle = {
    path,
    token,
    release() {
      if (released) return;
      released = true;
      held.delete(handle);
      // Only ever remove OUR lock. If we were reaped as stale while still running, the file now
      // belongs to someone else and deleting it would hand the repo two concurrent holders.
      const holder = readHolder(path);
      if (holder && holder.token === token) {
        try {
          unlinkSync(path);
        } catch {
          /* already gone */
        }
      }
    },
  };
  held.add(handle);
  installHandlers();
  return handle;
}

/**
 * Wait for the lock, narrating who holds it. Resolves to a handle, or rejects on timeout naming the
 * holder — never silently proceeds without it, because "ran anyway" is the failure mode this exists
 * to remove.
 */
export async function acquire(name, { what = "", timeoutMs = 20 * 60 * 1000, staleMs = STALE_MS, log = console.log } = {}) {
  if (process.env.SH_NO_LOCK === "1") return { path: null, token: null, release() {} };
  const deadline = Date.now() + timeoutMs;
  let announced = 0;
  for (;;) {
    const r = tryAcquire(name, what, staleMs);
    if (r.handle) return r.handle;
    const now = Date.now();
    if (now > deadline) throw new Error(`lock "${name}" is held by ${describeHolder(r.held)} — gave up after ${Math.round(timeoutMs / 1000)}s. Re-run when it frees, or SH_NO_LOCK=1 to ignore it.`);
    if (now - announced > 15000) {
      announced = now;
      log(`⏳ waiting for lock "${name}" — held by ${describeHolder(r.held)}`);
    }
    await new Promise((res) => setTimeout(res, POLL_MS));
  }
}

/** Run `fn` under the lock, releasing it whatever happens. */
export async function withLock(name, opts, fn) {
  const handle = await acquire(name, opts);
  try {
    return await fn();
  } finally {
    handle.release();
  }
}

/** Synchronous, non-blocking variant for short critical sections (the port registry). */
export function acquireSyncBlocking(name, { what = "", staleMs = 60000, spinMs = 5000 } = {}) {
  const until = Date.now() + spinMs;
  for (;;) {
    const r = tryAcquire(name, what, staleMs);
    if (r.handle) return r.handle;
    if (Date.now() > until) {
      // A 5s wait for a file-registry write means something is wrong with the holder, not with us.
      // Reap it rather than block a dev server boot forever.
      try {
        unlinkSync(lockPath(name));
      } catch {
        /* gone */
      }
    }
    Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, 20);
  }
}
