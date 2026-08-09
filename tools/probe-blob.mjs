import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.evaluate(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector("[data-net=arm]")?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector("[data-net=launch]")?.click());
await page.waitForTimeout(22000); // 1× deploy pipeline
// book again (pad off)
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.waitForTimeout(300);
const pos = await page.evaluate(() => window.__satScreenPos?.("NET-SAT-0"));
console.log("sat screen pos:", pos);
console.log("cands:", await page.evaluate(() => window.__pickCands?.()));
if (pos) { await page.mouse.click(pos.x, pos.y); await page.waitForTimeout(600); }
console.log("selected:", await page.evaluate(() => window.__netState?.() ? "?" : "?"), await page.evaluate(() => (window).__netState ? undefined : undefined));
await page.screenshot({ path: "docs/screenshots/playtest/sat-blob-click.png" });
console.log("blobFlag:", await page.evaluate(() => window.__blobs?.()));
console.log("lastClick:", await page.evaluate(() => window.__lastClickDebug));
console.log("lastPick:", await page.evaluate(() => window.__lastPickDebug));
console.log("selectedId:", await page.evaluate(() => document.querySelector("canvas") && (window).__blobs?.()));
await browser.close();
