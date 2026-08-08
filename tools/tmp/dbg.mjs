import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
const evalx = (fn) => page.evaluate(fn);
await page.waitForTimeout(2000);
// act-1 quick
await evalx(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.waitForTimeout(300);
await evalx(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(200);
await evalx(() => document.querySelector("[data-net=arm]")?.click());
await page.waitForTimeout(200);
await evalx(() => document.querySelector("[data-net=launch]")?.click());
for (let i = 0; i < 6; i++) await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: ".", bubbles: true })));
await page.waitForTimeout(2500);
await evalx(() => document.querySelector("[data-net=accept]")?.click());
await evalx(() => { const b = [...document.querySelectorAll("[data-net=accept]")].find(x => x.getAttribute("data-contract") === "REGION-1"); b?.click(); });
for (let i = 0; i < 100; i++) { const s = await evalx(() => window.__netState?.()); if (s?.cursor >= 1) break; await page.waitForTimeout(300); }
console.log("cursor:", (await evalx(() => window.__netState?.()))?.cursor, JSON.stringify((await evalx(() => window.__netState?.()))?.contracts));
// now press C
const before = (await evalx(() => window.__netState?.()))?.sats.length;
const dbgPad = async () => await evalx(() => document.querySelector("[data-net=arm]") ? "pad-open" : "pad-closed");
console.log("pad before L:", await dbgPad());
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "l" })));
await page.waitForTimeout(300);
console.log("pad after L:", await dbgPad());
await page.evaluate(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "c", bubbles: true })));
await page.waitForTimeout(1000);
const after = await evalx(() => window.__netState?.());
console.log("sats before/after C:", before, after?.sats.length, "wire:", await evalx(() => [...document.querySelectorAll(".log-line .msg")].slice(-3).map(e => e.textContent)));
await browser.close();
