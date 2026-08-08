import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const st = () => page.evaluate(() => window.__netState?.());
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.waitForTimeout(150);
await page.evaluate(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => document.querySelector("[data-net=arm]")?.click());
await page.waitForTimeout(200);
await page.evaluate(() => document.querySelector("[data-net=launch]")?.click());
// sign EARLY, right after the deploy beat, BEFORE flooring the clock
await page.waitForTimeout(22000);
const earlySig = await page.evaluate(() => { const b = [...document.querySelectorAll("[data-net=accept]")].find(x => x.getAttribute("data-contract") === "REGION-0"); if (!b) return "MISSING"; b.click(); return "clicked"; });
console.log("early sign:", earlySig, "probe:", JSON.stringify(await st()));
for (let i = 0; i < 6; i++) await page.keyboard.press(".");
for (let i = 0; i < 8; i++) {
  await page.waitForTimeout(1200);
  const s = await st();
  const r0 = s?.contracts.find(c => c.id === "REGION-0");
  console.log(`tSim=${s?.tSim.toFixed(0)} cursor=${s?.cursor} R0=${r0?.state}/${r0?.servedFrac} bal=${s?.balance} sats=${s?.sats.length}`);
}
await browser.close();
