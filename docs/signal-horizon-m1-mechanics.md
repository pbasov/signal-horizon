# SIGNAL HORIZON — M1 Mechanics Specification
### v0.1 · the concrete spec · companion to GDD v0.8 + implementation-plan v0.2.1

> **What this document is, and why it exists.** The GDD is the *feelings-and-philosophy* doc — it says what the game should *feel* like and *why*. That was correct for deciding what game this is, but it is the reason the first prototype had a beautiful orrery and **no gameplay**: we handed an agent feelings without mechanics. This document is the opposite register. It is **concrete, numeric, and implementable** — data structures, verbs with costs, tick order, fault rules, a minute-by-minute scenario. Where a number is a balance knob we haven't tuned, it is written as a **`TUNABLE`** with a starting guess, not omitted. An implementer (human or agent) should be able to build M1 from this without making a design decision.
>
> **Scope: M1 only — the fun-gate.** Not the coverage grid (M2), not the leverage curve, not the full information economy. M1 is the *connectivity-construction game* that has to pass the kill-gate (GDD §9, plan §6). It is an **Earth-orbit satellite-ISP puzzle** that *culminates* in the first taste of Mars / light-delay / freshness — and then deliberately stops (Act 4 is a fenced teaser, not a system to build).
>
> **One section is deliberately unfinished:** the routing solver & cost metric (§7) is marked `TO SETTLE` — it's the one remaining design atom and will be specified next. Everything else is locked.

---

## 0. The M1 core, in one paragraph

You run a satellite ISP. **Demand arrives as standing connectivity contracts** — pre-shaped SLAs ("connect region X to the ground network at ≤latency, ≥availability, ≥bandwidth"), paid continuously while met, breached when not. Your verbs are **launch** (pick orbit + satellite loadout via a planner that shows the consequence before you commit; pay cost, accept risk; a batch arrives) and **tune routing** (by exception — the solver auto-routes, you bias it). A **deterministic solver** builds the best relay topology it can *from the satellites currently in orbit*, re-solving as orbital geometry moves links in and out of view; when it **can't** meet a contract it **diagnoses its own shortfall** ("availability breaks 8 min/orbit, no sat covers X in this window"), which is what turns "solver says no" into "I launch *that*." The skill is **constellation design** — choosing orbits and loadouts so your contracts stay met *as everything moves* — and the core tension is **oversubscription under moving geometry**: scarce antennas can't honestly cover every contract's peak, so you share infrastructure and cut it as thin as you dare. Your own success grows demand and congests shared paths, breaking contracts you'd already satisfied (the escalation engine), which drives the next launch. The hour culminates in reaching Mars and feeling, for the first time, that **the signal is slow** — the hook into the whole campaign.

---

## 1. The satellite — the atom

A **satellite** is: an **orbit** (set at launch, §3), a **bus tier** (its size/power/cost class, which fixes its slot layout), and a set of **typed antenna slots** filled with **antennas** chosen at launch from unlocked tech.

### 1.1 Bus tiers (the "units")

A bus tier fixes a **slot count and slot-class profile** — the unit's physical shape. You cannot rearrange slots; a different layout means a different bus. (This is the "units" legibility: buses come in recognizable classes.) Within the slots, you pick specific antennas at launch (§1.2) — that's the loadout (floor: a sensible default loadout, one click; ceiling: customize per contract).

Slot classes: **G** = ground-class slot (holds a ground-facing antenna: BROADCAST / ACCESS / GATEWAY). **S** = sat-link-class slot (holds CROSSLINK or, if unlocked + tier permits, LASER).

| Tier | Bus class | G slots | S slots | Mass (launch cost driver) | Typical orbit | Identity |
|---|---|---|---|---|---|---|
| 1 | **Smallsat** | 1 | 1 (CROSSLINK only) | light `TUNABLE ~150kg` | LEO | Cheap access tiler. One footprint, one relay link. The bread-and-butter early unit; deploy in numbers. |
| 2 | **Comsat** | 2 | 2 (CROSSLINK) | medium `TUNABLE ~700kg` | LEO/MEO | Bigger access + real relaying. The distribution entry. |
| 3 | **Trunk sat** | 1 | 2 CROSSLINK + 1 LASER-capable | heavy `TUNABLE ~2500kg` | MEO/GEO | Aggregator with one foot on the backbone. First LASER slot. *(LASER tech itself is a later unlock — the slot can exist before you can fill it.)* |
| 4 | **Backbone platform** | 0–1 | 1 CROSSLINK + 4 LASER | very heavy `TUNABLE ~6000kg` | GEO / high-MEO | Pure spine. The §4.3a backbone node. |

**Progression / unlock ramp (M1 uses mostly Tier 1–2; 3–4 are late-M1/M2):** start tiling Tier-1 access sats for coverage → Tier-2 for bigger footprints and the first sat-to-sat relaying → Tier-3 when you must aggregate and span distance → Tier-4 laser backbone when spanning the globe / heading interplanetary. Each tier is also a launch-cost and risk step (heavier = costlier, riskier — §4), so "three cheap access sats or one expensive relay" is a real call.

> **`TUNABLE`** — slot counts and the tier ladder are balance knobs. The *shape* (access→distribution→backbone, laser scarce and high-tier-only) is locked; the exact numbers are not.

### 1.2 Antenna types (the connection roles)

Five types, splitting along **what they connect** and **directionality**. An antenna has: type, **gain/range**, **beam cone** (wide = covers a footprint / forgiving pointing; narrow = precise pointing, needs stable relative geometry), **bandwidth**, and **directionality** (symmetric vs. asymmetric).

| Type | Connects | Cone | Bandwidth | Directionality | Role / notes |
|---|---|---|---|---|---|
| **BROADCAST** | sat → ground (passive receivers) | wide | high *down*, ~none *up* | **asymmetric** (fat down, thin/no up) | Cheap ground receivers. The GEO broadcaster's tool. Great for weather/content distribution to many passive terminals; **cannot do bidirectional**. |
| **ACCESS** | sat ↔ customer terminal | wide-ish | moderate | symmetric | The LEO access workhorse for real two-way service. Customer terminals pricier than broadcast receivers, cheaper than gateway dishes. |
| **GATEWAY** | sat ↔ your ground station | narrow | high | symmetric | Your high-capacity downlink to the terrestrial internet. Few, expensive, precise. |
| **CROSSLINK** | sat ↔ sat (RF) | medium | modest | symmetric | The distribution-layer relay link. Forgiving pointing, modest range. |
| **LASER** | sat ↔ sat (optical) | very narrow | very high | symmetric | The backbone spine. Long range, huge bandwidth, hard pointing (needs stable relative geometry). **Scarce — high-tier buses only** (§4.3a terminal-scarcity lever). Later unlock. |

**The topology this produces:** `customer → ACCESS sat → [CROSSLINK/LASER relays] → GATEWAY sat → your ground network`. Customer-facing (ACCESS/BROADCAST) vs. your-own-infrastructure (GATEWAY) vs. inter-sat (CROSSLINK/LASER) is a clean three-way distinction that *is* the connectivity puzzle.

> **`TUNABLE`** — all antenna numbers (range, cone angle, bandwidth, cost). Locked: the five types, their roles, and BROADCAST's asymmetry (it's what makes GEO a broadcaster, not a comms sat — §2).

---

## 2. Orbit regimes & the GEO/LEO physics axis (a permanent strategic axis, not a phase)

Altitude is not a tier you outgrow — it's a **standing tradeoff selected by the contract's SLA shape**. Four physical properties move together with altitude, and the player learns them by needing them:

| Property | LEO (~550 km) | MEO (~8,000 km) | GEO (~36,000 km) |
|---|---|---|---|
| **Footprint** (coverage per sat) | small (must tile many) | medium | huge (~⅓ of Earth) |
| **Latency floor** (hop, one way) | ~few ms | ~tens of ms | **~120ms one-way, ~240ms round-trip — a hard floor** |
| **Reach / link difficulty** | easy (close; cheap terminals) | moderate | hard (far; high-gain needed; **expensive/asymmetric uplink**) |
| **Per-user bandwidth** | high (small footprint, fewer users sharing) | medium | low (huge footprint shares the pipe) |
| **Motion** | fast (passes overhead; **needs constellation for continuous coverage**) | moderate | **stationary** (parks over a spot) |
| **Lifetime / decay** (M2 — §6) | short (~5yr, decays) | long | effectively permanent |

**The consequences that make orbit choice a permanent decision:**
- **GEO is a *broadcaster*, not a comms workhorse.** Its ~240ms round-trip floor means it *physically cannot* meet a low-latency SLA, ever. Its asymmetry (cheap fat downlink, expensive thin uplink) makes it ideal for *broadcast to many passive receivers* (weather, content) and poor for bidirectional service. **Latency SLA is the natural enemy of GEO.**
- **GEO is also a good *backbone anchor*** — when the SLA wants high uptime/throughput and *doesn't* care about latency. Same physics (high + stable + far), two role applications, both gated by the latency ceiling.
- **LEO is the bidirectional access workhorse** — low latency, high per-user bandwidth — *but it moves*, so a single LEO sat can't hold a region; you need a **constellation** that hands off as sats rise and set. This is the source of the core puzzle.
- **A latency-tolerant broadcast contract → GEO is the cheap elegant answer. A low-latency bidirectional contract → you need a LEO constellation and GEO can't help.** The SLA selects the regime.

**This is transferable knowledge (GDD §3a):** these are the real tradeoffs of real orbital comms. A player who learns "GEO can't do low latency, LEO needs a constellation" has learned something true outside the game.

> GEO-broadcaster and GEO-backbone are **roles that emerge from combining primitives** (a mid/high-tier bus + GEO orbit + BROADCAST or LASER antennas), not bespoke units. The physics does the rest.

---

## 3. The launch planner — the verb of "launch"

Launch is **not** piloting (no ascent minigame — GDD Pillar 2). The player chooses an orbit and a loadout via a **planner that shows the consequence before commit**, pays cost, accepts risk, and a **batch of sats arrives in the chosen orbit/plane**.

### 3.1 The planner (floor + ceiling)
- **Presets are the floor:** one-click starting points at sensible parameters — "LEO access," "GEO broadcast," "Molniya high-latitude," "MEO relay." Most launches: pick a preset, go.
- **Parameters are the ceiling:** from a preset you can drag **altitude**, **inclination**, **phase**, **RAAN**. As you drag, the orrery shows — *truthfully and predictably* — the resulting **footprint**, **ground track**, **orbital period**, **latency floor**, and an **overlay of the contract's coverage gap you're trying to fill**. You're not "setting inclination to 53°," you're "dragging the orbit until its ground track covers the region that's currently dark," and the number follows.
- **First two parameters that matter (expose these first):** **altitude** (footprint/latency/reach — the GEO/LEO axis) and **inclination** (which latitudes you can cover — makes "this region is too far north for GEO" legible).

### 3.2 The planner design rule (LOCKED — this is the spec's most important UX principle)
> **The planner shows truthful, predictable consequences of any choice before commit (never a slot machine). The assist provides a viable-but-imperfect starting point (never an optimal one). Closing the gap between viable and optimal — and noticing when "viable" is actually broken — is the player's game.** Adequate by default, optimal earned, **failure always reachable.**

A planner that *solves* the puzzle for you is a vending machine, not a game. The assist's job is to remove *tedium* (suggest a sensible N-sat phasing to start from), never to remove *the decision* (you still must notice it under-covers at the poles / breaks during the conjunction / rides too close to the latency ceiling, and fix it).

### 3.3 Constellation phasing (the assist seam)
A region a single LEO sat can't hold continuously needs several sats **evenly phased** so that as one sets, another rises. The planner **assists** ("to maintain coverage of X you need ≈4 evenly-phased sats — place the set?") and gives a **viable-but-imperfect** result; hand-tuning phase/RAAN is the ceiling. *(Degree of assist — how good the suggested constellation is, how much it deliberately leaves broken — is a `PLAYTEST KNOB`, not a spec-time number. Lean: viable-but-flawed, never perfect.)*

### 3.4 Launch as a batch
A launch puts **N sats into a plane** (you don't economically launch one at a time). "Deploy a constellation" = one launch action → a batch. This reinforces constellation-as-a-unit and (M2) the replenishment-flow. M1 launch is **minimal**: pick orbit + loadout + batch size, see cost + risk, commit, batch arrives. *(Launch-cadence, rideshare→dedicated→owned provider progression, and interplanetary windows are GDD §4.7 — **M2**, not M1.)*

### 3.5 Launch cost & risk (M1, minimal)
- **Cost** = f(total payload mass, destination Δv). Higher/farther = dearer. `TUNABLE`.
- **Risk** = a failure probability per launch (launch failure loses the batch; partial-deployment failure loses some). `TUNABLE`, low enough not to feel arbitrary. Insurance is a € market — **flag M2** (don't build the insurance market in M1; a flat risk % is enough for the gate).

---

## 4. Demand — standing connectivity contracts

Demand is **not** discrete packages — you provide a **service**. A contract is a standing SLA, paid while met, breached when not.

### 4.1 Contract shape (arrives pre-shaped; player accepts, does not author)
```
Contract {
  endpoints:     region/point A  ↔  ground-network (or A ↔ B)
  sla_latency:   max ms            (e.g. 200)   — or "latency-tolerant" (broadcast)
  sla_avail:     min %             (e.g. 99.0)
  sla_bandwidth: min Gbps          (e.g. 10)     — the *committed* floor
  offered_load:  varies over time, can exceed or fall below sla_bandwidth   (§4.3)
  pays:          €/sec while SLA met
  penalty:       €/sec or reputation loss while breached; drops if breached too long
}
```
The player's only authoring act at the floor is **accept this contract**. (Composing/negotiating intents is a ceiling/later concern.)

### 4.2 Serve-or-breach (the heartbeat)
A contract is **met** when the solver currently has a path A→ground that satisfies *all three* SLA axes simultaneously. It **breaches** the moment any axis fails — and the most common breach is **availability**: a LEO sat sets, no other covers the gap, the path vanishes until the constellation re-forms. Continuous satisfy-or-breach, evaluated every tick, is the early-game's pulse. **This is a coverage/availability/latency/bandwidth gauge — NOT a freshness gauge.** Freshness does not exist on Earth (§8).

### 4.3 Oversubscription — the core optimization tension (the early-game's "freshness")
`offered_load` varies and can exceed `sla_bandwidth`. You provision a topology to meet the SLA — but provisioning to the *peak* wastes scarce antennas/sats on rarely-used capacity, while provisioning to the *average* breaches during spikes. **The skill is statistical overprovisioning judgment:** share a backbone link across multiple contracts whose peaks don't coincide, under-provision and bet on non-coincident peaks, cut it as thin as you dare before an SLA breach costs more than the hardware you saved. This is **statistical multiplexing / oversubscription** — real ISP engineering (transferable knowledge), and it's the early-game's tame-the-sprawl tension: *N contracts, M sats, honest provisioning needs ~2M sats — how cleverly do you share?* The optimizer's parse (M2) will show *which links are overprovisioned (wasting hardware) and which ride too close to breach.*

### 4.4 The SLA-axis teaching ramp (introduced one at a time across the session — §9)
1. **Connectivity** — is there a path at all? (Act 1–2)
2. **Availability** — does the path hold continuously as sats orbit? → forces constellations. (Act 2)
3. **Latency** — is the path short enough? → wrong orbit / too many hops = too slow → forces better topology & exposes the GEO ceiling. (Act 3)
4. **Bandwidth** — does the path have capacity? → antenna/link limits → forces parallel paths / better hardware / oversubscription judgment. (Act 3)

---

## 5. Faults — the resilience validator (the chaos-kitten)

Faults exist to **force the player to build redundancy and good self-healing routing, and to test it** — to convert "did you build resilience?" from an invisible virtue into a visible, tested outcome. This is what makes the routing/topology layer *deep* rather than a one-time shortest-path solve. Faults are **distinct from decay** (§6): decay is predictable economic aging; faults are the resilience test. They are often lumped together but do opposite jobs.

### 5.1 The fault spectrum (mild → severe; the gradation is the craft)
| # | Fault | Recoverable? | Warned? | Teaches | M1? |
|---|---|---|---|---|---|
| 1 | **Degradation** | yes, self-recovers | no | leave capacity headroom (pairs with oversubscription §4.3) | **yes — the first fault the player meets** |
| 2 | **Transient outage** | yes, brief | no | need a backup *path*; self-healing reroute proves itself | yes |
| 3 | **Telegraphed failure** | — (you act before it dies) | **yes — warning + countdown** | watch fleet health, act on early warning *fairly* | **yes — your "telegraphed event"** |
| 4 | **Hard failure** | no, permanent | no | you can't watch your way out of single-point-of-failure; only *built-in redundancy* survives it | **rare**; ramp in late-M1, full force M2 |

The player meets faults **mild-first**: a degrade (low stakes, teaches headroom), then a telegraphed fault (teaches watch-and-act, *fair* because warned), with hard random failure rare in M1 and arriving in force at M2. **Start as a chaos *kitten*, not a chaos monkey:** it degrades and warns, rarely kills, teaches you to build well before it ever tests you hard.

### 5.2 Causal + rare-random (two mechanics, two jobs — LOCKED)
- **Causal faults** — fault probability is **raised by player choices**, so faults are a *risk surface you manage*, not bad luck you endure:
  - **Overclocking:** running an antenna/link past its rated bandwidth raises fault risk. *(Overclocking is real and cool — more throughput now, higher failure rate. A genuine tradeoff.)*
  - **Cheap buses:** lower tiers have higher base fault rates.
  - **Low orbits:** more drag/thermal cycling → faster degradation (bridges to decay, §6).
  - **Age:** older sats fault more (bridges to decay).
  - Teaches: *your decisions have reliability consequences you can reason about.*
- **Rare random faults** — an **irreducible floor** you cannot prevent by playing well. Their specific job: punish absence-of-redundancy that causal faults don't, so that even the conservative player (premium buses, no overclocking, high orbits) who's driven controllable risk near zero **still** finds redundancy worth building. *No strategy reaches zero failure.* **Rare** — common enough to keep redundancy honest, rare enough to read as "bad luck, I should've had a backup," never "the game is punishing me."

**The interplay is the depth — two archetypes fall out of one mechanic:** *overclock-and-mesh* (push hardware hot, build redundant, bet that fast reroute covers the higher fault rate — high-throughput/high-churn) vs. *premium-and-sparse* (reliable hardware, fewer nodes, lean on low fault rate). Both valid; no single dominant strategy. This is the network engineer's real reliability-vs-throughput tradeoff, and it's *yours*.

### 5.3 Faults ride the diagnostic view (no separate UI)
A degrading/faulting sat is surfaced on the orrery (node pulses amber as it degrades) and in `SYSTEM.LOG` ("`SAT-7 thermal fault · bandwidth degraded 40% · est. recovery 3min`"), with a countdown for telegraphed failures. The **same trace/diagnostic view that shows why the solver routed as it did also shows which nodes are sick** — one legibility system, double duty.

> **`TUNABLE` / `PLAYTEST KNOB`:** all fault rates, the causal multipliers, the rare-random floor, and *when in the session faults first appear* (§9, Act 3). Locked: the spectrum, causal+rare-random as distinct mechanics, mild-first introduction.

---

## 6. Orbit decay — `M2`, NOT M1 (recorded here so it isn't lost)

Decay is **real, altitude-driven, and an altitude *decision*, not per-tick upkeep** (pure upkeep is the boring end of the sim — the chore taming exists to escape). **It is deferred to M2** (M1 sessions aren't long enough for lifetime to matter, and adding it muddies the gate). Recorded so the design isn't lost:
- **Real numbers for reference:** a ~550km LEO sat (Starlink-class) has a ~5-year life — partly *deliberate* (low enough to self-deorbit when dead, a debris-mitigation choice). Lower = faster decay (300km: weeks–months); higher = slower (>1000km: centuries); GEO/MEO: effectively permanent.
- **As a decision, not a tax:** at launch, "how low?" is a capex-vs-opex / latency-vs-longevity bet — low = cheaper + lower latency + better SLA-hitting, *but* shorter life + more replenishment over time.
- **LEO becomes a *flow*, not a *stock*:** a LEO constellation is maintained by replenishment (sats age out, you relaunch) — the physical-layer rhyme with the §4.10 "information is a flow you keep feeding" endgame, available early with zero freshness concept.
- **Graceful, not a cliff:** a decaying sat loses altitude → footprint/timing drift → coverage gaps creep in → SLAs start breaching → eventual deorbit. Telegraphed degradation, not a surprise.

---

## 7. Routing solver & cost metric — `TO SETTLE` (the one remaining design atom)

This is the last unspecified atom and will be drafted next. Locked so far (from design discussion):
- **A deterministic solver, NOT a real protocol engine.** It *borrows the mental model* of OSPF/BGP (link-state cost metrics, shortest-path, policy/preferences) so the player's knowledge is transferable — but underneath it is a clean, deterministic shortest-path-over-time-varying-graph solver (Dijkstra/A* on the current line-of-sight adjacency, re-solved on **topology-change events**, not every tick). **Determinism is preserved** (GDD §4.1/§6 golden-master) — no real-daemon timers, concurrency, flap-damping, or real-world calibration. Reasons a real FRR engine is rejected: it destroys determinism, it's tuned to *avoid* the constant reconvergence our orbital gameplay *requires*, and it's fidelity the player can't perceive (Pillar 2).
- **OSPF-interior early, BGP-peering later.** Early game = OSPF-flavored cost-metric tuning over *your own* constellation (internal, geometric, latency-driven). BGP-flavored policy (peering, trust, "don't route gov traffic over rival X," economics) enters with the **peering layer — later/M2+**, mirroring reality (OSPF = your interior, BGP = between autonomous systems).
- **Floor / ceiling / power-user, three tiers of control:** (floor) auto-solve, player just watches; (ceiling) tune cost metrics + policy via sliders + a visual constructor — *Cisco Packet Tracer as the reference for fun*; (power-user) type **FRR-style config into the terminal** — authored to map onto *our* solver's parameters, not real FRR.
- **The solver diagnoses its own shortfall.** When it can't meet a contract it must surface the **binding constraint and the kind of fix** ("latency floor 340ms via 4 LEO hops; a GEO relay at [point] → 180ms but you have none"; "availability breaks 8min/orbit; need ≥1 more sat in this plane"). The solver doesn't just route — it points at the gap. This *is* the trace/diagnostic view, and it's an **M1 necessity** (without it the tune-by-exception verb is unplayable and "solver says no" is opaque).

**Still to decide (the §7 draft):** what a link's cost is *derived from* (raw latency? player-set weight? inverse bandwidth? a blend?); what the solver optimizes by default (lowest-latency path that meets SLA? cheapest? most-reliable?); what the **first** thing the player gets to tune is (per-link weight? per-contract priority? a global "prefer latency vs. prefer reliability" slider?); and how the visual constructor + slider UX maps to the terminal config.

---

## 8. What is explicitly NOT in M1 (scope fences)

To stop the spec ballooning back into a feelings doc, these are **named and fenced out**:
- **Freshness, caching depth, the information economy** — Act 4 introduces the *concepts* as a teaser (§9), but the full freshness/prefetch/coherence/parse/currency system is **post-gate, not yet designed**. Do not build it from this doc.
- **The coverage hex grid** — M2 (GDD §4.2). M1 demand is region/point endpoints, not a per-cell field.
- **Decay** (§6 — M2), **insurance market** (§3.5 — M2), **launch-cadence/rideshare/owned-launch progression** (§4.7 — M2), **interplanetary launch windows** (M2/M4).
- **BGP peering, trust, inter-operator economics** (§7 — later; M1 routing is OSPF-interior over your own fleet).
- **The leverage curve / tech-tree depth** (GDD §4.11 — post-gate). M1 has the *minimum* bus/antenna unlock ramp needed for the session, not a designed tree.
- **Rivals / emergent-narrative generator** (GDD §3 — M2). M1's tension is endogenous (your own success), not competitive.

---

## 9. The one-hour scenario — the gate's curriculum (M1-12, expanded)

The M1 session is **not a flat slice** — it is a **sequenced ~60-minute experience with an onboarding curve inside it**, ending on the Mars hook. The hour (not half-hour) is a *stronger* gate: 30 minutes can pass on novelty alone; an hour forces the *loop* (escalation, the optimizer pull) to carry it once novelty wears off, and it lets at least one full **tame → outgrow → re-tame** cycle complete. **M1-12 is therefore the onboarding curriculum, not just "set up a conjunction" — it's as much a design artifact as the mechanics.**

### Act 1 — Coverage (~0–10 min)
One region, latency-tolerant. The player launches one sat (preset: GEO broadcast, *or* a single LEO pass) and **sees signal reach the region** — the "oh, I made it reach there" hit. Core verbs only: launch → connect → served. No SLA stacking, no faults, no failure. *Teaches: the launch→planner→serve loop, and reading the orrery.*

### Act 2 — Connectivity + the constellation (~10–30 min)
A new region a single sat **can't hold** (high latitude GEO can't reach, or A↔B across the curve). The player hits the **availability** wall — one LEO sat covers it only while overhead — and must build a **constellation** (the planner assists with phasing; the result is viable-but-imperfect). They watch hand-offs as sats rise/set; the path forms, breaks, re-forms. First **oversubscription** pressure appears (a second contract sharing infrastructure). *Teaches: availability → constellations, the planner's ceiling, sharing scarce capacity. The Earth game proper.*

### Act 3 — Strain, faults, and re-taming (~30–50 min)
- **Escalation:** the player's success **grows demand** on served regions (network effect) and **congests** shared paths → contracts they'd satisfied start riding close to breach. They must re-engineer / launch more — the first full **tame → outgrow → re-tame** cycle.
- **Latency + bandwidth SLAs** now bite (a contract demands low latency → the GEO ceiling is felt; a contract demands high bandwidth → antenna/link limits → parallel paths or better hardware).
- **The chaos-kitten arrives, mild-first:** a **degradation** (recoverable, teaches headroom — and bites the player who over-cut oversubscription), then a **telegraphed fault** (warned, teaches watch-and-act). The player who built redundantly sails through; the brittle builder scrambles — *resilience becomes visible and tested.*
- **The optimizer pull appears:** the diagnostic/trace view shows *where* they're brittle or wasteful (overprovisioned links, single points of failure). *Teaches: the loop sustains past novelty; build resilient, not just cheap; the parse is worth reading.*

### Act 4 — The Mars frontier (teaser, ~50–60 min) — **concepts only, fenced (§8)**
The session **culminates** in reaching toward Mars — and the player's Earth playbook **breaks**, which is the point (the first across-tier *invalidation*, GDD §3b / Pillar 5):
- The player places their first object near/at Mars and **sends the first signal — and watches it crawl.** The same packet-crawl visual, but now the round-trip is **minutes**. They *feel* the helplessness: you can't real-time-tune a topology when your command arrives 8+ minutes late. **Light-delay taught by sight** (§4.4), as pure visceral fact, no mechanic to optimize yet.
- **The freshness *concept* appears, not the freshness *economy*:** data from Mars **arrives old** — stamped "as of 8m ago." One demand appears that *cares* about freshness (pays less for stale Mars data), so the player feels the *shape* of the future problem. They get **one cache** to place — feel "oh, putting data closer helps" — and that's the breadcrumb. They are **not** given the full caching/prefetch/coherence toolkit (it's M2+, undesigned).
- **It stops, on purpose, on a "to be continued."** The last beat is not "you won" — it's "you've reached the frontier, and the frontier is a *different game*: light is slow, distance changes everything, caching is the answer, freshness is the new currency-to-be." The player should finish **wanting to see where it goes.**

### The gate — two-layer success criterion
Run ≥5 testers cold. The old PASS (unprompted routing/constellation tuning + blackout/fault tension + can articulate why interesting) is **necessary but not sufficient** — it proves *liveness*. The sharpened bar has **two layers**:
1. **Did the hour of Earth connectivity *sustain*?** Past the novelty of the first 30 minutes, did the escalation loop and the resilience/optimization tension keep them engaged — and did they finish an Earth contract **wanting to do it *better*** (the optimizer hook, GDD §3a)? A tester who finishes *satisfied-and-done* built a toy; one who wants the re-run felt the optimization pull.
2. **Did the Mars culmination *hook them into the campaign*?** When light-delay **broke their Earth playbook**, did they **lean in** ("I want to see where this goes") or **bounce** ("this is annoying")? This tests the *premise of the whole game*, not just the slice.

**FAIL** = wait-and-click / ignore the geometry / "a spreadsheet" / finishes-and-shrugs / bounces off the Mars hook → iterate **visualization + core + the teaching sequence** only (GDD Risk 2), re-run; 3 failed iterations ⇒ rethink the premise. **A gate that passes layer 1 but fails layer 2 means the connectivity game is fun but the interplanetary premise doesn't grab — which you must learn before building M2+.** Do not start M2 until both layers pass.

---

## 10. Open decisions (tracked)

- **§7 routing solver** — the one unspecified atom (cost derivation, default optimization target, first tunable, constructor↔terminal-config UX). Draft next.
- **Degree-of-assist on the planner / constellation phasing** (§3.3) — how viable-but-imperfect the suggestion is. `PLAYTEST KNOB`.
- **Fault timing & rates** (§5) — when faults first appear in the session, causal multipliers, the rare-random floor. `PLAYTEST KNOB`.
- **All `TUNABLE` numbers** — bus tiers, antenna characteristics, costs, risk %, SLA thresholds, oversubscription variance. To be set in playtest, not at spec time.
- **Whether a *taste* of hard random failure belongs in M1** (§5.1) or waits for M2 — leaning rare-in-late-M1; confirm at playtest.

---

*v0.1 of the concrete spec. The register here is deliberately the opposite of the GDD: numbers, structures, fences. Acts 1–3 are the buildable M1 (the Earth connectivity game); Act 4 is a fenced concepts-teaser that hooks the campaign; §7 (the routing solver) is the one atom still to settle and is drafted next. Everything marked `TUNABLE`/`PLAYTEST KNOB` is a number we set by playing, not by guessing — but the mechanics around them are locked. Build M1 from this; do not build the fenced systems (§8) from this.*

