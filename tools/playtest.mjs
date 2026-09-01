/**
 * THE PLAYTEST LOOP (R3 tooling upgrade). A headless, scripted, ASSERTIVE playthrough
 * of the FIRST LIGHT hour — the machine side of the M1 gate. Scenes are code (expressive,
 * diffable); the runner is dumb: launch chromium (same channel as tools/shoot.mjs), run
 * each scene in order, collect fail/pass, drop screenshots.
 *
 * Usage: node tools/playtest.mjs [sceneName ...]   (default: all scenes, in dependency order)
 * Env:   HEADLESS=1 — SwiftShader CI path (no display). BASE=<url> to drive a server of your own.
 *        SH_NO_LOCK=1 to skip the cross-worktree lock (know that you are alone before you do).
 *
 * TWO THINGS KEEP CONCURRENT WORKTREES OUT OF EACH OTHER'S PLAYTEST (SD-59 / X-08):
 *   1. It drives THIS TREE'S port (tools/workspace.mjs) and, if nothing answers there, starts and
 *      owns a vite for this tree. It can no longer test a neighbour's code and call it green.
 *   2. It holds a repo-wide lock while it runs. Two playtests at once fought over the GPU, the
 *      display and each other's timing; now the second one waits and says who it is waiting for.
 *
 * Each scene module exports { name, run(ctx) }:
 *   ctx.page      playwright-core Page
 *   ctx.shot(tag) capture a screenshot to docs/screenshots/playtest/<scene>-<tag>.png
 *   ctx.ok(label, cond, detail?)   record an assertion (fail = report + nonzero exit)
 *   ctx.eval(fn|expr)              evaluate in page (awaits promises)
 *   ctx.key(key)                   dispatch a keydown on window (the app's keyset listens there)
 *   ctx.click(sel)/ctx.clickText(t) DOM click helpers
 *   ctx.setParam(name, value)      drive a [data-net=param-*] typed field (change event)
 *   ctx.wait(ms) / ctx.settle(ms=350)
 *   ctx.probe(name, ...args)       call window.__<name>(...args) (the __aimProbe etc. family)
 */

import { chromium } from "playwright-core";
import { makeCtx } from "./ctx.mjs";
import { devPort, treeName } from "./workspace.mjs";
import { ensureServer } from "./serve.mjs";
import { acquire } from "./lock.mjs";
import { mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..");
const PORT = devPort();
const BASE_OVERRIDE = process.env.BASE ?? null;
const EXEC = process.env.CHROMIUM_BIN ?? "/usr/bin/chromium";
const HEADLESS = process.env.HEADLESS === "1" || process.env.HEADFUL !== "1";
const args = HEADLESS
  ? ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
  : ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-gpu"];
if (!process.env.DISPLAY && process.env.WAYLAND_DISPLAY) args.push("--ozone-platform-hint=auto");

const SHOTS = join(ROOT, "docs/screenshots/playtest");
mkdirSync(SHOTS, { recursive: true });

const wanted = new Set(process.argv.slice(2));
const sceneDir = join(here, "scenes");
const files = readdirSync(sceneDir).filter((f) => f.endsWith(".mjs")).sort();

// Serialize across every worktree BEFORE spending anything: chromium, the GPU and the wall clock
// are machine-wide resources, and a playtest that shares them with another playtest measures the
// contention, not the game.
const lock = await acquire("playtest", {
  what: `npm run playtest in ${treeName()}`,
  timeoutMs: Number(process.env.SH_LOCK_TIMEOUT_MS ?? 20 * 60 * 1000),
});

// Borrow this tree's dev server if it is up, else run one for the duration. Either way it serves
// THIS tree — the port belongs to the checkout, so "already up" cannot mean a neighbour.
const server = BASE_OVERRIDE
  ? { base: BASE_OVERRIDE, started: false, stop() {} }
  : await ensureServer({ root: ROOT, port: PORT, log: (m) => console.log(m) }).catch((e) => {
      lock.release();
      throw e;
    });
// A scene that hard-crashes the process must not leak a vite behind it. (The lock releases itself
// the same way — see tools/lock.mjs.)
process.once("exit", () => { if (server.started) server.stop(); });
const BASE = server.base;
console.log(`▸ ${treeName()} playtest → ${BASE}${server.started ? " (ours)" : ""}`);

const browser = await chromium.launch({ executablePath: EXEC, headless: HEADLESS, args });
let failures = 0;
let assertions = 0;
const t0 = Date.now();

for (const f of files) {
  const mod = await import(pathToFileURL(join(sceneDir, f)).href);
  const scene = mod.default;
  if (!scene || wanted.size > 0 && !wanted.has(scene.name)) continue;
  const results = [];
  const sceneErrors = [];
  const page = await browser.newPage({ viewport: { width: 1920, height: 1080 }, deviceScaleFactor: 1 });
  page.on("console", (m) => {
    if (m.type() === "error") sceneErrors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => sceneErrors.push(`pageerror: ${e.message}`));

  const ctx = makeCtx({ page, base: BASE, shotsDir: SHOTS, tag: scene.name, results });

  const t = Date.now();
  try {
    await scene.run(ctx);
  } catch (e) {
    ctx.ok("scene threw", false, String(e));
  }
  for (const e of sceneErrors) ctx.ok("no console/page errors", false, e);
  // A scene's BASE-URL share is its own affair (each scene navigates itself at its own pace).

  const pass = results.filter((r) => r.pass).length;
  const fail = results.filter((r) => !r.pass).length;
  failures += fail;
  assertions += results.length;
  console.log(`\n■ ${scene.name} (${((Date.now() - t) / 1000).toFixed(1)}s) — ${pass} ok · ${fail} failed`);
  for (const r of results) console.log(`  ${r.pass ? "✓" : "✗"} ${r.label}${r.detail ? `  — ${r.detail}` : ""}`);
  await page.close();
}

await browser.close();
if (server.started) server.stop();
lock.release();
console.log(`\n══ PLAYTEST ${failures === 0 ? "GREEN" : "RED"}: ${assertions} assertions, ${failures} failed · ${((Date.now() - t0) / 1000).toFixed(1)}s ══`);
process.exit(failures === 0 ? 0 : 1);
