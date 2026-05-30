/**
 * M2e — THE ESCALATION ENGINE: DYNAMIC DEMAND (GDD §3b generator 1, Pillar 6, §4.9).
 *
 * The §3b PRIMARY generator + the heartbeat of the loop: "demand grows where you
 * serve". The M2a {@link DemandField} is a STATIC surface — a fully-built network over
 * it stays solved, so the loop PLATEAUS (the failure mode §3b/Pillar 6 explicitly
 * rejects). This module makes SUCCESS CREATE THE NEXT PROBLEM: a cell served at/above
 * the quality bar gains economic weight over sim-time (the §4.9 network effect), so it
 * comes to demand MORE than the capacity you built for it → your covered-demand
 * fraction ERODES → revenue dips → you must EXPAND → which serves the now-bigger demand
 * → which grows it further. "Every served gap re-opens one size larger" (the OpenTTD
 * loop). This is what makes the loop ESCALATE instead of plateau.
 *
 * --- THE GROWTH LAW (pure, DT-invariant, bounded) ---------------------------
 * A DYNAMIC OVERLAY rides on top of the static baseline field (the M2a field is left
 * immutable — the M1 path + every static scorer is untouched). Each cell carries a
 * CURRENT demand `d`, initialised to its baseline `b`. Per integration step over
 * `dtSeconds` of sim-time, with a per-cell SERVED QUALITY `q ∈ [0,1]` (1 = served at/
 * above the bar, 0 = unserved), demand moves by a CONTINUOUS per-sim-time rate:
 *
 *   served (q > 0):   d' = GROWTH_RATE_PER_S · q · d · (1 − d / cap)          [LOGISTIC]
 *   unserved (q = 0): d' = DECAY_RATE_PER_S · (b − d)                         [→ baseline]
 *
 * where `cap = b · CAPACITY_MULTIPLIER` is the per-cell CARRYING CAPACITY. The served
 * branch is LOGISTIC growth toward `cap`, so a long run NEVER explodes to Infinity/NaN —
 * it asymptotes to `cap`. The unserved branch relaxes a cell back toward its baseline (a
 * region you stop serving cools off, slowly).
 *
 * Both branches are integrated by their EXACT CLOSED-FORM FLOW over the step, not an
 * explicit Euler bump — so the law is DT-INVARIANT to f64 tolerance (the SD-20 contract):
 * the analytic flow is a semigroup, so composing two steps of dt equals one step of 2·dt,
 * and the same sim-time at 1× vs a coarse dt yields the same demand. The closed forms:
 *
 *   logistic:  d(t+dt) = cap / (1 + ((cap − d)/d) · exp(−GROWTH_RATE_PER_S · q · dt))
 *   decay:     d(t+dt) = b + (d − b) · exp(−DECAY_RATE_PER_S · dt)
 *
 * (A linear Euler bump would carry O(dt) error that, fed back through the demand-weighted
 * served fraction into the contract revenue, would break the existing revenue DT-invariance
 * pin — the closed form keeps both exact.)
 *
 * PURITY: pure data + pure transition. No three / DOM / wall-clock; NO RNG (growth is a
 * deterministic function of served quality + sim-time, never random). The whole `current`
 * array folds into the session snapshot/state-hash, so the dynamic demand is in the
 * replay fold. Numbers are SANE PLACEHOLDERS (tune later); named constants keep the dials.
 */

import type { GeodesicGrid } from "./grid";
import { DemandField } from "./demand";

// --- TUNING CONSTANTS — sane placeholders, tune later ------------------------

/** Per-cell CARRYING CAPACITY as a multiple of the cell's baseline demand. A served
 * cell's demand asymptotes here (logistic ceiling), so a long-served region ends up
 * ~3× its starting weight — perceptible escalation within a sitting, bounded forever.
 * Placeholder. */
export const CAPACITY_MULTIPLIER = 3.0;

/** Logistic GROWTH rate (per sim-second) of a fully-served cell at the low-demand end
 * (where the (1 − d/cap) brake ≈ 1). Tuned so a well-served metro's demand visibly
 * climbs over a chunk of a sitting (≈ tens of sim-minutes of served time to roughly
 * double from baseline) without being punishing. DT-invariant rate. Placeholder. */
export const GROWTH_RATE_PER_S = 8.0e-5;

/** DECAY rate (per sim-second) at which an UNSERVED cell relaxes back toward its
 * baseline (a dropped region cools off, slowly — much gentler than growth, so losing
 * coverage doesn't instantly erase the work). DT-invariant rate. Placeholder. */
export const DECAY_RATE_PER_S = 1.0e-5;

/** The demand-growth INTEGRATION CADENCE (sim-seconds): the escalation engine samples the
 * whole-grid served-quality + advances the closed-form growth on this fixed sim-time
 * cadence, NOT every 1/60 s tick. Two reasons: (1) growth is glacial (rate ~8e-5/s), so
 * 60-Hz integration is wasted work — a per-minute closed-form step is indistinguishable
 * over a sitting; (2) it keeps the per-tick cost flat (the 320-cell sweep fires ~once a
 * sim-minute, not every tick). DT-INVARIANCE is preserved because BOTH a fine (dt=1/60)
 * and a coarse (dt=60) caller accumulate to the SAME cadence boundaries and integrate the
 * SAME closed-form flow over the SAME sampled served-quality there. Must divide evenly into
 * a coarse caller's dt for exact boundary alignment; 60 s matches the test's 60 s coarse dt. */
export const GROWTH_INTEGRATION_SECONDS = 60.0;

/**
 * The DYNAMIC demand overlay: a per-cell CURRENT demand that GROWS under service and
 * relaxes toward baseline when unserved. Exposes the SAME read surface as a
 * {@link DemandField} ({@link of} + {@link total}), so every coverage/contract/score
 * reader ({@link import("./score").servedFractionAt}, {@link import("./score").scoreCoverageAt})
 * uses it as a drop-in CURRENT field with no reshaping — they only call `of()`/`total`.
 *
 * Owns the live `current[]` (the growth state) + a cached running `total`; the baseline
 * `DemandField` is held by reference (immutable, the floor a cell decays back toward).
 */
export class DynamicDemand {
  /** The immutable baseline field (the M2a static surface) — the per-cell floor. */
  private readonly baseline: DemandField;
  /** current[cellId] — the LIVE demand units (starts at baseline, grows under service). */
  readonly current: number[];
  /** Per-cell carrying capacity = baseline · {@link CAPACITY_MULTIPLIER} (logistic ceiling). */
  private readonly cap: number[];
  /** Σ current — the live denominator for covered-demand fraction (kept in sync). */
  private runningTotal: number;

  private constructor(baseline: DemandField, current: number[], cap: number[], total: number) {
    this.baseline = baseline;
    this.current = current;
    this.cap = cap;
    this.runningTotal = total;
  }

  /** Build a dynamic overlay for a grid: current = baseline, cap = baseline · multiplier. */
  static build(grid: GeodesicGrid, baseline?: DemandField): DynamicDemand {
    const base = baseline ?? DemandField.build(grid);
    const current = base.weight.slice();
    const cap = base.weight.map((w) => w * CAPACITY_MULTIPLIER);
    return new DynamicDemand(base, current, cap, base.total);
  }

  /** Current demand weight of a cell by id (the LIVE value coverage/contracts read). */
  of(cellId: number): number {
    return this.current[cellId];
  }

  /** Σ current demand over all cells (the live covered-demand-fraction denominator). */
  get total(): number {
    return this.runningTotal;
  }

  /** The immutable baseline demand of a cell (the floor it decays toward) — for readouts. */
  baselineOf(cellId: number): number {
    return this.baseline.of(cellId);
  }

  /** Σ baseline demand over all cells — the "where we started" denominator (for readouts). */
  get baselineTotal(): number {
    return this.baseline.total;
  }

  /**
   * ADVANCE the demand growth over `dtSeconds` of elapsed sim-time. `servedQuality` is
   * indexed by cell id: `q ∈ [0,1]` is the served fraction of that cell this step (1 =
   * served at/above the quality bar, 0 = unserved). Pure mutation in place via the EXACT
   * CLOSED-FORM flow of each branch (DT-INVARIANT — see the module header): logistic growth
   * toward the per-cell cap where served, exponential relaxation toward baseline where
   * unserved. The running total is recomputed so {@link total} stays in sync.
   *
   * Bounded: the logistic flow asymptotes to `cap` (it can never exceed it); the decay flow
   * contracts toward baseline. A long run stays finite + approaches cap — never NaN/Infinity.
   */
  step(servedQuality: number[], dtSeconds: number): void {
    if (dtSeconds <= 0) return;
    let total = 0;
    const cur = this.current;
    const cap = this.cap;
    for (let i = 0; i < cur.length; i++) {
      const d = cur[i];
      const q = servedQuality[i] ?? 0;
      let next: number;
      if (q > 0 && d > 0) {
        // LOGISTIC growth toward the carrying capacity (exact closed-form flow):
        //   d(t+dt) = cap / (1 + ((cap − d)/d) · exp(−rate · q · dt)).
        // dt-invariant (semigroup) + bounded above by cap (the exp term ≥ 0).
        const c = cap[i];
        if (c > 0) {
          const k = Math.exp(-GROWTH_RATE_PER_S * q * dtSeconds);
          next = c / (1 + ((c - d) / d) * k);
        } else {
          next = d;
        }
      } else {
        // RELAX toward baseline (exact closed-form flow): d(t+dt) = b + (d − b)·exp(−k·dt).
        const b = this.baseline.of(i);
        next = b + (d - b) * Math.exp(-DECAY_RATE_PER_S * dtSeconds);
      }
      cur[i] = next;
      total += next;
    }
    this.runningTotal = total;
  }

  /** JSON-safe capture of the live demand state (folds into the session snapshot). */
  snapshot(): number[] {
    return this.current.slice();
  }

  /** Restore the live demand state from a snapshot; recomputes the running total. */
  restore(current: number[]): void {
    const n = this.current.length;
    let total = 0;
    for (let i = 0; i < n; i++) {
      const v = current[i] ?? this.baseline.of(i);
      this.current[i] = v;
      total += v;
    }
    this.runningTotal = total;
  }
}
