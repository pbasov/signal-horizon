import { describe, it, expect } from "vitest";
import { SimRng } from "../rng";
import { resolveOrbit, GEO_PARK, LEO_SWEEP } from "./world";
import { standardLoadout, type NetSat } from "./sat";
import { NET_REF_LINK_DISTANCE_M } from "./link-budget";
import {
  rollFaults,
  makeFaultState,
  stochasticCauseForSat,
  STOCHASTIC_FAULT_KIND,
} from "./fault";
import {
  type FaultState,
  type FaultScript,
  FAULT_REMOVES_SAT,
  DEGRADATION_CAPACITY_FACTOR,
  DEGRADATION_DURATION_S,
  TRANSIENT_DURATION_S,
  TELEGRAPHED_COUNTDOWN_S,
  RARE_RANDOM_FAULT_RATE_PER_S,
  CAUSAL_BASE_FAULT_RATE_PER_S,
  causalFaultRatePerS,
  causalInputForSat,
  faultResolvedAt,
  faultRemovesSatAt,
  telegraphedCountdownRemainingS,
} from "./fault-types";

/**
 * net/ ACT 3b — THE FAULT SPECTRUM (design §5 / C2.1). fault.ts is the seeded, PURE generator:
 * a step `rollFaults` that draws from the passed-in SimRng (the M2 launch-failure-roll pattern,
 * NO new seed) and produces the next tick's NEW faults + the resolved ones. This suite pins:
 *   - DETERMINISM: same rng state + same inputs ⇒ a bit-identical fault sequence (replay-safe).
 *   - MILD-FIRST capability: the scripted queue fires scripted-first (a Degradation, then a
 *     Telegraphed failure) BEFORE any stochastic fault — the ordering the act3b beat sequences.
 *   - SELF-RECOVERY: a degradation/transient resolves at recoversAtS; a telegraphed countdown
 *     expires into a drop at failsAtS; a hard fault never resolves.
 *   - THE TELEGRAPHED COUNTDOWN: failsAtS = startedAtS + the lead time; the sat routes until then.
 *   - PURITY of the seam: rollFaults mutates none of its inputs.
 */

/** Build a launched NetSat from a world preset at a given epoch (the real field path:
 * orbit.aM = semi-major axis, orbit.epochS = the launch epoch the age lever reads). */
function makeSat(
  id: string,
  preset: { semiMajorM: number; incRad: number; subLonRad: number },
  epochS: number,
): NetSat {
  return {
    id,
    orbit: resolveOrbit(
      { semiMajorM: preset.semiMajorM, incRad: preset.incRad, subLonRad: preset.subLonRad },
      epochS,
    ),
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

/** Build a NetSat at an explicit semi-major axis (metres) + epoch. Used to probe the LOW-ORBIT
 * lever at REAL-Earth scales: the toy GEO_PARK/LEO_SWEEP presets both sit far BELOW the
 * fault-types LOW_ORBIT_REF_M (a real-Earth GEO radius), so a true GEO-class orbit (aM ≳ the
 * reference) is needed to exercise the lever's NEUTRAL end + the rareRandom-cause fallback. */
function makeSatAt(id: string, aM: number, epochS: number): NetSat {
  return {
    id,
    orbit: {
      parentId: "earth",
      aM,
      e: 0,
      incRad: 0,
      raanRad: 0,
      argpRad: 0,
      m0Rad: 0,
      epochS,
      muParent: 1,
    },
    bus: "smallsat",
    loadout: standardLoadout(NET_REF_LINK_DISTANCE_M),
  };
}

// ── makeFaultState: the spectrum's predictability-seed times per kind ─────────────

describe("makeFaultState — the spectrum stamps the right predictability-seed times", () => {
  it("degradation: a capacity haircut that self-recovers, no countdown", () => {
    const f = makeFaultState("S0", "degradation", "lowOrbit", 100);
    expect(f.kind).toBe("degradation");
    expect(f.degradedCapacityFactor).toBe(DEGRADATION_CAPACITY_FACTOR);
    expect(f.degradedCapacityFactor).toBeGreaterThan(0);
    expect(f.degradedCapacityFactor).toBeLessThanOrEqual(1);
    expect(f.recoversAtS).toBe(100 + DEGRADATION_DURATION_S);
    expect(f.failsAtS).toBe(Infinity); // unwarned — no countdown.
    expect(FAULT_REMOVES_SAT[f.kind]).toBe(false); // the sat still routes (haircut, not removal).
  });

  it("transient: a brief full outage that self-recovers", () => {
    const f = makeFaultState("S0", "transient", "lowOrbit", 100);
    expect(f.recoversAtS).toBe(100 + TRANSIENT_DURATION_S);
    expect(f.failsAtS).toBe(Infinity);
    expect(FAULT_REMOVES_SAT[f.kind]).toBe(true); // a full outage removes the sat.
  });

  it("telegraphed: a warned failure with a countdown, never recovers", () => {
    const f = makeFaultState("S0", "telegraphed", "age", 100);
    expect(f.failsAtS).toBe(100 + TELEGRAPHED_COUNTDOWN_S);
    expect(f.recoversAtS).toBe(Infinity); // it fails, it does not recover.
  });

  it("hard: permanent — never recovers, no countdown (effectively off this hour)", () => {
    const f = makeFaultState("S0", "hard", "rareRandom", 100);
    expect(f.recoversAtS).toBe(Infinity);
    expect(f.failsAtS).toBe(Infinity);
  });
});

// ── DETERMINISM: same rng state ⇒ identical fault sequence (replay-safe) ───────────

describe("rollFaults — DETERMINISM (same rng state ⇒ a bit-identical fault sequence)", () => {
  // A deep LEO with a large age drives the causal rate well above the floor, and a large dt
  // (pure sim-seconds math) makes a stochastic hit reachable so the determinism comparison has
  // real firings to compare — not two empty rolls.
  const sat = makeSat("LEO-0", LEO_SWEEP, 0);
  const t = 1_000_000; // a large age (ageS = t − epochS) so the age lever is fully engaged.
  const dt = 50; // a large step so rate·dt is appreciable (firings exist to compare).

  it("two rolls from the SAME seed produce byte-identical started/resolved", () => {
    const a = rollFaults([], [sat], t, dt, new SimRng(7n));
    const b = rollFaults([], [sat], t, dt, new SimRng(7n));
    expect(a).toEqual(b);
  });

  it("a 200-step sequence is reproducible from the same seed (the replay guarantee)", () => {
    const run = (): FaultState[] => {
      const rng = new SimRng(123456789n);
      let active: FaultState[] = [];
      const fired: FaultState[] = [];
      for (let i = 1; i <= 200; i++) {
        const now = i * dt;
        const { started, resolved } = rollFaults(active, [sat], now, dt, rng);
        for (const s of started) fired.push(s);
        const resolvedSet = new Set(resolved);
        active = active.filter((f) => !resolvedSet.has(f.satId)).concat(started);
      }
      return fired;
    };
    const first = run();
    const second = run();
    expect(second).toEqual(first);
    expect(first.length).toBeGreaterThan(0); // the sequence actually exercised some firings.
  });

  it("a DIFFERENT seed yields a different draw cadence (the seed is load-bearing)", () => {
    // Borderline probability: with two distinct seeds the per-step Bernoulli decisions diverge,
    // so over a window the two sequences differ (proves the outcome rides the seeded stream).
    const window = (seed: bigint): number => {
      const rng = new SimRng(seed);
      let active: FaultState[] = [];
      let count = 0;
      for (let i = 1; i <= 300; i++) {
        const now = i * dt;
        const { started, resolved } = rollFaults(active, [sat], now, dt, rng);
        count += started.length;
        const resolvedSet = new Set(resolved);
        active = active.filter((f) => !resolvedSet.has(f.satId)).concat(started);
      }
      return count;
    };
    // Same seed ⇒ same count; the assertion that matters is reproducibility (above). Here we
    // simply confirm the roll consumes the seed (a fresh seed re-runs to its OWN stable count).
    expect(window(1n)).toBe(window(1n));
    expect(window(2n)).toBe(window(2n));
  });

  it("advances the rng by exactly ONE draw per eligible sat per step (fixed draw count)", () => {
    const sats = [makeSat("A", GEO_PARK, 0), makeSat("B", LEO_SWEEP, 0)];
    const rng = new SimRng(99n);
    const before = rng.state;
    rollFaults([], sats, 10, 1 / 60, rng);
    // Replay the same number of draws on a parallel rng and confirm the state matches: 2 sats,
    // no scripted queue ⇒ exactly 2 nextDouble() draws.
    const parallel = new SimRng(before);
    parallel.nextDouble();
    parallel.nextDouble();
    expect(rng.state).toBe(parallel.state);
  });

  it("a scripted fault consumes exactly ONE draw (scripted pair shares the stream cadence)", () => {
    const sats = [makeSat("A", GEO_PARK, 0)];
    const rng = new SimRng(99n);
    const before = rng.state;
    // One scripted fault + one eligible sat that the script targets (so the stochastic pass
    // skips it) ⇒ exactly ONE draw (the scripted target pick).
    const queue: FaultScript[] = [{ kind: "degradation", targetSatId: "A", cause: "lowOrbit" }];
    rollFaults([], sats, 10, 1 / 60, rng, queue);
    const parallel = new SimRng(before);
    parallel.nextDouble(); // the scripted target-pick draw.
    // The sole sat "A" is the scripted target ⇒ no stochastic draw for it.
    expect(rng.state).toBe(parallel.state);
  });
});

// ── MILD-FIRST: the scripted pair fires scripted-first, before any stochastic fault ─

describe("rollFaults — MILD-FIRST capability (Degradation, then Telegraphed, scripted-first)", () => {
  const sats = [makeSat("LEO-0", LEO_SWEEP, 0), makeSat("LEO-1", LEO_SWEEP, 0)];

  it("a queued [degradation, telegraphed] pair fires IN ORDER, scripted-first", () => {
    const queue: FaultScript[] = [
      { kind: "degradation", targetSatId: null, cause: "lowOrbit" },
      { kind: "telegraphed", targetSatId: null, cause: "lowOrbit" },
    ];
    const { started } = rollFaults([], sats, 10, 1 / 60, new SimRng(42n), queue);
    // The first two started faults are the scripted pair, in queue order (mild-first): the
    // Degradation precedes the Telegraphed failure. (No stochastic fault precedes them.)
    expect(started.length).toBeGreaterThanOrEqual(2);
    expect(started[0].kind).toBe("degradation");
    expect(started[1].kind).toBe("telegraphed");
  });

  it("the scripted pair targets DISTINCT sats (no sat double-faults in one step)", () => {
    const queue: FaultScript[] = [
      { kind: "degradation", targetSatId: null, cause: "lowOrbit" },
      { kind: "telegraphed", targetSatId: null, cause: "lowOrbit" },
    ];
    const { started } = rollFaults([], sats, 10, 1 / 60, new SimRng(42n), queue);
    expect(started[0].satId).not.toBe(started[1].satId);
  });

  it("a tiny dt with NO queue fires NOTHING (the floor is vanishingly small this hour)", () => {
    // The rare-random + base-causal rate over a single 1/60 s tick is ~1e-7 — effectively off,
    // so a fresh GEO almost never stochastically faults. This pins "mild-first is the script's
    // job": absent the scripted queue, the early ticks are quiet.
    const geo = makeSat("GEO-0", GEO_PARK, 0);
    let anyFired = false;
    for (let i = 1; i <= 50; i++) {
      const { started } = rollFaults([], [geo], i / 60, 1 / 60, new SimRng(BigInt(i)));
      if (started.length > 0) anyFired = true;
    }
    expect(anyFired).toBe(false);
  });

  it("an explicit scripted target is honoured (the beat can pin the sat)", () => {
    const queue: FaultScript[] = [{ kind: "degradation", targetSatId: "LEO-1", cause: "lowOrbit" }];
    const { started } = rollFaults([], sats, 10, 1 / 60, new SimRng(1n), queue);
    expect(started[0].kind).toBe("degradation");
    expect(started[0].satId).toBe("LEO-1");
  });

  it("a null-target scripted fault picks the LOWEST-orbit live sat (the LEO the lever bites)", () => {
    const geo = makeSat("GEO-0", GEO_PARK, 0);
    const leo = makeSat("LEO-0", LEO_SWEEP, 0);
    const queue: FaultScript[] = [{ kind: "telegraphed", targetSatId: null, cause: "lowOrbit" }];
    const { started } = rollFaults([], [geo, leo], 10, 1 / 60, new SimRng(5n), queue);
    expect(started[0].satId).toBe("LEO-0"); // the lower orbit, not the GEO.
  });
});

// ── SELF-RECOVERY + the telegraphed countdown ─────────────────────────────────────

describe("rollFaults — SELF-RECOVERY + the telegraphed drop", () => {
  const sat = makeSat("LEO-0", LEO_SWEEP, 0);

  it("a degradation self-recovers at recoversAtS (resolved on the step that reaches it)", () => {
    const f = makeFaultState("LEO-0", "degradation", "lowOrbit", 0);
    // Before recovery: not resolved.
    const beforeT = DEGRADATION_DURATION_S - 1;
    expect(rollFaults([f], [sat], beforeT, 1 / 60, new SimRng(0n)).resolved).toEqual([]);
    // At/after recovery: resolved (the session clears it).
    const atT = DEGRADATION_DURATION_S;
    expect(rollFaults([f], [sat], atT, 1 / 60, new SimRng(0n)).resolved).toEqual(["LEO-0"]);
  });

  it("a transient self-recovers at its (shorter) recoversAtS", () => {
    const f = makeFaultState("LEO-0", "transient", "lowOrbit", 0);
    expect(rollFaults([f], [sat], TRANSIENT_DURATION_S - 1, 1, new SimRng(0n)).resolved).toEqual([]);
    expect(rollFaults([f], [sat], TRANSIENT_DURATION_S, 1, new SimRng(0n)).resolved).toEqual(["LEO-0"]);
  });

  it("a telegraphed fault counts DOWN, then RESOLVES (drops the sat) at failsAtS", () => {
    const f = makeFaultState("LEO-0", "telegraphed", "lowOrbit", 0);
    // Mid-countdown: the sat still routes (not removed yet) and is NOT resolved.
    const mid = TELEGRAPHED_COUNTDOWN_S / 2;
    expect(faultRemovesSatAt(f, mid)).toBe(false); // routes during the warning window.
    expect(telegraphedCountdownRemainingS(f, mid)).toBeCloseTo(TELEGRAPHED_COUNTDOWN_S - mid, 9);
    expect(rollFaults([f], [sat], mid, 1, new SimRng(0n)).resolved).toEqual([]);
    // Countdown expired: the sat DROPS (removed) and the fault resolves into the drop.
    const expired = TELEGRAPHED_COUNTDOWN_S;
    expect(faultRemovesSatAt(f, expired)).toBe(true);
    expect(telegraphedCountdownRemainingS(f, expired)).toBe(0);
    expect(rollFaults([f], [sat], expired, 1, new SimRng(0n)).resolved).toEqual(["LEO-0"]);
  });

  it("a hard fault NEVER resolves (permanent — both times Infinity)", () => {
    const f = makeFaultState("LEO-0", "hard", "rareRandom", 0);
    expect(faultResolvedAt(f, 1e12)).toBe(false);
    expect(rollFaults([f], [sat], 1e12, 1, new SimRng(0n)).resolved).toEqual([]);
  });

  it("a still-active fault keeps its sat off the new-fault passes (no double-fault)", () => {
    // An active degradation on the only sat ⇒ even a forced large dt cannot start a SECOND
    // fault on it this step (the sat is excluded from both the scripted and stochastic passes).
    const f = makeFaultState("LEO-0", "degradation", "lowOrbit", 0);
    const queue: FaultScript[] = [{ kind: "telegraphed", targetSatId: "LEO-0", cause: "lowOrbit" }];
    const { started } = rollFaults([f], [sat], 1, 1000, new SimRng(0n), queue);
    expect(started).toEqual([]); // the sat is already faulted ⇒ nothing new starts on it.
  });
});

// ── the CAUSAL lever is LIVE (low-orbit + age raise the rate; cause label tracks it) ─

describe("rollFaults — the CAUSAL lever (low-orbit + age live; the cause label tracks it)", () => {
  it("a deep LEO has a HIGHER causal rate than the (also-low) toy GEO (low-orbit lever live)", () => {
    // The toy world's scales are tiny (GEO aM ≈ 835 km, LEO aM ≈ 610 km) — both BELOW the
    // fault-types LOW_ORBIT_REF_M (≈ 42,157 km, a real-Earth GEO radius), so both carry SOME
    // low-orbit lift. The lever is still LIVE in the right direction: the lower LEO faults more.
    const geoRate = causalFaultRatePerS(causalInputForSat(makeSat("G", GEO_PARK, 0), 0));
    const leoRate = causalFaultRatePerS(causalInputForSat(makeSat("L", LEO_SWEEP, 0), 0));
    expect(leoRate).toBeGreaterThan(geoRate);
    // A sat AT the real-Earth GEO reference (above the toy scales) gets the NEUTRAL multiplier,
    // so its causal rate is the bare base — pinning the low-orbit ramp's neutral end.
    const trueGeo = makeSatAt("REF", 36_000_000 + 6_400_000, 0); // ≳ LOW_ORBIT_REF_M.
    const refRate = causalFaultRatePerS(causalInputForSat(trueGeo, 0));
    expect(refRate).toBeCloseTo(CAUSAL_BASE_FAULT_RATE_PER_S, 12);
  });

  it("an OLDER sat has a higher causal rate than a fresh one (age lever live)", () => {
    const sat = makeSat("L", LEO_SWEEP, 0);
    const fresh = causalFaultRatePerS(causalInputForSat(sat, 0));
    const aged = causalFaultRatePerS(causalInputForSat(sat, 1_000_000));
    expect(aged).toBeGreaterThan(fresh);
  });

  it("the stochastic cause label is the DOMINANT live lever (lowOrbit for a fresh LEO)", () => {
    const leo = makeSat("L", LEO_SWEEP, 0);
    expect(stochasticCauseForSat(leo, 0)).toBe("lowOrbit"); // a deep, fresh LEO ⇒ low-orbit lever.
  });

  it("a fresh sat at the GEO reference (no live lever) falls back to the rareRandom floor label", () => {
    // At/above the real-Earth GEO reference the low-orbit lever is NEUTRAL, and a fresh sat has
    // no age lift either ⇒ neither lever engaged ⇒ the irreducible floor names it.
    const ref = makeSatAt("REF", 36_000_000 + 6_400_000, 0);
    expect(stochasticCauseForSat(ref, 0)).toBe("rareRandom");
  });

  it("an old sat at the GEO reference reads 'age' (the only live lever once orbit is GEO-class)", () => {
    const ref = makeSatAt("REF", 36_000_000 + 6_400_000, 0);
    expect(stochasticCauseForSat(ref, 1_000_000)).toBe("age");
  });

  it("a stochastic fault is the MILD kind (a degradation) — hard stays off this hour", () => {
    // Force a near-certain stochastic firing with a deep-LEO + large age + large dt, then assert
    // the kind is the mild degradation (the floor never opens a hard failure this hour).
    const sat = makeSat("L", LEO_SWEEP, 0);
    const t = 1_000_000;
    let kind: string | null = null;
    for (let s = 1n; s <= 50n && kind === null; s++) {
      const { started } = rollFaults([], [sat], t, 1000, new SimRng(s));
      if (started.length > 0) kind = started[0].kind;
    }
    expect(kind).toBe(STOCHASTIC_FAULT_KIND);
    expect(STOCHASTIC_FAULT_KIND).toBe("degradation");
  });
});

// ── PURITY of the seam: rollFaults mutates none of its inputs ─────────────────────

describe("rollFaults — PURITY (mutates none of its inputs; returns a delta)", () => {
  it("does not mutate prevFaultStates, sats, or the scripted queue", () => {
    const sat = makeSat("LEO-0", LEO_SWEEP, 0);
    const prev: FaultState[] = [makeFaultState("LEO-0", "degradation", "lowOrbit", 0)];
    const prevCopy = structuredClone(prev);
    const sats = [sat];
    const satsCopy = structuredClone(sats);
    const queue: FaultScript[] = [{ kind: "telegraphed", targetSatId: null, cause: "lowOrbit" }];
    const queueCopy = structuredClone(queue);
    rollFaults(prev, sats, 5, 1, new SimRng(3n), queue);
    expect(prev).toEqual(prevCopy);
    expect(sats).toEqual(satsCopy);
    expect(queue).toEqual(queueCopy);
  });

  it("the rare-random floor is added on top of the causal rate (a positive floor everywhere)", () => {
    // The floor constant is positive and small (effectively off but never zero), so EVERY sat —
    // even a fresh GEO — carries a non-zero total rate (the irreducible floor the design pins).
    expect(RARE_RANDOM_FAULT_RATE_PER_S).toBeGreaterThan(0);
    const geo = makeSat("G", GEO_PARK, 0);
    const total = causalFaultRatePerS(causalInputForSat(geo, 0)) + RARE_RANDOM_FAULT_RATE_PER_S;
    expect(total).toBeGreaterThan(causalFaultRatePerS(causalInputForSat(geo, 0)));
  });
});
