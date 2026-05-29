/**
 * Versioned save / replay container (P0-05 / ticket B2). A faithful port of
 * SignalHorizon.Sim/SaveGame.cs.
 *
 * The COMPLETE deterministic description of a session: re-seeding the RNG with
 * `seed`, loading `initialConditions`, and replaying `actions` in order at the
 * fixed `dt` reproduces the exact state. The on-disk format is "inputs", not
 * "outputs"; `snapshots` are an OPTIONAL fast-load optimisation.
 *
 * Pure data + functions: imports NOTHING from `three` or the DOM, uses no
 * wall-clock time and no nondeterministic RNG.
 *
 * --- TWO CORRECTNESS RISKS THIS MODULE EXISTS TO SOLVE ---------------------
 *
 *  1. dt = 1/60 does NOT survive a JSON decimal round-trip. A JSON number
 *     carries ~15-17 significant digits but the parse/print path is not
 *     guaranteed bit-stable, and any human edit destroys the low bits. dt is
 *     determinism-critical (folded into every state hash — see state-hash.ts),
 *     so we serialize its EXACT IEEE-754 bit pattern as `dt_bits`: the int64
 *     view of the double, written as a STRING (a full 64-bit integer is itself
 *     beyond JSON-number precision). On load we reconstruct the EXACT double
 *     from those bits, so 1/60 returns bit-identical. The plain `dt` number is a
 *     human-readable convenience only.
 *
 *  2. JSON cannot represent a bigint / u64 (seed, rng state, a state hash).
 *     Every such value is serialized as a STRING and parsed back to bigint on
 *     load. seed is a 64-bit value carried as bigint end-to-end.
 *
 * --- JSON KEY CASING -------------------------------------------------------
 * In-memory the shape is camelCase (src/sim convention); the serialized DICT
 * uses the C#/GDScript snake_case wire keys (`dt_bits`, `initial_conditions`,
 * `rng_state`, `next_id`, …) so a save written by either runtime loads in both.
 */

import {
  actionFromDict,
  actionToDict,
  type JsonValue,
  type SimAction,
  type SimActionDict,
} from "./action";

/** Bump on any breaking format change; deserialize can branch on it to migrate. */
export const CURRENT_VERSION = 1;

// --------------------------------------------------------------- dt_bits ---

// Scratch buffer for IEEE-754 <-> int64 bit reinterpretation. Single-threaded
// and deterministic, so a shared view is safe.
const dtBuf = new ArrayBuffer(8);
const dtView = new DataView(dtBuf);

/**
 * Exact IEEE-754 representation of a double as the decimal string of its int64
 * bit pattern (lossless, JSON-safe, round-trips bit-identically). Mirrors
 * SaveGame.DtBitsStr = BitConverter.DoubleToInt64Bits(value).ToString().
 */
export function dtBitsStr(value: number): string {
  dtView.setFloat64(0, value);
  return dtView.getBigInt64(0).toString();
}

/**
 * Reconstruct the exact double from a `dt_bits` int64-pattern string. Mirrors
 * SaveGame.FloatFromBitsStr = BitConverter.Int64BitsToDouble(long.Parse(s)).
 */
export function floatFromBitsStr(s: string): number {
  dtView.setBigInt64(0, BigInt(s));
  return dtView.getFloat64(0);
}

// -------------------------------------------------------------- snapshot ---

/**
 * The minimal deterministic MUTABLE sim state captured for a fast-load
 * snapshot. Enough to restore the live objects exactly:
 *   - the clock `tick` (the canonical sim-time);
 *   - the RNG `rngState` (splitmix64 internal state — a u64, carried as bigint);
 *   - the Mission director's mutable fields.
 *
 * Everything else (orbital truth, link geometry) is a pure function of `tick`
 * and the seeded initial conditions, so it need not be stored.
 */
export interface MissionSnapshot {
  /** Next packet id to assign (Mission.nextId). */
  nextId: number;
  /** Whether the Earth↔Mars line of sight is currently occulted (Mission.occulted). */
  occulted: boolean;
  /** Index into the flavour SCRIPT (Mission.scriptIdx). */
  scriptIdx: number;
  /** Next sim-time a flavour line fires (Mission.nextScriptT). */
  nextScriptT: number;
  /** Whether the mission boot sequence has run (Mission.booted). */
  booted: boolean;
  /** The in-flight packet, or null. Plain JSON-safe data. */
  packet: PacketSnapshot | null;
}

/** JSON-safe view of PacketState (see src/types.ts). All fields are numbers/strings. */
export interface PacketSnapshot {
  id: number;
  fromId: string;
  toId: string;
  launchT: number;
  oneWay: number;
  progress: number;
  freshness: number;
}

/** A periodic fast-load snapshot of deterministic mutable sim state. */
export interface SimSnapshot {
  /** Sim clock tick at capture (integer). */
  tick: number;
  /** RNG internal state at capture (u64 → bigint; serialized as a string). */
  rngState: bigint;
  /** Mission director state at capture. */
  mission: MissionSnapshot;
}

/** Wire form of a snapshot (bigint → string, snake_case keys). */
interface SimSnapshotDict {
  tick: number;
  rng_state: string;
  mission: {
    next_id: number;
    occulted: boolean;
    script_idx: number;
    next_script_t: number;
    booted: boolean;
    packet: PacketSnapshot | null;
  };
}

/** Serialize a snapshot to its JSON-safe dict (rngState bigint → string). */
export function snapshotToDict(s: SimSnapshot): SimSnapshotDict {
  return {
    tick: s.tick,
    rng_state: s.rngState.toString(),
    mission: {
      next_id: s.mission.nextId,
      occulted: s.mission.occulted,
      script_idx: s.mission.scriptIdx,
      next_script_t: s.mission.nextScriptT,
      booted: s.mission.booted,
      packet: s.mission.packet == null ? null : { ...s.mission.packet },
    },
  };
}

/** Reconstruct a snapshot from its dict (string → bigint), tolerant of partials. */
export function snapshotFromDict(d: Record<string, JsonValue>): SimSnapshot {
  const m = (d.mission ?? {}) as Record<string, JsonValue>;
  const pkt = m.packet;
  return {
    tick: typeof d.tick === "number" ? d.tick : 0,
    rngState: typeof d.rng_state === "string" ? BigInt(d.rng_state) : 0n,
    mission: {
      nextId: typeof m.next_id === "number" ? m.next_id : 1,
      occulted: m.occulted === true,
      scriptIdx: typeof m.script_idx === "number" ? m.script_idx : 0,
      nextScriptT: typeof m.next_script_t === "number" ? m.next_script_t : 0,
      booted: m.booted === true,
      packet:
        pkt != null && typeof pkt === "object" && !Array.isArray(pkt)
          ? (pkt as unknown as PacketSnapshot)
          : null,
    },
  };
}

// -------------------------------------------------------------- SaveGame ---

/** Wire form of a SaveGame (seed bigint → string, dt also carried as dt_bits). */
export interface SaveGameDict {
  version: number;
  /** Seed as a decimal string (u64/bigint cannot be a JSON number). */
  seed: string;
  /** Human-readable dt; NOT authoritative — `dt_bits` reconstructs the exact value. */
  dt: number;
  /** Exact IEEE-754 int64 bit pattern of dt, as a string (lossless). */
  dt_bits: string;
  initial_conditions: Record<string, JsonValue>;
  actions: SimActionDict[];
  snapshots: SimSnapshotDict[];
}

/**
 * The save container. `seed` is a bigint (64-bit determinism anchor). `dt` is
 * the fixed timestep; it is reconstructed bit-exactly from `dt_bits` on load.
 */
export interface SaveGame {
  version: number;
  seed: bigint;
  dt: number;
  initialConditions: Record<string, JsonValue>;
  actions: SimAction[];
  snapshots: SimSnapshot[];
}

/** Construct a SaveGame with sensible defaults (mirrors the C# ctor). */
export function saveGame(
  seed: bigint,
  dt = 0,
  initialConditions?: Record<string, JsonValue>,
): SaveGame {
  return {
    version: CURRENT_VERSION,
    seed,
    dt,
    initialConditions: initialConditions == null ? {} : structuredClone(initialConditions),
    actions: [],
    snapshots: [],
  };
}

/**
 * Plain dictionary view (JSON-safe), stable key order. `dt_bits` preserves the
 * exact IEEE-754 pattern; `seed` is a string so the full 64-bit value survives.
 */
export function saveToDict(sg: SaveGame): SaveGameDict {
  return {
    version: sg.version,
    seed: sg.seed.toString(),
    dt: sg.dt,
    dt_bits: dtBitsStr(sg.dt),
    initial_conditions: structuredClone(sg.initialConditions),
    actions: sg.actions.map(actionToDict),
    snapshots: sg.snapshots.map(snapshotToDict),
  };
}

/** Serialize to a JSON string. Round-trip does not depend on whitespace. */
export function saveToJSON(sg: SaveGame): string {
  return JSON.stringify(saveToDict(sg));
}

/**
 * Rebuild from an already-parsed dictionary. Tolerant of missing keys so
 * partial/older saves load. dt is reconstructed from `dt_bits` when present
 * (lossless); falls back to the human-readable `dt` number for older saves.
 */
export function saveFromDict(d: Record<string, unknown>): SaveGame {
  const version = typeof d.version === "number" ? Math.trunc(d.version) : CURRENT_VERSION;
  const seed = typeof d.seed === "string" ? BigInt(d.seed) : typeof d.seed === "number" ? BigInt(Math.trunc(d.seed)) : 0n;

  let dt = 0;
  if (typeof d.dt_bits === "string") {
    dt = floatFromBitsStr(d.dt_bits);
  } else if (typeof d.dt === "number") {
    dt = d.dt;
  }

  const initialConditions =
    d.initial_conditions != null &&
    typeof d.initial_conditions === "object" &&
    !Array.isArray(d.initial_conditions)
      ? structuredClone(d.initial_conditions as Record<string, JsonValue>)
      : {};

  const actions: SimAction[] = Array.isArray(d.actions)
    ? d.actions.map((a) => actionFromDict(a as Record<string, JsonValue>))
    : [];

  const snapshots: SimSnapshot[] = Array.isArray(d.snapshots)
    ? d.snapshots.map((s) => snapshotFromDict(s as Record<string, JsonValue>))
    : [];

  return { version, seed, dt, initialConditions, actions, snapshots };
}

/**
 * Rebuild a SaveGame from a JSON string produced by {@link saveToJSON}. Returns
 * null on malformed input (mirrors SaveGame.FromJson returning null).
 */
export function saveFromJSON(s: string): SaveGame | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(s);
  } catch {
    return null;
  }
  if (parsed == null || typeof parsed !== "object" || Array.isArray(parsed)) {
    return null;
  }
  return saveFromDict(parsed as Record<string, JsonValue>);
}

/** Append an action to the ordered log (convenience, mirrors AddAction). */
export function addAction(sg: SaveGame, action: SimAction): void {
  sg.actions.push(action);
}

/** Record a fast-load snapshot (convenience, mirrors AddSnapshot). */
export function addSnapshot(sg: SaveGame, snapshot: SimSnapshot): void {
  sg.snapshots.push(snapshot);
}
