// tools/smoke.mjs — BOOT SMOKE TEST. Loads the app in a headless browser and FAILS
// (exit 1) on any uncaught exception or console error on load.
//
// Why this exists: a circular-import TDZ ("Cannot access 'X' before initialization")
// crashed `npm run dev` at boot while CI stayed green — because CI screenshots the
// PRODUCTION bundle (`vite preview`, which Rollup hoists so the cycle never fires)
// and vitest never boots the app's browser module graph. This gate runs the actual
// DEV server (unbundled native ESM), the one developers run, and catches that whole
// class of dev-only module-init crashes.
//
// Usage: node tools/smoke.mjs <url> [waitMs]
//   e.g. node tools/smoke.mjs http://localhost:5173 5000
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:5173";
const waitMs = Number(process.argv[3] ?? 5000);
const EXEC = process.env.CHROMIUM_BIN ?? "/usr/bin/chromium";
const HEADLESS = process.env.HEADLESS !== "0"; // headless by default (CI / no display)

// Benign noise to ignore (no favicon is declared in index.html).
const IGNORE = [/favicon\.ico/i];
const keep = (s) => !IGNORE.some((re) => re.test(s));

const args = HEADLESS
  ? ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
  : ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-gpu"];

const browser = await chromium.launch({ executablePath: EXEC, headless: HEADLESS, args });
const errors = [];
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 800 } });
  page.on("console", (m) => {
    if (m.type() === "error" && keep(m.text())) errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => {
    if (keep(e.message)) errors.push(`pageerror: ${e.message}`);
  });
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  await page.waitForTimeout(waitMs); // let deferred module-eval / first frames run
} finally {
  await browser.close();
}

if (errors.length) {
  console.error(`SMOKE FAIL — ${url} raised ${errors.length} error(s) on boot:`);
  for (const e of errors) console.error("  " + e);
  process.exit(1);
}
console.log(`SMOKE OK — ${url} booted with no uncaught/console errors`);
