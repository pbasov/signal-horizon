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
 * @see docs/signal-horizon-m1.md Part II §3 (the gating engine), §4 (determinism), §5.
 */

import type { NetSession } from "./session";
import {
  NET_ACT1_REGION,
  NET_ACT1B_REGION,
  NET_ACT1_REGION_RADIUS_RAD,
  NET_ACT2_REGION_LAT_RAD,
  NET_ACT2_REGION_LON_RAD,
  NET_ACT4_MARS_REGION,
  ACT4_MARS_CONTRACT_ID,
  type Region,
} from "./endpoint";
import { offerNetContract, NET_DEFAULT_PAY_PER_SECOND, type SlaAxis } from "./contract";
import type { FaultScript, TraceShortfall } from "./fault-types";

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

// --- ACT 2 tuning (Coverage is MAINTAINED, not placed) ----------------------------

/** The Act-2 contract id the act2 beat emits — a SECOND demand a single LEO cannot hold
 * (its availability axis is active+visible). The replay action log accepts THIS id. */
export const ACT2_CONTRACT_ID = "REGION-1";

/** The visible availability bar (onboarding line 67): the min fraction of time REGION-1 must
 * be HELD. A lone inclined LEO (worst-phase rolling avail ≈ 0.28 over REGION-1) sawtooths far
 * below it; a phased N=4 polar constellation holds rolling-avail = 1.0 and clears it. */
export const ACT2_SLA_AVAIL = 0.99;

// --- FL-07 (SD-47) — ACT 1 TENDER TEXTURE -------------------------------------------

/** FL-07 — the second Act-1 tender id (the decaying one: "equatorial transit", 5°E). */
export const ACT1B_CONTRACT_ID = "REGION-C";

/** FL-07 — the Act-1 offers now carry a CLOCK (the Act-1 Infinity exemption is dead):
 * both tenders lapse 2 sim-hours after emit. TUNABLE. */
export const ACT1_OFFER_WINDOW_S = 2 * 3600.0;
/** FL-07 — REGION-0's sign-on bonus (€) + its lapse limit. With the bonus, one full REGION-0
 * term earns 2.0×7200 + 2000 = €16,400 < the €19,055 honest GEO stack — the economy
 * theorem still holds. TUNABLE. */
export const ACT1_SIGNON_BONUS_EUR = 2000;
export const ACT1_SIGNON_WINDOW_S = 900;
/** FL-07 — REGION-C's pay multiple + decay half-life. 1.3× (not a fat multiple): a FULL-pay
 * term (2.6 × 7200 = €18,720) stays under the €19,055 stack, so even a degenerate immediate
 * sign cannot out-earn its own honest provisioning (the economy theorem); the DECAY does the
 * pricing work from there. TUNABLE. */
export const ACT1B_PAY_MULT = 1.3;
export const ACT1B_PAY_HALVING_S = 1200;

/** The HAND-OFF CYCLE the gate requires the region to be HELD across, breach-free, before the
 * concept is FELT (≥1 full rise→set→rise hand-off, design §3.3). Two LEO periods (= 300 s) — a
 * full hand-off cycle is proven to fit, and 300 s ≪ termSeconds (6 h), so the hand-off gate
 * fires BEFORE completion-by-term (the gate is the driver, not the clock). Imported as a fresh
 * constant; the period itself lives in world.ts. */
export const NET_HANDOFF_CYCLE_S = 2 * 150.0; // = 2 · A1_LEO_PERIOD_S (150 s); = 300 s.

/** The EMPIRICALLY MEASURED zero-gap minimum for the polar LEO_SWEEP family at ACT2_SLA_AVAIL
 * over the high-lat REGION-1 (terminating at the co-located high-lat GROUND-1): the smallest
 * evenly-phased constellation whose worst-phase rolling availability holds the bar. Pinned here
 * (= 4 at lat 70°, inc 90°) so the over-build waste log is a pure `(session, t)` predicate (no
 * eph in the gate signature). The phasing assist DERIVES the same N empirically (phasing.ts);
 * this constant must equal that derivation for REGION-1 (pinned in net-replay + phasing tests).
 * If the physics ever shifts N, BOTH this constant and the golden re-pin together. */
export const ACT2_ZERO_GAP_N = 4;

/** REGION-1 — HIGH LATITUDE (lat 70°), BEYOND the parked equatorial GEO's ~64° footprint edge,
 * so the GEO physically CANNOT reach it at any longitude (Act-2 variant (a): the only Act-2
 * physics lever is LATITUDE — latency is not a lever until Act 3). Same disc shape as REGION-0
 * but a distinct id/label and a high-lat centre, so it reads as a SECOND metro the GEO can't
 * touch. The bent path region→sat→ground closes only via the co-located high-lat GROUND-1 (the
 * equatorial GROUND-0 is ~70° away — wider than a LEO can bridge); a polar (inc 90°) inclined
 * constellation reaches it, and the measured zero-gap minimum is N=4. Seeds oversubscription
 * (two contracts share the roster) but availability is the ONLY new taught axis — one concept
 * per act. */
export const NET_ACT2_REGION: Region = {
  id: ACT2_CONTRACT_ID,
  label: "polar metro",
  latRad: NET_ACT2_REGION_LAT_RAD,
  lonRad: NET_ACT2_REGION_LON_RAD,
  radiusRad: NET_ACT1_REGION_RADIUS_RAD,
  bodyId: "earth",
};

// --- ACT 3a tuning (Your own success congests it) ---------------------------------

/** The Act-3a corridor contract id — a THIRD demand sharing REGION-0's equatorial infrastructure
 * corridor (onboarding line 99). The replay action log accepts THIS id (accept + net_set_prefer). */
export const ACT3A_CONTRACT_ID = "REGION-2";

/** Longitude (radians) of the Act-3a corridor region — a few degrees E of the equatorial REGION-0
 * (lon 0), inside the same equatorial corridor so the SAME equatorial sats bridge BOTH (the shared
 * link the §4.3 oversubscription rides). 3° E. */
export const NET_ACT3A_CORRIDOR_LON_RAD = 3 * (Math.PI / 180);

/** The Act-3a corridor's LOW one-way latency SLA (seconds): tighter than the parked GEO path
 * (~3.57 ms) but looser than a short equatorial LEO hop (~2.07 ms) — so the latency-tolerant GEO
 * CANNOT meet it (the GEO ceiling, felt) and a shorter LEO route DOES (§4.4). 3 ms. */
export const NET_ACT3A_LOW_LATENCY_S = 0.003;

/** REGION-2 — the Act-3a EQUATORIAL CORRIDOR metro (lat 0, lon 3° E), sharing REGION-0's
 * equatorial corridor so the SAME equatorial sats bridge both — the shared link the §4.3
 * oversubscription rides. Same disc shape as REGION-0; a distinct id/label + a nearby longitude.
 * Its LATENCY axis is active (low slaLatencyS): the GEO ceiling is felt (GEO can't meet it), a
 * shorter equatorial LEO route does — the §4.4 latency axis, arriving by an AUTHORED contract. */
export const NET_ACT3A_CORRIDOR_REGION: Region = {
  id: ACT3A_CONTRACT_ID,
  label: "corridor metro",
  latRad: 0,
  lonRad: NET_ACT3A_CORRIDOR_LON_RAD,
  radiusRad: NET_ACT1_REGION_RADIUS_RAD,
  bodyId: "earth",
};

// --- ACT 3a: the SHARED-PIPE backhaul (R0/SD-45 — the squeeze under the pipe model) ---

/** The Act-3a BACKHAUL contract id — the second latency-TOLERANT demand that SHARES the GEO's
 * BROADCAST pipe with REGION-0 (under the R0 pipe model, cross-contract sharing lives on
 * BROADCAST pipes: a floodlight carries every latency-tolerant contract in view). The id is
 * chosen for its diurnal PHASE (~103° from REGION-0's — loadPhaseForId hash), so their peaks
 * are genuinely non-coincident and the fair-share squeeze opens ASYMMETRIC windows. */
export const ACT3A_BACKHAUL_CONTRACT_ID = "BACKHAUL-3";

/** Longitude of the backhaul region — west of REGION-0, inside the parked GEO's footprint,
 * reachable from GROUND-0. 6° W. */
export const NET_ACT3A_BACKHAUL_LON_RAD = -6 * (Math.PI / 180);

/** The backhaul's starting offered load — small, so the shared GEO pipe starts comfortable
 * and the squeeze is ESCALATION-DRIVEN (both baselines grow toward the ceiling; only then do
 * the asymmetric peak windows cut REGION-0's fair share below its floor). TUNABLE. */
export const NET_ACT3A_BACKHAUL_LOAD = 0.4;

/** The backhaul's committed bandwidth floor — low (it is the elastic bulk traffic; REGION-0's
 * 0.6 floor is the one the squeeze bites). TUNABLE. */
export const NET_ACT3A_BACKHAUL_SLA_BW = 0.3;

/** REGION-3 — the COASTAL BACKHAUL region (lat 0, lon 6° W): a latency-tolerant bulk demand
 * INSIDE the parked GEO's footprint, sharing its BROADCAST pipe with REGION-0. The §4.3
 * oversubscription tension under the pipe model: two tolerant contracts on ONE floodlight
 * pipe, peaks non-coincident — share cleverly until growth makes the windows bite. */
export const NET_ACT3A_BACKHAUL_REGION: Region = {
  id: ACT3A_BACKHAUL_CONTRACT_ID,
  label: "coastal backhaul",
  latRad: 0,
  lonRad: NET_ACT3A_BACKHAUL_LON_RAD,
  radiusRad: NET_ACT1_REGION_RADIUS_RAD,
  bodyId: "earth",
};

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
  emit(session: NetSession, t: number): void {
    // FL-07 (SD-47) — TWO live tenders, not one patient offer: a real choice exists from
    // minute one (which patron, and when to sign). Both connectivity-only (the axis mask is
    // unchanged), both clocked; idempotent (the session de-dupes by id).
    // REGION-0 — the opener: flat pay + a sign-on bonus with a 15-minute clock.
    session.addContract(
      offerNetContract(ACT1_CONTRACT_ID, NET_ACT1_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity"]),
        // §7.2 — the equatorial trunk is LATENCY-class (lat-only default weights = the byte-identical
        // pre-P3 default). It routes the SHORT way; the player later OVERRIDES it to bandwidth-share-
        // aware (the act3a net_set_prefer relief) so it yields the short corridor to REGION-2.
        trafficClass: "latency",
        offerWindowS: ACT1_OFFER_WINDOW_S,
        offeredAtS: t,
        signOnBonusEur: ACT1_SIGNON_BONUS_EUR,
        signOnBonusUntilS: t + ACT1_SIGNON_WINDOW_S,
      }),
    );
    // REGION-C — the richer but REPRICING deal: the market halves its pay every 1200 s the
    // offer sits unsigned. Signing what you can't serve yet bleeds; waiting bleeds the pay.
    session.addContract(
      offerNetContract(ACT1B_CONTRACT_ID, NET_ACT1B_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity"]),
        trafficClass: "latency",
        payPerSecond: NET_DEFAULT_PAY_PER_SECOND * ACT1B_PAY_MULT,
        penaltyPerSecond: 2 * NET_DEFAULT_PAY_PER_SECOND * ACT1B_PAY_MULT,
        offerWindowS: ACT1_OFFER_WINDOW_S,
        offeredAtS: t,
        payHalvingS: ACT1B_PAY_HALVING_S,
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
 * act2 — "Coverage is MAINTAINED, not placed — you need a CONSTELLATION." The biggest
 * conceptual leap of the hour: a single LEO MOVES (sets each pass), so it cannot HOLD a
 * region needing continuous coverage; the fix is a constellation phased so one sat rises as
 * another sets. Act 1's "place one thing, done" is productively broken by a SECOND demand
 * whose AVAILABILITY axis a lone LEO sawtooths against.
 *
 * emit: offer REGION-1 with activeAxes = {connectivity, availability} (the availability bar
 *       becomes VISIBLE + ENFORCED for the first time); avail = ACT2_SLA_AVAIL.
 * gate: REGION-1 held CONTINUOUS SERVED via a hand-off constellation across ≥1 full hand-off
 *       cycle WITHOUT breaching — a SUSTAINED clean window (the hardened predicate), not an
 *       instantaneous breach==0. Over-build still completes; the surplus is silently logged.
 * fallback: co-phasing specificity in CONSTELLATION terms (the onboarding fallback).
 */
/** R3 (SD-45): the Act-2+ tender offer window (sim-seconds) — offers carry clocks. */
export const NET_OFFER_WINDOW_S = 3600;

const ACT2: Beat = {
  id: "act2",
  emit(session: NetSession, t: number): void {
    // The SECOND demand: availability ACTIVE + VISIBLE (the axis the player meets for the first
    // time). The axis is flipped ON purely via activeAxes — NO struct reshape; slaAvail already
    // exists on the contract. Idempotent (the session de-dupes by id).
    session.addContract(
      offerNetContract(ACT2_CONTRACT_ID, NET_ACT2_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity", "availability"]),
        slaAvail: ACT2_SLA_AVAIL,
        offerWindowS: NET_OFFER_WINDOW_S,
        offeredAtS: t,
        // §7.2 — the polar coverage metro is AVAILABILITY-class: it leans OFF latency (a low w_lat)
        // toward stability (w_stab present but DORMANT in M1, contributing 0). It does not chase the
        // absolute-shortest hop; any bridging polar sat that HOLDS the region serves it (the
        // continuous-coverage lesson). The class differs from REGION-0's latency-class by sight.
        trafficClass: "availability",
      }),
    );
  },
  gate(session: NetSession): boolean {
    // The concept is FELT when REGION-1 is HELD continuous SERVED via a hand-off constellation
    // across ≥1 full hand-off cycle without breaching. HARDENED (the gate-hardening field): a
    // SUSTAINED clean window — `nowS − cleanServedSinceS ≥ NET_HANDOFF_CYCLE_S` — not an
    // instantaneous breach==0 a single served tick mid-sawtooth could spuriously satisfy. The
    // rolling availability must ALSO be holding the bar right now (the meter is flat). NO
    // `sats.length ≥ N` literal — coverage-held is the predicate, so over-build still completes
    // (a constellation that never holds can't satisfy it; zeroGapN is geometry, not a count gate).
    const c = session.contractById(ACT2_CONTRACT_ID);
    if (c === null || c.state !== "active") return false;
    const held =
      c.lastAvailability >= c.slaAvail &&
      session.nowS - session.cleanSinceS >= NET_HANDOFF_CYCLE_S;
    if (!held) return false;
    // Over-build waste = sats beyond the measured zero-gap minimum, recorded at the firing tick
    // (seeds the Act-3 optimizer pull). Idempotent: the gate fires once (the cursor advances).
    session.recordWasteSats(session.sats.length - ACT2_ZERO_GAP_N);
    return true;
  },
  fallback(session: NetSession): Shortfall | null {
    // Stuck on act2: REGION-1 active but availability below the bar (the sawtooth). State the
    // fix in CONSTELLATION terms (the onboarding fallback) — name the shortfall + the
    // co-phasing remedy without doing it for the player.
    const c = session.contractById(ACT2_CONTRACT_ID);
    if (c === null || c.state !== "active" || c.lastAvailability >= c.slaAvail) return null;
    const have = session.sats.length;
    return {
      subjectId: c.id,
      message:
        `${c.label}: a single satellite cannot HOLD this region — it MOVES and sets each ` +
        `pass, so availability sawtooths below the ${(c.slaAvail * 100).toFixed(0)}% bar. ` +
        `Coverage requires a CONSTELLATION — sats phased so one rises as another sets. ` +
        `You have ${have}; place ~${ACT2_ZERO_GAP_N} evenly-phased LEOs (spread their phase / add one).`,
      suggestPresetId: "LEO_SWEEP",
    };
  },
};

/**
 * act3a — "Your own success congests it." (escalation; C1b). The first full tame → outgrow →
 * re-tame cycle (onboarding lines 98-105). Two SLA axes arrive ONE AT A TIME (§4.4):
 *   - LATENCY (authored arrival): emit adds REGION-2, an equatorial CORRIDOR contract sharing
 *     REGION-0's infrastructure, activeAxes={connectivity,latency}, low slaLatencyS. The
 *     latency-tolerant parked GEO can't meet it (~3.57 ms > 3 ms) ⇒ the GEO ceiling is FELT;
 *     a shorter equatorial LEO route does ⇒ the player launches/re-routes onto the short path.
 *   - BANDWIDTH (escalation-triggered mask flip): emit also enables the ESCALATION LAW — a served
 *     contract's offeredLoad grows logistically. As REGION-0 + REGION-2 (both min-latency onto the
 *     same short equatorial LEO) ride the SHARED link past capacity, the escalation step flips the
 *     bandwidth axis on (load crosses the threshold) ⇒ the shared-link limit BITES (binary —
 *     breachSecondsAccum accrues, the HIGH-1 fix) ⇒ a comfortable contract dips near-breach.
 * The player re-engineers BY EXCEPTION — a parallel path (a 2nd equatorial LEO) + a per-contract
 * net_set_prefer(bw) override — to split the shared sat and re-tame.
 *
 * emit: enableEscalation() + offer REGION-2 (the latency corridor). Both deterministic; emit
 *       never touches physics (the §3 contract) — the generator it enables drives the escalation.
 * gate: escalationReTamed() — a previously-served contract dipped near-breach under risen load,
 *       then returned to fully SERVED (the §3a re-tame). SEPARATE from act3b so faults are fenced
 *       structurally behind THIS gate (act3b only opens after act3a clears).
 */
const ACT3A: Beat = {
  id: "act3a",
  emit(session: NetSession, t: number): void {
    // Enable the escalation generator (the §3 emit contract: flip a flag, never touch physics).
    session.enableEscalation();
    // The latency corridor demand: latency ACTIVE + VISIBLE for the first time (the §4.4 latency
    // axis, arriving by an AUTHORED contract). Idempotent (the session de-dupes by id). The
    // bandwidth axis is NOT set here — it is flipped on by the escalation law crossing capacity
    // (the §4.4 "one at a time": latency = authored arrival; bandwidth = escalation-triggered).
    session.addContract(
      offerNetContract(ACT3A_CONTRACT_ID, NET_ACT3A_CORRIDOR_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity", "latency"]),
        slaLatencyS: NET_ACT3A_LOW_LATENCY_S,
        offerWindowS: NET_OFFER_WINDOW_S,
        offeredAtS: t,
        // §7.2 — the corridor trunk is BANDWIDTH-class: w_lat KEPT 1 (so an un-congested corridor
        // still picks the SHORT equatorial LEO to meet its low latency SLA — the GEO ceiling felt),
        // PLUS a heavy w_bw so once the SHARED equatorial sat's congestion_term rises (the escalation
        // tips it over capacity) the blend ROUTES REGION-2 AROUND the loaded sat onto the parallel
        // LEO. So REGION-2 and REGION-0 — the SAME two equatorial sats — route DIFFERENTLY (REGION-0
        // latency-class clings to the short hop; REGION-2 bandwidth-class abandons the congested one):
        // demand-shape → topology-shape, the §7.2 thesis, now LIVE instead of inert.
        trafficClass: "bandwidth",
      }),
    );
    // THE SHARED-PIPE SQUEEZE (R0/SD-45): the second latency-TOLERANT demand that rides the
    // SAME GEO BROADCAST pipe as REGION-0. Under the pipe model a latency-active corridor can
    // never share a floodlight, so the §4.3 oversubscription tension lives HERE: two tolerant
    // contracts on one 1.5u pipe, phases ~103° apart, baselines growing under escalation —
    // until an asymmetric peak window cuts REGION-0's fair share below its 0.6 floor.
    session.addContract(
      offerNetContract(ACT3A_BACKHAUL_CONTRACT_ID, NET_ACT3A_BACKHAUL_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity"]),
        offerWindowS: NET_OFFER_WINDOW_S,
        offeredAtS: t,
        offeredLoad: NET_ACT3A_BACKHAUL_LOAD,
        slaBandwidth: NET_ACT3A_BACKHAUL_SLA_BW,
        payPerSecond: 1.2,
        trafficClass: "bandwidth",
      }),
    );
  },
  gate(session: NetSession): boolean {
    // The concept is FELT when the tame → outgrow → re-tame cycle has been demonstrated: a
    // previously-served contract dipped near-breach under risen load, then returned to fully
    // SERVED (the player re-engineered). State-gated (the session latches the witness), not
    // clock-timed. Fencing: act3b's emit only fires once the cursor advances past act3a.
    return session.escalationReTamed();
  },
  fallback(session: NetSession): Shortfall | null {
    // The §4.3 sharing readout (the trace's first face): if a corridor contract is sitting
    // near-breach on a saturated shared link without the player acting, surface the fix — add a
    // parallel path or prefer-bw on the contract (point at it, never do it).
    const c = session.contractById(ACT3A_CONTRACT_ID);
    if (c === null || c.state !== "active") return null;
    // Only nag while the contract is actually under-served (a saturated shared link), not when
    // it is comfortably served.
    if (c.lastServedFraction > 0) return null;
    const satId = session.lastSolveFor(c.id)?.path?.[1] ?? null;
    const carried = satId !== null ? session.loadOnSat(satId) : c.offeredLoad;
    return {
      subjectId: c.id,
      message:
        `${c.label}: the shared link${satId !== null ? ` via ${satId}` : ""} carries combined ` +
        `load ${carried.toFixed(2)} — its peak exceeds capacity, so a comfortable contract dips ` +
        `near-breach. Add a PARALLEL PATH (a second equatorial LEO) or set net_set_prefer(bw) on ` +
        `${c.label} to route it around the congested sat.`,
      suggestPresetId: "LEO_SWEEP",
    };
  },
};

/**
 * The MILD-FIRST scripted TRIO the act3b emit seeds into the fault roll (design §5.1, the full
 * spectrum mild→severe). Each fires only after the prior one's lifetime ENDS (the session feeds the
 * roll only the queue HEAD and advances it once the prior scripted fault leaves the active map), so
 * the trio is sequenced IN TIME — never fired together. `targetSatId: null` lets the roll pick the
 * LOWEST-orbit live sat (a LEO the low-orbit lever bites) deterministically off the seeded stream;
 * `cause: "lowOrbit"` stamps the live lever the trace names.
 *
 *   1. DEGRADATION — recoverable capacity haircut, self-recovers, UNWARNED. Teaches HEADROOM; bites
 *      whoever cut oversubscription too thin in 3a. (Barely felt with redundancy.)
 *   2. TRANSIENT (P2, audit §5.1) — a BRIEF full OUTAGE that SELF-HEALS (the sat drops, the router
 *      reactively re-routes around it, then it comes back). Teaches "you need a backup PATH; the
 *      self-healing reroute proves itself" (the §5 row-2 lesson, previously never fired — `transient`
 *      was a type-only kind). With redundancy the reroute is invisible-but-real (a re-route flash);
 *      without it the region blinks out for the outage.
 *   3. TELEGRAPHED (P2 §5.1 — now with TEETH) — a WARNED failure with a live countdown; the sat
 *      DROPS PERMANENTLY when it expires (a warned hard failure the player did NOT replace). Teaches
 *      WATCH-AND-ACT: the redundant builder's constellation bridges around the lost sat (it weathers
 *      the drop); a brittle single-sat contract would breach. The drop is real now (the session-
 *      ordering bug that deleted it before the router saw it is fixed).
 */
export const ACT3B_FAULT_SCRIPTS: FaultScript[] = [
  { kind: "degradation", targetSatId: null, cause: "lowOrbit" },
  { kind: "transient", targetSatId: null, cause: "lowOrbit" },
  { kind: "telegraphed", targetSatId: null, cause: "lowOrbit" },
];

/**
 * act3b — "And faults degrade it." (mild-first; ONLY after act3a re-tamed). The fault theme,
 * FENCED STRUCTURALLY behind act3a (this beat becomes current — and its emit fires — only once
 * the cursor advances PAST act3a, i.e. the act3a gate `escalationReTamed()` already fired, so a
 * fault can never fire before re-stabilisation).
 *
 * emit: ENABLE the fault generator (the §3 emit contract: flip a flag + seed the mild-first
 *       scripted pair — it never touches physics; the seeded roll in session.step drives the
 *       faults). ASSERTS act3a fired (the structural fence, belt-and-braces).
 * gate: weathered ≥1 fault while keeping contracts served (or recovering) AND the trace surfaced
 *       ≥1 resilience/optimisation shortfall — the player FELT a working network degrade and the
 *       trace did its job (named the shortfall + stamped the loss). State-gated; opens act4.
 * fallback: surface the active fault's resilience shortfall (the trace's brittle-builder warning).
 */
const ACT3B: Beat = {
  id: "act3b",
  emit(session: NetSession): void {
    // THE STRUCTURAL FENCE (design §3a/§3b — faults begin only after re-stabilisation): this beat
    // is current only once the cursor advanced past act3a (its gate fired), so escalationReTamed()
    // MUST be true here. Assert it — a fault can never fire before act3a re-tamed.
    if (!session.escalationReTamed()) {
      throw new Error("act3b fence violated: faults enabled before the act3a re-tame gate fired");
    }
    // Enable the fault generator + seed the mild-first scripted pair (the §3 emit contract: flip a
    // flag, never touch physics — the seeded roll in session.step drives the degradation, then the
    // telegraphed failure). Idempotent (the session de-dupes the seed; a re-emit never re-queues).
    session.enableFaults(ACT3B_FAULT_SCRIPTS);
  },
  gate(session: NetSession): boolean {
    // The concept is FELT when the player WEATHERED ≥1 fault while keeping contracts served (or
    // recovering — the redundant builder sails through) AND the TRACE surfaced ≥1 resilience/
    // optimisation shortfall (the predictability seed + the kind-of-fix — the trace did its job).
    // State-gated (both latch in session.step); act4 opens on the first true.
    return session.weatheredFault() && session.traceSurfacedShortfall();
  },
  fallback(session: NetSession): Shortfall | null {
    // Stuck on act3b: a fault is active but the player has not yet weathered it (or the trace has
    // not surfaced the shortfall). Surface the brittle-builder warning from the trace's resilience
    // shortfalls (SPOF / over-provision) — point at the redundant-path fix, never do it.
    const faults = session.faults;
    if (faults.length === 0) return null;
    const report = session.trace;
    const sf = report?.shortfalls.find(
      (s: TraceShortfall) => s.kindOfFix === "addRedundantPath" || s.kindOfFix === "addPhasedSat",
    );
    const sat = faults[0].satId;
    return {
      subjectId: sf?.subjectId ?? sat,
      message:
        sf?.message ??
        `${sat} is faulting (${faults[0].cause}) — a single fault must not drop a served region. ` +
          `Add a redundant/phased path so the network weathers it.`,
      suggestPresetId: "LEO_SWEEP",
    };
  },
};

/**
 * act4 — "Distance changes everything." (the Mars frontier TEASER — vertigo, FENCED, by sight).
 * The player has a mature Earth network (acts 1-3 done) and feels they have got this; act4 is the
 * REVERSAL. The cursor reaching act4 IS the "you've reached the frontier" beat.
 *
 * emit: surface the ONE Mars opportunity — offer a Mars contract (NET_ACT4_MARS_REGION, bodyId
 *       "mars", activeAxes={connectivity}). The player then does what they always do — LAUNCH a
 *       deep-space relay (the SAME net_launch, the MARS_RELAY preset) toward Mars. The FIRST SIGNAL
 *       CRAWLS: the router's solveMarsLeg injects the REAL Earth↔Mars light delay (minutes) into
 *       latencyS, so the Earth real-time-tune playbook physically BREAKS (you cannot tune a topology
 *       when your command arrives 8+ min late). Data arrives OLD ("as of Nm ago" — freshness BY
 *       SIGHT, reusing freshness-as-saturation). NO escalation, NO fault enable, NO mask flip — pure
 *       demand arrival; the "less for stale" pay-dimming is RENDER-LAYER (no Contract field, §8).
 * gate: STAYS FALSE FOREVER — a READ, not a gate. The scenario stops on a deliberate "to be
 *       continued"; the cursor never advances past act4 (NO win screen, NO completion gate). The
 *       human two-layer gate (did they lean in or bounce) is read OUTSIDE the sim.
 */
const ACT4: Beat = {
  id: "act4",
  emit(session: NetSession): void {
    // The ONE Mars demand: connectivity-only (latency/avail/bw present-but-un-enforced, as in Act 1
    // — the minutes-long latency is a READOUT, never a breach axis; vertigo, not a system). The
    // session de-dupes by id, so a re-emit is a no-op.
    session.addContract(
      offerNetContract(ACT4_MARS_CONTRACT_ID, NET_ACT4_MARS_REGION, {
        activeAxes: new Set<SlaAxis>(["connectivity"]),
      }),
    );
  },
  gate(): boolean {
    return false; // NO gate — a read, not a gate. The cursor STOPS on the frontier ("to be continued").
  },
};

/**
 * THE M1 ARRIVAL SEQUENCE (design §3). One game, four gated beats, with act3 split into
 * act3a (escalation) and act3b (faults, fenced behind act3a) so the granularity is real
 * from the start. The session steps the cursor act1 → act2 → act3a → act3b → act4. In
 * Phase A only act1 is live; the rest are structural placeholders (empty emit, false gate).
 */
export const M1_SCENARIO: Beat[] = [ACT1, ACT2, ACT3A, ACT3B, ACT4];
