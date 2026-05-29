# Tiling WM Spec — zone-grid + mouse zone-snapping (DD-10)

> The Ops Console's window manager. Synthesis of the owner's requirements (mouse-driven, KDE/Windows zone-snapping, presets-as-gameplay-loops) + the design critique. **Decision: it's a *feature, but a shallow one*** — most players rearrange, few deeply tile. So we build **curated freedom** (zone-grid + snapping + great presets), NOT sway's full generality. This supersedes the M0 `HSplit/VSplit` shell. **Status: ACCEPTED (DD-10).**

## Layout model — a constrained ZONE GRID (not a binary-split tree)
- **Canvas** = area inside the swaybar/status strip. Divided **column-first**: **1–3 columns**, each subdividable into **1–3 rows**. That's the ceiling — enough for ~7 panels, no deeper nesting. (The v2 mockup's 2-col / 1-row-left / 3-row-right is expressible.)
- **One panel per zone**, OR a zone holds a **tab group** (stacked panels, 1-bit tab strip on top) — this absorbs "more panels than zones" with no occlusion.
- **Gaps + outer margin are theme-fixed**, not player-adjustable (one tasteful value).
- **ALWAYS-TILED INVARIANT — no empty zones, ever.** N zones ⇒ N panels (or tab groups). Closing a panel reclaims its zone (neighbours expand / slot collapses). This is enforced on every op (close/swap/split/resize). Fixes the dead-quadrant.

## Zone-snapping — the mouse-driven core (KDE/FancyZones borrow)
1. **Drag a panel's title bar** (no modifier for the common case).
2. On drag-start the canvas shows a **zone overlay**: only *legal* target zones light up as outlined drop-regions; the dragged panel ghosts at reduced opacity. (The overlay appearing *is* the tutorial — self-teaching.)
3. Hover a zone → strong highlight (the white-border focus treatment).
4. Release → snap. Occupied zone ⇒ **SWAP** the two panels (predictable, mentally undoable; never overlay/push).
5. Drop onto a zone's **title-strip** (not its body) ⇒ join as a **TAB** in that zone.
6. **Shift-drag** = fidelity escalation → reveals **sub-zone** drop targets; dropping **splits** a zone into a new row/col (your "still drag it into boxes"). Coarse (whole zones) by default; fine (create-split) on Shift.
7. **Edge-resize**: hover the gap between two zones → resize cursor → drag the one divider to repartition (cheap because the grid constrains it). The most-wanted "make the orrery bigger" affordance.
- **Keyboard parity** (mouse is primary): `mod+hjkl` move focus, `mod+shift+hjkl` move panel, `1–5` switch preset, `f` fullscreen-focus, `Esc` restore, `0` reset.

## Presets — the real work (a preset = a workspace for a decision)
Principles (load-bearing):
- A preset is **designed around a specific decision the player is making** — never a panel-salad with a label. Each answers: *what is the player deciding here, and what's the minimum panel set with nothing extraneous?*
- **The hero panel (largest zone) earns its size from the task** (spatial triage ⇒ orrery; gap-finding ⇒ heatmap). If two presets have the same hero at the same size, **merge them**.
- **Each preset foregrounds its verb's CTA and demotes others** — this is per-preset, not global. (Fixes "SEND PING is the loudest button everywhere": ping is loud in OVERVIEW where you *learn* delay, recessive in MARKETS where the loud button is capture-spread.)

### Target preset set — **5, pinned by the v3 mockups** (`docs/mockups/v3-1..5-*.png`)
The owner's v3 mockups fully realize the five preset loops — superseding my earlier 5→4 merge proposal. INFRA and COVERAGE both feature the hex heatmap but are genuinely distinct: **INFRA *acts*** (heatmap + datacenter tiers + autonomy/prefetch policy), **COVERAGE *reads*** (full-bleed heatmap + dimension tabs + light-delay/log). Each frame is its preset; treat the v3 mockups as the definitive visual + layout target for the C# UI build.

| # | Preset | Decision it serves | Hero (largest) | Foregrounded CTA (per-preset) | Content milestone |
|---|---|---|---|---|---|
| 1 | **OVERVIEW** | "Is anything wrong right now?" — triage | Orrery (cislunar, live; occult-zone + isochrone + margin) | `SEND PING → MOON` (teaching verb) | **M0/M1 — real now** |
| 2 | **INFRA** | "Where do I place/upgrade caches & DCs, tune prefetch/autonomy?" | Coverage heatmap (CONN) + DATACENTER·L2 tiers + AUTONOMY·edge policy | `UPGRADE → T2`, prefetch slider, store-and-forward toggle | partial now (caching) → M2/M3 |
| 3 | **MARKETS** | "Sell the pipe or feed the mint? Broker what?" | BROKER·ARBITRAGE (bid/ask/spread book) | `CAPTURE SPREAD · ARBITRAGE FILL` | M4 |
| 4 | **LAUNCH** | "Which window, payload, risk?" | LAUNCH·PAD OPS (manifest/window/cost) | `▲ COMMIT LAUNCH` | M2/M4 |
| 5 | **COVERAGE** | "Where are my gaps, in which dimension?" | COVERAGE·NEARSIDE hex heatmap, full-bleed, CONN/BW/LAT/OBS/FRESH tabs | switch-dimension, inspect-cell | M2 |

The v3 mockups also resolve most of `ui-critique-punchlist.md` **in design** (honest log-axis light-delay, → one-way/rtt, freshness-premium explained, system.log timestamps + severity glyphs, Earth terminator, margin thresholds). The engineering still must *implement* these in the C# build, but the design is settled — judge captures against `docs/mockups/v3-*.png`.

### Real-now preset set (what we build with today's content — M1)
Only two genuinely distinct workspaces exist with real content:
- **OVERVIEW** (read/triage): orrery hero + light-delay + network·finance + system.log. Ping prominent (teaching delay).
- **OPS** (act/caching — the M1 verb screen, the INFRA precursor): the Earth↔Mars caching loop is the M1 game. Orrery hero (you act on the route) + **place-cache / prefetch / coherence** CTAs foregrounded + finance + light-delay supporting. This is where the player *manages the standing tension* (the OpenTTD squeeze), not just reads it.

The engine ships with these two as data; MARKETS/LAUNCH (and INFRA's heatmap) are framework-ready stubs that populate as M2/M3/M4 content lands.

## State / behaviour requirements
- **Preset = serializable zone-map + panel→zone assignment** (`data/layouts/*` — data, not code). Switch re-tiles instantly.
- **Per-preset edits remembered** (nudge the orrery bigger in OVERVIEW → persists for OVERVIEW); **per-preset reset + global reset are mandatory** (players wreck layouts).
- **Focus**: one focused tile (inverted title bar), click/Tab to move; keyboard verbs land on it.
- **Fullscreen-focus** (`f`) + Esc.
- **Always-tiled invariant** enforced on every op.
- **Tab groups** for overflow; tab strip 1-bit chrome, body carries coloured signal.
- **Responsive floor**: below a canvas width, degrade to fewer columns / more tab-stacking — never shrink panels into illegibility.
- **Discoverability**: zone overlay on drag-start is the tutorial; a one-time hint ("drag a title bar to rearrange · Shift-drag to split") on first tile focus.

## Explicitly NOT building (scope discipline)
- No binary-split tree / arbitrary nesting (1–3 col × 1–3 row is the ceiling).
- No player-configurable gaps/borders/animations (beyond the monochrome/CRT toggle).
- No floating-window mode (zone-snapping gives "put it here" without reintroducing occlusion).
- No multi-monitor / detach-to-second-screen (post-1.0).
- No arbitrary user-named custom workspaces beyond the preset set (v1 = "edit the presets, reset the presets").

## Engineering note
The engine is **content-agnostic** (presets are data) — building it does not wait on finalising the preset *content*. It supersedes the M0 `OpsShell` but MUST preserve the public API (`Inject`/`GetHostBody`/`GetHostPane`/`SetStatus`/`SetPreset`/`ResetLayout`/`CurrentPreset`/`HOST_*`/`PresetChanged`) so the ops-console scene + the M1 panels keep working unchanged. Visual feel (overlay tint, ghost, snap) needs run+screenshot iteration after the headless build.
