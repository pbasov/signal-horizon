# Signal Horizon — Sim ↔ Render Boundary Contract
### v0 · the interface that keeps the truth layer pure and the render layer honest

> This is the single most important coordination artifact between the deterministic sim and everything that draws or reacts to it (Engineering Principle #1). The sim owns *truth* in f64; the render layer owns the *lie* (scaling, floating-origin rebase, drawing) in f32. They meet only here. Keep this current with the actual code — it is referenced by every render/UI integration ticket.
>
> **Status:** v0, authored alongside the foundations workflow. Class/function names below are the agreed targets; reconcile against the landed code (`SignalHorizon.Sim/Ephemeris.cs`, `render/FloatingOrigin.cs`, etc.) when the foundations workflow completes, and bump to v1.

---

## The one rule

**The sim never returns a `Vector3`/`Transform3D`/`Basis` (those are 32-bit `real_t`).** It returns f64 — plain `double`, `double[]`, or arrays of them. Conversion to `Vector3` happens in exactly **one** place: the floating-origin rebase in `render/`. Everywhere else, f64 truth flows untouched. The pure `SignalHorizon.Sim` library carries no Godot reference, so the sim half cannot construct a `Vector3` — purity is enforced by the project boundary itself.

---

## Time

- **Authority:** `SimClockCore` (`SignalHorizon.Sim/SimClock.cs`) holds absolute sim-time as an integer `tick × dt_seconds`. `TimeSeconds() -> double` is the canonical clock read.
- **Advance:** `TickScheduler` (`game/TickScheduler.cs`) is the *only* place a render-frame delta touches sim time (fixed-timestep accumulator). Time-acceleration scales how many fixed steps run per frame — it never changes `dt` or any physics constant.
- **Consequence:** anything time-dependent is a **pure function of absolute `t`**. `position(id, t)` called twice with the same `t` is bit-identical. Fast-forward and save-replay fall out for free.

## Positions & bodies (the truth layer)

`Ephemeris` (`SignalHorizon.Sim/Ephemeris.cs`), loaded via `Ephemeris.LoadFrom("res://data/system.json")`:

| Call | Returns | Notes |
|---|---|---|
| `Position(id, t)` | `double[] {x,y,z}` | **metres, absolute, heliocentric ecliptic-J2000.** f64. |
| `Velocity(id, t)` | `double[] {vx,vy,vz}` | m/s. |
| `DistanceBetween(a, b, t)` | `double` | metres. |
| `BodyIds()` | `string[]` | all loaded bodies + satellites. |
| `HasBody(id)` | `bool` | |
| `ParentOf(id)` | `string` | `""` for the root (Sun). |
| `RadiusM(id)` | `double` | physical radius (for occlusion + render scale). |

Propagation is analytic two-body Kepler (Newton, fixed iterations → perifocal → 3-1-3 rotation → parent-relative composition). Hierarchy: Moon is parent-relative to Earth, composed by recursion. Decision: **Kepler now, SGP4 deferred** (Q1).

## Links, line-of-sight, light-delay (sim core)

In `SignalHorizon.Sim/SignalLink.cs` and `SignalHorizon.Sim/SignalDelay.cs` (pure):

- `SegmentBlockedBySphere(p1, p2, center, radius) -> bool` — pure f64 ray/segment-vs-sphere, blocker must be *between* the endpoints.
- `LineOfSight(eph, a_id, b_id, t, occluder_ids) -> bool` — composes positions + the above.
- `Distance(eph, a_id, b_id, t) -> double` — metres.
- `OneWaySeconds(distance_m) -> double` = `distance_m / C` (C = 299792458.0); `RoundTripSeconds`, `Freshness(age, half_life) = pow(0.5, age/half_life)`, `FormatDelay(s) -> "14m 22s"`, `AsOfStamp`.

## The render boundary (the lie)

`FloatingOrigin` (`render/FloatingOrigin.cs`) — the **only** f64→`Vector3` crossing:

- `ToRender(abs_xyz_f64, origin_xyz_f64, scale) -> Vector3` — subtract the focus origin **in f64**, multiply by `scale`, *then* construct `Vector3`. A millimetre delta at 10⁹ m survives because the subtraction never touches f32.
- `SetOrigin(abs_xyz)` / `WorldToRender(abs_xyz)` — rebase the scene each frame around the camera-focus body. Ephemeris-agnostic (takes f64 arrays / an id→pos map; the integration phase wires `Ephemeris` in).
- A separate, non-linear **scale-compression** remap (the orrery's "selectable compression") sits *after* the rebase — it's a visual lie, never the truth.

## Styling: monochrome machine, living signal (GDD §8 / DD-8)

Two distinct styling systems, never mixed:

- **Chrome (1-bit):** `ChromeTheme.Build() -> Theme` (`ui/theme/ChromeTheme.cs`). White-on-near-black, monospace, square corners, dithered title bars. Tonal variation comes from dither, never colour. This is what the **tiling-WM shell (DD-8)** dresses its tiles/splits in.
- **Signal (coloured):** `SignalPalette` (`render/SignalPalette.cs`) — per-dimension hues (connectivity/bandwidth/latency/observation/freshness), faction hues, two currency treatments, each paired with a **redundant** dither/shape/glyph so colour-off stays unambiguous (colour-blind safe). `render/shaders/signal.gdshader` draws signal billboards (bodies as dithered circles, packets, link glyphs) with uniforms `hue`, `freshness` (1=fresh→hue, 0=stale→`machine_grey`), `machine_grey`, `purist`, and a freshness-modulated Bayer grain (the redundant channel that encodes age even at `purist==1`).

## Save / determinism (state crosses as data, not objects)

- `SaveGame` (`SignalHorizon.Sim/SaveGame.cs`): `{version, seed, dt, initial_conditions, actions[], snapshots[]}`, JSON, versioned, lossless round-trip.
- `StateHash.CanonicalHash(eph, ticks, dt)` (`SignalHorizon.Sim/StateHash.cs`): deterministic, id/tick-sorted, f64-bit-stable — the golden-master substrate (P0-06). Any new player action must be serialisable into the action log or it breaks determinism *and* save/load at once.

---

## Integration phase reads this, then:

1. Drives the orrery from `Ephemeris.Position(id, clock.TimeSeconds())` through `FloatingOrigin` — sim-driven body motion, never a faked spin.
2. Wraps panels/orrery in the **tiling-WM shell** (DD-8) dressed in `ChromeTheme`.
3. Renders links/packets via the signal shader, with light-delay readouts from `SignalHorizon.Sim/SignalDelay.cs` — the on-screen packet crawl **must** match the displayed one-way time (the M0 money shot).
