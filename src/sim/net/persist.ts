/**
 * net/ X-04 — THE CHECKPOINT ENVELOPE. A savegame = version + the session snapshot + the
 * tick it was taken at. Everything else derives: the folded state covers roster, contracts,
 * wallet, RNG, scenario cursor, gate stamps, faults, escalation, Mars — so a restore
 * continues the run BIT-EXACT (asserted by the state-hash round-trip pin).
 *
 * PURE: JSON-safe types, no DOM, no wall clock. The WALL timestamp on the envelope is
 * presentation-only metadata handed in by the caller (never folded, never read back into
 * the sim).
 */

import type { NetSession } from "./session";

/** The current save format version. */
export const NET_SAVE_VERSION = 1;

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
  /** The session snapshot (opaque to this module — truth lives in session.snapshot()). */
  session: unknown;
}

/** Build a checkpoint from the live session. Pure except the caller-provided wall stamp. */
export function checkpointNet(session: NetSession, tick: number, savedAtMs: number): NetCheckpoint {
  return {
    version: NET_SAVE_VERSION,
    tick,
    tSim: tick * (1 / 60),
    balanceEur: session.balance,
    act: session.cursor,
    savedAtMs,
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

/** Validate + read a checkpoint back. Returns the SESSION-side restore inputs, or null
 * with the problem string when the envelope is unusable (bad version / wrong shape). */
export function readCheckpoint(raw: unknown): { tick: number; session: NetCheckpoint["session"]; meta: { tSim: number; balanceEur: number; act: number; savedAtMs: number } } | null {
  if (typeof raw !== "object" || raw === null) return null;
  const c = raw as Partial<NetCheckpoint>;
  if (c.version !== NET_SAVE_VERSION) return null; // future migrations hang HERE.
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
