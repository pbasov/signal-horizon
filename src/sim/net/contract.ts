/**
 * net/ — THE CONTRACT (design §2.2): the unit of demand, the teacher. A region-disc
 * demand with ALL THREE quantitative SLA axes PRESENT in the struct from day one
 * (slaAvail / slaLatencyS / slaBandwidth) plus an `activeAxes` GATE MASK that says which
 * axes the serve/breach evaluator ENFORCES this act — so an act adds an axis with a
 * one-line mask change in the scenario table, never a struct or solver change.
 *
 * --- THE REUSE DECISION (design §2.2, pinned in docs/decisions.md) ---------------
 * This is a FRESH struct (not the m2 Contract): the m2 `Contract` is GRID-CELL-coupled
 * (its region is `cellIds: number[]` resolved against the GeodesicGrid, served via
 * `coverageDimsAt` over those cells). The net/ game's demand is a REGION/POINT geodesic
 * disc on the spinning frame, served via the router's path-existence — a grid-cell
 * contract cannot express that without dragging the whole GeodesicGrid coupling in.
 *
 * It is NOT a drift hazard, because it shares the m2 state machine VERBATIM:
 *   - the same {@link ContractState} ("offered"|"active"|"completed"|"failed"), imported
 *     from m2/contracts (the shared vocabulary, NOT re-declared here);
 *   - identical field NAMES: state / termSeconds / servedSecondsAccum / breachSecondsAccum
 *     / lastServedFraction / earnedEur;
 *   - and net/session.ts IMPORTS the m2 transition helpers (stepActiveContract /
 *     stepOfferedContract) + the single BREACH_GRACE_SECONDS — so there is ONE breach
 *     convention in the codebase, two demand geometries.
 * The one extension net/ needs is the multi-axis mask the m2 single-valued QualityAxis
 * enum left a door open for — opened here on net/'s own struct, without touching the m2 file.
 *
 * PURE: plain JSON-safe data + pure constructors. No three / DOM / wall-clock / RNG.
 *
 * @see docs/signal-horizon-m1.md Part II §2.2 (the reuse decision), §4 (the fold), §5.
 */

import type { ContractState } from "../m2/contracts"; // SHARED state vocabulary (NOT re-declared)
import type { Region } from "./endpoint";

/**
 * The FIXED integer ordinal per SLA axis — the deterministic fold key (design §2.2/§4,
 * resolves the fold-ordering issue). NEVER reorder, NEVER add in the middle: the golden
 * folds `activeAxes` by iterating this map ASCENDING and mixing the ordinal of each
 * PRESENT axis (never Set iteration order, never a string sort of mutable labels), so a
 * future axis rename can never shift the hash. A new axis appends with the next ordinal.
 */
export const SLA_AXIS_ORDINAL = {
  connectivity: 0,
  availability: 1,
  latency: 2,
  bandwidth: 3,
} as const;

/** An SLA axis — the keys of {@link SLA_AXIS_ORDINAL}. Act 1 enforces only "connectivity";
 * Act 2 adds "availability"; Act 3 adds "latency" then "bandwidth" one at a time. */
export type SlaAxis = keyof typeof SLA_AXIS_ORDINAL;

/** The per-contract router PREFER weights (§7.2/§7.3): the design surface that biases the
 * link cost (latency vs bandwidth vs stability). `stab` is PRESENT but `w_stab` is dormant
 * in M1 (the cost blend is `w_lat·latencyTerm + w_bw·congestionTerm + 0·instabilityTerm`). */
export interface PreferWeights {
  lat: number;
  bw: number;
  stab: number;
}

/**
 * THE TRAFFIC CLASS (§7.2 — "demand-shape produces topology-shape"). What the contract is
 * carrying, which SETS its DEFAULT {@link PreferWeights} so the SAME solver over the SAME sats
 * routes a latency contract and a trunk contract DIFFERENTLY. The mapping is {@link PREFER_FOR_CLASS}:
 *   - "latency"      — latency-critical ⇒ high w_lat ⇒ routes the SHORT way (the LEO-mesh lesson).
 *   - "bandwidth"    — trunk/aggregation ⇒ high w_bw ⇒ routes the FAT/less-congested way (it leaves
 *                      a congested shared sat for a parallel path — the §4.3 oversubscription relief).
 *   - "availability" — coverage ⇒ high w_stab ⇒ would route over links that STAY UP (the Iridium
 *                      lesson). M1 LOCKED: w_stab is DORMANT (contributes 0), so availability-class
 *                      differs only by LEANING OFF latency (a low w_lat) — the weight is set, the term
 *                      stays dormant, so M1 routing/golden are unaffected by the stability term itself.
 */
export type TrafficClass = "latency" | "bandwidth" | "availability";

/** The bandwidth-class congestion weight `w_bw` (§7.2). SMALL relative to `w_lat=1` ONLY because of
 * the TOY frame: the latency_term is sub-millisecond (a short LEO ≈ 2.1 ms vs the GEO ≈ 3.6 ms, a
 * ~1.5 ms span), while the congestion_term is a dimensionless 0..~1.7 (load/capacity). This value is
 * tuned so `w_bw·congestion_term` OUTWEIGHS the ~0 latency gap between two SHORT parallel LEOs (so a
 * congested trunk leaves a loaded LEO for a free one — the §4.3 split) yet stays UNDER the ~1.5 ms
 * latency gap to the GEO (so it never routes the latency-critical corridor onto the latency-FAILING
 * GEO). Pinned in cost-blend + net-replay (a clean re-tamed split lands the corridor on the parallel
 * equatorial LEO, under capacity). Placeholder on the toy latency scale. */
export const NET_BANDWIDTH_CLASS_W_BW = 4.0e-4;

/**
 * The §7.2 PER-CLASS DEFAULT prefer weights — `TUNABLE` placeholders on the LOCKED shape (cost is a
 * physics-blend; the weights are per-traffic-class). Tuned for the M1 toy so two contracts over the
 * SAME equatorial sats route DIFFERENTLY (demand-shape → topology-shape):
 *   - latency: lat-only (= {@link NET_DEFAULT_PREFER}) ⇒ picks the SHORTEST path (the byte-identical
 *     pre-P3 default — a latency-class contract is unchanged from the old hardcoded {1,0,0}).
 *   - bandwidth: w_lat KEPT 1 (so an UN-congested trunk still picks the short LEO and meets any
 *     latency SLA — it does NOT abandon a short path for a long, latency-failing one), PLUS a w_bw
 *     that makes the congestion_term BITE: once a shared sat's congestion_term rises the blend ROUTES
 *     the trunk AROUND it onto a PARALLEL less-loaded SHORT path (the act3a "split the shared sat",
 *     now automatic by class). THE SCALE IS THE TOY FRAME: the latency_term is the realized one-way
 *     light time — SUB-MILLISECOND at the 300 km toy body (a short LEO ≈ 2.1 ms, the parked GEO ≈
 *     3.6 ms; ~1.5 ms span) — while the congestion_term is a dimensionless 0..~1.7 (load/capacity). So
 *     w_bw must be SMALL relative to w_lat to stay COMMENSURATE: w_bw·(congestion) must outweigh the
 *     latency gap between two SHORT parallel LEOs (≈0) so the trunk leaves a congested LEO for a free
 *     one, yet stay UNDER the latency gap to the GEO (~1.5 ms) so it never jumps to the latency-FAILING
 *     GEO. {@link NET_BANDWIDTH_CLASS_W_BW} sits inside that band — (in a non-toy latency frame this
 *     would be an O(1) weight; the tiny value here is purely the toy's sub-ms latency scale).
 *   - availability: w_lat LEANED DOWN (0.2) + w_stab 1 (DORMANT in M1) ⇒ it does NOT chase the
 *     absolute shortest hop; it tolerates a slightly-longer-but-equally-up bridge. w_stab's effect is
 *     0 in M1 (the cost-blend instability term is locked off), so this only differs by the low w_lat.
 */
export const PREFER_FOR_CLASS: Readonly<Record<TrafficClass, PreferWeights>> = {
  latency: { lat: 1.0, bw: 0.0, stab: 0.0 },
  bandwidth: { lat: 1.0, bw: NET_BANDWIDTH_CLASS_W_BW, stab: 0.0 },
  availability: { lat: 0.2, bw: 0.0, stab: 1.0 },
};

/** The DEFAULT prefer for a traffic class (a fresh copy — never aliases the shared table). */
export function preferForClass(trafficClass: TrafficClass): PreferWeights {
  return { ...PREFER_FOR_CLASS[trafficClass] };
}

/**
 * THE PER-CONTRACT PREFER SLIDER MAPPING (§7.3 / §10 — "the first thing the player tunes"). Maps a
 * single normalized 0..1 slider position to the three-stop latency ↔ bandwidth ↔ stability control:
 *   - 0.0  → LATENCY     ({@link PREFER_FOR_CLASS}.latency)     — route the SHORT way.
 *   - 0.5  → BANDWIDTH   ({@link PREFER_FOR_CLASS}.bandwidth)   — route AROUND congestion (the fat way).
 *   - 1.0  → STABILITY   ({@link PREFER_FOR_CLASS}.availability)— lean OFF latency (w_stab DORMANT in M1).
 * Between stops the weights LERP, so dragging visibly + continuously re-biases the cost-blend (the
 * router re-solves and the path moves). The mapping reuses the per-class weights so the slider, the
 * classes, and the cost-blend are ONE design surface. Pure. The inverse {@link preferSliderPos} reads
 * a contract's current weights back to the nearest slider position for the readout. */
export function preferFromSliderPos(pos: number): PreferWeights {
  const p = pos < 0 ? 0 : pos > 1 ? 1 : pos;
  const lerp = (a: number, b: number, f: number): number => a + (b - a) * f;
  if (p <= 0.5) {
    const f = p / 0.5; // latency → bandwidth
    const A = PREFER_FOR_CLASS.latency;
    const B = PREFER_FOR_CLASS.bandwidth;
    return { lat: lerp(A.lat, B.lat, f), bw: lerp(A.bw, B.bw, f), stab: lerp(A.stab, B.stab, f) };
  }
  const f = (p - 0.5) / 0.5; // bandwidth → stability
  const A = PREFER_FOR_CLASS.bandwidth;
  const B = PREFER_FOR_CLASS.availability;
  return { lat: lerp(A.lat, B.lat, f), bw: lerp(A.bw, B.bw, f), stab: lerp(A.stab, B.stab, f) };
}

/** Read a contract's current prefer weights back to the nearest 0..1 slider position (the inverse of
 * {@link preferFromSliderPos}, for the readout). A heuristic on the dominant lever: a non-zero w_bw
 * (relative to the bandwidth-class default) reads toward the BANDWIDTH stop (0.5); a low w_lat with
 * w_stab reads toward STABILITY (1.0); lat-only reads LATENCY (0.0). Pure. */
export function preferSliderPos(prefer: PreferWeights): number {
  if (prefer.stab > 0 && prefer.lat < 1) return 1.0; // stability-leaning.
  if (prefer.bw > 0) {
    // Between latency (bw=0) and bandwidth (bw=class default): position 0..0.5 by the bw fraction.
    const frac = Math.min(1, prefer.bw / Math.max(NET_BANDWIDTH_CLASS_W_BW, prefer.bw));
    return 0.5 * frac;
  }
  return 0.0; // lat-only ⇒ the LATENCY stop.
}

/** A region-disc demand contract. ALL THREE SLA axes are present; `activeAxes` gates which
 * the serve/breach evaluator enforces. The state-machine fields mirror m2/contracts.ts. */
export interface Contract {
  /** Stable id (the net_accept / net_set_prefer action payloads carry this). */
  id: string;
  /** Glanceable label (the region the contract sits over). */
  label: string;
  /** The endpoint GEOMETRY: a body-fixed geodesic disc — NOT m2 grid cells. The router
   * reads this; it makes the struct a structural supertype of the router's RoutableContract. */
  region: Region;

  // --- ALL THREE QUANTITATIVE AXES PRESENT (Act 1 HIDES them via the mask) ---
  /** Min fraction of time the region must be served (0..1) — the availability bar (Act 2). */
  slaAvail: number;
  /** Max one-way latency (seconds) the path must achieve (Act 3). */
  slaLatencyS: number;
  /** Min per-user bandwidth (units) the path must carry (Act 3) — the COMMITTED FLOOR (§4.1/§4.3).
   * The bandwidth axis (§4.3) is bandwidth-MET when the contract's served bandwidth over the shared
   * link is ≥ this; it BREACHES when a coincident-peak spike pushes the shared link past what honors
   * every sharing contract's floor. NOT a flat uniform cliff — the contract's OWN committed floor. */
  slaBandwidth: number;
  /** Time-varying offered demand (drives oversubscription/congestion in §4.3) — the BURSTY REALIZED
   * load THIS instant: a monotone-grown {@link loadBaseline} PLUS a deterministic diurnal oscillation
   * + a bounded seeded-noise term, with a PER-CONTRACT {@link loadPhase} so different contracts peak
   * at DIFFERENT times (non-coincident peaks). It RISES ABOVE and FALLS BELOW {@link slaBandwidth}
   * over time. A pure function of (t, loadPhase, the session's seeded splitmix64) — replay-safe. */
  offeredLoad: number;
  /** The MONOTONE-GROWN baseline the bursty {@link offeredLoad} oscillates around (§3a — "demand
   * grows where you serve"). It grows logistically toward the ceiling via {@link escalateLoad} ONLY
   * where served well (frozen while breaching); the diurnal+noise burst rides ON TOP of it. Folded
   * (it is the slow state the burst is a pure function of). Initialised = the offer's offeredLoad. */
  loadBaseline: number;
  /** The PER-CONTRACT diurnal PHASE (radians) so peaks are NON-COINCIDENT (§4.3 — "share a link
   * across contracts whose peaks don't coincide"). A deterministic pure hash of the contract id into
   * [0, 2π) — two contracts over the same shared sat peak at DIFFERENT times unless their phases
   * happen to align. Folded (stable per contract; never drawn from the clock). Set at offer. */
  loadPhase: number;

  // --- THE GATE MASK: which axes the serve/breach evaluator ENFORCES this act ---
  /** Act1 {connectivity}; Act2 +availability; Act3 +latency,+bandwidth. The UI reads this
   * to decide what to SHOW; the session reads it to decide what the router must satisfy. */
  activeAxes: ReadonlySet<SlaAxis>;

  // --- the router surface (§7.2/§7.3): traffic class + per-contract prefer weights ---
  /** What the contract CARRIES (§7.2) — sets the DEFAULT {@link prefer} per {@link PREFER_FOR_CLASS}
   * so demand-shape produces topology-shape (a latency contract and a trunk contract route
   * DIFFERENTLY over the same sats). The UI shows it; the player can still OVERRIDE `prefer` by hand
   * (the §7.3 per-contract slider) without changing the class. */
  trafficClass: TrafficClass;
  /** Per-contract prefer weights (defaulted from {@link trafficClass}, player-overridable via
   * net_set_prefer); `stab` present, w_stab dormant in M1. */
  prefer: PreferWeights;

  /** € per sim-second at FULL service (accrues while served). */
  payPerSecond: number;
  /** € per sim-second drained while ACTIVE but wholly unserved (the SLA bite). */
  penaltyPerSecond: number;

  // --- SHARED state-machine fields (SAME NAMES as m2/contracts.ts) ---
  /** Current lifecycle state (the imported {@link ContractState}). */
  state: ContractState;
  /** Sim-time the OFFER auto-expires (the m2 stepOfferedContract reads this). The net
   * contract has NO offer window in Act 1, so this is `Infinity` — the SHARED offered-step
   * helper then never expires it (a genuine, deterministic no-op), keeping ONE convention.
   * SAME field name as m2/contracts.ts.
   * FL-07 (SD-47): Act 1 ladders onto the SAME machinery — windows are now universal. */
  offerExpiresAtS: number;
  // --- FL-07 (SD-47) — TENDER TEXTURE: the offer is a live market object, not a static row ---
  /** When the offer was emitted (the decay + sign-on clock origin). */
  offeredAtS: number;
  /** One-shot sign-on bonus (€) credited to the wallet if accepted by {@link signOnBonusUntilS}. */
  signOnBonusEur: number;
  /** Absolute sim-time the sign-on bonus lapses (0 = no bonus offered). */
  signOnBonusUntilS: number;
  /** While OFFERED, the pay decays with this half-life from {@link offeredAtS} (the market
   * re-prices an unsigned deal). Infinity = flat (Acts 2–4 tenders keep their R3 behaviour).
   * On accept the pay FREEZES at its decayed value and this is set to Infinity. */
  payHalvingS: number;
  /** Term in sim-seconds (fraction-weighted served-time must reach this to COMPLETE). */
  termSeconds: number;
  /** Accumulated served sim-seconds, weighted by served fraction (drives COMPLETION). */
  servedSecondsAccum: number;
  /** Consecutive sim-seconds currently below the bar (FAILS past the imported grace). */
  breachSecondsAccum: number;
  /** Last computed served fraction ∈ [0,1] (the readout; refreshed each step). */
  lastServedFraction: number;
  /** Last computed ROLLING availability ∈ [0,1] over the trailing hand-off window — the
   * sawtooth-meter value (Act 2). A READOUT (like {@link lastServedFraction}), NOT a
   * state-machine field: the session sets it each step when the availability axis is active
   * (0 otherwise). The Act-2 gate reads it; the fold mixes it. NO struct reshape — additive. */
  lastAvailability: number;
  /** Total € this contract has earned (a readout; the wallet is the truth). */
  earnedEur: number;
}

// --- TUNING CONSTANTS — sane placeholders (tune later) ----------------------------

/** € per sim-second a served Act-1 connectivity contract pays. Sized against the R0
 * economy theorem (m1-redesign §2.5): one term's full revenue (pay × term ≈ €14.4k) is
 * LESS than the contract's honest provisioning (~€19k launch stack) — no single contract
 * pays for its own hardware; margins come from sharing + renewals. TUNABLE. */
export const NET_DEFAULT_PAY_PER_SECOND = 2.0;

/** € per sim-second drained while an ACTIVE contract is wholly unserved — the 2× penalty
 * ASYMMETRY (m1-redesign §2.5): a wrong signing is strictly worse than not signing.
 * TUNABLE. */
export const NET_DEFAULT_PENALTY_PER_SECOND = 4.0;

/** Default contract term (sim-seconds) — a sustained commitment scaled to the session
 * (≈ 2 sim-hours; ~15 real-minutes at the 8× cruise). TUNABLE. */
export const NET_DEFAULT_TERM_SECONDS = 2 * 3600.0; // 2 sim-hours.

/** Default availability/latency/bandwidth bars carried in the struct but HIDDEN in Act 1
 * (activeAxes={connectivity}). Sane non-trivial values so Act 2/3 inherit a real bar when
 * the mask opens. Placeholders.
 *
 * NET_DEFAULT_SLA_BANDWIDTH is the COMMITTED FLOOR (§4.1/§4.3). Sized BELOW the initial
 * offeredLoad (1.0) and the trough of the diurnal burst so a contract ALONE on a sat (its
 * served bandwidth = its full offeredLoad) always honors its floor — the bandwidth axis bites
 * ONLY when a coincident-peak spike on a SHARED sat cuts a contract's fair share below it. */
export const NET_DEFAULT_SLA_AVAIL = 0.99;
export const NET_DEFAULT_SLA_LATENCY_S = 0.05; // 50 ms one-way.
export const NET_DEFAULT_SLA_BANDWIDTH = 0.6;

/** The neutral prefer weights (latency-biased, bandwidth secondary, stability dormant). */
export const NET_DEFAULT_PREFER: PreferWeights = { lat: 1.0, bw: 0.0, stab: 0.0 };

// --- THE ESCALATION LAW (Act 3a / C1b — "your success congests it") ----------------
//
// `offeredLoad` GROWS on a contract being served well, run in the session step ONLY when
// escalation is gated ON (the act3a beat enables it; present-from-day-one otherwise dormant).
// "Demand grows where you serve well" (onboarding line 99). The growth is the EXACT CLOSED-FORM
// LOGISTIC FLOW the M2 dynamic-demand engine uses (coverage/dynamic-demand.ts) so it is
// DT-INVARIANT (the SD-20/SD-34 contract): the analytic flow is a semigroup, so a fine (dt=1/60)
// and a coarse (dt=60) caller integrating to the same sim-time yield the same offeredLoad, and
// composing two steps of dt equals one step of 2·dt — never an O(dt)-error Euler bump.

/** The served-fraction threshold above which a contract's demand ESCALATES: a contract served
 * WELL grows; one that is breaching/under-served does not. = 1.0 (fully served the prior step) —
 * mirrors the M2 engine's "served at/above the quality bar grows" rule (binary q here). */
export const ESCALATION_SERVE_THRESHOLD = 1.0;

/** Logistic GROWTH rate (per sim-second) of a fully-served contract's offeredLoad at the
 * low-load end (where the (1 − load/ceiling) brake ≈ 1). Tuned for the toy ~4-min day so a
 * well-served corridor's load climbs from 1.0 across the bandwidth-axis threshold (1.2) within
 * ~45 sim-seconds of served time — enough that two contracts sharing one sat tip past
 * NET_LINK_CAPACITY_UNITS within a short sitting — without exploding. DT-invariant rate.
 * Placeholder, on the M2 GROWTH_RATE_PER_S scale but faster for the toy day. */
export const ESCALATION_RATE_PER_S = 2.0e-2;

/** The logistic CARRYING CAPACITY (the ceiling the offeredLoad asymptotes to under sustained
 * service). Chosen BELOW NET_LINK_CAPACITY_UNITS (1.5) so a single well-served contract ALONE on
 * a sat never self-congests (its grown load 1.0 → 1.4 stays under capacity even once its bandwidth
 * axis is on) — but TWO well-served contracts SHARING one sat sum to ~2.8, well over capacity (the
 * strain the act3a beat needs). This is the "your own success congests it" pivot: relief is
 * SPLITTING the shared sat (a parallel path / a prefer override), not just adding headroom on one.
 * Placeholder on the `offeredLoad` scale. */
export const ESCALATION_LOAD_CEILING = 1.4;

/** The loadBaseline a served contract crosses to make its BANDWIDTH axis bite (the §4.4
 * escalation-triggered mask flip): once a served contract's grown BASELINE reaches this, the act3a
 * escalation step adds "bandwidth" to its activeAxes (one-line mask add, no struct reshape). Keyed
 * on the SLOW {@link loadBaseline} (not the bursty realized offeredLoad) so the mask flip is a
 * monotone, replay-stable event — it never flickers on/off with the diurnal oscillation. Set ABOVE
 * the initial baseline (1.0) so the axis is genuinely ESCALATION-triggered (it flips only after
 * demand has grown — NOT at t=0), and BELOW the ceiling (1.4) so escalation reaches it. Placeholder. */
export const ESCALATION_BANDWIDTH_AXIS_THRESHOLD = 1.2;

// --- THE BURSTY, NON-COINCIDENT LOAD MODEL (Act 3a / §4.3 — the oversubscription tension) ---------
//
// The §4.3 tension ("N contracts, M sats — share a link across contracts whose peaks DON'T coincide;
// cut it as thin as you dare before a breach costs more than the hardware") needs a TIME-VARYING
// offered load, not a monotone ramp: a load that RISES ABOVE and FALLS BELOW its sla_bandwidth over
// time, with PER-CONTRACT phase so two contracts sharing one sat peak at DIFFERENT times. The model
// is `offeredLoad(t) = baseline · (1 + AMP·sin(2π·t/PERIOD + phase) + noise)`, where:
//   - `baseline`  — the monotone-grown {@link loadBaseline} (the §3a network effect stays);
//   - the SIN term is the deterministic "diurnal" oscillation (a periodic function of t — NO clock);
//   - `phase`     — the PER-CONTRACT {@link loadPhase} (a pure hash of the id) so peaks are
//                   NON-COINCIDENT (two contracts peak at different t unless their phases align);
//   - `noise`     — a bounded term drawn from the session's SEEDED splitmix64 (NO unseeded random),
//                   so a coincident-peak spike is the STATISTICAL BET the player makes, not scripted.
// PURE + replay-safe: a function of (t, loadPhase) for the periodic part + the folded rng for noise.

/** The diurnal oscillation PERIOD (sim-seconds): the toy "day" over which a contract's load swings
 * peak→trough→peak. Sized a few toy LEO periods (≈ 2·A1_LEO_PERIOD_S = 300 s) so within a short
 * sitting a contract sweeps through several peaks — and two contracts at different phases visibly
 * peak at different times (the non-coincident-peak bet plays out over the act3a corridor). Placeholder. */
export const NET_LOAD_DIURNAL_PERIOD_S = 300.0;

/** The diurnal oscillation AMPLITUDE (fraction of the baseline). The sin term swings the load
 * ±AMP·baseline around the baseline, so offeredLoad rises ABOVE and falls BELOW sla_bandwidth over
 * time. 0.45 ⇒ a baseline-1.0 contract swings ≈ 0.55 → 1.45 (its trough 0.55 stays just under a
 * lone-sat floor of 0.6 only at the deepest trough — the bandwidth floor 0.6 is comfortably honored
 * by a contract ALONE on a sat at its baseline; the bite is a SHARED-sat coincident peak). Sized so
 * a coincident peak of two ~1.0-baseline contracts (≈ 2.9) blows past the 1.5 capacity while a
 * non-coincident pairing (one near-peak ≈ 1.45 + one near-trough ≈ 0.55 ≈ 2.0) still over-subscribes
 * but less deeply — the statistical-multiplexing gradient. Placeholder on the offeredLoad scale. */
export const NET_LOAD_DIURNAL_AMPLITUDE = 0.45;

/** The bounded NOISE amplitude (fraction of the baseline) the seeded splitmix64 adds each step — a
 * small jitter so a peak is never perfectly periodic (the bet has real variance), bounded so it can
 * never dominate the diurnal signal or send the load negative. ±0.06·baseline. Placeholder. */
export const NET_LOAD_NOISE_AMPLITUDE = 0.06;

/**
 * THE BURSTY, NON-COINCIDENT OFFERED LOAD (design §4.3). A pure function of the slow `baseline`, the
 * sim-time `t`, the PER-CONTRACT `phase` (so peaks are non-coincident), and a bounded `noise01` ∈
 * [0,1) drawn from the session's SEEDED splitmix64 (the caller draws it; this function is pure):
 *
 *   offeredLoad = baseline · (1 + AMP·sin(2π·t/PERIOD + phase) + NOISE_AMP·(2·noise01 − 1))
 *
 * RISES ABOVE and FALLS BELOW sla_bandwidth over time; bounded below by 0 (clamped). Deterministic:
 * the periodic part is `sin(t)` (no clock), the noise is a seeded draw mapped to [−1,1). So sharing a
 * sat across two contracts whose phases DON'T align is viable (their peaks miss); if the phases align
 * the shared link spikes over capacity and one tips toward breach (the §4.3 statistical bet). Pure.
 */
export function burstyOfferedLoad(
  baseline: number,
  t: number,
  phase: number,
  noise01: number,
): number {
  if (baseline <= 0) return 0;
  const diurnal = NET_LOAD_DIURNAL_AMPLITUDE * Math.sin((2 * Math.PI * t) / NET_LOAD_DIURNAL_PERIOD_S + phase);
  const noise = NET_LOAD_NOISE_AMPLITUDE * (2 * noise01 - 1);
  const load = baseline * (1 + diurnal + noise);
  return load > 0 ? load : 0;
}

/**
 * THE PER-CONTRACT DIURNAL PHASE (radians, [0, 2π)) — a deterministic pure hash of the contract id
 * so different contracts peak at DIFFERENT times (NON-COINCIDENT peaks, §4.3). NOT drawn from a
 * clock or an unseeded random — a stable function of the id, so the same contract always carries the
 * same phase across runs/restores (folded). A simple string-fold (FNV-1a-ish over the char codes)
 * mapped into [0, 2π). The act3a corridor (REGION-2) and the equatorial trunk (REGION-0) get
 * DIFFERENT phases by construction (their ids differ), so the SAME shared equatorial sat sees their
 * peaks at different t — the bet is real. Pure.
 */
export function loadPhaseForId(id: string): number {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < id.length; i++) {
    h ^= id.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return (h / 4294967296) * (2 * Math.PI);
}

/**
 * Advance a contract's `offeredLoad` by the EXACT CLOSED-FORM LOGISTIC FLOW toward
 * {@link ESCALATION_LOAD_CEILING} over `dtSeconds` of served time (the M2 dynamic-demand
 * semigroup): `load(t+dt) = cap / (1 + ((cap − load)/load)·exp(−ESCALATION_RATE_PER_S·dt))`.
 * Returns the grown load. Pure; DT-invariant; bounded above by the ceiling (it can never
 * exceed it, so a long run never explodes — a single ceiling-clamp via the asymptote, mirroring
 * commit 2fc0500's shock-compounding fence). A non-positive load or dt is returned unchanged.
 */
export function escalateLoad(offeredLoad: number, dtSeconds: number): number {
  const cap = ESCALATION_LOAD_CEILING;
  if (dtSeconds <= 0 || offeredLoad <= 0 || cap <= 0) return offeredLoad;
  if (offeredLoad >= cap) return cap; // already at/above the ceiling — clamp (no overshoot).
  const k = Math.exp(-ESCALATION_RATE_PER_S * dtSeconds);
  return cap / (1 + ((cap - offeredLoad) / offeredLoad) * k);
}

/**
 * Build an OFFERED contract over a region. Act 1 offers a connectivity-ONLY contract
 * (activeAxes = {connectivity}); the avail/latency/bandwidth fields are present but the
 * mask hides + un-enforces them. Pure: a deterministic function of its inputs (no RNG,
 * no clock). The scenario beat calls this to put the one Act-1 contract on the board.
 */
export function offerNetContract(
  id: string,
  region: Region,
  opts?: {
    label?: string;
    activeAxes?: ReadonlySet<SlaAxis>;
    payPerSecond?: number;
    penaltyPerSecond?: number;
    termSeconds?: number;
    slaAvail?: number;
    slaLatencyS?: number;
    slaBandwidth?: number;
    offeredLoad?: number;
    trafficClass?: TrafficClass;
    prefer?: PreferWeights;
    /** R3 (SD-45): the offer auto-expires this many sim-seconds after `offeredAtS`
     * (both must be given; the shared m2 stepOfferedContract fails it past that). */
    offerWindowS?: number;
    offeredAtS?: number;
    /** FL-07: one-shot sign-on bonus (€) + its absolute lapse time. */
    signOnBonusEur?: number;
    signOnBonusUntilS?: number;
    /** FL-07: offer-board pay decay half-life (Infinity = flat). */
    payHalvingS?: number;
  },
): Contract {
  // The traffic class SETS the default prefer (§7.2). An explicit `prefer` opt still wins (a test /
  // a pre-set override); otherwise the class's default weights are used. Default class is "latency"
  // (the lat-only weights = the byte-identical pre-P3 default, so a class-less caller is unchanged).
  const trafficClass: TrafficClass = opts?.trafficClass ?? "latency";
  return {
    id,
    label: opts?.label ?? region.label,
    region,
    slaAvail: opts?.slaAvail ?? NET_DEFAULT_SLA_AVAIL,
    slaLatencyS: opts?.slaLatencyS ?? NET_DEFAULT_SLA_LATENCY_S,
    slaBandwidth: opts?.slaBandwidth ?? NET_DEFAULT_SLA_BANDWIDTH,
    offeredLoad: opts?.offeredLoad ?? 1.0,
    // The slow baseline the bursty offeredLoad oscillates around (= the initial offeredLoad at offer;
    // it grows via escalateLoad while served well). The PER-CONTRACT diurnal phase is a pure hash of
    // the id so peaks are non-coincident (§4.3) — two contracts sharing a sat peak at different t.
    loadBaseline: opts?.offeredLoad ?? 1.0,
    loadPhase: loadPhaseForId(id),
    activeAxes: opts?.activeAxes ?? new Set<SlaAxis>(["connectivity"]),
    trafficClass,
    prefer: opts?.prefer ? { ...opts.prefer } : preferForClass(trafficClass),
    payPerSecond: opts?.payPerSecond ?? NET_DEFAULT_PAY_PER_SECOND,
    penaltyPerSecond: opts?.penaltyPerSecond ?? NET_DEFAULT_PENALTY_PER_SECOND,
    state: "offered",
    // R3 (SD-45): a finite offer window when the scenario gives one (Act 2+ tenders have
    // clocks; the Act-1 opener stays patient). The SHARED m2 expiry helper enforces it.
    offerExpiresAtS:
      opts?.offerWindowS !== undefined && opts?.offeredAtS !== undefined
        ? opts.offeredAtS + opts.offerWindowS
        : Infinity,
    offeredAtS: opts?.offeredAtS ?? 0,
    signOnBonusEur: opts?.signOnBonusEur ?? 0,
    signOnBonusUntilS: opts?.signOnBonusUntilS ?? 0,
    payHalvingS: opts?.payHalvingS ?? Infinity,
    termSeconds: opts?.termSeconds ?? NET_DEFAULT_TERM_SECONDS,
    servedSecondsAccum: 0,
    breachSecondsAccum: 0,
    lastServedFraction: 0,
    lastAvailability: 0,
    earnedEur: 0,
  };
}

// --- R3 (SD-45) — RENEWALS: the sustaining loop -----------------------------------
/** Renewal tariff growth per completed term (the escalation engine's economic face:
 * demand grew while you served — the renewal pays more AND asks more). TUNABLE. */
export const NET_RENEWAL_PAY_GROWTH = 1.15;
/** The renewal's offer window (sim-seconds) — renewals have clocks (a served customer
 * expects continuity; dawdle and the deal lapses). TUNABLE. */
export const NET_RENEWAL_OFFER_WINDOW_S = 1800;

/**
 * Build the RENEWAL offer a COMPLETED contract spawns (m1-redesign §2.5: margins come
 * from sharing + renewals — the term revenue never pays for the hardware, the RELATIONSHIP
 * does). The renewal inherits the region + axes + class, carries the GROWN demand
 * (offeredLoad = the completed term's baseline — you built for less than they now need),
 * and pays {@link NET_RENEWAL_PAY_GROWTH}× the old tariff. Deterministic; the id appends
 * a renewal ordinal. Pure.
 */
export function renewalOffer(completed: Contract, generation: number, nowS: number): Contract {
  return offerNetContract(`${completed.id.split("+R")[0]}+R${generation}`, completed.region, {
    label: completed.label,
    activeAxes: new Set(completed.activeAxes),
    payPerSecond: completed.payPerSecond * NET_RENEWAL_PAY_GROWTH,
    penaltyPerSecond: completed.penaltyPerSecond * NET_RENEWAL_PAY_GROWTH,
    termSeconds: completed.termSeconds,
    slaAvail: completed.slaAvail,
    slaLatencyS: completed.slaLatencyS,
    slaBandwidth: completed.slaBandwidth,
    offeredLoad: completed.loadBaseline,
    trafficClass: completed.trafficClass,
    prefer: { ...completed.prefer },
    offerWindowS: NET_RENEWAL_OFFER_WINDOW_S,
    offeredAtS: nowS,
  });
}

/**
 * The € revenue RATE (per sim-second) an ACTIVE contract accrues at a served fraction:
 * payPerSecond × servedFraction when served at all; a NEGATIVE penalty rate when wholly
 * unserved (servedFraction 0). Pure. Mirrors m2's contractRevenueRatePerSecond shape so
 * the two economies read identically. Only ACTIVE contracts earn/drain.
 */
export function netRevenueRatePerSecond(contract: Contract, servedFraction: number): number {
  if (contract.state !== "active") return 0;
  if (servedFraction > 0) return contract.payPerSecond * servedFraction;
  return -contract.penaltyPerSecond;
}

// --- FL-07 (SD-47) — the decayed-pay + sign-on-bonus helpers (the market texture) -----

/** The pay an OFFERED contract would freeze at if signed at sim-time `t`: the offer-board
 * value decayed with {@link Contract.payHalvingS} from {@link Contract.offeredAtS}.
 * Flat (exact `payPerSecond`) when the half-life is not finite/positive OR the contract is
 * already past its offered state (accept freezes + flattens it). Pure. */
export function decayedPayAtS(c: Contract, t: number): number {
  if (!Number.isFinite(c.payHalvingS) || c.payHalvingS <= 0) return c.payPerSecond;
  const dt = Math.max(0, t - c.offeredAtS);
  return c.payPerSecond * Math.pow(2, -dt / c.payHalvingS);
}

/** The sign-on bonus (€) payable if signed at sim-time `t` (0 once the bonus window has
 * lapsed, when none was offered, or after accept consumed it). Pure. */
export function signOnBonusAtS(c: Contract, t: number): number {
  return c.signOnBonusEur > 0 && t <= c.signOnBonusUntilS ? c.signOnBonusEur : 0;
}

/** Add € earned this step to a contract's running total (the session calls this with the
 * same rate×dt it adds to the wallet, keeping the readout and the truth aligned). */
export function recordNetEarned(contract: Contract, eur: number): void {
  contract.earnedEur += eur;
}

/** Deep-copy a contract by value (a fresh `activeAxes` Set + `prefer` so a snapshot never
 * shares the mutable mask/weights with the live contract). */
export function cloneNetContract(c: Contract): Contract {
  return {
    ...c,
    activeAxes: new Set(c.activeAxes),
    prefer: { ...c.prefer },
  };
}
