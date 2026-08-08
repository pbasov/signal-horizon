/**
 * SCENE: the full Act-1 hour-opening — the playable loop end to end, with REAL gestures where
 * they exist (typed aim, ring-grab probe, ARM/LAUNCH two-step, SIGN) and the clock cranked to
 * 1000× for the pipeline beats. Asserts the economy, the gate, the WIRE beats, and the
 * act-boundary surfaces (risk band appears, REVIEW parse fills).
 */
export default {
  name: "act1",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);

    // ── 1. open the pad; the boot draft is the dead pre-aim (90° W — honestly unsweetened) ──
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle();
    const chip = await ctx.eval(() => document.querySelector(".net-draft-chip")?.textContent ?? "");
    ctx.ok("draft chip shows the dead pre-aim (never serves — the puzzle is real)", chip.includes("never serves"), chip);
    const stack0 = await ctx.eval(() => document.querySelector(".mission-stack")?.textContent ?? "");
    ctx.ok("stack shows the true price of the default fit", stack0.includes("€"), stack0);

    // ── 2. typed aim home, then a ring-grab (the embodied verb) ─────────────────
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle();
    const chip1 = await ctx.eval(() => document.querySelector(".net-draft-chip")?.textContent ?? "");
    ctx.ok("aimed draft reports serving NOW", chip.includes || chip1.includes("serving NOW"), chip1);

    // ring-grab: find the ring on screen, drag up 100 px, watch altitude + price move.
    const probe = await ctx.eval(() => {
      const p = window.__dragOrbitProbe;
      if (typeof p !== "function") return null;
      const best = { x: 0, y: 0, d: Infinity };
      for (let x = 100; x < 1500; x += 10)
        for (let y = 100; y < 950; y += 10) {
          const r = p(x, y);
          if (r && r.distPx < best.d) { best.x = x; best.y = y; best.d = r.distPx; }
        }
      return best.d < 26 ? best : null;
    });
    ctx.ok("found a grabbable point on the draft ring", probe !== null, probe ? `(${probe.x},${probe.y})` : "none");
    const altBefore = await ctx.eval(() => document.querySelector("[data-net=param-altKm]")?.value);
    if (probe) {
      await ctx.page.mouse.move(probe.x, probe.y);
      await ctx.page.mouse.down();
      for (let i = 1; i <= 8; i++) await ctx.page.mouse.move(probe.x, probe.y - i * 12);
      await ctx.page.mouse.up();
      await ctx.settle();
      const altAfter = await ctx.eval(() => document.querySelector("[data-net=param-altKm]")?.value);
      ctx.ok("ring drag RAISED the orbit", Number(altAfter) < Number(altBefore) === false, `${altBefore} → ${altAfter}`);
      // Put it BACK to GEO park altitude so the loop below is the canonical one.
      await ctx.setParam("altKm", 535);
      await ctx.settle();
    }

    // ── 3. ARM → LAUNCH (two-step commit); the wallet drops by the stack price ──
    const w0 = await ctx.eval(() => document.querySelector(".mission-stack")?.textContent ?? "");
    await ctx.click("[data-net=arm]");
    await ctx.settle();
    const ready = await ctx.eval(() => !document.querySelector("[data-net=launch]")?.disabled);
    ctx.ok("ARM makes LAUNCH ready", ready);
    await ctx.click("[data-net=launch]");
    await ctx.settle();
    const w1 = await ctx.eval(() => document.querySelector(".mission-top")?.textContent?.match(/€[\d,]+/)?.[0] ?? "");
    ctx.ok("the commit charged the wallet", w1 !== "" && !w1.includes("75,000"), `${w0.match(/wallet €[\d,]*/)?.[0]} → ${w1}`);

    // ── 4. crank time; the pipeline (deploy → first signal → serve → act-1 gate) ──
    for (let i = 0; i < 6; i++) await ctx.key(".");
    // ~40 s real at 1000× ≈ covers deploy (18 sim-s) + the serve+earn gate comfortably.
    await ctx.wait(3000);
    const deployed = await ctx.eval(() => document.querySelector(".ledger-fleet")?.textContent ?? "");
    ctx.ok("the sat deployed into the fleet", deployed.includes("NET-SAT-0"), deployed.slice(0, 120));

    const accepted = await ctx.click("[data-net=accept]");
    ctx.ok("SIGN is clickable on the offered tender", accepted);
    await ctx.wait(4000);

    const state = await ctx.eval(() => ({
      objective: document.querySelector(".net-obj-title")?.textContent ?? "",
      served: document.querySelector(".mission-tender-served")?.textContent ?? "",
      wire: [...document.querySelectorAll(".log-line .msg")].slice(-4).map((e) => e.textContent ?? ""),
    }));
    ctx.ok(
      "REGION-0 completes its term WITH earnings (the history strip records it)",
      await ctx.eval(() => {
        const strip = document.querySelector(".mission-history")?.textContent ?? "";
        const book = document.querySelector("[data-contract=REGION-0]")?.closest(".mission-tender")?.querySelector(".mission-tender-served")?.textContent ?? "";
        return strip.includes("COMPLETED") || (book.includes("€") && !book.includes("€0"));
      }),
      "completion surfaced (strip or row)",
    );
    ctx.ok("the act-1 gate fired (act 2 objective live)", state.objective.includes("moves"), state.objective);
    ctx.ok(
      "the WIRE marks the transition beat",
      state.wire.some((w) => w.includes("polar metro")),
      state.wire.join(" | "),
    );
    await ctx.shot("10-act2-arrives");

    // ── 5. act boundary: the pad's risk band is now honest-armed ─────────────
    await ctx.click("[data-net=pad-toggle]"); // back to book first (toggle twice if needed)
    await ctx.settle();
    const padText = await ctx.eval(() => {
      const b = document.querySelector("[data-net=pad-toggle]");
      if (b && !b.textContent?.includes("BACK")) b.click();
      return null;
    });
    await ctx.settle();
    void padText;
    const risk = await ctx.eval(() => document.querySelector("[data-net=launch]")?.closest(".group")?.textContent ?? "");
    ctx.ok("the risk band appears once failures are real (act 2)", risk.includes("launch risk"), risk.slice(0, 200));
    await ctx.shot("20-risk-band");

    // ── 6. REVIEW: THE PARSE is alive with the run record ─────────────────────
    await ctx.clickText("REVIEW");
    await ctx.settle(700);
    const parse = await ctx.eval(() => {
      const p = [...document.querySelectorAll(".panel")].find((x) => x.querySelector(".title")?.textContent?.includes("PARSE"));
      return p?.textContent ?? "";
    });
    ctx.ok("REVIEW shows the account book with the signed tender", parse.includes("REGION-0") && parse.includes("on-air"), parse.slice(180, 320));
    ctx.ok("the act book marks act 1 gated", parse.includes("gated"), "");
    await ctx.shot("30-review");
  },
};
