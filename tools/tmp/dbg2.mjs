import { chromium } from "playwright-core";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1920, height: 1080 } });
await page.goto("http://localhost:5173", { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const padState = () => page.evaluate(() => {
  const b = document.querySelector("[data-net=pad-toggle]");
  return b?.textContent ?? "?";
});
console.log("boot:", await padState());
await page.keyboard.press("l");
await page.waitForTimeout(400);
console.log("after real L:", await padState());
await browser.close();
