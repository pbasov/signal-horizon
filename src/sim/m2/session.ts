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
import { servedFractionAt } from "../coverage/score";
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
  cloneContract,
  contractRevenueRatePerSecond,
  recordEarned,
  stepActiveContract,
  stepOfferedContract,
} from "./contracts";
import { ContractGenerator, type GeneratorSnapshot } from "./contract-generator";

/** Opening € for a build session — enough to deploy a few stations + buy a launch
 * or two, little enough that building is a budget choice (the build-vs-budget
 * tension, GDD §3/§4.9). Placeholder; M2d's contract revenue refills it. */
export const BUILD_OPENING_BALANCE = 5000.0;

/** Seed for the build session's launch-failure PRNG (a fixed determinism anchor;
 * the live main.ts + the replay test both start from this so a live-saved build
 * replays). Distinct from the M1 session's anchor. Chosen so the golden build log's
 * launches hit BOTH a success and a deterministic FAILURE (exercising the risk). */
export const BUILD_RNG_SEED = 7n;

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
   * reads (built once; the SAME default-level grid the live render scores). Pure. */
  private readonly grid: GeodesicGrid;
  private readonly demand: DemandField;
  /** Every contract this session has seen, in offer order (offered/active/done/failed). */
  private readonly contractList: Contract[] = [];
  /** The deterministic offer generator (draws targets/terms/intervals from {@link rng}). */
  private readonly generator = new ContractGenerator();
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
    this.demand = demand ?? DemandField.build(this.grid);
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
    // (1) Advance the offer generator (offer/expire contracts deterministically).
    this.generator.step(this.contractList, this.rng, this.grid, this.demand, t);

    // (1b) Expire stale OFFERS (cheap — no coverage needed) and note any ACTIVE ones.
    let anyActive = false;
    for (const c of this.contractList) {
      if (c.state === "offered") stepOfferedContract(c, t);
      else if (c.state === "active") anyActive = true;
    }
    this.lastStepS = t;
    if (!anyActive) return; // nothing to serve → skip the coverage sweep (perf).

    // (2)+(3) Accrue revenue + advance state machines. Precompute the roster positions
    // ONCE for this step's t (all active contracts read the same coverage instant).
    this.scratchPos = this.roster.worldPositions(eph, t, this.scratchPos);
    const eirps = this.cachedEirps();
    const center = eph.position("earth", t);
    const radius = eph.radiusMeters("earth");

    let netDelta = 0; // ONE summed wallet apply for DT-invariance.
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
  }
}
