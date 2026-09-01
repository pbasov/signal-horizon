import { chromium } from "playwright-core";
import { devBase } from "./workspace.mjs";
const browser = await chromium.launch({ executablePath: "/usr/bin/chromium", headless: true, args: ["--no-sandbox","--enable-unsafe-swiftshader","--use-gl=angle","--use-angle=swiftshader"] });
const page = await browser.newPage({ viewport: { width: 1600, height: 980 } });
await page.goto(devBase(), { waitUntil: "networkidle" });
await page.waitForTimeout(2000);
const out = await page.evaluate(() => {
  const q = (sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    const cs = getComputedStyle(el);
    return { bg: cs.backgroundColor, img: cs.backgroundImage?.slice(0, 110), bgc: cs.getPropertyValue("background"), color: cs.color };
  };
  return { missionTop: q(".mission-top"), telem: q(".telem"), group: q(".telem .group"), panelBody: q(".panel-body"), panel: q(".panel"), body: q("body"), app: q("#app"), root: getComputedStyle(document.documentElement).getPropertyValue("--bg") };
});
console.log(JSON.stringify(out, null, 1));
await browser.close();
