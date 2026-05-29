# Spike Backlog

Tracks what the spike set out to build and the state of each item. Mirrors the Godot
`docs/backlog.md` checklist style. Scope is deliberately the *minimum to answer the
question* — see `FINDINGS.md` for the verdict.

Legend: ✅ done · 🟡 partial / spike-scoped · ⛔ explicitly out of scope · ⬜ pending

## 1 · App shell
- ✅ Full-bleed dark (#0B0B12) app, no browser-default leakage, F11 bare window
- ✅ Keyboard-native preset switching (1–5) + reset (0)
- 🟡 Tauri native borderless window — **deferred** (SD-2); UX is identical webview content

## 2 · DD-10 zone-grid tiling WM (DOM)
- ✅ Zone-grid model (1–3 cols × 1–3 rows, relative weights, always-tiled invariant)
- ✅ OVERVIEW + OPS presets as data (+ TRACK / STREAM / SPLIT to fill 1–5)
- ✅ Title-bar drag → zone **swap** (drop-target overlay, ghosted source, zones only)
- ✅ Edge-resize by dragging gutters (relative weights, adjacent-only)
- ✅ Always-tiled invariant enforced (`validate()` gate; swap is a permutation)
- ✅ 1-bit chrome: white-on-#0B0B12, runtime Bayer dither (CSS), monospace placeholder font
- 🟡 Tab / Split / Close — modelled in the data shape, not gesture-wired (SD-6)

## 3 · Three.js orrery (make-or-break)
- ✅ Sun + Earth + Mars on correct elliptical orbits (ported Kepler, real `system.json`)
- ✅ LEO (53° inclined) + GEO (equatorial) sats — orbital planes read clearly
- ✅ Body-anchored orbit camera (drag az/el, wheel zoom, R reset)
- ✅ Four animated camera presets: CISLUNAR / ORBITS / SYSTEM / TOP-DOWN
- ✅ Packet crawling Earth→Mars at honest light-speed on sim time; progress == readout
- ✅ Freshness-as-saturation (packet amber → machine-grey; freshness gauge)
- ✅ Dashed orbit rings (sampled from the ephemeris)
- ✅ Dithered circle billboards (Bayer 4×4 terminator stipple) + Sun halo
- ✅ Floating-origin f64→f32 rebase + per-preset log-compression (SD-5)
- ✅ Moon included (cislunar reads); body labels

## 4 · Status strip (always visible)
- ✅ Sim time, time scale (1×/10×/100×/1000× + pause), Earth→Mars light-delay readout
- ✅ Focus body, camera preset, WM preset, preset hotkey tabs, occult alarm cell

## 5 · SYSTEM.LOG panel
- ✅ Monospace terminal, severity syntax highlighting (info/warn/error/crit + glyphs)
- ✅ Scrollable, 1-bit frame, capped ring buffer (400 lines), auto-scroll
- ✅ Fed by sim events: packet launched/arrived (real), conjunction/occult, scripted feed

## 6 · Sim truth layer (TS port)
- ✅ Kepler ephemeris ported (8-iter Newton, 3-1-3, recursive parents) — bit-identical to C#
- ✅ Vitest pin vs C# golden master (+ 13 corroborating structural assertions)
- ✅ Light delay (d/c) + freshness; line-of-sight occlusion geometry; sim clock

## Out of scope (per brief)
- ⛔ Rust sim backend / Tauri IPC (math hardcoded in TS)
- ⛔ Save/load, real economy / M1 mechanics
- ⛔ Coverage heatmap, finance panel
- ⛔ Porting `SignalHorizon.Sim` wholesale

## Adversarial review (2026-05-29) — 7 confirmed findings, all fixed
- ✅ Orrery hot loop allocated ~960 `Vector3`/frame → scratch vectors + direct `Float32Array` writes
- ✅ Terminator sun-direction computed in log-compressed space (8–21° off for off-focus bodies) → uncompressed
- ✅ WM gesture listeners could stack on overlapping pointerdowns → gesture-active guard + `destroy()`
- ✅ `freshness()` degenerate-halfLife branch diverged from C# → matches `ageSeconds <= 0 ? 1 : 0`
- ✅ Edge-resize divider drifted from cursor by `frac·gutter` → gutter-excluded span
- ✅ Drag hit-test used a stale snapshot on mid-drag relayout → hit-tests the live layout
- ✅ Orrery titlebar lamp hardcoded `ok` → reflects Earth→Mars occult
- (14 further raw findings were adversarially rejected as non-issues / style nits)

## Follow-ups if this graduates past a spike
- ⬜ Wrap in Tauri and re-validate under WebKitGTK (WebGL2 / dither / fonts) — SD-2
- ⬜ Hide far/parent orbit rings in near-field presets (ORBITS shows stray distant dashes)
- ⬜ Wire Tab/Split/Close gestures; port the WmModel unit tests to Vitest
- ⬜ Port the fixed-tick clock + (optionally) run the headless C# sim as a state source
- ⬜ Pool the ephemeris `Vec3` array returns too (the truth-layer port still allocates small arrays)
