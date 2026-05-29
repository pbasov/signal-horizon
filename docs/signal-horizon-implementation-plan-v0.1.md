# SIGNAL HORIZON — Implementation Plan & Ticket Backlog
### v0.1 · companion to GDD v0.5

> Engineering plan, priorities, and a paste-ready ticket backlog. This is the *how/when*; the GDD is the *what/why*. Where they ever disagree, the GDD wins on design and this doc wins on sequencing.

---

## 0. How to read this

- Work is grouped into a **Phase 0 (foundations)** plus **Milestones M0–M6** matching GDD §9. Each milestone has **epics**; each epic has **tickets**.
- Tickets use a compact, portable format so they drop straight into GitHub Issues / Linear / Jira:
  > **[ID] Title** — *Size · Depends: …*
  > One or two sentences of scope. **Done when:** testable acceptance criteria.
- **Detail is deliberately front-loaded.** P0, M0 and M1 are specified tightly because they gate everything. M2–M4 are epics + headline tickets only. M5–M6 are sketches. Per GDD §10, the endgame must not be designed in detail until the mid-game is proven fun — so this doc refuses to pretend otherwise.
- **The single most important fact in this plan:** **M1 is a kill-gate.** Its only job is to answer *"is watching and optimising light-delayed information flow fun for 30 minutes with no narrative?"* If M1 fails its playtest (§ M1 below), the correct action is to stop or pivot the core — not to build M2. Everything before M1 exists to reach that question as cheaply as possible.

**Sizing legend (solo-dev gut estimates, not commitments):** `S` ≈ ≤1 day · `M` ≈ 2–4 days · `L` ≈ 1–2 weeks · `XL` ≈ multi-week, break down further before starting · `SPIKE` = time-boxed research/decision, produce a written conclusion not production code.

**Status legend (for spike-validated tickets):** `DONE-SPIKE` = demonstrated working in the spike · `NEEDS-PORT` = design unchanged from Godot plan but not yet built in TS · no marker = design unchanged, not yet started.

---

## 1. Engineering principles (lock these before writing feature code)

1. **The sim is pure and headless.** Everything in `src/sim/` is plain TypeScript data + functions with **no DOM, no Three.js, no rendering, no input**. It must run under Vitest with zero browser or WebGL setup. This is what makes determinism, testing, fast-forward, and (someday) a server authority possible. Treat any `import`/reference from `src/sim/` into `src/orrery/`, `src/panels/`, or `src/wm/` as a build-breaking mistake.
2. **Determinism first, always.** Given the same seed + same ordered action log, the sim produces a bit-identical state. No wall-clock, no unseeded RNG, no frame-rate-dependent logic, no requestAnimationFrame in the sim. This is non-negotiable and is enforced by a replay test (P0). TS needs a fixed-tick reimplementation (the spike uses a plain f64 accumulator; the real product requires an integer fixed-step tick for bit-determinism, just like the Godot project's `SimClock`).
3. **Truth is f64; the render lie is f32.** Sim positions/velocities are stored as 64-bit doubles in our own structs — **never** in Three.js `Vector3`/`BufferAttribute` (those are f32). Conversion to f32 happens *only* at the floating-origin rebase boundary in `src/orrery/`. (TS `number` is f64 natively; the port from C# `double` is zero-cost.)
4. **Position is a pure function of sim-time.** Because propagation is analytic Kepler (not integration), `position(body, t)` is stateless and reproducible for any absolute `t`. Time-acceleration just advances the authoritative sim-clock faster; it never scales physics constants. Fast-forward and save/load fall out of this for free.
5. **Vertical slices, not horizontal layers.** Build one thin end-to-end path (sim → orrery → one panel) before widening. Resist building "the whole economy" or "all seven dashboards." One excellent view per milestone (GDD §5/§10).
6. **Test the fun before the depth.** The cheapest possible thing that can answer "is this fun?" beats the correct thing that takes three months. M1 is engineered around this.
7. **Monochrome machine, coloured signal (GDD §8) is an architecture boundary too.** Chrome (CSS theme, window frames, icons) is one styling system; the signal layer (orrery overlays, dashboard data series, terminal syntax highlighting) is a separate, colour-aware rendering path with redundant (dither/shape) encoding baked in from the start, not retrofitted.

---

## 2. Tech decisions to lock now (Phase 0 spikes)

- **[P0-S1] Pin the Node + Three.js versions** — *SPIKE (S) · DONE-SPIKE* · Pin exact versions: Node (runtime), Three.js `^0.184.0`, TypeScript `^6.0.3`, Vite `^8.0.14`, Vitest `^4.1.7`, Playwright `^1.60.0`. **Done when:** versions pinned in `package.json` and README; `npm install && npm test && npm run dev` all pass from a clean clone.
- **[P0-S2] Sim-core implementation approach** — *SPIKE (S) · RESOLVED BY SPIKE* · The sim core is pure **TypeScript** with **no DOM or Three.js imports** (`src/sim/`), keeping it rigorously pure so the hot path (Kepler propagation, routing solver) stays portable to a Rust/WASM kernel *later, only when a profiler says so*. The Kepler truth layer is already ported and pinned bit-identical to the C# implementation (14/14 Vitest pass vs the golden master). **Done when:** decision + rationale written; the purity boundary (principle #1) documented as a lint/review rule.
- **[P0-S3] Test & CI tooling** — *SPIKE (S) · DONE-SPIKE* · Vitest for pure-TS unit tests, Playwright (headful ungoogled-chromium) for visual regression. Confirm test execution works locally and in CI. **Done when:** `npm test` passes on your machine and in CI.

---

## 3. Critical path (one paragraph)

`P0 foundations` → `M0 sim spike + a coloured packet crawling to Mars` → **`M1 fun-gate (STOP/GO)`** → `M2 Earth vertical slice` → `M3 cislunar on-ramp` → `M4 interplanetary (the game becomes itself)` → post-1.0 (`M5 outer/DTN`, `M6 optional information economy`). Cross-cutting epics (determinism, perf, accessibility, save/load, audio, content pipeline) run continuously from P0. **Do not start M2 until M1 passes its gate.**

---

## Phase 0 — Foundations (engineering backbone)

*Goal: a deterministic, testable skeleton you can build features on without regret. ~1–2 weeks.*

**Epic: Project & repo setup**
- **[P0-01] Repo + project skeleton** — *S · DONE-SPIKE* · Git repo, `package.json`, `.gitignore`, README, license, module folders `src/sim/ src/orrery/ src/panels/ src/wm/ src/main.ts data/` per GDD §6. **Done when:** project opens in browser via `npm run dev`; folder boundaries documented in README.
- **[P0-02] CI: test + build check** — *M · P0-S3 · NEEDS-PORT* · CI pipeline that runs `npm test` (Vitest) and `npm run build` on push. **Done when:** green pipeline on a trivial commit; failing test fails the build. *(You're a DevOps engineer — make this nice early; it pays for itself.)*

**Epic: Deterministic core backbone**
- **[P0-03] Authoritative sim-clock + fixed-step tick** — *M · P0-01 · NEEDS-PORT* · A sim clock holding absolute time; a fixed-dt advance loop decoupled from render framerate (accumulator pattern). Time-acceleration multiplies how fast the clock advances, nothing else. The spike uses a plain f64 accumulator (SD-7); this ticket replaces it with an integer fixed-step tick for bit-determinism, matching the Godot project's `SimClock` discipline. **Done when:** ticking at 1× and 100× for the same sim-duration yields identical end-state (unit test).
- **[P0-04] Seeded RNG abstraction** — *S · P0-01 · NEEDS-PORT* · All randomness flows through one seeded PRNG owned by the sim. No `Math.random()` calls scattered in gameplay. **Done when:** two runs with the same seed produce identical RNG streams; grep shows no stray global RNG use in `src/sim/`.
- **[P0-05] Action-log + state-snapshot save format** — *M · P0-03 · NEEDS-PORT* · Save = seed + initial conditions + ordered action log (+ periodic snapshots for fast load), per GDD §6. Stub the action types; the format matters more than coverage now. **Done when:** a session can be saved and reloaded to an identical state hash.
- **[P0-06] Determinism / replay golden-master test** — *M · P0-03, P0-04, P0-05 · NEEDS-PORT* · A test harness that replays a recorded action log and asserts a bit-identical state hash against a stored golden value. **Done when:** the harness runs in CI and fails loudly on any nondeterminism regression. *This is the most valuable test in the project; write it before the sim gets complex.*

**Epic: Rendering & styling backbone**
- **[P0-07] Floating-origin scene manager** — *M · P0-01 · DONE-SPIKE* · Rebase the Three.js scene to the active camera focus each frame; sim stays in absolute f64; convert to `Float32Array` only here. **Done when:** an object 1e9 m from origin renders with no visible jitter when the camera focuses near it.
- **[P0-08] 1-bit chrome theme + signal-layer styling split** — *M · P0-01 · DONE-SPIKE* · Two distinct styling systems (GDD §8): CSS for monochrome OS chrome, and a colour-aware "signal" draw path with redundant dither/shape encoding hooks. Stub a colour-blind-safe palette + a "monochrome purist" toggle now so it's never retrofitted. **Done when:** a window with mono chrome displays a coloured data swatch that also reads correctly with colour forced off.

---

## Milestone 0 — Sim spike + the visible web

*Goal (GDD §9): headless Kepler propagator + floating-origin orrery rendering Earth/Moon/Mars + a few satellites at honest scale, with time controls, and you can watch a coloured packet crawl Earth→Mars with honest (compressed) light-delay and visible freshness decay. Proves the sim/render split, the precision approach, and that the invisible product can be drawn.*

**Epic: Orbital sim core (truth layer)**
- **[M0-01] f64 Keplerian element model** — *M · P0-03 · DONE-SPIKE* · Body/orbit structs storing classical orbital elements (a, e, i, Ω, ω, M₀, epoch) and physical constants, in f64, loaded from `data/`. **Done when:** Sun/Earth/Moon/Mars load from JSON with realistic elements.
- **[M0-02] Analytic Kepler propagation `position(body, t)`** — *L · M0-01 · DONE-SPIKE* · Solve Kepler's equation (Newton iteration on eccentric anomaly) to return state vectors at any absolute `t`. Stateless, deterministic. **Done when:** propagated positions match a reference ephemeris within tolerance at sampled dates; `position(t)` then `position(t)` again is bit-identical.
- **[M0-03] Earth-orbit satellite propagation** — *M · M0-02 · DONE-SPIKE* · A few LEO/GEO satellites via Kepler (SGP4 deferred — log it as optional). **Done when:** a GEO sat holds station over a ground point; a LEO sat visibly orbits at honest period.
- **[M0-04] Minimal solar system dataset** — *S · M0-01 · DONE-SPIKE* · `data/` JSON for Sun, Earth, Moon, Mars + 2–3 satellites. **Done when:** loads headless and renders.

**Epic: Render layer (the orrery)**
- **[M0-05] Orrery scene: bodies + orbits (1-bit)** — *M · P0-07, P0-08, M0-02 · DONE-SPIKE* · Bodies as dithered circles (Bayer 4×4 terminator stipple billboards), orbits as dashed lines (`BufferGeometry`), on the near-black field. Selectable scale compression (log-fold). **Done when:** the inner system renders legibly at two compression levels.
- **[M0-06] LOD / icon collapse for distant objects** — *S · M0-05 · DONE-SPIKE* · Distant bodies/assets collapse to icons + labels. Constant-screen-size billboards. **Done when:** zooming out swaps meshes for icons without popping artefacts.
- **[M0-07] Camera + selection controls** — *S · M0-05 · DONE-SPIKE* · Orbit camera (drag azimuth/elevation, wheel zoom); body-anchored focus cycling; four animated camera presets (CISLUNAR / ORBITS / SYSTEM / TOP-DOWN). **Done when:** you can fly the camera and select objects.
- **[M0-08] Time controls UI (pause + variable accel)** — *S · P0-03, M0-05 · DONE-SPIKE* · Pause and multi-speed controls wired to the sim-clock. **Done when:** speeding up advances orbits faster with zero change to orbital periods-in-sim-seconds (constants untouched).

**Epic: The visible signal (make-or-break, starts here per GDD §5)**
- **[M0-09] Link model + line-of-sight + distance** — *M · M0-02 · DONE-SPIKE* · A link between two nodes; compute occlusion by bodies and instantaneous distance. **Done when:** an Earth↔Mars link reports "blocked" when the Sun is between them and "open" otherwise.
- **[M0-10] Light-delay computation + display** — *S · M0-09 · DONE-SPIKE* · One-way light time = distance ÷ c, surfaced in UI as `as of Xm Ys ago`. **Done when:** Earth↔Mars shows a delay that grows/shrinks correctly as the planets move.
- **[M0-11] Packets-in-flight rendering (coloured signal)** — *M · M0-09, M0-10, P0-08 · DONE-SPIKE* · A packet object that travels a link at compressed-but-honest light speed, drawn as a coloured moving glyph. **Done when:** you can watch a packet crawl Earth→Mars and its travel time tracks M0-10.
- **[M0-12] Freshness-as-saturation prototype** — *M · M0-11 · DONE-SPIKE* · A data sample carries an age; render it desaturating toward the machine-grey as it stales (GDD §8 signature cue), with a redundant dither-grain channel so it reads colour-blind. **Done when:** a served sample visibly "drains" colour over its half-life and still reads with colour off.

**M0 exit criteria:** all of the above green; determinism test (P0-06) still passes with orbital sim included; you can sit and watch a coloured packet make the honest, slow trip to Mars and fade. *This is the first time the game's whole thesis is on screen.*

---

## Milestone 1 — THE FUN GATE (build the least, learn the most)

*Goal: answer the only question that decides whether this project should continue. Minimal economy, minimal map, maximal core loop. Do not add anything not strictly needed to feel the caching/light-delay tension.*

**Epic: Minimal demand & serve-or-starve**
- **[M1-01] One demand source with a freshness requirement** — *S · M0-12 · NEEDS-PORT* · A single customer (e.g., a Mars base) requests a dataset and pays more for fresher data. **Done when:** demand exists, ticks, and has a freshness-vs-price curve.
- **[M1-02] Feasible-path check (connectivity)** — *S · M0-09 · NEEDS-PORT* · Can data get from source to demand over current links? **Done when:** demand is served only when a feasible path exists; a blackout (M0-09) starves it.
- **[M1-03] Serve / miss / stale resolution** — *M · M1-01, M1-02 · NEEDS-PORT* · Meeting demand with fresh data → revenue; stale → reduced revenue; miss → penalty. **Done when:** the finance number moves correctly across all three cases.

**Epic: The caching / prefetch loop (the actual core)**
- **[M1-04] Cache node placement** — *M · M0-09 · NEEDS-PORT* · Place a cache/edge node at a relay; it stores a dataset with an age. **Done when:** a cache can be placed and holds data that stales over time.
- **[M1-05] Cache hit / miss logic** — *M · M1-03, M1-04 · NEEDS-PORT* · Hit → serve local (low latency, possibly stale); miss → fetch across the light-gap (customer waits). **Done when:** hits and misses produce visibly/audibly different outcomes and different revenue.
- **[M1-06] Predictive prefetch action** — *M · M1-04 · NEEDS-PORT* · Spend €/bandwidth to pre-position a dataset on a forecast of future demand. **Done when:** a well-timed prefetch turns a future miss into a fresh hit; a mistimed one wastes spend.
- **[M1-07] Coherence level (simplified)** — *S · M1-05 · NEEDS-PORT* · Two levels in M1 (e.g., eventual vs best-effort) with distinct €/latency profiles. **Done when:** choosing a level measurably changes cost and freshness.

**Epic: Minimal economy + one dashboard + one map**
- **[M1-08] Cash, simple revenue & opex** — *S · M1-03 · NEEDS-PORT* · Balance, revenue from served demand, opex for caches/links. Bankruptcy possible. **Done when:** a bad strategy can go broke; a good one grows cash.
- **[M1-09] Single finance panel (mono chrome, coloured data)** — *S · P0-08, M1-08 · NEEDS-PORT* · One dashboard: balance, runway, per-action margin. **Done when:** the panel reflects live state and obeys the chrome/signal split.
- **[M1-10] Glanceable map readout** — *S · M0-11, M0-12 · NEEDS-PORT* · The orrery shows the web + packets + a freshness/coverage cue for the demand. **Done when:** network health is readable at a glance without opening a menu (the Mini Metro test).
- **[M1-11] Cache-hit audio cue** — *S · M1-05 · NEEDS-PORT* · A placeholder beep/tone on cache hit; degraded tone as the network stales (GDD §5 audio-as-information). **Done when:** you can hear whether the network is healthy with your eyes closed.
- **[M1-12] 30-minute scenario script** — *S · all M1 · NEEDS-PORT* · A hand-tuned single scenario (one source, one customer, a relay or two, a looming conjunction blackout) designed to force interesting caching decisions. **Done when:** a fresh player has 30 minutes of meaningful choices without instruction.

### M1 playtest protocol (the gate)

Run ≥5 testers (or yourself + 4 others) through M1-12 cold. **PASS if** most testers, unprompted, (a) place and re-tune caches/prefetch in response to the light-delay, (b) feel tension around the conjunction blackout, and (c) can articulate *why it was interesting* afterward. **FAIL if** they treat it as a wait-and-click economy, ignore the light-delay, or describe it as "a spreadsheet." 

- **On PASS:** proceed to M2.
- **On FAIL:** do **not** build M2. Iterate the *visualisation and core loop* only (per GDD Risk 2) — make packets/freshness more visceral, make caching decisions sharper — and re-run the gate. If three iterations can't move it, the premise needs rethinking. This is cheaper to learn now than after M4.

---

## Milestone 2 — Earth tycoon vertical slice

*Goal: is the core loop fun across a full session at Tier 1? Adds the economy, the escalation engine, and the first emergent stories. Only start after M1 passes.*

**Epic: Coverage & demand at scale**
- **[M2-01] H3-like geodesic hex grid over Earth** — *L* · Surface cells with demand weight (population/economic). **Done when:** the grid renders as a coverage heatmap and stores per-cell demand.
- **[M2-02] Coverage field from assets** — *M · M2-01* · Per-cell coverage derived from line-of-sight + link budget of current assets. **Done when:** adding a satellite visibly fills coverage gaps on the heatmap.
- **[M2-03] Simplified link-budget model** — *M* · Capacity = f(gain, Tx power, distance², band, weather, pointing). **Done when:** moving an asset farther/through weather reduces capacity sensibly.

**Epic: Assets, launch, economy**
- **[M2-04] Placeable ground stations & satellites** — *M* · Build/place/decommission assets with capex/opex. **Done when:** assets can be placed, cost money, and affect coverage.
- **[M2-05] Launch market (buy launches)** — *M* · €/kg to a target orbit, with a window and a failure probability; insurance as a € option. **Done when:** a launch can be purchased, can fail, and deploys payload to orbit on success.
- **[M2-06] Contracts & markets state machine** — *L* · Demand expressed as contracts (region/observation/transport) with tariffs and penalties. **Done when:** contracts spawn, are served or breached, and settle in €.
- **[M2-07] Orbital decay (Tier-2 perturbation, optional)** — *M · M0-02* · J2/drag as a maintenance/station-keeping pressure; assets decay if unpaid. **Done when:** an unmaintained LEO sat reenters; station-keeping opex prevents it. *(Toggleable; don't let it become a chore — GDD §10.)*

**Epic: The escalation engine + emergent stories (GDD §3)**
- **[M2-08] Demand growth / network effects** — *M · M2-06* · Serving a region grows its demand; success congests links and forces re-engineering (the OpenTTD loop). **Done when:** a profitable route reliably becomes a congestion problem you must solve.
- **[M2-09] Emergent-event generator v1** — *M* · Named, identity-coloured rival operators; news/demand-shock events (storm, flagship mission, spectrum auction). **Done when:** unscripted events change the market mid-session and rivals act independently.
- **[M2-10] Coverage heatmap view (coloured by dimension)** — *M · M2-01, P0-08* · The one excellent dashboard for M2: switchable connectivity/bandwidth/latency/observation/freshness ramps. **Done when:** gaps in any dimension are obvious at a glance, colour-blind-safe.

**M2 exit criteria:** a full ~60–90 min session is engaging at Tier 1; the escalation engine generates its own problems; at least one emergent "story" lands. Determinism test still green with the economy in.

---

## Milestone 3 — Cislunar + first light-delay (the gentle on-ramp)

*Goal: introduce delay at ~1.3s, where it teaches before it bites (GDD §10 onboarding).*

**Epic: Cislunar reach**
- **[M3-01] Moon + Lagrange points** — *M* · New bodies/regions; relay placement at L-points. **Done when:** cislunar assets propagate and route.
- **[M3-02] First orbital datacenter (edge node)** — *L* · A placeable DC with power/cooling/compute budgets (GDD §4.5) that hosts a cache and runs simple edge processing. **Done when:** a DC turns raw data into a smaller product and visibly cuts bandwidth/latency-to-value.
- **[M3-03] Basic autonomy policies** — *M* · Standing orders for out-of-contact nodes (reprioritise/reroute/throttle/safe-mode), framed as flight software, never "AI" (GDD §4.6). **Done when:** a node executes its policy during a contact gap and the player can edit the orders.
- **[M3-04] Observation contract line** — *M · M2-06* · Sensing/imaging as a distinct product from comms. **Done when:** observation contracts are servable and priced separately.
- **[M3-05] Light-delay teaching beat** — *S · M0-10, M0-11* · Use the ~1.3s cislunar delay + packet visuals as the in-game teacher before Mars. **Done when:** a new player understands "data is old" by watching, not by tooltip.
- **[M3-06] DC power/cooling/thermal model** — *M · M3-02* · Radiative-only cooling and distance² solar falloff as real caps on compute (GDD §4.5). **Done when:** an under-cooled or under-powered DC throttles.

---

## Milestone 4 — Interplanetary + signature systems (the game becomes itself)

*Goal: the full signature loop at minutes-scale delay. Highest-value content; also where "waiting is gameplay" and "brokering doesn't eat the carrier fantasy" get validated.*

**Epic: Mars & transfer planning**
- **[M4-01] Mars + synodic launch windows** — *M* · Real ~26-month window cadence affecting €/kg and feasible mass. **Done when:** off-window transfers are punitively expensive/impossible; on-window are cheap.
- **[M4-02] Patched-conic launch planner** — *L · M0-02* · Planner computes transfer Δv/window so the player chooses, never calculates (GDD §2/§4.1, KSP lesson). **Done when:** the player picks a window/vehicle/payload and the planner does the math.
- **[M4-03] Conjunction blackouts** — *S · M0-09* · Sun-occultation starves Mars-side ops for days. **Done when:** a blackout is forecast, arrives, starves the link, and clears.

**Epic: The full caching/compute/brokering loop**
- **[M4-04] Full caching/prefetch/coherence at minutes-scale** — *L · M1-04..07, M3-02* · The M1 loop, matured across the real light-gap with full consistency levels. **Done when:** coherence/freshness trade-offs are a live, consequential decision at Mars distance.
- **[M4-05] Edge-processing datacenters (raw→product)** — *M · M3-02, M3-06* · Process at the edge to ship conclusions not bytes; the core economic justification. **Done when:** "ship raw vs process at edge" is a real per-dataset decision with clear payoffs.
- **[M4-06] Autonomy tiers tied to DC compute** — *M · M3-03, M4-05* · Better edge compute → better autonomous decisions; the trust/risk dial. **Done when:** upgrading a DC measurably improves blackout-time performance, with occasional costly autonomous mistakes.
- **[M4-07] Constrained brokering + latency arbitrage** — *L · M2-06* · Brokering **gated behind owned/peered infrastructure, margin-capped, with decaying margins** (GDD §4.4) so it complements rather than replaces carrying. **Done when:** a pure-carrier strategy is viable AND a broker still must build; playtests show players don't abandon construction.
- **[M4-08] "Waiting is gameplay" validation pass** — *M · M4-01, M4-04* · Ensure transfer-window/round-trip waits are filled with caching/prefetch decisions, not a fast-forward stare (GDD §3/§10). **Done when:** playtesters make meaningful choices *during* waits, not just before/after.

**M4 exit / 1.0-candidate criteria:** carrier, broker, and observation archetypes are all viable (GDD §10 single-strategy risk); the signature light-delay loop is the best part of the game; brokering hasn't cannibalised building.

---

## Post-1.0 (sketch only — do not detail-design yet)

- **M5 — Outer system + DTN:** Belt/Jupiter/Saturn, store-and-forward bundle routing, predictive replication, nuclear/rad-hard DCs, high-autonomy edge intelligence, heavy ISL backbone, perf work for a much larger time-varying graph.
- **M6 — Optional information-economy endgame (GDD §4.10):** the gradual, foreshadowed, €-preserving, **opt-in** currency flip; information-as-medium-of-exchange; information-dominance as an *optional* win with a legible dramatic final state (not a silent score threshold). **Prototype no earlier than after M4 proves the mid-game fun.**
- **Deferred indefinitely / affordance-only:** multiplayer (separate project; the headless authoritative sim keeps the door open — GDD §7) and the mobile companion (no version target — GDD §6). The optional local LLM is **cut**; all in-world text stays hand-authored/templated (GDD §4.6).

---

## Cross-cutting epics (run continuously from P0)

- **[X-01] Determinism & replay** — keep the golden-master test (P0-06) green at every milestone; add a recorded replay per milestone as a regression fixture. *TS note:* the fixed-tick clock (P0-03) is the new foundation for this; the spike's f64 accumulator was not deterministic across replays.
- **[X-02] Performance budget** — routing graph re-solves **only on topology-change events**, not per tick; **precompute geometric link windows** (they're predictable from orbits). Establish a frame/tick budget and a headless perf benchmark before M4's graph gets big. *TS note:* the primary perf concern is GC allocation pools in Three.js — the adversarial review caught ~960 `Vector3`/frame in the orrery hot loop; the fix (scratch vectors + direct `Float32Array` writes) is the pattern to enforce. Pool ephemeris `Vec3` array returns as well.
- **[X-03] Accessibility** — colour-blind-safe palettes, the fully-playable monochrome-purist mode, scalable-UI/larger-bitmap mode (GDD §8). Test the colour-off path every milestone so it never rots.
- **[X-04] Save/load robustness** — versioned saves, migration story, fast snapshot load. Grows with each milestone's new action types. *TS note:* save format is JSON serialisable from the pure `src/sim/` layer; no DOM/Three.js state in saves.
- **[X-05] Audio system** — UI beeps/clacks, telemetry chirps, the *commit* tone, and audio-as-information for network health (GDD §5/§8). *TS note:* Web Audio API.
- **[X-06] Content pipeline** — `data/` JSON resources for bodies, tech, contracts, balance tables, and hand-authored flavour-text templates, designer-editable without code (GDD §6).

---

## First two weeks — concrete next actions

1. **Pin the resolved P0 spikes** (P0-S1/S2/S3): Node + Three.js versions (already pinned), sim-core language (TS, resolved), test framework (Vitest + Playwright, working). Write the one-paragraph decisions if not already in `docs/decisions.md`.
2. **Stand up the deterministic backbone** (P0-03, P0-04, P0-06). Port the fixed-step tick from the Godot project; implement the seeded RNG; write the golden-master replay test before any new sim code. This is the highest-leverage work remaining.
3. **Wire CI** (P0-02): `npm test` + `npm run build` in CI.
4. **Then chase the M0 gap:** packet + freshness (M0-09 → M0-12) are already DONE-SPIKE; the gap is the deterministic backbone (P0-03..P0-06) and the save format (P0-05).

Everything after that is in service of reaching the **M1 gate** as fast as honestly possible.

---

## Open technical questions / spikes to schedule

- **SGP4 for Earth-orbit assets** — needed, or is Kepler good enough for the gameplay? (Decide during M0-03; default: Kepler now, SGP4 only if LEO realism demands it.)
- **Routing solver choice** — what algorithm for the time-varying graph at M4 scale, and what's the event model that triggers re-solves? (Spike before M4; affects X-02.)
- **Hex grid library vs roll-your-own** — existing JS/TS hex/grid libraries or a simpler geodesic grid? (Spike at M2-01.)
- **When (if ever) to port the sim hot path** off plain TypeScript to a native (Rust/WASM) kernel — gate this on a real profiler result during M4, not a hunch.
- **Time-compression ratio** — how aggressively to compress so months-apart windows fit minutes-long sessions without killing the "waiting" tension (GDD §10). Prototype empirically at M4-08.

---

*v0.1. This plan is intentionally detailed through M1 and deliberately vague past M4, mirroring GDD §9–§10: the near-term work is real and sequenced; the far-term work is a direction, not a commitment. Revisit after the M1 gate — a PASS unlocks M2 planning in detail; a FAIL means this document's later half was hypothetical anyway.*
