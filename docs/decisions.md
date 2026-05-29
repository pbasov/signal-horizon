# Spike Decisions (SD)

Decision log for the Tauri/TS/Three.js spike, in the spirit of the Godot project's
`docs/decisions.md` (DD-N). These are scoped to the spike only.

---

### SD-1 — Stack under test: Tauri + TypeScript + Three.js, Chromium-first
**Status: ACCEPTED.** The spike evaluates whether the DD-10 tiling-WM shell + 3D orrery
build more naturally on a web stack than on Godot. The entire UX is WebView content, so
it is developed and judged in Chromium first (real GPU, DevTools, instant HMR), with the
Tauri native shell deferred (SD-2). Reason: every make-or-break question (tiling feel,
orrery readability, packet honesty, keyboard-native presets) is answered by the webview;
the native wrapper adds nothing to those answers.

### SD-2 — Defer the Tauri native shell
**Status: ACCEPTED (deferred).** Tauri 2.x compiles a Rust shell (verified available:
rustc 1.95, webkit2gtk-4.1 present). We do **not** wrap the app yet. Risk recorded: Tauri
on Linux renders in **WebKitGTK**, not Chromium — WebGL2 limits, CSS dither rendering and
font smoothing must be re-validated when wrapped. The code is kept Tauri-ready (fixed dev
port, no Chrome-only APIs). See FINDINGS "Open risks".

### SD-3 — Port the Kepler truth layer to TS; pin against a C# golden master
**Status: ACCEPTED.** `Ephemeris.cs`/`OrbitalBody.cs` are ported verbatim to
`src/sim/ephemeris.ts` (TS `number` is f64 natively; same 8-iteration Newton solver, same
3-1-3 rotation, same `WrapPi` fmod semantics, same recursive parent composition). The
xunit suite deliberately holds **no external JPL vector** ("NEVER external JPL state
vectors"), so the golden master is *generated* by compiling the **real, unmodified** C#
sources (`tools/golden/`) and emitting G17 round-trip doubles. **Result: bit-identical** —
Earth@J2000 worst relative error vs C# is `0.000e+0` on this machine; the Vitest pin keeps
a `1e-9` tolerance for cross-machine libm robustness.

### SD-4 — Reuse the canonical dataset by symlink (no copy)
**Status: ACCEPTED.** `data/system.json` is a relative symlink to the Godot project's file.
Honors "same file, no copy". Vite `server.fs.allow` is widened to read the symlink target.
Trade-off: the spike depends on the Godot tree being present (documented in README).

### SD-5 — Floating origin + per-preset log-compression in the orrery
**Status: ACCEPTED.** Mirrors `render/Orrery.cs`. Positions come from the f64 ephemeris in
metres; the focused body is subtracted **before** casting to f32 scene units (precision
survives at solar-system scale). A per-preset radial log-fold `logScale·ln(1+d/logK)` is
applied **after** rebase so LEO/GEO rings and the Earth↔Mars span both read in one view.
The fold is a visual lie only — it never feeds distance/light-delay math. Bodies are
constant-screen-size dithered billboards (Bayer 4×4 terminator stipple).

### SD-6 — Presets are data; WM is a constrained zone-grid (DD-10), Swap + Resize wired
**Status: ACCEPTED.** `zonegrid.ts` reduces `SignalHorizon.Sim.Wm.ZoneGrid` (1–3 cols ×
1–3 rows, one panel-or-tab-group per zone, relative weights, Clone-Mutate-Validate). Of the
full op set, the spike wires the two interactions the brief calls for — **title-bar drag →
Swap** and **edge-resize** — plus the always-tiled `validate()` gate. Tab/Split/Close exist
in the data shape but are not gesture-wired in the spike. Presets (OVERVIEW, OPS, +3) are
authoring data compiled to grids; switching is one keystroke.

### SD-7 — Sim clock is an f64 accumulator (no fixed-tick determinism in the spike)
**Status: ACCEPTED.** The real sim uses an integer fixed-step tick for bit-determinism
(save/replay). The spike has no determinism requirement (no backend, no save/load), so the
clock accumulates f64 sim-seconds directly, clamped against frame-time spikes. The packet
and the light-delay readout both read this one clock, so the crawl and the readout cannot
drift. Fixed-tick would be a straightforward addition if the backend is ported.

### SD-8 — SYSTEM.LOG: real packet events + a scripted severity feed
**Status: ACCEPTED.** Packet launch/arrival and the genuine line-of-sight occult are real
(sim-time accurate). Real solar conjunction is far rarer than a session, so the log is also
fed a deterministic, sim-time-paced flavour stream that exercises every severity — exactly
the "fake log lines timed to sim events" the brief asks for.

### SD-9 — Verify in headful ungoogled-chromium via Playwright (+ MCP)
**Status: ACCEPTED.** `tools/shoot.mjs` drives the user's ungoogled-chromium (148) through
`playwright-core` for headful, real-GPU screenshots. A Playwright **MCP** server is also
registered in the parent `.mcp.json` for interactive driving (loads on Claude Code restart).
