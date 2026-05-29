# FINDINGS — can Signal Horizon's UX be built more naturally in Tauri + TS + Three.js than in Godot?

**Short answer: Yes — at least as naturally, and it *iterates* dramatically faster, with
zero loss of numerical fidelity.** The two genuinely hard problems (solar-system-scale f32
precision, and the 3D orrery) turned out to be the *same* problems with the *same* solutions
in both stacks — the web stack did not make them harder. The real cost of a move is not the
UX; it's (a) re-validating under the WebView you actually ship (WebKitGTK on Linux, **not**
Chromium), and (b) re-implementing the deterministic fixed-tick + save/replay in TS.

This document is the deliverable. The spike that backs it lives in this folder; it runs with
`npm run dev`, passes `npm test` (Kepler port pinned bit-for-bit to the C# truth layer), and
was verified headful on the GPU in ungoogled-chromium (see `docs/screenshots/`).

---

## What the spike actually demonstrates

- A **DD-10 zone-grid tiling WM** in the DOM: always-tiled invariant, title-bar drag → zone
  swap, gutter resize, five data-driven presets, instant keyboard switching.
- A **Three.js orrery**: Sun/Earth/Mars on correct elliptical orbits (real `system.json`),
  LEO (53°) + GEO (equatorial) sats whose **planes read clearly in 3D**, dashed rings,
  dithered billboards, a body-anchored orbit camera with four animated presets, and a packet
  crawling Earth→Mars at **honest light speed** whose on-screen progress equals the displayed
  one-way light delay.
- The supporting **1-bit chrome**: SYSTEM.LOG with severity syntax highlighting, a live
  telemetry readout, an always-visible status strip — visually a sibling of the current
  Godot build.

It is a faithful sibling of the Godot screen, built to compare the *stack*, not to replace
anything.

---

## Easier than Godot

1. **Iteration velocity — the headline.** Vite HMR applies edits in well under a second with
   state preserved. Every polish pass in this spike (label offsets, dither cell size, shader
   stipple, camera framings) was a save-and-see cycle measured in seconds, with full browser
   DevTools on the live WebGL/DOM. There is no engine build, no scene reload, no editor
   round-trip. This compounds over a project and is the single strongest argument for the move.

2. **No precision tax on the math.** TypeScript `number` *is* IEEE-754 f64. The Kepler truth
   layer ported across with the **same 8-iteration Newton solver, the same 3-1-3 rotation, the
   same `WrapPi` fmod semantics, and the same recursive parent composition** — and reproduces
   the C# implementation **bit-for-bit** (Earth@J2000 worst relative error vs the real
   `SignalHorizon.Sim.Ephemeris` = `0.000e+0` on this machine; see `npm test`). The "C# double
   is reliable f64 fidelity" argument for Godot is fully preserved in TS.

3. **Dense text UI is genuinely *better* in the DOM.** The panels (SYSTEM.LOG, telemetry,
   status strip) are the kind of information-dense, syntax-highlighted, scrollable readouts
   that the DOM + CSS were made for. Severity colouring, monospace tables, the bottom strip —
   all trivial and expressive, and they came out matching the Godot build's language quickly.

4. **One language, one build, one repo.** Sim, WM logic, panels, and the 3D view are all
   TypeScript. There is no GDScript/C#↔Godot-node boundary. The pure layer stays
   engine-agnostic and unit-tested (Vitest), exactly as the Godot project keeps it
   `dotnet test`-able.

5. **Shaders & line work are ergonomic.** The dithered terminator billboards (GLSL Bayer 4×4)
   and dashed rings (BufferGeometry segment-skipping) were concise. Notably, the Godot code
   rebuilds `ImmediateMesh` every frame as a *workaround* for the lack of a stable dashed-line
   primitive; the Three.js equivalent (update a `BufferGeometry`) is a cleaner API at similar cost.

6. **Reproducible visual verification.** Driving ungoogled-chromium headful via Playwright
   gives deterministic, scriptable screenshots of any state (preset + camera + time). That is
   at least as good as Godot's `--write-movie` frame-capture loop, and it's the same browser
   the user runs.

---

## Harder than Godot (honest friction)

1. **Solar-system scale still needs floating origin — by hand.** Three.js matrices/shaders are
   f32, so a millimetre delta at 10¹¹ m is lost unless you rebase. I re-implemented the exact
   discipline from `render/FloatingOrigin.cs`: subtract the f64 focus position *before* casting
   to f32. **This is not worse than Godot — Godot's `Vector3` is also f32 and needs the identical
   trick** — but neither engine gives it to you for free.

2. **No built-in LOD / constant-screen-size.** Bodies are sized to constant pixels per frame
   (mirroring Godot's `FaceBodiesToCamera`). Same manual solution in both.

3. **Per-frame GC pressure (found by the review, now fixed).** Idiomatic Three.js
   (`new Vector3()` in hot loops) allocates — the orrery originally churned ~960 `Vector3`/frame
   across bodies/rings/link/labels. The adversarial review caught it; the orrery now reuses
   scratch vectors and writes ring/link vertices straight into the `Float32Array` (zero
   per-frame `THREE` allocations). The lesson stands: Three.js makes the *easy* path allocate,
   whereas Godot's engine loop is more forgiving by default.

4. **Bundler friction with external data.** The symlinked `data/system.json` (same file, no
   copy) needed Vite `server.fs.allow` widening. Minor, one-line.

5. **You re-implement the deterministic backbone.** The spike has no determinism requirement,
   so it uses a plain f64 sim-clock accumulator. The real project's **bit-deterministic
   fixed-tick + seed/action-log save-replay** would need porting to TS. It's low-risk (f64 is
   fine; an integer tick is fine; the pure layer already unit-tests under Vitest), but it is
   real work and must be done carefully to keep golden-master parity.

---

## DOM tiling-WM aesthetic — specific pain points

The "feels like software, not a webpage" bar is **achievable**, but only after deliberately
killing browser defaults. What it took:

- A hard reset of `user-select`, focus outlines, tap-highlight, `overscroll-behavior`, and
  native scrollbars. Once suppressed, no webpage-ness leaks through.
- **Custom scrollbars are a portability wart**: `::-webkit-scrollbar` is Chromium/WebKit-only;
  Firefox uses a different mechanism. Fine for a Tauri/WebKit target, but not portable.
- **Crisp pixels need vendor CSS**: `-webkit-font-smoothing: none` / `image-rendering` are
  WebKit/Chromium-specific. Again fine for the Tauri target, noted for portability.
- **Escape the box model by not using it for tiles.** The WM computes pixel rects from a
  relative-weight solver and absolutely-positions zones; it never relies on flow/flex for the
  tiling itself. That's why the layout reads as a window manager rather than a web page — the
  engine owns geometry. Flow/flex is used only *inside* a panel, where it belongs.
- A true bitmap font is a trivial webfont swap (the spike uses a monospace placeholder per the
  brief). Runtime Bayer-dither tiles → CSS custom properties gave the 1-bit tone cleanly.

Net: the DOM is a *strong* fit for this chrome. The pain points are all "turn off the
browser's opinions," not "fight the layout engine."

---

## Three.js orrery vs Godot 3D orrery — honest comparison

| Concern | Godot 3D | Three.js (this spike) | Verdict |
|---|---|---|---|
| Elliptical orbits from real ephemeris | ✅ | ✅ (bit-identical port) | parity |
| Inclined planes read (LEO 53° vs GEO) | ✅ | ✅ (see `02-orbits-planes.png`) | parity |
| f32 precision at AU scale | FloatingOrigin (manual) | FloatingOrigin (manual, ported) | parity — same trick |
| Multi-scale view (LEO ↔ Mars in one shot) | log-compression (manual) | log-compression (manual, ported) | parity |
| Dithered bodies / terminator | `body.gdshader` | GLSL Bayer 4×4 billboard | parity, both custom |
| Dashed orbit rings | `ImmediateMesh` rebuilt/frame (workaround) | `BufferGeometry` update | TS slightly cleaner |
| Constant-screen-size bodies | `FaceBodiesToCamera` (manual) | per-frame sizing (manual) | parity |
| Camera presets + smooth transitions | curated presets + tween | curated presets + eased tween | parity |
| Renderer consistency across OS | engine-owned, consistent | **inherits the OS WebView** | **Godot wins** |
| Iteration on shaders/scene | engine build/reload | HMR + DevTools | **Three.js wins** |
| Post-FX pipeline maturity | mature | roll-your-own / EffectComposer | Godot ahead |

The orrery — the explicit make-or-break view — reached parity on every functional axis. The
hard parts were hard *identically* in both engines. Godot's edge is a consistent,
engine-owned renderer and a mature post-FX stack; Three.js's edge is iteration speed and
sharing one language/build with the rest of the app.

---

## Open risks (must close before committing to a move)

1. **WebKitGTK ≠ Chromium (the big one).** Tauri on Linux ships **WebKitGTK**. This spike was
   validated in Chromium. WebGL2 limits, the dither rendering, custom scrollbars, and
   `-webkit-font-smoothing` must be re-checked under WebKitGTK. Godot, by contrast, ships one
   renderer everywhere. **Recommended next step: wrap the spike in Tauri and re-run these exact
   screenshots under WebKitGTK.** (Rust 1.95 + webkit2gtk-4.1 are already present here.)
2. **Determinism/save-replay** must be re-implemented in TS (fixed-tick + seed + action log).
   Low-risk but load-bearing for the design; keep the golden-master pin green throughout.
3. **Perf at full scene scale**: pool the per-frame allocations before judging frame-time.
4. **Cross-platform WebView matrix** (WebKitGTK / WKWebView / WebView2) if shipping beyond Linux.

---

## Recommendation

**Lean yes — proceed to a gated migration, WebKitGTK validation first.**

- The UX question is answered: the tiling WM, the 3D orrery, the packet honesty, and the
  keyboard-native presets all build at least as naturally in TS/Three.js, with **much faster
  iteration** and **no numerical-fidelity loss**. The aesthetic matches the Godot build.
- The decision should hinge on **one gate, run next**: wrap this spike in Tauri and confirm it
  renders and performs acceptably under **WebKitGTK**. If that passes, the remaining cost is
  re-implementing the deterministic fixed-tick/save-replay in TS — bounded, low-risk work that
  the already-bit-identical pure layer de-risks.
- If WebKitGTK parity fails or is flaky, the consistent engine-owned renderer becomes a strong
  reason to stay on Godot, and the right move is to keep Godot for the 3D/render layer while
  borrowing the iteration lessons.

The thing the team was most worried about — f64 orbital truth and a legible 3D orrery — is
exactly the thing that ported cleanest. The thing to actually de-risk is the shipping WebView.
