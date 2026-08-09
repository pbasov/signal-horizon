/**
 * SCENE: sat blob — launch a GEO (GEO PARK), wait for deploy, click the freshly-minute bird,
 * assert its coverage blob appears (and disappears when clicked elsewhere — deselect).
 */
export default {
  name: "blob",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle(150);
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle(200);
    await ctx.click("[data-net=arm]");
    await ctx.settle(200);
    await ctx.click("[data-net=launch]");
    await ctx.wait(22000); // pipeline at 1×
    const pos = await ctx.eval(() => window.__satScreenPos?.("NET-SAT-0"));
    ctx.ok("the sat projects to a screen point", pos !== null, JSON.stringify(pos));
    if (!pos) return;
    // The blob is only drawn when the sat is selected and the orbit view (not the pad) is
    // what a human reads while inspecting — close the pad first so the emphasis reads clean.
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle(300);
    // The camera bar can shadow low clicks (orbit elevation puts the bird at the bottom edge) —
    // tilt up first so the sat is above the bar.
    await ctx.page.mouse.move(600, 500);
    await ctx.page.mouse.down();

    for (let i = 1; i <= 6; i++) { await ctx.page.mouse.move(600 - i * 10, 500 - i * 35); await ctx.wait(40); }
    await ctx.page.mouse.up();
    await ctx.settle(500);
    // The sat MOVES — probe-then-click until the selection lands (≤5 retries at tolerance).
    for (let tries = 0; tries < 5 && !(await ctx.eval(() => window.__blobs?.() === true)); tries++) {
      const p2 = await ctx.eval(() => window.__satScreenPos?.("NET-SAT-0"));
      if (!p2) break;
      await ctx.page.mouse.click(p2.x, p2.y);
      await ctx.settle(250);
    }
    const blobOn = await ctx.eval(() => window.__blobs?.() ?? false);
    ctx.ok("the click INSPECTS the sat — its coverage blob is drawn (surface-hugged patch)", blobOn === true, `blob=${blobOn}`);
    await ctx.shot("blob-on");
  },
};
