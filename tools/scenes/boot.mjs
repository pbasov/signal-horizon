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
    ctx.ok("two tenders on the board at boot", tenders.length === 2, tenders.map((t) => t.label).join(", "));
    ctx.ok("both tenders OFFERED", tenders.every((t) => t.state === "OFFERED"));
    ctx.ok(
      "tender texture: bonus clock on the opener, decay on the second",
      tenders[0]?.facts.includes("sign-on") && tenders[1]?.facts.includes("halves"),
      tenders.map((t) => t.facts).join(" || "),
    );

    // R3-polish regression: the idle assist must NOT show at arrival (the epoch-time bug).
    const shortfallAtBoot = await ctx.eval(() => (document.querySelector(".mission-shortfall")?.textContent ?? "").trim());
    ctx.ok("no stuck-assist at cold boot (epoch bug stays dead)", shortfallAtBoot === "", shortfallAtBoot || "clean");

    const wallet = await ctx.eval(() => document.querySelector(".lf-wallet")?.textContent ?? "");
    ctx.ok("wallet shows the retuned ante", wallet.includes("75,000"), wallet);

    await ctx.shot("01-boot");

    // The fast time should already tick the tenders. Wait a beat; the decay must visibly move.
    const pay0 = await ctx.eval(() => [...document.querySelectorAll(".mission-tender-bet")][1]?.textContent);
    await ctx.wait(4000);
    const pay1 = await ctx.eval(() => [...document.querySelectorAll(".mission-tender-bet")][1]?.textContent);
    ctx.ok("REGION-C board pay visibly DECAYS while unsigned", pay0 !== pay1, `${pay0} → ${pay1}`);
  },
};
