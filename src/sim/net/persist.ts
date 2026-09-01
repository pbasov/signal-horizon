/**
 * net/ X-04 — THE CHECKPOINT ENVELOPE. A savegame = version + the session snapshot + the
 * tick it was taken at. Everything else derives: the folded state covers roster, contracts,
 * wallet, RNG, scenario cursor, gate stamps, faults, escalation, Mars — so a restore
 * continues the run BIT-EXACT (asserted by the state-hash round-trip pin).
 *
 * PURE: JSON-safe types, no DOM, no wall clock. The WALL timestamp on the envelope is
 * presentation-only metadata handed in by the caller (never folded, never read back into
 * the sim).
 *
 * --- FOLDED vs PRESENTATION ------------------------------------------------------------
 * `session` is the FOLDED truth — it decides the state hash, so a restore is bit-exact.
 * Everything beside it (`tSim`, `balanceEur`, `act`, `savedAtMs`, `scaleIndex`, `paused`)
 * is PRESENTATION: written for the slot label and the view's own comfort, never read back
 * into the sim, never folded. That split is why the time-accel cursor can ride along in v2
 * without touching a single golden.
 *
 * --- VERSIONING + MIGRATION ------------------------------------------------------------
 * A save sitting in a player's browser outlives the code that wrote it. `NET_SAVE_VERSION`
 * is the format stamp and {@link migrateCheckpoint} is the upgrade ladder: one rung per
 * version, applied in order, until the envelope reads current. A version with NO rung is
 * unreadable and reads as "no save" rather than as a half-load. A save from the FUTURE (a
 * newer build wrote it) is likewise refused — we cannot invent fields we never wrote.
 */

import type { NetSession } from "./session";

/** The current save format version. v1 -> v2 added the presentation-only view state. */
export const NET_SAVE_VERSION = 2;

/**
 * The time-accel cursor a pre-v2 save (or a field-less envelope) is read at. v1 never
 * recorded the accel, so there is nothing to recover — this is deliberately the COLD-BOOT
 * accel, `TIME_SCALES[0]` === 1x real-time, which is what net mode starts a run at. Resuming
 * an old save at 1x is the honest answer to "we don't know"; inheriting 100x would fling the
 * player's restored world forward at a speed they never chose. Held as a plain number rather
 * than imported from the clock so this module stays a leaf.
 */
const LEGACY_SCALE_INDEX = 0;

/** The view state riding along with a checkpoint. PRESENTATION ONLY — never folded. */
export interface CheckpointView {
  /** Index into `TIME_SCALES` (the time-accel cursor) at save. */
  scaleIndex: number;
  /** Whether the run was paused at save. */
  paused: boolean;
}

/** A checkpoint payload: what a save slot holds. JSON-safe. */
export interface NetCheckpoint {
  version: number;
  /** The snapshot's sim-tick — restoring sets the clock to it. */
  tick: number;
  /** Sim-seconds the run had covered when saved (readout only). */
  tSim: number;
  /** Wallet € at save (readout only). */
  balanceEur: number;
  /** Scenario cursor at save (readout only; the snapshot carries the truth). */
  act: number;
  /** Wall-clock ms when saved (PRESENTATION ONLY — for the slot label; never folded). */
  savedAtMs: number;
  /** Time-accel cursor at save (PRESENTATION ONLY — restored into the clock, never folded). */
  scaleIndex: number;
  /** Paused at save (PRESENTATION ONLY — restored into the clock, never folded). */
  paused: boolean;
  /** The session snapshot (opaque to this module — truth lives in session.snapshot()). */
  session: unknown;
}

/** Build a checkpoint from the live session. Pure except the caller-provided wall stamp. */
export function checkpointNet(
  session: NetSession,
  tick: number,
  savedAtMs: number,
  view: CheckpointView = { scaleIndex: LEGACY_SCALE_INDEX, paused: false },
): NetCheckpoint {
  return {
    version: NET_SAVE_VERSION,
    tick,
    tSim: tick * (1 / 60),
    balanceEur: session.balance,
    act: session.cursor,
    savedAtMs,
    scaleIndex: view.scaleIndex,
    paused: view.paused,
    session: toJSONSafe(session.snapshot()),
  };
}

// ── the JSON-safety boundary ─────────────────────────────────────────────────────
// The snapshot carries a live `Set` per contract (activeAxes) — which JSON.stringify
// SILENTLY ruins (Set → {}). The envelope boundary converts Set ↔ array strictly, both
// ways, so what's folded into the golden stays byte-exact and what's on disk is real JSON.
function toJSONSafe(snap: ReturnType<NetSession["snapshot"]>): unknown {
  return {
    ...snap,
    contracts: snap.contracts.map((c) => ({ ...c, activeAxes: [...c.activeAxes] })),
  };
}

/** Restore-shape: read-side of the boundary. JSON turns non-finite floats into null — the
 * sim's canonical defaults (an eternal offer clock / no decay) are exactly those non-finite
 * values, so map null back onto the canonical defaults per field. */
function fromJSONSafe(obj: unknown): unknown {
  if (typeof obj !== "object" || obj === null) return obj;
  const snap = obj as { contracts?: unknown };
  if (!Array.isArray(snap.contracts)) return obj;
  return {
    ...snap,
    contracts: snap.contracts.map((c) => {
      const cc = c as { [k: string]: unknown };
      return {
        ...cc,
        activeAxes: new Set(Array.isArray(cc.activeAxes) ? (cc.activeAxes as string[]) : []),
        // Infinity doesn't survive JSON (it becomes null). These two fields are the
        // non-finite-capable contract fields — null reads the canonical default back in.
        offerExpiresAtS: cc.offerExpiresAtS === null ? Infinity : cc.offerExpiresAtS,
        payHalvingS: cc.payHalvingS === null ? Infinity : cc.payHalvingS,
      };
    }),
  };
}

// ── the migration ladder ─────────────────────────────────────────────────────────

/** One rung: take an envelope AT version N and hand back the same run AT version N+1. */
type Rung = (raw: Record<string, unknown>) => Record<string, unknown>;

/**
 * The ladder, keyed by the version each rung upgrades FROM. Adding a format break =
 * bumping NET_SAVE_VERSION and adding exactly ONE rung here; the walk below does the rest.
 *
 * 1 -> 2: the presentation-only view state (time-accel cursor + paused) joined the
 *         envelope. A v1 save never recorded it, so it resumes at the clock's own
 *         defaults. The FOLDED half is untouched, so a migrated v1 save restores bit-exact.
 */
const LADDER: Record<number, Rung> = {
  1: (raw) => ({ ...raw, version: 2, scaleIndex: LEGACY_SCALE_INDEX, paused: false }),
};

/**
 * Walk an envelope up the ladder to {@link NET_SAVE_VERSION}. Returns the upgraded
 * envelope, or null when it cannot be read at all:
 *   - no integer `version` (not one of our envelopes);
 *   - a version NEWER than this build wrote (we would have to invent fields);
 *   - a version with no rung (a break nobody wrote a migration for).
 * An already-current envelope passes through untouched.
 */
export function migrateCheckpoint(raw: Record<string, unknown>): Record<string, unknown> | null {
  if (typeof raw.version !== "number" || !Number.isInteger(raw.version)) return null;
  if (raw.version > NET_SAVE_VERSION) return null; // a save from the FUTURE: refuse, don't guess.
  let cur = raw;
  // Each rung MUST raise the version (asserted in-loop), so this walk cannot spin.
  while (typeof cur.version === "number" && cur.version < NET_SAVE_VERSION) {
    const from = cur.version;
    const rung = LADDER[from];
    if (rung === undefined) return null;
    cur = rung(cur);
    if (typeof cur.version !== "number" || cur.version <= from) return null; // a bad rung.
  }
  return cur;
}

/** Validate + read a checkpoint back. Returns the SESSION-side restore inputs, or null
 * when the envelope is unusable (bad version / wrong shape). Older formats are walked up
 * the migration ladder FIRST, so a v1 save still loads. */
export function readCheckpoint(raw: unknown): { tick: number; session: NetCheckpoint["session"]; meta: { tSim: number; balanceEur: number; act: number; savedAtMs: number; scaleIndex: number; paused: boolean } } | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) return null;
  const migrated = migrateCheckpoint(raw as Record<string, unknown>);
  if (migrated === null) return null; // unreadable format = "no save" (never a half-load).
  const c = migrated as Partial<NetCheckpoint>;
  if (c.version !== NET_SAVE_VERSION) return null; // belt: the ladder must land on current.
  if (typeof c.tick !== "number" || !Number.isInteger(c.tick) || c.tick < 0) return null;
  if (typeof c.session !== "object" || c.session === null) return null;
  return {
    tick: c.tick,
    session: fromJSONSafe(c.session),
    meta: {
      tSim: typeof c.tSim === "number" ? c.tSim : c.tick / 60,
      balanceEur: typeof c.balanceEur === "number" ? c.balanceEur : 0,
      act: typeof c.act === "number" ? c.act : 0,
      savedAtMs: typeof c.savedAtMs === "number" ? c.savedAtMs : 0,
      scaleIndex:
        typeof c.scaleIndex === "number" && Number.isInteger(c.scaleIndex) && c.scaleIndex >= 0
          ? c.scaleIndex
          : LEGACY_SCALE_INDEX,
      paused: c.paused === true,
    },
  };
}

/**
 * Serialize: the checkpoint goes through JSON strictly (the slot stores a STRING). Throws
 * when the snapshot can't round-trip (a bug, not a player action — the snapshot pair is
 * pinned JSON-safe by the replay tests).
 */
export function checkpointToJSON(cp: NetCheckpoint): string {
  const s = JSON.stringify(cp);
  // Fail fast if anything non-JSON-safe snuck in (undefined members can survive a
  // stringify silently — the round-trip guard in the test pins this).
  JSON.parse(s);
  return s;
}
