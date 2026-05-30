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
- [x] **M1-06b** Prefetch *policy* — the tame-it lever — *M* · **NEW (v0.2.1).** A standing rule that auto-prefetches (keep feeds above X freshness / pre-stage before a forecast blackout) — the *relief* in the strain→relief arc and the first rung of the leverage curve (GDD §4.11): hand-cranking N feeds → declaring intent and watching the system keep up. **E8 (SD-22):** new pure `src/sim/m1/policy.ts` (`PrefetchMode` manual/freshness/freshness_blackout; pure `selectAutoPrefetches`) fires inside `step()` (after arrivals, before resolve), self-rate-limited by `maxConcurrentAuto` counting in-flight legs. Determinism: the policy *change* is a logged `set_prefetch_policy` SimAction (shared `applySessionAction`); the auto-prefetches are *derived* purely → replay re-derives for free (golden re-pinned `8072561960299808504n`). Keys `A`/`[`/`]`; PREFETCH readout (MANUAL vs AUTO@N% / AUTO+BLK), status-strip cell, + a pre-stage audio cue. **Measured sweet-spot floor 0.70** beats both extremes (net €5.4k/hr→€14.4k/hr, +€961 over a run); 237 tests; screenshot-verified manual↔AUTO+BLK. **Caveat RESOLVED in E10a (SD-24):** the `freshness_blackout` pre-stage is now live against the REAL ephemeris — see M1-blk below.
- [x] **M1-blk** Conjunction-blackout corridor (the marquee insight, live) — *M* · **NEW.** **E10a (SD-24, retires SD-22's gap):** the Mars solar-conjunction blackout is modelled as a *solar-interference corridor* — the Earth↔Mars link is dead when its LoS passes within `SOLAR_CORRIDOR_RSUN` (default 5) solar radii of the Sun *centre* (the physically-honest small-SEP RF-noise criterion), a clean generalisation of the old 1-Rsun disk occlusion (N=1 ≡ the disk). One dial in `src/sim/links.ts`; `segmentSphere` gains a separate block-radius, `lineOfSight`/`feasible`/`earthMarsLos` thread the corridor (still requiring the Sun strictly *between* the endpoints, so a near-side Sun never blacks out). The real conjunction (t ≈ **15,731,438 s**, tightest miss **3.322 Rsun**) now opens a **≈582,650 s (≈6.7-day)** blackout window; `feasible()` goes false → resolver `blackout_miss` → economy SLA penalty → BLACKOUT readout → blackout enter/exit events — the whole pre-wired pathway lights up. Proven against the real eph in `src/sim/m1/conjunction-blackout.test.ts`: scans for the conjunction, asserts in-corridor infeasibility + blackout_miss + bracketing events, and the marquee payoff — `freshness_blackout` pre-stages live (feasible(now) && !feasible(t+lead), cause `prestage`) and a pre-staged feed *serves through* the blackout from cache while an un-staged feed takes the SLA hit. Determinism: replay golden **unchanged `8072561960299808504n`** (the replay window never reaches a conjunction, so no resolve outcome moved — verified) + a corridor-purity determinism test. Render: the CONJUNCTION readout foreshadows (watch/warn as the margin tightens toward the corridor) and reads BLACKOUT inside; gauge bands keyed off the live corridor threshold. 277 tests; screenshot-verified blackout + pre-stage relief.
- [~] **M1-07** Coherence level — *S* · ~~two levels~~ **three** (SD-17: GDD §4.4 names strong/eventual/best-effort; GDD outranks the plan). **E1+conformance:** `src/sim/m1/coherence.ts` — `EVENTUAL < BEST_EFFORT < STRONG` ladder (floor 0.5/0.9/0.98, cadence 7200/1800/600s, cost 1/3/6×), pinned. Live wiring at E3.

**Minimal economy + one dashboard + one map**
- [x] **M1-08** Cash, simple revenue & opex — *S* · bankruptcy on `balance<0`. **E3:** `src/sim/m1/economy.ts` (`M1Economy`: balance/applyPayout/chargeOpex×coherence/chargePrefetch/runway/bankrupt) ported + wired into `M1Session` (payout + opex per tick). Good-vs-bad solvency gap proven through the real economy (no-prefetch → bankrupt; prefetch-before-blackout → solvent). Pinned in `economy.test.ts`. _Balance/runway in `FrameState`; the finance PANEL is M1-09 (E4)._
- [x] **M1-09** Single finance panel (mono chrome, coloured data) — *S* · live NETWORK·FINANCE. **E4:** `src/panels/finance.ts` — WALLET (balance/runway) · FLOW (revenue/opex) · VALUE (derived `FRESHNESS PREMIUM €600` + AS-OF age stamp); registered in the OPS preset (key 2); CVD-redundant glyphs (✕/+/−) + structural BANKRUPT banner; fake premium log line removed from `mission.ts`. **Screenshot-verified.** _Surfaced an economy-balance blocker — see M1-12._
- [x] **M1-10** Glanceable map readout — *S* · Mars freshness drain + fetch packet/countdown. **E5:** orrery corner overlay (`src/orrery/readout.ts`, `deriveReadout`): MARS CACHE freshness % (◆/◇/· glyph + draining bar), FETCH ETA (hidden when idle), CONJUNCTION approach gauge (from `marginSolarRadii` → blackout foreseeable), BLACKOUT badge. **Freshness-as-saturation** (§8): Mars node bleeds machine-grey→hot as the cache drains, CVD-redundant (dither coarsens + shrinking halo). E2 telemetry WAIT/CACHE clip fixed. **Screenshot-verified** (empty/grey → 79% saturated).
- [x] **M1-10b** Truthful event log (the parse seed) — the floor/ceiling hinge — *M* · **NEW (v0.2.1).** Every serve/miss/stale, cache hit/miss, prefetch (timely/wasted), blackout — timestamped + honest, surfaced in SYSTEM.LOG + retained for the run (GDD §4.12). Full post-run parse w/ achievable-optimum is M2+; the log must be truthful + complete from day one. **E9 (SD-23):** new pure `src/sim/m1/eventlog.ts` — `M1Event` discriminated union (8 kinds: serve band-transition, fetch_launch, fetch_arrive w/ true landed freshness, cache_store, cache_evict w/ victim+reason+forBy, prefetch manual|auto|prestage, policy, blackout enter|exit), sim-tick timestamps + monotonic seq, **edge-triggered** (transitions not per-tick level). Emitted purely from `step()`/`prefetch()`/`setPolicy()` → the stream **replays bit-identically** (new `eventlog-replay.test.ts`), kept OUT of the state hash so **golden stayed stable** `8072561960299808504n`. SYSTEM.LOG renders ONLY the real stream (scripted SD-8 feed de-wired; "PKT 0.50" lie fixed at root) via pure `log-format.ts` w/ §8 per-token highlighting (severity/entity/time+freshness/value), incremental append (no per-frame rebuild, 400-row cap). 261 tests; screenshot-verified.
- [x] **M1-11** Cache-hit audio cue — *S* · first audio; Web Audio API. **E5:** `src/audio/cue.ts` — lazy AudioContext on first user gesture (autoplay-safe), one-way `CueBus` (sim stays Web-Audio-free), synthesised blips (cache-hit rising ping / fetch-arrival / stale / blackout; pitch encodes good/bad), `emitCueTransition` on rising edges. 8 tests pin the bus + edges. _Code-verified; unheard in headless — needs a real listen._
- [x] **M1-12** 30-minute scenario script — *M* (was S) · tuned to the **strain threshold**: several feeds + a predictable conjunction to pre-stage against. Target arc: overwhelmed hand-managing feeds → discover prefetch policy → in control → blackout tests the policy. **E10b (SD-25):** new `src/sim/m1/scenario.ts` (one-place dial) places the start epoch at **t0=14,500,000 s** (~10.9 days before the real conjunction); `main.ts` boots `clock.setTick(SCENARIO.tick0)` so the sim clock IS ephemeris time (telemetry CLOCK row shows **MET** mission-elapsed, reads 0 at boot). Starting margin 15.93 Rsun (green); Mars 2.59 AU → one-way ~21.5 min (the dramatic light-delay moment). Arc fits a session: first fetch ~13 real-s at the 100× boot (strain felt); ramp to 1000× → blackout enters ~15.7 real-min, dwellable ~9.7 min; CONJUNCTION readout foreshadows monotonically green→watch→warn→BLACKOUT. Fixed the E10a lead minor (`blackoutLeadS` 1200→1800 > max one-way ~1305s, so a default-mode pre-stage beats the gap). Golden re-pinned `544847093270497462n`; 292 tests; screenshot-verified the approach foreshadow + blackout. _Open minor RESOLVED in E10c (SD-26): the default boot scale is now a scenario `defaultScaleIndex` dial (1000×) + a one-shot foreshadow nudge, so a passive player completes the arc without discovering time-accel unaided._
- [x] **M1-GATE** Playtest instrumentation — *S–M* · telemetry action log + event stream + gate metrics + the post-run "do it better?" prompt. **E10c (SD-26):** new pure `src/sim/m1/parse.ts` — `parseRun(EventLog, RunContext)` folds the E9 truthful stream into a `RunParse`: PER-CONTRACT post-mortem (per-feed fresh/stale/miss/blackout seconds by integrating the edge-triggered serve transitions + fetches/prefetches/evictions + the specific miss called out), AGGREGATE `GateMetrics` (fresh/stale/miss/blackout %, prefetches **timely vs wasted** + the € on wasted legs, blackout-handling verdict served_through|partial|went_dark + a `blackoutHandled` flag, net €), and the HEADLINE efficiency = actual fresh-fraction / a **heuristic achievable bound** (slots/feeds of link-up time, blackout excluded — labelled `achievable (est.)`, NOT a solver; M2+) with the `freshGap` "do it better" hook. PURE read (no three/DOM/clock/RNG, never re-derives — folds straight from the log), so the parse can't disagree with the record (§4.12 honesty) and is deterministic; `parse.test.ts` (9) pins band-time, the bound+gap, timely/wasted, and the blackout verdicts off a known event sequence. Surfaced reviewable-at-rest as `src/panels/parse.ts` (THE PARSE, GDD §5 view #9) — §8 1-bit chrome housing, data on the shared warmth ramp; a 6th WM preset **PARSE** (key 6) + a **G** toggle key; refreshed (forced) on view-entry + dirty-checked per-frame while shown (re-folds only when `events.appended` grew — free at rest). Onboarding (the E10b minor): scenario `defaultScaleIndex` boots the LIVE clock at **1000×** so a passive player reaches+dwells in the blackout in a sitting, plus a one-shot foreshadow NUDGE into SYSTEM.LOG on watch-band entry ("CONJUNCTION in Nd — set time-accel ( , / . ) … pre-stage (P / A)…") that POINTS at the controls (Risk-6: still decision-space). Determinism: the parse never mutates sim state + the default-scale/nudge touch only the live loop, so the replay golden is **unchanged `544847093270497462n`**; 304 tests; tsc + build clean; screenshot-verified THE PARSE (preset 6 / G; seek ≈15.435e6 s then play across the blackout) + the nudge line.

**Gate (sharpened, GDD §3a/§9):** ≥5 testers cold. Old PASS (cache/prefetch tuning + blackout tension + can say why) is necessary but **not sufficient**. Sharpened: (1) the **strain→relief arc fires** — the tester struggles to hand-manage the feeds, *discovers* the prefetch policy, feels the relief (tames to *functional*); (2) **the optimiser hook fires (decisive)** — the tester finishes **wanting to look at what happened and do it *better*** (wants a re-run to fix what they now see). FAIL = finishes-and-shrugs / "a spreadsheet" → iterate viz+core+strain-tuning; 3 fails ⇒ rethink premise. **The human gate is the user's to run; assumed-passed for the autonomous build (user directive), so M2+ proceeds.**

---

## Milestones 2–6 (headlines only — detail after M1 PASS)

- [x] **M2 — Earth tycoon vertical slice:** coverage grid, coverage field, link budget, placeable assets, launch market, contracts state machine, escalation engine, emergent-event generator v1, one coverage heatmap. **COMPLETE (M2a–M2f, SD-27..SD-32):** the full GDD §9 M2 scope, built + adversarially verified on a separate deterministic M2 world (own golden `6225853297339560787n`; M1 golden `544847093270497462n` untouched). The loop is live: build the coverage monument → serve contracts for € → demand grows where you serve (escalation) → emergent shocks/rivals perturb it. _Owed/deferred (later M2 polish or M3+): Level-1 routing policy + the trace view (the §4.3a/§5 seed the plan lists under M2); deep rival-competition AI; globe-raycast placement; the connectivity-ramp + escalation-bite tuning; demand-overlay colour channel._
  - [x] **M2a — geodesic coverage grid + coverage field (GDD §4.2 "The Heart", SD-27).** Pure, standalone `src/sim/coverage/`: roll-your-own subdivided-icosahedron grid (`grid.ts`, triangular faces, 20·4^level, default level 2 → 320 cells, symmetric degree-3 adjacency, areas sum to 4π), deterministic placeholder demand field (`demand.ts`, lat-band + fixed hotspots, no RNG), `coverageOf(cell, assets, t)` over the §4.2 dimensions connectivity/bandwidth/latency with the LoS-horizon + inverse-square/min-elevation link budget reusing the ephemeris (`field.ts`), and the demand-weighted multi-axis scoring stub (`score.ts`). NOT wired into M1Session → replay golden `544847093270497462n` untouched. M2b renders it.
  - [x] **M2b — coverage heatmap render (GDD §5 view #2, the monument begins, SD-28).** Render-only `src/orrery/`: `coverage-overlay.ts` builds a 320-triangle shell ONCE from the grid's corner unit-vectors, floating-origin-rebased to hug Earth a hair above the surface; `heatmap-color.ts` (pure, tested) maps each cell to a §8 hue ramp by the selected dimension — connectivity=cyan / bandwidth=green / latency=amber (lower=hotter), uncovered cells dark-desaturated (a visible hole in the web), CVD-redundant via brightness × opacity. Live coverage swept each frame from the 4 dataset sats via the allocation-free `coverageDimsAt` fast path (parity-pinned to `coverageOf`); X-02 honoured (geometry built once, colour buffer rewritten in place). Keys **H** toggle / **D** cycle dimension; footer + readout show the active dimension. Render-only → golden `544847093270497462n` untouched. 355→369 tests; screenshot-verified (cyan connectivity + green bandwidth shells on Earth, the dimension cycle, clean toggle-off). _Tuning (placeholders, flagged): CONNECTIVITY_HOT=3 reads flat at 4 sats (→2 once more assets exist); shell prominence is modest at curated camera distances (a dedicated Earth-coverage framing is later polish); coverageCellColor allocates ~320 tiny objects/frame (negligible)._
  - [x] **M2c — build-the-monument loop: placeable assets + launch market (GDD §3/§4.7, SD-29).** New separate deterministic M2 world `src/sim/m2/` (`roster.ts` placeable ground/sat roster; `orbit.ts` pure Keplerian propagation for launched sats — own elements, not in the shared ephemeris; `launch.ts` market = 3 presets LEO/MEO/GEO with €cost + seeded failure roll; `sites.ts` candidate sites + starter; `session.ts` `BuildSession` = roster + own €5000 wallet + seeded PRNG, snapshot/restore; `apply-build-action.ts` shared applier). Keys **B** deploy (€250) / **L** launch (€600–1800, charged win-or-lose) / **;** cycle preset. The M2b heatmap + `scoreCoverageAt` read the LIVE roster so coverage GROWS as you build; readout shows `DEMAND NN% · Ngs/Nsat · €NNNN [OVERSPENT]`. Own replay golden `2503511112643458855n` (records deploys + launches incl. a seed-failure; LIVE==REPLAY + coverage-grows invariant); **M1 golden `544847093270497462n` untouched**. 369→393 tests; screenshot-verified (built 6gs/4sat, coverage 9%→76%, €‑3200 overspend with an exact-math seeded launch failure). _Minors: altitudeKm holds semi-major axis (rename owed); constellation-spread wrap; body-fixed frame (inherited)._
  - [x] **M2d — contracts state machine + coverage revenue (GDD §4.9/§3, SD-30).** Closes the gap→asset→integration→revenue loop. New pure `src/sim/m2/contracts.ts` (Contract = region cells + quality + tariff + term; OFFERED→ACTIVE→COMPLETED/FAILED) + `contract-generator.ts` (deterministic seeded offers off the session PRNG) + `servedFractionAt` (region demand-weighted served fraction over the live roster). New `BuildSession.step(eph,t,dt)`: continuous DT-invariant revenue (€/s = tariff × servedFraction, −1.5/s breach penalty) summed into the wallet. Actions `accept_contract`/`decline_contract` via the shared applier; keys **N** cycle / **K** accept / **J** decline. CONTRACTS board panel (WM preset **key 7**), §8 chrome, colour-redundant STATE words. M2 golden re-pinned `2503511112643458855n`→`5706799219860839795n` (LOOP-CLOSES + DT-invariance + decline tests); **M1 golden `544847093270497462n` untouched**. 393→408 tests. Loop closes (verified): golden replay €5000→−€350→+€2398→**€2048 net-positive**; live run €1304→€6192 serving. Screenshot-confirmed the board + the breach/fail path + exact capex wallet math; active-serving wallet-climb verified numerically (blind keypress couldn't align coverage-region to offer cadence at 1000×). _Minors: latent dt-dependent generator re-arm (unreachable at current cadence); sub-tick accept timing ≤1 tick (bit-identical at live DT)._
  - [x] **M2f — emergent-event generator v1: rivals + news shocks (GDD §3 / Risk-7, SD-32).** New pure `src/sim/m2/events.ts` (M2Event: demand_shock / rival_action / news + M2EventLog) + `event-generator.ts` (deterministic seeded, first at 2400s, ~4h cadence) + `rivals.ts` (3 named operators with §8 identity hues — HELIX RELAY violet / MERIDIAN LINK orange / PALE BLUE NET blue). World coupling: a demand_shock applies a decaying per-cell multiplier overlay on DynamicDemand (ripples through scorers/contracts, expires to ×1.0, never inflates the bounded growth); a rival relay_failure spawns a real premium contract (`r{N}`, ×1.6). Surfaced §8-truthfully in SYSTEM.LOG with faction-coloured names via `log.renderM2()`. M2 golden re-pinned `15734905161678697793n`→`6225853297339560787n`; **M1 golden untouched**. 418→427 tests; screenshot-verified (SOUTH-AMERICA dust storm + a `✕ MERIDIAN LINK RELAY FAILURE … their customers come knocking` line in orange). _Deep rival-competition AI deferred to M3+; flavour numbers/cadence are placeholders._
  - [x] **M2e — the escalation engine: demand grows where you serve (GDD §3b gen 1 / Pillar 6, SD-31).** New pure `src/sim/coverage/dynamic-demand.ts`: per-cell demand grows logistically toward a 3× cap where served (quality≥bar), decays toward the M2a baseline floor where not — integrated by the EXACT closed-form flow (DT-invariant semigroup, bounded, no RNG). A `DemandReader` interface makes static+dynamic drop-in for the scorers. `BuildSession.step` advances growth on a 60-s sim-cadence (sweeps served-quality via the allocation-free gates), folds the dynamic field into the snapshot/state-hash. Escalation verified: fixed roster → total demand 154→392 (2.54×, capped), covered fraction eroded 0.546→0.507; adding capacity restored 0.914 (the renewing OpenTTD cycle). M2 golden re-pinned `5706799219860839795n`→`15734905161678697793n`; **M1 golden untouched**. 408→418 tests. Orrery readout `COVERED NN% · DEMAND·GROWTH +NN%`; screenshot-verified `COVERED 81% · DEMAND·GROWTH +55%`. _Minors: coexisting static fallback field in orrery; cadence-divides-dt DT caveat (honored by the fixed-DT callers); gentle per-sitting bite (−0.039/41sim-hr) — placeholder constants._
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
