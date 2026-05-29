// Screenshot / drive helper — launches the user's ungoogled-chromium via
// playwright-core (no bundled-browser download) and captures the prototype.
// Usage: node tools/shoot.mjs <url> <out.png> [waitMs] [keys csv] [width height]
//   keys: comma-separated keypresses dispatched to the page before the shot,
//         e.g. "2,o" to switch to OPS preset then the ORBITS camera.
import { chromium } from "playwright-core";

const url = process.argv[2] ?? "http://localhost:5173";
const out = process.argv[3] ?? "shot.png";
const waitMs = Number(process.argv[4] ?? 2500);
const keys = (process.argv[5] ?? "").split(",").filter(Boolean);
const width = Number(process.argv[6] ?? 1600);
const height = Number(process.argv[7] ?? 980);

const EXEC = process.env.CHROMIUM_BIN ?? "/usr/bin/chromium";
// Headful by default so the orrery renders on the real GPU (set HEADLESS=1 to
// force the software-SwiftShader headless path for CI / no-display contexts).
const HEADLESS = process.env.HEADLESS === "1";
const args = HEADLESS
  ? ["--no-sandbox", "--enable-unsafe-swiftshader", "--use-gl=angle", "--use-angle=swiftshader"]
  : ["--no-sandbox", "--ignore-gpu-blocklist", "--enable-gpu"];
if (!process.env.DISPLAY && process.env.WAYLAND_DISPLAY) args.push("--ozone-platform-hint=auto");

const browser = await chromium.launch({ executablePath: EXEC, headless: HEADLESS, args });
try {
  const page = await browser.newPage({ viewport: { width, height }, deviceScaleFactor: 1 });
  const errors = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(`console.error: ${m.text()}`);
  });
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  await page.goto(url, { waitUntil: "networkidle", timeout: 30000 });
  for (const k of keys) {
    // Dispatch the window keydown directly — the app's global handler listens on
    // window, so this is independent of which element has focus.
    await page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k.trim());
    await page.waitForTimeout(1000);
  }
  await page.waitForTimeout(waitMs);
  await page.screenshot({ path: out });
  console.log(`shot → ${out}  (${width}x${height}, exec=${EXEC})`);
  if (errors.length) {
    console.log(`PAGE ERRORS (${errors.length}):`);
    for (const e of errors.slice(0, 40)) console.log("  " + e);
  } else {
    console.log("no page errors");
  }
} finally {
  await browser.close();
}
