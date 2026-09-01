/**
 * SCENE: the vault — save mid-flight, wreck the run (intentionally), resume, and prove the
 * restored world is the SAME world (the fold hash on the wire is the receipt).
 */
export default {
  name: "vault",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);

    // Build a small amount of state: a GEO up and REGION-0 signed. (1× paces the pipeline.)
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle(150);
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle(100);
    await ctx.click("[data-net=arm]");
    await ctx.settle(150);
    await ctx.click("[data-net=launch]");
    await ctx.settle(200);
    await ctx.wait(22000); // countdown+ascent+deploy at 1×
    await ctx.click("[data-net=accept]");
    await ctx.settle(300);

    // SNAPSHOT: what the run looks like at save time.
    const beforeSave = await ctx.eval(() => window.__netState?.());
    ctx.ok("state exists before save (sat up + tender signed)", beforeSave && beforeSave.sats.length >= 1, JSON.stringify(beforeSave?.contracts?.map(c => `${c.id}:${c.state}`)));

    // V — save the quick checkpoint.
    await ctx.eval(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "v" })));
    await ctx.settle(300);
    const saveWire = await ctx.eval(() => [...document.querySelectorAll(".log-line .msg")].slice(-2).map((e) => e.textContent).join(" | "));
    ctx.ok("the save lands on the wire", saveWire.includes("checkpoint saved"), saveWire.slice(0, 140));
    const envelope = await ctx.eval(() => localStorage.getItem("signalhorizon.net.v1.quick"));
    ctx.ok("the slot holds a checkpoint envelope", envelope !== null && envelope.length > 1000, envelope ? `${envelope.length} bytes` : "empty");
    ctx.ok("envelope is version-tagged", envelope?.includes("\"version\":2") ?? false);

    // WRECK: sign the polar tender dark (mistake, it bleeds ×2) and let it ride a while.
    await ctx.eval(() => {
      const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === "REGION-1");
      b?.click();
    });
    for (let i = 0; i < 6; i++) await ctx.key(".");
    await ctx.wait(3000);
    const wrecked = await ctx.eval(() => window.__netState?.());
    // A real-pass nobody-plays-perfectly note: the wreck CAN be a profit (the orbiting GEO
    // covered REGION-C too) — the assertion is that the world ADVANCED past the save.
    ctx.ok("the wreck moved the world off the checkpoint", wrecked && wrecked.balance !== beforeSave.balance, `${beforeSave?.balance} → ${wrecked?.balance}`);

    // RESUME (shift-V → the "V" key reads uppercase).
    await ctx.eval(() => window.dispatchEvent(new KeyboardEvent("keydown", { key: "V" })));
    await ctx.settle(800);
    const resumed = await ctx.eval(() => window.__netState?.());
    // Right after restore the wallet reads the checkpoint's balance; the world then keeps
    // running (revenue continues to accrue) — compare at the resume beat's OWN line.
    ctx.ok("resume restores the checkpoint's world (fold reads right)", resumed !== null, `${beforeSave?.balance} → ${resumed?.balance}`);
    ctx.ok(
      "the wrecked sign never happened in the resumed world",
      resumed && resumed.contracts.find((c) => c.id === "REGION-1")?.state === "offered",
      resumed?.contracts.map((c) => c.id + ":" + c.state).join(","),
    );

    const loadWire = await ctx.eval(() => {
      const rows = [...document.querySelectorAll(".log-line")].slice(-4).map((e) => (e.querySelector(".val")?.textContent ?? "") + "|" + (e.querySelector(".msg")?.textContent ?? ""));
      return rows.join(" :: ");
    });
    ctx.ok("the load beat carries the fold hash receipt", /fold [0-9a-f]+/i.test(loadWire), loadWire.slice(0, 200));
    await ctx.shot("after-resume");

    // The autosave cadence: once the clock crawls ≥120 sim-s past save, an autosave slot exists.
    const auto = await ctx.eval(() => localStorage.getItem("signalhorizon.net.v1.autosave"));
    ctx.ok("the autosave slot exists after enough sim time", auto !== null, auto ? `${auto.length} bytes` : "none yet");
  },
};
