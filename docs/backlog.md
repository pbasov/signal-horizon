# SIGNAL HORIZON — Ticket Backlog (trackable)
### Companion to implementation-plan (v0.2) + scoping (historical)

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
- [x] **CI** — GitHub Actions (`.github/workflows/ci.yml`): vitest + `tsc --noEmit` + build + headless Playwright orrery screenshot (uploaded as an artifact). Node 26.

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
- [x] **P0-02** CI — GitHub Actions (`.github/workflows/ci.yml`): vitest + `tsc --noEmit` + `npm run build` + headless Playwright screenshot via `tools/shoot.mjs` (CI-bundled Chromium through `CHROMIUM_BIN`, `HEADLESS=1`), artifact-uploaded. Node 26 (D1).

**Deterministic core backbone**
- [x] **P0-03** Authoritative sim-clock + fixed-step tick — *M* · Integer fixed-step clock implemented in `src/sim/clock.ts`. Tick accumulator, `scheduleWall()`/`nextTick()` drain pattern, `DT = 1/60` s. Death-spiral clamp. `setTick()` for save/load. 12 Vitest tests green.
- [x] **P0-04** Seeded RNG abstraction — *S* · Splitmix64 ported to TS via `bigint` in `src/sim/rng.ts`. Golden values cross-verified bit-identical against C# `SimRng`. 11 Vitest tests green. No `Math.random()` in `src/sim/`. D4 resolved → bigint for spec-defined portability.
- [x] **P0-05** Action-log + state-snapshot save format — *M* · JSON, versioned; port the C# `SaveGame` shape. Pure `src/sim/`, no DOM state. **B2:** `src/sim/save.ts` (SaveGame, lossless `dt_bits`, bigint-as-string) + `src/sim/action.ts` (SimAction) + snapshot shape; round-trip-pinned. **E3:** live action-log recording wired at `src/main.ts` — prefetch + pause/faster/slower now recorded as actions at `clock.tick` (closing the reproducibility gap). _Minor optional: clock scale/pause in the snapshot itself (reconstructible by replaying the log; only matters for snapshot-only fast-load)._
- [x] **P0-06** Determinism / replay golden-master test — *M* · **B1:** `src/sim/state-hash.ts` (canonical hash port) + TS-native golden pin (`state-hash.test.ts`); the C# hash is not bit-portable cross-runtime (SD-15). **B3:** `src/sim/scheduler.ts` (unclamped, no-drop accumulate-steps kernel) + `save-replay.test.ts` — replays an action log through the kernel and pins the folded mutable-state hash (tick + RNG + Mission), with a scale / frame-slicing-independence proof (a coarse-frame drive only the no-drop kernel can complete). 146 tests green.

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
- [x] **M0-04** Solar system dataset — done (Sun/Earth/Moon/Mars + sats; vendored as a real file in `data/system.json` — SD-12, was a symlink under SD-4)

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

> **v0.2.1 reshape (GDD §3a/§3b):** M1 sits just past the **hand-management strain threshold** — several simultaneous feeds (M1-01) + a prefetch-*policy* tame-it lever (M1-06b) + a truthful event log (M1-10b, the parse seed). The unit of fun is one full **strain → relief** arc.
> Build order: 01+02 → 03 → 04→05→06 → 06b → 07 → 08/09/10 → 10b → 11 → 12 + telemetry.
> **Single-feed floor (E1–E6) built; the v0.2.1 plural/policy/log layer is the live work (E7→). Human gate assumed-passed for the autonomous build (user directive).**

**Minimal demand & serve-or-starve**
- [x] **M1-01** Demand sources w/ freshness requirements — *M* (was S) · **several simultaneous feeds (≈4–6)**, each a 3-band price, decaying on independent clocks — the plurality IS the strain. **E1:** single `demand.ts` (`band()` + ramp price, SD-17), pinned + wired (E2/E3). **E7 (SD-21):** **5 feeds** as designer-editable data (`src/sim/m1/feeds.ts` `FEED_CONFIGS` → `buildFeeds()`): imagery/weather/telemetry/science/comms, distinct half-lives 1800–5400s, base prices €500–1200, min-acceptable 0.4–0.6, each decaying on its own clock. Plurality IS the strain (3 slots < 5 feeds). Screenshot-verified (3/5 hit · 2 fetch reads at a glance).
- [~] **M1-02** Feasible-path check — *S* · single Earth↔Mars LoS check. **E1:** generalized `lineOfSight(eph,a,b,t,occluders)` in `links.ts` + `resolver.feasible()` (default occluder `sun`), pinned. Live wiring at E2/E3.
- [~] **M1-03** Serve / miss / stale resolution — *M* · fresh/stale/miss/blackout-miss. **E1:** `src/sim/m1/resolver.ts` — pure `resolve()` → `ResolveResult` (the primary telemetry tap), pinned. Live wiring/telemetry at E2/E3/E6.

**Caching / prefetch loop (the actual core)**
- [x] **M1-04** Cache node placement — *M* · cache @ Mars, **a few slots + simple eviction** (which dataset to hold is a choice). **E1/E2:** one-slot `Cache(mars)` wired live (stores on arrival, serves hits), pinned. **E7 (SD-21):** `Cache` generalised to a `datasetId`-keyed multi-slot store (capacity ctor arg, default 1 keeps single-slot tests faithful; session builds 3). On a full store it **evicts the lowest *current* freshness** (judged at real store-time `t`), ties break first-inserted — deterministic; resolver reads `peek(datasetId)`. Which 3 of 5 to hold is the choice. Pinned (new `session.test.ts` multi-slot eviction cases).
- [x] **M1-05** Cache hit / miss logic — *M* · miss = visible pending wait + countdown. **E2:** `src/sim/m1/session.ts` (pure, deterministic) drives demand→resolve each tick; a MISS gates the crawling Earth→Mars packet (auto-relaunch removed); on arrival the sample stores → fresh hit → decays → next miss (the loop breathes). Telemetry SERVE shows `MISS · fetching NNmNNs` (live countdown) / `FRESH|STALE · cache` / `BLACKOUT`; PACKET progress matches the on-orrery crawl. **Screenshot-verified** (mid-crawl: PKT-0001 58% · MISS fetching 6m32s). _Minor: telemetry WAIT/CACHE rows clip below SERVE in OVERVIEW — countdown still on SERVE; full readout polish at E5/M1-10._
- [x] **M1-06** Predictive prefetch action — *M* · manual prefetch = what fills the wait. **E3:** `session.prefetch()` (player-initiated pre-position fetch, €50, gated to one fetch in flight) is the first logged player action ('P' → recorded `SimAction` at `clock.tick`). **E3-fix:** honest arrival freshness `2^(-oneWay/halfLife)≈0.84` gives a ~44-min fresh-hit window so prefetch is a genuinely usable lever (top-up before a blackout); pre-blackout prefetch survives vs no-prefetch eats −500. Determinism: live==replay via shared `applySessionAction`.
- [x] **M1-06b** Prefetch *policy* — the tame-it lever — *M* · **NEW (v0.2.1).** A standing rule that auto-prefetches (keep feeds above X freshness / pre-stage before a forecast blackout) — the *relief* in the strain→relief arc and the first rung of the leverage curve (GDD §4.11): hand-cranking N feeds → declaring intent and watching the system keep up. **E8 (SD-22):** new pure `src/sim/m1/policy.ts` (`PrefetchMode` manual/freshness/freshness_blackout; pure `selectAutoPrefetches`) fires inside `step()` (after arrivals, before resolve), self-rate-limited by `maxConcurrentAuto` counting in-flight legs. Determinism: the policy *change* is a logged `set_prefetch_policy` SimAction (shared `applySessionAction`); the auto-prefetches are *derived* purely → replay re-derives for free (golden re-pinned `8072561960299808504n`). Keys `A`/`[`/`]`; PREFETCH readout (MANUAL vs AUTO@N% / AUTO+BLK), status-strip cell, + a pre-stage audio cue. **Measured sweet-spot floor 0.70** beats both extremes (net €5.4k/hr→€14.4k/hr, +€961 over a run); 237 tests; screenshot-verified manual↔AUTO+BLK. **Caveat (→ E10):** `freshness_blackout` pre-stage — the GDD §4.4/§3a *marquee* insight — is dormant in this ephemeris (Earth-Mars LoS tightest 3.32 Rsun, never occults the 1-Rsun disk); proven in unit tests only. E10 must make a conjunction blackout live-exercisable.
- [~] **M1-07** Coherence level — *S* · ~~two levels~~ **three** (SD-17: GDD §4.4 names strong/eventual/best-effort; GDD outranks the plan). **E1+conformance:** `src/sim/m1/coherence.ts` — `EVENTUAL < BEST_EFFORT < STRONG` ladder (floor 0.5/0.9/0.98, cadence 7200/1800/600s, cost 1/3/6×), pinned. Live wiring at E3.

**Minimal economy + one dashboard + one map**
- [x] **M1-08** Cash, simple revenue & opex — *S* · bankruptcy on `balance<0`. **E3:** `src/sim/m1/economy.ts` (`M1Economy`: balance/applyPayout/chargeOpex×coherence/chargePrefetch/runway/bankrupt) ported + wired into `M1Session` (payout + opex per tick). Good-vs-bad solvency gap proven through the real economy (no-prefetch → bankrupt; prefetch-before-blackout → solvent). Pinned in `economy.test.ts`. _Balance/runway in `FrameState`; the finance PANEL is M1-09 (E4)._
- [x] **M1-09** Single finance panel (mono chrome, coloured data) — *S* · live NETWORK·FINANCE. **E4:** `src/panels/finance.ts` — WALLET (balance/runway) · FLOW (revenue/opex) · VALUE (derived `FRESHNESS PREMIUM €600` + AS-OF age stamp); registered in the OPS preset (key 2); CVD-redundant glyphs (✕/+/−) + structural BANKRUPT banner; fake premium log line removed from `mission.ts`. **Screenshot-verified.** _Surfaced an economy-balance blocker — see M1-12._
- [x] **M1-10** Glanceable map readout — *S* · Mars freshness drain + fetch packet/countdown. **E5:** orrery corner overlay (`src/orrery/readout.ts`, `deriveReadout`): MARS CACHE freshness % (◆/◇/· glyph + draining bar), FETCH ETA (hidden when idle), CONJUNCTION approach gauge (from `marginSolarRadii` → blackout foreseeable), BLACKOUT badge. **Freshness-as-saturation** (§8): Mars node bleeds machine-grey→hot as the cache drains, CVD-redundant (dither coarsens + shrinking halo). E2 telemetry WAIT/CACHE clip fixed. **Screenshot-verified** (empty/grey → 79% saturated).
- [x] **M1-10b** Truthful event log (the parse seed) — the floor/ceiling hinge — *M* · **NEW (v0.2.1).** Every serve/miss/stale, cache hit/miss, prefetch (timely/wasted), blackout — timestamped + honest, surfaced in SYSTEM.LOG + retained for the run (GDD §4.12). Full post-run parse w/ achievable-optimum is M2+; the log must be truthful + complete from day one. **E9 (SD-23):** new pure `src/sim/m1/eventlog.ts` — `M1Event` discriminated union (8 kinds: serve band-transition, fetch_launch, fetch_arrive w/ true landed freshness, cache_store, cache_evict w/ victim+reason+forBy, prefetch manual|auto|prestage, policy, blackout enter|exit), sim-tick timestamps + monotonic seq, **edge-triggered** (transitions not per-tick level). Emitted purely from `step()`/`prefetch()`/`setPolicy()` → the stream **replays bit-identically** (new `eventlog-replay.test.ts`), kept OUT of the state hash so **golden stayed stable** `8072561960299808504n`. SYSTEM.LOG renders ONLY the real stream (scripted SD-8 feed de-wired; "PKT 0.50" lie fixed at root) via pure `log-format.ts` w/ §8 per-token highlighting (severity/entity/time+freshness/value), incremental append (no per-frame rebuild, 400-row cap). 261 tests; screenshot-verified.
- [x] **M1-11** Cache-hit audio cue — *S* · first audio; Web Audio API. **E5:** `src/audio/cue.ts` — lazy AudioContext on first user gesture (autoplay-safe), one-way `CueBus` (sim stays Web-Audio-free), synthesised blips (cache-hit rising ping / fetch-arrival / stale / blackout; pitch encodes good/bad), `emitCueTransition` on rising edges. 8 tests pin the bus + edges. _Code-verified; unheard in headless — needs a real listen._
- [ ] **M1-12** 30-minute scenario script — *M* (was S) · tuned to the **strain threshold**: several feeds + a scripted, predictable conjunction to pre-stage against. Target arc: overwhelmed hand-managing feeds → discover prefetch policy → in control → blackout tests the policy. _(E10. The earlier economy-balance blocker is RESOLVED — E6a continuous rates, SD-20.)_
- [ ] **M1-GATE** Playtest instrumentation — *S–M* · telemetry action log + event stream + gate metrics + the post-run "do it better?" prompt. _(E10.)_

**Gate (sharpened, GDD §3a/§9):** ≥5 testers cold. Old PASS (cache/prefetch tuning + blackout tension + can say why) is necessary but **not sufficient**. Sharpened: (1) the **strain→relief arc fires** — the tester struggles to hand-manage the feeds, *discovers* the prefetch policy, feels the relief (tames to *functional*); (2) **the optimiser hook fires (decisive)** — the tester finishes **wanting to look at what happened and do it *better*** (wants a re-run to fix what they now see). FAIL = finishes-and-shrugs / "a spreadsheet" → iterate viz+core+strain-tuning; 3 fails ⇒ rethink premise. **The human gate is the user's to run; assumed-passed for the autonomous build (user directive), so M2+ proceeds.**

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
- [~] **X-05** Audio system — Web Audio API; one-way event-bus → cues. **First cue landed (M1-11/E5):** `src/audio/cue.ts` lazy gesture-unlock + `CueBus` (sim stays Web-Audio-free). Health-sonification M2+.
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
- ⬜ Save/replay backbone — P0-06 ✅ (B1+B3); P0-05 format ✅ (B2); live action-log recording + snapshot scale/pause owed at E3

---

*Keep `[x]` honest — tick only when the plan's "Done when" is actually met. Re-detail M2+ after the M1 gate.*
