/**
 * SCENE: audio — the engine unlocks on first gesture, the cues land on UI + sim beats,
 * the health bed reads the network. Asserts via window.__audio probe (headless can't HEAR,
 * but it CAN see the graph alive).
 */
export default {
  name: "audio",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);
    // SD-64 — every gesture in this scene is a REAL click (the autoplay policy needs trusted
    // events), and the cold open swallows the first real pointerdown for ~3.8 s. Wait it out, or
    // the "first gesture" is spent on the intro and the launch pipeline never runs.
    await ctx.bootDone();

    // First gesture (a REAL device-level click, trusted by the autoplay policy) unlocks.
    await ctx.page.mouse.click(960, 540);
    await ctx.settle(500);
    const p0 = await ctx.eval(() => window.__audio?.());
    ctx.ok("the engine unlocked after the first gesture", p0 && p0.ctxState === "running", JSON.stringify(p0));

    // UI click → key_click cue recorded.
    const beforeClicks = await ctx.eval(() => window.__audio?.()?.cuesPlayed ?? 0);
    const padHit = await ctx.realClick("[data-net=pad-toggle]");
    ctx.ok("a HAND can reach the pad toggle", padHit.ok, padHit.reason);
    await ctx.settle(300);
    const p1 = await ctx.eval(() => window.__audio?.());
    ctx.ok("a button click plays a key_click", p1 && p1.cuesPlayed > beforeClicks && p1.lastKinds.includes("key_click"), p1?.lastKinds.join(","));

    // The launch pipeline: commit → liftoff → deploy_pop (the "money + first signal" ears).
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle(120);
    // SD-64/SD-68 — THE COMMIT CONTROLS MUST BE REACHABLE BY A HAND, not just by DOM `.click()`.
    // These assertions caught the pad's commit row sitting BELOW THE PANEL FOLD at 1920×1080 (562 px
    // of scroll viewport against 1043 px of instruments), which put the game's first verb off-screen.
    // SD-68 made the row a non-scrolling footer of the pad, so it is now on screen at every scroll
    // position — and these stay as the standing witness, because every OTHER scene drives the pad
    // with DOM clicks that ignore layout entirely and could never tell you if it regressed.
    const armHit = await ctx.realClick("[data-net=arm]");
    ctx.ok("a HAND can reach ARM", armHit.ok, armHit.reason);
    await ctx.settle(150);
    const launchHit = await ctx.realClick("[data-net=launch]");
    ctx.ok("a HAND can reach LAUNCH", launchHit.ok, launchHit.reason);
    await ctx.settle(150);
    await ctx.wait(20000); // pipeline lands
    const p2 = await ctx.eval(() => window.__audio?.());
    ctx.ok("the commit tone played", p2 && p2.lastKinds.includes("credit_committed"), p2?.lastKinds.join(","));
    ctx.ok("the deploy pop played", p2 && p2.lastKinds.includes("deploy_pop"), p2?.lastKinds.join(","));
    // The health bed learned something once a sat exists.
    ctx.ok("the health bed is alive (hum gain > 0 once committed)", p2 && p2.humGain > 0, `humGain ${p2?.humGain}`);

    // Reverb mix stays "slight" by the house rule.
    ctx.ok("reverb is slight (mix ≤ 0.2)", p2 && p2.reverbMix <= 0.2, `mix ${p2?.reverbMix}`);

    // Sign REGION-0 → the signed cue; gate → the act bell.
    await ctx.eval(async () => {
      const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === "REGION-0");
      if (!b) return;
      const r = b.getBoundingClientRect();
      // synthesize a trusted click through CDP-level mouse on the button's centre
      // (scene-level: the probe assertion is that the app's handler ran — gesture trust for
      // AUDIO comes from the prior real clicks).
      b.dispatchEvent(new MouseEvent("pointerdown", { bubbles: true }));
      b.click();
    });
    await ctx.settle(400);
    const p3 = await ctx.eval(() => window.__audio?.());
    ctx.ok("the signature cue played", p3 && p3.lastKinds.includes("signed_offered"), p3?.lastKinds.join(","));

    for (let i = 0; i < 6; i++) await ctx.key(".");
    // wait for the act-1 gate (serve + earn at fast-clock)
    const t0 = Date.now();
    let won = false;
    while (Date.now() - t0 < 60000) {
      const st = await ctx.eval(() => window.__netState?.());
      if (st && st.cursor >= 1) { won = true; break; }
      await ctx.wait(200);
    }
    const p4 = await ctx.eval(() => window.__audio?.());
    ctx.ok("the act-1 gate bell played", won && p4 && p4.lastKinds.includes("gate_act"), p4?.lastKinds.join(","));
    await ctx.shot("audio-live");
  },
};
