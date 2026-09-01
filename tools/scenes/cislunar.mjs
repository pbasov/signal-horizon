/**
 * SCENE: act 3c — THE CISLUNAR LEG (`?netact=3c`). The rung the GDD asks for between Earth's ~3 ms
 * and Mars's minutes: the lunar farside is the first demand no Earth orbit can EVER reach, and the
 * answer is a relay parked where neither endpoint is.
 *
 * SD-62 built the act with NO playtest scene and NO rendering, so nothing could tell you whether the
 * one act whose entire lesson is GEOMETRIC was visible at all — and it was not (M1-A3C-7). This
 * asserts the act on BOTH channels: the panels say the farside carries, and the ORRERY actually draws
 * the farside, the gateway and the two-hop path between them.
 *
 * The scene deliberately reads the drawn geometry through `__cislunar` rather than trusting the copy.
 * A panel saying "carrying" while the pane is empty is exactly the failure this act already had once.
 */
export default {
  name: "cislunar",
  async run(ctx) {
    // WATCH FOR NaN GEOMETRY FROM THE FIRST FRAME. Three's warning names no object, so a bare
    // "no console/page errors" failure costs a bisect every time; this records the offender BY NAME
    // as soon as it appears, even if a later frame overwrites it with good numbers (SD-66 chased
    // exactly such a transient through `lunarBasis`).
    await ctx.page.addInitScript(() => {
      window.__nanSeen = null;
      const poll = () => {
        try {
          const scan = window.__nanScan?.();
          if (scan && scan.length > 0 && window.__nanSeen === null) window.__nanSeen = scan;
        } catch { /* probe not mounted yet */ }
        requestAnimationFrame(poll);
      };
      requestAnimationFrame(poll);
    });
    await ctx.page.goto(ctx.base + "?netact=3c", { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2500);
    await ctx.bootDone();

    // ── 1. the act is actually reached, and exactly ONE gateway flies ────────────────
    const st = await ctx.eval(() => window.__netState?.());
    const luna = st?.contracts?.find((c) => c.id === "LUNA-1") ?? null;
    ctx.ok("the debug seed reaches act 3c", st?.cursor === 4, `cursor ${st?.cursor}`);
    ctx.ok("the farside demand is on the board and signed", luna?.state === "active", `state=${luna?.state}`);
    ctx.ok("the farside link carries", (luna?.servedFrac ?? 0) > 0.99, `served ${luna?.servedFrac}`);
    // A seed that RESUMED a saved campaign stacked a fresh gateway on every page load (1 → 3 → 5
    // across three boots) until the vault predicate learned about this view. One is the whole point.
    const gates = (st?.sats ?? []).filter((x) => x.id.startsWith("LUNA-GATE"));
    ctx.ok("exactly one L2 gateway flies (the seed does not stack onto a saved run)", gates.length === 1, `${gates.length} gateways: ${gates.map((g) => g.id).join(",")}`);

    // ── 2. THE ORRERY DRAWS IT — the half SD-62 shipped without ──────────────────────
    const p = await ctx.eval(() => window.__cislunar?.() ?? null);
    ctx.ok("the cislunar render slice exists once the act is live", p !== null, JSON.stringify(p));
    if (p !== null) {
      ctx.ok("the farside demand is drawn", p.farsideVisible === true, `farsideVisible=${p.farsideVisible}`);
      ctx.ok("the L2 gateway node is drawn", p.gatewayUp === true && p.gateVisible === true, `up=${p.gatewayUp} visible=${p.gateVisible}`);
      // farside → gateway → dish is three nodes, so two hops. The SHAPE is the lesson: the path goes
      // out past the Moon and comes back to Earth, because neither end can see the other.
      ctx.ok("the leg is drawn as TWO hops (out past the Moon, then home)", p.legVisible === true && p.legSegments === 2, `visible=${p.legVisible} segments=${p.legSegments} nodes=${p.pathNodes}`);
      ctx.ok("the signal is crawling the leg (light delay by sight, not just printed)", p.crawlerVisible === true, `crawlerVisible=${p.crawlerVisible}`);
      // SD-66: an unguarded normalise in `lunarBasis` put NaN through every one of these points.
      ctx.ok("every drawn point is finite", p.finite === true, `finite=${p.finite}`);
      // The GDD's own number for this rung (risk #7: "~1.3 s before Mars bites"), read off the
      // ephemeris rather than written down anywhere.
      ctx.ok("the one-way light time is the honest cislunar ~1.3 s", p.oneWayS > 1.1 && p.oneWayS < 1.6, `${p.oneWayS?.toFixed?.(3)} s`);
    }

    // ── 3. the camera lands on the framing that SHOWS the act ────────────────────────
    // The seed used to sit on the Earth-focused CISLUNAR preset, at whose distance the Moon is off
    // the pane — so the seed that exists to show the act rendered it off-screen.
    const cam = await ctx.eval(() => {
      const bar = document.querySelector(".body-bar");
      return {
        rows: bar ? [...bar.children].map((b) => (b.textContent ?? "").replace(/\s+/g, " ").trim()) : [],
        active: bar ? [...bar.children].filter((b) => b.className.includes("active")).map((b) => (b.textContent ?? "").trim()) : [],
      };
    });
    // Each row leads with its CVD-safe glyph (●/✳/◍), so match on content, not position.
    const moonRow = cam.rows.find((r) => r.includes("MOON")) ?? "";
    // SD-63's bar badges each body with its own one-way light delay. The Moon's is the act's number,
    // so the bar states the lesson before the player has read a single panel.
    ctx.ok("the body bar badges the MOON with its live light delay", /MOON/.test(moonRow) && /[\d.]+\s*s/.test(moonRow), `moon="${moonRow}" rows=[${cam.rows.join(" | ")}]`);

    // ── 4. the panels tell the same story as the pane (LAW 1) ────────────────────────
    const panels = await ctx.eval(() => ({
      tenders: [...document.querySelectorAll(".mission-tender")].map((r) => r.textContent ?? "").join(" | "),
      wire: [...document.querySelectorAll(".log-line .msg")].map((e) => e.textContent ?? "").join(" | "),
      fleet: document.querySelector(".ledger-fleet")?.textContent ?? "",
    }));
    ctx.ok("the farside tender names its customer and its reason", /farside station/.test(panels.tenders) && /never in our sky|farside/i.test(panels.tenders), panels.tenders.slice(0, 160));
    ctx.ok("the WIRE records the farside's first signal", /farside station lit|first signal/.test(panels.wire), panels.wire.slice(-160));
    ctx.ok("the gateway is in the fleet", /LUNA-GATE/.test(panels.fleet), panels.fleet.slice(0, 120));

    // ── 5. and the MARS line is NOT drawn — that act has not been reached ────────────
    // `setMarsLinkLive` read `cursor >= 4`, which meant act4 until SD-62 appended act3c AT 4. After
    // that the Earth↔Mars dashes switched on one act early: a leg the player has not reached, drawn
    // across the pane (SD-66). The board is the honest test — no Mars contract, no Mars line.
    const marsOnBoard = await ctx.eval(() => (window.__netState?.()?.contracts ?? []).some((c) => c.id.startsWith("MARS")));
    ctx.ok("no Mars contract exists at act 3c (so no Mars leg may be claimed)", marsOnBoard === false, `marsOnBoard=${marsOnBoard}`);

    // Nothing may EVER have carried NaN, not even for one frame: a NaN vertex is undrawable garbage
    // and Three reports it as a console error, which this harness counts as a failure anyway.
    const nanSeen = await ctx.eval(() => window.__nanSeen ?? null);
    ctx.ok("no geometry carried NaN on any frame", nanSeen === null, nanSeen === null ? "clean" : JSON.stringify(nanSeen));

    await ctx.shot("00-cislunar-leg");
  },
};
