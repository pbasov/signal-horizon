/**
 * net/ — ACT 3b THE FAULT SPECTRUM (design §5 / the act3-act4 design C2.1). The seeded,
 * PURE fault GENERATOR: a step function {@link rollFaults} that — off the {@link SimRng}
 * the {@link import("./session").NetSession} ALREADY owns (the M2 launch-failure-roll
 * pattern, `rng.nextDouble() < rate·dt`) — produces the next tick's NEW faults + the
 * resolved ones. NO new action, NO new seed: the splitmix64 stream is the ONLY randomness,
 * so the whole spectrum folds + replays bit-stably.
 *
 * --- THE ONE CONCEPT --------------------------------------------------------------
 * *"And faults degrade it."* A working network does not stay working. This module is the
 * spectrum + the roll; the MILD-FIRST ORDERING (a Degradation, then a Telegraphed failure)
 * is the SCENARIO's job — the act3b beat injects a {@link FaultScript} queue that this roll
 * consumes scripted-first, then runs the stochastic causal + rare-random stream underneath
 * as the irreducible floor. We expose the spectrum + the roll; the beat sequences the pair.
 *
 * --- THE TWO LOCKED MECHANICS (design §5.2) --------------------------------------
 *   - CAUSAL: a per-sat probability raised by overclock / cheap-bus / low-orbit / age. The
 *     LIVE levers this hour are LOW-ORBIT + AGE (the rate algebra lives in fault-types.ts
 *     {@link causalFaultRatePerS}); overclock / cheap-bus are present-but-neutral (M1 has
 *     one bus + no overclock UI).
 *   - RARE-RANDOM: an irreducible {@link RARE_RANDOM_FAULT_RATE_PER_S} floor added to EVERY
 *     sat regardless of choices.
 * HARD random failure stays vanishingly rare / effectively OFF this hour (the rare-random
 * floor only ever fires the MILDEST stochastic kind here; "hard" is in the spectrum so M2
 * turns it up without a reshape).
 *
 * --- THE SPECTRUM, MILD-FIRST (design §5.1) --------------------------------------
 *   - "degradation" — a capacity HAIRCUT ({@link FaultState.degradedCapacityFactor} ∈ (0,1]);
 *     the sat still routes; SELF-RECOVERS at `recoversAtS`. Unwarned (no countdown).
 *   - "transient"   — a brief full OUTAGE (the sat drops); SELF-RECOVERS at `recoversAtS`.
 *   - "telegraphed" — a WARNED failure: a countdown (`failsAtS`); the sat drops when it expires.
 *   - "hard"        — permanent (`recoversAtS = failsAtS = Infinity`); vanishingly rare this hour.
 *
 * PURE: no three / DOM / wall-clock / unseeded random. The roll draws ONLY from the passed-in
 * {@link SimRng} (never a `new SimRng`), so the seam is trivially replay-safe. Mutates NOTHING
 * the caller passes in (it returns a delta — the session folds the resulting {@link FaultState}[]).
 *
 * @see docs/signal-horizon-m1-act3-act4-design.md (ACT 3, fault.ts / 3B portions).
 * @see docs/signal-horizon-m1-onboarding.md (Act 3, sub-beat 3B).
 */

import type { SimRng } from "../rng";
import type { NetSat } from "./sat";
import {
  type FaultKind,
  type FaultState,
  type FaultCause,
  type FaultRollResult,
  type FaultScript,
  RARE_RANDOM_FAULT_RATE_PER_S,
  DEGRADATION_CAPACITY_FACTOR,
  DEGRADATION_DURATION_S,
  TRANSIENT_DURATION_S,
  TELEGRAPHED_COUNTDOWN_S,
  AGE_MULTIPLIER_PER_S,
  causalFaultRatePerS,
  causalInputForSat,
  lowOrbitMultiplier,
  faultSelfRecoveredAt,
} from "./fault-types";

/**
 * The stochastic kind the causal + rare-random stream draws when a per-sat Bernoulli FIRES
 * this hour. MILD by design: the irreducible floor only ever opens a {@link "degradation"}
 * (a recoverable capacity haircut) — the scripted mild-first pair + the LIVE causal lever
 * carry the beat's teaching, and a HARD random failure stays vanishingly rare / OFF this hour
 * (the brief). M2 turns the stochastic spectrum up here without reshaping the roll. */
export const STOCHASTIC_FAULT_KIND: FaultKind = "degradation";

/**
 * Build the {@link FaultState} for a fault of `kind` starting at `t` on `satId`, stamped with
 * its `cause`. The three sim-times are the §2.4 PREDICTABILITY SEED: each kind fills the times
 * it USES and sets the rest to Infinity so the fold shape stays uniform + bit-stable:
 *   - degradation → a capacity haircut + a self-recovery at `t + DEGRADATION_DURATION_S`.
 *   - transient   → a full outage that self-recovers at `t + TRANSIENT_DURATION_S`.
 *   - telegraphed → a countdown to `failsAtS = t + TELEGRAPHED_COUNTDOWN_S` (it fails, never recovers).
 *   - hard        → permanent (both times Infinity).
 * Pure: no rng (the Bernoulli draw happens in {@link rollFaults}); a deterministic constructor.
 */
export function makeFaultState(
  satId: string,
  kind: FaultKind,
  cause: FaultCause,
  t: number,
): FaultState {
  switch (kind) {
    case "degradation":
      return {
        satId,
        kind,
        cause,
        startedAtS: t,
        degradedCapacityFactor: DEGRADATION_CAPACITY_FACTOR,
        failsAtS: Infinity,
        recoversAtS: t + DEGRADATION_DURATION_S,
      };
    case "transient":
      return {
        satId,
        kind,
        cause,
        startedAtS: t,
        degradedCapacityFactor: 1.0, // a full outage removes the sat — no haircut.
        failsAtS: Infinity,
        recoversAtS: t + TRANSIENT_DURATION_S,
      };
    case "telegraphed":
      return {
        satId,
        kind,
        cause,
        startedAtS: t,
        degradedCapacityFactor: 1.0, // routes during the countdown, then drops wholesale.
        failsAtS: t + TELEGRAPHED_COUNTDOWN_S,
        recoversAtS: Infinity, // it fails; it does not recover.
      };
    case "hard":
      return {
        satId,
        kind,
        cause,
        startedAtS: t,
        degradedCapacityFactor: 1.0,
        failsAtS: Infinity,
        recoversAtS: Infinity, // permanent.
      };
  }
}

/**
 * The cause to STAMP on a STOCHASTIC fault drawn on a sat at sim-time t — the trace names it.
 * The LIVE levers this hour are LOW-ORBIT + AGE; we attribute the draw to whichever LIVE lever
 * contributes MORE to the sat's causal rate (a lower orbit ⇒ "lowOrbit", an older sat ⇒ "age"),
 * falling back to "rareRandom" when neither causal lever is engaged (a fresh GEO whose only
 * non-zero rate is the irreducible floor). Pure: a deterministic read of the sat geometry + t,
 * no rng. (This is a LABEL for legibility — it never changes WHETHER the fault fired.)
 */
export function stochasticCauseForSat(sat: NetSat, t: number): FaultCause {
  const input = causalInputForSat(sat, t);
  // Each LIVE lever's MULTIPLICATIVE LIFT above the neutral 1.0 — read off the SAME LOCKED
  // fault-types algebra the rate uses (lowOrbitMultiplier + the age ramp), so the label is
  // consistent with the rate (a sat reads the lever that contributes more to its OWN rate):
  //   - low-orbit lift = lowOrbitMultiplier(altitudeM) − 1  (0 at/above the reference, up to MAX−1)
  //   - age lift       = ageS · AGE_MULTIPLIER_PER_S        (0 for a fresh sat, growing linearly)
  const lowOrbitLift = lowOrbitMultiplier(input.altitudeM) - 1.0;
  const ageLift = Math.max(0, input.ageS) * AGE_MULTIPLIER_PER_S;
  // No causal lift at all (a sat at/above the reference, freshly launched) ⇒ the only source of
  // its rate is the irreducible floor ⇒ rareRandom names it.
  if (lowOrbitLift <= 0 && ageLift <= 0) return "rareRandom";
  // Attribute to the DOMINANT live lever; tie ⇒ "lowOrbit" (the geometry-first lever).
  return ageLift > lowOrbitLift ? "age" : "lowOrbit";
}

/**
 * THE FAULT ROLL — one step (design §5 / C2.1). Pure + deterministic off the passed-in seeded
 * {@link SimRng}: given the faults ACTIVE at the start of the step (`prevFaultStates`), the live
 * `sats` roster, the sim-time `t` (END of the step), the elapsed `dt`, and an optional scripted
 * mild-first `queue`, it returns the per-step DELTA:
 *   - `started`  — the faults that newly fired this step (SCRIPTED-FIRST, then STOCHASTIC).
 *   - `resolved` — the satIds whose ACTIVE fault SELF-RECOVERED this step (a degradation/transient
 *     reached its `recoversAtS` and the sat comes BACK — {@link faultSelfRecoveredAt}). A TELEGRAPHED
 *     fault reaching `failsAtS` is NOT here (the P2 §5.1 fix): its sat dies PERMANENTLY, so the fault
 *     stays ACTIVE (the session keeps removing the sat from the graph) and is never "freed".
 *
 * THE ORDER (load-bearing for determinism + the mild-first guarantee):
 *   1. RESOLVE first (no rng): scan `prevFaultStates`, collect every fault that SELF-RECOVERED at
 *      `t`. A telegraphed countdown that EXPIRED is NOT collected — it stays active as a permanent
 *      drop (so `downSatIds` keeps seeing it), but it still keeps its sat off the new-fault passes.
 *   2. SCRIPTED faults next: for each {@link FaultScript} in `queue` (in order), pick its target
 *      (the explicit `targetSatId`, else a deterministic roster pick off the rng) and START it.
 *      Each scripted fault DRAWS exactly ONE double from the rng (advancing it deterministically)
 *      so the scripted pair and the stochastic stream share ONE bit-stable draw cadence.
 *   3. STOCHASTIC stream last: for each live sat NOT already faulted (and not just resolved / not
 *      a fresh scripted target), draw ONE Bernoulli `rng.nextDouble() < rate·dt` where
 *      `rate = causalFaultRatePerS(sat) + RARE_RANDOM_FAULT_RATE_PER_S`; on a hit, START the mild
 *      {@link STOCHASTIC_FAULT_KIND} stamped with {@link stochasticCauseForSat}.
 *
 * One draw per scripted fault + one draw per eligible sat — a FIXED, roster-ordered draw count, so
 * the same rng state + the same roster + the same queue ⇒ a bit-identical fault sequence (the
 * determinism the test pins). Mutates nothing the caller owns: `prevFaultStates` / `sats` / `queue`
 * are read-only; the session folds the returned {@link FaultState}[].
 *
 * NOTE on dt ≤ 0 / empty roster: no stochastic draw fires (rate·dt ≤ 0); scripted faults still
 * fire (they are authored, not probabilistic) but consume their rng draw so replay stays stable.
 */
export function rollFaults(
  prevFaultStates: readonly FaultState[],
  sats: readonly NetSat[],
  t: number,
  dt: number,
  rng: SimRng,
  queue: readonly FaultScript[] = [],
): FaultRollResult {
  const started: FaultState[] = [];
  const resolved: string[] = [];

  // (1) RESOLVE — no rng. A degradation/transient that reached recoversAtS SELF-RECOVERS: the sat
  // comes back and the session frees it (pushed to `resolved`). A sat freed by self-recovery is NOT
  // re-faulted THIS step (it stays in `faultedNow` so the scripted/stochastic passes skip it).
  //
  // P2 (§5.1, the audit fix): a TELEGRAPHED countdown that reached failsAtS does NOT self-recover —
  // its sat DROPS PERMANENTLY (a warned hard failure). It is NOT pushed to `resolved` (so the session
  // never deletes it / never spuriously latches "weathered" / never logs "RECOVERED"); it stays in
  // `faultedNow` so the sat — now permanently down — takes no new fault. The session keeps it in the
  // active map, where `faultRemovesSatAt(f, t)` (t ≥ failsAtS) removes the sat from the router graph
  // from failsAtS on. So a telegraphed failure the player did NOT replace is a real, permanent loss.
  const faultedNow = new Set<string>();
  for (const f of prevFaultStates) {
    if (faultSelfRecoveredAt(f, t)) resolved.push(f.satId); // self-heal ⇒ free the sat.
    else faultedNow.add(f.satId); // still active (incl. a telegraphed-expired permanent drop) ⇒ no new fault.
  }

  // (2) SCRIPTED faults (the mild-first pair the act3b beat seeds). Each consumes ONE rng draw
  // (so the scripted pair shares the stochastic stream's cadence + replay stays bit-stable) and
  // is the AUTHORED kind regardless of the draw value — the draw only picks a target when the
  // script leaves it open. Scripted-first guarantees the Degradation (queue[0]) precedes the
  // Telegraphed (queue[1]) before any stochastic fault can fire (mild-first).
  for (const script of queue) {
    const targetId = pickScriptedTarget(script, sats, faultedNow, rng);
    if (targetId === null) continue; // no eligible target (every live sat already faulted).
    started.push(makeFaultState(targetId, script.kind, script.cause, t));
    faultedNow.add(targetId);
  }

  // (3) STOCHASTIC stream — the irreducible floor underneath. ONE Bernoulli per eligible sat, in
  // roster order (a fixed draw count ⇒ deterministic). A sat already faulted (still-active OR a
  // fresh scripted target this step) is skipped (no draw) so it never double-faults.
  for (const sat of sats) {
    if (faultedNow.has(sat.id)) continue;
    const rate = causalFaultRatePerS(causalInputForSat(sat, t)) + RARE_RANDOM_FAULT_RATE_PER_S;
    const p = rate * dt;
    const draw = rng.nextDouble();
    if (p > 0 && draw < p) {
      const cause = stochasticCauseForSat(sat, t);
      started.push(makeFaultState(sat.id, STOCHASTIC_FAULT_KIND, cause, t));
      faultedNow.add(sat.id);
    }
  }

  return { started, resolved };
}

/**
 * Pick the target sat for a {@link FaultScript}, drawing ONE double from `rng` (so the scripted
 * fault advances the stream deterministically — the design's "the scripted pair draws from the
 * same rng stream"). An explicit `targetSatId` pins the target (the draw is still consumed for
 * cadence); a null selector picks a deterministic ELIGIBLE sat off the roster + the draw:
 * the lowest-orbit live sat NOT already faulted (a LEO — the lever the degradation/telegraphed
 * pair teaches), tie-broken to a uniform pick across the joint-lowest by the rng draw. Returns
 * null when no eligible sat exists. Pure (off the passed-in rng).
 */
function pickScriptedTarget(
  script: FaultScript,
  sats: readonly NetSat[],
  faultedNow: ReadonlySet<string>,
  rng: SimRng,
): string | null {
  const draw = rng.nextDouble(); // consumed either way (cadence + the eligible-pick tiebreak).
  // Explicit target: honour it iff still eligible (not already faulted this step).
  if (script.targetSatId !== null) {
    return faultedNow.has(script.targetSatId) ? null : script.targetSatId;
  }
  // Deterministic pick: the eligible sats, lowest orbit first (a LEO — the low-orbit lever the
  // mild-first pair is meant to bite), tie-broken by satId ascending for a stable ordering.
  const eligible = sats
    .filter((s) => !faultedNow.has(s.id))
    .sort((a, b) => a.orbit.aM - b.orbit.aM || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
  if (eligible.length === 0) return null;
  // Among the JOINT-lowest orbit (the deepest LEOs), pick uniformly by the rng draw so the
  // selection is seeded (not just first-by-id) yet deterministic. Usually a single lowest sat.
  const lowestAM = eligible[0].orbit.aM;
  const deepest = eligible.filter((s) => s.orbit.aM === lowestAM);
  const idx = Math.min(deepest.length - 1, Math.floor(draw * deepest.length));
  return deepest[idx].id;
}
