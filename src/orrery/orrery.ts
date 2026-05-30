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
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: "CISLUNAR", focus: "earth", az: 0 * DEG, el: 22 * DEG, dist: 3.2, fov: 50, logK: 2.0e8, logScale: 1.4 },
  { name: "ORBITS", focus: "earth", az: 35 * DEG, el: 30 * DEG, dist: 5.0, fov: 46, logK: 9.0e6, logScale: 1.15 },
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
}

/** M2c — the LIVE build roster + coverage score the orrery renders (the monument).
 * Supplied per-frame by main.ts from the pure BuildSession; the orrery reads it to
 * (1) draw ground-station + sat markers, (2) sweep the heatmap off the LIVE roster,
 * and (3) show the coverage-score readout that rises as you build. */
export interface BuildRenderState {
  assets: BuildAssetRender[];
  /** Covered-demand fraction ∈ [0,1] — the headline "the web grew" readout. */
  coveredDemandFraction: number;
  /** Ground-station + launched-sat counts (the "size of the monument"). */
  groundCount: number;
  satCount: number;
  /** On-hand € (build-vs-budget) + bankruptcy (overspent). */
  balanceEur: number;
  bankrupt: boolean;
}

export interface OrreryCtx {
  eph: Ephemeris;
  now(): number;
  packet(): PacketRenderState | null;
  /** M2c — the live build roster + coverage score (null until wired). */
  build?(): BuildRenderState | null;
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
/** Max placed-asset markers the orrery draws at once (the marker pool size). The
 * coverage sweep itself is unbounded; only the on-screen marker glyphs are capped. */
const MAX_BUILD_MARKERS = 48;
/** Earth billboard px (mirrors the BODIES "earth" entry) — used to size the shell
 * so it hugs the Earth disc on screen. Kept in one place. */
const EARTH_BILLBOARD_PX = 40;

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
  private activePreset = 2; // SYSTEM — the Earth→Mars money shot

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

  private quad = new THREE.PlaneGeometry(1, 1);
  private tmpV = new THREE.Vector3();
  // scratch reused every frame — the hot loop allocates no new Vector3/Color
  private _rp = new THREE.Vector3();
  private _rp2 = new THREE.Vector3();
  private _earthR = new THREE.Vector3();
  private _marsR = new THREE.Vector3();
  private _sunDir = new THREE.Vector3();
  private readonly _amber = new THREE.Color(1.0, 0.62, 0.18);
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

  constructor(private ctx: OrreryCtx) {
    this.host = document.createElement("div");
    this.host.className = "orrery-host";
    this.canvas = document.createElement("canvas");
    this.host.appendChild(this.canvas);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "orrery-overlay";
    this.host.appendChild(this.labelLayer);
    this.buildOverlayCorners();
    this.buildReadout(); // builds the block + caches its sub-nodes (no field needed)

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x0b0b12, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const p = CAMERA_PRESETS[this.activePreset];
    this.focusId = p.focus;
    this.cur = { az: p.az, el: p.el, dist: p.dist, fov: p.fov, logK: p.logK, logScale: p.logScale };
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
    this.tgt = { az: p.az, el: p.el, dist: p.dist, fov: p.fov, logK: p.logK, logScale: p.logScale };
  }

  resetCamera(): void {
    this.setPreset(this.activePreset);
  }

  cycleFocus(dir: number): void {
    const i = FOCUS_ORDER.indexOf(this.focusId);
    this.focusId = FOCUS_ORDER[(i + dir + FOCUS_ORDER.length) % FOCUS_ORDER.length];
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
    this.applyCamera();

    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    const sunAbs = this.ctx.eph.position("sun", t);

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

    // M2b/M2c — the coverage heatmap shell (only when toggled on), now swept off the
    // LIVE roster, plus the placed-asset markers so the built network is visible.
    if (this.coverageOverlay.visible) {
      this.updateCoverageHeatmap(t, focusAbs, worldPerPx);
      this.updateBuildMarkers(focusAbs, worldPerPx);
    } else {
      for (const m of this.buildMarkers) m.visible = false;
    }

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
    let slot = 0;
    for (const a of assets) {
      if (slot >= this.buildMarkers.length) break;
      const m = this.buildMarkers[slot];
      this.renderInto(this._rp, a.posM, focusAbs);
      m.position.copy(this._rp);
      // Ground stations read a hair smaller than launched sats (the §8 size cue).
      this.sizeBillboard(m, a.kind === "ground" ? 7 : 9, worldPerPx);
      m.visible = true;
      slot++;
    }
    for (let i = slot; i < this.buildMarkers.length; i++) this.buildMarkers[i].visible = false;
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

  /** focus-relative log-compression scale (scene units per metre) for distance d. */
  private compressScale(d: number): number {
    return d > 0 ? (this.cur.logScale * Math.log(1 + d / this.cur.logK)) / d : 0;
  }

  /** Floating-origin rebase (f64 m) → log-compress → ecliptic→three, written into `out`. */
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
    const showSats = this.presetName() === "ORBITS" || this.presetName() === "CISLUNAR";
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
      const pct = Math.round(this.coveredDemandFraction * 100);
      const b = this.buildState;
      const monument = b
        ? ` · ${b.groundCount}gs/${b.satCount}sat · €${Math.round(b.balanceEur)}${b.bankrupt ? " OVERSPENT" : ""}`
        : "";
      set(
        "bl",
        `drag orbit · wheel zoom\nCOVERAGE <span class="k">${this.dimensionLabel()}</span> · ` +
          `DEMAND <span class="k">${pct}%</span>${monument}`,
      );
    } else {
      set("bl", `drag orbit · wheel zoom`);
    }
    set(
      "br",
      `<span class="k">C O S T</span> presets · <span class="k">R</span> reset · <span class="k">F</span> focus\n` +
        `<span class="k">H</span> heatmap · <span class="k">D</span> dim · <span class="k">B</span> deploy · <span class="k">L</span> launch`,
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

  // --- input (body-anchored orbit) ----------------------------------------
  private attachInput(): void {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPtr.x;
      const dy = e.clientY - this.lastPtr.y;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.tgt.az -= dx * 0.006;
      this.tgt.el = Math.max(-88 * DEG, Math.min(88 * DEG, this.tgt.el + dy * 0.006));
    });
    const stop = (e: PointerEvent) => {
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
