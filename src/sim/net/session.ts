/**
 * net/ — THE NET SESSION (design §2.2 / §4): the live mutable world of the network game,
 * the connectivity sibling of {@link import("../m2/session").BuildSession}. A PURE,
 * deterministic, SAVEABLE state: the launched-sat roster + the region-disc contracts + a
 * € wallet + a SEEDED splitmix64 RNG + a scenario cursor. It owns NO render concern; the
 * render layer reads a {@link NetSnapshot}.
 *
 * --- THE SHARED STATE MACHINE (design §2.2 — the reuse decision) -----------------
 * The contract is a net/ fresh region-disc struct ({@link Contract}), but its serve/breach
 * advance is the SAME state machine the m2 build session uses: this file IMPORTS the m2
 * transition helpers {@link stepActiveContract} / {@link stepOfferedContract} and the single
 * {@link BREACH_GRACE_SECONDS} from m2/contracts.ts. There is ONE breach convention in the
 * codebase, two demand geometries — net/ computes the scalar servedFraction from the ROUTER
 * (path-existence over the spinning frame) instead of from m2's grid-cell coverage, then
 * passes it into the IMPORTED `stepActiveContract(contract, servedFraction, dt)`.
 *
 * --- THE PER-TICK LOOP (step) ----------------------------------------------------
 * Each tick `step(eph, t, dt)`:
 *   1. for each contract, run the §2.4 re-solve split ({@link resolveTick}) to get the
 *      current SolveResult cheaply (cached path re-eval; full search only on a topology
 *      change or a horizon rise/set);
 *   2. derive the scalar servedFraction (Act 1: 1.0 if served else 0.0 — the binary axis);
 *   3. accrue payPerSecond×fraction×dt (or −penalty×dt when wholly unserved) — SUMMED into
 *      ONE wallet add per step, so revenue is DT-INVARIANT (same sim-time ⇒ same €);
 *   4. advance the contract state machine via the IMPORTED stepActiveContract /
 *      stepOfferedContract + the IMPORTED grace.
 * Mirrors BuildSession.step's "one summed apply for DT-invariance" shape.
 *
 * PURE: no three / DOM / wall-clock. The ONLY randomness is the seeded {@link SimRng}
 * (faults will draw from it in Act 3b; absent here). The wallet is a plain number (net/
 * imports NEITHER m1/ NOR m2/session.ts — only the axis-agnostic m2/contracts helpers).
 *
 * @see docs/signal-horizon-m1.md Part II §2.2 (session + reuse), §4 (determinism/fold), §5.
 */

import type { Ephemeris } from "../ephemeris";
import { SimRng } from "../rng";
import {
  stepActiveContract as m2StepActiveContract,
  stepOfferedContract as m2StepOfferedContract,
  type ContractState,
} from "../m2/contracts";
import type { NetSat } from "./sat";
import { BUS_SPECS } from "./sat";
import { type BeamMap, validateBeamAssign, pipeKey, parsePipeKey } from "./beams";
import { type GroundNet, NET_ACT1_GROUND, NET_ACT2_GROUND, NET_ACT4_RELAY_ID_STEM } from "./endpoint";
import {
  type Contract,
  type SlaAxis,
  SLA_AXIS_ORDINAL,
  renewalOffer,
  netRevenueRatePerSecond,
  recordNetEarned,
  cloneNetContract,
  escalateLoad,
  burstyOfferedLoad,
  ESCALATION_SERVE_THRESHOLD,
  ESCALATION_BANDWIDTH_AXIS_THRESHOLD,
} from "./contract";
import { NET_LINK_CAPACITY_UNITS } from "./link-budget";
import { rollNetLaunch } from "./world";
import { BREACH_GRACE_SECONDS as NET_BREACH_GRACE_SECONDS } from "../m2/contracts";
import {
  type SolveResult,
  type RouterState,
  resolveTick,
  pipeCapacityOf,
} from "./router";
import { windowAvailability } from "./availability";
import { freshness } from "../delay";
import { interBodyOneWayLatencyS } from "./link-budget";
import { ACT4_MARS_CONTRACT_ID } from "./endpoint";
import { M1_SCENARIO, type Beat, type Shortfall } from "./scenario";
import { rollFaults } from "./fault";
import {
  type FaultState,
  type FaultScript,
  type TraceReport,
  faultRemovesSatAt,
} from "./fault-types";
import { diagnose, type ContractSolve } from "./trace";

/** The re-exported grace, so a caller (and the A2 test) can assert net/ uses the SHARED
 * m2 constant — there is NO net/ copy of the breach grace. */
export { BREACH_GRACE_SECONDS } from "../m2/contracts";

/**
 * THE SHARED-STATE-MACHINE LENS (design §2.2). The m2 serve/breach helpers are typed against
 * the m2 grid-cell Contract, but they are AXIS-AGNOSTIC: they only read/write the state-machine
 * fields below (a scalar servedFraction + dt advance — they never touch grid cells). This lens
 * is exactly the field subset each helper touches, and the net {@link Contract} has every one of
 * them (same names), so a net contract is a structural supertype of the lens. We bind the
 * imported helpers to lens-typed references ONCE here — the only adapter between the two demand
 * geometries — so net/session calls the IMPORTED transitions (not a net/ copy): ONE breach
 * convention, two geometries. (The cast is a function-type narrowing the helpers' grid fields
 * out; it is sound because they are never dereferenced for a scalar-fraction advance.)
 */
interface SharedStateMachineContract {
  state: ContractState;
  offerExpiresAtS: number;
  termSeconds: number;
  servedSecondsAccum: number;
  breachSecondsAccum: number;
  lastServedFraction: number;
}

/** Advance an ACTIVE contract via the IMPORTED m2 transition (servedFraction, dt). */
const stepActiveContract = m2StepActiveContract as unknown as (
  c: SharedStateMachineContract,
  servedFraction: number,
  dtSeconds: number,
) => ContractState | null;

/** Expire a stale OFFER via the IMPORTED m2 transition (nowS). */
const stepOfferedContract = m2StepOfferedContract as unknown as (
  c: SharedStateMachineContract,
  nowS: number,
) => boolean;

/** Opening € for a net session (m1-redesign.md §2.5 — scarcity from minute one): the first
 * full launch stack (T1 bus + BROADCAST card + the GEO lift ≈ €19k) consumes ~half of it, so
 * every early commit is felt. Overspending is ALLOWED (the wallet can dip negative — the
 * build-vs-budget tension), but the theorem holds: no single contract's term revenue pays for
 * its own honest provisioning (economy.test.ts asserts it). TUNABLE. */
export const NET_OPENING_BALANCE = 40000.0;

// ── the launch-event pipeline (m1-redesign.md §2.2 phase 3 — launch as a sim-tick event) ──

/** Countdown from commit to liftoff (sim-seconds). */
export const NET_LAUNCH_COUNTDOWN_S = 4.0;
/** Ascent from liftoff to the deploy window (sim-seconds). */
export const NET_LAUNCH_ASCENT_S = 10.0;
/** Spacing between successive batch-member deploys (sim-seconds). */
export const NET_LAUNCH_DEPLOY_SPACING_S = 1.5;
/** How long a finished launch event lingers for the render layer before pruning (s). */
export const NET_LAUNCH_EVENT_LINGER_S = 8.0;

/** Whole-vehicle loss chance per launch (rare, dramatic; maiden + Act-1 launches are
 * forced-success). TUNABLE. */
export const NET_VEHICLE_LOSS_CHANCE = 0.02;
/** Per-member UNDERBURN chance (the COMMON failure flavor): the sat arrives in a lower
 * orbit and needs a paid circularization burn. TUNABLE. */
export const NET_UNDERBURN_CHANCE = 0.08;
/** Per-member separation-failure chance (the sat never deploys; the hole in YOUR phasing).
 * TUNABLE. */
export const NET_NOSEP_CHANCE = 0.03;
/** The underburn arrival factor: the sat's semi-major axis arrives at this fraction of
 * the intended one until circularized. TUNABLE. */
export const NET_UNDERBURN_FACTOR = 0.82;
/** The circularization burn price (€) — the "fix the underburn" button. TUNABLE. */
export const NET_CIRCULARIZE_COST_EUR = 300.0;

/** One batch member riding a pending launch. JSON-safe; folded. */
export interface PendingMember {
  /** The sat as it will DEPLOY (underburn members carry the lowered orbit). */
  sat: NetSat;
  /** Sim-time this member pops off the vehicle (and, if ok/underburn, joins the roster). */
  deployAtS: number;
  /** The seeded outcome rolled at commit. */
  outcome: "ok" | "no_sep" | "underburn";
  /** The semi-major axis the player AIMED (== sat.orbit.aM unless underburn). */
  intendedAM: number;
  /** Whether the deploy instant has been processed (folded 0/1). */
  deployed: number;
}

/** One in-flight launch event (countdown → ascent → deploys), sim-driven and folded so
 * the render layer can stage the drama off sim truth. */
export interface PendingLaunch {
  id: string;
  committedAtS: number;
  /** committed + countdown. */
  liftoffAtS: number;
  /** Whole-vehicle loss (nothing ever deploys); the render shows the break at lostAtS. */
  lost: number;
  lostAtS: number;
  members: PendingMember[];
}

/** Seed for the net session's splitmix64 RNG (the determinism anchor; faults draw from it
 * in Act 3b — absent in Act 1). Distinct from the m1/m2 anchors. The replay golden (A3)
 * is bootstrapped from this. */
export const NET_RNG_SEED = 4242424242424242n;

/** The QUANTIZATION BUCKET WIDTH (offeredLoad units) the congestion epoch is keyed on (E3): a
 * sat's aggregate shared load is bucketed `floor(load / bucket)`, and the {@link NetSession}'s
 * `congestionEpoch` bumps whenever ANY sat's bucket changes between steps. Folding the QUANTIZED
 * epoch (an int) into the §2.4 topologyKey — never the raw float — forces a re-solve on a
 * meaningful congestion change (the HIGH-2 fix) while a glacial sub-bucket drift preserves the
 * cache (it would otherwise re-solve every tick). Sized a fraction of NET_LINK_CAPACITY_UNITS so
 * the approach-to-capacity is resolved in several buckets. Placeholder. */
export const NET_CONGESTION_BUCKET_UNITS = NET_LINK_CAPACITY_UNITS / 4;

/** The NEAR-BREACH fraction of the shared grace a contract's `breachSecondsAccum` must reach
 * (while escalation is on) to be WITNESSED as having "dipped near-breach under risen load" — the
 * first half of the act3a tame→outgrow→re-tame gate (design §3a / onboarding line 120). A sustained
 * dip to this depth of the grace (then a return to fully SERVED) demonstrates the concept WITHOUT
 * requiring an actual FAILED contract (the full grace). 0.08 of the 600 s grace = 48 s of breach —
 * a real, sustained near-breach the player must re-engineer out of, comfortably below the FAIL
 * threshold so a re-tame is reachable. (R0: sized under the ~54 s continuous bite window the
 * seeded asymmetric-peak squeeze produces on the shared BROADCAST pipe.) PLAYTEST KNOB. */
export const NET_NEAR_BREACH_GRACE_FRACTION = 0.08;

/**
 * ACT 4 (the Mars frontier teaser) — a tiny LOCAL 3-field sample mirroring the m1/cache.ts
 * `CachedSample` SHAPE + its SD-19 honest-staleness CONVENTION (capturedAtT-at-arrival,
 * half-life = the one-way light delay), WITHOUT importing the m1 economy (SD-40 fence: `net/`
 * imports neither `m1/` nor `m2/session.ts`; it imports `delay.ts` directly). The "data arrives
 * old" readout is `age = t − capturedAtT` ("as of Nm ago") + `freshness(age, halfLifeS)` (the
 * reused `delay.ts` curve). This is the WHOLE caching lesson for now — one slot, NOT the
 * multi-slot eviction/prefetch/coherence economy (§8 fenced). */
export interface MarsSample {
  /** The single dataset id ("mars"). */
  datasetId: "mars";
  /** Sim-time the sample was CAPTURED (frozen when the Mars path first carries; reset closer to
   * "now" when the cache breadcrumb is placed — so the freshness readout improves by sight). */
  capturedAtT: number;
  /** The freshness half-life (seconds) = the one-way light delay at capture (SD-19: the sample is
   * one-way old on arrival). A smaller half-life ⇒ it greys faster; the breadcrumb places the
   * sample "closer" (a smaller effective age), raising the displayed freshness. */
  halfLifeS: number;
}

/** JSON-safe capture of the whole net session (save/restore + state-hash parity). */
export interface NetSnapshot {
  /** The launched-sat roster, by value. */
  roster: NetSat[];
  /** The € wallet balance. */
  balance: number;
  /** The splitmix64 RNG state (a u64) — string (JSON has no bigint). */
  rngState: string;
  /** How many sats have been LAUNCHED (drives ids + the constellation phase later). */
  launchedCount: number;
  /** Every contract (offered/active/completed/failed), by value, in offer order. */
  contracts: Contract[];
  /** The scenario cursor (which beat is current) + the recorded gate-tick stamps. */
  scenarioCursor: number;
  gateTicks: number[];
  /** The sim-time the session has been STEPPED to (so revenue resumes seamlessly). */
  lastStepS: number;
  /** Sim-time of the LAST availability-axis breach reset (a step that fed served-fraction 0
   * for an availability-active contract). The Act-2 gate (§3.3) requires a SUSTAINED clean
   * hand-off window — `nowS − cleanServedSinceS ≥ NET_HANDOFF_CYCLE_S` — so a single served tick
   * mid-sawtooth cannot spuriously fire it. Initialised to 0 (the session epoch). */
  cleanServedSinceS: number;
  /** Over-build waste (sats beyond the measured zero-gap minimum) recorded at the moment the
   * act2 gate fired — surfaced for the Act-3 optimizer pull (onboarding line 86). 0 until act2
   * completes; the gate's predicate is coverage-held (not a sat cap), so over-build still
   * completes and the surplus is SILENTLY logged here. Folded into the golden. */
  wasteLoggedSats: number;

  // --- ACT-3a (C1b) escalation + congestion fold state -----------------------------
  /** Whether the escalation law is GATED ON (0/1) — set true by the act3a beat's emit. While
   * on, a well-served contract's `offeredLoad` grows logistically each step (design §3a). */
  escalationOn: number;
  /** The §2.4 CONGESTION EPOCH (E3): a monotone int that bumps whenever any sat's quantized
   * shared-load bucket changes. Fed into the router topologyKey so a rising load forces a
   * re-solve through the cache (the HIGH-2 fix). Folds into the golden. */
  congestionEpoch: number;
  /** The chosen serving PIPE (`satId:slotIdx`) per ACTIVE contract id (the two-pass
   * aggregation's Pass-A result), as `[contractId, pipeKey]` pairs. Folded (sorted by
   * contractId) so `loadByPipe` is a pure function of folded state across a restore
   * boundary (the MED desync fix). */
  chosenPipeByContract: [string, string][];
  /** Whether the act3a tame→outgrow→re-tame cycle has been WITNESSED (0/1): a previously-served
   * contract dipped near-breach under risen load, then returned to fully SERVED. The act3a gate
   * returns this. Folds into the golden. */
  act3aReTameWitnessed: number;
  /** Contracts that DIPPED near-breach while escalation was on (id → dip sim-time), so a
   * later player-re-engineered return to fully-served completes the cycle. Folds (sorted). */
  nearBreachWitnessed: [string, number][];
  /** Sim-time of the last player topology action (launch/beam/circularize/prefer); null =
   * never. The re-tame witness requires it strictly after the dip. Folded. */
  playerTopoActionS: number | null;
  /** The quantized congestion fingerprint of the LAST step's shared-load aggregate (E3): the
   * congestion epoch bumps when the current step's fingerprint differs from this. Folded as a
   * string so a restore reproduces the epoch-bump decision of a continuous run (replay-safe). */
  congestionFingerprint: string;

  // --- ACT-3b (C2) fault + trace fold state ----------------------------------------
  /** Whether the FAULT GENERATOR is gated ON (0/1) — set true by the act3b beat's emit, which
   * fires ONLY after the act3a gate (faults are FENCED behind re-stabilisation). While on, the
   * session rolls {@link rollFaults} off the seeded stream each step. Folds into the golden. */
  faultsOn: number;
  /** The ACTIVE faults this step, one per faulted sat (folded by satId|kind|cause|the three
   * §2.4 predictability-seed sim-times — bit-stable f64s). Sorted by satId so the fold never
   * depends on insertion order. A faulted sat is removed from the router graph (transient /
   * telegraphed-expired) or has its effective capacity haircut (degradation). */
  activeFaults: FaultState[];
  /** The pending SCRIPTED mild-first queue (a Degradation, then a Telegraphed failure) the
   * act3b emit seeds; the roll consumes the HEAD once mild-first-ready. Folded (in order) so a
   * restore resumes the exact mild-first sequence. */
  faultScriptQueue: FaultScript[];
  /** The satId of the LAST scripted fault that fired (null = none) — the mild-first gate the
   * Telegraphed failure waits on (it fires only once the Degradation resolved). Folded. */
  lastScriptedFaultSatId: string | null;
  /** Whether the player has WEATHERED ≥1 fault — kept a contract served through a fault's whole
   * lifetime (start → resolve). The first half of the act3b gate. Latched. Folds (0/1). */
  faultWeathered: number;
  /** SatIds whose active fault has coexisted with a fully-served contract (the network kept
   * serving while it faulted); on that fault's resolution the player WEATHERED it. Folded (sorted)
   * so a restore reproduces the weather latch across the boundary. */
  servedThroughFault: string[];
  /** Whether the trace has surfaced ≥1 optimisation/resilience shortfall (over-provision / SPOF /
   * binding-constraint) since faults began — the second half of the act3b gate. Latched true the
   * step {@link diagnose} returns a non-empty shortfall list while faults are on. Folds (0/1). */
  surfacedShortfall: number;

  // --- ACT-4 (D1) the Mars frontier teaser — the ONE folded slot --------------------
  /** The Act-4 Mars data sample (null until the path first carries / a breadcrumb is placed). The
   * ONLY Act-4 fold growth (2 floats + a null-flag): `capturedAtT` + `halfLifeS`. The "data arrives
   * old" / "as of Nm ago" / the stale-pay dimming are render-layer reads off THIS — NO Contract
   * field, NO wallet wiring, NO freshness economy (§8 fenced). */
  marsSample: MarsSample | null;

  // --- R0 (SD-45): beams + the launch pipeline + underburns -------------------------
  /** The beam-assignment table (pipeKey → regionId), sorted pairs. Folded — pointing is
   * topology state. */
  beamAssign: [string, string][];
  /** In-flight launch events (countdown/ascent/deploy pipeline), in commit order. Folded. */
  pendingLaunches: PendingLaunch[];
  /** Underburned sats awaiting a circularization burn: [satId, intendedAM]. Folded. */
  underburnIntended: [string, number][];
  /** How many launches have been COMMITTED (drives event ids + the maiden-flight rule). */
  launchCommits: number;
}

export class NetSession {
  /** The launched-sat roster (the player's constellation). */
  private readonly satList: NetSat[] = [];
  /** The € wallet — a plain number (net/ does not import the m1 economy). */
  private walletBalance: number;
  /** The seeded splitmix64 RNG (faults draw from it in Act 3b; absent in Act 1). */
  private rng: SimRng;
  /** Successful launches so far — fans sat ids + (later) constellation phase. */
  private launchedCount = 0;

  /** Every contract this session has seen, in offer order. */
  private readonly contractList: Contract[] = [];
  /** The ground-network endpoints the router terminates paths at (Act 1: one). */
  private readonly groundNets: GroundNet[];

  /** The §2.4 re-solve cache, one {@link RouterState} per contract id (keyed by id so a
   * contract keeps its cached path across ticks; the cheap re-eval avoids a full search
   * unless the topology changes or a horizon rise/set flips the served verdict). */
  private readonly routerStates = new Map<string, RouterState>();
  /** The last SolveResult per contract id (the readout: path / latency / losses / binding). */
  private readonly lastSolve = new Map<string, SolveResult>();

  /** The scenario cursor (which beat is current). Driven by the A3 scenario engine in
   * `step`; the session owns the integer so it folds into the replay hash. */
  private scenarioCursor = 0;
  /** The recorded gate-tick stamps (the tick each beat's gate first fired). */
  private readonly gateTicks: number[] = [];
  /** The authored arrival sequence (design §3). The session DRIVES it in `step`: it emits
   * the current beat once, then calls gate() each tick and advances on the first true. */
  private readonly scenario: Beat[];
  /** The cursor whose beat's emit() has already fired (-1 = none yet). Distinct from
   * scenarioCursor so the FIRST beat (act1) emits before its gate is ever checked, and a
   * re-restore re-emits no beat (emit is idempotent + de-duped by id anyway). NOT folded:
   * it is fully derived from scenarioCursor (every beat ≤ cursor has emitted), so it adds
   * no new outcome state — the contracts the emits produced ARE folded. */
  private emittedCursor = -1;

  /** Sim-time the session has been STEPPED to (for snapshot-resume continuity). */
  private lastStepS = 0;

  /** Sim-time of the last availability-axis breach reset — the START of the current clean
   * hand-off streak (§3.3, the gate-hardening field). Stamped to `t` every step that feeds a
   * 0 served-fraction for an availability-active contract; the Act-2 gate fires only once
   * `nowS − cleanServedSinceS ≥ NET_HANDOFF_CYCLE_S` (a SUSTAINED clean window). Folds into the
   * snapshot/golden. Initialised to 0 (the session epoch). */
  private cleanServedSinceS = 0;

  /** Over-build waste (sats beyond the measured zero-gap minimum) recorded when the act2 gate
   * fired — seeds the Act-3 optimizer pull (onboarding line 86). 0 until act2 completes. */
  private wasteLoggedSats = 0;

  // --- ACT-3a (C1b) escalation + congestion state ----------------------------------
  /** The escalation law gate (folded as int 0/1): set true by {@link enableEscalation}. */
  private escalationOn = false;
  /** The §2.4 congestion epoch (E3) — bumps on a quantized shared-load bucket change. Folded. */
  private congestionEpoch = 0;
  /** The chosen serving PIPE per ACTIVE contract id (Pass A of the two-pass aggregation). Folded
   * as sorted `id|pipeKey` pairs so {@link loadByPipeFromState} is a pure function of folded state
   * across a restore boundary; the live `loadByPipe` map is re-derived each step, never stored. */
  private readonly chosenPipeByContract = new Map<string, string>();

  // --- R0 (SD-45): beams + the launch pipeline + underburns -------------------------
  /** The beam-assignment table (pipeKey → regionId) — the pointing state. Folded. */
  private readonly beamAssign = new Map<string, string>();
  /** In-flight launch events (the countdown/ascent/deploy pipeline). Folded. */
  private pendingLaunchList: PendingLaunch[] = [];
  /** Underburned sats awaiting a circularization burn (satId → intended aM). Folded. */
  private readonly underburnIntended = new Map<string, number>();
  /** Launches COMMITTED so far (event ids + the maiden-flight forced-success rule). Folded. */
  private launchCommits = 0;
  /** The act3a re-tame witness (folded int 0/1): a previously-served contract dipped near-breach
   * under risen load, then returned to fully SERVED. {@link escalationReTamed} returns this. */
  private act3aReTameWitnessed = false;
  /** Contracts that have DIPPED near-breach while escalation was on (the first half of the
   * re-tame witness), mapped to the sim-time of the dip. A later return to fully-served —
   * AFTER a player re-engineering action — completes the cycle. Folded (sorted pairs). */
  private readonly nearBreachWitnessed = new Map<string, number>();
  /** Sim-time of the last PLAYER topology action (launch commit / beam / circularize /
   * prefer) — the "the player re-engineered" stamp the re-tame witness requires between the
   * dip and the all-green state. null = never. Folded. */
  private lastPlayerTopoActionS: number | null = null;
  /** The quantized congestion fingerprint of the last step's shared-load aggregate (E3) — the
   * epoch bumps when this step's fingerprint differs. Folded so a restore reproduces the bump. */
  private prevCongestionFingerprint = "";

  // --- ACT-3b (C2) fault + trace state ----------------------------------------------
  /** The FAULT GENERATOR gate (folded as int 0/1): set true by {@link enableFaults} — fired ONLY
   * by the act3b beat, which emits ONLY after the act3a gate (faults FENCED behind re-stabilisation).
   * While on, {@link step} rolls {@link rollFaults} off the seeded {@link SimRng} each tick. */
  private faultsOn = false;
  /** The ACTIVE faults, keyed by satId (one fault per sat at a time). A faulted sat is REMOVED from
   * the router graph (transient / a telegraphed countdown that expired) or has its effective
   * capacity HAIRCUT (a degradation — the sat still routes, its shared load is scaled up so it
   * congests sooner). Folded (sorted by satId) as the predictability-seed times. */
  private readonly activeFaults = new Map<string, FaultState>();
  /** The pending SCRIPTED mild-first queue (a Degradation, then a Telegraphed failure) the act3b
   * emit seeds; the roll consumes the HEAD once it is mild-first-ready (the prior scripted fault
   * resolved). Folded in order so a restore resumes the exact mild-first sequence. */
  private faultScriptQueue: FaultScript[] = [];
  /** The satId of the LAST scripted fault that fired (null = none yet) — the mild-first gate: the
   * NEXT scripted fault (the Telegraphed failure) fires only once THIS one has resolved (left the
   * active map). Folded (string|null) so a restore reproduces the mild-first cadence. */
  private lastScriptedFaultSatId: string | null = null;
  /** The act3b WEATHERED-A-FAULT witness (folded int 0/1): the player kept ≥1 contract served
   * through a fault's WHOLE lifetime (start → self-recover / drop) — the network rode through it.
   * {@link weatheredFault} returns this. */
  private faultWeathered = false;
  /** SatIds whose ACTIVE fault has coexisted with ≥1 fully-served contract at some step (the
   * network kept serving while this sat was faulting). On that fault's RESOLUTION, the player
   * WEATHERED it ⇒ latch {@link faultWeathered}. Folded (sorted) so a restore reproduces the
   * weather latch across the boundary. Cleared per sat when its fault resolves. */
  private readonly servedThroughFault = new Set<string>();
  /** The act3b TRACE-SURFACED-A-SHORTFALL witness (folded int 0/1): {@link diagnose} surfaced ≥1
   * resilience/optimisation/binding shortfall while faults were on. {@link traceSurfacedShortfall}
   * returns this — the act3b gate's layer-1 target (the trace did its job). */
  private surfacedShortfall = false;
  /** The LAST trace report (a DERIVED readout the render/log reads; NOT folded — only the booleans
   * the session latches from it fold). Refreshed each step once faults are on. */
  private lastTrace: TraceReport | null = null;

  // --- ACT-4 (D1) the Mars frontier teaser — the ONE folded slot --------------------
  /** The Act-4 Mars data sample (null until the Mars path first carries OR the cache breadcrumb is
   * placed). The ONLY Act-4 fold growth. The "data arrives old" / "as of Nm ago" / the stale-pay
   * dimming are RENDER-LAYER reads off this (NO Contract field, NO wallet wiring, §8 fenced). */
  private marsSample: MarsSample | null = null;

  constructor(
    openingBalance = NET_OPENING_BALANCE,
    seed: bigint = NET_RNG_SEED,
    // The ground network: the equatorial GROUND-0 (Act 1, serves REGION-0) PLUS the high-lat
    // GROUND-1 (Act 2, the only ground REGION-1's inclined constellation can downlink to — the
    // equatorial GEO cannot reach it either, so it does NOT let the GEO serve REGION-1). The
    // router bridges via the strongest (sat, ground) pair across all grounds, so REGION-0 keeps
    // its byte-identical GROUND-0 bridge (golden-safe) and REGION-1 terminates at GROUND-1.
    groundNets: GroundNet[] = [NET_ACT1_GROUND, NET_ACT2_GROUND],
    scenario: Beat[] = M1_SCENARIO,
  ) {
    this.walletBalance = openingBalance;
    this.rng = new SimRng(seed);
    this.groundNets = groundNets.map((g) => ({ ...g }));
    this.scenario = scenario;
  }

  /** On-hand € balance. */
  get balance(): number {
    return this.walletBalance;
  }

  /** A read-only view of the launched-sat roster (the render reads this). */
  get sats(): readonly NetSat[] {
    return this.satList;
  }

  /** A read-only view of every contract, in offer order (the panel reads this). */
  get contracts(): readonly Contract[] {
    return this.contractList;
  }

  /** A read-only view of the ground-network endpoints. */
  get grounds(): readonly GroundNet[] {
    return this.groundNets;
  }

  /** The current scenario cursor (which beat is live). */
  get cursor(): number {
    return this.scenarioCursor;
  }

  /** The sim-time the session has been STEPPED to (the END of the last step). The Act-2 gate
   * reads this against {@link cleanServedSinceS} to require a sustained clean hand-off streak. */
  get nowS(): number {
    return this.lastStepS;
  }

  /** The START of the current availability clean streak — the last sim-time a step fed a 0
   * served-fraction for an availability-active contract (the gate-hardening stamp, §3.3). */
  get cleanSinceS(): number {
    return this.cleanServedSinceS;
  }

  /** Over-build waste recorded at act2 completion (sats beyond the measured zero-gap minimum). */
  get wasteSats(): number {
    return this.wasteLoggedSats;
  }

  /** Record over-build waste at the moment the act2 gate fires (the scenario beat calls this).
   * Idempotent in spirit — the gate fires once, so this is written once per act2 completion. */
  recordWasteSats(n: number): void {
    this.wasteLoggedSats = Math.max(0, Math.trunc(n));
  }

  // --- mutation surface (driven by applyNetAction; pure + deterministic) -----------

  /**
   * LAUNCH a satellite into the given orbit at sim-time `t`, with a BROADCAST loadout, CHARGING
   * `costEur` to the wallet (design §3.5 — "charge for launches": you pay the launch provider
   * win OR lose, mirroring the m2 build session) and rolling the FLAT per-launch FAILURE chance off
   * the session's SEEDED splitmix64 RNG ({@link rollNetLaunch} — the M2 launch-roll pattern, NO new
   * seed). On SUCCESS the sat joins the roster immediately (its coverage starts at `t`) and the
   * monotonic id is consumed; on FAILURE nothing is added (you ate the loss) and no id is consumed.
   * Returns `{ ok, satId, roll }`. Deterministic + replay-safe (the draw folds via the rng state).
   */
  launchSat(sat: NetSat, costEur = 0): { ok: boolean; satId: string | null; roll: number } {
    // Charge ALWAYS (win or lose) — the §3.5 "you pay the launch provider" convention (the m2
    // build session debits the cost BEFORE the failure roll too). The wallet can go negative
    // (the build-vs-budget tension); the planner shows the cost before commit.
    this.walletBalance -= costEur;
    const roll = rollNetLaunch(this.rng);
    // ACT 1 IS THE DELIBERATELY-GENTLE "place one thing and it WORKS" opener (m1.md §IV act1: no
    // failure). Suppress the §3.5 launch-failure roll while the scenario is on the FIRST beat
    // (scenarioCursor 0); from Act 2 on the flat failure chance applies. DETERMINISM: the roll is
    // STILL DRAWN above (so the seeded-RNG draw count — and every downstream roll — stays byte-
    // identical to before); only the OUTCOME is overridden to success here. scenarioCursor advances
    // identically in live + replay (gate-driven sim state), so this is replay-stable — the golden
    // moves ONLY if the canonical run had ever rolled an Act-1 failure (now forced to succeed).
    const failuresArmed = this.scenarioCursor > 0;
    if (!roll.ok && failuresArmed) {
      // The launch FAILED: the sat is lost (no roster add, no id consumed, no topology change).
      return { ok: false, satId: null, roll: roll.roll };
    }
    this.satList.push(sat);
    this.launchedCount++;
    // A launch is a topology change: invalidate every cached router path so the next step
    // does a full re-search (the §2.4 launch/commit event).
    this.routerStates.clear();
    return { ok: true, satId: sat.id, roll: roll.roll };
  }

  /** The next launched-sat id (monotonic, stable across replay). */
  nextSatId(): string {
    return `NET-SAT-${this.launchedCount}`;
  }

  /** CONSUME the next sat id (advances the monotonic counter) — the applier calls this
   * per batch member at COMMIT, so ids are stable across deploy outcomes. */
  consumeSatId(isRelay = false): string {
    const id = isRelay ? this.nextRelaySatId() : this.nextSatId();
    this.launchedCount++;
    return id;
  }

  // --- R0 (SD-45): the launch-event pipeline + beams + underburns -------------------

  /** The beam-assignment table (pipeKey → regionId) — the pointing state the router
   * consumes. Read-only view. */
  get beams(): BeamMap {
    return this.beamAssign;
  }

  /** In-flight launch events (the render layer stages countdown/ascent/deploy off this). */
  get launchEvents(): readonly PendingLaunch[] {
    return this.pendingLaunchList;
  }

  /** The intended semi-major axis of an underburned sat awaiting circularization
   * (null when the sat is not underburned). */
  underburnFor(satId: string): number | null {
    return this.underburnIntended.get(satId) ?? null;
  }

  /** Every underburned sat id (the render marks them + offers the burn). */
  get underburnedSatIds(): readonly string[] {
    return [...this.underburnIntended.keys()].sort();
  }

  /**
   * ASSIGN (or with `regionId === ""` UNASSIGN) a spot beam: pipe (satId, slotIdx) →
   * region. The pointing verb (m1-redesign §2.3) — instant, free, but a topology change
   * (the router cache invalidates; whoever the beam left is un-served next tick).
   * Returns a problem string, or null on success. Deterministic.
   */
  assignBeam(satId: string, slotIdx: number, regionId: string): string | null {
    const problem = validateBeamAssign(this.satList, satId, slotIdx, regionId);
    if (problem !== null) return problem;
    const key = pipeKey(satId, slotIdx);
    if (regionId === "") this.beamAssign.delete(key);
    else this.beamAssign.set(key, regionId);
    this.routerStates.clear(); // pointing is a topology change (§2.4).
    this.lastPlayerTopoActionS = this.lastStepS; // the player re-engineered.
    return null;
  }

  /**
   * COMMIT a launch (m1-redesign §2.2 phase 3): charge the wallet, roll the seeded
   * outcomes, and enqueue the sim-tick launch EVENT — the sats deploy over the next
   * ~15–20 sim-seconds ({@link processPendingLaunches}), they do NOT appear instantly.
   *
   * ROLL ORDER (deterministic, one stream): 1 vehicle-loss draw per launch, then per
   * member 1 underburn draw + 1 no-sep draw — always drawn (stable draw count), outcomes
   * FORCED to success while the scenario is on the Act-1 beat (the gentle opener) and
   * for the vehicle-loss roll on the maiden flight (launchCommits === 0).
   */
  launchBatch(members: NetSat[], costEur: number, t: number): PendingLaunch {
    this.walletBalance -= costEur; // charged win OR lose (§3.5).
    const failuresArmed = this.scenarioCursor > 0;
    const maiden = this.launchCommits === 0;

    const lossRoll = this.rng.nextDouble();
    const lost = failuresArmed && !maiden && lossRoll < NET_VEHICLE_LOSS_CHANCE;

    const liftoffAtS = t + NET_LAUNCH_COUNTDOWN_S;
    const firstDeployAtS = liftoffAtS + NET_LAUNCH_ASCENT_S;
    const pending: PendingMember[] = [];
    for (let i = 0; i < members.length; i++) {
      const underburnRoll = this.rng.nextDouble();
      const nosepRoll = this.rng.nextDouble();
      const underburn = failuresArmed && underburnRoll < NET_UNDERBURN_CHANCE;
      const nosep = failuresArmed && !underburn && nosepRoll < NET_NOSEP_CHANCE;
      const sat = members[i];
      const intendedAM = sat.orbit.aM;
      if (underburn) sat.orbit.aM = intendedAM * NET_UNDERBURN_FACTOR;
      pending.push({
        sat,
        deployAtS: firstDeployAtS + i * NET_LAUNCH_DEPLOY_SPACING_S,
        outcome: lost ? "no_sep" : underburn ? "underburn" : nosep ? "no_sep" : "ok",
        intendedAM,
        deployed: 0,
      });
    }
    const ev: PendingLaunch = {
      id: `LAUNCH-${this.launchCommits}`,
      committedAtS: t,
      liftoffAtS,
      lost: lost ? 1 : 0,
      lostAtS: lost ? liftoffAtS + NET_LAUNCH_ASCENT_S / 2 : 0,
      members: pending,
    };
    this.launchCommits++;
    this.pendingLaunchList.push(ev);
    return ev;
  }

  /**
   * CIRCULARIZE an underburned sat (the paid fix, m1-redesign §2.2): charge the burn,
   * raise its semi-major axis to the intended value. Returns true when applied (false =
   * not underburned / unknown sat). Deterministic; a topology change.
   */
  circularize(satId: string): boolean {
    const intended = this.underburnIntended.get(satId);
    if (intended === undefined) return false;
    const sat = this.satList.find((s) => s.id === satId);
    if (sat === undefined) return false;
    this.walletBalance -= NET_CIRCULARIZE_COST_EUR;
    sat.orbit.aM = intended;
    this.underburnIntended.delete(satId);
    this.routerStates.clear();
    this.lastPlayerTopoActionS = this.lastStepS; // the player re-engineered.
    return true;
  }

  /** Deploy any pending launch members whose deploy instant has arrived (the sim-tick
   * event pipeline), then prune finished events past the render linger. A deploy is a
   * topology change. Pure function of (t, folded state). */
  private processPendingLaunches(t: number): void {
    if (this.pendingLaunchList.length === 0) return;
    let topologyChanged = false;
    for (const ev of this.pendingLaunchList) {
      if (ev.lost === 1) continue;
      for (const m of ev.members) {
        if (m.deployed === 1 || t < m.deployAtS) continue;
        m.deployed = 1;
        if (m.outcome === "no_sep") continue;
        this.satList.push({
          ...m.sat,
          orbit: { ...m.sat.orbit },
          loadout: m.sat.loadout.map((a) => ({ ...a })),
        });
        if (m.outcome === "underburn") this.underburnIntended.set(m.sat.id, m.intendedAM);
        topologyChanged = true;
        // The re-tame witness stamp fires at DEPLOY (when the re-engineering physically
        // lands), not at commit — a dip cannot be "answered" by paperwork still in flight.
        this.lastPlayerTopoActionS = t;
      }
    }
    this.pendingLaunchList = this.pendingLaunchList.filter((ev) => {
      const endS =
        ev.lost === 1
          ? ev.lostAtS
          : ev.members.length > 0
            ? ev.members[ev.members.length - 1].deployAtS
            : ev.liftoffAtS;
      const done = ev.lost === 1 ? t > endS + NET_LAUNCH_EVENT_LINGER_S : ev.members.every((m) => m.deployed === 1) && t > endS + NET_LAUNCH_EVENT_LINGER_S;
      return !done;
    });
    if (topologyChanged) this.routerStates.clear();
  }

  /** The next Act-4 MARS RELAY id (monotonic, stable across replay). The id begins with
   * {@link NET_ACT4_RELAY_ID_STEM} so the router's solveMarsLeg PRESENCE test recognises it as
   * the deep-space relay that bridges the Mars leg by construction. */
  nextRelaySatId(): string {
    return `${NET_ACT4_RELAY_ID_STEM}-${this.launchedCount}`;
  }

  /** Add a contract to the board (the scenario beat's emit() calls this). De-duplicated by
   * id so a beat re-emit is idempotent. */
  addContract(contract: Contract): void {
    if (this.contractList.some((c) => c.id === contract.id)) return;
    this.contractList.push(contract);
  }

  /** Find a contract by id (null if unknown). */
  contractById(id: string): Contract | null {
    return this.contractList.find((c) => c.id === id) ?? null;
  }

  /**
   * ACCEPT an OFFERED contract by id, moving it OFFERED → ACTIVE so it begins accruing
   * revenue from the live router coverage. Returns the affected contract, or null if the
   * id is unknown or not OFFERED. Pure + deterministic.
   */
  acceptContract(contractId: string): Contract | null {
    const c = this.contractById(contractId);
    if (c === null || c.state !== "offered") return null;
    c.state = "active";
    return c;
  }

  /**
   * Set a contract's per-contract PREFER weights (the §7.3 tune-by-exception, first used
   * in Act 3). Returns the affected contract, or null if unknown. Pure.
   */
  setPrefer(contractId: string, lat: number, bw: number, stab: number): Contract | null {
    const c = this.contractById(contractId);
    if (c === null) return null;
    c.prefer = { lat, bw, stab };
    this.lastPlayerTopoActionS = this.lastStepS; // re-biasing the blend = re-engineering.
    return c;
  }

  /** ENABLE the escalation law (the act3a beat's emit calls this; idempotent). While on, a
   * well-served contract's `offeredLoad` grows logistically each step (design §3a — "your
   * success congests it"). Pure flag flip — it never touches physics (the §3 emit contract). */
  enableEscalation(): void {
    this.escalationOn = true;
  }

  /** Whether the escalation law is gated on (the readout + the trace face). */
  get escalationEnabled(): boolean {
    return this.escalationOn;
  }

  /** ENABLE the FAULT GENERATOR (the act3b beat's emit calls this; idempotent). FENCED: the act3b
   * beat emits ONLY after the act3a gate fired, so this can never turn on before re-stabilisation
   * (the scenario assert). Optionally seeds the mild-first SCRIPTED queue (a Degradation, then a
   * Telegraphed failure) the roll consumes scripted-first. Pure flag flip + queue seed — it never
   * touches physics (the §3 emit contract); the seeded roll in step() drives the faults. */
  enableFaults(scripts: readonly FaultScript[] = []): void {
    this.faultsOn = true;
    // Seed the mild-first queue ONCE (idempotent — a re-emit of an already-seeded queue is a no-op,
    // so a restore-then-re-emit never double-queues; the queue is folded so a restore resumes it).
    if (scripts.length > 0 && this.faultScriptQueue.length === 0) {
      this.faultScriptQueue = scripts.map((s) => ({ ...s }));
    }
  }

  /** Whether the fault generator is gated on (the readout + the act3b assert). */
  get faultsEnabled(): boolean {
    return this.faultsOn;
  }

  /** A read-only view of the active faults this step (the render/log/SYSTEM.LOG reads this — the
   * amber pulse + the telegraphed countdown). Sorted by satId for a stable readout. */
  get faults(): readonly FaultState[] {
    return [...this.activeFaults.values()].sort((a, b) => (a.satId < b.satId ? -1 : a.satId > b.satId ? 1 : 0));
  }

  /** Whether the player has WEATHERED ≥1 fault while keeping contracts served (or recovering) —
   * the first half of the act3b gate. Latched. */
  weatheredFault(): boolean {
    return this.faultWeathered;
  }

  /** Whether the trace has surfaced ≥1 resilience/optimisation shortfall since faults began —
   * the second half of the act3b gate. Latched. */
  traceSurfacedShortfall(): boolean {
    return this.surfacedShortfall;
  }

  /** The LAST trace report (a derived readout the render/log reads — the shortfall lines + the
   * fault SYSTEM.LOG + the predictability-seed loss roll). Null until faults turn on. NOT folded. */
  get trace(): TraceReport | null {
    return this.lastTrace;
  }

  /** The current §2.4 congestion epoch (E3) — the readout the topologyKey is keyed on. */
  get congestion(): number {
    return this.congestionEpoch;
  }

  /** Whether the act3a tame→outgrow→re-tame cycle has been witnessed (the act3a gate's
   * predicate): a previously-served contract dipped near-breach under risen load, then returned
   * to fully SERVED. State-gated (the concept demonstrated), not clock-timed. */
  escalationReTamed(): boolean {
    return this.act3aReTameWitnessed;
  }

  /** The aggregate shared load routed over a sat id this step (Σ over its pipes) —
   * re-derived from the folded chosen-pipe assignment + each contract's offeredLoad. */
  loadOnSat(satId: string): number {
    return NetSession.satLoadView(this.loadByPipeFromState()).get(satId) ?? 0;
  }

  // --- ACT-4 (D1) the Mars frontier teaser — the freshness readouts (render-layer) ---

  /** The Act-4 Mars data sample (null until the path first carries / a breadcrumb is placed). The
   * render reads this for the "data arrives old" desaturation + the "as of Nm ago" stamp. */
  get mars(): MarsSample | null {
    return this.marsSample;
  }

  /** The AGE of the Mars sample at sim-time t ("as of Nm ago" = age/60 minutes). null until a
   * sample exists. A READOUT (render-layer) — never a wallet/breach input (§8 fenced). */
  marsAgeS(t: number): number | null {
    return this.marsSample === null ? null : Math.max(0, t - this.marsSample.capturedAtT);
  }

  /** The FRESHNESS of the Mars sample at sim-time t (the reused `delay.ts` curve `2^(−age/half)`):
   * the Mars data node desaturates toward grey as it ages (DD-1: freshness = saturation draining).
   * null until a sample exists. A READOUT only — NO Earth contract ever exposes this (§4.2 / §8). */
  marsFreshness(t: number): number | null {
    if (this.marsSample === null) return null;
    return freshness(this.marsAgeS(t) ?? 0, this.marsSample.halfLifeS);
  }

  /**
   * PLACE the ONE Act-4 cache breadcrumb (the net_place_cache action applies this — "data closer
   * helps"). DETERMINISTIC, NO ROLL: it RE-CAPTURES the Mars sample "near Mars" at sim-time t (a
   * fresh `capturedAtT = t` ⇒ age 0 ⇒ the freshness readout jumps back up by sight). It does NOT
   * change served/breach or revenue (a FELT breadcrumb, not a relief lever) — the whole caching
   * lesson for now, NOT the multi-slot eviction/prefetch/coherence economy (§8 fenced). The
   * half-life stays the honest one-way light delay at t (SD-19 convention). Pure + idempotent-safe.
   */
  placeMarsCache(eph: Ephemeris, t: number): void {
    this.marsSample = {
      datasetId: "mars",
      capturedAtT: t,
      halfLifeS: interBodyOneWayLatencyS(eph, "earth", "mars", t),
    };
  }

  /** Advance the scenario cursor + stamp the gate tick (the A3 engine calls this when a
   * beat's gate first fires). Idempotent-ish: records the tick for the current beat. */
  advanceCursor(gateTick: number): void {
    this.gateTicks[this.scenarioCursor] = gateTick;
    this.scenarioCursor++;
  }

  /** A read-only view of the last solve per contract id (the trace/render reads this). */
  lastSolveFor(contractId: string): SolveResult | null {
    return this.lastSolve.get(contractId) ?? null;
  }

  /**
   * The scalar servedFraction ∈ [0,1] for a contract this instant, from the router's verdict
   * over the contract's ACTIVE axes. Two regimes, gated purely by the `activeAxes` mask:
   *
   *   - CONNECTIVITY-ONLY (Act 1): BINARY — 1.0 if a path region→sat→groundNet exists this
   *     instant, else 0.0. BYTE-IDENTICAL to the old body (golden-safe for REGION-0).
   *   - AVAILABILITY ACTIVE (Act 2): the region must be HELD across the hand-off window, not
   *     merely reachable this instant. We compute the ROLLING {@link windowAvailability} and
   *     feed a fraction that drops to 0 while availability is in breach — an instantaneous gap
   *     (the sawtooth trough) OR a sustained rolling shortfall (avail < slaAvail). A lone LEO
   *     sawtooths + rolling-avail ≈ 0 ⇒ feeds 0 ⇒ the SHARED grace breaches it on schedule; a
   *     phased N=4 holds served continuously + avail = 1.0 ⇒ feeds 1.0 ⇒ completes. ONE breach
   *     convention (the imported `stepActiveContract`), no second state machine, no reshape.
   *
   * Pure; reuses the cached {@link RouterState} for the instant verdict + the pure
   * {@link windowAvailability} for the rolling held-fraction. `lastAvailability` is a readout.
   */
  private servedFractionFor(
    eph: Ephemeris,
    contract: Contract,
    t: number,
    loadBySat?: ReadonlyMap<string, number>,
    faults?: ReadonlySet<string>,
  ): number {
    const prev = this.routerStates.get(contract.id) ?? null;
    // E2/E3 (Act 3a): the shared-load aggregate + the congestion epoch are forwarded into the
    // §2.4 re-solve split. Absent/empty (Acts 1–2) ⇒ congestion_term 0 + epoch 0 ⇒ byte-identical
    // routing + the same topologyKey, so the pre-Act-3 fold is untouched (golden-safe).
    // Act 3b: `faults` is the set of DOWN sat ids (transient / telegraphed-expired) — removed from
    // the graph via the router's existing `faults?` param (a topology change). Absent when faults
    // are off ⇒ undefined ⇒ byte-identical routing (golden-safe for Acts 1–3a).
    const next = resolveTick(
      eph,
      contract,
      this.satList,
      this.groundNets,
      t,
      prev,
      faults, // Act 3b: the down-sat set (transient/telegraphed-expired); undefined pre-act3b.
      loadBySat,
      this.congestionEpoch,
      this.beamAssign, // R0: the pointing state — eligibility + the beams topology key.
    );
    this.routerStates.set(contract.id, next);
    this.lastSolve.set(contract.id, next.result);
    // Act 1 (connectivity-only): binary served fraction — the byte-identical legacy path.
    if (!contract.activeAxes.has("availability")) {
      return next.result.served ? 1.0 : 0.0;
    }
    // Act 2 (availability active): the held-fraction over the trailing hand-off cycle.
    const avail = windowAvailability(eph, contract, this.satList, this.groundNets, t, faults, this.beamAssign);
    contract.lastAvailability = avail; // the sawtooth-meter readout (set each step).
    if (!next.result.served) return 0.0; // instant gap (a sawtooth trough) → 0.
    return avail >= contract.slaAvail ? 1.0 : 0.0; // sustained shortfall → 0; held → 1.0.
  }

  /**
   * THE TWO-PASS CONGESTION AGGREGATION (Act 3a / C1b — Pass A + Aggregate). REPLAY-SAFE: built
   * ENTIRELY from FOLDED state (`offeredLoad` + the prior-tick `chosenSatByContract`), never a
   * separate cached map, so a restore-then-step reproduces a continuous run (the MED desync fix).
   *
   * {@link loadBySatFromState} rebuilds the shared-load aggregate `satId → Σ offeredLoad` from the
   * LAST step's chosen-sat assignment (Pass A's one-tick lag — deterministic + bounded). The live
   * `step` then runs the contract solves against THIS map, records each contract's freshly-chosen
   * sat back into {@link chosenSatByContract}, and bumps {@link congestionEpoch} when a quantized
   * bucket changed — so next step's aggregate reflects this step's routing. Pure.
   */
  private loadByPipeFromState(): Map<string, number> {
    const load = new Map<string, number>();
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      const pipe = this.chosenPipeByContract.get(c.id);
      if (pipe === undefined) continue;
      load.set(pipe, (load.get(pipe) ?? 0) + c.offeredLoad);
    }
    return load;
  }

  /** Aggregate a per-PIPE load map into a per-SAT view (Σ over the sat's pipes) — the
   * trace/readout surface that thinks in sats. Pure. */
  private static satLoadView(loadByPipe: ReadonlyMap<string, number>): Map<string, number> {
    const out = new Map<string, number>();
    for (const [pipe, l] of loadByPipe) {
      const parsed = parsePipeKey(pipe);
      if (parsed === null) continue;
      out.set(parsed.satId, (out.get(parsed.satId) ?? 0) + l);
    }
    return out;
  }

  /** The load routed over one PIPE this step (readout). */
  loadOnPipe(pipe: string): number {
    return this.loadByPipeFromState().get(pipe) ?? 0;
  }

  /** The capacity (units) of a pipe on the live roster (readout; 0 = unknown). */
  pipeCapacity(pipe: string): number {
    return pipeCapacityOf(this.satList, pipe);
  }

  /** The quantized congestion FINGERPRINT of the current `loadBySat` (E3): each sat's bucket
   * `floor(load / NET_CONGESTION_BUCKET_UNITS)` plus a flag for whether it crossed the bandwidth
   * capacity, folded into a sorted string. A change between steps ⇒ the congestion epoch bumps ⇒
   * the topologyKey flips ⇒ a re-solve through the cache. Pure. */
  private congestionFingerprint(load: ReadonlyMap<string, number>): string {
    const parts: string[] = [];
    for (const [pipe, l] of load) {
      const bucket = Math.floor(l / NET_CONGESTION_BUCKET_UNITS);
      const cap = pipeCapacityOf(this.satList, pipe);
      const overCap = cap > 0 && l >= cap ? 1 : 0;
      parts.push(`${pipe}:${bucket}:${overCap}`);
    }
    parts.sort();
    return parts.join("|");
  }

  /**
   * THE act3a RE-TAME WITNESS (design §3a / onboarding line 120 — the tame→outgrow→re-tame gate).
   * Two halves, both folded:
   *   1. DIP — an active contract whose `breachSecondsAccum` crossed the near-breach threshold
   *      (NET_NEAR_BREACH_GRACE_FRACTION of the shared grace) while escalation was on: it dipped
   *      near-breach under risen load. (Reachable because the bandwidth axis bites when a coincident
   *      peak cuts its served bandwidth below its committed slaBandwidth floor — §4.3 — so the shared
   *      grace actually accrues.) Recorded in `nearBreachWitnessed`.
   *   2. RE-TAME — a witnessed contract back to fully SERVED on a SPLIT (un-shared) bridge: it is
   *      served AND it is the SOLE active loader of its chosen bridge sat — NO other active contract
   *      routes over the same sat this step. That un-shared state is the STRUCTURAL signature of the
   *      player's RELIEF (a parallel path + a net_set_prefer override SPLITS the shared sat so the
   *      corridor rides its OWN link), so the service is DURABLE — not a transient bursty trough where
   *      both sharing contracts happened to dip at once on a STILL-shared, still-oversubscribed sat.
   *      So the cycle (your success congests it, you re-engineer, it re-tames) is genuinely FELT, and
   *      the diurnal load merely dipping into a coincident trough on a shared link can NEVER spuriously
   *      latch it (the sat is still shared then). State-gated, not clock-timed. Pure.
   */
  private updateReTameWitness(contract: Contract, servedFraction: number): void {
    if (this.act3aReTameWitnessed) return; // once witnessed, latched (idempotent).
    // R0 (SD-45): the dip only counts when the BANDWIDTH axis is what is biting — the real
    // §4.3 squeeze. Under the pipe model a sole-pipe contract (the pointed corridor) dips on
    // ordinary horizon gaps (connectivity-binding); those must never arm the re-tame gate.
    const bindingBandwidth = this.lastSolve.get(contract.id)?.bindingConstraint === "bandwidth";
    const nearBreach =
      contract.breachSecondsAccum >= NET_NEAR_BREACH_GRACE_FRACTION * NET_BREACH_GRACE_SECONDS;
    if (nearBreach) {
      if (bindingBandwidth && !this.nearBreachWitnessed.has(contract.id)) {
        this.nearBreachWitnessed.set(contract.id, this.lastStepS);
      }
      return;
    }
    const dipAtS = this.nearBreachWitnessed.get(contract.id);
    if (dipAtS === undefined) return;
    if (servedFraction < ESCALATION_SERVE_THRESHOLD) return;
    // R0 (SD-45): the re-tame must be the PLAYER'S re-engineering, not a passing sat
    // transiently relieving the pipe — require a topology action strictly after the dip.
    if (this.lastPlayerTopoActionS === null || this.lastPlayerTopoActionS <= dipAtS) return;
    // The contract must be the SOLE active loader of its serving PIPE — the SPLIT happened (no
    // other active contract shares its chosen pipe this step). That is the structural signature of
    // the relief; a transient coincident trough on a still-SHARED pipe can never satisfy it.
    const bridgePipe = this.chosenPipeByContract.get(contract.id) ?? null;
    if (bridgePipe === null) return;
    for (const [otherId, otherPipe] of this.chosenPipeByContract) {
      if (otherId === contract.id) continue;
      const other = this.contractById(otherId);
      if (other?.state === "active" && otherPipe === bridgePipe) return; // still SHARED — not re-tamed.
    }
    // R0 (SD-45): sole-on-pipe must mean the SPLIT happened, not that the sharing partner got
    // knocked out this instant (its own floor bite momentarily clears its pipe assignment).
    // Require ALL active Earth contracts fully served — the network is genuinely all-green
    // after the relief, nobody was sacrificed. (One-tick staleness across the loop is
    // deterministic and acceptable.)
    for (const other of this.contractList) {
      if (other.id === contract.id || other.state !== "active") continue;
      if (other.region.bodyId !== "earth") continue;
      if (other.lastServedFraction < ESCALATION_SERVE_THRESHOLD) return; // not all-green yet.
    }
    // A dipped-then-re-tamed contract alone on its split bridge: the act3a concept is FELT. Latch it.
    this.act3aReTameWitnessed = true;
  }

  /**
   * THE FAULT ROLL (design §5 / Act 3b — "and faults degrade it"). Run ONLY when the fault
   * generator is gated ON (the act3b beat enabled it — itself FENCED behind the act3a gate, so a
   * fault can never fire before re-stabilisation). Off ⇒ NO rng draw, NO fault state ⇒ byte-
   * identical to the pre-act3b fold (golden-safe for Acts 1–3a). When on:
   *   1. roll {@link rollFaults} off the seeded {@link SimRng} (the M2 launch-failure-roll pattern,
   *      NO new seed / NO new action) with the active faults + the live roster + the scripted
   *      mild-first queue (scripted-first: the Degradation precedes the Telegraphed failure);
   *   2. CLEAR every SELF-RECOVERED fault (a degradation/transient that came back) and ADD every
   *      newly-started fault. A TELEGRAPHED fault that expired is NOT in `resolved` (P2 §5.1) — it
   *      stays in the active map as a PERMANENT drop, so {@link downSatIds} keeps removing its sat
   *      from the router graph (a warned failure the player did not replace is a real loss);
   *   3. consume the scripted queue head when its scripted fault actually fired this step (so the
   *      pair fires in order across steps, never re-queued).
   * The active fault map folds (sorted by satId); the rng is already folded. Pure off the stream.
   */
  private rollAndApplyFaults(t: number, dt: number): void {
    if (!this.faultsOn) return;
    // MILD-FIRST IN TIME (design §5.1 — a Degradation, THEN a Telegraphed failure): feed the roll
    // only the HEAD of the scripted queue, and advance the head ONLY once the prior scripted fault
    // has fully RESOLVED (recovered / dropped). So the Degradation fires first, the player weathers
    // it, and only after it self-recovers does the Telegraphed countdown begin — the pair is
    // sequenced over time, not fired together. The head is gated on `scriptedHeadPending`: it is
    // eligible to fire only when no PRIOR scripted fault is still active (the gate below).
    const headQueue =
      this.faultScriptQueue.length > 0 && this.scriptedHeadReady() ? [this.faultScriptQueue[0]] : [];
    const prev = [...this.activeFaults.values()];
    const result = rollFaults(prev, this.satList, t, dt, this.rng, headQueue);
    // CLEAR SELF-RECOVERED faults (the session frees the sat — a degradation/transient that came
    // back). A fault that SELF-RECOVERS on a sat the network kept SERVING THROUGH (servedThroughFault,
    // set by the prior step's witness) was WEATHERED — the player rode through its whole lifetime,
    // start → recover. Latch it. P2 (§5.1): `result.resolved` now EXCLUDES a telegraphed-expired
    // fault — its sat dropped PERMANENTLY (it stays in activeFaults, removed from the graph by
    // downSatIds), so a telegraphed failure is NEVER credited as "weathered/recovered" (the old bug).
    for (const satId of result.resolved) {
      this.activeFaults.delete(satId);
      if (this.servedThroughFault.delete(satId)) this.faultWeathered = true;
    }
    // ADD the newly-started faults (one per sat; the roll never double-faults a sat in a step).
    for (const f of result.started) this.activeFaults.set(f.satId, { ...f });
    // Advance the scripted mild-first queue: a scripted head that FIRED this step (a started fault
    // whose kind matches the head) is consumed, so the NEXT scripted fault becomes the head — but
    // it only fires once the just-started one resolves (the scriptedHeadReady gate). The head fault
    // is also stamped so its resolution gates the next (tracked via lastScriptedFaultSatId).
    if (headQueue.length > 0) {
      const head = headQueue[0];
      const fired = result.started.find((f) => f.kind === head.kind);
      if (fired !== undefined) {
        this.faultScriptQueue = this.faultScriptQueue.slice(1);
        this.lastScriptedFaultSatId = fired.satId;
      }
    }
  }

  /** Whether the scripted-queue HEAD is eligible to fire this step (the mild-first gate): true
   * when NO prior scripted fault is still active — so the Telegraphed failure begins only after the
   * Degradation has self-recovered (the pair is sequenced in time). The first scripted fault is
   * always ready (no prior). Pure read. */
  private scriptedHeadReady(): boolean {
    if (this.lastScriptedFaultSatId === null) return true; // no prior scripted fault ⇒ ready.
    return !this.activeFaults.has(this.lastScriptedFaultSatId); // prior resolved ⇒ ready.
  }

  /** The set of sat ids REMOVED from the routing graph this instant (a topology change, design
   * §2.4 / the router's `faults?` param): a transient outage, or a telegraphed fault whose
   * countdown has EXPIRED (before expiry a telegraphed sat still routes — the watch-and-act
   * window). A DEGRADATION is NOT here — it is a capacity haircut, not a removal (the sat still
   * routes). Empty when faults are off (⇒ the router sees `undefined` ⇒ byte-identical routing). */
  private downSatIds(t: number): Set<string> | undefined {
    if (!this.faultsOn || this.activeFaults.size === 0) return undefined;
    const down = new Set<string>();
    for (const f of this.activeFaults.values()) {
      if (faultRemovesSatAt(f, t)) down.add(f.satId);
    }
    return down.size > 0 ? down : undefined;
  }

  /** Apply the DEGRADATION capacity HAIRCUT to a per-PIPE shared-load aggregate (design §5.1): a
   * degraded sat still routes, but EVERY pipe it carries has its capacity scaled by
   * `degradedCapacityFactor ∈ (0,1]`. The router compares each pipe's shared load against that
   * antenna's own capacity, so we model the haircut by SCALING UP the degraded sat's pipes'
   * effective load by `1/factor` — the whole sat congests sooner (one fault domain: the
   * consolidator's bet, felt). Returns a NEW map; the folded chosen-pipe truth is untouched. Pure. */
  private applyDegradationHaircut(
    load: ReadonlyMap<string, number>,
  ): ReadonlyMap<string, number> {
    let touched = false;
    const out = new Map(load);
    for (const f of this.activeFaults.values()) {
      if (f.kind !== "degradation") continue;
      const factor = f.degradedCapacityFactor;
      if (!(factor > 0) || factor >= 1) continue; // no haircut (factor 1) or degenerate ⇒ skip.
      for (const [pipe, raw] of load) {
        const parsed = parsePipeKey(pipe);
        if (parsed === null || parsed.satId !== f.satId) continue;
        out.set(pipe, raw / factor); // effective load up ⇒ effective capacity down.
        touched = true;
      }
    }
    return touched ? out : load;
  }

  /** THE act3b WEATHER-A-FAULT WITNESS (the gate's first half) — MARK phase. AFTER serve/breach,
   * if ≥1 active fault coexists with ≥1 fully-served contract this step, the network kept serving
   * WHILE the sat was faulting — mark that sat's id in {@link servedThroughFault}. The LATCH fires
   * later, when that fault RESOLVES (in {@link rollAndApplyFaults}): the player rode through the
   * fault's WHOLE lifetime ⇒ weathered. So the gate needs a fault to be survived START→RECOVER, not
   * merely to appear (mild-first: the Degradation must self-recover before the witness latches).
   * Pure (reads the active faults + the contract states). */
  private updateFaultWeathered(): void {
    if (this.faultWeathered) return; // latched — nothing more to track.
    if (this.activeFaults.size === 0) return; // no fault this step.
    // Is the network still serving ≥1 contract this step (it kept working through the fault)?
    let serving = false;
    for (const c of this.contractList) {
      if (c.state === "active" && c.lastServedFraction >= ESCALATION_SERVE_THRESHOLD) {
        serving = true;
        break;
      }
    }
    if (!serving) return;
    // Mark every currently-faulting sat as "served through" — its later resolution latches weathered.
    for (const f of this.activeFaults.values()) this.servedThroughFault.add(f.satId);
  }

  /** THE TRACE DIAGNOSIS (design §2.6 / C2.5 — the single legibility surface). Run each step once
   * faults are on: feed {@link diagnose} the per-contract last SolveResults + the roster + the
   * active faults + the shared load (the read-over-snapshot input — it re-derives nothing). Latch
   * {@link surfacedShortfall} once it surfaces ≥1 shortfall (the act3b gate's layer-1 target), and
   * keep the report as a derived readout (the SYSTEM.LOG / shortfall lines / the predictability
   * seed). NOT folded — only the latched boolean folds. Pure read of the session snapshot. */
  private diagnoseTrace(t: number, loadByPipe: ReadonlyMap<string, number> | undefined): void {
    if (!this.faultsOn) return;
    const solves: ContractSolve[] = this.contractList.map((c) => ({
      contract: c,
      solve: this.lastSolve.get(c.id) ?? null,
    }));
    const report = diagnose({
      solves,
      sats: this.satList,
      faults: [...this.activeFaults.values()],
      // The trace thinks in SATS (the fleet surface): hand it the per-sat aggregate view.
      loadBySat: loadByPipe === undefined ? undefined : NetSession.satLoadView(loadByPipe),
      t,
    });
    this.lastTrace = report;
    if (report.shortfalls.length > 0) this.surfacedShortfall = true;
  }

  /**
   * THE ESCALATION LAW + THE BURSTY, NON-COINCIDENT LOAD (design §3a / §4.3, onboarding line 99).
   * Two layers, both deterministic + replay-safe:
   *
   *   1. THE SLOW BASELINE GROWTH (the §3a network effect). For each ACTIVE Earth contract served
   *      WELL the prior step (`lastServedFraction >= ESCALATION_SERVE_THRESHOLD`), grow its
   *      `loadBaseline` by the EXACT CLOSED-FORM LOGISTIC FLOW toward the ceiling over `dtSeconds`
   *      (the M2 dynamic-demand semigroup — DT-INVARIANT, bounded, no shock-compounding). A
   *      breaching/under-served contract does NOT grow its baseline ("demand grows where you serve").
   *
   *   2. THE BURSTY REALIZED LOAD (the §4.3 oversubscription tension). EVERY active Earth contract's
   *      `offeredLoad` is re-derived as the bursty {@link burstyOfferedLoad}(baseline, t, loadPhase,
   *      noise) — a periodic "diurnal" oscillation (a pure function of t — NO clock) PLUS a bounded
   *      noise term drawn from the session's SEEDED splitmix64 (NO unseeded random). The PER-CONTRACT
   *      `loadPhase` makes peaks NON-COINCIDENT: two contracts sharing one sat peak at DIFFERENT t
   *      (sharing is viable) unless their phases align (the shared link spikes over capacity and one
   *      tips toward breach — the statistical bet). The load RISES ABOVE and FALLS BELOW slaBandwidth
   *      over time. Even a breaching contract's load still oscillates (only the BASELINE is frozen).
   *
   * Once a served contract's BASELINE crosses ESCALATION_BANDWIDTH_AXIS_THRESHOLD the BANDWIDTH axis
   * is added to its `activeAxes` (the §4.4 escalation-triggered mask flip — keyed on the SLOW baseline
   * so it never flickers with the burst). The noise is drawn ONCE per active Earth contract per step,
   * in `contractList` order (deterministic), so the rng advances identically across runs/restores.
   * Folds via loadBaseline + offeredLoad + activeAxes + the rng state (all in netStateHash).
   */
  private stepEscalation(t: number, dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      // ACT 4 FENCE (§8): the escalation/oversubscription economy is an EARTH concept (act3a). The
      // Mars teaser is connectivity-only by SIGHT — NO freshness economy, NO bandwidth axis. Skip
      // any non-Earth contract so escalation never grows its load / flips its bandwidth axis.
      if (c.region.bodyId !== "earth") continue;
      // (1) Grow the SLOW BASELINE only where served WELL the prior step (a breaching/under-served
      // contract's baseline is frozen — "demand grows where you serve well"). The bursty oscillation
      // below still applies to a frozen-baseline contract (the load rises + falls; the baseline does not).
      if (c.lastServedFraction >= ESCALATION_SERVE_THRESHOLD) {
        c.loadBaseline = escalateLoad(c.loadBaseline, dtSeconds);
      }
      // (2) THE BURSTY REALIZED LOAD: a diurnal oscillation (periodic-of-t) + a bounded SEEDED noise
      // term, with the per-contract phase so peaks are non-coincident. The noise draw advances the
      // folded rng deterministically (one draw per active Earth contract per step, in list order).
      const noise01 = this.rng.nextDouble();
      c.offeredLoad = burstyOfferedLoad(c.loadBaseline, t, c.loadPhase, noise01);
      // The §4.4 escalation-triggered BANDWIDTH-axis mask flip — keyed on the SLOW baseline (a
      // monotone, replay-stable event; never flickers with the burst). Idempotent (Set add of a
      // present axis). Once on, the contract's committed slaBandwidth floor is enforced (§4.3).
      if (c.loadBaseline >= ESCALATION_BANDWIDTH_AXIS_THRESHOLD && !c.activeAxes.has("bandwidth")) {
        c.activeAxes = new Set<SlaAxis>([...c.activeAxes, "bandwidth"]);
      }
    }
  }

  /**
   * THE PER-TICK LOOP (the loop closes). Advance the session over `dtSeconds` of elapsed
   * sim-time at sim-time `t` (the END of the step). It:
   *   1. expires stale OFFERS via the IMPORTED {@link stepOfferedContract} (Act 1 offers do
   *      not auto-expire — there is no offer window on the net contract — so this is a no-op
   *      placeholder that keeps the SAME imported convention the m2 session uses);
   *   2. for each ACTIVE contract, derives its servedFraction from the router, accrues
   *      payPerSecond×fraction×dt (or −penalty×dt when wholly unserved) — SUMMED into ONE
   *      wallet add for DT-invariance — and advances the state machine via the IMPORTED
   *      {@link stepActiveContract} (which uses the IMPORTED {@link BREACH_GRACE_SECONDS}).
   *
   * Pure + deterministic: a function of (eph, t, dt) over the seeded RNG + the live roster.
   * The single summed wallet add is the DT-invariance guarantee. Call once per fixed tick.
   */
  step(eph: Ephemeris, t: number, dtSeconds: number): void {
    // (0) THE SCENARIO ENGINE (design §3) — emit the CURRENT beat once, BEFORE serve/breach,
    // so the Act-1 contract is on the board before its first solve. The emit is the only
    // authored arrival; it adds demand / flips a mask / enables a fault gen — never physics.
    this.emitCurrentBeat(t);

    // (0b) THE LAUNCH-EVENT PIPELINE (R0, m1-redesign §2.2): deploy any pending batch
    // members whose deploy instant arrived (a topology change), prune finished events.
    this.processPendingLaunches(t);

    // (1) Expire stale offers via the SHARED helper (the SAME breach/offer convention as
    // m2; on a net contract there is no offer window, so this is a safe no-op here). Using
    // the imported helper — not a net/ copy — keeps ONE convention in the codebase.
    for (const c of this.contractList) {
      if (c.state === "offered") stepOfferedContract(c, t);
    }

    // (2a) The AVAILABILITY clean-streak reset for a not-yet-ACTIVE availability contract
    // (§3.3, the gate-hardening field): while an availability-active demand is still OFFERED
    // (not yet accepted), the clean hand-off streak cannot have started — pin it to `t` so the
    // streak measures only sustained-clean time AFTER the contract is live (a freshly accepted
    // contract must still hold a full hand-off cycle before the gate fires, never from t=0).
    for (const c of this.contractList) {
      if (c.state !== "active" && c.activeAxes.has("availability")) this.cleanServedSinceS = t;
    }

    // (1b) THE TWO-PASS CONGESTION AGGREGATION (Act 3a / C1b — Pass A + Aggregate). Run ONLY when
    // escalation is gated ON (Acts 1–2: escalationOn=false ⇒ NO loadBySat, NO epoch bump ⇒ the
    // serve loop passes `undefined` ⇒ congestion_term 0 + epoch 0 ⇒ byte-identical routing + the
    // pre-Act-3 topologyKey, so Act-1/Act-2 + their fold are UNTOUCHED — golden-safe). When on:
    // rebuild the shared-load aggregate from the FOLDED prior chosen-sat map + current offeredLoad
    // (Pass A's one-tick lag, fully re-derivable across a restore — the MED desync fix), and bump
    // the congestion epoch when its quantized fingerprint changed (E3: a rising load ⇒ a re-solve
    // through the cache; a static load preserves it). The serve loop below is Pass B (the truth).
    let loadByPipe: ReadonlyMap<string, number> | undefined;
    if (this.escalationOn) {
      loadByPipe = this.loadByPipeFromState();
      const fp = this.congestionFingerprint(loadByPipe);
      if (fp !== this.prevCongestionFingerprint) {
        this.congestionEpoch++;
        this.prevCongestionFingerprint = fp;
      }
    }

    // (1c) THE FAULT ROLL (Act 3b / C2 — "and faults degrade it"). Run ONLY when the fault generator
    // is gated ON (the act3b beat enabled it — itself FENCED behind the act3a gate). OFF (Acts 1–3a)
    // ⇒ NO rng draw, NO fault state ⇒ the serve loop sees `undefined` faults + the raw loadBySat ⇒
    // byte-identical routing + fold (golden-safe). When on: draw the next-tick faults off the seeded
    // stream (scripted mild-first pair first, then the stochastic floor), update the active map, and
    // derive the DOWN-sat set (removed from the graph) + the degraded-capacity HAIRCUT load (a
    // degraded sat congests sooner). The serve loop routes around the down sats + bites the haircut.
    this.rollAndApplyFaults(t, dtSeconds);
    const downSats = this.downSatIds(t);
    const effLoad = this.faultsOn && loadByPipe !== undefined
      ? this.applyDegradationHaircut(loadByPipe)
      : loadByPipe;

    // (2) Accrue revenue + advance ACTIVE contract state machines (Pass B — the truth this tick).
    // One summed wallet add (revenue − opex). Each contract's freshly-chosen serving PIPE is
    // recorded back into chosenPipeByContract so NEXT step's aggregate reflects THIS routing.
    let netDelta = 0;
    // THE PER-SAT OPEX DRAIN (m1-redesign §2.5): owning hardware costs €/s by bus tier —
    // an idle fleet bleeds, so over-build reads in the ledger, not just in capex. DT-invariant
    // (rate × dt summed into the same single wallet add as revenue).
    for (const sat of this.satList) {
      netDelta -= BUS_SPECS[sat.bus].opexPerSecond * dtSeconds;
    }
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      const frac = this.servedFractionFor(eph, c, t, effLoad, downSats);
      // Record the chosen serving pipe for the two-pass aggregation; clear it when the
      // contract has no path this tick (so a dropped contract no longer loads a pipe).
      const chosen = this.lastSolve.get(c.id)?.pipe;
      if (chosen !== undefined && chosen !== null) this.chosenPipeByContract.set(c.id, chosen);
      else this.chosenPipeByContract.delete(c.id);
      // The AVAILABILITY clean-streak stamp (§3.3, the gate-hardening field): whenever an
      // availability-active contract feeds a 0 served-fraction (a breach reset — an instant gap
      // OR a rolling shortfall), the clean hand-off streak RESTARTS at this sim-time. The Act-2
      // gate fires only once the streak has run ≥ NET_HANDOFF_CYCLE_S, so a single served tick
      // mid-sawtooth cannot spuriously satisfy it. Pure (a function of t + the served fraction).
      if (frac <= 0 && c.activeAxes.has("availability")) this.cleanServedSinceS = t;
      // The € rate from the net contract's pay/penalty at this served fraction.
      const earned = netRevenueRatePerSecond(c, frac) * dtSeconds;
      netDelta += earned;
      recordNetEarned(c, earned);
      // The IMPORTED m2 transition (servedFraction, dt) — NO net/ copy. It advances the
      // served/breach accums + completes on term / fails past the IMPORTED grace.
      const wasActive = c.state === "active";
      stepActiveContract(c, frac, dtSeconds);
      // R3 (SD-45) — RENEWALS: a COMPLETED term immediately spawns its renewal offer (the
      // grown demand at a richer tariff, on a clock). Deterministic: keyed to the completion
      // transition inside the step; the renewal generation counts prior renewals of the id.
      if (wasActive && (c.state as ContractState) === "completed" && c.region.bodyId === "earth") {
        const baseId = c.id.split("+R")[0];
        let gen = 1;
        for (const other of this.contractList) {
          if (other.id.startsWith(`${baseId}+R`)) gen++;
        }
        this.addContract(renewalOffer(c, gen, t));
      }
      // THE act3a RE-TAME WITNESS (design §3a / onboarding line 120) — only while escalation is on.
      // FIRST half: a contract whose breach window crossed the near-breach threshold (it dipped
      // near-breach under risen load). SECOND half: a witnessed contract back to fully SERVED
      // (re-tamed) ⇒ the tame→outgrow→re-tame cycle is demonstrated (act3aReTameWitnessed=true).
      if (this.escalationOn) this.updateReTameWitness(c, frac);
      // ACT 4 (D1) — the Mars data FREEZES at arrival (the honest-staleness convention, SD-19):
      // when the Mars contract's path FIRST carries (served), capture the sample one-way OLD on
      // arrival (capturedAtT = t − one-way; half-life = the one-way light delay). It then DRAINS by
      // sight (freshness = 2^(−age/half)). A render-layer read only — no breach, no wallet (§8).
      if (c.id === ACT4_MARS_CONTRACT_ID && frac > 0 && this.marsSample === null) {
        const oneWayS = interBodyOneWayLatencyS(eph, "earth", "mars", t);
        this.marsSample = { datasetId: "mars", capturedAtT: t - oneWayS, halfLifeS: oneWayS };
      }
    }
    if (netDelta !== 0) this.walletBalance += netDelta;

    // (2c) THE ESCALATION LAW (design §3a / onboarding line 99 — "demand grows where you serve").
    // After serve/breach + revenue (so the step's € is keyed on the load at the START of the step
    // — DT-invariant, mirroring the M2 dynamic-demand cadence), grow each well-served contract's
    // offeredLoad logistically toward the ceiling, and flip the bandwidth axis on once it crosses
    // the escalation threshold (the §4.4 escalation-triggered mask add). Gated ON by act3a.
    if (this.escalationOn) this.stepEscalation(t, dtSeconds);

    // (2d) THE act3b WITNESSES + THE TRACE (Act 3b / C2). AFTER serve/breach (so the served fractions
    // + the SolveResults are this tick's truth) and only while faults are on. (i) WEATHER-A-FAULT:
    // latch once a contract stays served through an active fault (the gate's first half). (ii) THE
    // TRACE: run diagnose over the per-contract SolveResults + the active faults + the shared load,
    // latching surfacedShortfall once it surfaces ≥1 resilience/optimisation shortfall (the gate's
    // layer-1 target) and keeping the report as a derived readout (the SYSTEM.LOG / shortfall lines /
    // the predictability-seed loss roll). Both are pure reads; only the latched booleans fold.
    if (this.faultsOn) {
      this.updateFaultWeathered();
      this.diagnoseTrace(t, effLoad);
    }

    // (3) THE GATE (design §3) — AFTER serve/breach + revenue, so a contract that just got
    // served+paid THIS tick can open the next beat THIS tick. On the first true: record the
    // gate tick, advance the cursor, and emit the next beat — all deterministically in step
    // (so the whole arrival sequence is in the fold + replays bit-identically). The gate is
    // evaluated at most once per step; the cursor never moves more than one beat per tick.
    this.evaluateGate(t, dtSeconds);

    this.lastStepS = t;
  }

  /** Emit the current beat's authored arrival ONCE (design §3): the first emit puts the
   * Act-1 contract on the board; each subsequent beat emits when the cursor reaches it via
   * {@link evaluateGate}. Idempotent (the contract add is de-duped by id), and only fires
   * when a beat newly becomes current — so a restore re-emits nothing already past. Pure. */
  private emitCurrentBeat(t: number): void {
    if (this.emittedCursor >= this.scenarioCursor) return;
    const beat = this.scenario[this.scenarioCursor];
    if (beat !== undefined) beat.emit(this, t);
    this.emittedCursor = this.scenarioCursor;
  }

  /** Evaluate the current beat's completion predicate (design §3). On the FIRST true:
   * record the gate tick (tick = round(t/dt) at the fixed step), advance the cursor, and
   * emit the next beat — all inside step, so the transition is in the fold. The final beat
   * (act4) has a never-true gate (a read, not a gate), so the cursor stops there. Pure. */
  private evaluateGate(t: number, dtSeconds: number): void {
    const beat = this.scenario[this.scenarioCursor];
    if (beat === undefined) return; // cursor past the last beat: nothing to gate.
    if (!beat.gate(this, t)) return;
    const gateTick = dtSeconds > 0 ? Math.round(t / dtSeconds) : 0;
    this.advanceCursor(gateTick);
    // Emit the now-current (next) beat deterministically in the same step.
    this.emitCurrentBeat(t);
  }

  /** The current beat's gentle failure-to-progress assist (design §3 fallback / §2.6), or
   * null when the player is progressing. The render/trace reads this to surface the Act-1
   * "footprint does not reach [region]; try this preset" without doing it for the player. */
  currentShortfall(t: number): Shortfall | null {
    const beat = this.scenario[this.scenarioCursor];
    if (beat === undefined || beat.fallback === undefined) return null;
    return beat.fallback(this, t);
  }

  /** Capture the whole net session by value (save/snapshot/state-hash). */
  snapshot(): NetSnapshot {
    return {
      roster: this.satList.map((s) => ({
        ...s,
        orbit: { ...s.orbit },
        loadout: s.loadout.map((a) => ({ ...a })),
      })),
      balance: this.walletBalance,
      rngState: this.rng.state.toString(),
      launchedCount: this.launchedCount,
      contracts: this.contractList.map(cloneNetContract),
      scenarioCursor: this.scenarioCursor,
      gateTicks: this.gateTicks.slice(),
      lastStepS: this.lastStepS,
      cleanServedSinceS: this.cleanServedSinceS,
      wasteLoggedSats: this.wasteLoggedSats,
      // ACT-3a (C1b) escalation + congestion fold state. chosenSatByContract is captured as sorted
      // [id, satId] pairs so loadBySat is a pure function of folded state across a restore.
      escalationOn: this.escalationOn ? 1 : 0,
      congestionEpoch: this.congestionEpoch,
      chosenPipeByContract: [...this.chosenPipeByContract.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      ),
      act3aReTameWitnessed: this.act3aReTameWitnessed ? 1 : 0,
      nearBreachWitnessed: [...this.nearBreachWitnessed.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      ),
      playerTopoActionS: this.lastPlayerTopoActionS,
      congestionFingerprint: this.prevCongestionFingerprint,
      // ACT-3b (C2) fault + trace fold state. activeFaults is captured SORTED by satId (by value)
      // so the fold never depends on Map insertion order; the script queue keeps order (the
      // mild-first sequence); the witnesses are ints. The lastTrace report is DERIVED (not folded).
      faultsOn: this.faultsOn ? 1 : 0,
      activeFaults: [...this.activeFaults.values()]
        .sort((a, b) => (a.satId < b.satId ? -1 : a.satId > b.satId ? 1 : 0))
        .map((f) => ({ ...f })),
      faultScriptQueue: this.faultScriptQueue.map((s) => ({ ...s })),
      lastScriptedFaultSatId: this.lastScriptedFaultSatId,
      faultWeathered: this.faultWeathered ? 1 : 0,
      servedThroughFault: [...this.servedThroughFault].sort(),
      surfacedShortfall: this.surfacedShortfall ? 1 : 0,
      // ACT-4 (D1) the Mars frontier teaser — the ONE folded slot (2 floats + a null-flag), captured
      // by value so a snapshot never shares the live sample. Null until the Mars path first carries
      // / the cache breadcrumb is placed.
      marsSample: this.marsSample === null ? null : { ...this.marsSample },
      // R0 (SD-45): beams + the launch pipeline + underburns — all by value, sorted for
      // fold stability.
      beamAssign: [...this.beamAssign.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      ),
      pendingLaunches: this.pendingLaunchList.map((ev) => ({
        ...ev,
        members: ev.members.map((m) => ({
          ...m,
          sat: {
            ...m.sat,
            orbit: { ...m.sat.orbit },
            loadout: m.sat.loadout.map((a) => ({ ...a })),
          },
        })),
      })),
      underburnIntended: [...this.underburnIntended.entries()].sort((a, b) =>
        a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0,
      ),
      launchCommits: this.launchCommits,
    };
  }

  /** Restore the whole net session from a snapshot (the ephemeris is unchanged). */
  restore(s: NetSnapshot): void {
    this.satList.length = 0;
    for (const sat of s.roster) {
      this.satList.push({
        ...sat,
        orbit: { ...sat.orbit },
        loadout: sat.loadout.map((a) => ({ ...a })),
      });
    }
    this.walletBalance = s.balance;
    this.rng.state = BigInt(s.rngState);
    this.launchedCount = s.launchedCount;
    this.contractList.length = 0;
    for (const c of s.contracts) this.contractList.push(cloneNetContract(c));
    this.scenarioCursor = s.scenarioCursor;
    // Every beat up to the restored cursor has already emitted (its contracts are in the
    // restored list), so mark them emitted — a restored session re-emits nothing past.
    this.emittedCursor = s.scenarioCursor;
    this.gateTicks.length = 0;
    for (const gt of s.gateTicks) this.gateTicks.push(gt);
    this.lastStepS = s.lastStepS;
    this.cleanServedSinceS = s.cleanServedSinceS;
    this.wasteLoggedSats = s.wasteLoggedSats;
    // ACT-3a (C1b) escalation + congestion fold state. Nullish-coalesced so a pre-C1b snapshot
    // restores to the dormant defaults (escalation off, epoch 0, empty maps) — byte-identical to
    // the Act-1/Act-2 fold. chosenSatByContract + prevCongestionFingerprint make loadBySat a pure
    // function of folded state across the restore boundary (restore-then-step == continuous-run).
    this.escalationOn = (s.escalationOn ?? 0) === 1;
    this.congestionEpoch = s.congestionEpoch ?? 0;
    this.chosenPipeByContract.clear();
    for (const [id, pipe] of s.chosenPipeByContract ?? []) this.chosenPipeByContract.set(id, pipe);
    this.act3aReTameWitnessed = (s.act3aReTameWitnessed ?? 0) === 1;
    this.nearBreachWitnessed.clear();
    for (const [id, dipAtS] of s.nearBreachWitnessed ?? []) this.nearBreachWitnessed.set(id, dipAtS);
    this.lastPlayerTopoActionS = s.playerTopoActionS ?? null;
    this.prevCongestionFingerprint = s.congestionFingerprint ?? "";
    // ACT-3b (C2) fault + trace fold state. Nullish-coalesced so a pre-C2 snapshot restores to the
    // dormant defaults (faults off, empty maps/queue, no witness) — byte-identical to the Acts 1–3a
    // fold. The active fault map + the script queue make the fault stream a pure function of folded
    // state across the restore boundary (restore-then-step == continuous-run); the lastTrace report
    // is DERIVED (re-built on the next stepped tick), so it is not restored.
    this.faultsOn = (s.faultsOn ?? 0) === 1;
    this.activeFaults.clear();
    for (const f of s.activeFaults ?? []) this.activeFaults.set(f.satId, { ...f });
    this.faultScriptQueue = (s.faultScriptQueue ?? []).map((sc) => ({ ...sc }));
    this.lastScriptedFaultSatId = s.lastScriptedFaultSatId ?? null;
    this.faultWeathered = (s.faultWeathered ?? 0) === 1;
    this.servedThroughFault.clear();
    for (const id of s.servedThroughFault ?? []) this.servedThroughFault.add(id);
    this.surfacedShortfall = (s.surfacedShortfall ?? 0) === 1;
    this.lastTrace = null;
    // ACT-4 (D1) the Mars frontier teaser — the ONE folded slot. Nullish-coalesced so a pre-D1
    // snapshot restores to null (byte-identical to the Acts 1–3 fold); captured by value.
    this.marsSample = s.marsSample == null ? null : { ...s.marsSample };
    // R0 (SD-45): beams + the launch pipeline + underburns. Nullish-coalesced for pre-R0 saves.
    this.beamAssign.clear();
    for (const [k, v] of s.beamAssign ?? []) this.beamAssign.set(k, v);
    this.pendingLaunchList = (s.pendingLaunches ?? []).map((ev) => ({
      ...ev,
      members: ev.members.map((m) => ({
        ...m,
        sat: {
          ...m.sat,
          orbit: { ...m.sat.orbit },
          loadout: m.sat.loadout.map((a) => ({ ...a })),
        },
      })),
    }));
    this.underburnIntended.clear();
    for (const [k, v] of s.underburnIntended ?? []) this.underburnIntended.set(k, v);
    this.launchCommits = s.launchCommits ?? 0;
    // The cached router paths are derived; the next step() rebuilds them on a full search
    // (the topology key for a restored roster differs from the empty initial state).
    this.routerStates.clear();
    this.lastSolve.clear();
  }

  /**
   * Fold the `activeAxes` mask of a contract by the FIXED INTEGER ORDINAL (design §4): a
   * caller's state-hash uses this so the fold NEVER depends on Set iteration order or a
   * string sort of mutable labels. Returns the present axes' ordinals, ASCENDING. Exposed
   * here so the A3 golden test folds the mask through the one canonical path.
   */
  static foldAxisOrdinals(activeAxes: ReadonlySet<SlaAxis>): number[] {
    const out: number[] = [];
    // Iterate the ordinal map ASCENDING (connectivity=0, …, bandwidth=3); push present ones.
    const axes = Object.keys(SLA_AXIS_ORDINAL) as SlaAxis[];
    axes.sort((a, b) => SLA_AXIS_ORDINAL[a] - SLA_AXIS_ORDINAL[b]);
    for (const ax of axes) {
      if (activeAxes.has(ax)) out.push(SLA_AXIS_ORDINAL[ax]);
    }
    return out;
  }
}
