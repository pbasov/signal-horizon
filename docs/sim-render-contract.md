# Signal Horizon — Sim ↔ Render Boundary Contract
### v1 · the interface that keeps the truth layer pure and the render layer honest

> This is the single most important coordination artifact between the deterministic sim and everything that draws or reacts to it (Engineering Principle #1). The sim owns *truth* in f64; the render layer owns the *lie* (scaling, floating-origin rebase, drawing) in f32. They meet only here. Keep this current with the actual code — it is referenced by every render/UI integration ticket.
>
> **Status:** v1, reconciled to the landed TypeScript code (`src/sim/clock.ts`, `src/sim/ephemeris.ts`, `src/sim/delay.ts`, `src/sim/links.ts`, `src/orrery/orrery.ts`, driven by `src/main.ts`). Symbol names below are the ones that actually exist in the source. The original C#/Godot foundations were migrated to TypeScript + Three.js (WebGL2) + Vite, browser-native (Chromium).

---

## The one rule

**The sim never returns a `THREE.Vector3` (f32).** It returns f64 — plain `number`, `number[]` (the `Vec3` tuple `[number, number, number]`), or arrays of them. TypeScript `number` is IEEE-754 f64 natively, so the sim carries the same precision as the C# `double` original with no special handling. Conversion to a `THREE.Vector3` happens in exactly **one** place: the floating-origin rebase in `src/orrery/orrery.ts`. Everywhere else, f64 truth flows untouched. `src/sim/` imports nothing from `three` or the DOM, so the sim half cannot construct a `THREE.Vector3` — purity is enforced by the project boundary itself.

---

## Time

- **Authority:** `SimClock` (`src/sim/clock.ts`) holds absolute sim-time as an integer `tick`; each tick is exactly `DT` sim-seconds (`DT = 1/60`). The `seconds` getter is derived exactly as `tick * DT` — always exact, no drift. `setTick(tick)` resets the clock to an exact tick for save/load replay.
- **Advance:** the fixed-timestep accumulator lives in `SimClock`: the game loop in `src/main.ts` calls `scheduleWall(wallDtSeconds)` with the wall-frame delta (the *only* place a render-frame delta touches sim time), then drains `nextTick()` until it returns `null`, stepping the sim once per returned tick. Time-acceleration scales how many fixed steps run per frame (via the `TIME_SCALES` multiplier) — it never changes `DT` or any physics constant.
- **Consequence:** anything time-dependent is a **pure function of absolute `t`**. `Ephemeris.position(id, t)` called twice with the same `t` is bit-identical. Fast-forward and save-replay fall out for free.

## Positions & bodies (the truth layer)

`Ephemeris` (`src/sim/ephemeris.ts`), built from the parsed `data/system.json` via `Ephemeris.build(systemSpec)`:

| Call | Returns | Notes |
|---|---|---|
| `position(id, t)` | `Vec3` (`[number, number, number]`) `{x,y,z}` | **metres, absolute, heliocentric ecliptic-J2000.** f64. |
| `velocity(id, t)` | `Vec3` `{vx,vy,vz}` | m/s. |
| `distanceBetween(a, b, t)` | `number` | metres. |
| `bodyIds()` | `string[]` | all loaded bodies + satellites. |
| `hasBody(id)` | `boolean` | |
| `parentOf(id)` | `string` | `""` for the root (Sun). |
| `radiusMeters(id)` | `number` | physical radius (for occlusion + render scale). |
| `sampleRelativeOrbit(id, count)` | `Vec3[]` | one closed orbit relative to the parent, evenly spaced in mean anomaly; for the renderer's orbit rings (geometric, independent of `t`). `[]` for the root. |

Propagation is analytic two-body Kepler (`solveEccentricAnomaly`: Newton, fixed `KEPLER_ITERS = 8` iterations → perifocal → 3-1-3 rotation via `rotatePerifocal` → parent-relative composition). Hierarchy: Moon is parent-relative to Earth, composed by recursion. Decision: **Kepler now, SGP4 deferred** (Q1). The algorithm is a faithful port of the C# `Ephemeris.cs` + `OrbitalBody.cs`; `number` being f64 natively, it preserves the exact control flow and bit-results.

## Links, line-of-sight, light-delay (sim core)

In `src/sim/links.ts` and `src/sim/delay.ts` (pure; both import only types from `src/sim/ephemeris.ts`):

- `segmentSphere(a, b, center, radius) -> { distance, t, blocked }` — pure f64 closest-point-vs-sphere; `blocked` requires the centre to project *strictly between* the endpoints (`0 < t < 1`). Port of `SignalLink.cs`'s `SegmentBlockedBySphere`.
- `earthMarsLos(eph, t) -> { missDistance, marginSolarRadii, occulted }` — composes Earth/Mars/Sun positions through `segmentSphere` to give the conjunction margin (in solar radii) and whether the solar disk occults the link.
- `oneWaySeconds(distanceM) -> number` = `distanceM / C_LIGHT` (`C_LIGHT = 299792458.0`, exact by SI definition); plus `roundTripSeconds(distanceM)` and `freshness(ageSeconds, halfLifeSeconds) = 2^(-age/halfLife)` (a degenerate `halfLife <= 0` is instantly stale unless `age <= 0`). Port of `SignalDelay.cs`.

## The render boundary (the lie)

`Orrery` (`src/orrery/orrery.ts`) — the **only** f64→`THREE.Vector3` crossing, in its private `renderInto(out, abs, focusAbs)` / `writeRenderPoint(arr, w, ax, ay, az, focusAbs)` rebase methods:

- `renderInto(out, abs, focusAbs)` — subtract the focus-body position `focusAbs` from `abs` **in f64**, apply the radial compression scale, swap axes (ecliptic `x, y, z=north` → three `x, up=z, -y`), *then* write into the supplied `THREE.Vector3` (or, in `writeRenderPoint`, straight into a `Float32Array`). A millimetre delta at 10⁹ m survives because the subtraction never touches f32. The hot loop reuses scratch vectors and allocates no new `Vector3`/`Color`.
- The scene is rebased every frame around the camera-focus body (`focusId`); `focusAbs = eph.position(focusId, t)`. The orrery reads the f64 `Ephemeris` directly.
- A separate, non-linear **scale-compression** remap — `compressScale(d) = logScale·ln(1 + d/logK) / d`, per camera preset — sits *inside* the rebase, applied *after* the focus subtraction. It's a visual lie, never the truth, and never feeds back into distance / light-delay math.

## Styling: monochrome machine, living signal (GDD §8 / DD-8)

Two distinct styling systems, never mixed:

- **Chrome (1-bit):** `applyDither()` (`src/dither.ts`) generates ordered Bayer 4×4 stipple tiles at runtime and injects them as CSS custom properties (`--dither-sparse/-dense/-mid`); the visual rules live in `src/style.css`. White-on-near-black, monospace, square corners, dithered title bars. Tonal variation comes from dither, never colour. This is what the **tiling-WM shell (DD-8)** — `Shell` (`src/wm/shell.ts`) — dresses its tiles/splits in.
- **Signal (coloured):** the orrery's billboard shaders carry the coloured "living signal" layer. `src/orrery/orrery.ts` embeds two GLSL3 fragment shaders (`FRAG` for bodies/packets, `HALO_FRAG` for the Sun glow) with uniforms `uColor`, `uSunDirView`, `uTerminator`, `uCell`, and a Bayer 4×4 ordered-dither stipple in screen space (the redundant channel that keeps shapes legible at 1-bit). Freshness drives a **redundant** colour treatment in TS, not a shader uniform: the packet's colour is `lerp(machine-grey → amber, freshness)`, so a stale packet desaturates toward machine-grey as its freshness drains (mirrors `freshness()` from `src/sim/delay.ts`).

## Save / determinism (state crosses as data, not objects)

- **Save / replay backbone (P0-05/06):** `{version, seed, dt, initial_conditions, actions[], snapshots[]}`, JSON, versioned, lossless round-trip. Not greenfield — it is being ported from the complete, tested C# reference at `/home/basov/Games/Godot/galaxy-link/SignalHorizon.Sim/` (`SaveGame` / `SimAction` / `StateHash` / `SimScheduler`).
- `CanonicalHash(eph, ticks, dt)` lands in `src/sim/state-hash.ts` (the TS port of `StateHash.cs`): deterministic, id/tick-sorted, f64-bit-stable — the golden-master substrate (P0-06), pinned to the C# golden state-hash `15552073864691245897n` (unsigned u64). Any new player action must be serialisable into the action log or it breaks determinism *and* save/load at once.

---

## Integration phase reads this, then:

1. Drives the orrery from `eph.position(id, clock.seconds)` through the `Orrery.renderInto` floating-origin rebase (`src/orrery/orrery.ts`) — sim-driven body motion, never a faked spin.
2. Wraps panels/orrery in the **tiling-WM shell** (DD-8), `Shell` (`src/wm/shell.ts`), dressed in the 1-bit chrome from `src/dither.ts` + `src/style.css`.
3. Renders links/packets via the orrery's signal shaders, with light-delay readouts from `oneWaySeconds` (`src/sim/delay.ts`) — the on-screen packet crawl **must** match the displayed one-way time (the M0 money shot).
