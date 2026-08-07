/**
 * net/ — the network game's toy-radius pacing + world constants + the planner's
 * orbit resolver + launch cost. Migrated UNCHANGED (pacing-wise) from a1/world-a1.ts.
 *
 * PURE: no three, no DOM, no wall-clock, no unseeded RNG. Everything is derived from
 * the real, UNFORKED `EARTH_MU` (m2/launch.ts) so orbit propagation stays bit-for-bit
 * the same code the ephemeris + roster use. The only toy invention is a TOY body
 * radius (300 km) + a ~4-minute "day", chosen so a GEO-class orbit (a) sits above the
 * toy surface and (b) shares its period with the body spin (geostationary by
 * construction). The physically-faithful, transferable part is the RATIO
 * (GEO period == rotation period ⇒ parks); the absolute scales are explicit toys.
 *
 * Note on framing (design §1, A0): EIRP stays a REAL antenna field used by the link
 * budget — never an Act-1 "closing-lever" forced-imperfection knob. The dropped
 * A1_DISH_EIRP=1.1 and its preset framing do NOT migrate here.
 *
 * @see docs/signal-horizon-m1.md Part II §1 (layout), §2.1 (pacing), §5 (Act-1 slice).
 */

import type { Ephemeris } from "../ephemeris";
import type { SatOrbit } from "../m2/roster";
import type { SimRng } from "../rng";
import { EARTH_MU } from "../m2/launch";
import { orbitPeriodSeconds, solveOrbit } from "../m2/orbit";
import type { AntennaSpec, NetSat, BusTier } from "./sat";
import { standardLoadout, hardwarePriceEur, DEFAULT_LOADOUT_CARD_IDS } from "./sat";
import {
  type RegionPoint,
  type GroundNet,
  type Region,
  NET_SPACE_SAMPLES,
  coveredFraction,
} from "./endpoint";
// Source the link-budget reference distance from the LEAF coverage/field (NOT the
// link-budget re-export) to break a module-init cycle: link-budget imports
// A1_BODY_RADIUS_M from this file, and the eager preset construction below reads
// this constant AT MODULE-EVAL — under the unbundled dev server that races the
// cycle into a TDZ ("Cannot access 'NET_REF_LINK_DISTANCE_M' before initialization").
// The value is identical (link-budget's NET_REF_LINK_DISTANCE_M === REF_LINK_DISTANCE_M).
import { REF_LINK_DISTANCE_M as NET_REF_LINK_DISTANCE_M } from "../coverage/field";
import { solve, isPointServed, type RouterAxis } from "./router";

const TAU = Math.PI * 2;

// ── pacing synthesis (GEO period == day, both ~4 min) ──────────────────────────

/** Toy body radius (metres). Render-decoupled (Decision G, net-mode scoped); the
 * surface math only ever uses THIS radius, never the real 6371 km ephemeris radius. */
export const A1_BODY_RADIUS_M = 300_000;

/** GEO-class orbital period (seconds) — also the body's rotation period (the "day"). */
export const A1_GEO_PERIOD_S = 240;

/** LEO-class orbital period (seconds). Shorter ⇒ n_LEO ≠ ω ⇒ it sweeps + sets. */
export const A1_LEO_PERIOD_S = 150;

/** GEO-class semi-major axis (metres) from the unforked μ: a = cbrt(μ·(T/2π)²). */
export const A1_GEO_SEMI_MAJOR_M = Math.cbrt(EARTH_MU * (A1_GEO_PERIOD_S / TAU) ** 2);

/** LEO-class semi-major axis (metres) from the unforked μ. */
export const A1_LEO_SEMI_MAJOR_M = Math.cbrt(EARTH_MU * (A1_LEO_PERIOD_S / TAU) ** 2);

/** Earth spin rate (rad/s) = 2π / day. By construction this equals the GEO mean
 * motion √(μ/a³) (pinned bit-equal in pacing.test.ts), so the equatorial GEO parks. */
export const A1_EARTH_OMEGA_RAD_PER_S = TAU / A1_GEO_PERIOD_S;

/** The body's rotation period (seconds) — equal to the GEO period by construction. */
export const A1_EARTH_ROTATION_PERIOD_S = A1_GEO_PERIOD_S;

/** De-squash render band outer radius (metres), set above the GEO altitude so the
 * GEO/LEO orbits fan out above the toy surface in net render mode (Decision G). */
export const A1_RENDER_BAND_M = 1.2 * A1_GEO_SEMI_MAJOR_M;

// ── the two non-dominant presets (real planner points; eirp is a real field) ────

/** A launch preset: a named point in the orbit + loadout design space the planner
 * exposes. `eirp` selects the standard antenna for the preset's loadout — a real
 * antenna field feeding the link budget, NOT a forced-imperfection closing lever. */
export interface NetPreset {
  id: string;
  label: string;
  semiMajorM: number;
  incRad: number;
  subLonRad: number;
  /** Standard antenna EIRP (1.0) — a real link-budget field. */
  eirp: number;
  /** Antenna cone half-angle (radians) — the footprint half-angle hint. */
  coneHalfAngleRad: number;
  /** Base launch cost (€) before the altitude/mass term. */
  costBaseEur: number;
}

/** GEO PARK — equatorial, parks over a fixed sub-longitude (ω == n). At eirp 1.0 the
 * parked GEO covers the WHOLE equatorial region disc with margin (no clip): this is
 * the Act-1 default that already works. */
export const GEO_PARK: NetPreset = {
  id: "GEO_PARK",
  label: "GEO PARK",
  semiMajorM: A1_GEO_SEMI_MAJOR_M,
  incRad: 0,
  subLonRad: 0,
  eirp: 1.0,
  coneHalfAngleRad: 30 * (Math.PI / 180),
  costBaseEur: 1200,
};

/** LEO SWEEP — the Act-2 high-INCLINATION (polar, 90°) LEO, lower than GEO, sweeps + sets
 * each ~150 s pass. A single LEO sets, so it does not HOLD the region (a sawtooth — the
 * Act-2 wall / the gentle-shortfall fallback case). The polar inclination is what lets an
 * inclined CONSTELLATION reach the high-latitude REGION-1 (lat 70°) the parked equatorial
 * GEO physically cannot — the only Act-2 physics lever is LATITUDE (latency is not a lever
 * until Act 3). At inc 90° an evenly-phased N=4 constellation holds REGION-1's centre across
 * the hand-off cycle (the EMPIRICALLY measured zero-gap minimum; pinned in scenario/phasing). */
export const LEO_SWEEP: NetPreset = {
  id: "LEO_SWEEP",
  label: "LEO SWEEP",
  semiMajorM: A1_LEO_SEMI_MAJOR_M,
  incRad: 90 * (Math.PI / 180),
  subLonRad: 5 * (Math.PI / 180),
  eirp: 1.0,
  coneHalfAngleRad: 30 * (Math.PI / 180),
  costBaseEur: 900,
};

/** MARS RELAY — the Act-4 deep-space relay the player launches to "reach Mars" (the frontier
 * teaser, "distance changes everything"). The player launches it with the SAME net_launch verb
 * they always have (onboarding: "you launch as you always have") — only the preset differs. Its
 * orbit + antenna are COSMETIC: connectivity on the Mars leg is PRESENCE-based (the router's
 * solveMarsLeg branch), NOT a toy-frame inverse-square close — so the relay needs NO giant EIRP
 * to "reach" Mars (there is no toy budget on that hop) and no special orbit. A parked GEO-class
 * orbit gives it a stable, time-invariant presence (no horizon thrash on the Earth side); the
 * minutes-long latency is the REAL Earth↔Mars light delay injected by the router, not this orbit.
 * The eirp is the standard real antenna field (never a closing lever). */
export const MARS_RELAY: NetPreset = {
  id: "MARS_RELAY",
  label: "MARS RELAY",
  semiMajorM: A1_GEO_SEMI_MAJOR_M,
  incRad: 0,
  subLonRad: Math.PI, // parked on the anti-meridian (cosmetic; presence is what bridges).
  eirp: 1.0,
  coneHalfAngleRad: 30 * (Math.PI / 180),
  costBaseEur: 1500,
};

export const NET_PRESETS: NetPreset[] = [GEO_PARK, LEO_SWEEP, MARS_RELAY];

// ── epoch-correct sub-longitude → orbit ─────────────────────────────────────────

/**
 * Resolve a planner draft (semi-major axis, inclination, desired body-fixed
 * sub-longitude) into a {@link SatOrbit} at commit epoch `t`, around "earth".
 *
 * Epoch-correct sub-longitude mapping: with `inc=raan=argp=0` the inertial sub-lon is
 * `m0 + n·(t−epoch)`; the body-fixed sub-lon is `inertial − θ(t) = m0 + n·(t−epoch) − ω·t`.
 * With epoch == t this is `m0 − ω·epoch`. To make the parked body-fixed longitude equal
 * the player's `subLonRad` at ANY commit tick, set `m0 = subLonRad + ω·epoch`.
 * (The naive `m0 = subLonRad` would park at `subLonRad − ω·epoch` — the MED bug.)
 */
export function resolveOrbit(
  p: { semiMajorM: number; incRad: number; subLonRad: number; raanRad?: number },
  t: number,
): SatOrbit {
  return {
    parentId: "earth",
    aM: p.semiMajorM,
    e: 0,
    incRad: p.incRad,
    // RAAN is the planner's fourth parameter (§3.1) — the ceiling the player drags to slide the
    // ground-track east/west around the pole. DEFAULTS to 0 so a launch that never touches RAAN
    // resolves byte-identically to the pre-RAAN orbit (the net golden is unaffected; only a
    // dragged-RAAN launch ever sets a non-zero value).
    raanRad: p.raanRad ?? 0,
    argpRad: 0,
    m0Rad: p.subLonRad + A1_EARTH_OMEGA_RAD_PER_S * t,
    epochS: t,
    muParent: EARTH_MU,
  };
}

/** Launch cost (€): base + a small altitude-above-the-toy-surface term (heavier lift
 * for higher orbits). Pure deterministic function of the draft.
 * @deprecated R0 (SD-45): the live economy prices launches via {@link launchVehicleCost}
 * + {@link launchStackCost} (mass-aware, bus-tiered). Kept for legacy readers/tests. */
export function launchCost(p: { semiMajorM: number; costBaseEur: number }): number {
  const altM = Math.max(0, p.semiMajorM - A1_BODY_RADIUS_M);
  return p.costBaseEur + altM * 1e-3;
}

// ── R0 (SD-45) — the launch economy (m1-redesign §2.2/§2.5) ─────────────────────────

/** The fixed vehicle/base price of a launch (€), before the lift term. TUNABLE. */
export const NET_LAUNCH_BASE_EUR = 6000;

/** Lift price (€ per km of altitude) by bus tier — the mass term. A comsat masses ~4.7×
 * a smallsat but lifts at ~1.9× the €/km (economies of scale): consolidation is cheaper
 * per unit, at the price of one fault domain in one place. TUNABLE. */
export const NET_LIFT_EUR_PER_KM: Readonly<Record<BusTier, number>> = {
  smallsat: 16,
  comsat: 30,
};

/** The vehicle cost (€) of ONE launch to a target semi-major axis with a given bus tier
 * aboard: base + lift·altKm. One launch carries the whole batch (batching rewarded). */
export function launchVehicleCost(bus: BusTier, semiMajorM: number): number {
  const altKm = Math.max(0, semiMajorM - A1_BODY_RADIUS_M) / 1000;
  return NET_LAUNCH_BASE_EUR + NET_LIFT_EUR_PER_KM[bus] * altKm;
}

/** The batch manifest discount (FL-11, SD-48): members 2+ of one launch pay
 * `1 − NET_BATCH_MEMBER_DISCOUNT` × hardware — batching rewards consolidation (one vehicle
 * already amortized). TUNABLE. */
export const NET_BATCH_MEMBER_DISCOUNT = 0.15;

/** The full committed cost (€) of a launch: one vehicle + `count` × (bus + antenna
 * cards), members 2+ at the manifest discount. The SAME function the builder previews and
 * the applier charges. Pure. */
export function launchStackCost(
  bus: BusTier,
  cardIds: readonly string[],
  semiMajorM: number,
  count: number,
): number {
  const n = Math.max(1, Math.trunc(count));
  const hw = hardwarePriceEur(bus, cardIds);
  return launchVehicleCost(bus, semiMajorM) + hw * (1 + (n - 1) * (1 - NET_BATCH_MEMBER_DISCOUNT));
}

/**
 * THE FLAT PER-LAUNCH FAILURE CHANCE (design §3.5 — the launch-failure minimum). A low %, drawn
 * from the session's SEEDED splitmix64 RNG exactly like the M2 build session's launch roll (NO new
 * seed, NO new action): each launched member draws ONE double and FAILS the launch if the draw is
 * below this chance — a failed launch loses that sat (you ate the cost) but never the wallet you
 * already paid. TUNABLE: this is the spec floor (~5%), pinned here so the golden is deterministic.
 * The value is chosen so the scripted canonical-run launches all clear the roll (verified in the
 * re-pinned net-replay golden) while a player's ad-hoc launch can still deterministically fail. */
export const NET_LAUNCH_FAILURE_CHANCE = 0.05;

/**
 * Roll a net launch's success against {@link NET_LAUNCH_FAILURE_CHANCE}, drawing ONE double from
 * the SEEDED splitmix64 PRNG (advances `rng` by one u64) — the M2 `rollLaunch` pattern. Deterministic:
 * same rng state ⇒ same roll ⇒ same outcome on replay. `ok = roll >= NET_LAUNCH_FAILURE_CHANCE`.
 */
export function rollNetLaunch(rng: SimRng): { ok: boolean; roll: number } {
  const roll = rng.nextDouble();
  return { ok: roll >= NET_LAUNCH_FAILURE_CHANCE, roll };
}

/**
 * The launch COST BASE (€) for a recorded launch, resolved from its `presetId` (the wire carries
 * the preset id, not the cost). A known preset uses its own `costBaseEur`; an unknown id (a hand-
 * dragged CUSTOM orbit, or a test corridor preset) falls back to {@link NET_DEFAULT_LAUNCH_COST_BASE}.
 * Pure + deterministic so the applier charges the SAME cost the planner previewed. */
export const NET_DEFAULT_LAUNCH_COST_BASE = GEO_PARK.costBaseEur;
export function launchCostBaseForPreset(presetId?: string): number {
  const p = NET_PRESETS.find((x) => x.id === presetId);
  return p ? p.costBaseEur : NET_DEFAULT_LAUNCH_COST_BASE;
}

// ── the launch planner: drafts, presets, and the TRUTHFUL consequence preview ────

/**
 * A planner DRAFT (design §2.3): the editable orbit + loadout the player tunes before
 * committing a launch. `count` is the batch size (1 in Act 1). The loadout is the antenna
 * set the would-be sat carries; the preset seeds it from {@link standardLoadout}. This is
 * the wire-shape (radians + SI metres) the {@link import("../action").netLaunch} action
 * carries (minus the loadout, which the applier rebuilds from the standard loadout in M1).
 */
export interface LaunchDraft {
  semiMajorM: number;
  incRad: number;
  subLonRad: number;
  /** RAAN (radians) — the planner's fourth draggable parameter (§3.1). OPTIONAL: a preset that
   * never sets it (and a launch that never drags it) leaves it undefined ⇒ resolveOrbit uses 0,
   * so the orbit is byte-identical to the pre-RAAN draft (golden-safe). */
  raanRad?: number;
  /** R0/FL: the bus tier the draft flies. OPTIONAL + defaults to "smallsat" so a preset /
   * pre-FL draft is byte-identical (the router never reads `bus` — pricing + slots only). */
  bus?: BusTier;
  loadout: AntennaSpec[];
  count: number;
}

/** A launch PRESET (design §2.3): a named draft + its base cost — the "floor" the planner
 * opens to (GEO PARK already mostly works in Act 1; params are the "ceiling"). A thin
 * adapter over {@link NetPreset} so the planner reads one `LaunchDraft` shape. */
export interface Preset {
  id: string;
  label: string;
  draft: LaunchDraft;
  costBaseEur: number;
}

/** Turn a {@link NetPreset} into a planner {@link Preset} (a `LaunchDraft` + base cost).
 * The loadout is the standard BROADCAST antenna at the preset eirp, sourced from the ONE
 * link-budget reference distance — exactly what the launch applier fits, so the preview
 * loadout == the committed loadout. Pure. */
export function presetToPreset(p: NetPreset): Preset {
  const loadout = standardLoadout(NET_REF_LINK_DISTANCE_M);
  // The preset's eirp seeds the standard antenna (a real link-budget field, not a knob).
  for (const a of loadout) a.eirp = p.eirp;
  return {
    id: p.id,
    label: p.label,
    draft: { semiMajorM: p.semiMajorM, incRad: p.incRad, subLonRad: p.subLonRad, loadout, count: 1 },
    costBaseEur: p.costBaseEur,
  };
}

/** The two Act-1 planner presets as `LaunchDraft`-shaped {@link Preset}s: GEO PARK (the
 * default that already mostly works) and LEO SWEEP (the non-covering fallback case). */
export const GEO_PARK_PRESET: Preset = presetToPreset(GEO_PARK);
export const LEO_SWEEP_PRESET: Preset = presetToPreset(LEO_SWEEP);
/** The Act-4 Mars-relay planner preset (the "launch toward Mars" verb is the SAME net_launch). */
export const MARS_RELAY_PRESET: Preset = presetToPreset(MARS_RELAY);
export const NET_PLANNER_PRESETS: Preset[] = [GEO_PARK_PRESET, LEO_SWEEP_PRESET, MARS_RELAY_PRESET];

/** The launch cost (€) of a {@link LaunchDraft}: the base cost (from the seeding preset)
 * + the altitude term, ×`count`. An overload of {@link launchCost} over a full draft so
 * the planner reads ONE cost surface. Pure.
 * @deprecated FL-01/FL-11 (SD-48): legacy math, NOT what a commit charges — the truthful
 * preview + applier share {@link launchStackCost}. Kept for legacy readers/tests only. */
export function launchDraftCost(draft: LaunchDraft, costBaseEur: number): number {
  return launchCost({ semiMajorM: draft.semiMajorM, costBaseEur }) * Math.max(1, draft.count);
}

/** The minimal world surface {@link previewLaunch} reads off the live session: the standing
 * contracts (their region geometry + active axes) and the ground-net endpoints the router
 * terminates paths at. Structural so the preview never imports the concrete `NetSession`
 * (and so a test can pass a hand-built world) — the session satisfies it by its getters. */
export interface PreviewWorld {
  readonly contracts: readonly { id: string; region: Region; activeAxes?: ReadonlySet<RouterAxis> }[];
  readonly grounds: readonly GroundNet[];
}

/** The per-contract slice of a {@link LaunchPreview}: what the would-be sat does for ONE
 * standing contract — served verdict, the realized latency floor, and the fraction of the
 * region disc the footprint reaches (the truthful coverage gap). */
export interface ContractPreview {
  contractId: string;
  /** True iff the committed sat would carry a path region→sat→groundNet THIS instant. */
  served: boolean;
  /** The realized one-way latency along that path (seconds); Infinity when unserved. */
  latencyFloorS: number;
  /** Fraction of the region disc the footprint covers (1.0 = whole disc, the Act-1 win). */
  coveredFraction: number;
  /** The binding axis when unserved (feeds the trace face); null when served. */
  bindingConstraint: RouterAxis | null;
}

/** The TRUTHFUL consequence preview (design §2.3 / §6): what a draft launch WOULD do,
 * computed with the SAME router + link-budget the live world uses — so the preview the
 * player sees before commit is exactly what they get after commit. Pure. */
export interface LaunchPreview {
  /** The orbit the draft resolves to at commit time (epoch-correct m0). */
  orbit: SatOrbit;
  /** The orbital period (seconds) — GEO parks (== the day); LEO sweeps + sets. */
  periodS: number;
  /** The launch cost (€) the commit would charge. */
  costEur: number;
  /** The ground track: the body-fixed sub-point (lat,lon) at evenly-spaced phases over one
   * period — the footprint's path across the spinning surface (GEO holds station; LEO walks). */
  groundTrack: RegionPoint[];
  /** Per standing contract, what the would-be sat does (served / latency floor / coverage). */
  contracts: ContractPreview[];
}

/** Number of ground-track samples over one period (the footprint's path). */
export const NET_GROUND_TRACK_SAMPLES = 64;

/**
 * Build the would-be {@link NetSat} a draft launch resolves to at sim-time `t` — the SAME
 * sat {@link import("./apply-action").applyNetAction} commits (epoch-correct orbit via
 * {@link resolveOrbit}; the draft's loadout). So a preview against this sat is byte-truthful
 * to the post-commit world. `id` is the preview placeholder (the live applier assigns the
 * monotonic roster id). Pure.
 */
export function draftToSat(draft: LaunchDraft, t: number, id = "PREVIEW-SAT"): NetSat {
  return {
    id,
    orbit: resolveOrbit(
      { semiMajorM: draft.semiMajorM, incRad: draft.incRad, subLonRad: draft.subLonRad, raanRad: draft.raanRad },
      t,
    ),
    // FL-01/FL-11: the preview sat flies the drafted bus (defaults smallsat — byte-
    // identical to the pre-bus builder sat; the router never reads `bus`).
    bus: draft.bus ?? "smallsat",
    loadout: draft.loadout.map((a) => ({ ...a })),
  };
}

/**
 * The body-fixed sub-point (lat,lon) of a sat at sim-time t: the surface point directly
 * under the sat, mapped back through the spin so it reads as a body-fixed track (a parked
 * GEO holds a fixed sub-lon; a LEO walks). The sat's inertial direction is the UNFORKED
 * {@link solveOrbit} position (earth-relative — the toy parent is "earth"); the body-fixed
 * sub-lon subtracts the spin angle θ(t) = ω·t (the same convention frame.ts/earthThetaAt
 * use). Pure.
 */
function subPointOf(sat: NetSat, t: number): RegionPoint {
  const pos = solveOrbit(sat.orbit, t);
  const m = Math.hypot(pos[0], pos[1], pos[2]) || 1;
  const z = Math.max(-1, Math.min(1, pos[2] / m));
  const theta = A1_EARTH_OMEGA_RAD_PER_S * t;
  const latRad = Math.asin(z);
  const inertialLon = Math.atan2(pos[1], pos[0]);
  return { latRad, lonRad: wrapPi(inertialLon - theta) };
}

/** Wrap an angle into (-π, π]. */
function wrapPi(a: number): number {
  let x = a % TAU;
  if (x > Math.PI) x -= TAU;
  if (x <= -Math.PI) x += TAU;
  return x;
}

/** The card ids a draft's resolved antenna loadout corresponds to (an id-less legacy
 * antenna — eirp-seeded or pre-R0 — reads as the wire default it would resolve to). */
function draftCardIds(draft: LaunchDraft): string[] {
  const ids = draft.loadout.map((a) => a.cardId).filter((id) => id.length > 0);
  return ids.length > 0 ? ids : [...DEFAULT_LOADOUT_CARD_IDS];
}

/**
 * THE TRUTHFUL CONSEQUENCE PREVIEW (design §2.3 / §6). Compute what committing `draft` at
 * sim-time `t` WOULD do — footprint coverage, ground track, period, and the per-contract
 * latency floor — using the SAME {@link solve} + link budget the live session runs
 * post-commit. The verdict is computed against the would-be sat ALONE (the preview shows the
 * marginal consequence of THIS launch; Act 1 has an empty roster, so it is the whole world).
 *
 * The consequence-truth invariant (pinned in the A4 test): for any draft, the preview's
 * per-contract {served, latencyFloorS, bindingConstraint} equals the post-commit
 * `router.solve` for that exact orbit — because both build the sat the SAME way (resolveOrbit
 * + the standard loadout) and run the SAME solver. Pure.
 */
export function previewLaunch(
  eph: Ephemeris,
  world: PreviewWorld,
  draft: LaunchDraft,
  t: number,
  /** @deprecated FL-01: ignored — the preview price is the applier's {@link launchStackCost},
   * never the legacy base+altitude math. Kept in the signature for legacy callers. */
  costBaseEur = 0,
): LaunchPreview {
  void costBaseEur;
  const sat = draftToSat(draft, t);
  const sats: NetSat[] = [sat];
  const grounds = world.grounds.slice();
  const periodS = orbitPeriodSeconds(sat.orbit);

  // Per-contract truthful verdict via the SAME router.solve the live session uses.
  const contracts: ContractPreview[] = [];
  for (const c of world.contracts) {
    const res = solve(eph, { id: c.id, region: c.region, activeAxes: c.activeAxes }, sats, grounds, t);
    const frac = coveredFraction(c.region, NET_SPACE_SAMPLES, (p: RegionPoint) =>
      isPointServed(eph, p, grounds, sats, t),
    );
    contracts.push({
      contractId: c.id,
      served: res.served,
      latencyFloorS: res.latencyS,
      coveredFraction: frac,
      bindingConstraint: res.bindingConstraint,
    });
  }

  // The ground track over one period (the footprint's body-fixed path). For a degenerate or
  // zero-period orbit we sample over a single GEO day so the track is still well-defined.
  const span = periodS > 0 ? periodS : A1_GEO_PERIOD_S;
  const groundTrack: RegionPoint[] = [];
  for (let i = 0; i < NET_GROUND_TRACK_SAMPLES; i++) {
    const tt = t + (span * i) / NET_GROUND_TRACK_SAMPLES;
    groundTrack.push(subPointOf(sat, tt));
  }

  return {
    orbit: sat.orbit,
    periodS,
    // FL-01/FL-11 (SD-46/SD-48): THE preview price IS the applier's price — the ONE stack-cost
    // function over the drafted bus + cards + count (+ the batch discount), so the PAD line ==
    // the charged line, always. The draft's AntennaSpec loadout carries its cardId through from
    // the builder (an id-less legacy antenna reads as the wire default it resolves to).
    costEur: launchStackCost(
      sat.bus,
      draftCardIds(draft),
      draft.semiMajorM,
      draft.count,
    ),
    groundTrack,
    contracts,
  };
}
