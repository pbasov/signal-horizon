# UI Critique Punch-list (v2 mockups + current build)

> Concrete, ordered critique of the v2 mockups — but several items are bugs in **code already built** (M0 panels/orrery) or **sim-truth/determinism** concerns, not just mockup polish. Ordered by impact; owner-area tagged `[sim]/[render]/[ui]/[content]`.
>
> **UPDATE — the v3 mockups (`docs/mockups/v3-*.png`) resolve most of these IN DESIGN:** honest log-axis light-delay, `→` one-way / `rtt`, freshness-premium explained, system.log timestamps + severity glyphs (✓!·×, CVD-safe), Earth terminator, margin thresholds, per-preset CTAs (ping no longer the universal loud button). These are now **settled design** — the remaining work is to *implement* them in the C# build (DD-11) and judge captures against the v3 mockups. Determinism items (seeded RNG, predictable occult) are satisfied by the C# M1 model.

## ★ The two to fix first (critique's call)
1. **Light-delay bar scale is dishonest** `[ui]` — the light-delay panel. MOON 1.28s vs MARS 862s (670×) render ~3× apart (`BAR_FULL_SECONDS=1400` linear → everything sub-Mars is a stub). The one panel whose job is to make delay *magnitude* legible flattens the exact gap the game teaches. **Fix:** honest encoding — a **log axis with labelled ticks + a "log" marker**, or a clearly-scaled mapping. Not unlabeled per-row scaling.
2. **Chrome typeface drifts from §8** `[ui]` — the chrome theme uses SystemFont mono (JetBrains/DejaVu). §8 specifies a **blocky bitmap late-80s-OS display face** for chrome (+ a legible mono for data). A coding mono ≠ the retro-OS identity. (The mockup's Space Grotesk is the same drift, worse.) **Fix:** vendor a bitmap/pixel display face for titles/headers; keep a clean mono for data rows.

## MUST be right in M1 — verify when the workflow lands (don't let these ship wrong)
- **Occultation must be PREDICTABLE, not random/wall-clock** `[sim]` — the skill in store-and-forward/prefetch only exists if blackouts are *forecastable* (you see the farside pass coming and pre-stage). M1 must derive the blackout from geometry (`SignalLink.line_of_sight`) and/or a deterministic scheduled window, and surface a real **OCCULT T-… countdown**. If it's a bare wall-clock timer, prefetch becomes gambling. *(M1 prompt specified geometric LoS + `seconds_to_blackout()`; VERIFY.)*
- **Determinism of all state-affecting variation** `[sim]` — link-margin jitter, market spread drift, balance accrual, occult timing: any that affect *state* must flow through `SimRng` (P0-04), never engine RNG or wall-clock time (P0-06). Purely-cosmetic render noise is fine but must be **labelled** so it never leaks into state. *(M1 requires seeded-only; VERIFY no stray engine-RNG or wall-clock reads in the M1 sim + session layer.)*
- **Economic verbs must out-rank the tutorial verb** `[ui]` — the real loop is **place-cache, set-prefetch-policy, sell-pipe-vs-feed-mint**. "Send ping → watch packet crawl" is the *teaching hook*, not the loop — it must recede after it teaches. Don't give ping the loudest CTA. *(M1 actions are place-cache/prefetch/coherence — keep those prominent, ping recessive/absent.)*
- **Standing tension, not one-shot spectacles** `[sim/ui]` — the gate is the OpenTTD loop: demand you must *keep* served as freshness decays under you and occultations recur; success that creates its own next problem. M1's scenario must be a recurring squeeze (periodic demand + decay + looming/repeating blackout), not a single button-press climax. *(VERIFY the scenario tuning creates sustained pressure.)*

## Bugs in current built code — fix in the post-M1 polish pass
- **`↔` vs one-way convention** `[render]` — the orrery packet callout shows `↔ 1.28s` (bidirectional) in a one-way context while the log uses round-trip. Pick one: hero callout = **one-way** (`→`), reserve `↔`/`rtt` for explicit round-trip. (Packet callout label + link readout in `render/`.)
- **LINKS UP bar doesn't reflect the ratio** `[ui]` — the network/finance panel: 38/42 shows a near-full lit bar with no 4-segment gap, while the log says a link is lost. The health widget must show the damage (segmented to total, missing segments dim).
- **System.log: no timestamps + verbatim repeats** `[content/ui]` — the system-log panel. A game about time omits time. **Add timestamps — as delayed-arrival stamps** (free thematic reinforcement) — and **vary values/intervals** (no identical `margin 4.0 dB` ×3); drive from real session events where possible.
- **Log is colour-only coded → CVD-unsafe** `[ui]` — severity (info/warn/error/critical) coded purely by hue collapses under common CVD; a missed `! ALARM` is the costliest miss. **Add a non-colour channel**: a severity glyph/column (`!`/`▲`/`×`), not just colour. Per §8 this + a **fully-playable monochrome-purist mode is the accessibility FLOOR, not a tweak** — wire the `purist` path through the panels, not just the orrery shader.
- **Earth has no terminator** `[render]` — §8 specifies phase-via-dither-gradient; the body disc is uniformly lit. Add a sun-direction phase gradient to the signal/body shader. (`render/shaders/signal.gdshader`.)
- **Margin severity thresholds inconsistent** `[ui]` — same dB value shown green vs warn across frames. Define one threshold table (e.g. <0 red, 0–3 warn, >3 ok) and hold it everywhere. (Mostly M2 link-budget, but lock the thresholds now.)
- **Panels under-fill their tiles** `[ui]` — content not expanding (big gaps between rows and the CTA block; tiny floating hex). Ensure `SIZE_EXPAND_FILL` + spacers so content fills its tile (ties into the DD-9 layout pass + the "no dead quadrant" tiling-integrity rule).

## Identity / craft (post-M1 polish)
- **Casing consistency** — lowercase window titles vs UPPERCASE swaybar/tray. Pick one convention.
- **Orrery label collisions** — `PING`/isochrone labels overlap the ring labels + Earth glow. Offset labels, leader lines, or de-conflict the densest corner.

## Future milestones (the v2 mockups preview these; build at the right time)
- **Coverage legend poles per dimension** `[ui, M2]` — LAT isn't GAP↔FULL; it's fast↔slow. Each of CONN/BW/LAT/OBS/FRESH needs its own poles (LAT: LOW↔HIGH, FRESH: FRESH↔STALE). Don't reuse the CONN framing for all five.
- **Autonomy earns its own workspace** `[M3/M4]` — at Tier-2 it's correctly "basic policies tucked in INFRA"; as it scales toward Mars it likely becomes its own preset, and the "flight software, not AI" framing (§4.6) must hold when prominent.

## Strategic note (not a now-task)
Liveness is proven (the M0 "make the invisible visible" gate — the isochrone rings + freshness-saturation + diegetic log — passed resoundingly). **Fun is not yet proven** — that's the M1 gate, and the critique's core: turn verbs-you-click into a tension-you-manage. The tiling-WM bet is a deliberate niche-narrowing; **presets must be so complete that a player who never tiles still gets the whole game** — tiling is discoverable depth, never required friction.
