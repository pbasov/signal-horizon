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
 * carries its OWN seeded splitmix64 PRNG (for launch failure rolls) and its OWN
 * snapshot/state-hash + replay golden — the M1 golden stays untouched. Every
 * mutation flows through {@link deployGround} / {@link launchSat}, applied at a
 * tick by the shared applier, so a recorded build sequence replays bit-identically:
 *   - deploys are pure (a candidate-site index → lat/lon, a fixed € charge);
 *   - launches draw ONE u64 from the seeded PRNG for the failure roll, so the
 *     success/failure outcome + the resulting roster are reproducible.
 *
 * No three / DOM / wall-clock; randomness only via the seeded {@link SimRng}.
 */

import type { Ephemeris } from "../ephemeris";
import { SimRng } from "../rng";
import { M1Economy } from "../m1/economy";
import { Roster, type RosterSnapshot } from "./roster";
import { CANDIDATE_SITES, GROUND_DEPLOY_COST, GROUND_EIRP, STARTER } from "./sites";
import {
  LAUNCH_PRESETS,
  presetById,
  resolveLaunchOrbit,
  rollLaunch,
  type LaunchPreset,
} from "./launch";

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
  /** What happened: a deploy, a successful launch, a failed launch, or rejected. */
  kind: "ground_deployed" | "sat_launched" | "launch_failed" | "rejected";
  /** The new asset's id when one was added (deploy / successful launch). */
  assetId?: string;
  /** € charged by this action (0 when rejected). */
  costEur: number;
  /** For a launch: the preset's label (for the readout/log). */
  presetLabel?: string;
  /** For a launch: the [0,1) PRNG roll the outcome was decided on. */
  roll?: number;
}

/** JSON-safe capture of the whole build session (save/restore + state-hash parity). */
export interface BuildSnapshot {
  roster: RosterSnapshot;
  balance: number;
  /** The launch PRNG state (a u64) — captured as a string (JSON has no bigint). */
  rngState: string;
  /** How many sats have been LAUNCHED successfully (drives the constellation phase). */
  launchedCount: number;
}

export class BuildSession {
  /** The deterministic placeable-asset roster (the monument's state). */
  readonly roster = new Roster();
  /** The € wallet (reuses the M1 economy's one-shot-charge API). */
  readonly economy: M1Economy;
  /** The seeded PRNG for launch-failure rolls (the ONLY randomness, seeded). */
  private rng: SimRng;
  /** Successful launches so far — fans the next launch's constellation phase. */
  private launchedCount = 0;

  constructor(openingBalance = BUILD_OPENING_BALANCE, seed: bigint = BUILD_RNG_SEED) {
    this.economy = new M1Economy(openingBalance);
    this.rng = new SimRng(seed);
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
    };
  }

  /** Restore the whole build session from a snapshot (the ephemeris is unchanged). */
  restore(s: BuildSnapshot): void {
    this.roster.restore(s.roster);
    this.economy.balance = s.balance;
    this.rng.state = BigInt(s.rngState);
    this.launchedCount = s.launchedCount;
  }
}
