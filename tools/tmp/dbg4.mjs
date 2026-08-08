import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const st = () => page.evaluate(() => window.__netState?.());
// act 1
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.waitForTimeout(200);
await page.evaluate(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => document.querySelector("[data-net=arm]")?.click());
await page.evaluate(() => document.querySelector("[data-net=launch]")?.click());
for (let i = 0; i < 6; i++) await page.keyboard.press(".");
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector("[data-net=accept]")?.click());
for (let i = 0; i < 60; i++) { const s = await st(); if (s?.cursor >= 1) break; await page.waitForTimeout(300); }
// constellation + fill
await page.keyboard.press("c");
await page.waitForTimeout(2000);
await page.evaluate(() => [...document.querySelectorAll("[data-net=circularize]")].forEach(f => f.click()));
// fill batch via pad (pad still open from act1? toggled? — check)
await page.evaluate(() => { const t = document.querySelector("[data-net=pad-toggle]"); if (t?.textContent?.includes("BACK")) {} else t?.click(); });
await page.waitForTimeout(200);
await page.evaluate(() => { const i = document.querySelector("[data-net=param-altKm]"); i.value = "150"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => { const i = document.querySelector("[data-net=param-incDeg]"); i.value = "90"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "45"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => { const plus = document.querySelector("[data-net=count-plus]"); for (let i = 0; i < 3; i++) plus?.click(); });
await page.evaluate(() => { const i = document.querySelector("[data-net=param-phaseSpreadDeg]"); i.value = "90"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(300);
await page.evaluate(() => document.querySelector("[data-net=arm]")?.click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector("[data-net=launch]")?.click());
for (let i = 0; i < 80; i++) { const s = await st(); if ((s?.sats.length ?? 0) >= 7) break; await page.waitForTimeout(300); }
console.log("fleet:", (await st())?.sats.map(x => x.id + "@" + x.aKm + "km").join(" "));
// sign REGION-1
await page.evaluate(() => { const b = [...document.querySelectorAll("[data-net=accept]")].find(x => x.getAttribute("data-contract") === "REGION-1"); b?.click(); });
for (let i = 0; i < 40; i++) {
  const s = await st();
  const c1 = s?.contracts.find(c => c.id === "REGION-1");
  if (i % 5 === 0) console.log(`avail=${c1?.avail?.toFixed?.(2)} frac=${c1?.servedFrac?.toFixed?.(2)} state=${c1?.state} cursor=${s?.cursor}`);
  if (s?.cursor >= 2) { console.log("GATE-2!"); break; }
  await page.waitForTimeout(400);
}
await browser.close();
