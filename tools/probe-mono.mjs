import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: process.env.CHROMIUM_BIN ?? "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2200);
const read = async () => page.evaluate(() => {
  const v = getComputedStyle(document.documentElement).getPropertyValue("--cyan");
  const chip = document.querySelector(".cam-btn.active");
  return { cyanVar: v.trim(), chipBg: chip ? getComputedStyle(chip).backgroundColor : null, mono: document.documentElement.classList.contains("cvd-mono") };
});
console.log("before:", JSON.stringify(await read()));
await page.keyboard.press("m");
await page.waitForTimeout(400);
console.log("after:", JSON.stringify(await read()));
await browser.close();
