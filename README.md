# Signal Horizon — TypeScript / Three.js

A satellite & information-network tycoon simulation. The product you sell is *knowledge moved across distance*; the speed of light is the hardest constraint.

Runs in the browser. See [`FINDINGS.md`](./FINDINGS.md) for the spike verdict and [`docs/`](./docs/) for the full design and engineering documentation.

---

## Run it

```bash
npm install
npm run dev          # Vite dev server → http://localhost:5173
```

For a bare, OS-chrome-free window, press **F11** in the browser.

### Tests

```bash
npm test             # Vitest — pins the Kepler port against the C# golden master
```

### Typecheck

```bash
npx tsc --noEmit
```

### Headful screenshot helper (drives ungoogled-chromium via Playwright)

```bash
# node tools/shoot.mjs <url> <out.png> [waitMs] [keysCSV] [w] [h]
node tools/shoot.mjs http://localhost:5173 shot.png 3000 "o"     # press O → ORBITS camera, then shoot
```

Headful by default (real GPU); `HEADLESS=1` forces the software path for CI.

### Regenerate the C# golden master

```bash
cd tools/golden && dotnet run -c Release    # compiles the REAL Ephemeris.cs/OrbitalBody.cs
```

---

## Controls

| Key | Action |
|-----|--------|
| `1`–`5` | Switch WM preset (OVERVIEW, OPS, TRACK, STREAM, SPLIT) |
| `0` | Reset layout to the active preset (undo swaps/resizes) |
| `C` / `O` / `S` / `T` | Camera presets: CISLUNAR / ORBITS / SYSTEM / TOP-DOWN |
| `R` | Reset camera to the active preset framing |
| `F` / `Shift+F` | Cycle focused body (Sun→Earth→Mars→Moon) |
| `Space` | Pause / resume sim time |
| `,` / `.` | Time scale down / up (1× · 10× · 100× · 1000×) |
| drag title-bar | Swap two panels (zones only, always tiled) |
| drag gutter | Resize adjacent zones (relative weights) |
| drag in orrery | Orbit camera (azimuth/elevation); wheel zooms |

---

## Layout

```
src/
  sim/          pure truth layer (engine-agnostic, unit-tested)
    ephemeris.ts        faithful TS port of SignalHorizon.Sim/Ephemeris.cs (f64, 8-iter Newton, 3-1-3)
    ephemeris.test.ts   Vitest pin vs the C# golden master (bit-identical here)
    delay.ts            light delay (d / c) + freshness
    links.ts            line-of-sight / solar-occult geometry
    clock.ts            sim clock (sim-seconds, time scale, pause)
    mission.ts          Earth→Mars packet lifecycle + SYSTEM.LOG feed
    system-data.ts      loads data/system.json (symlink to the Godot dataset)
  wm/           DD-10 zone-grid tiling WM
    zonegrid.ts         model + always-tiled invariant + swap/resize + layout solver
    presets.ts          preset layouts as data
    shell.ts            DOM shell: drag-to-swap, edge-resize, preset switching
  orrery/
    orrery.ts           Three.js: floating origin, log-compression, dithered billboards,
                        dashed rings, light-speed packet, body-anchored camera + presets
  panels/
    log.ts              SYSTEM.LOG terminal (severity syntax highlighting)
    telemetry.ts        live readout (distance, light delay, freshness gauge)
    status.ts           always-visible bottom status strip
  dither.ts             runtime Bayer 4×4 dither tiles → CSS vars
  format.ts             sim-time / delay / distance formatting
  types.ts              shared FrameState / LogEntry / PacketState
  main.ts               wiring + render loop + keyboard
tools/
  golden/               throwaway C# tool that emits the golden master from the real sources
  shoot.mjs             Playwright (ungoogled-chromium) screenshot driver
data/system.json        → symlink to ../../../../Godot/galaxy-link/data/system.json
docs/                   backlog / decisions / GDD / specs / mockups / screenshots / progress
```

> Note: `data/system.json` is a symlink into the Godot tree. This project depends on that
> project being present at its path. That is intentional — the brief asked to use the
> *same* dataset, no copy.
