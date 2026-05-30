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

### SD-20 — E6a: continuous per-sim-time economy (per-tick → rates)
**Status: ACCEPTED (user: "continuous rates, tune later").** The per-tick economy (€1/tick opex) bankrupted the live loop in ~17 sim-s — opex was coupled to the 1/60 s tick (~60 €/sim-s) while the first delivery is ~923 s away — and per-tick payout would have ballooned once deliveries landed. Reworked to **continuous per-sim-time rates**: `balance += (revenueRate(band) − opexRate(coherence)) × dtSeconds`, so the wallet is invariant to DT / time-compression (adversarially verified bit-identical at 1×/10×/100× and coarse frames). Rates (€/sim-second, EVENTUAL baseline × coherence.costMultiplier): opex 2.0, fresh +5.0 (net +3), stale +2.5 (net +0.5), miss 0 (net −2), blackout −4 penalty (net −6); opening €3000 (~25-min opex runway, survives the ~923 s wait to first delivery); prefetch €50 one-shot. Survivable-if-played-well (well-played 30-min ≈ €8k) vs bankrupt-if-starved (≈ −€7.8k); the pre-blackout prefetch flips solvent↔bankrupt. **Numbers are placeholders — tune later.** Replay golden re-pinned; finance panel reads €/hr rates + live-burn runway.

### SD-23 — E9: the truthful event log (the parse seed / GDD §4.12 legible record)
**Status: ACCEPTED (autonomous gameplay decision per "make gameplay decisions yourself").** GDD §4.12 makes the *legible record* the floor/ceiling hinge — the thing that turns taming-to-functional into optimising-to-optimal — and demands it be COMPLETE + HONEST, "cheap because the sim IS the truth layer." E9 builds the M1-era seed: log truthfully from day one so E10's post-run parse (and the §9 "did the player finish wanting to do it better?" gate) has real data. New pure module `src/sim/m1/eventlog.ts`: `M1Event` is a discriminated union of 8 kinds — `serve` (band transition from→to), `fetch_launch` (cause), `fetch_arrive` (true landedFreshness), `cache_store`, `cache_evict` (victim + freshness + forBy + reason), `prefetch` (cause manual|auto|prestage + eta + costEur), `policy` (mode + floor + from), `blackout` (enter|exit) — each carrying a SIM timestamp (integer tick + tSim, never wall-clock) + a monotonic `seq`. The `EventLog` buffer is append-only (`push`/`readAll`/`readSince(seq)`); it lives unbounded on `M1Session` as the recording log, the panel reads a bounded tail. **All EDGE-TRIGGERED** (per-feed `prevBand`/`prevFeasible` + `prevPolicyMode` gate emission to genuine transitions — never per-tick level; a 200k-tick run emitted only 52 events).

**Honesty:** SYSTEM.LOG now renders ONLY `session.events` — `main.ts` discards `mission.*()`'s scripted LogEntry returns (mission.ts is kept only as the orrery packet director, fully de-wired from the log), so the SD-8 scripted severity feed never reaches the screen. The known cosmetic lie ("PKT 0.50 arrived") is fixed at root: the `fetch_arrive` event carries the real `delayFreshness(t−launchT)` (≈0.70–0.89, decaying), pinned by `log-format.test.ts`. New pure `Cache.evictionVictim()` lets the session LOG an eviction truthfully *before* the store mutates the cache (mirrors `evictStalest`'s lowest-freshness + insertion-order tie-break).

**Determinism (the key honesty guarantee):** events are emitted purely from deterministic state transitions in a fixed order → the event stream is a pure function of (eph, action log, dt) and replays BIT-IDENTICALLY (new `eventlog-replay.test.ts` records then replays and diffs the full ordered sequence + payloads). The stream is a **derived side-output kept OUT of `SessionSnapshot`/the state hash**, so the replay **golden is unchanged** (`8072561960299808504n`) — events proven reproducible separately rather than re-pinned. *(Consequence flagged for E10: a future at-rest fast-load would resume with an empty live log + reset edge-trackers, so the first post-load step could emit a spurious `from=null` serve transition. Not reachable today — no at-rest load is wired.)*

**Render:** new pure DOM-free `src/panels/log-format.ts` maps each event to a `LogRow` (severity row-class + typed tokens) per GDD §8 — severity (info/warn/error/crit; blackout/blackout_miss = crit, prestage/evict/stale = warn), entities (feed/dataset IDs in the violet identifier colour), time+freshness (a `warmthOf()` bucket good/watch/warn/dead so a stale value desaturates toward machine-grey — the §8 freshness ramp), € values. `log.ts` drains only the new tail via `readSince` and appends incrementally (no per-frame whole-list rebuild, zero alloc on a quiet frame, 400-row DOM cap). 237→261 tests; tsc clean; build clean; src/sim stays pure; screenshot-verified the truthful syntax-highlighted log. Minor follow-ups (→ later): a dead `.ts.stale` CSS hook never emitted; the de-wired scripted `mission.ts` left in-tree (churn-avoidance).

### SD-25 — E10b: the strain-tuned 30-min scenario (the full arc placed at a real conjunction)
**Status: ACCEPTED (autonomous gameplay decision per "make gameplay decisions yourself").** GDD §9's sharpened M1 gate needs a 30-min run that contains a full strain→relief arc AND ends with the player wanting to do it better — and its scenario note demands "enough simultaneous feeds that you feel it getting away from you." E7–E10a built the mechanisms (5-feed strain, prefetch-policy relief, truthful log, live conjunction blackout); E10b PLACES them on a timeline that fits one sitting. **The core tension resolved (GDD Risk-6):** light-delay (one-way ~900–1300+ s) wants a slow scale to be felt, but the conjunction (182 days from J2000 t=0) wants a fast scale to be reached — ~5 orders apart. Resolution: start the scenario near a real conjunction so the macro-timeline is short, and let the player bridge scales with the existing 1×–1000× controls, the waiting filled with prefetch decisions (not a slider you merely watch). New `src/sim/m1/scenario.ts` is the one-place dial: `SCENARIO.t0Seconds = 14_500_000` (tick0 = round(t0/DT) = 870,000,000), with `missionElapsedSeconds(simSeconds) = max(0, simSeconds − t0)`. The sim clock IS ephemeris time — `main.ts` boots `clock.setTick(SCENARIO.tick0)` so every position/LOS read uses the true J2000 epoch with zero translation; the ONLY presentation adaptation is the telemetry CLOCK row showing **MET** (mission-elapsed) so it reads 0 at boot, not ~168 days.

**The placement (computed against the real ephemeris):** t0 is ≈10.87 days before the corridor opens; conjunction at t≈15,731,438 s. Starting Sun-miss margin ≈15.93 Rsun (SAFE/green, well above the 9-Rsun watch edge), so the foreshadow is a CHANGE the player watches tighten. Earth↔Mars ≈2.589 AU at t0 → one-way light ≈1292 s (≈21.5 min, near the worst — Mars across the Sun — the dramatic light-delay teaching moment that coincides with the looming blackout). Real-time-to-blackout: 100× (default boot) ≈156 real-min, but the early first-fetch wait is ≈13 real-s so the strain is FELT; 1000× ≈15.7 real-min to ENTER, ≈25.4 to EXIT, with ≈9.7 real-min of dwell inside the 6.74-day corridor. The arc: green @100× (mash P, feel 5 feeds slip) → discover AUTO+BLK (a/[/]) → control → crank to 1000× → green→watch→warn→BLACKOUT → ride it out.

**Lead retune (fixes the SD-24/E10a minor):** `defaultPolicy().blackoutLeadS` 1200 → 1800 s. Max one-way light over the approach is ≈1305 s, so the old 1200 s lead launched a pre-stage that landed ≈100 s AFTER the gap opened. 1800 s exceeds the worst one-way by ≈495 s, so the earliest default-mode pre-stage lands ≈500 s BEFORE the gap — it genuinely beats the light-gap now (proven in `scenario.test.ts`: new lead beats the gap, old 1200 does not; a default-tuned freshness_blackout pre-stages ahead and a pre-staged feed serves through while an unprepared feed takes blackout_miss).

**Determinism:** epoch + lead change moved the replay golden `8072561960299808504n` → **`544847093270497462n`** (the fold change is exactly snap.policy.blackoutLeadS 1200→1800; the session boots `defaultPolicy()`). All 7 sibling determinism tests pass unchanged (same-log-twice, scale/frame-slicing independence, LIVE==REPLAY, competing-prefetch, mid-run toggle, JSON round-trip) and the E9 event-stream replay still holds. 277→292 tests; tsc clean; build clean; src/sim pure (scenario.ts imports only DT). Screenshot-verified: the CONJUNCTION readout foreshadow tightening (6.9 Rsun, half-gauge, 21m39s fetch ETAs) + the BLACKOUT band. **Open (→ E10c):** the default boot scale is 100×, so a passive player who never ramps to 1000× never reaches the blackout in a sitting — add a scenario default-scale dial or an onboarding nudge. (Also latent: the live action log records at the large absolute tick0; harmless today — no test replays a live-saved session.) **Epoch/lead/corridor values remain placeholders — tune later.**

### SD-24 — E10a: the solar-interference CORRIDOR makes the conjunction blackout live (retires the SD-22 gap)
**Status: ACCEPTED (autonomous gameplay decision per "make gameplay decisions yourself").** SD-22 self-flagged the single most important missing beat of M1: the GDD §4.4/§3a *marquee* transferable insight — "pre-stage the cache before the predictable conjunction blackout and you beat the light-gap" — was DORMANT in real play. The Earth↔Mars line of sight in this ephemeris never crosses the 1-Rsun solar disk (tightest Sun-miss **3.322 Rsun** over a full synodic period), so the disk-occlusion blackout never fired live and `freshness_blackout` was proven only against a fake ephemeris. E10a makes it live.

**The honest fix (geometry):** a real Mars solar conjunction is NOT a literal disk occultation — it is a comms blackout from solar RF interference at small Sun-Earth-probe angle (NASA stops commanding Mars craft at SEP ≲ 2°, degraded from ~2–5°). So the blackout is modelled as a **solar-interference CORRIDOR**: the Earth↔Mars link is dead when its LoS passes within `SOLAR_CORRIDOR_RSUN` solar radii of the Sun **centre** (not just inside the 1-Rsun disk). This **generalises** the existing occlusion check (N=1 ≡ the physical disk) — no duplication. New tunable `SOLAR_CORRIDOR_RSUN` (default **5**, one-place dial in `src/sim/links.ts`): with the tightest real approach at 3.322 Rsun, N=5 opens a genuine blackout window. `segmentSphere` gains a separate `blockRadius` (geometry distance stays the true miss; the corridor is the blocking radius); `lineOfSight` threads a `corridorRsun` defaulting to the constant; `earthMarsLos` returns `{corridorRsun, inCorridor}` alongside the existing `{marginSolarRadii, occulted}`. The "Sun strictly between the endpoints" guard (0<t<1) is preserved, so a near-side Sun never blacks out. The corridor is the minimum Sun-centre→**segment** distance (projection clamped to [0,1]).

**The live conjunction:** scanning the real eph, the conjunction is at **t ≈ 15,731,438 s** (≈182 days), min miss **3.3219666904 Rsun**; the default corridor opens a blackout window from t ≈ 15,439,238 to 16,021,888 — **≈582,650 s ≈ 6.74 days wide**. The whole pre-wired pathway lights up unchanged: `feasible()` → false in-corridor → resolver `blackout_miss` → economy SLA penalty rate (−€4/s) → BLACKOUT readout → blackout enter/exit events. New `src/sim/m1/conjunction-blackout.test.ts` proves it against the REAL eph: scans for the conjunction, asserts in-corridor infeasibility + `blackout_miss` (payout −500) + bracketing enter/exit events; and the **marquee payoff** — `freshness_blackout` pre-stages live (`feasible(now) && !feasible(t+lead)`, prefetch cause `prestage`) and a pre-staged feed (science, long half-life) **serves through** the blackout from cache while an un-staged feed takes the SLA hit. N=1 corridor is asserted to reduce EXACTLY to the disk occultation.

**Determinism:** the replay golden is **UNCHANGED `8072561960299808504n`** — and that is correct, not a skip: the action-driven replay window runs to t=2000 s where the min Sun-miss is ~156 Rsun (link wide open), so disk-vs-corridor feasibility is identical there and no resolve outcome moved (verified by sweep). 1×==N× fixed-dt replay still holds; a corridor-purity determinism test asserts stepping the same in-corridor instants twice is bit-identical (state + events) and `feasible()`/`earthMarsLos()` are pure of (eph, t).

**Render (the cue leads the event — §4.3a "blackouts are geometrically predictable"):** the CONJUNCTION readout bands are re-keyed off the live corridor threshold (`losCorridorRsun` added to `FrameState`; watch opens at `CONJUNCTION_WATCH_FACTOR×corridor`, full/alarm at/inside it). The gauge fills (cyan watch → amber warn) as the margin tightens and the label reads the live `N.N Rsun`; once the LoS enters the corridor the label reads **BLACKOUT** (red, full bar) — the same verdict the resolver reaches. The orrery titlebar lamp + readout blackout badge now key off `inCorridor` (the corridor), not the never-firing disk. `main.ts` stays thin (f64→f32 only in src/orrery); a DEV-only `window.seekSim(tSeconds)` hook (stripped from prod via `import.meta.env.DEV`) lets the screenshot harness jump to the conjunction (unreachable by wall-clock even at 1000×). Screenshot-verified: OVERVIEW + SYSTEM camera at t=15,731,438 shows the BLACKOUT readout + conjunction geometry; ~95 min before the window with AUTO+BLK shows the pre-stage relief firing. 261→277 tests; tsc clean; build clean; src/sim stays pure. **Corridor N and feed/rate values remain placeholders — tune later.**

### SD-22 — E8: the standing prefetch POLICY (the tame-it lever / the relief)
**Status: ACCEPTED (autonomous gameplay decision per "make gameplay decisions yourself").** E7 made the strain real; E8 is the GDD §3a *taming-to-functional* relief and the first rung of the §4.11 leverage curve — the unit of command rises from "asset" (hand-mashing 'P' per feed) to "declared intent" (a standing policy the system executes). New pure module `src/sim/m1/policy.ts`: `PrefetchMode` = manual | freshness | freshness_blackout; `PrefetchPolicy {mode, freshnessFloor (default 0.70), blackoutLeadS (1200), maxConcurrentAuto (3)}`; pure `selectAutoPrefetches(policy, feedStates, cache, eph, t)` → ordered feedId list (eligibility = link feasible AND no leg in flight; budget = maxConcurrentAuto − legs-already-in-flight so it self-rate-limits; "freshness" tops up feeds below the floor most-urgent-first; "freshness_blackout" *also* pre-stages a feed where feasible(now)&&!feasible(t+lead), with priority over routine top-ups; "manual" = []). It fires inside `M1Session.step()` step 2 (after arrivals land, before resolve), launching legs + charging €50 each. **Default mode is "manual" — default behaviour unchanged.**

**Determinism contract (the load-bearing decision):** AUTO-prefetches are a *pure function of (policy, state, geometry)* computed inside `step()`, so replay re-derives them with **no extra logging**. Only a *change* of policy is player intent → new `set_prefetch_policy` SimAction (`src/sim/action.ts`), applied via the SHARED `applySessionAction` so live ('A'/'['/']' keys at `clock.tick`) and replay set the policy at the SAME tick. Snapshot/restore round-trips the policy. Golden re-pinned `8387670477081443185n` → **`8072561960299808504n`** (folds the policy + the economy tune below); a new determinism test toggles the policy mid-run and asserts replay-bit-identical + LIVE==REPLAY. *(One honesty note in `session.ts`: the per-step accrual is DT-invariant, but the autopilot evaluates once per tick, so an autopilot-ON run is not bit-DT-invariant across different dt — the contract is fixed-dt replay, which IS bit-identical; comment corrected to say so.)*

**Economy tune (placeholder, flagged):** with the original numbers NO floor beat manual — a light-gap-crossing copy lands at freshness ~0.70–0.89, below Demand's 0.9 fresh cap, so a top-up never reached the paying FRESH band and only burned €50. Fix: added `freshFreshness` to FeedConfig and set it 0.75 (a just-arrived copy IS fresh), so a top-up converts STALE (+€2.5/s) → FRESH (+€5/s). Now there is a real interior optimum: floor sweep over 200k ticks — manual €9394; floors 0.05–0.60 *below* manual (wasted fetches); **0.70 peak €10355 (+€961, beats both extremes)**; 0.75–0.95 declining (over-prefetch/eviction churn). The 57% structural miss (3 slots < 5 feeds) is the E7 strain and is intentionally NOT tamed away — E8 relieves the *served* portion (fresh-time 11.8%→15.6%). **Numbers are placeholders — tune later.**

**Render (the §5 relief made visible):** PREFETCH readout row (MANUAL dim vs AUTO@70% / AUTO+BLK, cyan armed → green the step it fires), status-strip PREFETCH cell, a subtle "prestage" audio cue, and the existing per-feed roster + finance NET visibly stabilising. Screenshot-verified: manual ↔ AUTO+BLK@70%, autopilot launches top-ups on screen, balance climbs.

**Known gap → RESOLVED in SD-24 (E10a):** the solar-interference corridor made the conjunction blackout live against the real ephemeris; `freshness_blackout` now pre-stages and serves through a real conjunction. The original gap text is retained below for the record. ~~`freshness_blackout` — the GDD §4.4/§3a *marquee* transferable insight ("pre-stage before the predictable conjunction blackout and you beat the light-gap") — is **dormant in real play**: the Earth-Mars LoS in this ephemeris never crosses the 1-Rsun solar disk (tightest 3.322 Rsun over a full synodic period), so the pre-stage never fires live; its logic + economics are proven against a fake-eph unit test only. **E10 must make a conjunction blackout live-exercisable** — most likely by modelling the blackout as a *solar-interference corridor* (LoS within ~N Rsun of the Sun, N≈3–5, which is the physically-honest comms-blackout criterion — real Mars conjunction is small-angular-separation RF noise, not literal disk occultation) rather than a hard 1-Rsun occultation, OR by choosing a scenario epoch where the disk is actually crossed. Without it, M1's single most important "real insight" beat is missing.~~

### SD-21 — E7: single feed → several feeds + multi-slot cache (the strain becomes real)
**Status: ACCEPTED (autonomous gameplay decision per "make gameplay decisions yourself").** The single Mars feed was the *floor*; GDD §9 demands "enough simultaneous feeds that you feel it getting away from you, so the tame-it lever has something to tame." So M1 now runs **5 distinct feeds** (data-driven in the new `src/sim/m1/feeds.ts` — `FEED_CONFIGS`, designer-editable): mars_imagery/weather/telemetry/science/comms, each its own half-life (1800–5400 s), base price (€500–1200), and min-acceptable (0.4–0.6), decaying on independent clocks. The cache is **3 slots** (`CACHE_SLOTS=3 < 5 feeds` — the strain is structural: you provably cannot hold all five fresh). `Cache` generalised to a `datasetId`-keyed multi-slot store (capacity ctor arg, default 1 keeps the single-slot resolver/economy/m1-model tests faithful); on a full store it **evicts the lowest *current* freshness** (judged at real store-time `t`, so a just-arrived ~0.84 copy compares fairly), ties break first-inserted — deterministic. `M1Session` rewritten to drive `Demand[]` + the shared cache + a per-feed `FetchState` (one in-flight leg each); arrivals land before resolve, revenue **sums** over serving bands, **opex scales with occupied slots** (`OPEX_RATE × max(1, occupied) × coherence` — full 3-slot = €6/s at EVENTUAL, idle still burns a one-slot floor so there is no free idle). Manual prefetch ('P') now targets the **most-urgent eligible feed** (link up, no leg in flight, lowest current freshness; empty slot reads 0 → most urgent). Render adapts: orrery draws one cyan crawler per in-flight feed (small lateral fan) + Mars-node saturation = peak cache freshness; a per-feed Mini-Metro roster (glyph ◆fresh ◇stale ▸fetch ○miss ▰blackout + freshness bar) + SLOTS N/3; finance sums revenue/opex/net and FRESHNESS PREMIUM across feeds + CACHE SLOTS N/3; telemetry a compact "N/5 hit · N fetch · N blk" digest. **Replay golden re-pinned to `8387670477081443185n`** (fold now covers every feed's fetch state + every cache slot). 222 tests green; determinism (1×==1000×, snapshot round-trip, LIVE==REPLAY) holds over the full roster; purity intact. Screenshot-verified: the 3/5-served strain reads at a glance on OVERVIEW + OPS. **Note (design-correct):** the realistic ceiling on the shipped 5-feed roster is below the idealised +€9/s — you can't hold all five, held copies decay — which IS the intended strain (E8's prefetch *policy* is the relief). **Feed/rate values are placeholders — tune later.**

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
