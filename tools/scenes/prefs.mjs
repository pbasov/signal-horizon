/** SCENE: prefs persist across reload (mono ON + muted survive a full page reload). */
export default {
  name: "prefs",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2200);
    await ctx.pressKey("m");
    await ctx.pressKey("u");
    await ctx.settle(300);
    const check0 = await ctx.eval(() => ({
      mono: document.documentElement.classList.contains("cvd-mono"),
      muted: window.__audio?.().muted,
      stored: localStorage.getItem("signalhorizon.prefs.v1"),
    }));
    ctx.ok("prefs stage: mono on + muted set, stored to localStorage", check0.mono && check0.muted === true && check0.stored?.includes("\"muted\":true"), JSON.stringify(check0));
    // reload the page — prefs must re-apply before first paint of the mission.
    await ctx.page.reload({ waitUntil: "networkidle" });
    await ctx.settle(2000);
    const after = await ctx.eval(() => ({
      mono: document.documentElement.classList.contains("cvd-mono"),
      muted: window.__audio?.().muted,
    }));
    ctx.ok("prefs survive a full reload", after.mono === true && after.muted === true, JSON.stringify(after));
    // un-disable for clean run state
    await ctx.pressKey("m");
    await ctx.pressKey("u");
    await ctx.settle(200);
    await ctx.shot("prefs-restored-back");
  },
};
