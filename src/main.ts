/**
 * Entry point — builds the chrome scaffold, wires the sim → view loop, and routes
 * keyboard control. Everything runs on SIM time from one SimClock.
 *
 * Keys:  1–5 WM preset · 0 reset layout · C/O/S/T camera presets ·
 *        R reset camera · F cycle focus · Space pause · , / . time scale ·
 *        P prefetch (pre-position fresh data into the Mars cache)
 *
 * ACTION LOG (E3 / M1-06): every player input that mutates the deterministic sim
 * — pause, faster, slower (recorded as set_time_scale) and prefetch — is appended
 * to a live {@link SaveGame} action log at the CURRENT clock tick. The log is the
 * "inputs, not outputs" record that makes this session reproducible: replaying
 * seed + dt + this action log re-derives the exact balance/cache/fetch state.
 */
import "./style.css";
import { applyDither } from "./dither";
import { loadEphemeris } from "./sim/system-data";
import { SimClock, DT } from "./sim/clock";
import { oneWaySeconds } from "./sim/delay";
import { earthMarsLos } from "./sim/links";
import { Mission } from "./sim/mission";
import { M1Session, type SessionRenderState } from "./sim/m1/session";
import { saveGame, addAction } from "./sim/save";
import { setTimeScale, prefetch as prefetchAction, setPrefetchPolicy } from "./sim/action";
import { applySessionAction } from "./sim/m1/apply-action";
import type { PrefetchMode } from "./sim/m1/policy";
import { Shell, type PanelHandle } from "./wm/shell";
import { PRESET_SPECS, buildGrid } from "./wm/presets";
import { Orrery } from "./orrery/orrery";
import { deriveReadout } from "./orrery/readout";
import { CueBus, AudioCue, emitCueTransition, type CueDemandSlice } from "./audio/cue";
import { SystemLog } from "./panels/log";
import { Telemetry } from "./panels/telemetry";
import { Finance } from "./panels/finance";
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
// The standing Mars-imagery demand: drives the live cache-miss→fetch→arrive→hit
// loop. When it starts a fetch, we launch the Mission packet to render the wait.
const session = new M1Session();
// Latest render-facing resolve state; refreshed by tickSim() each fixed tick. The
// boot tickSim(clock.seconds) below runs the FIRST real step and overwrites this;
// the placeholder is just a well-typed idle roster (no serves, empty cache) so the
// panels have a shape to read before the first frame, with NO premature step.
let demand: SessionRenderState = {
  feeds: session.feeds.map((f) => ({
    id: f.id,
    datasetId: f.datasetId,
    outcome: "miss" as const,
    viaCache: false,
    cacheFreshness: 0,
    fetchInFlight: false,
    fetchCountdownSeconds: null,
    blackout: false,
    servedAgeSeconds: null,
    freshnessPremium: f.price(f.freshFreshness) - f.price(f.minAcceptableFreshness),
  })),
  slotsUsed: 0,
  slotCapacity: session.cache.capacity,
  balance: session.economy.balance,
  revenueRatePerSecond: 0,
  opexRatePerSecond: session.opexRatePerSecond(),
  netRatePerSecond: -session.opexRatePerSecond(),
  runway: session.economy.runway(session.opexRatePerSecond()),
  bankrupt: false,
  fetchesInFlight: 0,
  peakCacheFreshness: 0,
  policyMode: session.policy.mode,
  policyFloor: session.policy.freshnessFloor,
  autoPrefetched: [],
  autoBlackoutPrestage: false,
};

// --- action log -------------------------------------------------------------
// The live, deterministic record of player input. Seed is a fixed determinism
// anchor (the M1 session draws no RNG yet, but the log mirrors the save format).
// dt is the clock's fixed timestep; actions are appended at the current tick.
const SEED = 1n;
const save = saveGame(SEED, DT, { system: "data/system.json" });
// Track the last time-scale we recorded so we only log genuine CHANGES.
let lastScale = clock.scale;

/** Record a set_time_scale action at the current tick after a clock mutation. */
function recordScale(): void {
  const s = clock.scale; // 0 while paused, else TIME_SCALES[scaleIndex]
  if (s === lastScale) return;
  lastScale = s;
  addAction(save, setTimeScale(s, clock.tick));
}

/** The policy modes in cycle order for the 'a' key (manual → freshness → blackout). */
const POLICY_CYCLE: PrefetchMode[] = ["manual", "freshness", "freshness_blackout"];

/**
 * E8 — apply + LOG a prefetch-policy change at the current tick. The policy CHANGE
 * is a player intent recorded as a SimAction; the autopilot's per-step prefetches
 * it drives are DERIVED inside step() and need no logging. Applied via the SHARED
 * applySessionAction so live + replay set the policy at the SAME tick.
 */
function applyPolicy(mode: PrefetchMode, floor: number): void {
  const p = session.policy;
  const action = setPrefetchPolicy(mode, floor, p.blackoutLeadS, p.maxConcurrentAuto, clock.tick);
  applySessionAction(eph, session, action, DT);
  addAction(save, action);
}

// --- audio (M1-11) ----------------------------------------------------------
// The one-way cue bus: tickSim (orchestration, NOT the pure sim) emits semantic
// cues on demand-state transitions; the frame loop drains them into AudioCue.
// src/sim stays Web-Audio-free — the bus and synth both live in src/audio.
const cueBus = new CueBus();
const audio = new AudioCue();
audio.armUnlock(); // create + resume the AudioContext on the first gesture.
// Prior demand slice for edge detection (a cache hit / arrival is a TRANSITION).
let prevCue: CueDemandSlice | null = null;

/**
 * One fixed sim tick at time t: drive the Mission (packet crawl + log), then the
 * standing demand (the cache loop). When the demand STARTS a fetch (a miss) and
 * no packet is in flight, launch the Mission packet so its crawl IS the visible
 * wait. Mission and session share the same one-way ETA, so they stay in lockstep.
 *
 * AUDIO: after the pure step, derive any cue from the demand transition and push
 * it onto the one-way bus (drained by the frame loop). The sim never sees audio.
 */
function tickSim(t: number): void {
  for (const e of mission.update(t)) log.append(e);
  demand = session.step(eph, t);
  // The Mission's single Earth→Mars packet represents the AGGREGATE in-flight
  // wait (all feeds share the same geometry); the orrery draws a packet PER feed
  // in flight from the per-feed readout. Launch the log/telemetry packet whenever
  // any leg is crawling and none is shown.
  if (demand.fetchesInFlight > 0 && mission.packet === null) {
    for (const e of mission.launch(t)) log.append(e);
  }
  // Audio reads an AGGREGATE slice across the roster: a fetch is "in flight" if
  // ANY feed is fetching; a serve is "via cache" if ANY feed hit; the outcome is
  // the worst live band (blackout > miss > stale > fresh) so the network SOUNDS
  // as bad as its weakest-served feed.
  const slice: CueDemandSlice = aggregateCueSlice(demand);
  emitCueTransition(cueBus, prevCue, slice, t);
  prevCue = slice;
  // E8 — a subtle audible cue when the autopilot PRE-STAGES ahead of a forecast
  // blackout (the tame-it lever acting): the relief you can hear. Only on the
  // firing step (autoBlackoutPrestage is set by that step's selectAutoPrefetches).
  if (demand.autoBlackoutPrestage) cueBus.emit("prestage", t);
}

/** Worst-band-wins aggregate of the roster for the audio cue channel. */
function aggregateCueSlice(d: SessionRenderState): CueDemandSlice {
  const rank: Record<string, number> = { fresh: 0, stale: 1, miss: 2, blackout_miss: 3 };
  let worst: CueDemandSlice["outcome"] = "fresh";
  let anyFetch = false;
  let anyCache = false;
  for (const f of d.feeds) {
    if (f.fetchInFlight) anyFetch = true;
    if (f.viaCache) anyCache = true;
    if (rank[f.outcome] > rank[worst]) worst = f.outcome;
  }
  return { fetchInFlight: anyFetch, viaCache: anyCache, outcome: worst };
}

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
const finance = new Finance();

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
  ["finance", finance],
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

// initial boot: mission boot triplet + first demand evaluation (may launch a packet)
tickSim(clock.seconds);

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
    recordScale(); // pause/unpause is a set_time_scale (0 ↔ current scale)
  } else if (k === ",") {
    clock.slower();
    recordScale();
  } else if (k === ".") {
    clock.faster();
    recordScale();
  } else if (k === "p" || k === "P") {
    // M1-06 PREFETCH: pre-position fresh data into the Mars cache, charged the
    // one-shot prefetch cost. POST-DRAIN, at the current clock tick — the SAME
    // ordering the replay driver uses (apply the action AFTER step(at_tick)), via
    // the shared applySessionAction so live and replay cannot drift. Gated to one
    // fetch in flight; only RECORD the action when it actually launches (so the
    // replay charges exactly once too).
    const action = prefetchAction(clock.tick);
    if (applySessionAction(eph, session, action, DT)) {
      addAction(save, action);
      // The prefetch IS the visible wait: launch the Mission packet to crawl it.
      if (mission.packet === null) {
        for (const ev of mission.launch(clock.seconds)) log.append(ev);
      }
    }
  } else if (k === "a" || k === "A") {
    // E8 — CYCLE the prefetch policy mode: manual → freshness → freshness_blackout
    // → manual. Switching it on is the tame-it lever: the autopilot takes over the
    // hand-cranking. The change is the logged player intent.
    const i = POLICY_CYCLE.indexOf(session.policy.mode);
    const next = POLICY_CYCLE[(i + 1) % POLICY_CYCLE.length];
    applyPolicy(next, session.policy.freshnessFloor);
  } else if (k === "[") {
    // E8 — lower the autopilot's freshness floor (−0.05, clamped to [0, 0.95]).
    applyPolicy(session.policy.mode, clamp01floor(session.policy.freshnessFloor - 0.05));
  } else if (k === "]") {
    // E8 — raise the autopilot's freshness floor (+0.05, clamped to [0, 0.95]).
    applyPolicy(session.policy.mode, clamp01floor(session.policy.freshnessFloor + 0.05));
  }
});

/** Clamp a freshness floor to [0, 0.95] (the UI-tunable range), rounded to a step. */
function clamp01floor(f: number): number {
  return Math.max(0, Math.min(0.95, Math.round(f * 100) / 100));
}

// --- main loop --------------------------------------------------------------
let last = performance.now();

function frame(now: number): void {
  const wallDt = (now - last) / 1000;
  last = now;
  // Fixed-tick drain: schedule wall time, then run all owed sim ticks.
  clock.scheduleWall(wallDt);
  while (clock.nextTick() !== null) {
    tickSim(clock.seconds);
  }

  // Render at the latest sim time (interpolation deferred — analytic Kepler
  // means position(t) is exact for any t, so no visual error from using the
  // last tick boundary).
  const t = clock.seconds;
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
    demand: {
      feeds: demand.feeds.map((f) => ({
        id: f.id,
        outcome: f.outcome,
        viaCache: f.viaCache,
        cacheFreshness: f.cacheFreshness,
        fetchInFlight: f.fetchInFlight,
        fetchCountdownSeconds: f.fetchCountdownSeconds,
        blackout: f.blackout,
        servedAgeSeconds: f.servedAgeSeconds,
        freshnessPremium: f.freshnessPremium,
      })),
      slotsUsed: demand.slotsUsed,
      slotCapacity: demand.slotCapacity,
      peakCacheFreshness: demand.peakCacheFreshness,
      fetchesInFlight: demand.fetchesInFlight,
      balance: demand.balance,
      revenueRatePerSecond: demand.revenueRatePerSecond,
      opexRatePerSecond: demand.opexRatePerSecond,
      netRatePerSecond: demand.netRatePerSecond,
      runway: demand.runway,
      bankrupt: demand.bankrupt,
      policyMode: demand.policyMode,
      policyFloor: demand.policyFloor,
      autoPrefetched: demand.autoPrefetched,
      autoBlackoutPrestage: demand.autoBlackoutPrestage,
    },
  };

  telemetry.update(fs);
  finance.update(fs);
  status.update(fs);
  // Feed the glanceable readout (M1-10) + freshness-as-saturation, then render.
  orrery.setReadout(deriveReadout(fs));
  orrery.update(wallDt);
  shell.tickChrome();
  // Drain the one-way cue bus into the synth (no-op until a gesture unlocks audio).
  audio.pump(cueBus);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);