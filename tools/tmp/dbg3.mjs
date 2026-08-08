import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
page.on("console", m => { if (m.text().includes("[NC2]")) console.log("PAGE>", m.text()); });
page.on("pageerror", e => console.log("ERR>", e.message));
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const st = () => page.evaluate(() => window.__netState?.());
const lastWire = () => page.evaluate(() => [...document.querySelectorAll(".log-line .msg")].slice(-3).map(e => e.textContent).join(" || "));
// act 1
await page.evaluate(() => document.querySelector("[data-net=pad-toggle]")?.click());
await page.waitForTimeout(200);
await page.evaluate(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector("[data-net=arm]")?.click());
await page.waitForTimeout(150);
await page.evaluate(() => document.querySelector("[data-net=launch]")?.click());
for (let i = 0; i < 6; i++) await page.keyboard.press(".");
await page.waitForTimeout(2500);
await page.evaluate(() => document.querySelector("[data-net=accept]")?.click());
for (let i = 0; i < 60; i++) { const s = await st(); if (s?.cursor >= 1) break; await page.waitForTimeout(300); }
console.log("cursor:", (await st())?.cursor);
// act 2: sign REGION-1 then C
await page.evaluate(() => { const b = [...document.querySelectorAll("[data-net=accept]")].find(x => x.getAttribute("data-contract") === "REGION-1"); b?.click(); });
await page.waitForTimeout(200);
await page.keyboard.press("c");
await page.waitForTimeout(800);
console.log("sats:", (await st())?.sats.map(s => s.id).join(","), "balance:", (await st())?.balance);
console.log("wire:", await lastWire());
await browser.close();
