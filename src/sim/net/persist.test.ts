/**
 * X-04 — checkpoint round-trip pins. A checkpoint saved mid-run and restored into a FRESH
 * session resumes bit-exactly: the state hash after restore equals the continuous run's
 * hash at the same tick. Persisted through JSON (the storage boundary), so the envelope
 * is proven store-safe, not just in-memory.
 */

import { describe, it, expect } from "vitest";
import { loadEphemeris } from "../system-data";
import { NetSession } from "./session";
import { checkpointNet, readCheckpoint, checkpointToJSON, NET_SAVE_VERSION } from "./persist";
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

  it("readCheckpoint REJECTS wire garbage + wrong versions (migration surface is the version field)", () => {
    expect(readCheckpoint(null)).toBeNull();
    expect(readCheckpoint({})).toBeNull();
    expect(readCheckpoint({ version: 0, tick: 1, session: {} })).toBeNull();
    expect(readCheckpoint({ version: NET_SAVE_VERSION, tick: 1.5, session: {} })).toBeNull();
    expect(readCheckpoint({ version: NET_SAVE_VERSION, tick: 1, session: null })).toBeNull();
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
