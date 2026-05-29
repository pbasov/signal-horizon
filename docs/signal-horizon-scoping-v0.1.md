# SIGNAL HORIZON — Engineering Scoping
### v0.1 (Tauri/TS/Three.js) · companion to implementation-plan-v0.1 / GDD v0.5

> Output of a 5-way scoping pass (P0 foundations · M0 sim core · M0 render/signal · M1 fun-gate · cross-cutting/spikes) against the live codebase, then **updated** to reflect the Tauri + TypeScript + Three.js spike results. The spike proved the UX builds at least as naturally on the web stack (see `FINDINGS.md`); the remaining cost is re-implementing determinism and validating WebKitGTK. Scope only — game design is unchanged.

---

## 0. The one-paragraph picture

The spike **proved** the Tauri/TypeScript/Three.js stack can build the UX at least as naturally as Godot — the DD-10 tiling WM, the 3D orrery, the honest light-speed packet, and the keyboard-native presets all work, with dramatically faster iteration and zero numerical-fidelity loss. The render/UI/aesthetic layer is now *proven reusable* (floating origin, log-compression, dithered billboards, DOM panels — all ported and screenshot-verified). The sim layer is real Kepler (bit-identical to C#, golden-master-pinned), not a placeholder. What remains greenfield is the **deterministic backbone**: fixed-tick clock, seeded PRNG, and save/replay — all load-bearing for M1 and absent from the spike. The work now is to (a) validate under WebKitGTK (the one open gate before committing to this stack), (b) port the deterministic fixed-tick + save/replay machinery to TypeScript, and (c) drive the proven visuals from a fully deterministic sim.

---

## 1. Environment ground-truth (verified)

| Check | Result |
|---|---|
| Tauri | **2.x** (`@tauri-apps/cli` 2.11.2, `@tauri-apps/api` 2.11.0). Rust toolchain: **rustc 1.95.0**. `webkit2gtk-4.1` present on host. |
| Node | **v26.1.0**. `npm run dev` starts Vite HMR; `npm test` runs Vitest. |
| TypeScript | **6.0.3**, strict, `ES2022` target, `bundler` module resolution. |
| Three.js | **0.184.0** with `@types/three` 0.184.1. WebGL2 renderer. |
| Vite | **8.0.14**. HMR sub-second on this hardware. |
| Vitest | **4.1.7**. 14/14 Kepler pins pass (golden-master vs C#). |
| Playwright | **1.60.0** (`playwright-core`). Headful screenshot driver (`tools/shoot.mjs`) against ungoogled-chromium 148. |
| Git | **Initialized and pushed.** Two commits on `main`: spike build + screenshot cleanup. |
| `data/` dir | **Exists.** `data/system.json` is a relative symlink to the Godot project's canonical file. Vite `server.fs.allow` widened to read the symlink target. |

---

## 2. Decisions the human owes before coding

| # | Decision | Recommendation (from scoping) |
|---|---|---|
| D1 | Pin Tauri + Node versions | **Tauri 2.11.x, Node 26 LTS, Three.js 0.184.x.** Pin CI to these exact versions (Tauri's WebView inherits the OS renderer; pin only what we control). Re-pin when Tauri 3.x is stable and WebKitGTK is re-validated. |
| D2 | Sim-core language | **RESOLVED — TypeScript.** Proven by spike (SD-3): `number` is IEEE-754 f64 natively, Kepler ports bit-identically, pure layer stays engine-agnostic and unit-tested under Vitest. No Godot-node boundary. The GDD §6 "hot core" discipline is preserved: the sim is a pure TS module with no DOM/Three.js/WebGL reference. |
| D3 | Test framework | **RESOLVED — Vitest + Playwright.** Vitest for the pure sim (fast, no DOM); Playwright headful for visual regression and WebKitGTK validation (same browser the user runs). Vitest pins already green on the golden master. |
| D4 | RNG portability | **Still open — decide before P0-04.** Port the splitmix64 (or xoshiro256**) to TypeScript; pin seed → output. If golden hashes must survive runtime upgrades / cross-platform, prefer hand-rolled integer PRNG over `Math.random()` (which is explicitly not portable). |
| D5 | Fixed sim `DT` | Provisional now (e.g. 1/60 s), finalized empirically at M0-08/M0-11. Time-accel scales *how many fixed steps run*, never `DT` or physics constants. |
| D6 | Project rename | `GalaxyLink` → `SignalHorizon` (cosmetic, do once). |
| D7 | Epoch / frame convention | **J2000 + ecliptic-J2000.** Threads through all of M0; lock it once. |

---

## 3. Cross-cutting findings (all five agents independently, updated for TS stack)

1. **`git init` is done.** Repository initialized, committed, and pushed. The spike tree is the baseline.
2. **The sim is not a placeholder — it's real Kepler.** The spike's `src/sim/ephemeris.ts` is a verbatim, bit-identical port of the C# truth layer (8-iteration Newton solver, 3-1-3 rotation, recursive parent composition, golden-master-pinned). The light-delay math (`delay.ts`) and link geometry (`links.ts`) are also real. What is *missing* is the deterministic backbone: fixed-tick clock, seeded PRNG, and save/replay. The pure sim is **not** throwaway — it is the foundation.
3. **The clock is an f64 accumulator — needs fixed-tick determinism.** The spike's `clock.ts` accumulates `sim_seconds += delta * time_scale` per-frame (SD-7: frame-rate-dependent, no fixed step). This is the exact anti-pattern. The real clock must be an integer fixed-step clock in the pure sim layer (P0-03); a stray `Math.random()` or frame-time dependency anywhere is a P0-04 violation. Write down and enforce the purity rule before the economy is authored.
4. **The reusable gold is the Three.js orrery + DOM WM + CSS dither.** `src/orrery/orrery.ts` (floating-origin f64→f32 rebase, per-preset log-compression, dithered billboards, dashed rings, camera presets), `src/wm/` (zone-grid tiling WM, drag-to-swap, gutter resize, data-driven presets), `src/dither.ts` (Bayer 4×4 runtime dither via CSS custom properties), and the entire `src/panels/` + `src/style.css` (1-bit chrome, SYSTEM.LOG, telemetry, status strip). All screenshot-verified against the Godot build.
5. **The chrome/signal render split is proven in the spike.** The dither stays on chrome (CSS Bayer on panel backgrounds); the orrery renders in colour with freshness-as-saturation and a redundant dither/shape/glyph channel. No global flatten. The compositing order is already right: chrome is DOM, signal is WebGL canvas. The GDD §8 "monochrome machine, living signal" split is already the live architecture.
6. **M1 path is shorter now — the spike proved the UX works.** The orrery, WM, panels, and packet-honest display are done. The M1 kill-gate depends on the *deterministic backbone* (fixed-tick + save/replay) and the *economy model* (demand → feasible-path → serve/miss/stale), not on re-proving the visuals. Scoping M1 as "imminent" was wrong for the Godot baseline; with the spike, the path to the gate is mostly backend work in the pure sim.

---

## 4. Per-slice scope (condensed for TS/Tauri stack)

### Phase 0 — Foundations (TS stack)
- **Spikes (D1, D4):** pin Tauri/Node/Three.js versions (D1, one sitting); settle PRNG choice (D4, one sitting). D2 and D3 are resolved.
- **WebKitGTK validation gate (highest priority):** wrap the spike in Tauri (`npm run tauri:dev`), re-run the six existing screenshots under WebKitGTK, verify WebGL2 limits, CSS dither rendering, font smoothing, and custom scrollbars. If this fails, the stack decision re-opens. This is the **one gate** that must close before any other Phase 0 work.
- **Backbone:** P0-03 fixed-tick clock in `src/sim/` (integer tick scheduler; f64 accumulator in the game loop drives N fixed steps per frame, never the other way) · P0-04 seeded sim PRNG in TypeScript (port splitmix64 or xoshiro256**; settle D4) · P0-05 save = seed + initial conditions + ordered action log + snapshots · **P0-06 determinism golden-master replay test (highest-leverage item in the project — write it before the sim gets complex)**.
- **Render/style backbone (already proven):** P0-07 floating-origin (ported, screenshot-verified — prove no jitter at 1e9 m under the fixed-tick clock) · P0-08 chrome/signal split (already the live architecture — document the contract explicitly: DOM owns chrome, WebGL canvas owns signal, freshness-as-saturation on the orrery side, 1-bit dither on the panel side).
- **Sim purity boundary:** enforce that `src/sim/` has no import from `three`, DOM APIs, or WebGL. Vitest is the purity guard — the sim test suite runs without a DOM.

### Milestone 0 — Spike-done + deterministic backbone
- **M0 is now spike-done** (just needs the WebKitGTK gate). The orrery, WM, panels, packet crawl, and Kepler truth layer all exist and pass. The spike backlog (§6 items) is ✅. Remaining M0 work:
  - Port the fixed-tick clock to replace the f64 accumulator (P0-03 → M0-08 rewire).
  - Wire the seeded PRNG (P0-04).
  - Add save/load + replay (P0-05/06).
  - Minor follow-ups from `docs/backlog.md`: hide far/parent orbit rings in near-field presets; wire Tab/Split/Close gestures; pool the ephemeris `Vec3` array returns.
- **The money shot already exists.** A coloured packet crawling Earth→Mars at honest light-speed, fading as it stales, no jitter. Under the fixed-tick clock it must still match the readout exactly — that is the M0 exit check.

### Milestone 1 — THE FUN GATE (updated for TS stack)
- **The economy model is greenfield in `src/sim/`.** Build order: M1-01 demand (freshness→price) + M1-02 feasible-path (a linear chain collapses this to two booleans — don't build a routing solver) → M1-03 serve/miss/stale resolver + M1-08 economy → **M1-04→05→06 cache→hit/miss→prefetch (prototype M1-05's *visible pending wait* first; this is the experiment)** → M1-07 coherence (most stubbable) → M1-09 finance panel (DOM panel, chrome/signal colour split already proven) + M1-10 glanceable map (2D schematic fallback — the 3D orrery already works) + M1-11 audio cue → M1-12 30-min scenario (first `data/` scenario file; one source / one customer / one relay / one conjunction tuned so pre-positioning a cache is the only survival).
- **Gate instrumentation is an unlisted deliverable (`S–M`):** persist the action log + per-request event stream → `playtest_log.jsonl`; derive hit-rate, mean wait, and **action-density-into-the-blackout** to judge PASS/FAIL objectively. Rides free on P0-05/06.
- **Don't cut:** M1-06 prefetch (it's what fills the wait) and the visible-pending-wait on miss. **Do stub:** M1-07, multi-node routing, storage capacity, demand growth, the 3D orrery (2D schematic is fine for the gate, but the 3D orrery already works anyway).

### Cross-cutting (run continuously from P0)
- **X-01 determinism** = same mechanism as **X-04 save/load** (seed+log+snapshot+canonical hash) — build together. Canonical hash: fixed field order, hash f64 by raw IEEE-754 bits (`DataView`/`Float64Array`), sort collections by stable id. One regression replay fixture per milestone.
- **X-02 perf:** routes re-solve **on topology-change events only**; **precompute geometric link windows** (deterministic from orbits). Wire the event-driven invalidation at M1 while trivial; benchmark harness M2–M3; budget real before M4.
- **X-03 accessibility:** chrome/signal split is already live — make "colour-off still fully playable" a per-milestone exit check. CVD-safe palette stub + purist toggle in P0.
- **X-05 audio:** one-way event-bus → cues (never read wall-clock / feed back into sim). Placeholder at M1-11; health-sonification matures M2+.
- **X-06 content pipeline:** `data/` JSON via symlink (already working). First scenario file at M1-12. Validate schema in CI.

### Open questions (resolved/deferred)
- **SGP4 vs Kepler** → Kepler now, SGP4 deferred indefinitely (orbital decay at M2-07 is a cheap parametric pressure, not SGP4).
- **Routing solver** → Dijkstra/A* is ample through M2; the *event model* matters more than the algorithm; spike heavier solvers at M4 against a profiled graph.
- **Hex grid** → **roll your own** subdivided-icosahedron geodesic grid. Lat/lon mock is fine through M1, replace at M2-01.
- **When to port the sim** → the sim is already in TypeScript (golden-master-pinned). A Rust backend for the sim is still deferred — gate on a profiler result at M4, never a hunch.
- **Time-compression ratio** → a *feel* parameter; keep it a `data/` tunable, tune at M4-08; determinism is safe at any ratio.

---

## 5. Recommended first weeks

**Week 1 — WebKitGTK gate + backbone**
0. **Wrap in Tauri (`npm run tauri:dev`)** — this is the gate. Re-run the six spiked screenshots under WebKitGTK. Verify WebGL2, CSS dither, font smoothing, custom scrollbars. If green, proceed; if red, the stack decision re-opens.
1. Resolve D1 (pin versions) + D4 (PRNG choice). Write the one-paragraph decisions + the `src/sim/` purity lint rule (no `three`/DOM imports).
2. P0-03: fixed-tick clock in `src/sim/clock.ts` (integer tick scheduler; the game loop's `requestAnimationFrame` drives N fixed steps per frame). Replace the current f64 accumulator.
3. P0-04: seeded PRNG in `src/sim/` (port splitmix64 or xoshiro256**). Pin seed → output with a Vitest fixture.

**Week 2 — save/replay/determinism + integration**
4. P0-05 (action-log + snapshot + canonical state hash in TS).
5. **P0-06 (golden-master replay in CI)** — before any real sim code beyond Kepler.
6. Rewire the orrery and panels to the fixed-tick clock (verify the money shot still works under deterministic stepping).
7. Minor follow-ups: hide far/parent orbit rings in near-field presets; wire Tab/Split/Close gestures; pool ephemeris `Vec3` array returns.

Then chase **M1** (economy model in the pure sim, fed to the proven visuals), which is now mostly backend work — the render/UI layer is done.

**Critical coordination artifact:** the **sim↔render boundary contract** — `position(body, t) -> f64 metres (absolute)` via `src/sim/ephemeris.ts`, a link open/blocked + distance query, and exactly *one* authoritative fixed-tick clock that the time UI mirrors. Render owns rebase + scale-compression + all drawing (Three.js); sim owns truth (`src/sim/`). Define this before P0-07/M0-05 start — this is already the live architecture, just needs the contract written down.

---

## Appendix — target module layout (actual `src/`)

| Module | Home | Responsibility |
|---|---|---|
| Sim clock + tick scheduler | `src/sim/clock.ts` | Currently f64 accumulator (SD-7); to be replaced with integer fixed-step clock. The game loop (`src/main.ts`) drives ticks off `requestAnimationFrame`. No frame-time dependency in the sim. |
| Kepler ephemeris | `src/sim/ephemeris.ts` | Bit-identical port of C# truth layer. 8-iteration Newton solver, 3-1-3 rotation, recursive parent composition. Returns f64 metres, never `Vector3`. Golden-master-pinned (`ephemeris.test.ts`). |
| Light-delay + freshness | `src/sim/delay.ts` | Pure one-way-seconds-from-metres / freshness math. Presentation formatters in `src/format.ts`. |
| Links + occlusion | `src/sim/links.ts` | Line-of-sight occlusion geometry, link state. |
| Mission / scenario | `src/sim/mission.ts` | Scenario data and packet lifecycle. |
| System data | `src/sim/system-data.ts` | Loads `data/system.json` (symlinked from Godot tree). |
| Economy (M1) | `src/sim/economy.ts` | The real M1 caching/economy model — greenfield. Must stay a pure TS module (no DOM/Three.js import). |
| Network graph (M1) | `src/sim/` | Node/edge graph as deterministic sim truth. |
| Coverage | `src/sim/` | Out of scope until M2-01 (real geodesic grid). |
| Orrery | `src/orrery/orrery.ts` | Three.js scene: floating-origin rebase, per-preset log-compression, dithered billboards, dashed rings, camera presets, packet crawl. Fed by `ephemeris.ts`. |
| Tiling WM | `src/wm/shell.ts` + `zonegrid.ts` + `presets.ts` | DD-10 zone-grid WM in DOM: always-tiled, drag-to-swap, gutter resize, 5 data-driven presets. |
| Panels | `src/panels/status.ts` + `telemetry.ts` + `log.ts` | SYSTEM.LOG (severity highlighting, ring buffer), telemetry (freshness gauge), status strip. DOM + CSS. |
| Dither | `src/dither.ts` | Bayer 4×4 runtime dither via CSS custom properties. Applied to chrome only — never to the orrery canvas. |
| Types | `src/types.ts` | Shared type definitions. |
| Format helpers | `src/format.ts` | Light-delay, money, time formatters. |
| App entry + loop | `src/main.ts` | Vite entry, `requestAnimationFrame` loop, wires sim ↔ orrery ↔ panels. |
| Styles | `src/style.css` | 1-bit chrome: dark (#0B0B12) background, monospace, custom scrollbars, suppressed browser defaults. |
| Data | `data/system.json` (symlink) | Canonical body/orbit data. Same file as the Godot project, no copy. |
| Golden master | `tools/golden/` | C# program that compiles the real `SignalHorizon.Sim` sources and emits G17 round-trip doubles. Pin target for Vitest. |
| Screenshot driver | `tools/shoot.mjs` | Playwright headful screenshots against ungoogled-chromium. Reproducible visual verification. |
| Tests | `src/sim/ephemeris.test.ts` | Vitest. Kepler golden-master pin + 13 structural assertions. Purity guard: sim tests run without DOM. |

*v0.1 (Tauri/TS/Three.js). The spike proved the UX works — the path to the M1 kill-gate is now deterministic-backbone + economy in the pure sim, driven by the proven visuals. Everything before M1 exists to reach that fun question as cheaply and honestly as possible.*
