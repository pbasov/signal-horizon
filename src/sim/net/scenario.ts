/**
 * net/ — THE STATE-GATING ENGINE (design §3). The ONE authored layer of the network
 * game: a PURE DATA TABLE of {@link Beat}s + a deterministic gate evaluator that the
 * {@link import("./session").NetSession} drives inside `step`. It WITHHOLDS the next
 * contract / fault until the current concept is DEMONSTRATED — state-gated, NOT
 * clock-timed (a clock-timed tutorial fires whether the player is ready or not; the
 * `~minutes` in the design are loose orientation, not triggers).
 *
 * --- THE CONTRACT (design §3) ----------------------------------------------------
 * Each beat is three pure functions of `(session, t)`:
 *   - `emit`   : the AUTHORED arrival — add a contract / flip an `activeAxes` mask /
 *                enable a fault generator. It NEVER touches the solver/physics.
 *   - `gate`   : the COMPLETION PREDICATE (the concept FELT) → opens the next beat.
 *   - `fallback`: the failure-to-progress assist (state-gated; the gentle correction).
 *
 * The session advances a `scenarioCursor` integer: it emits the CURRENT beat once (the
 * first emit puts the Act-1 contract on the board), then calls `gate()` each tick; when
 * `gate()` first returns true it records the gate tick, advances the cursor, and calls
 * the NEXT beat's `emit()` — all DETERMINISTICALLY INSIDE step, so the whole arrival
 * sequence is in the fold and replays bit-identically.
 *
 * --- 3a / 3b ARE SEPARATE CURSOR BEATS (design §3a/§3b, the granularity must-fix) -
 * The escalation theme (act3a) and the fault theme (act3b) are DISTINCT cursor entries
 * that emit in sequence, so faults are FENCED behind escalation re-stabilisation
 * (onboarding: faults begin "not before" re-stabilisation, "because faults on an
 * unstable network would just be noise"). They are STRUCTURAL placeholders here — their
 * emit/gate are stubs to be filled in Phase C (C1 = act3a escalation, C2 = act3b faults
 * fenced behind act3a). Their presence now means the granularity is real from the start
 * and the cursor steps act1 → act2 → act3a → act3b → act4.
 *
 * PURE: no three / DOM / wall-clock / unseeded RNG. The table is data; the predicates
 * read only `(session, t)`. Determinism is the whole point: every emit/gate transition
 * is a function of (session state, t), evaluated inside step, recorded in the cursor.
 *
 * @see docs/signal-horizon-m1-design.md §3 (the gating engine), §4 (determinism), §5.
 */

import type { NetSession } from "./session";
import { NET_ACT1_REGION } from "./endpoint";
import { offerNetContract, type SlaAxis } from "./contract";

/**
 * The gentle failure-to-progress assist a beat surfaces (design §3 fallback / §2.6 the
 * trace face). The full {@link import("./router").SolveResult}-driven `diagnose` parse is
 * `trace.ts` (a later increment, §2.6); A3 defines the minimal shape the Act-1 gentle
 * shortfall needs — "footprint does not reach [region]; try this preset" — so the scenario
 * fallback has a typed return now. `trace.ts` will extend/own this without reshaping it.
 */
export interface Shortfall {
  /** The contract/region the shortfall is about (the thing not progressing). */
  subjectId: string;
  /** A human-readable, point-at-the-fix message (never does it for the player). */
  message: string;
  /** A preset id to point the player at (the "try this preset" lever), if any. */
  suggestPresetId?: string;
}

/**
 * One authored beat in the arrival sequence. `id` is the stable cursor key; `emit` is the
 * deterministic arrival the session fires when this beat becomes current; `gate` is the
 * completion predicate that opens the NEXT beat; `fallback` is the optional gentle assist.
 */
export interface Beat {
  /** The stable beat id ("act1","act2","act3a","act3b","act4"). */
  id: string;
  /** The AUTHORED arrival: add demand / flip a mask / enable a fault gen. Pure; never
   * touches the solver/physics. Called ONCE when this beat becomes the current cursor. */
  emit: (session: NetSession, t: number) => void;
  /** The COMPLETION PREDICATE (the concept FELT). Pure function of (session, t); when it
   * first returns true the session advances the cursor + emits the next beat. */
  gate: (session: NetSession, t: number) => boolean;
  /** The failure-to-progress assist (state-gated). Returns a {@link Shortfall} when the
   * player is stuck on this beat's concept, else null. Pure. */
  fallback?: (session: NetSession, t: number) => Shortfall | null;
}

// --- ACT 1 tuning -----------------------------------------------------------------

/** The Act-1 contract id the act1 beat emits (the one equatorial connectivity-only
 * demand). The replay action log accepts THIS id. */
export const ACT1_CONTRACT_ID = "REGION-0";

/** A generous idle window (sim-seconds): if no covering launch lands within it, the
 * act1 fallback surfaces the gentle "try GEO PARK" assist. State-gated orientation, not
 * a trigger — the gate is the only thing that advances the cursor. Placeholder. */
export const ACT1_IDLE_WINDOW_S = 2 * 3600.0; // 2 sim-hours.

// --- the authored arrival sequence ------------------------------------------------

/**
 * act1 — "I launch sats; they connect regions to ground."
 * emit: one equatorial latency-tolerant connectivity-only contract; activeAxes =
 *       {connectivity}; avail/lat/bw HIDDEN (present in the struct, un-enforced).
 * gate: one contract SERVED and revenue positive (€ rising) → opens act2.
 * fallback: gentle "footprint does not reach [region]; try this preset" — point at the
 *           fix, do not do it. Fires on a non-covering orbit OR a long idle.
 */
const ACT1: Beat = {
  id: "act1",
  emit(session: NetSession): void {
    // The ONE Act-1 demand: connectivity-only (the mask hides the other axes), latency-
    // tolerant (the high default slaLatencyS is un-enforced this act). Idempotent — the
    // session de-dupes by id, so a re-emit is a no-op.
    session.addContract(
      offerNetContract(ACT1_CONTRACT_ID, NET_ACT1_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity"]),
      }),
    );
  },
  gate(session: NetSession): boolean {
    // The concept is FELT when ONE accepted contract is being SERVED (a path exists this
    // instant) AND it has earned € (revenue positive — the wallet is rising). earnedEur>0
    // proves the launch→cover→paid chain actually paid out, not merely that a path exists.
    for (const c of session.contracts) {
      if (c.state === "active" && c.lastServedFraction > 0 && c.earnedEur > 0) return true;
    }
    return false;
  },
  fallback(session: NetSession, t: number): Shortfall | null {
    // Find the Act-1 demand; if it is being served, there is nothing to assist.
    const c = session.contracts.find((x) => x.id === ACT1_CONTRACT_ID) ?? null;
    if (c === null) return null;
    if (c.state === "active" && c.lastServedFraction > 0) return null;
    // Stuck: either no covering orbit (active but unserved) or a long idle with no launch.
    const idledOut = session.sats.length === 0 && t >= ACT1_IDLE_WINDOW_S;
    const wrongOrbit = c.state === "active" && c.lastServedFraction === 0;
    if (!idledOut && !wrongOrbit) return null;
    return {
      subjectId: c.id,
      message: `footprint does not reach ${c.label}; try the GEO PARK preset`,
      suggestPresetId: "GEO_PARK",
    };
  },
};

/**
 * act2 — "Coverage is maintained, not placed — you need a constellation." STRUCTURAL
 * placeholder (Phase B / B1 fills emit+gate). emit will offer a second contract with the
 * `availability` axis active+visible; gate = a region held continuous via ≥2 sats across
 * ≥1 hand-off cycle. The empty emit + never-true gate keep act2 inert in Phase A while the
 * cursor structure is real. NO physics here either way.
 */
const ACT2: Beat = {
  id: "act2",
  emit(): void {
    /* B1: offer the availability contract; activate the availability axis. */
  },
  gate(): boolean {
    return false; // B1 fills the continuous-coverage predicate.
  },
};

/**
 * act3a — "Your own success congests it." (escalation) STRUCTURAL placeholder (Phase C /
 * C1). emit will turn ON the escalation law (`offeredLoad` grows where served) + activate
 * latency then bandwidth; gate = a served contract dipped near-breach under risen load,
 * then returned to SERVED. SEPARATE from act3b so faults are fenced behind THIS gate.
 */
const ACT3A: Beat = {
  id: "act3a",
  emit(): void {
    /* C1: enable the escalation law; activate latency then bandwidth. */
  },
  gate(): boolean {
    return false; // C1 fills the escalation re-tame predicate.
  },
};

/**
 * act3b — "And faults degrade it." (mild-first; ONLY after act3a re-tamed) STRUCTURAL
 * placeholder (Phase C / C2). emit will ENABLE the fault generator (a Degradation, then a
 * Telegraphed failure) — fenced behind act3a having fired; gate = weathered ≥1 fault while
 * keeping contracts served AND the trace surfaced ≥1 resilience shortfall.
 */
const ACT3B: Beat = {
  id: "act3b",
  emit(): void {
    /* C2: enable the fault generator (fenced behind act3a). */
  },
  gate(): boolean {
    return false; // C2 fills the weathered-a-fault predicate.
  },
};

/**
 * act4 — "Distance changes everything." (FENCED, by sight) STRUCTURAL placeholder
 * (Phase D / D1). emit will surface the Mars opportunity (light-delay on the router
 * latency term). NO gate — a read, not a gate; the scenario stops on a deliberate "to be
 * continued", so its gate stays false forever (the cursor never advances past act4).
 */
const ACT4: Beat = {
  id: "act4",
  emit(): void {
    /* D1: surface the Mars opportunity (delay.ts on the latency term). */
  },
  gate(): boolean {
    return false; // NO gate — a read, not a gate.
  },
};

/**
 * THE M1 ARRIVAL SEQUENCE (design §3). One game, four gated beats, with act3 split into
 * act3a (escalation) and act3b (faults, fenced behind act3a) so the granularity is real
 * from the start. The session steps the cursor act1 → act2 → act3a → act3b → act4. In
 * Phase A only act1 is live; the rest are structural placeholders (empty emit, false gate).
 */
export const M1_SCENARIO: Beat[] = [ACT1, ACT2, ACT3A, ACT3B, ACT4];
