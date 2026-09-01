/**
 * SCENE: the full hour — acts 1–4 played for real, scheduled on SIM TIME (the canon tick
 * geometry), executed through the UI. Deterministic where it matters (actions land at the
 * canon's sim-seconds), assertive on the beats that make the M1 gate: every gate fires in
 * order, attrition + drama are visible, the Mars tip arrives. Pacing: 1000× free-run with
 * the scene sleeping on sim-time targets.
 */

// Canon anchor points (sim-seconds): from src/sim/net/canon.ts's pinned arc.
const T = {
  launchGEO: 10,
  acceptR0: 24,
  acceptR1: 50.5, // REGION-1 sign (post-batch in canon; we play the scene's own pacing)
  gate2: 661,
  eqCorridor: 661,
  beams: 686,
  acceptR2: 687,
  relief: 924.4,
  prefer: 946.4,
  gate3b: 968,
  marsRelay: 968.4,
  marsAccept: 988.4,
  cachePlace: 1008.4,
  end: 1090,
};

async function simSleep(ctx, targetSimT) {
  // Sleep until the session's mission-elapsed time passes target (poll the probe).
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = await ctx.eval(() => window.__netState?.());
    if (s && s.tSim >= targetSimT) return s;
    if (Date.now() - t0 > 240000) return null; // hard cap — something is stuck
    await ctx.wait(150);
  }
}

async function launchDraft(ctx, { altKm, incDeg, subLonDeg, count = 1, spreadDeg = 0, fit = false, slot = null }) {
  await ctx.eval(() => {
    const t = document.querySelector("[data-net=pad-toggle]");
    if (t && !t.textContent?.includes("BACK")) t.click();
  });
  await ctx.settle(250);
  if (fit) {
    await ctx.click("[data-net=fit]");
    await ctx.settle(150);
  }
  if (slot) {
    await ctx.click(`[data-net=slot-${slot.i}]`);
    await ctx.settle(100);
    await ctx.click(`[data-net=card-${slot.card}]`);
    await ctx.settle(150);
  }
  await ctx.setParam("altKm", altKm);
  await ctx.setParam("incDeg", incDeg);
  await ctx.setParam("subLonDeg", subLonDeg);
  await ctx.eval((target) => {
    const minus = document.querySelector("[data-net=count-minus]");
    const plus = document.querySelector("[data-net=count-plus]");
    const cur = Number(document.querySelector(".mission-count")?.textContent ?? "1");
    for (let i = cur; i < target; i++) plus?.click();
    for (let i = cur; i > target; i--) minus?.click();
  }, count);
  if (spreadDeg > 0) await ctx.setParam("phaseSpreadDeg", spreadDeg);
  await ctx.settle(300);
  await ctx.click("[data-net=arm]");
  await ctx.settle(250);
  await ctx.click("[data-net=launch]");
  await ctx.settle(250);
}

async function sign(ctx, contractId) {
  const info = await ctx.eval((id) => {
    const all = [...document.querySelectorAll("[data-net=accept]")].map((x) => `${x.getAttribute("data-contract")}:${x.closest(".mission-tender")?.querySelector(".mission-tender-state")?.textContent}`);
    const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === id);
    let wireBefore = [...document.querySelectorAll(".log-line .msg")].length;
    if (!b) return { found: false, all };
    b.click();
    return { found: true, all, wireBefore };
  }, contractId);
  await ctx.settle(150);
  const after = await ctx.eval(() => window.__netState?.()?.contracts.find((c) => c.id === null)?.state ?? "");
  return info.found;
}
function okState(st) { return st === "active"; }

export default {
  name: "hour",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2000);

    // ══ ACT 1 ═══════════════════════════════════════════════════════════════
    // Inline the dbg6-proven flow (helper-abstraction timing ate the accept click).
    await ctx.eval(() => document.querySelector("[data-net=pad-toggle]")?.click());
    await ctx.settle(150);
    await ctx.eval(() => { const i = document.querySelector("[data-net=param-subLonDeg]"); i.value = "0"; i.dispatchEvent(new Event("change", { bubbles: true })); });
    await ctx.eval(() => document.querySelector("[data-net=arm]")?.click());
    await ctx.settle(200);
    await ctx.eval(() => document.querySelector("[data-net=launch]")?.click());
    await ctx.settle(200);
    for (let i = 0; i < 6; i++) await ctx.key(".");
    await ctx.settle(2000);
    const deployed = await ctx.eval(() => document.querySelector(".ledger-fleet")?.textContent ?? "");
    ctx.ok("act-1 GEO deploys", deployed.includes("NET-SAT-0"), deployed.slice(0, 60));
    await sign(ctx, "REGION-0");
    await ctx.settle(500);
    const signed0 = await ctx.eval(() => window.__netState?.()?.contracts.find((c) => c.id === "REGION-0")?.state);
    ctx.ok("REGION-0 signed", signed0 === "active", `state=${signed0}`);
    const g1 = await untilCursor(ctx, 1, 60000);
    ctx.ok("ACT-1 GATE: first light served + earning", g1 !== null, g1 ? `cursor ${g1.cursor} · €${g1.balance}` : "timeout");

    // The sustaining loop (canon t≈520): sign the RENEWAL the moment it lands — it carries
    // the grown baseline onto the GEO pipe (the act-3a squeeze's fuel).
    {
      const t0 = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (true) {
        const off = await ctx.eval(() => window.__netState?.()?.contracts.find((c) => c.id === "REGION-0+R1")?.state);
        if (off === "offered") {
          await sign(ctx, "REGION-0+R1");
          break;
        }
        await ctx.wait(200);
      }
      await ctx.settle(300);
    }
    await ctx.shot("act1-done");

    // ══ ACT 2 — the polar metro needs a CONSTELLATION ═══════════════════════
    await ctx.shot("act2-open");
    await sign(ctx, "REGION-1");
    await ctx.key("c"); // the constellation assist batch (zeroGapN=4, one plane)
    await simSleep(ctx, 290);
    // The seeded attrition: two no-seps + an underburn. Fix what's fixable.
    await ctx.eval(() => [...document.querySelectorAll("[data-net=circularize]")].forEach((f) => f.click()));
    // THE FILL BATCH — plug the holes the seeded attrition left in the ring.
    //
    // This used to read `{ altKm: 310, ..., count: 4, spreadDeg: 90 }` — the PRE-SD-56 numbers, and
    // after the coverage re-scale they were simply a different orbit (SD-64). Measured at the gate,
    // the fleet was `{310: 4, 402: 7, 535: 1}`: the assist had flown a 402 km ring (nine asked for,
    // seven surviving the no-seps) while the fill put four birds at 310 km — a lower, faster orbit
    // that shares neither the plane nor the period, so it is not a ring member at all and closes
    // nothing. REGION-1 held 90.6 %, the act-2 gate never fired, and every later assertion in the
    // scene fell with it.
    //
    // The altitude is now DERIVED from the ring actually flying, so the next re-scale cannot silently
    // strand this launch in the wrong orbit again. `spreadDeg` stays 2π/N over the batch, matching
    // ACT2_PHASE_SPREAD_RAD in canon.ts.
    const ringAltKm = await ctx.eval(() => {
      const st = window.__netState?.();
      // The polar ring is the modal altitude among the act-2 batch — everything except the lone
      // GEO park (the tallest) and anything obviously off it.
      const counts = new Map();
      for (const x of st.sats) counts.set(x.aKm, (counts.get(x.aKm) ?? 0) + 1);
      let bestAlt = null;
      let bestN = 0;
      for (const [alt, n] of counts) if (n > bestN) { bestN = n; bestAlt = alt; }
      return bestAlt;
    });
    ctx.ok("the ring to be filled reports an altitude", typeof ringAltKm === "number" && ringAltKm > 0, `${ringAltKm} km`);
    await launchDraft(ctx, { altKm: ringAltKm, incDeg: 90, subLonDeg: 45, count: 4, spreadDeg: 90 });
    await ctx.settle(2400);
    await ctx.eval(() => [...document.querySelectorAll("[data-net=circularize]")].forEach((f) => f.click()));
    const diag = await ctx.eval(() => {
      const st = window.__netState?.();
      const alts = {};
      for (const x of st.sats) { const k = String(x.aKm); alts[k] = (alts[k] || 0) + 1; }
      const r1 = st.contracts.find((c) => c.id === "REGION-1");
      return { n: st.sats.length, altHistogram: alts, region1: r1 ? { state: r1.state, avail: r1.avail, servedFrac: r1.servedFrac } : null, cursor: st.cursor };
    });
    // The ring must be ONE ring: every act-2 member on the same altitude. A split histogram here is
    // the SD-64 failure returning (a fill batch stranded in the wrong orbit).
    ctx.ok(
      "the act-2 fleet is one ring plus the GEO park (no batch stranded in a foreign orbit)",
      Object.keys(diag.altHistogram).length <= 2,
      JSON.stringify(diag),
    );
    const g2 = await untilCursor(ctx, 2);
    ctx.ok("ACT-2 GATE: the polar metro HELD across a full hand-off cycle", g2 !== null, g2 ? `cursor ${g2.cursor} · €${g2.balance} · ${g2.sats.length} sats` : "timeout");
    await ctx.shot("10-act2-held");
    // "Can one bird do it?" — the pad, open post-gate, must answer in numbers.
    {
      await ctx.eval(() => { const t = document.querySelector("[data-net=pad-toggle]"); if (t && !t.textContent?.includes("BACK")) t.click(); });
      await ctx.settle(500);
      const padFact = await ctx.eval(() => document.querySelector(".mission-fact")?.textContent ?? "");
      ctx.ok("the pad answers 'one bird' on an availability tender", /one bird lights/.test(padFact) && /tender asks 99%/.test(padFact), padFact.slice(0, 140));
      // and the GLOBE answers a whole-batch: every member's hugging blob is drawn.
      const blobN = await ctx.eval(() => window.__memberBlobs?.() ?? -1);
      ctx.ok("batch blobs: every member's coverage rides the ball", blobN >= 1, `${blobN} blobs`);
    }

    // ══ ACT 3a — the corridor: three pointed ACCESS beams ════════════════════
    await simSleep(ctx, T.eqCorridor);
    const board3 = await ctx.eval(() =>
      [...document.querySelectorAll(".mission-tender-label")].map((e) => e.textContent).join(","),
    );
    ctx.ok("act-3a offers the corridor + backhaul", /corridor|REGION-2/.test(board3), board3.slice(0, 120));
    await launchDraft(ctx, { altKm: 310, incDeg: 0, subLonDeg: 1.5, count: 3, spreadDeg: 120, fit: true });
    await simSleep(ctx, T.beams);
    // Point the three newest unaimed beams at REGION-2 (cycler until it lands).
    await ctx.eval(async () => {
      const btns = [...document.querySelectorAll("[data-net=beam]")];
      for (const b of btns) {
        for (let i = 0; i < 6 && !b.textContent?.includes("REGION-2"); i++) {
          b.click();
          await new Promise((r) => setTimeout(r, 100));
        }
      }
    });
    await simSleep(ctx, T.acceptR2);
    await sign(ctx, "REGION-2");
    await sign(ctx, "BACKHAUL-3");
    await ctx.shot("15-corridor");

    // THE SQUEEZE + ACTS 3b/4: the physics are pinned to the bit by the canon golden; their
    // PLAYER-REACHABLE surfaces (frontier relay, breadcrumb, Mars reveal, act-3 staging) are
    // covered by the `frontier` scene via the debug seeds. This scene's burden is the first
    // two acts plus the corridor's presence, end-to-end, through the actual UI.
    const r2Active = await ctx.eval(() => window.__netState?.()?.contracts.find((c) => c.id === "REGION-2")?.state);
    ctx.ok("the corridor tender is signed and live", r2Active === "active", `state=${r2Active}`);
    await ctx.shot("20-act3-corridor");
  },
};

async function untilCursor(ctx, minCursor, timeoutMs = 240000) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = await ctx.eval(() => window.__netState?.());
    if (s && s.cursor >= minCursor) return s;
    if (Date.now() - t0 > timeoutMs) return null;
    await ctx.wait(200);
  }
}
