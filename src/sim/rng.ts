/**
 * Deterministic seeded PRNG (splitmix64) — P0-04.
 *
 * Ported from SignalHorizon.Sim/SimRng.cs (C# `ulong` splitmix64).
 * Uses JavaScript `bigint` for exact 64-bit unsigned arithmetic with
 * wrapping modulo 2^64. Same seed → bit-identical stream across
 * all JS engines (bigint arithmetic is specified, not implementation-defined).
 *
 * The C# version uses `unchecked` (wrapping) `ulong` arithmetic; this port
 * replicates it with `(x & MASK)`.
 */

const MASK = (1n << 64n) - 1n; // 0xFFFFFFFFFFFFFFFF

function wrap(x: bigint): bigint {
  return x & MASK;
}

export class SimRng {
  private _state: bigint;

  constructor(seed: bigint | number = 0n) {
    this._state = BigInt(seed) & MASK;
  }

  /** Next raw 64-bit value as bigint (0 ≤ result < 2^64). */
  nextU64(): bigint {
    this._state = wrap(this._state + 0x9E3779B97F4A7C15n);
    let z = this._state;
    z = wrap((z ^ (z >> 30n)) * 0xBF58476D1CE4E5B9n);
    z = wrap((z ^ (z >> 27n)) * 0x94D049BB133111EBn);
    return z ^ (z >> 31n);
  }

  /** Uniform double in [0, 1) using the top 53 bits (exact double mantissa). */
  nextDouble(): number {
    return Number(this.nextU64() >> 11n) * (1.0 / 9007199254740992.0);
  }

  nextDoubleRange(from: number, to: number): number {
    return from + (to - from) * this.nextDouble();
  }

  /** Inclusive integer in [from, to]. */
  nextIntRange(from: number, to: number): number {
    const span = BigInt(to - from + 1);
    if (to < from) return from;
    return from + Number((this.nextU64() >> 1n) % span);
  }

  /** Derive an independent child stream deterministically (for sub-systems). */
  fork(label: bigint | number): SimRng {
    return new SimRng(this.nextU64() ^ BigInt(label));
  }

  get state(): bigint {
    return this._state;
  }

  set state(value: bigint) {
    this._state = value & MASK;
  }
}
