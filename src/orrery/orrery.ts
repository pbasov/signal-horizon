/**
 * Three.js orrery — the make-or-break view. Reproduces the design intent of the
 * Godot render/Orrery.cs:
 *   - FLOATING ORIGIN: positions come from the f64 ephemeris in metres; we
 *     subtract the f64 focus-body position BEFORE casting to f32 scene units, so
 *     precision survives at solar-system scale (mirrors FloatingOrigin.ToRender).
 *   - PER-PRESET LOG COMPRESSION: a visual radial fold (logScale·ln(1+d/logK))
 *     applied AFTER rebase so LEO/GEO rings and the Earth↔Mars span both read in
 *     one shot. It never feeds back into distance / light-delay math.
 *   - CONSTANT-SCREEN-SIZE dithered billboards (Bayer 4×4 terminator stipple).
 *   - DASHED orbit rings sampled from the real ephemeris.
 *   - A packet crawling Earth→Mars at honest light speed on SIM time, its colour
 *     desaturating toward machine-grey as freshness drains.
 *   - A BODY-ANCHORED orbit camera (drag az/el, wheel zoom) with four curated,
 *     smoothly-animated presets and an R reset.
 */
import * as THREE from "three";
import type { Ephemeris, Vec3 } from "../sim/ephemeris";
import type { Readout, FeedGlyphState } from "./readout";
import { fmtDuration, fmtPct } from "../format";
import { GeodesicGrid } from "../sim/coverage/grid";
import { type CellCoverage, coverageDimsAt } from "../sim/coverage/field";
import { DemandField } from "../sim/coverage/demand";
import { scoreCoverageAt } from "../sim/coverage/score";
import { CoverageOverlay } from "./coverage-overlay";
import { type CoverageDimension, DIMENSION_CYCLE, dimensionLabel } from "./heatmap-color";
import { orbitRenderRadius, type OrbitRenderScale } from "./orbit-render-scale";
import { pickNearest, type PickCandidate } from "./pick";
import { solveOrbit, orbitPeriodSeconds } from "../sim/m2/orbit";
import type { SatOrbit } from "../sim/m2/roster";
import { A1_BODY_RADIUS_M, A1_RENDER_BAND_M } from "../sim/net/world";

const DEG = Math.PI / 180;

/** Per-feed state glyph (the redundant, colour-off shape channel for the map). */
const FEED_GLYPH: Record<FeedGlyphState, string> = {
  fresh: "◆",
  stale: "◇",
  fetching: "▸",
  miss: "○",
  blackout: "▰",
};

/** Per-feed state tone class (colour reinforces the glyph; never the sole channel). */
const FEED_TONE: Record<FeedGlyphState, string> = {
  fresh: "good",
  stale: "warn",
  fetching: "watch",
  miss: "dead",
  blackout: "bad",
};

/** How many in-flight feed packets the orrery will draw at once (capped). */
const MAX_FEED_PACKETS = 5;

export interface CameraPreset {
  name: string;
  focus: string;
  az: number;
  el: number;
  dist: number;
  fov: number;
  /** compression knee (metres) */
  logK: number;
  /** compression gain (scene units) */
  logScale: number;
  /** Near-body orbit de-squash band (metres). When set, points within this distance
   * of the focus body are radially RE-RADII'd (orbit-render-scale) BEFORE the log-fold
   * so near-body orbits/sats separate from the parent disc and sweep visibly. Identity
   * (no de-squash) when undefined — system-scale presets keep the honest log-fold only. */
  orbitBandM?: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  // EARTH — the new DEFAULT framing. A tight Earth-focused shot with the near-body
  // de-squash ON, so LEO/GEO + deployed sats render CLEAR of the Earth disc and the
  // player SEES them sweep as the clock advances (the screensaver → game fix #1). The
  // band holds LEO..GEO comfortably inside the Moon distance (Moon ≈ 3.84e8 m), so the
  // Moon ring + everything past it stays on the honest log-fold (identity de-squash).
  { name: "EARTH", focus: "earth", az: 20 * DEG, el: 24 * DEG, dist: 3.0, fov: 48, logK: 6.0e7, logScale: 1.25, orbitBandM: 2.0e8 },
  { name: "CISLUNAR", focus: "earth", az: 0 * DEG, el: 22 * DEG, dist: 3.2, fov: 50, logK: 2.0e8, logScale: 1.4, orbitBandM: 1.2e8 },
  { name: "ORBITS", focus: "earth", az: 35 * DEG, el: 30 * DEG, dist: 5.0, fov: 46, logK: 9.0e6, logScale: 1.15, orbitBandM: 8.0e7 },
  { name: "SYSTEM", focus: "sun", az: 0 * DEG, el: 24 * DEG, dist: 11, fov: 50, logK: 9.0e10, logScale: 3.6 },
  { name: "TOP-DOWN", focus: "sun", az: 0 * DEG, el: 88 * DEG, dist: 13, fov: 46, logK: 9.0e10, logScale: 3.6 },
];

export interface PacketRenderState {
  fromId: string;
  toId: string;
  progress: number;
  freshness: number;
}

/** M2c — one placeable asset's render descriptor (the orrery draws a marker for it
 * + uses its world position to drive the live coverage heatmap). */
export interface BuildAssetRender {
  id: string;
  kind: "ground" | "sat";
  /** World position (metres, ecliptic) at the frame's sim-time — the roster's pure
   * Kepler/surface position. The orrery rebases it like any body. */
  posM: Vec3;
  /** Link budget EIRP (drives the coverage sweep). */
  eirp: number;
  /** For a launched SAT: its Kepler elements, so the orrery can draw a dashed orbital-
   * plane RING (fix #2) sampled from the sat's own orbit — exactly like the dataset
   * LEO/GEO rings. Undefined for a ground station. */
  orbit?: SatOrbit;
  /** net/ Act-3b — true while this sat carries an ACTIVE FAULT (a degradation haircut, a
   * transient outage, or a telegraphed countdown): the marker PULSES AMBER (the §8 "a working
   * node is degrading" cue). Render-only — driven from the live NetSession's `faults`. */
  faulting?: boolean;
}

/** M3a — one placed ORBITAL DATACENTER's render descriptor (GDD §4.5): a distinct §8 node on
 * the orrery + the resolved power/thermal/compute readout that the corner overlay shows. The
 * world position is the DC's body sub-point (rebased like a body); the rest is pure derived
 * physics from main.ts. */
export interface DCRender {
  id: string;
  label: string;
  /** World position (metres, ecliptic) of the DC's body sub-point at the frame's sim-time. */
  posM: Vec3;
  /** Heliocentric distance (AU) of the DC's body — the 1/d² flux driver. */
  distanceAU: number;
  /** Usable power (W) = solar(1/d²) + RTG. */
  powerW: number;
  /** Rejectable heat (W) — the radiative-only thermal cap. */
  rejectableHeatW: number;
  /** Usable compute budget (units) = min(power-limited, thermal-limited). */
  computeUnits: number;
  /** True iff the THERMAL ceiling is the binding one (thermally throttled). */
  thermalLimited: boolean;
  /** The bounded revenue MULTIPLIER (≥ 1.0) this DC's compute applies in its footprint. */
  liftMultiplier: number;
}

/** M2c — the LIVE build roster + coverage score the orrery renders (the monument).
 * Supplied per-frame by main.ts from the pure BuildSession; the orrery reads it to
 * (1) draw ground-station + sat markers, (2) sweep the heatmap off the LIVE roster,
 * and (3) show the coverage-score readout that rises as you build. */
export interface BuildRenderState {
  assets: BuildAssetRender[];
  /** M3a — the placed orbital datacenters (a SMALL set — §4.5) + their power/thermal/compute. */
  datacenters: DCRender[];
  /** Covered-demand fraction ∈ [0,1] — the headline "the web grew" readout. */
  coveredDemandFraction: number;
  /** Ground-station + launched-sat counts (the "size of the monument"). */
  groundCount: number;
  satCount: number;
  /** On-hand € (build-vs-budget) + bankruptcy (overspent). */
  balanceEur: number;
  bankrupt: boolean;
  /** M2e — the ESCALATION ENGINE readout: the CURRENT total demand (grows where you serve)
   * vs the BASELINE it started from. demandGrowth = total/baseline − 1 ∈ [0,2] is how far the
   * served network has grown the demand — the "I solved this, and now it's bigger" cue. */
  totalDemand: number;
  baselineDemand: number;
}

/** net/ Act-1 — the live NET render slice (design §6): the highlighted region (lit the
 * instant the router reports it SERVED, dim otherwise) + the launched sat's footprint, in
 * the TOY-radius world. Supplied per-frame by main.ts from the pure NetSession + previewLaunch;
 * the orrery reads it ONLY while {@link Orrery.netRenderMode} is on. World positions are
 * earth-relative metres in the toy frame (the orrery rebases them like any body). */
export interface NetRenderState {
  /** The Act-1 region: its body-fixed surface world point, angular radius, and SERVED state. */
  region: {
    id: string;
    /** Earth-relative world position (m) of the region-centre surface point at this t. */
    centerPosM: Vec3;
    /** Angular radius of the region disc (radians) — sizes the lit disc on the globe. */
    radiusRad: number;
    /** True the instant router.solve reports the region SERVED (lit); false ⇒ dim. */
    served: boolean;
  } | null;
  /**
   * Act-2 — the HAND-OFF render (design §6, the make-or-break "footprint snaps over the
   * region" beat generalized to a constellation). ONE disc per covering sat: with a single
   * LEO this is one disc that sweeps off the region every pass (the sawtooth — coverage drops
   * each time it sets); with a phased constellation several discs sweep so that as one slides
   * off the region another slides on — the region stays SERVED across the hand-off (the lit
   * disc never goes dim). Empty until a covering sat is up. Was a single `footprint` in Act 1;
   * generalized to a list here (Act 1 simply supplies a one-element list). */
  footprints: {
    /** Earth-relative world position (m) of the footprint-centre surface point (the nadir). */
    centerPosM: Vec3;
    /** Angular radius of the footprint disc (radians). */
    radiusRad: number;
  }[];
  /**
   * Act-2 — the AVAILABILITY SAWTOOTH meter (design §4.4 axis-2 / §6). The rolling held-
   * fraction over the trailing hand-off window vs the SLA bar, plus a short render-only ring
   * buffer of recent values so the orrery can draw the SAWTOOTH (a lone LEO / N≤3 dips every
   * orbit; the N=4 constellation FLATTENS at the bar — "motion is the antagonist", tamed). A
   * derived display (computed in main.ts from `contract.lastAvailability`), NOT in the
   * snapshot/fold — like the existing packet trail. Null when no availability axis is active. */
  availability: {
    /** The live rolling availability ∈ [0,1] (the meter's current value — `lastAvailability`). */
    value: number;
    /** The SLA bar ∈ [0,1] the value must hold above (`slaAvail`) — the threshold line. */
    bar: number;
    /** Render-only recent-value history (oldest→newest), the sawtooth trace. */
    history: number[];
  } | null;
}

export interface OrreryCtx {
  eph: Ephemeris;
  now(): number;
  packet(): PacketRenderState | null;
  /** M2c — the live build roster + coverage score (null until wired). */
  build?(): BuildRenderState | null;
  /** net/ Act-1 — the live region/footprint slice, read only in net render mode. */
  net?(): NetRenderState | null;
}

interface BodySpec {
  id: string;
  px: number;
  color: [number, number, number];
  terminator: boolean;
  glow: boolean;
}

const BODIES: BodySpec[] = [
  { id: "sun", px: 58, color: [1.0, 0.93, 0.8], terminator: false, glow: true },
  { id: "earth", px: 40, color: [0.84, 0.88, 0.98], terminator: true, glow: false },
  { id: "mars", px: 28, color: [0.96, 0.82, 0.74], terminator: true, glow: false },
  { id: "moon", px: 16, color: [0.82, 0.82, 0.88], terminator: true, glow: false },
  { id: "sat_leo", px: 9, color: [1.0, 0.62, 0.18], terminator: false, glow: false },
  { id: "sat_geo", px: 9, color: [1.0, 0.62, 0.18], terminator: false, glow: false },
];

const RING_IDS = ["earth", "mars", "moon", "sat_leo", "sat_geo"];
const RING_SAMPLES = 180;
const FOCUS_ORDER = ["sun", "earth", "mars", "moon"];

/** The body the coverage grid sits on. */
const COVERAGE_BODY_ID = "earth";
/** DEMAND·GROWTH readout guard: the minimum SANE baseline-demand denominator (below this the
 * ratio is meaningless) and the maximum SANE growth % to render. The escalation engine bounds
 * total demand at the global carrying cap (≈3× baseline ⇒ +200%), so anything beyond this is a
 * sim blow-up, not a real readout — we omit the segment rather than paint scientific notation. */
const DEMAND_GROWTH_EPSILON = 1e-9;
const DEMAND_GROWTH_MAX_PCT = 1000;
/** Max placed-asset markers the orrery draws at once (the marker pool size). The
 * coverage sweep itself is unbounded; only the on-screen marker glyphs are capped. */
const MAX_BUILD_MARKERS = 48;
/** Max DC nodes the orrery draws at once. A DC is a SMALL number of high-impact strategic
 * nodes (GDD §4.5 / Risk-5 — NOT a base-builder), so the pool is deliberately tiny. */
const MAX_DC_MARKERS = 8;
/** Earth billboard px (mirrors the BODIES "earth" entry) — used to size the shell
 * so it hugs the Earth disc on screen. Kept in one place. */
const EARTH_BILLBOARD_PX = 40;
/** Near-body de-squash tunables (render-only visual lie — see orbit-render-scale.ts).
 * The surface LIFT (metres) puts even the lowest orbit clear of the parent disc; the
 * concave altitude EXPONENT (< 1) fans LEO/MEO/GEO into clearly separate visual radii.
 * Identity below the surface + beyond the per-preset band, so ground stations / the
 * disc / the Moon ring / Earth↔Mars are all untouched. */
const ORBIT_DESQUASH_LIFT_M = 1.8e7;
const ORBIT_DESQUASH_ALT_EXPONENT = 0.32;
/** NET-MODE de-squash tunables (design §6 / Decision-G), scaled to the TOY world. The toy
 * band is ~1002 km over a 300 km body — three orders of magnitude smaller than the real
 * Earth↔GEO span — so the system-scale 1.8e7 m lift (18 000 km, larger than the whole toy
 * band) would invert the concave curve. These toy-scaled constants keep `lift < (band −
 * surface)` (the {@link OrbitRenderScale} invariant): the lift (120 km) puts the LEO clear of
 * the 300 km disc, and the exponent fans the toy GEO/LEO into separate visual radii. Used
 * ONLY when {@link Orrery.netRenderMode} is on — the off-mode de-squash is unchanged. */
const NET_ORBIT_DESQUASH_LIFT_M = 1.2e5;
const NET_ORBIT_DESQUASH_ALT_EXPONENT = 0.32;
/** Click-to-focus pick tolerance (px): a click within this of a billboard's projected
 * centre selects + focuses it. Generous, since billboards are constant-screen-size. */
const PICK_TOLERANCE_PX = 26;
/** Act-2 — max footprint discs the orrery draws at once (the hand-off pool). A constellation
 * is a small set (the measured zero-gap N=4, plus headroom for over-build); only the on-screen
 * discs are capped, the served verdict itself is unbounded. */
const MAX_NET_FOOTPRINTS = 12;
/** Launched-sat orbit rings: samples per ring (matches the dataset ring density). */
const SAT_RING_SAMPLES = 96;
/** Max launched-sat orbit rings drawn at once (a pool; the roster sat count is small). */
const MAX_SAT_RINGS = 24;

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uSunDirView;
  uniform float uTerminator;
  uniform float uCell;
  in vec2 vUv;
  out vec4 fragColor;
  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec3 N = vec3(p.x, p.y, sqrt(max(0.0, 1.0 - r * r)));
    float lambert = mix(1.0, clamp(dot(N, normalize(uSunDirView)), 0.0, 1.0), uTerminator);
    float bright = mix(0.10, 0.95, lambert);
    bright = max(bright, smoothstep(0.90, 1.0, r) * lambert * 0.9); // sunlit limb rim
    ivec2 ip = ivec2(mod(gl_FragCoord.xy / uCell, 4.0));
    float threshold = (BAYER[ip.y * 4 + ip.x] + 0.5) / 16.0;
    if (bright < threshold) discard;
    fragColor = vec4(uColor, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uCell;
  in vec2 vUv;
  out vec4 fragColor;
  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float bright = pow(max(0.0, 1.0 - r), 2.2);
    ivec2 ip = ivec2(mod(gl_FragCoord.xy / uCell, 4.0));
    float threshold = (BAYER[ip.y * 4 + ip.x] + 0.5) / 16.0;
    if (bright < threshold) discard;
    fragColor = vec4(uColor, 1.0);
  }
`;

interface Frame {
  az: number;
  el: number;
  dist: number;
  fov: number;
  logK: number;
  logScale: number;
  /** Near-body orbit de-squash band (metres); 0 = de-squash off (identity). Animated
   * across preset changes like the other camera fields so the transition is smooth. */
  orbitBandM: number;
}

export class Orrery {
  readonly host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private w = 1;
  private h = 1;

  private cur: Frame;
  private tgt: Frame;
  focusId: string;
  /** The CLICK-/F-selected asset id (a body, a placed asset, or a DC), or null. Drives
   * the selection ring + is the click-to-focus target. Set on click/F, not per frame. */
  selectedId: string | null = null;
  private activePreset = 0; // EARTH — the near-body framing where sats visibly orbit (the default)
  /**
   * NET RENDER MODE (design §6 / Decision-G): when true, the near-body de-squash is driven
   * from the TOY body radius {@link A1_BODY_RADIUS_M} (300 km) + band {@link A1_RENDER_BAND_M}
   * instead of the real `eph.radiusMeters("earth")` (6371 km) — otherwise the toy GEO/LEO
   * radii log-fold to sub-pixel and the make-or-break Act-1 viz collapses. SCOPED STRICTLY:
   * when OFF (the default), the M1-cache / M2 / M3 framings are byte-identical to before this
   * flag existed (the de-squash reads the real radius exactly as it always did). Set by the
   * net-game wiring (A4 human pass); default OFF so every existing framing is unaffected. */
  netRenderMode = false;

  private bodyMeshes = new Map<string, THREE.Mesh>();
  private haloMesh?: THREE.Mesh;
  /** Mars cache-freshness halo — the redundant SHAPE channel for §8 saturation. */
  private marsHalo: THREE.Mesh;
  private rings = new Map<string, { line: THREE.LineSegments; rel: Vec3[] }>();
  private packetMesh: THREE.Mesh;
  /** E7 — a pool of per-feed packet discs (one crawler per in-flight feed, capped). */
  private feedPackets: THREE.Mesh[] = [];
  private linkLine: THREE.LineSegments;
  private labels = new Map<string, HTMLElement>();
  private labelLayer: HTMLElement;
  /** On-canvas camera-preset buttons (one per CAMERA_PRESET), keyed by preset index, so
   * {@link paintCameraButtons} can light the active one. Built once; clicking calls the
   * SAME setPreset path the E/C/O/S/T hotkeys use. */
  private cameraButtons: HTMLButtonElement[] = [];
  /** Latest glanceable readout (M1-10), painted into the overlay each frame. */
  private readout: Readout | null = null;
  /** Cached readout sub-nodes (grabbed once) so paintReadout never queries DOM. */
  private roFreshGlyph!: HTMLElement;
  private roFreshVal!: HTMLElement;
  private roFreshFill!: HTMLElement;
  private roSlotsVal!: HTMLElement;
  private roPolicyVal!: HTMLElement;
  private roFeeds!: HTMLElement;
  private roCountRow!: HTMLElement;
  private roCountVal!: HTMLElement;
  private roConjVal!: HTMLElement;
  private roConjFill!: HTMLElement;
  private roBlackout!: HTMLElement;

  /** The live near-body de-squash for the current focus + animated orbit band (fix #1).
   * Rebuilt each frame by {@link refreshOrbitScale}; null = de-squash off (identity). */
  private orbitScale: OrbitRenderScale | null = null;

  private quad = new THREE.PlaneGeometry(1, 1);
  private tmpV = new THREE.Vector3();
  // scratch reused every frame — the hot loop allocates no new Vector3/Color
  private _rp = new THREE.Vector3();
  private _rp2 = new THREE.Vector3();
  private _earthR = new THREE.Vector3();
  private _marsR = new THREE.Vector3();
  private _sunDir = new THREE.Vector3();
  private readonly _amber = new THREE.Color(1.0, 0.62, 0.18);
  /** net/ Act-3b — the healthy signal-green a built sat marker reads at rest (the amber pulse for a
   * faulting sat lerps from THIS toward {@link _amber}). Matches the buildMarkers' seed colour. */
  private readonly _buildGreen = new THREE.Color(0.62, 1.0, 0.78);
  private readonly _grey = new THREE.Color(0.36, 0.36, 0.4);
  private readonly _pkColor = new THREE.Color();
  // Mars freshness-as-saturation scratch: a saturated "hot data" Mars that bleeds
  // toward the machine-grey as the cached copy stales (reuses the packet's path).
  private readonly _marsHot = new THREE.Color(1.0, 0.5, 0.26);
  private readonly _marsColor = new THREE.Color();
  /** Live Mars cache freshness in [0,1], pushed by {@link setReadout}. */
  private marsFreshness = 0;
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };

  // --- M2b/M2c coverage heatmap (GDD §5 view #2 — the monument) --------------
  /** The static geodesic grid (built once) the shell mesh + coverage sweep use. */
  private coverageGrid = GeodesicGrid.build();
  /** The demand field over the grid (built once) — the score's denominator. */
  private demandField = DemandField.build(this.coverageGrid);
  /** The shell mesh + per-frame re-colour (the heatmap render). */
  private coverageOverlay: CoverageOverlay;
  /** Preallocated per-cell coverage results — reused every frame (no alloc storm). */
  private coverageScratch: CellCoverage[];
  /** Active heatmap dimension (connectivity/bandwidth/latency); the 'd' key cycles it. */
  private coverageDimension: CoverageDimension = "connectivity";
  /** M2c — the latest covered-demand fraction (the live monument readout). */
  private coveredDemandFraction = 0;
  /** Per-frame scratch: each asset's EIRP + world position (grown as the roster grows). */
  private coverageEirps: number[] = [];
  private coverageAssetPos: Vec3[] = [];
  /** Scratch for Earth's rebased shell position (no per-frame Vector3 alloc). */
  private _shellPos = new THREE.Vector3();

  // --- M2c placed-asset markers (ground stations + launched sats) ------------
  /** Pooled marker billboards reused across frames (no per-frame mesh alloc). */
  private buildMarkers: THREE.Mesh[] = [];
  /** Latest build render state (roster + coverage score), set per-frame by main.ts. */
  private buildState: BuildRenderState | null = null;

  // --- M3a orbital-datacenter markers (a distinct §8 compute node) -----------
  /** Pooled DC node discs (distinct hot-violet signal nodes — the §8 compute glyph) +
   * their compute halos (a corona scaled by the DC's compute budget), reused per frame. */
  private dcMarkers: THREE.Mesh[] = [];
  private dcHalos: THREE.Mesh[] = [];

  // --- launched-sat orbit rings (fix #2 — the monument's orbital planes) ------
  /** Pooled dashed orbit-plane rings for the ROSTER's launched sats — drawn exactly
   * like the dataset LEO/GEO rings, one per launched sat, in the sat's own body-relative
   * frame. Each carries the body-relative sampled orbit (rebased + folded each frame) +
   * the sat's parent id. The pool is rebuilt ONLY when the roster's sat set changes
   * (X-02 — never per frame), keyed by {@link satRingSig}. */
  private satRings: { line: THREE.LineSegments; rel: Vec3[]; parentId: string }[] = [];
  /** Signature of the launched-sat set the rings were last built for (id + epoch + a).
   * When the live roster's signature differs, {@link rebuildSatRings} re-samples. */
  private satRingSig = "";

  // --- click-to-focus selection cue (fix #4) ---------------------------------
  /** A cyan reticle halo drawn over the SELECTED body/asset/DC, so click-to-focus is a
   * visible action. Built once + hidden; {@link updateSelection} shows/positions it. */
  private selectionMesh?: THREE.Mesh;

  // --- net/ Act-1 region + footprint overlay (design §6) ----------------------
  /** The highlighted Act-1 region disc: a halo that reads DIM (amber, low) while UNSERVED
   * and LIT (signal-green, bright) the instant the router reports it served — the single
   * legible Act-1 state change. Built once + hidden; shown only in net render mode. */
  private netRegionMesh?: THREE.Mesh;
  /** Act-2 — a POOL of footprint discs (one per covering sat), parked over the region (the
   * cover→paid beat, generalized to a hand-off: several discs sweep so one slides on as
   * another slides off). Built once + hidden; updateNetOverlay shows/positions the in-use set. */
  private netFootprintMeshes: THREE.Mesh[] = [];
  /** Latest net render slice (region + footprints + availability), set per-frame by main.ts. */
  private netState: NetRenderState | null = null;
  private readonly _netDim = new THREE.Color(0.95, 0.6, 0.2); // amber: UNSERVED region.
  private readonly _netLit = new THREE.Color(0.55, 1.0, 0.7); // signal-green: SERVED.
  /** Act-2 — the availability SAWTOOTH meter DOM (a small canvas-free bar+trace pinned over
   * the orrery, drawn from the {@link NetRenderState.availability} slice). Built once + hidden;
   * paintNetAvailability mutates it in place (no per-frame DOM rebuild). */
  private netAvailBox?: HTMLElement;
  private netAvailVal?: HTMLElement;
  private netAvailTrace?: HTMLElement;
  /** The sawtooth-trace sample bars, grown to the history length on first paint + reused. */
  private netAvailBars: HTMLElement[] = [];

  constructor(private ctx: OrreryCtx) {
    this.host = document.createElement("div");
    this.host.className = "orrery-host";
    this.canvas = document.createElement("canvas");
    this.host.appendChild(this.canvas);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "orrery-overlay";
    this.host.appendChild(this.labelLayer);
    this.buildOverlayCorners();
    this.buildCameraButtons(); // on-canvas clickable camera-preset buttons (§8 1-bit chrome)
    this.buildReadout(); // builds the block + caches its sub-nodes (no field needed)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x0b0b12, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const p = CAMERA_PRESETS[this.activePreset];
    this.focusId = p.focus;
    this.cur = { az: p.az, el: p.el, dist: p.dist, fov: p.fov, logK: p.logK, logScale: p.logScale, orbitBandM: p.orbitBandM ?? 0 };
    this.tgt = { ...this.cur };
    this.camera = new THREE.PerspectiveCamera(p.fov, 1, 0.001, 100000);

    this.buildBodies();
    this.buildRings();
    this.packetMesh = this.buildSignalDisc([1.0, 0.62, 0.18]);
    this.scene.add(this.packetMesh);
    // E7 — per-feed packet crawlers: one disc per in-flight feed (capped). Built
    // once and hidden; updatePacketAndLink positions/shows them from the readout.
    for (let i = 0; i < MAX_FEED_PACKETS; i++) {
      const m = this.buildSignalDisc([0.55, 0.85, 1.0]); // cool cyan: a feed leg.
      m.visible = false;
      m.renderOrder = 10;
      this.feedPackets.push(m);
      this.scene.add(m);
    }
    // Mars freshness halo — a dithered glow whose RADIUS encodes cache freshness
    // (the redundant, colour-off SHAPE channel that backs the saturation cue).
    this.marsHalo = this.buildHaloDisc([1.0, 0.5, 0.26]);
    this.marsHalo.renderOrder = 8;
    this.scene.add(this.marsHalo);
    this.linkLine = this.buildLink();
    this.scene.add(this.linkLine);

    // M2b/M2c — the coverage heatmap shell. Build the static grid mesh ONCE and
    // preallocate the per-cell coverage results so the per-frame sweep + re-colour
    // allocate nothing (X-02). The coverage ASSETS are now the LIVE PLAYER ROSTER
    // (M2c): the eirps + world positions arrive per-frame via the build provider, so
    // the heatmap grows as the player deploys/launches. The scratch arrays grow to
    // fit the roster on demand (only when an asset is added — never per frame).
    this.coverageScratch = this.coverageGrid.cells.map((c) => ({
      cellId: c.id,
      connectivity: 0,
      bandwidth: 0,
      latencyS: Infinity,
      links: [],
    }));
    this.coverageOverlay = new CoverageOverlay(this.coverageGrid);
    this.scene.add(this.coverageOverlay.mesh);

    // M2c — a pool of placed-asset marker billboards (ground stations + sats),
    // built once + hidden; updateBuildMarkers shows/positions them from the roster.
    for (let i = 0; i < MAX_BUILD_MARKERS; i++) {
      const m = this.buildSignalDisc([0.62, 1.0, 0.78]); // signal-green: a built asset.
      m.visible = false;
      m.renderOrder = 11; // over the body billboards so a marker reads on the globe.
      this.buildMarkers.push(m);
      this.scene.add(m);
    }

    // M3a — a small pool of ORBITAL-DATACENTER nodes (a handful matter — §4.5). Each is a
    // distinct hot-VIOLET signal disc (the §8 compute-node hue, set apart from the green
    // assets + amber packets + cyan feed legs) backed by a compute HALO whose radius scales
    // with the DC's compute budget (the bigger/brighter the node, the more it processes).
    for (let i = 0; i < MAX_DC_MARKERS; i++) {
      const halo = this.buildHaloDisc([0.78, 0.55, 1.0]); // violet compute corona.
      halo.visible = false;
      halo.renderOrder = 11;
      this.dcHalos.push(halo);
      this.scene.add(halo);
      const m = this.buildSignalDisc([0.82, 0.6, 1.0]); // hot violet: a compute node.
      m.visible = false;
      m.renderOrder = 12; // above its halo + the asset markers so the node reads clearly.
      this.dcMarkers.push(m);
      this.scene.add(m);
    }

    // Fix #4 — the SELECTION reticle: a cyan halo drawn over the click-/F-selected target,
    // so picking a body/asset/DC is a visible action. Built once + hidden; positioned by
    // updateSelection from the selected id each frame.
    this.selectionMesh = this.buildHaloDisc([0.4, 0.92, 1.0]); // cyan reticle.
    this.selectionMesh.visible = false;
    this.selectionMesh.renderOrder = 13; // above everything else so the cue always reads.
    this.scene.add(this.selectionMesh);

    // net/ Act-1 — the region disc (lit/dim) + the launched sat's footprint disc. Both are
    // dithered halo billboards on the toy globe, built once + hidden; updateNetOverlay shows
    // + positions + tints them only in net render mode (off-mode they never draw).
    this.netRegionMesh = this.buildHaloDisc([0.95, 0.6, 0.2]); // seeded amber (UNSERVED).
    this.netRegionMesh.visible = false;
    this.netRegionMesh.renderOrder = 8; // on the globe, under the markers.
    this.scene.add(this.netRegionMesh);
    // Act-2 — a POOL of cool-cyan footprint discs (one per covering sat). The hand-off render:
    // with a constellation several sweep so the region stays lit as one slides off + the next on.
    for (let i = 0; i < MAX_NET_FOOTPRINTS; i++) {
      const m = this.buildHaloDisc([0.45, 0.85, 1.0]); // cool cyan footprint.
      m.visible = false;
      m.renderOrder = 7;
      this.netFootprintMeshes.push(m);
      this.scene.add(m);
    }
    // Act-2 — the availability SAWTOOTH meter (design §4.4 / §6): a small bar+trace pinned over
    // the orrery that sawtooths for a lone LEO / N≤3 and FLATTENS at the SLA bar for the N=4
    // constellation. Built once + hidden; shown only in net mode with an availability axis live.
    this.buildNetAvailMeter();

    this.attachInput();
  }

  // --- construction helpers ------------------------------------------------
  private bodyMaterial(spec: BodySpec): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(...spec.color) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uTerminator: { value: spec.terminator ? 1 : 0 },
        uCell: { value: 2.0 },
      },
    });
  }

  private buildSignalDisc(color: [number, number, number]): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(...color) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uTerminator: { value: 0 },
        uCell: { value: 2.0 },
      },
    });
    return new THREE.Mesh(this.quad, mat);
  }

  /** A dithered additive glow disc (same stipple as the Sun halo), tinted `color`. */
  private buildHaloDisc(color: [number, number, number]): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: HALO_FRAG,
      transparent: true,
      depthWrite: false,
      blending: THREE.AdditiveBlending,
      uniforms: {
        uColor: { value: new THREE.Color(...color) },
        uCell: { value: 3.0 },
      },
    });
    return new THREE.Mesh(this.quad, mat);
  }

  private buildBodies(): void {
    for (const spec of BODIES) {
      const mesh = new THREE.Mesh(this.quad, this.bodyMaterial(spec));
      mesh.renderOrder = 10;
      this.scene.add(mesh);
      this.bodyMeshes.set(spec.id, mesh);
      if (spec.glow) {
        const halo = new THREE.Mesh(
          this.quad,
          new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: VERT,
            fragmentShader: HALO_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
              uColor: { value: new THREE.Color(...spec.color) },
              uCell: { value: 3.0 },
            },
          }),
        );
        halo.renderOrder = 9;
        this.scene.add(halo);
        this.haloMesh = halo;
      }
    }
  }

  private buildRings(): void {
    for (const id of RING_IDS) {
      const rel = this.ctx.eph.sampleRelativeOrbit(id, RING_SAMPLES);
      if (!rel.length) continue;
      // dashed: keep only every other segment (i even)
      const segCount = Math.floor(RING_SAMPLES / 2);
      const positions = new Float32Array(segCount * 2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const isSat = id.startsWith("sat_");
      const mat = new THREE.LineBasicMaterial({
        color: isSat ? 0xff9e2e : 0xcfcfdb,
        transparent: true,
        opacity: isSat ? 0.55 : 0.42,
      });
      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.rings.set(id, { line, rel });
    }
  }

  /**
   * Fix #2 — REBUILD the launched-sat orbit rings from the live roster, ONLY when the
   * sat set changed (keyed by {@link satRingSig}). Each launched sat gets a dashed
   * orbital-plane ring sampled from its OWN Kepler elements (one full orbit, in the
   * sat's body-relative frame — the SAME frame the dataset rings use), so a launched sat
   * draws an orbit ring exactly like the dataset LEO/GEO. Sampling sweeps the mean anomaly
   * across one period via {@link solveOrbit} (pure Kepler), so the ring matches the sat's
   * actual swept path. Rings beyond the pool cap are not drawn (rare — sat count is small).
   * Called from {@link update}; never allocates per frame (only on a launch).
   */
  private rebuildSatRings(sats: BuildAssetRender[]): void {
    // Build a cheap signature of the launched-sat set (id + epoch + semi-major axis): a
    // launch changes it, a per-frame propagation does not. Skip the rebuild when unchanged.
    let sig = "";
    for (const a of sats) {
      const o = a.orbit;
      if (o) sig += `${a.id}:${o.epochS}:${o.aM}|`;
    }
    if (sig === this.satRingSig) return;
    this.satRingSig = sig;

    // Grow the pool to the (capped) sat count, building each ring's geometry once.
    const need = Math.min(sats.filter((a) => a.orbit).length, MAX_SAT_RINGS);
    while (this.satRings.length < need) {
      const segCount = Math.floor(SAT_RING_SAMPLES / 2);
      const positions = new Float32Array(segCount * 2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const mat = new THREE.LineBasicMaterial({ color: 0xff9e2e, transparent: true, opacity: 0.5 });
      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.satRings.push({ line, rel: [], parentId: "earth" });
    }

    // Re-sample each in-use ring from its sat's orbit; hide the rest.
    let slot = 0;
    for (const a of sats) {
      if (!a.orbit || slot >= MAX_SAT_RINGS || slot >= this.satRings.length) continue;
      const ring = this.satRings[slot];
      ring.rel = sampleSatOrbitRelative(a.orbit, SAT_RING_SAMPLES);
      ring.parentId = a.orbit.parentId;
      ring.line.visible = true;
      slot++;
    }
    for (let i = slot; i < this.satRings.length; i++) this.satRings[i].line.visible = false;
  }

  /**
   * Fix #4 — position the SELECTION reticle over the currently selected target (a body,
   * a deployed asset, or a DC). Resolves the selected id's world position from the
   * ephemeris (bodies) or the live roster (assets/DCs), rebases it the same way, and
   * shows a cyan halo a touch larger than the target. Hidden when nothing is selected or
   * the selection has left the roster. Render-only; no per-frame allocation.
   */
  private updateSelection(t: number, focusAbs: Vec3, worldPerPx: number): void {
    const mesh = this.selectionMesh;
    if (!mesh) return;
    const id = this.selectedId;
    if (id === null) {
      mesh.visible = false;
      return;
    }
    let abs: Vec3 | null = null;
    let px = 18;
    if (this.ctx.eph.hasBody(id)) {
      abs = this.ctx.eph.position(id, t);
      const spec = BODIES.find((s) => s.id === id);
      px = (spec?.px ?? 16) + 16; // a ring a bit wider than the body disc.
    } else {
      const bs = this.buildState;
      const a = bs?.assets.find((x) => x.id === id);
      if (a) {
        abs = a.posM;
        px = (a.kind === "ground" ? 7 : 9) + 14;
      } else {
        const d = bs?.datacenters.find((x) => x.id === id);
        if (d) {
          abs = d.posM;
          px = 11 + 16;
        }
      }
    }
    if (abs === null) {
      mesh.visible = false; // the selected asset is gone (e.g. roster reset).
      return;
    }
    this.renderInto(this._rp, abs, focusAbs);
    mesh.position.copy(this._rp);
    this.sizeBillboard(mesh, px, worldPerPx);
    mesh.visible = true;
  }

  /**
   * net/ Act-1 — draw the highlighted region + the launched sat's footprint (design §6).
   * The region disc reads DIM (amber) while UNSERVED and LIT (signal-green, brighter +
   * wider) the instant the router reports it served — the single legible Act-1 state
   * change. The footprint disc sits over the region's nadir. Both are rebased like a body
   * and sized as billboards proportional to the toy globe's apparent disc (the region's
   * angular radius scaled off the Earth billboard px). Hidden when net mode is off or the
   * slice is empty. Render-only — no sim feedback; no per-frame allocation.
   */
  private updateNetOverlay(focusAbs: Vec3, worldPerPx: number): void {
    const region = this.netRegionMesh;
    if (!region) return;
    const ns = this.netState;
    if (ns === null) {
      region.visible = false;
      for (const m of this.netFootprintMeshes) m.visible = false;
      this.paintNetAvailability(null);
      return;
    }

    // The region disc: lit/dim by the served verdict — the make-or-break state change. In
    // Act 2 this is the SAWTOOTH made visible on the globe: a lone LEO lights green only while
    // its single footprint is overhead and dips amber the instant it sets; a constellation
    // holds green because ANOTHER footprint slides on as one slides off (the served verdict
    // main.ts derives stays true across the hand-off).
    if (ns.region) {
      this.renderInto(this._rp, ns.region.centerPosM, focusAbs);
      region.position.copy(this._rp);
      // LIT iff SERVED and a footprint is covering (the hand-off holds green as one disc slides
      // off + the next slides on); DIM the instant the lone footprint sets and served drops.
      const lit = Orrery.regionLit(ns.region.served, ns.footprints.length);
      const mat = region.material as THREE.ShaderMaterial;
      mat.uniforms.uColor.value.copy(lit ? this._netLit : this._netDim);
      // A served region reads a touch wider + brighter (the lit pulse); the angular radius
      // maps to a px size off the Earth billboard (a hemisphere ≈ the full disc).
      const px = this.netDiscPx(ns.region.radiusRad) * (lit ? 1.25 : 1.0);
      this.sizeBillboard(region, px, worldPerPx);
      region.visible = true;
    } else {
      region.visible = false;
    }

    // The footprint discs over the region (the hand-off beat): one cool-cyan wash per covering
    // sat. Several discs sweep with the constellation so the region stays lit as one slides off
    // + the next slides on — the sawtooth flattens into continuous SERVED (the Act-2 dopamine).
    let slot = 0;
    for (const fp of ns.footprints) {
      if (slot >= this.netFootprintMeshes.length) break;
      const mesh = this.netFootprintMeshes[slot];
      this.renderInto(this._rp, fp.centerPosM, focusAbs);
      mesh.position.copy(this._rp);
      this.sizeBillboard(mesh, this.netDiscPx(fp.radiusRad), worldPerPx);
      mesh.visible = true;
      slot++;
    }
    for (let i = slot; i < this.netFootprintMeshes.length; i++) this.netFootprintMeshes[i].visible = false;

    // The availability sawtooth meter (the legible "motion is the antagonist" cue).
    this.paintNetAvailability(ns.availability);
  }

  /**
   * Act-2 — build the availability SAWTOOTH meter DOM once (design §4.4 axis-2 / §6): a small
   * pinned block with the live rolling-availability %, the SLA bar threshold, and a row of
   * trace bars (the render-only history ring buffer) that draw the sawtooth. Hidden until net
   * mode supplies an availability slice; paintNetAvailability mutates it in place (no rebuild).
   */
  private buildNetAvailMeter(): void {
    const box = document.createElement("div");
    box.className = "net-avail";
    box.style.display = "none";
    box.innerHTML =
      `<div class="na-row"><span class="na-lab">AVAILABILITY</span>` +
      `<span class="na-val">—</span></div>` +
      `<div class="na-trace"></div>`;
    this.labelLayer.appendChild(box);
    this.netAvailBox = box;
    this.netAvailVal = box.querySelector(".na-val") as HTMLElement;
    this.netAvailTrace = box.querySelector(".na-trace") as HTMLElement;
  }

  /**
   * Act-2 — paint the availability sawtooth meter from the {@link NetRenderState.availability}
   * slice (or hide it when null). Pure presentation: the % readout + a tone keyed off whether
   * the value HOLDS the bar ({@link Orrery.availMeterTone}), and a row of trace bars whose
   * heights are the recent history (the sawtooth) and whose tone flips green↔amber per-sample
   * at the bar line — so a lone LEO reads as a jagged amber/green saw and the N=4 constellation
   * reads as a flat green line riding the bar. No per-frame DOM rebuild (bars are pooled).
   */
  private paintNetAvailability(av: NetRenderState["availability"]): void {
    const box = this.netAvailBox;
    if (!box) return;
    if (av === null) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    const tone = Orrery.availMeterTone(av.value, av.bar);
    if (this.netAvailVal) {
      const txt = `${Math.round(av.value * 100)}% · bar ${Math.round(av.bar * 100)}%`;
      if (this.netAvailVal.textContent !== txt) this.netAvailVal.textContent = txt;
      const cls = `na-val ${tone}`;
      if (this.netAvailVal.className !== cls) this.netAvailVal.className = cls;
    }
    const trace = this.netAvailTrace;
    if (!trace) return;
    // Grow the trace-bar pool to the history length once (X-02 — never per frame after).
    while (this.netAvailBars.length < av.history.length) {
      const bar = document.createElement("span");
      bar.className = "na-bar";
      trace.appendChild(bar);
      this.netAvailBars.push(bar);
    }
    for (let i = 0; i < this.netAvailBars.length; i++) {
      const bar = this.netAvailBars[i];
      if (i >= av.history.length) {
        if (bar.style.display !== "none") bar.style.display = "none";
        continue;
      }
      if (bar.style.display === "none") bar.style.display = "";
      const v = av.history[i];
      const h = `${Math.max(2, Math.round(v * 100))}%`;
      if (bar.style.height !== h) bar.style.height = h;
      // Each sample bar is green when it holds the bar, amber when it dips below — so a lone
      // LEO's troughs paint amber (the visible breach) and a held constellation paints all green.
      const cls = v >= av.bar ? "na-bar good" : "na-bar warn";
      if (bar.className !== cls) bar.className = cls;
    }
  }

  /**
   * Act-2 — the PURE meter-tone mapping (split out so it is unit-testable without a DOM): the
   * sawtooth meter reads GOOD (green) when the rolling availability holds the SLA bar (the
   * constellation has tamed the motion), WARN (amber) when it is below (a lone LEO / N≤3 still
   * sawtoothing). A deterministic function of (value, bar) — no `this`, no DOM. */
  static availMeterTone(value: number, bar: number): "good" | "warn" {
    return value >= bar ? "good" : "warn";
  }

  /**
   * Act-2 — the PURE hand-off region verdict (split out so it is unit-testable without a DOM):
   * the region disc reads LIT (green) iff it is SERVED and at least one footprint is covering it,
   * else DIM (amber). Across a hand-off, as footprint A slides off the region another (B) slides
   * on — `served` stays true and the covering count stays ≥ 1, so the region NEVER goes dim (the
   * sawtooth flattens). A lone LEO's single footprint sliding off drops the count to 0 AND flips
   * `served` false, so the region dips dim (the visible sawtooth trough). A deterministic
   * function of (served, coveringCount) — no `this`, no DOM. */
  static regionLit(served: boolean, coveringCount: number): boolean {
    return served && coveringCount > 0;
  }

  /** Map a region/footprint angular radius (radians) to a billboard px size on the toy
   * globe. The Earth billboard spans the toy globe diameter; a disc of angular radius ψ
   * spans ≈ sin(ψ) of the globe radius, so its diameter px ≈ EARTH_PX·sin(ψ), floored so a
   * small region still reads. Pure presentation. */
  private netDiscPx(radiusRad: number): number {
    return Math.max(10, EARTH_BILLBOARD_PX * Math.sin(Math.max(0, radiusRad)));
  }

  /**
   * Fix #2 — position the launched-sat orbit rings each frame: rebase + de-squash + fold
   * each ring's body-relative samples around its parent's current ephemeris position, the
   * SAME path the dataset rings use (so a launched LEO sat's ring sweeps + de-squashes
   * identically to the dataset sat_leo ring). Writes straight into the ring's Float32Array
   * (zero per-point Vector3 alloc). Cheap; the geometry buffers were built on the rebuild.
   */
  private updateSatRings(t: number, focusAbs: Vec3): void {
    for (const ring of this.satRings) {
      if (!ring.line.visible) continue;
      const parentAbs = this.ctx.eph.position(ring.parentId, t);
      const pos = ring.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      const n = ring.rel.length;
      let w = 0;
      for (let i = 0; i < n; i += 2) {
        const a = ring.rel[i];
        const b = ring.rel[(i + 1) % n];
        w = this.writeRenderPoint(arr, w, parentAbs[0] + a[0], parentAbs[1] + a[1], parentAbs[2] + a[2], focusAbs);
        w = this.writeRenderPoint(arr, w, parentAbs[0] + b[0], parentAbs[1] + b[1], parentAbs[2] + b[2], focusAbs);
      }
      pos.needsUpdate = true;
    }
  }

  private buildLink(): THREE.LineSegments {
    // Earth↔Mars link as a dashed amber segment set (recomputed each frame).
    const dashes = 22;
    const positions = new Float32Array(dashes * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xff9e2e, transparent: true, opacity: 0.5 });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  private buildOverlayCorners(): void {
    for (const cls of ["tl", "tr", "bl", "br"]) {
      const c = document.createElement("div");
      c.className = `corner ${cls}`;
      c.dataset.k = cls;
      this.labelLayer.appendChild(c);
    }
  }

  /**
   * The ON-CANVAS CAMERA-PRESET BUTTONS (the owner's "camera presets need to be BUTTONS
   * you can mouseclick inside the orrery, in addition to hotkeys"). A compact, edge-docked
   * button group (§8 1-bit chrome) with one button per {@link CAMERA_PRESETS} entry —
   * EARTH · CISLUNAR · ORBITS · SYSTEM · TOP-DOWN. Clicking a button calls the SAME
   * {@link setPreset} path the E/C/O/S/T hotkeys use (the hotkeys stay), then repaints the
   * active highlight. Built ONCE here (X-02; never per-frame); {@link paintCameraButtons}
   * is the only per-change touch.
   *
   * The buttons live in the orrery overlay (pointer-events:auto on the bar) layered OVER
   * the WebGL canvas. A button click lands on the bar, not the canvas, so it does NOT
   * trigger the click-to-focus raycast; we also stopPropagation on the bar's pointer
   * events as belt-and-suspenders so a press can never reach the canvas orbit/pick handler.
   */
  private buildCameraButtons(): void {
    const bar = document.createElement("div");
    bar.className = "cam-bar";
    // Hit-test the buttons FIRST: swallow pointer events on the bar so a click here never
    // starts a camera-orbit drag or a click-to-focus pick on the canvas underneath.
    for (const ev of ["pointerdown", "pointerup", "wheel"] as const) {
      bar.addEventListener(ev, (e) => e.stopPropagation());
    }
    CAMERA_PRESETS.forEach((p, i) => {
      const btn = document.createElement("button");
      btn.className = "cam-btn";
      btn.type = "button";
      btn.textContent = p.name;
      btn.title = `camera → ${p.name}`;
      btn.addEventListener("click", () => this.setPreset(i)); // same path as the hotkey.
      bar.appendChild(btn);
      this.cameraButtons.push(btn);
    });
    this.labelLayer.appendChild(bar);
    this.paintCameraButtons();
  }

  /** Light the active camera-preset button (cyan active-state, §8 coloured-for-signal).
   * Called once at build + on every {@link setPreset} — event-driven, never per-frame. */
  private paintCameraButtons(): void {
    this.cameraButtons.forEach((btn, i) => btn.classList.toggle("active", i === this.activePreset));
  }

  /**
   * Build the glanceable readout (M1-10): a DOM block pinned over the orrery's
   * top-right, showing Mars-relay FRESHNESS, the fetch COUNTDOWN, a BLACKOUT
   * badge, and a conjunction-APPROACH gauge. DOM is built ONCE here; per-frame
   * {@link paintReadout} only mutates text / classes / widths in place.
   */
  private buildReadout(): HTMLElement {
    const box = document.createElement("div");
    box.className = "orrery-readout";
    box.innerHTML =
      `<div class="ro-row ro-fresh"><span class="ro-lab">MARS CACHE</span>` +
      `<span class="ro-glyph"></span><span class="ro-val">—</span></div>` +
      `<div class="ro-bar ro-freshbar"><span class="ro-fill"></span></div>` +
      `<div class="ro-row ro-slots"><span class="ro-lab">SLOTS</span>` +
      `<span class="ro-val">—</span></div>` +
      // E8 — the prefetch POLICY (the tame-it lever): MANUAL vs AUTO @ NN%, lit
      // when the autopilot is firing; the relief made glanceable.
      `<div class="ro-row ro-policy"><span class="ro-lab">PREFETCH</span>` +
      `<span class="ro-val">—</span></div>` +
      // E7 — the per-feed map: the Mini-Metro at-a-glance roster. Rows are built
      // lazily on the first paint (one per feed) and mutated in place after.
      `<div class="ro-feeds"></div>` +
      `<div class="ro-row ro-count"><span class="ro-lab">FETCH ETA</span>` +
      `<span class="ro-val">—</span></div>` +
      `<div class="ro-row ro-conj"><span class="ro-lab">CONJUNCTION</span>` +
      `<span class="ro-val">—</span></div>` +
      `<div class="ro-bar ro-conjbar"><span class="ro-fill"></span></div>` +
      `<div class="ro-badge ro-blackout">▰ BLACKOUT</div>`;
    this.labelLayer.appendChild(box);
    // Grab the live sub-nodes ONCE; paintReadout mutates these in place.
    this.roFreshGlyph = box.querySelector(".ro-fresh .ro-glyph") as HTMLElement;
    this.roFreshVal = box.querySelector(".ro-fresh .ro-val") as HTMLElement;
    this.roFreshFill = box.querySelector(".ro-freshbar .ro-fill") as HTMLElement;
    this.roSlotsVal = box.querySelector(".ro-slots .ro-val") as HTMLElement;
    this.roPolicyVal = box.querySelector(".ro-policy .ro-val") as HTMLElement;
    this.roFeeds = box.querySelector(".ro-feeds") as HTMLElement;
    this.roCountRow = box.querySelector(".ro-count") as HTMLElement;
    this.roCountVal = box.querySelector(".ro-count .ro-val") as HTMLElement;
    this.roConjVal = box.querySelector(".ro-conj .ro-val") as HTMLElement;
    this.roConjFill = box.querySelector(".ro-conjbar .ro-fill") as HTMLElement;
    this.roBlackout = box.querySelector(".ro-blackout") as HTMLElement;
    return box;
  }

  /**
   * Per-feed map rows, keyed by feed id, built lazily on first paint and then
   * mutated in place (no per-frame DOM rebuilds). Each row carries a state glyph,
   * a short label, a freshness % value, and a freshness bar — the redundant
   * (colour-off) channels that make the roster legible at a glance.
   */
  private roFeedRows = new Map<string, { glyph: HTMLElement; lab: HTMLElement; val: HTMLElement; fill: HTMLElement }>();

  /** Ensure a map row exists for `id`; build it once into the ro-feeds container. */
  private feedRow(id: string, label: string): { glyph: HTMLElement; lab: HTMLElement; val: HTMLElement; fill: HTMLElement } {
    let row = this.roFeedRows.get(id);
    if (!row) {
      const r = document.createElement("div");
      r.className = "ro-feed";
      r.innerHTML =
        `<span class="ro-fglyph"></span><span class="ro-flab">${label}</span>` +
        `<span class="ro-fval">—</span>` +
        `<span class="ro-fbar"><span class="ro-ffill"></span></span>`;
      this.roFeeds.appendChild(r);
      row = {
        glyph: r.querySelector(".ro-fglyph") as HTMLElement,
        lab: r.querySelector(".ro-flab") as HTMLElement,
        val: r.querySelector(".ro-fval") as HTMLElement,
        fill: r.querySelector(".ro-ffill") as HTMLElement,
      };
      this.roFeedRows.set(id, row);
    }
    return row;
  }

  // --- public control ------------------------------------------------------
  /**
   * Hand the orrery the latest glanceable readout (M1-10) — the live Mars-relay
   * freshness / fetch countdown / blackout / conjunction-approach derived from
   * FrameState. Pure presentation: stored here, painted next {@link update}.
   * Also drives the Mars cache node's freshness-as-saturation (§8).
   */
  setReadout(r: Readout): void {
    this.readout = r;
    this.marsFreshness = r.freshness;
  }

  setPreset(i: number): void {
    if (i < 0 || i >= CAMERA_PRESETS.length) return;
    this.activePreset = i;
    const p = CAMERA_PRESETS[i];
    this.focusId = p.focus;
    this.tgt = { az: p.az, el: p.el, dist: p.dist, fov: p.fov, logK: p.logK, logScale: p.logScale, orbitBandM: p.orbitBandM ?? 0 };
    this.paintCameraButtons(); // keep the on-canvas active highlight in sync (click + hotkey).
  }

  resetCamera(): void {
    this.setPreset(this.activePreset);
  }

  cycleFocus(dir: number): void {
    const i = FOCUS_ORDER.indexOf(this.focusId);
    this.focusId = FOCUS_ORDER[(i + dir + FOCUS_ORDER.length) % FOCUS_ORDER.length];
    // F-cycle is the secondary select path (fix #4): keep the reticle on the focus body.
    this.selectedId = this.focusId;
  }

  presetName(): string {
    return CAMERA_PRESETS[this.activePreset].name;
  }

  subtitle(): string {
    const cov = this.coverageOverlay.visible ? ` · COV ${dimensionLabel(this.coverageDimension)}` : "";
    return `${this.presetName()} · ${this.focusId}${cov}`;
  }

  /** M2b — toggle the coverage heatmap shell on/off (the 'h' key). Returns the new state. */
  toggleHeatmap(): boolean {
    return this.coverageOverlay.setVisible(!this.coverageOverlay.visible);
  }

  /** True iff the coverage heatmap shell is currently shown. */
  heatmapVisible(): boolean {
    return this.coverageOverlay.visible;
  }

  /** M2b — cycle the displayed coverage dimension (connectivity → bandwidth → latency). */
  cycleDimension(): CoverageDimension {
    const i = DIMENSION_CYCLE.indexOf(this.coverageDimension);
    this.coverageDimension = DIMENSION_CYCLE[(i + 1) % DIMENSION_CYCLE.length];
    return this.coverageDimension;
  }

  /** The active coverage dimension's glanceable label (for the footer / status). */
  dimensionLabel(): string {
    return dimensionLabel(this.coverageDimension);
  }

  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- per-frame -----------------------------------------------------------
  update(dtWall: number): void {
    const k = 1 - Math.exp(-Math.min(dtWall, 0.05) * 9);
    this.cur.az += (this.tgt.az - this.cur.az) * k;
    this.cur.el += (this.tgt.el - this.cur.el) * k;
    this.cur.dist += (this.tgt.dist - this.cur.dist) * k;
    this.cur.fov += (this.tgt.fov - this.cur.fov) * k;
    this.cur.logK += (this.tgt.logK - this.cur.logK) * k;
    this.cur.logScale += (this.tgt.logScale - this.cur.logScale) * k;
    this.cur.orbitBandM += (this.tgt.orbitBandM - this.cur.orbitBandM) * k;
    this.applyCamera();

    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    const sunAbs = this.ctx.eph.position("sun", t);
    // Refresh the near-body de-squash for THIS frame's focus + animated band (fix #1):
    // points within orbitBandM of the focus body get radially re-radii'd before the
    // log-fold, so near-Earth orbits separate from the disc + sweep. Identity when the
    // band is ~0 (system-scale presets) — see renderInto / writeRenderPoint.
    this.refreshOrbitScale();

    // bodies
    const worldPerPx = (2 * Math.tan((this.cur.fov * DEG) / 2)) / this.h;
    for (const spec of BODIES) {
      const mesh = this.bodyMeshes.get(spec.id)!;
      const absBody = this.ctx.eph.position(spec.id, t);
      this.renderInto(this._rp, absBody, focusAbs);
      mesh.position.copy(this._rp);
      this.sizeBillboard(mesh, spec.px, worldPerPx);
      if (spec.id === "mars") this.applyMarsFreshness(mesh, worldPerPx);
      if (spec.terminator) {
        // Sun direction from UNCOMPRESSED physical positions — the log-fold is a
        // per-point radial scale and would skew the terminator for off-focus bodies.
        this._sunDir
          .set(sunAbs[0] - absBody[0], sunAbs[2] - absBody[2], -(sunAbs[1] - absBody[1]))
          .normalize()
          .transformDirection(this.camera.matrixWorldInverse);
        (mesh.material as THREE.ShaderMaterial).uniforms.uSunDirView.value.copy(this._sunDir);
      }
      if (spec.glow && this.haloMesh) {
        this.haloMesh.position.copy(this._rp);
        this.sizeBillboard(this.haloMesh, spec.px * 2.8, worldPerPx);
      }
    }

    // rings — write straight into the Float32Array, zero Vector3 per point
    for (const [id, ring] of this.rings) {
      const parent = this.ctx.eph.parentOf(id);
      const parentAbs = this.ctx.eph.position(parent, t);
      const pos = ring.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      let w = 0;
      for (let i = 0; i < RING_SAMPLES; i += 2) {
        const a = ring.rel[i];
        const b = ring.rel[(i + 1) % RING_SAMPLES];
        w = this.writeRenderPoint(arr, w, parentAbs[0] + a[0], parentAbs[1] + a[1], parentAbs[2] + a[2], focusAbs);
        w = this.writeRenderPoint(arr, w, parentAbs[0] + b[0], parentAbs[1] + b[1], parentAbs[2] + b[2], focusAbs);
      }
      pos.needsUpdate = true;
    }

    // packet + link
    this.updatePacketAndLink(t, focusAbs, worldPerPx);

    // M2c — pull the live build roster + coverage score for this frame (the monument).
    this.buildState = this.ctx.build?.() ?? null;

    // Fix #2/#3 — the player's launched constellation is the MONUMENT: draw it ALWAYS,
    // not only with the heatmap on. Rebuild the orbit-plane rings only when the sat set
    // changed (a launch), then position the deployed-sat + ground markers + the DC nodes
    // + the launched-sat orbit rings every frame from the live roster (they orbit/sweep
    // with the clock via the same Kepler-propagated world positions the coverage scores).
    const assets = this.buildState?.assets ?? [];
    this.rebuildSatRings(assets);
    this.updateSatRings(t, focusAbs);
    this.updateBuildMarkers(focusAbs, worldPerPx);
    this.updateDCMarkers(focusAbs, worldPerPx);

    // M2b/M2c — the coverage heatmap shell (only when toggled on), swept off the LIVE
    // roster so the §4.2/§4.3 windows visibly open/close as the sats pass (fix #6). The
    // markers/rings above are drawn regardless; only the shell is heatmap-gated.
    if (this.coverageOverlay.visible) {
      this.updateCoverageHeatmap(t, focusAbs, worldPerPx);
    }

    // Fix #4 — the selection reticle over the click-/F-selected target.
    this.updateSelection(t, focusAbs, worldPerPx);

    // net/ Act-1 — the region (lit/dim) + footprint discs, only in net render mode.
    this.netState = this.netRenderMode ? (this.ctx.net?.() ?? null) : null;
    this.updateNetOverlay(focusAbs, worldPerPx);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels(t, focusAbs);
    this.updateCorners();
    this.paintReadout();
  }

  private updatePacketAndLink(t: number, focusAbs: Vec3, worldPerPx: number): void {
    this.renderInto(this._earthR, this.ctx.eph.position("earth", t), focusAbs);
    this.renderInto(this._marsR, this.ctx.eph.position("mars", t), focusAbs);
    const ex = this._earthR.x, ey = this._earthR.y, ez = this._earthR.z;
    const mx = this._marsR.x, my = this._marsR.y, mz = this._marsR.z;

    const pos = this.linkLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const dashes = arr.length / 6;
    let w = 0;
    for (let d = 0; d < dashes; d++) {
      const t0 = d / dashes;
      const t1 = t0 + 0.5 / dashes; // half-on dash
      arr[w++] = ex + (mx - ex) * t0; arr[w++] = ey + (my - ey) * t0; arr[w++] = ez + (mz - ez) * t0;
      arr[w++] = ex + (mx - ex) * t1; arr[w++] = ey + (my - ey) * t1; arr[w++] = ez + (mz - ez) * t1;
    }
    pos.needsUpdate = true;

    const pk = this.ctx.packet();
    if (pk) {
      const from = pk.fromId === "earth" ? this._earthR : this.renderInto(this._rp, this.ctx.eph.position(pk.fromId, t), focusAbs);
      const to = pk.toId === "mars" ? this._marsR : this.renderInto(this._rp2, this.ctx.eph.position(pk.toId, t), focusAbs);
      this.packetMesh.visible = true;
      this.packetMesh.position.copy(this.tmpV.copy(from).lerp(to, pk.progress));
      this.sizeBillboard(this.packetMesh, 13, worldPerPx);
      // freshness-as-saturation: amber → machine-grey
      this._pkColor.copy(this._grey).lerp(this._amber, pk.freshness);
      (this.packetMesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(this._pkColor);
    } else {
      this.packetMesh.visible = false;
    }

    // E7 — per-feed packet crawlers. Each in-flight feed's leg gets a cool-cyan
    // disc crawling Earth→Mars at its own progress (capped at the pool size). They
    // share the Earth→Mars segment endpoints already rebased above. A small lateral
    // fan-out keeps overlapping legs distinguishable without new geometry.
    const ro = this.readout;
    let slot = 0;
    if (ro) {
      for (const f of ro.feeds) {
        if (slot >= this.feedPackets.length) break;
        if (f.packetProgress == null) continue;
        const mesh = this.feedPackets[slot];
        mesh.visible = true;
        // base crawl point, then fan perpendicular-ish by the slot index so stacked
        // legs do not perfectly overlap (purely a presentation offset).
        const p = f.packetProgress;
        const fan = (slot - 2) * 0.012; // small, in scene units
        this.tmpV.set(
          ex + (mx - ex) * p,
          ey + (my - ey) * p + fan,
          ez + (mz - ez) * p,
        );
        mesh.position.copy(this.tmpV);
        this.sizeBillboard(mesh, 9, worldPerPx);
        slot++;
      }
    }
    for (let i = slot; i < this.feedPackets.length; i++) this.feedPackets[i].visible = false;
  }

  /**
   * M2b — drive the COVERAGE HEATMAP (GDD §5 view #2). Each frame, with the shell
   * toggled on:
   *   1. read the system sats' world positions at sim-time t (the ephemeris the
   *      orrery already holds — NO session wiring, so the replay golden is untouched);
   *   2. sweep the static grid with the allocation-free {@link coverageDimsAt} into
   *      the preallocated scratch (~320 cells × 4 sats — cheap, and zero alloc, X-02);
   *   3. re-colour the shell on the active dimension + place it at Earth's rebased
   *      position sized to the Earth disc.
   * As Earth's billboard sits at the rebased focus-relative point and the sats orbit,
   * the lit cells sweep — the network visibly working (§5 "coverage felt").
   *
   * f64→f32 boundary: the grid geometry is static f32 (unit vectors); the ONLY f64
   * crossing is Earth's rebased scene position (computed by the same renderInto the
   * body billboards use) + the shell radius (scene units). Metres never reach the mesh.
   */
  private updateCoverageHeatmap(t: number, focusAbs: Vec3, worldPerPx: number): void {
    // Earth world position (f64 m) + radius for the coverage sweep.
    const earthAbs = this.ctx.eph.position(COVERAGE_BODY_ID, t);
    const earthR = this.ctx.eph.radiusMeters(COVERAGE_BODY_ID);

    // M2c — the coverage assets are the LIVE PLAYER ROSTER: read their eirps + world
    // positions (already computed by the pure roster) out of the build provider into
    // the reused scratch (grown only when the roster grew — never per frame).
    const build = this.buildState;
    const assets = build?.assets ?? [];
    const n = assets.length;
    while (this.coverageEirps.length < n) {
      this.coverageEirps.push(0);
      this.coverageAssetPos.push([0, 0, 0] as Vec3);
    }
    this.coverageEirps.length = n;
    this.coverageAssetPos.length = n;
    for (let i = 0; i < n; i++) {
      this.coverageEirps[i] = assets[i].eirp;
      const out = this.coverageAssetPos[i] ?? ([0, 0, 0] as Vec3);
      out[0] = assets[i].posM[0];
      out[1] = assets[i].posM[1];
      out[2] = assets[i].posM[2];
      this.coverageAssetPos[i] = out;
    }

    // Whole-grid coverage sweep into the preallocated scratch (allocation-free).
    const cells = this.coverageGrid.cells;
    for (let id = 0; id < cells.length; id++) {
      coverageDimsAt(cells[id], this.coverageEirps, this.coverageAssetPos, earthAbs, earthR, this.coverageScratch[id]);
    }
    // The covered-demand fraction (the live monument readout) — reuses the per-cell
    // scratch the sweep just filled, so this is a cheap demand-weighted rollup.
    this.coveredDemandFraction = scoreCoverageAt(
      this.coverageGrid,
      this.demandField,
      this.coverageEirps,
      this.coverageAssetPos,
      earthAbs,
      earthR,
      this.coverageScratch,
    ).coveredDemandFraction;

    // Re-colour the shell on the active dimension (writes into the preallocated buffer).
    this.coverageOverlay.updateColors(this.coverageScratch, this.coverageDimension);

    // Place the shell at Earth's rebased scene position, sized to the Earth disc.
    // The Earth billboard radius in scene units ≈ (px · worldPerPx · dist) / 2
    // (the quad spans the full diameter; matches sizeBillboard's sizing).
    this.renderInto(this._shellPos, earthAbs, focusAbs);
    const dist = this.camera.position.distanceTo(this._shellPos);
    const shellRadius = (EARTH_BILLBOARD_PX * worldPerPx * dist) / 2;
    this.coverageOverlay.place(this._shellPos, shellRadius);
  }

  /**
   * M2c — draw the PLACED ASSET markers (ground stations + launched sats) from the
   * live roster: each asset's pure world position is rebased like a body and shown
   * as a small signal-green billboard, so the monument you BUILT is visible on the
   * globe. Pooled + reused (no per-frame mesh alloc); markers beyond the pool cap
   * are simply not drawn (the heatmap still scores them).
   */
  private updateBuildMarkers(focusAbs: Vec3, worldPerPx: number): void {
    const assets = this.buildState?.assets ?? [];
    // net/ Act-3b — the amber PULSE phase for a faulting sat (the §8 "a working node is degrading"
    // cue). Driven off the SIM clock (deterministic, NOT wall-clock): a 0..1 triangle wave so a
    // faulting marker oscillates green→amber→green. ~0.7 Hz in sim-seconds.
    const tSim = this.ctx.now();
    const pulse = 0.5 + 0.5 * Math.sin(tSim * 4.4);
    let slot = 0;
    for (const a of assets) {
      if (slot >= this.buildMarkers.length) break;
      const m = this.buildMarkers[slot];
      this.renderInto(this._rp, a.posM, focusAbs);
      m.position.copy(this._rp);
      // Ground stations read a hair smaller than launched sats (the §8 size cue).
      this.sizeBillboard(m, a.kind === "ground" ? 7 : 9, worldPerPx);
      // A FAULTING sat pulses AMBER (green ↔ amber); a healthy asset stays signal-green.
      const col = (m.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
      if (a.faulting) col.copy(this._buildGreen).lerp(this._amber, pulse);
      else col.copy(this._buildGreen);
      m.visible = true;
      slot++;
    }
    for (let i = slot; i < this.buildMarkers.length; i++) this.buildMarkers[i].visible = false;
  }

  /**
   * M3a — draw the ORBITAL-DATACENTER nodes (GDD §4.5): each placed DC's body sub-point is
   * rebased like a body and shown as a distinct hot-VIOLET signal disc (the §8 compute glyph,
   * set apart from the green assets) with a violet COMPUTE HALO whose radius scales with the
   * DC's compute budget — so a power+thermal-rich node reads as a big bright corona and a
   * power-starved / thermally-throttled one as a thin rim (the physics, visible). The dither
   * cell COARSENS when the DC is thermally limited (a redundant, colour-off cue that the
   * thermal ceiling is biting). Pooled + reused; a handful at most (Risk-5 — sparse by design).
   */
  private updateDCMarkers(focusAbs: Vec3, worldPerPx: number): void {
    const dcs = this.buildState?.datacenters ?? [];
    let slot = 0;
    for (const d of dcs) {
      if (slot >= this.dcMarkers.length) break;
      const m = this.dcMarkers[slot];
      const halo = this.dcHalos[slot];
      this.renderInto(this._rp, d.posM, focusAbs);
      m.position.copy(this._rp);
      // The node is a touch bigger than a sat marker (a DC is a strategic node, not a smallsat).
      this.sizeBillboard(m, 11, worldPerPx);
      // Redundant colour-off cue: coarsen the node's dither when thermally throttled.
      (m.material as THREE.ShaderMaterial).uniforms.uCell.value = d.thermalLimited ? 4.0 : 2.0;
      m.visible = true;
      // The compute HALO: radius grows with the compute budget (clamped), so the node's glow
      // reads its processing power — a force-multiplier you can SEE working.
      halo.position.copy(this._rp);
      const haloPx = 16 + Math.min(40, d.computeUnits * 3);
      this.sizeBillboard(halo, haloPx, worldPerPx);
      halo.visible = true;
      slot++;
    }
    for (let i = slot; i < this.dcMarkers.length; i++) {
      this.dcMarkers[i].visible = false;
      this.dcHalos[i].visible = false;
    }
  }

  /**
   * FRESHNESS-AS-SATURATION (§8, the signature cue) on the Mars cache node. The
   * disc colour bleeds from a hot, saturated "fresh data" tint toward the machine
   * grey as the cached copy stales — reusing the packet's grey→hot lerp path. Two
   * REDUNDANT, colour-off channels back it so it reads CVD-safe:
   *   - the disc's dither cell COARSENS as it greys (a finer stipple = fresher);
   *   - a Mars freshness HALO whose radius/brightness shrinks toward nothing as
   *     freshness drains (a shape/size cue, gone entirely when the cache is empty).
   * Snaps back saturated + haloed the instant a fresh delivery refills the cache.
   * No per-frame allocation: all scratch is preallocated (_marsColor, _marsHot).
   */
  private applyMarsFreshness(mesh: THREE.Mesh, worldPerPx: number): void {
    const f = this.marsFreshness;
    const mat = mesh.material as THREE.ShaderMaterial;
    // grey (stale) → hot (fresh): identical move to the in-flight packet.
    this._marsColor.copy(this._grey).lerp(this._marsHot, f);
    mat.uniforms.uColor.value.copy(this._marsColor);
    // Redundant channel A: coarser dither when stale (cell 2 fresh → 5 dead).
    mat.uniforms.uCell.value = 2.0 + (1 - f) * 3.0;
    // Redundant channel B: a freshness halo that shrinks/dims to nothing as the
    // copy decays (and vanishes when the cache is empty — f == 0).
    this.marsHalo.position.copy(mesh.position);
    this.marsHalo.visible = f > 0.001;
    if (this.marsHalo.visible) {
      const halo = this.marsHalo.material as THREE.ShaderMaterial;
      halo.uniforms.uColor.value.copy(this._marsColor);
      // Halo spans the Mars disc (~28px) plus a freshness-scaled glow ring, so it
      // is a wide bright corona when fresh and a thin rim as it fades to empty.
      this.sizeBillboard(this.marsHalo, 28 + 44 * f, worldPerPx);
    }
  }

  private sizeBillboard(mesh: THREE.Mesh, px: number, worldPerPx: number): void {
    const dist = this.camera.position.distanceTo(mesh.position);
    const size = px * worldPerPx * dist;
    mesh.scale.set(size, size, 1);
    mesh.quaternion.copy(this.camera.quaternion);
  }

  /**
   * Rebuild the per-frame near-body de-squash (fix #1) from the current focus body's
   * true radius + the animated orbit band. Identity (null) when the band is ~0 (a
   * system-scale preset) or the focus body is dimensionless. PURE w.r.t. the render
   * state; called once per frame in {@link update}. The de-squash is a documented
   * VISUAL LIE on rendered radius only — it never touches src/sim metres.
   */
  private refreshOrbitScale(): void {
    const realSurfaceM = this.ctx.eph.radiusMeters(this.focusId);
    this.orbitScale = Orrery.computeOrbitScale(this.netRenderMode, realSurfaceM, this.cur.orbitBandM);
  }

  /**
   * The PURE surface+band → {@link OrbitRenderScale} choice (Decision-G, design §6), split out
   * so the net-mode override is unit-testable without a DOM/WebGL render. STRICTLY scoped:
   *   - net mode OFF (every M1-cache / M2 / M3 framing): `surfaceM == realSurfaceM` (the real
   *     `eph.radiusMeters(focus)`) and the band is the live animated `orbitBandM` — BYTE-
   *     IDENTICAL to the pre-net-mode behaviour, so no existing framing shifts a pixel;
   *   - net mode ON (the Act-1 toy world): `surfaceM == A1_BODY_RADIUS_M` (300 km) and the band
   *     is {@link A1_RENDER_BAND_M} (1.2·a_GEO) — so the toy GEO/LEO radii fan out off the toy
   *     surface instead of log-folding to sub-pixel.
   * Returns null (identity de-squash) when the band does not clear the surface, exactly as
   * before. Pure — no `this`, no eph, no DOM.
   */
  static computeOrbitScale(
    netRenderMode: boolean,
    realSurfaceM: number,
    animatedBandM: number,
  ): OrbitRenderScale | null {
    const surfaceM = netRenderMode ? A1_BODY_RADIUS_M : realSurfaceM;
    const band = netRenderMode ? A1_RENDER_BAND_M : animatedBandM;
    // The lift/exponent are toy-scaled in net mode (the toy band is ~1 Mm, so the system-
    // scale 18 000 km lift would break the lift < band−surface invariant); off-mode keeps
    // the exact system-scale tunables, so no existing framing changes.
    const lift = netRenderMode ? NET_ORBIT_DESQUASH_LIFT_M : ORBIT_DESQUASH_LIFT_M;
    const altExponent = netRenderMode ? NET_ORBIT_DESQUASH_ALT_EXPONENT : ORBIT_DESQUASH_ALT_EXPONENT;
    return band > surfaceM && surfaceM > 0
      ? { surfaceM, bandOuterM: band, surfaceLiftM: lift, altExponent }
      : null;
  }

  /** The combined focus-relative scale (scene units per TRUE metre) for distance d:
   * the near-body de-squash (when active) re-radii's d FIRST, then the SD-5 log-fold
   * runs on the de-squashed radius. Returns 0 for a degenerate point. The de-squash +
   * fold are both visual lies on rendered radius; the ANGULAR direction (the caller's
   * unit vector) is untouched, and neither ever feeds coverage/link/delay math. */
  private compressScale(d: number): number {
    if (d <= 0) return 0;
    const r = this.orbitScale ? orbitRenderRadius(d, this.orbitScale) : d;
    // scene-units-per-true-metre = (log-fold of the de-squashed radius) / d, so the
    // caller's `f*scale` lands the point at the de-squashed-then-folded radius while
    // keeping the f64 direction exact.
    return (this.cur.logScale * Math.log(1 + r / this.cur.logK)) / d;
  }

  /** Floating-origin rebase (f64 m) → de-squash → log-compress → ecliptic→three, into `out`. */
  private renderInto(out: THREE.Vector3, abs: Vec3, focusAbs: Vec3): THREE.Vector3 {
    const fx = abs[0] - focusAbs[0];
    const fy = abs[1] - focusAbs[1];
    const fz = abs[2] - focusAbs[2];
    const s = this.compressScale(Math.sqrt(fx * fx + fy * fy + fz * fz));
    // ecliptic (x, y, z=north) → three (x, up=z, -y)
    return out.set(fx * s, fz * s, -fy * s);
  }

  /** Same transform written straight into a Float32Array at offset `w`; returns the new offset. */
  private writeRenderPoint(arr: Float32Array, w: number, ax: number, ay: number, az: number, focusAbs: Vec3): number {
    const fx = ax - focusAbs[0];
    const fy = ay - focusAbs[1];
    const fz = az - focusAbs[2];
    const s = this.compressScale(Math.sqrt(fx * fx + fy * fy + fz * fz));
    arr[w++] = fx * s;
    arr[w++] = fz * s;
    arr[w++] = -fy * s;
    return w;
  }

  private applyCamera(): void {
    const el = Math.max(-88 * DEG, Math.min(88 * DEG, this.cur.el));
    const ce = Math.cos(el);
    this.camera.position.set(
      this.cur.dist * ce * Math.sin(this.cur.az),
      this.cur.dist * Math.sin(el),
      this.cur.dist * ce * Math.cos(this.cur.az),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    if (Math.abs(this.camera.fov - this.cur.fov) > 1e-3) {
      this.camera.fov = this.cur.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  private labelFor(id: string): HTMLElement {
    let el = this.labels.get(id);
    if (!el) {
      el = document.createElement("div");
      el.style.position = "absolute";
      el.style.font = "10px var(--mono)";
      el.style.color = "var(--fg-dim)";
      el.style.letterSpacing = "0.08em";
      el.style.transform = "translate(0, -50%)";
      el.style.whiteSpace = "nowrap";
      this.labelLayer.appendChild(el);
      this.labels.set(id, el);
    }
    return el;
  }

  private updateLabels(t: number, focusAbs: Vec3): void {
    const pn = this.presetName();
    const showSats = pn === "EARTH" || pn === "ORBITS" || pn === "CISLUNAR";
    for (const spec of BODIES) {
      const isSat = spec.id.startsWith("sat_");
      const el = this.labelFor(spec.id);
      if (isSat && !showSats) {
        el.style.display = "none";
        continue;
      }
      this.renderInto(this._rp, this.ctx.eph.position(spec.id, t), focusAbs);
      this.tmpV.copy(this._rp).project(this.camera);
      if (this.tmpV.z > 1 || this.tmpV.z < -1) {
        el.style.display = "none";
        continue;
      }
      const x = (this.tmpV.x * 0.5 + 0.5) * this.w;
      const y = (-this.tmpV.y * 0.5 + 0.5) * this.h;
      el.style.display = "block";
      el.style.left = `${x + spec.px * 0.5 + 5}px`; // sit just outside the disc edge
      el.style.top = `${y}px`;
      el.style.color = spec.id === this.focusId ? "var(--cyan)" : "var(--fg-dim)";
      el.textContent = spec.id.replace("sat_", "").toUpperCase();
    }
  }

  private updateCorners(): void {
    const set = (k: string, html: string) => {
      const el = this.labelLayer.querySelector(`.corner.${k}`) as HTMLElement;
      if (el) el.innerHTML = html;
    };
    set("tl", `<b>${this.presetName()}</b>\nfocus <span class="k">${this.focusId.toUpperCase()}</span>`);
    set("tr", `fov ${this.cur.fov.toFixed(0)}°\ndist ${this.cur.dist.toFixed(2)}`);
    // bl — when the heatmap is up, name the active coverage dimension (the §8
    // per-dimension hue the shell is painting) + the LIVE coverage-score readout
    // (the covered-demand fraction that rises as you build — the monument growing)
    // + the build budget, so the build-vs-budget tension reads at a glance.
    if (this.coverageOverlay.visible) {
      const b = this.buildState;
      // The covered-demand fraction reflects the CURRENT (M2e dynamic) demand when the build
      // provider supplies it (it scores against the growing field); fall back to the orrery's
      // own static sweep when there is no build state yet.
      const pct = Math.round((b?.coveredDemandFraction ?? this.coveredDemandFraction) * 100);
      const monument = b
        ? ` · ${b.groundCount}gs/${b.satCount}sat · €${Math.round(b.balanceEur)}${b.bankrupt ? " OVERSPENT" : ""}`
        : "";
      // M2e — the ESCALATION readout: how far the served network has grown total demand above
      // the baseline it started from (the "I solved this, and now it's bigger" cue). Rises as
      // served regions' demand balloons; the covered % erodes against it under fixed capacity.
      let escalation = "";
      if (b && b.baselineDemand > DEMAND_GROWTH_EPSILON) {
        const ratio = b.totalDemand / b.baselineDemand;
        const growthPct = Math.round((ratio - 1) * 100);
        // Guard the readout (belt-and-suspenders): only render when the ratio is finite + sane. A
        // degenerate ratio (NaN/Inf from a bad denominator, or an absurd value from a sim blow-up)
        // would otherwise paint scientific notation ("+6.5e39%") in the chrome. In the degenerate
        // case we OMIT the segment rather than show nonsense — the sim, not the readout, is wrong.
        if (Number.isFinite(growthPct) && growthPct >= 0 && growthPct <= DEMAND_GROWTH_MAX_PCT) {
          escalation = ` · DEMAND·GROWTH <span class="k">+${growthPct}%</span>`;
        }
      }
      // M3a — the ORBITAL-DATACENTER readout (GDD §4.5): the first DC's power / thermal /
      // compute / the bounded force-multiplier it applies. A new line so the §4.5 physics
      // (1/d² power, the radiative thermal cap, the min() compute budget) is glanceable on
      // the same screen as the coverage it lifts. Shows the binding ceiling (PWR vs THERM).
      let dcLine = "";
      if (b && b.datacenters.length > 0) {
        const d = b.datacenters[0];
        const more = b.datacenters.length > 1 ? ` (+${b.datacenters.length - 1})` : "";
        const bind = d.thermalLimited ? "THERM" : "PWR";
        dcLine =
          `\nDC ${d.label}${more} · ${Math.round(d.powerW)}W pwr · ` +
          `${Math.round(d.rejectableHeatW)}W rej · CMP <span class="k">${d.computeUnits.toFixed(1)}u</span>` +
          ` [${bind}] · LIFT <span class="k">×${d.liftMultiplier.toFixed(2)}</span>`;
      }
      set(
        "bl",
        `drag orbit · wheel zoom\nCOVERAGE <span class="k">${this.dimensionLabel()}</span> · ` +
          `COVERED <span class="k">${pct}%</span>${escalation}${monument}${dcLine}`,
      );
    } else {
      set("bl", `drag orbit · wheel zoom · <span class="k">click</span> a body/asset to focus`);
    }
    set(
      "br",
      `<span class="k">E C O S T</span> presets · <span class="k">R</span> reset · <span class="k">F</span> focus · <span class="k">click</span> select\n` +
        `<span class="k">H</span> heatmap · <span class="k">D</span> dim · <span class="k">B</span> deploy · <span class="k">L</span> launch · <span class="k">M</span> datacenter`,
    );
  }

  /**
   * Paint the glanceable readout (M1-10) — text/classes/widths only, no DOM
   * rebuilds. Every colour cue carries a REDUNDANT channel (CVD-safe, GDD §8):
   * the freshness band rides a shape glyph (◆ fresh / ◇ stale / · empty) and a
   * bar width; the conjunction approach rides a bar width + an "OCCULT/Rsun"
   * label, not just colour; blackout is a labelled badge.
   */
  private paintReadout(): void {
    const r = this.readout;
    if (!r) return;

    // MARS CACHE — PEAK freshness across slots (the Mars-node saturation): draining
    // %, shape glyph, tone, and a bar that bleeds to grey.
    const fGlyph = r.band === "fresh" ? "◆" : r.band === "stale" ? "◇" : "·";
    const fTone = r.band === "fresh" ? "good" : r.band === "stale" ? "warn" : "dead";
    setN(this.roFreshGlyph, fGlyph);
    setN(this.roFreshVal, r.freshness > 0 ? fmtPct(r.freshness) : "EMPTY");
    setC(this.roFreshVal, `ro-val ${fTone}`);
    setC(this.roFreshGlyph, `ro-glyph ${fTone}`);
    this.roFreshFill.style.width = `${Math.round(r.freshness * 100)}%`;
    setC(this.roFreshFill, `ro-fill ${fTone}`);

    // SLOTS — occupied / capacity, the contention readout (amber when full).
    setN(this.roSlotsVal, `${r.slotsUsed}/${r.slotCapacity}`);
    setC(this.roSlotsVal, `ro-val ${r.slotsUsed >= r.slotCapacity ? "warn" : "good"}`);

    // PREFETCH POLICY (E8 — the tame-it lever). MANUAL is the dim hand-crank
    // baseline; AUTO @ NN% is the autopilot ON (watch/cyan = under control), and
    // it lights "good"/green the step the autopilot actually FIRES — the relief
    // made glanceable. A blackout pre-stage gets the brightest cue.
    setN(this.roPolicyVal, r.policyLabel);
    const pTone =
      r.policyMode === "manual"
        ? "dead"
        : r.policyPrestaging
          ? "good"
          : r.policyFiring
            ? "good"
            : "watch";
    setC(this.roPolicyVal, `ro-val ${pTone}`);

    // PER-FEED MAP — the Mini-Metro roster: one row per feed with a state glyph
    // (◆ fresh / ◇ stale / ▸ fetching / ○ miss / ▰ blackout), the freshness %, and
    // a freshness bar. Every cue rides the glyph + bar, not just colour (CVD-safe).
    for (const f of r.feeds) {
      const row = this.feedRow(f.id, f.label);
      const g = FEED_GLYPH[f.state];
      const tone = FEED_TONE[f.state];
      setN(row.glyph, g);
      setC(row.glyph, `ro-fglyph ${tone}`);
      // Fetching shows the ETA in place of the %, so the wait reads as gameplay.
      const valText =
        f.state === "fetching" && f.countdownSeconds != null
          ? fmtDuration(f.countdownSeconds)
          : f.freshness > 0
            ? fmtPct(f.freshness)
            : "—";
      setN(row.val, valText);
      setC(row.val, `ro-fval ${tone}`);
      row.fill.style.width = `${Math.round(f.freshness * 100)}%`;
      setC(row.fill, `ro-ffill ${tone}`);
    }

    // FETCH COUNTDOWN — only present while a fetch crawls Earth→Mars.
    if (r.countdownSeconds != null) {
      this.roCountRow.style.display = "flex";
      setN(this.roCountVal, `${fmtDuration(r.countdownSeconds)} · ETA`);
    } else {
      this.roCountRow.style.display = "none";
    }

    // CONJUNCTION APPROACH — the predictable-blackout lead cue (E10a's solar-
    // interference corridor). The bar grows as the Sun-miss margin tightens toward
    // the corridor threshold; the label reads the live Rsun margin while the link
    // is up, then BLACKOUT once the LOS enters the corridor (margin ≤ threshold) —
    // the same verdict the resolver reaches via feasible(). So the player SEES the
    // blackout coming (watch → warn) and pre-staging is a visible skill (§4.3a).
    const cTone = r.inCorridor ? "bad" : r.approachAlarm ? "warn" : r.approach > 0 ? "watch" : "good";
    setN(
      this.roConjVal,
      r.inCorridor
        ? "BLACKOUT"
        : Number.isFinite(r.marginSolarRadii)
          ? `${r.marginSolarRadii.toFixed(1)} Rsun`
          : "CLEAR",
    );
    setC(this.roConjVal, `ro-val ${cTone}`);
    this.roConjFill.style.width = `${Math.round(r.approach * 100)}%`;
    setC(this.roConjFill, `ro-fill ${cTone}`);

    // BLACKOUT badge — link down with no usable cache (a labelled, not just red, cue).
    this.roBlackout.style.display = r.blackout ? "block" : "none";
  }

  // --- input (body-anchored orbit + click-to-focus) ------------------------
  /** How far the pointer has moved (px) since pointerdown, so pointerup can tell a CLICK
   * (pick) from a DRAG (orbit the camera). A click is a press with < a few px travel. */
  private dragTravelPx = 0;

  private attachInput(): void {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.dragTravelPx = 0;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPtr.x;
      const dy = e.clientY - this.lastPtr.y;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.dragTravelPx += Math.abs(dx) + Math.abs(dy);
      this.tgt.az -= dx * 0.006;
      this.tgt.el = Math.max(-88 * DEG, Math.min(88 * DEG, this.tgt.el + dy * 0.006));
    });
    const stop = (e: PointerEvent) => {
      // Fix #4 — CLICK-TO-FOCUS: a press that barely moved is a click, not a drag. Pick
      // the nearest body/asset under the cursor and focus + select it. Raycast/pick runs
      // ON CLICK ONLY (never per frame) — X-02. A drag (camera orbit) skips the pick.
      if (this.dragging && this.dragTravelPx < 5) {
        const rect = this.canvas.getBoundingClientRect();
        this.handleClick(e.clientX - rect.left, e.clientY - rect.top);
      }
      this.dragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.tgt.dist = Math.max(0.4, Math.min(60, this.tgt.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      },
      { passive: false },
    );
  }

  /**
   * Fix #4 — pick the nearest pickable (a body, a deployed sat/ground station, or a DC
   * node) to the click in SCREEN space, then SELECT + FOCUS it. The pick is the pure
   * {@link pickNearest} over each candidate's projected billboard centre (constant-screen-
   * size sprites ⇒ screen-space nearest is the robust pick). On a hit: mark it selected
   * (the selection ring) and, if it is a focusable BODY, frame the camera on it; assets/
   * DCs select-only (the camera stays on the parent body so the orbit stays in view).
   * Render-only — touches no sim/economy/coverage state. Runs once per click.
   */
  private handleClick(clickX: number, clickY: number): void {
    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    const cands: PickCandidate[] = [];
    const project = (id: string, abs: Vec3): void => {
      this.renderInto(this._rp, abs, focusAbs);
      this.tmpV.copy(this._rp).project(this.camera);
      const onScreen = this.tmpV.z <= 1 && this.tmpV.z >= -1;
      cands.push({
        id,
        sx: (this.tmpV.x * 0.5 + 0.5) * this.w,
        sy: (-this.tmpV.y * 0.5 + 0.5) * this.h,
        onScreen,
      });
    };
    // Bodies (the F-cycle focusables + the dataset sats).
    for (const spec of BODIES) project(spec.id, this.ctx.eph.position(spec.id, t));
    // The player's deployed assets + DCs (the monument) — selectable but not camera-focusable.
    const bs = this.buildState;
    if (bs) {
      for (const a of bs.assets) project(a.id, a.posM);
      for (const d of bs.datacenters) project(d.id, d.posM);
    }
    const hit = pickNearest(cands, clickX, clickY, PICK_TOLERANCE_PX);
    if (hit === null) return;
    this.selectedId = hit;
    // Focus the camera only on a focusable BODY; assets/DCs select-only (keep the parent
    // framed so the orbit + the rest of the constellation stay on screen).
    if (FOCUS_ORDER.includes(hit)) this.focusId = hit;
  }

  /** The currently selected asset/body id (click- or F-selected), or null. */
  selected(): string | null {
    return this.selectedId;
  }
}

/**
 * Fix #2 — sample a launched sat's full orbit RELATIVE TO ITS PARENT (metres), as
 * `count` points evenly spaced around the orbit, mirroring Ephemeris.sampleRelativeOrbit
 * for dataset bodies. The mean anomaly sweeps a full 2π by stepping the propagation time
 * across one orbital period via the pure {@link solveOrbit} (so the ring matches the
 * sat's actual swept path). A degenerate orbit (zero period) yields a single point.
 * Pure; allocates the sample array (called only on a roster change, never per frame).
 */
export function sampleSatOrbitRelative(orbit: SatOrbit, count: number): Vec3[] {
  const period = orbitPeriodSeconds(orbit);
  const out: Vec3[] = [];
  if (period <= 0) return [solveOrbit(orbit, orbit.epochS)];
  for (let k = 0; k < count; k++) {
    out.push(solveOrbit(orbit, orbit.epochS + (period * k) / count));
  }
  return out;
}

// --- tiny in-place DOM helpers (no per-frame allocation in paintReadout) -----

/** Set textContent only when it changed. */
function setN(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

/** Set className only when it changed. */
function setC(node: HTMLElement, cls: string): void {
  if (node.className !== cls) node.className = cls;
}
