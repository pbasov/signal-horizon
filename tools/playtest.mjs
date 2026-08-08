/**
 * THE PLAYTEST LOOP (R3 tooling upgrade). A headless, scripted, ASSERTIVE playthrough
 * of the FIRST LIGHT hour — the machine side of the M1 gate. Scenes are code (expressive,
 * diffable); the runner is dumb: launch chromium (same channel as tools/shoot.mjs), run
 * each scene in order, collect fail/pass, drop screenshots.
 *
 * Usage: node tools/playtest.mjs [sceneName ...]   (default: all scenes, in dependency order)
 * Env:   HEADLESS=1 — SwiftShader CI path (no display). BASE=<url> (default localhost:5173).
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
import { mkdirSync, readdirSync } from "node:fs";
import { basename, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = fileURLToPath(new URL(".", import.meta.url));
const ROOT = join(here, "..");
const BASE = process.env.BASE ?? "http://localhost:5173";
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

  const ctx = {
    page,
    base: BASE,
    results,
    ok(label, cond, detail = "") {
      results.push({ label, pass: !!cond, detail: String(detail) });
    },
    async shot(tag) {
      const out = join(SHOTS, `${scene.name}-${tag}.png`);
      await page.screenshot({ path: out });
      return out;
    },
    eval: (fn, ...evalArgs) => page.evaluate(fn, ...evalArgs),
    key: (k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k),
    async click(sel) {
      const found = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.click();
        return true;
      }, sel);
      return found;
    },
    async clickText(text) {
      return page.evaluate((t) => {
        const b = [...document.querySelectorAll("button, .tab")].find((x) => (x.textContent ?? "").includes(t));
        if (!b) return false;
        b.click();
        return true;
      }, text);
    },
    setParam(name, v) {
      return page.evaluate(
        ([n, val]) => {
          const inp = document.querySelector(`[data-net=param-${n}]`);
          if (!inp) return false;
          inp.value = String(val);
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        [name, v],
      );
    },
    wait: (ms) => page.waitForTimeout(ms),
    settle: (ms = 350) => page.waitForTimeout(ms),
    probe: (name, ...args) => page.evaluate(([n, a]) => window[`__${n}`]?.(...a), [name, args]),
  };

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
console.log(`\n══ PLAYTEST ${failures === 0 ? "GREEN" : "RED"}: ${assertions} assertions, ${failures} failed · ${((Date.now() - t0) / 1000).toFixed(1)}s ══`);
process.exit(failures === 0 ? 0 : 1);
