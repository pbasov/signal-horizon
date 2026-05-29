/**
 * M1-08 — Economy: balance + burn on CONTINUOUS PER-SIM-TIME RATES.
 *
 * Reworked from the old per-TICK model (€/tick payouts + €/tick opex) to a
 * per-SIM-SECOND RATE model so the money is invariant to DT and time-compression:
 * the same sim-time elapsed yields the same balance whether you ran it at 1× or
 * 1000×. The wallet moves through {@link M1Economy.accrue} once per step, scaled
 * by THAT step's elapsed sim-seconds (dt) — never by the tick count.
 *
 * PURE data + functions (no three / DOM / wall-clock / RNG): a single mutable
 * `balance` advanced only through {@link M1Economy.apply}.
 *
 * THE SOLVENCY LOOP is the whole point. Per sim-second:
 *   - OPEX is a standing drain to run the cache, × coherence.costMultiplier
 *     (BEST_EFFORT/STRONG cost more to hold fresher).
 *   - REVENUE is keyed by the SERVE BAND:
 *       FRESH    — full positive rate (slow profit: revenue > opex).
 *       STALE    — reduced rate (roughly break-even / small profit).
 *       MISS     — no income (you pay opex with nothing coming in → net loss).
 *       BLACKOUT — no income PLUS an SLA penalty rate (the deepest net loss).
 *   - PREFETCH is a one-shot cost (pre-positioning has a price).
 *
 * So a GOOD strategy (prefetch fresh into the Mars cache before a blackout, then
 * serve hits) is net-POSITIVE and survives a 30-min run; a BAD strategy (no
 * cache, miss/blackout the whole way) burns opex with no income and goes
 * bankrupt. Numbers below are SANE PLACEHOLDERS chosen to make that gap real —
 * tune later. They are named constants so the dials are in one place.
 */
import { costMultiplier } from "./coherence";

/**
 * The serve band the economy earns on. Maps 1:1 from the resolver's
 * ResolveOutcome ("fresh" | "stale" | "miss" | "blackout_miss"), so the session
 * can hand its outcome straight to {@link M1Economy.accrue}.
 */
export type ServeBand = "fresh" | "stale" | "miss" | "blackout_miss";

// --- RATE CONSTANTS (€ per SIM-SECOND) — sane placeholders, tune later --------

/**
 * Baseline cost to run ONE cache, in € per sim-second (at EVENTUAL, before the
 * coherence multiplier). The standing money-out floor. €2/s ⇒ €120/sim-minute.
 */
export const OPEX_RATE_PER_SECOND = 2.0;

/**
 * Revenue while serving FRESH data, € per sim-second. Set ABOVE opex so a fresh
 * serve is net-POSITIVE at EVENTUAL (+€3/s) — the slow profit a well-run network
 * earns.
 */
export const FRESH_REVENUE_RATE_PER_SECOND = 5.0;

/**
 * Revenue while serving STALE-but-usable data, € per sim-second. Set just ABOVE
 * baseline opex so stale serving is roughly break-even / a small profit at
 * EVENTUAL (+€0.5/s) — usable, but the freshness premium is real.
 */
export const STALE_REVENUE_RATE_PER_SECOND = 2.5;

/**
 * Revenue on a MISS (cache empty/stale, fetch in flight): NONE. You still pay
 * opex, so a miss is net-negative — waiting on the light-gap costs money.
 */
export const MISS_REVENUE_RATE_PER_SECOND = 0.0;

/**
 * The SLA PENALTY rate during a BLACKOUT (link down, no usable cache), € per
 * sim-second, applied ON TOP of zero income. So a blackout's net is
 * −(opex + penalty) = the deepest burn (−€6/s at EVENTUAL) — exactly what a
 * pre-blackout prefetch buys you out of.
 */
export const BLACKOUT_PENALTY_RATE_PER_SECOND = 4.0;

/**
 * Opening balance (€). Gives a runway of MINUTES on pure opex burn (€3000 / €2s
 * ≈ 25 sim-minutes), so the network survives the ≈923 s wait for the first
 * delivery and a 30-min run IF it keeps serving — but is lethal if it starves
 * (miss/blackout) for long.
 */
export const OPENING_BALANCE = 3000.0;

/** One-shot cost of issuing a prefetch action (the price of pre-positioning). */
export const PREFETCH_COST = 50.0;

/** Revenue rate (€/sim-second) for a serve band, BEFORE opex is netted off. */
export function revenueRatePerSecond(band: ServeBand): number {
  switch (band) {
    case "fresh":
      return FRESH_REVENUE_RATE_PER_SECOND;
    case "stale":
      return STALE_REVENUE_RATE_PER_SECOND;
    case "miss":
      return MISS_REVENUE_RATE_PER_SECOND;
    case "blackout_miss":
      // No income during a blackout, and the SLA penalty is added as NEGATIVE
      // revenue so the single net = revenue − opex formula stays uniform.
      return -BLACKOUT_PENALTY_RATE_PER_SECOND;
  }
}

/** Opex rate (€/sim-second) at a coherence level: baseline × costMultiplier. */
export function opexRatePerSecond(coherenceLevel: number): number {
  return OPEX_RATE_PER_SECOND * costMultiplier(coherenceLevel);
}

export class M1Economy {
  /** On-hand balance (€). Bankrupt when < 0. */
  balance: number;

  /** Baseline opex rate (€/sim-second) before the coherence multiplier. */
  opexRatePerSecond = OPEX_RATE_PER_SECOND;

  /** One-shot cost of issuing a prefetch action (the cost of pre-positioning). */
  prefetchCost = PREFETCH_COST;

  /** Starts from a configurable opening balance (default {@link OPENING_BALANCE}). */
  constructor(balance = OPENING_BALANCE) {
    this.balance = balance;
  }

  /** Apply a signed € delta to the balance. The single mutation point. Pure. */
  apply(delta: number): void {
    this.balance += delta;
  }

  /**
   * Accrue one step of the continuous economy over `dtSeconds` of ELAPSED
   * SIM-TIME. This is the SINGLE per-step entry point the session calls:
   *
   *   balance += (revenueRate(band) − opexRate(coherenceLevel)) × dtSeconds
   *
   * DT-INVARIANT: the accrued € depends only on the band, coherence, and the
   * sim-seconds elapsed — never on the tick rate or time-compression. Running to
   * the same sim-time at 1× vs 1000× yields the same balance.
   *
   * `viaCache` is accepted for signature completeness (a serve's locality); the
   * band already encodes whether income flows, so revenue is keyed off the band.
   */
  accrue(
    band: ServeBand,
    _viaCache: boolean,
    dtSeconds: number,
    coherenceLevel: number,
  ): void {
    const net = revenueRatePerSecond(band) - opexRatePerSecond(coherenceLevel);
    this.apply(net * dtSeconds);
  }

  /** The current opex rate (€/sim-second) at a coherence level. The OPEX readout. */
  opexRate(coherenceLevel: number): number {
    return opexRatePerSecond(coherenceLevel);
  }

  /** The current revenue rate (€/sim-second) for a serve band. The REVENUE readout. */
  revenueRate(band: ServeBand): number {
    return revenueRatePerSecond(band);
  }

  /** The current NET rate (€/sim-second): revenue − opex. >0 earning, <0 burning. */
  netRatePerSecond(band: ServeBand, coherenceLevel: number): number {
    return revenueRatePerSecond(band) - opexRatePerSecond(coherenceLevel);
  }

  /** Charge the one-shot cost of a prefetch action. */
  chargePrefetch(): void {
    this.apply(-this.prefetchCost);
  }

  /**
   * Runway: how many SIM-SECONDS until bankruptcy at a given net BURN rate
   * (€/sim-second, > 0 means losing money). +Inf when not burning (break-even or
   * earning). The HUD's "time until broke" readout, now in sim-seconds (not ticks).
   */
  runway(burnRatePerSecond: number): number {
    if (burnRatePerSecond <= 0.0) return Number.POSITIVE_INFINITY;
    return this.balance / burnRatePerSecond;
  }

  /** True once the balance has gone negative — the kill condition. */
  bankrupt(): boolean {
    return this.balance < 0.0;
  }
}
