/**
 * SCENE: perf profile — the mature network at 1000×, reading __perf's rings.
 * Asserts the frame budget holds under load AND prints the section medians so the
 * engineer reads where time goes.
 */
export default {
  name: "perf",
  async run(ctx) {
    // The worst case today: the seeded multi-sat world + full speed.
    await ctx.page.goto(ctx.base + "?netact=3", { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2500);
    // Full accel for a while to accumulate state depth.
    for (let i = 0; i < 6; i++) await ctx.key(".");
    await ctx.wait(4000);
    // Reset rings for a clean measurement window.
    await ctx.eval(() => { window.__perfReset?.(); });
    // Fall back if the reset isn't wired: just measure now.
    await ctx.wait(2500);
    const back = await ctx.eval(() => window.__perf?.());
    ctx.ok("the profiler is live", !!back && back.frames > 0, JSON.stringify(back?.sections));
    if (back) {
      console.log(`\n  ── perf profile (mature net @1000×, ${back.frames} frames over the window) ──`);
      console.log(`    frame p50 ${back.frameMsP50.toFixed(2)}ms  p95 ${back.frameMsP95.toFixed(2)}ms`);
      for (const [k, v] of Object.entries(back.sections)) {
        console.log(`    ${k.padEnd(10)} p50 ${v.p50.toFixed(2)}ms  p95 ${v.p95.toFixed(2)}ms`);
      }
      // The budget: this is a 60 fps desktop game; the frame must hold 16.6 ms at p95 under load.
      ctx.ok("frame p95 under 16.6ms under load (60fps holds)", back.frameMsP95 < 16.6, `p95 ${back.frameMsP95.toFixed(2)}ms`);
      // and the hot path is the sim, not an accident of rendering.
      const top = Object.entries(back.sections).sort((a, b) => b[1].p95 - a[1].p95)[0];
      console.log(`    hottest section: ${top[0]} (p95 ${top[1].p95.toFixed(2)}ms)`);
    }
  },
};
