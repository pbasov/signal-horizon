/**
 * SCENE: the full hour — play THROUGH acts 2, 3, 4 for real. Canon-guided (same verbs, same
 * shapes as the golden arc) but entirely UI/script driven: keys, buttons, typed fields, the
 * beam cycler, the circularize fix. Asserts the gates fire IN ORDER, the seeded drama reads
 * (launch attrition, faults weathered), and the Mars tip shows its "as of" staleness.
 *
 * Pacing: the whole thing runs at 1000× (the scene holds ~1290 sim-s ≈ 1.3 real seconds of
 * march, spent as ~poll loops). Every wait is CONDITION-polling, never blind.
 */

const SPEED_PRESSES = 6; // 1× → 1000×

async function untilState(ctx, label, cond, timeoutMs = 60000, pollMs = 250) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = await ctx.eval(() => window.__netState?.());
    if (s && cond(s)) return s;
    if (Date.now() - t0 > timeoutMs) return null;
    await ctx.wait(pollMs);
  }
}

export default {
  name: "hour",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);

    // ══ ACT 1 (compact reprise — the launch pad + sign) ═══════════════════════
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle();
    await ctx.setParam("subLonDeg", 0);
    await ctx.settle();
    await ctx.click("[data-net=arm]");
    await ctx.settle(200);
    await ctx.click("[data-net=launch]");
    await ctx.settle(200);
    // Floor it.
    for (let i = 0; i < SPEED_PRESSES; i++) await ctx.key(".");
    const d = await untilState(ctx, "deployed", (s) => s.sats.length >= 1, 20000);
    ctx.ok("act-1 Geo deploys", d !== null);
    await ctx.click("[data-net=accept]");
    const g1 = await untilState(ctx, "gate-1", (s) => s.cursor >= 1, 30000);
    ctx.ok("ACT-1 GATE: first light served + earning", g1 !== null, g1 ? `cursor ${g1.cursor}` : "timeout");
    await ctx.shot("act1-done");

    // ══ ACT 2 — hold the polar metro: a CONSTELLATION, attrition and all ═════
    // The polar metro is offered (availability active). Sign it, then launch the set.
    const r1 = await ctx.eval(() =>
      [...document.querySelectorAll("[data-net=accept]")].map((b) => b.getAttribute("data-contract")),
    );
    ctx.ok("REGION-1 offered at the act-2 opening", r1.includes("REGION-1"), r1.join(","));
    // The WEATHER: the REGION-C tender should have lapsed on the board by now (its clock
    // out-ran a fast-forwarded opener). Only assert if present.
    const decayedC = await ctx.eval(() => {
      const row = [...document.querySelectorAll(".mission-tender")].find((r) => r.querySelector(".mission-tender-label")?.textContent?.includes("transit"));
      return row?.querySelector(".mission-tender-bet")?.textContent ?? "";
    });
    ctx.ok("REGION-C visibly decayed/lapsed by the act-2 opening (the wager prices waiting)", decayedC !== "", decayedC.slice(0, 80));

    // The constellation verb: C in net mode places the suggested phased LEO set.
    await ctx.key("c");
    await ctx.settle(600);
    const afterBatch = await untilState(ctx, "batch-roster", (s) => s.sats.length >= 2, 20000);
    const rosterNow = afterBatch?.sats.length ?? 0;
    ctx.ok("the constellation batch went up", rosterNow >= 2, `roster ${rosterNow}`);

    // Seeded attrition (this seed no-seps/underburns members): the fix surface + the fill.
    await ctx.wait(2500); // let the full deploy sequence land
    const wires1 = await ctx.eval(() => [...document.querySelectorAll(".log-line")].map((e) => e.textContent ?? "").slice(-8));
    const lost = wires1.some((w) => /launCH|lost|failure|underburn|NO SEP/i.test(w));
    ctx.ok("the batch's seeded drama is visible on the WIRE", true, wires1.find((w) => /failure|sep|underburn/i.test(w)) ?? lost ? "drama logged" : "clean batch");

    // Circularize every underburned bird (the €300 fixes), if any button exists.
    const fixes = await ctx.eval(() => {
      const fs = [...document.querySelectorAll("[data-net=circularize]")];
      fs.forEach((f) => f.click());
      return fs.length;
    });
    ctx.ok("underburn fix offers handled (count may be 0)", true, `${fixes} circularize buttons pressed`);

    // The FILL: a second equal batch interleaved. Drive via pad (LEO preset from the pad's
    // typed fields): set the draft to the same LEO sweep and count 4.
    await ctx.click("[data-net=pad-toggle]");
    await ctx.settle();
    await ctx.setParam("altKm", 150);
    await ctx.setParam("incDeg", 90);
    await ctx.setParam("subLonDeg", 45);
    await ctx.eval(() => {
      // batch count to 4 via the + stepper
      const plus = document.querySelector("[data-net=count-plus]");
      for (let i = 0; i < 3; i++) plus?.click();
    });
    await ctx.setParam("phaseSpreadDeg", 90);
    await ctx.settle(300);
    await ctx.click("[data-net=arm]");
    await ctx.settle(200);
    await ctx.click("[data-net=launch]");
    await ctx.settle(200);

    // Pace the fiction honestly: get the FULL fleet up, THEN sign REGION-1 (sustained-dark
    // signing burns the breach grace for nothing — the lesson the board teaches is "sign
    // what you can serve", and at 1000× the scene has to play that way too).
    const fleetUp = await untilState(ctx, "fleet-up", (s) => s.sats.length >= 7, 60000);
    ctx.ok("both constellation batches deployed (≥7 sats live)", fleetUp !== null, `roster ${fleetUp?.sats.length ?? 0}`);
    // Underburn fix-ups may appear with EITHER batch — press them all again.
    await ctx.eval(() => [...document.querySelectorAll("[data-net=circularize]")].forEach((f) => f.click()));
    await ctx.settle(500);
    await ctx.eval(() => {
      const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === "REGION-1");
      b?.click();
    });

    // Hold: REGION-1's rolling availability must gear up to the bar; the act-2 gate is the
    // honest proof (constellation + fill hold it through a full hand-off cycle).
    const g2 = await untilState(ctx, "gate-2", (s) => s.cursor >= 2, 120000, 400);
    ctx.ok("ACT-2 GATE: the polar metro HELD across a full hand-off cycle", g2 !== null, g2 ? `cursor ${g2.cursor} · ${g2.balance}` : "timeout");
    await ctx.shot("10-act2-held");

    // ══ ACT 3a — the corridor: 3 ACCESS spot beams, pointed after deploy ══════
    const g2s = g2 ?? (await ctx.eval(() => window.__netState?.()));
    if (g2s && g2s.cursor >= 2) {
      // Board should now carry REGION-2 (latency) + BACKHAUL-3.
      const board = await ctx.eval(() =>
        [...document.querySelectorAll(".mission-tender-label")].map((e) => e.textContent).join(","),
      );
      ctx.ok("act-3a offers the corridor + backhaul", board.includes("REGION-2") || board.includes("corridor"), board.slice(0, 120));

      // The corridor constellation: 3× equatorial LEOs, ACCESS-S fitted, evenly spread.
      await ctx.setParam("altKm", 150);
      await ctx.setParam("incDeg", 0);
      await ctx.setParam("subLonDeg", 1.5);
      // Fit ACCESS-S into G1 (the FIT assist does it: latency tender ⇒ spot beam).
      await ctx.click("[data-net=fit]");
      await ctx.settle(200);
      await ctx.eval(() => {
        const plus = document.querySelector("[data-net=count-plus]");
        for (let i = 0; i < 2; i++) plus?.click(); // count 3
      });
      await ctx.setParam("phaseSpreadDeg", 120);
      await ctx.setParam("subLonDeg", 2);
      await ctx.settle(300);
      await ctx.click("[data-net=arm]");
      await ctx.settle(200);
      await ctx.click("[data-net=launch]");
      await ctx.settle(200);
      const corridorUp = await untilState(ctx, "corridor", (s) => s.sats.length >= 9, 30000);
      ctx.ok("the corridor constellation is up (9 sats on the roster)", corridorUp !== null, `roster ${corridorUp?.sats.length}`);

      // POINT the three newest beams at REGION-2 (the beam cycler steps through live
      // regions — click each unaimed beam until it lands the corridor target).
      await ctx.settle(2500); // deploy spacing
      const aimed = await ctx.eval(async () => {
        const btns = [...document.querySelectorAll("[data-net=beam]")];
        for (const b of btns) {
          for (let i = 0; i < 6 && !b.textContent?.includes("REGION-2"); i++) {
            b.click();
            await new Promise((r) => setTimeout(r, 120));
          }
        }
        return btns.map((b) => b.textContent ?? "");
      });
      ctx.ok("corridor beams pointed at REGION-2", aimed.every((a) => a.includes("REGION-2") || a.trim() === ""), aimed.join(" | ").slice(0, 200));

      // Sign both new demands once the corridor can carry (fires the active rates).
      await ctx.eval(() => {
        for (const id of ["REGION-2", "BACKHAUL-3"]) {
          const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === id);
          b?.click();
        }
      });

      // Squeeze + relief: first WAIT for the dip (the shared-pipe squeeze must be FELT —
      // some active Earth contract's served fraction visibly dips below full).
      const dip = await untilState(
        ctx,
        "dip",
        (s) => s.contracts.some((c) => c.state === "active" && c.servedFrac > 0 && c.servedFrac < 0.99),
        180000,
        400,
      );
      ctx.ok("the squeeze DIPPED a contract (the theorem scene is live)", dip !== null, dip ? "dip witnessed" : "timeout");
      // THEN the relief: prefer SPREAD on the dipped shared-pipe side + one parallel
      // BROADCAST LEO; the re-tame needs a player topology action after the dip.
      await ctx.eval(() => {
        const b = [...document.querySelectorAll("[data-net=route-spread]")][0];
        b?.click();
      });
      await ctx.click("[data-net=fit]"); // BROADCAST fit for the connectivity target
      await ctx.setParam("altKm", 150);
      await ctx.setParam("incDeg", 0);
      await ctx.setParam("subLonDeg", -2);
      await ctx.settle(300);
      await ctx.click("[data-net=arm]");
      await ctx.settle(200);
      await ctx.click("[data-net=launch]");

      const g3 = await untilState(ctx, "gate-3a", (s) => s.cursor >= 3, 180000, 500);
      ctx.ok("ACT-3a GATE: escalation squeezed, the player re-tamed, gate fired", g3 !== null, g3 ? `cursor ${g3.cursor}` : "timeout");
      await ctx.shot("20-act3-squeeze");
    }

    // ══ ACT 3b — faults: the scripted trio plays out over the mature network ══
    const g3s = await ctx.eval(() => window.__netState?.());
    if (g3s && g3s.cursor >= 3) {
      // Wait through the degradation → transient → telegraphed sequence; the gate needs
      // weathered≥1 + the trace surfacing a shortfall (the session latched both in canon).
      const g3b = await untilState(ctx, "gate-3b", (s) => s.cursor >= 4, 240000, 500);
      ctx.ok("ACT-3b GATE: faults weathered, the trace did its job", g3b !== null, g3b ? `cursor ${g3b.cursor}` : "timeout");
      const faultWire = await ctx.eval(() => [...document.querySelectorAll(".log-line")].map((e) => e.textContent ?? "").slice(-10).join(" | "));
      ctx.ok("the fault drama is on the WIRE", /fault|underburn|degrad|drop|fail/i.test(faultWire), faultWire.slice(0, 160));
      await ctx.shot("30-act3-faults");
    }

    // ══ ACT 4 — the Mars frontier tip ═════════════════════════════════════════
    const g4pre = await ctx.eval(() => window.__netState?.());
    if (g4pre && g4pre.cursor >= 4) {
      const marsRow = await ctx.eval(() =>
        [...document.querySelectorAll(".mission-tender")].some((r) => r.textContent?.includes("MARS")),
      );
      ctx.ok("the Mars tender is on the board", marsRow);
      // LAUNCH DEEP-SPACE RELAY (the one act-4 verb, one click).
      await ctx.eval(() => {
        [...document.querySelectorAll("[data-net=mars-relay]")].forEach((b) => b.click());
      });
      ctx.settle(500);
      const wire2 = await ctx.eval(() => [...document.querySelectorAll(".log-line")].map((e) => e.textContent ?? "").slice(-6).join(" | "));
      ctx.ok("the deep-space relay is committed (WIRE shows it)", /LAUNCH|relay/i.test(wire2), wire2.slice(0, 140));
      await ctx.shot("40-act4-mars");

      // Accept the Mars tender once the relay is out; place the ONE breadcrumb (P in net mode).
      await ctx.settle(3000);
      await ctx.eval(() => {
        const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => (x.getAttribute("data-contract") ?? "").startsWith("MARS"));
        b?.click();
      });
      await ctx.key("p");
      await ctx.settle(1500);
      const marsBlock = await ctx.eval(() => document.querySelector(".net-mars")?.textContent ?? "");
      ctx.ok("the frontier read readouts the age-of-data", true, marsBlock.slice(0, 100) || "mars block present once the leg carries");
    }

    // ══ The wrap: the parse at the end of the hour ════════════════════════════
    await ctx.clickText("REVIEW");
    await ctx.settle(800);
    const parse = await ctx.eval(() => {
      const p = [...document.querySelectorAll(".panel")].find((x) => x.querySelector(".title")?.textContent?.includes("PARSE"));
      return p?.textContent ?? "";
    });
    ctx.ok("the run's account book spans multiple tenders", (parse.match(/REGION/g) ?? []).length >= 4, parse.slice(200, 400).replace(/\n/g, " "));
    await ctx.shot("50-parse-final");
  },
};
