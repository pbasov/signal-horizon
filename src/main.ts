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
  type PreviewWorld,
} from "./sim/net/world";
import { surfacePointRelative } from "./sim/net/link-budget";
import { ACT1_CONTRACT_ID } from "./sim/net/scenario";
import { NetPlanner, type NetPlannerRenderState } from "./panels/net-planner";
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
import { PRESET_SPECS, buildGrid } from "./wm/presets";
import { WindowRail } from "./wm/window-rail";
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
import type { ContractReadout, ContractsRenderState, FrameState } from "./types";

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

const status = new StatusStrip();

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
// APP MODE — Act 1 (net) is what BOOTS (the cold player sees + plays the connectivity game).
// The existing M1-cache / M2 / M3 wiring stays instantiable behind ?mode=cache (the live loop
// drives whichever world is active; net mode also flips orrery.netRenderMode so the toy globe
// is visible). The net session is ALWAYS stepped so the scenario emits + the loop is live the
// instant the mode is entered.
type AppMode = "net" | "cache";
const APP_MODE: AppMode =
  new URLSearchParams(window.location.search).get("mode") === "cache" ? "cache" : "net";
const netMode = APP_MODE === "net";
// The selected planner preset cursor (GEO PARK default that already works; LEO SWEEP sweeps).
let netPresetCursor = 0;
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
 * net/ A4 — build the LAUNCH PLANNER panel's per-frame {@link NetPlannerRenderState}: the
 * wallet, the REGION-0 contract (state + served + earned), the preset buttons, and the
 * TRUTHFUL consequence preview of the selected preset via the pure {@link previewLaunch}
 * (the SAME router + link budget the live world runs, so the preview == the post-commit
 * verdict). Pure reads of the net session; computed here so the panel stays a thin painter.
 */
function netPlannerRenderState(): NetPlannerRenderState {
  const t = clock.seconds;
  const selected = NET_PLANNER_PRESETS[netPresetCursor % NET_PLANNER_PRESETS.length];
  const preview = previewLaunch(eph, netPreviewWorld(), selected.draft, t, selected.costBaseEur);
  // The selected preset's per-REGION-0 preview slice (its consequence on the Act-1 demand).
  const slice = preview.contracts.find((c) => c.contractId === ACT1_CONTRACT_ID) ?? null;

  const c = netSession.contractById(ACT1_CONTRACT_ID);
  const solve = c ? netSession.lastSolveFor(c.id) : null;
  const shortfall = netSession.currentShortfall(t);

  return {
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
      selected: i === netPresetCursor % NET_PLANNER_PRESETS.length,
    })),
    preview: {
      coveredFraction: slice?.coveredFraction ?? 0,
      periodS: preview.periodS,
      latencyFloorS: slice?.latencyFloorS ?? Number.POSITIVE_INFINITY,
      costEur: preview.costEur,
      served: slice?.served ?? false,
    },
    launched: netSession.sats.length > 0,
    shortfall: shortfall?.message ?? null,
  };
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
  const c = netSession.contractById(ACT1_CONTRACT_ID);
  if (c === null) return { region: null, footprint: null };

  const solve = netSession.lastSolveFor(c.id);
  const served = c.state === "active" && (solve?.served ?? false);
  const center = add(surfacePointRelative(c.region.latRad, c.region.lonRad, t));
  const region = {
    id: c.region.id,
    centerPosM: center,
    radiusRad: c.region.radiusRad,
    served,
  };
  // The footprint sits over the region nadir once a covering sat is up (a parked GEO holds
  // station). Show it only when there is a sat AND the region is served (the cover beat).
  const footprint =
    served && netSession.sats.length > 0
      ? { centerPosM: center, radiusRad: c.region.radiusRad * 1.15 }
      : null;
  return { region, footprint };
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
  const assets = netSession.sats.map((s) => {
    const rel = solveOrbit(s.orbit, t);
    const posM: Vec3 = [earth[0] + rel[0], earth[1] + rel[1], earth[2] + rel[2]];
    const eirp = s.loadout.reduce((m, a) => Math.max(m, a.eirp), 0);
    return { id: s.id, kind: "sat" as const, posM, eirp, orbit: s.orbit };
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
  const preset = NET_PLANNER_PRESETS[netPresetCursor % NET_PLANNER_PRESETS.length];
  const action = netLaunchAction(
    {
      presetId: preset.id,
      semiMajorM: preset.draft.semiMajorM,
      incRad: preset.draft.incRad,
      subLonRad: preset.draft.subLonRad,
      count: preset.draft.count,
    },
    clock.tick,
  );
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "sats_launched") {
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "NET-LAUNCH",
      value: preset.label,
      msg: `${preset.label} reached orbit — footprint ${preset.id === "GEO_PARK" ? "parks over" : "sweeps past"} REGION-0`,
    });
  }
}

/**
 * net/ A4 — ACCEPT the Act-1 REGION-0 contract (design §2.2/§5): record a net_accept action
 * at the current tick + apply it via the SHARED applyNetAction. The parked GEO is already
 * serving the whole disc, so the contract earns from the first served step — the launch→
 * cover→PAID chain closes.
 */
function netAccept(): void {
  const action = netAcceptAction(ACT1_CONTRACT_ID, clock.tick);
  const res = applyAndRecordNetAction(action);
  if (res && res.kind === "contract_accepted") {
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "NET-CONTRACT",
      value: ACT1_CONTRACT_ID,
      msg: `accepted REGION-0 — serve it to EARN (the wallet ticks while served)`,
    });
  }
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

/** Cycle the selected planner preset (GEO PARK ↔ LEO SWEEP) for the next LAUNCH. */
function cycleNetPreset(): void {
  netPresetCursor = (netPresetCursor + 1) % NET_PLANNER_PRESETS.length;
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
  // net/ Act-1 — drive the NET session on the SAME fixed tick (design §4): step() runs the
  // scenario emit (REGION-0 onto the board) + serve/breach + revenue + the gate. A net action
  // is recorded at clock.tick and applied IMMEDIATELY in its handler (after THIS tick's step
  // has already run in the prior drain) — exactly the m2 build pattern, which is byte-identical
  // to the replay golden's "step at atTick, then apply post-step" order. Stepped every tick so
  // the scenario is live the instant net mode boots (the contract is offered before launch).
  netSession.step(eph, t, DT);
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
const finance = new Finance();
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
const netPlannerPanel = new NetPlanner({
  onSelectPreset: (id) => {
    const i = NET_PLANNER_PRESETS.findIndex((p) => p.id === id);
    if (i >= 0) netPresetCursor = i;
  },
  onLaunch: () => netLaunch(),
  onAccept: () => netAccept(),
});

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

const registry = new Map<string, PanelHandle>([
  ["orrery", orreryHandle],
  ["system-log", log],
  ["telemetry", telemetry],
  ["finance", finance],
  ["parse", parse],
  ["contracts", contractsPanel],
  ["fleet", fleetPanel],
  ["net-planner", netPlannerPanel],
]);

const shell = new Shell(wmCanvas, registry);

// THE WINDOW-SUMMON RAIL — the right-edge vertical button rail that summons any panel
// into the focused tile LIVE (the owner's core ask). Built once; it wires itself to
// shell.onActivePanelsChange for its active-state repaint (event-driven, never per-frame).
// On a summon that brings THE PARSE in, fold the run-so-far so the record is fresh.
const windowRail = new WindowRail(shell, undefined, (host, changed) => {
  if (host === "parse" && changed) refreshParse(true);
});
wmCanvas.appendChild(windowRail.element);
// Reserve the collapsed rail's strip (34px, matches .window-rail width) so the tiles
// never sit under it; the rail's hover-expand overlays transiently on top.
shell.setReservedRight(34);

// --- WM presets -------------------------------------------------------------
const presets = PRESET_SPECS.map((spec) => ({ name: spec.name, grid: buildGrid(spec) }));
let wmPresetName = presets[0].name;

function setWmPreset(i: number): void {
  if (i < 0 || i >= presets.length) return;
  wmPresetName = presets[i].name;
  shell.setPreset(presets[i].name, presets[i].grid);
  // REVIEW carries THE PARSE (the §4.12 reviewable-at-rest record). Force-fold the run
  // summary on entry so it reflects the live log even on a paused run (the per-frame
  // caller is dirty-checked). Summoning PARSE via the rail does the same (above).
  if (wmPresetName === "REVIEW") refreshParse(true);
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
setWmPreset(0); // PLAY (the default working layout)
// net/ Act-1 — BOOT INTO NET MODE: surface the LAUNCH planner so the cold player sees the
// Act-1 game (orrery hero on the left, the planner on the right where CONTRACTS sits). We
// swap the CONTRACTS tile for the net planner via the SAME shell summon the rail uses, then
// re-focus the orrery so the player starts on the globe. The cache-mode boot is unchanged.
if (netMode) {
  shell.setFocus("contracts");
  shell.summonPanel("net-planner");
  shell.setFocus("orrery");
}

// initial boot: mission boot triplet + first demand evaluation (may launch a packet)
tickSim(clock.seconds);

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
}

// --- keyboard ---------------------------------------------------------------
window.addEventListener("keydown", (e) => {
  if (e.repeat) return;
  const k = e.key;
  if (k >= "1" && k <= "3") setWmPreset(Number(k) - 1);
  else if (k === "0") shell.reset();
  else if (k === "g" || k === "G") {
    // G — TOGGLE THE PARSE (§4.12 reviewable-at-rest record). PARSE is no longer its own
    // preset (the 7→3 cut); it is a panel summoned via the right rail. G is the keyboard
    // parity for that: SUMMON it into the focused tile if it is off-screen, else jump to
    // the REVIEW layout (its at-rest home). Summoning folds the run summary (rail hook).
    if (shell.visibleHosts().includes("parse")) setWmPreset(presets.findIndex((p) => p.name === "REVIEW"));
    else windowRail.summonParse();
  }
  // Camera presets, by name. EARTH (the near-body framing where sats visibly orbit) is
  // the boot default; E re-frames it. C/O/S/T keep their named presets (now shifted by
  // EARTH at index 0). See CAMERA_PRESETS in orrery.ts.
  else if (k === "e" || k === "E") orrery.setPreset(0); // EARTH (near-body, the default)
  else if (k === "c" || k === "C") orrery.setPreset(1); // CISLUNAR
  else if (k === "o" || k === "O") orrery.setPreset(2); // ORBITS
  else if (k === "s" || k === "S") orrery.setPreset(3); // SYSTEM (the Earth→Mars money shot)
  else if (k === "t" || k === "T") orrery.setPreset(4); // TOP-DOWN
  else if (k === "r" || k === "R") orrery.resetCamera();
  else if (k === "f") orrery.cycleFocus(1);
  else if (k === "F") orrery.cycleFocus(-1);
  else if (k === "h" || k === "H") {
    // M2b — TOGGLE THE COVERAGE HEATMAP (GDD §5 view #2, the monument's first
    // visible cell). Render-only: it reads sat positions off the ephemeris and
    // never touches the sim/replay path, so the M1 golden is unaffected.
    orrery.toggleHeatmap();
  } else if (k === "d" || k === "D") {
    // M2b — CYCLE the heatmap's information dimension (connectivity → bandwidth →
    // latency). A free key beside the camera controls; render-only.
    orrery.cycleDimension();
  } else if (k === "b" || k === "B") {
    // M2c — DEPLOY a ground station at the next candidate site (the cheap, instant
    // coverage lever). Recorded + applied via the shared applier; the web grows.
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
  } else if (k === "m" || k === "M") {
    // M3a — PLACE an ORBITAL DATACENTER at the selected candidate site (GDD §4.5: compute as
    // infrastructure, a force-multiplier on the loop). Recorded + applied via the shared applier;
    // it lifts served revenue in its edge-compute footprint, bounded by its power+thermal compute.
    placeDatacenter();
  } else if (k === "'") {
    // M3a — cycle the selected DC candidate site (Earth regions → Moon → Mars) for the next M.
    dcSiteCursor = (dcSiteCursor + 1) % DC_CANDIDATES.length;
    log.append({
      tSim: clock.seconds,
      sev: "info",
      entity: "DC-SEL",
      value: DC_CANDIDATES[dcSiteCursor].label,
      msg: `selected · press M to place an orbital datacenter`,
    });
  } else if (k === "n" || k === "N") {
    // M2d — CYCLE the selected contract (the accept/decline target) among the live
    // offered + active ones. UI cursor only (no sim mutation, no logged action).
    cycleSelectedContract(k === "N" ? -1 : 1);
  } else if (k === "k" || k === "K") {
    // net/ Act-1 — in NET mode K ACCEPTS the REGION-0 contract (close the serve→pay loop);
    // in cache mode K accepts the targeted M2d offered contract.
    if (netMode) netAccept();
    else acceptSelectedContract();
  } else if (k === "j" || k === "J") {
    // M2d — DECLINE the targeted OFFERED contract (it leaves the board, not taken).
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
  lastBlackedOut = los.inCorridor;

  // E10c — the foreshadow nudge: once the margin first enters the watch band
  // (approach > 0), surface the looming blackout + the speed control, one-shot.
  if (!conjunctionNudged) {
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
  };

  // E9 — paint the truthful SYSTEM.LOG: drain the new tail of the sim event stream
  // (incremental, by seq) into the panel. The log IS the surfaced sim record.
  log.render(session.events);
  // M2f — interleave the truthful M2 WORLD-event stream (demand shocks / rival actions / news) into
  // the same ledger: emergent story beats surface in SYSTEM.LOG, §8-highlighted (rivals in their
  // faction hue). Incremental drain by the M2 seq cursor; the events are REAL world changes (a shock
  // line means the demand actually bumped; a relay-failure line means a contract was spawned).
  log.renderM2(build.events);
  telemetry.update(fs);
  finance.update(fs);
  status.update(fs);
  // M2d — paint the CONTRACTS board (the offer list + the served% + the earn). Project
  // the live build session each frame; the panel rebuilds its rows only on a change.
  contractsPanel.render(contractsRenderState());
  // net/ Act-1 — paint the LAUNCH PLANNER (the offered REGION-0 + presets + the truthful
  // consequence preview + the LAUNCH/ACCEPT face). Projected each frame from the live net
  // session; the panel rebuilds its DOM only on change.
  netPlannerPanel.render(netPlannerRenderState());
  // M-fleet — paint the FLEET tile: the satellites around the orrery's focused body
  // (SD-35 click-to-focus). Projected each frame from the focused body + the live roster
  // + the dataset sats; the panel rebuilds its rows only on a glanceable signature change
  // (X-02). Render/read-only — a pure SELECT over existing truth, no sim mutation.
  fleetPanel.render(fleetRenderState());
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