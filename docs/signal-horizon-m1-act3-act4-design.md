# SIGNAL HORIZON — M1 Acts 3 & 4: build-ready designs

> Companion to `signal-horizon-m1-design.md` (M1 as one game). Produced + adversarially verified read-only while Phase B (Act 2) built. Build C (Act 3) then D (Act 4) on the net/ systems after Act 2 lands + is golden-re-pinned. The two existing goldens stay untouched; the net golden re-pins per phase.

---

## ACT 3 — strain + faults (mastery-under-pressure)

All critique facts are confirmed against the real code:

1. `stepActiveContract` (contracts.ts:266-270): `servedFraction>0` ⇒ `breachSecondsAccum=0`. Pro-rata fraction can never accumulate breach. **HIGH issue 1 confirmed.**
2. `solve` returns the **first** bridging sat (router.ts:196-213) — no min-cost, no `prefer`, no `slaLatencyS`, no `loadBySat`. `RoutableContract` is `{id, region, activeAxes?}` (router.ts:79-83). **MED issue confirmed.**
3. `servedFractionFor` calls `resolveTick(eph, contract, satList, groundNets, t, prev)` — no faults, no loadBySat (session.ts:280). `topologyKey` = `contractId|satIds|faulted` — no demand/load (router.ts:251-258). **HIGH issue 2 confirmed.**
4. `NetSat` has `orbit: SatOrbit` (sat.ts:49); epoch is `sat.orbit.epochS`, not `sat.epochS`. **LOW issue confirmed.**

The critique is accurate on every load-bearing point. Here is the final, build-ready Act 3 design with all five issues resolved.

---

# SIGNAL HORIZON — Act 3 design (FINAL, build-ready): "It strains under success, and breaks under faults"

Mastery-under-pressure, two sub-beats, one theme. Grounded in onboarding Act 3 (lines 92-123) + mechanics §4.3/§4.4/§5/§7.2-7.5 + design §2.4/§2.5/§2.6/§3a/§3b. **Read-only design; no files written.** All paths absolute. This revision resolves the critique's two HIGH and three MED/LOW issues; every changed interface is verified against the BUILT code (router.ts:79-83, 171-258; session.ts:278-285; contracts.ts:259-283; sat.ts:46-52).

Act 3 fills the existing `act3a`/`act3b` scenario stubs and adds two standalone files (`fault.ts`, `trace.ts`). It does **not** reshape the `SolveResult` return `{served, path, latencyS, bindingConstraint, losses}` nor the four-tuple verdict. It DOES make four small **additive** interface extensions (all signature-stable on returns), each called out explicitly below because the critique caught the original design conflating the full `Contract` with the router's minimal `RoutableContract` and threading load through the wrong function.

---

## The two-line contract of Act 3 (what the player must FEEL)

- **3a — your success bites you.** A well-served region's `offeredLoad` rises (escalation, gated ON here), shared links ride near capacity, a peak tips a comfortable contract toward breach. The player re-engineers (parallel path, or `net_set_prefer` by exception) and re-tames. The `latency` then `bandwidth` axes activate one at a time — the GEO ceiling and the link-capacity limit, *felt*. The router's reactive cost-blend (`latency_term + congestion_term`, `w_stab` dormant) decides paths.
- **3b — faults degrade it (fenced structurally behind 3a's cursor gate).** Off the seeded splitmix64 the session already owns, a mild-first spectrum begins: a `Degradation`, then a `Telegraphed` failure. Causal probability (low-orbit / age live this hour; overclock / cheap-bus hooks present but neutral) plus a rare-random irreducible floor. The trace surfaces resilience shortfalls (overprovisioned links, SPOFs) and stamps every loss with cause + time (the predictability seed).

---

## The four ADDITIVE interface extensions (verified against BUILT code; resolves critique MED/HIGH-2)

These are the only interface changes. None reshapes a return type; all are backward-compatible so `previewLaunch`, the A1/A2 tests, and the cheap re-eval compile and behave identically when the new optionals are absent.

| # | File:loc | Extension | Why (critique) | Back-compat default |
|---|---|---|---|---|
| E1 | `router.ts:79-83` `RoutableContract` | add `prefer?: PreferWeights`, `slaLatencyS?: number` | MED: the blend reads `prefer.{lat,bw,stab}` + the latency-axis reads `slaLatencyS`, but `RoutableContract` carries only `{id,region,activeAxes?}`. The full `Contract` is a structural supertype and supplies them at runtime — but the TYPE must surface them. | absent ⇒ `prefer = NET_DEFAULT_PREFER`, `slaLatencyS = Infinity` ⇒ identical Act-1/2 routing |
| E2 | `router.ts:171` `solve(...)` | add ONE trailing optional `loadBySat?: ReadonlyMap<string, number>` | the congestion term needs the shared-load aggregate; `faults?` is already the last param, this sits after it. Return UNCHANGED. | absent ⇒ `congestion_term = 0` ⇒ pure latency routing |
| E3 | `router.ts:251` `topologyKey(...)` + `resolveTick(...)` | `topologyKey` folds a **congestion fingerprint**; `resolveTick` gains trailing optional `faults?` + `loadBySat?` and forwards them to `solve` | **HIGH-2:** the session calls `resolveTick` (session.ts:280), NOT `solve`; `resolveTick` re-solves only on a `topologyKey` change, and `topologyKey` (router.ts:251-258) ignores demand/load — so a rising `offeredLoad` produces NO re-solve. design §2.4 itself requires "a demand/escalation change triggers a re-solve." | absent ⇒ empty congestion contribution to the key ⇒ identical fingerprint to today |
| E4 | `contract.ts` (sat side) + `link-budget.ts` | add `NET_LINK_CAPACITY_UNITS` constant (per standard antenna; uniform in C1, bus-varied in C2) | capacity must live somewhere `congestion_term = load/capacity` can read it | n/a (new constant) |

**E3 detail — the congestion fingerprint (the HIGH-2 fix):** extend `topologyKey` to append a **quantized escalation epoch** rather than the raw float load (raw floats would re-solve every tick and defeat the cache). The session keeps a per-step integer `congestionEpoch` that increments whenever ANY contract's quantized `loadBySat` bucket changes OR a contract crosses the bandwidth-axis threshold. `topologyKey` becomes `${contract.id}|${satIds}|${faulted}|${congestionEpoch}`. A congestion change ⇒ epoch bumps ⇒ fingerprint changes ⇒ full re-solve through the cached path. This keeps the cheap-re-eval cache (it doesn't re-solve when load is static) while honoring design §2.4:144. `resolveTick` forwards `faults`/`loadBySat` to its internal `solve` call so the re-solve actually consumes them.

`PreferWeights` already exists on the BUILT `Contract` (contract.ts `prefer{lat,bw,stab}`, confirmed by critique against contract.ts:54-59); E1 imports that type into router.ts (or restates the structural shape) — no new type invented.

---

## What is INDEPENDENT / parallel-buildable vs. what EXTENDS shared files

| File | Status | Touches |
|---|---|---|
| `/home/basov/Games/signal-horizon/src/sim/net/fault.ts` | **NEW, standalone — PARALLEL** | Imports only `SimRng` type, `NetSat`, pure tuning constants. No reverse deps. |
| `/home/basov/Games/signal-horizon/src/sim/net/trace.ts` | **NEW, standalone — PARALLEL** | Imports `SolveResult`/`LinkLossStamp`/`PreferWeights` types, `Contract`, `NetSat`, and the `FaultState` **type** from fault.ts. Pure read-over-snapshot. |
| `/home/basov/Games/signal-horizon/src/sim/net/router.ts` | **EXTENDS** (shared) | E1+E2+E3: min-cost blend, `RoutableContract` widen, `solve`/`resolveTick`/`topologyKey` additive params + congestion fingerprint. Returns unchanged. |
| `/home/basov/Games/signal-horizon/src/sim/net/contract.ts` | **EXTENDS** (shared, additive) | E4 sat-side `linkCapacity`/constant + escalation tuning constants. No struct reshape. |
| `/home/basov/Games/signal-horizon/src/sim/net/session.ts` | **EXTENDS** (shared) | escalation tick, two-pass congestion aggregation + `congestionEpoch`, fault roll, new folded state. |
| `/home/basov/Games/signal-horizon/src/sim/net/scenario.ts` | **EXTENDS** (shared) | fill `act3a` + `act3b` emit/gate/fallback. |
| `/home/basov/Games/signal-horizon/src/sim/net-replay.test.ts` | **EXTENDS** (golden) | re-pin (two chained re-pins); add fold ADDITIONS (see golden section). |

**Parallelism note (unchanged, verified):** `fault.ts` and `trace.ts` share only the `FaultState` **type** (define in fault.ts, import the type into trace.ts) — no runtime edge. Build them in parallel in C2. The shared-file edits (router/session/scenario/contract) must serialize because they touch the step loop + golden: do C1 (3a) fully, re-pin, then C2 (3b), re-pin.

---

## C1 — Sub-beat 3A: escalation + oversubscription + latency-then-bandwidth axes + reactive cost-blend + first prefer-override

### C1.1 — The escalation law (`session.ts` extends; present-from-day-one, gated ON in 3a)

`Contract.offeredLoad` already exists and already folds. Escalation is a **pure, deterministic** growth of `offeredLoad` on contracts being served well, run in `step` only when `escalationOn` is true. `act3a.emit` flips the flag (it "enables a generator," never touches physics — the §3 emit contract).

Add to `NetSession`:
- `private escalationOn = false;` — folded as int 0/1; set true by `enableEscalation()`.
- In `step`, after serve/breach + revenue, a pure `stepEscalation(dt)`: for each `active` contract whose `lastServedFraction >= ESCALATION_SERVE_THRESHOLD` (= 1.0, served well), grow toward a ceiling:
  `offeredLoad = min(ESCALATION_LOAD_CEILING, offeredLoad + ESCALATION_RATE_PER_S * dt)`.
  Demand grows where you serve well (onboarding:99). DT-invariant (rate×dt, single clamp at the ceiling — mirrors the single-clamp discipline of commit `2fc0500`'s shock-compounding fence so coarse vs fine dt converge).

**Determinism:** pure function of `(servedFraction, offeredLoad, dt)` — no RNG. Folds via `offeredLoad` (already in `netStateHash`).

### C1.2 — Oversubscription / congestion (`contract.ts` + `router.ts` + `session.ts`) — REVISED per HIGH-1 + HIGH-2

Teaching target (mechanics §4.3): N contracts sharing M sats; a shared link rides near capacity; a peak tips a contract toward breach.

**Capacity (E4):** `NET_LINK_CAPACITY_UNITS` on the sat/antenna side (units matching `offeredLoad`). Uniform per standard antenna in C1; bus/overclock variation arrives in C2 (degradation haircut).

**The congestion term (cost-blend, §7.2):** the router currently returns the **first** bridging sat (verified router.ts:196-213). Extend `solve` to compute, over each candidate bridging sat, a **cost** and pick the **minimum** (still O(sats) — the degenerate-Dijkstra the header promises):

```
link_cost = w_lat·latency_term + w_bw·congestion_term + w_stab·instability_term
  latency_term     = up.latencyS + down.latencyS         (already computed in bridgeForPoint)
  congestion_term  = sharedLoadOnSat / linkCapacity      (∝ 1 / available bandwidth)
  instability_term = 0                                    (w_stab DORMANT — M1 LOCKED)
  w_lat = contract.prefer.lat,  w_bw = contract.prefer.bw,  w_stab = contract.prefer.stab
```
`prefer` + `slaLatencyS` are read off the E1-widened `RoutableContract` (defaulting when absent). `sharedLoadOnSat = loadBySat.get(satId) ?? 0` (E2). No `loadBySat` ⇒ term 0 ⇒ exact Act-1/2 routing. Return struct **unchanged**.

**THE SERVE VERDICT — binary on the bandwidth axis (resolves HIGH-1).** The original pro-rata `servedFraction = min(1, capacity/load) ∈ (0,1)` is **broken under the BUILT state machine**: `stepActiveContract` (contracts.ts:266-270, verified) resets `breachSecondsAccum=0` on ANY `servedFraction>0` and accumulates breach ONLY at `servedFraction==0`. A pro-rata fraction therefore never accrues breach, so oversubscription could never tip a contract near-breach and the C1.6 re-tame gate (keyed off `breachSecondsAccum`) could never fire. **Fix:** the bandwidth axis bites **binary, exactly like the latency axis** —
- when `activeAxes.has("bandwidth")` AND the bound sat is over capacity (`congestion_term >= 1`, i.e. `sharedLoadOnSat >= linkCapacity`): `served = false`, `bindingConstraint = "bandwidth"`, **servedFraction 0** for that contract. Now `breachSecondsAccum` accrues toward `BREACH_GRACE_SECONDS` and the re-tame is detectable through the UNCHANGED shared helper.
- The latency-axis bite is the same binary shape: `activeAxes.has("latency")` AND realized `latencyS > slaLatencyS` ⇒ `served=false`, `bindingConstraint="latency"`, fraction 0 (a GEO path at ~340 ms fails a low-latency SLA; a LEO/short-hop passes — the GEO ceiling, felt).

If a non-binary "near-breach" *readout* is wanted (for the trace's amber pulse), derive it from **`lastServedFraction < 1 held across N consecutive ticks** (a session-tracked counter), NOT from `breachSecondsAccum`. The design no longer claims any positive fraction accumulates breach.

**Who computes `loadBySat` — two-pass, replay-safe (resolves MED two-pass determinism):** the session, once per step, **fully recomputed from folded state** (no separate cached map that could desync across a restore):
1. **Pass A** — solve every active contract via `resolveTick` using the *prior tick's* `loadBySat` (rebuilt below) + the prior `congestionEpoch`. Record each contract's chosen sat into a `chosenSatByContract: Map<contractId, satId>`.
2. **Aggregate** — `loadBySat[satId] = Σ offeredLoad` over contracts whose chosen sat is `satId`. Bump `congestionEpoch` if any sat's quantized bucket changed (E3).
3. **Pass B** — derive each contract's served verdict (the truth this tick) from its `resolveTick` result under the freshly-bumped epoch; a contract bound to an over-capacity sat ⇒ binary-unserved on the bandwidth axis (above).

**Replay-safety (resolves the MED desync):** `loadBySat` and `chosenSatByContract` are **fully re-derivable each step from folded state** — `offeredLoad` (folded) + the prior-tick chosen-sat assignment. To make the chosen-sat assignment survive a restore boundary, **fold `chosenSatByContract`** (a small `contractId→satId` map, stamped into `netStateHash` as sorted `id|satId` pairs, and carried in `NetSnapshot`/`restore`). Then `loadBySat` is a pure function of folded state and need not itself fold (like `routerStates`). The one-tick lag (Pass A uses last tick's map) is deterministic and bounded. **Add an explicit restore-then-step == continuous-run assertion for `loadBySat` + the chosen-sat map.** Because `congestionEpoch` feeds `topologyKey` (E3), a load change forces the cached path to re-solve — closing the HIGH-2 gap that otherwise left the cached verdict stale on congestion.

### C1.3 — Latency then bandwidth, ONE AT A TIME (`scenario.ts` act3a.emit)

Per mechanics §4.4 + onboarding (axes "one at a time"), `act3a` does not flip both at once:
- **Latency arrives by an authored new contract.** `act3a.emit` adds `REGION-2`, a latency-critical corridor contract sharing the existing infrastructure corridor (onboarding:99), `activeAxes={connectivity,availability,latency}`, low `slaLatencyS`. Latency-tolerant GEO can't meet it ⇒ forces a shorter LEO route.
- **Bandwidth arrives by the escalation law crossing capacity.** A one-line deterministic mask add inside `stepEscalation` when a served contract's `offeredLoad` crosses `ESCALATION_BANDWIDTH_AXIS_THRESHOLD` ⇒ `contract.activeAxes = new Set([...contract.activeAxes, "bandwidth"])` (and bump `congestionEpoch`). Still "emit flips a mask," driven by the generator the emit enabled. Document in the act3a header: *latency = authored arrival; bandwidth = escalation-triggered mask flip, both deterministic in step.*

`act3a.emit(session, t)`:
- `session.enableEscalation()`.
- `session.addContract(offerNetContract("REGION-2", NET_ACT3_CORRIDOR_REGION, { activeAxes:{connectivity,availability,latency}, slaLatencyS: NET_ACT3_LOW_LATENCY_S, prefer: NET_DEFAULT_PREFER }))`.

### C1.4 — The first per-contract prefer-override, by exception (`net_set_prefer` — already wired)

No new action: `KIND_NET_SET_PREFER` + `netSetPrefer` + `applyNetAction`'s prefer branch + `NetSession.setPrefer` all exist and are A2-tested (verified by critique against action.ts / apply-action.ts:96-101 / session.ts:252). Act 3 is the **first scenario where the router consumes `prefer`** (because C1.2's blend reads `prefer.{lat,bw,stab}` off the E1-widened type). The player relieves congestion by launching a parallel path (a second corridor sat ⇒ `loadBySat` splits ⇒ both under capacity) OR `net_set_prefer(REGION-2, lat=high, bw=low)` to bias the latency-critical contract onto the short LEO route while the trunk takes the fat GEO path. Same physics, two paths by intent — the §7.3 first-tunable landing.

### C1.5 — The trace surfaces the sharing problem (`trace.ts` first face; full parse in C2.5)

For C1 the trace only needs the binding-constraint readout: reads `SolveResult.bindingConstraint` + the `loadBySat` aggregate and emits the §7.4 string *"link via [SAT-id] carries N contracts; combined peak exceeds capacity — add a parallel path or prefer-bw on [contract]."* This is the `Shortfall` shape already in scenario.ts (`{subjectId, message, suggestPresetId?}`), which trace.ts extends/owns (the scenario.ts header says so). `act3a.fallback` calls it.

### C1.6 — The 3a gate (the re-tame)

Onboarding:120 / design §3a: *a previously-served contract dipped near-breach under risen `offeredLoad`, then returned to SERVED.* Folded session state:
- A per-contract near-breach witness: set when a contract that was served crosses `breachSecondsAccum > NEAR_BREACH_GRACE_FRACTION * BREACH_GRACE_SECONDS` **while escalation is on** (it dipped near-breach under risen load — now reachable because C1.2 makes the bandwidth bite binary ⇒ `breachSecondsAccum` actually accrues), then a single session int `act3aReTameWitnessed` (0/1) set true the first tick such a contract is back to `lastServedFraction == 1.0` (re-tamed).
- `act3a.gate` returns `session.escalationReTamed()`.

State-gated (the *concept* is demonstrated), not clock-timed. `act3a.fallback` surfaces the sharing problem if the player sits near-breach without acting.

### C1 tests + acceptance

New `src/sim/net/escalation.test.ts` (unit) + `session.test.ts` extensions:
- **Escalation grows `offeredLoad` only where served, only when on, DT-invariant** (fine vs coarse dt converge; single ceiling-clamp prevents shock-compounding).
- **Oversubscription tips a contract to breach (binary):** two contracts share one sat, escalation drives combined load `>= linkCapacity` ⇒ the bandwidth-active contract goes **servedFraction 0**, `bindingConstraint="bandwidth"`, and `breachSecondsAccum` rises toward grace. (Explicitly asserts the binary verdict, NOT a pro-rata fraction — the HIGH-1 fix.)
- **A parallel path relieves it:** launch a second sat ⇒ `loadBySat` splits ⇒ both back to full service ⇒ `breachSecondsAccum` resets.
- **A prefer override relieves it:** `net_set_prefer` biases the latency contract onto the short path ⇒ meets `slaLatencyS` ⇒ served; assert the chosen `path[1]` sat id flips with the weight (the blend provably routed differently).
- **Congestion re-solves through the cache:** assert a rising `offeredLoad` that bumps `congestionEpoch` forces `resolveTick` to re-run the full solve (the cached verdict refreshes for congestion — the HIGH-2 fix). Assert a static load does NOT re-solve (cache preserved).
- **Router back-compat:** `previewLaunch` + all A1/A2 tests pass with no `loadBySat`/`prefer`/`slaLatencyS` (defaults ⇒ congestion 0, latency Infinity ⇒ identical behavior).
- **Restore-replay for congestion:** restore-then-step == continuous-run for `loadBySat` + the folded `chosenSatByContract` (the MED desync fix).
- **act3a.gate fires on tame→outgrow→re-tame** at a deterministic tick; does NOT fire without a dip or without recovery.
- **Latency axis:** a GEO-only path fails the low-latency corridor (`bindingConstraint=="latency"`); a LEO path passes.
- **Golden re-pin #1:** see the golden section. Both old goldens (`544847093270497462n`, `8431658617016421069n`) untouched (net/ imports neither m1/ nor m2/session.ts).

**Acceptance C1:** `npm test` green; escalation→oversubscription→re-tame deterministic end-to-end; the cost-blend routes by `prefer`; the bandwidth bite is binary (accrues breach); congestion forces a re-solve through the cache; latency axis exposes the GEO ceiling; restore-replay holds; golden re-pinned with old→new note; both old goldens byte-for-byte intact.

---

## C2 — Sub-beat 3B: the fault spectrum, mild-first, fenced behind 3a

### C2.1 — `fault.ts` (NEW, standalone, parallel-buildable)

Pure data + pure roll functions off a `SimRng` the caller (`NetSession`) owns. The splitmix64 is the only randomness — the M2 launch-failure-roll pattern (`launchSat` notes the seeded RNG is held for the Act-3b fault stream).

```ts
export type FaultKind = "degradation" | "transientOutage" | "telegraphed" | "hardFailure";
export interface FaultState {
  satId: string;
  kind: FaultKind;
  startedAtS: number;
  capacityMultiplier: number; // degradation: bandwidth/capacity multiplier in (0,1) while active
  failsAtS: number;           // telegraphed: sim-time it WILL fail (trace countdown); else Infinity
  recoversAtS: number;        // degradation/transient recover at this sim-time; Infinity for hard
}
```
- **Causal probability (§5.2):** pure `causalFaultRatePerS(sat, ageS)` raising a base rate by overclock / cheap-bus / low-orbit / age multipliers, named PLAYTEST-KNOB constants. M1 has one bus (`smallsat`) + no overclock UI, so those hooks are present-but-neutral; the live levers this hour are **low-orbit** (LEO faults more than GEO — bridges to decay, rewards redundancy) and **age**. **Age uses the real field path: `ageS = t - sat.orbit.epochS`** (verified: `NetSat.orbit: SatOrbit`, sat.ts:49; epoch folds at net-replay.test.ts:123 as `o.epochS`). The original `t - sat.epochS` does not compile (LOW fix).
- **Rare-random floor (§5.2):** an irreducible `RARE_RANDOM_FAULT_RATE_PER_S` added to every sat regardless of choices.
- **Roll (deterministic):** `rollFaults(rng, sats, faultsActive, t, dt, scriptedQueue)` → new `FaultState`s + recoveries. Per-sat Bernoulli over dt: `if rng.nextDouble() < rate*dt`. **Mild-first is AUTHORED for the first two faults:** `act3b.emit` injects a `scriptedQueue` of (1) a `Degradation`, then (2) a `Telegraphed` failure — exactly the spec's mild-first pair (onboarding:110-112, mechanics §5.1 rows 1+3). The stochastic causal+rare-random stream runs underneath as the irreducible floor thereafter. The scripted pair **draws from the same rng stream** (advance it deterministically) so fold + replay stay bit-stable.
- **HardFailure** stays vanishingly rare in M1 (onboarding:113, mechanics §5.1 row 4 "ramp in late-M1") — a tiny floor, effectively off this hour; in the enum so M2 turns it up without reshape.

### C2.2 — Faults as a topology change in the router (router already supports it)

The router already accepts `faults?: ReadonlySet<string>` and filters faulted sats (`live = sats.filter(s => !faults.has(s.id))`, verified router.ts:191), and `topologyKey` already folds the faulted set. So:
- **Hard / telegraphed-after-it-fails** ⇒ the existing `faults: ReadonlySet<string>` removal (topology change, re-solve, loss stamped). Zero router change.
- **Degradation** is NOT a removal (the sat still routes) — it's a **capacity haircut**: in the session's aggregate, multiply that sat's `linkCapacity` by `FaultState.capacityMultiplier` before computing `congestion_term`. Feeds the C1.2 congestion path. No new router branch.

The router signature stays completely unchanged; faults arrive through `faults?` (existing) + `loadBySat?` (E2 from C1).

### C2.3 — `act3b.emit` fenced structurally behind `act3a.gate` (scenario.ts)

`act3a` and `act3b` are **separate cursor entries** in `M1_SCENARIO` (verified in design grounding). `act3b.emit` fires only when the cursor reaches `act3b` — which only happens after `act3a.gate` returned true. The fence is **structural, not a runtime guard**: faults are impossible before 3a re-tame because the generator is enabled by `act3b.emit`, gated by the cursor. `act3b.emit`:
- `session.enableFaults()` (sets `faultsOn=true`, folded int).
- seeds the scripted mild-first queue `[degradation@sat, telegraphed@sat]`.
- `step` calls `rollFaults` only when `faultsOn`.

**Test the fence explicitly** (design §3b acceptance): assert no `FaultState` exists AND the fault rng-draw counter is 0 until the cursor reaches `act3b`.

### C2.4 — Session integration (`session.ts` extends)

- New folded state: `faultsOn` (int 0/1), `activeFaults: FaultState[]` (folded by `satId` + `kind` + the three sim-times as bit-stable f64s), and the **fault cursor** the golden fold reserves (`faultCursor=0` placeholder at net-replay.test.ts:108 becomes the count of faults rolled / the rng-draw counter).
- In `step`, after escalation: `if (faultsOn) stepFaults(t, dt)` — roll new faults (scripted-first, then stochastic), advance recoveries/countdowns, build the down-sat set + the degraded-capacity map, feed both into the contract solves. RNG draws come off `this.rng` (the same `SimRng` already in the snapshot via `rngState`) — replay-safe, no new seed.
- `NetSnapshot`/`restore` gain `activeFaults` + `faultsOn` (and `chosenSatByContract` from C1).

### C2.5 — `trace.ts` (NEW, standalone, parallel-buildable) — the self-diagnosing view (§2.6 / §7.4 — M1 NECESSITY)

Pure read over a session snapshot + the last `SolveResult` per contract (the session exposes `lastSolveFor(id)`). The **single legibility surface** for shortfalls AND fault state (§5.3 — one system, double duty). Owns/extends the `Shortfall` interface from scenario.ts.

`diagnose(session, t) → TraceReport`:
- **Binding-constraint + kind-of-fix** (§7.4), from each unserved/near-breach contract's `bindingConstraint`: connectivity → "no path; launch a covering sat"; availability → "availability breaks ~N min/orbit; add a phased sat in this plane"; latency → "latency floor is {latencyS*1000}ms via this path; a shorter LEO/relay route cuts it"; bandwidth → "trunk via [sat] saturated by N shared contracts; add a parallel path / prefer-bw."
- **Optimization/resilience shortfalls** (§3a optimizer pull, the gate's layer-1 target):
  - **Overprovisioned (waste):** a sat with `loadBySat[sat] << linkCapacity` while another contract breaches ⇒ "[sat] runs at X% — capacity idle; this contract could share it."
  - **SPOF (risk):** a served contract whose only bridging sat is one (no redundant bridge this solve) ⇒ "[region] has no redundant path; one sat fault drops it — add a phased sat / parallel orbit." Computed by a cheap re-run of `bridgeForPoint` excluding the chosen sat (≥2 independent bridges ⇒ redundant).
- **Fault state** (§5.3): each `FaultState` as a `SYSTEM.LOG` line — degradation amber pulse + "bandwidth degraded {1-mult}%, est. recovery {recoversAtS-t}"; telegraphed countdown "fails in {failsAtS-t}".
- **The predictability seed** (§7.5 REQUIRED): stamp every `SolveResult.losses` entry as "link [aId]↔[bId] lost: [cause] at [atS]" — `LinkLossStamp{aId,bId,cause,atS}` already carries it (verified router.ts:50-55). `w_stab` stays dormant; the *forecast* is M2+, the *stamped geometric cause + time* is here day one.

`trace.ts` is pure and standalone: imports `SolveResult`/`LinkLossStamp`/`PreferWeights` types, `Contract`, `NetSat`, and the `FaultState` **type** from fault.ts — no runtime coupling, so it builds in parallel with fault.ts.

### C2.6 — The 3b gate (weathered + surfaced)

Design §3b / onboarding:120: *weathered ≥1 fault while keeping contracts served (or recovering) AND the trace surfaced ≥1 optimization/resilience shortfall.* Folded session state:
- `weatheredFault` (int 0/1): set when an `active` contract experienced a fault on a sat it routed through yet kept `lastServedFraction > 0` across the fault window (or recovered to served after a transient/telegraphed) — redundancy or recovery held.
- `surfacedShortfall` (int 0/1): set the first tick `trace.diagnose` returns a non-empty resilience/optimization shortfall list. The trace is **called once per step inside `step` when `faultsOn`** to fold this deterministically (the report is a derived readout, not folded; the boolean it sets IS folded).
- `act3b.gate = weatheredFault && surfacedShortfall`. The fallback eases the fault rate (a session `faultRateScale` the drowning-detector lowers) and makes the trace more directive (onboarding:122).

### C2 tests + acceptance

New `src/sim/net/fault.test.ts` + `src/sim/net/trace.test.ts` (both standalone) + scenario/session extensions:
- **Fault rolls deterministic on replay** (same rng stream → same sequence; the M2 launch-failure-roll pattern).
- **The fence:** no fault before `act3a.gate` fired — assert `activeFaults` empty + the fault rng-draw counter 0 until the cursor reaches `act3b`.
- **Mild-first ordering:** first fault `Degradation`, second `Telegraphed` (scripted queue), before any stochastic hard failure.
- **Age hook compiles + bites:** an older / lower sat shows a higher `causalFaultRatePerS` using `t - sat.orbit.epochS` (the real field).
- **Redundant builder sails, brittle builder breaches:** a two-bridging-sat contract stays served through a telegraphed failure of one; a single-sat contract breaches — the resilience lesson lands by consequence.
- **Trace stamps the predictability seed:** a LEO set produces a `LinkLossStamp` the trace renders with cause + time.
- **Trace surfaces SPOF + overprovision** on the right topologies.
- **act3b.gate fires** only when both conditions hold; the drowning-fallback eases the rate.
- **Golden re-pin #2:** see below. Both old goldens still untouched.

**Acceptance C2:** `npm test` green; faults provably fenced behind 3a; mild-first; redundant-vs-brittle diverge; trace is the single surface for shortfalls + fault state + the predictability seed; `act3b.gate` fires on weathered+surfaced; golden re-pinned (old→new note chained); the two existing goldens byte-for-byte intact.

---

## Golden re-pin discipline (resolves LOW: fold ADDITIONS, not pure value moves)

The original framing ("moves the value rather than reshaping the fold") is true **only for `faultCursor`** (the `=0` placeholder at net-replay.test.ts:108 becomes a live count — a value move). The new folded session fields are **genuinely new fold inputs** = fold ADDITIONS (reshapes), and must be documented as such:

- **C1 re-pin #1 (fold additions):** `escalationOn` (int), `act3aReTameWitnessed` (int), the near-breach witness, `congestionEpoch` (int), `chosenSatByContract` (sorted `id|satId` pairs). Plus value moves already in the fold: `offeredLoad` shifts, `activeAxes` gains `latency`/`bandwidth`. Order new fields **after** existing ones to minimize churn; add a `mixInt`/sorted-pair entry per addition. Re-pin `NET_REPLAY_GOLDEN` (current `10424955607522567073n`) → new value with an old→new note in the test header.
- **C2 re-pin #2 (fold additions + the one value move):** `faultsOn` (int), `weatheredFault` (int), `surfacedShortfall` (int), `activeFaults[]` (array of `satId|kind|f64×3`), and `faultCursor` becomes a live value (the one true value move). Extend the golden replay log to drive through act3a (launch a parallel path / prefer override) and into act3b (weather the scripted faults) so the fold exercises the new state. Re-pin `NET_REPLAY_GOLDEN` → new value, old→new note chained from #1, documenting each addition.

Both re-pins are fine and documented; they ARE reshapes (new fold entries) plus one value move — stated honestly, per the design's golden discipline. **The two existing goldens `544847093270497462n` and `8431658617016421069n` stay byte-for-byte untouched** across both re-pins.

---

## How this generalizes (faithful to onboarding Act 3, sets up M2+)

- **`w_stab` stays dormant** (`prefer.stab` present, weight 0) — the cost-blend STRUCTURE is the real §7.2 blend, so M2 turns on the stability/predictive term with no reshape.
- **The trace/seed feeds the post-gate predictive a-ha** (§7.5): the stamped `losses` (cause + time) + the SPOF/overprovision parse are the "information that was always there" the M2 forecast surfaces — soil planted, tool deferred.
- **The fault enum carries `hardFailure`** at a vanishing M1 rate; M2 turns it up + adds the efficiency-vs-resilience/cascade coupling without touching the spectrum.
- **The `SolveResult` return `{served,path,latencyS,bindingConstraint,losses}` never changed** across Acts 1→3: Act 1 path-existence, Act 2 multi-sat hand-off + availability, Act 3 min-cost over bridging sats with the latency+congestion blend — all by flipping `activeAxes`, reading `prefer`, and the four additive extensions (E1 type widen, E2 `loadBySat`, E3 `resolveTick`/`topologyKey`, E4 capacity). Act 4 (Mars light-delay) extends `latency_term` only.

---

## Build-increment summary

- **C1 = act3a (escalation):** serialized shared-file edits — `router.ts` (E1 `RoutableContract` widen + E2 `solve` `loadBySat` + E3 `resolveTick`/`topologyKey` congestion fingerprint + min-cost blend, returns stable), `contract.ts` (E4 capacity + escalation constants, additive), `session.ts` (escalation tick + two-pass congestion aggregation + folded `chosenSatByContract` + `congestionEpoch` + 3a gate state), `scenario.ts` (act3a emit/gate/fallback). The bandwidth axis bites **binary** (HIGH-1). Tests + golden re-pin #1 (fold additions + value moves, old→new note). Both old goldens untouched.
- **C2 = act3b (faults): `fault.ts` ∥ `trace.ts` are independent standalone NEW files, parallel-buildable** (shared `FaultState` *type* only). Then serialized session/scenario edits to wire them (fault roll off the existing `this.rng`; hard/telegraphed via the existing `faults?` param, degradation via the C1 capacity haircut; the act3b structural fence + gate; trace called once/step to fold `surfacedShortfall`). Age hook uses `sat.orbit.epochS` (LOW). Tests + golden re-pin #2 (fold additions + the `faultCursor` value move, old→new note chained). Both old goldens untouched.

**Files touched (absolute):** NEW `/home/basov/Games/signal-horizon/src/sim/net/fault.ts`, `/home/basov/Games/signal-horizon/src/sim/net/trace.ts`; EXTEND `/home/basov/Games/signal-horizon/src/sim/net/router.ts`, `/home/basov/Games/signal-horizon/src/sim/net/contract.ts`, `/home/basov/Games/signal-horizon/src/sim/net/session.ts`, `/home/basov/Games/signal-horizon/src/sim/net/scenario.ts`, `/home/basov/Games/signal-horizon/src/sim/net-replay.test.ts`; NEW tests `/home/basov/Games/signal-horizon/src/sim/net/escalation.test.ts`, `/home/basov/Games/signal-horizon/src/sim/net/fault.test.ts`, `/home/basov/Games/signal-horizon/src/sim/net/trace.test.ts`. Reused unchanged: `net_set_prefer` in `/home/basov/Games/signal-horizon/src/sim/action.ts` + `/home/basov/Games/signal-horizon/src/sim/net/apply-action.ts` + `NetSession.setPrefer`.

**Critique resolution map:** HIGH-1 (pro-rata breach) → C1.2 binary bandwidth bite + C1.6 reachable witness. HIGH-2 (load not threaded / topologyKey ignores demand) → E2 `solve` `loadBySat` + E3 `resolveTick` forwarding + `congestionEpoch` in `topologyKey`. MED (RoutableContract type) → E1 additive widen with defaults. MED (two-pass replay desync) → folded `chosenSatByContract`, `loadBySat` re-derived from folded state, explicit restore-replay test. LOW (age field) → `sat.orbit.epochS`. LOW (golden value-move vs reshape) → both re-pins documented as fold ADDITIONS + the single `faultCursor` value move.

---

## ACT 4 — the Mars frontier teaser (vertigo; FENCED, mostly reuse)

Confirmed. The full-eccentricity orbital extremes give one-way ~3.0–22.3 min (round-trip ~6.1–44.6 min). The critique's ~4.4–21 min one-way was using the circular-orbit approximation; the true Keplerian extremes are wider. Either way, the design's asserted **8–40 min one-way** band is physically wrong — that is the round-trip figure. And `mission.ts` crawls on `oneWaySeconds`, with the readout printing the one-way ETA.

I now have everything verified. The two blocking issues are real and confirmed against the actual code/data. Here is the revised, build-ready Act 4 design.

---

# ACT 4 — "Distance changes everything" (vertigo) — the fenced campaign-hook teaser

## Design status & discipline

Act 4 is a **TEASER, not a system**: introduce light-delay + freshness + caching as **concepts felt by sight**, then STOP. Per onboarding line 131 ("introduce the *vertigo*, withhold the *toolkit*") and §8 fences, this is **near-zero new mechanics** — mostly **REUSE + FENCE** of code that already exists (`src/sim/delay.ts`, the `m1/cache.ts` honest-staleness *convention*, the `mission.ts`/orrery packet-crawl).

The one true new mechanic is a **special-cased latency injection on the Mars leg**: connectivity is decided by a deliberately-closing deep-space relay (presence-based), and the leg's latency is taken from the **real Earth↔Mars ephemeris distance** via `delay.ts` — so the Earth toy's microsecond latency is replaced, on that one hop, by an honest minutes-long delay. Everything else is a contract, a readout, an action, and a render reuse.

**Fenced OUT (do NOT build — §8, post-gate, undesigned):** prefetch policy, coherence levels, eviction-as-strategy, the freshness economy/pricing curve, the parse, "currency," sat↔sat relay coherence, launch-window planning. `m1/policy.ts`, `m1/coherence.ts`, `m1/demand.ts`, `m1/parse.ts`, `m1/eventlog.ts` are **NOT imported by net/** and stay that way. Act 4 reuses ONLY `delay.ts` (`oneWaySeconds`/`roundTripSeconds`/`freshness`) and the `m1/cache.ts` honest-staleness *convention* (capturedAtT-at-launch, SD-19) at the design level — **never** its multi-slot eviction policy, and **never imported** (SD-40 invariant: `net/` imports neither `m1/` nor `m2/session.ts`).

---

## Two critique blockers — RESOLVED (these are the substance of this revision)

### BLOCKER 1 (HIGH) — the latency band was physically wrong. FIXED.

I computed the real Earth↔Mars light delay from `data/system.json` (`earth a_au=1.00000011 e=0.01671`; `mars a_au=1.5237 e=0.0934`), using the actual Keplerian orbital extremes (not the circular approximation):

| | distance | **one-way** | **round-trip** |
|---|---|---|---|
| closest (opposition, near peri/apo) | 0.365 AU | **3.0 min** | 6.1 min |
| farthest (conjunction) | 2.683 AU | **22.3 min** | **44.6 min** |

The router's `latencyS` is documented **one-way** (`router.ts` SolveResult: *"Realized one-way latency"*; `delay.ts oneWaySeconds = d / C_LIGHT`). `mission.ts` (line 76–87) launches the crawl on `oneWaySeconds(distanceBetween("earth","mars",t))` and prints the **one-way** ETA. So:

- The design's asserted **"8–40 min one-way"** band is **the round-trip number** (onboarding line 137 literally says *"the round-trip is 8–40 minutes"*). As a **one-way** assertion it would FAIL: the real one-way never reaches 40 min and dips to ~3 min near opposition.

**RESOLUTION (chosen explicitly):** keep the router's internal `latencyS` **one-way** (no semantics change), and make the **player-facing vertigo readout the ROUND-TRIP** — because the thing that breaks the Earth real-time-tune playbook is *"my command's effect comes back 8–40 minutes late"*, which is a round trip. Concretely:

- `link-budget`/router `latencyS` (one-way) is pinned to the real one-way band **`[3 min, 23 min]`** (pin both synodic extremes with a small tolerance, e.g. `[2.9 min, 22.5 min]`).
- The trace/readout surfaces **`roundTripSeconds(eph.distanceBetween("earth","mars",t))`** as the headline "command round-trip," pinned to **`[6 min, 45 min]`** — this is the onboarding's "8–40 min" lived figure (and a typical mid-synodic value lands squarely inside 8–40).
- Both are pure functions of the same unforked ephemeris distance at the same `t`, so crawl (one-way) and readout cannot drift, and the round-trip is exactly `2×` the one-way the crawl uses.

This keeps the headline number honest *and* matches the onboarding's "8–40" by displaying the quantity (round-trip) the onboarding was actually describing.

### BLOCKER 2 (MED) — the inter-body frame bridge was underspecified/contradictory. PINNED.

The design previously gave two unreconciled mechanisms ("common inertial frame via `surfacePointInertial`" vs "just `eph.distanceBetween`"). Verified against code: `router.satPositionRelative` **drops** `eph.position` (line 89–95) and `link-budget.surfacePointRelative` **hard-codes** `A1_BODY_RADIUS_M` (300 km toy) + `earthThetaAt` (line 76–81, earth-only). A Mars region/relay **cannot** flow through `evaluateLink`/`bridgeForPoint` as-is, and forcing the toy inverse-square budget to close at ~1 AU would need a physically-meaningless giant EIRP.

**RESOLUTION (the clean, near-zero path — committed):** the Mars leg is a **special-cased latency injection with presence-based connectivity**, NOT a toy-frame `evaluateLink` close:

- **Connectivity** for the Mars contract is decided by **relay presence**: once the player has launched the `MARS_RELAY` (a logged `net_launch` with the Mars preset), the Mars leg **bridges by construction** (a boolean presence test against the launched-sat roster). No toy inverse-square budget is computed on the Mars leg; no fake EIRP; the Mars point never goes through `surfacePointRelative`.
- **Latency** for the Mars leg is `oneWaySeconds(eph.distanceBetween("earth","mars",t))` (body-center-to-center, the **same value** the crawl uses), injected into the `SolveResult.latencyS` for the Mars contract. The Earth-side leg (relay→Earth-ground) is negligible and can be added as the toy microsecond term or omitted; the Mars interplanetary term dominates by ~9 orders of magnitude either way.
- The design states **plainly**: the Mars contract is routed by a dedicated `solveMarsLeg` branch (presence + ephemeris-latency injection), **bypassing** `surfacePointRelative`/`evaluateLink`. Earth contracts are **untouched** — they keep the full toy-frame `bridgeForPoint`. No change to `satPositionRelative`/`surfacePointRelative`, so the earth-relative-cancellation the whole module relies on is never perturbed.

This keeps the change to "one enum member + one constant + one small `solveMarsLeg` branch," and puts no physically-meaningless number into the fold or the trace.

---

## File-level design on `src/sim/net/`

### `endpoint.ts` — a Mars endpoint that breaks the toy-frame assumption (REUSE + small extension)

Widen `Region.bodyId` and `GroundNet.bodyId` from the literal `"earth"` to `"earth" | "mars"`. Add one constant region (the data source on Mars):

- `NET_ACT4_MARS_REGION: Region` — `bodyId: "mars"`, nominal lat/lon (geometry is **cosmetic**: Act 4 asserts neither whole-disc coverage nor a toy-frame budget on this region; it is connectivity-by-relay-presence over an interplanetary hop).
- `NET_ACT4_MARS_GROUND` is the **existing Earth ground net** — the data comes *back* to Earth's network, so the long leg is the interplanetary one.

This is the only `endpoint.ts` change: one enum member + one constant. The `coveredFraction`/Fibonacci sampler is untouched (Act 4 never asserts whole-disc on Mars).

### `link-budget.ts` — add the inter-body distance helper ONLY (no toy-frame Mars geometry)

`surfacePointRelative`/`evaluateLink` stay **exactly as built** (earth-toy-frame, microsecond latency for Earth links). Add **one pure helper**:

- `interBodyOneWayLatencyS(eph, "earth", "mars", t): number` → `oneWaySeconds(eph.distanceBetween("earth","mars",t))` (import `oneWaySeconds` from `../delay`). This is the **only** new function here, and it does **not** touch the toy-frame budget. The Earth toy latency stays microseconds.

No fake EIRP, no Mars point through `surfacePointRelative`.

### `router.ts` — a `solveMarsLeg` branch; latency is a READOUT, never an enforced Earth axis

`SolveResult` is **unchanged** (`{served, path, latencyS, bindingConstraint, losses}`). Add a small branch in `solve` (keyed on `contract.region.bodyId === "mars"`) that calls a new `solveMarsLeg`:

- **Served** iff the `MARS_RELAY` is present in the launched-sat roster (presence test) — that is the connectivity verdict; `bindingConstraint = "connectivity"` when no relay, exactly like Act 1.
- **`latencyS = interBodyOneWayLatencyS(eph, "earth", "mars", t)`** (the honest one-way minutes). `path = [marsRegion.id, relay.id, groundNet.id]`.
- **`latency` is NOT added to the Mars contract's `activeAxes`.** Act 4 enforces **only `connectivity`** (path existence). The minutes-long latency is **surfaced as a readout** (the crawl, the round-trip stamp, "as of Nm ago"), never as a breach axis. If latency were enforced, the Mars contract would hard-breach and that is a system, not vertigo.

Earth contracts (`bodyId === "earth"`) keep the existing `bridgeForPoint` path verbatim. The re-solve split is unaffected — a Mars relay in a stable orbit produces no horizon thrash and the topology key already keys on sat ids; the presence test is time-invariant so the cached path holds.

### `contract.ts` — ONE Mars contract that pays less for stale data (REUSE; NO struct change)

No struct change. The Act-4 beat offers **one** Mars contract via the existing `offerNetContract(...)`:

- `region: NET_ACT4_MARS_REGION`, `activeAxes: {connectivity}` (latency/avail/bw present-but-un-enforced, as in Act 1).
- **The "pays less for stale data" is a RENDER-LAYER read-only effect, with NO new Contract field.** There is **no** `freshnessFactor` on the `Contract` struct and **nothing** new in the fold beyond `marsSample` (below). The trace face computes the stale dimming at render time from `marsSample` freshness; the wallet accrual stays the simple `netRevenueRatePerSecond(c, frac)` — **no** freshness→€ wiring (that is `m1/demand.ts`'s priceCurve — fenced §8).

> Decision to record (SD-40·D1): "less for stale data" is a **render-layer read-only annotation** in Act 4 — NOT a wallet mechanic and NOT a Contract field. The freshness economy (price-vs-staleness slope, the §8/SD-15 ramp) stays fenced and undesigned. A future increment that makes stale data actually reduce € is post-gate M2+.

### Freshness "as of Nm ago" — REUSE the `delay.ts` curve + the cache CONVENTION (one slot, render-layer, NO import of `m1/`)

The "data arrives old" readout reuses the **already-built** freshness math without importing the economy:

- Import **`delay.ts` directly** (`oneWaySeconds`, `roundTripSeconds`, `freshness` — note the real export name is **`freshness`**, *not* `delayFreshness`; that alias only exists locally inside `m1/cache.ts`).
- Define a tiny **local 3-field `MarsSample`** mirroring `CachedSample`: `{ datasetId: "mars"; capturedAtT: number; halfLifeS: number }`. The age readout is `t - capturedAtT` ("as of Nm ago"); the freshness readout is `freshness(age, halfLifeS)` with `halfLifeS = oneWaySeconds(distanceBetween(...))` at capture (the SD-19 honest-staleness convention: the sample is one-way old on arrival).
- **Reuse only the curve + the convention** — never the multi-slot `store`/`evictStalest`/`evictionVictim` policy (fenced §3a/§3b). One slot, one breadcrumb.

> Namespace caveat (preserved): SD-40 says `net/` imports **neither `m1/` nor `m2/session.ts`**. `m1/cache.ts` imports `freshness` from `delay.ts`. To honor that fence, `net/` imports **`delay.ts` directly** and inlines the 3-field `MarsSample` — the brief's "reuse the m1 cache code" is satisfied at the **design/curve** level (same half-life decay, same capturedAtT-at-launch convention) without breaking the import fence.

### `session.ts` — the Mars sample lives on the session (folded), one cache action

`NetSession` gains a minimal foldable Act-4 slot:

- One field: `marsSample: { capturedAtT: number; halfLifeS: number } | null` (null until the cache breadcrumb is placed). Folded into `NetSnapshot` + the state-hash (2 floats + a null-flag) so replay stays bit-identical.
- The per-tick `step` is **unchanged** for serve/breach (connectivity-only). When the Mars contract is active, it **freezes** the sample's `capturedAtT` at the moment the path first carries (honest-staleness, SD-19: one-way old on arrival) and refreshes the readout. No wallet change.
- The cache breadcrumb is placed via **one new action** (below); placing it sets `marsSample` "near Mars" so the freshness readout improves by sight. It does **not** change served/breach or revenue (a felt breadcrumb, not a relief lever).

### `action.ts` — ONE new action kind: `net_place_cache`

Mirrors `net_launch`/`net_accept` constructors and snake_case wire keys:

- `KIND_NET_PLACE_CACHE = "net_place_cache"`, payload `{}` (or `{ datasetId: "mars" }`). The single cache breadcrumb. Applied at `atTick` via the shared applier so live==replay. **Deterministic, no roll** — it just sets `marsSample`.
- **No prefetch-policy action, no coherence action.** `KIND_PREFETCH`/`KIND_SET_PREFETCH_POLICY` exist for the *old m1* economy and are **NOT** reused by net/ (§8 fence).

### `apply-action.ts` — handle `net_place_cache` (one branch)

Add one branch to `applyNetAction` that calls `session.placeMarsCache(t)`; no-op on unknown kind (existing pattern). The launch-toward-Mars uses the **existing** `net_launch` (the player "launches as they always have" — onboarding line 134), with the deep-space loadout selected by the Mars preset.

### `world.ts` — one Mars preset (the relay the player launches)

Add a `MARS_RELAY` `NetPreset` + its `Preset` adapter, so the planner's "launch toward Mars" verb is the same `net_launch` action with a different preset. Because connectivity on the Mars leg is **presence-based** (Blocker-2 resolution), the relay's antenna spec is **cosmetic** — it does NOT need a giant EIRP to "close" a toy-frame budget (there is none on the Mars leg). Give it a plausible deep-space antenna for flavour; do not invent a meaningless EIRP for the fold. `previewLaunch` already runs the real `solve` — so the Mars-launch preview **already shows the minutes-long latency floor truthfully** (via the `solveMarsLeg` branch), which is itself part of the vertigo: the player sees the crawl coming *before* commit. No new planner mechanic.

### `scenario.ts` — fill the `act4` beat (already a structural placeholder; gate stays false)

The `ACT4` beat exists with empty `emit` and a never-true `gate`. Fill `emit` only:

```
act4.emit:  offer ONE Mars contract (NET_ACT4_MARS_REGION, activeAxes={connectivity});
            (no fault enable, no mask flip, no escalation — pure demand arrival;
             the "less for stale" dimming is render-layer, not emitted here)
act4.gate:  stays `return false` forever  ← the cursor STOPS here ("to be continued")
act4.fallback: none (the only "failure" read is the human bounce — Layer 2)
```

The cursor reaching `act4` is itself the "you've reached the frontier" beat. Because `gate` never returns true, `scenarioCursor` never advances past `act4` — the deterministic, no-win-screen "to be continued" (matches the built `evaluateGate` + SD-40·A3).

### `trace.ts` (when it lands) — the vertigo readout, never an Earth gauge

The trace face surfaces the Mars hop as a **diagnostic readout**: the headline **command round-trip** `roundTripSeconds(distanceBetween("earth","mars",t))` ("first signal: round-trip 8–40 min; your real-time tune does not apply across this distance"), the one-way crawl ETA, and the "as of Nm ago" freshness stamp (with the stale-dimmed pay annotation, render-layer only). It must **never** render a freshness gauge on any **Earth** contract (the §8 fence + Test 2). Earth contracts continue to show only connectivity/availability/latency/bandwidth.

---

## Visualization (by sight — make-or-break)

- **Reuse the existing packet-crawl** (`mission.ts` line 76–87 + the orrery per-feed crawlers at `orrery.ts:1189+`) — already crawls Earth→Mars at honest `oneWaySeconds(eph.distanceBetween("earth","mars",t))`. The net render mode draws the same crawler for the Mars leg; because both the crawl and the router latency term come from the **identical** `delay.ts` formula + the same ephemeris distance, the crawl reaches progress 1.0 exactly when the latency readout says it arrives — no drift. The round-trip readout is exactly `2×` that same one-way.
- **Freshness by saturation** (DD-1: "freshness = saturation draining to grey"). The Mars data node desaturates as the sample ages; the "as of Nm ago" stamp ticks. The placed cache breadcrumb visibly raises the saturation (data closer = fresher-looking) — the single caching lesson.
- **The Earth globe is unchanged** — Mars shown at honest interplanetary scale (the de-squash/log-fold is render-only and never feeds light-delay math, SD-5).

---

## Build increment D1 (one Build→Verify subagent) — tests + acceptance

**D1. The Mars vertigo read.** Wire the `act4.emit` Mars contract; the `interBodyOneWayLatencyS` helper in `link-budget.ts` + the `solveMarsLeg` presence/latency branch in `router.ts`; the `MARS_RELAY` preset in `world.ts`; the `net_place_cache` action + applier branch + `marsSample` session field; the render-layer freshness readout (reused `delay.ts` `freshness`, local 3-field `MarsSample`); the round-trip headout; the `act4` cursor stop. **NO** prefetch/coherence/freshness-economy/parse/eviction-policy; **NO** new Contract field.

**Tests:**
1. **Latency explodes deterministically at Mars distance (ONE-WAY band fixed).** For the Mars contract over the Act-4 epoch window, `SolveResult.latencyS` (one-way) lands in **`[~3 min, ~23 min]`** and equals `oneWaySeconds(eph.distanceBetween("earth","mars",t))` exactly. **Pin both synodic extremes** (closest ≈ 0.365 AU → 3.0 min; farthest ≈ 2.683 AU → 22.3 min) with a small tolerance so a future ephemeris swap is caught. The **round-trip readout** is asserted separately in `[~6 min, ~45 min]` and equals `roundTripSeconds(...) = 2× latencyS`. **Crucially, the Earth toy latency stays microseconds** (assert an Earth contract's `latencyS` is sub-millisecond — the Mars branch never touches Earth).
2. **NO Earth gauge ever shows freshness.** Assert every Earth contract's readout/trace exposes only connectivity/availability/latency/bandwidth and **never** a freshness/staleness field; only the Mars contract carries the "as of Nm ago" / freshness readout. (Guards the §8 fence at the type/render boundary — and confirms no `Contract` struct field carries freshness.)
3. **Crawl == readout (no drift).** The packet-crawl one-way and the router `latencyS` are the **same** value at the same `t` (both via `oneWaySeconds` + the same `distanceBetween`); the round-trip readout is exactly `2×` that.
4. **Latency stays un-enforced.** The Mars contract's `activeAxes` is `{connectivity}` only; serve/breach is presence-based path-existence; the minutes-long latency never flips `state` to breach and never alters `earnedEur` (no freshness→€ wiring).
5. **One cache breadcrumb, deterministic.** `net_place_cache` sets `marsSample`, raises the displayed freshness, and is a pure no-roll deterministic mutation; placing it does **not** change served/breach or revenue.
6. **Replay stable + NET golden re-pinned.** Re-pin **only** `NET_REPLAY_GOLDEN` (`10424955607522567073n → <new>`) in `src/sim/net-replay.test.ts` with a **documented old→new note** (the fold now covers `marsSample`'s 2 floats + a null-flag + the Mars contract). Replay-twice bit-identical; live==replay; SaveGame JSON round-trip reproduces the hash; the two existing goldens **byte-for-byte untouched** — `544847093270497462n` (`m1-session-replay.test.ts`, M1 cache economy) and `8431658617016421069n` (`m2-build-replay.test.ts`, M2 build); `net/` still imports neither `m1/` nor `m2/session.ts`; purity scan covers the new sources (only randomness = seeded splitmix64; `delay.ts`/`ephemeris` pure, no `Date.now`). **Note:** this is the **NET** golden — do **not** touch the M2-build golden (M3a re-pinned that one `6225853297339560787n → 8431658617016421069n`, a different world/test); that conflation in the prior draft is dropped.
7. **The cursor stops on act4.** Once the cursor reaches `act4`, `act4.gate` is false forever — `scenarioCursor` never advances past it (the deterministic "to be continued," no win screen, no completion gate).

**Acceptance:**
- The Mars-leg latency explodes deterministically (one-way `[3, 23]` min, round-trip readout `[6, 45]` min); the Earth toy latency stays microseconds.
- No Earth gauge ever shows freshness; only the Mars hop does; no new Contract field; the only fold growth is `marsSample`.
- Replay stable; **NET** golden re-pinned with the old→new note; both existing goldens (`544847093270497462n`, `8431658617016421069n`) untouched.
- **Human (two-layer gate, ≥5 cold testers, run after the build):** Layer 1 — finishes Act 3 *wanting to do it better*; **Layer 2** — when light-delay broke the Earth playbook, did they **lean in** ("how *do* you run a network across that?") or **bounce**. A read on the hook, not a completion gate. Layer-1 pass + Layer-2 fail = the connectivity game is fun but the interplanetary premise doesn't grab — learned before M2.

---

## Why this is faithful + fenced (no rework, near-zero new mechanics)

1. **One real new mechanic:** the `solveMarsLeg` branch — presence-based connectivity + an `interBodyOneWayLatencyS` injection from the real ephemeris via `delay.ts` into the router's existing `latencyS`. The toy-frame `evaluateLink`/`surfacePointRelative` are **untouched** (no Mars point in the toy frame, no fake EIRP, no perturbed earth-relative cancellation). Everything else is a contract, a readout, an action, and a render reuse.
2. **Reuse, not rebuild:** `delay.ts` (`oneWaySeconds`/`roundTripSeconds`/`freshness` — real export names) and the `m1/cache.ts` honest-staleness *convention* at the design level, without importing the m1 economy (SD-40 fence preserved by the direct `delay.ts` import + local 3-field `MarsSample`).
3. **Router signature stays stable:** `{served, path, latencyS, bindingConstraint, losses}` untouched; latency was already a returned field; the Mars contract's `activeAxes` is `{connectivity}` only.
4. **Freshness economy withheld:** "pays less for stale" is a **render-layer** read-only annotation (no Contract field, no fold growth beyond `marsSample`, no wallet wiring); caching is one breadcrumb slot, no eviction; no prefetch/coherence/parse/currency (§8).
5. **Determinism:** latency is a pure function of the unforked ephemeris; `marsSample` is 2 folded floats + a null-flag; one deterministic no-roll action; the NET golden re-pins with a documented note; the two existing goldens never move.
6. **The ending is a read, not a gate:** `act4.gate` stays `false` (already built) — the cursor stops on the frontier; no win screen. The vertigo is introduced; the toolkit is withheld.

**Relevant files (absolute):**
- `/home/basov/Games/signal-horizon/src/sim/net/scenario.ts` — fill `act4.emit`; gate stays `false`.
- `/home/basov/Games/signal-horizon/src/sim/net/link-budget.ts` — add `interBodyOneWayLatencyS(eph,"earth","mars",t)` (imports `oneWaySeconds` from `../delay`); toy-frame functions untouched.
- `/home/basov/Games/signal-horizon/src/sim/net/router.ts` — `solveMarsLeg` branch (presence-based connectivity + ephemeris-latency injection) keyed on `region.bodyId==="mars"`; Earth path verbatim; signature unchanged.
- `/home/basov/Games/signal-horizon/src/sim/net/endpoint.ts` — `bodyId: "earth"|"mars"`; `NET_ACT4_MARS_REGION` (+ reuse Earth `NET_ACT4_MARS_GROUND`).
- `/home/basov/Games/signal-horizon/src/sim/net/contract.ts` — one Mars contract via existing `offerNetContract`; **no struct change**, no freshness field.
- `/home/basov/Games/signal-horizon/src/sim/net/session.ts` — `marsSample` folded field, `placeMarsCache(t)`, capturedAtT-freeze on first carry.
- `/home/basov/Games/signal-horizon/src/sim/net/apply-action.ts` — one `net_place_cache` branch.
- `/home/basov/Games/signal-horizon/src/sim/net/world.ts` — `MARS_RELAY` preset (cosmetic deep-space antenna; no fake EIRP).
- `/home/basov/Games/signal-horizon/src/sim/action.ts` — `KIND_NET_PLACE_CACHE` + constructor (additive only).
- `/home/basov/Games/signal-horizon/src/sim/net-replay.test.ts` — re-pin **NET** `10424955607522567073n → <new>`, old→new note.
- `/home/basov/Games/signal-horizon/docs/decisions.md` — SD-40·D1: stale-as-render-layer fence; one-way `latencyS` + round-trip readout; `delay.ts`-direct-import + local `MarsSample` to preserve the net/-imports-neither invariant; re-pin is the NET golden (not M2-build).

**Reused leaf modules:** `/home/basov/Games/signal-horizon/src/sim/delay.ts` (`oneWaySeconds`, `roundTripSeconds`, `freshness`), `/home/basov/Games/signal-horizon/src/sim/ephemeris.ts` (`distanceBetween`, `C_LIGHT`); freshness/half-life convention from `/home/basov/Games/signal-horizon/src/sim/m1/cache.ts` (design-level only, **not imported**). The crawl reuse: `/home/basov/Games/signal-horizon/src/sim/mission.ts` + `/home/basov/Games/signal-horizon/src/orrery/orrery.ts`. **Untouched goldens:** `544847093270497462n`, `8431658617016421069n`.
