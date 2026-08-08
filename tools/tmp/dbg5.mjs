import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const st = () => page.evaluate(() => window.__netState?.());
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.waitForTimeout(250);
await page.evaluate(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.evaluate(() => document.querySelector("[data-net=arm]")?.click());
await page.waitForTimeout(250);
await page.evaluate(() => document.querySelector("[data-net=launch]")?.click());
for (let i = 0; i < 6; i++) await page.keyboard.press(".");
await page.waitForTimeout(2000);
await page.evaluate(() => document.querySelector("[data-net=accept]")?.click());
// watch contracts for 60 s
for (let i = 0; i < 40; i++) {
  await page.waitForTimeout(1500);
  const s = await st();
  const rows = (s?.contracts ?? []).map(c => `${c.id}:${c.state}`).join(" ");
  if (rows.includes("+R1")) { console.log(`t+${(i * 1.5).toFixed(0)}s:`, rows); break; }
  if (i % 10 === 9) console.log(`t+${(i * 1.5).toFixed(0)}s:`, rows);
}
await browser.close();
