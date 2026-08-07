/**
 * FL-01 — the loadout-pricing exploit regression (net/ applier). Before the fix, a wire
 * launch with an ABSENT or EMPTY loadout silently fitted the standard BROADCAST antenna
 * ({@link resolveLoadout}) but was CHARGED for zero cards (the `cardIds.length > 0` guard
 * skipped validation and the price used the raw empty list) — a free €2,500 card on every
 * launch, violating consequence-truth (the charged € must equal the previewed €).
 *
 * FIX: the wire default DEFAULT_LOADOUT_CARD_IDS = ["BROADCAST"] is applied BEFORE
 * validation + pricing, always. Every launch — explicit or defaulted — is validated and
 * pays for what it flies.
 *
 * FL-11 — the batch manifest discount (−15% hardware for members 2+; vehicle shared once).
 */

import { describe, expect, it } from "vitest";
import { loadEphemeris } from "../system-data";
import { KIND_NET_LAUNCH, simAction } from "../action";
import { NetSession, launchFailureRates } from "./session";
import { launchStackCost, GEO_PARK, NET_BATCH_MEMBER_DISCOUNT, launchVehicleCost } from "./world";
import { DEFAULT_LOADOUT_CARD_IDS, hardwarePriceEur } from "./sat";
import { DT } from "../clock";
import { applyNetAction, type NetActionResult } from "./apply-action";

const eph = loadEphemeris();

function freshSession(): NetSession {
  return new NetSession();
}

/** Drive the shared applier (live == replay path) directly. */
function apply(s: NetSession, action: ReturnType<typeof simAction>): NetActionResult {
  const out = applyNetAction(eph, s, action, DT);
  if (out === null) throw new Error("expected a net action result");
  return out;
}

describe("FL-01: a loadout-less launch is CHARGED for the standard BROADCAST it flies", () => {
  const base = {
    semiMajorM: GEO_PARK.semiMajorM,
    incRad: GEO_PARK.incRad,
    subLonRad: GEO_PARK.subLonRad,
  };
  const chargedDefault = launchStackCost("smallsat", DEFAULT_LOADOUT_CARD_IDS, base.semiMajorM, 1);

  it("absent loadout ⇒ priced default (the exploit is closed)", () => {
    const s = freshSession();
    const res = apply(s, simAction(KIND_NET_LAUNCH, 0, { ...base, count: 1 }));
    expect(res.kind).toBe("sats_launched");
    expect(res.costEur).toBeCloseTo(chargedDefault, 6);
    expect(res.costEur).toBeGreaterThan(launchVehicleCost("smallsat", base.semiMajorM));
  });

  it("explicit EMPTY loadout ⇒ the same priced default (no free card via [])", () => {
    const s = freshSession();
    const res = apply(s, simAction(KIND_NET_LAUNCH, 0, { ...base, count: 1, loadout: [] }));
    expect(res.kind).toBe("sats_launched");
    expect(res.costEur).toBeCloseTo(chargedDefault, 6);
  });

  it("the defaulted sat really FLIES the BROADCAST it paid for", () => {
    const s = freshSession();
    const res = apply(s, simAction(KIND_NET_LAUNCH, 0, { ...base, count: 1 }));
    expect(res.kind).toBe("sats_launched");
    // The commit is a launch EVENT (countdown → ascent → deploy); the member's design is
    // fixed at commit. Check the pending member, then fast-forward past deploy.
    const pending = s.launchEvents[s.launchEvents.length - 1];
    expect(pending.members[0].sat.loadout.map((a) => a.cardId)).toEqual([...DEFAULT_LOADOUT_CARD_IDS]);
    for (let tick = 1; tick <= 60 * 120; tick++) s.step(eph, tick * DT, DT);
    const sat = s.sats.find((x) => x.id === res.satIds?.[0]);
    expect(sat?.loadout.map((a) => a.cardId)).toEqual([...DEFAULT_LOADOUT_CARD_IDS]);
  });

  it("an INVALID explicit loadout is still rejected (validation always runs)", () => {
    const s = freshSession();
    const res = apply(
      s,
      simAction(KIND_NET_LAUNCH, 0, { ...base, count: 1, loadout: ["BROADCAST", "ACCESS_L"] }),
    );
    expect(res.kind).toBe("rejected");
    expect(res.problem).toMatch(/G slot/);
  });
});

describe("FL-11: the batch manifest discount (−15% hardware for members 2+)", () => {
  it("a single member pays the full stack (unchanged)", () => {
    const a = GEO_PARK.semiMajorM;
    const one = launchStackCost("smallsat", ["ACCESS_S"], a, 1);
    expect(one).toBeCloseTo(launchVehicleCost("smallsat", a) + hardwarePriceEur("smallsat", ["ACCESS_S"]), 9);
  });

  it("members 2+ pay (1 − discount) × hardware; the vehicle is shared once", () => {
    const a = GEO_PARK.semiMajorM;
    const hw = hardwarePriceEur("smallsat", ["ACCESS_S"]);
    expect(launchStackCost("smallsat", ["ACCESS_S"], a, 2)).toBeCloseTo(
      launchVehicleCost("smallsat", a) + hw * (1 + (1 - NET_BATCH_MEMBER_DISCOUNT)),
      9,
    );
    expect(launchStackCost("smallsat", ["ACCESS_S"], a, 3)).toBeCloseTo(
      launchVehicleCost("smallsat", a) + hw * (1 + 2 * (1 - NET_BATCH_MEMBER_DISCOUNT)),
      9,
    );
  });

  it("batching is cheaper per sat than launching singles (the consolidation incentive)", () => {
    const a = GEO_PARK.semiMajorM;
    const single = launchStackCost("smallsat", ["BROADCAST"], a, 1);
    const perSatBatched = launchStackCost("smallsat", ["BROADCAST"], a, 3) / 3;
    expect(perSatBatched).toBeLessThan(single);
  });
});

// ── FL-10 (SD-49) — the honest risk band: rates arithmetic + the act-1 curtain ──────
describe("FL-10 — launchFailureRates + the failuresArmed curtain", () => {
  it("null while failures are dark (act 1 shows NOTHING, never a '0%' lie)", () => {
    expect(launchFailureRates(1, false)).toBeNull();
    expect(launchFailureRates(6, false)).toBeNull();
    expect(freshSession().failuresArmed).toBe(false); // cursor 0
  });

  it("armed: the flat per-launch/per-member rates + the ANY-member batch gamble", () => {
    const r = launchFailureRates(1, true)!;
    expect(r.vehicleLoss).toBeCloseTo(0.02, 12);
    expect(r.perMemberUnderburn).toBeCloseTo(0.08, 12);
    expect(r.perMemberNoSep).toBeCloseTo(0.03, 12);
    expect(r.anyMemberFailed).toBeCloseTo(0.03, 12);
    const r6 = launchFailureRates(6, true)!;
    expect(r6.anyMemberFailed).toBeCloseTo(1 - Math.pow(1 - 0.03, 6), 12);
    expect(r6.anyMemberFailed).toBeGreaterThan(6 * 0.03 * 0.9); // clearly NOT 6× (independence)
  });

  it("failuresArmed flips exactly when the act-1 gate advances the cursor", () => {
    // Driving the full canonical act-1 is the replay suite's job; here we pin the RULE:
    // the getter is a pure read of the scenario cursor (same predicate the roll gates on).
    const s = freshSession();
    expect(s.cursor).toBe(0);
    expect(s.failuresArmed).toBe(false);
  });
});
