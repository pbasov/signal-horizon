# SIGNAL HORIZON — M1 (The Fun-Gate)
### v0.2 · the Earth-orbit connectivity game · companion to GDD v0.8

> **What M1 is.** An **Earth-orbit satellite-ISP connectivity puzzle** that *culminates* in a fenced taste of Mars / light-delay / freshness. The player accepts standing connectivity SLAs, launches satellites via a consequence-showing planner, and tunes-by-exception a deterministic solver that auto-routes and diagnoses its own shortfalls. The heartbeat is **serve-or-breach** every tick across the SLA axes; the early-game optimisation tension is **oversubscription** (statistical multiplexing of shared links). An hour-long curriculum runs **Acts 1–3** (the buildable Earth game) + **Act 4** (a fenced Mars concepts teaser), state-gated so the next act opens only when the current concept is *felt*.
>
> **Why this doc exists.** The GDD is the *feelings-and-philosophy* doc. This is the opposite register: **concrete, numeric, implementable** — data structures, verbs with costs, tick order, fault rules, a minute-by-minute scenario. Where a number is a balance knob not yet tuned, it is written as **`TUNABLE`** with a starting guess, not omitted. An implementer (human or agent) can build M1 from this without making a design decision.
>
> **This document merges four prior docs** (mechanics spec, build-ready design, acts-3-4 design, onboarding script) into four parts. The `@see` comments in `src/sim/net/` point at the part + section here. The mechanics spec (Part I) is the *what*; the build design (Part II) is the *how*; the acts-3-4 design (Part III) fills the C/D build increments; the onboarding script (Part IV) is the director's script for the first hour.
>
> **Scope: M1 only — the fun-gate.** Not the coverage grid (M2), not the leverage curve, not the full information economy. The freshness/caching loop the old M1 was built around is **reclassified** to a post-gate campaign concept, teased (concepts only) in Act 4 — see Part I §8.
>
> **The spec is complete across all atoms.** The routing solver & cost metric (Part I §7) — the last open design atom — is fully specified as of v0.2. What remains open are `TUNABLE` numbers and `PLAYTEST KNOB`s (Part I §10), not design decisions.

---

# PART I — Mechanics Specification

> *Source: `signal-horizon-m1-mechanics.md` v0.2. The concrete, numeric spec — data structures, verbs, tick order, fault rules.*

## 0. The M1 core, in one paragraph

You run a satellite ISP. **Demand arrives as standing connectivity contracts** — pre-shaped SLAs ("connect region X to the ground network at ≤latency, ≥availability, ≥bandwidth"), paid continuously while met, breached when not. Your verbs are **launch** (pick orbit + satellite loadout via a planner that shows the consequence before you commit; pay cost, accept risk; a batch arrives) and **tune routing** (by exception — the solver auto-routes, you bias it). A **deterministic solver** builds the best relay topology it can *from the satellites currently in orbit*, re-solving as orbital geometry moves links in and out of view; when it **can't** meet a contract it **diagnoses its own shortfall** ("availability breaks 8 min/orbit, no sat covers X in this window"), pointing the player at the gap. The early-game's tame-the-sprawl tension is **oversubscription under moving geometry** — statistical multiplexing as gameplay.

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
`offered_load` varies and can exceed `sla_bandwidth`. You provision a topology to meet the SLA — but provisioning to the *peak* wastes scarce antennas/sats on rarely-used capacity, while provisioning to the *average* breaches during spikes. **The skill is statistical overprovisioning judgment:** share a backbone link across multiple contracts whose peaks don't coincide, under-provision and bet on non-coincident peaks, cut it as thin as you dare before an SLA breach costs more than the hardware you saved. This is **statistical multiplexing / oversubscription** — real ISP engineering (transferable knowledge), and it's the early-game's tame-the-sprawl tension: *N contracts, M sats, honest provisioning needs ~2M sats — how cleverly do you share?* The optimizer's job is to let the player see *which* links ride close to the edge, and the trace view's job is to show the over-subscription *before* it bites.

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

## 7. Routing solver & cost metric

The relay network is a **routing problem over a continuously-changing graph**: satellites are nodes, line-of-sight links are edges, and the adjacency matrix *breathes* as orbital geometry moves links in and out of view. The solver finds paths through that graph; the player shapes the graph (via constellation design) and biases the solver (via cost tuning). This section specifies the solver, its cost model, the three control tiers, and the **capability arc** the routing layer grows along (most of which is post-M1, recorded here so it isn't lost).

### 7.1 Architecture — borrow the concepts, not the engine (LOCKED)
A **clean deterministic shortest-path-over-time-varying-graph solver** (Dijkstra/A\* over the current line-of-sight adjacency), re-solved on **topology-change events** (a link enters/leaves view, a fault, a demand change), **not** every tick. It *exposes the mental model* of OSPF/BGP — link-state cost metrics, shortest-path, policy/preference — so the player's knowledge is **real and transferable** (GDD §3a: the routing concepts are true about real networks). But underneath it is **not a real routing daemon.**

**Why a real FRR/BGP engine is rejected** (this was discussed at length — recording the reasoning so it isn't relitigated):
- **Determinism.** A real daemon is concurrent, timer-driven, nondeterministic in convergence ordering — it would destroy the golden-master/replay property the whole architecture rests on (GDD §4.1/§6).
- **Real protocols are tuned for the opposite problem.** BGP is built to *avoid* reconverging (flap damping, hold timers) because in the terrestrial internet, flapping is bad. But our *entire gameplay* is constant topology change as things orbit — links are *supposed* to come and go. A real engine would either flap-damp itself useless or thrash.
- **It's fidelity the player can't perceive** (Pillar 2). The player experiences *paths forming, holding, and re-routing* — not "real BGP." We deliver that experience with a purpose-built deterministic solver that borrows the concepts, without inheriting a daemon's timers, concurrency, and real-world calibration.

### 7.2 Link cost — a physics-computed blend, weighted by traffic class (LOCKED)
The orbital-specific insight: in textbook OSPF, link cost is static (admin-set, often inverse-bandwidth). **Our links are not static — their properties change continuously with geometry** (distance drives latency *and* signal margin; a link cheap now is gone in ten minutes as sats separate). And different **contract classes care about different link properties** — so cost is not one fixed formula. It is a **blend of physics-computed terms, with weights selected by what the path is carrying:**

```
link_cost(link, traffic_class) =
      w_lat(class)   · latency_term(link)        // ∝ distance / hop count        (instantaneous)
    + w_bw(class)    · congestion_term(link)     // ∝ 1 / available bandwidth     (instantaneous)
    + w_stab(class)  · instability_term(link)    // ∝ 1 / remaining-in-view-time  (REQUIRES PREDICTION — see 7.5)
```
- The **`*_term` functions are physics** — computed honestly from geometry and current load. **Not tunable; they are truth.**
- The **`w_*(class)` weights are the design surface** — the mixing ratio is the interesting part, and it is what makes demand-shape produce topology-shape automatically:
  - **latency-critical** contract → high `w_lat` → routes the short way (rewards the LEO-mesh / short-hop topology).
  - **bandwidth/trunk** contract → high `w_bw` → routes the fat way (rewards the backbone-spine / aggregation topology).
  - **availability/coverage** contract → high `w_stab` → routes over links that *stay up* (rewards regular, stable constellation geometry — the Iridium lesson).

This is real **QoS-class / traffic-engineering routing** (different traffic classes get different path selection) — transferable knowledge, and it is *the mechanism by which the two player archetypes coexist*: the same solver, same constellation, routes a latency contract and a trunk contract **differently over the same physical links**, because their weights differ. (This is why heterogeneous demand — §4.4, the contract generator — is what creates routing agency: uniform demand collapses routing into "one boring answer," shaped demand makes it a real allocation problem.)

> **`TUNABLE`:** the default `w_*` per contract class, and the exact form of each `*_term`. **Locked:** cost is a physics-blend of latency + congestion + instability, the weights are per-traffic-class (set by demand) and player-overridable (the ceiling, §7.3).

### 7.3 Three control tiers (the floor/ceiling/power-user pattern — LOCKED)
The same cost model, exposed at three depths:
- **Floor — auto-solve.** The player does nothing. Each contract's traffic class carries sensible default weights; the solver routes; paths form. The player *watches* latency contracts take short paths and trunk contracts take fat paths. It works without intervention. *(The whole early game is playable at this tier.)*
- **Ceiling — sliders + visual constructor (the Cisco Packet Tracer layer, the reference for the fun).** The player **overrides the weights.** The first and most legible knob is a **per-contract "prefer latency ↔ bandwidth ↔ stability" control** — it directly expresses intent and visibly changes the path. (Example: a contract is met at 200ms, but the player wants *lowest possible* latency → crank `w_lat` → the solver re-solves and picks an even shorter path, perhaps the LEO route over the GEO one — *this is the GEO-fed-by-LEO lowest-latency scenario from design discussion*.) The visual constructor lets the player *see* the graph and the chosen path and drag priorities on it.
- **Power-user — terminal config (FRR-style).** The same weights plus per-link cost overrides and policy, expressed as text that *maps onto our solver's parameters* (NOT real FRR syntax): e.g. `set latency-weight 100 on contract-7`. Same machine, text interface, for the player who wants it.

> **The first thing the player tunes is a per-contract weight** (prefer-latency/bandwidth/stability). That is the answer to the long-open sub-question — it's the single most legible knob, it expresses intent directly, and it visibly moves the path.

### 7.4 The solver diagnoses its own shortfall (M1 NECESSITY — LOCKED)
When the solver **can't** meet a contract, it must surface the **binding constraint and the kind of fix** — not just "no path":
- *"latency floor is 340ms via 4 LEO hops; a GEO relay at [point] would cut it to 180ms, but you have none there."*
- *"availability breaks 8 min/orbit: no sat covers region X in this window; you need ≥1 more sat in this plane."*
- *"bandwidth saturated: this trunk link is at 100% from 3 shared contracts; add a parallel path or a higher-bandwidth antenna."*

The solver doesn't just route — **it points at the gap and the kind of hardware/positioning that closes it.** This converts "solver says no" into "I launch *that*," and it *is* the trace/diagnostic view. **It is an M1 necessity** (without it the tune-by-exception verb is unplayable and a failed solve is opaque). The same view shows fault state (§5.3) — one legibility system, multiple jobs.

### 7.5 The capability arc — reactive now, predictive (discovered) later (M1 = reactive + seeds)

This is the routing layer's progression, and it's the first concrete instance of GDD §4.11's "capability *discovered through operation*, not purchased from a menu." **Most of it is post-M1**; M1 builds only the reactive baseline and plants the seeds. Recorded in full so the M1 seeds are planted knowing where they lead.

**The reactive baseline (M1).** Cost uses **latency + congestion only** (both instantaneous; `w_stab = 0`). The solver routes for right-now and **reconverges when a link breaks**. Consequence: when a LEO link sets, the path drops, the solver re-routes, and there's a **brief outage** — survivable, masked by redundancy, but real. The player initially experiences these as noise / bad luck.

**The seed M1 must plant (REQUIRED in M1 even though prediction isn't):** the **trace/diagnostic view stamps every link loss with its geometric cause and time** — `link SAT-7↔SAT-12 lost: SAT-12 set below horizon at 14:32`. A *time*, a *cause*: geometry, not gremlins. M1 routing is reactive and the outages are real, but **the predictability is made visible from the first version** — so the later discovery has soil. *(Build this in M1. It is cheap — the sim already knows the geometry — and it is the prerequisite for the post-gate a-ha.)*

**Discovery — the predictive-routing a-ha (POST-M1).** The capability is **not** a tech-tree node. It is *discovered* via the diagnostic view, as the answer to a problem the player is actively diagnosing:
1. The player suffers repeated reactive outages on a coverage contract (a link sets every orbit).
2. Investigating the breach in the trace, they see it stamped with a clean *periodic* time — and the orrery shows the same sat setting at the same orbital point, again and again.
3. The pattern becomes unignorable: **"this isn't random — it's clockwork. It's *predictable.*"** (Ideally the player sees this before the game says anything.) The instant they think it, the next thought is automatic: *"if I know it's coming, why is my network waiting for it to happen?"*
4. **The tool surfaces exactly where the player is already looking** — the trace view shows a *forecast* ("next loss of this link: 14:32, in 6m") and offers *"route around it ahead of time."* Not bought from a menu; handed to them where their hand already was, framed as the answer to the question they just formed. The payoff: enable it, watch a path **re-route 30s before the link sets, zero outage.**

This is the **general capability-discovery template** for the whole §4.11 leverage curve, worth stating once: **operate → hit a wall → investigate the wall in a diagnostic view → recognize the pattern → the tool that scales past the wall surfaces there, as the answer to the question you just asked.** Predictive routing is the first instance. *(Honest caveat: spontaneous discovery can't be guaranteed; for players who don't connect the dots, the trace-view forecast is doing more of the work — nudged discovery. The framing must look like "information that was always there," a forecast born of knowable geometry, not an achievement-unlock popup. It should feel discovered even when surfaced.)*

**The deeper a-ha — predictive is NOT a strict upgrade; it's an efficiency-vs-resilience axis (POST-M1, the permanent strategic tension).** Turning up the predictive/stability optimization buys **efficiency** (tight schedules, pre-staged paths, no outages at scheduled link-sets) at the cost of **fragility to perturbation** — because optimized, interdependent paths *cascade* when something unscheduled hits them. *(The OpenTTD-timetable lesson: a timetabled line is efficient until one late train cascades downstream through the whole schedule. The Deutsche-Bahn lesson: same thing, real and painful.)* This couples routing to the **fault system (§5)**:
- The **perturbation** that breaks an over-optimized predictive schedule is a **fault** — and fault rate is *player-influenced* (overclocking / cheap buses / low orbits, §5.2).
- So **the fault rate determines which routing philosophy is wiser**, and neither dominates:
  - **premium-and-sparse + predictive:** low fault rate → safe to run tight predictive schedules → efficient and clean, *but* a rare fault hits the optimized schedule and browns out a region in a cascade (low probability, high blast radius).
  - **overclock-and-mesh + reactive:** high fault rate → predictive schedules would cascade constantly → run reactive with redundant paths → absorb the churn, contained failures, less efficient but **anti-fragile** (high perturbation, low blast radius per event).

These are the same two archetypes from §5.2 — now revealed as two *coherent philosophies about efficiency vs. resilience* threading through **hardware choice → fault rate → routing strategy → topology** together. This is real infrastructure-engineering truth (tight optimization vs. slack/resilience) — transferable knowledge (§3a) — and it's the routing layer's deepest mastery. The second discovery beat is the player learning, the painful DB way, that *over-optimization has a fragility cost and slack has value.*

> **`M1 scope for §7 (LOCKED):`** reactive solver (latency + congestion, `w_stab = 0`); the cost-blend structure and per-contract weight control present but `w_stab` dormant; the three control tiers (auto / sliders+constructor / terminal) present at least at floor + basic ceiling; the self-diagnosing trace view present (an M1 necessity); and the **predictability seed planted** (trace stamps link losses with geometric cause + time). **Deferred to M2+ (recorded above so the M1 seeds know where they lead):** the predictive/stability term (`w_stab > 0`), predictive routing as a *discovered* capability, the efficiency-vs-resilience/fragility-cascade tension, the routing↔fault coupling, BGP-style peering/policy across other operators, and the full visual-constructor depth.

### 7.6 OSPF-interior now, BGP-peering later (LOCKED — the routing complexity ramp)
- **Early/M1 = OSPF-flavored:** link-state cost-metric tuning over *your own* constellation. Internal, geometric, latency/stability-driven. (Everything in §7.2–§7.5 above.)
- **Later/M2+ = BGP-flavored:** policy and preferences across *other operators'* networks — peering, trust, "don't route my gov-contract traffic over rival X," inter-operator economics. Mirrors reality (OSPF = your interior IGP; BGP = between autonomous systems). This is where routing meets the competitive/economic layer, and it pairs with the rivals/peering systems (GDD §3, §4.3) — **all deferred, recorded here so the ramp is explicit.**

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

The M1 session is **not a flat slice** — it is a **sequenced ~60-minute experience with an onboarding curve inside it**, ending on the Mars hook. The hour (not half-hour) is a *stronger* gate: 30 minutes can pass on novelty alone; an hour forces the *loop* (escalation, the optimizer pull) to carry it once novelty wears off, and it lets at least one full **tame → outgrow → re-tame** cycle complete. **M1-12 is therefore the onboarding curriculum, not just "set up a conjunction" — it's as much a design artifact as the mechanics.** The full director's script is in **Part IV**.

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

## 10. TUNABLE / PLAYTEST KNOB summary (M1)

Locked shapes vs tunable numbers, collected in one place:

- **Locked (design shapes, not numbers):** the 4 bus tiers (access→distribution→backbone, laser scarce + high-tier-only); the 5 antenna types + BROADCAST asymmetry; the GEO/LEO physics axis (GEO ~240ms RTT is a HARD floor); demand as standing SLAs paid-while-met; the SLA-axis teaching ramp (one at a time); oversubscription as statistical multiplexing; the fault spectrum (degrade→transient→telegraphed→hard); causal + rare-random as distinct fault mechanics; mild-first fault introduction; the §7 cost-blend (physics `*_term` + per-class `w_*`); reactive solver M1 (latency + congestion, `w_stab=0`); the self-diagnosing trace (M1 necessity); the predictability seed (geometric cause + time stamp); the one-hour four-act curriculum; the two-layer gate.
- **`TUNABLE` (balance knobs, starting guesses):** bus slot counts + mass; antenna range/cone/bandwidth/cost; launch cost formula + risk %; SLA thresholds (latency/avail/bandwidth values); link capacity; `w_*` default weights per class; fault rates + causal multipliers; the `activeAxes` mask thresholds that flip axes on.
- **`PLAYTEST KNOB` (feel, tuned at the gate):** degree-of-assist on the planner (viable-but-flawed); fault *timing* (when in the session the first fault appears); the strain threshold (how many simultaneous contracts before the player feels it); the oversubscription variance (how bursty `offered_load` is).

---

# PART II — Build-Ready Design

> *Source: `signal-horizon-m1-design.md`. The file-level design for `src/sim/net/` — namespace, interfaces, determinism, the Act-1 slice. This is the "how" of the mechanics spec.*

> **Status / supersession.** This is the FINAL, build-ready design for **M1 as one game** — the real connectivity/coverage + launch-planner + routing-solver + fault systems running under a curated, state-gated arrival sequence, with **Act 1 as the first build-and-prove slice**. It **supersedes** the isolated Act-1 prototype plan (the bent-pipe reachability stub, co-located ground, EIRP-clip forced imperfection, `windowCoverage`/0.85-bar, throwaway golden — all DROPPED). What is KEPT from that stopped build: the spinning-Earth rotation frame, the toy-radius GEO-parks pacing, the sat atom.
>
> **Scope.** Acts 1–3 are buildable on one set of real systems; Act 4 is a fenced concepts-only teaser. **Cardinal rule: one new concept per act, never a second until the first is FELT.** The systems run for real; only the order contracts/faults arrive is scripted. Emotional arc: competence → challenge → mastery-under-pressure → vertigo.

## II.1. MODULE / NAMESPACE LAYOUT

### Namespace decision

- The OLD `src/sim/m1/` (21 files: `cache.ts`, `economy.ts`, `coherence.ts`, `feeds.ts`, `demand.ts`, `resolver.ts`, `policy.ts`, `parse.ts`, `scenario.ts`, `session.ts`, …) is the **reclassified cache-economy (Act-4 teaser)**. It owns golden `544847093270497462n` (`src/sim/m1-session-replay.test.ts`).
- The new connectivity game spans Acts 1–3 (one game, four gated beats). Naming it `a1/` would mislabel it as an Act-1 prototype — the exact contraption-trap framing the brief warns against.

**Chosen namespace: `src/sim/net/`** ("the network game"). Two reasons over `conn/`: it reads as the whole connectivity/routing/coverage game (not just "connectivity axis 1"), and it leaves room for the §7 router which is the spine of Acts 2–3. The new game imports **neither** `m1/` **nor** `m2/session.ts`. It MAY import small **pure, axis-agnostic helpers** from `m2/contracts.ts` (the serve/breach term-accrual transitions — see §II.2.2 reuse decision) and from `coverage/field.ts` (the link-budget formulas) and `delay.ts` (light-delay, Act 4 only); none of these pull in a session or a golden.

> **The `m1/` → `m1-economy/` rename is DEFERRED, not part of this build.** The critique confirmed it is **not** zero-touch: it touches **7 import sites** across `sim` AND `panels` AND `main`, including `m2/session.ts:38` (`import { M1Economy } from "../m1/economy"`) — a file that owns the M2 golden path. `net/` collides with nothing and imports neither, so there is no need to risk the M2 golden during the new-game build. If ever done, do it as an isolated increment-0 that rewrites all 7 sites and re-runs **both** existing goldens byte-for-byte before any `net/` work. **Recommendation: leave `m1/` alone; the `net/` name already removes the ambiguity for the new game.**

### File layout — `src/sim/net/` (all pure sim; no three, no DOM, no wall-clock, splitmix64 only)

| File | Responsibility | Origin |
|---|---|---|
| `world.ts` | Toy-radius pacing + world constants + `resolveOrbit` + `launchCost`. The locked **ratio** (GEO period == rotation period ⇒ parks). | **Migrate** `a1/world-a1.ts`. Drop nothing here — but the EIRP-clip "closing-lever" doc framing does not move (EIRP stays a real antenna field, never a forced-imperfection knob). |
| `frame.ts` | Spinning-Earth rotation frame: `earthThetaAt`, `rotZ`, `bodyFixedToInertialDir`, `inertialDirToBodyFixed`, `surfacePointInertial`. | **Migrate** `a1/frame-a1.ts` unchanged (locked by `frame.test.ts`). |
| `sat.ts` | The satellite atom: `BusTier`, `AntennaType`, `AntennaSpec`, `NetSat { id, orbit: SatOrbit, bus, loadout[] }`. | **Migrate** `a1/sat.ts`. **Drop `A1_DISH_EIRP=1.1`** and its "closing lever" framing (EIRP stays a real antenna field used by the link budget, NOT an Act-1 imperfection). |
| `endpoint.ts` | Demand geometry: `Region` (geodesic disc, body-fixed) + `GroundNet` (the ground-network endpoint). **Decoupled** Fibonacci sampler `sampleRegionPoints` + `coveredFraction(region, n, isCoveredAt)` taking a generic `(point, t) => boolean` callback. | **Migrate** `a1/region.ts` geometry; **REWORK** the co-located `A1Ground` into a real `GroundNet` endpoint; **decouple** from `pointReachable`. **Drop** `minFraction`/`meanFraction` `windowCoverage` + `A1_AVAILABILITY_BAR` (the 0.802/0.85 forced-imperfection machinery). |
| `contract.ts` | The unit of demand: **all three SLA axes present in the struct** + a per-axis **gate mask** (`activeAxes`) + `prefer` weight + `payPerSecond`/`penaltyPerSecond`/`offeredLoad`. Field NAMES + state machine **identical to `m2/contracts.ts`** (reuse decision §II.2.2). The contract is the teacher. | **New struct, shared vocabulary** — reuses the m2 serve/breach transition helpers. |
| `link-budget.ts` | The physics: elevation gate + inverse-square budget + line-of-sight on the spinning frame. The `*_term` truth functions (latency, congestion; `instability` present but zero-weighted). | **New**, reusing `coverage/field.ts` **formulas** (elevation `sin(el)=normal·dirToAsset≥SIN_MIN_ELEVATION`, inverse-square `received=eirp·(REF/d)²≥1`) with `net/`-local constants. **Replaces** `a1/reachability.ts`'s bent-pipe leg helpers as a generic edge predicate. |
| `router.ts` | The §7 solver: line-of-sight adjacency over `{sats, groundNets}` at `t`, shortest path by `link_cost`, re-solved on topology-change events. Returns `{served, path, latencyS, bindingConstraint, losses}` per contract. Trivial path-existence Act 1 → reactive latency+congestion blend by Act 3, `w_stab=0`. | **New.** **Subsumes** `a1/reachability.ts`. |
| `trace.ts` | The self-diagnosing view (M1 necessity): `diagnose(solverResult) → Shortfall` — the binding constraint + kind-of-fix + the **predictability seed** (every link loss stamped with geometric cause + time). | **New.** |
| `fault.ts` | The fault spectrum: `Degradation | TransientOutage | Telegraphed | HardFailure`; causal (player-raised probability) + rare-random (irreducible floor), both off a seeded splitmix64 stream. Absent Acts 1–2; mild-first Act 3b. | **New.** |
| `session.ts` | `NetSession` — the live mutable world: roster + contracts + wallet + RNG + faults + scenario cursor; `step(eph, t, dt)` (serve/breach + scenario gate + faults + escalation) + `snapshot()` for the fold. Mirrors the `BuildSession` live==replay shape. | **New** (pattern from `m2/session.ts`). |
| `apply-action.ts` | The shared applier `applyNetAction(eph, session, action, dt) → result \| null` — the SAME path live and replay use. | **New** (pattern from `m2/apply-build-action.ts`). |
| `scenario.ts` | The **state-gating engine** (§II.3): the authored arrival sequence as a pure data table + a deterministic gate evaluator. The ONLY scripted layer. | **New.** |

### Migrate vs drop, explicitly

- **Migrate (unchanged behavior):** `frame-a1.ts → frame.ts`, `world-a1.ts → world.ts`, `sat.ts → sat.ts` (minus `A1_DISH_EIRP`), the geometry half of `region.ts → endpoint.ts`. Carry their tests (`frame.test.ts`, `pacing.test.ts`, `region.test.ts`, `purity.test.ts`) into `src/sim/net/`, re-pointing imports.
- **DROP / REWORK (the contraption trap, confirmed in code):**
  - `a1/reachability.ts` — the bent-pipe REGION→SAT→GROUND stub (`pointReachable`, `legDistanceIfClosed`, `bestEirp`, `A1_MIN_ELEVATION_RAD=20°`, `A1_REF_LINK_DISTANCE_M=(a−R)·1.15`). Its own header says "When the §7 routing solver lands it subsumes this." → **replaced** by `router.ts` + `link-budget.ts`. Keep `reachability.test.ts` / `reachability.winnable.test.ts` **philosophy** (winnable-by-default) but retarget at the router, and **strengthen the assertion** (see §II.5).
  - The **co-located ground station** (`A1Ground`, lat-28 same-meridian, `region.ts:70`) → rework into `GroundNet` as a real ground-network endpoint.
  - The **EIRP-clip forced imperfection**: `A1_DISH_EIRP=1.1` (`sat.ts:52`), `A1_MIN_ELEVATION_RAD=20°` chosen so the lat-30 poleward edge clips (`reachability.ts:49`), and `windowCoverage.minFraction=0.802` / `A1_AVAILABILITY_BAR` (`region.ts:159`). **Act 1 has NO forced imperfection.** The link budget stays real; Act-1 geometry is chosen so the default GEO simply covers the **whole** region disc (binary SERVED) — re-derived and pinned in §II.5.
  - Any **throwaway golden** for the slice — the new game gets its **own** session + **own** golden (§II.4).

---

## II.2. THE REAL SYSTEMS + INTERFACES (designed to generalize across all four acts)

### II.2.1 Satellite / orbit / antenna model (migrated, unchanged)

- **Frame (`frame.ts`):** Earth spins +Z, θ(t)=ω·t. Surface points (regions, ground nets) ride the spin via `surfacePointInertial`; **orbits stay inertial and unforked** (`solveOrbit` from `m2/orbit.ts`). Locked invariant.
- **Pacing (`world.ts`):** `A1_BODY_RADIUS_M=300_000`, `GEO_PERIOD_S=240`, `LEO_PERIOD_S=150`, semi-major from the **unforked `EARTH_MU`**, so `A1_EARTH_OMEGA_RAD_PER_S == √(μ/a³)` bit-equal (pinned by `pacing.test.ts`; body-fixed GEO spread ~1.5e-13° over a period). GEO parks; LEO sweeps the full 358° of body-fixed longitude. Toy scales are explicit Act-1 toys; the **ratio** is the faithful part.
- **Sat atom (`sat.ts`):** `NetSat { id, orbit: SatOrbit, bus: BusTier, loadout: AntennaSpec[] }`. `SatOrbit` is the m2 type as-is (`parentId, aM, e, incRad, raanRad, argpRad, m0Rad, epochS, muParent`), so a launched net-sat propagates bit-identically to m2/ephemeris. **Generalizes:** more bus tiers / antenna types / slot classes drop in as enum members + loadout entries; frame + pacing never change.

### II.2.2 Connectivity/coverage model + the contract — REUSE DECISION (resolves med-issue "contract drift")

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

### II.2.3 The launch planner (consequence-preview; presets-as-floor, params-as-ceiling)

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

### II.2.4 The routing solver (§7 M1-scope) + per-contract weight + trace + predictability seed

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
  - The **event set** that triggers a full path re-solve is: a launch/commit, a fault state change, a demand/escalation change, **AND a horizon rise/set** (a node crossing an endpoint's elevation gate). The horizon event is essential: even the parked equatorial GEO's geometry is technically t-dependent (the region rides θ(t)), but for a perfectly parked GEO the relative geometry is time-invariant, so it produces **no** horizon event and re-solves only on the launch. A **non-covering LEO** (the Act-1 fallback case) **sets continuously**, which IS a per-tick horizon event — so the cached path is invalidated and re-solves to UNSERVED, and the gentle shortfall fires. Without horizon events in the trigger set the LEO-SWEEP fallback would never re-solve and the as…
  - **Cheapest correct M1 form (document this split):** each tick, cheaply **re-evaluate the cached path's link predicates** (each link's elevation+budget+LoS — O(sats), trivial in Act 1) to set `served`/`breach`; only **re-run the shortest-path search** on a discrete topology change in the event set above. So serve/breach is per-tick-truthful; Dijkstra is event-driven.
- **Growth, no rework:**
  - **Act 1:** one parked GEO ↔ one region ↔ one ground net → trivial path-existence. Degenerate but the **real** solver.
  - **Act 2:** adjacency "breathes" as LEO sats rise/set; paths form/break/re-form; availability-class routing reacts.
  - **Act 3:** latency + congestion both bite; first per-contract `prefer` override by exception; over/under-provisioned links surface.
- **Trace (`trace.ts`)** converts "solver says no" → "I launch *that*": availability breaks N min/orbit (need ≥1 more sat in this plane) / latency floor too high (a GEO relay at [point] cuts it) / bandwidth saturated (add a parallel path). Same view shows fault state. Carries the predictability seed (`link X↔Y lost: Y set below horizon at 14:32`). **Act 1 face:** only the gentle "footprint does not reach [region]; try this preset" — without doing it for the player.

### II.2.5 The fault spectrum (`fault.ts`)

- Spectrum mild→severe: `Degradation` (recoverable, unwarned), `TransientOutage` (brief reroute), `Telegraphed` (warning + countdown), `HardFailure` (permanent; rare/late-M1). Two mechanics, two jobs: **causal** (probability raised by overclock/cheap-bus/low-orbit/age) + **rare-random** (irreducible floor). Chaos kitten, not monkey. Rides the diagnostic view — no separate UI.
- **Both draws come off a seeded splitmix64 stream owned by `NetSession`** (replay-safe, exactly the M2 launch-failure-roll pattern). **Absent Acts 1–2** (the scenario keeps the fault generator disabled); **mild-first in Act 3b** (a degradation, then a telegraphed failure), **fenced behind 3a re-stabilization** (§II.3). Rates/timing are PLAYTEST KNOBs.

### II.2.6 The self-diagnosing diagnostic / trace view

`trace.ts` is the live face of the solver across all acts (Act 1 gentle assist → Act 3 optimizer pull). It must **log truthfully from day one** (the full achievable-optimum parse is M2+). It is the single surface for shortfalls **and** fault state.

---

## II.3. THE STATE-GATING ENGINE (`scenario.ts`)

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

The escalation theme (3a) and the fault theme (3b) are **distinct `scenarioCursor` entries that emit in sequence**, so faults are fenced behind escalation re-stabilization (Part IV Act 3: faults begin "not before" re-stabilization, "because faults on an unstable network would just be noise"). The shared **act3** human-acceptance gate (one theme, "mastery under pressure") is the *conjunction* of 3a and 3b having been demonstrated; internally the cursor still steps 3a → 3b.

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

## II.4. DETERMINISM + GOLDEN

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

## II.5. THE ACT 1 SLICE, PRECISELY (on the real systems; WINNABLE BY DEFAULT, NO forced imperfection)

- **Cold open:** the player opens to the orrery with **one thing lit** — `INBOUND CONTRACT — [Region: equatorial, latency-tolerant]` over one highlighted region; everything else quiet/dimmed. The contract struct has all three axes but `activeAxes={connectivity}`, so the UI reads the mask and **hides** avail/latency/bandwidth. Binary `SERVED`/`UNSERVED`.
- **The default that already mostly works:** the planner opens pre-seeded to the **GEO PARK** preset — an equatorial GEO (`incRad=0`, `semiMajorM=A1_GEO_SEMI_MAJOR_M`, `subLonRad` over the region's meridian). Because GEO period == rotation period, it **parks** over the region. Winnable by pressing LAUNCH on the default.

- **THE ACT-1 GEOMETRY MUST-FIX (resolves the HIGH-severity issue) — re-derive and pin "the WHOLE disc is served at eirp 1.0, no clip":**
  - Drop the inherited clip tuning. Specifically **delete** from the migration: `A1_DISH_EIRP=1.1`, `A1_AVAILABILITY_BAR`, `windowCoverage`/`minFraction`/`meanFraction`, and the `20°` `A1_MIN_ELEVATION_RAD`. Do **not** reuse the lat-30 region, the 20° mask, or the `(a−R)·1.15` reference distance on a re-centered region — those were deliberately tuned so only the **centre** reaches at eirp 1.0 and the poleward **edge** clips.
  - **Re-center equatorial and choose covering constants.** Pick the Act-1 region center at **lat 0** (equatorial), choose a **region radius `NET_ACT1_REGION_RADIUS_RAD`** and an **elevation floor `NET_MIN_ELEVATION_RAD`** (default to `field.ts`'s real `MIN_ELEVATION_RAD = 5°` unless a derivation shows otherwise) and an antenna `eirp = 1.0` such that **every Fibonacci sample of the disc is reachable from the parked GEO with margin** — not just the centre. The parked equatorial GEO sits at the region's nadir, so the worst-case point is the disc edge; size the radius so the edge's slant range + elevation clear the budget and the gate **with headroom**.
  - **Pin it in the retargeted `reachability.winnable.test.ts`** as the explicit assertion **`coveredFraction(region, N, isCoveredAt) === 1.0`** at `eirp = 1.0` (the WHOLE disc served, no clip), plus a margin assertion (e.g. worst-sample elevation ≥ floor + a documented headroom, worst-sample received ≥ 1 + headroom) so a future constant nudge cannot silently re-introduce an edge clip. This is the single Act-1 gate that proves "no hidden partial-coverage forced-imperfection."

- **The loop:** LAUNCH → the sat appears in its parked GEO → `router.solve` finds the trivial path region→sat→groundNet → contract flips `UNSERVED→SERVED` (servedFraction 1.0 → shared `stepActiveContract`) → revenue ticks (`payPerSecond` accrues into the wallet every step while served). That is the entire Act-1 game.
- **Completion gate:** `gate(): one contract served AND balance rising (revenue positive)`. The moment the first contract is SERVED and €>0, Act 2 may open.
- **Gentle shortfall fallback (assist at its most helpful):** if the player launches a non-covering orbit (e.g. LEO SWEEP, which sets — re-solving to UNSERVED via the horizon-event trigger in §II.2.4) or idles past a generous window, `trace.diagnose` surfaces *"footprint does not reach [region]; try a lower inclination / this preset"* — pointing at the fix without doing it for them. The spinning Earth makes the parked equatorial GEO hold the region forever, so "place one thing works."
- **What must NOT exist in Act 1:** no forced imperfection, no motion-management, no relay/sat-to-sat, no coverage-fraction tuning, no faults, no second SLA axis, no throwaway golden.

---

## II.6. VISUALIZATION FOR ACT 1 (make-or-break)

The render layer reads pure `NetSession` state; it never feeds back into the sim. Reuse `orrery/orrery.ts` + `orrery/coverage-overlay.ts` + the panels.

- **The spinning globe at the toy radius.** Add a **net render mode** to `orrery.ts` that applies the **Decision-G de-squash override scoped to net mode only** — the globe is sized to `A1_BODY_RADIUS_M` (300 km) with orbits fanned out to `A1_RENDER_BAND_M` (`world.ts` already exports `1.2·A1_GEO_SEMI_MAJOR_M`), and the de-squash `surfaceM` + billboard/shell radius are driven from `A1_BODY_RADIUS_M`, **not** from `eph.radiusMeters("earth")=6371 km` (or the three radii log-fold to sub-pixel). **M2/M3 visuals are untouched** (the override is gated behind the net-mode flag; the existing roster render path is unchanged). The globe rotates by `earthThetaAt(t)` so the parked GEO visibly holds station over the lit region.
- **The region lights up.** The highlighted region renders dim (UNSERVED) and lights to a "served" color the instant `router.solve` reports `served` — the single legible state change.
- **The footprint.** Before commit, the planner preview draws the GEO's footprint disc overlaid on the region (truthful consequence-preview, via `previewLaunch`); after launch, the live footprint sits parked over the region. The coverage-overlay heatmap is the existing component.
- **The launch→cover→paid causal chain (the make-or-break beat):** press LAUNCH → sat fades in at its parked GEO point → footprint disc snaps over the region → region lights SERVED → the finance panel ticks up. Three linked, immediate, causal events: *I placed one thing, it covers there, I'm paid.* That is competence, felt.

---

## II.7. INCREMENTAL BUILD PLAN

Each increment is sized for one Build→Verify subagent, with its tests and acceptance. **Act-1-shippable** increments first (the smallest provable-fun slice), then Acts 2→3→4 as gated beats on the **same** systems.

### Phase A — shared systems + Act 1 (ALL Act-1-shippable)

**A0. Namespace + migrate atoms.** Create `src/sim/net/`; migrate `frame.ts`, `world.ts`, `sat.ts` (drop `A1_DISH_EIRP`) and the geometry half of `region.ts → endpoint.ts` (drop the co-located-ground + `windowCoverage`/`A1_AVAILABILITY_BAR`). Carry `frame.test.ts`, `pacing.test.ts`, `region.test.ts`, `purity.test.ts`. **Re-center the Act-1 region to lat 0** and introduce `NET_ACT1_REGION_RADIUS_RAD` + `NET_MIN_ELEVATION_RAD` constants (the §II.5 must-fix prep). *(The `m1/`→`m1-economy/` rename is DEFERRED — not in this build.)*
- **Tests:** migrated physics-gates (frame ±1e-13, pacing ω==n bit-equal, Fibonacci band) + purity scan pass under `net/`.
- **Acceptance:** `npm test` green; the two existing goldens (`544847093270497462n`, `8431658617016421069n`) still pass byte-for-byte. *(Act-1-shippable.)*

**A1. Link budget + router (path-existence) + the WHOLE-DISC pin.** `link-budget.ts` (elevation + inverse-square + line-of-sight on the spinning frame, reusing `coverage/field.ts` formulas with `net/` constants) and `router.ts` `solve()` in its degenerate path-existence form (region→sat→groundNet), returning `{served, path, latencyS, bindingConstraint, losses}`. Implement the §II.2.4 re-solve split (per-tick cheap predicate re-eval incl. horizon rise/set; event-driven Dijkstra). Replaces `reachability.ts`.
- **Tests (physics-gate, the §II.5 HIGH must-fix):** retarget `reachability.winnable.test.ts` to assert **`coveredFraction === 1.0` at eirp 1.0** for the parked GEO over the equatorial region (WHOLE disc, no clip) + a worst-sample margin assertion; LEO-SWEEP single sat is **not** served (it sets) and a link-loss stamp records the geometric cause + time; the LEO non-cover re-solves to UNSERVED via the horizon event.
- **Acceptance:** parked GEO serves the whole disc with margin; sweeping LEO does not; the gentle-shortfall trigger fires. *(Act-1-shippable.)*

**A2. Contract + session + apply-action (SHARED state machine).** `contract.ts` (three axes + `activeAxes` mask + `prefer` + the shared field names + `SLA_AXIS_ORDINAL`); `session.ts` (`NetSession.step` computes `servedFraction` from the router and calls the **imported** `stepActiveContract`/`stepOfferedContract`/`BREACH_GRACE_SECONDS` from `m2/contracts.ts`; revenue accrual; `snapshot()`); `apply-action.ts`; the new action kinds in `action.ts` (`net_launch` radians/SI + `count`, `net_accept`, `net_set_prefer`). **Write the contract-reuse decision into `docs/decisions.md`** (§II.2.2 rationale).
- **Tests:** serve/breach toggles on coverage via the shared helper; revenue accrues while served; DT-invariant revenue (1× vs coarse dt) like the M2 test; `applyNetAction` no-ops on unknown kind; one assertion that the breach-grace constant is the shared `BREACH_GRACE_SECONDS` (not a `net/` copy).
- **Acceptance:** accept→serve→€ loop closes in-session on ONE state machine. *(Act-1-shippable.)*

**A3. Scenario engine + Act-1 beat + the M1 golden.** `scenario.ts` with the `act1` beat (`emit` one connectivity-only contract; `gate` = served + €>0; `fallback` gentle correction) and the cursor wired into `step` (with separate `act3a`/`act3b` placeholders in the table so the granularity is structural from the start). Create `src/sim/net-replay.test.ts` with seed `4242424242424242n`, the state-hash fold (incl. the fixed-ordinal `activeAxes` fold), and the **pinned golden**.
- **Tests (golden + determinism):** replay-twice bit-identical; live==replay; SaveGame JSON round-trip reproduces the hash; the Act-1 gate fires deterministically at the right tick; the two old goldens untouched.
- **Acceptance:** golden pinned; Act-1 scenario deterministic end-to-end. *(Act-1-shippable.)*

**A4. Act-1 planner + visualization.** `previewLaunch` (footprint/track/period/latency preview via the router); orrery **net render mode** with the scoped Decision-G de-squash; region light-up; launch→cover→paid chain; finance panel tick.
- **Tests:** planner preview matches post-launch solve (consequence-preview is truthful); a render-mode unit check that net mode does not alter M2/M3 sizing.
- **Acceptance (human, Act-1 gate Layer 1 in miniature):** a cold tester presses the default LAUNCH and is paid within the idle window; the causal chain reads. **This is the smallest provable-fun slice — Act 1 ships here.**

### Phase B — Act 2 (gated beat on the same systems; NOT Act-1-shippable)

**B1. Constellation routing + availability axis.** Extend `router.solve` to multi-sat hand-off (adjacency breathes as LEO sats rise/set; re-solve on the §II.2.4 topology events). Add the `act2` beat: `emit` the second contract with `availability` added to `activeAxes` (now visible); `gate` = continuous coverage via ≥2 sats across ≥1 hand-off cycle; `fallback` = co-phasing specificity. Constellation-phasing assist in the planner (viable-but-imperfect). Batch `count>1` launch.
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

---

# PART III — Acts 3 & 4 Design (Build-Ready)

> *Source: `signal-horizon-m1-act3-act4-design.md`. Companion to Part II (M1 as one game). Produced + adversarially verified read-only while Phase B (Act 2) built. Build C (Act 3) then D (Act 4) on the net/ systems after Act 2 lands + is golden-re-pinned. The two existing goldens stay untouched; the net golden re-pins per phase.*

## III.A — ACT 3: strain + faults (mastery-under-pressure)

Mastery-under-pressure, two sub-beats, one theme. Grounded in Part IV Act 3 (lines 92-123) + mechanics §4.3/§4.4/§5/§7.2-7.5 + design §2.4/§2.5/§2.6/§3a/§3b.

Act 3 fills the existing `act3a`/`act3b` scenario stubs and adds two standalone files (`fault.ts`, `trace.ts`). It does **not** reshape the `SolveResult` return `{served, path, latencyS, bindingConstraint, losses}` nor the four-tuple verdict. It DOES make four small **additive** interface extensions (all signature-stable on returns).

### The two-line contract of Act 3 (what the player must FEEL)

- **3a — your success bites you.** A well-served region's `offeredLoad` rises (escalation, gated ON here), shared links ride near capacity, a peak tips a comfortable contract toward breach. The player re-engineers (parallel path, or `net_set_prefer` by exception) and re-tames. The `latency` then `bandwidth` axes activate one at a time — the GEO ceiling and the link-capacity limit, *felt*. The router's reactive cost-blend (`latency_term + congestion_term`, `w_stab` dormant) decides paths.
- **3b — faults degrade it (fenced structurally behind 3a's cursor gate).** Off the seeded splitmix64 the session already owns, a mild-first spectrum begins: a `Degradation`, then a `Telegraphed` failure. Causal probability (low-orbit / age live this hour; overclock / cheap-bus hooks present but neutral) plus a rare-random irreducible floor. The trace surfaces resilience shortfalls (overprovisioned links, SPOFs) and stamps every loss with cause + time (the predictability seed).

### The four ADDITIVE interface extensions (verified against BUILT code)

These are the only interface changes. None reshapes a return type; all are backward-compatible so `previewLaunch`, the A1/A2 tests, and the cheap re-eval compile and behave identically when the new optionals are absent.

| # | File:loc | Extension | Why | Back-compat default |
|---|---|---|---|---|
| E1 | `router.ts` `RoutableContract` | add `prefer?: PreferWeights`, `slaLatencyS?: number` | the blend reads `prefer.{lat,bw,stab}` + the latency-axis reads `slaLatencyS`, but `RoutableContract` carries only `{id,region,activeAxes?}`. The full `Contract` is a structural supertype and supplies them at runtime — but the TYPE must surface them. | absent ⇒ `prefer = NET_DEFAULT_PREFER`, `slaLatencyS = Infinity` ⇒ identical Act-1/2 routing |
| E2 | `router.ts` `solve(...)` | add ONE trailing optional `loadBySat?: ReadonlyMap<string, number>` | the congestion term needs the shared-load aggregate; `faults?` is already the last param, this sits after it. Return UNCHANGED. | absent ⇒ `congestion_term = 0` ⇒ pure latency routing |
| E3 | `router.ts` `topologyKey(...)` + `resolveTick(...)` | `topologyKey` folds a **congestion fingerprint**; `resolveTick` gains trailing optional `faults?` + `loadBySat?` and forwards them to `solve` | the session calls `resolveTick` (NOT `solve`); `resolveTick` re-solves only on a `topologyKey` change, and `topologyKey` ignores demand/load — so a rising `offeredLoad` produces NO re-solve. Design §2.4 itself requires "a demand/escalation change triggers a re-solve." | absent ⇒ empty congestion contribution to the key ⇒ identical fingerprint to today |
| E4 | `contract.ts` (sat side) + `link-budget.ts` | add `NET_LINK_CAPACITY_UNITS` constant (per standard antenna; uniform in C1, bus-varied in C2) | capacity must live somewhere `congestion_term = load/capacity` can read it | n/a (new constant) |

**E3 detail — the congestion fingerprint (the fix):** extend `topologyKey` to append a **quantized escalation epoch** rather than the raw float load (raw floats would re-solve every tick and defeat the cache). The session keeps a per-step integer `congestionEpoch` that increments whenever ANY contract's quantized `loadBySat` bucket changes OR a contract crosses the bandwidth-axis threshold. `topologyKey` becomes `${contract.id}|${satIds}|${faulted}|${congestionEpoch}`. A congestion change ⇒ epoch bumps ⇒ fingerprint changes ⇒ full re-solve through the cached path. This keeps the cheap-re-eval cache (it doesn't re-solve when load is static) while honoring design §2.4. `resolveTick` forwards `faults`/`loadBySat` to its internal `solve` call so the re-solve is load-aware.

### C1 — Sub-beat 3A: escalation + oversubscription + latency-then-bandwidth axes + reactive cost-blend + first prefer-override

**C1.1 — The escalation law (`session.ts` extends; present-from-day-one, gated ON in 3a).**
`Contract.offeredLoad` already exists and already folds. Escalation is a **pure, deterministic** growth of `offeredLoad` on contracts being served well, run in `step` only when `escalationOn` is true. `act3a.emit` flips the flag (it "enables a generator," never touches physics — the emit contract).

Add to `NetSession`:
- `private escalationOn = false;` — folded as int 0/1; set true by `enableEscalation()`.
- In `step`, after serve/breach + revenue, a pure `stepEscalation(dt)`: for each `active` contract whose `lastServedFraction >= ESCALATION_SERVE_THRESHOLD` (= 1.0, served well), grow toward a ceiling: `offeredLoad = min(ESCALATION_LOAD_CEILING, offeredLoad + ESCALATION_RATE_PER_S * dt)`. DT-invariant (rate×dt, single clamp at the ceiling — mirrors the single-clamp discipline so coarse vs fine dt converge).

**Determinism:** pure function of `(servedFraction, offeredLoad, dt)` — no RNG. Folds via `offeredLoad` (already in `netStateHash`).

**C1.2 — Oversubscription / congestion (`contract.ts` + `router.ts` + `session.ts`).**

**Capacity (E4):** `NET_LINK_CAPACITY_UNITS` on the sat/antenna side (units matching `offeredLoad`). Uniform per standard antenna in C1; bus/overclock variation arrives in C2 (degradation haircut).

**The congestion term (cost-blend, §7.2):** the router currently returns the **first** bridging sat. Extend `solve` to compute, over each candidate bridging sat, a **cost** and pick the **minimum** (still O(sats) — the degenerate-Dijkstra the header promises):

```
link_cost = w_lat·latency_term + w_bw·congestion_term + w_stab·instability_term
  latency_term     = up.latencyS + down.latencyS         (already computed in bridgeForPoint)
  congestion_term  = sharedLoadOnSat / linkCapacity      (∝ 1 / available bandwidth)
  instability_term = 0                                    (w_stab DORMANT — M1 LOCKED)
  w_lat = contract.prefer.lat,  w_bw = contract.prefer.bw,  w_stab = contract.prefer.stab
```
`prefer` + `slaLatencyS` are read off the E1-widened `RoutableContract` (defaulting when absent). `sharedLoadOnSat = loadBySat.get(satId) ?? 0` (E2). No `loadBySat` ⇒ term 0 ⇒ exact Act-1/2 routing. Return struct **unchanged**.

**THE SERVE VERDICT — binary on the bandwidth axis.** The original pro-rata `servedFraction = min(1, capacity/load) ∈ (0,1)` is **broken under the BUILT state machine**: `stepActiveContract` resets `breachSecondsAccum=0` on ANY `servedFraction>0` and accumulates breach ONLY at `servedFraction==0`. A pro-rata fraction therefore never accrues breach, so oversubscription could never tip a contract near-breach and the C1.6 re-tame gate (keyed off `breachSecondsAccum`) could never fire. **Fix:** the bandwidth axis bites **binary, exactly like the latency axis** —
- when `activeAxes.has("bandwidth")` AND the bound sat is over capacity (`congestion_term >= 1`, i.e. `sharedLoadOnSat >= linkCapacity`): `served = false`, `bindingConstraint = "bandwidth"`, **servedFraction 0** for that contract. Now `breachSecondsAccum` accrues toward `BREACH_GRACE_SECONDS` and the re-tame is detectable through the UNCHANGED shared helper.
- The latency-axis bite is the same binary shape: `activeAxes.has("latency")` AND realized `latencyS > slaLatencyS` ⇒ `served=false`, `bindingConstraint="latency"`, fraction 0 (a GEO path at ~340 ms fails a low-latency SLA; a LEO/short-hop passes — the GEO ceiling, felt).

If a non-binary "near-breach" *readout* is wanted (for the trace's amber pulse), derive it from **`lastServedFraction < 1` held across N consecutive ticks** (a session-tracked counter), NOT from `breachSecondsAccum`. The design no longer claims any positive fraction accumulates breach.

**Who computes `loadBySat` — two-pass, replay-safe.** the session, once per step, **fully recomputed from folded state** (no separate cached map that could desync across a restore):
1. **Pass A** — solve every active contract via `resolveTick` using the *prior tick's* `loadBySat` (rebuilt below) + the prior `congestionEpoch`. Record each contract's chosen sat into a `chosenSatByContract: Map<contractId, satId>`.
2. **Aggregate** — `loadBySat[satId] = Σ offeredLoad` over contracts whose chosen sat is `satId`. Bump `congestionEpoch` if any sat's quantized bucket changed (E3).
3. **Pass B** — derive each contract's served verdict (the truth this tick) from its `resolveTick` result under the freshly-bumped epoch; a contract bound to an over-capacity sat ⇒ binary-unserved on the bandwidth axis (above).

**Replay-safety:** `loadBySat` and `chosenSatByContract` are **fully re-derivable each step from folded state** — `offeredLoad` (folded) + the prior-tick chosen-sat assignment. To make the chosen-sat assignment survive a restore boundary, **fold `chosenSatByContract`** (a small `contractId→satId` map, stamped into `netStateHash` as sorted `id|satId` pairs, and carried in `NetSnapshot`/`restore`). Then `loadBySat` is a pure function of folded state and need not itself fold (like `routerStates`). The one-tick lag (Pass A uses last tick's map) is deterministic and bounded. **Add an explicit restore-then-step == continuous-run assertion for `loadBySat` + the chosen-sat map.**

**C1.3 — Latency then bandwidth, ONE AT A TIME (`scenario.ts` act3a.emit).**
- **Latency arrives by an authored new contract.** `act3a.emit` adds `REGION-2`, a latency-critical corridor contract sharing the existing infrastructure corridor, `activeAxes={connectivity,availability,latency}`, low `slaLatencyS`. Latency-tolerant GEO can't meet it ⇒ forces a shorter LEO route.
- **Bandwidth arrives by the escalation law crossing capacity.** A one-line deterministic mask add inside `stepEscalation` when a served contract's `offeredLoad` crosses `ESCALATION_BANDWIDTH_AXIS_THRESHOLD` ⇒ `contract.activeAxes = new Set([...contract.activeAxes, "bandwidth"])` (and bump `congestionEpoch`). Still "emit flips a mask," driven by the generator the emit enabled. Document in the act3a header: *latency = authored arrival; bandwidth = escalation-triggered mask flip, both deterministic in step.*

**C1.4 — The first per-contract prefer-override, by exception (`net_set_prefer` — already wired).**
No new action: `KIND_NET_SET_PREFER` + `netSetPrefer` + `applyNetAction`'s prefer branch + `NetSession.setPrefer` all exist and are A2-tested. Act 3 is the **first scenario where the router consumes `prefer`** (because C1.2's blend reads `prefer.{lat,bw,stab}` off the E1-widened type). The player relieves congestion by launching a parallel path (a second corridor sat ⇒ `loadBySat` splits ⇒ both under capacity) OR `net_set_prefer(REGION-2, lat=high, bw=low)` to bias the latency-critical contract onto the short LEO route while the trunk takes the fat GEO path. Same physics, two paths by intent — the §7.3 first-tunable landing.

**C1.5 — The trace surfaces the sharing problem (`trace.ts` first face; full parse in C2.5).**
For C1 the trace only needs the binding-constraint readout: reads `SolveResult.bindingConstraint` + the `loadBySat` aggregate and emits the §7.4 string *"link via [SAT-id] carries N contracts; combined peak exceeds capacity — add a parallel path or prefer-bw on [contract]."* This is the `Shortfall` shape already in scenario.ts (`{subjectId, message, suggestPresetId?}`), which trace.ts extends/owns. `act3a.fallback` calls it.

**C1.6 — The 3a gate (the re-tame).**
*Design §3a / Part IV:120:* a previously-served contract dipped near-breach under risen `offeredLoad`, then returned to SERVED. Folded session state:
- A per-contract near-breach witness: set when a contract that was served crosses `breachSecondsAccum > NEAR_BREACH_GRACE_FRACTION * BREACH_GRACE_SECONDS` **while escalation is on** (it dipped near-breach under risen load — now reachable because C1.2 makes the bandwidth bite binary ⇒ `breachSecondsAccum` actually accrues), then a single session int `act3aReTameWitnessed` (0/1) set true the first tick such a contract is back to `lastServedFraction == 1.0` (re-tamed).
- `act3a.gate` returns `session.escalationReTamed()`.

State-gated (the *concept* is demonstrated), not clock-timed. `act3a.fallback` surfaces the sharing problem if the player sits near-breach without acting.

**C1 tests + acceptance.** New `src/sim/net/escalation.test.ts` (unit) + `session.test.ts` extensions:
- **Escalation grows `offeredLoad` only where served, only when on, DT-invariant.**
- **Oversubscription tips a contract to breach (binary):** two contracts share one sat, escalation drives combined load `>= linkCapacity` ⇒ the bandwidth-active contract goes **servedFraction 0**, `bindingConstraint="bandwidth"`, and `breachSecondsAccum` rises toward grace. (Explicitly asserts the binary verdict, NOT a pro-rata fraction.)
- **A parallel path relieves it:** launch a second sat ⇒ `loadBySat` splits ⇒ both back to full service ⇒ `breachSecondsAccum` resets.
- **A prefer override relieves it:** `net_set_prefer` biases the latency contract onto the short path ⇒ meets `slaLatencyS` ⇒ served; assert the chosen `path[1]` sat id flips with the weight (the blend provably routed differently).
- **Congestion re-solves through the cache:** assert a rising `offeredLoad` that bumps `congestionEpoch` forces `resolveTick` to re-run the full solve. Assert a static load does NOT re-solve (cache preserved).
- **Router back-compat:** `previewLaunch` + all A1/A2 tests pass with no `loadBySat`/`prefer`/`slaLatencyS` (defaults ⇒ congestion 0, latency Infinity ⇒ identical behavior).
- **Restore-replay for congestion:** restore-then-step == continuous-run for `loadBySat` + the folded `chosenSatByContract`.
- **act3a.gate fires on tame→outgrow→re-tame** at a deterministic tick; does NOT fire without a dip or without recovery.
- **Latency axis:** a GEO-only path fails the low-latency corridor (`bindingConstraint=="latency"`); a LEO path passes.
- **Golden re-pin #1:** see the golden section. Both old goldens (`544847093270497462n`, `8431658617016421069n`) untouched (net/ imports neither m1/ nor m2/session.ts).

**Acceptance C1:** `npm test` green; escalation→oversubscription→re-tame deterministic end-to-end; the cost-blend routes by `prefer`; the bandwidth bite is binary (accrues breach); congestion forces a re-solve through the cache; latency axis exposes the GEO ceiling; restore-replay holds; golden re-pinned with old→new note; both old goldens byte-for-byte intact.

---

### C2 — Sub-beat 3B: the fault spectrum, mild-first, fenced behind 3a

**C2.1 — `fault.ts` (NEW, standalone, parallel-buildable).**
Pure data + pure roll functions off a `SimRng` the caller (`NetSession`) owns. The splitmix64 is the only randomness — the M2 launch-failure-roll pattern.

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
- **Causal probability (§5.2):** pure `causalFaultRatePerS(sat, ageS)` raising a base rate by overclock / cheap-bus / low-orbit / age multipliers, named PLAYTEST-KNOB constants. M1 has one bus (`smallsat`) + no overclock UI, so those hooks are present-but-neutral; the live levers this hour are **low-orbit** (LEO faults more than GEO — bridges to decay, rewards redundancy) and **age**. **Age uses the real field path: `ageS = t - sat.orbit.epochS`** (verified: `NetSat.orbit: SatOrbit`; epoch folds at net-replay.test.ts as `o.epochS`).
- **Rare-random floor (§5.2):** an irreducible `RARE_RANDOM_FAULT_RATE_PER_S` added to every sat regardless of choices.
- **Roll (deterministic):** `rollFaults(rng, sats, faultsActive, t, dt, scriptedQueue)` → new `FaultState`s + recoveries. Per-sat Bernoulli over dt: `if rng.nextDouble() < rate*dt`. **Mild-first is AUTHORED for the first two faults:** `act3b.emit` injects a `scriptedQueue` of (1) a `Degradation`, then (2) a `Telegraphed` failure — exactly the spec's mild-first pair. The stochastic causal+rare-random stream runs underneath as the irreducible floor thereafter. The scripted pair **draws from the same rng stream** (advance it deterministically) so fold + replay stay bit-stable.
- **HardFailure** stays vanishingly rare in M1 — a tiny floor, effectively off this hour; in the enum so M2 turns it up without reshape.

**C2.2 — Faults as a topology change in the router (router already supports it).**
The router already accepts `faults?: ReadonlySet<string>` and filters faulted sats, and `topologyKey` already folds the faulted set. So:
- **Hard / telegraphed-after-it-fails** ⇒ the existing `faults: ReadonlySet<string>` removal (topology change, re-solve, loss stamped). Zero router change.
- **Degradation** is NOT a removal (the sat still routes) — it's a **capacity haircut**: in the session's aggregate, multiply that sat's `linkCapacity` by `FaultState.capacityMultiplier` before computing `congestion_term`. Feeds the C1.2 congestion path. No new router branch.

The router signature stays completely unchanged; faults arrive through `faults?` (existing) + `loadBySat?` (E2 from C1).

**C2.3 — `act3b.emit` fenced structurally behind `act3a.gate` (scenario.ts).**
`act3a` and `act3b` are **separate cursor entries** in `M1_SCENARIO`. `act3b.emit` fires only when the cursor reaches `act3b` — which only happens after `act3a.gate` returned true. The fence is **structural, not a runtime guard**: faults are impossible before 3a re-tame because the generator is enabled by `act3b.emit`, gated by the cursor. `act3b.emit`:
- `session.enableFaults()` (sets `faultsOn=true`, folded int).
- seeds the scripted mild-first queue `[degradation@sat, telegraphed@sat]`.
- `step` calls `rollFaults` only when `faultsOn`.

**Test the fence explicitly** (design §3b acceptance): assert no `FaultState` exists AND the fault rng-draw counter is 0 until the cursor reaches `act3b`.

**C2.4 — Session integration (`session.ts` extends).**
- New folded state: `faultsOn` (int 0/1), `activeFaults: FaultState[]` (folded by `satId` + `kind` + the three sim-times as bit-stable f64s), and the **fault cursor** the golden fold reserves (`faultCursor=0` placeholder at net-replay.test.ts becomes the count of faults rolled / the rng-draw counter).
- In `step`, after escalation: `if (faultsOn) stepFaults(t, dt)` — roll new faults (scripted-first, then stochastic), advance recoveries/countdowns, build the down-sat set + the degraded-capacity map, feed both into the contract solves. RNG draws come off `this.rng` (the same `SimRng` already in the snapshot via `rngState`) — replay-safe, no new seed.
- `NetSnapshot`/`restore` gain `activeFaults` + `faultsOn` (and `chosenSatByContract` from C1).

**C2.5 — `trace.ts` (NEW, standalone, parallel-buildable) — the self-diagnosing view (§2.6 / §7.4 — M1 NECESSITY).**
Pure read over a session snapshot + the last `SolveResult` per contract (the session exposes `lastSolveFor(id)`). The **single legibility surface** for shortfalls AND fault state (§5.3 — one system, double duty). Owns/extends the `Shortfall` interface from scenario.ts.

`diagnose(session, t) → TraceReport`:
- **Binding-constraint + kind-of-fix** (§7.4), from each unserved/near-breach contract's `bindingConstraint`: connectivity → "no path; launch a covering sat"; availability → "availability breaks ~N min/orbit; add a phased sat in this plane"; latency → "latency floor is {latencyS*1000}ms via this path; a shorter LEO/relay route cuts it"; bandwidth → "trunk via [sat] saturated by N shared contracts; add a parallel path / prefer-bw."
- **Optimization/resilience shortfalls** (§3a optimizer pull, the gate's layer-1 target):
  - **Overprovisioned (waste):** a sat with `loadBySat[sat] << linkCapacity` while another contract breaches ⇒ "[sat] runs at X% — capacity idle; this contract could share it."
  - **SPOF (risk):** a served contract whose only bridging sat is one (no redundant bridge this solve) ⇒ "[region] has no redundant path; one sat fault drops it — add a phased sat / parallel orbit." Computed by a cheap re-run of `bridgeForPoint` excluding the chosen sat (≥2 independent bridges ⇒ redundant).
- **Fault state** (§5.3): each `FaultState` as a `SYSTEM.LOG` line — degradation amber pulse + "bandwidth degraded {1-mult}%, est. recovery {recoversAtS-t}"; telegraphed countdown "fails in {failsAtS-t}".
- **The predictability seed** (§7.5 REQUIRED): stamp every `SolveResult.losses` entry as "link [aId]↔[bId] lost: [cause] at [atS]" — `LinkLossStamp{aId,bId,cause,atS}` already carries it. `w_stab` stays dormant; the *forecast* is M2+, the *stamped geometric cause + time* is here day one.

`trace.ts` is pure and standalone: imports `SolveResult`/`LinkLossStamp`/`PreferWeights` types, `Contract`, `NetSat`, and the `FaultState` **type** from fault.ts — no runtime coupling, so it builds in parallel with fault.ts.

**C2.6 — The 3b gate (weathered + surfaced).**
*Design §3b / Part IV:120:* *weathered ≥1 fault while keeping contracts served (or recovering) AND the trace surfaced ≥1 optimization/resilience shortfall.* Folded session state:
- `weatheredFault` (int 0/1): set when an `active` contract experienced a fault on a sat it routed through yet kept `lastServedFraction > 0` across the fault window (or recovered to served after a transient/telegraphed) — redundancy or recovery held.
- `surfacedShortfall` (int 0/1): set the first tick `trace.diagnose` returns a non-empty resilience/optimization shortfall list. The trace is **called once per step inside `step` when `faultsOn`** to fold this deterministically (the report is a derived readout, not folded; the boolean it sets IS folded).
- `act3b.gate = weatheredFault && surfacedShortfall`. The fallback eases the fault rate (a session `faultRateScale` the drowning-detector lowers) and makes the trace more directive (Part IV:122).

**C2 tests + acceptance.** New `src/sim/net/fault.test.ts` + `src/sim/net/trace.test.ts` (both standalone) + scenario/session extensions:
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

### Golden re-pin discipline (resolves LOW: fold ADDITIONS, not pure value moves)

The new folded session fields are **genuinely new fold inputs** = fold ADDITIONS (reshapes), and must be documented as such:

- **C1 re-pin #1 (fold additions):** `escalationOn` (int), `act3aReTameWitnessed` (int), the near-breach witness, `congestionEpoch` (int), `chosenSatByContract` (sorted `id|satId` pairs). Plus value moves already in the fold: `offeredLoad` shifts, `activeAxes` gains `latency`/`bandwidth`. Order new fields **after** existing ones to minimize churn; add a `mixInt`/sorted-pair entry per addition. Re-pin `NET_REPLAY_GOLDEN` with a new value with an old→new note in the test header.
- **C2 re-pin #2 (fold additions + the one value move):** `faultsOn` (int), `weatheredFault` (int), `surfacedShortfall` (int), `activeFaults[]` (array of `satId|kind|f64×3`), and `faultCursor` becomes a live value (the one true value move). Extend the golden replay log to drive through act3a (launch a parallel path / prefer override) and into act3b (weather the scripted faults) so the fold exercises the new state. Re-pin `NET_REPLAY_GOLDEN` → new value, old→new note chained from #1, documenting each addition.

Both re-pins are fine and documented; they ARE reshapes (new fold entries) plus one value move — stated honestly, per the design's golden discipline. **The two existing goldens `544847093270497462n` and `8431658617016421069n` stay byte-for-byte untouched** across both re-pins.

---

## III.B — ACT 4: the Mars frontier teaser (vertigo; FENCED, mostly reuse)

Act 4 is a **TEASER, not a system**: introduce light-delay + freshness + caching as **concepts felt by sight**, then STOP. Per Part IV line 131 ("introduce the *vertigo*, withhold the *toolkit*") and §8 fences, this is **near-zero new mechanics** — mostly **REUSE + FENCE** of code that already exists (`src/sim/delay.ts`, the `m1/cache.ts` honest-staleness *convention*, the `mission.ts`/orrery packet-crawl).

The one true new mechanic is a **special-cased latency injection on the Mars leg**: connectivity is decided by a deliberately-closing deep-space relay (presence-based), and the leg's latency is taken from the **real Earth↔Mars ephemeris distance** via `delay.ts` — so the Earth toy's microsecond latency is replaced, on that one hop, by an honest minutes-long delay. Everything else is a contract, a readout, an action, and a render reuse.

**Fenced OUT (do NOT build — §8, post-gate, undesigned):** prefetch policy, coherence levels, eviction-as-strategy, the freshness economy/pricing curve, the parse, "currency," sat↔sat relay coherence, launch-window planning. `m1/policy.ts`, `m1/coherence.ts`, `m1/demand.ts`, `m1/parse.ts`, `m1/eventlog.ts` are **NOT imported by net/** and stay that way. Act 4 reuses ONLY `delay.ts` (`oneWaySeconds`/`roundTripSeconds`/`freshness`) and the `m1/cache.ts` honest-staleness *convention* (capturedAtT-at-launch, SD-19) at the design level — **never** its multi-slot eviction policy, and **never imported** (SD-40 invariant: `net/` imports neither `m1/` nor `m2/session.ts`).

### Two critique blockers — RESOLVED

**BLOCKER 1 (HIGH) — the latency band was physically wrong. FIXED.**
The full-eccentricity orbital extremes give one-way ~3.0–22.3 min (round-trip ~6.1–44.6 min). The design's asserted **8–40 min one-way** band is physically wrong — that is the round-trip figure.

**RESOLUTION (chosen explicitly):** keep the router's internal `latencyS` **one-way** (no semantics change), and make the **player-facing vertigo readout the ROUND-TRIP** — because the thing that breaks the Earth real-time-tune playbook is *"my command's effect comes back 8–40 minutes late"*, which is a round trip:
- `link-budget`/router `latencyS` (one-way) is pinned to the real one-way band **`[3 min, 23 min]`** (pin both synodic extremes with a small tolerance).
- The trace/readout surfaces **`roundTripSeconds(eph.distanceBetween("earth","mars",t))`** as the headline "command round-trip," pinned to **`[6 min, 45 min]`** — this is the onboarding's "8–40 min" lived figure.
- Both are pure functions of the same unforked ephemeris distance at the same `t`, so crawl (one-way) and readout cannot drift, and the round-trip is exactly `2×` the one-way the crawl uses.

**BLOCKER 2 (MED) — the inter-body frame bridge was underspecified/contradictory. PINNED.**
Verified against code: `router.satPositionRelative` **drops** `eph.position` and `link-budget.surfacePointRelative` **hard-codes** `A1_BODY_RADIUS_M` (300 km toy) + `earthThetaAt` (earth-only). A Mars region/relay **cannot** flow through `evaluateLink`/`bridgeForPoint` as-is, and forcing the toy inverse-square budget to close at ~1 AU would need a physically-meaningless giant EIRP.

**RESOLUTION (the clean, near-zero path — committed):** the Mars leg is a **special-cased latency injection with presence-based connectivity**, NOT a toy-frame `evaluateLink` close:
- **Connectivity** for the Mars contract is decided by **relay presence**: once the player has launched the `MARS_RELAY`, the Mars leg **bridges by construction** (a boolean presence test against the launched-sat roster). No toy inverse-square budget is computed on the Mars leg; no fake EIRP; the Mars point never goes through `surfacePointRelative`.
- **Latency** for the Mars leg is `oneWaySeconds(eph.distanceBetween("earth","mars",t))` (body-center-to-center, the **same value** the crawl uses), injected into the `SolveResult.latencyS` for the Mars contract. The Earth-side leg (relay→Earth-ground) is negligible.
- The design states **plainly**: the Mars contract is routed by a dedicated `solveMarsLeg` branch (presence + ephemeris-latency injection), **bypassing** `surfacePointRelative`/`evaluateLink`. Earth contracts are **untouched** — they keep the full toy-frame `bridgeForPoint`. No change to `satPositionRelative`/`surfacePointRelative`, so the earth-relative-cancellation the whole module relies on is never perturbed.

This keeps the change to "one enum member + one constant + one small `solveMarsLeg` branch," and puts no physically-meaningless number into the fold or the trace.

### File-level design on `src/sim/net/` (Act 4)

**`endpoint.ts`** — widen `Region.bodyId` and `GroundNet.bodyId` from the literal `"earth"` to `"earth" | "mars"`. Add `NET_ACT4_MARS_REGION: Region` (`bodyId: "mars"`, nominal lat/lon — geometry is cosmetic: Act 4 asserts neither whole-disc coverage nor a toy-frame budget on this region). `NET_ACT4_MARS_GROUND` is the **existing Earth ground net** — the data comes *back* to Earth's network. The only `endpoint.ts` change: one enum member + one constant. The `coveredFraction`/Fibonacci sampler is untouched.

**`link-budget.ts`** — add the inter-body distance helper ONLY (no toy-frame Mars geometry). `surfacePointRelative`/`evaluateLink` stay **exactly as built** (earth-toy-frame, microsecond latency for Earth links). Add **one pure helper**: `interBodyOneWayLatencyS(eph, "earth", "mars", t): number` → `oneWaySeconds(eph.distanceBetween("earth","mars",t))` (import `oneWaySeconds` from `../delay`). This is the **only** new function here, and it does **not** touch the toy-frame budget.

**`router.ts`** — a `solveMarsLeg` branch; latency is a READOUT, never an enforced Earth axis. `SolveResult` is **unchanged**. Add a small branch in `solve` (keyed on `contract.region.bodyId === "mars"`) that calls a new `solveMarsLeg`:
- **Served** iff the `MARS_RELAY` is present in the launched-sat roster (presence test) — that is the connectivity verdict; `bindingConstraint = "connectivity"` when no relay.
- **`latencyS = interBodyOneWayLatencyS(eph, "earth", "mars", t)`** (the honest one-way minutes). `path = [marsRegion.id, relay.id, groundNet.id]`.
- **`latency` is NOT added to the Mars contract's `activeAxes`.** Act 4 enforces **only `connectivity`** (path existence). The minutes-long latency is **surfaced as a readout** (the crawl, the round-trip stamp, "as of Nm ago"), never as a breach axis.

Earth contracts (`bodyId === "earth"`) keep the existing `bridgeForPoint` path verbatim. The re-solve split is unaffected — a Mars relay in a stable orbit produces no horizon thrash and the topology key already keys on sat ids; the presence test is time-invariant so the cached path holds.

**`contract.ts`** — ONE Mars contract that pays less for stale data (REUSE; NO struct change). No struct change. The Act-4 beat offers **one** Mars contract via the existing `offerNetContract(...)`:
- `region: NET_ACT4_MARS_REGION`, `activeAxes: {connectivity}` (latency/avail/bw present-but-un-enforced, as in Act 1).
- **The "pays less for stale data" is a RENDER-LAYER read-only effect, with NO new Contract field.** There is **no** `freshnessFactor` on the `Contract` struct and **nothing** new in the fold beyond `marsSample` (below). The trace face computes the stale dimming at render time from `marsSample` freshness; the wallet accrual stays the simple `netRevenueRatePerSecond(c, frac)` — **no** freshness→€ wiring.

> Decision to record (SD-40·D1): "less for stale data" is a **render-layer read-only annotation** in Act 4 — NOT a wallet mechanic and NOT a Contract field. The freshness economy (price-vs-staleness slope, the §8 ramp) stays fenced and undesigned. A future increment that makes stale data actually reduce € is post-gate M2+.

**Freshness "as of Nm ago" — REUSE the `delay.ts` curve + the cache CONVENTION (one slot, render-layer, NO import of `m1/`).**
The "data arrives old" readout reuses the **already-built** freshness math without importing the economy:
- Import **`delay.ts` directly** (`oneWaySeconds`, `roundTripSeconds`, `freshness` — note the real export name is **`freshness`**, *not* `delayFreshness`; that alias only exists locally inside `m1/cache.ts`).
- Define a tiny **local 3-field `MarsSample`** mirroring `CachedSample`: `{ datasetId: "mars"; capturedAtT: number; halfLifeS: number }`. The age readout is `t - capturedAtT` ("as of Nm ago"); the freshness readout is `freshness(age, halfLifeS)` with `halfLifeS = oneWaySeconds(distanceBetween(...))` at capture (the SD-19 honest-staleness convention: the sample is one-way old on arrival).
- **Reuse only the curve + the convention** — never the multi-slot `store`/`evictStalest`/`evictionVictim` policy (fenced). One slot, one breadcrumb.

> Namespace caveat (preserved): SD-40 says `net/` imports **neither `m1/` nor `m2/session.ts`**. `m1/cache.ts` imports `freshness` from `delay.ts`. To honor that fence, `net/` imports **`delay.ts` directly** and inlines the 3-field `MarsSample` — the brief's "reuse the m1 cache code" is satisfied at the **design/curve** level (same half-life decay, same capturedAtT-at-launch convention) without breaking the import fence.

**`session.ts`** — the Mars sample lives on the session (folded), one cache action. `NetSession` gains a minimal foldable Act-4 slot:
- One field: `marsSample: { capturedAtT: number; halfLifeS: number } | null` (null until the cache breadcrumb is placed). Folded into `NetSnapshot` + the state-hash (2 floats + a null-flag) so replay stays bit-identical.
- The per-tick `step` is **unchanged** for serve/breach (connectivity-only). When the Mars contract is active, it **freezes** the sample's `capturedAtT` at the moment the path first carries (honest-staleness, SD-19: one-way old on arrival) and refreshes the readout. No wallet change.
- The cache breadcrumb is placed via **one new action** (below); placing it sets `marsSample` "near Mars" so the freshness readout improves by sight. It does **not** change served/breach or revenue (a felt breadcrumb, not a relief lever).

**`action.ts`** — ONE new action kind: `net_place_cache`. Mirrors `net_launch`/`net_accept` constructors and snake_case wire keys:
- `KIND_NET_PLACE_CACHE = "net_place_cache"`, payload `{}` (or `{ datasetId: "mars" }`). The single cache breadcrumb. Applied at `atTick` via the shared applier so live==replay. **Deterministic, no roll** — it just sets `marsSample`.
- **No prefetch-policy action, no coherence action.** `KIND_PREFETCH`/`KIND_SET_PREFETCH_POLICY` exist for the *old m1* economy and are **NOT** reused by net/ (§8 fence).

**`world.ts`** — one Mars preset (the relay the player launches). Add a `MARS_RELAY` `NetPreset` + its `Preset` adapter, so the planner's "launch toward Mars" verb is the same `net_launch` action with a different preset. Because connectivity on the Mars leg is **presence-based**, the relay's antenna spec is **cosmetic** — it does NOT need a giant EIRP to "close" a toy-frame budget. `previewLaunch` already runs the real `solve` — so the Mars-launch preview **already shows the minutes-long latency floor truthfully** (via the `solveMarsLeg` branch), which is itself part of the vertigo: the player sees the crawl coming *before* commit. No new planner mechanic.

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

### Visualization (by sight — make-or-break)

- **Reuse the existing packet-crawl** (`mission.ts` + the orrery per-feed crawlers) — already crawls Earth→Mars at honest `oneWaySeconds(eph.distanceBetween("earth","mars",t))`. The net render mode draws the same crawler for the Mars leg; because both the crawl and the router latency term come from the **identical** `delay.ts` formula + the same ephemeris distance, the crawl reaches progress 1.0 exactly when the latency readout says it arrives — no drift. The round-trip readout is exactly `2×` that same one-way.
- **Freshness by saturation** (DD-1: "freshness = saturation draining to grey"). The Mars data node desaturates as the sample ages; the "as of Nm ago" stamp ticks. The placed cache breadcrumb visibly raises the saturation (data closer = fresher-looking) — the single caching lesson.
- **The Earth globe is unchanged** — Mars shown at honest interplanetary scale (the de-squash/log-fold is render-only and never feeds light-delay math, SD-5).

---

### Build increment D1 (one Build→Verify subagent) — tests + acceptance

**D1. The Mars vertigo read.** Wire the `act4.emit` Mars contract; the `interBodyOneWayLatencyS` helper in `link-budget.ts` + the `solveMarsLeg` presence/latency branch in `router.ts`; the `MARS_RELAY` preset in `world.ts`; the `net_place_cache` action + applier branch + `marsSample` session field; the render-layer freshness readout (reused `delay.ts` `freshness`, local 3-field `MarsSample`); the round-trip headout; the `act4` cursor stop. **NO** prefetch/coherence/freshness-economy/parse/eviction-policy; **NO** new Contract field.

**Tests:**
1. **Latency explodes deterministically at Mars distance (ONE-WAY band fixed).** For the Mars contract over the Act-4 epoch window, `SolveResult.latencyS` (one-way) lands in **`[~3 min, ~23 min]`** and equals `oneWaySeconds(eph.distanceBetween("earth","mars",t))` exactly. **Pin both synodic extremes** (closest ≈ 0.365 AU → 3.0 min; farthest ≈ 2.683 AU → 22.3 min) with a small tolerance so a future ephemeris swap is caught. The **round-trip readout** is asserted separately in `[~6 min, ~45 min]` and equals `roundTripSeconds(...) = 2× latencyS`. **Crucially, the Earth toy latency stays microseconds** (assert an Earth contract's `latencyS` is sub-millisecond — the Mars branch never touches Earth).
2. **NO Earth gauge ever shows freshness.** Assert every Earth contract's readout/trace exposes only connectivity/availability/latency/bandwidth and **never** a freshness/staleness field; only the Mars contract carries the "as of Nm ago" / freshness readout. (Guards the §8 fence at the type/render boundary — and confirms no `Contract` struct field carries freshness.)
3. **Crawl == readout (no drift).** The packet-crawl one-way and the router `latencyS` are the **same** value at the same `t` (both via `oneWaySeconds` + the same `distanceBetween`); the round-trip readout is exactly `2×` that.
4. **Latency stays un-enforced.** The Mars contract's `activeAxes` is `{connectivity}` only; serve/breach is presence-based path-existence; the minutes-long latency never flips `state` to breach and never alters `earnedEur` (no freshness→€ wiring).
5. **One cache breadcrumb, deterministic.** `net_place_cache` sets `marsSample`, raises the displayed freshness, and is a pure no-roll deterministic mutation; placing it does **not** change served/breach or revenue.
6. **Replay stable + NET golden re-pinned.** Re-pin **only** `NET_REPLAY_GOLDEN` in `src/sim/net-replay.test.ts` with a **documented old→new note** (the fold now covers `marsSample`'s 2 floats + a null-flag + the Mars contract). Replay-twice bit-identical; live==replay; SaveGame JSON round-trip reproduces the hash; the two existing goldens **byte-for-byte untouched** — `544847093270497462n` (`m1-session-replay.test.ts`, M1 cache economy) and `8431658617016421069n` (`m2-build-replay.test.ts`, M2 build); `net/` still imports neither `m1/` nor `m2/session.ts`; purity scan covers the new sources (only randomness = seeded splitmix64; `delay.ts`/`ephemeris` pure, no `Date.now`). **Note:** this is the **NET** golden — do **not** touch the M2-build golden.
7. **The cursor stops on act4.** Once the cursor reaches `act4`, `act4.gate` is false forever — `scenarioCursor` never advances past it (the deterministic "to be continued," no win screen, no completion gate).

**Acceptance:**
- The Mars-leg latency explodes deterministically (one-way `[3, 23]` min, round-trip readout `[6, 45]` min); the Earth toy latency stays microseconds.
- No Earth gauge ever shows freshness; only the Mars hop does; no new Contract field; the only fold growth is `marsSample`.
- Replay stable; **NET** golden re-pinned with the old→new note; both existing goldens (`544847093270497462n`, `8431658617016421069n`) untouched.
- **Human (two-layer gate, ≥5 cold testers, run after the build):** Layer 1 — finishes Act 3 *wanting to do it better*; **Layer 2** — when light-delay broke the Earth playbook, did they **lean in** ("how *do* you run a network across that?") or **bounce**. A read on the hook, not a completion gate. Layer-1 pass + Layer-2 fail = the connectivity game is fun but the interplanetary premise doesn't grab — learned before M2.

---

### Why Act 4 is faithful + fenced (no rework, near-zero new mechanics)

1. **One real new mechanic:** the `solveMarsLeg` branch — presence-based connectivity + an `interBodyOneWayLatencyS` injection from the real ephemeris via `delay.ts` into the router's existing `latencyS`. The toy-frame `evaluateLink`/`surfacePointRelative` are **untouched** (no Mars point in the toy frame, no fake EIRP, no perturbed earth-relative cancellation). Everything else is a contract, a readout, an action, and a render reuse.
2. **Reuse, not rebuild:** `delay.ts` (`oneWaySeconds`/`roundTripSeconds`/`freshness` — real export names) and the `m1/cache.ts` honest-staleness *convention* at the design level, without importing the m1 economy (SD-40 fence preserved by the direct `delay.ts` import + local 3-field `MarsSample`).
3. **Router signature stays stable:** `{served, path, latencyS, bindingConstraint, losses}` untouched; latency was already a returned field; the Mars contract's `activeAxes` is `{connectivity}` only.
4. **Freshness economy withheld:** "pays less for stale" is a **render-layer** read-only annotation (no Contract field, no fold growth beyond `marsSample`, no wallet wiring); caching is one breadcrumb slot, no eviction; no prefetch/coherence/parse/currency (§8).
5. **Determinism:** latency is a pure function of the unforked ephemeris; `marsSample` is 2 folded floats + a null-flag; one deterministic no-roll action; the NET golden re-pins with a documented note; the two existing goldens never move.
6. **The ending is a read, not a gate:** `act4.gate` stays `false` (already built) — the cursor stops on the frontier; no win screen. The vertigo is introduced; the toolkit is withheld.

---

# PART IV — Onboarding Script (The First Hour)

> *Source: `signal-horizon-m1-onboarding.md` v0.1. The director's script for the first hour — companion to Part I §9 (the scenario shape).*

> **What this document is.** Part I (§9) defines the *shape* of the first hour — four acts, four concepts, the two-layer gate. This part defines *how it actually unfolds at the table*: what opens each act, how each concept is taught, and — critically — **how the game knows the player has learned it before introducing the next.** It is the M1-12 ticket ("the scenario") in full.
>
> **It is state-gated, not clock-timed.** There are no minute-by-minute cues. A clock-timed tutorial fires the next beat whether the player is ready or not — it fights them. A **state-gated** one waits until the player has *demonstrated* the current concept, then opens the next. The `~minutes` noted per act are loose orientation (and a pacing smell-test), **not triggers.** This also serves the gate: testers won't all be at the same *minute*, but they pass the same *gates in the same order*, which is what makes their runs comparable.
>
> **The contract is the teacher (no tutorial layer).** The game never shows a "tutorial prompt" or a tooltip lecture. Teaching is diegetic: **a new contract arriving *is* "here is the next thing to learn,"** because its SLA shape forces exactly one new skill. The player learns by trying to fulfill contracts, and the diagnostic view explains shortfalls (Part I §7.4). The only authored layer on top of the real systems is the **sequence** in which contracts and faults arrive — the systems themselves (solver, faults, oversubscription) run for real.
>
> **The hour is authored-on-real-systems.** For the *gate*, the demand/fault sequence is a curated script (a controlled stimulus — you can't read a test with a random run). But it sits on top of the real solver, real faults, real oversubscription — it is the real game with a *curated arrival order*, not a fake. Post-gate, this opens to seeded-sandbox generation.

---

## The cardinal rule

**Each act introduces exactly ONE new concept, and never introduces a second until the first is *felt*.** The fastest way to lose a new player is two new ideas at once — they learn neither. Every gate below exists to enforce this: the next act does not open until the current concept is demonstrated. If you are ever tempted to add a second teaching beat to an act, move it to the next act instead.

**The emotional arc across the four acts:** competence → challenge → mastery-under-pressure → vertigo.

| Act | Concept (the ONE idea) | Feeling | ~mins |
|---|---|---|---|
| 1 | "I launch things and they connect regions." | competence | ~0–10 |
| 2 | "Coverage isn't placed — it's *maintained* against motion." | challenge | ~10–30 |
| 3 | "A working network strains under success and breaks under faults." | mastery-under-pressure | ~30–50 |
| 4 | "Everything I learned assumed *instant* — and that's just died." | vertigo | ~50–60 |

---

## ACT 1 — "Make signal reach there" (competence)

**The ONE concept:** *I launch satellites and they connect regions to the ground network. That's the basic loop.*

**What must NOT exist yet:** faults, a second SLA axis, constellations, oversubscription, any sat-to-sat relaying. Act 1 is the whole game shrunk to a single verb. Resist every urge to show more.

### The cold open (the hardest 60 seconds in the game)
The player opens to the orrery — Earth, a clean starfield, the 1-bit OS chrome — and **one thing is lit and asking for attention:** a single inbound contract on the panel, and a single highlighted region on the globe. Everything else is quiet or dimmed. The screen does not explain antennas, orbits, or SLAs. It poses one need:

> **`INBOUND CONTRACT — [Region: equatorial, latency-tolerant]`**
> *"Provide connectivity to [region]. Pay: €/sec while connected."*

The contract is **deliberately the easiest possible**: a single equatorial region, latency-tolerant (so GEO is a fine answer), connectivity-only (no availability/latency/bandwidth sub-targets shown yet — those fields are hidden this act). The player's only available action is **LAUNCH**, and the launch planner opens pre-seeded to a sensible default (a preset that *will* satisfy this contract). The teaching here is *radical reduction*: there is exactly one viable verb, and the planner's default is already most of the way to correct.

### Teaching mechanism
- **The planner shows the consequence.** As the player confirms (or nudges) the preset orbit, the orrery shows the **footprint** the satellite will cover, overlaid on the contract's highlighted region. The player *sees* "this covers that" before committing. (This is the planner's core promise — Part I §3.2 — taught on the gentlest possible case.)
- **Launch → the satellite appears → the region lights up → money starts.** The causal chain is immediate and legible: action → coverage → payment. The status strip ticks from `UNSERVED` to `SERVED`, the region's link glows in the connectivity hue, and the finance panel starts counting up.
- That is the entire Act 1 loop. The player has learned: *I launch, it covers, I'm paid.*

### Completion gate (what proves the concept landed)
**The player has one contract served and is being paid for it.** That's it. The moment the first contract goes `SERVED` and revenue is positive, Act 1's concept is demonstrated and Act 2 may open.

### Failure-to-progress fallback
If the player flounders in the planner (doesn't launch within a generous idle window, or launches into an orbit that *doesn't* cover the region), the diagnostic/shortfall view does the gentle correcting — "footprint does not reach [region]; try a lower inclination / this preset" — pointing at the fix without doing it for them (Part I §3.2: the assist never hands over the solution). The cold open is the one place the assist leans *most* helpful; it gets less hand-holding every act after.

> **Design note — why GEO-or-easy-LEO and latency-tolerant.** Act 1 must be winnable with a *single* satellite and *no* concept of motion-management. A latency-tolerant equatorial contract is the only contract shape a lone GEO sat fully solves (Part I §2). That is the point: it is the one case where "place one thing" works — so that Act 2 can *break* that intuition on purpose.

---

## ACT 2 — "Coverage is maintained, not placed" (challenge)

**The ONE concept:** *A single satellite can't hold a region that needs continuous coverage, because it moves. You need a constellation — enough satellites that as one sets, another rises.*

This is the **core puzzle of the early game** and the biggest conceptual leap in the hour, which is why it's the longest act. Everything Act 1 taught ("place one thing, done") must now be *productively broken*.

### Entry trigger
Act 1's contract is stably served. A **second contract** arrives — and it is shaped to be unsolvable by Act 1's method:

> **`INBOUND CONTRACT — [Region: high-latitude OR requires ≥99% availability]`**
> *Now the **availability** SLA field is visible for the first time: `min availability: 99%`.*

Two ways to force the lesson (pick one for the gate; the other is a variation):
- **(a) High-latitude region** GEO physically cannot cover (the footprint never reaches it — the player *sees* the GEO footprint miss it on the planner). Forces an inclined orbit.
- **(b) A continuous-availability requirement** that a single LEO sat cannot meet — the player launches one, and **watches coverage drop every time the sat sets below the horizon.** The availability meter sawtooths; the contract breaches on a schedule.

Either way the player hits a wall Act 1's toolkit can't clear, and the diagnostic names it.

### Teaching mechanism
- **The breach is visible and rhythmic.** The player sees the region go `SERVED → BREACHED → SERVED` as the satellite passes and leaves. The orrery shows the footprint sweeping past and the gap opening behind it. The availability meter visibly sawtooths. *The motion is the antagonist, and it's legible.*
- **The diagnostic states the fix in constellation terms** (Part I §7.4): *"availability breaks ~8 min each orbit: no satellite covers [region] in this window. Coverage requires a constellation — additional satellites phased so one rises as another sets."*
- **The planner assists with phasing** (Part I §3.3): when the player goes to add satellites, the planner can suggest *"to hold continuous coverage here you need ≈N evenly-phased satellites — place the set?"* — and gives a **viable-but-imperfect** result (maybe N is slightly too few, or the phasing leaves a small gap), so closing the gap is still the player's act. The launch-as-a-batch verb (Part I §3.4) is introduced here naturally: a constellation is one launch of several sats into a plane.
- **The payoff:** the player places the constellation, and watches the coverage *hold* as satellites hand off — the sawtooth flattens into continuous `SERVED`. The hand-off is the thing they built, and the orrery shows it working. *That is the Act 2 dopamine: motion tamed.*

### Completion gate
**The player has a region under continuous coverage via a constellation (≥2 satellites handing off), holding `SERVED` across at least one full hand-off cycle without breaching.** That proves they understand coverage-as-maintenance, not coverage-as-placement. Act 3 may open.

### Failure-to-progress fallback
If the player keeps adding satellites to the *wrong* orbits (e.g. all in one plane, leaving a phasing gap), the diagnostic escalates its specificity: *"coverage gap persists at [time-in-orbit]; satellites are co-phased — spread their phase / add one in this position."* If they over-build (10 sats where 4 would do), the act still completes (they've demonstrated the concept) — and the *waste* is silently logged for the optimizer pull that arrives in Act 3 (this is the first seed of "you solved it, but sloppily").

> **Design note — this is where oversubscription is first *seeded* (not yet taught).** With two contracts now live and sharing your satellites/antennas, the conditions for oversubscription exist — but the act does not yet *teach* it. The strain stays latent until Act 3's escalation makes it bite. One concept per act.

---

## ACT 3 — "It strains under success, and breaks under faults" (mastery-under-pressure)

**The ONE concept (one theme, the network under pressure):** *A working network doesn't stay working. Your own success congests it, and faults degrade it — and you must build for both.*

This act has two sub-beats (escalation, then faults), but they share one theme and one feeling: *the network you tamed is now fighting back, and mastery is keeping it alive under pressure.* They arrive in sequence, escalation first.

### Sub-beat 3A — Escalation (your success bites you)
**Entry trigger:** the player has stable coverage on two regions (Act 2 complete). Now **demand grows where they've served well** (Part I §4 / GDD §3b generator 1): a served region's offered load rises — it now wants more than the constellation was built for — and/or a **third contract** arrives that wants to share the same infrastructure corridor.

**Teaching mechanism — oversubscription bites (finally taught):**
- The shared links start riding near capacity; a peak tips a contract from comfortable into **near-breach**. The player feels their scarce antennas/links can't cover every contract's peak at once.
- The diagnostic surfaces it as a *sharing* problem (Part I §4.3): *"this link carries 3 contracts; combined peak exceeds capacity — add a parallel path, a higher-bandwidth antenna, or accept the breach risk on the lowest-value contract."*
- **Latency and/or bandwidth SLA fields now appear** on the new contract (the last two SLA axes, introduced one at a time per Part I §4.4): a low-latency contract makes the GEO ceiling *felt* ("this path is 340ms; a shorter LEO route is needed"); a high-bandwidth contract makes antenna/link limits bite.
- The player must **re-engineer**: launch more, re-tune routing priorities (Part I §7.3 — the first use of the prefer-latency/bandwidth/stability weight, by exception), or make a *deliberate* oversubscription bet (cut it thin on the lowest-value contract). This is the first full **tame → outgrow → re-tame** cycle (GDD §3b).

### Sub-beat 3B — Faults (the chaos-kitten, mild-first)
**Entry trigger:** the player has re-stabilized after 3A (the strain is back under control). *Now* faults begin — and not before, because faults on top of an unstable network would just be noise (Part I §5).

**Teaching mechanism — mild-first, fair (Part I §5.1):**
- **First a degradation:** a satellite's antenna underperforms briefly, then recovers. If the player cut oversubscription too thin in 3A, this *bites* (the degrade pushes a near-breach contract over); if they left headroom, they barely notice. **The lesson lands by consequence:** leave headroom. The fault rides the diagnostic view (a node pulses amber; `SYSTEM.LOG` shows the degrade and recovery — Part I §5.3). No separate UI.
- **Then a telegraphed failure:** a satellite shows a warning + countdown before it fails (Part I §5.1 #3). The player is *warned* — they can launch a replacement or re-route proactively. The player who built redundantly sails through; the brittle builder scrambles. **Resilience becomes visible and tested — fairly.**
- *(Hard random failure stays out, or is vanishingly rare, this hour — Part I §5.1.)*

**The optimizer pull appears (the §3a hook, the gate's layer-1 target):**
- Throughout Act 3, the diagnostic/trace view starts showing **where the player is wasteful or brittle** — overprovisioned links (waste), single points of failure (risk), a contract riding closer to breach than it needs to. The seeds logged silently in Act 2 (over-building) and 3A (thin bets) now surface as *legible shortfalls against what was achievable.*
- This is the first taste of "the parse" (the legible record, Part I §4.12 seed): the player sees that their network *works* but isn't *optimal*, and the gap is visible and naggable.

### Completion gate
**The player has weathered the strain and at least one fault while keeping their contracts served (or recovering from a breach), AND the diagnostic has surfaced at least one optimization/resilience shortfall to them.** The concept (a working network strains and breaks; build for it) is demonstrated. Act 4 may open. *The richest signal that Act 3 worked: the player proactively adds redundancy or re-tunes **before** the next problem forces them to — that's mastery, not reaction.*

### Failure-to-progress fallback
If the player is drowning (cascading breaches, can't stabilize), the script eases the fault rate and the diagnostic gets more directive ("you have no redundant path to [region]; one more satellite here covers the fault window"). The act is forgiving on *execution* — the goal is that they *understand* strain and faults, not that they play perfectly. A player who breaches, diagnoses, and recovers has learned the lesson better than one who never breached.

---

## ACT 4 — "Distance changes everything" (vertigo) — **the campaign hook, fenced**

**The ONE concept:** *Everything I learned assumes instant response. Across interplanetary distance, that assumption dies — and a whole different game begins.*

This is the **culmination and the gate's layer-2 test**. It is a *teaser*, not a system: it introduces light-delay, freshness, and caching as **concepts felt by sight**, then deliberately stops. **Do not build the freshness economy from this act** (Part I §8 — it is post-gate, undesigned). The discipline here is total: introduce the *vertigo*, withhold the *toolkit*.

### Entry trigger
The player has a mature, stable, fault-weathered Earth network (Act 3 complete) — they feel like they've *got this*. That competence is the setup; Act 4 is the reversal. An opportunity appears: **reach Mars** (a high-value contract, or a narrative beat — "establish the first Mars link"). The player does what they've always done: launch toward it, plan to connect it.

### Teaching mechanism — the playbook breaks, by sight
- **The first signal to Mars crawls.** The player sends the first command/signal and **watches the packet travel — and it takes *minutes*.** The same packet-crawl visual they've seen all hour, but now the round-trip is 8–40 minutes (honest light-delay — GDD §4.4). They *feel* the helplessness: **you cannot real-time-tune a topology when your input arrives 8 minutes late.** Every reactive habit Act 3 drilled is suddenly useless. *This is the across-tier invalidation (GDD §3b / Pillar 5) — the Earth playbook physically stops working.*
- **Data arrives old.** The first data back from Mars is **stamped "as of 8m ago."** On Earth, "fresh" and "stale" were never categories — data was just *there*. Now the player sees, for the first time, that **freshness is a thing.** A single contract appears that *cares*: it pays less for stale Mars data. The player feels the *shape* of the future problem without being handed tools to fully solve it.
- **One cache, as a breadcrumb.** The player is given **exactly one cache** to place near Mars — and feels "oh, putting data *closer* helps." That is the entire caching lesson for now: a single breadcrumb pointing at the post-gate game. **They are NOT given prefetch policy, coherence levels, the freshness economy, or the parse** (all Part I §8 — fenced, undesigned).

### The ending — stop on "to be continued"
The act does not resolve into a win screen. It **stops on a frontier.** The last beat is not "you won" — it is *"you've reached the edge of the game you know, and past it is a different one: light is slow, distance changes everything, caching is the answer, and freshness is the new currency."* The player should finish **wanting to see where it goes.** A quiet, deliberate "to be continued" — the campaign's promise, not its delivery.

### What Act 4 tests (the gate's layer 2)
Not a completion gate — a **read on the hook.** When light-delay broke their playbook, did the player **lean in** ("I want to see where this goes — how *do* you run a network across that?") or **bounce** ("this is annoying / I'm done")? That read tests the *premise of the whole campaign*, not just the slice (Part I §9 gate, layer 2).

---

## The gate (what the whole hour is for)

Run ≥5 testers cold. The hour passes the gate only if **both layers** clear (Part I §9):

**Layer 1 — did the Earth hour sustain and create the optimizer pull?**
- The player passed all three Earth-act gates (competence → constellation → weathered strain+fault) without bouncing.
- Past the novelty of the first stretch, the **escalation loop and the resilience/optimization tension kept them engaged** — the hour was carried by the *loop*, not by first-impression novelty (the reason it's an hour, not 30 minutes).
- **The decisive signal:** the player finishes an Earth contract **wanting to do it *better*** — they want another run to fix the wasteful/brittle thing the diagnostics showed them (GDD §3a). A tester who finishes *satisfied-and-done* built a toy; one who wants the re-run has felt the optimization pull, and *that* is the fun confirmed.

**Layer 2 — did the Mars culmination hook them into the campaign?**
- When light-delay **broke their Earth playbook**, did they **lean in or bounce?**

**FAIL** = bounces in Act 1 (cold open too hard) / never builds a real constellation (Act 2 didn't teach) / drowns or disengages under strain (Act 3 mistuned) / finishes-and-shrugs (no optimizer pull) / bounces off the Mars hook (premise doesn't grab). On fail, iterate **the cold open + the teaching sequence + the difficulty tuning + visualization** only (GDD Risk 2), re-run; 3 failed iterations ⇒ rethink the premise. **A run that passes layer 1 but fails layer 2 means the connectivity game is fun but the interplanetary premise doesn't grab — which you must learn before building M2+.** Do not start M2 until both layers pass.

---

## What this script does NOT do (fences)

- **No minute-by-minute timing.** State-gated only; `~minutes` are orientation, not triggers.
- **No tutorial layer.** Contracts and diagnostics teach; there are no tooltip lectures or coach-marks. (The cold open's assist is the *most* directive moment and is still diegetic — a shortfall diagnostic, not a tutorial popup.)
- **No second concept per act.** The cardinal rule. Latent systems (oversubscription in Act 2, the parse in Act 3) are *seeded* silently and *taught* only in their own act.
- **No freshness economy.** Act 4 is concepts-by-sight + one cache breadcrumb, then stop. The caching/prefetch/coherence/parse/currency systems are post-gate and undesigned (Part I §8).
- **No authored narrative beyond the arrival sequence.** The systems run for real; only the *order* contracts and faults arrive is scripted. Post-gate, even that opens to seeded-sandbox generation.

---

*The hour is four acts, four concepts, each gated on the previous being *felt*: competence → challenge → mastery-under-pressure → vertigo. The contract is the teacher; the diagnostic explains shortfalls; the systems run for real under a curated arrival sequence. Acts 1–3 are the buildable Earth game; Act 4 is the fenced campaign-hook teaser. The whole hour exists to answer one question in two layers: did the Earth loop make them want to do it better, and did the Mars frontier make them want to see where it goes?*
