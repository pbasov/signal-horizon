/**
 * `npm run link-modules` — GIVE THIS WORKTREE A node_modules WITHOUT A SECOND INSTALL (SD-64).
 *
 * Every worktree under .claude/worktrees/ is a full checkout, and each one needs `node_modules` to
 * run vite, vitest or a playtest. Installing per tree would cost hundreds of megabytes and let two
 * trees drift onto different dependency trees, so they all SHARE the main checkout's install through
 * a symlink.
 *
 * That symlink used to arrive by accident: it had been COMMITTED (an absolute path into one machine's
 * home directory), so `git worktree add` checked it out for free. That is why main — where
 * node_modules is a real directory — reported the path deleted forever, and why a fresh clone on any
 * other machine would land a dangling link. SD-64 untracked it and made the .gitignore pattern
 * slash-free so it cannot be re-committed; this script is the deliberate replacement.
 *
 * The link it writes is RELATIVE, so it keeps working if the repo is moved or renamed.
 * Idempotent and safe to re-run: an existing node_modules of any kind is left exactly as it is.
 */

import { execFileSync } from "node:child_process";
import { existsSync, lstatSync, readlinkSync, symlinkSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

/** This tree's root: tools/ lives at <root>/tools in every checkout, worktrees included. */
const ROOT = resolve(fileURLToPath(new URL(".", import.meta.url)), "..");

/** The MAIN checkout's root — the parent of the shared .git that every worktree points at. */
function mainCheckoutRoot() {
  try {
    const out = execFileSync("git", ["rev-parse", "--git-common-dir"], {
      cwd: ROOT,
      stdio: ["ignore", "pipe", "ignore"],
    })
      .toString()
      .trim();
    return dirname(resolve(ROOT, out));
  } catch {
    return null; // not a git checkout (a tarball, a CI export)
  }
}

const link = join(ROOT, "node_modules");

// Already present — a real install in the main checkout, or a link already made here. Either way
// there is nothing to do, and we must never touch a directory somebody installed on purpose.
if (existsSync(link) || isDanglingLink(link)) {
  const kind = isDanglingLink(link)
    ? `a DANGLING symlink → ${readlinkSync(link)}`
    : lstatSync(link).isSymbolicLink()
      ? `a symlink → ${readlinkSync(link)}`
      : "a real directory";
  if (isDanglingLink(link)) {
    console.error(`✗ ${ROOT}/node_modules is ${kind}`);
    console.error("  Remove it and re-run, or `npm install` here if this tree wants its own copy.");
    process.exit(1);
  }
  console.log(`▸ node_modules already present (${kind}) — nothing to do.`);
  process.exit(0);
}

const main = mainCheckoutRoot();
if (main === null) {
  console.error("✗ not a git checkout — nothing to link to. Run `npm install` here instead.");
  process.exit(1);
}
if (main === ROOT) {
  console.error("✗ this IS the main checkout and it has no node_modules. Run `npm install` here.");
  process.exit(1);
}

const target = join(main, "node_modules");
if (!existsSync(target)) {
  console.error(`✗ the main checkout has no install to share (${target} is missing).`);
  console.error(`  Run \`npm install\` in ${main} first, then re-run this.`);
  process.exit(1);
}

// Relative, so the pair survives the repo being moved or renamed.
const rel = relative(ROOT, target);
symlinkSync(rel, link, "dir");
console.log(`▸ linked node_modules → ${rel} (shared with ${main})`);

/** A symlink whose target does not resolve. `existsSync` follows links, so it answers false. */
function isDanglingLink(p) {
  try {
    return lstatSync(p).isSymbolicLink() && !existsSync(p);
  } catch {
    return false;
  }
}
