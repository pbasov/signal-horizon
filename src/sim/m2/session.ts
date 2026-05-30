/**
 * M2c — the BUILD SESSION: the player's deterministic build-the-monument state
 * (GDD §3 "gap → asset → integration → revenue", §1/§5 the monument, §4.7 launch).
 *
 * This is the M2 sibling of {@link import("../m1/session").M1Session}: a PURE,
 * deterministic, SAVEABLE state — the placeable-asset {@link Roster} + a € wallet +
 * a launch PRNG — driven by LOGGED player actions (deploy a ground station, launch
 * a sat) applied at a tick. It owns NO render concern. The coverage field/score
 * read the LIVE roster, so building grows the coverage web.
 *
 * --- DETERMINISM (its OWN replay path, separate from the M1 golden) ----------
 * The build session is a SEPARATE world from the M1 cache/economy session, so it
 * carries its OWN seeded splitmix64 PRNG (for launch failure rolls AND the M2d
 * contract-offer generator) and its OWN snapshot/state-hash + replay golden — the M1
 * golden stays untouched. Every mutation flows through {@link deployGround} /
 * {@link launchSat} / {@link acceptContract} / {@link declineContract}, applied at a
 * tick by the shared applier, plus a per-tick {@link BuildSession.step} that advances
 * the deterministic contract economy, so a recorded sequence replays bit-identically:
 *   - deploys are pure (a candidate-site index → lat/lon, a fixed € charge);
 *   - launches draw ONE u64 from the seeded PRNG for the failure roll;
 *   - the contract generator draws its offers from the SAME seeded PRNG (target/term/
 *     interval), and revenue accrual is a pure function of (live coverage, dt).
 *
 * --- M2d: THE PER-TICK CONTRACT ECONOMY (the loop CLOSES) -------------------
 * M2c was EVENT-DRIVEN (state changed only on a logged action). M2d adds
 * {@link BuildSession.step}: each tick it (a) advances the deterministic offer
 * generator (offer/expire contracts), (b) for each ACTIVE contract computes its served
 * fraction from the LIVE roster coverage and accrues tariff × fraction × dt into the
 * wallet (DT-invariant, mirroring the SD-20 continuous M1 economy), and (c) advances
 * the contract state machines (complete on term, breach/fail on sustained under-cover).
 * So building coverage now EARNS € back — gap → asset → integration → REVENUE (§3).
 *
 * No three / DOM / wall-clock; randomness only via the seeded {@link SimRng}.
 */

import type { Ephemeris, Vec3 } from "../ephemeris";
import { SimRng } from "../rng";
import { M1Economy } from "../m1/economy";
import { GeodesicGrid } from "../coverage/grid";
import { DemandField } from "../coverage/demand";
import { DynamicDemand, GROWTH_INTEGRATION_SECONDS } from "../coverage/dynamic-demand";
import { servedFractionAt, servedQualityAt } from "../coverage/score";
import type { CellCoverage } from "../coverage/field";
import { Roster, type RosterSnapshot } from "./roster";
import { CANDIDATE_SITES, GROUND_DEPLOY_COST, GROUND_EIRP, STARTER } from "./sites";
import {
  LAUNCH_PRESETS,
  presetById,
  resolveLaunchOrbit,
  rollLaunch,
  type LaunchPreset,
} from "./launch";
import {
  type Contract,
  type ContractTarget,
  cloneContract,
  contractRevenueRatePerSecond,
  offerContract,
  recordEarned,
  resolveTargetCells,
  stepActiveContract,
  stepOfferedContract,
  DEFAULT_TARGET_RADIUS_DEG,
  DEFAULT_TERM_SECONDS,
  DEFAULT_OFFER_WINDOW_SECONDS,
} from "./contracts";
import { ContractGenerator, type GeneratorSnapshot } from "./contract-generator";
import { EventGenerator, type EventGeneratorSnapshot, type EmitPlan } from "./event-generator";
import { M2EventLog, type M2Event } from "./events";

/** Opening € for a build session — enough to deploy a few stations + buy a launch
 * or two, little enough that building is a budget choice (the build-vs-budget
 * tension, GDD §3/§4.9). Placeholder; M2d's contract revenue refills it. */
export const BUILD_OPENING_BALANCE = 5000.0;

/** Seed for the build session's launch-failure PRNG (a fixed determinism anchor;
 * the live main.ts + the replay test both start from this so a live-saved build
 * replays). Distinct from the M1 session's anchor. Chosen so the golden build log's
 * launches hit BOTH a success and a deterministic FAILURE (exercising the risk). */
export const BUILD_RNG_SEED = 7n;

/** M2f — the € TARIFF MULTIPLIER on a contract spawned by a rival RELAY_FAILURE ("their customers
 * come knocking"): the desperate hand-off pays a premium over a normal offer, so it is the
 * lucrative-but-time-pressured opportunity the story beat creates. Placeholder. */
export const RELAY_FAILURE_TARIFF_BONUS = 1.6;

/** M2f — an ACTIVE demand shock the session is riding: a region's cells, a peak multiplier, and a
 * lifetime. The per-step shock overlay is the peak DECAYING LINEARLY to 1.0 over [startS, startS +
 * durationS), so coverage/contracts react to the spike then it cleanly returns to baseline (no
 * permanent drift — when t passes the end the shock drops out of the list entirely). */
export interface ActiveShock {
  cellIds: number[];
  multiplier: number;
  startS: number;
  durationS: number;
}

/** The outcome of applying a build action (for the live caller's feedback + log). */
export interface BuildActionResult {
  /** What happened: a deploy, a (failed) launch, a contract accept/decline, rejected. */
  kind:
    | "ground_deployed"
    | "sat_launched"
    | "launch_failed"
    | "contract_accepted"
    | "contract_declined"
    | "rejected";
  /** The new asset's id when one was added (deploy / successful launch). */
  assetId?: string;
  /** € charged by this action (0 when rejected). */
  costEur: number;
  /** For a launch: the preset's label (for the readout/log). */
  presetLabel?: string;
  /** For a launch: the [0,1) PRNG roll the outcome was decided on. */
  roll?: number;
  /** For an accept/decline: the affected contract (for the live caller's feedback). */
  contract?: Contract;
}

/** JSON-safe capture of the whole build session (save/restore + state-hash parity). */
export interface BuildSnapshot {
  roster: RosterSnapshot;
  balance: number;
  /** The launch + contract-generator PRNG state (a u64) — string (JSON has no bigint). */
  rngState: string;
  /** How many sats have been LAUNCHED successfully (drives the constellation phase). */
  launchedCount: number;
  /** M2d — every contract (offered/active/completed/failed), by value, in offer order. */
  contracts: Contract[];
  /** M2d — the offer generator's schedule cursor (next-offer time + offered counter). */
  generator: GeneratorSnapshot;
  /** M2d — the sim-time the session has been STEPPED to (so revenue resumes seamlessly). */
  lastStepS: number;
  /** M2e — the ESCALATION ENGINE's live per-cell demand (grows under service). Folds
   * into the replay hash so the dynamic demand reproduces on replay/restore. */
  demand: number[];
  /** M2e — the sim-time growth was last integrated to + the next cadence boundary (so a
   * save/restore resumes the escalation engine on the exact same cadence). */
  lastGrowthAtS: number;
  nextGrowthAtS: number;
  /** M2f — the emergent-event generator's schedule cursor (next-event time + emitted counter). */
  eventGenerator: EventGeneratorSnapshot;
  /** M2f — the active demand shocks the session is riding (region cells + peak + lifetime). They
   * apply a temporary multiplier to the dynamic demand that decays to baseline + expires cleanly. */
  activeShocks: ActiveShock[];
  /** M2f — monotonic counter for rival-failure-spawned contract ids (`r{N}`). */
  spawnedContractCount: number;
  /** M2f — the surfaced world-event stream (demand shocks / rival actions / news), folded so a
   * restored game shows the same history + reproduces the same state-hash. */
  events: { events: M2Event[]; nextSeq: number };
}

export class BuildSession {
  /** The deterministic placeable-asset roster (the monument's state). */
  readonly roster = new Roster();
  /** The € wallet (reuses the M1 economy's one-shot-charge API). */
  readonly economy: M1Economy;
  /** The seeded PRNG for launch-failure rolls AND the M2d contract-offer generator
   * (the ONLY randomness, seeded — one stream so the snapshot is single-sourced). */
  private rng: SimRng;
  /** Successful launches so far — fans the next launch's constellation phase. */
  private launchedCount = 0;

  // --- M2d: the contract economy ---------------------------------------------
  /** The coverage grid + demand field the contracts target + the served fraction
   * reads (built once; the SAME default-level grid the live render scores). Pure.
   *
   * M2e — the demand is now DYNAMIC (the escalation engine): a per-cell CURRENT demand
   * that GROWS where the network serves (GDD §3b). It exposes the SAME read surface as a
   * static {@link DemandField} (`of`/`total`), so the contract served-fraction + score
   * readers use it as a drop-in CURRENT field; the session advances its growth each step. */
  private readonly grid: GeodesicGrid;
  private readonly demand: DynamicDemand;
  /** M2e — reusable per-cell served-quality scratch (0/1 per cell) the demand growth
   * reads (grown to the grid size once; no per-step allocation after that). */
  private servedQuality: number[] = [];
  /** M2e — the sim-time the demand growth was last integrated to, and the next cadence
   * boundary it fires at. Triggering on the sim-time `t` (which a fixed-step caller hits
   * EXACTLY at tick multiples, e.g. tick·(1/60) === 60 at tick 3600) — rather than on a
   * drifting elapsed-time accumulator — is what makes growth DT-INVARIANT: a fine (dt=1/60)
   * and a coarse (dt=60) caller both fire at the SAME boundary t and sample the SAME
   * geometry there, so the discontinuous 0/1 served-quality gate can't flip between them.
   * Both fold into the snapshot so growth resumes exactly mid-cadence after save/restore. */
  private lastGrowthAtS = 0;
  private nextGrowthAtS = GROWTH_INTEGRATION_SECONDS;
  /** Every contract this session has seen, in offer order (offered/active/done/failed). */
  private readonly contractList: Contract[] = [];
  /** The deterministic offer generator (draws targets/terms/intervals from {@link rng}). */
  private readonly generator = new ContractGenerator();

  // --- M2f: the emergent-event generator (the story layer) -------------------
  /** The deterministic emergent-event generator (draws type/region/multiplier/rival/headline
   * from the SAME seeded {@link rng} — same seed ⇒ same event timeline). Advanced in {@link step}. */
  private readonly eventGenerator = new EventGenerator();
  /** The surfaced world-event stream (demand shocks / rival actions / news) — the truthful M2 feed
   * the SYSTEM.LOG renders. Folds into the snapshot/state-hash (the events ARE saved state). */
  private readonly eventLog = new M2EventLog();
  /** The active demand shocks (each: region cells + peak multiplier + lifetime). The per-step
   * overlay decays each to baseline and drops it when expired — applied via the dynamic demand's
   * {@link DynamicDemand.setShockMultipliers}. Reconstructed on restore from the snapshot. */
  private activeShocks: ActiveShock[] = [];
  /** Reusable per-cell shock-multiplier scratch (grown to the grid size once; rebuilt each step
   * from {@link activeShocks} — no per-step allocation after the first grow). */
  private shockMulScratch: number[] = [];
  /** Monotonic counter for rival-failure-spawned contract ids (`r0`, `r1`… — distinct from the
   * ContractGenerator's `c{N}` stream so the two never collide). */
  private spawnedContractCount = 0;

  /** Sim-time the session has been STEPPED to (for snapshot-resume continuity). */
  private lastStepS = 0;
  /** Reusable scratch for served-fraction reads + a single CellCoverage (no per-step
   * allocation once the roster has settled). */
  private scratchPos: Vec3[] = [];
  /** Cached per-asset EIRP array, rebuilt only when the roster size changes (eirps are
   * fixed per asset, so this is stable between deploys/launches — no per-tick alloc). */
  private eirpCache: number[] = [];
  private readonly scratchCov: CellCoverage = {
    cellId: -1,
    connectivity: 0,
    bandwidth: 0,
    latencyS: Infinity,
    links: [],
  };

  constructor(
    openingBalance = BUILD_OPENING_BALANCE,
    seed: bigint = BUILD_RNG_SEED,
    grid?: GeodesicGrid,
    demand?: DemandField,
  ) {
    this.economy = new M1Economy(openingBalance);
    this.rng = new SimRng(seed);
    this.grid = grid ?? GeodesicGrid.build();
    // M2e — build the DYNAMIC demand from the static baseline (the M2a field stays the
    // immutable floor the dynamic overlay grows above + decays back toward).
    this.demand = DynamicDemand.build(this.grid, demand ?? DemandField.build(this.grid));
    // Boot with a SMALL starter roster so the coverage web is not empty but building
    // still matters (a couple of ground stations over demand + one LEO sat).
    for (const s of STARTER.grounds) {
      this.roster.deployGround(s.bodyId, s.latRad, s.lonRad, GROUND_EIRP, s.altitudeM);
    }
    for (const orb of STARTER.sats) this.roster.launchSat(orb, orb.eirp);
  }

  /** On-hand € balance. */
  get balance(): number {
    return this.economy.balance;
  }

  /** True once the balance has gone negative (overspent on building). */
  get bankrupt(): boolean {
    return this.economy.bankrupt();
  }

  /** The launch board (presets) for the UI. */
  get presets(): readonly LaunchPreset[] {
    return LAUNCH_PRESETS;
  }

  /**
   * DEPLOY a ground station at candidate SITE `siteIndex` (wraps the candidate
   * list). Charges {@link GROUND_DEPLOY_COST} (always — deploy is instant + cheap)
   * and adds the station to the roster. Returns the outcome. Rejected only if the
   * site index is empty (no candidates) — overspending is ALLOWED (the build-vs-
   * budget tension; the balance can go negative). Deterministic + pure.
   */
  deployGround(siteIndex: number): BuildActionResult {
    if (CANDIDATE_SITES.length === 0) return { kind: "rejected", costEur: 0 };
    const n = CANDIDATE_SITES.length;
    const site = CANDIDATE_SITES[((siteIndex % n) + n) % n];
    this.economy.apply(-GROUND_DEPLOY_COST);
    const id = this.roster.deployGround(site.bodyId, site.latRad, site.lonRad, GROUND_EIRP, site.altitudeM);
    return { kind: "ground_deployed", assetId: id, costEur: GROUND_DEPLOY_COST };
  }

  /**
   * LAUNCH a satellite into preset `presetId` at sim-time `t`. Charges the preset's
   * € (always — you pay the launch provider win or lose), then rolls the failure
   * chance from the SEEDED PRNG. On success the sat reaches orbit at t and joins the
   * roster (its coverage starts immediately); on failure nothing is added (you ate
   * the loss). Returns the outcome. Rejected only for an unknown preset id.
   */
  launchSat(presetId: string, t: number): BuildActionResult {
    const preset = presetById(presetId);
    if (preset === null) return { kind: "rejected", costEur: 0 };
    this.economy.apply(-preset.costEur);
    const roll = rollLaunch(this.rng, preset);
    if (!roll.ok) {
      return { kind: "launch_failed", costEur: preset.costEur, presetLabel: preset.label, roll: roll.roll };
    }
    const orbit = resolveLaunchOrbit(preset, this.launchedCount, t);
    this.launchedCount++;
    const id = this.roster.launchSat(orbit, preset.eirp);
    return { kind: "sat_launched", assetId: id, costEur: preset.costEur, presetLabel: preset.label, roll: roll.roll };
  }

  // --- M2d: contracts ---------------------------------------------------------

  /** A read-only view of every contract, in offer order (the panel reads this). */
  get contracts(): readonly Contract[] {
    return this.contractList;
  }

  /** Per-asset EIRP, cached + reused between ticks (rebuilt only when the roster size
   * changes — eirps are fixed per asset). Avoids a per-tick array allocation. */
  private cachedEirps(): number[] {
    if (this.eirpCache.length !== this.roster.count) this.eirpCache = this.roster.eirps();
    return this.eirpCache;
  }

  /** Find a contract by id (null if unknown). */
  private contractById(id: string): Contract | null {
    return this.contractList.find((c) => c.id === id) ?? null;
  }

  /**
   * ACCEPT an OFFERED contract by id, moving it OFFERED → ACTIVE at sim-time `t` so it
   * begins accruing revenue from the live coverage of its region. Rejected (no state
   * change) if the id is unknown or the contract is not currently OFFERED. Pure +
   * deterministic. Returns the outcome (the contract is included for the live feedback).
   */
  acceptContract(contractId: string, t: number): BuildActionResult {
    const c = this.contractById(contractId);
    if (c === null || c.state !== "offered") return { kind: "rejected", costEur: 0 };
    c.state = "active";
    c.activatedAtS = t;
    return { kind: "contract_accepted", costEur: 0, contract: c };
  }

  /**
   * DECLINE an OFFERED contract by id, retiring the offer (OFFERED → FAILED, i.e. not
   * taken — it leaves the open-offer board). Rejected if unknown / not offered. Pure.
   */
  declineContract(contractId: string): BuildActionResult {
    const c = this.contractById(contractId);
    if (c === null || c.state !== "offered") return { kind: "rejected", costEur: 0 };
    c.state = "failed";
    return { kind: "contract_declined", costEur: 0, contract: c };
  }

  /**
   * The SERVED FRACTION ∈ [0,1] of a contract's target region right now, from the LIVE
   * roster coverage at sim-time `t` (the demand-weighted fraction of the region's cells
   * covered at/above the contract's quality bar). The same coverage truth the heatmap
   * reads. Pure; reuses session scratch (no per-call allocation once settled).
   */
  servedFraction(eph: Ephemeris, contract: Contract, t: number): number {
    this.scratchPos = this.roster.worldPositions(eph, t, this.scratchPos);
    const eirps = this.cachedEirps();
    const center = eph.position("earth", t);
    const radius = eph.radiusMeters("earth");
    return servedFractionAt(
      this.grid,
      this.demand,
      contract.cellIds,
      contract.qualityThreshold,
      eirps,
      this.scratchPos,
      center,
      radius,
      this.scratchCov,
    );
  }

  /**
   * THE PER-TICK CONTRACT ECONOMY (M2d — the loop closes). Advances the session over
   * `dtSeconds` of ELAPSED SIM-TIME at sim-time `t` (the END of the step). It:
   *
   *   1. advances the deterministic offer GENERATOR (offers/expires contracts off the
   *      seeded PRNG — same seed ⇒ same offer timeline);
   *   2. for each ACTIVE contract, computes its served fraction from the LIVE roster
   *      coverage and accrues tariff × fraction × dt (or a NEGATIVE breach-penalty × dt
   *      when wholly unserved) — SUMMED into ONE wallet apply() per step, so the revenue
   *      is DT-INVARIANT (same sim-time ⇒ same €, at 1× or Nx);
   *   3. advances each ACTIVE contract's state machine (complete on term / fail on a
   *      sustained breach past the grace), and expires stale OFFERS.
   *
   * Pure + deterministic: a function of (eph, t, dt) over the seeded PRNG + the live
   * roster. The single summed apply() is the DT-invariance guarantee. Idempotent shape:
   * call it once per fixed tick with that tick's dt (mirrors the M1 session's step()).
   */
  step(eph: Ephemeris, t: number, dtSeconds: number): void {
    // (1) Advance the offer generator (offer/expire contracts deterministically). It
    // reads the CURRENT (dynamic) demand, so an offer over a region that has grown is
    // priced off the bigger demand — the §4.9 + §3b coupling.
    this.generator.step(this.contractList, this.rng, this.grid, this.demand, t);

    // (1a) M2f — THE EMERGENT-EVENT GENERATOR (the story layer, §3 / Risk-7). Advance off the SAME
    // seeded RNG (fixed draw order AFTER the offer generator ⇒ deterministic), then turn each due
    // EmitPlan into reality: a DEMAND_SHOCK registers a temporary region multiplier on the demand,
    // a rival RELAY_FAILURE spawns a lucrative contract offer ("customers come knocking"), every
    // event is surfaced as a TRUTHFUL log line. Usually 0 plans; rarely 1.
    for (const plan of this.eventGenerator.step(this.rng, t)) {
      this.executeEmitPlan(plan, t, dtSeconds);
    }

    // (1b) M2f — apply the ACTIVE-SHOCK overlay to the dynamic demand at t: each shock's multiplier
    // DECAYS LINEARLY to 1.0 over its lifetime, expired shocks are dropped (clean return to
    // baseline — no permanent drift). Done BEFORE revenue accrual so the shocked demand is what
    // contracts/coverage/score read THIS step (the world coupling: a shock over a region you serve
    // spikes its value + strains capacity). Cheap; runs every step so an expired shock resets.
    this.applyShockOverlay(t);

    // (1b) Expire stale OFFERS (cheap — no coverage needed) and note any ACTIVE ones.
    let anyActive = false;
    for (const c of this.contractList) {
      if (c.state === "offered") stepOfferedContract(c, t);
      else if (c.state === "active") anyActive = true;
    }
    this.lastStepS = t;

    // Precompute the roster world positions + body geometry ONCE for this step's t (the
    // same instant the revenue read + the escalation sweep use). Cheap when the roster is
    // empty; this is the only Kepler propagation of the step.
    let positionsReady = false;
    const eirps = this.cachedEirps();
    let center: Vec3 = [0, 0, 0];
    let radius = 0;
    const ensurePositions = (): void => {
      if (positionsReady) return;
      this.scratchPos = this.roster.worldPositions(eph, t, this.scratchPos);
      center = eph.position("earth", t);
      radius = eph.radiusMeters("earth");
      positionsReady = true;
    };

    // (2)+(3) Accrue revenue + advance state machines, reading the CURRENT (dynamic) demand
    // (so a contract over a region whose demand has GROWN is harder to keep at full serve —
    // the served fraction is weighted by the now-bigger demand: the escalation BITE). The
    // revenue is accrued BEFORE the demand growth below, so a step's € is keyed on the demand
    // at the START of the step — making it DT-invariant w.r.t. the growth cadence (both a fine
    // and a coarse caller accrue over the same piecewise-constant demand). One summed wallet
    // apply() for DT-invariance.
    if (anyActive) {
      ensurePositions();
      let netDelta = 0;
      for (const c of this.contractList) {
        if (c.state !== "active") continue;
        const frac = servedFractionAt(
          this.grid,
          this.demand,
          c.cellIds,
          c.qualityThreshold,
          eirps,
          this.scratchPos,
          center,
          radius,
          this.scratchCov,
        );
        const earned = contractRevenueRatePerSecond(c, frac) * dtSeconds;
        netDelta += earned;
        recordEarned(c, earned);
        stepActiveContract(c, frac, dtSeconds);
      }
      if (netDelta !== 0) this.economy.apply(netDelta);
    }

    // (4) THE ESCALATION ENGINE (M2e). Once sim-time crosses the next fixed-cadence boundary,
    // sample the whole-grid served-quality at t and advance the dynamic demand by the EXACT
    // CLOSED-FORM logistic flow over the elapsed time since the last fire — a cell served
    // at/above the bar GAINS demand (GDD §3b generator 1, "demand grows where you serve"), so
    // its served-fraction erodes under fixed capacity → revenue dips → you must EXPAND. Firing
    // on a fixed sim-time cadence (not every 1/60 s tick) keeps the per-tick cost flat AND
    // keeps growth DT-invariant (see {@link lastGrowthAtS}). Runs even with no active contract
    // — demand grows wherever the network serves, contract or not.
    if (t >= this.nextGrowthAtS) {
      ensurePositions();
      // The growth bar mirrors the contract quality bar (connectivity ≥ 1): demand grows on
      // the same "is it served?" gate the heatmap + contracts read.
      servedQualityAt(this.grid, 1, eirps, this.scratchPos, center, radius, this.servedQuality, this.scratchCov);
      this.demand.step(this.servedQuality, t - this.lastGrowthAtS);
      this.lastGrowthAtS = t;
      // Advance the boundary to the next un-crossed cadence multiple (catch up if a big dt
      // jumped several; integrating the whole gap in one closed-form step is exact for the
      // flow, so a single fire suffices).
      while (this.nextGrowthAtS <= t) this.nextGrowthAtS += GROWTH_INTEGRATION_SECONDS;
    }
  }

  // --- M2f: the emergent-event coupling --------------------------------------

  /** A read-only view of the surfaced world-event stream (the panel/log reads this). */
  get events(): M2EventLog {
    return this.eventLog;
  }

  /**
   * M2f — turn ONE {@link EmitPlan} into reality at sim-time `t`: a DEMAND_SHOCK becomes a live
   * region-multiplier shock + a truthful shock log line; a RIVAL_ACTION becomes a faction-coloured
   * log line (and a relay_failure ALSO spawns a lucrative contract offer); a NEWS becomes a headline
   * line. Every push is TRUTHFUL — the shock log line is emitted only AFTER the shock is registered,
   * so the line reflects real state (the §4.12 honesty precondition). Pure given (plan, t, the
   * resolved region cells) — no RNG here (the generator already drew everything).
   */
  private executeEmitPlan(plan: EmitPlan, t: number, dtSeconds: number): void {
    // The integer fixed-step tick this event lands on (metadata; tSim is the canonical timestamp).
    // A fixed-step caller hits t = tick·dt exactly, so round(t/dt) recovers the tick bit-stably.
    const tick = dtSeconds > 0 ? Math.round(t / dtSeconds) : 0;
    if (plan.kind === "demand_shock" && plan.region) {
      const target: ContractTarget = {
        label: plan.region.label,
        latRad: plan.region.latRad,
        lonRad: plan.region.lonRad,
        radiusRad: DEFAULT_TARGET_RADIUS_DEG * (Math.PI / 180),
      };
      const { cellIds } = resolveTargetCells(this.grid, this.demand, target);
      const multiplier = plan.multiplier ?? 1.5;
      const durationS = plan.durationS ?? 3600;
      // Register the live shock FIRST (so the log line below reflects real applied state).
      this.activeShocks.push({ cellIds: cellIds.slice(), multiplier, startS: t, durationS });
      this.eventLog.push((seq) => ({
        kind: "demand_shock",
        seq,
        tick,
        tSim: t,
        regionLabel: plan.region!.label,
        latRad: plan.region!.latRad,
        lonRad: plan.region!.lonRad,
        cellIds: cellIds.slice(),
        multiplier,
        durationS,
        cause: plan.region!.shockCause,
      }));
      return;
    }
    if (plan.kind === "rival_action" && plan.region && plan.rivalId && plan.rivalKind) {
      // A relay_failure spawns a lucrative CONTRACT OFFER over the region ("customers come knocking").
      let spawnedContractId: string | null = null;
      if (plan.rivalKind === "relay_failure") {
        spawnedContractId = this.spawnRelayFailureContract(plan.region, t);
      }
      this.eventLog.push((seq) => ({
        kind: "rival_action",
        seq,
        tick,
        tSim: t,
        rivalId: plan.rivalId!,
        kind2: plan.rivalKind!,
        regionLabel: plan.region!.label,
        spawnedContractId,
      }));
      return;
    }
    if (plan.kind === "news" && plan.newsText) {
      this.eventLog.push((seq) => ({
        kind: "news",
        seq,
        tick,
        tSim: t,
        text: plan.newsText!,
        severity: plan.newsSeverity ?? "info",
      }));
    }
  }

  /**
   * M2f — spawn the lucrative CONTRACT OFFER a rival RELAY_FAILURE creates: a normal offer over the
   * region (resolved from the live demand) with a PREMIUM tariff ({@link RELAY_FAILURE_TARIFF_BONUS})
   * and a tighter offer window (it is a time-pressured hand-off). Pushed onto the contract board with
   * an `r{N}` id (distinct from the ContractGenerator's `c{N}`), so it appears as a real accept-able
   * offer. Returns the spawned id. Deterministic + pure (the region cells/demand are deterministic).
   */
  private spawnRelayFailureContract(region: { label: string; latRad: number; lonRad: number }, t: number): string {
    const target: ContractTarget = {
      label: region.label,
      latRad: region.latRad,
      lonRad: region.lonRad,
      radiusRad: DEFAULT_TARGET_RADIUS_DEG * (Math.PI / 180),
    };
    const id = `r${this.spawnedContractCount++}`;
    const c = offerContract(id, this.grid, this.demand, target, t, DEFAULT_TERM_SECONDS, DEFAULT_OFFER_WINDOW_SECONDS);
    c.tariffPerSecond *= RELAY_FAILURE_TARIFF_BONUS; // the premium for taking the rival's stranded customers.
    this.contractList.push(c);
    return id;
  }

  /**
   * M2f — recompute the per-cell shock multiplier overlay at sim-time `t` and push it into the
   * dynamic demand. Each active shock contributes `1 + (peak − 1)·(1 − elapsed/duration)` on its
   * cells (a LINEAR decay from peak back to 1.0); multiple shocks on the same cell COMPOUND. A
   * shock whose lifetime has elapsed is DROPPED from {@link activeShocks} entirely (clean expiry —
   * its cells return to 1.0). Runs every step so an expired shock resets even with no new event.
   * Pure mutation in place; no RNG; no allocation after the scratch has grown to the grid size.
   */
  private applyShockOverlay(t: number): void {
    const n = this.demand.current.length;
    if (this.shockMulScratch.length !== n) this.shockMulScratch = new Array(n).fill(1.0);
    else this.shockMulScratch.fill(1.0);
    // Drop expired shocks, then fold the live ones into the per-cell multiplier.
    if (this.activeShocks.length > 0) {
      this.activeShocks = this.activeShocks.filter((s) => t < s.startS + s.durationS);
      for (const s of this.activeShocks) {
        const frac = s.durationS > 0 ? Math.max(0, Math.min(1, (t - s.startS) / s.durationS)) : 1;
        const m = 1 + (s.multiplier - 1) * (1 - frac); // peak at start → 1.0 at end (linear decay).
        for (const id of s.cellIds) this.shockMulScratch[id] *= m;
      }
    }
    this.demand.setShockMultipliers(this.shockMulScratch);
  }

  /** The summed € revenue RATE (per sim-second) of all ACTIVE contracts at sim-time t,
   * from the live coverage — the FINANCE readout (the network's current earn rate). */
  contractRevenueRatePerSecond(eph: Ephemeris, t: number): number {
    this.scratchPos = this.roster.worldPositions(eph, t, this.scratchPos);
    const eirps = this.cachedEirps();
    const center = eph.position("earth", t);
    const radius = eph.radiusMeters("earth");
    let rate = 0;
    for (const c of this.contractList) {
      if (c.state !== "active") continue;
      const frac = servedFractionAt(
        this.grid,
        this.demand,
        c.cellIds,
        c.qualityThreshold,
        eirps,
        this.scratchPos,
        center,
        radius,
        this.scratchCov,
      );
      rate += contractRevenueRatePerSecond(c, frac);
    }
    return rate;
  }

  /**
   * The asset world positions (metres) at sim-time t, in roster order — the input
   * the coverage field's allocation-free sweep + scoreRoster want. Pure. `out` is a
   * reusable scratch array the caller may pass to avoid per-frame allocation.
   */
  worldPositions(eph: Ephemeris, t: number, out?: import("../ephemeris").Vec3[]) {
    return this.roster.worldPositions(eph, t, out);
  }

  /** Capture the whole build session by value (save/snapshot/state-hash). */
  snapshot(): BuildSnapshot {
    return {
      roster: this.roster.snapshot(),
      balance: this.economy.balance,
      rngState: this.rng.state.toString(),
      launchedCount: this.launchedCount,
      contracts: this.contractList.map(cloneContract),
      generator: this.generator.snapshot(),
      lastStepS: this.lastStepS,
      demand: this.demand.snapshot(),
      lastGrowthAtS: this.lastGrowthAtS,
      nextGrowthAtS: this.nextGrowthAtS,
      eventGenerator: this.eventGenerator.snapshot(),
      activeShocks: this.activeShocks.map((s) => ({ ...s, cellIds: s.cellIds.slice() })),
      spawnedContractCount: this.spawnedContractCount,
      events: this.eventLog.snapshot(),
    };
  }

  /** Restore the whole build session from a snapshot (the ephemeris is unchanged). */
  restore(s: BuildSnapshot): void {
    this.roster.restore(s.roster);
    this.economy.balance = s.balance;
    this.rng.state = BigInt(s.rngState);
    this.launchedCount = s.launchedCount;
    this.contractList.length = 0;
    if (s.contracts) for (const c of s.contracts) this.contractList.push(cloneContract(c));
    if (s.generator) this.generator.restore(s.generator);
    this.lastStepS = s.lastStepS ?? 0;
    if (s.demand) this.demand.restore(s.demand);
    this.lastGrowthAtS = s.lastGrowthAtS ?? 0;
    this.nextGrowthAtS = s.nextGrowthAtS ?? GROWTH_INTEGRATION_SECONDS;
    // M2f — restore the emergent-event state. The shock overlay is reconstructed on the next step()
    // (applyShockOverlay re-derives the per-cell multiplier from activeShocks at t).
    if (s.eventGenerator) this.eventGenerator.restore(s.eventGenerator);
    this.activeShocks = (s.activeShocks ?? []).map((sh) => ({ ...sh, cellIds: sh.cellIds.slice() }));
    this.spawnedContractCount = s.spawnedContractCount ?? 0;
    if (s.events) this.eventLog.restore(s.events);
  }

  /**
   * M2e — a read-only view of the CURRENT dynamic demand (the escalation engine's live
   * field). The live render reads this to (a) drive the heatmap/score off the GROWING
   * demand and (b) show the rising-demand / eroding-coverage readout. Pure read. */
  get demandField(): DynamicDemand {
    return this.demand;
  }
}
