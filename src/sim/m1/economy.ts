/**
 * M1-08 — Economy: balance + burn, fed by resolve payouts and cache/action cost.
 *
 * Faithful TypeScript port of SignalHorizon.Sim/M1/M1Economy.cs. PURE data +
 * functions (no three/DOM/wall-clock/RNG): a single mutable `balance` advanced
 * only through {@link M1Economy.apply}.
 *
 * The whole point is the SOLVENCY LOOP: a GOOD strategy (prefetch fresh data
 * into the Mars cache before a blackout, then serve hits) earns net-positive; a
 * BAD strategy (no cache, miss every request, eat blackout penalties) burns to
 * bankruptcy. The economy reads {@link ResolveResult.payout} from the resolver
 * (M1-07 coherence.costMultiplier feeds the per-tick opex) and charges a
 * one-shot cost for a player-initiated prefetch (M1-06).
 */
import { costMultiplier } from "./coherence";
import type { ResolveResult } from "./resolver";

/** Flat opex charged PER CACHE PER TICK (before the coherence multiplier). */
export const CACHE_OPEX_PER_TICK = 1.0;

/** One-shot cost of issuing a prefetch action (the cost of pre-positioning). */
export const PREFETCH_COST = 50.0;

export class M1Economy {
  /** On-hand balance (currency units). Bankrupt when < 0. */
  balance: number;

  /** Flat opex charged PER CACHE PER TICK (before coherence multiplier). */
  cacheOpexPerTick = CACHE_OPEX_PER_TICK;

  /** One-shot cost of issuing a prefetch action (the cost of pre-positioning). */
  prefetchCost = PREFETCH_COST;

  /** Starts from a configurable opening balance (default 0). */
  constructor(balance = 0.0) {
    this.balance = balance;
  }

  /** Apply a signed delta to the balance. The single mutation point. Pure. */
  apply(delta: number): void {
    this.balance += delta;
  }

  /** Credit a resolve() result's payout (may be negative for a blackout penalty). */
  applyPayout(r: ResolveResult): void {
    this.apply(r.payout);
  }

  /**
   * Charge per-tick opex for `cacheCount` caches at the given coherence level.
   * BEST_EFFORT / STRONG cost their costMultiplier × the baseline (M1-07 → M1-08).
   */
  chargeOpex(cacheCount: number, coherenceLevel: number): void {
    this.apply(-this.cacheOpexPerTick * cacheCount * costMultiplier(coherenceLevel));
  }

  /** Charge the one-shot cost of a prefetch action. */
  chargePrefetch(): void {
    this.apply(-this.prefetchCost);
  }

  /**
   * Runway: how many ticks until bankruptcy at a given per-tick burn (>0).
   * +Inf if not burning (or earning). The HUD's "time until broke" readout.
   */
  runway(burnPerTick: number): number {
    if (burnPerTick <= 0.0) return Number.POSITIVE_INFINITY;
    return this.balance / burnPerTick;
  }

  /** True once the balance has gone negative — the kill condition. */
  bankrupt(): boolean {
    return this.balance < 0.0;
  }
}
