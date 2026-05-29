# UI Exploration v2 — mockup study (NOT a spec)

> Three exploratory mockups landed (`docs/mockups/explore-v2-*.png`): **1 OVERVIEW** (cislunar orrery + occult/blackout alarm), **2 INFRA** (datacenter L2-cache tiers + autonomy edge-policy), **5 COVERAGE** (lunar hex heatmap + ping-in-flight). They are **exploration, not source of truth** (owner's words) — a richer, more polished read of the DD-8 tiling console. This file harvests the ideas and **phases** them so the good ones land at the right milestone instead of all at once. Nothing here overrides the GDD/decisions; it's a backlog of UI direction.

## Standout ideas (and where they belong)

### NOW — fold into the post-M1 DD-9 layout/polish pass (cheap, high-value, already aligned)
- **Light-delay ISOCHRONE rings on the orrery** — concentric dotted range rings labelled in light-seconds (`0.42s / 0.84s / 1.26s`). Makes light-delay *spatially* legible; this is the direction-C overlay, and it's the single best idea here. Cheap (rings + labels around the focus body).
- **Blackout/occult as a dramatic RED state** — red dashed link + `✕ LINK LOST` badge on the map, a top **alarm banner** (`✕ FARSIDE OCCULT — link lost`), an `OCCULT ACTIVE · 11s` countdown, and a red `! ALARM …` log row. This is *exactly* the M1 blackout tension surfaced well — wire M1's `blackout_changed` signal to these.
- **Packet labelled with its light-time** (`← 1.28 s` badge on the crawling glyph) + a `PING IN FLIGHT…` progress bar. Honest light-delay made unmissable; trivial on top of the existing packet.
- **Bottom preset TAB bar** — `1 OVERVIEW · 2 INFRA · 3 MARKETS · 4 LAUNCH · 5 COVERAGE` + `TILED ‹ current ›` indicator, matching the shell's number-key presets. Plus a **richer status strip**: `❚❚ 1× 4× · LINKS · BAL · FRESH · OCCULT countdown · UTC clock`.
- **Title-bar chrome refinement** — diagonal **hatch** fill (vs plain dashes), a `●` status dot + lowercase title, a maximize/⛶ glyph. Crisper 1-bit chrome; pairs with the 1440p/maximize work.
- **Action buttons in panels** — `▶ SEND PING → MOON` style. M1 already needs place-cache/prefetch buttons; adopt this visual treatment.

### SOON — at their own milestones (the mockups preview these; don't build early)
- **Coverage hex heatmap** (geodesic cells) with `CONN / BW / LAT / OBS / FRESH` dimension tabs + a `GAP→FULL` ramp → **M2** (coverage field, GDD §4.2; roll-your-own geodesic grid per Q3).
- **Datacenter L2-cache tiers `T0–T3`** + upgrade cost + staged-dataset list, **autonomy edge-policy** (prefetch % slider, store-and-forward-through-occult toggle, `AUTONOMY ACTIVE · 1.3s round-trip authority`) → **M3** (orbital DC + autonomy, GDD §4.5/§4.6). Note: M1 already has a minimal prefetch + coherence; these are the matured UI.
- **Link-budget dB margin** (`EARTH↔L2 MARGIN -0.1 dB` red / `3.1 dB` green) → **M2** (link-budget model, GDD §4.3).
- **`3 MARKETS` preset** (broker/peering UI) → **M4** (constrained brokering, GDD §4.4).
- **Cislunar scale as a first-class view** (Earth glow + L1/L2/L4/L5 + RELAY-L2) → **M3** (cislunar tier). M1's testbed stays Earth↔Mars, but the isochrone-ring treatment applies to both scales now.

### Aesthetic notes (apply opportunistically)
- Subtle Earth atmospheric glow ring; gold/amber for the coverage dimension; cyan for the active/selected signal; red reserved for alarms (occult, negative margin). Consistent with SignalPalette + DD-1 "monochrome machine, living signal".
- Lowercase panel titles with a status dot read calmer than the current SHOUTING caps; minor, optional.

## What we keep from current build (don't regress)
The DD-8 tiling shell, the real-sim orrery + honest packet, the chrome/signal split, syntax-highlighted log, and the M1 caching loop (in flight) are the substance. These mockups are a **skin + overlay + future-panel** direction on top of that, not a rebuild.

## Sequencing
1. M1 fun-gate lands → 2. DD-9 layout/scaling pass **+ the NOW list above** (isochrone rings, blackout red state, packet light-time badge, preset/status bar, title-bar hatch) → 3. M1 playtest → 4. SOON items at M2/M3/M4 as those milestones arrive.
