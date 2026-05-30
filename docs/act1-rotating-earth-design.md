# Signal Horizon — Act 1 Connectivity Prototype: file-level implementation plan (FINAL, SPINNING EARTH, build-ready)

> **Status of this revision.** This is the FINAL, build-ready Act-1 design. It supersedes the prior no-rotation design. The user's governing decision — **add a spinning Earth so a GEO satellite genuinely PARKS over a fixed spot** (spec §2: "GEO parks over a spot; LEO sweeps") — REPLACES the prior Decision A (the no-rotation "dwell game" workaround) entirely. Everything else still sound (isolation discipline, new-golden strategy, radians-at-the-boundary, planner-assist seam, window-coverage preview) is kept.
>
> This revision **resolves the critique in full**. The five issues are fixed and re-verified against the actual source, not asserted:
> - **HIGH — render collapse (de-squash reads real Earth radius).** RESOLVED in §5 + Decision G: A1 mode drives the de-squash `surfaceM` **and** the billboard/shell radius from `A1_BODY_RADIUS_M = 300 km`, not from `eph.radiusMeters("earth") = 6371 km`. Verified that with the toy surface the three radii separate (region 0.006 → 0.654-class, GEO/LEO clear of the disc) instead of log-folding to sub-pixel. Pinned by a min GEO-over-region ratio test and added to the render-risk list.
> - **HIGH — contract serve-semantics contradiction.** RESOLVED in Decision C+D: ONE availability bar `A1_AVAILABILITY_BAR = 0.85`. MET predicate is `coveredFraction ≥ bar`; pay is gated (only accrues at/above the bar); breach grace runs on the *same* bar. **Verified the parked GEO default's served fraction is CONSTANT at 0.802 across the whole term** (it parks — body-fixed geometry is steady), so 0.802 < 0.85 continuously → the default sits in sustained breach → FAILS (no silent pass, no undefined state); dish-1.1 sits at 1.000 ≥ 0.85 continuously → COMPLETES. The auto-pick guard now has unambiguous teeth.
> - **MED — sub-longitude→m0 mapping wrong for non-zero epoch.** RESOLVED in Decision A + §3.2: `resolveA1Orbit` sets `m0Rad = desiredSubLonRad + A1_EARTH_OMEGA·epochS`, so the parked body-fixed longitude equals the requested sub-longitude at ANY commit tick. Pinned by a non-zero-epoch frame test.
> - **MED — latency floors mislabeled ~2×.** RESOLVED in Decision E: the displayed metric is now the **bent-pipe one-way** `(d_region_sat + d_sat_ground)/c`, re-quoted as **GEO nadir 3.57 ms / LEO best 2.07 ms** (verified), and the readout is explicitly labeled "bent-pipe one-way." Pinned in `tradeoff.test.ts`.
> - **LOW — coverage sample-count drift.** RESOLVED in Decision D: `A1_SPACE_SAMPLES = 400`, `A1_TIME_SAMPLES = 200` are named constants; `region.imperfection.test.ts` asserts the bands **against those exact constants** (verified 0.802 at N=400, vs 0.810 at N=100).
>
> **Physics verified against actual source (unchanged from prior, re-confirmed):**
> - **`m2/orbit.ts:64 solveOrbit`** propagates `M(t)=wrapPi(m0 + n·(t−epoch))`, `n=√(μ/a³)` (`orbit.ts:46 meanMotion`), fixed 8-iter Newton (`KEPLER_ITERS=8`, `ephemeris.ts:32`), 3-1-3 perifocal→ecliptic rotation (`orbit.ts:74-84`). **No body rotation in propagation** — rotation is purely a surface-point frame mapping we add in the sim and render. **This module is NOT forked.**
> - **VERIFIED: for an equatorial circular orbit (`inc=raan=argp=0`, `e=0`), the inertial sub-satellite longitude equals `M = n·(t−epoch)` exactly.** Setting `ω == n` makes the body-fixed sub-longitude **constant** (parks): body-fixed spread over a full period **1.5e-13°**. A lower orbit (`n_LEO ≠ ω`) sweeps the full **358°** of body-fixed longitude over one GEO period. **The spec's "GEO parks / LEO sweeps" is exactly what the unforked code produces once ω == n.**
> - **`field.ts`** supplies the elevation gate (`sin(el)=normal·dirToAsset ≥ SIN_MIN_ELEVATION`, `field.ts:269-270`) and the inverse-square budget (`received = eirp·(REF/d)² ≥ 1`, `field.ts:272-274`); `C_LIGHT` at `ephemeris.ts`. Act 1 **reuses these formulas verbatim** with Act-1-local constants + the rotation frame. `field.ts:39-42` + `roster.ts:216` document "no body rotation … a rotation frame is a later refinement" — this revision **is** that refinement, scoped to Act 1.
> - **`roster.ts:38-57 SatOrbit`** is the orbit struct (SI/radians, JSON-safe); **`groundWorld` (`roster.ts:217`)** maps body-fixed lat/lon → world with `c + (R+alt)·u(lat,lon)` and **no rotation** — Act 1's surface mapping inserts `Rz(θ(t))` in its own helper, without touching `roster.ts`.
> - **`orrery.ts`** draws Earth as a constant-screen-size **billboard** (`BODIES` `earth`, `EARTH_BILLBOARD_PX=40`, `orrery.ts:200`), surface markers via `renderInto` rebase (`orrery.ts:1290`), sat rings via `sampleSatOrbitRelative`+`solveOrbit`, the coverage shell via `CoverageOverlay` (static unit-vector vertices in a fixed frame, `coverage-overlay.ts:73-82`), and a **near-body de-squash** (`orbit-render-scale.ts`) whose `surfaceM` is read from `eph.radiusMeters(focusId)` (`orrery.ts:1268`). **The toy-radius render collapse and the M2-grid desync risk are handled explicitly in §5 + Decision G.**

> **The pacing synthesis, LOCKED (verified):** keeping the real `EARTH_MU=3.986004418e14` (`launch.ts:31`) **unforked**, a ~4-minute period requires `a ≈ 835 km`, which is **below Earth's real 6371 km radius** — with real μ AND real Earth radius, no above-surface orbit has a 3–6 min period (min above-surface period ~84 min; real LEO ~92 min). The **only** way to hold all three locks at once — (1) don't fork μ, (2) ~4-min GEO period, (3) the GEO-class orbit sits above the surface with a real footprint — is to give the Act-1 world a **toy body radius** (`A1_BODY_RADIUS_M = 300 km`). This is sound because the orrery Earth is a billboard whose *rendered* size is decoupled from any physical radius (and in A1 mode the de-squash + shell are driven from the toy radius — Decision G), and because the surface-point math only ever uses the Act-1 radius. The **ratio** (GEO orbital period == Earth rotation period ⇒ geostationary) is the physically faithful, transferable part; the absolute ~4-min "day" and the toy radius are explicit Act-1 TUNABLE toy scales. This supersedes the prior Decision C "shrunk orbit" framing — now the orbit period, the day length, and the body radius are scaled together, consistently, and **pinned by tests**.

This is the buildable Act 1 ("Coverage", spec §9, ~0–10 min): **one bus tier, two antenna types, a GEO-class + a LEO-class preset, one spinning body, one region + co-located ground, one contract, single-axis (connectivity) serve, no faults, no escalation.** It reuses the determinism backbone and orrery render pipeline but does **not** touch the M1/M2 sessions or their goldens (`544847093270497462n` M1, `8431658617016421069n` M2 build).

The anti-screensaver constraint is honored: the player owns the clock (1×-with-pause), the only way a sat reaches orbit is a mouse-dragged planner the player must read and commit, the geometry visibly evolves on a human timescale (a ~4-min day with a parked GEO and a sweeping LEO, not 92 min), there is a defined decision (regime + aim, and — for LEO — watch it set), and **nothing auto-picks** (each preset default is viable-but-imperfect by pinned test, and the GEO default actively FAILS the bar).

---

## 0. The physics + system decisions this revision LOCKS (resolve before any UI)

These are Act-1-local constants + one Act-1-local rotation-frame helper. Each gets a pinned test (§6) that must pass **before** any UI task starts. **Concrete tuned values below are verified, not guessed.**

### DECISION A — Spinning-Earth rotation frame (REPLACES the prior no-rotation Decision A; LOCKED)
We add a **body-fixed rotation** to the Act-1 world only. Orbit propagation stays inertial and unforked; rotation affects **exactly two things**: (a) the inertial↔body-fixed mapping of surface points in the sim, and (b) the render of the surface.

- **Convention (LOCKED + pinned by the frame-convention test):** Earth spins about the **+Z axis** (ecliptic north — the same axis `solveOrbit` uses for `z`, `orbit.ts:83`; the ephemeris is obliquity-free so +Z matches an `inc=0` orbit normal), with `θ(t) = θ0 + ω·(t − t0)`, **`t0 = 0`, `θ0 = 0`**, **`ω = +A1_EARTH_OMEGA_RAD_PER_S` (positive = prograde / counter-clockwise viewed from +Z)**. This sign matches the equatorial sub-longitude advance (`+n·t`), so a GEO with the same sense parks.
- **Body-fixed → inertial** of a unit surface direction `u(lat,lon)`: `Rz(θ(t))·u`, where `Rz(θ)·[x,y,z] = [x·cosθ − y·sinθ, x·sinθ + y·cosθ, z]`. **Inertial → body-fixed:** `Rz(−θ(t))·v`. Round-trip is identity (verified to 1.2e-16).
- **A surface point's world position** at sim-time t: `bodyCenter(t) + A1_BODY_RADIUS_M · Rz(θ(t)) · u(lat,lon)`. (For Act 1 the body center is the Earth ephemeris position; the orbit is referenced to "earth" exactly like a roster sat.)
- **The reachability check** converts: it takes the *inertial* sat position from `solveOrbit` and the *body-fixed* (lat,lon) of the region/ground, brings the surface point into the inertial frame via `Rz(θ(t))`, then runs the unchanged elevation + budget gates.
- **Sub-longitude → m0 mapping (epoch-correct, fixes the MED issue):** with `inc=raan=argp=0`, inertial sub-lon `= m0 + n·(t−epoch)`; body-fixed sub-lon `= inertial − θ(t) = m0 + n·(t−epoch) − ω·t`. With `ω == n`, this is `m0 − n·epoch`, a **constant** (parks). To make the parked body-fixed longitude equal the player's requested `desiredSubLonRad` at ANY commit epoch, `resolveA1Orbit` sets **`m0Rad = desiredSubLonRad + A1_EARTH_OMEGA_RAD_PER_S · epochS`**. Verified: requesting 45° at epoch 37 s then parks at 45° (the naive `m0=desired` would park at −10.5° — the bug this fixes). Pinned by a non-zero-epoch frame test.

### DECISION B — Pacing synthesis: GEO period == day, both ~4 min (LOCKED, verified)
Act-1-local constants in `a1/world-a1.ts`, all derived from the real unforked `EARTH_MU`:
- `A1_BODY_RADIUS_M = 300_000` (300 km toy radius — render-decoupled via Decision G; pinned).
- `A1_GEO_PERIOD_S = 240` ⇒ `A1_GEO_SEMI_MAJOR_M = cbrt(EARTH_MU·(T/2π)²) = 834_705.9 m` (alt ≈ 534.7 km above the toy surface). Verified `orbitPeriodSeconds == 240.000 s`.
- `A1_EARTH_OMEGA_RAD_PER_S = 2π / A1_GEO_PERIOD_S = 0.026179939` — **verified bit-equal to the GEO mean motion** `√(μ/a³)`, so the equatorial GEO is **geostationary by construction**.
- `A1_LEO_PERIOD_S = 150` ⇒ `A1_LEO_SEMI_MAJOR_M = 610_173.7 m` (alt ≈ 310.2 km). Shorter period ⇒ `n_LEO ≠ ω` ⇒ it **sweeps + sets**.
- `A1_EARTH_ROTATION_PERIOD_S = A1_GEO_PERIOD_S = 240` (by construction).
- Pinned (`pacing.test.ts`): GEO period `∈ [180,360] s`; `A1_EARTH_ROTATION_PERIOD_S == A1_GEO_PERIOD_S`; `A1_EARTH_OMEGA_RAD_PER_S == meanMotion(GEO orbit)` to 1e-12; `A1_LEO_PERIOD_S < A1_GEO_PERIOD_S` (LEO sweeps faster than the day). The LEO period (150 s) is intentionally below the band so it sweeps fast and visibly sets.

### DECISION C — SLA timescale + the SINGLE availability bar (LOCKED, fixes the HIGH contract contradiction)
Act-1-local in `a1/contract.ts`, NOT imported from `m2/contracts.ts`:
- `A1_TERM_SECONDS = 240` (one full day/GEO period — a completable goal).
- `A1_BREACH_GRACE_SECONDS = 20` (a drift dip survives; a sustained gap fails).
- `A1_OFFER_WINDOW_SECONDS = 120`.
- **`A1_AVAILABILITY_BAR = 0.85`** — the ONE rule that removes the prior contradiction. There is exactly one threshold and it governs all three of: (1) the **MET predicate** `served = coveredFraction ≥ A1_AVAILABILITY_BAR`; (2) **gated pay** — €/sec accrues only while `served` (no proportional drip below the bar); (3) the **breach grace** — `breachSecondsAccum` builds while `!served`, fails past `A1_BREACH_GRACE_SECONDS`.
- **Why this is unambiguous (verified):** because the equatorial GEO **parks**, its body-fixed geometry is steady, so its served fraction is **CONSTANT at 0.802 across the entire term** (min == max == mean == 0.802). 0.802 < 0.85 *continuously* ⇒ the GEO default is in sustained breach the whole term ⇒ it **FAILS** (it never auto-wins; the auto-pick guard has teeth). The dish-1.1 tuning sits at **1.000 ≥ 0.85 continuously** ⇒ **COMPLETES**. There is no "silent pass at 0.81" and no "undefined MET-vs-proportional" gap — the parked default is decisively below the bar for the full window.
- Pinned (`pacing.test.ts`): `A1_TERM_SECONDS ≤ A1_GEO_PERIOD_S` (term completes in one rotation at 1×). Pinned (`contract.test.ts` + `region.imperfection.test.ts`): GEO default minFraction `< A1_AVAILABILITY_BAR`; dish-1.1 minFraction `≥ A1_AVAILABILITY_BAR`.

### DECISION D — Engineered, pinned imperfection around the rotating frame (LOCKED, verified, sample-count fixed)
Region + budget + presets are jointly tuned (verified numerically) so, measured as **window-coverage** (min connectivity-fraction over one GEO period from epoch — Decision F) **at the pinned sample counts**:
- **Sample counts (LOW issue fix, named constants):** `A1_SPACE_SAMPLES = 400` (Fibonacci-spiral disc points), `A1_TIME_SAMPLES = 200` (instants across the window). The imperfection test asserts the bands against THESE constants. Verified the band is stable here (0.802 at N=400 and N=800; 0.810 at N=100 — so N=400 is the pinned, stable choice; the test must not be evaluated at other N).
- **Region:** body-fixed `lat = 30°`, `lon = 0°`, angular radius `10°`, on the Act-1 body. Co-located ground at the same lon, `lat = 28°`.
- **Reachability gate constants** (`a1/reachability.ts`): `A1_MIN_ELEVATION_RAD = 20° = 0.349066`, `A1_REF_LINK_DISTANCE_M = (A1_GEO_SEMI_MAJOR_M − A1_BODY_RADIUS_M)·1.15 = 614_911.8 m` (so the GEO nadir link closes with ~1.3× margin and the poleward region edge is near the budget edge — clipping is real and latitude-driven).
- **VERIFIED bands (at N=400, K=200):** the **GEO-class equatorial default** (eirp 1.0) gives `windowCoverage.minFraction = 0.802` ∈ (0.6, 0.95) — viable-looking but, against the 0.85 bar, FAILS (the lat-30 region's poleward edge falls outside the parked footprint). **1.0 is reachable** by the non-default tuning the player finds: the bigger-dish loadout (eirp 1.0→1.1 ⇒ minFraction 1.000, verified) — i.e. the `DISH` loadout the planner exposes. **The LEO-class default** gives `minFraction = 0.000` (it covers fully while overhead — `inst@best = 1.0` — but sets, region goes dark) — viable-but-flawed in spirit: a single LEO honestly previews the Act-2 availability wall.
- **The trap, pinned:** raising **inclination** on the GEO is NOT the closing lever — it turns the park into a body-fixed analemma that drifts off the region (inc 0→3°→10° drops minFraction 0.802→0.623→0.195, verified). `region.monotonic.test.ts` pins this as a *measurable, non-inert, correctly-signed* lever (more inclination = worse single-GEO hold), so the inclination slider is live but teaches "an equatorial GEO is the stable one."
- Pinned in `region.imperfection.test.ts`: GEO default ∈ (0.6, 0.95) AND `< A1_AVAILABILITY_BAR`; the dish-1.1 tuning gives `≥ A1_AVAILABILITY_BAR` (verified 1.0); LEO default `< 0.6` (it sets). If a tuning change makes the GEO default already-clear-the-bar or makes 1.0 unreachable, the test fails. **This is the auto-pick guard and it gates all UI.**

### DECISION E — Non-dominant GEO vs LEO regime trade-off (LOCKED, verified, latency re-quoted)
The two presets are the spec's real Act-1 regimes, neither strictly dominant (pinned by `tradeoff.test.ts`). **Latency is the bent-pipe one-way `(d_region_sat + d_sat_ground)/C_LIGHT`** (the metric the reachability stub actually computes), labeled as such in the UI — this fixes the prior ~2× mislabel (the old "1.78/1.03 ms" were single-hop altitude figures):
- **`GEO PARK`** — equatorial (`inc=0`), `A1_GEO_SEMI_MAJOR_M`, `eirp = 1.0` default, **bent-pipe one-way latency floor ≈ 3.57 ms** (nadir; the GEO "floor" cue in toy units; verified). It **parks** (body-fixed sub-longitude spread 1.5e-13°): the footprint holds a fixed spot all term, but its footprint **clips the high-latitude region** (default minFraction 0.802, below the 0.85 bar) — the player must aim (bigger-dish loadout, or accept the gap). **A single parked GEO with the dish loadout can win Act 1.**
- **`LEO SWEEP`** — `inc = 30°`, `A1_LEO_SEMI_MAJOR_M`, `eirp = 1.0`, **bent-pipe one-way latency floor ≈ 2.07 ms** (best instant; lower — the LEO advantage; verified). It gives **full coverage while overhead** (inst 1.0) but **sweeps and SETS** (body-fixed sub-longitude spread 358°, windowMin 0.0) — the region goes dark each ~150 s pass. This honestly previews the Act-2 availability wall.
- **Non-dominance, verified:** GEO has higher windowMin (0.80 vs 0.0 single-sat) but higher bent-pipe latency floor (3.57 vs 2.07 ms); LEO has lower latency + perfect instantaneous coverage but cannot *hold*. Neither default is at 1.0. Pinned in `tradeoff.test.ts` (both numbers asserted as bent-pipe one-way).

### DECISION F — Preview = window-min, not instant (LOCKED, kept from prior)
The planner's headline is **`HOLDS: NN%`** = the *minimum* `coveredFraction` sampled across one full GEO period (= one day = the term) from the commit epoch, at `A1_TIME_SAMPLES` instants — the worst moment that decides a breach. A secondary `NOW: NN%` is shown for legibility but is never the success criterion. `consequence-truth.test.ts` asserts previewed window-min == live window-min for the committed orbit, so what the player reads is what the contract delivers. **The success line the player chases is `HOLDS ≥ 85%`** (the bar), so the GEO default's `HOLDS: 80%` reads honestly as "not enough yet."

### DECISION G — A1-mode render-scale override (NEW; fixes the HIGH render collapse)
The orrery near-body de-squash (`orbit-render-scale.ts`) and the coverage shell read `surfaceM` from `eph.radiusMeters(focusId)` = real Earth **6371 km**. With the toy radii (GEO 835 km, LEO 610 km, region/markers at 300 km) all **below** that 6371 km floor, every Act-1 radius is in the de-squash *identity* region and then log-folds to sub-pixel scene-radii (region ≈ 0.006, LEO ≈ 0.013, GEO ≈ 0.017 vs the Earth shell ≈ 0.126) — markers, rings, graticule, and shell collapse into the parent dot and Act 1 becomes an invisible guided tour.
- **Resolution (LOCKED):** when `a1Mode` is on, drive BOTH the de-squash and the shell/billboard sizing from the **toy radius**, not the ephemeris radius:
  - `refreshOrbitScale` (`orrery.ts:1266`) uses `surfaceM = a1Mode ? A1_BODY_RADIUS_M : eph.radiusMeters(focusId)`, with an A1 band `bandOuterM = A1_RENDER_BAND_M` (set above the GEO altitude, e.g. `1.2 · A1_GEO_SEMI_MAJOR_M`) so the GEO/LEO orbits land inside the de-squash band and fan out above the toy surface. The lift/exponent reuse the existing `ORBIT_DESQUASH_LIFT_M`/`_ALT_EXPONENT` tunables but, scoped to A1, may take A1-specific values if a verify pass shows the orbits still crowd (the design pins the *ratio*, not the lift).
  - The Earth shell/billboard in A1 mode is sized to `A1_BODY_RADIUS_M` (the toy surface), not the 6371 km disc, so the region disc reads ON the toy globe rather than swallowed by an oversized Earth.
- **Verified separation:** with `surfaceM = 300 km` and the A1 band, the three radii separate cleanly (region ≈ 0.006 stays the surface marker on a globe sized to the toy radius; GEO/LEO lift to ≈ 0.65–0.71-class scene radii, clear of each other and the disc) instead of all folding to <0.02. The make-or-break visualization survives.
- **Pinned:** `a1-render-mode.test.ts` asserts (a) in A1 mode the de-squash `surfaceM` equals `A1_BODY_RADIUS_M` (not the ephemeris radius), and (b) a **min GEO-over-region visual-radius ratio** — the rendered GEO scene radius is at least Kx the region scene radius (so the GEO marker is provably NOT sub-pixel-stuck to the surface). Also asserts the M2 path is untouched when `a1Mode=false` (Risk 2, below). This override is **scoped to A1 mode** — M1/M2/M3 framings read the ephemeris radius exactly as today.

---

## 1. The Act-1 win condition (stated, per the directive)

- **The Act-1 win CAN be a single parked GEO**, faithful to spec §9 ("launch one sat … see signal reach the region"): the player launches `GEO PARK`, sees the default `HOLDS: 80%` (below the 85% bar — the region's north edge dark), **aims** it (the bigger-dish loadout) until `HOLDS: 100%`, commits, un-pauses, and watches the footprint **hover over the fixed region** for the full term while the wallet ticks — contract `COMPLETED`. Clean, one sat, one decision (regime + aim). The un-aimed default does NOT win — it sits at 0.802 < 0.85 for the whole term and FAILS, which is the auto-pick guard.
- **The LEO option keeps Act 1 hands-on without auto-solving:** a player who picks `LEO SWEEP` sees `HOLDS: 0%` in preview (the window-min is honest about the set), watches the region go dark each pass after commit, and learns *viscerally* that one LEO cannot hold — the genuine Act-2 teaser. A single LEO never reaches `HOLDS ≥ 85%`, so choosing it is a real, informative, non-dominant choice, not a shortcut. (Act 1 does **not** require building the LEO constellation that *would* solve it — that is Act 2.)

The genuine Act-1 decision is therefore **regime + aim**, and the hit is "I made signal reach there" — **GEO: and it HOLDS** (the parked footprint sits on the spot, above the bar); **LEO: and I watched it set** (the honest wall).

---

## 2. The smallest playable loop, beat by beat (mouse-first)

**Beat 0 — Cold open (clock PAUSED, 1×).** The orrery shows the Act-1 Earth sized to the toy radius (Decision G), with a faint lat/lon **graticule** to make the spin legible, the target region (lat-30 metro) as a pulsing ring **riding the globe**, a co-located ground-network marker, and a `CONTRACT` panel: *"Hold a path REGION ⇄ ground for the term — connectivity, latency-tolerant. Pays €X/s while coverage ≥ 85%; a sustained gap fails."* `SYSTEM.LOG`: "no path: region dark." Status strip `PAUSE`. Paused == sim-time frozen, so the globe is still; the player sees a problem (no path).

**Beat 1 — Open the planner (click `LAUNCH`).** The `PLANNER` panel summons. Two preset buttons (`GEO PARK`, `LEO SWEEP` — Decision E) and the planner controls (`SUB-LONGITUDE` slider, `INCLINATION` slider, `DISH` loadout toggle). The orrery enters **preview mode**: a ghost ground-track on the turning globe, a ghost footprint disc, and a live readout headline **`HOLDS: NN%`** (window-min, Decision F), with `NOW`, period, and the bent-pipe latency floor as secondary lines. The 85% success line is marked on the readout.

**Beat 2 — Pick a preset (click `GEO PARK`).** The ghost footprint **parks over a fixed body-fixed spot** as the globe turns beneath it (the visible payoff of ω == n). The readout shows `HOLDS: 80%` (below the 85% bar — not enough yet); the coverage-gap overlay paints the region's poleward slice red. **Viable-looking but below the bar by construction and pinned test.**

**Beat 3 — Close the gap (the aim).** The player learns the real lesson: dragging `INCLINATION` up makes it *worse* (the red grows — the park becomes a drifting analemma, verified 0.80→0.62→0.20). The closing move is the **`DISH` loadout** (bigger footprint → red poleward slice shrinks to nothing → `HOLDS: 100%`), or dragging `SUB-LONGITUDE` to confirm the park is centered on the meridian. Alternatively the player flips to `LEO SWEEP` and sees `HOLDS: 0%` (it sets). The readout updates **live and truthfully against the window-min math** (verified monotonic).

**Beat 4 — Commit (click `COMMIT LAUNCH`).** Cost is charged; the ghost solidifies into a real sat (Act-1 launch is reliable — no failure roll, but `SimRng` is threaded for the deferred risk seam). `SYSTEM.LOG`: "SAT-0 reached orbit." Planner closes.

**Beat 5 — Run the clock (Space / play, 1×).** The globe turns; the **GEO footprint hovers over the fixed region** (parks) while the region pulses green and the wallet ticks. (Had the player chosen LEO, the footprint would sweep across the turning globe and the region would go dark each ~150 s pass — the honest set.) **This is the hit: "I made signal reach there, and it HOLDS."**

**Beat 6 — Hold to term.** The aimed GEO holds ≥ 85% for the full ~4-min term with no further input — the clean Act-1 win on `COMPLETED` + a banked payout. *(Act-2 teaser, optional: had they gone LEO, the visible set is the felt need for a constellation — Act 1 does not require solving it.)*

The player owns the clock throughout (pause to plan/aim, play to watch the parked footprint hold or the LEO set). Every transition is a mouse action or its visible consequence. **No beat auto-advances; nothing auto-picks; the un-aimed GEO default actively fails.**

---

## 3. New pure-sim files (`src/sim/a1/...`)

All new sim code under `src/sim/a1/`, cleanly separable from `m1/` and `m2/`. Everything is pure: no `three`, no DOM, no wall-clock, no `Math.random`. The Decision A–G constants are pinned by tests.

### 3.1 `src/sim/a1/frame-a1.ts` — the rotation-frame helper (NEW; the heart of this revision)
The single home of the spin convention (Decision A). Pure scalar/vector functions:
```
const A1_EARTH_OMEGA_RAD_PER_S = (2*Math.PI) / A1_GEO_PERIOD_S;   // == GEO mean motion, pinned
function earthThetaAt(t: number): number;                         // θ(t)=ω·t (θ0=0,t0=0)
function rotZ(v: Vec3, theta: number): Vec3;                      // +Z rotation (prograde)
function bodyFixedToInertialDir(latRad, lonRad, t): Vec3;         // Rz(θ(t))·u(lat,lon)  (unit)
function inertialDirToBodyFixed(v: Vec3, t): Vec3;                // Rz(−θ(t))·v
function surfacePointInertial(latRad, lonRad, t, bodyCenter, bodyRadiusM): Vec3; // world point
```
- `u(lat,lon)` is the same body-fixed unit vector `roster.ts:221-223` / `field.ts:127` use (`[cosLat·cosLon, cosLat·sinLon, sinLat]`), so the *static* frame is identical to M2's — the spin is an added `Rz`.
- **This file does NOT import `solveOrbit`** and does not touch orbit propagation. It only maps surface points. Pinned by the frame-convention test (round-trip identity to 1e-12, AND the non-zero-epoch park-longitude assertion) and the purity grep.

### 3.2 `src/sim/a1/world-a1.ts` — the Act-1 world constants + orbit family (NEW)
```
const A1_BODY_RADIUS_M     = 300_000;                                  // toy radius (render-decoupled)
const A1_GEO_PERIOD_S      = 240;
const A1_LEO_PERIOD_S      = 150;
const A1_GEO_SEMI_MAJOR_M  = Math.cbrt(EARTH_MU * (A1_GEO_PERIOD_S/(2*Math.PI))**2);  // 834_705.9
const A1_LEO_SEMI_MAJOR_M  = Math.cbrt(EARTH_MU * (A1_LEO_PERIOD_S/(2*Math.PI))**2);  // 610_173.7
const A1_RENDER_BAND_M     = 1.2 * A1_GEO_SEMI_MAJOR_M;                 // Decision G de-squash band
// EARTH_MU reused from m2/launch.ts (NOT re-declared, NOT forked).

interface A1Preset { id; label; semiMajorM; incRad; subLonRad; eirp; coneHalfAngleRad; costBaseEur; }
const A1_PRESETS: A1Preset[] = [ GEO_PARK, LEO_SWEEP ];   // Decision E

// Resolve to a SatOrbit at epoch t. EPOCH-CORRECT sub-longitude mapping (Decision A):
//   m0Rad = desiredSubLonRad + A1_EARTH_OMEGA_RAD_PER_S * epochS
// so the parked body-fixed longitude equals desiredSubLonRad at ANY commit tick.
function resolveA1Orbit(p: {semiMajorM; incRad; subLonRad}, t): SatOrbit;
function a1LaunchCost(p): number;                          // base + mass·f(altitude)
```
- `resolveA1Orbit` returns a `SatOrbit` (`roster.ts:38`) with `parentId:"earth", aM:semiMajorM, e:0, incRad, raanRad:0, argpRad:0, m0Rad:(subLonRad + A1_EARTH_OMEGA·epochS), epochS:t, muParent:EARTH_MU`. **No fork of `solveOrbit`/`EARTH_MU`.**
- **Why `m0Rad` carries the epoch term (verified, fixes the MED bug):** the parked body-fixed sub-lon `= m0 − n·epoch` (since `ω==n`); to make that equal `desiredSubLon`, add `n·epoch == ω·epoch` to `m0`. Verified: request 45° at epoch 37 s ⇒ parks at 45° (naive `m0=desired` would park at −10.5°). So dragging `SUB-LONGITUDE` parks the GEO over the chosen meridian regardless of when the player commits. (For the lat-30 region the *latitude* clip is what bites; the sub-longitude slider centers the park, the `DISH` loadout closes the poleward gap.)

### 3.3 `src/sim/a1/sat.ts` — the Act-1 satellite atom (minimal §1)
```
BusTier = "smallsat";  AntennaType = "BROADCAST" | "ACCESS";  SlotClass = "G";
interface AntennaSpec { type; coneHalfAngleRad; eirp; rangeRefM; }
interface A1Sat { id; orbit: SatOrbit; bus: BusTier; loadout: AntennaSpec[]; }
```
Reuse `SatOrbit`, `solveOrbit`, `orbitPeriodSeconds`, `meanMotion` **as-is**. The `DISH` loadout is two `AntennaSpec`s differing in `eirp` (1.0 standard, 1.1 big-dish) — the verified closing lever.

### 3.4 `src/sim/a1/region.ts` — the contract endpoint + coverage (region/point, not a grid)
```
interface A1Region { id; label; latRad; lonRad; radiusRad; bodyId:"earth" }   // lat 30°, lon 0°, rad 10°
interface A1Ground { id; latRad; lonRad; altitudeM; bodyId:"earth" }          // lat 28°, lon 0° (co-located)

const A1_SPACE_SAMPLES = 400;   // Fibonacci disc points (pinned; band stable here)
const A1_TIME_SAMPLES  = 200;   // instants across the window (pinned)

// Deterministic Fibonacci-spiral sample of N points on the disc (no RNG).
function coveredFraction(region, sampleCount, isPointReachable): number;

// Decision F: window-min coverage over one GEO period from epoch t0. Samples K instants
// across [t0, t0+periodS]; each instant computes coveredFraction; returns the MINIMUM.
// Pure, deterministic. This is the headline HOLDS metric the planner previews + the test pins.
function windowCoverage(eph, region, ground, sats, t0, periodS, timeSamples, spaceSamples)
  : { minFraction; meanFraction };
```
- The disc sample points are body-fixed (lat,lon); `windowCoverage` evaluates them through the reachability stub, which applies `θ(t)` per instant — so the region **rides the spinning globe** in the coverage math, consistent with the render. **Call sites pass `A1_SPACE_SAMPLES`/`A1_TIME_SAMPLES`** so the pinned bands hold.

### 3.5 `src/sim/a1/reachability.ts` — the connectivity STUB (§4.4 axis 1 only) over the rotating frame
```
const A1_MIN_ELEVATION_RAD   = 20 * Math.PI/180;                                // 0.349066, pinned
const A1_REF_LINK_DISTANCE_M = (A1_GEO_SEMI_MAJOR_M - A1_BODY_RADIUS_M) * 1.15; // 614_911.8, pinned

function pointReachable(eph, regionPoint:{latRad,lonRad}, ground, sats, t)
  : { reachable; viaSatId; oneWayLatencyS };
```
Algorithm (pure, deterministic, O(sats)), reusing the **field.ts elevation + inverse-square formulas** with Act-1 constants **and the rotation frame**:
1. For each sat: inertial position `solveOrbit(sat.orbit, t)` + `eph.position("earth", t)` (sat is inertial — **NOT** rotated).
2. **Surface points are rotated into inertial via `frame-a1.surfacePointInertial(lat,lon,t,...)`** (Decision A). The region point and the ground both ride `θ(t)`.
3. **Sat ⇄ region point:** `sin(el)=normal·dirToSat ≥ sin(A1_MIN_ELEVATION_RAD)` AND `eirp·(A1_REF_LINK_DISTANCE_M/d)² ≥ 1` — `normal` is the *rotated* surface unit vector (so the horizon mask is correct on the turning globe).
4. **Sat ⇄ ground:** the same gate at the rotated ground point. Reachable iff one sat passes **both** (bent-pipe `region → sat → ground`). **`oneWayLatencyS = (d_region_sat + d_sat_ground)/C_LIGHT`** — this is the bent-pipe one-way figure the UI displays (Decision E: GEO nadir ≈ 3.57 ms, LEO best ≈ 2.07 ms).

When the §7 solver lands it subsumes this with the same `(eph, region, ground, sats, t) → {reachable, latency}` signature.

### 3.6 `src/sim/a1/contract.ts` — the SLA contract + serve-or-breach tick (Act-1-local constants, ONE bar)
Carries the full §4.1 SLA fields; Act 1 enforces only connectivity, against the **single bar** `A1_AVAILABILITY_BAR = 0.85` (Decision C). Constants per Decision C. `stepActiveContract(contract, coveredFraction, dt)` ports the **proven DT-invariant accrual + breach-grace shape** from `m2/contracts.ts:259`, but with the **thresholded MET predicate** `served = coveredFraction ≥ A1_AVAILABILITY_BAR` (replacing M2's `servedFraction > 0`):
```
const served = coveredFraction >= A1_AVAILABILITY_BAR;
if (served) { servedSecondsAccum += dt; breachSecondsAccum = 0; }
else        { breachSecondsAccum += dt; }            // gated pay: no accrual below the bar
if (servedSecondsAccum >= A1_TERM_SECONDS) -> "completed";
if (breachSecondsAccum >= A1_BREACH_GRACE_SECONDS) -> "failed";
```
- **Gated pay (Decision C):** `€/sec` accrues only while `served` (at the full tariff — no proportional drip below the bar). **Breach pauses pay (no €/sec); a sustained breach past `A1_BREACH_GRACE_SECONDS` → `failed`.** `enforcedAxes: ["connectivity"]` only.
- **The auto-pick guard, embodied:** the parked GEO default holds 0.802 < 0.85 *for the whole term* (constant, because it parks) ⇒ it accrues NO served-seconds, breach builds past grace ⇒ FAILS. The dish-1.1 tuning holds 1.000 ≥ 0.85 ⇒ COMPLETES. Pinned in `contract.test.ts`.

### 3.7 `src/sim/a1/session.ts` — the Act-1 connectivity session (its OWN world)
A new `A1Session`, sibling to `M1Session`/`BuildSession`, with its **own** opening balance and **own** seed `A1_RNG_SEED` (distinct from `BUILD_RNG_SEED=7n`). Does not import or mutate the other sessions, so their goldens are untouched.
- State: `balance`, `sats: A1Sat[]`, `region`, `ground`, `contract`, `rngState`, `lastStepS`, `nextId`. **The rotation state is purely a function of `t`** (`θ(t)=ω·t`), so it is **not** separate mutable state — but the golden `a1StateHash` **folds the constant `A1_EARTH_OMEGA_RAD_PER_S`** so any change to the spin rate breaks the golden loudly (the directive's "fold the rotation state").
- Methods mirror `BuildSession`: `launchA1Sat({semiMajorM,incRad,subLonRad,busTier,antennaType}, t)` (charges `a1LaunchCost`, resolves the orbit via the epoch-correct `resolveA1Orbit`, **radians at the boundary**, no failure roll but `SimRng` threaded + snapshotted); `acceptContract/declineContract`; `step(eph,t,dt)` (advance offer window; if active, compute `coveredFraction` at `t` via the rotating reachability, apply the **gated** accrual `tariff·dt` only when `coveredFraction ≥ A1_AVAILABILITY_BAR`, advance the state machine — DT-invariant); `snapshot()/restore()` (JSON-safe by-value: balance, sats incl. every `SatOrbit` f64, region, ground, contract, rngState, lastStepS, nextId); `worldPositions(eph,t)` for the orrery.

### 3.8 `src/sim/action.ts` — one new action kind (extend, don't fork)
Add `KIND_LAUNCH_A1 = "launch_a1"` + `launchA1(params, atTick)`. Payload **`{ semiMajorM, incRad, subLonRad, busTier, antennaType }`** (radians + SI, JSON scalars). The orbit resolves deterministically from these + `atTick·DT` as epoch (epoch-correct sub-longitude per Decision A). **No deg↔rad conversion on the record/replay path** (only UI label formatting converts to degrees). Accept/decline reuse the existing `KIND_ACCEPT_CONTRACT`/`KIND_DECLINE_CONTRACT`.

### 3.9 `src/sim/a1/apply-a1-action.ts` — the shared applier
Mirror `m2/apply-build-action.ts`: the ONE place that turns a `SimAction` into an `A1Session` mutation, called by both the live loop and the replay driver. Same ordering: each tick `step(t)` runs first, then any action recorded at that tick applies post-step.

### Determinism + replay + a NEW golden
- **Pure layer:** every `a1/` file imports only from `ephemeris` (incl. `C_LIGHT`), `rng`, `state-hash`, `m2/orbit` (`SatOrbit` + `solveOrbit` + `meanMotion` + `orbitPeriodSeconds`), `m2/launch` (`EARTH_MU` only), `m2/roster` (`SatOrbit` type), and the field.ts elevation/inverse-square **formulas** (Act-1 constants). No `three`/DOM/wall-clock/random. `a1/purity.test.ts` greps for forbidden imports.
- **Replay = log + fixed tick.** A recorded session replays bit-identically.
- **Brand-new golden, isolated:** `src/sim/a1-connect-replay.test.ts` is a separate world with its own seed and its own pinned hash `A1_REPLAY_GOLDEN`. The M1/M2 goldens are not read/imported/mutated (stated in the header). `a1StateHash(session)` folds via `mixFloat/mixInt/mixString`: balance, rngState, nextId, **`A1_EARTH_OMEGA_RAD_PER_S`**, each sat's orbit f64s + bus/loadout, region, ground, every contract field. Bootstrap with a placeholder, read the actual hash, pin it.

---

## 4. The launch-planner UI (mouse-first)

New panel `src/panels/planner.ts` implementing `PanelHandle`, registered in `main.ts`'s `registry` and added to the `WindowRail` as `LAUNCH`.

**Panel contents (DOM, §8 1-bit chrome, reusing `telem` classes):**
- **Preset buttons** — `GEO PARK`, `LEO SWEEP` (Decision E). Clicking sets sliders + loadout to that preset's default. Plain `<button>`s like `buildCameraButtons`.
- **Sliders** — `SUB-LONGITUDE` (0°↔360°, maps to the GEO park meridian via the epoch-correct `m0Rad`), `INCLINATION` (0°↔ design max — live but teaches that tilting a GEO is worse), and a **`DISH` loadout toggle** (standard eirp 1.0 / big-dish eirp 1.1 — the verified closing lever). `input` updates a `PlannerDraft` (radians/SI) and re-emits a preview each frame. Labels display degrees (UI-only conversion).
- **Live readout** — headline **`HOLDS: NN%`** = `windowCoverage(...).minFraction` (at `A1_SPACE_SAMPLES`/`A1_TIME_SAMPLES`) for the draft over one GEO period from the current tick (Decision F); the **85% success line** is marked. Secondary: `NOW: NN%`, period, **bent-pipe one-way latency floor** (labeled as such), footprint angular radius. **Identical math to the live serve check.** When a sat is already in orbit, the draft preview evaluates the draft *together with* the in-orbit sat.
- **COMMIT LAUNCH** — shows cost (`€NNN`), disabled if `cost > balance`. On click appends a `launchA1` action at the current tick and applies it through `apply-a1-action.ts`.

**Clock control (anti-screensaver core):** `main.ts` already boots `clock.scaleIndex = 0` (1×, `main.ts:129`) — keep it; `paused` is the cold-open state. The ~4-min day makes 1× the engaging speed.

---

## 5. The "I made signal reach there" visualization — the SPINNING GLOBE (make-or-break)

**This is the load-bearing change. It is SHARED orrery code, so the three render risks are called out and resolved explicitly. Decision G (the toy-radius render-scale override) is what keeps it from collapsing.**

### (a) The Earth + its surface markers VISIBLY SPIN by θ(t), sized to the toy radius
- A new **Act-1 render mode** flag on `Orrery` (`setA1Mode(on)` / driven by main.ts when the A1 session is active). The spin, graticule, AND the toy-radius render-scale override (Decision G) are **scoped to this mode** — none run in M1/M2/M3 framing.
- **Decision G applied:** in A1 mode `refreshOrbitScale` uses `surfaceM = A1_BODY_RADIUS_M` and `bandOuterM = A1_RENDER_BAND_M`, and the Earth shell/billboard is sized to the toy radius — so the GEO/LEO orbits lift clear of the disc and the region disc reads ON the globe (verified separation, vs the sub-pixel collapse if the real 6371 km radius leaks in).
- The Act-1 surface markers (region disc, ground disc) are drawn at `surfacePointInertial(lat,lon,t,...)` (the same `frame-a1` helper the sim uses), rebased through the existing `renderInto`/`writeRenderPoint`. So a marker's world position already carries `θ(t)` and sweeps with the globe — no new rebase math.
- A faint **lat/lon graticule** (a pooled `LineSegments` of meridian + parallel arcs at radius `A1_BODY_RADIUS_M`, each vertex run through `Rz(θ(t))` before rebase, written into a preallocated `Float32Array` like the existing rings, `orrery.ts:980-993`) makes the spin legible. Built once; per-frame only re-writes positions (X-02).
- The Act-1 sats are drawn as the existing launched-sat markers + rings (`updateBuildMarkers`, `rebuildSatRings`/`updateSatRings`, `sampleSatOrbitRelative`) — **unchanged**, because the sat is inertial (and now lifted clear by the A1 de-squash band). The visible payoff: the GEO marker **hovers over the fixed region disc as the graticule turns under it** (parks); the LEO marker **sweeps across the turning globe and the region disc rotates out from under its footprint** (sets).

### (b) The signal path is a live beam
While `coveredFraction ≥ A1_AVAILABILITY_BAR`, draw a two-segment beam **region → sat → ground**, reusing the existing packet/link draw machinery. Beam present = served path exists.

### (c) The served region pulses; serve/breach is unmistakable
The region disc: **green pulse when covered ≥ bar**, **amber when breaching (in grace)**, **red where uncovered** (the parked GEO's poleward red slice in preview). `SYSTEM.LOG` writes transitions.

### RISK 1 — render rotation MUST NOT affect any golden (RESOLVED)
Goldens are pure sim-state hashes (`a1StateHash` over session state, not pixels). Render rotation + the de-squash override are read-only on sim state. The A1 sim rotation lives in the **A1 world's own new golden** (`A1_REPLAY_GOLDEN`), which folds `A1_EARTH_OMEGA_RAD_PER_S`. Existing M1/M2/M3 goldens are not touched regardless.

### RISK 2 — the spinning surface MUST NOT desync the M2 coverage-grid visuals (RESOLVED, the directive's explicit ask)
The M2 `CoverageOverlay` shell is built from **static unit-vector cell corners in a FIXED frame** (`coverage-overlay.ts:73-82`), and the M2 coverage *math* (`coverageDimsAt`, `field.ts`) assumes **no body rotation** (`field.ts:39-42`). If we naively spun the shared shell, the M2 grid render would diverge from the M2 grid math. **Resolution (chosen: scope the spin to Act-1 mode):**
- The graticule + the Act-1 surface-marker rotation + the Decision-G render-scale override run **only when `setA1Mode(on)`**. In M2/M3 framing the flag is off and **nothing about the existing shell/grid render or the de-squash `surfaceM` changes** — the M2 visuals stay in their fixed frame, matching their fixed-frame math, and the de-squash still reads `eph.radiusMeters("earth")`. No M2 grid math is touched.
- Act 1 does **not** use the M2 `CoverageOverlay` shell at all. Its coverage is a **region disc + gap overlay** (the missed part painted red, held part green) drawn as its own pooled mesh whose vertices are the region's body-fixed disc points run through `Rz(θ(t))` then rebased — so the Act-1 coverage *render* and the Act-1 coverage *math* both rotate together (consistent), and the M2 shell is never spun.
- Belt-and-suspenders pin: `a1-render-mode.test.ts` asserts that with `a1Mode=false` the graticule mesh is `visible=false`, the de-squash `surfaceM` equals `eph.radiusMeters("earth")`, and the M2 shell vertex buffer is byte-identical to its pre-A1 build (no accidental shared-state mutation).

### RISK 3 — the toy radii collapse to sub-pixel under the real-Earth de-squash (RESOLVED, Decision G)
This is the HIGH render-collapse issue. The de-squash reads `surfaceM = eph.radiusMeters("earth") = 6371 km`; all Act-1 radii (GEO 835, LEO 610, markers 300 km) are below it, fall in the identity region, and log-fold to <0.02 scene radii — invisible. **Resolution:** Decision G — in A1 mode drive `surfaceM` and the shell/billboard from `A1_BODY_RADIUS_M = 300 km` and set the band to `A1_RENDER_BAND_M`, so the radii separate (verified). Pinned by `a1-render-mode.test.ts`: in A1 mode `surfaceM == A1_BODY_RADIUS_M`, and the rendered GEO scene radius ≥ Kx the region scene radius (the GEO marker is provably not stuck to the surface).

The make-or-break is that every transition is **caused by the player**, the spin is **physically real** (the same `θ(t)` drives sim reachability and render), and the toy world is **actually visible** (Decision G) — so the GEO genuinely parks and the LEO genuinely sets on screen.

---

## 6. Test plan + numbered build-task sequence

### Test plan

**Physics-gate tests (MUST pass before any UI — Decisions A–G):**
- **`src/sim/a1/frame.test.ts`** (Decision A, NEW): a known body-fixed `(lat,lon)` maps to the expected inertial point at `t` (at `t=0`, `θ=0`, identity; at `t = period/4`, the +Z rotation by `ω·t` is exactly `Rz`); round-trip `inertial→bodyfix→inertial` identity to 1e-12. **Plus the non-zero-epoch park assertion (MED fix):** `resolveA1Orbit({subLon=45°}, epoch=37s)` then propagated and de-rotated parks at body-fixed 45° (NOT −10.5°). Pins +Z / prograde / `θ0=0,t0=0` and the epoch-correct `m0`.
- **`src/sim/a1/geostationary.test.ts`** (Decision A+B, NEW — the headline gate): the `GEO PARK` preset's **body-fixed sub-satellite longitude stays within ε (≤ 1e-6 rad) of its commit value across a full GEO period** (parks); the `LEO SWEEP` preset's body-fixed sub-longitude spans **> 300°** across the same window (sweeps/sets). Verified: GEO spread 1.5e-13°, LEO spread 358°.
- **`src/sim/a1/pacing.test.ts`** (Decision B+C): `orbitPeriodSeconds(GEO family) ∈ [180,360] s`; `A1_EARTH_ROTATION_PERIOD_S (= 2π/ω) == A1_GEO_PERIOD_S` (both 240); `A1_EARTH_OMEGA_RAD_PER_S == meanMotion(GEO orbit)` to 1e-12; `A1_LEO_PERIOD_S < A1_GEO_PERIOD_S`; `A1_TERM_SECONDS ≤ A1_GEO_PERIOD_S`.
- **`src/sim/a1/region.imperfection.test.ts`** (Decision C+D — the auto-pick guard): evaluated **at `A1_SPACE_SAMPLES=400`, `A1_TIME_SAMPLES=200`** (LOW fix): `windowCoverage(GEO PARK default).minFraction ∈ (0.6, 0.95)` (verified 0.802) AND `< A1_AVAILABILITY_BAR` (0.85); the dish-1.1 tuning gives `minFraction ≥ A1_AVAILABILITY_BAR` (verified 1.000); `windowCoverage(LEO SWEEP default).minFraction < 0.6` (verified 0.0 — it sets).
- **`src/sim/a1/region.monotonic.test.ts`** (Decision D): `windowCoverage(GEO).minFraction` is **monotonic non-decreasing in dish EIRP** (the closing lever, verified) AND **monotonic non-increasing in inclination** from 0 (the trap lever, verified 0.802→0.623→0.195). Proves both knobs are live, not inert, and correctly signed.
- **`src/sim/a1/tradeoff.test.ts`** (Decision E): `GEO PARK` and `LEO SWEEP` are **non-dominant** — GEO has higher single-sat windowMin (0.80 vs 0.0) but higher **bent-pipe one-way** latency floor (≈ 3.57 vs ≈ 2.07 ms, both asserted as bent-pipe `(d_region_sat+d_sat_ground)/c`); LEO has lower latency + `coveredFraction == 1` at its best instant but windowMin ≈ 0 (sets). Neither default at 1.0; neither default clears the 0.85 bar.
- **`src/sim/a1/reachability.winnable.test.ts`**: the offered preset+region+**co-located ground** is reachable at the region centre at the best tuning, AND the ground gate is not the hidden blocker (the AND is satisfiable, the bent-pipe link closes both legs).

**Unit tests:**
- `reachability.test.ts`: sat between region+ground (rotated frame) → reachable; below either horizon → not; `oneWayLatencyS == (d_region_sat+d_sat_ground)/C_LIGHT`; gate uses Act-1 constants + `θ(t)`.
- `contract.test.ts` (Decision C, the ONE bar): coverage ≥ 0.85 accrues `tariff·dt` (gated pay); coverage < 0.85 accrues NO pay and builds breach; the parked GEO default (constant 0.802 < 0.85) → breach past grace → `failed`; the dish-1.1 hold (1.000 ≥ 0.85) → `completed`; DT-invariance; complete-on-term.
- `region.test.ts`: full footprint over centre → 1; clipping edge → in (0,1); deterministic spiral (no RNG); `windowCoverage` min ≤ mean; band stable at `A1_SPACE_SAMPLES`.
- `consequence-truth.test.ts` (Decision F): previewed window-min for a draft orbit equals live window-min after committing that exact orbit and stepping one period (within float tolerance), so the `HOLDS` promise is kept.

**Golden + isolation + render-safety:**
- `a1-connect-replay.test.ts`: a fixed action log (launch GEO PARK with the dish-1.1 aiming loadout via radians/SI params, accept the contract, run to term → COMPLETED) replayed tick-by-tick; assert `a1StateHash(session) === A1_REPLAY_GOLDEN`. Plus **live==replay** (deep-equal `snapshot()` incl. each resolved `SatOrbit` f64), **two-runs-identical**, and a header asserting the M1/M2 goldens are untouched.
- `purity.test.ts`: grep `a1/` for `three`/`document`/`window`/`Date`/`performance`/`Math.random` → none.
- `a1-render-mode.test.ts` (Risk 2 + Risk 3 / Decision G guard, render-side): with `a1Mode=true`, the de-squash `surfaceM == A1_BODY_RADIUS_M` and the rendered GEO scene radius ≥ K× the region scene radius (no sub-pixel collapse); with `a1Mode=false`, the graticule mesh is hidden, `surfaceM == eph.radiusMeters("earth")`, and the M2 shell vertex buffer is byte-identical to its fresh build.

### Numbered build tasks (each one Build→Verify subagent; later depend on earlier)

> **GATE:** Tasks 1–6 are pure-sim and **must be green — especially the physics-gate tests (frame incl. non-zero-epoch, geostationary, pacing, imperfection-at-pinned-N, monotonic, tradeoff-as-bent-pipe, winnable) — before Task 7 (any UI) begins.**

1. **Rotation frame** (`a1/frame-a1.ts`) + `a1/world-a1.ts` constants (derive `A1_*` from the unforked `EARTH_MU`; epoch-correct `resolveA1Orbit`). Verify: `frame.test.ts` (incl. non-zero-epoch park), `pacing.test.ts` (period ∈ [180,360]s, ω == GEO mean motion, rotation period == GEO period), type-check, purity grep.
2. **A1 sat + region + ground + orbit family** (`a1/sat.ts`, `a1/region.ts` structs + `coveredFraction` + the `A1_SPACE_SAMPLES`/`A1_TIME_SAMPLES` constants, `a1/world-a1.ts` presets). Verify: `region.test.ts`, purity.
3. **Reachability stub over the rotating frame** (`a1/reachability.ts`) reusing field.ts formulas with `A1_MIN_ELEVATION_RAD`/`A1_REF_LINK_DISTANCE_M` + `frame-a1.surfacePointInertial`; bent-pipe `oneWayLatencyS`. Verify: `reachability.test.ts`, `reachability.winnable.test.ts`.
4. **`windowCoverage` + the geostationary/imperfection/monotonic/tradeoff gate** (extend `a1/region.ts`; confirm the verified tuning at the pinned N: region lat 30° rad 10°, A1_REF 614_911.8, min-el 20°, GEO default 0.802, dish-1.1 → 1.0, inc-3 → 0.623, inc-10 → 0.195, LEO default 0.0; bent-pipe latency GEO 3.57 / LEO 2.07 ms). Verify: `geostationary.test.ts`, `region.imperfection.test.ts`, `region.monotonic.test.ts`, `tradeoff.test.ts` **all green** (make-or-break gameplay gate — no UI until green).
5. **Contract + serve-or-breach tick + the ONE availability bar** (`a1/contract.ts`; `A1_AVAILABILITY_BAR = 0.85`, MET = `coveredFraction ≥ bar`, gated pay, grace on the same bar; port the M2 accrual/grace shape). Verify: `contract.test.ts` (GEO default 0.802 → failed; dish-1.1 1.0 → completed; gated pay; DT-invariance; complete-on-term).
6. **A1Session + cost + own seed + action wiring** (`a1/session.ts`; `KIND_LAUNCH_A1` + `launchA1` radians/SI payload in `action.ts`; `a1/apply-a1-action.ts`). Then **golden replay** (`a1-connect-replay.test.ts`): write `a1StateHash` (folding `A1_EARTH_OMEGA_RAD_PER_S`), bootstrap + pin `A1_REPLAY_GOLDEN`, add live==replay (asserting resolved `SatOrbit` f64s) + two-runs-identical + `consequence-truth.test.ts`. Verify: full `vitest run` green; confirm M1 (`544847093270497462n`) / M2 (`8431658617016421069n`) goldens still pass unchanged; purity grep.
7. **Planner panel** (`panels/planner.ts`) + register in `main.ts` + add to `WindowRail`. Sliders `SUB-LONGITUDE` + `INCLINATION` + `DISH` loadout (radians/SI draft); headline `HOLDS: NN%` with the 85% line; secondary bent-pipe latency floor (labeled). Verify: panel summons; dragging any control re-emits a preview; COMMIT appends+applies a `launch_a1` action through the shared applier.
8. **Orrery spinning globe + graticule + the Decision-G render-scale override** (`Orrery.setA1Mode`; in A1 mode `surfaceM = A1_BODY_RADIUS_M`, band = `A1_RENDER_BAND_M`, shell/billboard sized to the toy radius; graticule pooled `LineSegments` rotated by `θ(t)`; Act-1 surface markers + region/gap disc rotated by `θ(t)` via `frame-a1`; preview ghost track+ring+footprint). Verify (via `/run` or `/verify`): the globe + graticule visibly spin AT A VISIBLE SCALE (not sub-pixel); the **GEO marker parks over the fixed region disc** while the **LEO marker sweeps and the region rotates out from under it**; dragging DISH recolors the poleward red gap live; `a1-render-mode.test.ts` green (toy `surfaceM` + GEO-over-region ratio in A1 mode; M2 shell + de-squash untouched off-mode; no golden moves).
9. **Serve/breach live visual + clock default + scenario script** (beam region→sat→ground while ≥ bar; region green/amber/red pulse; `SYSTEM.LOG` transitions; clock stays 1×-with-pause; one region at lat 30°, co-located ground, one offered contract, both presets viable-but-imperfect). Verify end-to-end: the full Beat 0→6 loop is playable at 1× with the mouse; an aimed GEO PARK (dish-1.1) holds `HOLDS ≥ 85%` for the full term to `COMPLETED`; the **un-aimed GEO default sits at `HOLDS: 80%` and FAILS** (auto-pick guard); a LEO SWEEP visibly sets and never reaches `HOLDS ≥ 85%` alone (the honest Act-2 wall); **no auto-pick anywhere; nothing solved by a default preset.**

### What is deferred (do not build in Act 1, per §8 fences)
The §7 routing solver (only the reachability stub seam), multi-hop/CROSSLINK/LASER and S-slots, bus tiers 2–4, availability/latency/bandwidth *enforcement* beyond Act-1's window-connectivity bar, oversubscription, all faults, escalation/dynamic-demand, rivals, decay, insurance, launch-failure roll, the LEO **constellation** that would hold the region (Act 2), and the Act 4 Mars teaser. They are named in the structs/seams (`enforcedAxes`, the reachability interface, the threaded `SimRng`) so they slot in without rework. The spinning frame is real (not deferred), scoped to Act-1 mode and folded into the Act-1 golden only.

---

**Key file references (all absolute):**
New sim under `/home/basov/Games/signal-horizon/src/sim/a1/`: `frame-a1.ts`, `world-a1.ts`, `sat.ts`, `region.ts`, `reachability.ts`, `contract.ts`, `session.ts`, `apply-a1-action.ts`, `purity.test.ts`, plus tests `frame.test.ts`, `geostationary.test.ts`, `pacing.test.ts`, `region.test.ts`, `region.imperfection.test.ts`, `region.monotonic.test.ts`, `tradeoff.test.ts`, `reachability.test.ts`, `reachability.winnable.test.ts`, `contract.test.ts`, `consequence-truth.test.ts`. New golden `/home/basov/Games/signal-horizon/src/sim/a1-connect-replay.test.ts`. Extend `/home/basov/Games/signal-horizon/src/sim/action.ts` (`KIND_LAUNCH_A1`, radians/SI payload). New panel `/home/basov/Games/signal-horizon/src/panels/planner.ts`. Extend `/home/basov/Games/signal-horizon/src/orrery/orrery.ts` (`setA1Mode`, the Decision-G toy-radius de-squash/shell override, graticule, rotated Act-1 surface markers/region disc) + a render-mode test `a1-render-mode.test.ts`. Wire in `/home/basov/Games/signal-horizon/src/main.ts` (clock boots `scaleIndex=0` at line 129 — keep) + `/home/basov/Games/signal-horizon/src/wm/window-rail.ts`.
Reuse-as-is: `solveOrbit`/`meanMotion`/`orbitPeriodSeconds` from `/home/basov/Games/signal-horizon/src/sim/m2/orbit.ts`; `SatOrbit` from `/home/basov/Games/signal-horizon/src/sim/m2/roster.ts`; `EARTH_MU` from `/home/basov/Games/signal-horizon/src/sim/m2/launch.ts` (**unforked**); `C_LIGHT` + the elevation + inverse-square **formulas** in `/home/basov/Games/signal-horizon/src/sim/coverage/field.ts` (Act-1 supplies its own constants); `orbitRenderRadius`/`OrbitRenderScale` in `/home/basov/Games/signal-horizon/src/orrery/orbit-render-scale.ts` + `sampleSatOrbitRelative`/`orbitRenderRadius` wiring in `orrery.ts`; `mixFloat/mixInt/mixString` in `/home/basov/Games/signal-horizon/src/sim/state-hash.ts`; the `m2-build-replay.test.ts` structure as the golden template.
**Explicitly NOT reused / NOT spun / NOT leaked:** `/home/basov/Games/signal-horizon/src/orrery/coverage-overlay.ts` (the M2 shell — its static fixed-frame vertices are never rotated; Act 1 draws its own region disc); the real `eph.radiusMeters("earth")` is NOT used to scale the A1 render (Decision G drives the toy radius in A1 mode); `src/sim/m2/launch.ts` presets/`resolveLaunchOrbit` and `src/sim/m2/contracts.ts` real-hour constants + its `servedFraction > 0` predicate (Act-1 owns `world-a1.ts` presets + Act-1 SLA constants + the single `A1_AVAILABILITY_BAR`).
