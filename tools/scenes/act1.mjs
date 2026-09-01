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
    // SD-64 — the cold open is a full-window overlay for ~3.8 s and it EATS the first real
    // pointerdown. The ring drag below is this scene's only real-mouse gesture, so without this the
    // drag was spent skipping the intro and never reached the orrery at all.
    ctx.ok("the cold open finished before the first real gesture", await ctx.bootDone(), "boot-seq gone");

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
    // `chip.includes || chip1.includes("serving NOW")` used to stand here. The left operand is an
    // UNCALLED function reference — always truthy — so the assertion could not fail and the typed
    // aim was never actually proven (SD-64).
    ctx.ok("aimed draft reports serving NOW", chip1.includes("serving NOW"), chip1);

    // ring-grab: find the ring on screen, drag up, watch the altitude move.
    //
    // TWO THINGS WENT WRONG HERE AND HID EACH OTHER (SD-64).
    //  1. The assertion read `Number(altAfter) < Number(altBefore) === false` — `<` binds tighter
    //     than `===`, so it asserted "altAfter is NOT LESS than altBefore", which is TRUE when they
    //     are EQUAL. It passed while reporting `534.7 → 534.7`: the gesture did nothing at all.
    //  2. The grab accepted the handler's BARE tolerance (26 px, PICK_TOLERANCE_PX). The scan is
    //     slow — it projects the whole ring geometry per sample, ~12k samples — and the draft ring
    //     SWEEPS across the screen as the body turns. A point found at the edge of tolerance during
    //     the scan can be outside it by the time the press lands, and the orrery then reads the drag
    //     as a CAMERA ORBIT instead. Silently: no error, no altitude change.
    // The verb itself is sound — verified by hand at 534.7 → 659.9 km, headful AND headless. So the
    // scan keeps its best point unconditionally, the distance is RE-MEASURED at press time, and a
    // comfortable margin is required, so a near-miss fails loudly instead of testing nothing.
    const RING_GRAB_MARGIN_PX = 8;
    const probe = await ctx.eval(() => {
      const p = window.__dragOrbitProbe;
      if (typeof p !== "function") return null;
      const best = { x: 0, y: 0, d: Infinity };
      for (let x = 100; x < 1500; x += 10)
        for (let y = 100; y < 950; y += 10) {
          const r = p(x, y);
          if (r && r.distPx < best.d) { best.x = x; best.y = y; best.d = r.distPx; }
        }
      return Number.isFinite(best.d) ? best : null;
    });
    ctx.ok("found a grabbable point on the draft ring", probe !== null, probe ? `(${probe.x},${probe.y}) d=${probe.d.toFixed(1)}px` : "none");
    // The ring must still be under that point when the press lands, or the drag is a camera orbit.
    const grabDist = probe === null ? null : await ctx.eval((pt) => window.__dragOrbitProbe(pt.x, pt.y)?.distPx ?? null, probe);
    // `__dragOrbitProbe` is pure projection maths: it has no idea whether anything is ON TOP of that
    // pixel, so it reported a 0.2 px "hit" through the boot overlay all along. A press only reaches
    // the orrery if the canvas is the top element there — assert it, and the next overlay that eats
    // a gesture says so instead of reading as a passing drag.
    const onCanvas = probe === null ? false : await ctx.eval((pt) => {
      const c = document.querySelector("canvas");
      return document.elementFromPoint(pt.x, pt.y) === c;
    }, probe);
    ctx.ok("the grab point is the orrery canvas, not an overlay", onCanvas, onCanvas ? "canvas" : "covered by something else");
    const grabbable = onCanvas && grabDist !== null && grabDist <= RING_GRAB_MARGIN_PX;
    ctx.ok("the ring is still under the grab point when the press lands", grabbable, `${grabDist === null ? "no ring" : grabDist.toFixed(1) + "px"} (need ≤ ${RING_GRAB_MARGIN_PX})`);
    const altBefore = await ctx.eval(() => document.querySelector("[data-net=param-altKm]")?.value);
    if (grabbable) {
      await ctx.page.mouse.move(probe.x, probe.y);
      await ctx.page.mouse.down();
      for (let i = 1; i <= 8; i++) await ctx.page.mouse.move(probe.x, probe.y - i * 12);
      await ctx.page.mouse.up();
      await ctx.settle();
      const altAfter = await ctx.eval(() => document.querySelector("[data-net=param-altKm]")?.value);
      // STRICTLY higher. The drag saturates at the preset's altitude ceiling (~660 km from this
      // start), which is fine — the claim is that pulling up RAISES the orbit, not by how much.
      ctx.ok("ring drag RAISED the orbit", Number(altAfter) > Number(altBefore), `${altBefore} → ${altAfter}`);
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
      wire: [...document.querySelectorAll(".log-line .msg")].slice(-14).map((e) => e.textContent ?? ""),
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
    // SD-60 / B1 FIRST LIGHT — the one beat guaranteed to fire. The licence stops being a
    // premise and becomes a record, in the Registry's own flat voice.
    ctx.ok(
      "the REGISTRY records first service (B1)",
      state.wire.some((w) => w.includes("FIRST SERVICE RECORDED")),
      state.wire.filter((w) => w.includes("LICENCE")).join(" | "),
    );
    // SD-60 — the tender names WHO is buying and WHY: the primary narrative channel.
    const cast = await ctx.eval(() => {
      const row = document.querySelector(".mission-tender");
      return {
        head: row ? (row.querySelector(".mission-tender-label")?.textContent ?? "") : "",
        reason: row ? (row.querySelector(".mission-tender-reason")?.textContent ?? "") : "",
      };
    });
    ctx.ok(
      "the tender carries its client and reason line",
      cast.head.length > 0 && cast.reason.length > 0,
      cast.head + " // " + cast.reason,
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
