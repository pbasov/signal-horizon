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
import { COASTLINES } from "./coastlines";
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
  /**
   * net/ Act-1 — NET-RENDER-MODE framing override. The SYSTEM/TOP-DOWN presets are heliocentric
   * in cache mode (focus the Sun, system-scale log-fold) — but the connectivity game has NO
   * heliocentric scene, so net mode would frame a sun-focused void and render BLACK. When net
   * render mode is on, {@link Orrery.netFrame} substitutes these fields (Earth-orbit-scale fold +
   * sane distance) so the preset frames the operated Earth + its constellation instead. Each field
   * falls back to the cache value when absent. Cache mode ignores this entirely (byte-identical).
   */
  net?: Partial<Pick<CameraPreset, "az" | "el" | "dist" | "fov" | "logK" | "logScale" | "orbitBandM">>;
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
  // SYSTEM — cache mode: the heliocentric Earth→Mars money shot. NET mode: a pulled-back CISLUNAR
  // overview (the `net` override re-frames it Earth-centric at a cislunar fold so Earth + the Moon
  // + the constellation all read, instead of a black sun-focused void).
  {
    name: "SYSTEM", focus: "sun", az: 0 * DEG, el: 24 * DEG, dist: 11, fov: 50, logK: 9.0e10, logScale: 3.6,
    // NET cislunar overview: the SAME readable Earth fold as the EARTH preset (logK 6e7 keeps the
    // toy globe a clear disc — the cislunar fold logK 2e8 collapsed it to sub-pixel), pulled back
    // far enough that the real-distance Moon (on the honest log-fold past the 2e8 de-squash band)
    // lands in frame. Earth ~110px + Moon to one side = the Earth+Moon "system" shot.
    net: { az: 28 * DEG, el: 26 * DEG, dist: 6.6, fov: 50, logK: 6.0e7, logScale: 1.25, orbitBandM: 2.0e8 },
  },
  // TOP-DOWN — cache mode: looking down the ecliptic. NET mode: a north-pole-down view of the
  // operated Earth so the orbital PLANES of the launched constellation read from above.
  {
    name: "TOP-DOWN", focus: "sun", az: 0 * DEG, el: 88 * DEG, dist: 13, fov: 46, logK: 9.0e10, logScale: 3.6,
    net: { az: 0 * DEG, el: 86 * DEG, dist: 3.4, fov: 48, logK: 9.0e6, logScale: 1.15, orbitBandM: 8.0e7 },
  },
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
  /** FL-14 (SD-49) — sim-seconds since this sat DEPLOYED (present only while < 3 s): the
   * deploy POP — a one-shot expanding flash at separation, decaying quadratically (the
   * launch payoff, per member). Undefined = no pop. */
  freshAgeS?: number;
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
  /**
   * §3 — THE OPERATED BODY (body-agnostic). The body the active contract's region sits on (its
   * `region.bodyId`), supplied per-frame so the orrery draws a REAL 3D sphere at THAT body's render
   * radius + focuses/zooms it when the planner is open. NEVER hardcoded "earth": for the toy net
   * frame this is "earth" with `renderRadiusM == A1_BODY_RADIUS_M` (the de-squashed toy radius); for
   * any other body it is that body's id + its real `eph.radiusMeters(bodyId)`. Null only before a
   * contract exists (then the orrery falls back to the camera focus body). */
  body: {
    /** The operated body's ephemeris id (the region's bodyId, or the focus body). */
    id: string;
    /** Earth-relative-or-absolute world position (m) of the body centre at this t — the orrery
     * rebases it like any body (it is just `eph.position(id, t)`). */
    centerPosM: Vec3;
    /** The body's RENDER radius (metres): A1_BODY_RADIUS_M for the toy net frame, the real
     * ephemeris radius otherwise. The de-squash/log-fold turn this into scene units. */
    renderRadiusM: number;
    /** The body spin angle θ(t) (radians) so the graticule visibly turns with the body. */
    spinThetaRad: number;
    /** True while the LAUNCH PLANNER is open/active — the orrery focuses + zooms this body CLOSE so
     * coverage reads in detail, then smoothly restores the normal framing when it goes false. */
    plannerActive: boolean;
  } | null;
  /** The Act-1 region: its body-fixed surface world point, angular radius, and SERVED state. */
  region: {
    id: string;
    /** Earth-relative world position (m) of the region-centre surface point at this t. */
    centerPosM: Vec3;
    /** Angular radius of the region disc (radians) — sizes the lit disc on the globe. */
    radiusRad: number;
    /** True the instant router.solve reports the region SERVED (lit); false ⇒ dim. */
    served: boolean;
    /** R2 (SD-45): signed-and-dark ⇒ the queue ring pulses (bleeding, not just dim). */
    active?: boolean;
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
  /** FL-UX — the CLICK-INSPECT blob: when the player has clicked a net sat, its coverage blo
   * rendered against the ball (a bent surface patch, not a plate): for BROADCAST, the nadir
   * horizon cap; for a pointed spot-beam, a cap over the AIMED region only (honest: a beam
   * pointed nowhere covers nothing). */
  focusBlob: { centerPosM: Vec3; radiusRad: number } | null;
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
  /**
   * Act-4 — THE MARS FRONTIER TEASER render slice (design §4.5 / §8, "distance changes
   * everything" — the vertigo, BY SIGHT). Present only once the act4 beat has emitted the Mars
   * opportunity; null on Acts 1–3. The Earth↔Mars signal CRAWLS at the REAL light delay (the
   * SAME `oneWaySeconds(distanceBetween)` machinery the M1-cache packet uses), the Mars data node
   * DESATURATES toward machine-grey as it ages (freshness-as-saturation, reused), and the readout
   * reads "as of Nm ago". A pure read off the live NetSession (session.mars / marsAgeS / marsFreshness);
   * NO sim feedback — the minutes-long latency is a READOUT, never a breach axis (§8 fenced). */
  mars: {
    /** The Mars region/data-node id (MARS-1) — the node drawn at Mars's render position. */
    id: string;
    /** Whether the deep-space MARS RELAY is launched (its presence bridges the leg by construction).
     * Until launched, the leg is dim + the crawl is "no signal yet". */
    relayLaunched: boolean;
    /** Earth-relative world position (m) of the launched relay (drawn as a node on the Earth side),
     * or null when no relay is up. */
    relayPosM: Vec3 | null;
    /** The REAL one-way Earth↔Mars light delay (s) at this t — the crawl's transit time + the
     * sample half-life (SD-19). Drives the "the signal takes Nm to cross" readout. */
    oneWayS: number;
    /** The crawl progress ∈ [0,1] of the in-flight Earth→Mars signal at light speed (a render-only
     * cycle keyed on sim-time / oneWayS), so the signal VISIBLY crawls. null until the relay is up. */
    crawlProgress: number | null;
    /** The Mars sample's AGE (s) — `t − capturedAtT` ("as of Nm ago"); null until a sample exists. */
    sampleAgeS: number | null;
    /** The Mars sample FRESHNESS ∈ [0,1] (the reused `delay.ts` 2^(−age/half) curve) — drives the
     * data-node DESATURATION (full → machine-grey). null until a sample exists. */
    freshness: number | null;
    /** True the step the cache breadcrumb is placed (freshness jumps back to full) — a one-shot
     * cue the readout can flash. Render-derived in main.ts; never folded. */
    breadcrumbPlaced: boolean;
  } | null;
  /**
   * §3 — THE LIVE PLANNER DRAFT consequence, drawn on the globe AS THE PLAYER DRAGS (the spec's
   * make-or-break UX: "you are not setting inclination to 53°, you are dragging the orbit until its
   * ground-track covers the region that's currently dark"). A render-only projection of the pure
   * {@link import("../sim/net/world").previewLaunch} outputs — NO geometry is recomputed here. Null
   * when the planner is not the active focus (or net mode is off). Updates every frame the draft
   * changes, so the footprint disc + ground-track arc + coverage-gap overlay move live with the
   * sliders/arrow-keys. The committed launch is unaffected (this is preview-only). */
  draft: {
    /** The draft footprint disc (the would-be sat's nadir + its coverage angular radius) — the
     * cyan-dashed "here's where it points right now" preview, distinct from a committed footprint. */
    footprint: { centerPosM: Vec3; radiusRad: number } | null;
    /** The draft GROUND-TRACK arc: the body-fixed sub-points over one period (GEO parks ⇒ a point;
     * LEO walks ⇒ an arc), each already lifted to an earth-relative surface world point so the
     * orrery rebases them like any body. Empty until a draft exists. */
    groundTrack: Vec3[];
    /** THE CONTRACT COVERAGE-GAP OVERLAY (§3.1): the region disc with the still-dark fraction painted
     * RED and the covered fraction painted GREEN, so the player drags until the red shrinks. Null
     * until a region is live. `coveredFraction` ∈ [0,1] is previewLaunch's truthful per-contract
     * coverage of THIS draft. */
    gap: { centerPosM: Vec3; radiusRad: number; coveredFraction: number } | null;
    /** THE DRAFT ORBIT RING (§3.1 — "see the orbit before you launch"): the would-be orbit sampled
     * over one period as earth-relative world points, so the player SEES the path they're about to
     * launch — and the knobs visibly move it (altitude resizes, inclination tilts, RAAN rotates the
     * plane). Drawn through the SAME de-squash/log-fold the launched-sat rings use, so the preview
     * ring lands exactly where the committed sat's ring will. Empty until a draft exists. */
    orbitRing: Vec3[];
    /** Every batch member's park position at commit (N markers; a 0° spread stacks them). */
    memberPosM: Vec3[];
    /** FL-UX DRAFT-BATCH — one surface blob per member (the sweep-band the comb only shows
     * in time). nadir surface point + cap radius each. */
    memberBlobs: { centerPosM: Vec3; radiusRad: number }[];
    /** The draft sat's CURRENT position on that ring (the phase marker — moves as PHASE changes), an
     * earth-relative world point. Null until a draft exists. */
    satPosM: Vec3 | null;
    /** FL-13 (SD-49) — the draft orbit's ALTITUDE above the surface (metres). The ring-grab
     * drag reads it as the grab-start value (the callback emits absolute altitudes). */
    altM: number;
  } | null;
  /**
   * §3 / Act-1 "signal reaches there" — the SERVED region→sat→ground LINK beam, drawn when a
   * LAUNCHED sat currently bridges the active region to the ground network. Three earth-relative
   * world points (region surface → sat → ground surface); the orrery draws a bright beam through
   * them so "the signal reaches there" is visible on the globe (currently not drawn). Null when no
   * launched sat serves the region. A render-only read of the SAME bridge the router uses. */
  servedLink: { regionPosM: Vec3; satPosM: Vec3; groundPosM: Vec3 } | null;
  /** SD-45 — assigned spot beams sat→region; blind = pointed with no line of sight (red). */
  beamPointers: { fromPosM: Vec3; toPosM: Vec3; blind: boolean }[];
  /** SD-45 — in-flight launch arcs (pad → first member park), progress-clipped. */
  launchArcs: { points: Vec3[]; progress: number; lost: boolean }[];
  /** R2e (SD-45) — ground stations + the launch pad, drawn + labeled on the globe. */
  sites: { id: string; label: string; kind: "ground" | "pad"; posM: Vec3 }[];
  /**
   * P1 (GDD §5 survival condition) — THE LIVE NETWORK, DRAWN. One entry per ACTIVE served contract:
   * the router's own path `region→…→sat→…→ground` (the {@link import("../sim/net/router").SolveResult}
   * `path` node ids, resolved to earth-relative world points main.ts feeds in — NO geometry recomputed
   * here), so EVERY contract's current serving path is a beam on the globe (the P0 single beam
   * generalized to all contracts + a constellation hand-off: as a LEO sets and the router re-solves to
   * the rising sat, the beam migrates because `path[1]` migrates).
   *
   * COLOUR BY UTILISATION / HEADROOM (§4.3, was text-only): each hop carries a `util ∈ [0,1]` =
   * `loadOnSat(sat) / NET_LINK_CAPACITY_UNITS` (the session's shared-load aggregate), mapped
   * cool-green (headroom) → amber (near capacity) → red (at/over capacity) so a congesting link is
   * VISIBLE before it breaches. `rerouteAge ∈ [0,1]` rises to 1 the instant the path's bridging sat
   * changed (a set/fault re-route) and decays — the orrery flashes the new path so the self-healing
   * re-route reads, rather than snapping invisibly. Empty until ≥1 active contract is served. */
  /**
   * SD-53 — THE TRACED FLOW (GDD §5 view #4 / §4.3a: "pick a flow … the orrery renders its actual
   * current path"). The contract id selected in the routing table, or null. The traced path renders
   * at full strength while every OTHER served path drops to {@link NET_TRACE_DIM} — so the answer
   * to "where does this one actually go" is a picture, not a row of ids. Render-only.
   */
  tracedContractId: string | null;
  /**
   * SD-53 — THE CANDIDATE ARCS. For the traced flow, one dashed arc region→sat for every OTHER
   * satellite whose link to that region CLOSES RIGHT NOW. This is the lawful answer to the fact
   * that the route-bias lever frequently cannot move anything: it is geometry recomputed this
   * frame, not a preview of what the solver would choose (which would be a pre-commit verdict).
   * When the lever does nothing, the absence of a second arc is the reason, made spatial.
   */
  candidateArcs: { fromPosM: Vec3; toPosM: Vec3 }[];
  servedLinks: {
    /** The contract id this path serves (the re-route tracker keys on it). */
    contractId: string;
    /** The hop world points, region→…→ground (≥2). Each adjacent pair is one drawn segment. */
    points: Vec3[];
    /** Utilisation ∈ [0,1] of the bridging sat (loadOnSat / capacity) — drives the green→red tint. */
    util: number;
    /** Re-route flash ∈ [0,1]: 1 the frames just after the bridging sat changed, decaying to 0. */
    rerouteAge: number;
  }[];
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
/** NET-MODE GLOBE FRAMING (fix #1 — the make-or-break "the on-globe consequence must READ").
 * At the cache-mode EARTH framing the toy Earth is a thumbnail and the draft footprint /
 * ground-track / coverage-gap discs cluster sub-pixel, so "drag the orbit and watch the
 * footprint cover the dark region" does not visually land. In net mode we (a) ZOOM the camera —
 * a closer dist + narrower fov pulls the toy globe + its de-squashed LEO/GEO rings LARGE and
 * CENTRAL — and (b) MAGNIFY the toy-globe billboard + every overlay disc by the SAME factor so
 * the region / footprint / gap / ground-track read at that framing. Both are RENDER-ONLY (no
 * sim, no de-squash math, no golden); applied ONLY when {@link Orrery.netRenderMode} is on, so
 * every cache-mode framing is byte-identical. `DIST_SCALE` < 1 dollies in; `FOV_SCALE` < 1
 * narrows the lens; `PX_SCALE` enlarges the billboard glyphs to match the dolly-in. */
const NET_CAMERA_DIST_SCALE = 1.6;
const NET_CAMERA_FOV_SCALE = 0.7;
const NET_GLOBE_PX_SCALE = 4.4;
/** net/ Act-1 — Moon billboard magnification in net mode so the cislunar scale reference reads
 * (its raw 16px terminator disc is otherwise a sub-pixel speck at the toy globe fold). */
const NET_MOON_PX_SCALE = 2.6;
/** §3 — THE PLANNER CLOSE-UP framing. When the LAUNCH planner is open/active, the camera FOCUSES
 * the operated body and ZOOMS IN CLOSE so the region + the coverage gap read IN DETAIL (the region
 * fills a good part of the view, not a sub-pixel dot). On top of the net dolly-in we pull the
 * distance down + narrow the lens further; the body de-squash + the sphere render radius do the
 * rest. Render-only; restored smoothly (the same lerp the presets use) the instant the planner
 * closes. `< 1` dollies in / narrows. */
const NET_PLANNER_DIST_SCALE = 0.42;
const NET_PLANNER_FOV_SCALE = 0.78;
/** §3 — THE PLANNER CLOSE-UP SPHERE FILL (BUG-2 fix). The fixed {@link NET_PLANNER_DIST_SCALE}
 * dolly framed the toy sphere at ~11px — a speck — because the operated-body SCENE radius (~0.006
 * units, the de-squashed/log-folded toy radius) is tiny and a fixed dolly cannot know it. Instead,
 * at the close-up we compute the camera distance DIRECTLY from the sphere's scene radius so the
 * sphere DIAMETER fills this fraction of the pane HEIGHT, regardless of the de-squash scale:
 *   the sphere (radius R, at the look-at origin) subtends half-angle asin(R/d); its on-screen
 *   radius as a fraction of the half-FOV is (R/d)/tan(halfFov). For a diameter == FILL·h the
 *   on-screen radius == FILL·h/2, i.e. that half-FOV fraction == FILL, so
 *       d = R / (FILL · tan(halfFov)).
 * FILL 0.40 ⇒ the sphere fills ~40% of the pane height (a big, central, legible globe). */
const NET_PLANNER_SPHERE_FILL = 0.4;
/** §3 — THE OPERATED-BODY SPHERE. A real {@link THREE.SphereGeometry} (NOT a billboard) drawn for
 * the operated body in net render mode: a dim, dark, 1-bit-styled globe at the body's render radius
 * with a lat/lon GRATICULE that rotates with the body spin θ(t). The geometry is a UNIT sphere
 * (radius 1, scaled per-frame to the de-squashed render radius); the graticule is built once over
 * the unit sphere + spun by θ(t). Body-agnostic: nothing here references "earth" — the id + radius
 * arrive in the {@link NetRenderState.body} slice. */
const NET_SPHERE_SEGMENTS = 48;
/** Graticule density: parallels (lat lines) + meridians (lon lines) over the unit sphere. */
const NET_GRATICULE_PARALLELS = 6;
const NET_GRATICULE_MERIDIANS = 12;
const NET_GRATICULE_SAMPLES = 64;
/** §3 — surface coverage-disc tessellation: a tangent surface patch (a small spherical cap) is
 * drawn as a triangle fan of this many segments, oriented to lie ON the sphere surface (not a
 * camera-facing billboard) so the region / footprint / gap paint flat against the globe. */
const NET_SURFACE_DISC_SEGMENTS = 40;
/** Click-to-focus pick tolerance (px): a click within this of a billboard's projected
 * centre selects + focuses it. Generous, since billboards are constant-screen-size. */
const PICK_TOLERANCE_PX = 26;
/** Act-2 — max footprint discs the orrery draws at once (the hand-off pool). A constellation
 * is a small set (the measured zero-gap N=4, plus headroom for over-build); only the on-screen
 * discs are capped, the served verdict itself is unbounded. */
const MAX_NET_FOOTPRINTS = 12;
/** P1 (GDD §5) — the LIVE-NETWORK link buffer caps: at most this many active served contracts'
 * paths are drawn at once, each with up to this many hops (region→sat→ground = 2 hops in Act 1;
 * headroom for the multi-hop relay graph of Acts 2–3). The pooled LineSegments holds
 * MAX_NET_LINKS·MAX_NET_LINK_HOPS segments; per-frame the writer fills the in-use prefix. */
const MAX_NET_LINKS = 16;
/** SD-53 — how far an UNTRACED path's colour is pulled down while another flow is traced. Dim
 * enough that the traced path is unmistakable, bright enough that the rest of the network is still
 * a network. The utilisation ramp itself is untouched (Orrery.utilColor is pinned by a test) — this
 * scales the result, so a congesting sibling still reads warm, just quieter. */
const NET_TRACE_DIM = 0.3;
/** Max candidate arcs drawn at once (other pipes whose link to the traced region closes now). */
const MAX_NET_CANDIDATES = 12;
const MAX_NET_LINK_HOPS = 4;
/** §3 — the DRAFT ground-track dashed-line vertex cap (the previewLaunch ground-track is sampled
 * at NET_GROUND_TRACK_SAMPLES=64 over one period; the line draws a dash per adjacent pair). */
const NET_DRAFT_TRACK_SAMPLES = 64;
/** Segments in the DRAFT ORBIT RING (the would-be orbit drawn in space). Must match the sample count
 * main.ts puts in the draft slice's `orbitRing` (NET_DRAFT_RING_SAMPLES there). */
const NET_DRAFT_RING_SAMPLES = 96;
/** Launched-sat orbit rings: samples per ring (matches the dataset ring density). */
const SAT_RING_SAMPLES = 96;
/** Max launched-sat orbit rings drawn at once (a pool; the roster sat count is small). */
const MAX_SAT_RINGS = 24;

// SURFACE-CAP VERTEX (the FL-UX surface-hug): the still-flat unit disc gets pulled DOWN
// toward the sphere — position.xy is the plate's unit radius; z bends by (1−cos(ρ)) in
// plate-local units so the rim lands ON the ball, not on paper over it.
const VERT_BENT = /* glsl */ `
  uniform float uRadiusRad; // the cap's surface angular radius (radians)
  uniform float uBend;      // 0 = flat plate, 1 = hug
  out vec2 vUv;
  void main() {
    vUv = uv;
    vec3 pos = position;
    float d = length(position.xy);
    float rho = d * uRadiusRad;
    float sag = (1.0 - cos(rho)) / max(1e-5, sin(uRadiusRad));
    pos.z -= uBend * sag;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
  }
`;

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

/**
 * §3 — THE OPERATED-BODY SPHERE shaders. A REAL 3D sphere (NOT a billboard): the vertex shader
 * carries the view-space normal so the fragment shader can Lambert-shade a dim, dark, 1-bit
 * (Bayer-dithered) globe — the same stipple aesthetic as the body billboards, but on actual
 * geometry. Kept deliberately dark so the bright coverage overlay pops against it (the planner
 * "dim the sphere under the region so the overlay pops" cue). The sun direction is a view-space
 * uniform set per frame (the same value the billboard terminator uses). */
const SPHERE_VERT = /* glsl */ `
  out vec3 vNormalView;
  void main() {
    vNormalView = normalize(normalMatrix * normal);
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const SPHERE_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uSunDirView;
  uniform float uCell;
  uniform float uDim;
  in vec3 vNormalView;
  out vec4 fragColor;
  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  void main() {
    vec3 N = normalize(vNormalView);
    float lambert = clamp(dot(N, normalize(uSunDirView)), 0.0, 1.0);
    // A DIM, DARK globe: a low day-side, a near-black night side, so the bright surface
    // coverage overlay reads clearly against it. uDim scales the whole thing down.
    float bright = mix(0.06, 0.42, lambert) * uDim;
    ivec2 ip = ivec2(mod(gl_FragCoord.xy / uCell, 4.0));
    float threshold = (BAYER[ip.y * 4 + ip.x] + 0.5) / 16.0;
    // SD-45 FLICKER FIX — SOFT ordered dither on a SOLID globe. The old binary discard
    // popped whole cells whenever sub-pixel motion (floating-origin jitter / rotation)
    // nudged a cell across its threshold — the perceived "flickering". Each cell now
    // FADES across a one-Bayer-step band, and nothing is discarded (no depth holes):
    // between-dots pixels paint the near-black globe base, so the body stays solid.
    float mask = smoothstep(threshold - 0.05, threshold + 0.05, bright);
    vec3 base = vec3(0.030, 0.032, 0.050);
    fragColor = vec4(mix(base, uColor, mask), 1.0);
  }
`;

/** §3 — the SURFACE-COVERAGE-PATCH shader. The region / footprint / coverage-gap discs are drawn as
 * flat triangle-fan caps oriented to lie ON the sphere surface (NOT camera-facing billboards), so
 * coverage paints flat against the globe. A radial Bayer-dithered fill (bright centre, soft edge)
 * keeps the 1-bit aesthetic; `uColor` is the high-contrast tint (region bright, gap RED, covered
 * GREEN, footprint cyan). Position is a local unit disc in the patch's own tangent plane (vUv ∈
 * [0,1]²); the mesh's matrix orients + scales it onto the surface point. */
const SURFACE_DISC_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uCell;
  uniform float uAlpha;
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
    // Bright interior with a soft dithered rim so the patch reads as a crisp coverage spot.
    float bright = mix(1.0, 0.35, smoothstep(0.65, 1.0, r)) * uAlpha;
    // SD-45 FLICKER FIX — SOFT screen-locked dither. The old binary discard popped whole
    // cells under sub-pixel motion (the "region keeps flickering" report). Screen-locked
    // cells keep the dots stationary while the patch slides beneath; the soft one-step
    // threshold band makes each dot FADE in/out instead of popping. Alpha-blended (the
    // discs are already transparent + renderOrder-stacked).
    ivec2 ip = ivec2(mod(gl_FragCoord.xy / uCell, 4.0));
    float threshold = (BAYER[ip.y * 4 + ip.x] + 0.5) / 16.0;
    float mask = smoothstep(threshold - 0.05, threshold + 0.05, bright);
    if (mask <= 0.004) discard;
    fragColor = vec4(uColor, mask);
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
   * net-game wiring (A4 human pass); default OFF so every existing framing is unaffected.
   *
   * fix #1 — turning it ON (after construction, by the net boot) ALSO re-applies the active
   * preset through the net-globe FRAMING ({@link Orrery.netFrame}) so the toy globe snaps LARGE
   * and central; turning it off restores the cache framing. The backing field + setter keep this
   * a single source of truth (the per-frame body/disc magnification also reads the flag). */
  private _netRenderMode = false;
  get netRenderMode(): boolean {
    return this._netRenderMode;
  }
  set netRenderMode(on: boolean) {
    if (this._netRenderMode === on) return;
    this._netRenderMode = on;
    // fix #2 — HIDE the M1-cache MARS-CACHE readout overlay in net mode (the net game has its
    // own net-avail / net-mars overlays). The block stays painted (cheap) but is display:none.
    if (this.readoutBox) this.readoutBox.style.display = on ? "none" : "";
    // Re-target the camera through the (possibly net) framing so the toy globe is large + central
    // the instant net mode is entered (the flag is set after construction). Render-only.
    this.setPreset(this.activePreset);
  }

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
  /** The MARS-CACHE glanceable readout block (the freshness / SLOTS / PREFETCH / feeds / FETCH-ETA
   * / CONJUNCTION overlay). It belongs to the M1-cache game — HIDDEN in net mode (fix #2), where
   * the net-avail meter + net-mars readout carry the connectivity-game overlay instead. */
  private readoutBox!: HTMLElement;

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
  private netQueueRing?: THREE.Mesh;
  private netSiteMarkers: THREE.Mesh[] = [];
  /** Act-2 — a POOL of footprint discs (one per covering sat), parked over the region (the
   * cover→paid beat, generalized to a hand-off: several discs sweep so one slides on as
   * another slides off). Built once + hidden; updateNetOverlay shows/positions the in-use set. */
  private netFootprintMeshes: THREE.Mesh[] = [];
  private netFocusBlob?: THREE.Mesh;
  private netMemberBlobs: THREE.Mesh[] = [];

  /** FL-UX probe: is the click-inspect blob drawn right now (its mesh's live visibility). */
  netBlobVisibility(): boolean {
    return this.netFocusBlob?.visible ?? false;
  }

  /** FL-UX probe: how many DRAFT-BATCH blobs are on-screen right now. */
  netMemberBlobCount(): number {
    return this.netMemberBlobs.filter((m) => m.visible).length;
  }
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

  // --- net/ Act-4 Mars frontier teaser overlay (design §4.5 / §8) -------------
  /** The Mars DATA NODE disc drawn at Mars's render position in net mode: a hot "fresh data" disc
   * that DESATURATES toward machine-grey as `mars.freshness` drains (freshness-as-saturation, the
   * SAME grey→hot lerp the packet uses). Built once + hidden; shown only in net mode at act4. */
  private netMarsNode?: THREE.Mesh;
  /** The deep-space MARS RELAY node (the Earth-side relay the player launched), a distinct cyan
   * disc. Built once + hidden; shown when the relay is launched. */
  private netMarsRelay?: THREE.Mesh;
  /** The Act-4 Earth↔Mars signal crawler — a disc that crawls Earth→Mars at the REAL light delay
   * (reuses the packet-crawl machinery). Built once + hidden; shown when the relay is up. */
  private netMarsCrawler?: THREE.Mesh;
  /** Hot "fresh data" tint for the Mars node (bleeds toward grey as freshness drains). */
  private readonly _netMarsHot = new THREE.Color(1.0, 0.5, 0.26);
  private readonly _netMarsColor = new THREE.Color();
  /** Act-4 — the MARS readout DOM (the "as of Nm ago" stamp + freshness + light-delay), pinned over
   * the orrery. Built once + hidden; paintNetMars mutates it in place. */
  private netMarsBox?: HTMLElement;
  private netMarsAge?: HTMLElement;
  private netMarsFresh?: HTMLElement;
  private netMarsDelay?: HTMLElement;
  private netMarsHint?: HTMLElement;

  // --- §3 LIVE PLANNER DRAFT consequence on the globe (the make-or-break planner) -------------
  /** The DRAFT footprint disc — a distinct WARM-cyan wash over the would-be sat's nadir, drawn as
   * the player drags so they see where the orbit points right now (set apart from a committed
   * cool-cyan footprint). Built once + hidden; updateNetDraft positions/sizes it from previewLaunch. */
  private netDraftFootprint?: THREE.Mesh;
  /** THE COVERAGE-GAP OVERLAY (§3.1): two stacked region discs — a RED "still dark" disc under a
   * GREEN "covered" disc whose radius scales with previewLaunch's coveredFraction. The player drags
   * the orbit until the red ring vanishes (the region goes fully green). Built once + hidden. */
  private netGapDark?: THREE.Mesh;
  private netGapCovered?: THREE.Mesh;
  /** The DRAFT GROUND-TRACK arc: a dashed line through the body-fixed sub-points over one period
   * (a GEO parks ⇒ a tight knot; a LEO walks ⇒ a long arc). Render-only; positions rewritten each
   * frame from the draft slice. Built once with a fixed sample cap. */
  private netGroundTrack?: THREE.LineSegments;
  /** THE DRAFT ORBIT RING + sat marker — the would-be orbit drawn IN SPACE (not on the surface), so
   * the player sees the path before launch + the knobs visibly move it (altitude resizes it,
   * inclination tilts it, RAAN rotates the plane, phase slides the marker). Built once + hidden;
   * positions rewritten each frame from the draft slice (same de-squash/fold the launched rings use). */
  private netDraftRing?: THREE.LineSegments;
  /** FL-14 — the ring-pinned draft readout chip (DOM, fed per frame by main). */
  private netDraftChip?: HTMLElement;
  private netDraftSat?: THREE.Mesh;
  private netDraftMembers: THREE.Mesh[] = [];
  /** Act-1 "signal reaches there" — the SERVED region→sat→ground LINK beam (a bright green dashed
   * segment set through the three world points), drawn when a launched sat bridges the region. */
  private netServedLink?: THREE.LineSegments;
  /** P1 (GDD §5) — THE LIVE NETWORK: one pooled LineSegments carrying EVERY active served contract's
   * router path region→…→ground, PER-VERTEX coloured by the bridging sat's utilisation (green
   * headroom → amber near-cap → red over-cap) so congestion reads on the globe BEFORE a breach, and
   * a re-route flash (a brief white-hot pulse) when a path's bridging sat changes (the self-healing
   * reroute made legible). Built once with a fixed segment cap; positions+colours rewritten per frame
   * from {@link NetRenderState.servedLinks} (render-only, no per-frame alloc). */
  private netServedLinks?: THREE.LineSegments;
  /** SD-53 — dashed region→sat arcs for the traced flow's other reachable pipes. */
  private netCandidateLines?: THREE.LineSegments;
  private netBeamLines?: THREE.LineSegments;
  private netBlindBeamLines?: THREE.LineSegments;
  private netLaunchArcLines?: THREE.Line;
  /** FL-14 — the pooled launch-arc lines (one LIVE arc per launch event). */
  private netLaunchArcPool: THREE.Line[] = [];
  /** Scratch colours reused across frames to tint the network links without per-frame Color alloc. */
  private readonly _netUtilCool = new THREE.Color(0.35, 1.0, 0.55); // headroom: cool green.
  private readonly _netUtilWarm = new THREE.Color(1.0, 0.72, 0.2); // near capacity: amber.
  private readonly _netUtilHot = new THREE.Color(1.0, 0.28, 0.26); // at/over capacity: red.
  private readonly _netLinkScratch = new THREE.Color();
  private readonly _netRerouteFlash = new THREE.Color(0.95, 1.0, 1.0); // re-route pulse: white-hot.

  // --- §3 the OPERATED BODY as a real 3D sphere + graticule (body-agnostic) -------------------
  /** THE OPERATED-BODY SPHERE: a REAL {@link THREE.SphereGeometry} (a UNIT sphere scaled per frame
   * to the operated body's de-squashed render radius), dim + dark + 1-bit-dithered — NOT the
   * constant-screen-size billboard. Built once + hidden; shown only in net render mode, positioned +
   * sized + sun-lit per frame from the {@link NetRenderState.body} slice (the body's id + radius). */
  private netBodySphere?: THREE.Mesh;
  /** R2 (SD-45) — DRAG-TO-AIM: while the pad is open, dragging ON the globe aims the
   * draft (body-fixed lat/lon under the cursor). Set by main.ts; null = aiming off. */
  onNetAim: ((latRad: number, lonRad: number) => void) | null = null;
  /** FL-13 (SD-49) — RING-GRAB: set by main; while the pad is open, grabbing the DRAFT
   * ORBIT RING (not the globe) drags ALTITUDE — a vertical pull raises/lowers the orbit.
   * Receives absolute altitudes above the surface (metres, game-space, pre-clamp). */
  onNetDragOrbit: ((altM: number) => void) | null = null;
  private aimDragging = false;
  /** FL-13 (SD-49) — RING-GRAB state: grabbing the DRAFT RING (not the globe) drags
   * ALTITUDE; a vertical pull raises/lowers the orbit. Pointer priority while the pad is
   * open: RING grab → globe aim → camera orbit. */
  private ringDragging = false;
  private ringGrabClientY = 0;
  private ringGrabAltM = 0;
  /** metres of altitude per vertical pixel (derived from the ring's screen span at grab). */
  private ringMPerPx = 1000;
  private readonly aimRaycaster = new THREE.Raycaster();
  private readonly aimNdc = new THREE.Vector2();
  /** A faint lat/lon GRATICULE child of the sphere (its own LineSegments over the unit sphere) that
   * ROTATES with the body spin θ(t) so the globe visibly turns. Built once; spun per frame. */
  private netBodyGraticule?: THREE.LineSegments;
  /** Render-only smoothed PLANNER-FOCUS state: how strongly the camera is dollied into the operated
   * body (0 = normal net framing, 1 = the close-up). Lerps toward the target each frame so opening /
   * closing the planner glides smoothly (the same feel as a preset change). */
  private netPlannerFocus = 0;
  /** Render-only — the DESKTOP HERO FRAMING request (#14). When > 0 (set by the active WM desktop via
   * {@link Orrery.setNetHeroFraming}), the camera dollies so the operated globe DIAMETER fills this
   * fraction of the pane height — even with NO planner open — so OVERVIEW/CONNECTIVITY show Earth as a
   * clear central hero instead of the ~3px speck the bare preset dist produces (the toy globe's scene
   * radius is tiny). 0 = no hero dolly (use the preset dist, e.g. the pulled-back ROUTING orbits view).
   * The planner close-up still overrides to {@link NET_PLANNER_SPHERE_FILL} while it is open. */
  private netHeroFill = 0;
  /** R2e (SD-45) — user wheel-zoom multiplier over the hero/planner FILL distance (the
   * fill used to fully override the wheel: "mouse zoom still doesn't work"). 1 = the
   * framed default; wheel scales it; reset on framing change / R. */
  private netZoomMul = 1;
  private readonly _netBodyDark = new THREE.Color(0.5, 0.56, 0.7); // dim slate globe tint.
  private _sphereSunDir = new THREE.Vector3();
  /** Surface-coverage patch scratch: a basis (centre normal + two tangents) reused to orient a
   * tangent disc onto the sphere surface without per-frame Vector3 alloc. */
  private _surfN = new THREE.Vector3();
  private _surfT = new THREE.Vector3();
  private _surfB = new THREE.Vector3();
  private _surfM = new THREE.Matrix4();

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
    // FL-14 (SD-49) — the ring-pinned DRAFT READOUT chip: cost · period · time-to-service,
    // pinned bottom-right of the pad's consequence view (facts only, fed per frame by main).
    this.netDraftChip = document.createElement("div");
    this.netDraftChip.className = "net-draft-chip";
    this.netDraftChip.style.display = "none";
    this.labelLayer.appendChild(this.netDraftChip);

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

    // §3 — THE OPERATED BODY AS A REAL 3D SPHERE (body-agnostic): a dim, dark, 1-bit sphere at the
    // operated body's render radius + a lat/lon GRATICULE that rotates with the body spin θ(t). Built
    // once + hidden; shown only in net render mode, positioned/sized/lit per frame from the body slice.
    this.buildNetBodySphere();

    // net/ Act-1 — the region patch (lit/dim) + the launched sat's footprint patch. Now ORIENTED
    // SURFACE DISCS (NOT camera-facing billboards): each lies tangent ON the operated-body sphere at
    // its surface point so coverage paints flat against the globe. Built once + hidden; updateNetOverlay
    // shows + positions + orients + tints them only in net render mode (off-mode they never draw).
    this.netRegionMesh = this.buildSurfaceDisc([0.95, 0.6, 0.2]); // seeded amber (UNSERVED).
    this.netRegionMesh.visible = false;
    // FLICKER FIX — the co-located surface discs now form a fixed ASCENDING renderOrder stack that
    // matches their ascending depth-lift (region < footprints < draft-fp < gap-dark < gap-covered),
    // all in (coastline 6 .. markers 10), so back-to-front draw order is deterministic every frame.
    this.netRegionMesh.renderOrder = 6.2; // base: the demand region, under all coverage patches.
    this.scene.add(this.netRegionMesh);
    // R2 (SD-45) — THE QUEUE RING: a pulsing halo around a SIGNED-and-dark region ("someone
    // is waiting and you are bleeding"), billboard-sized so it reads at any framing.
    this.netQueueRing = this.buildHaloDisc([1.0, 0.45, 0.35]);
    this.netQueueRing.visible = false;
    this.netQueueRing.renderOrder = 6.1;
    this.scene.add(this.netQueueRing);
    // FL-UX — the CLICK-INSPECT blob: one surface patch, hot warm-cyan, BENT onto the ball.
    this.netFocusBlob = this.buildSurfaceDisc([0.65, 0.95, 1.0]);
    this.netFocusBlob.visible = false;
    this.netFocusBlob.renderOrder = 6.7;
    this.scene.add(this.netFocusBlob);
    // FL-UX — DRAFT-BATCH blobs: one DIM hugging patch per batch member (≤6 covers the max).
    this.netMemberBlobs = [];
    for (let i = 0; i < 6; i++) {
      const m = this.buildSurfaceDisc([0.38, 0.75, 0.9]);
      m.visible = false;
      m.renderOrder = 6.55 + i * 0.01;
      (m.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.22;
      this.scene.add(m);
      this.netMemberBlobs.push(m);
    }

    // R2e (SD-45) — GROUND SITES: dish glyphs for the comms ground stations (violet-cyan)
    // and a warm triangle-read halo for the launch pad, each with a DOM label.
    for (let i = 0; i < 4; i++) {
      const m = new THREE.Mesh(
        this.quad,
        new THREE.MeshBasicMaterial({ color: 0x7cc7e8, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false }),
      );
      m.visible = false;
      m.renderOrder = 10.5;
      this.scene.add(m);
      this.netSiteMarkers.push(m);
    }
    // Act-2 — a POOL of cool-cyan footprint SURFACE discs (one per covering sat). The hand-off render:
    // with a constellation several sweep so the region stays lit as one slides off + the next on.
    for (let i = 0; i < MAX_NET_FOOTPRINTS; i++) {
      const m = this.buildSurfaceDisc([0.45, 0.85, 1.0]); // cool cyan footprint.
      m.visible = false;
      // DISTINCT per-slot renderOrder (6.50, 6.52, …) so overlapping footprints during a hand-off
      // never share an order ⇒ the z-tiebreaker is never consulted ⇒ no flicker. Stays in (region
      // 6.2 .. draft 7.0), below the markers (10+).
      m.renderOrder = 6.5 + i * 0.02;
      this.netFootprintMeshes.push(m);
      this.scene.add(m);
    }
    // Act-2 — the availability SAWTOOTH meter (design §4.4 / §6): a small bar+trace pinned over
    // the orrery that sawtooths for a lone LEO / N≤3 and FLATTENS at the SLA bar for the N=4
    // constellation. Built once + hidden; shown only in net mode with an availability axis live.
    this.buildNetAvailMeter();

    // Act-4 — the MARS FRONTIER TEASER overlay (design §4.5 / §8): a hot Mars DATA NODE that
    // desaturates as the cached copy ages, a cyan deep-space RELAY node on the Earth side, and an
    // Earth↔Mars signal CRAWLER (reusing the packet-crawl path). Built once + hidden; shown only in
    // net mode once the act4 beat has surfaced the Mars opportunity. The "as of Nm ago" readout box
    // is built alongside (mutated in place by paintNetMars, no per-frame DOM rebuild).
    this.netMarsNode = this.buildSignalDisc([1.0, 0.5, 0.26]); // hot fresh-data tint.
    this.netMarsNode.visible = false;
    this.netMarsNode.renderOrder = 12;
    this.scene.add(this.netMarsNode);
    this.netMarsRelay = this.buildSignalDisc([0.45, 0.85, 1.0]); // cyan relay node.
    this.netMarsRelay.visible = false;
    this.netMarsRelay.renderOrder = 12;
    this.scene.add(this.netMarsRelay);
    this.netMarsCrawler = this.buildSignalDisc([0.45, 0.85, 1.0]); // cyan crawling signal.
    this.netMarsCrawler.visible = false;
    this.netMarsCrawler.renderOrder = 13;
    this.scene.add(this.netMarsCrawler);
    this.buildNetMarsReadout();

    // §3 — THE LIVE PLANNER DRAFT overlay (the make-or-break planner). All four parts are render-
    // only billboards/lines on the toy globe, built once + hidden; updateNetDraft shows + positions
    // + tints them from previewLaunch's truthful outputs only in net render mode (off-mode dark).
    //  (a) the draft footprint disc (warm-cyan), (b) the coverage-gap overlay (a RED still-dark
    //  region disc under a GREEN covered disc), (c) the draft ground-track arc, (d) the served beam.
    // The coverage-gap overlay is now ORIENTED SURFACE DISCS too (flat on the sphere): a RED still-
    // dark region patch UNDER a GREEN covered patch whose radius scales with previewLaunch's truthful
    // coveredFraction — so dragging the orbit VISIBLY opens/closes the red gap on the region surface.
    this.netGapDark = this.buildSurfaceDisc([1.0, 0.28, 0.26]); // RED: the still-dark region slice.
    this.netGapDark.visible = false;
    this.netGapDark.renderOrder = 7.5; // the still-dark slice, over the draft footprint.
    this.scene.add(this.netGapDark);
    this.netGapCovered = this.buildSurfaceDisc([0.4, 1.0, 0.55]); // GREEN: the covered slice.
    this.netGapCovered.visible = false;
    this.netGapCovered.renderOrder = 8; // the covered slice reads on TOP — "it's served".
    this.scene.add(this.netGapCovered);
    this.netDraftFootprint = this.buildSurfaceDisc([0.5, 0.95, 1.0]); // warm-cyan: the live draft footprint.
    this.netDraftFootprint.visible = false;
    this.netDraftFootprint.renderOrder = 7; // the live planner preview, over committed coverage, under the gap state.
    this.scene.add(this.netDraftFootprint);
    this.netGroundTrack = this.buildPolyline(NET_DRAFT_TRACK_SAMPLES, 0x7df2ff, 0.7); // warm-cyan dashed arc.
    this.netGroundTrack.visible = false;
    this.netGroundTrack.renderOrder = 9; // over the coverage discs (≤8), under the markers (10+) — reads on top, no z-fight.
    this.scene.add(this.netGroundTrack);
    // THE DRAFT ORBIT RING (in space) + its phase marker — see the orbit BEFORE launch; the knobs move it.
    this.netDraftRing = this.buildPolyline(NET_DRAFT_RING_SAMPLES, 0x6fe0ff, 0.85); // bright cyan orbit ring.
    this.netDraftRing.visible = false;
    this.netDraftRing.renderOrder = 9.6; // over the surface discs, alongside the ground-track.
    this.scene.add(this.netDraftRing);
    this.netDraftSat = new THREE.Mesh(
      new THREE.CircleGeometry(1, 18),
      new THREE.MeshBasicMaterial({ color: 0xc7f6ff, transparent: true, depthTest: false, depthWrite: false }),
    );
    this.netDraftSat.visible = false;
    this.netDraftSat.frustumCulled = false;
    this.netDraftSat.renderOrder = 12; // the draft sat dot, above the ring + discs.
    // SD-45 — BATCH MEMBER markers: one small dot per would-be batch member (max 6), so a
    // stacked batch (0° spread) is VISIBLY one pile before commit.
    for (let i = 0; i < 6; i++) {
      const m = new THREE.Mesh(
        this.quad,
        new THREE.MeshBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false }),
      );
      m.visible = false;
      m.renderOrder = 11.8;
      this.scene.add(m);
      this.netDraftMembers.push(m);
    }
    this.scene.add(this.netDraftSat);
    this.netServedLink = this.buildPolyline(2, 0x8dffc6, 0.85); // green served beam (region→sat→ground).
    this.netServedLink.visible = false;
    this.netServedLink.renderOrder = 14; // above the discs so the beam reads on the globe.
    this.scene.add(this.netServedLink);
    // P1 (GDD §5) — THE LIVE NETWORK: one pooled PER-VERTEX-COLOURED line for ALL active served
    // contracts' router paths, tinted green→amber→red by each bridging sat's utilisation (congestion
    // visible before breach) + flashed white-hot on a re-route. Built once + hidden; positions +
    // colours rewritten per frame from the servedLinks slice.
    this.netServedLinks = this.buildVertexColorLine(MAX_NET_LINKS * MAX_NET_LINK_HOPS, 0.9);
    this.netServedLinks.visible = false;
    this.netServedLinks.renderOrder = 15; // above the single draft beam so the live web reads on top.
    // SD-45 — BEAM POINTER lines (one segment per assigned beam; red when blind) + the
    // LAUNCH ARC polylines. Pooled Float32 line buffers, rebuilt in place per frame.
    {
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3 * 24), 3));
      const mat = new THREE.LineBasicMaterial({ color: 0x9fe8ff, transparent: true, opacity: 0.5, depthTest: false, depthWrite: false });
      this.netBeamLines = new THREE.LineSegments(geo, mat);
      this.netBeamLines.frustumCulled = false;
      this.netBeamLines.visible = false;
      this.netBeamLines.renderOrder = 14.5;
      this.scene.add(this.netBeamLines);
      // SD-53 — CANDIDATE ARCS: dashed region→sat segments for the pipes that COULD carry the
      // traced flow right now. Dashed is the non-colour channel (a candidate is a possibility, and
      // it looks like one); the hue only reinforces it.
      const geoC = new THREE.BufferGeometry();
      geoC.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3 * MAX_NET_CANDIDATES), 3));
      const matC = new THREE.LineDashedMaterial({
        color: 0x8e84ff,
        transparent: true,
        opacity: 0.65,
        depthTest: false,
        depthWrite: false,
        dashSize: 0.05,
        gapSize: 0.035,
      });
      this.netCandidateLines = new THREE.LineSegments(geoC, matC);
      this.netCandidateLines.frustumCulled = false;
      this.netCandidateLines.visible = false;
      this.netCandidateLines.renderOrder = 14.4;
      this.scene.add(this.netCandidateLines);
      const geoB = new THREE.BufferGeometry();
      geoB.setAttribute("position", new THREE.BufferAttribute(new Float32Array(2 * 3 * 24), 3));
      const matB = new THREE.LineBasicMaterial({ color: 0xe2604a, transparent: true, opacity: 0.85, depthTest: false, depthWrite: false });
      this.netBlindBeamLines = new THREE.LineSegments(geoB, matB);
      this.netBlindBeamLines.frustumCulled = false;
      this.netBlindBeamLines.visible = false;
      this.netBlindBeamLines.renderOrder = 14.6;
      this.scene.add(this.netBlindBeamLines);
      // FL-14 (SD-49) — launch arcs are POOLED, one Line per concurrent launch event (the
      // bundled launch + an interleaved fill batch both show — the theatre isn't capped at
      // one arc). Pool of 4 (the launch pipeline never overlaps more than that in M1; extras
      // degrade to the newest 4 silently).
      this.netLaunchArcPool = [];
      for (let pi = 0; pi < 4; pi++) {
        const geoL = new THREE.BufferGeometry();
        geoL.setAttribute("position", new THREE.BufferAttribute(new Float32Array(3 * 26 * 4), 3));
        const matL = new THREE.LineBasicMaterial({ color: 0xffd27c, transparent: true, opacity: 0.95, depthTest: false, depthWrite: false });
        const line = new THREE.Line(geoL, matL);
        line.frustumCulled = false;
        line.visible = false;
        line.renderOrder = 15.5;
        this.scene.add(line);
        this.netLaunchArcPool.push(line);
      }
      this.netLaunchArcLines = this.netLaunchArcPool[0];
      this.scene.add(this.netLaunchArcLines);
    }
    this.scene.add(this.netServedLinks);

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

  /**
   * §3 — build THE OPERATED-BODY SPHERE (a REAL {@link THREE.SphereGeometry}, NOT a billboard) + its
   * rotating lat/lon GRATICULE, ONCE. The geometry is a UNIT sphere (radius 1) so it can be scaled
   * per frame to ANY body's de-squashed render radius (body-agnostic — the id/radius arrive in the
   * net body slice); a dim/dark Bayer-dithered Lambert shader keeps the 1-bit aesthetic + lets the
   * bright surface coverage pop. The graticule (parallels + meridians) is a child {@link
   * THREE.LineSegments} over the unit sphere, spun by θ(t) each frame so the globe visibly turns.
   */
  private buildNetBodySphere(): void {
    const geo = new THREE.SphereGeometry(1, NET_SPHERE_SEGMENTS, NET_SPHERE_SEGMENTS);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SPHERE_VERT,
      fragmentShader: SPHERE_FRAG,
      // FLICKER FIX (the real one): the globe is OPAQUE — SPHERE_FRAG outputs alpha 1.0 and uses a
      // Bayer `discard` for the 1-bit dither, never blends. Marking it `transparent:true` forced it
      // into the TRANSPARENT pass, where MSAA + the dithered discard + depthWrite at the silhouette
      // flicker in GPU-dependent ways (the limb shimmer the player sees — invisible to the headless
      // software-GL renderer, which is why instrument scans read clean). Render it OPAQUE so it goes
      // through the clean opaque pass with stable depth. Visual is identical (alpha was always 1).
      transparent: false,
      depthWrite: true, // a SOLID globe: coverage discs sit just above the surface + read on top.
      uniforms: {
        uColor: { value: this._netBodyDark.clone() },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uCell: { value: 2.0 },
        uDim: { value: 1.0 },
      },
    });
    const sphere = new THREE.Mesh(geo, mat);
    sphere.renderOrder = 4; // under all the overlay discs/markers (they paint over the globe).
    sphere.visible = false;
    sphere.frustumCulled = false;
    this.scene.add(sphere);
    this.netBodySphere = sphere;

    // The graticule: NET_GRATICULE_PARALLELS lat circles + NET_GRATICULE_MERIDIANS lon half-circles,
    // each sampled as a dashed-ish polyline over the UNIT sphere (a child so it rides the sphere's
    // transform; we additionally spin it by θ(t) about the body's +Z so it turns with the body).
    const pts: number[] = [];
    const seg = NET_GRATICULE_SAMPLES;
    // FLICKER FIX — LIFT the graticule a hair OFF the unit sphere fill (R 1.0). Built at R 1.0 it was
    // EXACTLY COPLANAR with the SphereGeometry(1) surface, and with both depthWrite:true the two
    // z-FOUGHT — the floating-origin rebase jitters that tie every frame, flipping the winner ⇒ the
    // GLOBE-LIMB flicker. Lifting it to GRAT_R (just under the coastlines at 1.004) makes it
    // UNAMBIGUOUSLY in front of the surface everywhere, so the depth test resolves deterministically.
    const GRAT_R = 1.0025;
    // ecliptic (x,y,z=north) → three (x, up=z, -y): the SAME axis swap renderInto uses, so the
    // graticule's +Z spin axis matches the body-fixed θ(t) convention (spin about ecliptic north).
    const toThree = (x: number, y: number, z: number): [number, number, number] => [x * GRAT_R, z * GRAT_R, -y * GRAT_R];
    for (let p = 1; p < NET_GRATICULE_PARALLELS; p++) {
      const lat = -Math.PI / 2 + (Math.PI * p) / NET_GRATICULE_PARALLELS;
      const cl = Math.cos(lat);
      const sz = Math.sin(lat);
      for (let i = 0; i < seg; i++) {
        const a0 = (2 * Math.PI * i) / seg;
        const a1 = (2 * Math.PI * (i + 1)) / seg;
        pts.push(...toThree(cl * Math.cos(a0), cl * Math.sin(a0), sz));
        pts.push(...toThree(cl * Math.cos(a1), cl * Math.sin(a1), sz));
      }
    }
    for (let mlon = 0; mlon < NET_GRATICULE_MERIDIANS; mlon++) {
      const lon = (2 * Math.PI * mlon) / NET_GRATICULE_MERIDIANS;
      const cosL = Math.cos(lon);
      const sinL = Math.sin(lon);
      for (let i = 0; i < seg; i++) {
        const t0 = -Math.PI / 2 + (Math.PI * i) / seg;
        const t1 = -Math.PI / 2 + (Math.PI * (i + 1)) / seg;
        pts.push(...toThree(Math.cos(t0) * cosL, Math.cos(t0) * sinL, Math.sin(t0)));
        pts.push(...toThree(Math.cos(t1) * cosL, Math.cos(t1) * sinL, Math.sin(t1)));
      }
    }
    const gg = new THREE.BufferGeometry();
    gg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    // depthTest keeps the back-side grid hidden by the opaque globe; depthWrite:false because a
    // TRANSLUCENT overlay must not write depth (writing it makes the faint lines z-fight each other +
    // the discard-sphere at the limb — a GPU-dependent shimmer). Standard transparent-overlay combo.
    const gmat = new THREE.LineBasicMaterial({ color: 0x6f7d9a, transparent: true, opacity: 0.34, depthWrite: false });
    const grat = new THREE.LineSegments(gg, gmat);
    grat.frustumCulled = false;
    grat.renderOrder = 5; // over the sphere fill, under the coverage discs.
    sphere.add(grat); // a child: rides the sphere position+scale; we spin it locally per frame.
    this.netBodyGraticule = grat;

    this.buildNetCoastlines(grat);
  }

  /**
   * net/ Act-1 — build the world COASTLINE outlines ONCE as a {@link THREE.LineSegments} over the
   * UNIT sphere, in the SAME body-fixed basis as the graticule (latLon → [cos·lat·cos·lon,
   * cos·lat·sin·lon, sin·lat] with the renderInto axis swap [x, z, −y]), so continents land where
   * the surface-frame regions/footprints do (which use surfacePointRelative's identical basis + the
   * θ(t) spin). Added as a CHILD of the graticule, so it rides the sphere position/scale AND the per-
   * frame body spin — the continents turn with the globe. depthTest keeps the FAR-side coast hidden
   * behind the globe (only the near hemisphere shows, as it should). A dim land tone (DD-1: reference
   * geography, low-saturation — it must not compete with the bright coverage signal). No per-frame
   * alloc (built once); ~5k segment vertices in one draw call.
   */
  private buildNetCoastlines(grat: THREE.LineSegments): void {
    const D2R = Math.PI / 180;
    const R = 1.004; // a hair above the unit sphere fill + the graticule, so it never z-fights.
    const pts: number[] = [];
    for (const poly of COASTLINES) {
      for (let i = 0; i + 1 < poly.length; i++) {
        for (const [lonDeg, latDeg] of [poly[i], poly[i + 1]]) {
          const lat = latDeg * D2R;
          const lon = lonDeg * D2R;
          const cl = Math.cos(lat);
          // ecliptic body-fixed unit vector, then the renderInto axis swap (x, z, −y).
          pts.push(R * cl * Math.cos(lon), R * Math.sin(lat), -R * cl * Math.sin(lon));
        }
      }
    }
    const cg = new THREE.BufferGeometry();
    cg.setAttribute("position", new THREE.BufferAttribute(new Float32Array(pts), 3));
    const cmat = new THREE.LineBasicMaterial({ color: 0x6fae93, transparent: true, opacity: 0.6, depthWrite: false });
    const coast = new THREE.LineSegments(cg, cmat);
    coast.frustumCulled = false;
    coast.renderOrder = 6; // over the sphere fill + graticule, under the coverage discs.
    grat.add(coast); // child of the graticule ⇒ inherits the θ(t) spin + the sphere transform.
  }

  /**
   * §3 — build a SURFACE-COVERAGE PATCH disc (a flat triangle-fan over a local unit disc in the XY
   * plane, +Z its normal), tinted `color`. Unlike a billboard, this disc is ORIENTED per frame to lie
   * tangent ON the operated-body sphere ({@link orientSurfaceDisc}), so the region / footprint / gap
   * paint flat against the globe and rotate with it. The fragment shader gives a bright dithered fill.
   */
  private buildSurfaceDisc(color: [number, number, number]): THREE.Mesh {
    const n = NET_SURFACE_DISC_SEGMENTS;
    // A unit disc: a centre vertex + a rim ring, as a triangle fan. UVs map the disc into [0,1]² so
    // the radial Bayer fill works (centre = (0.5,0.5), rim = unit circle).
    const verts: number[] = [0, 0, 0];
    const uvs: number[] = [0.5, 0.5];
    const idx: number[] = [];
    for (let i = 0; i <= n; i++) {
      const a = (2 * Math.PI * i) / n;
      verts.push(Math.cos(a), Math.sin(a), 0);
      uvs.push(0.5 + 0.5 * Math.cos(a), 0.5 + 0.5 * Math.sin(a));
      if (i > 0) idx.push(0, i, i + 1);
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array(verts), 3));
    geo.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(uvs), 2));
    geo.setIndex(idx);
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT_BENT,
      fragmentShader: SURFACE_DISC_FRAG,
      transparent: true,
      // FLICKER FIX (net coverage). The discs flicker because the co-located region/footprint/gap
      // patches paint at near-equal view-space depth and the floating-origin rebase jitters that
      // depth every frame. An earlier attempt used depthTest+depthWRITE with tiny per-class lifts —
      // but this scene's near/far range (0.001 .. 100000) gives terrible depth-buffer precision, so
      // the sub-pixel lifts could not be resolved and the patches Z-FOUGHT instead (a worse flicker).
      // The robust fix: NO depth comparison at all (depthTest:false, depthWrite:false), so ordering
      // is decided SOLELY by renderOrder — and every co-located disc class (and every footprint slot)
      // is given a DISTINCT renderOrder, so the z-tiebreaker is never consulted. Deterministic,
      // flip-free, and z-fight-free. (Trade-off: far-side patches paint over the globe; not visible
      // in the close planner view and far less objectionable than the flicker.)
      depthWrite: false,
      depthTest: false,
      uniforms: {
        uColor: { value: new THREE.Color(...color) },
        uCell: { value: 2.0 },
        uAlpha: { value: 1.0 },
        // The surface-hug uniforms (0 radius = honestly flat).
        uRadiusRad: { value: 0.0 },
        uBend: { value: 1.0 },
      },
    });
    const mesh = new THREE.Mesh(geo, mat);
    mesh.frustumCulled = false;
    return mesh;
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
        depthWrite: false, // translucent ring: don't write depth (z-fights the limb otherwise).
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
      const mat = new THREE.LineBasicMaterial({ color: 0xff9e2e, transparent: true, opacity: 0.5, depthWrite: false });
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
      for (let i = 0; i < this.netSiteMarkers.length; i++) {
        this.netSiteMarkers[i].visible = false;
        this.labelFor(`site:${i}`).style.display = "none";
      }
      this.paintNetAvailability(null);
      return;
    }

    // The OPERATED BODY context (centre + scene radius) the surface discs orient against. Body-
    // agnostic — the id/radius come from the slice. Without it (no contract yet) discs stay hidden.
    const body = ns.body;
    const bodySceneR = body !== null ? this.netBodySceneRadius(body, focusAbs) : 0;

    // The region patch: lit/dim by the served verdict — the make-or-break state change, now an
    // ORIENTED SURFACE DISC flat on the sphere. In Act 2 this is the SAWTOOTH made visible: a lone
    // LEO lights green only while its single footprint is overhead and dips amber the instant it
    // sets; a constellation holds green because ANOTHER footprint slides on as one slides off.
    if (ns.region && body !== null) {
      const lit = Orrery.regionLit(ns.region.served, ns.footprints.length);
      const mat = region.material as THREE.ShaderMaterial;
      mat.uniforms.uColor.value.copy(lit ? this._netLit : this._netDim);
      mat.uniforms.uAlpha.value = lit ? 0.95 : 0.7;
      // A served region reads a touch wider (the lit pulse).
      this.orientSurfaceDisc(
        region,
        ns.region.centerPosM,
        body.centerPosM,
        bodySceneR,
        ns.region.radiusRad * (lit ? 1.1 : 1.0),
        focusAbs,
      );
      region.visible = true;
      // The queue ring: pulse ONLY when signed-and-dark (offered regions sit dim, calm).
      const ring = this.netQueueRing;
      if (ring) {
        const bleeding = ns.region.active === true && !ns.region.served;
        if (bleeding) {
          ring.position.setFromMatrixPosition(region.matrix);
          const tSim = this.ctx.now();
          const pulse = 0.5 + 0.5 * Math.sin(tSim * 2.6);
          this.sizeBillboard(ring, 30 + pulse * 26, worldPerPx);
          ((ring.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).setRGB(1.0, 0.35 + 0.25 * pulse, 0.3);
          ring.visible = true;
        } else {
          ring.visible = false;
        }
      }
    } else {
      region.visible = false;
      if (this.netQueueRing) this.netQueueRing.visible = false;
    }

    // R2e (SD-45) — the ground stations + the launch pad, visible + labeled ("you can't
    // see GROUND-0 properly"). Billboards sized to read at any framing; labels ride the
    // shared DOM label layer.
    const sites = ns.sites ?? [];
    for (let i = 0; i < this.netSiteMarkers.length; i++) {
      const m = this.netSiteMarkers[i];
      const site = sites[i];
      const label = this.labelFor(`site:${i}`);
      if (site === undefined || body === null) {
        m.visible = false;
        label.style.display = "none";
        continue;
      }
      this.renderInto(m.position, site.posM, focusAbs);
      this.sizeBillboard(m, site.kind === "pad" ? 8 : 7, worldPerPx);
      (m.material as THREE.MeshBasicMaterial).color.setHex(site.kind === "pad" ? 0xffb057 : 0x7cc7e8);
      m.visible = true;
      // Label just right of the marker, matching the body-label convention.
      this.tmpV.copy(m.position).project(this.camera);
      if (this.tmpV.z > 1 || this.tmpV.z < -1) {
        label.style.display = "none";
      } else {
        label.style.display = "block";
        label.style.left = `${(this.tmpV.x * 0.5 + 0.5) * this.w + 8}px`;
        label.style.top = `${(-this.tmpV.y * 0.5 + 0.5) * this.h}px`;
        label.style.color = site.kind === "pad" ? "#ffb057" : "#7cc7e8";
        label.textContent = site.kind === "pad" ? `▲ ${site.label}` : `⌾ ${site.label}`;
      }
    }

    // The footprint patches over the region (the hand-off beat): one cool-cyan surface disc per
    // covering sat, oriented flat on the sphere at the sat's nadir. Several sweep with a
    // constellation so the region stays lit as one slides off + the next slides on (the sawtooth).
    let slot = 0;
    if (body !== null) {
      for (const fp of ns.footprints) {
        if (slot >= this.netFootprintMeshes.length) break;
        const mesh = this.netFootprintMeshes[slot];
        (mesh.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.6;
        // liftMul 2 + a per-slot step so overlapping footprints (a hand-off) sit at distinct depths.
        this.orientSurfaceDisc(mesh, fp.centerPosM, body.centerPosM, bodySceneR, fp.radiusRad, focusAbs, 2 + slot * 0.15);
        mesh.visible = true;
        slot++;
      }
    }
    for (let i = slot; i < this.netFootprintMeshes.length; i++) this.netFootprintMeshes[i].visible = false;

    // FL-UX — the click-inspected blob (needs the operated body for its radius + centre).
    if (this.netFocusBlob) {
      if (ns?.focusBlob && body) {
        (this.netFocusBlob.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.85;
        this.orientSurfaceDisc(
          this.netFocusBlob,
          ns.focusBlob.centerPosM,
          body.centerPosM,
          bodySceneR,
          ns.focusBlob.radiusRad,
          focusAbs,
          3.0,
        );
        this.netFocusBlob.visible = true;
      } else {
        this.netFocusBlob.visible = false;
      }
    }

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

  /**
   * Act-4 — build the MARS readout DOM once (design §4.5 / §8): a small pinned block reading the
   * "as of Nm ago" staleness stamp, the freshness % (the desaturation, in words), and the REAL
   * one-way light delay ("the signal takes Nm to cross"). Hidden until net mode reaches act4;
   * {@link paintNetMars} mutates it in place (no per-frame DOM rebuild).
   */
  private buildNetMarsReadout(): void {
    const box = document.createElement("div");
    box.className = "net-mars";
    box.style.display = "none";
    box.innerHTML =
      `<div class="nm-row"><span class="nm-lab">MARS DATA</span><span class="nm-age">—</span></div>` +
      `<div class="nm-row"><span class="nm-lab">FRESHNESS</span><span class="nm-fresh">—</span></div>` +
      `<div class="nm-row"><span class="nm-lab">LIGHT DELAY</span><span class="nm-delay">—</span></div>` +
      `<div class="nm-hint">—</div>`;
    this.labelLayer.appendChild(box);
    this.netMarsBox = box;
    this.netMarsAge = box.querySelector(".nm-age") as HTMLElement;
    this.netMarsFresh = box.querySelector(".nm-fresh") as HTMLElement;
    this.netMarsDelay = box.querySelector(".nm-delay") as HTMLElement;
    this.netMarsHint = box.querySelector(".nm-hint") as HTMLElement;
  }

  /**
   * Act-4 — draw the MARS FRONTIER TEASER (design §4.5 / §8 — the vertigo, BY SIGHT). The Mars
   * DATA NODE sits at Mars's render position and DESATURATES from a hot "fresh data" tint toward
   * machine-grey as `mars.freshness` drains (the SAME grey→hot lerp the packet uses); the cyan
   * deep-space RELAY node sits at the launched relay's Earth-relative position; and the Earth↔Mars
   * signal CRAWLER walks Earth→Mars at the REAL light-delay crawl progress (reusing the rebased
   * Earth/Mars endpoints the link line already computes). Hidden when there is no Mars slice or no
   * relay. Render-only — no sim feedback; the minutes-long latency is a READOUT (§8 fenced).
   */
  private updateNetMars(t: number, focusAbs: Vec3, worldPerPx: number): void {
    const node = this.netMarsNode;
    const relay = this.netMarsRelay;
    const crawler = this.netMarsCrawler;
    if (!node || !relay || !crawler) return;
    const ms = this.netRenderMode ? this.netState?.mars ?? null : null;
    if (ms === null) {
      node.visible = false;
      relay.visible = false;
      crawler.visible = false;
      this.paintNetMars(null);
      return;
    }

    // The Earth + Mars rebased render points (the SAME transform the link line uses).
    this.renderInto(this._earthR, this.ctx.eph.position("earth", t), focusAbs);
    this.renderInto(this._marsR, this.ctx.eph.position("mars", t), focusAbs);

    // THE MARS DATA NODE — a hot disc at Mars that DESATURATES as the cached copy ages: the
    // freshness-as-saturation cue (the data reads OLD by sight). When no sample yet, it reads cold
    // grey (nothing fresh has arrived). The dither also coarsens as it greys (a colour-off channel).
    const f = ms.freshness ?? 0;
    node.position.copy(this._marsR);
    this._netMarsColor.copy(this._grey).lerp(this._netMarsHot, f);
    const nMat = node.material as THREE.ShaderMaterial;
    nMat.uniforms.uColor.value.copy(this._netMarsColor);
    nMat.uniforms.uCell.value = 2.0 + (1 - f) * 3.0; // finer stipple = fresher.
    this.sizeBillboard(node, 22, worldPerPx);
    node.visible = true;

    // THE DEEP-SPACE RELAY NODE — the Earth-side relay the player launched (cyan), shown only once
    // it is up; until then there is no path (the leg is presence-based) and the crawler is hidden.
    if (ms.relayLaunched && ms.relayPosM !== null) {
      this.renderInto(this._rp, ms.relayPosM, focusAbs);
      relay.position.copy(this._rp);
      this.sizeBillboard(relay, 11, worldPerPx);
      relay.visible = true;
    } else {
      relay.visible = false;
    }

    // THE EARTH↔MARS SIGNAL CRAWLER — a cyan disc crawling Earth→Mars at the REAL light delay
    // (crawlProgress is the render-only cycle keyed on sim-time / oneWayS in main.ts). The signal
    // VISIBLY crawls across the interplanetary gap — the vertigo: minutes one-way, every command late.
    if (ms.crawlProgress !== null) {
      const p = ms.crawlProgress;
      this.tmpV.set(
        this._earthR.x + (this._marsR.x - this._earthR.x) * p,
        this._earthR.y + (this._marsR.y - this._earthR.y) * p,
        this._earthR.z + (this._marsR.z - this._earthR.z) * p,
      );
      crawler.position.copy(this.tmpV);
      this.sizeBillboard(crawler, 10, worldPerPx);
      crawler.visible = true;
    } else {
      crawler.visible = false;
    }

    this.paintNetMars(ms);
  }

  /**
   * Act-4 — paint the MARS readout box (the "as of Nm ago" stamp + freshness + light delay), or
   * hide it when null. Pure presentation: the staleness reads OLD (minutes ago) and the freshness
   * desaturates in words; the light-delay names why ("the signal takes Nm to cross"). A breadcrumb
   * placement flashes the hint ("CACHE PLACED — data closer"). No per-frame DOM rebuild.
   */
  private paintNetMars(ms: NetRenderState["mars"]): void {
    const box = this.netMarsBox;
    if (!box) return;
    if (ms === null) {
      box.style.display = "none";
      return;
    }
    box.style.display = "block";
    // "as of Nm ago" — the data arrives OLD (the staleness stamp). Em-dash until a sample exists.
    const ageTxt =
      ms.sampleAgeS === null
        ? ms.relayLaunched
          ? "awaiting first signal"
          : "no relay — launch one"
        : `as of ${fmtDuration(ms.sampleAgeS)} ago`;
    setN(this.netMarsAge!, ageTxt);
    setC(this.netMarsAge!, ms.sampleAgeS === null ? "nm-age warn" : "nm-age");
    // FRESHNESS — the desaturation in words (full → grey). Tone tracks the band.
    const fr = ms.freshness ?? 0;
    setN(this.netMarsFresh!, ms.freshness === null ? "—" : fmtPct(fr));
    setC(this.netMarsFresh!, `nm-fresh ${fr >= 0.5 ? "good" : fr > 0.05 ? "warn" : "dead"}`);
    // LIGHT DELAY — the REAL one-way Earth↔Mars crossing time (minutes). The vertigo, named.
    setN(this.netMarsDelay!, `${fmtDuration(ms.oneWayS)} one-way`);
    setC(this.netMarsDelay!, "nm-delay warn");
    // HINT — the breadcrumb cue, or the standing teaser line.
    const hint = ms.breadcrumbPlaced
      ? "CACHE PLACED — data closer, freshness jumps"
      : ms.sampleAgeS === null
        ? "the signal crawls — minutes one-way; you cannot tune what arrives this late"
        : "data arrives OLD — place a cache (P) to bring it closer";
    setN(this.netMarsHint!, hint);
    setC(this.netMarsHint!, ms.breadcrumbPlaced ? "nm-hint good" : "nm-hint");
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
    const mat = new THREE.LineBasicMaterial({ color: 0xff9e2e, transparent: true, opacity: 0.5, depthWrite: false });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  /**
   * §3 — a generic dashed POLYLINE buffer ({@link maxPoints} along the path, drawn as a dash per
   * adjacent pair): the draft ground-track arc + the served region→sat→ground beam both reuse this.
   * The geometry holds `maxPoints` segments (2 verts each); the per-frame writer fills only the
   * in-use prefix + collapses the unused tail to a degenerate point. Built once; no per-frame alloc.
   */
  private buildPolyline(maxPoints: number, color: number, opacity: number): THREE.LineSegments {
    const positions = new Float32Array(maxPoints * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    // FLICKER FIX — these overlay lines (the draft GROUND-TRACK + the served BEAM) run ALONG the globe
    // surface at the same radius as the operated-body sphere. With the default depthTest/depthWrite they
    // Z-FOUGHT the sphere per pixel (poor depth precision over the 0.001..100000 range) and STROBED as
    // the surface swept — fast, and frozen on pause. Like the coverage discs, they are now a pure
    // painter's-overlay (depthTest:false, depthWrite:false), ordered by renderOrder alone, so they sit
    // cleanly on the globe without z-fighting. (The caller sets a renderOrder ABOVE the globe + discs.)
    const mat = new THREE.LineBasicMaterial({
      color, transparent: true, opacity, depthTest: false, depthWrite: false,
    });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  /**
   * P1 (GDD §5) — a PER-VERTEX-COLOURED dashed polyline buffer ({@link maxSegments} segments, 2
   * verts each, each vert carrying an RGB so a hop can be tinted by its bridging sat's utilisation —
   * green headroom → amber near-cap → red over-cap — and flashed on a re-route). The geometry holds
   * `maxSegments` segments; the per-frame writer fills only the in-use prefix + collapses the unused
   * tail to a degenerate point. Built once; no per-frame alloc.
   */
  private buildVertexColorLine(maxSegments: number, opacity: number): THREE.LineSegments {
    const positions = new Float32Array(maxSegments * 2 * 3);
    const colors = new Float32Array(maxSegments * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    geo.setAttribute("color", new THREE.BufferAttribute(colors, 3));
    const mat = new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, opacity, depthTest: false, depthWrite: false });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  /**
   * P1 (GDD §5) — the §4.3 UTILISATION → colour ramp (split out, pure, unit-testable): cool-green at
   * headroom (util 0), amber at near-capacity (util 0.75), red at/over capacity (util ≥ 1) — so a
   * link riding close to breach reads warm and an over-subscribed one reads RED on the globe BEFORE it
   * actually breaches. Writes into `out` (no alloc) and returns it. A deterministic lerp of the three
   * tunable tints; clamped to [0,1]. */
  static utilColor(
    util: number,
    cool: THREE.Color,
    warm: THREE.Color,
    hot: THREE.Color,
    out: THREE.Color,
  ): THREE.Color {
    const u = util < 0 ? 0 : util > 1 ? 1 : util;
    if (u <= 0.75) return out.copy(cool).lerp(warm, u / 0.75);
    return out.copy(warm).lerp(hot, (u - 0.75) / 0.25);
  }

  /**
   * §3 — THE LIVE PLANNER DRAFT consequence ON THE GLOBE (the spec's most important UX principle):
   * as the player drags altitude / inclination / phase / RAAN, draw — TRUTHFULLY, from the pure
   * {@link import("../sim/net/world").previewLaunch} outputs main.ts feeds in (NO geometry recomputed
   * here) — (a) the draft FOOTPRINT disc over the would-be sat's nadir, (b) the draft GROUND-TRACK
   * arc across the spinning surface, (c) THE CONTRACT COVERAGE-GAP OVERLAY (the region disc with the
   * still-dark fraction RED + the covered fraction GREEN), and (d) the SERVED region→sat→ground LINK
   * beam when a launched sat bridges the region ("the signal reaches there"). Hidden when net mode is
   * off or there is no draft. Render-only — no sim feedback; no per-frame allocation.
   */
  private updateNetDraft(focusAbs: Vec3, worldPerPx: number): void {
    const fp = this.netDraftFootprint;
    const dark = this.netGapDark;
    const cov = this.netGapCovered;
    const track = this.netGroundTrack;
    const beam = this.netServedLink;
    if (!fp || !dark || !cov || !track || !beam) return;
    const ns = this.netRenderMode ? this.netState : null;
    const draft = ns?.draft ?? null;
    // The OPERATED BODY context the surface discs orient against (body-agnostic; null ⇒ hide discs).
    const body = ns?.body ?? null;
    const bodySceneR = body !== null ? this.netBodySceneRadius(body, focusAbs) : 0;

    // (a) THE DRAFT FOOTPRINT — a warm-cyan SURFACE patch over the would-be sat's nadir, flat on the
    // sphere, live as the player drags (altitude→LEO shrinks/moves the cap; inclination tilts it).
    if (draft?.footprint && body !== null) {
      (fp.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.55;
      this.orientSurfaceDisc(fp, draft.footprint.centerPosM, body.centerPosM, bodySceneR, draft.footprint.radiusRad, focusAbs, 3.5);
      fp.visible = true;
    } else {
      fp.visible = false;
    }

    // (b) THE COVERAGE-GAP OVERLAY — the region SURFACE patch painted bright RED (the still-dark
    // slice) with a GREEN patch on top whose radius scales with previewLaunch's truthful
    // coveredFraction: dragging the orbit VISIBLY opens/closes the RED gap on the region surface.
    // coveredFraction is a fraction of the disc AREA, so the green radius ≈ √frac of the full radius
    // (25% covered reads as a half-radius green spot — the honest equal-area mapping). The whole gap
    // sits flat on the sphere, oriented at the region's surface point so it rotates with the body.
    if (draft?.gap && body !== null) {
      const frac = Math.max(0, Math.min(1, draft.gap.coveredFraction));
      // RED: the full region patch (the worst case — all dark). Hidden once fully covered.
      (dark.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.9;
      this.orientSurfaceDisc(dark, draft.gap.centerPosM, body.centerPosM, bodySceneR, draft.gap.radiusRad, focusAbs, 4);
      dark.visible = frac < 0.999;
      // GREEN: the covered slice — a concentric patch sized √frac of the region radius (equal-area).
      (cov.material as THREE.ShaderMaterial).uniforms.uAlpha.value = 0.95;
      this.orientSurfaceDisc(cov, draft.gap.centerPosM, body.centerPosM, bodySceneR, draft.gap.radiusRad * Math.sqrt(frac), focusAbs, 5);
      cov.visible = frac > 0.001;
    } else {
      dark.visible = false;
      cov.visible = false;
    }

    // (c) THE DRAFT GROUND-TRACK ARC — dashed warm-cyan through the body-fixed sub-points over one
    // period (a GEO parks ⇒ a knot; a LEO walks ⇒ a long arc), each rebased + folded like a body.
    const gt = draft?.groundTrack ?? [];
    if (gt.length >= 2) {
      const posAttr = track.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const segCap = arr.length / 6;
      const n = Math.min(gt.length, segCap);
      let w = 0;
      for (let i = 0; i < n; i++) {
        const a = gt[i];
        const b = gt[(i + 1) % gt.length];
        w = this.writeRenderPoint(arr, w, a[0], a[1], a[2], focusAbs);
        w = this.writeRenderPoint(arr, w, b[0], b[1], b[2], focusAbs);
      }
      // Collapse the unused tail to the last written point (a degenerate, invisible segment).
      while (w < arr.length) arr[w++] = arr[w - 4] ?? 0;
      posAttr.needsUpdate = true;
      track.visible = true;
    } else {
      track.visible = false;
    }

    // (c2) THE DRAFT ORBIT RING — the would-be orbit drawn IN SPACE, sampled over one period and run
    // through the SAME de-squash/log-fold (writeRenderPoint) the launched-sat rings use, so the preview
    // ring lands exactly where the committed sat will ride. The knobs move it live: altitude resizes,
    // inclination tilts, RAAN rotates the plane. The marker rides it at the current PHASE.
    const ring = this.netDraftRing;
    const dsat = this.netDraftSat;
    const rp = draft?.orbitRing ?? [];
    if (ring && rp.length >= 2) {
      const posAttr = ring.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      const segCap = arr.length / 6;
      const n = Math.min(rp.length - 1, segCap);
      let w = 0;
      for (let i = 0; i < n; i++) {
        w = this.writeRenderPoint(arr, w, rp[i][0], rp[i][1], rp[i][2], focusAbs);
        w = this.writeRenderPoint(arr, w, rp[i + 1][0], rp[i + 1][1], rp[i + 1][2], focusAbs);
      }
      while (w < arr.length) arr[w++] = arr[w - 4] ?? 0;
      posAttr.needsUpdate = true;
      ring.visible = true;
    } else if (ring) {
      ring.visible = false;
    }
    // Batch member park markers (SD-45) + per-member coverage blobs (UX): the BATCH's
    // coverage answer on the globe — each member's hugging blob shows where it actually
    // lights, dimmer than the clicked-sat blob; disappears with the pad.
    const members = draft?.memberPosM ?? [];
    {
      const blobs = draft?.memberBlobs ?? [];
      const body = this.netState?.body ?? null;
      if (body && draft) {
        const bodySceneR = this.netBodySceneRadius(body, focusAbs);
        for (let i = 0; i < this.netMemberBlobs.length; i++) {
          const m0 = this.netMemberBlobs[i];
          if (i < blobs.length) {
            this.orientSurfaceDisc(m0, blobs[i].centerPosM, body.centerPosM, bodySceneR, blobs[i].radiusRad, focusAbs, 1.3 + i * 0.02);
            m0.visible = true;
          } else {
            m0.visible = false;
          }
        }
      } else {
        for (const m0 of this.netMemberBlobs) m0.visible = false;
      }
    }
    for (let i = 0; i < this.netDraftMembers.length; i++) {
      const mm = this.netDraftMembers[i];
      if (i < members.length && draft) {
        this.renderInto(mm.position, members[i], focusAbs);
        this.sizeBillboard(mm, 5, worldPerPx);
        mm.visible = true;
      } else {
        mm.visible = false;
      }
    }
    if (dsat && draft?.satPosM) {
      this.renderInto(dsat.position, draft.satPosM, focusAbs);
      this.sizeBillboard(dsat, 5, worldPerPx);
      dsat.visible = true;
    } else if (dsat) {
      dsat.visible = false;
    }

    // (d) THE SERVED LINK BEAM — region→sat→ground, drawn when a LAUNCHED sat bridges the region
    // (Act-1 "the signal reaches there"). Two dashes: region→sat and sat→ground.
    const link = ns?.servedLink ?? null;
    if (link) {
      const posAttr = beam.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = posAttr.array as Float32Array;
      let w = 0;
      w = this.writeRenderPoint(arr, w, link.regionPosM[0], link.regionPosM[1], link.regionPosM[2], focusAbs);
      w = this.writeRenderPoint(arr, w, link.satPosM[0], link.satPosM[1], link.satPosM[2], focusAbs);
      w = this.writeRenderPoint(arr, w, link.satPosM[0], link.satPosM[1], link.satPosM[2], focusAbs);
      w = this.writeRenderPoint(arr, w, link.groundPosM[0], link.groundPosM[1], link.groundPosM[2], focusAbs);
      posAttr.needsUpdate = true;
      beam.visible = true;
    } else {
      beam.visible = false;
    }
  }

  /**
   * P1 (GDD §5 survival condition) — DRAW THE LIVE NETWORK. For every active served contract in
   * {@link NetRenderState.servedLinks} draw its router path region→…→ground as a beam on the globe
   * (the P0 single beam generalized to ALL contracts + a constellation hand-off — as the router
   * re-solves to the rising sat, `path[1]` migrates and the beam follows). Each hop is PER-VERTEX
   * coloured by the bridging sat's utilisation (the §4.3 oversubscription data, previously text-only):
   * cool-green headroom → amber near-capacity → red at/over capacity ({@link Orrery.utilColor}), so a
   * congesting link reads warm BEFORE it breaches. On a RE-ROUTE (the path's bridging sat changed —
   * a set below the horizon or a fault removing a sat) the whole path is flashed toward white-hot by
   * `rerouteAge`, then decays, so the self-healing reroute is legible rather than snapping invisibly.
   * Render-only — positions + colours rewritten in place; no per-frame allocation, no sim touch.
   */
  private updateNetLinks(focusAbs: Vec3): void {
    // SD-45 — beam pointers + launch arcs (drawn whether or not anything serves).
    const nsAll = this.netRenderMode ? this.netState : null;
    const drawSegs = (obj: THREE.LineSegments | undefined, segs: { fromPosM: Vec3; toPosM: Vec3 }[]) => {
      if (!obj) return;
      if (segs.length === 0) {
        obj.visible = false;
        return;
      }
      const attr = obj.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let w = 0;
      const maxSegs = Math.min(segs.length, arr.length / 6);
      for (let i = 0; i < maxSegs; i++) {
        w = this.writeRenderPoint(arr, w, segs[i].fromPosM[0], segs[i].fromPosM[1], segs[i].fromPosM[2], focusAbs);
        w = this.writeRenderPoint(arr, w, segs[i].toPosM[0], segs[i].toPosM[1], segs[i].toPosM[2], focusAbs);
      }
      obj.geometry.setDrawRange(0, maxSegs * 2);
      attr.needsUpdate = true;
      obj.visible = true;
    };
    const pointers = nsAll?.beamPointers ?? [];
    drawSegs(this.netBeamLines, pointers.filter((p) => !p.blind));
    drawSegs(this.netBlindBeamLines, pointers.filter((p) => p.blind));
    // SD-53 — the candidate arcs. Dashed geometry needs its line distances recomputed whenever the
    // vertices move, which is every frame here (the region and the sats are both in motion).
    drawSegs(this.netCandidateLines, nsAll?.candidateArcs ?? []);
    if (this.netCandidateLines?.visible === true) this.netCandidateLines.computeLineDistances();
    const arcs = nsAll?.launchArcs ?? [];
    // FL-14 — every concurrent launch gets its own pooled arc line (no more arcs[0]-only).
    for (let pi = 0; pi < this.netLaunchArcPool.length; pi++) {
      const line0 = this.netLaunchArcPool[pi];
      const arc = arcs[pi];
      if (!arc || arc.points.length < 2) {
        line0.visible = false;
        continue;
      }
      const attr = line0.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = attr.array as Float32Array;
      let w = 0;
      const n = Math.min(arc.points.length, arr.length / 3);
      for (let i = 0; i < n; i++) {
        w = this.writeRenderPoint(arr, w, arc.points[i][0], arc.points[i][1], arc.points[i][2], focusAbs);
      }
      line0.geometry.setDrawRange(0, n);
      attr.needsUpdate = true;
      (line0.material as THREE.LineBasicMaterial).color.setHex(arc.lost ? 0xe2604a : 0xffd27c);
      line0.visible = true;
    }
    const line = this.netServedLinks;
    if (!line) return;
    const ns = this.netRenderMode ? this.netState : null;
    const links = ns?.servedLinks ?? [];
    if (links.length === 0) {
      line.visible = false;
      return;
    }
    const posAttr = line.geometry.getAttribute("position") as THREE.BufferAttribute;
    const colAttr = line.geometry.getAttribute("color") as THREE.BufferAttribute;
    const pos = posAttr.array as Float32Array;
    const col = colAttr.array as Float32Array;
    const segCap = pos.length / 6; // 6 floats per segment (2 verts × xyz).
    let seg = 0;
    for (const lk of links) {
      const pts = lk.points;
      if (pts.length < 2) continue;
      // The base utilisation tint for this whole path (the bridging sat's headroom), pulled toward
      // white-hot by the re-route flash so a freshly re-routed path pops, then settles to its tint.
      Orrery.utilColor(lk.util, this._netUtilCool, this._netUtilWarm, this._netUtilHot, this._netLinkScratch);
      const flash = lk.rerouteAge < 0 ? 0 : lk.rerouteAge > 1 ? 1 : lk.rerouteAge;
      if (flash > 0) this._netLinkScratch.lerp(this._netRerouteFlash, flash);
      // SD-53 — THE TRACE. With a flow selected in the routing table, its path holds full strength
      // and every other path dims: "pick a flow and the orrery renders its actual current path"
      // (GDD §5 #4). The utilisation ramp is SCALED, never replaced, so a congesting sibling still
      // reads warm — quieter, not recoloured. With nothing selected the whole web reads normally.
      const traced = ns?.tracedContractId ?? null;
      const dim = traced !== null && lk.contractId !== traced ? NET_TRACE_DIM : 1;
      const cr = this._netLinkScratch.r * dim;
      const cg = this._netLinkScratch.g * dim;
      const cb = this._netLinkScratch.b * dim;
      for (let i = 0; i + 1 < pts.length; i++) {
        if (seg >= segCap) break;
        const a = pts[i];
        const b = pts[i + 1];
        let w = seg * 6;
        this.writeRenderPoint(pos, w, a[0], a[1], a[2], focusAbs);
        this.writeRenderPoint(pos, w + 3, b[0], b[1], b[2], focusAbs);
        // Both verts of the hop carry the path tint (a flat-coloured segment).
        for (let v = 0; v < 2; v++) {
          col[w + v * 3] = cr;
          col[w + v * 3 + 1] = cg;
          col[w + v * 3 + 2] = cb;
        }
        seg++;
      }
      if (seg >= segCap) break;
    }
    // Collapse the unused tail to a degenerate (invisible) segment at the origin.
    for (let s = seg; s < segCap; s++) {
      const w = s * 6;
      for (let f = 0; f < 6; f++) pos[w + f] = 0;
    }
    posAttr.needsUpdate = true;
    colAttr.needsUpdate = true;
    line.visible = seg > 0;
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
    this.readoutBox = box;
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

  /**
   * #14 — set the active desktop's HERO globe framing. `fill` is the fraction of the pane HEIGHT the
   * operated globe's DIAMETER should fill (0 = no hero dolly, use the bare preset distance). The
   * dolly glides in/out via the same smoothing the planner close-up uses, so SWITCHING desktops
   * pans the camera smoothly. Net-mode only (the off-mode camera is untouched). Call from setWmPreset.
   */
  /** DEV probe: raycast a client point → body-fixed lat/lon (aim calibration). */
  __aimProbe(clientX: number, clientY: number): { latRad: number; lonRad: number } | null {
    return this.aimHit(clientX, clientY);
  }

  /** DEV probe (SD-45 flicker hunt): per-frame mesh states of the net surface discs. */
  __discDebug(): Record<string, unknown> {

    const m = (mesh: THREE.Mesh | null) =>
      mesh === null
        ? null
        : {
            vis: mesh.visible,
            color: ((mesh.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color).getHexString(),
            alpha: (mesh.material as THREE.ShaderMaterial).uniforms.uAlpha?.value ?? null,
            mtx: [12, 13, 14].map((i) => Math.round(mesh.matrix.elements[i] * 1e6) / 1e6),
            mscale: Math.round(Math.hypot(mesh.matrix.elements[0], mesh.matrix.elements[1], mesh.matrix.elements[2]) * 1e6) / 1e6,
          };
    const reg = this.netState?.region ?? null;
    let dM = null as number | null;
    if (reg) {
      const f = this.ctx.eph.position(this.focusId, this.ctx.now());
      dM = Math.hypot(reg.centerPosM[0] - f[0], reg.centerPosM[1] - f[1], reg.centerPosM[2] - f[2]);
    }
    return {
      dM,
      cur: {
        band: this.cur.orbitBandM,
        logK: this.cur.logK,
        logScale: this.cur.logScale,
        dist: this.cur.dist,
        focus: this.focusId,
        hero: this.netHeroFill,
      },
      region: m(this.netRegionMesh ?? null),
      gapDark: m(this.netGapDark ?? null),
      gapCov: m(this.netGapCovered ?? null),
      draftFp: m(this.netDraftFootprint ?? null),
      fp0: m(this.netFootprintMeshes[0] ?? null),
      fp0Order: this.netFootprintMeshes[0]?.renderOrder ?? null,
    };
  }

  setNetHeroFraming(fill: number): void {
    this.netHeroFill = this._netRenderMode ? Math.max(0, fill) : 0;
    this.netZoomMul = 1; // a new framing resets the user zoom.
  }

  /** UX sweep — the Earth↔Mars link line is the ACT-4 frontier's opening reveal. In net mode
   * it stays hidden until the Mars leg exists (cursor reached act4); cache mode unaffected.
   * True once per frame from main (cheap idempotent assignment). */
  setMarsLinkLive(live: boolean): void {
    this.marsLinkLive = live;
  }
  private marsLinkLive = false;

  setPreset(i: number): void {
    if (i < 0 || i >= CAMERA_PRESETS.length) return;
    this.activePreset = i;
    const p = CAMERA_PRESETS[i];
    // net/ Act-1 — the connectivity game is an EARTH-ORBIT puzzle: the camera must NEVER focus a
    // body net mode hides. The SYSTEM/TOP-DOWN presets focus the Sun (blanked in net mode) → a
    // black frame. Override focus to the OPERATED body so every preset frames Earth + its
    // constellation; the preset's `net` override (applied in netFrame) supplies the Earth-orbit
    // fold + distance. Cache mode keeps the preset's own focus (byte-identical).
    this.focusId = this._netRenderMode ? (this.netState?.body?.id ?? "earth") : p.focus;
    this.tgt = this.netFrame(p);
    this.paintCameraButtons(); // keep the on-canvas active highlight in sync (click + hotkey).
  }

  /**
   * fix #1 — project a {@link CameraPreset} into the camera target, applying the NET-MODE globe
   * FRAMING when net render mode is on: dolly in ({@link NET_CAMERA_DIST_SCALE}) + narrow the lens
   * ({@link NET_CAMERA_FOV_SCALE}) so the toy globe + its de-squashed LEO/GEO rings fill the frame
   * (the drag→consequence read must not be sub-pixel). In cache mode this is the identity (the
   * preset's own dist/fov) — every cache framing is byte-identical. Pure projection (no `this`
   * mutation); the caller assigns the result. */
  private netFrame(p: CameraPreset): typeof this.tgt {
    const distScale = this._netRenderMode ? NET_CAMERA_DIST_SCALE : 1;
    const fovScale = this._netRenderMode ? NET_CAMERA_FOV_SCALE : 1;
    // net/ Act-1 — apply the preset's NET override (Earth-orbit framing for the otherwise
    // heliocentric SYSTEM/TOP-DOWN presets) only while net render mode is on. Empty in cache mode.
    const o = this._netRenderMode ? (p.net ?? {}) : {};
    return {
      az: o.az ?? p.az,
      el: o.el ?? p.el,
      dist: (o.dist ?? p.dist) * distScale,
      fov: (o.fov ?? p.fov) * fovScale,
      logK: o.logK ?? p.logK,
      logScale: o.logScale ?? p.logScale,
      orbitBandM: o.orbitBandM ?? p.orbitBandM ?? 0,
    };
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

    // §3 — fetch the live net slice UP FRONT (before the camera lerp) so the PLANNER FOCUS can
    // re-target the camera the same frame the planner opens: when net mode is on + a body slice is
    // live, FOCUS the operated body (set focusId to body.id ⇒ it sits at the scene origin the camera
    // looks at) and, while the planner is active, dolly the close-up framing in. Body-agnostic — the
    // id comes from the slice (the region's bodyId), never hardcoded. Off-mode this is a no-op.
    this.netState = this.netRenderMode ? (this.ctx.net?.() ?? null) : null;
    this.applyPlannerFocus(k);

    this.cur.az += (this.tgt.az - this.cur.az) * k;
    this.cur.el += (this.tgt.el - this.cur.el) * k;
    this.cur.dist += (this.tgt.dist - this.cur.dist) * k;
    this.cur.fov += (this.tgt.fov - this.cur.fov) * k;
    this.cur.logK += (this.tgt.logK - this.cur.logK) * k;
    this.cur.logScale += (this.tgt.logScale - this.cur.logScale) * k;
    this.cur.orbitBandM += (this.tgt.orbitBandM - this.cur.orbitBandM) * k;

    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    const sunAbs = this.ctx.eph.position("sun", t);
    // Refresh the near-body de-squash for THIS frame's focus + animated band (fix #1):
    // points within orbitBandM of the focus body get radially re-radii'd before the
    // log-fold, so near-Earth orbits separate from the disc + sweep. Identity when the
    // band is ~0 (system-scale presets) — see renderInto / writeRenderPoint.
    // NOTE — refreshed BEFORE applyCamera so the planner close-up can compute its dolly distance
    // from the operated-body SCENE radius (which depends on this de-squash fold + the focus point).
    this.refreshOrbitScale();
    this.applyCamera(focusAbs);

    // bodies
    const worldPerPx = (2 * Math.tan((this.cur.fov * DEG) / 2)) / this.h;
    // §3 — the OPERATED BODY is drawn as a real SPHERE in net mode (updateNetBodySphere), so its
    // flat billboard is hidden to avoid double-drawing the globe (body-agnostic — the id comes from
    // the live body slice, defaulting to the focus body / "earth" toy frame when none is live yet).
    const operatedBodyId = this.netState?.body?.id ?? (this._netRenderMode ? "earth" : null);
    for (const spec of BODIES) {
      const mesh = this.bodyMeshes.get(spec.id)!;
      // net/ Act-1 — net mode is the EARTH-ORBIT world: the operated Earth is the hero, and we now
      // also draw the MOON (a cislunar scale reference + "life"; it has no glow halo, so it is safe)
      // and keep the real Sun DIRECTION driving Earth's terminator (the day/night line answers
      // "where's the Sun" without a 1-AU-away disc washing the pane). We still hide Mars + the
      // dataset sat glyphs + the Sun's giant additive halo. Cache mode draws all.
      // CRITICAL: a glow body (the Sun) owns a SEPARATE additive halo mesh — hide it here too, or
      // the SUN'S HALO keeps its last cache-mode position/size and additive-blends a giant radial
      // disc over the whole pane (the "glow that looked like the globe"). The early continue below
      // for the operated body already hides its halo; this branch covers every OTHER glow body.
      const netVisibleBody = spec.id === "earth" || spec.id === "moon";
      if (this._netRenderMode && !netVisibleBody) {
        mesh.visible = false;
        if (spec.glow && this.haloMesh) this.haloMesh.visible = false;
        // The Mars freshness corona (this.marsHalo) is a SEPARATE additive mesh whose
        // visibility is set in applyMarsFreshness — which this `continue` skips in net
        // mode, so it would keep its stale cache-mode visible=true and wash the planner
        // pane orange. Hide it here every frame (net Act-4 uses netMarsNode instead).
        this.marsHalo.visible = false;
        continue;
      }
      // The operated body's sphere replaces its billboard in net mode.
      if (this._netRenderMode && spec.id === operatedBodyId) {
        mesh.visible = false;
        if (spec.glow && this.haloMesh) this.haloMesh.visible = false;
        continue;
      }
      mesh.visible = true;
      const absBody = this.ctx.eph.position(spec.id, t);
      // HONEST position for every body, INCLUDING the Moon: rebased through the same log-fold as
      // everything else. The Moon sits at its real cislunar distance, so it moves naturally and is
      // off-frame in the tight EARTH/PLAY close-up (you are zoomed into your LEO/GEO orbits) and
      // comes into frame when you pull back to the SYSTEM/CISLUNAR overview — never a faked,
      // camera-dependent floating disc. (A prior stylized-offset experiment made it slide insanely
      // as the camera moved; removed.)
      this.renderInto(this._rp, absBody, focusAbs);
      mesh.position.copy(this._rp);
      // fix #1 — MAGNIFY the toy Earth in net mode so it is the LARGE central hero the overlay
      // discs read against (matched by the same NET_GLOBE_PX_SCALE on every overlay disc below).
      // net/ Act-1 — also enlarge the Moon in net mode so the cislunar scale reference actually
      // READS (its raw 16px disc is sub-pixel at the toy fold). Render-only + scoped to net mode;
      // cache-mode sizing is unchanged.
      const px =
        this._netRenderMode && spec.id === "earth"
          ? spec.px * NET_GLOBE_PX_SCALE
          : this._netRenderMode && spec.id === "moon"
            ? spec.px * NET_MOON_PX_SCALE
            : spec.px;
      this.sizeBillboard(mesh, px, worldPerPx);
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
      // net/ Act-1 — no dataset rings in the Earth-orbit frame: the heliocentric earth/mars rings +
      // the cache dataset sat_leo/sat_geo rings are clutter, and the Moon now rides a STYLIZED
      // offset (so its real-distance orbit ring would no longer pass through it). The player's own
      // launched constellation draws its own rings via updateSatRings. Cache mode draws all.
      if (this._netRenderMode) {
        ring.line.visible = false;
        continue;
      }
      // UX sweep (backlog follow-up): in a NEAR-FIELD preset, heliocentric rings of OTHER
      // bodies are stray distant dashes (they're rendered around the rebase origin, miles
      // off-screen-relative-to-nothing). Hide them; they return at pull-back (dist ≥ 4.2).
      const nearField = this.tgt.dist < 4.2;
      const parent = this.ctx.eph.parentOf(id);
      if (nearField && parent === "sun" && id !== this.focusId) {
        ring.line.visible = false;
        continue;
      }
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

    // §3 — THE OPERATED BODY as a real 3D sphere + its rotating graticule (body-agnostic), drawn
    // first so the coverage discs paint over it. Only in net render mode with a body slice live.
    this.updateNetBodySphere(t, focusAbs, sunAbs, worldPerPx);
    // net/ Act-1 — the region (lit/dim) + footprint discs, only in net render mode. (netState was
    // fetched at the top of update() to drive the planner-focus camera.)
    this.updateNetOverlay(focusAbs, worldPerPx);
    // §3 — the LIVE PLANNER DRAFT consequence (footprint + ground-track + coverage-gap overlay) +
    // the served region→sat→ground beam, drawn on the globe as the player drags the orbit.
    this.updateNetDraft(focusAbs, worldPerPx);
    // P1 (GDD §5) — THE LIVE NETWORK: every active served contract's router path drawn region→sat→
    // ground, coloured by the bridging sat's utilisation + flashed on a re-route.
    this.updateNetLinks(focusAbs);
    // net/ Act-4 — the Mars frontier teaser: the desaturating Mars data node + the relay node +
    // the Earth↔Mars signal crawling at the real light delay (shown only at act4 in net mode).
    this.updateNetMars(t, focusAbs, worldPerPx);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels(t, focusAbs);
    this.updateCorners();
    this.paintReadout();
  }

  /**
   * §3 — THE PLANNER FOCUS (body-agnostic). When net mode is on + a body slice is live, FOCUS the
   * OPERATED BODY: set {@link Orrery.focusId} to the slice's `body.id` so the body sits at the scene
   * origin the camera already looks at (the region's bodyId / the click-to-focus body — NEVER
   * hardcoded "earth"). While the LAUNCH planner is open (`body.plannerActive`), lerp {@link
   * Orrery.netPlannerFocus} toward 1 (the close-up); when it closes, toward 0 (the normal net
   * framing) — {@link Orrery.applyCamera} reads it to dolly in / restore smoothly. Render-only.
   */
  private applyPlannerFocus(k: number): void {
    const body = this.netState?.body ?? null;
    // The close-up engages when the LAUNCH planner is OPEN *or* the active desktop requests a HERO
    // globe (#14, netHeroFill > 0). Either way FOCUS the operated body so it is centred + the camera
    // frames it. Only force focus then, so a click-to-focus / preset still controls the camera on a
    // desktop with no hero framing + no planner. Body-agnostic.
    const wantClose = (body?.plannerActive ?? false) || this.netHeroFill > 0;
    if (body !== null && wantClose && this.ctx.eph.hasBody(body.id)) {
      this.focusId = body.id;
    }
    const want = wantClose ? 1 : 0;
    // Smooth the dolly with the same exponential lerp the camera frame uses (glides in/out).
    this.netPlannerFocus += (want - this.netPlannerFocus) * k;
    if (Math.abs(want - this.netPlannerFocus) < 1e-3) this.netPlannerFocus = want;
  }

  /**
   * §3 — draw THE OPERATED BODY AS A REAL 3D SPHERE (body-agnostic) + spin its lat/lon graticule.
   * The unit {@link THREE.SphereGeometry} is positioned at the body's rebased render point and scaled
   * to the body's de-squashed RENDER RADIUS in scene units (the same renderInto fold the surface
   * points use, so the sphere + the coverage discs share one frame). A dim/dark 1-bit Lambert shader
   * keeps the bright coverage popping. The graticule child is spun by θ(t) about the body's +Z so the
   * globe VISIBLY turns. Hidden when net mode is off or there is no body slice. No per-frame alloc.
   */
  private updateNetBodySphere(t: number, focusAbs: Vec3, sunAbs: Vec3, _worldPerPx: number): void {
    const sphere = this.netBodySphere;
    const grat = this.netBodyGraticule;
    if (!sphere || !grat) return;
    const body = this.netRenderMode ? this.netState?.body ?? null : null;
    if (body === null) {
      sphere.visible = false;
      return;
    }
    // Centre at the body's rebased render point; the body sits at (or near) the scene origin when it
    // is the focus, but rebase generally so a non-focus operated body still renders correctly.
    this.renderInto(this._rp, body.centerPosM, focusAbs);
    sphere.position.copy(this._rp);
    // The body's RENDER RADIUS in scene units = |render(centre + R·x̂) − render(centre)|: push a
    // point one render-radius along +x (ecliptic) and measure the folded scene distance. This makes
    // the sphere exactly match the de-squashed/log-folded scale every surface point lands at.
    const r = body.renderRadiusM;
    this.renderInto(
      this._rp2,
      [body.centerPosM[0] + r, body.centerPosM[1], body.centerPosM[2]],
      focusAbs,
    );
    const sceneR = this._rp2.distanceTo(this._rp) || 1e-4;
    sphere.scale.setScalar(sceneR);
    // Spin the graticule with the body: θ(t) about the body's +Z (= scene up after the axis swap).
    grat.rotation.set(0, body.spinThetaRad, 0);
    // Dim the day-side a touch more under the planner close-up so the bright coverage reads.
    const mat = sphere.material as THREE.ShaderMaterial;
    mat.uniforms.uDim.value = 1.0 - 0.35 * this.netPlannerFocus;
    // Sun direction in view space (the same convention the billboard terminator uses).
    this._sphereSunDir
      .set(
        sunAbs[0] - body.centerPosM[0],
        sunAbs[2] - body.centerPosM[2],
        -(sunAbs[1] - body.centerPosM[1]),
      )
      .normalize()
      .transformDirection(this.camera.matrixWorldInverse);
    mat.uniforms.uSunDirView.value.copy(this._sphereSunDir);
    sphere.visible = true;
  }

  /**
   * §3 — orient a SURFACE-COVERAGE PATCH disc to lie tangent ON the operated-body sphere at a surface
   * point (so the region / footprint / gap paint flat on the globe, not as a billboard). Builds a
   * tangent basis at the surface point in SCENE space (normal = centre→surface direction; two
   * orthonormal tangents) and writes the disc's world matrix so its local +Z aligns with the normal
   * and its unit radius scales to the patch's scene radius. `radiusRad` is the patch's ANGULAR radius
   * on the body; the scene radius is `bodySceneR · sin(radiusRad)`. Lifts the disc a hair off the
   * surface so it never z-fights the sphere. Render-only; reuses preallocated scratch.
   */
  private orientSurfaceDisc(
    mesh: THREE.Mesh,
    surfacePosM: Vec3,
    bodyCenterPosM: Vec3,
    bodySceneR: number,
    radiusRad: number,
    focusAbs: Vec3,
    liftMul = 1,
  ): void {
    // SD-45 FLICKER FIX — place the disc BY CONSTRUCTION on the rendered sphere instead of
    // pushing a surface point through the radial remap (whose surface-adjacent behaviour is
    // ULP-sensitive): direction = the f64 surface direction (axis-swapped), position = body
    // scene centre + direction · bodySceneR. Exact, cheap, and immune to rebase noise.
    this.renderInto(this._rp2, bodyCenterPosM, focusAbs); // the body's scene centre.
    const ux = surfacePosM[0] - bodyCenterPosM[0];
    const uy = surfacePosM[1] - bodyCenterPosM[1];
    const uz = surfacePosM[2] - bodyCenterPosM[2];
    const um = Math.sqrt(ux * ux + uy * uy + uz * uz) || 1;
    // ecliptic (x, y, z=north) → three (x, up=z, −y): the renderInto axis swap.
    this._surfN.set(ux / um, uz / um, -uy / um);
    const sx = this._rp2.x + this._surfN.x * bodySceneR;
    const sy = this._rp2.y + this._surfN.y * bodySceneR;
    const sz = this._rp2.z + this._surfN.z * bodySceneR;
    // Two tangents orthogonal to the normal (pick a reference not parallel to N).
    const ref = Math.abs(this._surfN.y) < 0.9 ? this.tmpV.set(0, 1, 0) : this.tmpV.set(1, 0, 0);
    this._surfT.crossVectors(ref, this._surfN).normalize();
    this._surfB.crossVectors(this._surfN, this._surfT).normalize();
    const rad = Math.max(1e-4, bodySceneR * Math.sin(Math.max(0, radiusRad)));
    // Lift outward so the patch sits just above the surface. `liftMul` gives each disc CLASS a
    // strictly distinct lift (region < footprint < gap < draft), so co-located patches land at
    // distinct depths and the depth-test produces a deterministic, flip-free stack (the FLICKER
    // FIX — see buildSurfaceDisc). A tangent plane lifted outward stays entirely outside the sphere,
    // so even at the rim there is no clipping into the globe.
    const lift = bodySceneR * 0.004 * liftMul;
    // World matrix: columns = (T·rad, B·rad, N·rad) basis, translation = surface point + N·lift.
    this._surfM.set(
      this._surfT.x * rad, this._surfB.x * rad, this._surfN.x * rad, sx + this._surfN.x * lift,
      this._surfT.y * rad, this._surfB.y * rad, this._surfN.y * rad, sy + this._surfN.y * lift,
      this._surfT.z * rad, this._surfB.z * rad, this._surfN.z * rad, sz + this._surfN.z * lift,
      0, 0, 0, 1,
    );
    mesh.matrixAutoUpdate = false;
    mesh.matrix.copy(this._surfM);
    mesh.matrixWorldNeedsUpdate = true; // we set the local matrix directly — refresh the world matrix.
    // The surface-hug: bend this plate onto the ball at its own angular radius.
    const sh = mesh.material as THREE.ShaderMaterial;
    if (sh.uniforms.uRadiusRad) sh.uniforms.uRadiusRad.value = radiusRad;
  }

  /** §3 — the operated body's RENDER radius in scene units (the de-squashed/log-folded scale every
   * surface point lands at): |render(centre + R·x̂) − render(centre)|. Reused by the coverage discs
   * so they size against the SAME sphere the body renders at. Returns a small floor for degenerate
   * inputs. Reuses _rp/_rp2 scratch (caller must not rely on them after). */
  private netBodySceneRadius(body: NonNullable<NetRenderState["body"]>, focusAbs: Vec3): number {
    this.renderInto(this._rp, body.centerPosM, focusAbs);
    this.renderInto(
      this._rp2,
      [body.centerPosM[0] + body.renderRadiusM, body.centerPosM[1], body.centerPosM[2]],
      focusAbs,
    );
    return this._rp2.distanceTo(this._rp) || 1e-4;
  }

  private updatePacketAndLink(t: number, focusAbs: Vec3, worldPerPx: number): void {
    // Net-mode boot honesty (UX sweep): the Earth↔Mars line belongs to the Act-4 frontier story.
    // Before the Mars leg exists it is a diagonal of noise crossing the pane — the boot of the
    // CONNECTIVITY game reads better without it. (Cache mode is unchanged: it always shows.)
    if (this.netRenderMode && !this.marsLinkLive) {
      this.linkLine.visible = false;
      this.packetMesh.visible = false;
      for (const fp of this.feedPackets) fp.visible = false;
      return;
    }
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
    // Restore visibility only when drawing (hidden in net mode pre-act-4).
    this.linkLine.visible = true;
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
      // A FAULTING sat pulses AMBER (green ↔ amber); a healthy asset stays signal-green;
      // a FRESHLY-DEPLOYED sat flashes bright for its first seconds (the deploy payoff).
      const col = (m.material as THREE.ShaderMaterial).uniforms.uColor.value as THREE.Color;
      if (a.faulting) col.copy(this._buildGreen).lerp(this._amber, pulse);
      else if (a.freshAgeS !== undefined) {
        // FL-14 — the DEPLOY POP: peaks at separation, decays as (1 − age/2.2s)², then rests.
        const k = Math.max(0, 1 - a.freshAgeS / 2.2);
        col.setRGB(0.75 + 0.25 * k, 1.0, 0.85 + 0.15 * k);
        this.sizeBillboard(m, 9 + 22 * k * k + 2 * pulse * k, worldPerPx);
      } else col.copy(this._buildGreen);
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
    // Net mode owns its own Mars viz (netMarsNode); this cache-mode freshness corona
    // is additive and would wash the whole planner pane orange — keep it cache-only.
    this.marsHalo.visible = !this._netRenderMode && f > 0.001;
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

  private applyCamera(focusAbs?: Vec3): void {
    const el = Math.max(-88 * DEG, Math.min(88 * DEG, this.cur.el));
    const ce = Math.cos(el);
    // §3 — THE PLANNER CLOSE-UP: while the planner is open ({@link Orrery.netPlannerFocus}→1) narrow
    // the lens + dolly the camera in toward the operated-body close-up, blended by the smoothed focus
    // so opening/closing glides. The focus body is already at the scene origin (the camera looks at
    // 0,0,0), so this just frames it tighter. Net-mode scoped (focus is 0 off-mode).
    const f = this.netPlannerFocus;
    // The close-up FOV is computed first because the SPHERE-FILL distance below depends on it.
    const fov = this.cur.fov * (1 - f * (1 - NET_PLANNER_FOV_SCALE));
    // BUG-2 — FRAME THE OPERATED-BODY SPHERE TO FILL THE PANE. The fixed dolly left the toy sphere a
    // ~11px speck (scene radius ~0.006 at ~2 units). Instead compute the close-up distance FROM the
    // sphere's scene radius so its diameter fills ~NET_PLANNER_SPHERE_FILL of the pane height:
    //   d = R / (FILL · tan(halfFov))   (see NET_PLANNER_SPHERE_FILL). Blend the normal-framing dist
    // (f→0) toward this fill distance (f→1) so the glide in/out of the close-up stays smooth. Falls
    // back to the old fixed dolly when no body slice / focus is available (no scene radius to read).
    const fovDist = this.cur.dist * (1 - f * (1 - NET_PLANNER_DIST_SCALE));
    let dist = fovDist;
    const body = this._netRenderMode ? this.netState?.body ?? null : null;
    // The focus body's scene radius (cheap, no alloc) — drives both the close-up dolly AND the
    // near-plane tightening below. Computed once for the whole net frame.
    const sceneR = body !== null && focusAbs ? this.netBodySceneRadius(body, focusAbs) : 0;
    // The close-up FILL fraction: the planner close-up frames tighter (NET_PLANNER_SPHERE_FILL); a
    // desktop hero framing (#14) uses its requested netHeroFill. Whichever is active drives the dolly.
    const fill = body?.plannerActive ? NET_PLANNER_SPHERE_FILL : this.netHeroFill;
    if (f > 1e-3 && body !== null && focusAbs && fill > 0) {
      const halfFov = (fov * DEG) / 2;
      const fillDist = (sceneR / (fill * Math.tan(halfFov))) * this.netZoomMul;
      // Blend toward the fill distance by the smoothed close-up amount (glides in/out of the close-up).
      dist = fovDist * (1 - f) + fillDist * f;
    }
    this.camera.position.set(
      dist * ce * Math.sin(this.cur.az),
      dist * Math.sin(el),
      dist * ce * Math.cos(this.cur.az),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    if (Math.abs(this.camera.fov - fov) > 1e-3) {
      this.camera.fov = fov;
      this.camera.updateProjectionMatrix();
    }
    // FLICKER FIX (depth precision). The fixed near/far (0.001 .. 100000) spreads the depth buffer's
    // range across EIGHT orders of magnitude; at the globe (z_eye ≈ dist) the resolution is coarse.
    // Standard depth precision is dominated by the NEAR plane, so in NET MODE pull NEAR up to just
    // inside the focus body's nearest surface point (dist − sceneR) — everything else (the log-folded
    // Moon/Mars/markers) sits FARTHER, so it is never clipped. (FAR stays wide: the net scene reaches
    // ~tens of scene units — the Moon among them — so a tight FAR would clip it; near-field precision
    // at the globe is near-plane-dominated anyway.) Off-mode keeps the wide default (cache unchanged).
    const nearWant = this._netRenderMode && body !== null ? Math.max(1e-3, (dist - sceneR) * 0.5) : 0.001;
    if (Math.abs(this.camera.near - nearWant) > 1e-3) {
      this.camera.near = nearWant;
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
      // net/ Act-1 — net mode is the EARTH-ORBIT world: label only the operated Earth + the Moon
      // (their glyphs are the only bodies drawn); hide the Sun / Mars / dataset-sat labels. Cache
      // mode labels all.
      if (this._netRenderMode && !(spec.id === "earth" || spec.id === "moon")) {
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
    // br — THE KEYMAP HINT. In NET mode this is the connectivity game's keymap (the planner-
    // drag + launch/accept/cache verbs); in cache mode it is the M2/M3 build keymap (heatmap /
    // deploy / datacenter). The two games own DIFFERENT verbs, so the hint must match the mode —
    // showing "B deploy · M datacenter" in net mode is the clutter fix #2 calls out.
    if (this.netRenderMode) {
      // SD-44 — the CLEAN net keymap (matches the status strip + the main.ts handler): the desktop
      // (keys 1-5) sets the camera, so no E/C/O/S/T here; accept/constellation/prefer are panel
      // buttons; the only on-globe verbs are the planner drag + L launch + R reset-cam. DESKTOP-AWARE:
      // the orbit-tuning keys only do something while the LAUNCH planner is on screen (CONNECTIVITY),
      // so only show them there — elsewhere (OVERVIEW triage / ROUTING) point the player to the launch
      // desktop instead of advertising keys that look inert.
      // R1 (SD-45): a pure CONTROL LEGEND (keys only, never goal instructions — LAW 2).
      const planning = this.netState?.body?.plannerActive ?? false;
      const line2 = planning
        ? `<span class="k">↑↓</span> altitude · <span class="k">←→</span> inclination · <span class="k">[ ]</span> phase`
        : `<span class="k">drag</span>/<span class="k">wheel</span> to look · <span class="k">L</span> pad`;
      set(
        "br",
        `<span class="k">1 2</span> desktops · <span class="k">R</span> reset cam · <span class="k">click</span> select\n` + line2,
      );
    } else {
      set(
        "br",
        `<span class="k">E C O S T</span> presets · <span class="k">R</span> reset · <span class="k">F</span> focus · <span class="k">click</span> select\n` +
          `<span class="k">H</span> heatmap · <span class="k">D</span> dim · <span class="k">B</span> deploy · <span class="k">L</span> launch · <span class="k">M</span> datacenter`,
      );
    }
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

  /** R2 (SD-45) — raycast the pointer against the operated-body sphere; returns the
   * BODY-FIXED lat/lon under the cursor (accounting for the spin θ(t)), or null. */
  private aimHit(clientX: number, clientY: number): { latRad: number; lonRad: number } | null {
    const sphere = this.netBodySphere;
    if (!sphere || !sphere.visible) return null;
    const rect = this.canvas.getBoundingClientRect();
    this.aimNdc.set(
      ((clientX - rect.left) / rect.width) * 2 - 1,
      -(((clientY - rect.top) / rect.height) * 2 - 1),
    );
    this.aimRaycaster.setFromCamera(this.aimNdc, this.camera);
    const hits = this.aimRaycaster.intersectObject(sphere, false);
    if (hits.length === 0) return null;
    const p = hits[0].point;
    // Direction from the sphere centre in THREE axes → ecliptic (x_e = x, y_e = −z, z_e = y).
    const dx = p.x - sphere.position.x;
    const dy = p.y - sphere.position.y;
    const dz = p.z - sphere.position.z;
    const mlen = Math.hypot(dx, dy, dz) || 1;
    const xe = dx / mlen;
    const ye = -dz / mlen;
    const ze = dy / mlen;
    const latRad = Math.asin(Math.max(-1, Math.min(1, ze)));
    const inertialLon = Math.atan2(ye, xe);
    // Body-fixed longitude: subtract the spin angle (net toy: ω = 2π / 240 s).
    const theta = ((2 * Math.PI) / 240) * this.ctx.now();
    let lon = inertialLon - theta;
    const TAU2 = Math.PI * 2;
    lon = ((lon % TAU2) + TAU2) % TAU2;
    if (lon > Math.PI) lon -= TAU2;
    return { latRad, lonRad: lon };
  }

  /** FL-13 (SD-49) — screen-space distance (px) from the pointer to the DRAFT ORBIT RING
   * (null when the ring is hidden). The ring is a LineSegments whose positions sit in
   * RENDER space (rebased); project each vertex and take the min distance. Read-only. */
  private ringScreenDistPx(clientX: number, clientY: number): number | null {
    const ring = this.netDraftRing;
    if (!ring || !ring.visible) return null;
    const rect = this.canvas.getBoundingClientRect();
    const arr = (ring.geometry.getAttribute("position") as { array: Float32Array }).array;
    const v = this.aimNdc3;
    let best = Infinity;
    for (let i = 0; i < arr.length; i += 6) {
      // every segment START (they duplicate, but the det is cheap and correct)
      v.set(arr[i], arr[i + 1], arr[i + 2]).project(this.camera);
      const sx = rect.left + ((v.x + 1) / 2) * rect.width;
      const sy = rect.top + ((1 - v.y) / 2) * rect.height;
      const d = Math.hypot(sx - clientX, sy - clientY);
      if (d < best) best = d;
    }
    return best;
  }
  private readonly aimNdc3 = new THREE.Vector3();

  /** FL-13 — dev/test probe: pointer → ring hit-test result (the scriptable handle the
   * ring-drag pointer test drives). */
  __dragOrbitProbe(clientX: number, clientY: number): { distPx: number } | null {
    const d = this.ringScreenDistPx(clientX, clientY);
    return d === null ? null : { distPx: d };
  }

  /** FL-14 (SD-49) — the ring-pinned DRAFT chip: show a one-line facts readout pinned over
   * the orrery while the pad is open (null hides). Facts only; main composes the text. */
  setNetDraftChip(text: string | null): void {
    if (!this.netDraftChip) return;
    if (text === null) {
      if (this.netDraftChip.style.display === "none") return; // already hidden — no churn
      this.netDraftChip.style.display = "none";
      return;
    }
    if (this.netDraftChip.textContent !== text) this.netDraftChip.textContent = text;
    this.netDraftChip.style.display = "";
  }

  private attachInput(): void {
    this.canvas.addEventListener("pointerdown", (e) => {
      // Pointer priority (pad open): RING grab (altitude drag) → globe AIM drag → camera.
      const aiming = this.onNetAim !== null && (this.netState?.body?.plannerActive ?? false);
      if (aiming && this.onNetDragOrbit !== null) {
        const ringDist = this.ringScreenDistPx(e.clientX, e.clientY);
        if (ringDist !== null && ringDist <= PICK_TOLERANCE_PX) {
          this.ringDragging = true;
          this.ringGrabClientY = e.clientY;
          this.ringGrabAltM = this.netState?.draft?.altM ?? 0;
          // metres-per-pixel from the ring's screen span: dragging across the ring's height
          // spans the whole altitude axis (LEO→GEO), at whatever zoom we're at.
          const ring = this.netDraftRing!;
          const rect = this.canvas.getBoundingClientRect();
          const arr = (ring.geometry.getAttribute("position") as { array: Float32Array }).array;
          const v = this.aimNdc3;
          let yMin = Infinity;
          let yMax = -Infinity;
          for (let i = 0; i < arr.length; i += 6) {
            v.set(arr[i], arr[i + 1], arr[i + 2]).project(this.camera);
            const sy = rect.top + ((1 - v.y) / 2) * rect.height;
            if (sy < yMin) yMin = sy;
            if (sy > yMax) yMax = sy;
          }
          const spanPx = Math.max(40, yMax - yMin);
          // The altitude axis covered by the ring's screen height ≈ the ring's own altitude
          // on both sides of the globe (2× alt), floored to keep low-orbit drags usable.
          this.ringMPerPx = Math.max(500, (2 * Math.max(this.ringGrabAltM, 20_000)) / spanPx);
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      if (aiming) {
        const hit = this.aimHit(e.clientX, e.clientY);
        if (hit !== null) {
          this.aimDragging = true;
          this.onNetAim!(hit.latRad, hit.lonRad);
          this.canvas.setPointerCapture(e.pointerId);
          return;
        }
      }
      this.dragging = true;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.dragTravelPx = 0;
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (this.ringDragging) {
        // FL-13 — vertical pull = altitude. UP (negative clientY delta) raises the orbit.
        this.onNetDragOrbit?.(this.ringGrabAltM + (this.ringGrabClientY - e.clientY) * this.ringMPerPx);
        return;
      }
      if (this.aimDragging) {
        const hit = this.aimHit(e.clientX, e.clientY);
        if (hit !== null) this.onNetAim?.(hit.latRad, hit.lonRad);
        return;
      }
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
      this.aimDragging = false;
      this.ringDragging = false;
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
        const k = 1 + Math.sign(e.deltaY) * 0.08;
        // R2e (SD-45): while a hero/planner FILL drives the dolly, the wheel scales the
        // fill distance (netZoomMul) — otherwise the fill silently overrode every wheel
        // event ("mouse zoom still doesn't work"). Off-fill, the classic dist zoom.
        const fillActive =
          this._netRenderMode && (this.netHeroFill > 0 || (this.netState?.body?.plannerActive ?? false));
        if (fillActive) {
          this.netZoomMul = Math.max(0.35, Math.min(4, this.netZoomMul * k));
        } else {
          this.tgt.dist = Math.max(0.4, Math.min(60, this.tgt.dist * k));
        }
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
    (window as unknown as Record<string, unknown>).__lastClickDebug = { x: clickX, y: clickY };
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
    (window as unknown as Record<string, unknown>).__lastPickDebug = { hit, n: cands.length, c0: cands[0] ? { id: cands[0].id, dx: cands[0].sx - clickX, dy: cands[0].sy - clickY } : null };
    if (hit === null) return;
    this.selectedId = hit;
    // Focus the camera only on a focusable BODY; assets/DCs select-only (keep the parent
    // framed so the orbit + the rest of the constellation stay on screen).
    if (FOCUS_ORDER.includes(hit)) this.focusId = hit;
  }

  /** Debug: all pickable candidates + their screen positions (what a click at X,Y would hit). */
  pickCands(): { id: string; x: number; y: number }[] {
    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    const out: { id: string; x: number; y: number }[] = [];
    const project = (id: string, abs: Vec3): void => {
      this.renderInto(this._rp, abs, focusAbs);
      this.tmpV.copy(this._rp).project(this.camera);
      if (this.tmpV.z > 1) return;
      const rect = this.canvas.getBoundingClientRect();
      out.push({ id, x: rect.left + ((this.tmpV.x + 1) / 2) * rect.width, y: rect.top + ((1 - this.tmpV.y) / 2) * rect.height });
    };
    const bs = this.buildState;
    if (bs) for (const a of bs.assets) project(a.id, a.posM);
    return out;
  }

  /** Screen-space centre of an asset id (probe for tests/scenes; null if off/currently undrawn). */
  assetScreenPos(id: string): { x: number; y: number } | null {
    const a = this.buildState?.assets.find((x) => x.id === id);
    if (!a) return null;
    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    this.renderInto(this._rp, a.posM, focusAbs);
    this.tmpV.copy(this._rp).project(this.camera);
    if (this.tmpV.z > 1) return null;
    const rect = this.canvas.getBoundingClientRect();
    return {
      x: rect.left + ((this.tmpV.x + 1) / 2) * rect.width,
      y: rect.top + ((1 - this.tmpV.y) / 2) * rect.height,
    };
  }

  /** The currently selected asset/body id (click- or F-selected), or null. */
  selected(): string | null {
    return this.selectedId;
  }

  /**
   * §3 — DEV-ONLY introspection for the headless planner-globe verify: confirms the operated body is
   * a REAL {@link THREE.SphereGeometry} (NOT a billboard), reports the operated body id (body-
   * agnostic, read from the live net slice), its visibility, and the smoothed planner-focus value
   * (0 normal net framing → 1 close-up). BUG-1/BUG-2 verify: also reports whether the SUN HALO is
   * hidden in net mode, and PROJECTS the live sphere to measure its ON-SCREEN radius (px + the
   * fraction of the pane height it fills) so the close-up framing is checkable headlessly. Render-
   * only read; called only from the DEV window hook.
   */
  netGlobeDebug(): {
    sphereIsSphereGeometry: boolean;
    sphereVisible: boolean;
    bodyId: string | null;
    graticuleSegments: number;
    plannerFocus: number;
    focusId: string;
    sunHaloVisible: boolean;
    spherePxRadius: number;
    sphereHeightFraction: number;
    /** P1 (GDD §5) — how many active served-contract paths the live network is drawing this frame. */
    servedLinkCount: number;
    /** P1 — whether the live-network LineSegments is currently visible (≥1 link drawn). */
    servedLinkVisible: boolean;
    /** net/ Act-1 — Moon glyph debug: visibility + on-screen NDC + pixel position (for framing). */
    moonVisible: boolean;
    moonOnScreen: boolean;
    moonNdc: [number, number, number];
  } {
    const sphere = this.netBodySphere;
    const grat = this.netBodyGraticule;
    // Project the sphere's CENTRE + a point one scaled-radius up onto the screen and measure the
    // pixel distance ⇒ the on-screen sphere radius. (sphere.scale is the scene radius; +X world is a
    // good probe since the camera looks at the origin.) NDC y∈[-1,1] maps to h px; the projected
    // radius as a fraction of the PANE HEIGHT == pxRadius / h.
    let spherePxRadius = 0;
    if (sphere && sphere.visible) {
      const c = this.tmpV.copy(sphere.position).project(this.camera);
      const edge = this._rp2
        .copy(sphere.position)
        .addScaledVector(this._rp.set(1, 0, 0), sphere.scale.x)
        .project(this.camera);
      const dx = ((edge.x - c.x) * this.w) / 2;
      const dy = ((edge.y - c.y) * this.h) / 2;
      spherePxRadius = Math.hypot(dx, dy);
    }
    return {
      sphereIsSphereGeometry: sphere?.geometry instanceof THREE.SphereGeometry,
      sphereVisible: sphere?.visible ?? false,
      bodyId: this.netState?.body?.id ?? null,
      graticuleSegments: grat ? (grat.geometry.getAttribute("position")?.count ?? 0) / 2 : 0,
      plannerFocus: this.netPlannerFocus,
      focusId: this.focusId,
      sunHaloVisible: this.haloMesh?.visible ?? false,
      spherePxRadius,
      // The sphere DIAMETER as a fraction of the pane height (the BUG-2 target: ~0.35–0.45).
      sphereHeightFraction: this.h > 0 ? (2 * spherePxRadius) / this.h : 0,
      // P1 — the live network drawn this frame (the count from the slice + the mesh visibility).
      servedLinkCount: this.netState?.servedLinks?.length ?? 0,
      servedLinkVisible: this.netServedLinks?.visible ?? false,
      ...(() => {
        const moon = this.bodyMeshes.get("moon");
        if (!moon) return { moonVisible: false, moonOnScreen: false, moonNdc: [0, 0, 0] as [number, number, number] };
        const n = this.tmpV.copy(moon.position).project(this.camera);
        const onScreen = moon.visible && n.x >= -1 && n.x <= 1 && n.y >= -1 && n.y <= 1 && n.z >= -1 && n.z <= 1;
        return {
          moonVisible: moon.visible,
          moonOnScreen: onScreen,
          moonNdc: [Math.round(n.x * 1000) / 1000, Math.round(n.y * 1000) / 1000, Math.round(n.z * 1000) / 1000] as [number, number, number],
        };
      })(),
    };
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
