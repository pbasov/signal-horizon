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
**Status: SUPERSEDED by SD-12.** `data/system.json` was a relative symlink to the Godot project's file, with Vite `server.fs.allow` widened to read across trees. Replaced by an in-repo vendored copy so the project clones and runs with no external dependency.

### SD-5 — Floating origin + per-preset log-compression in the orrery
**Status: ACCEPTED.** Mirrors `render/FloatingOrigin.cs`. f64 subtract → f32 cast. Per-preset radial log-fold. The fold is a visual lie only — it never feeds distance/light-delay math. Constant-screen-size dithered billboards.

### SD-6 — Presets are data; WM is a constrained zone-grid (DD-10), Swap + Resize wired
**Status: ACCEPTED.** `zonegrid.ts` implements the DD-10 model. Title-bar drag → Swap and edge-resize are wired. Tab/Split/Close exist in the data shape but are not gesture-wired.

### SD-7 — Sim clock is an f64 accumulator (replaced by fixed-tick clock)
**Status: SUPERSEDED by P0-03.** The spike used an f64 accumulator (non-deterministic). Production now uses an integer fixed-step clock: `SimClock` holds an integer `tick`, each tick is exactly `DT = 1/60` sim-seconds. `seconds` is derived as `tick * DT`. The `TickScheduler` pattern (`scheduleWall()` → drain `nextTick()`) ensures time-acceleration scales tick count, never DT. Same tick count = same sim state.

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

### SD-12 — Vendor the canonical dataset as a real file (supersedes SD-4)
**Status: ACCEPTED.** `data/system.json` is now a real, committed file in this repo — a vendored copy of the Godot project's canonical dataset (byte-identical at vendoring time, sha256 `d2bee65a…`). Replaces the SD-4 symlink so the repo is self-contained and clones/runs anywhere with no external Godot tree present. Consequences: (1) `vite.config.ts` no longer hardcodes absolute machine paths and the `server.fs.allow` cross-tree widening is removed (root defaults to cwd — the package dir under `npm run {dev,build,preview}`); (2) the two datasets are now decoupled — if the Godot `system.json` changes, re-copy it here to resync (noted in `README.md` and `src/sim/system-data.ts`). Verified: `tsc --noEmit`, `vite build`, dev server, and 37/37 Vitest all green.

### SD-11 — No UI framework; imperative DOM and Three.js only
**Status: ACCEPTED.** No React, Vue, Svelte, or any reactive/reconciliation layer. The frame loop is `requestAnimationFrame → sim.tick() → orrery.update(state) → renderer.render()` — no diffing, no virtual DOM, no scheduling, no effect lifecycle. Three reasons: (1) The orrery renders to a WebGL canvas — a framework can't schedule or diff GPU draw calls; a React-Three-Fiber wrapper adds JS overhead before the same GL calls. (2) A real-time sim updates every frame — position, packets, freshness all change every tick. Reactive frameworks optimise for skipping unchanged subtrees, but there's nothing to skip; the reconciliation cost is pure overhead. (3) GC pressure: each framework render cycle allocates vdom nodes, memo objects, and effect cleanup closures. At 60fps (~16ms/frame) this competes with the sim and orrery for the frame budget. The adversarial review caught ~960 `Vector3`/frame in Three.js — a framework's allocation pattern would compound this. Panels use `element.textContent = newValue` in the frame loop. If panel complexity grows later, the answer is writing that component imperatively, not introducing a framework.

### SD-13 — GDD bumped v0.5 → v0.7 (Pillar 7 + network topology)
**Status: ACCEPTED.** Source GDD. Two design additions land in the design doc: (1) **Pillar 7 "Leverage compounds"** (§4.11) — capability is discovered through operation, not bought; there is no research building and no tech-point currency. The unit of command rises over a run: asset → fleet → declared intent. The concrete tech tree is **DEFERRED post-M1** (the M1 fun-gate does not depend on it). (2) **§4.3a network topology** — forgiving RF access links (easy, lossy, ubiquitous) versus a scarce point-to-point laser backbone; terminals are finite and exist on backbone nodes only. Governance splits into a Level-1 policy floor and a Level-2 construction ceiling. The trace-view is an "mtr" for the link graph. Records the version bump only — the GDD itself is the authority; this log does not restate it.

### SD-14 — Implementation plan v0.1 → v0.2 (supersedes; v0.1 deleted)
**Status: ACCEPTED.** Source PLAN. The old `docs/signal-horizon-implementation-plan-v0.1.md` was the pre-spike Godot/GDScript plan and is **deleted**. The live plan is `docs/signal-horizon-implementation-plan.md` (this is v0.2), which reflects the TS/Three.js move (SD-10), the M0 spike done, and **M1 as the live fun-gate frontier** (DD-7). v0.2 supersedes v0.1; all references re-point to the live filename.

### SD-15 — Port the save/replay backbone + M1 economy from the tested C# reference
**Status: ACCEPTED.** Source PLAN/SPIKE. The save/replay backbone (P0-05/06) and the M1 economy are **not greenfield** — they are ported from the complete, tested C# reference at `/home/basov/Games/Godot/galaxy-link/SignalHorizon.Sim/` (`SaveGame`/`SimAction`/`StateHash`/`SimScheduler` + `M1/{Cache,Coherence,Demand,Resolver,M1Economy}` + `Tests/{SaveReplayTests,M1ModelTests}.cs`).

**Finding from B1 — the C# golden state-hash is NOT bit-portable to TS.** `StateHash` was ported byte-for-byte to `src/sim/state-hash.ts` (verified: identical fold constants `Mult=1000003`/`Seed=1469598103934665603`, little-endian IEEE-754 byte order, sort order, hashed quantities, unsigned-u64 fold). Yet `canonicalHash` over the golden ticks `{0,3600,86400,2592000}` at `dt=1/60` yields **12899997400407946598** in TS vs **15552073864691245897** (unsigned u64) in C#. Cause: of the 96 folded position doubles, two differ in their lowest 1–2 mantissa bits (`sat_meo_inc.z@t0`, `mars.y@t3600`) — V8-vs-.NET `Math.sin/atan2/sqrt` rounding, the same sub-ULP divergence `ephemeris.test.ts` already tolerates at `REL_TOL=1e-9`. A raw-bit hash has full avalanche, so 1 ULP scrambles the result; matching C# would need an fdlibm-identical trig port (out of scope). **Resolution:** pin the TS-native value as the determinism guard, record the C# baseline as provenance. P0-06 is therefore an *intra-runtime* TS determinism proof (replay → identical TS state), not a cross-runtime C# equivalence proof; the **replay golden (B3) should fold the action-driven mutable state** (clock tick, RNG state, economy integers — all exactly representable), not the transcendental ephemeris positions. The TS pin is stable for a fixed V8/Node (D1 pins Node 26).

Two C# porting traps still hold for SaveGame/replay: (1) `dt = 1/60` is stored as exact IEEE-754 bits and **does not survive JSON** — preserve the bit pattern, do not round-trip through a decimal string; (2) replay must use the **unclamped scheduler kernel** (`SimScheduler`), because the live `SimClock` drops steps under fast-forward and would diverge.

### SD-16 — Defer a single SimState/World consolidation (conscious deferral)
**Status: ACCEPTED (conscious deferral).** Source PLAN. Sim mutable state is small and well-defined — the clock tick, the RNG state, and a few `Mission` fields — so P0-05 serialises it directly rather than introducing a god-object `SimState`/`World`. No consolidation refactor before the economy lands. Revisit only if M1 state sprawls.

### SD-17 — E1 design-conformance: 3-level coherence + sloped stale-band price (GDD §4.4 over the C# port)
**Status: ACCEPTED (user-approved).** Source GDD §4.4. After the faithful E1 port (commit 3dafb70), a GDD-grounded design review found two M1-scoped gaps where the prior C# port under-served the design authority; both applied as a *separate* commit so the faithful port stays a clean baseline. (1) **Coherence is 3 levels, not 2.** The C# port (and the M1-07 ticket) had Eventual/BestEffort; GDD §4.4 names *strong/eventual/best-effort* — three. Now a cheap→premium ladder `EVENTUAL(floor 0.5, cadence 7200s, cost 1.0×) < BEST_EFFORT(0.9, 1800s, 3.0×) < STRONG(0.98, 600s, 6.0×)`, so the spend-vs-staleness dial is a real choice, not an on/off toggle. **GDD outranks the plan**, so M1-07's "two levels" is superseded. (2) **The stale-band price is a slope, not a flat tier.** The 3-band step left the whole `[min,fresh)` band paying a flat €400, so tuning freshness within it bought nothing — but the gate measures whether *optimising* is fun, which needs a gradient (GDD §4.4: a freshness penalty that *scales* with staleness). `Demand.priceCurve` now defaults to `"ramp"` (continuous LERP €400→€1000 across the stale band, keeping the hard min-cliff and fresh-cap), with `"step"` retained for an in-gate A/B. Both are pure-sim, behind tests covering all 3 levels and both curves. *(Latent: the ramp divides by `freshFreshness − minAcceptableFreshness`; guard or validate when scenario configs set these — E6.)* Full §4.4 depth (brokering, prediction, multi-slot, dynamic demand, the €→information flip) remains deferred per the review.

### SD-18 — GDD v0.7 → v0.8 (name the fun + give escalation a mechanism)
**Status: ACCEPTED.** Source GDD (author revision, commit 74dc6fb). Records the bump and its three additions: (1) **§3a "What the Fun Is"** — the spine is *taming the sprawl* (chaos→order, visceral, measured against *functional*) and the mastery layer is *optimising against the parse* (order→optimal, cerebral, measured against *optimal*); the same verb at two bars, hinged on a legible record. Design constraint: the floor verb and the ceiling verb must be the same verb. (2) **§3b "The Escalation Engine"** — replaces "bigger gap" with three endogenous generators (demand growth · freshness decay · earned automation) + the across-tier rule "each new tier must invalidate a strategy that worked the tier before, or be cut." (3) **§4.12 "The Legible Record (The Parse)"** — the combat-log for information delivery, promoting the optimisation layer (§4.2/§4.3a) from footnote to spine. **The M1 gate is sharpened** to "does the player finish a run wanting to look at what happened and do it better?" Consequence for the build: E3's action log + Resolver-outcome stream is the substrate of the parse; **E6 telemetry should surface a player-facing post-run record, not just hidden gate metrics** (tracked on the E6 task).

### SD-19 — E3: M1 economy + prefetch-as-logged-action + the honest-freshness breathing loop
**Status: ACCEPTED (user-approved "make it breathe").** Source PLAN/SPIKE + user. (1) `M1Economy` ported (balance/applyPayout/chargeOpex×coherence.costMultiplier/chargePrefetch/runway/bankrupt) and wired into `M1Session`; the good-vs-bad solvency gap runs through the real economy. (2) **Prefetch is the first logged player action**: `session.prefetch()` (€50, one-fetch-in-flight gate) recorded as a `SimAction` at `clock.tick`; the previously-unlogged pause/faster/slower mutations are now recorded too — closing the reproducibility gap (P0-05). (3) **Honest-freshness breathing loop**: the cache captures the fetched sample at its Earth-*launch* instant, so on arrival it is honestly one-way old — freshness `2^(-oneWay/halfLife) ≈ 0.84` (a paying *stale* hit, never perfectly "fresh", which is the correct physics), yielding a ~44-min fresh-hit window where no fetch is in flight and prefetch is a usable lever (top-up before a conjunction blackout). Earlier the cache effectively re-missed near-continuously, starving the prefetch lever. (4) **Determinism with player actions**: live and replay apply a recorded prefetch at the *same* point (after `step(at_tick)`) via a shared `applySessionAction`, so a recorded log replays bit-identically even when `step()` would itself start a competing miss-fetch (guarded by an adversarial competing-case test — do not delete it; the ordering-regression teeth live there).

---

## Resolved engineering decisions (from scoping)

| ID | Decision | Status | Rationale |
|---|---|---|---|
| D1 | **Pin stack versions** | PROPOSED | Node 26 + Three.js 0.184.x + Vite 8.x. Pin in README + CI. |
| D2 | **Sim-core language** | ACCEPTED | TypeScript (SD-3). Pure `src/sim/` with zero DOM/Three.js imports. Bit-identical to C#. |
| D3 | **Test framework** | ACCEPTED | Vitest for pure sim; Playwright for headful screenshot CI. |
| D4 | **RNG portability** | ACCEPTED | bigint splitmix64 in `src/sim/rng.ts` (P0-04). Golden values cross-verified bit-identical against C# `SimRng`. bigint arithmetic is spec-defined, portable across all JS engines. |
| D5 | **Fixed sim `DT`** | ACCEPTED | `DT = 1/60` s. Time-accel scales *how many fixed steps run*, never `DT`. Integer tick accumulator (P0-03). |
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
| SD-4 | Canonical dataset by symlink (Vite `fs.allow` widened) | **SD-12** (vendored real file in-repo) | Symlink + absolute `server.fs.allow` paths broke cloning/running on other machines; vendoring makes the repo self-contained. |

---

*Append new decisions at the bottom of the relevant section; never silently overwrite — mark SUPERSEDED and add the replacement.*
