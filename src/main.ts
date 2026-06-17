/**
 * Entry point — builds the chrome scaffold, wires the sim → view loop, and routes
 * keyboard control. Everything runs on SIM time from one SimClock.
 *
 * Keys:  1–3 WM preset (1 PLAY · 2 MAP · 3 REVIEW) · 0 reset layout · click a rail button
 *        (right edge) to SUMMON any panel into the focused tile · E/C/O/S/T camera
 *        presets (E = EARTH near-body, the boot default) · click a body/asset to focus
 *        + select it · R reset camera · F cycle focus · Space pause · , / . time scale
 *        (boots at 1× — the PLAYER drives the acceleration, GDD §3/Risk-6) ·
 *        P prefetch (pre-position fresh data into the Mars cache) · A policy ·
 *        [ ] floor · G toggle THE PARSE (the §4.12 reviewable-at-rest record) ·
 *        H toggle the COVERAGE HEATMAP · D cycle its dimension (M2b) ·
 *        B deploy a ground station · L launch a satellite · ; cycle launch preset
 *        (M2c — the build-the-monument loop: the heatmap reads the LIVE roster) ·
 *        N cycle the selected contract · K accept it · J decline it
 *        (M2d — contracts + coverage revenue: serve a region's coverage to EARN €) ·
 *        M place an orbital datacenter · ' cycle its site
 *        (M3a — compute as infrastructure: a DC's power+thermal-limited compute force-
 *        multiplies the served revenue of contracts in its edge-compute footprint, §4.5)
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
import { SCENARIO, missionElapsedSeconds } from "./sim/m1/scenario";
import { parseRun, type RunContext } from "./sim/m1/parse";
import { OPENING_BALANCE } from "./sim/m1/economy";
import { conjunctionApproach } from "./orrery/readout";
import { saveGame, addAction } from "./sim/save";
import {
  setTimeScale,
  prefetch as prefetchAction,
  setPrefetchPolicy,
  deployGround as deployGroundAction,
  launchSat as launchSatAction,
  acceptContract as acceptContractAction,
  declineContract as declineContractAction,
  placeDC as placeDCAction,
  netLaunch as netLaunchAction,
  netAccept as netAcceptAction,
  netSetPrefer as netSetPreferAction,
  netPlaceCache as netPlaceCacheAction,
  type SimAction,
} from "./sim/action";
import { applySessionAction } from "./sim/m1/apply-action";
import { applyBuildAction } from "./sim/m2/apply-build-action";
import { BuildSession } from "./sim/m2/session";
// net/ Act-1 — the connectivity game (design §5/§6). NetSession is the live mutable world
// (roster + REGION-0 contract + wallet + scenario cursor); applyNetAction is the SHARED
// applier live + replay use; the world planner gives the truthful consequence preview.
import { NetSession, NET_RNG_SEED } from "./sim/net/session";
import { applyNetAction } from "./sim/net/apply-action";
import {
  NET_PLANNER_PRESETS,
  previewLaunch,
  draftToSat,
  A1_BODY_RADIUS_M,
  A1_LEO_SEMI_MAJOR_M,
  A1_GEO_SEMI_MAJOR_M,
  NET_PRESETS,
  MARS_RELAY_PRESET,
  launchCost,
  launchCostBaseForPreset,
  type LaunchDraft,
  type PreviewWorld,
} from "./sim/net/world";
import { surfacePointRelative, NET_LINK_CAPACITY_UNITS } from "./sim/net/link-budget";
// §3 — the spin angle θ(t) so the operated-body graticule turns with the body (the SAME convention
// the surface frame + the orrery render-axis swap use). Pure scalar; render-only consumer.
import { earthThetaAt } from "./sim/net/frame";
import { bridgeForPoint, satPositionRelative, solve as routeSolve } from "./sim/net/router";
import { windowAvailability } from "./sim/net/availability";
import { suggestPhasing, phasingLadder } from "./sim/net/phasing";
// §7.3/§10 — the per-contract prefer slider mapping (the FIRST thing the player tunes): the pure
// slider-position ↔ prefer-weights map (lat↔bw↔stab) the planner control rides.
import { preferFromSliderPos, preferSliderPos, netRevenueRatePerSecond } from "./sim/net/contract";
import { ACT1_CONTRACT_ID, ACT2_CONTRACT_ID, ACT2_SLA_AVAIL, ACT2_ZERO_GAP_N } from "./sim/net/scenario";
import { ACT4_MARS_CONTRACT_ID } from "./sim/net/endpoint";
import { interBodyOneWayLatencyS } from "./sim/net/link-budget";
// net/ Act-3b — the pure SYSTEM.LOG renderers for the fault SYSTEM.LOG lines + the predictability-
// seed loss stamp (the trace's verbatim wording). Render-only; the sim owns the fault state.
import { renderFaultLine, renderLossStamp } from "./sim/net/trace";
// net/ Act-3b P2 — the LIVE telegraphed countdown + the permanent-drop predicate (the §5 watch-and-
// act readout). Pure time reads of the sim's folded fault state; render-only (no golden).
import { telegraphedCountdownRemainingS, faultRemovesSatAt } from "./sim/net/fault-types";
import { NetPlanner, NetLaunch, NetContracts, NetPrefer, type NetPlannerRenderState, type NetObjective, type NetContractRow } from "./panels/net-planner";
import { StatusBoard } from "./panels/status-board";
import { CoverageRoster, type CoverageRosterState } from "./panels/coverage-roster";
import { LinkLoad, type LinkLoadState } from "./panels/link-load";
import { Howto } from "./panels/howto";
import { LAUNCH_PRESETS } from "./sim/m2/launch";
import { orbitPeriodSeconds, solveOrbit } from "./sim/m2/orbit";
import { CANDIDATE_SITES } from "./sim/m2/sites";
import { DC_CANDIDATES } from "./sim/m3/dc-sites";
import { resolveDCCompute, computeLiftMultiplier } from "./sim/m3/datacenter";
import { latLonToUnit } from "./sim/coverage/grid";
import { GeodesicGrid } from "./sim/coverage/grid";
import { scoreCoverageAt } from "./sim/coverage/score";
import type { Vec3 } from "./sim/ephemeris";
import type { BuildRenderState } from "./orrery/orrery";
import {
  deriveFleet,
  type Fleet,
  type FleetDatasetSat,
  type FleetRosterSat,
} from "./sim/m2/fleet";
import type { PrefetchMode } from "./sim/m1/policy";
import { Shell, type PanelHandle } from "./wm/shell";
import { PRESET_SPECS, NET_PRESET_SPECS, buildGrid } from "./wm/presets";
import { WindowRail, RAIL_PANELS, NET_RAIL_PANELS } from "./wm/window-rail";
import { Orrery } from "./orrery/orrery";
import { deriveReadout } from "./orrery/readout";
import { CueBus, AudioCue, emitCueTransition, type CueDemandSlice } from "./audio/cue";
import { SystemLog } from "./panels/log";
import { Telemetry } from "./panels/telemetry";
import { Finance } from "./panels/finance";
import { ParsePanel } from "./panels/parse";
import { Contracts } from "./panels/contracts";
import { FleetPanel } from "./panels/fleet";
import { StatusStrip } from "./panels/status";
// net/ M1 — the ONBOARDING briefing popups (the UX-cold floor): one dismissible 1-bit info card per
// CORE CONCEPT, fired off the scenario beats (act1 at the cold open; the rest when the cursor reaches
// them). Render/UI only — no sim math, net mode ONLY. See drainNetOnboarding below for the trigger.
import { Onboarding, type OnboardingConcept } from "./panels/onboarding";
import type { ContractReadout, ContractsRenderState, FrameState, NetEconomy } from "./types";

applyDither();

// --- chrome scaffold --------------------------------------------------------
const app = document.getElementById("app")!;

const topbar = document.createElement("div");
topbar.className = "topbar";
topbar.innerHTML =
  `<span class="brand">◆ SIGNAL HORIZON</span>` +
  `<span>· ts/three.js</span>` +
  `<span class="spacer"></span>` +
  `<span class="hint">F11 fullscreen · click the right rail to summon a panel · drag title-bars to swap · drag gutters to resize</span>` +
  `<span class="win-glyphs"><span>●</span><span>⛶</span><span>✕</span></span>`;

const wmCanvas = document.createElement("div");
wmCanvas.className = "wm-canvas";

// APP MODE — resolved up-front (the single source of truth, read by the chrome + the sim wiring
// below). Act 1 (net) is what BOOTS (the cold player sees + plays the connectivity game); the
// M1-cache / M2 / M3 wiring stays instantiable behind ?mode=cache. The status strip's key-hint
// legend + cells must match the active game, so it needs netMode at construction time (fix #2).
type AppMode = "net" | "cache";
const NET_QUERY = new URLSearchParams(window.location.search);
const APP_MODE: AppMode = NET_QUERY.get("mode") === "cache" ? "cache" : "net";
const netMode = APP_MODE === "net";

const status = new StatusStrip(netMode);

app.append(topbar, wmCanvas, status.element);

// --- sim --------------------------------------------------------------------
const eph = loadEphemeris();
const clock = new SimClock();
// E10b — BOOT AT THE SCENARIO EPOCH. The sim clock IS ephemeris time; the M1
// scenario starts ≈10.87 days before the real Earth↔Mars conjunction so the whole
// strain → relief → approach → BLACKOUT arc fits a ~30-min sitting (GDD §9). The
// readout shows MISSION-ELAPSED time (missionElapsedSeconds), so the clock reads
// 0d at boot despite the non-zero J2000 epoch. See sim/m1/scenario.ts.
clock.setTick(SCENARIO.tick0);
// THE PLAYER CONTROLS THE CLOCK — BOOT AT 1× (real-time), NOT THE 1000× SCENARIO LOCK.
// Per GDD §3/Risk-6 the waiting must BE gameplay the PLAYER drives, not a time-accel
// slider they watch: dropping the player into 1000× made the game read as a screensaver
// (the owner's "scale is locked at 1000% — I want to control the speed myself"). We boot
// at 1× so the player is in control from t=0; , / . cycle the full 1×…1000× range and
// Space pauses, with the live scale shown in the status strip. (The M1 scenario EPOCH
// boot above is unchanged — only the SCALE lock is removed; a passive player is now
// nudged toward the speed keys by the foreshadow NOTICE, not force-accelerated.)
//
// This is a LIVE-ONLY setting. The replay harness starts at t=0 with its OWN scale
// handling (it drives ticks directly, not via this clock's scaleIndex), so BOTH replay
// goldens (M1 544847093270497462n, M2 8431658617016421069n) are unaffected — confirmed
// by the replay tests. SCENARIO.defaultScaleIndex is left in the scenario data for the
// foreshadow nudge's messaging; it no longer drives the boot scale.
clock.scaleIndex = 0; // TIME_SCALES[0] === 1× (real-time).
const mission = new Mission(eph);
// The standing Mars-imagery demand: drives the live cache-miss→fetch→arrive→hit
// loop. When it starts a fetch, we launch the Mission packet to render the wait.
const session = new M1Session();

// --- M2c — the BUILD SESSION (the build-the-monument loop) ------------------
// The placeable-asset roster + € wallet + launch PRNG. A SEPARATE deterministic
// world from the M1 cache session (its own snapshot/golden), driven by logged
// deploy/launch actions. The coverage heatmap (M2b) now reads THIS live roster, so
// deploying a ground station / launching a sat grows the coverage web (§1/§5 the
// monument). The covered-demand SCORE is computed from the same pure roster so the
// readout rises as you build. f64→f32 happens only in the orrery; main.ts hands the
// orrery f64 world positions + the pure score.
const build = new BuildSession();

// --- net/ Act-1 — THE NET SESSION (the connectivity game, design §5/§6) ------
// The live mutable connectivity world: the launched-sat roster + the scenario-emitted
// REGION-0 contract + a € wallet + the seeded splitmix64 + the scenario cursor. A SEPARATE
// deterministic world from the M1 cache session AND the M2 build session (its own snapshot +
// its own golden 10424955607522567073n), driven by logged net_launch/net_accept actions
// applied via the SHARED applyNetAction in the SAME step-then-post-drain order the M2 build
// session uses. Seeded with NET_RNG_SEED (4242424242424242n) so the live world == the golden.
const netSession = new NetSession(undefined, NET_RNG_SEED);
// APP MODE is resolved up-front near the chrome scaffold (the single source of truth: `APP_MODE`
// / `netMode` / `NET_QUERY`). Act 1 (net) is what BOOTS; the M1-cache / M2 / M3 wiring stays
// instantiable behind ?mode=cache (the live loop drives whichever world is active; net mode also
// flips orrery.netRenderMode so the toy globe is visible). The net session is ALWAYS stepped so
// the scenario emits + the loop is live the instant the mode is entered.
// net/ Act-4 — DEBUG-ONLY view seed (the headless-screenshot affordance, design §4.5 / §8). A
// `?netview=mars` (or `?netact=4`) query param asks the BOOT to seed the live net session straight
// at the act4 Mars state (the Mars opportunity on the board + the MARS RELAY launched + a Mars
// sample present) so a screenshot can reach the Mars VIEW WITHOUT driving the full ~460 s gated arc.
// FOR VISUAL INSPECTION ONLY — it is a main.ts BOOT-TIME RENDER HOOK on the LIVE session, NOT a
// sim/action/replay path: the replay harness builds its OWN NetSession from the golden action log
// and never reads this param, so the three goldens are PROVABLY untouched. Never reached in normal
// play (the param is absent). Labelled DEBUG in SYSTEM.LOG so it can never be mistaken for real play.
const netDebugView = netMode && (NET_QUERY.get("netview") === "mars" || NET_QUERY.get("netact") === "4");
// P1 (GDD §5) — DEBUG-ONLY view seed for THE LIVE NETWORK (the headless-screenshot affordance): a
// `?netview=net` (or `?netact=3`) query param drives the live session to a MULTI-SAT served state (the
// parked GEO over REGION-0 + the N=4 LEO_SWEEP constellation over REGION-1, escalation on) so a
// screenshot can show real region→sat→ground links — green→amber→red by utilisation + the hand-off
// re-route — WITHOUT driving the full gated arc. Same discipline as the Mars seed: public mutation
// surface only, NOT a sim/action/replay path (the replay harness builds its own session), so the
// three goldens are provably untouched. Never reached in normal play; DEBUG-labelled.
const netLiveDebugView = netMode && (NET_QUERY.get("netview") === "net" || NET_QUERY.get("netact") === "3");
// The selected planner preset cursor (GEO PARK default that already works; LEO SWEEP sweeps). The
// preset is the FLOOR (§3.1: one-click); it SETS the editable draft below. Dragging the draft is the
// CEILING. -1 ⇒ no preset matches the current (hand-dragged) draft, so no preset button lights.
let netPresetCursor = 0;

// §7.3/§10 — the per-contract PREFER control selection: the contract id the latency↔bandwidth↔
// stability slider currently tunes (null ⇒ auto-pick the first active contract each frame). The
// SELECT CONTRACT button cycles it across the active contracts; dragging the slider appends
// net_set_prefer for THIS contract → the router re-solves it → its path re-routes on the globe.
let netPreferContractId: string | null = null;

// §3.1 — THE EDITABLE PLANNER DRAFT (the make-or-break: presets are the floor, parameters are the
// ceiling). The player DRAGS altitude / inclination / phase / RAAN; each edit re-runs previewLaunch
// (the truthful consequence). Seeded from the GEO PARK preset (the default that parks over REGION-0);
// a preset click overwrites it wholesale, a slider/arrow nudges one field. RAAN starts undefined so
// an undragged launch stays byte-identical (golden-safe — see netLaunch wire).
let netDraft: LaunchDraft = cloneDraft(NET_PLANNER_PRESETS[0].draft);

/** §3.1 — the draggable bounds + nudge steps for the four planner parameters (radians + SI metres),
 * scoped to the toy world. Altitude rides from just above the toy surface (low LEO) past the GEO
 * radius (so the player can drag through the whole LEO→GEO axis — §2 "altitude is the first
 * parameter"); inclination 0..π (equatorial→polar→retrograde); phase + RAAN the full circle. */
const NET_DRAFT_BOUNDS = {
  semiMajorM: { min: A1_LEO_SEMI_MAJOR_M * 0.9, max: A1_GEO_SEMI_MAJOR_M * 1.15, step: A1_LEO_SEMI_MAJOR_M * 0.02 },
  incRad: { min: 0, max: Math.PI, step: Math.PI / 180 },
  subLonRad: { min: -Math.PI, max: Math.PI, step: Math.PI / 180 },
  raanRad: { min: -Math.PI, max: Math.PI, step: Math.PI / 180 },
} as const;

/** Deep-copy a {@link LaunchDraft} (the loadout antennas are copied so a preset re-seed never aliases
 * the preset's own loadout array). Pure. */
function cloneDraft(d: LaunchDraft): LaunchDraft {
  return {
    semiMajorM: d.semiMajorM,
    incRad: d.incRad,
    subLonRad: d.subLonRad,
    raanRad: d.raanRad,
    loadout: d.loadout.map((a) => ({ ...a })),
    count: d.count,
  };
}

/** Clamp `v` into `[min,max]`. */
function clampN(v: number, min: number, max: number): number {
  return v < min ? min : v > max ? max : v;
}

/** §3.1 — re-seed the editable draft FROM a preset (the floor): a one-click setter that overwrites
 * the whole draft, then lights that preset button. The player then drags from there (the ceiling). */
function netSelectPreset(presetId: string): void {
  const i = NET_PLANNER_PRESETS.findIndex((p) => p.id === presetId);
  if (i < 0) return;
  netPresetCursor = i;
  netDraft = cloneDraft(NET_PLANNER_PRESETS[i].draft);
}

/** §3.1 — EDIT one draft parameter (a slider set or an arrow-key nudge). The value is clamped to the
 * draggable bounds; editing clears the preset cursor unless the draft still matches a preset exactly
 * (so a hand-dragged orbit lights no preset — "you left the floor"). Each call mutates `netDraft`, so
 * the next netPlannerRenderState/netRenderState re-runs previewLaunch ⇒ the globe updates live. */
function netEditDraft(field: "semiMajorM" | "incRad" | "subLonRad" | "raanRad", value: number): void {
  const b = NET_DRAFT_BOUNDS[field];
  netDraft = { ...netDraft, [field]: clampN(value, b.min, b.max), loadout: netDraft.loadout };
  netPresetCursor = NET_PLANNER_PRESETS.findIndex((p) => draftMatchesPreset(netDraft, p.draft));
}

/** §3.1 — nudge a draft parameter by ±one step (the arrow-key ceiling control, for headless
 * drivability). `dir` is +1/−1. */
function netNudgeDraft(field: "semiMajorM" | "incRad" | "subLonRad" | "raanRad", dir: number): void {
  const b = NET_DRAFT_BOUNDS[field];
  const cur = field === "raanRad" ? (netDraft.raanRad ?? 0) : netDraft[field];
  netEditDraft(field, cur + dir * b.step);
}

/** §3.1 — map a planner-draft NUDGE KEY to its field+direction (the headless-drivable ceiling): the
 * arrows for the first-two-that-matter (altitude/inclination, §3.1) + the brackets for phase/RAAN.
 * Returns true iff `k` was a draft key (so the caller swallows it). The step is bigger than one
 * slider notch so a few presses visibly move the orbit on the globe (headless screenshots). */
function netDraftNudgeKey(k: string): boolean {
  // A coarse multi-step nudge so a handful of key presses visibly sweeps the orbit (vs a slider's
  // fine notch) — the headless driver reaches a clearly-different orbit in a few keystrokes.
  const STEP = 6;
  switch (k) {
    case "ArrowUp":
      netNudgeDraft("semiMajorM", STEP);
      return true;
    case "ArrowDown":
      netNudgeDraft("semiMajorM", -STEP);
      return true;
    case "ArrowRight":
      netNudgeDraft("incRad", STEP);
      return true;
    case "ArrowLeft":
      netNudgeDraft("incRad", -STEP);
      return true;
    case "]":
      netNudgeDraft("subLonRad", STEP);
      return true;
    case "[":
      netNudgeDraft("subLonRad", -STEP);
      return true;
    case "}":
      netNudgeDraft("raanRad", STEP);
      return true;
    case "{":
      netNudgeDraft("raanRad", -STEP);
      return true;
    default:
      return false;
  }
}

/** Does a draft's four orbit parameters match a preset's (within a hair)? Treats an undefined RAAN as
 * 0. Pure — used to light the active preset button only while the draft IS that preset (the floor). */
function draftMatchesPreset(d: LaunchDraft, p: LaunchDraft): boolean {
  const near = (a: number, b: number): boolean => Math.abs(a - b) < 1e-6;
  return (
    near(d.semiMajorM, p.semiMajorM) &&
    near(d.incRad, p.incRad) &&
    near(d.subLonRad, p.subLonRad) &&
    near(d.raanRad ?? 0, p.raanRad ?? 0)
  );
}
// The coverage grid (built once) for the live coverage score. Same default level as the
// session's internal grid, so cell ids align and scoring against the session's CURRENT
// (M2e dynamic) demand — read via build.demandField — is well-keyed. Pure reads; nothing
// here mutates sim state. Scratch positions grow with the roster.
const buildCoverageGrid = GeodesicGrid.build();
let buildScratchPos: Vec3[] = [];
// The candidate-site cursor: B cycles which candidate the next deploy targets, so a
// keyed/list deploy needs no globe-raycast (raycast placement is later polish).
let deploySiteCursor = 0;
// The launch-preset cursor: L launches into the selected preset; ; cycles it.
let launchPresetCursor = 0;
// M3a — the DC-site cursor: M places an orbital datacenter at the next candidate, ' cycles it.
// A keyed/list pick (no globe-raycast yet), mirroring the ground-station deploy cursor.
let dcSiteCursor = 0;
// M2d — the selected contract id (the accept/decline target). N cycles it among the
// live contracts; K accepts the selected offer; J declines it. Tracked by id (not
// index) so it survives the board changing as offers come + go.
let selectedContractId: string | null = null;

/**
 * M2c — build the orrery's per-frame {@link BuildRenderState}: the roster's pure
 * world positions + eirps (for the heatmap sweep + markers) and the live covered-
 * demand fraction (the monument readout). PURE reads of the build session; computed
 * here in main.ts (orchestration) so the orrery stays a thin painter and src/sim
 * stays render-free. Allocates only when the roster grows (scratch reuse).
 */
function buildRenderState(): BuildRenderState {
  const t = clock.seconds;
  buildScratchPos = build.worldPositions(eph, t, buildScratchPos);
  const eirps = build.roster.eirps();
  const earth = eph.position("earth", t);
  const earthR = eph.radiusMeters("earth");
  // M2e — score against the session's CURRENT (dynamic) demand, so the covered fraction
  // reflects the ESCALATION ENGINE's growth (it erodes as served regions outgrow the fixed
  // roster). buildCoverageDemand stays only as the BASELINE reference for the growth readout.
  const score = scoreCoverageAt(buildCoverageGrid, build.demandField, eirps, buildScratchPos, earth, earthR);
  const list = build.roster.list();
  // M3a — project each placed orbital DC into a render descriptor: its body sub-point world
  // position (rebased like a body in the orrery) + its resolved §4.5 power/thermal/compute and
  // the bounded force-multiplier its compute applies. PURE reads of the DC roster (f64 here;
  // f64→f32 stays in the orrery). A handful at most (Risk-5 — sparse strategic nodes).
  const dcs = build.dcRoster.list().map((d) => {
    const c = resolveDCCompute(eph, d, t);
    const center = eph.position(d.bodyId, t);
    const rM = eph.radiusMeters(d.bodyId);
    const u = latLonToUnit(d.subLatRad, d.subLonRad);
    const candidate = DC_CANDIDATES.find((cand) => cand.bodyId === d.bodyId && cand.subLatRad === d.subLatRad && cand.subLonRad === d.subLonRad);
    return {
      id: d.id,
      label: candidate?.label ?? d.bodyId.toUpperCase(),
      posM: [center[0] + u[0] * rM, center[1] + u[1] * rM, center[2] + u[2] * rM] as Vec3,
      distanceAU: c.distanceAU,
      powerW: c.powerW,
      rejectableHeatW: c.rejectableHeatW,
      computeUnits: c.computeUnits,
      thermalLimited: c.thermalLimited,
      liftMultiplier: computeLiftMultiplier(c.computeUnits),
    };
  });
  return {
    assets: list.map((a, i) => ({
      id: a.id,
      kind: a.kind,
      posM: buildScratchPos[i],
      eirp: eirps[i],
      // Hand a launched sat's Kepler elements to the orrery so it can draw the sat's
      // orbital-plane RING (fix #2). Pure read of the roster; the orrery samples the ring
      // from these once per roster change (never per frame). Ground stations have none.
      orbit: a.kind === "sat" ? a.orbit : undefined,
    })),
    datacenters: dcs,
    coveredDemandFraction: score.coveredDemandFraction,
    groundCount: build.roster.groundCount,
    satCount: build.roster.satCount,
    balanceEur: build.balance,
    bankrupt: build.bankrupt,
    totalDemand: build.demandField.total,
    baselineDemand: build.demandField.baselineTotal,
  };
}

// --- M-fleet — the FLEET tile render state (the focused body's constellation) ---
// The DATASET sats are the ephemeris bodies whose id carries the `sat_` convention
// (data/system.json's "satellites" section — sat_leo/sat_geo/sat_meo_*). Their orbital
// elements are read straight off the live Ephemeris OrbitalBody (a/e/inc/period), so the
// pure deriveFleet classifies them by altitude band exactly like a launched sat. Built
// ONCE (the dataset never changes mid-run) and cached — never per frame (X-02).
const FLEET_DATASET_SATS: FleetDatasetSat[] = eph
  .bodyIds()
  .filter((id) => id.startsWith("sat_"))
  .map((id) => {
    const b = eph.bodies.get(id)!;
    return {
      id,
      parentId: b.parent,
      aM: b.a,
      e: b.e,
      incRad: b.inc,
      periodS: b.periodSeconds(),
      parentRadiusM: eph.radiusMeters(b.parent),
    };
  });

/**
 * M-fleet — build the FLEET panel's per-frame {@link Fleet}: SELECT the satellites
 * orbiting the orrery's FOCUSED body (SD-35 click-to-focus). The focused body is the
 * CLICK-SELECTED body when the selection is a real ephemeris body, else the camera
 * focus body — so clicking a body lists its fleet, and the camera focus is the default.
 * The launched roster sats are projected into the pure descriptor shape (their orbit +
 * EIRP); the dataset descriptors are the cached {@link FLEET_DATASET_SATS}. PURE reads of
 * the live roster + ephemeris — nothing here mutates sim state (render/read-only, both
 * replay goldens untouched). deriveFleet allocates only the rows it returns (small).
 */
function fleetRenderState(): Fleet {
  // The focused body: the selected id when it names a real body (a click-to-focus on a
  // body), else the camera focus body (always a body). A selected ASSET/DC is not a body,
  // so it falls back to the camera focus — the fleet always belongs to a body.
  const sel = orrery.selectedId;
  const bodyId = sel !== null && eph.hasBody(sel) ? sel : orrery.focusId;

  // Project the launched roster sats into the pure descriptor shape (orbit + EIRP). Ground
  // stations are not orbiting sats and are excluded. Reads the roster by value (no mutation).
  const rosterSats: FleetRosterSat[] = [];
  for (const a of build.roster.list()) {
    if (a.kind !== "sat") continue;
    const o = a.orbit;
    rosterSats.push({
      id: a.id,
      parentId: o.parentId,
      aM: o.aM,
      e: o.e,
      incRad: o.incRad,
      periodS: orbitPeriodSeconds(o),
      parentRadiusM: eph.radiusMeters(o.parentId),
      eirp: a.eirp,
    });
  }
  return deriveFleet(bodyId, FLEET_DATASET_SATS, rosterSats);
}

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

/**
 * M2c — DEPLOY a ground station at the selected candidate site, recorded + applied
 * via the SHARED applyBuildAction at the current tick (live + replay agree). Logs a
 * NOTICE line so the build is felt; advances the site cursor so the next B targets
 * the next candidate. The coverage web grows immediately (the heatmap reads the live
 * roster). Building can overspend — that is the build-vs-budget tension (§3/§4.9).
 */
function deployGroundStation(): void {
  const site = CANDIDATE_SITES[deploySiteCursor % CANDIDATE_SITES.length];
  const action = deployGroundAction(deploySiteCursor, clock.tick);
  const res = applyBuildAction(eph, build, action, DT);
  if (res && res.kind === "ground_deployed") {
    addAction(save, action);
    log.append({
      tSim: clock.seconds,
      sev: build.bankrupt ? "warn" : "info",
      entity: "DEPLOY",
      value: `−€${Math.round(res.costEur)}`,
      msg: `ground station over ${site.label} — coverage growing${build.bankrupt ? " (OVERSPENT)" : ""}`,
    });
    deploySiteCursor = (deploySiteCursor + 1) % CANDIDATE_SITES.length;
  }
}

/**
 * M2c — LAUNCH a satellite into the selected preset, recorded + applied via the
 * SHARED applyBuildAction at the current tick. The deterministic failure roll is
 * drawn inside the build session from the seeded PRNG, so the outcome replays. On
 * success the sat joins the roster + starts covering cells; on failure the € is
 * spent for nothing (the §4.7 launch risk). Always RECORDS the action (the launch
 * happened either way — the roll is what differs, and it replays from the log).
 */
function launchSatellite(): void {
  const preset = LAUNCH_PRESETS[launchPresetCursor % LAUNCH_PRESETS.length];
  const action = launchSatAction(preset.id, clock.tick);
  const res = applyBuildAction(eph, build, action, DT);
  if (res && (res.kind === "sat_launched" || res.kind === "launch_failed")) {
    addAction(save, action);
    const ok = res.kind === "sat_launched";
    log.append({
      tSim: clock.seconds,
      sev: ok ? "info" : "error",
      entity: "LAUNCH",
      value: `−€${Math.round(res.costEur)}`,
      msg: ok
        ? `${preset.label} reached orbit — coverage growing`
        : `${preset.label} FAILED on ascent — € lost, no sat`,
    });
  }
}

/**
 * M3a — PLACE an ORBITAL DATACENTER at the selected candidate site, recorded + applied via the
 * SHARED applyBuildAction at the current tick (live + replay agree). Charges the DC capex and
 * adds the strategic compute node; from then on it FORCE-MULTIPLIES the revenue of any contract
 * in its edge-compute footprint, bounded by its power+thermal-limited compute (GDD §4.5). Logs a
 * NOTICE so the build is felt + advances the cursor. A DC is a SMALL number of high-impact nodes
 * (Risk-5) — dear, sparse, and a real strategic choice of WHICH region to lift.
 */
function placeDatacenter(): void {
  const site = DC_CANDIDATES[dcSiteCursor % DC_CANDIDATES.length];
  const action = placeDCAction(dcSiteCursor, clock.tick);
  const res = applyBuildAction(eph, build, action, DT);
  if (res && res.kind === "datacenter_placed") {
    addAction(save, action);
    log.append({
      tSim: clock.seconds,
      sev: build.bankrupt ? "warn" : "info",
      entity: "DATACENTER",
      value: `−€${Math.round(res.costEur)}`,
      msg: `compute node over ${site.label} — edge compute lifts served revenue in its footprint${build.bankrupt ? " (OVERSPENT)" : ""}`,
    });
    dcSiteCursor = (dcSiteCursor + 1) % DC_CANDIDATES.length;
  }
}

/**
 * M2d — CYCLE the selected contract among the live (OFFERED + ACTIVE) ones, so the
 * accept/decline keys have a clear target. Pure UI bookkeeping (no sim mutation, no
 * logged action): selection is a live cursor, not part of the deterministic state.
 */
function cycleSelectedContract(dir: number): void {
  const live = build.contracts.filter((c) => c.state === "offered" || c.state === "active");
  if (live.length === 0) {
    selectedContractId = null;
    return;
  }
  const cur = live.findIndex((c) => c.id === selectedContractId);
  const next = ((cur < 0 ? 0 : cur + dir) % live.length + live.length) % live.length;
  selectedContractId = live[next].id;
}

/** M2d — resolve the current accept/decline target: the selected contract if it is
 * still OFFERED, else the first OFFERED contract (so K/J always act on something sane). */
function targetOfferedContract(): string | null {
  const sel = build.contracts.find((c) => c.id === selectedContractId);
  if (sel && sel.state === "offered") return sel.id;
  const firstOffer = build.contracts.find((c) => c.state === "offered");
  return firstOffer ? firstOffer.id : null;
}

/**
 * M2d — ACCEPT the targeted OFFERED contract: recorded + applied via the SHARED
 * applyBuildAction at the current tick (live + replay agree), moving it OFFERED →
 * ACTIVE so it starts accruing coverage revenue. Logs a NOTICE so the deal is felt.
 */
function acceptSelectedContract(): void {
  const id = targetOfferedContract();
  if (id === null) return;
  const action = acceptContractAction(id, clock.tick);
  const res = applyBuildAction(eph, build, action, DT);
  if (res && res.kind === "contract_accepted" && res.contract) {
    addAction(save, action);
    selectedContractId = id;
    const c = res.contract;
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "CONTRACT",
      value: `+€${Math.round(c.tariffPerSecond * 3600)}/hr`,
      msg: `accepted ${c.label} — serve the region to earn (term ${Math.round(c.termSeconds / 3600)}h)`,
    });
  }
}

/** M2d — DECLINE the targeted OFFERED contract: recorded + applied via the shared
 * applier at the current tick. The offer leaves the board (it was not taken). */
function declineSelectedContract(): void {
  const id = targetOfferedContract();
  if (id === null) return;
  const action = declineContractAction(id, clock.tick);
  const res = applyBuildAction(eph, build, action, DT);
  if (res && res.kind === "contract_declined" && res.contract) {
    addAction(save, action);
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "CONTRACT",
      msg: `declined ${res.contract.label} — offer retired`,
    });
  }
}

/**
 * M2d — build the CONTRACTS panel's per-frame {@link ContractsRenderState}: project the
 * build session's live contracts into render rows + the network earn summary. PURE reads
 * of the build session (the served fraction is the live roster coverage); computed here
 * in main.ts (orchestration) so the panel stays a thin painter. Allocates a small array
 * per frame (a handful of contracts) — only consumed while the panel is on screen.
 */
function contractsRenderState(): ContractsRenderState {
  const t = clock.seconds;
  const list = build.contracts;
  let offeredCount = 0;
  let activeCount = 0;
  let totalEarnedEur = 0;
  const contracts: ContractReadout[] = list.map((c) => {
    if (c.state === "offered") offeredCount++;
    else if (c.state === "active") activeCount++;
    totalEarnedEur += c.earnedEur;
    return {
      id: c.id,
      label: c.label,
      state: c.state,
      cellCount: c.cellIds.length,
      tariffPerSecond: c.tariffPerSecond,
      termSeconds: c.termSeconds,
      servedFraction: c.state === "active" ? c.lastServedFraction : 0,
      servedSecondsAccum: c.servedSecondsAccum,
      breachSecondsAccum: c.breachSecondsAccum,
      earnedEur: c.earnedEur,
      offerSecondsLeft: c.state === "offered" ? Math.max(0, c.offerExpiresAtS - t) : 0,
      selected: c.id === selectedContractId,
    };
  });
  return {
    contracts,
    offeredCount,
    activeCount,
    revenueRatePerSecond: build.contractRevenueRatePerSecond(eph, t),
    totalEarnedEur,
    balanceEur: build.balance,
  };
}

// --- net/ Act-1 — the live render-state projections + the launch/accept loop --

/** The world surface previewLaunch reads: the standing contracts (region + active axes) +
 * the ground-net endpoints. The NetSession satisfies {@link PreviewWorld} structurally. */
function netPreviewWorld(): PreviewWorld {
  return {
    contracts: netSession.contracts.map((c) => ({
      id: c.id,
      region: c.region,
      activeAxes: c.activeAxes,
    })),
    grounds: netSession.grounds,
  };
}

/**
 * net/ Act-1 — THE PER-ACT OBJECTIVE text (render-only, the "no clear goals" fix). Mirrors the m1
 * doc's per-act curriculum; the scenario cursor (act1→act2→act3a→act3b→act4) indexes it. NOT a sim
 * concept — pure UI copy keyed off the live cursor. Never invents goals beyond the doc's intent.
 */
const NET_OBJECTIVES: NetObjective[] = [
  { actLabel: "ACT 1", title: "Serve a region, get paid", detail: "On CONNECTIVITY (2): aim the orbit until the red gap reads WILL SERVE, press L to launch. Then ACCEPT the contract on BUSINESS (4) to start earning." },
  { actLabel: "ACT 2", title: "Hold a region that moves", detail: "A single sat drifts off and coverage gaps. On CONNECTIVITY (2), hit PLACE SET to launch an evenly-phased constellation so the region never drops." },
  { actLabel: "ACT 3", title: "Relieve the congested link", detail: "Your own success is overloading a shared sat (watch it redden on LINK·LOAD). On ROUTING (3) retune the PREFER slider — or launch more capacity — to clear it." },
  { actLabel: "ACT 3", title: "Weather the fault", detail: "A fault is telegraphed on the ROSTER. Launch a redundant sat on CONNECTIVITY (2) so the served region survives the outage." },
  { actLabel: "ACT 4", title: "The frontier", detail: "You've reached the edge — Mars, and the speed of light. To be continued." },
];

/** net/ Act-1 — the current OBJECTIVE for the planner's goal surface, indexed by the live cursor. */
function netObjectiveState(): NetObjective | null {
  const i = Math.max(0, Math.min(NET_OBJECTIVES.length - 1, netSession.cursor));
  return NET_OBJECTIVES[i] ?? null;
}

/** net/ Act-1 — render the ENFORCED SLA terms of a contract (only the axes in activeAxes), so Act 1
 * reads "connectivity" and later acts reveal avail/latency/bandwidth as the escalation adds them. */
function netContractTerms(c: (typeof netSession.contracts)[number]): string {
  const parts: string[] = [];
  const axes = c.activeAxes;
  if (axes.size === 0 || axes.has("connectivity")) parts.push("connectivity");
  if (axes.has("availability")) parts.push(`avail ≥ ${Math.round(c.slaAvail * 100)}%`);
  if (axes.has("latency")) parts.push(`≤ ${Math.round(c.slaLatencyS * 1000)} ms`);
  if (axes.has("bandwidth")) parts.push(`bw ≥ ${Math.round(c.slaBandwidth)}`);
  return parts.join(" · ");
}

/** net/ Act-1 — project ALL live net contracts into the planner's CONTRACTS view rows (the "clear
 * contracts view" fix). PURE reads of the session; the served flag comes from the live router solve. */
function netContractRows(t: number): NetContractRow[] {
  // PRICE-THE-BET preview reads the live roster once (pure — no sim mutation, no golden impact).
  const live = [...netSession.sats];
  const grounds = [...netSession.grounds];
  return netSession.contracts.map((c) => {
    const solve = netSession.lastSolveFor(c.id);
    // For an OFFERED contract, run a PURE preview solve against the CURRENT fleet so the player can
    // PRICE the bet: would accepting it serve right now, or take a known penalty risk on which axis?
    let previewServable: boolean | null = null;
    let previewBreachAxis: string | null = null;
    if (c.state === "offered") {
      const sv = routeSolve(eph, c, live, grounds, t);
      previewServable = sv.served;
      previewBreachAxis = sv.served ? null : sv.bindingConstraint;
      // The availability axis is ROLLING (not the instantaneous path-existence solve checks), so
      // verify it separately against the live constellation when it is an enforced axis (Act 2+).
      if (previewServable && c.activeAxes.has("availability")) {
        if (windowAvailability(eph, c, live, grounds, t) < c.slaAvail) {
          previewServable = false;
          previewBreachAxis = "availability";
        }
      }
    }
    return {
      id: c.id,
      label: c.label,
      state: c.state,
      terms: netContractTerms(c),
      rewardPerHr: c.payPerSecond * 3600,
      served: c.state === "active" && (solve?.served ?? false),
      servedFraction: c.lastServedFraction,
      progressFraction: c.termSeconds > 0 ? Math.min(1, c.servedSecondsAccum / c.termSeconds) : 0,
      earnedEur: c.earnedEur,
      penaltyPerHr: c.penaltyPerSecond * 3600,
      previewServable,
      previewBreachAxis,
      bindingReason:
        c.state === "active" && !(solve?.served ?? false) ? (solve?.bindingConstraint ?? "connectivity") : null,
    };
  });
}

/**
 * net/ Act-1 — project the live NetSession into the {@link NetEconomy} the FINANCE panel + STATUS
 * strip read in net mode: wallet, total earned, the live serve REVENUE rate (summed over active
 * contracts at their current served fraction), the offered/active counts, the sat roster size, and
 * the overspend flag. PURE reads of the net session (no sim mutation, no golden impact).
 */
function netEconomyState(): NetEconomy {
  let earnedEur = 0;
  let revenueRatePerSecond = 0;
  let activeContracts = 0;
  let offeredContracts = 0;
  for (const c of netSession.contracts) {
    earnedEur += c.earnedEur;
    if (c.state === "active") {
      activeContracts++;
      revenueRatePerSecond += netRevenueRatePerSecond(c, c.lastServedFraction);
    } else if (c.state === "offered") {
      offeredContracts++;
    }
  }
  return {
    balanceEur: netSession.balance,
    earnedEur,
    revenueRatePerSecond,
    activeContracts,
    offeredContracts,
    satCount: netSession.sats.length,
    bankrupt: netSession.balance < 0,
  };
}

/**
 * net/ A4 — build the LAUNCH PLANNER panel's per-frame {@link NetPlannerRenderState}: the
 * wallet, the REGION-0 contract (state + served + earned), the preset buttons, and the
 * TRUTHFUL consequence preview of the selected preset via the pure {@link previewLaunch}
 * (the SAME router + link budget the live world runs, so the preview == the post-commit
 * verdict). Pure reads of the net session; computed here so the panel stays a thin painter.
 */
function netPlannerRenderState(): NetPlannerRenderState {
  const t = clock.seconds;
  // The cost base is the preset's when the draft still matches a preset, else the GEO PARK base (a
  // hand-dragged draft is no longer "a preset" but still has a base cost + the altitude term).
  const costBaseEur = (NET_PLANNER_PRESETS[netPresetCursor] ?? NET_PLANNER_PRESETS[0]).costBaseEur;
  // THE TRUTHFUL CONSEQUENCE of the LIVE EDITABLE DRAFT (not a fixed preset): re-run previewLaunch
  // every frame so the panel readouts + the on-globe overlay update AS THE PLAYER DRAGS (§3.1).
  const preview = previewLaunch(eph, netPreviewWorld(), netDraft, t, costBaseEur);
  // The draft's per-REGION-0 preview slice (its consequence on the Act-1 demand).
  const slice = preview.contracts.find((c) => c.contractId === ACT1_CONTRACT_ID) ?? null;

  const c = netSession.contractById(ACT1_CONTRACT_ID);
  const solve = c ? netSession.lastSolveFor(c.id) : null;
  const shortfall = netSession.currentShortfall(t);

  return {
    objective: netObjectiveState(),
    contracts: netContractRows(t),
    balanceEur: netSession.balance,
    contract: c
      ? {
          id: c.id,
          label: c.label,
          state: c.state,
          served: c.state === "active" && (solve?.served ?? false),
          earnedEur: c.earnedEur,
        }
      : null,
    presets: NET_PLANNER_PRESETS.map((p, i) => ({
      id: p.id,
      label: p.label,
      // The preset lights only while the draft IS that preset (the floor); a hand-dragged draft
      // (netPresetCursor = −1) lights none — "you left the assist, you're on the ceiling now".
      selected: i === netPresetCursor,
    })),
    // §3.1 — the four DRAGGABLE parameters (altitude / inclination / phase / RAAN), each as a
    // normalized 0..1 slider position + a human readout, so the panel paints range sliders the
    // player drags (the ceiling). The orbit altitude reads as km above the toy surface.
    draft: {
      altitude: draftParam("semiMajorM", `${Math.round((netDraft.semiMajorM - A1_BODY_RADIUS_M) / 1000)} km`),
      inclination: draftParam("incRad", `${Math.round(netDraft.incRad * (180 / Math.PI))}°`),
      phase: draftParam("subLonRad", `${Math.round(netDraft.subLonRad * (180 / Math.PI))}°`),
      raan: draftParam("raanRad", `${Math.round((netDraft.raanRad ?? 0) * (180 / Math.PI))}°`),
    },
    preview: {
      coveredFraction: slice?.coveredFraction ?? 0,
      periodS: preview.periodS,
      latencyFloorS: slice?.latencyFloorS ?? Number.POSITIVE_INFINITY,
      costEur: preview.costEur,
      served: slice?.served ?? false,
    },
    launched: netSession.sats.length > 0,
    shortfall: shortfall?.message ?? null,
    // Act-2 — the phasing assist: surfaced only once an availability demand (REGION-1) is live
    // (the act-2 beat has emitted it). The assist EMPIRICALLY derives the zero-gap minimum +
    // the viable-but-imperfect suggested set against the SAME router the live world runs.
    phasing: netPhasingReadout(t),
    // §7.3/§10 — the per-contract prefer control (the first thing the player tunes): the selected
    // active contract + its class + the latency↔bandwidth↔stability slider position.
    prefer: netPreferControl(t),
    // TRIAGE SUMMARY (OVERVIEW): fleet size + the live serve revenue rate (€/hr). A pure read.
    fleet: {
      satCount: netSession.sats.length,
      revenuePerHr:
        netSession.contracts
          .filter((cc) => cc.state === "active")
          .reduce((sum, cc) => sum + netRevenueRatePerSecond(cc, cc.lastServedFraction), 0) * 3600,
    },
  };
}

/**
 * §7.3/§10 — build the PER-CONTRACT PREFER control slice (the first thing the player tunes): the
 * SELECTED active contract (null until ≥1 is accepted), its traffic CLASS + current prefer weights,
 * and the slider position those weights map to. The selection is `netPreferContractId` when it still
 * names an active contract, else the FIRST active contract (so the control auto-targets something the
 * moment a contract goes active). A pure read of the live session. The slider drag (onSetPrefer)
 * appends net_set_prefer → the router re-solves that contract → its path re-routes (the P1 link line).
 */
function netPreferControl(t: number): import("./panels/net-planner").NetPreferControl | null {
  const active = netSession.contracts.filter((c) => c.state === "active");
  if (active.length === 0) return null;
  const chosen =
    active.find((c) => c.id === netPreferContractId) ?? active[0];
  // REROUTE PREVIEW — the contract's current bridge sat + where preferring BANDWIDTH would route it
  // (the congestion-relief lever's effect), both as a PURE read (bridgeForPoint over the live roster
  // with the current shared-load map; no sim mutation, no golden impact).
  const live = [...netSession.sats];
  const grounds = [...netSession.grounds];
  const cap = NET_LINK_CAPACITY_UNITS;
  const loadBySat = new Map(live.map((s) => [s.id, netSession.loadOnSat(s.id)]));
  const solve = netSession.lastSolveFor(chosen.id);
  const currentSat = solve?.served && solve.path !== null && solve.path.length >= 2 ? solve.path[1] : null;
  const centre = { latRad: chosen.region.latRad, lonRad: chosen.region.lonRad };
  const altBridge = bridgeForPoint(eph, centre, grounds, live, t, preferFromSliderPos(0.5), loadBySat);
  const altSat = altBridge.satId;
  return {
    contractId: chosen.id,
    label: chosen.label,
    trafficClass: chosen.trafficClass,
    pos: preferSliderPos(chosen.prefer),
    prefer: { lat: chosen.prefer.lat, bw: chosen.prefer.bw, stab: chosen.prefer.stab },
    canSelect: active.length > 1,
    currentSat,
    currentUtil: currentSat ? netSession.loadOnSat(currentSat) / cap : 0,
    altSat,
    altUtil: altSat ? netSession.loadOnSat(altSat) / cap : 0,
    wouldReroute: altSat !== null && currentSat !== null && altSat !== currentSat,
  };
}

/** §7.3/§10 — CYCLE which active contract the prefer slider tunes (the SELECT CONTRACT button). */
function netCyclePreferContract(): void {
  const active = netSession.contracts.filter((c) => c.state === "active");
  if (active.length === 0) return;
  const cur = active.findIndex((c) => c.id === netPreferContractId);
  const next = active[(cur + 1 + active.length) % active.length] ?? active[0];
  netPreferContractId = next.id;
}

/**
 * §7.3/§10 — SET a contract's prefer weights from the slider position (the first tunable). Maps the
 * normalized 0..1 position to {lat,bw,stab} via the pure {@link preferFromSliderPos} (0 = latency,
 * 0.5 = bandwidth, 1 = stability — w_stab DORMANT in M1), records + applies a net_set_prefer action
 * via the SHARED applier (live == replay), and pins the selection so the readout follows. The router
 * re-solves THAT contract next step ⇒ its path visibly re-routes (the P1 link line moves on the globe).
 */
function netSetPrefer(contractId: string, pos: number): void {
  netPreferContractId = contractId;
  const w = preferFromSliderPos(pos);
  const action = netSetPreferAction(contractId, w.lat, w.bw, w.stab, clock.tick);
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "prefer_set") {
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "NET-PREFER",
      value: contractId,
      msg: `prefer → lat ${w.lat.toFixed(2)} · bw ${w.bw < 0.01 && w.bw > 0 ? w.bw.toExponential(0) : w.bw.toFixed(2)} — the router re-solves; watch ${contractId}'s path re-route on the globe`,
    });
  }
}

/** §3.1 — project ONE draggable draft parameter into the panel's slider shape: its current value
 * normalized to a 0..1 position within the draggable bounds + a human-readable label. The panel
 * paints a range slider at `pos` and shows `label`; dragging it fires netEditDraft back. Pure read. */
function draftParam(
  field: "semiMajorM" | "incRad" | "subLonRad" | "raanRad",
  label: string,
): import("./panels/net-planner").NetDraftParam {
  const b = NET_DRAFT_BOUNDS[field];
  const v = field === "raanRad" ? (netDraft.raanRad ?? 0) : netDraft[field];
  const pos = b.max > b.min ? clampN((v - b.min) / (b.max - b.min), 0, 1) : 0;
  return { pos, label };
}

/**
 * Act-2 — the phasing-assist readout for the planner (design §3.3): null until the availability
 * demand (REGION-1) is live, then the EMPIRICALLY measured zero-gap minimum + the suggested
 * viable-but-imperfect set from the LEO_SWEEP family over REGION-1. A pure read (suggestPhasing
 * probes the real windowAvailability); never mutates sim state. The assist is computed once per
 * frame only when the act-2 demand exists, so it costs nothing in Act 1.
 */
function netPhasingReadout(t: number): import("./panels/net-planner").NetPhasingReadout | null {
  const c = netSession.contractById(ACT2_CONTRACT_ID);
  if (c === null || c.state === "completed" || c.state === "failed") return null;
  if (!c.activeAxes.has("availability")) return null;
  // The LEO orbit family the assist phases (the canon Act-2 fix: a phased LEO constellation).
  const leo = NET_PRESETS.find((p) => p.id === "LEO_SWEEP");
  if (leo === undefined) return null;
  const grounds = [...netSession.grounds];
  const sugg = suggestPhasing(eph, c.region, leo, ACT2_SLA_AVAIL, t, grounds);
  // The held-vs-size LADDER around the measured minimum: a small window the player dials within
  // (≥ 2 sats; up to two past zero-gap so the over-build cost is visible). A pure read.
  const loN = Math.max(2, sugg.zeroGapN - 2);
  const hiN = sugg.zeroGapN + 2;
  const ladder = phasingLadder(eph, c.region, leo, ACT2_SLA_AVAIL, t, grounds, loN, hiN);
  // The player's dialed size, defaulted to the measured minimum-that-holds + clamped to the ladder.
  if (netChosenConstellationN === null) netChosenConstellationN = sugg.zeroGapN;
  netChosenConstellationN = Math.max(loN, Math.min(hiN, netChosenConstellationN));
  const perSatCostEur = launchCost({ semiMajorM: leo.semiMajorM, costBaseEur: launchCostBaseForPreset(leo.id) });
  return {
    count: sugg.count,
    zeroGapN: sugg.zeroGapN,
    estCoveredFraction: sugg.estCoveredFraction,
    slaAvail: ACT2_SLA_AVAIL,
    ladder,
    chosenN: netChosenConstellationN,
    perSatCostEur,
  };
}

/** Act-2 — the player's DIALED constellation size on the {@link netPhasingReadout} ladder (UI-only,
 * never sim/golden state; the recorded launch action carries the concrete count). Null = not yet
 * dialed (defaults to the measured zero-gap minimum the first frame the assist shows). */
let netChosenConstellationN: number | null = null;

/** Act-2 — step the chosen constellation size up/down on the ladder (the −/+ stepper). UI-only:
 * clamps to the live ladder's [min, max]; the next render reflects the new held %/capex. */
function netConstellationStep(delta: number): void {
  const t = clock.seconds;
  const ph = netPhasingReadout(t);
  if (ph === null) return;
  const lo = ph.ladder[0]?.n ?? ph.chosenN;
  const hi = ph.ladder[ph.ladder.length - 1]?.n ?? ph.chosenN;
  netChosenConstellationN = Math.max(lo, Math.min(hi, ph.chosenN + Math.sign(delta)));
}

/**
 * Act-2 — LAUNCH the suggested phased constellation as ONE batch (design §3.3/§3.4): derive the
 * assist for the live REGION-1, then append a single net_launch into the LEO_SWEEP plane with
 * `count` members evenly m0-spread by `phaseSpreadRad = 2π/count` (the B2 batch wire). One launch
 * = several phased sats into a plane — the viable-but-imperfect set the player then closes by
 * adding one more. Recorded + applied via the SHARED applyAndRecordNetAction (live == replay).
 */
function netConstellation(): void {
  const t = clock.seconds;
  const c = netSession.contractById(ACT2_CONTRACT_ID);
  if (c === null || !c.activeAxes.has("availability")) return;
  const leo = NET_PRESETS.find((p) => p.id === "LEO_SWEEP");
  if (leo === undefined) return;
  const sugg = suggestPhasing(eph, c.region, leo, ACT2_SLA_AVAIL, t, [...netSession.grounds]);
  // Launch the size the player DIALED on the ladder (defaults to the measured zero-gap minimum),
  // not the fixed viable-but-imperfect suggestion — the player owns the coverage-vs-capex call.
  const loN = Math.max(2, sugg.zeroGapN - 2);
  const hiN = sugg.zeroGapN + 2;
  const n = Math.max(loN, Math.min(hiN, netChosenConstellationN ?? sugg.zeroGapN));
  const action = netLaunchAction(
    {
      presetId: leo.id,
      semiMajorM: leo.semiMajorM,
      incRad: leo.incRad,
      subLonRad: leo.subLonRad,
      count: n,
      phaseSpreadRad: (2 * Math.PI) / n,
    },
    clock.tick,
  );
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "sats_launched") {
    const launched = res.satIds?.length ?? 0;
    const failed = res.failedCount ?? 0;
    log.append({
      tSim: clock.seconds,
      sev: failed > 0 ? "warn" : "info",
      entity: "NET-CONSTELLATION",
      value: `${launched} sats · −€${Math.round(res.costEur)}`,
      msg:
        failed > 0
          ? `phased LEO set into one plane (${failed} lost to a launch failure; €${Math.round(res.costEur)} charged) — coverage HANDS OFF (need ~${sugg.zeroGapN}; relaunch the lost members)`
          : `phased LEO set into one plane (€${Math.round(res.costEur)} charged) — coverage HANDS OFF (need ~${sugg.zeroGapN}; add one to hold the bar)`,
    });
  } else if (res && res.kind === "launch_failed") {
    log.append({
      tSim: clock.seconds,
      sev: "warn",
      entity: "NET-CONSTELLATION",
      value: `LAUNCH FAILURE · −€${Math.round(res.costEur)}`,
      msg: `the constellation batch LAUNCH FAILED — every member was lost; €${Math.round(res.costEur)} charged. Relaunch the set.`,
    });
  }
}

/**
 * net/ Act-3b — drain the live NetSession's FAULT + TRACE state into SYSTEM.LOG (render-only). The
 * sim owns the truth (the seeded fault roll + the trace diagnosis fold into the replay golden);
 * this only SURFACES it, edge-triggered, so a fault appearing/resolving + the first resilience
 * shortfall each emit ONE line (a degradation amber pulse + est. recovery; a telegraphed countdown
 * "fails in N"; the binding-constraint / SPOF / over-provision shortfall). No per-frame spam: the
 * fault lines fire on the appearance/resolution edge; the shortfall fires once when it first
 * surfaces. Pure read of the session (never mutates sim state).
 */
const netFaultSeen = new Set<string>();
/** P1 (§7.4) — the set of trace shortfalls ALREADY surfaced (keyed subjectId|kindOfFix), so EVERY
 * shortfall the trace names is logged ONCE — not just shortfalls[0] — without per-frame spam. */
const netShortfallSeen = new Set<string>();
/** P1 (§7.5) — the set of predictability loss-stamps ALREADY surfaced (keyed aId|bId|cause|atS), so
 * each "link X↔Y lost: cause at T" stamp (renderLossStamp, previously dead code) is logged once. */
const netLossSeen = new Set<string>();
/** P2 (§5.3) — the LIVE telegraphed countdown: the last whole-`NET_COUNTDOWN_BUCKET_S`-second bucket
 * already surfaced per faulting sat, so the countdown re-fires as it TICKS DOWN (a visibly updating
 * "fails in Ns", not a one-shot line at appearance) without per-frame spam. */
const netCountdownBucket = new Map<string, number>();
/** P2 (§5.1) — the telegraphed sats whose countdown has EXPIRED (the sat DROPPED permanently), so the
 * one-shot "FAILED — sat lost" line fires once on the drop edge (the warned hard failure). */
const netDroppedSeen = new Set<string>();
/** The cadence (sim-seconds) the live telegraphed countdown re-surfaces at as it ticks down. */
const NET_COUNTDOWN_BUCKET_S = 5;
function drainNetFaultLog(): void {
  if (!netMode || !netSession.faultsEnabled) return;
  const t = clock.seconds;
  const live = new Set<string>();
  for (const f of netSession.faults) {
    live.add(f.satId);
    // NEW fault this frame ⇒ one SYSTEM.LOG line (the §5.3 fault face: the amber-pulse degradation
    // + est. recovery, or the telegraphed watch-and-act countdown's first warning).
    if (!netFaultSeen.has(f.satId)) {
      log.append({
        tSim: t,
        sev: f.kind === "telegraphed" ? "warn" : "info",
        entity: f.satId,
        value: f.kind.toUpperCase(),
        msg: renderFaultLine(f, t),
      });
    }
    // P2 (§5.3) — THE LIVE TICKING COUNTDOWN for a PENDING telegraphed fault. While the countdown is
    // still running (sat not yet dropped), re-surface "fails in Ns" each NET_COUNTDOWN_BUCKET_S as it
    // ticks down — a visibly updating watch-and-act readout, NOT a one-shot line at appearance. The
    // orrery also pulses the node amber (netBuildRenderState's `faulting` flag). When the countdown
    // expires the sat DROPS permanently (the P2 §5.1 fix) — announce the loss ONCE on the drop edge.
    if (f.kind === "telegraphed") {
      const dropped = faultRemovesSatAt(f, t);
      if (!dropped) {
        const remaining = telegraphedCountdownRemainingS(f, t);
        const bucket = Math.ceil(remaining / NET_COUNTDOWN_BUCKET_S);
        if (netCountdownBucket.get(f.satId) !== bucket) {
          netCountdownBucket.set(f.satId, bucket);
          log.append({
            tSim: t,
            sev: "warn",
            entity: f.satId,
            value: `FAILS IN ${remaining.toFixed(0)}s`,
            msg: `${f.satId} telegraphed fault (${f.cause}): fails in ${remaining.toFixed(0)}s — re-route or launch a replacement before it dies.`,
          });
        }
      } else if (!netDroppedSeen.has(f.satId)) {
        // The countdown hit zero with no replacement ⇒ the sat is PERMANENTLY DROPPED (removed from
        // the router graph from failsAtS on). A redundant constellation bridges around it; a brittle
        // single-sat contract breaches. The §5 watch-and-act stakes are real.
        netDroppedSeen.add(f.satId);
        netCountdownBucket.delete(f.satId);
        log.append({
          tSim: t,
          sev: "error",
          entity: f.satId,
          value: "FAILED · DROPPED",
          msg: `${f.satId} FAILED — the telegraphed fault dropped it permanently (no replacement in time). Redundant paths bridge around it; a single-sat region breaches.`,
        });
      }
    }
  }
  // SELF-RECOVERED faults this frame ⇒ a recovery line. P2: a telegraphed-expired sat stays ACTIVE
  // (permanently down) so it never leaves `live` ⇒ it never spuriously prints "RECOVERED" (the old
  // bug). Only a genuine degradation/transient self-heal leaves the set here.
  for (const id of netFaultSeen) {
    if (!live.has(id)) {
      log.append({ tSim: t, sev: "info", entity: id, value: "RECOVERED", msg: `${id} recovered — the network weathered it.` });
    }
  }
  netFaultSeen.clear();
  for (const id of live) netFaultSeen.add(id);
  // P1 (§7.4) — THE TRACE, FIRST-CLASS: surface ALL of diagnose()'s shortfalls (binding constraint +
  // the kind-of-fix wording for every unmet/at-risk contract + the SPOF / over-provision parses), NOT
  // just shortfalls[0]. De-duped by subject+fix so each distinct shortfall logs ONCE (no per-frame
  // spam). This is the §7.4 self-diagnosing view drained to SYSTEM.LOG — "the solver says no" turned
  // into "I launch THAT."
  const report = netSession.trace;
  if (report !== null) {
    for (const sf of report.shortfalls) {
      const key = `${sf.subjectId}|${sf.kindOfFix}`;
      if (netShortfallSeen.has(key)) continue;
      netShortfallSeen.add(key);
      log.append({ tSim: t, sev: "warn", entity: sf.subjectId, value: sf.kindOfFix, msg: sf.message });
    }
    // P1 (§7.5) — THE PREDICTABILITY LOSS-STAMP, surfaced via renderLossStamp (previously DEAD CODE
    // outside tests): "link X↔Y lost: Y set below horizon at 14:32" — the geometric cause + sim-time
    // every link loss carries. De-duped by the stamp identity so each loss logs once. The §7.5 seed
    // the spec calls REQUIRED-in-M1, now legible in SYSTEM.LOG.
    for (const loss of report.losses) {
      // De-dupe on the STABLE link+cause identity (not atS, which is fresh each solve) so a persistently
      // down link logs its loss-stamp ONCE — at the time it first lost — not every congestion re-solve.
      const key = `${loss.aId}|${loss.bId}|${loss.cause}`;
      if (netLossSeen.has(key)) continue;
      netLossSeen.add(key);
      log.append({ tSim: t, sev: "info", entity: `${loss.aId}↔${loss.bId}`, value: "LINK LOST", msg: renderLossStamp(loss) });
    }
  }
}

/**
 * net/ Act-4 — surface the MARS FRONTIER beat text + the "to be continued" stop into SYSTEM.LOG
 * (render-only, edge-triggered). The sim owns the truth (the act4 beat OFFERS the Mars contract +
 * the cursor STOPS on it — its gate is false forever, a READ not a gate). This only SURFACES the
 * narrative beat once when the cursor first reaches act4 (the player has reached the frontier),
 * then surfaces the Mars sample's FIRST arrival ("data arrives old") once, then the "to be
 * continued" stop once the player has seen the crawl + the stale read. No per-frame spam — each
 * line fires on its own edge. Pure read of the session (never mutates sim state, no golden).
 */
let netAct4BeatLogged = false;
let netMarsArrivalLogged = false;
let netAct4StopLogged = false;
function drainNetAct4Log(): void {
  if (!netMode) return;
  const t = clock.seconds;
  const mc = netSession.contractById(ACT4_MARS_CONTRACT_ID);
  if (mc === null) return; // act4 not yet reached.
  // (1) The FRONTIER beat — fired once when the Mars opportunity first appears on the board.
  if (!netAct4BeatLogged) {
    netAct4BeatLogged = true;
    log.append({
      tSim: t,
      sev: "warn",
      entity: "MARS-1",
      value: "FRONTIER",
      msg:
        "ACT 4 — distance changes everything. A Mars colony needs data. Launch a MARS RELAY " +
        "(; to select, L to launch) — but the signal crawls minutes one-way: your real-time playbook breaks.",
    });
  }
  // (2) The FIRST Mars data arrival — fired once the sample freezes (the data arrives OLD by sight).
  if (!netMarsArrivalLogged && netSession.mars !== null) {
    netMarsArrivalLogged = true;
    const ageMin = ((netSession.marsAgeS(t) ?? 0) / 60).toFixed(1);
    log.append({
      tSim: t,
      sev: "info",
      entity: "MARS-1",
      value: `as of ${ageMin}m ago`,
      msg:
        "Mars data arrived — and it is already OLD (one light-delay stale on arrival). Place a cache " +
        "(P) to bring it closer; freshness jumps, then drains again. This is the whole frontier lesson.",
    });
  }
  // (3) The "to be continued" stop — fired once the player has both seen the crawl + read the stale
  //     sample (the cursor stays on act4 forever; there is NO win screen — a deliberate frontier stop).
  if (!netAct4StopLogged && netMarsArrivalLogged) {
    netAct4StopLogged = true;
    log.append({
      tSim: t,
      sev: "info",
      entity: "SIGNAL HORIZON",
      value: "…",
      msg: "TO BE CONTINUED — you have reached the signal horizon. The frontier opens here.",
    });
  }
}

/**
 * net/ M1 — fire the ONBOARDING briefing card for the CURRENT concept off the scenario cursor
 * (render-only; the sim owns the truth). The cursor is the index into the M1 arrival sequence
 * (act1=0, act2=1, act3a=2, act3b=3, act4=4 — see M1_SCENARIO), so the beat that is CURRENT is the
 * concept just INTRODUCED: act1's card fires at the cold open (cursor 0 at boot, the Act-1 contract
 * already emitted); the others fire the frame the cursor first reaches them (the prior gate fired +
 * the new beat emitted). Onboarding.trigger de-dupes — each card shows ONCE per session — and the
 * card is dismissed via GOT IT / Esc / click-out (the clock never stops). Net mode only (onboarding
 * is null in cache mode). A pure read of netSession.cursor; never mutates sim state, no golden.
 */
const NET_ONBOARDING_CONCEPTS: OnboardingConcept[] = ["act1", "act2", "act3a", "act3b", "act4"];
function drainNetOnboarding(): void {
  if (onboarding === null) return; // cache mode (or never net) — no cards.
  const concept = NET_ONBOARDING_CONCEPTS[netSession.cursor];
  if (concept !== undefined) onboarding.trigger(concept);
}

/**
 * net/ A4 — build the ORRERY's per-frame net slice (design §6): the highlighted REGION-0
 * (lit the instant the router reports it SERVED, dim otherwise) + the launched sat's
 * footprint over the region. World positions are the TOY-frame earth-relative surface points
 * (link-budget surfacePointRelative) PLUS earth's ephemeris position, so the orrery rebases
 * them like any body. PURE reads of the net session; only consumed while netRenderMode is on.
 */
function netRenderState(): import("./orrery/orrery").NetRenderState {
  const t = clock.seconds;
  const earth = eph.position("earth", t);
  const add = (rel: Vec3): Vec3 => [earth[0] + rel[0], earth[1] + rel[1], earth[2] + rel[2]];
  // Act-2 — render the ACTIVE availability contract (REGION-1) when it is live, else the
  // Act-1 connectivity contract (REGION-0): the orrery shows whichever demand is the current
  // teaching beat, so the hand-off render + sawtooth meter track the act the player is on.
  const c = currentNetContract();
  // §3 — whether the LAUNCH planner is open (drives the orrery's planner-focus close-up). SD-44
  // PHASE 1: the LAUNCH tile is now the split "net-launch" host (shown on the CONNECTIVITY desktop).
  const plannerActive = shell.visibleHosts().includes("net-launch");
  if (c === null) {
    return {
      // §3 — the operated body even with no contract: the camera focus body, so the orrery still
      // draws the toy globe sphere (body-agnostic — never hardcoded "earth"; the focus is "earth"
      // in the toy net frame but this reads whatever the camera focuses).
      body: netBodySlice(orrery.focusId, t, plannerActive),
      region: null,
      footprints: [],
      availability: null,
      mars: netMarsSlice(t),
      draft: netDraftSlice(t, add, null),
      servedLink: null,
      // P1 — the live network: even with no current teaching contract, draw any OTHER active served
      // contract's path (e.g. an Act-3a corridor contract while the teaching cursor is elsewhere).
      servedLinks: netServedLinksSlice(t, add),
    };
  }

  const solve = netSession.lastSolveFor(c.id);
  const served = c.state === "active" && (solve?.served ?? false);
  const center = add(surfacePointRelative(c.region.latRad, c.region.lonRad, t));
  const region = {
    id: c.region.id,
    centerPosM: center,
    radiusRad: c.region.radiusRad,
    served,
  };
  // THE HAND-OFF RENDER (design §6): one footprint disc per sat currently COVERING the region,
  // each parked over the sat's own nadir so the discs SWEEP with the constellation. With a lone
  // LEO this is one disc that slides off the region every pass (the sawtooth); with a phased
  // constellation several sweep so one slides on as another slides off and the region holds
  // green. A pure read of the live roster geometry — the SAME bridge check the router runs.
  const footprints = c.state === "active" ? coveringFootprints(c, t, add) : [];
  // The availability sawtooth meter (design §4.4 axis-2): only when the availability axis is
  // live (Act 2). The rolling value is the contract's lastAvailability readout; the history is
  // a RENDER-ONLY ring buffer kept in main.ts (a derived display, NOT in the snapshot/fold).
  const availability =
    c.state === "active" && c.activeAxes.has("availability")
      ? { value: c.lastAvailability, bar: c.slaAvail, history: pushAvailHistory(c.id, c.lastAvailability) }
      : null;
  // §3 — THE LIVE PLANNER DRAFT consequence (footprint + ground-track + coverage-gap) for THIS
  // region, and the SERVED region→sat→ground beam when a launched sat bridges it ("signal reaches").
  const draft = netDraftSlice(t, add, c);
  const servedLink = netServedLinkSlice(c, t, add);
  // §3 — THE OPERATED BODY (body-agnostic): the body the active contract's region sits on, so the
  // orrery draws it as a real 3D sphere + focuses/zooms it when the planner is open. Read from the
  // region's bodyId — NEVER hardcoded "earth" (the Act-4 Mars teaser region rides "mars").
  const body = netBodySlice(c.region.bodyId, t, plannerActive);
  // P1 (GDD §5) — THE LIVE NETWORK: every active served contract's router path drawn region→sat→
  // ground, coloured by the bridging sat's utilisation + flashed on a re-route (the self-healing
  // reroute made legible). The single `servedLink` above stays for the planner draft beam.
  const servedLinks = netServedLinksSlice(t, add);
  return { body, region, footprints, availability, mars: netMarsSlice(t), draft, servedLink, servedLinks };
}

/**
 * §3 — build the OPERATED-BODY slice for the orrery (body-agnostic): the body's id, its world
 * centre, its RENDER radius, the spin angle θ(t), and whether the planner is open. The render radius
 * is the TOY {@link A1_BODY_RADIUS_M} for the toy net frame ("earth") — the SAME radius
 * surfacePointRelative uses, so the sphere and the surface coverage points share one scale — and the
 * REAL ephemeris radius for any other body (e.g. the Act-4 Mars teaser). NEVER hardcodes "earth":
 * the id is passed in (the region's bodyId or the focus body). Pure read of the ephemeris + frame.
 */
function netBodySlice(
  bodyId: string,
  t: number,
  plannerActive: boolean,
): import("./orrery/orrery").NetRenderState["body"] {
  // The toy net frame's surface math uses A1_BODY_RADIUS_M (300 km) for "earth"; everything else
  // (the Act-4 Mars region) is on its real ephemeris radius. This keeps the sphere matched to the
  // surfacePointRelative scale the region/footprint/ground-track world points are built at.
  const renderRadiusM = bodyId === "earth" ? A1_BODY_RADIUS_M : eph.radiusMeters(bodyId);
  return {
    id: bodyId,
    centerPosM: eph.position(bodyId, t),
    renderRadiusM,
    spinThetaRad: earthThetaAt(t),
    plannerActive,
  };
}

/**
 * §3 — build the LIVE PLANNER DRAFT slice for the orrery (the make-or-break planner ON THE GLOBE):
 * the would-be sat's FOOTPRINT disc + its GROUND-TRACK arc + THE CONTRACT COVERAGE-GAP overlay
 * (red still-dark / green covered) for the active region. All TRUTHFUL — fed from the SAME pure
 * {@link previewLaunch} the panel uses (the ground-track + per-contract coveredFraction) and the
 * SAME {@link draftToSat} the applier commits; NO geometry is recomputed in a private path here.
 * Returns null only when the planner panel is not summoned (no point drawing a draft nobody edits).
 */
function netDraftSlice(
  t: number,
  add: (rel: Vec3) => Vec3,
  c: ReturnType<NetSession["contractById"]>,
): import("./orrery/orrery").NetRenderState["draft"] {
  // Only draw the draft while the LAUNCH PLANNER is on screen (it IS the planner's consequence view);
  // off-planner the globe stays the clean monument view. Cheap visibleHosts read. SD-44 PHASE 1: the
  // LAUNCH tile is the split "net-launch" host (the CONNECTIVITY desktop).
  if (!shell.visibleHosts().includes("net-launch")) return null;
  // The truthful preview of the live editable draft (the SAME call the panel makes).
  const preview = previewLaunch(eph, netPreviewWorld(), netDraft, t);
  // The draft sat's NADIR footprint (the would-be sat built the SAME way the applier builds it).
  const sat = draftToSat(netDraft, t);
  const satRel = solveOrbit(sat.orbit, t);
  const r = Math.hypot(satRel[0], satRel[1], satRel[2]);
  const footprint =
    r > 0
      ? {
          centerPosM: add([
            (satRel[0] * A1_BODY_RADIUS_M) / r,
            (satRel[1] * A1_BODY_RADIUS_M) / r,
            (satRel[2] * A1_BODY_RADIUS_M) / r,
          ]),
          // The disc size hint: the active region's angular radius (matches coveringFootprints'
          // sizing), so the draft footprint reads at the same scale as a committed footprint.
          radiusRad: (c?.region.radiusRad ?? 0.4) * 1.15,
        }
      : null;
  // The ground-track arc: previewLaunch's body-fixed sub-points lifted to earth-relative surface
  // world points (surfacePointRelative re-applies the spin so each reads at its inertial place at t).
  const groundTrack = preview.groundTrack.map((p) => add(surfacePointRelative(p.latRad, p.lonRad, t)));
  // THE COVERAGE-GAP OVERLAY: the active region disc + previewLaunch's truthful per-contract
  // coveredFraction (red shrinks / green grows as the player drags). Null when no region is live.
  const gap =
    c !== null
      ? {
          centerPosM: add(surfacePointRelative(c.region.latRad, c.region.lonRad, t)),
          radiusRad: c.region.radiusRad,
          coveredFraction:
            preview.contracts.find((pc) => pc.contractId === c.id)?.coveredFraction ?? 0,
        }
      : null;
  return { footprint, groundTrack, gap };
}

/**
 * §3 / Act-1 "the signal reaches there" — the SERVED region→sat→ground LINK beam: when a LAUNCHED
 * sat currently bridges the active region's centre to a ground station, return the three world
 * points (region surface → that sat → that ground) so the orrery draws the beam. A render-only read
 * of the SAME {@link bridgeForPoint} the router runs; null when no launched sat serves the region.
 */
function netServedLinkSlice(
  c: NonNullable<ReturnType<NetSession["contractById"]>>,
  t: number,
  add: (rel: Vec3) => Vec3,
): import("./orrery/orrery").NetRenderState["servedLink"] {
  if (c.state !== "active") return null;
  const grounds = [...netSession.grounds];
  if (grounds.length === 0 || netSession.sats.length === 0) return null;
  const point = { latRad: c.region.latRad, lonRad: c.region.lonRad };
  const sats = [...netSession.sats];
  const bridge = bridgeForPoint(eph, point, grounds, sats, t);
  if (bridge.satId === null) return null;
  const sat = sats.find((s) => s.id === bridge.satId);
  const ground = grounds.find((g) => g.id === bridge.groundId);
  if (sat === undefined || ground === undefined) return null;
  return {
    regionPosM: add(surfacePointRelative(c.region.latRad, c.region.lonRad, t)),
    satPosM: add(satPositionRelative(eph, sat, t)),
    groundPosM: add(surfacePointRelative(ground.latRad, ground.lonRad, t)),
  };
}

/** P1 (GDD §5) — the RE-ROUTE tracker (render-only, NOT folded): the bridging sat id each active
 * contract was last served via. When a contract's `path[1]` changes between frames (a LEO set below
 * the horizon, a fault removed the sat — the router re-solved to the rising/parallel sat), we stamp
 * a re-route flash so the orrery pulses the new path. Keyed by contract id; cleared when a contract
 * stops being served. A pure read of the live SolveResult — never mutates sim state, no golden. */
const netLinkLastSat = new Map<string, string>();
const netLinkReroute = new Map<string, number>();
/** How fast the re-route flash decays per frame (≈ a half-second pulse at 60fps) — render-only. */
const NET_REROUTE_DECAY = 0.04;

/**
 * P1 (GDD §5 survival condition) — DRAW THE LIVE NETWORK for EVERY active served contract. Generalizes
 * the P0 single served-beam to all contracts + multi-hop/constellation paths: for each active contract
 * whose last router {@link import("./sim/net/router").SolveResult} carries a `path` (region→sat→ground
 * node ids), resolve each node to its earth-relative world point (region/ground = surface points, sat =
 * its orbit position) and emit the hop list — so the constellation hand-off is visible (as the router
 * re-solves to the rising sat, `path[1]` migrates and the beam follows). Each link carries:
 *   - `util` = `loadOnSat(path[1]) / NET_LINK_CAPACITY_UNITS` (the §4.3 oversubscription data, now ON
 *      THE GLOBE as colour — green headroom → red over-cap), so a congesting link reads warm BEFORE it
 *      breaches; and
 *   - `rerouteAge` — flashed to 1 the frame the bridging sat changed (set/fault re-route), decaying —
 *      so the self-healing reroute is legible.
 * Mars-body contracts are skipped (the Act-4 crawler renders the interplanetary leg; a toy-frame beam
 * at 1 AU would be geometrically meaningless). A render-only read of the live session; no golden.
 */
function netServedLinksSlice(
  t: number,
  add: (rel: Vec3) => Vec3,
): import("./orrery/orrery").NetRenderState["servedLinks"] {
  const out: import("./orrery/orrery").NetRenderState["servedLinks"] = [];
  const grounds = [...netSession.grounds];
  const live = new Set<string>();
  for (const c of netSession.contracts) {
    if (c.state !== "active") continue;
    if (c.region.bodyId !== "earth") continue; // Act-4 Mars leg is the crawler's job, not a toy beam.
    const solve = netSession.lastSolveFor(c.id);
    if (solve === null || !solve.served || solve.path === null || solve.path.length < 2) continue;
    const path = solve.path; // [regionId, satId, groundId] (the router's own node-id path).
    const satId = path[1];
    const sat = netSession.sats.find((s) => s.id === satId);
    if (sat === undefined) continue;
    const ground = grounds.find((g) => g.id === path[path.length - 1]);
    // Resolve the path node ids to world points: region surface → sat orbit → ground surface.
    const points: Vec3[] = [
      add(surfacePointRelative(c.region.latRad, c.region.lonRad, t)),
      add(satPositionRelative(eph, sat, t)),
    ];
    if (ground !== undefined) points.push(add(surfacePointRelative(ground.latRad, ground.lonRad, t)));
    // §4.3 utilisation of the bridging sat (shared load / capacity) — green headroom → red over-cap.
    const util = netSession.loadOnSat(satId) / NET_LINK_CAPACITY_UNITS;
    // RE-ROUTE detection: the bridging sat changed since the last served frame ⇒ flash the new path.
    live.add(c.id);
    const prevSat = netLinkLastSat.get(c.id);
    if (prevSat !== undefined && prevSat !== satId) netLinkReroute.set(c.id, 1);
    netLinkLastSat.set(c.id, satId);
    const reroute = netLinkReroute.get(c.id) ?? 0;
    if (reroute > 0) netLinkReroute.set(c.id, Math.max(0, reroute - NET_REROUTE_DECAY));
    out.push({ contractId: c.id, points, util, rerouteAge: reroute });
  }
  // Drop trackers for contracts no longer served (so a re-acquire flashes as a fresh re-route).
  for (const id of [...netLinkLastSat.keys()]) if (!live.has(id)) { netLinkLastSat.delete(id); netLinkReroute.delete(id); }
  return out;
}

/**
 * net/ M1 (SD-44 PHASE 1) — project the live net session into the COVERAGE·ROSTER tile state: one row
 * per launched sat (id + orbit CLASS LEO/GEO derived from its semi-major axis + a "covers REGION-x / —"
 * note from the router's per-contract solve), plus the DARK list of active contracts NOT served right
 * now. A PURE read of netSession (sats + contracts + lastSolveFor) — no sim mutation, no golden impact.
 */
function netCoverageRosterState(): CoverageRosterState {
  // Which active contract each sat is bridging right now: read the router's served path (path[1] = sat).
  const satCovers = new Map<string, string[]>();
  const dark: string[] = [];
  for (const c of netSession.contracts) {
    if (c.state !== "active") continue;
    const solve = netSession.lastSolveFor(c.id);
    if (solve !== null && solve.served && solve.path !== null && solve.path.length >= 2) {
      const satId = solve.path[1];
      const list = satCovers.get(satId) ?? [];
      list.push(c.region.id);
      satCovers.set(satId, list);
    } else {
      dark.push(c.region.id);
    }
  }
  const geoBoundaryM = (A1_LEO_SEMI_MAJOR_M + A1_GEO_SEMI_MAJOR_M) / 2;
  const sats = netSession.sats.map((s) => {
    const covered = satCovers.get(s.id) ?? [];
    return {
      id: s.id,
      orbitClass: s.orbit.aM >= geoBoundaryM ? "GEO" : "LEO",
      covers: covered.length > 0 ? `covers ${covered.join(", ")}` : "—",
      active: covered.length > 0,
    };
  });
  return { sats, dark };
}

/**
 * net/ M1 (SD-44 PHASE 1) — project the live net session into the LINK·LOAD tile state: one row per
 * BRIDGING sat (a sat carrying ≥1 served contract), its utilisation (loadOnSat / capacity, the §4.3
 * oversubscription read), the contract ids sharing it, and the binding constraint from the router's
 * last solve. A PURE read of netSession (loadOnSat + lastSolveFor). Empty (→ "no traffic yet") in Act 1
 * before any served contract.
 */
function netLinkLoadState(): LinkLoadState {
  // Group active served contracts by their bridging sat (path[1]); KEEP the contract refs (for the
  // allocation ledger) + collect the binding constraint.
  type NetC = (typeof netSession.contracts)[number];
  const bySat = new Map<string, { contracts: NetC[]; binding: string }>();
  for (const c of netSession.contracts) {
    if (c.state !== "active") continue;
    const solve = netSession.lastSolveFor(c.id);
    if (solve === null || !solve.served || solve.path === null || solve.path.length < 2) continue;
    const satId = solve.path[1];
    const entry = bySat.get(satId) ?? { contracts: [], binding: "—" };
    entry.contracts.push(c);
    if (solve.bindingConstraint !== null) entry.binding = solve.bindingConstraint;
    bySat.set(satId, entry);
  }
  const rows = [...bySat.entries()].map(([satId, e]) => {
    const sharedLoad = netSession.loadOnSat(satId);
    // ALLOCATION LEDGER — each sharing contract's served bandwidth vs its committed floor, computed
    // the SAME way router.ts does (§4.3): under cap the link honors full offered load; over cap it
    // splits capacity in PROPORTION to offered load (capacity·own/shared), and a contract STARVES iff
    // that fair-share falls below its own floor. A pure read — no sim mutation, no golden impact.
    const overCap = sharedLoad > NET_LINK_CAPACITY_UNITS && sharedLoad > 0;
    const shares = e.contracts.map((c) => {
      const own = c.offeredLoad;
      const served = overCap ? (NET_LINK_CAPACITY_UNITS * own) / sharedLoad : own;
      const floor = c.activeAxes.has("bandwidth") ? c.slaBandwidth : 0;
      return { contractId: c.region.id, served, floor, underFloor: overCap && floor > 0 && served < floor };
    });
    return {
      satId,
      util: sharedLoad / NET_LINK_CAPACITY_UNITS,
      contracts: e.contracts.map((c) => c.region.id),
      binding: e.binding,
      shares,
    };
  });
  return { rows };
}

/**
 * Act-4 — the MARS FRONTIER TEASER render slice (design §4.5 / §8 — the vertigo, BY SIGHT). Null
 * until the act4 beat has surfaced the Mars opportunity (the MARS-1 contract is on the board). Once
 * it has, this reads ENTIRELY off the live NetSession's PURE Act-4 surface — `mars` / `marsAgeS(t)` /
 * `marsFreshness(t)` — plus the launched-relay presence + the REAL Earth↔Mars light delay. The
 * Earth↔Mars signal CRAWL is a render-only cycle keyed on sim-time / oneWayS (the SAME light delay
 * the M1-cache packet uses): progress = frac(t / oneWayS), so the signal VISIBLY crawls at light
 * speed across the gap. NO sim feedback — the minutes-long latency is a READOUT (§8 fenced). A pure
 * read of the session; never mutates sim state, so no golden is touched.
 */
function netMarsSlice(t: number): import("./orrery/orrery").NetRenderState["mars"] {
  const mc = netSession.contractById(ACT4_MARS_CONTRACT_ID);
  if (mc === null) return null; // act4 not yet reached — no Mars opportunity on the board.
  // The deep-space relay's presence (the leg bridges by construction once it is up — solveMarsLeg).
  const relay = netSession.sats.find((s) => s.id.startsWith("MARS-RELAY")) ?? null;
  const earth = eph.position("earth", t);
  const relayPosM =
    relay !== null
      ? ((): Vec3 => {
          const rel = solveOrbit(relay.orbit, t);
          return [earth[0] + rel[0], earth[1] + rel[1], earth[2] + rel[2]];
        })()
      : null;
  const oneWayS = interBodyOneWayLatencyS(eph, "earth", "mars", t);
  // The crawl cycle: a signal re-launches every oneWayS and crawls Earth→Mars at light speed, so
  // progress = (t mod oneWayS) / oneWayS. Only shown once the relay is up (presence-based path).
  const crawlProgress = relay !== null && oneWayS > 0 ? (t % oneWayS) / oneWayS : null;
  const ageS = netSession.marsAgeS(t);
  const freshness = netSession.marsFreshness(t);
  // The breadcrumb-placed one-shot flash: the cache breadcrumb re-captures the sample at "now"
  // (age ≈ 0), so a near-zero age right after a place reads as "freshness jumped to full".
  const breadcrumbPlaced = ageS !== null && ageS < NET_MARS_BREADCRUMB_FLASH_S;
  return {
    id: mc.region.id,
    relayLaunched: relay !== null,
    relayPosM,
    oneWayS,
    crawlProgress,
    sampleAgeS: ageS,
    freshness,
    breadcrumbPlaced,
  };
}

/** Act-4 — how fresh (sim-seconds of age) the Mars sample must be to read as a just-placed cache
 * breadcrumb (the "freshness jumped to full" flash). A short window so the cue fires right after a
 * place + the sample-freeze-on-arrival, then settles into the standing "data arrives OLD" readout. */
const NET_MARS_BREADCRUMB_FLASH_S = 5.0;

/** Act-2 — the current teaching contract for the render: the live availability demand (REGION-1)
 * once the scenario has emitted it, else REGION-0. So the orrery's hand-off render + sawtooth
 * meter follow the act the player is on. Pure read of the net session. */
function currentNetContract(): ReturnType<NetSession["contractById"]> {
  const r1 = netSession.contractById(ACT2_CONTRACT_ID);
  if (r1 !== null && r1.state !== "completed" && r1.state !== "failed") return r1;
  return netSession.contractById(ACT1_CONTRACT_ID);
}

/** Act-2 — the per-sat footprints covering a contract's region centre this instant: for each
 * sat that BRIDGES the region centre (its own up+down links both close), a disc parked over the
 * sat's NADIR (its sub-point projected to the surface), so the discs sweep as the sats orbit.
 * A render-only read of the SAME geometry the router uses (link-budget bridge check); never
 * mutates sim state. */
function coveringFootprints(
  c: NonNullable<ReturnType<NetSession["contractById"]>>,
  t: number,
  add: (rel: Vec3) => Vec3,
): { centerPosM: Vec3; radiusRad: number }[] {
  const out: { centerPosM: Vec3; radiusRad: number }[] = [];
  const grounds = [...netSession.grounds];
  if (grounds.length === 0) return out;
  const point = { latRad: c.region.latRad, lonRad: c.region.lonRad };
  for (const s of netSession.sats) {
    // Does THIS sat alone bridge the region centre right now (up+down close, via ANY ground)?
    // The single-sat list reuse keeps this truthful to the router's per-sat link check.
    const bridge = bridgeForPoint(eph, point, grounds, [s], t);
    if (bridge.satId === null) continue;
    // The sat's nadir: its earth-relative position direction projected onto the surface.
    const satRel = satPositionRelative(eph, s, t);
    const r = Math.hypot(satRel[0], satRel[1], satRel[2]);
    if (r <= 0) continue;
    const k = A1_BODY_RADIUS_M / r;
    out.push({
      centerPosM: add([satRel[0] * k, satRel[1] * k, satRel[2] * k]),
      radiusRad: c.region.radiusRad * 1.15,
    });
  }
  return out;
}

/** Act-2 — the RENDER-ONLY availability history ring buffers (one per contract id), a derived
 * display like the packet trail — NOT in the snapshot/fold (so no sim golden is touched). Each
 * push appends the live rolling value + trims to the meter length, returning the trace. */
const netAvailHistory = new Map<string, number[]>();
const NET_AVAIL_TRACE_LEN = 48;
function pushAvailHistory(contractId: string, value: number): number[] {
  let h = netAvailHistory.get(contractId);
  if (h === undefined) {
    h = [];
    netAvailHistory.set(contractId, h);
  }
  h.push(value);
  if (h.length > NET_AVAIL_TRACE_LEN) h.splice(0, h.length - NET_AVAIL_TRACE_LEN);
  return h.slice();
}

/**
 * net/ A4 — project the net roster into the orrery's {@link BuildRenderState} so the EXISTING
 * sat-marker + orbit-plane-ring render path draws the launched net sats (no duplicate mesh
 * machinery): each net sat's earth-relative {@link solveOrbit} position is shifted by earth's
 * ephemeris position into a world point + its Kepler orbit handed over for the dashed ring. No
 * heatmap/DC/coverage concern in net mode (those are empty), so the shell never lights — the
 * net region/footprint overlay carries the Act-1 coverage cue instead. PURE reads of the net
 * session.
 */
function netBuildRenderState(): BuildRenderState {
  const t = clock.seconds;
  const earth = eph.position("earth", t);
  // net/ Act-3b — the faulting-sat set (amber-pulse on the orrery): the ids the live NetSession
  // reports as carrying an ACTIVE fault this step (degradation / transient / telegraphed). A pure
  // read of the session's folded fault state; the orrery pulses those markers amber.
  const faultingIds = new Set(netSession.faults.map((f) => f.satId));
  const assets = netSession.sats.map((s) => {
    const rel = solveOrbit(s.orbit, t);
    const posM: Vec3 = [earth[0] + rel[0], earth[1] + rel[1], earth[2] + rel[2]];
    const eirp = s.loadout.reduce((m, a) => Math.max(m, a.eirp), 0);
    return { id: s.id, kind: "sat" as const, posM, eirp, orbit: s.orbit, faulting: faultingIds.has(s.id) };
  });
  return {
    assets,
    datacenters: [],
    coveredDemandFraction: 0,
    groundCount: 0,
    satCount: assets.length,
    balanceEur: netSession.balance,
    bankrupt: false,
    totalDemand: 0,
    baselineDemand: 0,
  };
}

/**
 * net/ A4 — LAUNCH the SELECTED preset (design §2.3/§5): append a net_launch action at the
 * current tick (radians + SI metres on the wire) and DEFER it to drain post-step via the
 * SHARED applyNetAction (the SAME step-then-post-drain order the replay golden uses). The
 * default GEO PARK already parks over REGION-0 — pressing LAUNCH on it wins Act 1.
 */
function netLaunch(): void {
  // LAUNCH the LIVE EDITABLE DRAFT (§3.1) — the orbit the player dragged, not a fixed preset. The
  // presetId is recorded only while the draft still matches a preset (for the readout); a hand-
  // dragged orbit carries no preset id. RAAN crosses the wire only when dragged off 0 (golden-safe).
  const preset = netPresetCursor >= 0 ? NET_PLANNER_PRESETS[netPresetCursor] : null;
  const label = preset ? preset.label : "CUSTOM ORBIT";
  const action = netLaunchAction(
    {
      presetId: preset?.id,
      semiMajorM: netDraft.semiMajorM,
      incRad: netDraft.incRad,
      subLonRad: netDraft.subLonRad,
      raanRad: netDraft.raanRad,
      count: netDraft.count,
    },
    clock.tick,
  );
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "sats_launched") {
    // Some members may still have been lost to the §3.5 failure roll (a partial-loss batch): note the
    // survivors + the cost, and warn about any failures so the wallet hit is legible.
    const failed = res.failedCount ?? 0;
    log.append({
      tSim: clock.seconds,
      sev: failed > 0 ? "warn" : "info",
      entity: "NET-LAUNCH",
      value: `${label} · −€${Math.round(res.costEur)}`,
      msg:
        failed > 0
          ? `${label} reached orbit (${failed} lost to a launch failure — €${Math.round(res.costEur)} charged) — drag the orbit so its ground-track covers the dark region`
          : `${label} reached orbit (€${Math.round(res.costEur)} charged) — drag the orbit so its ground-track covers the dark region`,
    });
  } else if (res && res.kind === "launch_failed") {
    // THE LAUNCH WHOLLY FAILED (every member lost the §3.5 risk roll): the sat/batch is lost, but you
    // PAID the launch provider anyway (the cost is charged win or lose). Surface it in SYSTEM.LOG.
    log.append({
      tSim: clock.seconds,
      sev: "warn",
      entity: "NET-LAUNCH",
      value: `LAUNCH FAILURE · −€${Math.round(res.costEur)}`,
      msg: `${label} LAUNCH FAILED — the vehicle was lost; €${Math.round(res.costEur)} charged (you pay the provider win or lose). Try again.`,
    });
  }
}

/**
 * net/ A4 — ACCEPT the Act-1 REGION-0 contract (design §2.2/§5): record a net_accept action
 * at the current tick + apply it via the SHARED applyNetAction. The parked GEO is already
 * serving the whole disc, so the contract earns from the first served step — the launch→
 * cover→PAID chain closes.
 */
function netAccept(contractId?: string): void {
  // Accept the named contract, else the first OFFERED one (so the headline ACCEPT button + the
  // CONTRACTS-view inline buttons both work; falls back to REGION-0 for the Act-1 cold open).
  const id =
    contractId ??
    netSession.contracts.find((c) => c.state === "offered")?.id ??
    ACT1_CONTRACT_ID;
  const action = netAcceptAction(id, clock.tick);
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "contract_accepted") {
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "NET-CONTRACT",
      value: id,
      msg: `accepted ${id} — serve it to EARN (the wallet ticks while served)`,
    });
  }
}

/**
 * net/ Act-4 — PLACE the ONE Mars cache breadcrumb (design §4.5 / §8, "data closer helps"): record
 * a net_place_cache action at the current tick + apply it via the SHARED applyNetAction. It
 * re-captures the Mars sample at "now" (age ≈ 0 ⇒ the freshness readout JUMPS back to full by
 * sight), then drains again. It does NOT change served/breach or revenue (a FELT breadcrumb, not a
 * relief lever; §8 fenced). A no-op before the Mars path has carried (no sample to refresh yet).
 */
function netPlaceMarsCache(): void {
  const mc = netSession.contractById(ACT4_MARS_CONTRACT_ID);
  if (mc === null) return; // act4 not reached — no Mars opportunity yet.
  const action = netPlaceCacheAction(clock.tick);
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "cache_placed") {
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "MARS-CACHE",
      value: "placed",
      msg: "cache breadcrumb placed near Mars — freshness jumps to full (then drains again by sight)",
    });
  }
}

/**
 * net/ Act-4 — DEBUG SEED (render-only; the headless-screenshot affordance). Drive the LIVE net
 * session straight to the act4 Mars VIEW so a shot can land on the frontier WITHOUT playing the
 * ~460 s gated arc. Deterministic + idempotent. It uses ONLY the session's public mutation surface
 * (the SAME methods the live game uses): force the scenario cursor to act4 (so the next step emits
 * the Mars opportunity), launch the MARS RELAY, step the session, accept the Mars contract, step
 * again (so solveMarsLeg presence-bridges it + the sample FREEZES one-way old on arrival), then
 * place the cache breadcrumb. This is NOT a sim/action/replay path: the replay harness constructs
 * its OWN NetSession from the golden action log and NEVER calls this, so the three goldens are
 * untouched. NOT recorded to the SaveGame log (it is a render seed, not player input). Clearly
 * DEBUG-labelled. Called ONCE at boot ONLY when `?netview=mars` / `?netact=4` is present.
 */
/** net/ Act-4 — the DEBUG-view sample-ageing nudge (sim-seconds): how far the debug seed advances
 * the LIVE clock after the sample freezes, so the "as of Nm ago" staleness + the desaturation read
 * visibly OLD in the screenshot (freshness ≈ 0.3–0.4 against the ~15 min Earth↔Mars half-life). */
const NET_MARS_DEBUG_AGE_S = 400.0;
function seedNetMarsDebugView(): void {
  const t = clock.seconds;
  // (1) Force the cursor to act4 (index 4 in M1_SCENARIO: act1, act2, act3a, act3b, act4). Each
  //     advanceCursor bumps the cursor + stamps a gate tick; the next step's emit fires act4 only
  //     (the intermediate beats' emits are skipped — we only need the Mars opportunity + relay).
  while (netSession.cursor < 4) netSession.advanceCursor(Math.round(t / DT));
  // (2) Step once so the act4 beat EMITS the Mars contract onto the board (the same in-step emit
  //     the live scenario engine runs). Pure step on the live session.
  netSession.step(eph, t, DT);
  // (3) Launch the MARS RELAY via the SHARED applier (the SAME net_launch verb + preset the player
  //     presses). Its presence bridges the Mars leg by construction (solveMarsLeg). Render-only seed
  //     ⇒ NOT recorded to the save log.
  applyNetAction(eph, netSession, netLaunchAction({
    presetId: MARS_RELAY_PRESET.id,
    semiMajorM: MARS_RELAY_PRESET.draft.semiMajorM,
    incRad: MARS_RELAY_PRESET.draft.incRad,
    subLonRad: MARS_RELAY_PRESET.draft.subLonRad,
    count: 1,
  }, clock.tick), DT);
  // (4) Step + accept + step so the Mars path carries and the sample FREEZES (one-way old on
  //     arrival, SD-19). The accept moves MARS-1 OFFERED → ACTIVE; the next step's solve serves it.
  netSession.step(eph, t, DT);
  applyNetAction(eph, netSession, netAcceptAction(ACT4_MARS_CONTRACT_ID, clock.tick), DT);
  netSession.step(eph, t, DT);
  // (5) Make the staleness READ visibly old: nudge the live clock forward a few minutes so the
  //     sample's age (and the desaturation) reads OLD by sight in a screenshot. Render-only — the
  //     clock is a LIVE concern, NOT the replay tick driver (the goldens drive ticks directly). The
  //     resulting freshness ≈ 2^(−age/oneWay) ≈ 0.3–0.4 (clearly stale). Re-step at the new time.
  clock.setTick(clock.tick + Math.round(NET_MARS_DEBUG_AGE_S / DT));
  netSession.step(eph, clock.seconds, DT);
  log.append({
    tSim: clock.seconds,
    sev: "warn",
    entity: "DEBUG",
    value: "netview=mars",
    msg: "DEBUG VIEW — net session seeded at the Act-4 Mars frontier (relay launched, sample present). Not reached in normal play; does NOT affect replay.",
  });
}

/**
 * P1 (GDD §5) — DEBUG SEED for THE LIVE NETWORK (the headless-screenshot affordance). Drive the LIVE
 * net session to a MULTI-SAT served state so a shot shows real region→sat→ground links (coloured by
 * utilisation, with the constellation hand-off) WITHOUT playing the full gated arc. Uses ONLY the
 * session's public mutation surface (the SAME verbs the live game uses): launch the parked GEO +
 * accept REGION-0 (Act 1, one served beam), launch the N=4 LEO_SWEEP constellation + accept REGION-1
 * (Act 2, the multi-sat hand-off — the beam migrates as the router re-solves to the rising sat), then
 * enable escalation so the shared-link utilisation grows and the link tint warms by sight. Steps the
 * live session a bounded number of fixed ticks so the solves settle + the load aggregates. NOT a
 * sim/action/replay path (the replay harness builds its own session + never reads this), so the three
 * goldens are provably untouched. NOT recorded to the SaveGame log (a render seed, not player input).
 */
function seedNetLiveNetworkDebugView(): void {
  const t = clock.seconds;
  const geo = NET_PLANNER_PRESETS.find((p) => p.id === "GEO_PARK") ?? NET_PLANNER_PRESETS[0];
  const leo = NET_PRESETS.find((p) => p.id === "LEO_SWEEP");
  // (1) ACT 1 — the parked GEO over REGION-0, then accept it (one served region→sat→ground beam).
  applyNetAction(eph, netSession, netLaunchAction({
    presetId: geo.id,
    semiMajorM: geo.draft.semiMajorM,
    incRad: geo.draft.incRad,
    subLonRad: geo.draft.subLonRad,
    count: 1,
  }, clock.tick), DT);
  netSession.step(eph, t, DT);
  applyNetAction(eph, netSession, netAcceptAction(ACT1_CONTRACT_ID, clock.tick), DT);
  // (2) Step until the act2 gate fires (REGION-0 served+paid opens act2 — the scenario emits REGION-1).
  //     Bounded: state-gated, so a small budget of fixed ticks reaches it deterministically.
  for (let i = 0; i < 200 && netSession.cursor < 2; i++) netSession.step(eph, t, DT);
  // (3) ACT 2 — the N=4 LEO_SWEEP constellation as ONE batch (the §3.4 hand-off constellation), then
  //     accept the availability-axis REGION-1. The beam MIGRATES from the setting sat to the rising
  //     one each re-solve (the hand-off, drawn). Only if the LEO preset + the act2 contract are live.
  if (leo !== undefined && netSession.contractById(ACT2_CONTRACT_ID) !== null) {
    applyNetAction(eph, netSession, netLaunchAction({
      presetId: leo.id,
      semiMajorM: leo.semiMajorM,
      incRad: leo.incRad,
      subLonRad: leo.subLonRad,
      count: ACT2_ZERO_GAP_N,
      phaseSpreadRad: (2 * Math.PI) / ACT2_ZERO_GAP_N,
    }, clock.tick), DT);
    netSession.step(eph, t, DT);
    applyNetAction(eph, netSession, netAcceptAction(ACT2_CONTRACT_ID, clock.tick), DT);
  }
  // (4) Enable escalation so the shared-link utilisation grows (the §4.3 congestion colour warms by
  //     sight). Same flag the act3a beat flips; pure (no physics). Then step a bounded run so the
  //     constellation holds REGION-1 served, the hand-off plays, and the load aggregates onto sats.
  netSession.enableEscalation();
  for (let i = 0; i < 400; i++) netSession.step(eph, t + i * DT, DT);
  clock.setTick(clock.tick + 400);
  netSession.step(eph, clock.seconds, DT);
  log.append({
    tSim: clock.seconds,
    sev: "warn",
    entity: "DEBUG",
    value: "netview=net",
    msg: "DEBUG VIEW — net session seeded multi-sat served (GEO + N=4 LEO constellation, escalation on) so the live region→sat→ground links draw. Not reached in normal play; does NOT affect replay.",
  });
}

/**
 * net/ — apply a net action via the SHARED {@link applyNetAction} at the current tick AND
 * record it to the SaveGame log (only when it actually took, mirroring the m2 build handlers).
 * The action's step for clock.tick already ran in the prior drain, so applying here is the
 * SAME "step then post-step apply" order the replay golden uses — live == replay. Returns the
 * outcome for the caller's log decision (null on a non-net action / no-op).
 */
function applyAndRecordNetAction(action: SimAction): ReturnType<typeof applyNetAction> {
  const res = applyNetAction(eph, netSession, action, DT);
  if (res && res.kind !== "rejected") addAction(save, action);
  return res;
}

/** Cycle the selected planner preset (GEO PARK ↔ LEO SWEEP) — a one-click setter that RE-SEEDS the
 * editable draft from the preset (the floor); the player drags from there (the ceiling). */
function cycleNetPreset(): void {
  // From a hand-dragged draft (cursor −1) the cycle lands on the first preset; else it advances.
  const next = netPresetCursor < 0 ? 0 : (netPresetCursor + 1) % NET_PLANNER_PRESETS.length;
  netSelectPreset(NET_PLANNER_PRESETS[next].id);
  const p = NET_PLANNER_PRESETS[netPresetCursor];
  log.append({
    tSim: clock.seconds,
    sev: "info",
    entity: "NET-PRESET",
    value: p.label,
    msg: `selected · press LAUNCH to commit`,
  });
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
  // net/ Act-1 — drive the NET session on the SAME fixed tick (design §4): step() runs the
  // scenario emit (REGION-0 onto the board) + serve/breach + revenue + the gate. A net action
  // is recorded at clock.tick and applied IMMEDIATELY in its handler (after THIS tick's step
  // has already run in the prior drain) — exactly the m2 build pattern, which is byte-identical
  // to the replay golden's "step at atTick, then apply post-step" order. Stepped every tick so
  // the scenario is live the instant net mode boots (the contract is offered before launch).
  // ALWAYS stepped (net mode is the live game; cache mode steps it too, harmlessly inert).
  netSession.step(eph, t, DT);

  // THE CACHE / M2-BUILD SIM IS CACHE-MODE ONLY. In net mode the connectivity game is the
  // whole world; stepping the cache session here is what leaked the mars_imagery/EARTH→MARS
  // misses, the Earth→Mars packet crawl, and the cache-framed FINANCE/SYSTEM.LOG into the
  // connectivity opening (the "we're still focusing on caching" confusion). Gating it OUT of
  // net mode keeps the cache/M2/Mission worlds CONSTRUCTED-BUT-INERT (so FrameState.demand keeps
  // a well-typed idle shape) and steps them only under ?mode=cache — byte-identical to before.
  if (netMode) return;

  // The Mission advances the orrery's single Earth→Mars packet crawl (the visible
  // aggregate wait). E9: it no longer feeds the SYSTEM.LOG — the log is the
  // TRUTHFUL sim event stream (session.events), rendered each frame below.
  mission.update(t);
  demand = session.step(eph, t);
  // M2d — drive the BUILD session's per-tick contract economy on the SAME fixed tick:
  // offer/expire contracts deterministically + accrue coverage revenue into the build
  // wallet (DT-invariant, summed once per step). This is what CLOSES the §3 loop — the
  // coverage the player built now EARNS € back. Same shared step() the replay drives.
  build.step(eph, t, DT);
  // The Mission's single Earth→Mars packet represents the AGGREGATE in-flight
  // wait (all feeds share the same geometry); the orrery draws a packet PER feed
  // in flight from the per-feed readout. Launch the packet whenever any leg is
  // crawling and none is shown (a render concern only — the real per-feed launch
  // is already logged as a fetch_launch event inside session.step()).
  if (demand.fetchesInFlight > 0 && mission.packet === null) {
    mission.launch(t);
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
    // net/ Act-1 — NO Earth→Mars packet crawl in the connectivity game (it is the cache
    // Mission's visible wait, deferred to the Act-4 Mars teaser). The Mission is not even
    // stepped in net mode, but gate the provider too so a mode toggle can never leak a packet.
    if (netMode) return null;
    const p = mission.packet;
    return p ? { fromId: p.fromId, toId: p.toId, progress: p.progress, freshness: p.freshness } : null;
  },
  // M2c — hand the orrery the live build roster + coverage score each frame (only
  // read when the heatmap is up, so it costs nothing while the shell is off). In net
  // mode the build roster is empty (the net session is the live world), so the markers
  // path simply draws the net sat fed through the SAME provider below.
  build: () => (netMode ? netBuildRenderState() : buildRenderState()),
  // net/ Act-1 — the live region/footprint slice (design §6); read only in net render mode.
  net: () => netRenderState(),
});
// net/ Act-1 — flip the orrery into NET RENDER MODE while net mode is the active app mode,
// so the toy globe (sized to A1_BODY_RADIUS_M) is visible and the parked GEO holds station.
// OFF for the M1-cache mode (every existing framing is byte-identical to before this flag).
orrery.netRenderMode = netMode;

const log = new SystemLog();
const telemetry = new Telemetry();
// net/ Act-1 — FINANCE reads the connectivity-game economy (wallet/revenue/earned/roster) in
// net mode instead of the cache freshness-premium/cache-slots readout (fix: stop surfacing the
// caching game in the connectivity opening). Byte-identical cache view under ?mode=cache.
const finance = new Finance(netMode);
// THE PARSE (§4.12 / §5 view #9) — the reviewable-at-rest legible record. It holds
// no sim state; refreshParse() folds the truthful event log into a RunParse and
// hands it over whenever the player opens the PARSE view (preset 6 / key G).
const parse = new ParsePanel();
// M2d — THE CONTRACTS BOARD (GDD §4.9 / §3): the coverage-revenue loop made glanceable.
// Holds no sim state; main.ts hands it a per-frame ContractsRenderState projected from
// the live BuildSession (offers + active served% + the earn).
const contractsPanel = new Contracts();
// M-fleet — THE FLEET TILE (GDD §5 / §4.2): the focused body's constellation. Holds no
// sim state; main.ts hands it a per-frame Fleet projected from the orrery's focused body
// + the live roster + the dataset sats. Summonable via the SD-36 rail (the FLEET button).
const fleetPanel = new FleetPanel();
// net/ Act-1 — THE LAUNCH PLANNER (design §2.3/§5/§6): the offered REGION-0 contract + the
// presets + the truthful consequence preview + the LAUNCH/ACCEPT buttons. Holds no sim state;
// main.ts hands it a per-frame NetPlannerRenderState and wires the buttons to the net loop
// (the launch/accept appliers + the preset cursor). Summonable via the LAUNCH rail button.
// net/ M1 (SD-44 PHASE 1) — the SHARED launch/accept/prefer actions object (the appliers + the preset
// cursor). The monolithic NetPlanner used it; the THREE split tiles (NET·LAUNCH / CONTRACTS / ROUTING·
// PREFER) all take the SAME object so the loop wiring is identical no matter which tile fires the verb.
const netPlannerActions = {
  // A preset click SETS the draft (the floor, §3.1); the player drags from there (the ceiling).
  onSelectPreset: (id: string) => netSelectPreset(id),
  // §3.1 — a slider drag EDITS one draft parameter to a normalized 0..1 position; each edit re-runs
  // previewLaunch so the on-globe consequence (footprint + ground-track + coverage gap) moves live.
  onEditDraft: (field: import("./panels/net-planner").NetDraftField, pos: number) => {
    const b = NET_DRAFT_BOUNDS[field];
    netEditDraft(field, b.min + pos * (b.max - b.min));
  },
  onLaunch: () => netLaunch(),
  onAccept: (id?: string) => netAccept(id),
  // Act-2 — the phasing assist's batch launch (the §3.4 launch-as-a-batch): one press places
  // the suggested phased constellation into a plane. Same shared applier the keys + replay use.
  onConstellation: () => netConstellation(),
  // Act-2 — dial the constellation SIZE on the held-vs-capex ladder before committing (UI-only).
  onConstellationStep: (delta: number) => netConstellationStep(delta),
  // §7.3/§10 — the per-contract prefer control (the FIRST thing the player tunes): CYCLE which
  // active contract is tuned, and DRAG the latency↔bandwidth↔stability slider (→ net_set_prefer →
  // the router re-solves that contract → its path re-routes on the globe via the P1 link line).
  onSelectPreferContract: () => netCyclePreferContract(),
  onSetPrefer: (contractId: string, pos: number) => netSetPrefer(contractId, pos),
};
// The cache-mode monolithic planner (kept for ?mode=cache; net mode mounts the split tiles instead).
const netPlannerPanel = new NetPlanner(netPlannerActions);
// net/ M1 (SD-44 PHASE 1) — THE THREE SPLIT MISSION-CONTROL TILES: NET·LAUNCH (the verb + the dead-clear
// WHAT/WHERE headline), CONTRACTS (the deal board + ACCEPT), ROUTING·PREFER (the per-contract tuner).
// All take the SAME actions object + the SAME per-frame NetPlannerRenderState.
const netLaunchPanel = new NetLaunch(netPlannerActions);
const netContractsPanel = new NetContracts(netPlannerActions);
const netPreferPanel = new NetPrefer(netPlannerActions);
// net/ M1 (SD-44 PHASE 1) — THE NEW MISSION-CONTROL DASHBOARDS: the OVERVIEW triage board, the
// CONNECTIVITY coverage roster, the ROUTING link-load board, and the REFERENCE how-it-works page.
const statusBoardPanel = new StatusBoard();
const coverageRosterPanel = new CoverageRoster();
const linkLoadPanel = new LinkLoad();
const howtoPanel = new Howto();

// net/ M1 — THE ONBOARDING POPUPS (the briefing cards): one dismissible 1-bit info card per CORE
// CONCEPT, mounted over the whole window (the app root) so it reads over every tile + the rail. Net
// mode ONLY (never constructed in ?mode=cache). Render/UI only — drainNetOnboarding (below) fires
// the card for the CURRENT concept off the scenario cursor each frame; the card is shown ONCE per
// session + dismissed via GOT IT / Esc / click-out (the clock keeps running underneath).
const onboarding = netMode ? new Onboarding(app) : null;

// Latest Earth→Mars line-of-sight state, refreshed each frame — drives the orrery
// titlebar lamp. The link is dead inside the solar-interference CORRIDOR (E10a),
// not only when the physical disk occults (which never happens in this eph).
let lastBlackedOut = false;

// --- E10c — THE FORESHADOW NUDGE (the onboarding minor) ---------------------
// A passive player who reaches the watch band must understand the stakes + the
// control. We fire a ONE-SHOT orchestration NOTICE into SYSTEM.LOG the first time
// the Sun-miss margin crosses INTO the watch band (the same band the orrery gauge
// starts filling at) — surfacing both the looming blackout AND the speed keys. It
// POINTS at the controls; it does NOT move the clock (GDD Risk-6: the waiting is
// decision-space, the player still manages feeds/policy/pre-stage). It rides the
// SystemLog.append legacy path (a non-event system line), so the TRUTHFUL sim event
// stream stays pure (§4.12 honesty). The conjunction epoch is found once by a cheap
// pure forward scan so the notice can read "in N days".
let conjunctionNudged = false;
const CONJ_EPOCH_SECONDS = ((): number => {
  let best = { t: clock.seconds, m: Number.POSITIVE_INFINITY };
  for (let tt = clock.seconds; tt <= clock.seconds + 4e6; tt += 2000) {
    const m = earthMarsLos(eph, tt).marginSolarRadii;
    if (m < best.m) best = { t: tt, m };
  }
  return best.t;
})();

const orreryHandle: PanelHandle = {
  title: "ORRERY",
  content: orrery.host,
  subtitle: () => `· ${orrery.subtitle()}`,
  status: () => (lastBlackedOut ? "crit" : "ok"),
  onResize: (w, h) => orrery.resize(w, h),
};

// net/ M1 (SD-44 PHASE 1) — the host registry the Shell mounts presets from. In NET mode it carries the
// FIVE mission-control desktops' hosts (the three split net tiles + the four dashboards + telemetry,
// which net presets now use) and does NOT register the monolithic "net-planner" (the cache-only tile).
// In CACHE mode it is byte-identical to before — the M2 CONTRACTS / FLEET / net-planner set.
const registry = new Map<string, PanelHandle>([
  ["orrery", orreryHandle],
  ["system-log", log],
  ["telemetry", telemetry],
  ["finance", finance],
  ["parse", parse],
]);
if (netMode) {
  registry.set("net-launch", netLaunchPanel);
  registry.set("net-contracts", netContractsPanel);
  registry.set("net-prefer", netPreferPanel);
  registry.set("status-board", statusBoardPanel);
  registry.set("coverage-roster", coverageRosterPanel);
  registry.set("link-load", linkLoadPanel);
  registry.set("howto", howtoPanel);
} else {
  registry.set("contracts", contractsPanel);
  registry.set("fleet", fleetPanel);
  registry.set("net-planner", netPlannerPanel);
}

const shell = new Shell(wmCanvas, registry);

// THE WINDOW-SUMMON RAIL — the right-edge vertical button rail that summons any panel
// into the focused tile LIVE (the owner's core ask). Built once; it wires itself to
// shell.onActivePanelsChange for its active-state repaint (event-driven, never per-frame).
// On a summon that brings THE PARSE in, fold the run-so-far so the record is fresh.
// net/ Act-1 — net mode offers ONLY the net-relevant rail set (NET_RAIL_PANELS: globe, LAUNCH,
// SYSTEM.LOG, FINANCE, PARSE) so the cache/M2/M3 panels (TELEMETRY feeds, the M2 CONTRACTS board,
// FLEET) are not summonable here. Cache mode keeps the full RAIL_PANELS.
const windowRail = new WindowRail(shell, netMode ? NET_RAIL_PANELS : RAIL_PANELS, (host, changed) => {
  if (host === "parse" && changed) refreshParse(true);
});
wmCanvas.appendChild(windowRail.element);
// Reserve the collapsed rail's strip (34px, matches .window-rail width) so the tiles
// never sit under it; the rail's hover-expand overlays transiently on top.
shell.setReservedRight(34);

// --- WM presets -------------------------------------------------------------
// net/ Act-1 — net mode is a DIFFERENT game from the cache/M2/M3 economy, so it uses its OWN
// preset set (NET_PRESET_SPECS): the layouts mount ONLY net-relevant panels (the NET·LAUNCH
// planner, the FINANCE/wallet readout, SYSTEM.LOG) — NOT the MARS-CACHE feeds / M2 CONTRACTS
// board / FLEET tile. Cache mode keeps the original PRESET_SPECS, byte-for-byte unchanged.
const presets = (netMode ? NET_PRESET_SPECS : PRESET_SPECS).map((spec) => ({ name: spec.name, grid: buildGrid(spec) }));
let wmPresetName = presets[0].name;

function setWmPreset(i: number): void {
  if (i < 0 || i >= presets.length) return;
  wmPresetName = presets[i].name;
  shell.setPreset(presets[i].name, presets[i].grid);
  // net/ M1 (SD-44 PHASE 1) — set the orrery CAMERA by the desktop NAME so each operating desktop opens
  // at the right framing: OVERVIEW + CONNECTIVITY → EARTH (near-body, where sats + footprints read
  // large); ROUTING → ORBITS (pulled back so the live links read across the constellation). BUSINESS +
  // REFERENCE don't mount the orrery, so the camera is left as-is.
  if (netMode) {
    if (wmPresetName === "OVERVIEW" || wmPresetName === "CONNECTIVITY") orrery.setPreset(0); // EARTH
    else if (wmPresetName === "ROUTING") orrery.setPreset(2); // ORBITS
    // #14 — HERO globe framing per desktop. The bare EARTH preset frames the toy globe at ~3px (its
    // scene radius is tiny); only a sphere-FILL dolly makes it legible. OVERVIEW is the triage glance,
    // so frame Earth as a clear central hero with room for the constellation around it; CONNECTIVITY
    // (where you launch) frames it a touch larger so the regions/footprints read. ROUTING stays pulled
    // back (fill 0) so the live links read across the whole constellation.
    if (wmPresetName === "OVERVIEW") orrery.setNetHeroFraming(0.34);
    else if (wmPresetName === "CONNECTIVITY") orrery.setNetHeroFraming(0.42);
    else orrery.setNetHeroFraming(0);
  }
  // PARSE lives on the REFERENCE desktop now (the §4.12 reviewable-at-rest record). Force-fold the run
  // summary on entry so it reflects the live log even on a paused run (the per-frame caller is dirty-
  // checked). In cache mode PARSE still lives on REVIEW. Summoning PARSE via the rail does the same.
  if (wmPresetName === "REFERENCE" || wmPresetName === "REVIEW") refreshParse(true);
}

/**
 * E10c — fold the truthful event log into a {@link RunParse} and hand it to the
 * PARSE panel. PURE read of the run: a {@link RunContext} (the feed roster's ids,
 * the run-start/now ticks, opening/current balance) drives {@link parseRun} over
 * `session.events`. This NEVER mutates sim state — the parse is a read-only summary,
 * so the replay golden is untouched. Called on PARSE-view entry + the toggle key.
 *
 * Dirty-checked: the per-frame caller skips the full re-fold + DOM rebuild unless
 * the truthful log actually grew (`events.appended` changed) since the last parse,
 * so a PARSE view left open on a paused/quiet run costs nothing. `force` (used on
 * view-open) re-renders regardless, so opening the panel always reflects the log.
 */
let lastParseAppended = -1;
function refreshParse(force = false): void {
  if (!force && session.events.appended === lastParseAppended) return;
  lastParseAppended = session.events.appended;
  const ctx: RunContext = {
    feeds: session.feeds.map((f) => ({ id: f.id, datasetId: f.datasetId })),
    startTick: SCENARIO.tick0,
    endTick: clock.tick,
    startTSim: SCENARIO.tick0 * DT,
    endTSim: clock.seconds,
    openingBalance: OPENING_BALANCE,
    closingBalance: session.economy.balance,
    slotCapacity: session.cache.capacity,
  };
  parse.render(parseRun(session.events, ctx));
}

status.setPresetTabs(presets.map((p) => p.name));
// net/ M1 (SD-44 PHASE 1) — BOOT INTO THE OVERVIEW TRIAGE WALL (index 0): the orrery hero + the
// STATUS·BOARD + FINANCE, so the cold player starts on "is anything wrong now?" rather than the crammed
// launch panel. The cache-mode boot is unchanged (PRESET_SPECS index 0 is its PLAY layout).
setWmPreset(0);
// Focus the orrery so the cold player starts on the large central toy globe (the OVERVIEW desktop
// mounts it). Guarded to when the orrery is actually visible (it is on OVERVIEW).
if (netMode && shell.visibleHosts().includes("orrery")) {
  shell.setFocus("orrery");
}

// initial boot: mission boot triplet + first demand evaluation (may launch a packet)
tickSim(clock.seconds);

// net/ Act-4 — DEBUG VIEW seed (render-only; ?netview=mars / ?netact=4). Drive the LIVE session to
// the act4 Mars frontier so a headless screenshot can reach the Mars VIEW without the full gated
// arc, then frame the SYSTEM preset (the Earth→Mars money shot) + pause so the crawl + the stale
// read sit still for the shot. NEVER reached in normal play; NOT a sim/action/replay path (the
// replay harness builds its own session) — the three goldens are provably untouched.
if (netDebugView) {
  seedNetMarsDebugView();
  orrery.setPreset(3); // SYSTEM — the Earth↔Mars span (the frontier money shot).
  if (!clock.paused) clock.togglePause(); // freeze the crawl + the stale read for the shot.
}
// P1 (GDD §5) — DEBUG VIEW seed for THE LIVE NETWORK (?netview=net / ?netact=3): drive the live
// session to a multi-sat served state so a headless screenshot shows the real region→sat→ground
// links (coloured by utilisation + the hand-off), framed at EARTH (the near-body view where the sats
// visibly orbit) + paused so the web sits still for the shot. Never reached in normal play; NOT a
// sim/action/replay path (the replay harness builds its own session) — the three goldens are untouched.
else if (netLiveDebugView) {
  seedNetLiveNetworkDebugView();
  orrery.setPreset(0); // EARTH — the near-body framing where the constellation + links read large.
  if (!clock.paused) clock.togglePause(); // freeze the hand-off so the links sit still for the shot.
}

// E10a/E10b — DEV-ONLY time seek so the screenshot harness can jump to a precise
// ephemeris instant. With the E10b scenario epoch (boot at t0 = 14.5e6 s) the
// arc is now reachable in-session by playing at 1000×, but the seek still lets a
// shot land EXACTLY on a beat: the approach (e.g. WATCH at t ≈ 15.07e6 s, margin
// 9 Rsun) or the conjunction blackout (window enter ≈ 15.44e6 s, conj ≈ 15.73e6
// s). NOTE seekSim takes ABSOLUTE ephemeris-seconds (not mission-elapsed).
// Stripped from production builds (import.meta.env.DEV), so it never bloats the
// shipped shell. Seeks the clock to `tSeconds`, pauses, and re-primes the session
// by stepping once at that time so the CONJUNCTION/BLACKOUT readout reflects it.
if (import.meta.env.DEV) {
  (window as unknown as { seekSim?: (tSeconds: number) => void }).seekSim = (tSeconds: number) => {
    clock.setTick(Math.round(tSeconds / DT));
    if (!clock.paused) clock.togglePause();
    session.step(eph, clock.seconds, DT);
    tickSim(clock.seconds);
  };
  // §3 — DEV-ONLY orrery introspection for the headless planner-globe verify (tools/verify-planner-
  // globe.mjs): confirms the operated body is a REAL SphereGeometry (NOT a billboard), reports its
  // operated body id (body-agnostic — read from the net slice), and the smoothed planner-focus value
  // (0 normal framing → 1 close-up). Stripped from production builds. Render-only read.
  (window as unknown as { netGlobeDebug?: () => unknown }).netGlobeDebug = () => orrery.netGlobeDebug();
}

// --- keyboard ---------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key;
  // §3.1 — THE PLANNER DRAFT NUDGE KEYS (net mode, the headless-drivable ceiling control): the
  // arrow keys nudge the two parameters that matter first (§3.1) — Up/Down = ALTITUDE (the GEO/LEO
  // axis), Left/Right = INCLINATION (which latitudes you reach); `[`/`]` nudge PHASE and `{`/`}`
  // (shift-bracket) nudge RAAN. Each re-runs previewLaunch so the on-globe footprint + ground-track
  // + coverage gap move live. Gated to net mode so cache mode keeps its `[`/`]` freshness controls.
  if (netMode && netDraftNudgeKey(k)) {
    e.preventDefault();
    return;
  }
  // net/ M1 (SD-44) — THE NET CONTROL SCHEME: a clean, fresh pass. The old pile of cache-era keys is
  // CUT in net mode entirely — net mode handles ONLY this minimal, collision-free set and RETURNS, so
  // no shortcut "does nothing here" and there is no C camera/constellation clash:
  //   1–5 switch desktop · 0 reset layout · Space pause · ,/. speed · ↑↓ alt · ←→ inc · [ ] phase
  //   (handled above by netDraftNudgeKey) · L launch · R reset camera.
  // ACCEPT, CONSTELLATION (PLACE SET), and the PREFER tune are PANEL BUTTONS now (on BUSINESS /
  // CONNECTIVITY / ROUTING), never global keys. The desktop sets the camera, so E/C/O/S/T are gone;
  // and F/P/H/D/B/M/'/N/J/A/; (all cache-mode verbs) never fire in net mode.
  if (netMode) {
    if (k >= "1" && k <= "5") setWmPreset(Number(k) - 1);
    else if (k === "0") shell.reset();
    else if (k === " ") {
      e.preventDefault();
      clock.togglePause();
      recordScale();
    } else if (k === ",") {
      clock.slower();
      recordScale();
    } else if (k === ".") {
      clock.faster();
      recordScale();
    } else if (k === "l" || k === "L") {
      netLaunch();
    } else if (k === "r" || k === "R") {
      orrery.resetCamera();
    }
    return; // net mode: nothing else is a key (the rest are panel buttons / cache-only verbs).
  }
  // --- cache mode (?mode=cache) keymap below — unchanged ---
  if (k >= "1" && k <= "5") setWmPreset(Number(k) - 1);
  else if (k === "0") shell.reset();
  else if (k === "g" || k === "G") {
    // G — TOGGLE THE PARSE (§4.12 reviewable-at-rest record). PARSE is a panel summoned via the right
    // rail. G is the keyboard parity: SUMMON it into the focused tile if it is off-screen, else jump to
    // its at-rest home desktop (REFERENCE in net mode, REVIEW in cache mode). Summoning folds the run.
    if (shell.visibleHosts().includes("parse")) {
      const home = netMode ? "REFERENCE" : "REVIEW";
      setWmPreset(presets.findIndex((p) => p.name === home));
    } else windowRail.summonParse();
  }
  // Camera presets, by name. EARTH (the near-body framing where sats visibly orbit) is
  // the boot default; E re-frames it. C/O/S/T keep their named presets (now shifted by
  // EARTH at index 0). See CAMERA_PRESETS in orrery.ts.
  else if (k === "e" || k === "E") orrery.setPreset(0); // EARTH (near-body, the default)
  else if (k === "c" || k === "C") {
    // net/ Act-2 — in NET mode C places the suggested phased CONSTELLATION as one batch (the
    // §3.3 assist + §3.4 batch launch) once the availability demand is live; otherwise (and in
    // cache mode) C is the CISLUNAR camera preset. The constellation is the act-2 verb, so the
    // game key wins in net mode the moment REGION-1 needs continuous coverage.
    const r1 = netMode ? netSession.contractById(ACT2_CONTRACT_ID) : null;
    if (r1 !== null && r1.state !== "completed" && r1.state !== "failed" && r1.activeAxes.has("availability")) {
      netConstellation();
    } else {
      orrery.setPreset(1); // CISLUNAR
    }
  }
  else if (k === "o" || k === "O") orrery.setPreset(2); // ORBITS
  else if (k === "s" || k === "S") orrery.setPreset(3); // SYSTEM (the Earth→Mars money shot)
  else if (k === "t" || k === "T") orrery.setPreset(4); // TOP-DOWN
  else if (k === "r" || k === "R") orrery.resetCamera();
  else if (k === "f") orrery.cycleFocus(1);
  else if (k === "F") orrery.cycleFocus(-1);
  else if (!netMode && (k === "h" || k === "H")) {
    // M2b — TOGGLE THE COVERAGE HEATMAP (GDD §5 view #2, the monument's first
    // visible cell). CACHE MODE ONLY — the heatmap belongs to the M2 build economy,
    // not the net connectivity game (the toy globe carries the net coverage cue via
    // the region/footprint/gap overlay instead). Render-only: it never touches the sim.
    orrery.toggleHeatmap();
  } else if (!netMode && (k === "d" || k === "D")) {
    // M2b — CYCLE the heatmap's information dimension (connectivity → bandwidth →
    // latency). CACHE MODE ONLY (rides the heatmap). Render-only.
    orrery.cycleDimension();
  } else if (!netMode && (k === "b" || k === "B")) {
    // M2c — DEPLOY a ground station at the next candidate site (the cheap, instant
    // coverage lever). CACHE MODE ONLY — ground-station deploy is the M2 build verb, not
    // a net-game verb. Recorded + applied via the shared applier; the web grows.
    deployGroundStation();
  } else if (k === "l" || k === "L") {
    // net/ Act-1 — in NET mode L LAUNCHES the selected planner preset (the parked GEO
    // PARK default already works). In cache mode L is the M2c sat launch.
    if (netMode) netLaunch();
    else launchSatellite();
  } else if (k === ";") {
    // net/ Act-1 — in NET mode ; cycles the planner preset (GEO PARK ↔ LEO SWEEP) for the
    // next L; in cache mode it cycles the M2c launch preset (LEO → MEO → GEO).
    if (netMode) {
      cycleNetPreset();
    } else {
      launchPresetCursor = (launchPresetCursor + 1) % LAUNCH_PRESETS.length;
      log.append({
        tSim: clock.seconds,
        sev: "info",
        entity: "LAUNCH-SEL",
        value: LAUNCH_PRESETS[launchPresetCursor].label,
        msg: `selected · €${Math.round(LAUNCH_PRESETS[launchPresetCursor].costEur)} · press L to launch`,
      });
    }
  } else if (!netMode && (k === "m" || k === "M")) {
    // M3a — PLACE an ORBITAL DATACENTER at the selected candidate site (GDD §4.5: compute as
    // infrastructure, a force-multiplier on the loop). CACHE MODE ONLY — the orbital-DC compute
    // economy is M3, not the net connectivity game. Recorded + applied via the shared applier;
    // it lifts served revenue in its edge-compute footprint, bounded by its power+thermal compute.
    placeDatacenter();
  } else if (!netMode && k === "'") {
    // M3a — cycle the selected DC candidate site (Earth regions → Moon → Mars) for the next M.
    // CACHE MODE ONLY (pairs with the M datacenter verb above).
    dcSiteCursor = (dcSiteCursor + 1) % DC_CANDIDATES.length;
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "DC-SEL",
      value: DC_CANDIDATES[dcSiteCursor].label,
      msg: `selected · press M to place an orbital datacenter`,
    });
  } else if (!netMode && (k === "n" || k === "N")) {
    // M2d — CYCLE the selected contract (the accept/decline target) among the live
    // offered + active ones. CACHE MODE ONLY (the M2 contracts board); UI cursor only.
    cycleSelectedContract(k === "N" ? -1 : 1);
  } else if (k === "k" || k === "K") {
    // net/ Act-1 — in NET mode K ACCEPTS the REGION-0 contract (close the serve→pay loop);
    // in cache mode K accepts the targeted M2d offered contract.
    if (netMode) netAccept();
    else acceptSelectedContract();
  } else if (!netMode && (k === "j" || k === "J")) {
    // M2d — DECLINE the targeted OFFERED contract (it leaves the board, not taken). CACHE MODE
    // ONLY (the M2 contracts board has no decline verb in the single-contract net game).
    declineSelectedContract();
  }
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
    // net/ Act-4 — in NET mode P PLACES the ONE Mars cache breadcrumb (the §8 "data closer helps":
    // it re-captures the Mars sample at "now", so the freshness readout jumps back to full by sight).
    // Recorded + applied via the SHARED applyNetAction at the current tick (live == replay). In
    // cache mode P is the M1-06 manual prefetch (unchanged below).
    if (netMode) {
      netPlaceMarsCache();
    } else {
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
        // (The truthful "prefetch MANUAL" line is already logged inside the session.)
        if (mission.packet === null) mission.launch(clock.seconds);
      }
    }
  } else if (!netMode && (k === "a" || k === "A")) {
    // E8 — CYCLE the prefetch policy mode: manual → freshness → freshness_blackout
    // → manual. CACHE MODE ONLY (the M1 prefetch autopilot — no prefetch economy in the
    // net game). Switching it on is the tame-it lever: the autopilot takes over the
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
  lastBlackedOut = los.inCorridor;

  // E10c — the foreshadow nudge: once the margin first enters the watch band
  // (approach > 0), surface the looming blackout + the speed control, one-shot.
  // CACHE MODE ONLY — the nudge is cache-framed ("pre-stage the cache (P/A)") and the
  // Earth↔Mars conjunction blackout is the cache game's constraint, not the net game's.
  if (!netMode && !conjunctionNudged) {
    const approach = conjunctionApproach(los.marginSolarRadii, los.inCorridor, los.corridorRsun);
    if (approach > 0) {
      conjunctionNudged = true;
      const daysToConj = Math.max(0, Math.round((CONJ_EPOCH_SECONDS - t) / 86400));
      log.append({
        tSim: t,
        sev: "warn",
        entity: "CONJUNCTION",
        value: `${daysToConj}d`,
        msg: "blackout approaching — set time-accel ( , / . ) to ride it out, and pre-stage the cache (P / A) before the link drops",
      });
    }
  }

  const fs: FrameState = {
    simSeconds: t,
    missionElapsedSeconds: missionElapsedSeconds(t),
    scaleLabel: clock.scaleLabel,
    paused: clock.paused,
    wmPreset: wmPresetName,
    cameraPreset: orrery.presetName(),
    focusBody: orrery.focusId,
    earthMarsDistanceM: dist,
    oneWaySeconds: ow,
    losMarginSolarRadii: los.marginSolarRadii,
    losCorridorRsun: los.corridorRsun,
    losOcculted: los.occulted,
    losInCorridor: los.inCorridor,
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
    // net/ Act-1 — the connectivity-game economy for the FINANCE/STATUS chrome (net mode only;
    // undefined in cache mode, where `demand` drives them).
    netEconomy: netMode ? netEconomyState() : undefined,
  };

  // E9 — paint the truthful SYSTEM.LOG: drain the new tail of the sim event stream
  // (incremental, by seq) into the panel. The log IS the surfaced sim record.
  // CACHE MODE ONLY — in net mode the SYSTEM.LOG carries ONLY the connectivity game's lines
  // (the net loop's log.append calls + drainNetFaultLog/drainNetAct4Log + the objective beats);
  // rendering the cache session's events here is what flooded the opening with mars_imagery
  // MISS / fetch-launched-EARTH→MARS / cache-EVICT lines.
  if (!netMode) {
    log.render(session.events);
    // M2f — interleave the truthful M2 WORLD-event stream (demand shocks / rival actions / news)
    // into the same ledger: emergent story beats surface in SYSTEM.LOG, §8-highlighted (rivals in
    // their faction hue). Incremental drain by the M2 seq cursor; REAL world changes.
    log.renderM2(build.events);
  }
  telemetry.update(fs);
  finance.update(fs);
  status.update(fs);
  if (netMode) {
    // net/ M1 (SD-44 PHASE 1) — paint the FIVE mission-control desktops' net tiles. The three split
    // tiles (NET·LAUNCH / CONTRACTS / ROUTING·PREFER) take ONE shared per-frame NetPlannerRenderState;
    // the four dashboards take their own pure projections. Each panel rebuilds DOM only on change, so
    // painting an off-screen tile is cheap (the Shell only mounts the visible ones, but a detached
    // panel's render is a no-op churn-wise). The orrery planner overlay keys on the net-launch tile.
    const ns = netPlannerRenderState();
    netLaunchPanel.render(ns);
    netContractsPanel.render(ns);
    netPreferPanel.render(ns);
    statusBoardPanel.render(ns);
    coverageRosterPanel.render(netCoverageRosterState());
    linkLoadPanel.render(netLinkLoadState());
    howtoPanel.render(netSession.cursor);
  } else {
    // M2d — paint the CONTRACTS board (the offer list + the served% + the earn). Project
    // the live build session each frame; the panel rebuilds its rows only on a change.
    contractsPanel.render(contractsRenderState());
    // net/ Act-1 — paint the cache-mode LAUNCH PLANNER (kept for ?mode=cache).
    netPlannerPanel.render(netPlannerRenderState());
    // M-fleet — paint the FLEET tile: the satellites around the orrery's focused body
    // (SD-35 click-to-focus). Projected each frame from the focused body + the live roster
    // + the dataset sats; the panel rebuilds its rows only on a glanceable signature change
    // (X-02). Render/read-only — a pure SELECT over existing truth, no sim mutation.
    fleetPanel.render(fleetRenderState());
  }
  // net/ Act-3b — surface the live fault + trace state into SYSTEM.LOG (edge-triggered, render-only:
  // the amber-pulse degradation / telegraphed countdown + the first resilience shortfall).
  drainNetFaultLog();
  // net/ Act-4 — surface the MARS FRONTIER beat text + the "data arrives old" + the "to be
  // continued" stop into SYSTEM.LOG (edge-triggered, render-only — the cursor stops on act4).
  drainNetAct4Log();
  // net/ M1 — fire the ONBOARDING briefing card for the current concept off the scenario cursor
  // (act1 at the cold open; the rest as the cursor reaches them). Shown once each; render-only.
  drainNetOnboarding();
  // E10c — while THE PARSE panel is VISIBLE (the REVIEW preset, or summoned into any tile
  // via the rail), keep the reviewable record live (a read-only re-fold of the truthful
  // log; it never mutates sim state). Dirty-checked, so it costs nothing when not shown.
  if (shell.visibleHosts().includes("parse")) refreshParse();
  // Feed the glanceable readout (M1-10) + freshness-as-saturation, then render.
  orrery.setReadout(deriveReadout(fs));
  orrery.update(wallDt);
  shell.tickChrome();
  // Drain the one-way cue bus into the synth (no-op until a gesture unlocks audio).
  audio.pump(cueBus);

  requestAnimationFrame(frame);
}

requestAnimationFrame(frame);