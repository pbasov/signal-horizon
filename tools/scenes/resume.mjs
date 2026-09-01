/**
 * SCENE: resume — THE REFRESH TEST. The complaint this scene exists to hold shut was
 * "every browser refresh starts from scratch": you fly a satellite, sign a tender, hit F5,
 * and the campaign is gone.
 *
 * So: build real state, RELOAD THE PAGE (no keystroke, no button — the thing a player
 * actually does), and prove the same world came back. Then prove the two deliberate cold
 * starts still work — `?fresh=1` and the NEW RUN verb — because "always resume" with no way
 * out would be its own trap.
 *
 * The build-up mirrors the `vault` scene's launch beat exactly (a known-good path to a
 * deployed GEO + a signed tender); the refresh is what's new here.
 */
export default {
  name: "resume",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);

    // A cold vault is a cold boot: nothing to resume, so the run starts at first light.
    const coldBoot = await ctx.eval(() => window.__netState?.());
    ctx.ok("first boot is COLD (empty vault, nothing to resume)", coldBoot?.sats?.length === 0 && coldBoot?.balance === 75000, `${coldBoot?.sats?.length} sats · €${coldBoot?.balance}`);

    // ── build a real run: a GEO up, REGION-0 signed (the vault scene's path) ───────
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle(150);
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle(100);
    await ctx.click("[data-net=arm]");
    await ctx.settle(150);
    await ctx.click("[data-net=launch]");
    await ctx.settle(200);
    await ctx.wait(22000); // countdown + ascent + deploy at 1×
    await ctx.click("[data-net=accept]");
    await ctx.settle(300);

    const before = await ctx.eval(() => window.__netState?.());
    ctx.ok(
      "a run exists before the refresh (sat up + tender signed)",
      before?.sats?.length >= 1 && before?.tSim > 0,
      `${before?.sats?.length} sats · €${before?.balance} · act ${before?.cursor + 1} · t=${Math.round(before?.tSim)}s`,
    );

    // ── THE REFRESH ───────────────────────────────────────────────────────────────
    // Exactly what a player does. Note what we do NOT do first: no save keystroke. The
    // page-exit checkpoint is supposed to catch this on its own.
    await ctx.page.reload({ waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2500);

    const after = await ctx.eval(() => window.__netState?.());
    ctx.ok(
      "THE FIX — the refresh RESUMED the run instead of restarting it",
      after?.sats?.length === before?.sats?.length && after?.sats?.length >= 1,
      `${before?.sats?.length} sats → ${after?.sats?.length} sats`,
    );
    ctx.ok(
      "the FLEET came back identical (same orbits, not a re-rolled world)",
      JSON.stringify(after?.sats) === JSON.stringify(before?.sats),
      `${JSON.stringify(before?.sats)} → ${JSON.stringify(after?.sats)}`,
    );
    ctx.ok(
      "the wallet came back (not the €75,000 cold-open float)",
      after?.balance !== 75000 && Math.abs((after?.balance ?? 0) - (before?.balance ?? 0)) < 15000,
      `€${before?.balance} → €${after?.balance}`,
    );
    ctx.ok(
      "the signed tender is still signed",
      after?.contracts?.find((c) => c.id === "REGION-0")?.state === before?.contracts?.find((c) => c.id === "REGION-0")?.state,
      after?.contracts?.map((c) => `${c.id}:${c.state}`).join(","),
    );
    ctx.ok("the scenario act survived the refresh", after?.cursor === before?.cursor, `act ${before?.cursor + 1} → ${after?.cursor + 1}`);
    ctx.ok(
      "the mission clock resumed where it stopped (not back at t=0)",
      after?.tSim > 0 && Math.abs(after.tSim - before.tSim) < 60,
      `t=${Math.round(before?.tSim)}s → t=${Math.round(after?.tSim)}s`,
    );
    // The honesty receipt: the restore prints its fold hash on the wire, so a resumed run
    // can never silently claim to be a world it isn't.
    const wire = await ctx.eval(() =>
      [...document.querySelectorAll(".log-line")].map((e) => (e.querySelector(".val")?.textContent ?? "") + "|" + (e.querySelector(".msg")?.textContent ?? "")).join(" :: "),
    );
    ctx.ok("the resume beat carries the fold-hash receipt", /fold [0-9a-f]+/i.test(wire) && /resumed/i.test(wire), wire.slice(0, 160));
    // The boot console must not greet a mid-campaign player as a newcomer.
    await ctx.page.goto(ctx.base, { waitUntil: "domcontentloaded", timeout: 30000 });
    await ctx.settle(700);
    const bootLines = await ctx.eval(() => [...document.querySelectorAll(".boot-line")].map((e) => e.textContent).join(" | "));
    ctx.ok("the boot console announces a RESTORED run", /RUN RESTORED/.test(bootLines), bootLines.slice(0, 160));
    await ctx.settle(2000);
    await ctx.shot("after-refresh");

    // ── deliberate cold start 1: ?fresh=1 ─────────────────────────────────────────
    await ctx.page.goto(`${ctx.base}?fresh=1`, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);
    const fresh = await ctx.eval(() => window.__netState?.());
    ctx.ok("?fresh=1 COLD-BOOTS even with a save in the vault", fresh?.sats?.length === 0 && fresh?.balance === 75000, `${fresh?.sats?.length} sats · €${fresh?.balance}`);
    // ...and it must not overwrite the campaign it declined to load. A scratch session that
    // still autosaved would clobber the saved run with a tick-0 world just for being opened.
    const saved = await ctx.eval(() => {
      const raw = localStorage.getItem("signalhorizon.net.v1.autosave");
      return raw === null ? null : Math.round(JSON.parse(raw).balanceEur);
    });
    ctx.ok("?fresh=1 leaves the saved run INTACT (declines it, never overwrites it)", saved !== null && saved !== 75000, `slot holds €${saved}`);

    // ── deliberate cold start 2: NEW RUN (shift-N) ────────────────────────────────
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);
    const resumedAgain = await ctx.eval(() => window.__netState?.());
    ctx.ok("navigating back with no ?fresh resumes the saved run again", resumedAgain?.sats?.length >= 1, `${resumedAgain?.sats?.length} sats · €${resumedAgain?.balance}`);

    // NEW RUN confirms first (it erases hours of work), then reloads clean. A REAL key press,
    // not a dispatched event: window.confirm blocks the page, so a dialog raised from inside
    // page.evaluate cannot be answered and gets auto-dismissed.
    let dialogText = "";
    ctx.page.once("dialog", (d) => {
      dialogText = d.message();
      d.accept();
    });
    await ctx.pressKey("Shift+N");
    await ctx.settle(3000);
    ctx.ok("NEW RUN asks before erasing, and names what it will erase", /NEW RUN/i.test(dialogText) && /act \d/i.test(dialogText), dialogText.replace(/\n+/g, " ").slice(0, 140));

    const newRun = await ctx.eval(() => window.__netState?.());
    ctx.ok("NEW RUN starts from scratch", newRun?.sats?.length === 0 && newRun?.balance === 75000, `${newRun?.sats?.length} sats · €${newRun?.balance}`);
    ctx.ok("NEW RUN reloaded CLEAN (no ?fresh — so the new campaign still persists)", !ctx.page.url().includes("fresh"), ctx.page.url());
    // The old campaign must be unrecoverable. The new run is a normal session, so it
    // autosaves immediately — every slot the vault still holds must describe THIS run.
    const slots = await ctx.eval(() =>
      ["quick", "autosave", "a", "b"]
        .map((s) => localStorage.getItem(`signalhorizon.net.v1.${s}`))
        .filter((v) => v !== null)
        .map((v) => Math.round(JSON.parse(v).balanceEur)),
    );
    ctx.ok("NEW RUN erased the old campaign (no slot remembers it)", slots.length >= 1 && slots.every((b) => b === 75000), JSON.stringify(slots));
    await ctx.shot("new-run");
  },
};
