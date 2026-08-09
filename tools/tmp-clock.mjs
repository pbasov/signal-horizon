import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2500);
const r0 = await page.evaluate(() => window.__netState?.()?.tSim);
await page.keyboard.press(".");
await page.waitForTimeout(3000);
const r1 = await page.evaluate(() => window.__netState?.()?.tSim);
console.log("tSim:", r0, "→", r1, "(", (r1-r0).toFixed(1), "sim-s in 3 s real )");
// key handler "1"/"2" check too:
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.evaluate(() => { const i = document.querySelector("[data-net=param-altKm]"); i?.focus(); });
await page.keyboard.press("2");
await page.waitForTimeout(300);
console.log("strip after typing 2 into a field:", await page.evaluate(() => document.querySelector(".statusstrip")?.textContent?.slice(0, 24)));
await browser.close();
