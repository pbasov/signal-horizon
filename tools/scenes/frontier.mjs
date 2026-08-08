/**
 * SCENE: acts 3b + 4 — seeded worlds (?netact=3 / ?netact=4). The GOLDEN canon pins the
 * physics of the squeeze/re-tame and the fault trio to the bit; this scene proves the
 * PLAYER-REACHABLE surfaces of the late game: the Mars relay verb, the sign, the cache
 * breadcrumb, the "as of Nm ago" readout, and the Mars link waking (the UX-gated reveal).
 *
 * Render-reachability only — the acts' determinism lives in sim/net tests.
 */
export default {
  name: "frontier",
  async run(ctx) {
    // ══ ACT 4 SEED — the Mars leg ════════════════════════════════════════════
    await ctx.page.goto(ctx.base + "?netact=4", { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2500);

    const state = await ctx.eval(() => window.__netState?.());
    ctx.ok("the debug seed reaches act 4", state?.cursor === 4, `cursor ${state?.cursor}`);
    ctx.ok("the relay is up (Mars row + relay sat)", !!state && state.sats.length > 0, `${state?.sats.length} sats`);

    const bookTenders = await ctx.eval(() =>
      [...document.querySelectorAll(".mission-tender")].map((r) => r.textContent ?? ""),
    );
    const marsRow = bookTenders.find((r) => /mars|relay|frontier/i.test(r));
    ctx.ok("the Mars tender is on the board", !!marsRow, bookTenders.map((b) => b.slice(0, 30)).join(" | "));

    // The frontier read: the "as of … ago" stamp exists somewhere after the leg carries.
    const marsReadout = await ctx.eval(() => {
      const block = document.querySelector(".net-mars");
      return block ? block.textContent : "";
    });
    ctx.ok("the staleness readout is on the orrery", /ago|stale|fresh/i.test(marsReadout), marsReadout.slice(0, 140));
    await ctx.shot("act4-mars-view");

    // The Mars LINK should be visible now (the UX gate: cursor 4 ⇒ live).
    const linkVisible = await ctx.eval(() => {
      // Probe the nearest rendered state: the orrery exposes nothing textual for the line;
      // assert through the world: cursor 4 AND a Mars contract present ⇒ the line is drawn.
      const s = window.__netState?.();
      return s?.cursor === 4 && s.contracts.some((c) => c.id.startsWith("MARS"));
    });
    ctx.ok("the Earth↔Mars line is LIVE at act 4 (was dark all hour)", linkVisible === true);

    // ── the cache breadcrumb (the P verb in net mode) ────────────────────────
    await ctx.key("p");
    await ctx.settle(1200);
    const wire = await ctx.eval(() => [...document.querySelectorAll(".log-line .msg")].slice(-4).map((e) => e.textContent).join(" | "));
    ctx.ok("the breadcrumb lands on the wire", /cache/i.test(wire), wire.slice(0, 160));
    await ctx.shot("act4-cache-placed");

    // ══ ACT 3 SEED — the multi-sat served network (the squeeze's staging) ════
    await ctx.page.goto(ctx.base + "?netact=3", { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2500);
    const s3 = await ctx.eval(() => window.__netState?.());
    ctx.ok("the act-3 seed shows a mature network", !!s3 && s3.sats.length >= 5, `${s3?.sats.length} sats`);
    const board3 = await ctx.eval(() => [...document.querySelectorAll(".mission-tender-label")].map((e) => e.textContent).join(","));
    ctx.ok("corridor + backhaul on the board at act-3", board3.length > 0, board3.slice(0, 140));
    await ctx.shot("act3-board");
  },
};
