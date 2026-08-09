/**
 * SCENE: cold boot — the first minute a cold tester sees. Catches: console errors, the
 * boot-cast composition (two clocked offers, no assist-yet), the epoch-shortfall regression
 * (R3-polish: the idle assist must NOT show at arrival), and the MISSION hero framing.
 */
export default {
  name: "boot",
  async run(ctx) {
    await ctx.page.goto(ctx.base ?? "http://localhost:5173", { waitUntil: "networkidle", timeout: 30000 });
    await ctx.settle(2200);

    // The world is up.
    const title = await ctx.eval(() => document.title);
    ctx.ok("app boots to SIGNAL HORIZON", title === "SIGNAL HORIZON", title);

    const tenders = await ctx.eval(() =>
      [...document.querySelectorAll(".mission-tender")].map((row) => ({
        label: row.querySelector(".mission-tender-label")?.textContent,
        state: row.querySelector(".mission-tender-state")?.textContent,
        facts: row.querySelector(".mission-tender-facts")?.textContent ?? "",
      })),
    );
    ctx.ok("the ONE tender is on the board at boot (REGION-C is gone, 2026-08-09)", tenders.length === 1, tenders.map((t) => t.label).join(", "));
    ctx.ok("both tenders OFFERED", tenders.every((t) => t.state === "OFFERED"));
    ctx.ok(
      "tender texture: bonus clock on the opener",
      tenders[0]?.facts.includes("sign-on"),
      tenders.map((t) => t.facts).join(" || "),
    );

    // R3-polish regression: the idle assist must NOT show at arrival (the epoch-time bug).
    const shortfallAtBoot = await ctx.eval(() => (document.querySelector(".mission-shortfall")?.textContent ?? "").trim());
    ctx.ok("no stuck-assist at cold boot (epoch bug stays dead)", shortfallAtBoot === "", shortfallAtBoot || "clean");

    // THE self-reference guard: the chrome must be dark (one collapsed sweep turned --bg into
    // var(--bg) once and the whole interior went white; "white UX is insane" must never return).
    const chrome = await ctx.eval(() => ({
      bgVar: getComputedStyle(document.documentElement).getPropertyValue("--bg").trim(),
      panelBg: (() => { const p = document.querySelector(".mission-top"); return p ? getComputedStyle(p).backgroundColor : null; })(),
      topbarBg: (() => { const t = document.querySelector(".topbar"); return t ? getComputedStyle(t).backgroundColor : null; })(),
    }));
    ctx.ok("chrome is near-black (the --bg token resolves, panels paint)", chrome.bgVar === "#0b0b12" && (chrome.panelBg === "rgb(11, 11, 18)" || chrome.topbarBg === "rgb(11, 11, 18)"), JSON.stringify(chrome));

    const wallet = await ctx.eval(() => document.querySelector(".lf-wallet")?.textContent ?? "");
    ctx.ok("wallet shows the retuned ante", wallet.includes("75,000"), wallet);

    await ctx.shot("01-boot");

    // The fast time already ticks the tender's lapo clock (the offer window ticks down).
    const pay0 = await ctx.eval(() => [...document.querySelectorAll(".mission-tender-served")][0]?.textContent);
    await ctx.wait(4000);
    const pay1 = await ctx.eval(() => [...document.querySelectorAll(".mission-tender-served")][0]?.textContent);
    ctx.ok("the tender's lapse clock visibly counts down", pay0 !== pay1, `${pay0} → ${pay1}`);
  },
};
