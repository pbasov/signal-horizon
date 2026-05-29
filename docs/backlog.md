# SIGNAL HORIZON — Ticket Backlog (trackable)
### Companion to implementation-plan-v0.1 + scoping-v0.1

> The plan is the *prose spec*; this is the *checklist*. Tickets are paste-ready for GitHub Issues / Linear. Tick `[x]` when the "Done when" (in the plan) is met. Sizes: `S`≈≤1d · `M`≈2–4d · `L`≈1–2wk · `XL`≈multi-week · `SPIKE`=time-boxed, produces a written conclusion. Scoping notes (`▸`) flag where scoping refined the plan.

**Status legend:** `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cut/deferred

---

## 🔁 BUILD TRACK — TypeScript / Three.js (browser)

> The project runs in the browser (SD-2). The spike (see `FINDINGS.md`) proved the UX builds at least as naturally in the web stack with no fidelity loss and dramatically faster iteration. The C# Godot project's design docs (GDD, tiling-WM spec, UI critique) remain the design authority; this backlog reflects the *current* TS stack.
>
> **Key status:** the spike demonstrated the full M0 visual/UX scope. Phase 0 foundations and M0 are "done in spike" — save/replay (P0-05/06) still needs production implementation. WebKitGTK validation is no longer a gate (SD-2).

**Build phases (live status):**
- [x] **PA — pure sim (TypeScript port)** — `src/sim/ephemeris.ts` (8-iter Newton → perifocal → 3-1-3 → recursive parent); bit-identical to the C# golden master. Light delay, freshness, LoS occlusion all ported. **Vitest pin + 13 structural assertions green.**
- [x] **PB.1 — Vite dev shell** — `npm run dev` via Vite + HMR; full-bleed dark app, no browser leakage, keyboard-native preset switching.
- [x] **PB.2 — M0 money-shot mechanics** — floating-origin f64→f32 rebase + sim-driven orrery + honest Earth→Mars packet crawl matching the on-screen readout. Packet progress == light-delay readout. **Verified headful in Chromium.**
- [x] **PB.2r — orrery in 3D + camera-only views** — body-anchored orbit camera + 4 animated presets (CISLUNAR / ORBITS / SYSTEM / TOP-DOWN). LEO inclined + GEO equatorial planes read in 3D. Dashed rings, dithered Bayer 4×4 billboards, freshness-as-saturation.
- [x] **PB.3 — tiling WM shell + 1-bit chrome** — DD-10 zone-grid in the DOM (1–3 cols × 1–3 rows, relative weights, always-tiled invariant). Title-bar drag → zone swap, edge-resize, 5 presets (OVERVIEW / OPS / TRACK / STREAM / SPLIT) switched by keys 1–5. Runtime Bayer dither via CSS custom properties. Monospace placeholder font.
- [x] **PB.4 — panels** — SYSTEM.LOG (severity syntax highlighting + glyphs, scrollable, ring-buffer), telemetry readout, status strip (sim time, time scale, light-delay, focus, presets, occult).
- [x] **PC — deterministic backbone (TS)** — fixed-tick integer clock ✅ (P0-03), seeded RNG ✅ (P0-04), action-log pending (P0-05/06).
- [ ] **PD — M1 economy integration** — demand, caching, prefetch, economy, finance panel. Wire to the fixed-tick sim clock. The M1 fun-gate playtest.
- [ ] **CI** — GitHub Actions: `npm test` (vitest) + Playwright screenshot CI.

---

## Pre-flight (must precede everything)

- [x] **GIT-00** Init git repo + commit current tree as baseline
- [x] **DEC-00** Confirm decisions D1–D3, D7; establish the sim/ purity rule
- [x] **SD-1..11** Spike decisions recorded (see `decisions.md`)

---

## Phase 0 — Foundations

> **Status: substantially done. Deterministic clock (P0-03) and seeded RNG (P0-04) are done; save/replay (P0-05/06) remains.**

**Spikes**
- [x] **P0-S1** Pin stack versions (Node + Three.js + Vite) — *SPIKE S*
- [x] **P0-S2** Sim-core language — *SPIKE S* · RESOLVED: TypeScript. `src/sim/` is pure TS with zero DOM/Three.js imports. Bit-identical to C# golden master (SD-3).
- [x] **P0-S3** Test & CI tooling — *SPIKE S* · Vitest + Playwright headful. Green.

**Project & repo**
- [x] **P0-01** Repo + module folders — done (`src/sim/ src/orrery/ src/wm/ src/panels/ data/`)
- [x] **P0-02** CI — vitest green; Playwright screenshot CI pending setup

**Deterministic core backbone**
- [x] **P0-03** Authoritative sim-clock + fixed-step tick — *M* · Integer fixed-step clock implemented in `src/sim/clock.ts`. Tick accumulator, `scheduleWall()`/`nextTick()` drain pattern, `DT = 1/60` s. Death-spiral clamp. `setTick()` for save/load. 12 Vitest tests green.
- [x] **P0-04** Seeded RNG abstraction — *S* · Splitmix64 ported to TS via `bigint` in `src/sim/rng.ts`. Golden values cross-verified bit-identical against C# `SimRng`. 11 Vitest tests green. No `Math.random()` in `src/sim/`. D4 resolved → bigint for spec-defined portability.
- [ ] **P0-05** Action-log + state-snapshot save format — *M* · JSON, versioned; port the C# `SaveGame` shape. Pure `src/sim/`, no DOM state.
- [ ] **P0-06** Determinism / replay golden-master test — *M* · Vitest harness that replays a recorded action log and asserts state hash. **Most valuable test — write before M1 sim gets complex.**

**Rendering & styling backbone**
- [x] **P0-07** Floating-origin scene manager — done in `src/orrery/orrery.ts` (f64 subtract → f32 cast; per-preset log-compression; constant-screen-size billboards).
- [x] **P0-08** 1-bit chrome theme + signal-layer styling split — done. CSS dither for chrome; Three.js coloured signal path with freshness-as-saturation; Bayer 4×4 terminator stipple in GLSL.

---

## Milestone 0 — Sim spike + the visible web

> **Status: SPIKE-DONE.** The full M0 scope was built and verified headful in Chromium. See `docs/screenshots/` and `FINDINGS.md`.

**Orbital sim core (truth layer)**
- [x] **M0-01** f64 Keplerian element model — done (`src/sim/ephemeris.ts`, parent hierarchy)
- [x] **M0-02** Analytic Kepler propagation `position(body,t)` — done (8-iter Newton, 3-1-3, recursive parent; bit-identical to C#)
- [x] **M0-03** Earth-orbit satellite propagation — done (LEO 53° + GEO equatorial in `data/system.json`)
- [x] **M0-04** Solar system dataset — done (Sun/Earth/Moon/Mars + sats; symlink to Godot project's file — SD-4)

**Render layer (orrery)**
- [x] **M0-05** Orrery: bodies + orbits (1-bit field, coloured signal) — done (Bayer 4×4 billboards, dashed rings, sim-driven via floating origin)
- [x] **M0-06** LOD / icon collapse — done (constant-screen-size billboards with min-icon clamp)
- [x] **M0-07** Camera + selection — done (body-anchored orbit camera + 4 animated presets)
- [x] **M0-08** Time controls UI — done (1×/10×/100×/1000× + pause in status strip)

**The visible signal**
- [x] **M0-09** Link model + line-of-sight + distance — done (LoS occlusion in `src/sim/links.ts`)
- [x] **M0-10** Light-delay computation + display — done (`SignalDelay.oneWaySeconds`, readout in telemetry)
- [x] **M0-11** Packets-in-flight rendering — done (packet crawls Earth→Mars at honest light-speed; on-screen progress == readout)
- [x] **M0-12** Freshness-as-saturation — done (packet amber → machine-grey; freshness gauge in telemetry)

**Exit:** ✅ MET — money shot reads: orrery with Earth/Mars on dashed rings, coloured packet honestly crawling, in 1-bit tiling shell. Vitest green. See `docs/screenshots/`.

---

## Milestone 1 — THE FUN GATE (kill-gate)

> Build order: 01+02 → 03+08 → 04→05→06 → 07 → 09/10/11 → 12 + telemetry.
> **All M1 tickets NEED-PORT** from C#; the spike has no economy layer.

**Minimal demand & serve-or-starve**
- [ ] **M1-01** One demand source w/ freshness requirement — *S* · piecewise 3-band price
- [ ] **M1-02** Feasible-path check — *S* · single Earth↔Mars LoS check
- [ ] **M1-03** Serve / miss / stale resolution — *M* · fresh/stale/miss/blackout-miss

**Caching / prefetch loop (the actual core)**
- [ ] **M1-04** Cache node placement — *M* · cache @ Mars; one slot, no eviction
- [ ] **M1-05** Cache hit / miss logic — *M* · miss = visible pending wait + countdown
- [ ] **M1-06** Predictive prefetch action — *M* · manual prefetch = what fills the wait
- [ ] **M1-07** Coherence level (simplified) — *S* · two levels

**Minimal economy + one dashboard + one map**
- [ ] **M1-08** Cash, simple revenue & opex — *S* · bankruptcy on `balance<0`
- [ ] **M1-09** Single finance panel (mono chrome, coloured data) — *S* · live NETWORK·FINANCE
- [ ] **M1-10** Glanceable map readout — *S* · Mars freshness drain + fetch packet/countdown
- [ ] **M1-11** Cache-hit audio cue — *S* · first audio; Web Audio API
- [ ] **M1-12** 30-minute scenario script — *S* · scripted conjunction; pre-position-to-survive
- [ ] **M1-GATE** Playtest instrumentation — *S–M* · telemetry action log + event stream + gate metrics

**Gate:** ≥5 testers cold. PASS = unprompted cache/prefetch tuning + tension around conjunction + can articulate why interesting. FAIL = iterate visualization+core only; 3 failed iterations ⇒ rethink premise.

---

## Milestones 2–6 (headlines only — detail after M1 PASS)

- [ ] **M2 — Earth tycoon vertical slice:** coverage grid, coverage field, link budget, placeable assets, launch market, contracts state machine, escalation engine, emergent-event generator v1, one coverage heatmap.
- [ ] **M3 — Cislunar on-ramp:** Moon + L-points, first orbital datacenter, basic autonomy policies, observation contracts, light-delay teaching beat, DC thermal model.
- [ ] **M4 — Interplanetary (the game becomes itself):** Mars + synodic windows, patched-conic planner, conjunction blackouts, full caching/prefetch/coherence, edge-processing DCs, autonomy tiers, constrained brokering.
- [-] **M5 — Outer system + DTN** *(post-1.0)*
- [-] **M6 — Optional information-economy endgame** *(post-1.0)*

---

## Cross-cutting (continuous from P0)

- [x] **X-01** Determinism & replay — fixed-tick clock ✅ (P0-03), seeded RNG ✅ (P0-04); golden-master green every milestone; +1 replay fixture per milestone.
- [ ] **X-02** Performance budget — GC allocation pools in Three.js (scratch vectors + direct Float32Array writes — proven in spike review); event-driven route re-solve; headless perf benchmark M2–M3; budget real before M4.
- [ ] **X-03** Accessibility — chrome/signal split + CVD-safe palette + purist toggle. "Colour-off fully playable" = per-milestone exit check.
- [ ] **X-04** Save/load robustness — JSON-serialisable from pure `src/sim/`; versioned saves + migration hook; fast snapshot load.
- [ ] **X-05** Audio system — Web Audio API; one-way event-bus → cues. Placeholder at M1-11; health-sonification M2+.
- [ ] **X-06** Content pipeline — `data/` JSON from M0-04; migrate each mock's constants as its real system lands; CI schema validation.

---

## Spike-specific findings (adversarial review, 2026-05-29)

All 7 findings fixed:
- ✅ Orrery hot loop allocated ~960 `Vector3`/frame → scratch vectors + direct `Float32Array` writes
- ✅ Terminator sun-direction computed in log-compressed space → uncompressed
- ✅ WM gesture listeners could stack on overlapping pointerdowns → gesture-active guard + `destroy()`
- ✅ `freshness()` degenerate-halfLife branch diverged from C# → matches `ageSeconds <= 0 ? 1 : 0`
- ✅ Edge-resize divider drifted from cursor by `frac·gutter` → gutter-excluded span
- ✅ Drag hit-test used a stale snapshot on mid-drag relayout → hit-tests the live layout
- ✅ Orrery titlebar lamp hardcoded `ok` → reflects Earth→Mars occult

---

## Follow-ups

- ⬜ Hide far/parent orbit rings in near-field presets (ORBITS shows stray distant dashes)
- ⬜ Wire Tab/Split/Close gestures in the WM
- ⬜ Port the WmModel unit tests to Vitest
- ⬜ Pool the ephemeris `Vec3` array returns (truth-layer still allocates small arrays)
- ⬜ Save/replay backbone (P0-05/06)

---

*Keep `[x]` honest — tick only when the plan's "Done when" is actually met. Re-detail M2+ after the M1 gate.*
