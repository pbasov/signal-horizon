/** SCENE: X-03 — the 1-bit purist toggle, asserted on computed styles (the instrument). */
export default {
  name: "mono",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2200);
    const read = () => ctx.eval(() => ({
      mono: document.documentElement.classList.contains("cvd-mono"),
      cyan: getComputedStyle(document.documentElement).getPropertyValue("--cyan").trim(),
      chipBg: (() => { const c = document.querySelector(".cam-btn.active"); return c ? getComputedStyle(c).backgroundColor : null; })(),
      canvasFilter: (() => { const c = document.querySelector(".orrery-host canvas"); return c ? getComputedStyle(c).filter : null; })(),
    }));
    const before = await read();
    ctx.ok("boots in colour mode with colour tokens", before.mono === false && before.cyan.toLowerCase() === "#46d6c9", JSON.stringify(before));
    await ctx.pressKey("m");
    await ctx.settle(400);
    const after = await read();
    ctx.ok("M toggles purist: --cyan becomes machine-white, and the ACTIVE camera chip follows", after.mono === true && after.cyan.toLowerCase() === "#e8e8f0" && after.chipBg === "rgb(232, 232, 240)", JSON.stringify(after));
    ctx.ok("the ORRERY canvas desaturates in purist mode (the signal's bare channel)", typeof after.canvasFilter === "string" && after.canvasFilter.includes("grayscale(1)"), String(after.canvasFilter));
    await ctx.shot("mono-on");
    await ctx.pressKey("m");
    await ctx.settle(300);
    const back = await read();
    ctx.ok("M again restores colour", back.mono === false && back.cyan.toLowerCase() === "#46d6c9", JSON.stringify(back));
    ctx.ok("the canvas filter clears", back.canvasFilter === "none", String(back.canvasFilter));
  },
};
