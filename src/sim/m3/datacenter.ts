/**
 * M3a — THE ORBITAL DATACENTER + THERMAL/POWER MODEL (GDD §4.5 "Orbital & Deep-Space
 * Datacenters — Compute as Infrastructure, force-multiplier, NOT a second game").
 *
 * This is the M3 spine's first node: COMPUTE AS BUILDABLE INFRASTRUCTURE that
 * FORCE-MULTIPLIES the network loop. A {@link Datacenter} is one of a SMALL NUMBER OF
 * HIGH-IMPACT STRATEGIC NODES the player places, powers, and cools (GDD §4.5 / Risk-5,
 * the explicit hard constraint): it is NOT a sprawling base-builder. Every lever here
 * feeds the §3 coverage/contract/economy loop directly (see {@link computeLiftMultiplier}),
 * or it is cut. Per Aspera's bolted-on colonies are the cautionary tale.
 *
 * --- THE TWO PHYSICAL CEILINGS (each a real constraint, GDD §4.5) ------------
 * A space datacenter is governed by physics utterly unlike a ground rack, and each
 * physical fact is a gameplay lever:
 *
 *   POWER. Solar flux falls off as 1/distance² from the Sun. A DC at Earth (1 AU) gets
 *   full flux; a DC at Mars (~1.52 AU) gets ~43%; at Jupiter ~4% (GDD §4.5: "outer-system
 *   compute is brutally expensive in panel mass"). So solar power = SOLAR_FLUX_1AU /
 *   d_AU² × panelArea × efficiency. An RTG option supplies a SMALL CONSTANT power
 *   independent of distance (the nuclear lever for the dark outer system).
 *
 *   COOLING is RADIATIVE-ONLY (vacuum — no convection/conduction sink). Heat is rejected
 *   through radiator area alone: P_reject = RADIATOR_W_PER_M2 × radiatorArea. Thermal
 *   rejection is a HARD CEILING on compute density (GDD §4.5: "thermal capacity is a hard
 *   ceiling on compute density" — the cold-but-empty environment makes cooling HARDER).
 *
 * COMPUTE BUDGET = min(power-limited compute, thermal-limited compute). BOTH ceilings
 * bite: a DC with huge panels but tiny radiators is thermally throttled; a DC with huge
 * radiators but small far-from-Sun panels is power-starved. The player trades panel mass
 * vs radiator mass vs distance — a genuine strategic optimisation, not flavour.
 *
 * --- PURITY / DETERMINISM ---------------------------------------------------
 * PURE: no three / DOM / wall-clock / RNG. Power/thermal/compute are pure functions of
 * (placement, ephemeris geometry at t). The DC's placement is bit-stable data (ids,
 * doubles, a body id), so a DC roster folds straight into the M2 BuildSession snapshot /
 * state-hash and reproduces on replay. Numbers are SANE PLACEHOLDERS (tune later); every
 * dial is a named constant here.
 */

import type { Ephemeris, Vec3 } from "../ephemeris";
import { AU_M } from "../ephemeris";

// --- TUNING CONSTANTS — sane placeholders, tune later -----------------------

/** Usable electrical power a solar panel delivers PER m² AT 1 AU (W/m²). Real solar
 * constant ≈ 1361 W/m²; this folds panel efficiency + packing into one dial so the
 * number reads as "delivered electrical watts per panel-m² at Earth distance". A
 * placeholder sized so a modest panel area yields a few hundred W of compute headroom. */
export const PANEL_W_PER_M2_AT_1AU = 300.0;

/** Heat (W) a radiator can REJECT per m² of radiator area (radiative-only, vacuum). A
 * lumped Stefan–Boltzmann-at-operating-temperature figure: real space radiators reject
 * on the order of a few hundred W/m². The radiator is the THERMAL ceiling — every watt
 * of compute becomes waste heat that must be shed through this area or the DC throttles. */
export const RADIATOR_W_PER_M2 = 250.0;

/** Watts of POWER drawn to deliver ONE UNIT of compute (W per compute-unit). The
 * power→compute conversion: compute_from_power = usablePower / COMPUTE_W_PER_UNIT. */
export const COMPUTE_W_PER_UNIT = 50.0;

/** Watts of HEAT each unit of compute must reject (W per compute-unit). Slightly under
 * {@link COMPUTE_W_PER_UNIT} (some draw leaves as signal, most as heat): compute_from_thermal
 * = rejectableHeat / THERMAL_W_PER_UNIT. With THERMAL just under COMPUTE_W_PER_UNIT a
 * balanced DC needs a hair more radiator-m² than panel-m² — the thermal ceiling is felt. */
export const THERMAL_W_PER_UNIT = 45.0;

/** Constant electrical power (W) an RTG supplies, INDEPENDENT of distance from the Sun
 * (the nuclear lever, GDD §4.5: "or forces nuclear/RTG power"). Small vs a decent panel
 * at 1 AU, but it does NOT fall off with d² — so it dominates in the dark outer system
 * where solar flux has collapsed. A DC can carry BOTH (panels + an RTG floor). */
export const RTG_POWER_W = 1200.0;

/** The maximum revenue/quality LIFT a fully-compute-saturated DC applies to contracts in
 * its footprint (GDD §4.5 "edge compute: transmit conclusions not bytes" — processing at
 * the edge turns raw bytes into high-value conclusions, lifting the € the same coverage
 * earns). A DC at full compute multiplies an in-footprint contract's revenue by up to
 * (1 + this). BOUNDED so a DC can't run away (Risk-5 / §4.5 — a force-multiplier with a
 * ceiling, not an exponential base-builder payoff). Placeholder: a strong but bounded +40%. */
export const MAX_COMPUTE_LIFT = 0.40;

/** Compute budget (units) at which the lift reaches HALF of {@link MAX_COMPUTE_LIFT} — the
 * diminishing-returns knee. The lift is a saturating (Michaelis–Menten-style) curve
 * compute/(compute + this): cheap early compute buys a lot of lift, more compute buys ever
 * less, and the lift can NEVER exceed MAX_COMPUTE_LIFT no matter how big the DC. This is the
 * "diminishing returns / bounded" discipline §4.5 demands. Placeholder. */
export const COMPUTE_LIFT_HALF_UNITS = 6.0;

/** Angular radius (radians) of a DC's edge-compute FOOTPRINT around its sub-point / co-located
 * region — the great-circle reach within which it can pre-process a contract's traffic. A
 * contract counts as IN-FOOTPRINT when its region centroid falls within this angle of the DC's
 * sub-point. Sized to roughly a continental region (a DC serves a region, not the globe).
 * Placeholder (≈ a 30° cap). */
export const DC_FOOTPRINT_RADIUS_RAD = 30.0 * (Math.PI / 180.0);

/** € capex to place one orbital datacenter — a MEANINGFUL strategic cost (GDD §4.5: DCs are
 * "heavy payloads … satisfying multi-launch construction projects"). Dear enough that a DC is
 * a deliberate, sparse investment (a handful at most matter, §4.5), not loose change like a
 * ground station. Placeholder; dwarfs a launch (~€1800) so it reads as a capex spine. */
export const DC_CAPEX_EUR = 6000.0;

// --- The DC node ------------------------------------------------------------

/** How a DC's panels are oriented for the flux read. M3a uses BODY distance from the Sun
 * (a DC at/around a body sees that body's heliocentric distance) — orbit-phase shadowing is
 * deferred. The enum keeps the door open for an eclipse-fraction model without reshaping. */
export type DCSite = "earth" | "moon" | "mars";

/**
 * A placed orbital datacenter: a strategic compute node parked at/around a body, with the
 * §4.5 physical levers as real dimensions. PURE data (bit-stable) so it folds into the M2
 * snapshot/state-hash and replays. The compute it can deliver is a pure function of (this,
 * the body's heliocentric distance at t).
 */
export interface Datacenter {
  /** Stable id (`dc0`, `dc1` … — a monotonic counter, never an RNG draw). */
  id: string;
  /** The body the DC orbits / co-locates with (drives its distance from the Sun → flux). */
  bodyId: DCSite;
  /** The DC's SUB-POINT on its body (radians) — the region it is stationed over. Its edge-
   * compute footprint is a great-circle cap of {@link DC_FOOTPRINT_RADIUS_RAD} around this, so
   * a DC over one region lifts THAT region's contracts, not the whole globe — placement is a
   * real strategic choice (GDD §4.5 force-multiplier on a chosen part of the loop). */
  subLatRad: number;
  subLonRad: number;
  /** Solar panel area (m²) — the POWER lever. Bigger panels = more solar power (∝ 1/d²). */
  panelM2: number;
  /** Radiator area (m²) — the COOLING lever. Bigger radiators = more rejectable heat =
   * higher thermal compute ceiling. The radiative-only sink (GDD §4.5). */
  radiatorM2: number;
  /** Whether this DC also carries an RTG (a constant {@link RTG_POWER_W} floor, distance-
   * independent — the nuclear lever for the power-starved outer system). */
  rtg: boolean;
}

/** The resolved power/thermal/compute readout of a DC at a sim-time (pure derived state).
 * This is what the readout panel + the force-multiplier wiring read. */
export interface DCCompute {
  /** Heliocentric distance of the DC's body (AU) — drives the solar flux. */
  distanceAU: number;
  /** Solar flux at the DC relative to 1 AU (1.0 at Earth, ~0.43 at Mars) = 1/d². */
  fluxFraction: number;
  /** Usable electrical power from solar panels (W) = flux × panelM2 × PANEL_W_PER_M2_AT_1AU. */
  solarPowerW: number;
  /** Usable electrical power from the RTG (W) — 0 when no RTG, else {@link RTG_POWER_W}. */
  rtgPowerW: number;
  /** Total usable power (W) = solar + RTG. */
  powerW: number;
  /** Rejectable heat (W) = radiatorM2 × RADIATOR_W_PER_M2 — the thermal rejection cap. */
  rejectableHeatW: number;
  /** Compute the POWER ceiling alone would allow (units) = powerW / COMPUTE_W_PER_UNIT. */
  powerLimitedCompute: number;
  /** Compute the THERMAL ceiling alone would allow (units) = rejectableHeatW / THERMAL_W_PER_UNIT. */
  thermalLimitedCompute: number;
  /** USABLE compute budget (units) = min(power-limited, thermal-limited) — both ceilings bite. */
  computeUnits: number;
  /** True iff the THERMAL ceiling is the binding one (compute is thermally throttled). */
  thermalLimited: boolean;
}

/** AU distance of a body from the Sun at sim-time t (the Sun is the ephemeris origin, so a
 * body's heliocentric distance is the magnitude of its position). Pure. Falls back to the
 * body's own mean orbit when it is a satellite of a planet (e.g. the Moon's distance ≈ Earth's
 * — we read the body's absolute position, which already composes the parent hierarchy). */
export function bodyDistanceAU(eph: Ephemeris, bodyId: string, t: number): number {
  const p: Vec3 = eph.position(bodyId, t);
  const m = Math.sqrt(p[0] * p[0] + p[1] * p[1] + p[2] * p[2]);
  return m / AU_M;
}

/**
 * Resolve a DC's full power/thermal/compute state at sim-time t (PURE function of the DC +
 * the body's heliocentric geometry). This is the heart of the §4.5 model:
 *
 *   POWER  = solarFlux(1/d²) × panelArea × PANEL_W_PER_M2_AT_1AU  (+ RTG if fitted)
 *   THERMAL (reject cap) = radiatorArea × RADIATOR_W_PER_M2
 *   COMPUTE = min(power / COMPUTE_W_PER_UNIT, rejectableHeat / THERMAL_W_PER_UNIT)
 *
 * so a DC near the Sun is power-rich (small panels suffice) but its radiators still cap it,
 * and a DC far out is power-starved (its panels deliver little) unless it carries an RTG.
 */
export function resolveDCCompute(eph: Ephemeris, dc: Datacenter, t: number): DCCompute {
  const distanceAU = Math.max(1e-6, bodyDistanceAU(eph, dc.bodyId, t));
  const fluxFraction = 1.0 / (distanceAU * distanceAU); // solar flux ∝ 1/d²
  const solarPowerW = fluxFraction * dc.panelM2 * PANEL_W_PER_M2_AT_1AU;
  const rtgPowerW = dc.rtg ? RTG_POWER_W : 0.0;
  const powerW = solarPowerW + rtgPowerW;
  const rejectableHeatW = dc.radiatorM2 * RADIATOR_W_PER_M2;
  const powerLimitedCompute = powerW / COMPUTE_W_PER_UNIT;
  const thermalLimitedCompute = rejectableHeatW / THERMAL_W_PER_UNIT;
  const computeUnits = Math.min(powerLimitedCompute, thermalLimitedCompute);
  return {
    distanceAU,
    fluxFraction,
    solarPowerW,
    rtgPowerW,
    powerW,
    rejectableHeatW,
    powerLimitedCompute,
    thermalLimitedCompute,
    computeUnits,
    thermalLimited: thermalLimitedCompute <= powerLimitedCompute,
  };
}

/**
 * THE FORCE-MULTIPLIER (GDD §4.5 "edge compute: transmit conclusions not bytes" — the core
 * economic justification). The bounded revenue/quality LIFT a DC's compute budget applies to
 * a contract IN ITS FOOTPRINT: a saturating function of available compute, capped at
 * {@link MAX_COMPUTE_LIFT}, with diminishing returns past {@link COMPUTE_LIFT_HALF_UNITS}.
 *
 *   lift = MAX_COMPUTE_LIFT × compute / (compute + COMPUTE_LIFT_HALF_UNITS)   ∈ [0, MAX)
 *
 * Returns a MULTIPLIER ≥ 1.0 (1.0 = no DC compute; up to 1 + MAX_COMPUTE_LIFT at saturation).
 * The cap + diminishing returns are the Risk-5 discipline: more compute always helps a little
 * but NEVER runs away — a force-multiplier with a ceiling, not a base-builder payoff curve.
 */
export function computeLiftMultiplier(computeUnits: number): number {
  const c = Math.max(0, computeUnits);
  const lift = (MAX_COMPUTE_LIFT * c) / (c + COMPUTE_LIFT_HALF_UNITS);
  return 1.0 + lift;
}
