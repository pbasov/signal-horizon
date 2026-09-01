/**
 * X-04 — checkpoint round-trip pins. A checkpoint saved mid-run and restored into a FRESH
 * session resumes bit-exactly: the state hash after restore equals the continuous run's
 * hash at the same tick. Persisted through JSON (the storage boundary), so the envelope
 * is proven store-safe, not just in-memory.
 */

import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { NetSession } from "./session";
import { checkpointNet, readCheckpoint, checkpointToJSON, migrateCheckpoint, NET_SAVE_VERSION } from "./persist";
import { netStateHash, act4Log, GOLDEN_DT } from "./canon";
import { applyNetAction } from "./apply-action";

/** Step a fresh session to `tSim` under the canonical action log (up to that point). */
function runTo(tSim: number): NetSession {
  const s = new NetSession();
  const eph = loadEphemeris(); void eph;
  const sg = act4Log();
  const byTick = new Map(sg.actions.map((a) => [a.atTick, [a]]));
  const maxTick = Math.round(tSim / GOLDEN_DT);
  for (let tick = 0; tick <= maxTick; tick++) {
    const t = tick * GOLDEN_DT;
    s.step(eph, t, GOLDEN_DT);
    const list = byTick.get(tick);
    if (list) for (const a of list) applyNetAction(eph, s, a, GOLDEN_DT);
  }
  return s;
}

describe("X-04 — checkpointNet / readCheckpoint", () => {
  it("the envelope carries version/tick/readouts and JSON round-trips", () => {
    const s = new NetSession();
    const cp = checkpointNet(s, 600, 1_789_000_000_000);
    expect(cp.version).toBe(NET_SAVE_VERSION);
    expect(cp.tick).toBe(600);
    expect(cp.tSim).toBe(10);
    expect(cp.balanceEur).toBe(75000);
    expect(cp.act).toBe(0);
    expect(cp.savedAtMs).toBe(1_789_000_000_000);
    const back = readCheckpoint(JSON.parse(checkpointToJSON(cp)));
    expect(back).not.toBeNull();
    expect(back!.tick).toBe(600);
    expect(back!.meta.savedAtMs).toBe(1_789_000_000_000);
  });

  it("readCheckpoint REJECTS wire garbage + unreadable versions", () => {
    expect(readCheckpoint(null)).toBeNull();
    expect(readCheckpoint({})).toBeNull();
    // version 0 predates the ladder's bottom rung — no migration exists, so it is unreadable.
    expect(readCheckpoint({ version: 0, tick: 1, session: {} })).toBeNull();
    expect(readCheckpoint({ version: NET_SAVE_VERSION, tick: 1.5, session: {} })).toBeNull();
    expect(readCheckpoint({ version: NET_SAVE_VERSION, tick: 1, session: null })).toBeNull();
    // A save from the FUTURE: refuse rather than invent the fields we never wrote.
    expect(readCheckpoint({ version: NET_SAVE_VERSION + 1, tick: 1, session: {} })).toBeNull();
    expect(readCheckpoint([])).toBeNull();
  });

  it("carries the PRESENTATION view state (accel cursor + pause) through the wire", () => {
    const s = new NetSession();
    const cp = checkpointNet(s, 600, 5, { scaleIndex: 3, paused: true });
    expect(cp.scaleIndex).toBe(3);
    expect(cp.paused).toBe(true);
    const back = readCheckpoint(JSON.parse(checkpointToJSON(cp)))!;
    expect(back.meta.scaleIndex).toBe(3);
    expect(back.meta.paused).toBe(true);
  });

  it("RESTORE into a fresh session yields the SAME fold hash at the same state (folded truth)", () => {
    // The strong, meaningful pin: populate mid-run, checkpoint through JSON, restore into a
    // FRESH session — the fold hash must equal the pre-save one. (Continuation-after-restore
    // bit-identity is owned by the net-replay restore==continuous test, same snapshot path.)
    const before = runTo(150);
    const cp = checkpointNet(before, Math.round(150 / GOLDEN_DT), 111);
    // Variant A — in-memory restore (no JSON boundary): the fold hash is unchanged.
    const restoredMem = new NetSession();
    restoredMem.restore(before.snapshot());
    expect(netStateHash(restoredMem)).toBe(netStateHash(before));
    // Variant B — through the envelope (a JSON STRING on the wire): still byte-through.
    const back = readCheckpoint(JSON.parse(checkpointToJSON(cp)))!;
    const restored = new NetSession();
    restored.restore(back.session as ReturnType<NetSession["snapshot"]>);
    expect(netStateHash(restored)).toBe(netStateHash(before));
  });

  it("the RESTORED session's own wallet continues from the checkpoint (no reset)", () => {
    const before = runTo(100);
    const cp = checkpointNet(before, Math.round(100 / GOLDEN_DT), 7);
    const back = readCheckpoint(JSON.parse(checkpointToJSON(cp)))!;
    const restored = new NetSession();
    restored.restore(back.session as ReturnType<NetSession["snapshot"]>);
    expect(restored.balance).toBeCloseTo(before.balance, 9);
    expect(restored.cursor).toBe(before.cursor);
    expect(restored.sats.length).toBe(before.sats.length);
  });
});

// ── X-04b — THE MIGRATION LADDER ────────────────────────────────────────────────────────
// A save sitting in a player's browser outlives the build that wrote it. These pin that an
// OLD envelope still loads, and — the part that actually matters — that migrating it does
// not disturb the FOLDED half, so a resumed v1 run is still bit-exact.

/** Forge the v1 envelope shape: v1 never had the presentation view state. */
function asV1(cp: ReturnType<typeof checkpointNet>): Record<string, unknown> {
  const raw = JSON.parse(checkpointToJSON(cp)) as Record<string, unknown>;
  delete raw.scaleIndex;
  delete raw.paused;
  raw.version = 1;
  return raw;
}

describe("X-04b — migrateCheckpoint", () => {
  it("walks a v1 envelope up to current and LOADS it", () => {
    const s = new NetSession();
    const v1 = asV1(checkpointNet(s, 600, 42, { scaleIndex: 3, paused: true }));
    expect(v1.version).toBe(1);
    const up = migrateCheckpoint(v1);
    expect(up).not.toBeNull();
    expect(up!.version).toBe(NET_SAVE_VERSION);
    // readCheckpoint runs the ladder itself, so a v1 save loads with no caller ceremony.
    const back = readCheckpoint(v1);
    expect(back).not.toBeNull();
    expect(back!.tick).toBe(600);
    expect(back!.meta.savedAtMs).toBe(42);
  });

  it("a v1 save resumes at the COLD-BOOT accel (1x) — the field it never recorded", () => {
    const s = new NetSession();
    // Even though this envelope was authored at 1000x + paused, stripping the v2 fields is
    // what a real v1 save looks like: the accel is simply not knowable, so it reads as 1x.
    const back = readCheckpoint(asV1(checkpointNet(s, 60, 1, { scaleIndex: 3, paused: true })))!;
    expect(back.meta.scaleIndex).toBe(0);
    expect(back.meta.paused).toBe(false);
  });

  it("migrating a v1 save leaves the FOLDED half untouched (still bit-exact)", () => {
    // The load-bearing pin: the whole point of the version split is that a migration touches
    // presentation only. Restore a MIGRATED v1 envelope and the fold hash must be unchanged.
    const before = runTo(150);
    const cp = checkpointNet(before, Math.round(150 / GOLDEN_DT), 111, { scaleIndex: 2, paused: false });
    const back = readCheckpoint(asV1(cp))!;
    const restored = new NetSession();
    restored.restore(back.session as ReturnType<NetSession["snapshot"]>);
    expect(netStateHash(restored)).toBe(netStateHash(before));
  });

  it("passes a CURRENT envelope through untouched", () => {
    const s = new NetSession();
    const raw = JSON.parse(checkpointToJSON(checkpointNet(s, 12, 3))) as Record<string, unknown>;
    expect(migrateCheckpoint(raw)).toEqual(raw);
  });

  it("REFUSES what it cannot read: no version, a non-integer version, the future, a missing rung", () => {
    expect(migrateCheckpoint({})).toBeNull(); // not one of our envelopes at all
    expect(migrateCheckpoint({ version: "1" })).toBeNull();
    expect(migrateCheckpoint({ version: 1.5 })).toBeNull();
    expect(migrateCheckpoint({ version: NET_SAVE_VERSION + 1 })).toBeNull(); // from the future
    expect(migrateCheckpoint({ version: 0 })).toBeNull(); // below the ladder's bottom rung
    expect(migrateCheckpoint({ version: -3 })).toBeNull();
  });
});
