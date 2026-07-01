# M1 REDESIGN — FIRST LIGHT (+ pointed beams)
### v1.0 · 2026-07-01 · the from-scratch redesign of the M1 gameplay slice, launcher, and UX

> **Status:** design accepted direction, pending user read. Supersedes the SD-44 dashboard track and the *presentation/build* layers of `signal-horizon-m1.md` Parts II–IV. **Part I of the M1 spec (mechanic shapes) and the GDD remain canon** — this redesign exists because the build betrayed them, not because they were wrong. Produced by a 4-vision × 3-judge design workflow grounded in a first-hand Playwright playtest; full artifacts in the session workflow logs.

---

## 1. Diagnosis — why there was NO GAME

A cold hands-on playtest (2026-07-01, live `vite dev`, real clicks) confirmed the user's verdict with specifics:

1. **Zero decisions on the golden path.** Act 1's default launch was pre-aimed at the target (press L, click ACCEPT — 90 seconds, no slider touched). Act 2's ladder pre-computed the answer and defaulted to it (`NEED ~4 · SIZE 4 · at minimum ✓` → click PLACE SET). Act 3's strain event prescribed its own fix ("no lighter path — launch capacity"). The game solved itself and issued instructions.
2. **The launcher was a settings form**, and launching was a non-event (a white dot appears). No sat design — the action payload couldn't even carry a loadout.
3. **The world was dead.** Packets-in-flight existed only in the fenced cache demo — the GDD's make-or-break pillar was absent from the actual game mode. Regions floated off the globe limb; sats were unlabeled dots; ROUTING showed a 30 px globe and no routes.
4. **The UI lied.** "WILL SERVE ✓" and "footprint does not reach" simultaneously; a headline that never updated; a disabled ghost ACCEPT.
5. **No economy.** €67k after 3 minutes; the constellation cost €4.8k. Accept-everything was optimal.
6. **No bandwidth gameplay.** One hidden uniform capacity constant; the "squeeze" fired on a sat carrying a single region.

**The root cause is a design-fidelity failure, not a spec failure.** The M1 spec's one LOCKED UX principle (§3.2) already says: *"The planner shows truthful, predictable consequences … the assist provides a viable-but-imperfect starting point (never an optimal one) … A planner that solves the puzzle for you is a vending machine, not a game."* And §3.1 already demands drag-the-orbit-until-the-track-covers-the-dark-region. The build shipped the vending machine.

**Two governing laws for everything below** (they answer failures 1 and 4 structurally):

- **LAW 1 — Facts, never verdicts.** Instruments show physics facts (footprint, ground track, line-of-sight windows, load, latency) recomputed from the sim snapshot every frame (no cached derived strings — stale headlines become impossible). The game never prints a solved answer ("WILL SERVE", "NEED 4", "HOLDS ✓") before commit. Solved diagnoses exist only *post-hoc*, in the parse, about a network that actually ran — earned, after the wound.
- **LAW 2 — Goals, never instructions.** Objectives name a want ("KESSLER COAST is dark and paying"), never a control ("press L"). Enforced by a CI lint that fails the build on imperative control strings in UI copy.

---

## 2. The game — FIRST LIGHT, braided

**Chassis: launch-first** ("you throw your network into the sky one hand-aimed shot at a time, then live with where it lands") — won 2 of 3 judges (cold-player, pragmatist). **Braid: beam-pointing** from the operator-console vision (the optimizer judge's winner) — it fixes launch-first's one structural flaw (every fix being a capex launch) by adding a continuous, free, non-capex lever: *pointing the capacity you already own*.

### 2.1 One screen: MISSION

90% of play happens on one desktop. The loop never leaves it.

- **The orrery (≈64% width, full height) is an input device, not a picture.** Click a region → focus + demand readout. Click a sat → its loadout, beams, and load. In PAD mode the draft ring's drag handles live here. Launch events play here. It renders: labeled sats, flow particles on serving paths, link arcs (thickness = capacity, fill = utilization, amber pulse ≥80%), **gray queue-rings of unserved demand accreting around regions** (the "someone is waiting" read), demand meter rings, day/night terminator (demand follows local solar time — see §2.5), beam cones.
- **Right rail (≈36%), three zones:** TOP = **TENDERS & CONTRACTS** (rows: region chip + three SLA pips LAT/AVAIL/BW + pay + term bar + **offer-expiry clock**; hover lights the region and its serving path on the globe). Pressing PAD swaps this zone to the **VEHICLE BUILDER** — no desktop switch. MIDDLE = **THE WIRE** (SYSTEM.LOG reborn: acquisitions, link losses stamped with geometric cause + time, breach warnings, fault telegraphs, tender dispatches; click a line → the camera flies to the entity). BOTTOM = **LEDGER STRIP** (wallet, net €/min sparkline) + **FLEET STRIP** (sat chips: tier glyph + load bar).
- **Bottom status strip:** time controls (1×/8×/30×), next-pass clock ("NORTH HAVEN: coverage gap in 02:14"), alert lamps.
- **Cross-highlight is structural:** each contract owns a hue shared by its tender row, region fill, flow pulses, and capacity-bar segments. Selection anywhere lights everywhere.
- The other WM desktops become **secondary instruments** (parse/ledger review, reference), summonable via the rail as today — but no loop beat *requires* leaving MISSION. The tiling WM and 1-bit chrome stay exactly as they are.

### 2.2 The launcher — design → aim → commit → fly

**PHASE 1 — DESIGN (the vehicle builder).** Pick a bus tier (T1 Smallsat 1G+1S, T2 Comsat 2G+2S purchasable from the start; T3/T4 rendered but locked "flight-proven required"). Fill slots by dropping **antenna cards** into sockets — G slots take BROADCAST / ACCESS / GATEWAY, S slots take CROSSLINK (LASER greyed). Every card carries CAPACITY and PRICE — **this is where per-sat bandwidth is born** (§2.4). The builder renders the sat's port map in plain words ("1 ACCESS + 1 CROSSLINK: serves one footprint, relays one hop — needs a GATEWAY sat in crosslink range to land traffic"). Live mass → live cost that updates as altitude is dragged in phase 2. Presets are starting *loadouts* only — **aim is never preset**. Batch stepper 1..6; an "even spread" helper spaces markers in *your* plane (tedium removal) — N, the plane, and any hand adjustment stay yours.

**PHASE 2 — AIM (the globe is the controller).** Live traffic dims; a dashed DRAFT RING appears with its one-orbit ground-track ribbon and footprint brushing the surface. The grammar: **pull the ring in/out = altitude** (footprint, period, cost, latency chip follow; at GEO the ring snaps-with-resistance and the ribbon collapses to a point, labeled PARKS); **drag the node handle = RAAN**; **drag the apex handle = inclination** (ribbon amplitude follows — a 62°N region visibly stays outside the ribbon until inclination reaches its latitude); **slide sat markers along the ring = phase**, per-marker for batches. Every handle also nudges with arrow keys, and a **typed-numeric orbit readout ships as a first-class equal — built BEFORE the drag handles** (all three judges; it de-risks the hardest UI and is the bot/accessibility path). The key instrument is the **COVERAGE COMB**: for the focused region, a timeline strip of the truthful line-of-sight windows this exact draft produces over one orbit — facts only (LAW 1): no WILL-SERVE, no NEED-4, no auto-target. Draft crosslink/gateway reach shows as dashed potential edges.

**PHASE 3 — COMMIT & FLY.** Itemized sheet (bus + antennas + launch base + mass × Δv-factor), risk % (maiden flight 0%; then base ~3% + per-tier mass), two-step ARM → LAUNCH. **The event, 15–20 real seconds, sim-driven at fixed tick (deterministic, replayable):** countdown with klaxon-shaped audio → ascent arc bends into the draft ring → cutoff → DEPLOY (batch members pop at their phase marks, per-sat thunk) → FIRST ACQUISITION (each sat ring-pulses, draws its first link; if it serves the focused region the dark dither **floods with signal color** — the "I made it reach there" hit, staged as the event's payoff). **Failure drama** (seeded rolls consumed in the action applier, replay-safe): rare full loss (arc breaks, "VEHICLE LOST", money and batch gone); the *common* flavor is **seeded underburn → paid circularization** (€300 button on the sat's own map label) and **partial deploy** ("SAT-9 NO SEP" — you got N−1 and your hand-placed phasing now has a hole *you* decide to live with or fill). Unskippable for the first 3 launches; hold-space-to-skip after; a bot skip-action exists for playtests.

### 2.3 The pointing verb — beams (the braid)

Sats don't serve automatically. **ACCESS and GATEWAY antennas are spot beams assigned to exactly ONE region/ground-station at a time** (new replay-safe action `net_assign_beam`); BROADCAST floodlights its whole footprint, its units shared across every latency-tolerant contract in view (asymmetry identity intact); CROSSLINK auto-meshes (the router's job, as today). Offered load flows through assigned pipes; fair-share within a pipe; over-capacity bites binary on the bandwidth axis exactly per the existing router semantics — so when the Act-3 squeeze fires, an over-cap pipe visibly carries and drops *multiple* contracts.

**Re-beaming is instant and free but un-serves someone** — the continuous intervention between launches, the optimizer's cheap lever, and the answer to "the game can't be dragging 3 sliders": the mid-game hands are *point, trade, time* — not just buy. Act-1 cold-start guard: the first sat's beam auto-*proposes* (pulsing cone onto the obvious dark region); the player's click commits it. Assists propose; the hand commits.

### 2.4 Per-satellite bandwidth (the user directive, made a game)

Capacity lives in **antennas, not a hidden constant**: a sat's usable throughput is the min along its path (access-side vs relay/gateway-side), so **loadout composition is capacity design**. Starting cards (all TUNABLE): ACCESS-S 60u/€1.5k · ACCESS-L 120u/€3.5k · GATEWAY 200u/€5k · CROSSLINK 80u/€2k · BROADCAST 150u-down-0-up/€2.5k.

- **The consolidate-vs-split bet, priced to tempt:** one T2 with 2×ACCESS-L = 240u in one launch, ~25% cheaper per unit — but one place at a time, one fault domain, and only 2 beams. Three T1s = 180u, dearer — but beams, positions, phase spread, and independent fault domains. **Beam count is the second scarcity** that keeps the choice off a spreadsheet.
- **Anti-win-button, by geometry not rulebook:** escalation grows demand where you serve, so any fixed fat sat is outrun; a fat LEO moves away, a fat GEO carries the 240 ms floor, and two regions outside one footprint can never share one spot beam. The Act-3 telegraphed fault targets the **highest-load sat** — fair, warned, and precisely the consolidator's sat.
- **Overclock** (per-antenna "run hot": +50% units, raised causal fault rate) is the spec §5.2 efficiency-vs-fragility dial promoted to a verb. *Explicitly the first scope cut if the build slips.*
- The UI never prints €-per-unit; it shows port maps, combs, and load — a unit of capacity is worth what it can reach from where it is.

### 2.5 Demand, economy, and the multiplexing heartbeat

- **Offered load follows local solar time** (deterministic diurnal curves keyed to the sweeping terminator — regions brighten toward local-evening peak) with **demand archetypes** (business-day / residential-evening / event-spike) and seeded bursts. Peaks are non-coincident by longitude — **statistical multiplexing becomes a visible, living bet**: commit 3×50u over a 120u gateway because peaks don't coincide — until escalation makes them coincide.
- **The economy theorem: one contract can never pay for its own honest provisioning.** Sharing is forced from Act 2 on; margins come from multiplexing judgment, not from printing money. Penalty asymmetry ~2×: a wrong signing is strictly worse than not signing. Offers carry expiry clocks; accept timing is a real decision (term/avail metering starts on accept after a printed grace).
- **Numbers (starting guesses, TUNABLE):** start €40,000; first launch ≈ €21,400 (most of the wallet — stakes from minute one); per-sat opex drain by tier (€/game-hr); time controls 1×/8×/30× (no 100×; terms sized to the hour). Reputation floor: PROBATION tier with guaranteed baseline offers (no soft-lock).

### 2.6 The acts — open problems, not instructions

- **ACT 1 (0–10 min) — first light.** One latency-tolerant tender, wallet pressure, the full launcher loop. Winnable by default *in the spec's sense* — a straightforward GEO broadcast solves it — but **the pre-aim is dead**: the draft ring spawns parked 90° west of the target, footprint visibly missing, and the player drags it home (the gate's hand-aim criterion, felt not enforced). ~7 real decisions by minute 10 (accept timing, loadout, regime, aim, park bias, tempo, second-tender triage). Maiden flight risk-free.
- **ACT 2 (10–30 min) — the availability wall.** A 62°N low-latency tender: GEO fails on latency *by physics shown in the instruments* (240 ms chip vs 150 ms SLA), a single LEO's comb shows ~20% duty — the wall is *felt in the comb*, never announced. The player builds a phased constellation by hand (helper spaces evenly; N/plane/phase theirs), watches hand-offs snap beam-to-beam. First sharing pressure (second contract over the same gateway).
- **ACT 3 (30–50 min) — strain, faults, re-taming.** Escalation congests what success built; latency + bandwidth SLAs bite together; the chaos kitten arrives mild-first (degradation → telegraphed failure aimed at the highest-load sat). The pressure levers, in cost order: **re-beam (free) → prefer-weights (free) → overclock (risky) → aimed relief launch (capex)**. The parse/trace earns its verdicts here — post-hoc SPOF and waste readings of the network that actually ran.
- **ACT 4 (50–60 min) — Mars teaser.** As specced (reuse the existing packet-crawl + one cache breadcrumb + "to be continued"). Near-zero new code.

### 2.7 What "more than 3 sliders" means, enumerated

Accept-or-hold (timed) · bus tier · antenna cards per slot · batch size · altitude (drag/typed) · inclination · RAAN · per-marker phasing · park bias / pre-positioning · beam assignment + re-beaming · per-contract prefer weights · overclock · circularize-or-abandon after underburn · tempo. Fourteen distinct decision surfaces, each with a stated trade-off, most recurring.

---

## 3. Build plan — phased, playtest-loop-gated

Everything sim-side carries: clock/RNG/action-log/replay/goldens (one coordinated re-pin per phase, SD-40 discipline), ephemeris/orbit math, router core + fair-share + binding-axis diagnosis, contract state machine, scenario gating engine, escalation law, orrery pipeline, tiling WM/rail, WIRE/log. **Dies:** net-launch/net-contracts/net-prefer panels, the objectives copy system, all verdict strings, the 5-desktop loop-scatter, `NET_LINK_CAPACITY_UNITS` as a uniform constant.

- **R0 — substrate (sim only):** antenna cards + per-antenna capacity + `capacityForSat`; `net_assign_beam` action + beam state in the fold; diurnal/archetype offered_load; economy re-derivation (theorem, opex, penalties); launch event as sim-tick sequence + underburn/partial-deploy rolls. One golden re-pin.
- **R1 — first playable (MISSION shell):** MISSION desktop; tenders/WIRE/ledger rails; typed-numeric PAD (no drag yet) + coverage comb; accept→design→aim→commit→fly→beam→serve loop bot-playable end-to-end. **Playtest gate: Act 1 delivers ≥5 real decisions cold, zero instructions.**
- **R2 — the hands:** draft-ring drag grammar + handles; launch-event staging/audio-shape; queue-rings, flow particles, load arcs, handoff snaps. **Playtest gate: aim-by-drag feels better than typed (else typed stays primary and drag ships as polish).**
- **R3 — the hour:** Act 2–3 beats on the real systems (availability wall, sharing, escalation, fault spectrum incl. highest-load telegraph, overclock, prefer weights), earned parse/trace. **Playtest gate: the consolidate-vs-split fork is taken both ways across seeds (pick-rate 20–80%), and `bandwidth` recurs as a binding constraint after any comsat launch.**
- **R4 — the gate:** Act 4 teaser fencing + the two-layer M1 gate run (≥5 cold testers, user-run).

**Standing falsifiers (bot-measurable every phase):** decision-count on the golden path; both forks viable; no imperative control strings (CI lint); no cached derived UI strings; Act-1 time-to-first-served within the gentle-opener envelope; the whole loop drivable by Playwright on stable selectors.

---

## 4. Risks (named by the judges, carried openly)

1. **The comb is load-bearing and abstract** — if a minute-2 novice can't read it, the aim loop stalls. Mitigation: it fills *as you drag* (cause→effect teaches it); queue-rings give the payoff read. Falsifier at R1 gate.
2. **3D drag handles are the hardest UI in the plan.** Mitigation: typed/keyboard path ships first and stays first-class; drag is R2, cuttable to polish.
3. **Beam assignment is the costliest new sim surface** (action kind, fold, router coupling). Mitigation: scoped to one-target ACCESS/GATEWAY assignment; crosslinks stay auto; overclock is the first cut.
4. **Economy re-derivation touches every number.** Mitigation: the theorem is a test ("no single contract pays its own honest provisioning"), asserted in Vitest, not hoped.
