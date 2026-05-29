# SIGNAL HORIZON — Implementation Plan & Ticket Backlog
### v0.2 · companion to GDD v0.7

> Engineering plan, priorities, and sequencing. This is the *how/when*; the GDD is the *what/why*. Where they disagree, the GDD wins on design and this doc wins on sequencing.
>
> **v0.2 supersedes v0.1.** v0.1 was written for a Godot/GDScript build, pre-spike, with everything ahead of it. Since then: the project **moved to TypeScript + Three.js + Vite, browser-native** (GDD §6), a spike proved the full M0 visual/UX scope, and **Phase 0 + M0 are substantially done**. The live frontier is **M1 — the fun-gate.** This plan reflects that reality and the current ticket backlog.

---

## 0. How to read this

- Work groups into **Phase 0 (foundations)**, **build phases PA–PD** (the spike→production track), and **Milestones M0–M6** (GDD §9). Phase 0 / M0 map onto PA–PC; M1 is PD; M2+ are post-gate.
- **Detail is front-loaded.** Done work is summarised; the live frontier (M1/PD) and its gate are specified tightly; M2–M4 are headlines; M5–M6 are post-1.0 sketches.
- **The single most important fact in this plan is unchanged from v0.1: M1 is a kill-gate.** Its only job is to answer *"is watching and optimising light-delayed information flow fun for 30 minutes with no narrative?"* If M1 fails its playtest, the correct action is to iterate the visualization/core or stop — **not** to build M2.

**Sizing legend:** `S` ≈ ≤1 day · `M` ≈ 2–4 days · `L` ≈ 1–2 wk · `XL` ≈ multi-week, decompose first · `SPIKE` = time-boxed, produces a written conclusion.

**Status:** `[ ]` todo · `[~]` in progress · `[x]` done · `[-]` cut/deferred · `[spike]` proven in spike, needs production hardening.

---

## 1. Where the project actually is (snapshot)

**Done and proven (spike + production):**
- **Stack chosen and validated** — TypeScript + Three.js (WebGL2) + Vite, browser-native (Chromium). One language across sim, WM, panels, and the 3D view. (GDD §6.)
- **Pure sim ported** — `src/sim/` is dependency-free TypeScript: analytic Kepler ephemeris (8-iter Newton → perifocal → 3-1-3 → recursive parent), light-delay, freshness, LoS occlusion. **Bit-identical to the prior C# golden master**; Vitest green.
- **Deterministic backbone, mostly** — integer fixed-step clock (`DT=1/60`, death-spiral clamp, `setTick` for save/load) and seeded splitmix64 RNG (via `bigint`, golden-cross-verified) are done. **Save/replay (action-log + golden-master replay test) is the one piece still owed.**
- **The M0 money shot is real** — floating-origin f64→f32 rebase, sim-driven 3D orrery (LEO 53° + GEO planes read; dashed rings; Bayer-4×4 dithered billboards; freshness-as-saturation), and an honest Earth→Mars packet crawl whose on-screen progress equals the light-delay readout. Verified headful in Chromium.
- **Tiling WM + 1-bit chrome** — DD-10 zone-grid in the DOM (1–3 cols × 1–3 rows, relative weights, always-tiled invariant, title-bar-drag swap, edge-resize, 5 presets on keys 1–5). SYSTEM.LOG with severity syntax-highlighting + glyphs, telemetry readout, status strip.

**The live frontier:** **M1 economy integration (PD)** — none of the demand/caching/economy layer exists yet; the spike has no economy. This is the next build and it is the gate.

**Still owed before/around the gate:** save/replay backbone (P0-05/06), CI (Vitest + Playwright screenshots), and the M1 telemetry instrumentation.

---

## 2. Engineering principles (locked)

1. **The sim is pure and headless.** `src/sim/` imports nothing from `three`, the DOM, or WebGL. It runs under Vitest with no browser. This is what makes determinism, testing, fast-forward, and a possible future server authority real. Any import across that boundary is a build-breaking mistake (enforced by review + DOM-free tests).
2. **Determinism first.** Same seed + same ordered action log → identical state. Integer fixed-step clock; seeded RNG only; no `Date.now()` or `Math.random()` in `src/sim/`; time-accel scales *how many fixed steps run per frame*, never `DT` or constants. The replay golden-master (P0-06) enforces it.
3. **Truth is f64; the render lie is f32.** Sim state is native `number` (f64). Conversion to `Float32Array`/`Vector3` happens *only* at the floating-origin rebase in `src/orrery/`. Three.js `Vector3` is f32 — truth never touches it.
4. **No UI framework.** Imperative DOM + Three.js, frame loop `raf → sim.tick() → orrery.update(state) → render()`. No React/Vue/Svelte, no vdom, no reconciliation. (Full rationale in GDD §6 — GPU draw calls a framework can't schedule, everything-changes-every-frame defeats reconciliation, GC pressure competes with the frame budget.)
5. **Watch the allocations.** Three.js's easy path allocates (the spike review caught ~960 `Vector3`/frame). Hot loops reuse scratch vectors and write straight into `Float32Array`. This is a standing discipline, not a one-time fix.
6. **Vertical slices, not horizontal layers.** One excellent view/loop end-to-end before widening. One excellent dashboard per milestone (GDD §5).
7. **Test the fun before the depth.** The cheapest thing that answers "is this fun?" beats the correct thing that takes a month. M1 is engineered around exactly this.

---

## 3. Critical path

`Phase 0 (done) → M0 spike (done) → PC deterministic backbone (save/replay owed) → ` **`PD = M1 fun-gate (STOP/GO)`** ` → M2 Earth slice → M3 cislunar on-ramp → M4 interplanetary (the game becomes itself) → post-1.0 (M5 outer/DTN, M6 information economy).` Cross-cutting epics run continuously. **Do not start M2 until M1 passes its gate.**

---

## 4. Build phases (PA–PD) — the spike→production track

- [x] **PA — pure sim (TS port).** `src/sim/ephemeris.ts` + light-delay + freshness + LoS, bit-identical to C# golden master, Vitest green.
- [x] **PB.1 — Vite dev shell.** `npm run dev` + HMR, full-bleed dark app, keyboard-native preset switching.
- [x] **PB.2 — M0 money-shot mechanics.** Floating-origin rebase + sim-driven orrery + honest packet crawl == readout. Verified headful.
- [x] **PB.2r — orrery in 3D + camera presets.** Body-anchored orbit camera, 4 animated presets (CISLUNAR / ORBITS / SYSTEM / TOP-DOWN), inclined/equatorial planes read, freshness-as-saturation.
- [x] **PB.3 — tiling WM + 1-bit chrome.** DD-10 zone-grid, drag-swap, edge-resize, 5 presets, CSS Bayer dither.
- [x] **PB.4 — panels.** SYSTEM.LOG (severity highlight + glyphs, ring-buffer), telemetry, status strip.
- [~] **PC — deterministic backbone (TS).** Clock ✅ + RNG ✅; **action-log + replay golden-master (P0-05/06) owed.**
- [ ] **PD — M1 economy integration.** Demand, caching, prefetch, economy, finance panel, scenario, telemetry → **the fun-gate.** (Detailed in §6.)
- [ ] **CI.** GitHub Actions: `npm test` (Vitest) + Playwright screenshot CI.

---

## 5. Phase 0 — Foundations (status)

**Spikes** — all resolved.
- [x] **P0-S1** Pin stack versions (Node + Three.js + Vite).
- [x] **P0-S2** Sim-core language → **TypeScript** (`src/sim/` pure, bit-identical to C# golden master).
- [x] **P0-S3** Test/CI tooling → Vitest + Playwright headful.

**Deterministic core backbone**
- [x] **P0-03** Integer fixed-step clock — `src/sim/clock.ts` (accumulator, drain pattern, `DT=1/60`, death-spiral clamp, `setTick`). 12 tests green.
- [x] **P0-04** Seeded RNG — splitmix64 via `bigint` in `src/sim/rng.ts`, golden-cross-verified, no `Math.random()` in `src/sim/`. 11 tests green.
- [ ] **P0-05** Action-log + state-snapshot save format — *M* · JSON, versioned, pure `src/sim/`, no DOM state. **Owed.**
- [ ] **P0-06** Determinism / replay golden-master — *M* · Vitest harness replays a recorded action log, asserts a state hash against a stored golden. **The most valuable test in the project — write it before the M1 economy makes the sim complex.** **Owed, and it should land before/at the start of PD.**

**Rendering & styling backbone**
- [x] **P0-07** Floating-origin scene manager — `src/orrery/` (f64 subtract → f32 cast; per-preset log-compression; constant-screen-size billboards).
- [x] **P0-08** 1-bit chrome theme + signal-layer split — CSS dither chrome; Three.js coloured-signal path; freshness-as-saturation; GLSL Bayer terminator stipple.

**Project/repo**
- [x] **P0-01** Repo + module folders (`src/sim/ src/orrery/ src/wm/ src/panels/ data/`).
- [~] **P0-02** CI — Vitest green; **Playwright screenshot CI pending.**

---

## 6. Milestone 1 — THE FUN GATE (= build phase PD; the live work)

*The spike has no economy. Everything here is greenfield TS, built on the proven sim/orrery/WM. Build order: 01+02 → 03 → 04→05→06 (the core; prototype 05's visible pending-wait first) → 07 → 08/09/10 → 11 → 12 + telemetry. Land P0-05/06 first so the economy is born deterministic.*

**Minimal demand & serve-or-starve**
- [ ] **M1-01** One demand source w/ freshness requirement — *S* · piecewise 3-band price (fresh/stale/miss).
- [ ] **M1-02** Feasible-path check — *S* · single Earth↔Mars LoS check; NO routing solver yet.
- [ ] **M1-03** Serve / miss / stale resolution — *M* · fresh/stale/miss/blackout-miss; primary telemetry tap.

**Caching / prefetch loop (the actual core)**
- [ ] **M1-04** Cache node placement — *M* · cache @ Mars; one slot, no eviction.
- [ ] **M1-05** Cache hit / miss logic — *M* · miss = a *visible pending wait* (the crawling packet) + countdown. *(Prototype this visible-wait first; it's the heart of whether the loop reads as fun.)*
- [ ] **M1-06** Predictive prefetch action — *M* · manual prefetch = what fills the wait (the §3 "waiting is gameplay" beat).
- [ ] **M1-07** Coherence level (simplified) — *S* · two levels, distinct €/latency profile.

**Minimal economy + one dashboard + one map**
- [ ] **M1-08** Cash, simple revenue & opex — *S* · bankruptcy on `balance < 0`.
- [ ] **M1-09** Single finance panel (mono chrome, coloured data) — *S* · live NETWORK·FINANCE; this is the M1 "one excellent dashboard."
- [ ] **M1-10** Glanceable map readout — *S* · Mars freshness drain + fetch packet/countdown + blackout on the orrery (the Mini-Metro at-a-glance test).
- [ ] **M1-11** Cache-hit audio cue — *S* · first audio via Web Audio API; healthy vs staling network *sounds* different.
- [ ] **M1-12** 30-minute scenario script — *S* · scripted conjunction (predictable, not random); pre-position-to-survive.
- [ ] **M1-GATE** Playtest instrumentation — *S–M* · telemetry action log + event stream + gate metrics.

### The gate (unchanged from v0.1)
≥5 testers cold. **PASS** = unprompted cache/prefetch tuning in response to delay + tension around the conjunction blackout + can articulate *why it was interesting*. **FAIL** = wait-and-click / ignore the delay / "a spreadsheet" → iterate **visualization + core only** (GDD Risk 2), re-run; 3 failed iterations ⇒ rethink the premise. **Do not start M2 until PASS.**

---

## 7. Milestones 2–6 (headlines — detail after M1 PASS)

- [ ] **M2 — Earth tycoon vertical slice:** geodesic coverage grid (roll-your-own, no H3 dep), coverage field, link budget, placeable assets, launch *market*, contracts state machine, the escalation engine (success→congestion), emergent-event generator v1 (rival operators, news shocks), one coverage heatmap. **Plus the first leverage + topology beats:** **Level-1 routing policy + the trace view** (GDD §4.3a/§5) seed here — cheap on top of the solver, and they're the floor of both the topology and `mtr` systems. **Goal: is the loop fun across a full session at Tier 1?**
- [ ] **M3 — Cislunar on-ramp:** Moon + L-points, first orbital datacenter (power/cooling/compute), basic autonomy policies (the first rung of the leverage curve, GDD §4.11), observation contracts, the light-delay teaching beat (~1.3s), DC thermal model.
- [ ] **M4 — Interplanetary (the game becomes itself):** Mars + synodic windows, patched-conic planner, conjunction blackouts, full caching/prefetch/coherence at minutes-scale, edge-processing DCs, **autonomy tiers (the leverage curve maturing — asset→fleet→intent, §4.11)**, **constrained brokering**, **Level-2 laser-backbone construction (§4.3a — terminals as a finite resource, cycle-robust meshing)**, "waiting is gameplay" validation. *(Perf-budget gate here — X-02.)*
- [-] **M5 — Outer system + DTN** *(post-1.0):* Belt/Jupiter/Saturn, store-and-forward, predictive replication, nuclear rad-hard DCs, high-autonomy edge intelligence, heavy ISL backbone.
- [-] **M6 — Optional information-economy endgame** *(post-1.0):* the §4.10 currency flip (the leverage curve's terminal), opt-in victory path; prototype no earlier than after M4 proves the mid-game fun.

**Deferred off the v1 critical path:** multiplayer (affordance only); mobile companion (no version target); the optional LLM (cut); outer/interstellar tiers; **the concrete tech tree** (GDD §4.11 — designed post-M1, never before the loop is proven); most of the eight dashboards (one excellent per milestone).

---

## 8. Cross-cutting epics (continuous)

- [~] **X-01** Determinism & replay — clock ✅ + RNG ✅; **golden-master replay (P0-06) owed**; +1 replay fixture per milestone thereafter.
- [ ] **X-02** Performance budget — Three.js allocation pools (scratch vectors + direct `Float32Array` writes, proven in spike review) are the standing discipline; event-driven route re-solve + precomputed link windows from M2; headless perf benchmark M2–M3; real budget before M4.
- [ ] **X-03** Accessibility — chrome/signal split + CVD-safe palette + monochrome-purist toggle; **"colour-off fully playable" is a per-milestone exit check** (GDD §8). The freshness-as-saturation cue must read via its redundant dither/desaturation channel.
- [ ] **X-04** Save/load robustness — JSON-serialisable from pure `src/sim/`; versioned saves + migration hook (lands with P0-05); fast snapshot load.
- [ ] **X-05** Audio system — Web Audio API; one-way event-bus → cues; placeholder at M1-11; health-sonification M2+.
- [ ] **X-06** Content pipeline — `data/` JSON from M0-04; migrate each mock's constants as its real system lands; CI schema validation.

---

## 9. Immediate next actions (the PD run-up)

1. **Land the deterministic save/replay backbone (P0-05, P0-06)** before the economy makes the sim complex. The replay golden-master is the highest-leverage test in the project; the M1 economy should be born deterministic, not retrofitted.
2. **Stand up CI** (P0-02 finish): `npm test` on push + Playwright screenshot capture, so the money-shot and (soon) the M1 loop are regression-guarded visually.
3. **Build the M1 caching loop core (M1-04→06), prototyping the *visible pending wait* (M1-05) first** — that single beat (miss → watch the packet crawl → relief) is the clearest read on whether the light-delay loop is fun, and it's cheap to stand up on the existing orrery/packet code.
4. **Wire the minimal economy + finance panel + glanceable map (M1-08→10)**, then the scenario (M1-12) and telemetry (M1-GATE).
5. **Run the gate.** Everything upstream exists to reach this question honestly.

---

## 10. Open technical questions / spikes to schedule

- **Save/replay shape** — port the C# `SaveGame` structure to TS (seed + action log + periodic snapshots). Land at P0-05.
- **Routing solver** — Dijkstra/A* is ample through M2; the *event model* (re-solve on topology-change only, precomputed geometric link windows) matters more than the algorithm. Architecture from M2; heavier solvers (time-expanded / DTN) spiked at M4 against a profiled graph.
- **Geodesic coverage grid** — roll-your-own subdivided-icosahedron, no H3 dependency; lat/lon mock fine through M1, real grid at M2-01.
- **Leverage-curve legibility (GDD §4.11 open question)** — the mechanism that surfaces the next capability as a near-future consequence of current activity (the cost of having no tech-tree screen). Resolve when the concrete capability set is designed, post-M1.
- **Time-compression ratio** — a `data/` feel-tunable; determinism safe at any ratio (only the clock advance scales). Tune empirically at M4-08.
- **Perf at full scene scale** — pool per-frame allocations and benchmark before judging frame-time; gate the question at M4.

---

*v0.2. Detailed through M1/PD, deliberately light past M4, mirroring GDD §9–§10. The project's hard technical bets (f64 orbital truth, the legible 3D orrery, the sim/render split, determinism) are proven; the make-or-break design bet (is the light-delay loop fun?) is the next thing built and is the gate. Re-detail M2+ after the M1 gate passes.*
