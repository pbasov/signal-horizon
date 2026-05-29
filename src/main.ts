/**
 * Entry point — builds the chrome scaffold, wires the sim → view loop, and routes
 * keyboard control. Everything runs on SIM time from one SimClock.
 *
 * Keys:  1–5 WM preset · 0 reset layout · C/O/S/T camera presets ·
 *        R reset camera · F cycle focus · Space pause · , / . time scale
 */
import "./style.css";
import { applyDither } from "./dither";
import { loadEphemeris } from "./sim/system-data";
import { SimClock } from "./sim/clock";
import { oneWaySeconds } from "./sim/delay";
import { earthMarsLos } from "./sim/links";
import { Mission } from "./sim/mission";
import { Shell, type PanelHandle } from "./wm/shell";
import { PRESET_SPECS, buildGrid } from "./wm/presets";
import { Orrery } from "./orrery/orrery";
import { SystemLog } from "./panels/log";
import { Telemetry } from "./panels/telemetry";
import { StatusStrip } from "./panels/status";
import type { FrameState } from "./types";

applyDither();

// --- chrome scaffold --------------------------------------------------------
const app = document.getElementById("app")!;

const topbar = document.createElement("div");
topbar.className = "topbar";
topbar.innerHTML =
  `<span class="brand">◆ SIGNAL HORIZON</span>` +
  `<span>· ts/three.js</span>` +
  `<span class="spacer"></span>` +
  `<span class="hint">F11 fullscreen · drag title-bars to swap · drag gutters to resize</span>` +
  `<span class="win-glyphs"><span>●</span><span>⛶</span><span>✕</span></span>`;

const wmCanvas = document.createElement("div");
wmCanvas.className = "wm-canvas";

const status = new StatusStrip();

app.append(topbar, wmCanvas, status.element);

// --- sim --------------------------------------------------------------------
const eph = loadEphemeris();
const clock = new SimClock();
const mission = new Mission(eph);

// --- orrery + panels --------------------------------------------------------
const orrery = new Orrery({
  eph,
  now: () => clock.seconds,
  packet: () => {
    const p = mission.packet;
    return p ? { fromId: p.fromId, toId: p.toId, progress: p.progress, freshness: p.freshness } : null;
  },
});

const log = new SystemLog();
const telemetry = new Telemetry();

// Latest Earth→Mars line-of-sight state, refreshed each frame — drives the orrery
// titlebar lamp (it is the panel drawing the blocked link).
let lastOcculted = false;

const orreryHandle: PanelHandle = {
  title: "ORRERY",
  content: orrery.host,
  subtitle: () => `· ${orrery.subtitle()}`,
  status: () => (lastOcculted ? "crit" : "ok"),
  onResize: (w, h) => orrery.resize(w, h),
};

const registry = new Map<string, PanelHandle>([
  ["orrery", orreryHandle],
  ["system-log", log],
  ["telemetry", telemetry],
]);

const shell = new Shell(wmCanvas, registry);

// --- WM presets -------------------------------------------------------------
const presets = PRESET_SPECS.map((spec) => ({ name: spec.name, grid: buildGrid(spec) }));
let wmPresetName = presets[0].name;

function setWmPreset(i: number): void {
  if (i < 0 || i >= presets.length) return;
  wmPresetName = presets[i].name;
  shell.setPreset(presets[i].name, presets[i].grid);
}

status.setPresetTabs(presets.map((p) => p.name));
setWmPreset(0); // OVERVIEW

// initial boot log
for (const e of mission.update(clock.seconds)) log.append(e);

// --- keyboard ---------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key;
  if (k >= "1" && k <= "5") setWmPreset(Number(k) - 1);
  else if (k === "0") shell.reset();
  else if (k === "c" || k === "C") orrery.setPreset(0);
  else if (k === "o" || k === "O") orrery.setPreset(1);
  else if (k === "s" || k === "S") orrery.setPreset(2);
  else if (k === "t" || k === "T") orrery.setPreset(3);
  else if (k === "r" || k === "R") orrery.resetCamera();
  else if (k === "f") orrery.cycleFocus(1);
  else if (k === "F") orrery.cycleFocus(-1);
  else if (k === " ") {
    e.preventDefault();
    clock.togglePause();
  } else if (k === ",") clock.slower();
  else if (k === ".") clock.faster();
});

// --- main loop --------------------------------------------------------------
let last = performance.now();

function frame(now: number): void {
  const dt = (now - last) / 1000;
  last = now;

  clock.advance(dt);
  const t = clock.seconds;

  for (const e of mission.update(t)) log.append(e);

  const dist = eph.distanceBetween("earth", "mars", t);
  const ow = oneWaySeconds(dist);
  const los = earthMarsLos(eph, t);
  lastOcculted = los.occulted;

  const fs: FrameState = {
    simSeconds: t,
    scaleLabel: clock.scaleLabel,
    paused: clock.paused,
    wmPreset: wmPresetName,
    cameraPreset: orrery.presetName(),
    focusBody: orrery.focusId,
    earthMarsDistanceM: dist,
    oneWaySeconds: ow,
    losMarginSolarRadii: los.marginSolarRadii,
    losOcculted: los.occulted,
    packet: mission.packet,
  };

  telemetry.update(fs);
  status.update(fs);
  orrery.update(dt);
  shell.tickChrome();

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);
