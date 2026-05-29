# SIGNAL HORIZON — Decision Log
### Living record of engineering & design decisions (ADR-lite)

> One row per decision. **Status:** `PROPOSED` (recommended by scoping, awaiting owner confirmation) · `ACCEPTED` (locked) · `SUPERSEDED` · `OPEN` (needs a call). Keep this current — a decision that isn't written here didn't happen. Source tags: GDD = design doc, PLAN = implementation-plan, SCOPE = scoping, SPIKE = prototype spike.

---

## Locked-in product/design framing (from GDD v0.5 + critique)

| ID | Decision | Status | Rationale / source |
|---|---|---|---|
| DD-1 | **Monochrome machine, living signal.** OS chrome strictly 1-bit; game-space signal (orrery, links, packets, live data) is coloured; freshness = saturation draining to grey. | ACCEPTED | GDD §8. Resolves the v0.4 aesthetic-vs-legibility risk. |
| DD-2 | **Visualization is priority zero** (the make-or-break pillar) — packets-in-flight + the growing coverage web are M0, not polish. | ACCEPTED | GDD §2/§5, critique (CS2 trap). |
| DD-3 | **Currency flip is optional, gradual, € stays relevant.** Information-dominance is an opt-in victory path, not a forced rug-pull. | ACCEPTED | GDD §4.10. |
| DD-4 | **Brokering gated + margin-capped** so it complements (never replaces) the carrier fantasy. | ACCEPTED | GDD §4.4. |
| DD-5 | **No "AI" framing.** Autonomy is diegetic flight-software/expert-systems. The optional local LLM is **cut from v1**. | ACCEPTED | GDD §4.6 (~85% negative AI sentiment). |
| DD-6 | **Multiplayer & mobile = affordance only**, no version target; v1 ships single-player desktop. | ACCEPTED | GDD §6/§7. |
| DD-7 | **M1 is a kill-gate.** If the 30-min light-delay fun-test fails, iterate visualization/core or stop — do not build M2. | ACCEPTED | PLAN §M1. |

---

## Spike decisions (TS/Three.js)

### SD-1 — Stack: TypeScript + Three.js, browser-first
**Status: ACCEPTED.** The spike evaluates whether the DD-10 tiling-WM shell + 3D orrery build more naturally on a web stack than on Godot. Developed and deployed in Chromium.

### SD-2 — No Tauri; browser is the platform
**Status: ACCEPTED.** The app runs in the browser (Chromium). Tauri wrapping is deferred indefinitely — the browser IS the deployment target for now. This removes the WebKitGTK validation gate entirely. The code remains standard web APIs only (no Chrome-only extensions), so a Tauri wrap remains a future option if needed.

### SD-3 — Port the Kepler truth layer to TS; pin against a C# golden master
**Status: ACCEPTED.** `Ephemeris.cs`/`OrbitalBody.cs` ported verbatim to `src/sim/ephemeris.ts`. TS `number` is f64 natively. Bit-identical to the C# golden master. Vitest pin holds `1e-9` tolerance for cross-machine libm robustness.

### SD-4 — Reuse the canonical dataset by symlink (no copy)
**Status: ACCEPTED.** `data/system.json` is a relative symlink to the Godot project's file. Vite `server.fs.allow` widened.

### SD-5 — Floating origin + per-preset log-compression in the orrery
**Status: ACCEPTED.** Mirrors `render/FloatingOrigin.cs`. f64 subtract → f32 cast. Per-preset radial log-fold. The fold is a visual lie only — it never feeds distance/light-delay math. Constant-screen-size dithered billboards.

### SD-6 — Presets are data; WM is a constrained zone-grid (DD-10), Swap + Resize wired
**Status: ACCEPTED.** `zonegrid.ts` implements the DD-10 model. Title-bar drag → Swap and edge-resize are wired. Tab/Split/Close exist in the data shape but are not gesture-wired.

### SD-7 — Sim clock is an f64 accumulator (no fixed-tick determinism in the spike)
**Status: ACCEPTED (spike-only).** The spike has no determinism requirement. The clock accumulates f64 sim-seconds directly. **Production must replace this** with an integer fixed-step clock for bit-deterministic save/replay.

### SD-8 — SYSTEM.LOG: real packet events + a scripted severity feed
**Status: ACCEPTED.** Packet launch/arrival and genuine LoS occult are real. Solar conjunction is rare, so the log is also fed a deterministic sim-time-paced flavour stream.

### SD-9 — Verify in headful ungoogled-chromium via Playwright (+ MCP)
**Status: ACCEPTED.** `tools/shoot.mjs` drives the user's ungoogled-chromium (148) through `playwright-core` for headful, real-GPU screenshots.

---

## Stack migration decision

### SD-10 — Migrate from Godot C# to TypeScript + Three.js (browser)
**Status: ACCEPTED.** The spike (see `FINDINGS.md`) proved the UX builds at least as naturally in the web stack:
- Kepler truth ported bit-for-bit (f64 is native in TS)
- Tiling WM, 3D orrery, packet honesty, keyboard presets all work
- HMR iteration is dramatically faster
- No numerical-fidelity loss

The app runs in the browser. No Tauri gate — see SD-2. The remaining engineering work is the deterministic fixed-tick + save/replay in TS (bounded, low-risk; the pure layer is already bit-identical).

**Supersedes DD-11** (C# on Godot .NET). Design decisions DD-1 through DD-7 and the full GDD remain the design authority; only the *engineering stack* changed.

---

## Resolved engineering decisions (from scoping)

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D1 | **Pin stack versions** | PROPOSED | Node 26 + Three.js 0.184.x + Vite 8.x. Pin in README + CI. |
| D2 | **Sim-core language** | ACCEPTED | TypeScript (SD-3). Pure `src/sim/` with zero DOM/Three.js imports. Bit-identical to C#. |
| D3 | **Test framework** | ACCEPTED | Vitest for pure sim; Playwright for headful screenshot CI. |
| D4 | **RNG portability** | OPEN | Splitmix64 needs TS port. If golden hashes must survive across JS engines, verify `bigint`/paired-`uint32` semantics. **Must decide before P0-06.** |
| D5 | **Fixed sim `DT`** | OPEN (provisional) | Start ~1/60 s; finalize empirically. Time-accel scales *how many fixed steps run*, never `DT`. |
| D6 | **Project rename** | SUPERSEDED | Was `GalaxyLink` → `SignalHorizon`. Done in the Godot repo; the TS repo starts as Signal Horizon. |
| D7 | **Epoch / reference frame** | PROPOSED | **J2000 + ecliptic-of-J2000.** Convert any equatorial-sourced data on load. |

---

## Resolved open technical questions

| ID | Question | Resolution | Status |
|---|---|---|---|
| Q1 | SGP4 vs Kepler for Earth-orbit assets | **Kepler now, SGP4 deferred indefinitely.** Orbital decay is a cheap parametric pressure, not SGP4. | ACCEPTED |
| Q2 | Routing solver for the time-varying graph | **Dijkstra/A\* is ample through M2.** Re-solve on topology-change events only. Spike heavier solvers at M4. | ACCEPTED |
| Q3 | Hex grid: H3 binding vs roll-your-own | **Roll your own** subdivided-icosahedron geodesic grid; no native dependency. | ACCEPTED |
| Q5 | Time-compression ratio | A *feel* parameter — keep it a `data/` tunable. Determinism safe at any ratio. | ACCEPTED |

---

## UI shell decisions

### DD-8 — The Ops Console is a tiling window manager with layout presets
**Status: ACCEPTED.** Direction **A · TILE**, dynamic (Sway/i3-style). Non-overlapping tiles always fill the screen; player splits/swaps/resizes/zooms tiles and switches between named layout presets. 1-bit window chrome, always-visible status strip. *Supersedes* floating-window (B · DESKTOP).

### DD-9 — Crisp, resolution-independent scaling
**Status: ACCEPTED.** In the web stack: CSS `image-rendering: pixelated`, `-webkit-font-smoothing: none`, viewport-driven scaling. The 2560×1440 design-density reference still applies as a CSS baseline.

### DD-10 — Tiling WM model (constrained zone-grid)
**Status: ACCEPTED.** 1–3 cols × 1–3 rows, one-panel-or-tab-group per zone, mouse-driven zone-snapping, presets-as-data, always-tiled invariant. Full spec in `tiling-wm-spec.md`.

### DD-15 — Orrery is 3D + body-anchored orbit camera + curated preset framings
**Status: ACCEPTED.** 3D is non-negotiable (orbital planes must read). Body-anchored orbit camera with rotate/zoom/reset. Curated presets (CISLUNAR/ORBITS/SYSTEM/TOP-DOWN) with animated transitions.

---

## Decisions still owed

- **Before P0-06 (determinism test):** D4 (RNG portability in TS).
- **At M0-02:** Kepler accuracy tolerance target — add as **D8 when reached**.
- **M3–M4:** default "hardcore" level — is the player's *own* network awareness delayed, or only in-fiction data products?
- **Before M6:** does the optional currency flip read as climax or confusion?

---

## Superseded decisions

| ID | Old decision | Superseded by | Why |
|---|---|---|---|
| DD-11 | C# on Godot .NET | **SD-10** (TS/Three.js/browser) | Spike proved web stack is at least as natural with faster iteration and no fidelity loss. |
| DD-12 | Godogen frame-grounded loop | **Retained in spirit** | Judge from rendered output, never from "it compiled." Replaced by Playwright screenshot CI. |
| DD-13 | Develop on `main`, auto-push | **Retained** | Same policy, new repo. |
| DD-14 | Build C# frontend fresh from v3 mockups | **SD-10** | Frontend is now TypeScript/DOM, built fresh from the spike + v3 mockups. Design target unchanged. |
| (old) SD-2 | Defer the Tauri native shell | **SD-2** (no Tauri; browser is the platform) | Owner decision: skip Tauri, keep it in the browser. Removes WebKitGTK gate. |

---

*Append new decisions at the bottom of the relevant section; never silently overwrite — mark SUPERSEDED and add the replacement.*
