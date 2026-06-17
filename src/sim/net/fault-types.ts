/**
 * net/ — ACT 3b SHARED FAULT TYPES (design §5 / the act3-act4 design C2.1 + C2.5).
 *
 * The ONE concept of Act 3b: *"And faults degrade it."* A working network does not stay
 * working — and faults are FENCED structurally behind the act3a re-tame gate (they begin
 * only after re-stabilisation, "because faults on an unstable network would just be
 * noise"). This module is the PURE SHARED TYPE SURFACE so {@link import("./fault").rollFaults}
 * (the seeded generator) and {@link import("./trace").diagnose} (the self-diagnosing view)
 * can be built in PARALLEL: BOTH import from here, NEITHER imports the other.
 *
 * --- WHAT LIVES HERE (and what does NOT) -----------------------------------------
 * Pure DATA SHAPES + tiny PURE helpers/constants ONLY. NO session, NO router-impl import
 * (a TYPE import of {@link SolveResult}/{@link LinkLossStamp} from router + {@link LinkCause}
 * from link-budget is fine — types erase at compile, no runtime edge). NO RNG draw here:
 * the seeded splitmix64 stream lives on the {@link import("./session").NetSession}, and the
 * fault roll (the M2 launch-failure-roll pattern, `rng.nextDouble() < rate·dt`) happens in
 * fault.ts off that stream — this module only describes the SHAPES + the rate ALGEBRA the
 * roll consumes, so it never needs an rng and stays trivially replay-safe.
 *
 * --- THE TWO LOCKED MECHANICS (design §5.2) --------------------------------------
 *   - CAUSAL: a per-sat probability RAISED by overclock / cheap-bus / low-orbit / age. M1
 *     has one bus (`smallsat`) + no overclock UI, so those two hooks are PRESENT-BUT-NEUTRAL
 *     (multiplier 1.0); the LIVE levers this hour are LOW-ORBIT (a LEO faults more than a GEO —
 *     bridges to decay, rewards redundancy) and AGE (`ageS = t − sat.orbit.epochS`, the REAL
 *     field path — `NetSat.orbit: SatOrbit`).
 *   - RARE-RANDOM: an irreducible floor added to EVERY sat regardless of choices.
 * HARD random failure stays vanishingly rare / effectively OFF this hour (in the enum so M2
 * turns it up without a reshape).
 *
 * --- MILD-FIRST, FAIR (design §5.1, the act3b emit's scripted pair) --------------
 * The first two faults are AUTHORED (a {@link FaultScript} queue the act3b emit seeds): (1) a
 * Degradation (recoverable, self-recovers, UNWARNED — teaches headroom; bites whoever cut
 * oversubscription too thin in 3a), then (2) a Telegraphed failure (warning + countdown —
 * teaches watch-and-act; the redundant builder sails through, the brittle one scrambles). The
 * stochastic causal + rare-random stream runs underneath as the irreducible floor thereafter.
 *
 * PURE: no three / DOM / wall-clock / unseeded-random. Minimal + stable.
 *
 * @see docs/signal-horizon-m1.md Part III (ACT 3, fault.ts/trace.ts/3b portions).
 * @see docs/signal-horizon-m1.md Part IV (Act 3, sub-beat 3B).
 */

import type { NetSat } from "./sat";
// TYPE-ONLY imports (erase at compile — no runtime edge to the router/link-budget impl).
import type { SolveResult, LinkLossStamp, RouterAxis } from "./router";
import type { LinkCause } from "./link-budget";
// VALUE import (P2): the TOY GEO-class semi-major axis the low-orbit lever's reference TRACKS, so the
// toy GEO sits at the neutral end + the toy LEO sits meaningfully below it (world.ts does NOT import
// fault-types — no cycle). Pure constant (no three / DOM / rng).
import { A1_GEO_SEMI_MAJOR_M } from "./world";

// ── THE FAULT KIND (the mild-first spectrum, design §5.1) ─────────────────────────

/**
 * The fault spectrum, mild-first. LOCKED by the act3b brief:
 *   - "degradation" — a capacity HAIRCUT (the sat still routes; a {@link FaultState.degradedCapacityFactor}
 *     in (0,1) scales its link capacity). Recoverable + self-recovering + UNWARNED (no countdown).
 *   - "transient"   — a brief full OUTAGE (the sat drops from the graph) that self-recovers. Unwarned.
 *   - "telegraphed" — a WARNED failure: a countdown (`failsAtS`) the trace surfaces; the sat drops
 *     when the countdown expires (watch-and-act — the redundant builder sails, the brittle scrambles).
 *   - "hard"        — a permanent failure (the sat never recovers). Vanishingly rare / effectively OFF
 *     this hour; present so M2 turns it up without a reshape.
 */
export type FaultKind = "degradation" | "transient" | "telegraphed" | "hard";

/** Fault kinds whose ACTIVE phase REMOVES the sat from the routing graph (a topology change,
 * fed through the router's existing `faults?: ReadonlySet<string>` param). A "degradation" is
 * NOT here — it is a capacity haircut, NOT a removal (the sat still routes). The session reads
 * this to build the down-sat set vs the degraded-capacity map. Pure constant. */
export const FAULT_REMOVES_SAT: Readonly<Record<FaultKind, boolean>> = {
  degradation: false,
  transient: true,
  telegraphed: true, // removes the sat ONLY after the countdown expires (see FaultState.failsAtS).
  hard: true,
} as const;

// ── THE CAUSAL LEVER (design §5.2) ────────────────────────────────────────────────

/**
 * Why a fault's CAUSAL probability was raised (the geometric/lifecycle lever it lives on), or
 * "rareRandom" for the irreducible floor. Stamped onto a {@link FaultState} so the trace can
 * name the cause — the PREDICTABILITY SEED at the fault level (alongside the per-loss
 * {@link LinkLossStamp} geometric cause). The two LIVE levers this hour are `lowOrbit` + `age`;
 * `overclock`/`cheapBus` are present-but-neutral (M1 has no overclock UI + one bus).
 */
export type FaultCause = "lowOrbit" | "age" | "overclock" | "cheapBus" | "rareRandom";

/**
 * The pure INPUTS the causal-rate algebra reads off ONE sat at sim-time t (no rng, no session).
 * fault.ts builds this per sat each roll; {@link causalFaultRatePerS} maps it to a rate.
 *   - `altitudeM` / `lowOrbitRefM` — the LOW-ORBIT lever: a lower orbit faults more (a LEO ≫ a GEO).
 *   - `ageS` — the AGE lever: `t − sat.orbit.epochS` (the REAL field path, design LOW fix).
 *   - `overclocked` / `cheapBus` — the present-but-neutral hooks (false / false in M1).
 */
export interface CausalFaultInput {
  /** The sat's orbital semi-major axis (metres) — the low-orbit lever's magnitude. */
  altitudeM: number;
  /** Seconds since the sat reached orbit: `t − sat.orbit.epochS` (the age lever). */
  ageS: number;
  /** Present-but-neutral M1 hook: an overclocked bus faults more (always false this hour). */
  overclocked: boolean;
  /** Present-but-neutral M1 hook: a cheap bus faults more (M1 has one bus ⇒ always false). */
  cheapBus: boolean;
}

// ── THE FAULT STATE (per-sat, folded; design C2.1) ────────────────────────────────

/**
 * One ACTIVE fault on one sat (the session folds an array of these into the net golden via
 * `satId | kind | the three sim-times as bit-stable f64s` + the {@link FaultCause}). Derived in
 * session.step off the seeded stream — NOT a stored action.
 *
 * The three sim-times are the §2.4 PREDICTABILITY SEED at the fault level: a degradation/transient
 * RECOVERS at `recoversAtS`; a telegraphed failure WILL fail at `failsAtS` (the trace countdown);
 * a hard failure never recovers (`recoversAtS = Infinity`). Whichever a kind does not use is set to
 * Infinity so the shapes stay uniform + bit-stable in the fold.
 */
export interface FaultState {
  /** The sat this fault is on (the router's `faults?` set + the degraded-capacity map key). */
  satId: string;
  /** Which fault is active. */
  kind: FaultKind;
  /** The causal lever (or "rareRandom") this fault was drawn on — the trace names it. */
  cause: FaultCause;
  /** Sim-time the fault began (the trace renders "since"; folded f64). */
  startedAtS: number;
  /** DEGRADATION ONLY: the capacity MULTIPLIER in (0,1] applied to the sat's link capacity while
   * active (1.0 ⇒ no haircut; e.g. 0.5 ⇒ half capacity). For non-degradation kinds this is 1.0
   * (the sat is removed wholesale via {@link FAULT_REMOVES_SAT}, not haircut). Folded f64. */
  degradedCapacityFactor: number;
  /** TELEGRAPHED ONLY: the sim-time the sat WILL fail (the trace countdown is `failsAtS − t`).
   * Infinity for every other kind. Folded f64. */
  failsAtS: number;
  /** DEGRADATION / TRANSIENT: the sim-time the sat self-RECOVERS. Infinity for hard (never
   * recovers) and for telegraphed (it fails, it does not recover). Folded f64. */
  recoversAtS: number;
}

// ── THE FAULT EVENT + THE ROLL INPUT (the seam fault.ts exposes to the session) ───

/**
 * What fault.ts's roll RETURNS for one step: the NEW faults that fired this step + the satIds
 * whose active fault RESOLVED (a degradation/transient recovered, or a telegraphed countdown
 * expired into a drop) so the session can clear them. Both lists are deterministic functions of
 * (the seeded stream, the live roster, t, dt, the scripted queue). The session folds the
 * resulting {@link FaultState}[] — this event is the per-step delta, not folded itself.
 */
export interface FaultRollResult {
  /** Faults that newly became active this step (scripted-first, then stochastic). */
  started: FaultState[];
  /** SatIds whose active fault RESOLVED this step (recovered, or a telegraphed drop fired). */
  resolved: string[];
}

/**
 * A scripted AUTHORED fault the act3b emit seeds into the roll's queue (the mild-first pair:
 * a Degradation, then a Telegraphed failure — design §5.1 rows 1 + 3). The scripted pair still
 * DRAWS from the same seeded stream (advancing it deterministically) so fold + replay stay
 * bit-stable; this only pins the KIND + the target sat selector, never a random outcome.
 *
 * `targetSatId` null ⇒ the roll picks a deterministic target (e.g. a live LEO) off the roster +
 * the seeded stream; a concrete id pins it. The session injects these in order; the stochastic
 * causal + rare-random stream runs underneath as the irreducible floor.
 */
export interface FaultScript {
  /** The authored kind (mild-first: "degradation" then "telegraphed"). */
  kind: FaultKind;
  /** The sat to fault, or null to let the roll pick a deterministic target off the roster. */
  targetSatId: string | null;
  /** The cause to STAMP on the scripted fault (the trace names it; defaults to the live lever
   * that best fits — e.g. "lowOrbit" for a LEO degradation). */
  cause: FaultCause;
}

// ── THE TRACE SHORTFALL (the self-diagnosing view; design C2.5 / §7.4) ────────────

/**
 * The DISCRIMINATED kind-of-fix a trace shortfall points at (design §7.4 + §3a optimizer pull).
 * NOT the same as the SLA {@link RouterAxis}: a shortfall is about the FIX, not the failing axis.
 *   - "addCoveringSat"   — connectivity: no path; launch a covering sat.
 *   - "addPhasedSat"     — availability: a gap each orbit; add a phased sat in this plane.
 *   - "shorterRoute"     — latency: the latency floor is too high; a shorter LEO/relay route cuts it.
 *   - "addParallelPath"  — bandwidth: a trunk is saturated by N shared contracts; add a parallel path.
 *   - "shareIdleCapacity"— OVERPROVISION (waste): a sat runs far under capacity while another breaches.
 *   - "addRedundantPath" — SPOF (risk): a served region has no redundant bridge; one fault drops it.
 */
export type ShortfallFixKind =
  | "addCoveringSat"
  | "addPhasedSat"
  | "shorterRoute"
  | "addParallelPath"
  | "shareIdleCapacity"
  | "addRedundantPath";

/**
 * The PREDICTABILITY-SEED loss stamp the trace renders (design §7.5 REQUIRED): "link [aId]↔[bId]
 * lost: [cause] at [atS]." ALIGNED with the router's {@link LinkLossStamp} (same field names +
 * the same `cause: Exclude<LinkCause,"ok">` geometric vocabulary) so the trace consumes a
 * `SolveResult.losses` entry verbatim with NO adapter. Declared here (not re-imported as the
 * router's own) so trace.ts gets the shape from the shared types module; structurally identical
 * to {@link LinkLossStamp} (a compile-time check below pins that alignment). */
export interface LossStamp {
  aId: string;
  bId: string;
  cause: Exclude<LinkCause, "ok">;
  atS: number;
}

/**
 * One shortfall the trace surfaces — a binding-constraint readout OR an optimisation/resilience
 * shortfall (the §3a optimizer pull, the act3b gate's layer-1 target). Owns/extends the scenario
 * {@link import("./scenario").Shortfall} shape (subjectId + a human message) and ADDS the
 * discriminated {@link kindOfFix} + the optional {@link bindingConstraint} (for the SLA-binding
 * face) + the optional {@link losses} (the predictability-seed stamps for this subject). Pure data.
 */
export interface TraceShortfall {
  /** The contract/region/sat the shortfall is about (the thing not optimal / at risk). */
  subjectId: string;
  /** A human-readable, point-at-the-fix message (never does it for the player). */
  message: string;
  /** The discriminated kind-of-fix (drives the UI affordance + the assist). */
  kindOfFix: ShortfallFixKind;
  /** The failing SLA axis when this shortfall is a binding-constraint readout; null/absent for a
   * pure optimisation/resilience shortfall (overprovision / SPOF have no failing axis). */
  bindingConstraint?: RouterAxis | null;
  /** The predictability-seed loss stamps relevant to this subject (the §7.5 geometric cause +
   * time). Empty when none. Aligned with {@link LinkLossStamp}. */
  losses?: LossStamp[];
}

/**
 * The full trace report for one step (the single legibility surface — §2.6 / §5.3, ONE system,
 * double duty): the optimisation/resilience + binding-constraint {@link TraceShortfall}s, the
 * active {@link FaultState}s (the SYSTEM.LOG face), and the flat predictability-seed loss roll
 * (every `SolveResult.losses` stamp this step). Returned by trace.ts's `diagnose`; a DERIVED
 * readout, NOT folded (only the booleans the session sets from it — `surfacedShortfall` — fold). */
export interface TraceReport {
  /** The surfaced shortfalls (binding-constraint + optimisation/resilience). */
  shortfalls: TraceShortfall[];
  /** The active faults this step (degradation amber pulse / telegraphed countdown lines). */
  faults: FaultState[];
  /** Every predictability-seed loss stamp surfaced this step (the §7.5 cause + time roll). */
  losses: LossStamp[];
}

// ── TUNING CONSTANTS (PLAYTEST KNOBS — placeholders on the per-second rate scale) ─

/**
 * The irreducible RARE-RANDOM fault rate per sim-second, added to EVERY sat regardless of its
 * orbit / age / choices (design §5.2). Kept VANISHINGLY small so a hard random failure is
 * effectively OFF this hour — the scripted mild-first pair + the causal lever carry the beat.
 * Placeholder. */
export const RARE_RANDOM_FAULT_RATE_PER_S = 1e-6;

/** The BASE causal fault rate per sim-second a fresh GEO sat carries before any lever raises it
 * (the floor the multipliers scale). Placeholder on the per-second scale. */
export const CAUSAL_BASE_FAULT_RATE_PER_S = 1e-5;

/** The reference semi-major axis (metres) the LOW-ORBIT lever is measured against: a sat at or
 * above this (the TOY GEO-class orbit) gets the neutral multiplier 1.0; a lower orbit (the toy LEO)
 * scales UP toward {@link LOW_ORBIT_MAX_MULTIPLIER} as `altitudeM` drops.
 *
 * --- TOY-SCALED (P2, audit §5.2) -------------------------------------------------
 * This was a REAL-Earth GEO radius (~42,160 km) while the toy world orbits at ~610-834 km against
 * a 300 km body — so the toy GEO and the toy LEO BOTH saturated near {@link LOW_ORBIT_MAX_MULTIPLIER}
 * (7.86× vs 7.90×, a ~0.5% gap) and "a LEO faults more than a GEO" did NOT register. We re-scale the
 * reference to the toy world's TOY GEO semi-major axis ({@link A1_GEO_SEMI_MAJOR_M} ≈ 834 km from the
 * toy 300 km body + the 240 s GEO period) so the toy GEO sits AT the neutral end (multiplier 1.0)
 * and the toy LEO (≈ 610 km, the 150 s period) sits MEANINGFULLY below it — a clear causal gap
 * (the toy LEO faults a measurable multiple more than the toy GEO). TUNABLE: raise this above the
 * toy GEO to push the GEO itself onto the ramp, or lower it to widen the LEO/GEO gap. Imported from
 * world.ts so the reference TRACKS the toy GEO (no second hard-coded constant to drift). */
export const LOW_ORBIT_REF_M = A1_GEO_SEMI_MAJOR_M; // the TOY GEO-class semi-major axis (P2 re-scale).

/** The MAX low-orbit multiplier a deep LEO reaches (the lowest practical orbit faults this many
 * times the GEO base — "a LEO faults more than a GEO," bridges to decay, rewards redundancy).
 * Placeholder. */
export const LOW_ORBIT_MAX_MULTIPLIER = 8.0;

/** The AGE multiplier gained per sim-second of orbit age (linear ramp: an older sat faults more).
 * Tiny so the ramp is felt over a sitting, not a tick. Placeholder (per-second). */
export const AGE_MULTIPLIER_PER_S = 1e-4;

/** The present-but-neutral OVERCLOCK multiplier hook (M1 has no overclock UI ⇒ never applied;
 * 1.0 keeps it neutral; M2 raises it). */
export const OVERCLOCK_MULTIPLIER = 1.0;

/** The present-but-neutral CHEAP-BUS multiplier hook (M1 has one bus ⇒ never applied; 1.0 keeps
 * it neutral; M2 raises it). */
export const CHEAP_BUS_MULTIPLIER = 1.0;

/** The capacity HAIRCUT a degradation applies while active (the {@link FaultState.degradedCapacityFactor}
 * the scripted degradation stamps): the sat still routes but its link capacity is scaled by this
 * — biting a contract that cut oversubscription thin in 3a, barely felt with headroom. Placeholder
 * in (0,1). */
export const DEGRADATION_CAPACITY_FACTOR = 0.5;

/** How long a degradation lasts before self-recovering (sim-seconds): `recoversAtS = startedAtS +
 * this`. Short enough to be a "briefly underperforms, then recovers" pulse for the toy day.
 * Placeholder. */
export const DEGRADATION_DURATION_S = 30.0;

/** How long a transient outage lasts before self-recovering (sim-seconds). Placeholder. */
export const TRANSIENT_DURATION_S = 15.0;

/** The telegraphed COUNTDOWN (sim-seconds): the warning lead time between a telegraphed fault
 * appearing and the sat dropping (`failsAtS = startedAtS + this`) — long enough that a player who
 * watches the trace can launch a replacement or re-route proactively. Placeholder. */
export const TELEGRAPHED_COUNTDOWN_S = 45.0;

// ── TINY PURE HELPERS (no rng, no session, no router-impl) ────────────────────────

/**
 * The CAUSAL fault rate per sim-second for one sat (design §5.2). Composes the base rate with the
 * LIVE levers (low-orbit + age) and the present-but-neutral hooks (overclock + cheap-bus, both 1.0
 * in M1). Pure: a deterministic function of the {@link CausalFaultInput} — NO rng (the Bernoulli
 * draw `rng.nextDouble() < rate·dt` happens in fault.ts off the session stream). The rare-random
 * floor is ADDED separately by the caller ({@link RARE_RANDOM_FAULT_RATE_PER_S}); this is the
 * CAUSAL part only, so a test can pin the levers in isolation.
 */
export function causalFaultRatePerS(input: CausalFaultInput): number {
  const lowOrbit = lowOrbitMultiplier(input.altitudeM);
  const age = 1.0 + Math.max(0, input.ageS) * AGE_MULTIPLIER_PER_S;
  const overclock = input.overclocked ? OVERCLOCK_MULTIPLIER : 1.0;
  const cheapBus = input.cheapBus ? CHEAP_BUS_MULTIPLIER : 1.0;
  return CAUSAL_BASE_FAULT_RATE_PER_S * lowOrbit * age * overclock * cheapBus;
}

/**
 * The LOW-ORBIT multiplier for a semi-major axis (metres): 1.0 at/above {@link LOW_ORBIT_REF_M}
 * (a GEO-ish orbit, neutral), ramping linearly up to {@link LOW_ORBIT_MAX_MULTIPLIER} as the
 * altitude drops toward the body surface (a deep LEO faults most). Pure + bounded (clamped to
 * [1, max] so a degenerate/zero altitude never explodes the rate).
 */
export function lowOrbitMultiplier(altitudeM: number): number {
  if (!(altitudeM > 0) || altitudeM >= LOW_ORBIT_REF_M) return 1.0;
  // Linear in the fraction BELOW the reference: frac=0 at the reference (mult 1), frac→1 at the
  // surface (mult → max). A monotone, bounded, rng-free ramp.
  const frac = (LOW_ORBIT_REF_M - altitudeM) / LOW_ORBIT_REF_M;
  const clampedFrac = Math.max(0, Math.min(1, frac));
  return 1.0 + clampedFrac * (LOW_ORBIT_MAX_MULTIPLIER - 1.0);
}

/**
 * Build the pure {@link CausalFaultInput} for a sat at sim-time t — the REAL field path the design
 * LOW fix pins: `ageS = t − sat.orbit.epochS` (NetSat.orbit: SatOrbit) and `altitudeM = orbit.aM`.
 * The neutral hooks are false in M1 (one bus, no overclock UI). Pure; reads the sat by type only.
 */
export function causalInputForSat(sat: NetSat, t: number): CausalFaultInput {
  return {
    altitudeM: sat.orbit.aM,
    ageS: t - sat.orbit.epochS,
    overclocked: false,
    cheapBus: false,
  };
}

/**
 * True iff an active fault is RESOLVED at sim-time t (a degradation/transient reached its
 * `recoversAtS`, or a telegraphed fault reached its `failsAtS` — at which point the sat DROPS).
 * Pure time predicate. (A hard fault never resolves — both times are Infinity.)
 *
 * NOTE (P2): "resolved" here means the fault's lifetime has ENDED — but the two end-states are
 * DIFFERENT consequences (the audit §5.1 fix): a degradation/transient SELF-RECOVERS (the sat comes
 * back — {@link faultSelfRecoveredAt}), whereas a TELEGRAPHED fault that reaches `failsAtS` DROPS the
 * sat PERMANENTLY (it does not come back — a warned hard failure). The session keeps the telegraphed-
 * expired fault ACTIVE (so the sat stays removed from the graph via {@link faultRemovesSatAt}) and
 * clears ONLY the self-recovered ones — so callers that "free the sat" must use the narrower
 * {@link faultSelfRecoveredAt}, not this. */
export function faultResolvedAt(fault: FaultState, t: number): boolean {
  return t >= fault.recoversAtS || t >= fault.failsAtS;
}

/**
 * True iff an active fault has SELF-RECOVERED at sim-time t — a degradation/transient that reached
 * its `recoversAtS` and whose sat comes BACK (the §5.1 self-healing end-state). This is NARROWER
 * than {@link faultResolvedAt}: a TELEGRAPHED fault reaching `failsAtS` is NOT a self-recovery — its
 * sat dies PERMANENTLY (the warned hard failure the P2 fix makes real), so it is excluded here. The
 * roll uses THIS (not faultResolvedAt) to decide which faults to clear from the active map; a
 * telegraphed-expired fault stays active as a permanent drop. (A hard fault never self-recovers.)
 * Pure. */
export function faultSelfRecoveredAt(fault: FaultState, t: number): boolean {
  return t >= fault.recoversAtS; // degradation/transient only; telegraphed/hard have recoversAtS = Infinity.
}

/**
 * True iff a TELEGRAPHED fault's countdown has expired at sim-time t — i.e. the sat now DROPS from
 * the graph (before this, a telegraphed sat still routes; the trace shows the countdown). For
 * non-telegraphed kinds this is whether the kind removes the sat at all (see {@link FAULT_REMOVES_SAT}).
 * Pure. */
export function faultRemovesSatAt(fault: FaultState, t: number): boolean {
  if (fault.kind === "telegraphed") return t >= fault.failsAtS;
  return FAULT_REMOVES_SAT[fault.kind];
}

/**
 * The telegraphed COUNTDOWN remaining (sim-seconds) at t — the trace's "fails in {n}" readout.
 * 0 once expired; Infinity for a non-telegraphed kind (no countdown). Pure. */
export function telegraphedCountdownRemainingS(fault: FaultState, t: number): number {
  if (fault.kind !== "telegraphed") return Infinity;
  return Math.max(0, fault.failsAtS - t);
}

// ── COMPILE-TIME ALIGNMENT PINS (no runtime cost; keep the shapes stable) ─────────

/**
 * Pin {@link LossStamp} structurally to the router's {@link LinkLossStamp}: a SolveResult.losses
 * entry must be assignable to a trace LossStamp with NO adapter (and vice-versa). These are
 * type-level identity assertions — they erase at compile and add zero runtime; if either shape
 * drifts, tsc fails here (the brief's "reusing/aligned with router LinkLossStamp"). */
type _LossStampMatchesRouter = LinkLossStamp extends LossStamp ? true : never;
type _RouterMatchesLossStamp = LossStamp extends LinkLossStamp ? true : never;
const _LOSS_STAMP_ALIGNED: _LossStampMatchesRouter & _RouterMatchesLossStamp = true;
void _LOSS_STAMP_ALIGNED;

/**
 * Pin that a {@link SolveResult} surfaces the `losses`/`bindingConstraint` the trace reads, so
 * trace.ts can consume a SolveResult through these shared types without re-deriving them. A
 * type-level read — erases at compile. */
type _SolveResultHasLosses = SolveResult["losses"] extends LinkLossStamp[] ? true : never;
const _SOLVE_RESULT_SHAPE: _SolveResultHasLosses = true;
void _SOLVE_RESULT_SHAPE;
