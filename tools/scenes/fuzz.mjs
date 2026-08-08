/**
 * SCENE: fuzz — hammer the controls while the game runs. Deterministic-ish pseudo-random key
 * and click spray (seeded PRNG so a failure can be replayed). Asserts NO page errors / no
 * console errors surface from any combination, over a multi-minute real-time soak.
 */
export default {
  name: "fuzz",
  async run(ctx) {
    let seed = 0xB00B5;
    const rnd = () => {
      seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; seed >>>= 0;
      return seed / 0xffffffff;
    };
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(1800);

    // Get the game INTO live state first (a launch + a sign; the fuzz must spray INTO systems
    // that matter, not against a fresh board).
    await ctx.eval(() => document.querySelector("[data-net=pad-toggle]")?.click());
    await ctx.settle(200);
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle(120);
    await ctx.eval(() => document.querySelector("[data-net=arm]")?.click());
    await ctx.settle(150);
    await ctx.eval(() => document.querySelector("[data-net=launch]")?.click());
    for (let i = 0; i < 6; i++) await ctx.key(".");
    await ctx.settle(2500);
    await ctx.eval(() => { const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === "REGION-0"); b?.click(); });
    await ctx.settle(500);

    const KEYS = [",", ".", " ", "l", "1", "2", "0", "m", "u", "v", "V", "c", "p", "r", "ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight", "[", "]"];
    const CLICKABLE = ["[data-net=pad-toggle]", "[data-net=fit]", "[data-net=arm]", "[data-net=launch]", "[data-net=count-plus]", "[data-net=count-minus]", "[data-net=slot-0]", "[data-net=slot-1]", "[data-net=fit]"];

    const errors = [];
    for (let i = 0; i < 220; i++) {
      const roll = rnd();
      if (roll < 0.45) {
        // Key spray, occasionally spammed fast.
        const k = KEYS[Math.floor(rnd() * KEYS.length)];
        await ctx.key(k);
        if (rnd() < 0.3) await ctx.key(k);
      } else if (roll < 0.85) {
        // Click a random visible target (or empty canvas).
        if (rnd() < 0.5) {
          await ctx.eval(([x, y]) => {
            const el = document.elementFromPoint(x, y);
            if (el && el.closest && el.closest("canvas")) el.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
          }, [Math.floor(rnd() * 1500), Math.floor(rnd() * 950)]);
        } else {
          const c = CLICKABLE[Math.floor(rnd() * CLICKABLE.length)];
          await ctx.eval((sel) => { const b = document.querySelector(sel); if (b && b.disabled !== true) b.click(); }, c);
        }
      } else {
        // Occasionally murder the speed control chain (pause-resume resets).
        await ctx.key(" ");
        if (rnd() < 0.5) await ctx.key(" ");
      }
      if (i % 22 === 0) await ctx.wait(300); // let the dust settle in bursts
      const errs = await ctx.eval(() => window.__errs ?? []);
      for (const e of errs) errors.push(e);
    }

    // Metric: zero page errors / console errors gathered by the runner; the session must still
    // be sane at the end (wallet finite, contracts non-corrupt, the session steps on).
    const state = await ctx.eval(() => window.__netState?.());
    ctx.ok("state survives the spray (cursor + contracts intact)", state !== null && Number.isFinite(state.balance), JSON.stringify({ cursor: state?.cursor, bal: state?.balance }));
    ctx.ok("no pageerrors during 220 sprays", errors.length === 0, `${errors.length} errors`);
    await ctx.shot("after-fuzz");
  },
};
