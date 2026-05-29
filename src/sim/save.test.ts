import { describe, it, expect } from "vitest";
import {
  actionFromDict,
  actionToDict,
  KIND_NOOP,
  KIND_SET_TIME_SCALE,
  noop,
  setTimeScale,
} from "./action";
import {
  CURRENT_VERSION,
  dtBitsStr,
  floatFromBitsStr,
  saveFromDict,
  saveFromJSON,
  saveGame,
  saveToDict,
  saveToJSON,
  snapshotFromDict,
  snapshotToDict,
  type SimSnapshot,
} from "./save";

/**
 * Save / replay round-trip fidelity (P0-05 / ticket B2). The TS port of the
 * highest-leverage C# test (SignalHorizon.Sim.Tests/SaveReplayTests.cs, the
 * round-trip half — hashing/replay live in state-hash.test.ts and B3).
 *
 * The real risks this proves (not float precision):
 *   - dt = 1/60 returns BIT-IDENTICAL via the dt_bits IEEE-754 trick.
 *   - bigint seed / rng state survive as STRINGS and parse back equal.
 *   - the full SaveGame survives toJSON -> stringify -> parse -> fromJSON
 *     value-identically.
 *   - every SimAction kind round-trips with its payload.
 *   - the snapshot round-trips.
 */

const DT_60 = 1 / 60;

describe("dt_bits — exact IEEE-754 round-trip (the 1/60 trap)", () => {
  it("reconstructs 1/60 bit-identically through the int64 bit pattern", () => {
    const bits = dtBitsStr(DT_60);
    expect(floatFromBitsStr(bits)).toBe(DT_60);
  });

  it("dt_bits matches the C# BitConverter.DoubleToInt64Bits decimal string", () => {
    // 1/60 -> raw IEEE-754 bits 0x3F9111111111111... reinterpreted as int64 =
    // 4580461061010952465 (matches SaveGame.DtBitsStr =
    // BitConverter.DoubleToInt64Bits in the C# build). Locks byte order + sign.
    expect(dtBitsStr(DT_60)).toBe("4580461061010952465");
  });

  it("survives the naive decimal path would-be loss for a range of values", () => {
    for (const v of [DT_60, 1 / 3, Math.PI, 0.1, 1e-300, -0, Number.MAX_VALUE]) {
      expect(floatFromBitsStr(dtBitsStr(v))).toBe(v);
    }
  });
});

describe("SimAction round-trip (each kind)", () => {
  it("set_time_scale preserves kind / atTick / payload", () => {
    const a = setTimeScale(7.5, 300);
    const a2 = actionFromDict(actionToDict(a));
    expect(a2.kind).toBe(KIND_SET_TIME_SCALE);
    expect(a2.atTick).toBe(300);
    expect(a2.payload.value).toBe(7.5);
  });

  it("noop preserves kind and atTick with an empty payload", () => {
    const n = noop(99);
    const n2 = actionFromDict(actionToDict(n));
    expect(n2.kind).toBe(KIND_NOOP);
    expect(n2.atTick).toBe(99);
    expect(n2.payload).toEqual({});
  });

  it("serializes with snake_case wire keys (C#/GDScript compatible)", () => {
    const dict = actionToDict(setTimeScale(10, 600));
    expect(dict).toEqual({ kind: "set_time_scale", at_tick: 600, payload: { value: 10 } });
  });

  it("survives JSON.stringify -> JSON.parse -> fromDict", () => {
    const a = setTimeScale(2.5, 42);
    const parsed = JSON.parse(JSON.stringify(actionToDict(a)));
    const back = actionFromDict(parsed);
    expect(back).toEqual(a);
  });

  it("tolerates a partial/hand-written dict (missing keys default sanely)", () => {
    const back = actionFromDict({});
    expect(back.kind).toBe(KIND_NOOP);
    expect(back.atTick).toBe(0);
    expect(back.payload).toEqual({});
  });
});

describe("snapshot round-trip (bigint rng state as string)", () => {
  const snap: SimSnapshot = {
    tick: 1234,
    rngState: 0xffffffffffffffffn, // full u64 — beyond Number precision
    mission: {
      nextId: 7,
      occulted: true,
      scriptIdx: 3,
      nextScriptT: 6480,
      booted: true,
      packet: {
        id: 6,
        fromId: "earth",
        toId: "mars",
        launchT: 600,
        oneWay: 1284.5,
        progress: 0.5,
        freshness: 0.7,
      },
    },
  };

  it("round-trips value-identically incl. the u64 rng state", () => {
    const back = snapshotFromDict(JSON.parse(JSON.stringify(snapshotToDict(snap))));
    expect(back).toEqual(snap);
    expect(back.rngState).toBe(0xffffffffffffffffn);
    expect(typeof back.rngState).toBe("bigint");
  });

  it("round-trips a null packet", () => {
    const s2: SimSnapshot = { ...snap, mission: { ...snap.mission, packet: null } };
    const back = snapshotFromDict(JSON.parse(JSON.stringify(snapshotToDict(s2))));
    expect(back.mission.packet).toBeNull();
  });

  it("serializes the rng state as a string (JSON has no bigint)", () => {
    const dict = snapshotToDict(snap) as unknown as Record<string, unknown>;
    expect(dict.rng_state).toBe("18446744073709551615");
    expect(typeof dict.rng_state).toBe("string");
  });
});

describe("SaveGame round-trip — toJSON -> stringify -> parse -> fromJSON", () => {
  function buildSave() {
    const sg = saveGame(1234567n, DT_60, { system: "data/system.json" });
    sg.actions.push(setTimeScale(10, 0));
    sg.actions.push(noop(120));
    sg.actions.push(setTimeScale(1, 600));
    sg.snapshots.push({
      tick: 0,
      rngState: 1234567n,
      mission: { nextId: 1, occulted: false, scriptIdx: 0, nextScriptT: 540, booted: false, packet: null },
    });
    sg.snapshots.push({
      tick: 600,
      rngState: 9876543210987654321n,
      mission: {
        nextId: 2,
        occulted: true,
        scriptIdx: 2,
        nextScriptT: 1620,
        booted: true,
        packet: { id: 1, fromId: "earth", toId: "mars", launchT: 0, oneWay: 1280, progress: 0.46875, freshness: 0.5 },
      },
    });
    return sg;
  }

  it("is value-identical end to end (dt === 1/60 exactly, bigints equal)", () => {
    const sg = buildSave();
    const reloaded = saveFromJSON(saveToJSON(sg));
    expect(reloaded).not.toBeNull();
    expect(reloaded).toEqual(sg);

    // The load-bearing assertions, called out explicitly:
    expect(reloaded!.dt).toBe(DT_60); // exact — dt_bits, not the decimal.
    expect(reloaded!.seed).toBe(1234567n); // bigint preserved.
    expect(typeof reloaded!.seed).toBe("bigint");
    expect(reloaded!.snapshots[1].rngState).toBe(9876543210987654321n);
    expect(reloaded!.version).toBe(CURRENT_VERSION);
    expect(reloaded!.actions.length).toBe(3);
    expect(reloaded!.snapshots.length).toBe(2);
    expect(reloaded!.initialConditions.system).toBe("data/system.json");
  });

  it("is byte-identical on a second serialization (idempotent JSON)", () => {
    const sg = buildSave();
    const jsonA = saveToJSON(sg);
    const jsonB = saveToJSON(saveFromJSON(jsonA)!);
    expect(jsonB).toBe(jsonA);
  });

  it("the naive dt path WOULD lose 1/60, proving dt_bits is necessary", () => {
    // Sanity guard: dt carried only as a JSON number is not guaranteed stable
    // under a print/parse that rounds; dt_bits sidesteps the entire question.
    const sg = buildSave();
    const dict = saveToDict(sg);
    // dt_bits is the authoritative field and reconstructs exactly.
    expect(floatFromBitsStr(dict.dt_bits)).toBe(DT_60);
    // fromDict prefers dt_bits over the decimal dt.
    expect(saveFromDict({ ...dict, dt: 0.01666 }).dt).toBe(DT_60);
  });

  it("returns null on malformed JSON (graceful, no throw)", () => {
    expect(saveFromJSON("} not json {")).toBeNull();
    expect(saveFromJSON("[1,2,3]")).toBeNull(); // not an object
  });

  it("loads an older save with no dt_bits via the decimal dt fallback", () => {
    const sg = saveFromDict({ version: 1, seed: "42", dt: 0.5, initial_conditions: {}, actions: [], snapshots: [] });
    expect(sg.dt).toBe(0.5);
    expect(sg.seed).toBe(42n);
  });
});
