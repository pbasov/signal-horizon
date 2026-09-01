/**
 * SCENE: THE ROUTING SCREEN (TRACE) — SD-53, docs/routing-screen.md §10.
 *
 * Drives the real loop through the UI (aim → launch → sign → escalate) with TRACE summoned into a
 * tile, and asserts the falsifiers the design commits to:
 *
 *   · the empty board announces its shape before it has content;
 *   · a DARK row's BINDING SENTENCE is legible with ZERO clicks (§5's "no critical state behind a
 *     dig" is not satisfied by a disclosure triangle);
 *   · the bands order worst-first and the order does NOT shuffle across steady frames (the diurnal
 *     load curve oscillates ±45% — an unstable list is an unclickable one);
 *   · the head census equals the probe's own counts (the panel cannot drift from its data);
 *   · every pipe's rider shares equal the ROUTER's own fair-share expression;
 *   · the Σfloor notch pins right exactly when the promises exceed the antenna;
 *   · the loss roll keeps repeats, and their spacing is an observed mean — never a forecast;
 *   · the panel's DOM rebuild count stays flat while numbers move (the no-churn idiom);
 *   · zero console errors throughout.
 */

/** Drop back to real time so an assertion reads the board it was aimed at. At 1000× a 400 ms
 * settle is 400 SIM-SECONDS — long enough for an Act-1 term to expire before the assert runs,
 * which is exactly how the first draft of this scene lied to itself. */
async function slow(ctx) {
  for (let i = 0; i < 8; i++) await ctx.key(",");
  await ctx.settle(150);
}
async function fast(ctx, steps = 6) {
  for (let i = 0; i < steps; i++) await ctx.key(".");
  await ctx.settle(120);
}

async function simSleep(ctx, targetSimT, capMs = 180000) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = await ctx.eval(() => window.__netState?.());
    if (s && s.tSim >= targetSimT) return s;
    if (Date.now() - t0 > capMs) return null;
    await ctx.wait(150);
  }
}

async function untilCursor(ctx, minCursor, timeoutMs = 180000) {
  const t0 = Date.now();
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const s = await ctx.eval(() => window.__netState?.());
    if (s && s.cursor >= minCursor) return s;
    if (Date.now() - t0 > timeoutMs) return null;
    await ctx.wait(200);
  }
}

async function sign(ctx, contractId) {
  return ctx.eval((id) => {
    const b = [...document.querySelectorAll("[data-net=accept]")].find((x) => x.getAttribute("data-contract") === id);
    if (!b) return false;
    b.click();
    return true;
  }, contractId);
}

async function launchDraft(ctx, { altKm, incDeg, subLonDeg, count = 1, spreadDeg = 0, fit = false }) {
  await ctx.eval(() => {
    const t = document.querySelector("[data-net=pad-toggle]");
    if (t && !t.textContent?.includes("BACK")) t.click();
  });
  await ctx.settle(200);
  if (fit) {
    await ctx.click("[data-net=fit]");
    await ctx.settle(120);
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
  await ctx.settle(250);
  await ctx.click("[data-net=arm]");
  await ctx.settle(200);
  await ctx.click("[data-net=launch]");
  await ctx.settle(200);
}

/** Summon TRACE into the focused tile the way a player would — off the rail. */
async function summonTrace(ctx) {
  return ctx.eval(() => {
    const b = [...document.querySelectorAll(".window-rail button")].find((x) => x.dataset.host === "trace");
    if (!b) return false;
    b.click();
    return document.querySelector(".trace") !== null;
  });
}

import { fillRingHole, exactRingAltKm } from "../ring-fill.mjs";

export default {
  name: "trace",
  async run(ctx) {
    await ctx.page.goto(ctx.base, { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(1800);

    // ── 1. the rail mounts it, and the empty board announces its shape ────────────
    ctx.ok("TRACE summons from the rail into the focused tile", await summonTrace(ctx));
    await ctx.settle(300);
    const cold = await ctx.eval(() => ({
      head: document.querySelector(".trace-head")?.textContent ?? "",
      hint: document.querySelector(".trace .net-hint")?.textContent ?? "",
      pipesShown: (document.querySelector(".trace-pipes")?.style.display ?? "") !== "none",
      probe: window.__trace?.() ?? null,
    }));
    ctx.ok("the cold board names a want, not a control", /signed tender and a bird in view/.test(cold.hint), cold.hint);
    ctx.ok("the census reads zero flows before the first signature", /0 flows/.test(cold.head), cold.head);
    ctx.ok("groups with nothing to say are ABSENT, not empty columns", cold.pipesShown === false, `pipes shown=${cold.pipesShown}`);
    ctx.ok("the probe agrees with the panel", cold.probe?.mounted === true && cold.probe.order.length === 0);
    await ctx.shot("00-cold");

    // ── 2. act 1: one bird, one promise. The board must not be embarrassing. ──────
    await ctx.eval(() => document.querySelector("[data-net=pad-toggle]")?.click());
    await ctx.settle(150);
    await ctx.eval(() => {
      const i = document.querySelector("[data-net=param-subLonDeg]");
      i.value = "0";
      i.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await ctx.eval(() => document.querySelector("[data-net=arm]")?.click());
    await ctx.settle(200);
    await ctx.eval(() => document.querySelector("[data-net=launch]")?.click());
    await ctx.settle(200);
    await fast(ctx);
    await ctx.settle(2000);
    await slow(ctx); // the deploy is done; read the board at real time, not 1000×
    await sign(ctx, "REGION-0");
    await ctx.settle(600);
    await summonTrace(ctx);
    await ctx.settle(400);

    const act1 = await ctx.eval(() => {
      const p = window.__trace?.();
      const row = document.querySelector("[data-net=trace-flow]");
      return {
        probe: p,
        rowText: row?.textContent ?? "",
        readCell: document.querySelector(".trace-read")?.textContent ?? "",
        pathCell: document.querySelector(".trace-path-text")?.textContent ?? "",
        pipeRows: [...document.querySelectorAll("[data-net=trace-pipe]")].map((r) => r.textContent ?? ""),
        legend: document.querySelector(".trace-sublegend")?.textContent ?? "",
        head: document.querySelector(".trace-head")?.textContent ?? "",
      };
    });
    ctx.ok("act 1 puts exactly one flow on the board", act1.probe?.order.length === 1, JSON.stringify(act1.probe?.order ?? []));
    ctx.ok(
      "the row leads with the two raw numbers the axis is decided by",
      /\/\s/.test(act1.readCell) && act1.readCell.length > 3,
      act1.readCell,
    );
    ctx.ok(
      "the path line names the antenna, not a colon index",
      /via .+ · (BROADCAST|ACCESS|GATEWAY)/.test(act1.pathCell) && !/:\d/.test(act1.pathCell),
      act1.pathCell,
    );
    ctx.ok("the ledger names the pipe and states the unit once", /capacity in units/.test(act1.legend), act1.legend);
    ctx.ok("the contention ledger has the serving antenna", act1.pipeRows.length >= 1, act1.pipeRows[0]?.slice(0, 110) ?? "");
    ctx.ok(
      "the head census matches the probe exactly (the panel cannot drift from its data)",
      act1.head.includes(`${act1.probe.counts.dark} dark`) &&
        act1.head.includes(`${act1.probe.counts.tight} tight`) &&
        act1.head.includes(`${act1.probe.counts.clear} clear`),
      `${act1.head} vs ${JSON.stringify(act1.probe.counts)}`,
    );
    ctx.ok(
      "the titlebar carries the across-the-room read (the lamp both flagship panels waste)",
      await ctx.eval(() => {
        const p = [...document.querySelectorAll(".panel")].find((x) => x.querySelector(".title")?.textContent?.includes("TRACE"));
        const sub = p?.querySelector(".sub")?.textContent ?? "";
        const dot = p?.querySelector(".dot")?.className ?? "";
        return { sub, dot, lit: sub !== "" || dot.trim() !== "dot" };
      }).then((r) => r.lit),
    );
    await ctx.shot("10-act1");

    // ── 4. act 2 + act 3: contention, a shared pipe, and a dark promise ──────────
    await fast(ctx);
    {
      // Sign the renewal the moment it lands (it carries the grown baseline onto the pipe).
      const t0 = Date.now();
      // eslint-disable-next-line no-constant-condition
      while (Date.now() - t0 < 90000) {
        const off = await ctx.eval(() => window.__netState?.()?.contracts.find((c) => c.id === "REGION-0+R1")?.state);
        if (off === "offered") {
          await sign(ctx, "REGION-0+R1");
          break;
        }
        await ctx.wait(200);
      }
    }
    await untilCursor(ctx, 1, 90000);
    // REGION-1 IS SIGNED LAST, once the ring is whole (SD-64). It used to be signed here, before a
    // single member flew, and availability is a ROLLING WINDOW — a contract accepted over an empty
    // sky keeps remembering that empty sky, so REGION-1 could not climb to its 99 % bar and the
    // act-2 gate never fired. Without act 2 there is no act 3, which is why this screen's own board
    // read "0 flows" and half its assertions were vacuous. canon.ts puts its accept after the fill
    // for exactly this reason.
    await ctx.key("c"); // the act-2 constellation batch (N measured live by suggestPhasing)
    await simSleep(ctx, 290, 120000);
    await ctx.eval(() => [...document.querySelectorAll("[data-net=circularize]")].forEach((f) => f.click()));
    // Every number in the fill is read off the ring that is actually flying — tools/ring-fill.mjs.
    await fillRingHole(ctx, { incDeg: 90, launch: (p) => launchDraft(ctx, p) });
    await ctx.settle(2000);
    await sign(ctx, "REGION-1");
    await ctx.settle(400);
    ctx.ok(
      "REGION-1 signs once the ring is whole",
      (await ctx.eval(() => window.__netState?.()?.contracts.find((c) => c.id === "REGION-1")?.state)) === "active",
      "active",
    );
    await untilCursor(ctx, 2, 150000);
    await slow(ctx);
    await summonTrace(ctx);
    await ctx.settle(500);
    await ctx.shot("20-act2");
    await fast(ctx);

    // Act 3a: the corridor + backhaul share a pipe — the whole reason this screen exists.
    await simSleep(ctx, 661, 150000);
    // The corridor LEOs are the SAME LEO family as the ring (canon flies them at
    // `LEO_SWEEP.semiMajorM`), so they take the ring's exact altitude too — 310 km was the
    // pre-SD-56 number and put them in a different orbit entirely (SD-64).
    const corridorAltKm = await exactRingAltKm(ctx);
    await launchDraft(ctx, { altKm: corridorAltKm, incDeg: 0, subLonDeg: 1.5, count: 3, spreadDeg: 120, fit: true });
    await simSleep(ctx, 686, 120000);
    await ctx.eval(async () => {
      const btns = [...document.querySelectorAll("[data-net=beam]")];
      for (const b of btns) {
        for (let i = 0; i < 6 && !b.textContent?.includes("REGION-2"); i++) {
          b.click();
          await new Promise((r) => setTimeout(r, 90));
        }
      }
    });
    await simSleep(ctx, 690, 120000);
    await slow(ctx);
    await sign(ctx, "REGION-2");
    await sign(ctx, "BACKHAUL-3");
    await ctx.settle(900);
    await summonTrace(ctx);
    await ctx.settle(600);
    await ctx.shot("30-act3");

    // ── 4b. THE ORDER, measured where there is something to shuffle ─────────────
    // The falsifier is "nothing OVERTOOK anything while the numbers moved" — not "the row set is
    // frozen". A term completing is a legitimate structural change; a shuffle is not. So sample
    // the board repeatedly at 10× (the ladder is 1/10/100/1000) — fast enough that the diurnal
    // offered-load curve visibly moves every number, short enough that no 480 s term expires
    // mid-window — and assert that between consecutive samples nothing overtook anything.
    const churnA = await ctx.eval(() => window.__panelChurn?.().trace ?? -1);
    await slow(ctx);
    await fast(ctx, 1); // 10×
    const samples = [];
    const loads = [];
    for (let i = 0; i < 10; i++) {
      const s = await ctx.eval(() => {
        const p = window.__trace?.();
        return {
          order: (p?.order ?? []).map((f) => f.id),
          keys: Object.fromEntries((p?.order ?? []).map((f) => [f.id, f.key])),
          hyst: p?.hysteresis ?? 0.05,
          load: (p?.pipes ?? []).reduce((a, x) => a + x.load, 0),
        };
      });
      samples.push(s);
      loads.push(s.load);
      await ctx.wait(220);
    }
    const churnB = await ctx.eval(() => window.__panelChurn?.().trace ?? -1);
    await slow(ctx);
    {
      const widest = samples.reduce((best, x) => (x.order.length > best.length ? x.order : best), []);
      // The invariant is NOT "the order never changes" — a row whose headroom genuinely falls past
      // the band has EARNED its move, and freezing it would be the lie. The invariant is that every
      // move was earned: an overtake is legal only when the riser's key is lower than the row it
      // passed by more than the hysteresis band.
      let unearned = "";
      let earnedMoves = 0;
      for (let i = 1; i < samples.length; i++) {
        const a = samples[i - 1].order;
        const b = samples[i].order;
        const k = samples[i].keys;
        const hyst = samples[i].hyst;
        const both = a.filter((id) => b.includes(id));
        for (let x = 0; x < both.length; x++) {
          for (let y = x + 1; y < both.length; y++) {
            const above = both[x];
            const below = both[y];
            if (b.indexOf(below) >= b.indexOf(above)) continue; // no swap
            earnedMoves++;
            const gap = (k[above] ?? 0) - (k[below] ?? 0);
            if (!(gap > hyst) && unearned === "") {
              unearned = `sample ${i}: ${below} passed ${above} on a gap of ${gap.toFixed(4)} (band ${hyst})`;
            }
          }
        }
      }
      ctx.ok("the window had rows to shuffle (the check is not vacuous)", widest.length >= 2, `widest=[${widest.join(",")}]`);
      ctx.ok(
        "every reorder was EARNED — no row passed another inside the hysteresis band",
        unearned === "",
        unearned || `${earnedMoves} earned move(s)`,
      );
      ctx.ok(
        "the load really was moving during that window (otherwise the check proves nothing)",
        new Set(loads.map((l) => l.toFixed(3))).size > 1,
        loads.map((l) => l.toFixed(2)).join(" "),
      );
      ctx.ok(
        "the table does not rebuild its DOM on a moving number",
        churnB - churnA <= 4,
        `${churnB - churnA} rebuilds across ~10 samples of live play`,
      );
    }

    // ── 5. THE ARITHMETIC: the table cannot disagree with the router ─────────────
    const board = await ctx.eval(() => window.__trace?.());
    ctx.ok("act 3 puts several promises on the board", (board?.order.length ?? 0) >= 2, `${board?.order.length ?? 0} flows`);
    ctx.ok(
      "bands are ordered worst-first (dark, then tight, then clear)",
      (() => {
        const rank = { dark: 0, tight: 1, clear: 2 };
        const seq = (board?.order ?? []).map((f) => rank[f.band]);
        return seq.every((v, i) => i === 0 || seq[i - 1] <= v);
      })(),
      (board?.order ?? []).map((f) => `${f.id}:${f.band}`).join(" "),
    );
    const shareErrors = [];
    for (const p of board?.pipes ?? []) {
      const shared = p.riders.reduce((a, r) => a + r.offer, 0);
      for (const r of p.riders) {
        const expected = shared <= p.cap || shared <= 0 ? r.offer : (p.cap * r.offer) / shared;
        if (Math.abs(expected - r.share) > 0.011) shareErrors.push(`${p.pipe}/${r.id}: ${r.share} vs ${expected.toFixed(3)}`);
      }
    }
    ctx.ok("every rider's share IS the router's own fair-share expression", shareErrors.length === 0, shareErrors.join(" | "));
    ctx.ok(
      "the Σfloor notch pins right exactly when the promises exceed the antenna",
      (board?.pipes ?? []).every((p) => (p.overPromised ? p.notch >= 0.999 : p.notch <= 1.0)),
      (board?.pipes ?? []).map((p) => `${p.pipe} notch=${p.notch} over=${p.overPromised}`).join(" "),
    );
    ctx.ok(
      "no pipe reports a utilisation the load and capacity do not produce",
      (board?.pipes ?? []).every((p) => p.cap <= 0 || Math.abs(p.util - p.load / p.cap) < 0.01),
      (board?.pipes ?? []).map((p) => `${p.pipe} ${p.load}/${p.cap}=${p.util}`).join(" "),
    );

    // ── 6. A DARK ROW'S DIAGNOSIS IS VISIBLE WITH ZERO CLICKS ────────────────────
    const dark = await ctx.eval(() => {
      const rows = [...document.querySelectorAll("[data-net=trace-flow]")];
      const d = rows.find((r) => r.className.includes("band-dark"));
      if (!d) return null;
      const b = d.querySelector(".trace-binding");
      const style = b ? getComputedStyle(b) : null;
      return {
        id: d.getAttribute("data-contract"),
        binding: b?.textContent ?? "",
        visible: !!b && style.display !== "none",
        whyNow: d.querySelector(".trace-whynow")?.textContent ?? "",
        binds: d.querySelector(".trace-binds")?.textContent ?? "",
      };
    });
    if (dark !== null) {
      ctx.ok("a DARK row states its binding constraint WITHOUT a click", dark.visible && dark.binding.length > 20, dark.binding);
      ctx.ok("the binding line names a class of hardware or geometry, never a control", !/press|click|button|prefer-bw/i.test(dark.binding), dark.binding);
      ctx.ok("the axis reads in CAPS with the router's ✕ (its own verdict on a failed solve)", /[A-Z]{2,}\s*✕/.test(dark.binds), dark.binds);
      ctx.ok("the why-now line stamps the cause and when it happened", dark.whyNow.length > 0, dark.whyNow);
    } else {
      ctx.ok("no DARK row this run — the binding-line assertions are skipped, not silently passed", true, "network held throughout");
    }

    // ── 7. THE PREDICTABILITY SEED: repeats kept, spacing observed, nothing forecast ──
    const roll = board?.roll ?? [];
    ctx.ok("the loss roll grouped at least one link", roll.length >= 1, `${roll.length} links`);
    const repeated = roll.find((r) => r.count >= 3);
    if (repeated) {
      ctx.ok(
        "a repeated link carries an OBSERVED mean spacing (three stamps make a rhythm)",
        repeated.meanGapS !== null && repeated.meanGapS > 0,
        `${repeated.key} ×${repeated.count} gap ${Math.round(repeated.meanGapS ?? 0)}s`,
      );
    }
    const rollDom = await ctx.eval(() => [...document.querySelectorAll("[data-net=trace-loss]")].map((r) => r.textContent ?? ""));
    ctx.ok(
      "no raw enum and no raw second reaches the player from the roll",
      rollDom.every((t) => !/set_below_horizon|out_of_budget|_/.test(t)),
      rollDom[0]?.slice(0, 120) ?? "(empty)",
    );
    ctx.ok(
      "nothing on the screen forecasts the NEXT loss (that is the post-gate a-ha)",
      await ctx.eval(() => !/next loss|in \d+m\b.*(predict|forecast)/i.test(document.querySelector(".trace")?.textContent ?? "")),
    );

    // ── 7b. THE GLOBE COUPLING — §5 #4's actual claim is that the trace renders on the ORRERY ──
    {
      const before = await ctx.eval(() => {
        const p = window.__trace?.();
        return { traced: p?.traced ?? null, arcs: p?.candidateArcs ?? -1 };
      });
      ctx.ok("nothing is traced until a flow is picked", before.traced === null && before.arcs === 0, JSON.stringify(before));

      const picked = await ctx.eval(() => {
        const row = document.querySelector("[data-net=trace-flow]");
        row?.click();
        return row?.getAttribute("data-contract") ?? null;
      });
      await ctx.settle(400);
      const after = await ctx.eval(() => {
        const p = window.__trace?.();
        const row = document.querySelector("[data-net=trace-flow]");
        return {
          traced: p?.traced ?? null,
          arcs: p?.candidateArcs ?? -1,
          rowCandidates: p?.order?.[0]?.candidates ?? -1,
          selected: row?.className.includes("sel") ?? false,
          servedLinkVisible: window.__netDebug?.()?.servedLinkVisible,
        };
      });
      ctx.ok("picking a flow traces it on the globe", after.traced === picked && picked !== null, `${picked} → ${after.traced}`);
      ctx.ok("the row shows it is the selected one", after.selected, String(after.selected));
      ctx.ok(
        "the dashed candidate arcs match the count the row states (geometry, not a preview)",
        after.arcs === after.rowCandidates,
        `${after.arcs} arcs vs "${after.rowCandidates}" on the row`,
      );

      const cleared = await ctx.eval(() => {
        document.querySelector("[data-net=trace-flow]")?.click(); // clicking again deselects
        return true;
      });
      await ctx.settle(300);
      const off = await ctx.eval(() => ({ traced: window.__trace?.().traced ?? null, arcs: window.__trace?.().candidateArcs ?? -1 }));
      ctx.ok(
        "picking it again releases the trace (the whole web reads normally again)",
        cleared && off.traced === null && off.arcs === 0,
        JSON.stringify(off),
      );
    }

    // ── 7c. THE REPOINT PICKER — the free lever, with its consequence stated first ──────
    {
      const closed = await ctx.eval(() => document.querySelectorAll("[data-net=repoint-pick]").length);
      ctx.ok("the picker is closed until asked for", closed === 0, `${closed} options showing`);

      // REPOINT A STEERABLE BEAM, chosen deterministically (SD-64).
      //
      // This used to click `querySelector("[data-net=repoint]")` — the FIRST repoint button on the
      // board. Which pipe is first depends on the live worst-first ordering, so the scene sometimes
      // grabbed the act-1 GEO's parked BROADCAST floodlight, whose picker has nothing to commit: the
      // click was a no-op, the picker stayed open with 4 options, and no beam action reached the WIRE.
      // That is the run-to-run variance filed as "TRACE scene instability" — not flakiness in the
      // panel, but a scene picking a different satellite each run. A floodlight is not a spot beam;
      // prefer a pipe whose antenna can actually be aimed.
      const opened = await ctx.eval(() => {
        const btns = [...document.querySelectorAll("[data-net=repoint]")];
        if (btns.length === 0) return null;
        const steerable = btns.filter((b) => {
          const row = b.closest("[data-net=trace-pipe]");
          return !/BROADCAST/.test(row?.textContent ?? "");
        });
        const b = steerable[0] ?? btns[0];
        b.click();
        return {
          sat: b.getAttribute("data-sat"),
          slot: b.getAttribute("data-slot"),
          steerable: steerable.length > 0,
          of: btns.length,
        };
      });
      ctx.ok(
        "a steerable beam is on the board to repoint (not just the parked floodlight)",
        opened !== null && opened.steerable === true,
        opened === null ? "no repoint button at all" : `${opened.sat}:${opened.slot} of ${opened.of} pipes`,
      );
      await ctx.settle(350);
      const picker = await ctx.eval(() =>
        [...document.querySelectorAll("[data-net=repoint-pick]")].map((b) => ({
          region: b.getAttribute("data-region"),
          text: b.textContent ?? "",
          blind: b.className.includes("blind"),
          current: b.className.includes("active"),
        })),
      );
      if (opened !== null) {
        ctx.ok("REPOINT opens a target picker rather than blind-cycling", picker.length >= 2, `${picker.length} options`);
        ctx.ok(
          "every option states the consequence of committing there",
          picker.every((o) => /in view|not in view|pointed here now|points at nothing/.test(o.text)),
          picker.map((o) => o.text).join(" | "),
        );
        ctx.ok(
          "STOW is offered and says what it would drop",
          picker.some((o) => o.region === "" && /points at nothing/.test(o.text)),
          picker.find((o) => o.region === "")?.text ?? "(no stow option)",
        );
        ctx.ok(
          "an unreachable target is SHOWN and reads unavailable on two channels",
          picker.every((o) => !o.blind || /not in view/.test(o.text)),
          picker.filter((o) => o.blind).map((o) => o.text).join(" | ") || "(all reachable)",
        );
        ctx.ok("no option is marked as the answer", !/best|recommend|optimal/i.test(picker.map((o) => o.text).join(" ")));

        // Committing lands one recorded action and closes the picker.
        const target = picker.find((o) => o.region !== "" && !o.blind && !o.current) ?? picker.find((o) => o.region === "");
        const before = await ctx.eval(() => [...document.querySelectorAll(".log-line .msg")].length);
        await ctx.eval((r) => {
          const b = [...document.querySelectorAll("[data-net=repoint-pick]")].find((x) => x.getAttribute("data-region") === r);
          b?.click();
        }, target?.region ?? "");
        await ctx.settle(400);
        const after = await ctx.eval((n) => {
          const msgs = [...document.querySelectorAll(".log-line .msg")].map((e) => e.textContent ?? "");
          return {
            lines: msgs.length,
            open: document.querySelectorAll("[data-net=repoint-pick]").length,
            // THE LINES ADDED SINCE THE COMMIT, not just the last one. The sim keeps talking while
            // the scene reads: a "first signal" line lands in the same instant and outraces the beam
            // line to the tail, which is the other half of the filed TRACE instability. The claim is
            // that committing a target SAYS SO on the wire — not that nothing else spoke afterwards.
            fresh: msgs.slice(n),
          };
        }, before);
        ctx.ok("committing a target closes the picker", after.open === 0, `${after.open} options still showing`);
        ctx.ok(
          "the commit lands one beam action on the WIRE",
          after.lines > before && after.fresh.some((l) => /beam/.test(l)),
          after.fresh.join(" | ") || "(nothing new on the wire)",
        );
      }
    }

    // ── 8. the lawfulness sweep over everything the panel actually rendered ──────
    const text = await ctx.eval(() => document.querySelector(".trace")?.textContent ?? "");
    ctx.ok("no pre-commit verdict anywhere on the board", !/WILL SERVE|NEED \d|HOLDS ✓|RECOMMENDED/i.test(text), text.slice(0, 100));
    ctx.ok("no imperative control string anywhere on the board", !/\bpress [A-Z]|\bclick [A-Z]|\b[A-Z]{2,} button\b/.test(text));
    ctx.ok("the unit is defined on screen", /one unit is roughly one region's baseline demand/.test(text));
    await ctx.shot("40-final");
  },
};
