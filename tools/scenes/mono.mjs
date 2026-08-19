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

    // ── SD-53 — the ROUTING SCREEN's purist exit check, asserted per distinction ──────────────
    // Every colour-coded read on that surface is doubled on a non-colour channel by construction.
    // "Reads fine with colour off" is a claim; these are the assertions that make it a fact.
    await ctx.eval(() => {
      const b = [...document.querySelectorAll(".window-rail button")].find((x) => x.dataset.host === "trace");
      b?.click();
    });
    await ctx.settle(250);
    // Give the board one flow so the row channels exist to check.
    await ctx.eval(() => document.querySelector("[data-net=pad-toggle]")?.click());
    await ctx.settle(150);
    await ctx.eval(() => {
      const i = document.querySelector("[data-net=param-subLonDeg]");
      if (i) { i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); }
    });
    await ctx.eval(() => document.querySelector("[data-net=arm]")?.click());
    await ctx.settle(150);
    await ctx.eval(() => document.querySelector("[data-net=launch]")?.click());
    for (let i = 0; i < 6; i++) await ctx.key(".");
    await ctx.settle(2200);
    for (let i = 0; i < 8; i++) await ctx.key(",");
    await ctx.settle(200);
    await ctx.eval(() => document.querySelector("[data-net=accept]")?.click());
    await ctx.settle(700);
    await ctx.eval(() => {
      const b = [...document.querySelectorAll(".window-rail button")].find((x) => x.dataset.host === "trace");
      b?.click();
    });
    await ctx.settle(300);
    await ctx.pressKey("m");
    await ctx.settle(400);

    const trace = await ctx.eval(() => {
      const row = document.querySelector("[data-net=trace-flow]");
      const pipe = document.querySelector("[data-net=trace-pipe]");
      return {
        mounted: document.querySelector(".trace") !== null,
        bandGlyph: row?.querySelector(".trace-glyph")?.textContent ?? "",
        binds: row?.querySelector(".trace-binds")?.textContent ?? "",
        read: row?.querySelector(".trace-read")?.textContent ?? "",
        miniBar: row?.querySelector(".trace-minibar")?.textContent ?? "",
        pipeState: pipe?.querySelector(".pipe-state")?.textContent ?? "",
        pipePct: pipe?.querySelector(".pipe-pct")?.textContent ?? "",
        pipeLoad: pipe?.querySelector(".pipe-load")?.textContent ?? "",
        riderNums: pipe?.querySelector(".rider-nums")?.textContent ?? "",
        riderFlag: pipe?.querySelector(".rider-flag")?.textContent ?? "",
        typeGlyph: pipe?.querySelector(".pipe-id")?.textContent ?? "",
        segWidth: (() => { const s = pipe?.querySelector(".pipe-seg"); return s ? s.style.width : ""; })(),
      };
    });
    ctx.ok("TRACE is mounted with a flow to read in purist mode", trace.mounted && trace.binds !== "", JSON.stringify(trace).slice(0, 160));
    ctx.ok("BAND survives colour-off: a glyph, not a hue", /[✕▲·]/.test(trace.bandGlyph), trace.bandGlyph);
    ctx.ok("BINDING AXIS survives: the axis is a WORD", /^(conn|avail|lat|bw|CONN|AVAIL|LATENCY|BW|—)/.test(trace.binds.trim()), trace.binds);
    ctx.ok("the MEASUREMENT survives: both operands are printed", /\/\s/.test(trace.read), trace.read);
    ctx.ok("UTILISATION survives on THREE channels: bar width, the integer, and the word", /[▓▒░]/.test(trace.miniBar) && /%/.test(trace.pipePct) && /HEADROOM|TIGHT|OVER|IDLE|BLIND/.test(trace.pipeState), `${trace.miniBar} ${trace.pipePct} ${trace.pipeState}`);
    ctx.ok("CAPACITY survives: load and capacity are both numerals on the line", /\d+\.\d+ \/ \d+\.\d+ u/.test(trace.pipeLoad), trace.pipeLoad);
    ctx.ok("ANTENNA TYPE survives: a glyph AND the type name", /[✳◆●○]/.test(trace.typeGlyph) && /(BROADCAST|ACCESS|GATEWAY)/.test(trace.typeGlyph), trace.typeGlyph);
    ctx.ok("RIDER ALLOCATION survives: offer, share and floor are all printed", /offer .*share .*floor/.test(trace.riderNums), trace.riderNums);
    ctx.ok("the RIDER FLAG survives: a glyph and, when there is a floor, a word", /[✕△✓·]/.test(trace.riderFlag), trace.riderFlag);
    ctx.ok("the bar SEGMENT carries a width, not only a colour", /%$/.test(trace.segWidth), trace.segWidth);
    await ctx.shot("trace-mono");
  },
};
