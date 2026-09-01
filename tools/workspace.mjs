/**
 * WHO AM I, AND WHICH PORT IS MINE (SD-59 / X-08).
 *
 * This repo is worked on by several agents at once, each in its own git worktree under
 * .claude/worktrees/. Every one of those trees is a complete checkout with its own vite config, and
 * until now every one of them asked for :5173. The first tree to boot won; the rest either failed on
 * `strictPort` or — far worse — quietly pointed their playtests, smoke checks and screenshots at
 * ANOTHER TREE'S APP and reported green for code they never ran.
 *
 * The fix is that a port belongs to a tree, not to the repo:
 *   - the main checkout keeps :5173, so muscle memory and AGENTS.md stay true;
 *   - every worktree gets its own port, allocated once and remembered.
 *
 * The registry lives in the MAIN repo's .git — the one directory every worktree shares, which is
 * outside all of them and so can never be committed. Allocation is done under a lock, so two trees
 * booting at the same moment cannot be handed the same number.
 */

import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, readFileSync, writeFileSync, renameSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { acquireSyncBlocking } from "./lock.mjs";

/** This tree's root: tools/ lives at <root>/tools in every checkout, worktrees included. */
export const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

const MAIN_PORT = 5173;
const RANGE_LO = 5174;
const RANGE_HI = 5372; // 5173 + 200: far more trees than anyone runs, and well clear of the
                       // agent-eval range (41000–49000, tools/serve.mjs).

let _common;
/** The main repo's .git, shared by every worktree. */
function gitCommonDir() {
  if (_common !== undefined) return _common;
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], { cwd: ROOT, stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    _common = resolve(ROOT, out);
  } catch {
    _common = null; // not a git checkout (a tarball, a CI export) — fall back below
  }
  return _common;
}

/** Where cross-worktree state lives. Created on demand; never inside a working tree. */
export function sharedDir() {
  if (process.env.SH_STATE_DIR) {
    mkdirSync(process.env.SH_STATE_DIR, { recursive: true });
    return process.env.SH_STATE_DIR;
  }
  const common = gitCommonDir();
  const dir = common ? join(common, "signal-horizon") : join(ROOT, "node_modules", ".signal-horizon");
  mkdirSync(dir, { recursive: true });
  return dir;
}

/** True when this is the primary checkout rather than a worktree. */
export function isMainCheckout() {
  const common = gitCommonDir();
  return common === null || dirname(common) === ROOT;
}

/** A human-readable name for this tree, used in lock files and log lines. */
export function treeName() {
  return isMainCheckout() ? `main:${basename(ROOT)}` : basename(ROOT);
}

const registryPath = () => join(sharedDir(), "dev-ports.json");

function readRegistry() {
  try {
    const raw = JSON.parse(readFileSync(registryPath(), "utf8"));
    return raw && typeof raw === "object" ? raw : {};
  } catch {
    return {};
  }
}

/**
 * This tree's dev port. Stable across calls and across processes, so `vite`, the playtest, the smoke
 * check and every screenshot tool agree without being told.
 *
 * SH_DEV_PORT overrides (CI, or a human who wants a known number).
 */
export function devPort() {
  const override = Number(process.env.SH_DEV_PORT);
  if (Number.isInteger(override) && override > 0) return override;
  if (isMainCheckout()) return MAIN_PORT;

  const mine = readRegistry()[ROOT];
  if (mine && Number.isInteger(mine.port)) return mine.port;

  const lock = acquireSyncBlocking("dev-ports", { what: `allocate port for ${treeName()}` });
  try {
    // Re-read inside the lock: another tree may have allocated while we waited.
    const fresh = readRegistry();
    if (fresh[ROOT] && Number.isInteger(fresh[ROOT].port)) return fresh[ROOT].port;

    // Drop trees that no longer exist, so a long-lived repo doesn't leak the range away.
    const live = Object.fromEntries(Object.entries(fresh).filter(([root]) => existsSync(root)));
    const port = pickPort(live);

    live[ROOT] = { port, name: treeName(), at: new Date().toISOString() };
    const tmp = `${registryPath()}.${process.pid}.tmp`;
    writeFileSync(tmp, `${JSON.stringify(live, null, 2)}\n`);
    renameSync(tmp, registryPath()); // atomic swap: a concurrent reader never sees half a file
    return port;
  } finally {
    lock.release();
  }
}

/**
 * The lowest port in the range that no live tree holds. Reusing the gap a removed worktree left is
 * the point: the range must not drain away over a repo's lifetime.
 */
export function pickPort(live) {
  const taken = new Set(Object.values(live).map((e) => e.port));
  for (let port = RANGE_LO; port <= RANGE_HI; port++) if (!taken.has(port)) return port;
  throw new Error(`no free dev port in ${RANGE_LO}-${RANGE_HI}; ${taken.size} worktrees registered`);
}

/** The base URL this tree's tools should talk to unless told otherwise. */
export function devBase() {
  return process.env.BASE ?? `http://localhost:${devPort()}`;
}
