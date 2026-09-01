/**
 * THE DESIGN-FREE OBSERVATION (SD-55 / AE-03).
 *
 * Builds the ONLY thing the agent ever sees, and (later) the only thing the judge is ever handed:
 * the rendered console, as a sighted player reads it, plus the list of controls currently on screen.
 *
 * Three rules, all load-bearing (docs/agent-eval.md §2, docs/agent-eval-judge.md §1):
 *
 * 1. VISIBLE ONLY. Text comes from `element.innerText`, which the browser computes from rendered
 *    layout — hidden subtrees are excluded for free. This matters concretely: the PAD's DOM exists
 *    while the BOOK face is showing, so a naive `textContent` scrape would hand the agent a screen
 *    full of controls it cannot see (verified: innerText on the MISSION panel at boot contains no
 *    ARM / LAUNCH / COVERAGE COMB).
 * 2. NOTHING FROM OUTSIDE THE GAME. No design docs, no act script, no golden path, no solver
 *    verdict the UI does not print. Every string here was rendered by the game for the player.
 *    What the keys do is not stated by the harness — the game prints its own key hints in the
 *    topbar and the orrery footer, so the agent learns them the way a player does.
 * 3. THE PERSONA RESTRICTION IS ENFORCED HERE, not by asking the brain to abstain. A withheld panel
 *    is never rendered into the observation and its summon control is dropped from the affordance
 *    list, which is what makes the `novice-floor` reading of GDD §9 claim 4 honest.
 */

export const OBS_SCHEMA_VERSION = 1;

/** Panels a capability-restricted persona never sees (matched against the panel title). */
// Matched case-insensitively against panel titles, `data-net` keys and visible control labels, so
// the token has to catch every surface the same panel is reachable through: the panel is titled
// "THE PARSE", its rail button reads "▸ PARSE" and TRACE's empty-state control is "trace-idle".
export const WITHHOLD = {
  "novice-floor": ["TRACE", "PARSE"],
};

/**
 * Read the console. Returns the structured observation; `render()` turns it into the agent's text.
 * @param {ReturnType<import("../ctx.mjs").makeCtx>} ctx
 * @param {{withhold?: string[]}} opts
 */
export async function observe(ctx, { withhold = [] } = {}) {
  const raw = await ctx.eval((withheldTitles) => {
    const vis = (el) => {
      if (typeof el.checkVisibility === "function") return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
      return !!(el.offsetParent || el.getClientRects().length);
    };
    const clean = (s) => (s ?? "").replace(/ /g, " ").replace(/[ \t]+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();

    const panels = [];
    for (const el of document.querySelectorAll(".panel")) {
      if (!vis(el)) continue;
      const title = (el.querySelector(".title")?.textContent ?? "").trim();
      if (withheldTitles.some((w) => title.includes(w))) continue;
      panels.push({ title, text: clean(el.innerText) });
    }

    // The affordance list: what a hand could reach right now. `data-net` keys are the stable ids
    // the scripted scenes already use; everything else is addressed by its visible label.
    const affordances = [];
    const seen = new Set();
    for (const el of document.querySelectorAll("[data-net]")) {
      if (!vis(el)) continue;
      const key = el.getAttribute("data-net");
      if (withheldTitles.some((w) => key.toLowerCase().includes(w.toLowerCase()))) continue;
      const isField = el.tagName === "INPUT" || el.tagName === "SELECT";
      affordances.push({
        target: key,
        kind: isField ? "field" : "button",
        label: clean(el.innerText || el.getAttribute("aria-label") || "").slice(0, 60),
        enabled: !el.disabled,
        ...(isField ? { value: el.value } : {}),
      });
      seen.add(el);
    }
    for (const el of document.querySelectorAll("button, .tab, [data-contract]")) {
      if (seen.has(el) || !vis(el)) continue;
      const label = clean(el.innerText).slice(0, 60);
      if (!label) continue;
      if (withheldTitles.some((w) => label.toUpperCase().includes(w.toUpperCase()))) continue;
      // Addressed by its visible label, collapsed to one line — the rail buttons render as
      // "▸\nTRACE", so splitting on the newline would give every one of them the target "▸".
      const flat = label.replace(/\s+/g, " ").trim();
      affordances.push({ target: `text:${flat.slice(0, 40)}`, kind: "button", label: flat, enabled: !el.disabled });
    }

    // The pad's typed orbit fields, kept as their own block: the driver compares the values at
    // commit against the values the game seeded when the pad opened (metrics M10, hand-aim).
    const pad = {};
    let padOpen = false;
    for (const el of document.querySelectorAll("[data-net^=param-]")) {
      if (!vis(el)) continue;
      padOpen = true;
      pad[el.getAttribute("data-net").slice("param-".length)] = el.value;
    }
    // The silhouette's slots, as words. Comparing the fit at commit against the fit the game
    // seeded when the pad opened is how "antenna cards" counts as touched without the harness
    // knowing a single card constant (metrics M2).
    const slots = [...document.querySelectorAll("[data-net^=slot-]")].filter(vis).map((el) => clean(el.innerText));

    return { panels, affordances, pad, padOpen, slots };
  }, withhold);

  const [clock, netState] = await Promise.all([ctx.probe("clock"), ctx.probe("netState")]);
  return {
    v: OBS_SCHEMA_VERSION,
    clock: clock ? { label: clock.scaleLabel, paused: clock.paused, tick: clock.tick } : null,
    missionElapsedS: netState?.tSim ?? null,
    withheld: withhold,
    ...raw,
  };
}

/** Full machine snapshot for scoring — never shown to the agent, never given to the judge. */
export async function probeAll(ctx, obs) {
  const netState = await ctx.probe("netState");
  const [trace, actions] = await Promise.all([ctx.probe("trace"), ctx.probe("actionLog")]);
  const regions = {};
  for (const c of netState?.contracts ?? []) regions[c.id] = await ctx.probe("regionProbe", c.id);
  return { missionElapsedS: netState?.tSim ?? null, netState, trace, regions, actions, pad: obs?.pad ?? {} };
}

/**
 * The state signature the stall detector compares. Deliberately excludes every clock, countdown and
 * money-per-second reading: those tick on their own, so a digest over raw text would call a wedged
 * console "changed" every turn and the detector would never fire.
 */
export function digest(obs, probes) {
  const ns = probes?.netState;
  return JSON.stringify({
    titles: obs.panels.map((p) => p.title),
    affordances: obs.affordances.map((a) => `${a.target}:${a.enabled ? 1 : 0}`).sort(),
    padOpen: obs.padOpen,
    pad: obs.pad,
    cursor: ns?.cursor ?? null,
    sats: (ns?.sats ?? []).map((s) => `${s.id}@${s.aKm}`).sort(),
    contracts: (ns?.contracts ?? []).map((c) => `${c.id}:${c.state}:${c.servedFrac > 0 ? "served" : "dark"}`).sort(),
    balanceBand: ns ? Math.round(ns.balance / 1000) : null,
    actions: (probes?.actions ?? []).length,
  });
}

/** The observation as the agent reads it. Compact: this text is paid for once per turn. */
export function render(obs, turn) {
  const head = `=== TURN ${turn} · mission clock ${fmt(obs.missionElapsedS)} · time ${obs.clock?.label ?? "?"} ===`;
  const panels = obs.panels.map((p) => `[${p.title}]\n${p.text}`).join("\n\n");
  const buttons = obs.affordances
    .filter((a) => a.kind === "button")
    .map((a) => `  ${a.target}${a.enabled ? "" : " (DISABLED)"} — ${oneLine(a.label)}`)
    .join("\n");
  const fields = obs.affordances
    .filter((a) => a.kind === "field")
    .map((a) => `  ${a.target.replace(/^param-/, "")} = ${a.value === "" ? "(blank)" : a.value}`)
    .join("\n");
  return [
    head,
    panels,
    `--- CONTROLS you can click (use the id on the left) ---\n${buttons || "  (none)"}`,
    fields ? `--- FIELDS you can set (use the name on the left) ---\n${fields}` : "",
  ]
    .filter(Boolean)
    .join("\n\n");
}

const oneLine = (s) => (s ?? "").replace(/\s+/g, " ").trim();
function fmt(sec) {
  if (sec === null || sec === undefined || !Number.isFinite(sec)) return "—";
  const s = Math.max(0, Math.round(sec));
  return `${String(Math.floor(s / 3600)).padStart(2, "0")}:${String(Math.floor((s % 3600) / 60)).padStart(2, "0")}:${String(s % 60).padStart(2, "0")}`;
}
