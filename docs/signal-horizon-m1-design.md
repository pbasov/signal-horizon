# SIGNAL HORIZON — M1 AS ONE GAME: BUILD-READY DESIGN

> **Status / supersession.** This is the FINAL, build-ready design for **M1 as one game** — the real connectivity/coverage + launch-planner + routing-solver + fault systems running under a curated, state-gated arrival sequence, with **Act 1 as the first build-and-prove slice**. It **supersedes** `docs/act1-rotating-earth-design.md` (the isolated Act-1 prototype plan): that doc framed Act 1 as a sealed slice with a bent-pipe reachability stub, a co-located ground, an EIRP-clip forced imperfection (`A1_DISH_EIRP=1.1`), a `windowCoverage.minFraction=0.802` / `A1_AVAILABILITY_BAR=0.85` availability bar, and its own throwaway golden. **All of that is dropped here** (see §1). What is KEPT from that doc and the stopped build: the spinning-Earth rotation frame, the toy-radius pacing (GEO period == rotation period ⇒ a parked equatorial GEO holds station), the unforked m2 orbit propagation, and the radians-at-the-boundary discipline. The CANON remains the three authoritative docs (`signal-horizon-m1-mechanics.md`, `signal-horizon-m1-onboarding.md`, `signal-horizon-gdd.md`); this design implements them and never overrides them.

**Scope.** Acts 1–3 are buildable on one set of real systems; Act 4 is a fenced concepts-only teaser. **Cardinal rule: one new concept per act, never a second until the first is FELT.** The systems run for real; only the order contracts/faults arrive is scripted. Emotional arc: competence → challenge → mastery-under-pressure → vertigo.

All file paths absolute. Type names match the verified in-repo backbone (`SimAction`, `SatOrbit`, `Ephemeris`, `StepAccumulator`, the `mixInt/mixFloat/mixString` state-hash fold, the `m2/contracts.ts` `stepActiveContract`/`stepOfferedContract`/`BREACH_GRACE_SECONDS` helpers).

---

## 1. MODULE / NAMESPACE LAYOUT

### Namespace decision

- The OLD `src/sim/m1/` (21 files: `cache.ts`, `economy.ts`, `coherence.ts`, `feeds.ts`, `demand.ts`, `resolver.ts`, `policy.ts`, `parse.ts`, `scenario.ts`, `session.ts`, …) is the **reclassified cache-economy (Act-4 teaser)**. It owns golden `544847093270497462n` (`src/sim/m1-session-replay.test.ts`).
- The new connectivity game spans Acts 1–3 (one game, four gated beats). Naming it `a1/` would mislabel it as an Act-1 prototype — the exact contraption-trap framing the brief warns against.

**Chosen namespace: `src/sim/net/`** ("the network game"). Two reasons over `conn/`: it reads as the whole connectivity/routing/coverage game (not just "connectivity axis 1"), and it leaves room for the §7 router which is the spine of Acts 2–3. The new game imports **neither** `m1/` **nor** `m2/session.ts`. It MAY import small **pure, axis-agnostic helpers** from `m2/contracts.ts` (the serve/breach term-accrual transitions — see §2.2 reuse decision) and from `coverage/field.ts` (the link-budget formulas) and `delay.ts` (light-delay, Act 4 only); none of these pull in a session or a golden.

> **The `m1/` → `m1-economy/` rename is DEFERRED, not part of this build.** The critique confirmed it is **not** zero-touch: it touches **7 import sites** across `sim` AND `panels` AND `main`, including `m2/session.ts:38` (`import { M1Economy } from "../m1/economy"`) — a file that owns the M2 golden path. `net/` collides with nothing and imports neither, so there is no need to risk the M2 golden during the new-game build. If ever done, do it as an isolated increment-0 that rewrites all 7 sites and re-runs **both** existing goldens byte-for-byte before any `net/` work. **Recommendation: leave `m1/` alone; the `net/` name already removes the ambiguity for the new game.**

### File layout — `src/sim/net/` (all pure sim; no three, no DOM, no wall-clock, splitmix64 only)

| File | Responsibility | Origin |
|---|---|---|
| `world.ts` | Toy-radius pacing + world constants + `resolveOrbit` + `launchCost`. The locked **ratio** (GEO period == rotation period ⇒ parks). | **Migrate** `a1/world-a1.ts`. Drop nothing here — but the EIRP-clip "closing-lever" doc framing does not move (EIRP stays a real antenna field, never a forced-imperfection knob). |
| `frame.ts` | Spinning-Earth rotation frame: `earthThetaAt`, `rotZ`, `bodyFixedToInertialDir`, `inertialDirToBodyFixed`, `surfacePointInertial`. | **Migrate** `a1/frame-a1.ts` unchanged (locked by `frame.test.ts`). |
| `sat.ts` | The satellite atom: `BusTier`, `AntennaType`, `AntennaSpec`, `NetSat { id, orbit: SatOrbit, bus, loadout[] }`. | **Migrate** `a1/sat.ts`. **Drop `A1_DISH_EIRP=1.1`** and its "closing lever" framing (EIRP stays a real antenna field used by the link budget, NOT an Act-1 imperfection). |
| `endpoint.ts` | Demand geometry: `Region` (geodesic disc, body-fixed) + `GroundNet` (the ground-network endpoint). **Decoupled** Fibonacci sampler `sampleRegionPoints` + `coveredFraction(region, n, isCoveredAt)` taking a generic `(point, t) => boolean` callback. | **Migrate** `a1/region.ts` geometry; **REWORK** the co-located `A1Ground` into a real `GroundNet` endpoint; **decouple** from `pointReachable`. **Drop** `minFraction`/`meanFraction` `windowCoverage` + `A1_AVAILABILITY_BAR` (the 0.802/0.85 forced-imperfection machinery). |
| `contract.ts` | The unit of demand: **all three SLA axes present in the struct** + a per-axis **gate mask** (`activeAxes`) + `prefer` weight + `payPerSecond`/`penaltyPerSecond`/`offeredLoad`. Field NAMES + state machine **identical to `m2/contracts.ts`** (reuse decision §2.2). The contract is the teacher. | **New struct, shared vocabulary** — reuses the m2 serve/breach transition helpers. |
| `link-budget.ts` | The physics: elevation gate + inverse-square budget + line-of-sight on the spinning frame. The `*_term` truth functions (latency, congestion; `instability` present but zero-weighted). | **New**, reusing `coverage/field.ts` **formulas** (elevation `sin(el)=normal·dirToAsset≥SIN_MIN_ELEVATION`, inverse-square `received=eirp·(REF/d)²≥1`) with `net/`-local constants. **Replaces** `a1/reachability.ts`'s bent-pipe leg helpers as a generic edge predicate. |
| `router.ts` | The §7 solver: line-of-sight adjacency over `{sats, groundNets}` at `t`, shortest path by `link_cost`, re-solved on topology-change events. Returns `{served, path, latencyS, bindingConstraint, losses}` per contract. Trivial path-existence Act 1 → reactive latency+congestion blend by Act 3, `w_stab=0`. | **New.** **Subsumes** `a1/reachability.ts`. |
| `trace.ts` | The self-diagnosing view (M1 necessity): `diagnose(solverResult) → Shortfall` — the binding constraint + kind-of-fix + the **predictability seed** (every link loss stamped with geometric cause + time). | **New.** |
| `fault.ts` | The fault spectrum: `Degradation | TransientOutage | Telegraphed | HardFailure`; causal (player-raised probability) + rare-random (irreducible floor), both off a seeded splitmix64 stream. Absent Acts 1–2; mild-first Act 3b. | **New.** |
| `session.ts` | `NetSession` — the live mutable world: roster + contracts + wallet + RNG + faults + scenario cursor; `step(eph, t, dt)` (serve/breach + scenario gate + faults + escalation) + `snapshot()` for the fold. Mirrors the `BuildSession` live==replay shape. | **New** (pattern from `m2/session.ts`). |
| `apply-action.ts` | The shared applier `applyNetAction(eph, session, action, dt) → result \| null` — the SAME path live and replay use. | **New** (pattern from `m2/apply-build-action.ts`). |
| `scenario.ts` | The **state-gating engine** (§3): the authored arrival sequence as a pure data table + a deterministic gate evaluator. The ONLY scripted layer. | **New.** |

### Migrate vs drop, explicitly

- **Migrate (unchanged behavior):** `frame-a1.ts → frame.ts`, `world-a1.ts → world.ts`, `sat.ts → sat.ts` (minus `A1_DISH_EIRP`), the geometry half of `region.ts → endpoint.ts`. Carry their tests (`frame.test.ts`, `pacing.test.ts`, `region.test.ts`, `purity.test.ts`) into `src/sim/net/`, re-pointing imports.
- **DROP / REWORK (the contraption trap, confirmed in code):**
  - `a1/reachability.ts` — the bent-pipe REGION→SAT→GROUND stub (`pointReachable`, `legDistanceIfClosed`, `bestEirp`, `A1_MIN_ELEVATION_RAD=20°`, `A1_REF_LINK_DISTANCE_M=(a−R)·1.15`). Its own header says "When the §7 routing solver lands it subsumes this." → **replaced** by `router.ts` + `link-budget.ts`. Keep `reachability.test.ts` / `reachability.winnable.test.ts` **philosophy** (winnable-by-default) but retarget at the router, and **strengthen the assertion** (see §5 + A1).
  - The **co-located ground station** (`A1Ground`, lat-28 same-meridian, `region.ts:70`) → rework into `GroundNet` as a real ground-network endpoint.
  - The **EIRP-clip forced imperfection**: `A1_DISH_EIRP=1.1` (`sat.ts:52`), `A1_MIN_ELEVATION_RAD=20°` chosen so the lat-30 poleward edge clips (`reachability.ts:49`), and `windowCoverage.minFraction=0.802` / `A1_AVAILABILITY_BAR` (`region.ts:159`). **Act 1 has NO forced imperfection.** The link budget stays real; Act-1 geometry is chosen so the default GEO simply covers the **whole** region disc (binary SERVED) — re-derived and pinned in §5 + A1.
  - Any **throwaway golden** for the slice — the new game gets its **own** session + **own** golden (§4).

---

## 2. THE REAL SYSTEMS + INTERFACES (designed to generalize across all four acts)

### 2.1 Satellite / orbit / antenna model (migrated, unchanged)

- **Frame (`frame.ts`):** Earth spins +Z, θ(t)=ω·t. Surface points (regions, ground nets) ride the spin via `surfacePointInertial`; **orbits stay inertial and unforked** (`solveOrbit` from `m2/orbit.ts`). Locked invariant.
- **Pacing (`world.ts`):** `A1_BODY_RADIUS_M=300_000`, `GEO_PERIOD_S=240`, `LEO_PERIOD_S=150`, semi-major from the **unforked `EARTH_MU`**, so `A1_EARTH_OMEGA_RAD_PER_S == √(μ/a³)` bit-equal (pinned by `pacing.test.ts`; body-fixed GEO spread ~1.5e-13° over a period). GEO parks; LEO sweeps the full 358° of body-fixed longitude. Toy scales are explicit Act-1 toys; the **ratio** is the faithful part.
- **Sat atom (`sat.ts`):** `NetSat { id, orbit: SatOrbit, bus: BusTier, loadout: AntennaSpec[] }`. `SatOrbit` is the m2 type as-is (`parentId, aM, e, incRad, raanRad, argpRad, m0Rad, epochS, muParent`), so a launched net-sat propagates bit-identically to m2/ephemeris. **Generalizes:** more bus tiers / antenna types / slot classes drop in as enum members + loadout entries; frame + pacing never change.

### 2.2 Connectivity/coverage model + the contract — REUSE DECISION (resolves med-issue "contract drift")

**Decision: the `net/` Contract is a fresh region-disc struct, but it shares `m2/contracts.ts`'s state-machine vocabulary AND lifts its serve/breach transition helpers. No silent duplicate.**

Rationale, pinned in `docs/decisions.md`:
- **Why a fresh struct (not the m2 Contract):** `m2/contracts.ts`'s `Contract` is **grid-cell-coupled** — its region is `cellIds: number[]` resolved against the `GeodesicGrid`, and its served fraction is `coverageDimsAt` over those cells. M1 `net/` demand is **region/point** per spec §4 (a body-fixed geodesic disc sampled by Fibonacci, served via the router's path-existence over the spinning frame). A grid-cell contract cannot express a router path-existence result without dragging the whole `GeodesicGrid` coupling into the new game. The fresh region-disc endpoint is therefore justified, not a contraption.
- **Why it is NOT a drift hazard:** the `net/` Contract reuses the m2 **state machine and field names verbatim**, and **imports the m2 transition helpers** so there is ONE breach-grace convention in the codebase:
  - State machine: the same `"offered" | "active" | "completed" | "failed"` (`ContractState`).
  - Field names identical: `servedSecondsAccum`, `breachSecondsAccum`, `lastServedFraction`, `earnedEur`, `termSeconds`, `state`.
  - **Shared transition helpers:** `net/session.step` calls the existing `stepActiveContract(contract, servedFraction, dtSeconds, nowS)` and `stepOfferedContract(contract, nowS)` from `m2/contracts.ts`, and the single `BREACH_GRACE_SECONDS=600.0` constant. These helpers are **axis-agnostic** — they advance a contract from a scalar `servedFraction` ∈ [0,1] and a dt; they do not know about grid cells. The `net/` session computes that `servedFraction` from the router instead of from `coverageDimsAt`, and passes it in. **One state machine, one grace, two demand geometries.**
  - **The one extension `net/` needs:** the m2 `QualityAxis` enum is single-valued (`"connectivity"`). `net/` adds the multi-axis mask on its own struct (below). The m2 enum comment already says it "keeps the door open for bandwidth/latency-threshold contracts later without reshaping the model" — `net/`'s `SlaAxis` is that door, opened, without touching the m2 file.

```ts
// net/contract.ts
import type { ContractState } from "../m2/contracts";   // SHARED state vocabulary
// serve/breach transitions: stepActiveContract / stepOfferedContract / BREACH_GRACE_SECONDS
// are imported by net/session.ts from "../m2/contracts" — ONE convention, not two.

// Fixed integer ordinal per axis — used for the deterministic fold (resolves the
// low-severity fold-ordering issue). NEVER reorder; the golden depends on these.
export const SLA_AXIS_ORDINAL = { connectivity: 0, availability: 1, latency: 2, bandwidth: 3 } as const;
export type SlaAxis = keyof typeof SLA_AXIS_ORDINAL;

export interface Contract {
  id: string;
  label: string;
  region: Region;          // endpoint geometry (body-fixed disc) — NOT grid cells
  // --- ALL THREE QUANTITATIVE AXES PRESENT IN THE STRUCT (Act 1 HIDES them) ---
  slaAvail: number;        // min fraction of time served (0..1)
  slaLatencyS: number;     // max one-way latency (seconds)
  slaBandwidth: number;    // min per-user bandwidth (units)
  offeredLoad: number;     // time-varying demand (drives oversubscription in Act 3)
  // --- THE GATE MASK: which axes the serve/breach evaluator ENFORCES this act ---
  activeAxes: ReadonlySet<SlaAxis>;   // Act1 {connectivity}; Act2 +availability; Act3 +latency,+bandwidth
  // --- the router surface (§7.2/§7.3): per-contract prefer weights ---
  prefer: { lat: number; bw: number; stab: number };   // stab present, w_stab dormant in M1
  payPerSecond: number;
  penaltyPerSecond: number;
  // --- SHARED state-machine fields (same names as m2/contracts.ts) ---
  state: ContractState;
  termSeconds: number;
  servedSecondsAccum: number;
  breachSecondsAccum: number;
  lastServedFraction: number;
  earnedEur: number;
}
```

- **Serve/breach (`session.step`)**: every tick, the session asks `router.solve(contract, t)` for a path satisfying **every axis in `activeAxes` simultaneously**, derives a scalar `servedFraction` (Act 1: 1.0 if served else 0.0; Acts 2–3: the same `coveredFraction` callback machinery measures held-fraction across the hand-off cycle), then calls the **shared** `stepActiveContract(...)`. The avail/latency/bandwidth fields are present but, in Act 1, **not displayed and not evaluated** (the UI reads `activeAxes` to decide what to show). Adding an axis in Act 2/3 is a one-line mask change in the scenario table — **no struct change, no solver change, no second state machine.**
- **Escalation engine** (`offeredLoad` rising where served) is a session-step law present from day one but **only the scenario gates it on** in Act 3a.

### 2.3 The launch planner (consequence-preview; presets-as-floor, params-as-ceiling)

The planner is **pure** and produces a `SatOrbit` (+ cost) from a draft; it never mutates the world — the player commits via a `launch` action. Previews are computed by the **same** `router`/`link-budget` the live world uses, so the preview is truthful.

```ts
// net/world.ts (planner side)
export interface LaunchDraft { semiMajorM: number; incRad: number; subLonRad: number; loadout: AntennaSpec[]; count: number; }
export interface Preset { id: string; label: string; draft: LaunchDraft; costBaseEur: number; }
export function resolveOrbit(d: LaunchDraft, t: number): SatOrbit;   // epoch-correct m0 = subLon + ω·t
export function launchCost(d: LaunchDraft): number;
// preview (consequence before commit): footprint + ground track + period + latency floor + coverage gap
export function previewLaunch(eph, session, draft, t): LaunchPreview;  // uses router + link-budget
```

- **Floor = presets** ("GEO PARK", "LEO SWEEP", later "Molniya", "MEO relay"). **Ceiling = drag** altitude + inclination (the two first-exposed params) → RAAN/phase later.
- **The locked design rule (§3.2 mechanics):** truthful predictable consequences before commit; the assist gives a **viable-but-imperfect** start, never optimal; failure always reachable. Act 1 pre-seeds a default that **already mostly works**; the assist is most helpful here and gets less hand-holding every act.
- **Batch verb** (`launch N sats into a plane`) is the same action with a `count` payload (1 in Act 1); introduced in Act 2 as "a constellation is one launch."

### 2.4 The routing solver (§7 M1-scope) + per-contract weight + trace + predictability seed

```ts
// net/router.ts
export interface LinkLossStamp { aId: string; bId: string; cause: "set_below_horizon"|"out_of_budget"|"fault"; atS: number; }
export interface SolveResult {
  served: boolean;
  path: string[] | null;          // node ids region→…→groundNet
  latencyS: number;               // realized one-way latency (truth)
  bindingConstraint: SlaAxis|null;// which active axis fails (feeds trace)
  losses: LinkLossStamp[];        // the PREDICTABILITY SEED
}
export function solve(eph, contract, sats, groundNets, t, faults): SolveResult;
```

- **Link cost (truth terms, design-surface weights):** `cost = w_lat(prefer)·latencyTerm + w_bw(prefer)·congestionTerm + w_stab(prefer)·instabilityTerm`. The `*_term`s are physics (latency = path length / `C_LIGHT`; congestion from `offeredLoad` vs link capacity; instability dormant). **M1: `w_stab=0`.**
- **Re-solve on topology-change events**, NOT a full Dijkstra every tick (resolves the low-severity re-solve issue):
  - The **event set** that triggers a full path re-solve is: a launch/commit, a fault state change, a demand/escalation change, **AND a horizon rise/set** (a node crossing an endpoint's elevation gate). The horizon event is essential: even the parked equatorial GEO's geometry is technically t-dependent (the region rides θ(t)), but for a perfectly parked GEO the relative geometry is time-invariant, so it produces **no** horizon event and re-solves only on the launch. A **non-covering LEO** (the Act-1 fallback case) **sets continuously**, which IS a per-tick horizon event — so the cached path is invalidated and re-solves to UNSERVED, and the gentle shortfall fires. Without horizon events in the trigger set the LEO-SWEEP fallback would never re-solve and the assist would never appear.
  - **Cheapest correct M1 form (document this split):** each tick, cheaply **re-evaluate the cached path's link predicates** (each link's elevation+budget+LoS — O(sats), trivial in Act 1) to set `served`/`breach`; only **re-run the shortest-path search** on a discrete topology change in the event set above. So serve/breach is per-tick-truthful; Dijkstra is event-driven.
- **Growth, no rework:**
  - **Act 1:** one parked GEO ↔ one region ↔ one ground net → trivial path-existence. Degenerate but the **real** solver.
  - **Act 2:** adjacency "breathes" as LEO sats rise/set; paths form/break/re-form; availability-class routing reacts.
  - **Act 3:** latency + congestion both bite; first per-contract `prefer` override by exception; over/under-provisioned links surface.
- **Trace (`trace.ts`)** converts "solver says no" → "I launch *that*": availability breaks N min/orbit (need ≥1 more sat in this plane) / latency floor too high (a GEO relay at [point] cuts it) / bandwidth saturated (add a parallel path). Same view shows fault state. Carries the predictability seed (`link X↔Y lost: Y set below horizon at 14:32`). **Act 1 face:** only the gentle "footprint does not reach [region]; try this preset" — without doing it for the player.

### 2.5 The fault spectrum (`fault.ts`)

- Spectrum mild→severe: `Degradation` (recoverable, unwarned), `TransientOutage` (brief reroute), `Telegraphed` (warning + countdown), `HardFailure` (permanent; rare/late-M1). Two mechanics, two jobs: **causal** (probability raised by overclock/cheap-bus/low-orbit/age) + **rare-random** (irreducible floor). Chaos kitten, not monkey. Rides the diagnostic view — no separate UI.
- **Both draws come off a seeded splitmix64 stream owned by `NetSession`** (replay-safe, exactly the M2 launch-failure-roll pattern). **Absent Acts 1–2** (the scenario keeps the fault generator disabled); **mild-first in Act 3b** (a degradation, then a telegraphed failure), **fenced behind 3a re-stabilization** (§3). Rates/timing are PLAYTEST KNOBs.

### 2.6 The self-diagnosing diagnostic / trace view

`trace.ts` is the live face of the solver across all acts (Act 1 gentle assist → Act 3 optimizer pull). It must **log truthfully from day one** (the full achievable-optimum parse is M2+). It is the single surface for shortfalls **and** fault state.

---

## 3. THE STATE-GATING ENGINE (`scenario.ts`)

The only authored layer: a **pure data table + a deterministic gate evaluator** on top of the real systems. It **withholds** the next contract/fault until the current concept is **demonstrated**. State-gated, **not clock-timed** (a clock-timed tutorial fires whether the player is ready or not). The `~minutes` are loose orientation, not triggers.

```ts
// net/scenario.ts
export interface Beat {
  id: string;                                   // "act1","act2","act3a","act3b","act4"
  emit: (session: NetSession, t: number) => void;   // the AUTHORED arrival: add a contract / flip a mask / enable a fault gen
  gate: (session: NetSession, t: number) => boolean;// the COMPLETION PREDICATE (concept FELT) → opens the next beat
  fallback?: (session: NetSession, t: number) => Shortfall | null; // failure-to-progress assist (state-gated)
}
export const M1_SCENARIO: Beat[] = [ /* act1, act2, act3a, act3b, act4 */ ];
```

`NetSession.step` advances a **`scenarioCursor` integer**: it calls `gate()` for the current beat each tick; when `gate()` first returns true it records the gate tick, advances the cursor, and calls the next beat's `emit()` **deterministically inside step** (so it is in the fold and replays bit-identically). `emit()` only **adds demand / flips an `activeAxes` mask / enables the fault generator** — it never touches the solver/physics. **Only the arrival order is scripted; the systems run for real.**

### 3a and 3b are SEPARATE cursor beats (resolves the med-issue "beat granularity")

The escalation theme (3a) and the fault theme (3b) are **distinct `scenarioCursor` entries that emit in sequence**, so faults are fenced behind escalation re-stabilization (onboarding line 108: faults begin "not before" re-stabilization, "because faults on an unstable network would just be noise"). The shared **act3** human-acceptance gate (one theme, "mastery under pressure") is the *conjunction* of 3a and 3b having been demonstrated; internally the cursor still steps 3a → 3b.

### Per-act gates (the completion predicates, quoted intent)

| Beat | The ONE concept | `emit()` | `gate()` predicate (concept FELT) → opens | `fallback()` |
|---|---|---|---|---|
| **act1** | "I launch sats; they connect regions to ground." | one equatorial latency-tolerant connectivity-only contract; `activeAxes={connectivity}`; avail/lat/bw HIDDEN. | **one contract `served` AND revenue positive (€ rising).** → act2 | if no launch within a generous idle window OR a non-covering orbit: gentle "footprint does not reach [region]; try this preset" — point at the fix, don't do it. |
| **act2** | "Coverage is maintained, not placed — you need a constellation." | second contract unsolvable by Act-1's method (high-lat **or** ≥99% avail); **`availability` axis now active + visible.** | **a region held under continuous coverage via a constellation (≥2 sats handing off), SERVED across ≥1 full hand-off cycle without breach.** → act3a | wrong-orbit/co-phasing: escalate specificity ("coverage gap at [time-in-orbit]; sats co-phased — spread phase / add one here"). Over-build still completes; waste silently logged for Act 3. |
| **act3a** | "Your own success congests it." (escalation) | turn ON the escalation law (`offeredLoad` grows where served) and/or a third corridor contract; **`latency` then `bandwidth` axes activate one at a time.** | **escalation re-tamed: a previously-served contract dipped near-breach under risen `offeredLoad`, then returned to SERVED (a parallel path / `prefer` override relieved it).** → act3b | latency/bandwidth assist: trace surfaces the sharing problem ("link [X↔Y] saturated; add a parallel path / prefer-bw on this contract"). |
| **act3b** | "And faults degrade it." (mild-first; ONLY after 3a re-tamed) | enable the fault generator: a `Degradation`, then a `Telegraphed` failure. | **weathered ≥1 fault while keeping contracts served (or recovering), AND the trace surfaced ≥1 optimization/resilience shortfall.** → act4. Richest signal: player adds redundancy *before* forced. | if drowning: ease fault rate; trace gets directive ("no redundant path to [region]; one more sat here covers the fault window"). Forgiving on execution. |
| **act4** | "Distance changes everything." (FENCED, by sight) | Mars opportunity; first signal crawls (8–40 min RTT via `delay.ts` on the router latency term); data stamped "as of 8m ago"; one cache breadcrumb; one contract that pays less for stale data. | **NO gate — a read, not a gate.** Stops on a deliberate "to be continued." | N/A (only "failure" read is *bounce* — human gate Layer 2). |

Determinism: every `emit`/`gate` transition is a pure function of `(session state, t)`, evaluated inside `step`, recorded in the cursor → **replay-safe**. The two-layer human gate (≥5 cold testers; Layer 1 = finishes wanting to do it *better*; Layer 2 = leans into Mars) is the acceptance test, run after the build.

---

## 4. DETERMINISM + GOLDEN

- **One M1 session, its own seed, its own golden.** `NetSession` carries a splitmix64 seeded from a **new** session seed (propose `4242424242424242n`; the *golden* hash is bootstrapped by running the replay once, then pinned in `src/sim/net-replay.test.ts`). **The two existing goldens are untouched:** `544847093270497462n` (`src/sim/m1-session-replay.test.ts`, old cache economy) and `8431658617016421069n` (`src/sim/m2-build-replay.test.ts`, M2 build — already re-pinned once at M3a from `6225853297339560787n`, so the "re-pin per phase with a documented old→new note" pattern is real). The new game imports neither `m1/` nor `m2/session.ts`.
- **Action kinds (record/replay boundary).** Add to `src/sim/action.ts`, mirroring the existing `launchSat`/`acceptContract` constructors and snake_case wire keys (`kind`/`at_tick`/`payload`):
  - `KIND_NET_LAUNCH = "net_launch"` — payload `{ presetId?: string, semiMajorM, incRad, subLonRad, count }`. **Planner params are radians + SI metres on the wire** (inclination/sub-longitude in radians, semi-major in metres), so the boundary is unit-exact and the epoch-correct `m0 = subLon + ω·atTick·DT` is recomputed at apply time. `count` is the batch size (1 in Act 1).
  - `KIND_NET_ACCEPT = "net_accept"` — payload `{ contractId }`.
  - `KIND_NET_SET_PREFER = "net_set_prefer"` — payload `{ contractId, lat, bw, stab }` (the per-contract weight, first used Act 3). Plain numbers.
  - (Faults need **no** action — derived in `step` off the seeded stream, exactly like the M2 launch-failure roll and offer generator.)
- **Apply order (live == replay), identical to `m2-build-replay.test.ts` and `main.ts:564`:** each tick run `session.step(eph, t, dt)` **first** (serve/breach + scenario gate + fault rolls + escalation), **then** apply any action recorded at that tick post-step via `applyNetAction`.
- **State-hash fold (`net-replay.test.ts`)** using the existing `mixInt/mixFloat/mixString` primitives (`state-hash.ts:53/66/82`). Fold everything that can change an outcome:
  - wallet balance; RNG state; `scenarioCursor` + the recorded gate-tick stamps; the fault-generator cursor + active faults.
  - roster: each sat's full `SatOrbit` fields + loadout EIRPs.
  - each contract: `state`, `servedSecondsAccum`, `breachSecondsAccum`, `lastServedFraction`, `earnedEur`, `offeredLoad`, and **`activeAxes` folded by FIXED INTEGER ORDINAL** (resolves the low-severity fold-ordering issue): iterate `SLA_AXIS_ORDINAL` ascending (connectivity=0, availability=1, latency=2, bandwidth=3) and `mixInt` the ordinal of each present axis — **never** Set iteration order, **never** string sort of mutable labels. Pin this in a comment next to the fold.
- **Purity discipline:** carry `a1/purity.test.ts` into `src/sim/net/purity.test.ts`, scanning every new source via `?raw` for `three`/`document`/`window`/`Date.now`/`performance.now`/`new Date`/`Math.random`. The seeded splitmix64 is the only randomness.

---

## 5. THE ACT 1 SLICE, PRECISELY (on the real systems; WINNABLE BY DEFAULT, NO forced imperfection)

- **Cold open:** the player opens to the orrery with **one thing lit** — `INBOUND CONTRACT — [Region: equatorial, latency-tolerant]` over one highlighted region; everything else quiet/dimmed. The contract struct has all three axes but `activeAxes={connectivity}`, so the UI reads the mask and **hides** avail/latency/bandwidth. Binary `SERVED`/`UNSERVED`.
- **The default that already mostly works:** the planner opens pre-seeded to the **GEO PARK** preset — an equatorial GEO (`incRad=0`, `semiMajorM=A1_GEO_SEMI_MAJOR_M`, `subLonRad` over the region's meridian). Because GEO period == rotation period, it **parks** over the region. Winnable by pressing LAUNCH on the default.

- **THE ACT-1 GEOMETRY MUST-FIX (resolves the HIGH-severity issue) — re-derive and pin "the WHOLE disc is served at eirp 1.0, no clip":**
  - Drop the inherited clip tuning. Specifically **delete** from the migration: `A1_DISH_EIRP=1.1`, `A1_AVAILABILITY_BAR`, `windowCoverage`/`minFraction`/`meanFraction`, and the `20°` `A1_MIN_ELEVATION_RAD`. Do **not** reuse the lat-30 region, the 20° mask, or the `(a−R)·1.15` reference distance on a re-centered region — those were deliberately tuned so only the **centre** reaches at eirp 1.0 and the poleward **edge** clips (confirmed: `reachability.winnable.test.ts:61-68` only proves the centre, and `region.test.ts:44` pins lat-30 with a 10° radius).
  - **Re-center equatorial and choose covering constants.** Pick the Act-1 region center at **lat 0** (equatorial), choose a **region radius `NET_ACT1_REGION_RADIUS_RAD`** and an **elevation floor `NET_MIN_ELEVATION_RAD`** (default to `field.ts`'s real `MIN_ELEVATION_RAD = 5°` unless a derivation shows otherwise) and an antenna `eirp = 1.0` such that **every Fibonacci sample of the disc is reachable from the parked GEO with margin** — not just the centre. The parked equatorial GEO sits at the region's nadir, so the worst-case point is the disc edge; size the radius so the edge's slant range + elevation clear the budget and the gate **with headroom**.
  - **Pin it in the retargeted `reachability.winnable.test.ts`** as the explicit assertion **`coveredFraction(region, N, isCoveredAt) === 1.0`** at `eirp = 1.0` (the WHOLE disc served, no clip), plus a margin assertion (e.g. worst-sample elevation ≥ floor + a documented headroom, worst-sample received ≥ 1 + headroom) so a future constant nudge cannot silently re-introduce an edge clip. This is the single Act-1 gate that proves "no hidden partial-coverage forced-imperfection."

- **The loop:** LAUNCH → the sat appears in its parked GEO → `router.solve` finds the trivial path region→sat→groundNet → contract flips `UNSERVED→SERVED` (servedFraction 1.0 → shared `stepActiveContract`) → revenue ticks (`payPerSecond` accrues into the wallet every step while served). That is the entire Act-1 game.
- **Completion gate:** `gate(): one contract served AND balance rising (revenue positive)`. The moment the first contract is SERVED and €>0, Act 2 may open.
- **Gentle shortfall fallback (assist at its most helpful):** if the player launches a non-covering orbit (e.g. LEO SWEEP, which sets — re-solving to UNSERVED via the horizon-event trigger in §2.4) or idles past a generous window, `trace.diagnose` surfaces *"footprint does not reach [region]; try a lower inclination / this preset"* — pointing at the fix without doing it for them. The spinning Earth makes the parked equatorial GEO hold the region forever, so "place one thing works."
- **What must NOT exist in Act 1:** no forced imperfection, no motion-management, no relay/sat-to-sat, no coverage-fraction tuning, no faults, no second SLA axis, no throwaway golden.

---

## 6. VISUALIZATION FOR ACT 1 (make-or-break)

The render layer reads pure `NetSession` state; it never feeds back into the sim. Reuse `orrery/orrery.ts` + `orrery/coverage-overlay.ts` + the panels.

- **The spinning globe at the toy radius.** Add a **net render mode** to `orrery.ts` that applies the **Decision-G de-squash override scoped to net mode only** — the globe is sized to `A1_BODY_RADIUS_M` (300 km) with orbits fanned out to `A1_RENDER_BAND_M` (`world.ts` already exports `1.2·A1_GEO_SEMI_MAJOR_M`), and the de-squash `surfaceM` + billboard/shell radius are driven from `A1_BODY_RADIUS_M`, **not** from `eph.radiusMeters("earth")=6371 km` (or the three radii log-fold to sub-pixel). **M2/M3 visuals are untouched** (the override is gated behind the net-mode flag; the existing roster render path is unchanged). The globe rotates by `earthThetaAt(t)` so the parked GEO visibly holds station over the lit region.
- **The region lights up.** The highlighted region renders dim (UNSERVED) and lights to a "served" color the instant `router.solve` reports `served` — the single legible state change.
- **The footprint.** Before commit, the planner preview draws the GEO's footprint disc overlaid on the region (truthful consequence-preview, via `previewLaunch`); after launch, the live footprint sits parked over the region. The coverage-overlay heatmap is the existing component.
- **The launch→cover→paid causal chain (the make-or-break beat):** press LAUNCH → sat fades in at its parked GEO point → footprint disc snaps over the region → region lights SERVED → the finance panel ticks up. Three linked, immediate, causal events: *I placed one thing, it covers there, I'm paid.* That is competence, felt.

---

## 7. INCREMENTAL BUILD PLAN

Each increment is sized for one Build→Verify subagent, with its tests and acceptance. **Act-1-shippable** increments first (the smallest provable-fun slice), then Acts 2→3→4 as gated beats on the **same** systems.

### Phase A — shared systems + Act 1 (ALL Act-1-shippable)

**A0. Namespace + migrate atoms.** Create `src/sim/net/`; migrate `frame.ts`, `world.ts`, `sat.ts` (drop `A1_DISH_EIRP`) and the geometry half of `region.ts → endpoint.ts` (drop the co-located-ground + `windowCoverage`/`minFraction`/`A1_AVAILABILITY_BAR`). Carry `frame.test.ts`, `pacing.test.ts`, `region.test.ts`, `purity.test.ts`. **Re-center the Act-1 region to lat 0** and introduce `NET_ACT1_REGION_RADIUS_RAD` + `NET_MIN_ELEVATION_RAD` constants (the §5 must-fix prep). *(The `m1/`→`m1-economy/` rename is DEFERRED — not in this build.)*
- **Tests:** migrated physics-gates (frame ±1e-13, pacing ω==n bit-equal, Fibonacci band) + purity scan pass under `net/`.
- **Acceptance:** `npm test` green; the two existing goldens (`544847093270497462n`, `8431658617016421069n`) still pass byte-for-byte. *(Act-1-shippable.)*

**A1. Link budget + router (path-existence) + the WHOLE-DISC pin.** `link-budget.ts` (elevation + inverse-square + line-of-sight on the spinning frame, reusing `coverage/field.ts` formulas with `net/` constants) and `router.ts` `solve()` in its degenerate path-existence form (region→sat→groundNet), returning `{served, path, latencyS, bindingConstraint, losses}`. Implement the §2.4 re-solve split (per-tick cheap predicate re-eval incl. horizon rise/set; event-driven Dijkstra). Replaces `reachability.ts`.
- **Tests (physics-gate, the §5 HIGH must-fix):** retarget `reachability.winnable.test.ts` to assert **`coveredFraction === 1.0` at eirp 1.0** for the parked GEO over the equatorial region (WHOLE disc, no clip) + a worst-sample margin assertion; LEO-SWEEP single sat is **not** served (it sets) and a link-loss stamp records the geometric cause + time; the LEO non-cover re-solves to UNSERVED via the horizon event.
- **Acceptance:** parked GEO serves the whole disc with margin; sweeping LEO does not; the gentle-shortfall trigger fires. *(Act-1-shippable.)*

**A2. Contract + session + apply-action (SHARED state machine).** `contract.ts` (three axes + `activeAxes` mask + `prefer` + the shared field names + `SLA_AXIS_ORDINAL`); `session.ts` (`NetSession.step` computes `servedFraction` from the router and calls the **imported** `stepActiveContract`/`stepOfferedContract`/`BREACH_GRACE_SECONDS` from `m2/contracts.ts`; revenue accrual; `snapshot()`); `apply-action.ts`; the new action kinds in `action.ts` (`net_launch` radians/SI + `count`, `net_accept`, `net_set_prefer`). **Write the contract-reuse decision into `docs/decisions.md`** (§2.2 rationale).
- **Tests:** serve/breach toggles on coverage via the shared helper; revenue accrues while served; DT-invariant revenue (1× vs coarse dt) like the M2 test; `applyNetAction` no-ops on unknown kind; one assertion that the breach-grace constant is the shared `BREACH_GRACE_SECONDS` (not a `net/` copy).
- **Acceptance:** accept→serve→€ loop closes in-session on ONE state machine. *(Act-1-shippable.)*

**A3. Scenario engine + Act-1 beat + the M1 golden.** `scenario.ts` with the `act1` beat (`emit` one connectivity-only contract; `gate` = served + €>0; `fallback` gentle correction) and the cursor wired into `step` (with separate `act3a`/`act3b` placeholders in the table so the granularity is structural from the start). Create `src/sim/net-replay.test.ts` with seed `4242424242424242n`, the state-hash fold (incl. the fixed-ordinal `activeAxes` fold), and the **pinned golden**.
- **Tests (golden + determinism):** replay-twice bit-identical; live==replay; SaveGame JSON round-trip reproduces the hash; the Act-1 gate fires deterministically at the right tick; the two old goldens untouched.
- **Acceptance:** golden pinned; Act-1 scenario deterministic end-to-end. *(Act-1-shippable.)*

**A4. Act-1 planner + visualization.** `previewLaunch` (footprint/track/period/latency preview via the router); orrery **net render mode** with the scoped Decision-G de-squash; region light-up; launch→cover→paid chain; finance panel tick.
- **Tests:** planner preview matches post-launch solve (consequence-preview is truthful); a render-mode unit check that net mode does not alter M2/M3 sizing.
- **Acceptance (human, Act-1 gate Layer 1 in miniature):** a cold tester presses the default LAUNCH and is paid within the idle window; the causal chain reads. **This is the smallest provable-fun slice — Act 1 ships here.**

### Phase B — Act 2 (gated beat on the same systems; NOT Act-1-shippable)

**B1. Constellation routing + availability axis.** Extend `router.solve` to multi-sat hand-off (adjacency breathes as LEO sats rise/set; re-solve on the §2.4 topology events). Add the `act2` beat: `emit` the second contract with `availability` added to `activeAxes` (now visible); `gate` = continuous coverage via ≥2 sats across ≥1 hand-off cycle; `fallback` = co-phasing specificity. Constellation-phasing assist in the planner (viable-but-imperfect). Batch `count>1` launch.
- **Tests:** availability sawtooth on a single LEO; flattens to continuous SERVED with a phased pair; gate fires on a clean hand-off cycle; golden **re-pinned** (Act-2 demand now in the fold) with a documented old→new note (the M3a pattern).
- **Acceptance:** the sawtooth→flat "motion tamed" payoff is real and deterministic.

### Phase C — Act 3 (TWO gated beats; NOT Act-1-shippable)

**C1. Escalation + latency/bandwidth axes + per-contract weight (act3a).** Turn on the escalation law (`offeredLoad` grows where served; optional third corridor contract); activate `latency` then `bandwidth` one at a time; congestion term active in `link_cost`; first `net_set_prefer` override by exception; trace surfaces sharing problems. `act3a.gate` = a previously-served contract dipped near-breach under risen load then returned to SERVED (escalation re-tamed).
- **Tests:** oversubscription tips a contract near-breach; a parallel path / prefer override relieves it; the tame→outgrow→re-tame cycle fires `act3a.gate`; golden re-pinned.
- **Acceptance:** the optimizer pull is legible; the per-contract weight visibly changes routing.

**C2. Fault spectrum, mild-first (act3b), fenced behind act3a.** `fault.ts` causal + rare-random off the seeded stream; **`act3b.emit` enables the fault generator ONLY after `act3a.gate` fired** (a `Degradation` then a `Telegraphed` failure); trace shows fault state + redundancy shortfalls; drowning-fallback eases rate.
- **Tests:** fault rolls deterministic on replay (the M2 launch-failure pattern); the fault generator is provably disabled until the `act3b` cursor entry (assert no fault before `act3a.gate`); a redundant builder sails through the telegraphed failure, a brittle one breaches; `act3b.gate` = weathered ≥1 fault + ≥1 surfaced shortfall; golden re-pinned.
- **Acceptance:** chaos-kitten, mild-first, fair; resilience becomes visible and tested.

### Phase D — Act 4 (fenced, by sight; NOT Act-1-shippable)

**D1. The Mars vertigo read.** Scenario emits the Mars opportunity; the launch the player always does; the signal crawls (light-delay applied to the router latency term at interplanetary distance — reuse `src/sim/delay.ts`); data stamped "as of 8m ago"; one cache breadcrumb; one contract that pays less for stale data. **NOT** prefetch/coherence/freshness-economy/parse. No completion gate — stops on "to be continued."
- **Tests:** the latency term explodes at Mars distance deterministically; no Earth gauge ever shows freshness; replay stable.
- **Acceptance (human, two-layer gate, ≥5 cold testers):** Layer 1 — finishes Act 3 *wanting to do it better*; Layer 2 — leans into Mars. Both must pass before M2.

---

### Key generalization guarantees (why there is no rework)

1. The **contract struct carries all three axes from day one**; acts only flip the `activeAxes` mask — no struct/solver change to add an axis.
2. The **net/ contract shares the m2 state machine** (same field names, the imported `stepActiveContract`/`stepOfferedContract`, the single `BREACH_GRACE_SECONDS`) — ONE breach convention, two demand geometries, no divergent drift.
3. The **router is the real solver in Act 1's degenerate case**; Acts 2–3 extend `solve` (multi-hop, congestion, weight) without changing its signature or callers; the re-solve event set already includes horizon rise/set.
4. **Faults are derived in `step` off a seeded stream** (no new action) and **fenced behind act3a** as a distinct cursor beat — enabling them is a scenario flag, gated on re-stabilization.
5. The **scenario engine touches only demand/mask/fault-enable**, never physics — "only the arrival order is scripted."
6. **One golden, re-pinned per phase** with a documented old→new note (the M3a precedent); the two existing goldens are never touched; `activeAxes` is folded by a fixed integer ordinal so a future axis rename can never shift the hash.

**Relevant files (absolute):** new game root `/home/basov/Games/signal-horizon/src/sim/net/`; migrate from `/home/basov/Games/signal-horizon/src/sim/a1/frame-a1.ts`, `.../a1/world-a1.ts`, `.../a1/sat.ts`, `.../a1/region.ts`; drop/rework `/home/basov/Games/signal-horizon/src/sim/a1/reachability.ts`; shared contract helpers `/home/basov/Games/signal-horizon/src/sim/m2/contracts.ts` (`stepActiveContract`/`stepOfferedContract`/`BREACH_GRACE_SECONDS`); link-budget formulas `/home/basov/Games/signal-horizon/src/sim/coverage/field.ts`; light-delay `/home/basov/Games/signal-horizon/src/sim/delay.ts`; new golden test `/home/basov/Games/signal-horizon/src/sim/net-replay.test.ts`; action kinds `/home/basov/Games/signal-horizon/src/sim/action.ts`; render mode `/home/basov/Games/signal-horizon/src/orrery/orrery.ts`; patterns from `/home/basov/Games/signal-horizon/src/sim/m2/session.ts`, `.../m2/apply-build-action.ts`, `.../m2-build-replay.test.ts`; decisions log `/home/basov/Games/signal-horizon/docs/decisions.md`. Untouched goldens: `544847093270497462n` (`/home/basov/Games/signal-horizon/src/sim/m1-session-replay.test.ts`), `8431658617016421069n` (`/home/basov/Games/signal-horizon/src/sim/m2-build-replay.test.ts`).
