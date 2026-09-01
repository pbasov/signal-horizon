/**
 * X-04 — THE VAULT: browser-storage save slots (localStorage), built on the pure
 * checkpoint envelope (sim/net/persist.ts). Zero sim imports beyond the envelope —
 * this module is presentation/service layer and CAN touch storage + wall clocks.
 *
 * DESIGN:
 *  - Slots: "quick" (V) + "autosave" (SysMaint) + up to 3 named (future). localStorage so
 *    saves survive browser restarts with no server. Quota errors are caught and reported
 *    as a string (the caller surfaces them on the wire — never crash the game on a full disk).
 *  - AUTOSAVE: the frame loop calls maybeAutosave on a sim-time cadence (no wall timers —
 *    pausing the game must pause autosaves too).
 *  - The vault is honest about what it restores: the fold hash is printed on load so a
 *    resumed run CANNOT silently diverge from the canonical one (the parse's honesty law).
 */

import {
  checkpointToJSON,
  readCheckpoint,
  type NetCheckpoint,
  NET_SAVE_VERSION,
} from "./sim/net/persist";

const PREFIX = "signalhorizon.net.v1.";
const SLOTS = ["quick", "autosave", "a", "b"] as const;
export type VaultSlot = (typeof SLOTS)[number];

/** localStorage can be absent (private mode, hard privacy) — degrade to no-vault, never throw. */
function storage(): Storage | null {
  try {
    return typeof localStorage !== "undefined" ? localStorage : null;
  } catch {
    return null;
  }
}

/** Write a checkpoint into a slot. Returns null on success, or the failure string. */
export function saveToVault(slot: VaultSlot, cp: NetCheckpoint): string | null {
  const store = storage();
  if (!store) return "browser storage unavailable";
  try {
    store.setItem(PREFIX + slot, checkpointToJSON(cp));
    return null;
  } catch (e) {
    return `save failed: ${e instanceof Error ? e.message : String(e)}`;
  }
}

/** Read + VALIDATE a slot. version/shape failures read as "no save" (never a half-load). */
export function readVault(slot: VaultSlot): NetCheckpoint | null {
  const store = storage();
  if (!store) return null;
  const raw = store.getItem(PREFIX + slot);
  if (raw === null) return null;
  try {
    const back = readCheckpoint(JSON.parse(raw));
    if (back === null) return null; // bad envelope = forget it exists (never crash on save rot)
    return {
      version: NET_SAVE_VERSION,
      tick: back.tick,
      tSim: back.meta.tSim,
      balanceEur: back.meta.balanceEur,
      act: back.meta.act,
      savedAtMs: back.meta.savedAtMs,
      scaleIndex: back.meta.scaleIndex,
      paused: back.meta.paused,
      session: back.session,
    };
  } catch {
    return null;
  }
}

/** A slot's headline, as the load board (and the resume picker) read it. */
export interface VaultEntry {
  slot: VaultSlot;
  savedAtMs: number;
  tSim: number;
  act: number;
  balanceEur: number;
}

/** List which slots hold saves, NEWEST FIRST (the load board's order). */
export function vaultContents(): VaultEntry[] {
  const out: VaultEntry[] = [];
  for (const slot of SLOTS) {
    const cp = readVault(slot);
    if (cp !== null) out.push({ slot, savedAtMs: cp.savedAtMs, tSim: cp.tSim, act: cp.act, balanceEur: cp.balanceEur });
  }
  return out.sort(compareRecency);
}

/**
 * The RESUME ordering (pure, so it's unit-testable without a browser): newest wall stamp
 * wins. Ties break on the further-along run (more sim-time), then on slot order — the
 * autosave and a quick save written in the same millisecond must still order DETERMINISTICALLY,
 * or "continue where I left off" would depend on Object key iteration luck.
 */
export function compareRecency(a: VaultEntry, b: VaultEntry): number {
  if (b.savedAtMs !== a.savedAtMs) return b.savedAtMs - a.savedAtMs;
  if (b.tSim !== a.tSim) return b.tSim - a.tSim;
  return SLOTS.indexOf(a.slot) - SLOTS.indexOf(b.slot);
}

/**
 * Pick the slot a cold boot should resume from: the most recent save across all slots, or
 * null when the vault is empty. Pure over the listing so the choice is testable.
 */
export function pickResumeSlot(entries: VaultEntry[]): VaultSlot | null {
  if (entries.length === 0) return null;
  return [...entries].sort(compareRecency)[0].slot;
}

/** The slot a cold boot should resume from, read straight off browser storage. */
export function resumeSlot(): VaultSlot | null {
  return pickResumeSlot(vaultContents());
}

/** Clear one slot (or all — a full NG+ wipe affordance). */
export function clearVault(slot?: VaultSlot): void {
  const store = storage();
  if (!store) return;
  if (slot !== undefined) {
    store.removeItem(PREFIX + slot);
    return;
  }
  for (const s of SLOTS) store.removeItem(PREFIX + s);
}

// ── X-04a — the PREFS shelf: render-layer preferences (audio volume / the mono display mode)
// persist BESIDE the vault — same storage story, same never-crash law, but NOT sim state:

export interface StoredPrefs {
  mono: boolean;
  muted: boolean;
  /** SD-60 — the player asked never to see the intro console again. Defaults false. */
  skipIntro: boolean;
}

const PREFS_KEY = "signalhorizon.prefs.v1";

export function loadPrefs(): StoredPrefs {
  const store = storage();
  if (!store) return { mono: false, muted: false, skipIntro: false };
  try {
    const raw = store.getItem(PREFS_KEY);
    if (raw === null) return { mono: false, muted: false, skipIntro: false };
    const p = JSON.parse(raw) as Partial<StoredPrefs>;
    // Absent key reads false, so a v1 prefs blob written before SD-60 stays valid.
    return { mono: p.mono === true, muted: p.muted === true, skipIntro: p.skipIntro === true };
  } catch {
    return { mono: false, muted: false, skipIntro: false };
  }
}

export function storePrefs(p: StoredPrefs): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(PREFS_KEY, JSON.stringify(p));
  } catch {
    /* quota shrug */
  }
}
