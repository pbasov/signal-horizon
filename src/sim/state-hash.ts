/**
 * Canonical, deterministic state hashing for the determinism golden-master
 * (P0-06 / ticket B1). A faithful, byte-for-byte TypeScript port of
 * SignalHorizon.Sim/StateHash.cs.
 *
 * Pure data + functions: imports NOTHING from `three` or the DOM, uses no
 * wall-clock time and no nondeterministic RNG. Folds the f64 orbital truth into
 * a single 64-bit unsigned integer reproducible bit-for-bit across runs and
 * INDEPENDENT of caller iteration order (ticks are sorted ascending, body ids
 * ordinally before hashing).
 *
 * WHY bigint: the C# accumulator is a `ulong` folded with 2's-complement
 * (unchecked) wraparound — full unsigned 64-bit arithmetic. A JS `number`
 * cannot hold a u64 exactly (53-bit mantissa), so the fold runs in `bigint`
 * masked to 64 bits. The result is the UNSIGNED u64 value (NOT a signed i64),
 * matching the C# `ulong` baseline.
 *
 * HOW f64 BITS ARE HASHED: each double is serialized to its raw IEEE-754
 * 8-byte LITTLE-ENDIAN representation (mirroring C# BitConverter.GetBytes on a
 * little-endian platform), then every byte is folded with the classic FNV-style
 * polynomial mix acc = acc * Mult + byte (mod 2^64). Hashing the RAW BITS — not
 * a decimal string — means two doubles hash equal IFF they are bit-identical,
 * which is exactly the determinism property P0-06 guards.
 */

import type { Ephemeris } from "./ephemeris";

/** 2^64 modulus mask: keep the accumulator an unsigned 64-bit value. */
const U64_MASK = (1n << 64n) - 1n;

/** Polynomial multiplier (a small prime; FNV/Python-tuple-hash heritage). */
export const MULT = 1000003n;

/** Non-zero seed so an all-zero input still produces a distinctive accumulator. */
export const SEED = 1469598103934665603n;

// Scratch buffer for IEEE-754 byte extraction. Reused across MixFloat calls;
// the hashing is single-threaded and deterministic, so sharing is safe.
const floatBuf = new ArrayBuffer(8);
const floatView = new DataView(floatBuf);

/** Fold one raw byte (0..255) into the accumulator. The u64 wraps deterministically. */
export function mixByte(acc: bigint, b: number): bigint {
  return (acc * MULT + BigInt(b)) & U64_MASK;
}

/**
 * Fold a 64-bit integer, low byte first, as 8 bytes — order-stable and
 * sign-safe. Mirrors C# MixInt which shifts a `long` and masks each byte. We
 * fold the value's two's-complement u64 representation so negative ticks would
 * also match C#.
 */
export function mixInt(acc: bigint, v: bigint): bigint {
  const u = v & U64_MASK; // two's-complement u64 view, as C# (byte)(v >> ...) yields.
  let a = acc;
  for (let i = 0n; i < 8n; i++) {
    a = mixByte(a, Number((u >> (i * 8n)) & 0xffn));
  }
  return a;
}

/**
 * Fold an f64 by its raw IEEE-754 bytes (little-endian, 8 bytes). Matches C#
 * BitConverter.GetBytes on a little-endian platform.
 */
export function mixFloat(acc: bigint, v: number): bigint {
  // littleEndian = true => byte 0 is the least-significant byte, exactly the
  // ordering BitConverter.GetBytes produces on a little-endian machine.
  floatView.setFloat64(0, v, true);
  let a = acc;
  for (let i = 0; i < 8; i++) {
    a = mixByte(a, floatView.getUint8(i));
  }
  return a;
}

/**
 * Fold a string by its UTF-8 bytes plus a zero terminator (so "ab"+"c" cannot
 * collide with "a"+"bc"). Mirrors C# Encoding.UTF8.GetBytes + MixByte(0).
 */
const utf8 = new TextEncoder();
export function mixString(acc: bigint, s: string): bigint {
  const bytes = utf8.encode(s);
  let a = acc;
  for (let i = 0; i < bytes.length; i++) {
    a = mixByte(a, bytes[i]);
  }
  return mixByte(a, 0);
}

/** Ordinal (UTF-16 code-unit) string comparator, matching C# StringComparer.Ordinal. */
function ordinalCompare(x: string, y: string): number {
  const n = Math.min(x.length, y.length);
  for (let i = 0; i < n; i++) {
    const cx = x.charCodeAt(i);
    const cy = y.charCodeAt(i);
    if (cx !== cy) return cx - cy;
  }
  return x.length - y.length;
}

/**
 * Canonical hash of the orbital truth over a set of ticks.
 *   eph   : populated Ephemeris (the truth layer).
 *   ticks : tick indices. A COPY is sorted ascending so the hash is independent
 *           of caller ordering.
 *   dt    : fixed timestep (seconds). Absolute time of a tick is tick * dt.
 * For each tick (ascending) and each body id (sorted ordinally) we fold the id,
 * the tick, then the three f64 position components — independent of map
 * iteration order. Returns the UNSIGNED u64 fold as a bigint.
 */
export function canonicalHash(
  eph: Ephemeris | null | undefined,
  ticks: readonly number[],
  dt: number,
): bigint {
  let acc = SEED;
  if (eph == null) return acc;

  // Sort a COPY of the ticks ascending (do not mutate the caller's array).
  // Numeric sort: JS default Array.sort is lexicographic, which would mis-order
  // multi-digit ticks — mirror C# Array.Sort over longs.
  const sortedTicks = [...ticks].sort((p, q) => (p < q ? -1 : p > q ? 1 : 0));

  // Stable, ordinally-sorted body ids.
  const ids = [...eph.bodyIds()].sort(ordinalCompare);

  // Fold dt itself so a different timestep yields a different golden value.
  acc = mixFloat(acc, dt);

  for (const tick of sortedTicks) {
    acc = mixInt(acc, BigInt(tick));
    const t = tick * dt;
    for (const id of ids) {
      acc = mixString(acc, id);
      const p = eph.position(id, t);
      // position() always returns 3 components; fold exactly three with a fixed
      // loop so control flow never branches.
      for (let k = 0; k < 3; k++) {
        acc = mixFloat(acc, p[k]);
      }
    }
  }

  return acc;
}

/** Hash a flat list of f64 values in order (helper for ad-hoc state vectors). */
export function hashFloats(values: readonly number[]): bigint {
  let acc = SEED;
  for (let i = 0; i < values.length; i++) {
    acc = mixFloat(acc, values[i]);
  }
  return acc;
}
