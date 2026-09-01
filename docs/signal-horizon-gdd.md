# SIGNAL HORIZON
### Game Design Document — v0.9 (live document; git history tracks revisions)

> A satellite and information-network tycoon sim. TypeScript + Three.js, runs in the browser.
> Working title: **Signal Horizon**. Genre: economic and management sim on an orbital-mechanics base. Platform: **desktop browser only** (Chromium first). A mobile companion app is a speculative post-1.0 idea, not a port. Currency: **EUR (€)** early and mid game. The late-game currency flip is optional (§4.10).
>
> **This document is the design authority.** It holds the *why* and the *feel*. The *what* lives elsewhere:
> - `signal-horizon-m1.md` — M1 mechanics canon (Part I; the superseded Parts II–IV were pruned, git history keeps them).
> - `m1-redesign.md` (FIRST LIGHT, SD-45) — the M1 gameplay, launcher, and UX authority.
> - `routing-screen.md` (TRACE, SD-53) — the build design for §5 view 4.
> - `signal-horizon-implementation-plan.md` — build order. `backlog.md` and `decisions.md` — execution and record.
>
> Never invent requirements. If this document does not call for it, do not build it.

---

## 0. Version Log

**v0.9 (this revision) — the simple-English rewrite, plus the review merge.** The user ordered a rewrite in simpler English with less wordy structure, and a merge of the review docs into the GDD. This revision does both:

1. Every section keeps its number. Other docs cite these numbers. The prose is new: short sentences, active voice, much less repetition.
2. `gdd-proposal.md` v0.2 is merged: the gate measurement protocol (§9), motion and alarm rules (§8), motion budget rules (§5), the defeat ladder and victory constraints (§4.9), the narrative rules (§3), the escalation test (§3b), the freshness ramp fix (§8), the resume screen (§5), and market notes (§11).
3. The player-attack doc's core is merged: the six falsifiable claims and their measures (§9), and the revise-by-subtraction rule.
4. The Cities: Skylines II claim is reworded to match the press record (§5).
5. The stale pointer to `signal-horizon-m1-mechanics.md` is fixed. §9 now describes M1 as FIRST LIGHT (SD-45), the current authority.
6. `signal-horizon-gdd-simple.md`, `gdd-proposal.md`, and `signal-horizon-player-attack.md` are deleted. Their content lives here or in git history. SD-54 records the change.
7. A fix pass the same day (adversarial review: "pass, with conditions") repaired the gate protocol — two pre-registered bits instead of one drifted endpoint, bands per layer, a pre-registered middle verdict — and filed four rulings: load variance must be forecastable (§3b), the tool exists from the start and discovery is promotion (§4.11), the parse's bar is labeled and never proven (§4.12), and the first health-soundscape lands at M2 (§5, §9).

| Version | One line |
|---|---|
| v0.4 | Research-driven revision. Visualization becomes the make-or-break pillar. The currency flip becomes optional. The LLM is cut. |
| v0.5 | Colour returns under one rule: monochrome machine, living signal. |
| v0.6 | Network topology becomes a designed system (§4.3a): RF edge, laser backbone. |
| v0.7 | Pillar 7 "Leverage compounds" (§4.11). The stack moves to TypeScript + Three.js. |
| v0.8 | The fun is named (§3a): tame to functional, optimise against the parse. Escalation gets a mechanism (§3b). |
| v0.8.1 | The early game is corrected: connectivity, not caching. Oversubscription, efficiency-vs-resilience, capability discovery, GEO/LEO axis. |
| v0.9 | Simple-English rewrite. Review and critique merged. Docs cleanup. |

**Version discipline.** The next numbered revision, v0.10, must cite gate data in its version-log entry. Until the M1 gate runs, this document accepts corrections and recorded rulings only — no new systems.

---

## 1. Vision Statement

You are not a rocket company. You are an **information empire**.

Rockets, satellites, and ground stations are means. The product is **knowledge moved across distance**: coverage, bandwidth, latency, observation, and brokered data. The fantasy: start with one ground station and a leased smallsat. End with a multi-planetary information utility whose backbone spans the solar system.

The signature tension is **physics versus economics**. Light is slow. Mars is far. A customer wants data *now*. But "now" between Earth and Mars is up to 22 light-minutes away, one way. The player who masters *where to place information* wins. That player knows what to cache, what to pre-compute, and with whom to peer. The player who treats the solar system like a terrestrial CDN goes bankrupt.

**The monument.** The product is invisible, so the game needs one thing the player can *see grow*. It is the **living coverage web**: a glowing lattice of links, shells, and packet flows across the solar system. It grows from a single dot over the Pacific to a backbone that reaches Saturn. The empire is invisible. Its shadow on the orrery is the trophy. This is the emotional payoff of the game (§5).

Late in the game, information can stop being something you sell and become the money itself. The flip is optional and gradual (§4.10).

**One-line pitch:** *OpenTTD meets a relativistically honest deep-space network. The speed of light is your hardest constraint, and information is the only real currency.*

---

## 2. Design Pillars

1. **Information is the product.** Coverage and data quality are the win conditions. Hardware is the cost base. Every system answers: "does this help me know more, sooner, in more places?"
2. **Physics is honest where it is fun.** Orbital mechanics, light-delay, and link budgets are honest enough to matter. The rest is abstracted. The planner does the math. The sim never lies. The player never does homework.
3. **Distance creates strategy.** Farther out, latency dominates. Caching, prediction, and brokering are the late game, not side features.
4. **The invisible made visible — the make-or-break pillar.** Information is invisible by nature. The craft of this game is to make it visible, to the *Mini Metro* standard: state legible at a glance, audio as a real second channel, health readable across the room. A deep sim the player cannot see working reads as dead. This is priority zero. It is prototyped first. If it fails, the project stops.
5. **Scale teaches.** Earth orbit, cislunar, inner planets, outer system, beyond. Each tier adds one new dominant constraint. The game keeps teaching, not repeating.
6. **Success creates the next problem.** A profitable route invites traffic. Traffic congests. Congestion forces re-engineering. Escalation is endogenous, with a stated mechanism (§3b).
7. **Leverage compounds.** Capability is discovered through operation, never bought from a menu. The unit of command rises: asset, then fleet, then declared intent (§4.11).

---

## 3. Core Gameplay Loop

**Moment to moment (seconds to minutes).** Watch the web. Spot a gap, a spike, a congesting link, or a staling cache. Decide: launch, reposition, lease, peer, retune. Commit €. **Watch the network respond.** A link lights. A flow re-routes. A coverage shell thickens. The visible response is the reward, not polish.

**Session (tens of minutes).** Plan a launch campaign or an expansion. Manage the money and the risk. Execute. Integrate the new assets. Serve the new contracts. Find the new strain.

**Campaign (the long arc).** Single region, to global, to cislunar, to interplanetary backbone, to information utility. Optionally into the information-economy endgame (§4.10).

The loop is always **gap → asset → integration → revenue → a bigger gap**. The gap type evolves: "coverage hole over the Pacific" becomes "unservable latency to the Belt". The cadence evolves too. Early, each launch is a campaign and the work is capacity planning. Late, you lay backbone in declarative gestures, in pipe-laying flow. The heartbeat speeds up as the unit of command rises (§4.11).

**Session shape rules:**
- **There is always a live goal, so stopping is a choice.** The game never runs out of next decisions. It never pushes the player out.
- **Timed premium tenders** give short-horizon goals: a contract pays a bonus if served inside a window. A tender deadline is a *service deadline*, not freshness. Freshness is value that decays with data age. The two are different things, and the late game depends on the player knowing the difference.
- Tuning heuristics, not rules: first payoff inside about five minutes. Several near-finish arcs on screen at any time.

**Emergent narrative.** The manager-sim "stories" hook, in three parts:
- **Rival operators** with names and personalities. They undercut you and peer with you.
- **Breaking data-events.** A Mars dust storm spikes observation demand. A science flagship needs backbone now. A rival relay fails, and their customers knock.
- **Outages with consequences.** A conjunction blackout starves a region for days.

Generator design rules:
1. Two event classes only. Passive news gives flavour. Decision events give agency.
2. Rival boards re-set their expectations from the performance you actually delivered.
3. The event log (The Wire) stays legible and causal, never literary. Bare causal events are enough. The player writes the story.
4. Playtests log event skip rates. Event types that players ignore get cut.

**Waiting is gameplay.** Waiting for a window or a round-trip is decision space: what to cache, what to prefetch on a bet, which consistency level to pay for. If waiting is ever just a fast-forward slider, we failed.

### 3a. What the Fun Is

**The spine is taming the sprawl.** The most visceral fun in this genre is creating order from chaos. This is the sysadmin pleasure: one server by hand, then ten with Ansible, then a thousand with Kubernetes. The complexity never shrinks. Your altitude over it rises. You can only tame complexity you can see. This is why §5 is the make-or-break pillar: it *is* the delivery mechanism for the fun. Taming is measured against the bar of **functional**. Does it work? Binary, gut-level, immediate. Anyone can feel it.

**The mastery layer is optimising against the parse.** Once the system works, a deeper pleasure opens: grind it toward optimal. This is the WoW combat-log pleasure and the Zachtronics histogram pleasure. It is measured against the bar of **optimal**: given that it works, how close to the theoretical best? Continuous, cerebral, deferred. The fun lives in the record, between runs, in the gap between your 73% and the achievable 91%.

**They are the same verb at two bars.** The hinge is **a legible, honest record of what happened** (§4.12). A novice never opens it and tames happily to functional. An optimiser lives in it and grinds toward optimal. This is the concrete mechanism behind "easy to pick up, hard to master" — one continuous staircase, not a casual game with a hardcore mode bolted on.

**A hard test for every system:** the novice's version and the master's version must be the same verb at different altitudes. If the master plays a different game the novice never touches, redesign.

**The knowledge is transferable.** The sim is honest: real light-delay, real link budgets, real geometry. So insights gained by optimising are true outside the game too. "Pre-stage the cache before the predictable blackout" is real knowledge about delayed networks. Design the mechanics so optimal play is a real, discoverable insight. Never hand the player a number.

### 3b. The Escalation Engine

Pillar 6 promises "success creates the next problem". This section is the mechanism.

**The weak way, rejected:** the designer places the next gap. The Belt is just Mars with bigger numbers. That produces the same-y feeling that kills the genre.

**The strong way:** your own success degrades your position. Three generators, all endogenous:

1. **Demand grows where you serve.** Serve a region well and its economic weight grows. It now demands more than the capacity you built. The gap you closed widened itself by being closed.
2. **Freshness decays.** A freshness contract is never done. Stop feeding it and it stales (§4.4, §4.10). The same Mars feed goes stale again because demand rose and prefetch did not keep up. This is a late mechanic — it does not exist in the connectivity-era early game.
3. **You outgrow your automation.** You build automation to hold the rising load. It is sized for today's scale. Growth breaks its scale, so you build a higher-altitude tool, and outgrow that later. Tame, outgrow, re-tame higher.

These three are one engine. Growth raises the load. Decay makes the load continuous. Automation is you taming the load until growth breaks its scale.

**The early-game engine, before freshness exists: oversubscription.** Offered load varies and can exceed the committed SLA. Your scarce antennas and links cannot honestly cover every contract's peak at once. So you share infrastructure across contracts whose peaks do not coincide. Cut it as thin as you dare, before a breach costs more than the hardware you saved. This is statistical multiplexing as gameplay — real ISP engineering, so it is transferable knowledge. The early-game tension: *N contracts, M satellites, honest provisioning needs about 2M satellites — how cleverly do you share?* Your own success is what tips a comfortable share into an oversubscribed one.

Load variance must be forecastable in principle — the same guarantee §4.3a gives conjunction blackouts. A breach the player could not have seen coming reads as dice. A breach they chose to risk reads as cutting it too thin. The game must never dress the first up as the second.

**Escalation keeps the optimum moving.** A static system gets fully optimised, then it is dead. Because demand grows, the optimum you were grinding toward shifts. Your near-optimal network is suddenly suboptimal again. The same engine renews the chaos the tamer fights and moves the optimum the optimiser chases.

**The across-tier rule.** Each new tier must **invalidate a strategy that worked before**. The Belt is not "Mars but farther" — it is where round-trip coherence becomes impossible and pure store-and-forward is forced. Jupiter is where radiation and one-way DTN break Belt assumptions. If a proposed tier does not invalidate a prior strategy, it is just a bigger number. Cut it.

**One test, added in v0.9:** do not test whether redundancy damps pressure. That is what redundancy is for. Test whether the *relief decays* as growth continues. If relief is permanent, the engine is broken.

**A post-1.0 note:** fleet power raising your own interference and fault rate is the one truly endogenous third channel, and it couples to §4.11's efficiency-versus-resilience axis. Deferred.

---

## 4. Core Systems

### 4.1 Orbital Mechanics and the Sim/Render Split

Two decoupled layers. This is the most important architectural decision in the doc:

- **Simulation (truth).** All bodies and craft propagate in real SI units with **double-precision (f64) Keplerian elements**, plus optional SGP4-style propagation for Earth orbit. Pure math, headless, engine-agnostic. This keeps coverage, link budgets, and revenue honest, and keeps multiplayer possible later without a commitment now.
- **Render (the lie).** Positions are rebased to a floating origin and rendered in float32. This avoids precision jitter at solar-system scale. Distant objects collapse to icons and labels.

Orbital fidelity tiers, invisible to the player:
- **Tier 0 — two-body Keplerian.** Default. Cheap, deterministic, propagatable to any time `t`.
- **Tier 1 — patched conics.** For the launch planner only: windows, Hohmann and bi-elliptic transfers, gravity assists. The planner does the math, so the player makes the choice — the KSP maneuver-node lesson.
- **Tier 2 — perturbations (J2, drag).** Optional LEO realism. Orbital decay makes a satellite a depreciating asset: it literally falls from the sky if you stop station-keeping payments.

No n-body gravity. Determinism, stability, and performance all argue against it, and players cannot tell.

### 4.2 Information and Coverage — The Heart

Coverage is a field over a target:
- **Body surfaces.** A geodesic cell grid (an H3-like hex tiling) per body. Each cell has a demand value (population, economic weight) and a coverage value derived from line-of-sight plus link budget.
- **Deep-space volumes.** Coverage is reachability over the link graph, not a surface grid.

Five information dimensions per cell or target:
- **Connectivity** — can data reach this place at all?
- **Bandwidth** — how much data per unit time?
- **Latency** — light distance plus queueing plus hops.
- **Observation** — sensing coverage (imaging, weather, monitoring). A separate product line from comms.
- **Freshness** — for cached or brokered data, how old is it?

**Multi-axis scoring is the optimisation spine.** The network is scored on competing axes: coverage, latency, freshness, cost. There is no single right build, only elegant trade-offs. This data is the substance of the parse (§4.12). Late game, the network renders as a shareable **network portrait** — your stat histogram against other players' builds.

Demand comes from **markets**: terrestrial telecom regions, government and observation contracts, deep-space missions, broker requests. Revenue = demand met × quality × tariff − cost to serve, in €.

### 4.3 Link Budgets, Peering and Routing

The network is a **time-varying directed graph**. Nodes: satellites, ground stations, relays, deep-space stations, partner and competitor nodes. Each edge has:

- **Capacity** (bps), from a simplified link budget: antenna gain, Tx power, distance², frequency band, weather and atmosphere loss, pointing.
- **Latency** = propagation (distance ÷ c) + processing and queueing.
- **Availability** — windows open and close with geometry. A satellite sets below the horizon. A planet occults a link. The Sun sits between Earth and Mars (conjunction blackout).
- **Cost** — your own links are capex and opex. Partner links cost € per bit.

**Peering** is a core economic system, on the ground and in space:
- **Ground peering:** interconnect at terrestrial exchanges. Buy and sell transit. Settle in €.
- **Space peering:** cross-link with partner constellations and other operators' relays. Reach places you do not cover. Optical inter-satellite links form the in-space backbone.
- **Partners and competitors:** the same NPC can be both. Each faction has a relationship state: trust, price, exclusivity. Contracts, settlement, and routing are counterparty-agnostic, so a remote human can slot in later (§7) — an affordance, not a v1 deliverable.

**Routing.** Data flows are routed over the graph by a cost function. The player biases the function (cheapest, lowest-latency, most-reliable) and overrides it with policy: "never route government data over Competitor X". **When a link drops, you watch packets re-route. This is core dashboard theatre** — real animation budget, not a log line (§5).

### 4.3a Network Topology and Laser Links

§4.3 is the routing *model*. This section is the physical layer: the links themselves, the part the player builds.

**Altitude is a permanent strategic axis, not a phase.** The contract's SLA shape selects the regime, forever:
- **GEO** — high, stationary, sees a third of the planet. A superb *broadcaster* and *backbone anchor*: cheap broad coverage, set-and-forget stability. But its ~240 ms round-trip is a hard physical wall, and uplink is thin and expensive. Useless for low-latency bidirectional service.
- **LEO** — low, fast-moving, small footprint. The bidirectional workhorse: low latency, high per-user bandwidth. But it moves. One LEO satellite cannot hold a region — you need a **constellation** with hand-offs as satellites rise and set.

**Two link types, opposite characters:**
- **RF access links** — wide beam, forgiving pointing, range-limited by inverse-square falloff. Cheap, everywhere, robust-but-mediocre. The default plumbing, the floor. The solver routes over them; the player rarely thinks about an individual RF link.
- **Laser links** — point-to-point beams locked between two nodes. Enormous bandwidth, negligible per-hop penalty. Expensive, **finite per node**, fragile to geometry. The backbone — the part the player physically builds.

**Terminals are scarce, and only backbone nodes have them.** A laser link is a committed pairing: two nodes lock beams on each other. Each node carries only a handful of optical terminals — on relays, datacenters, and premium satellites, never on cheap edge smallsats. Two consequences, and they are the whole game:

1. **You cannot mesh everything to everything.** Every committed laser link is a terminal you cannot point elsewhere. Topology becomes resource allocation: four terminals on a Mars relay, six things to reach — what do you give up? The terminal budget is the built-in defence against a single "just full-mesh it" strategy.
2. **The network takes a core/edge shape.** A sparse laser-meshed spine. A dense RF edge hanging off it. This is how real networks look, and the game's economics produce it — it is not scripted.

The two-tier shape also makes the network legible. Traffic enters at an edge satellite, climbs to its core node over RF, traverses the laser spine, descends at the destination. That climb-traverse-descend silhouette turns "show me this flow" into a diagnosis.

**Two levels of engagement, one routing model:**
- **Level 1 — the floor, everyone, from the early game.** Set policy intent (§4.3): bias and overrides. Lease and peer capacity. The solver routes. You observe and tune goals. You never edit a route. Works with zero laser links, so the M1 gate is untouched.
- **Level 2 — the ceiling, available but never required, matures at M4.** Physically construct the optical backbone: which backbone nodes peer, where the scarce terminals go, a topology that survives the orbital cycle. **Level 2 feeds Level 1.** You never hand-route over your mesh. You build a better graph, and the same policy and solver route over it. Policy and topology become two routes to the same goal — you can *satisfy* "no government data on foreign links" by building your own laser path.

**The topology breathes.** RF to ground re-acquires easily. A laser lock between divergent orbits must find and hold its beam across changing geometry. Links open and close predictably with the bodies. A conjunction severs the Mars segment for days. So the skill at Level 2 is a spine that survives the *cycle*. Blackouts are geometrically predictable, so pre-building the redundant path, or pre-staging the cache, is skill, not luck. "I saw the conjunction coming, built the redundant spine, and my traffic re-routed while my rival's went dark" is close to the whole game in one sentence.

**The trace view — the `mtr` of the game.** Pick a flow (a contract, a data product) and the orrery renders its actual current path, hop by hop. Delay accumulates. Freshness drains along the route. A good topology shows a clean climb-traverse-descend. A bad one shows a detour across three core hops because you never built the direct link. First-class view (§5; built as TRACE — see `routing-screen.md`).

**Scope honesty.** Level 1 is cheap and seeds around M2. Level 2 is a real system — terminals as a finite buildable resource, acquisition and tracking geometry, the construction UI, cycle robustness — and lands at M4. It gets a placement marker here, not a detailed design, until the core proves fun.

### 4.4 Light-Speed Delay, Caching and Brokering

This is the differentiator. It gets first-class systems, not flavour.

**Delayed information.** Every datum has an **age**: light-distance travelled plus dwell time in queues and caches. The UI surfaces age everywhere — a Mars telemetry feed is stamped "*as of 14m 22s ago*". Some contracts pay for freshness; the late-game economy is largely a fight against staleness. Make it visible: watch a ping crawl across the orrery toward Mars, with honest compressed travel time. This teaches light-delay *by sight*, before it ever bites economically. It is the onboarding teacher.

**Caching as a mechanic.** Round-trips to the outer system are catastrophically slow. Place **caches and edge nodes** near demand, then run prefetch and replication policies:
- **Cache hit** — serve locally, low latency, data can be stale. If the contract demands currency, you pay a freshness penalty. A cache hit is audible and visible: you must hear and see the network work well.
- **Cache miss** — fetch across the light-gap. You pay the latency. The customer waits.
- **Predictive prefetch** — spend compute and € to pre-position data you forecast will be requested. Over-prefetch wastes bandwidth and storage. Under-prefetch starves customers. This is the core late-game skill, and it fills waiting with decisions (§3).
- **Coherence cost** — choose per dataset: strong, eventual, or best-effort. Each has a € profile and a latency profile.

**Brokering — constrained, so it cannot eat the game.** A market layer on top of the network. Brokers buy and sell *data itself*, not just transport. Brokering exploits latency arbitrage: the same information has different value at different points in the system, purely by arrival time. Against AI, an uncapped arbitrage layer becomes a solved dominant strategy — so three rules:
1. **You can only broker data you can actually move.** Gated behind owned or peered infrastructure.
2. **Arbitrage margins are capped and decay** as routes become known and competed. A recurring discovery game, not a money printer.
3. **The highest-value brokering needs the physical network you built.** Carrier and broker fantasies are coupled, not substitutable.

Litmus test: a player who never brokers must be able to win as a pure carrier. If playtests show players skipping construction for brokering, cut the margins before new content ships.

### 4.5 Orbital and Deep-Space Datacenters — Force-Multipliers

Caching answers where data *lives*. Datacenters answer where it is *processed*. Shipping raw data across the light-gap is ruinous, so process near where it is gathered or consumed. This gives the player a second capex spine alongside launch.

**The design constraint:** datacenters are a **small number of high-impact strategic nodes** you place, power, cool, and upgrade. They must never become a base-building sub-game bolted onto the network sim. The bolted-on colonies of *Per Aspera* are the cautionary tale. Every DC mechanic below must feed the network, coverage, and freshness loop, or it is cut.

**Why space compute is a real decision, not flavour:**
- **Power is the headline.** Solar flux falls with the square of distance. A DC at Jupiter gets about 4% of Earth's solar power per panel. Outer-system compute forces nuclear or RTG.
- **Cooling is radiative only.** In vacuum you reject heat through radiator area alone. Radiators are heavy and large. Thermal capacity is a hard ceiling on compute density.
- **Radiation** degrades hardware. Pay for rad-hardened silicon (slower, pricier) or accept failures and refresh.
- **Latency-to-value is the point.** Compute co-located with a Mars sensor array turns 4 TB of raw imagery into a 4 MB analysis product *before* it crosses the gap. "Ship raw and process at Earth" versus "process at the edge and ship the answer" is a standing decision.

**Roles (all feed the network loop):** edge pre-processing, cache and coherence host, brokerage compute, autonomy substrate (§4.6 — no local compute, no local intelligence: distant nodes that lose their DC go dark and dumb).

**Progression:** ground DC → co-located with ground stations → LEO/GEO orbital → Lunar and L-point → Mars orbit and surface → outer-system (nuclear, rad-hard, sparse). Space DCs are heavy payloads: satisfying multi-launch construction projects, tied into §4.7.

Late game, DCs do not just process information — they **mint** it (§4.10).

### 4.6 Autonomous Edge Intelligence — Flight Software, Never "AI"

You cannot micromanage what you cannot reach. Mars is 20 light-minutes away: you see a problem, your command arrives 40 minutes later, and the situation has changed. The in-fiction answer — real spacecraft practice — is **autonomous intelligence running locally at the edge**.

**Framing is a commercial necessity.** The automation is never surfaced as "AI". No sparkle icon, no chat mascot. It is **flight software, expert systems, station agents, autonomy packages**. A late-2025 Quantic Foundry survey (N = 1,799, opt-in, skewed toward core PC players) found **85% negative sentiment** toward generative AI in games, with 63% choosing the most negative option, and sentiment worsening year over year. If a player cannot tell whether it is a clever rules engine or something fancier, we succeeded.

**As mechanics:**
- **Autonomy policies.** Configure what distant nodes do when out of contact: reprioritise downlinks, reroute around a dropped link, throttle non-critical traffic, safe-mode on fault, decide locally what is worth the bandwidth home. You write standing orders and live with how they play out across the delay.
- **Autonomy tiers tied to DC compute (§4.5).** No local compute means a dumb relay. A real DC behind a node means local triage, bounded peering, predictive prefetch. Better edge compute means less value lost to the light-gap. This is the engine of the leverage curve (§4.11).
- **The trust dial.** More autonomy buys better blackout performance and less direct control, and opens the door to expensive autonomous mistakes. The automation must never *visibly do something stupid* — visible incompetence destroys trust in the whole layer.
- **Information triage.** Deciding what is worth sending across a constrained, slow link is the killer autonomous function and a late-game skill.

**The optional local LLM is cut from v1.** It can ship after 1.0, or never. All in-world text (SYSTEM.LOG lines, agent messages, contract text, broker correspondence) is hand-written or templated. Litmus: a player who hates "AI features" plays the whole game, enjoys the autonomy as good automation, and never feels sold a buzzword.

### 4.7 Launch Capabilities

Getting mass to orbit and beyond is the capex spine of expansion:
- **Launch market.** Buy launches early: rideshare first, then dedicated. Price is € per kg to a given orbit. Each launch has a window and a failure probability. Later, vertically integrate: R&D plus fixed infrastructure, lower marginal €/kg — but you absorb the failures. This is the launch face of the leverage curve (§4.11).
- **Windows are real.** Mars is cheap only near the synodic window, about every 26 months. Off-window means far more Δv. Timing is a strategic resource, and it sets campaign rhythm — as long as the wait is filled with decisions (§3), not dead air.
- **Planning.** A small minigame: pick the window, vehicle, manifest, target orbit. Accept the risk profile. The patched-conic planner does the math (§4.1). The player chooses.
- **Risk.** Launch failure, deployment failure, infant mortality. Insurance is a € market.

### 4.8 Scale Progression

Each tier introduces **one new dominant constraint**, so complexity ramps with reach. The v1 critical path is Tiers 1–3.

| Tier | Reach | New dominant constraint | New systems |
|---|---|---|---|
| 1 | LEO, MEO, GEO. Single region → global Earth | Geometry, weather, orbital decay | Coverage grid, ground peering, ground DCs, launch market, multi-axis scoring |
| 2 | Cislunar (Moon, Lagrange points) | First real light-delay (~1.3 s). Relay placement | Lunar edge caches, first orbital DCs, L-point relays, observation contracts, basic autonomy, Level-1 routing policy + trace view. The gentle on-ramp where the game teaches light-delay before it bites |
| 3 | Inner planets (Mars, Venus, NEAs) | Minutes-scale delay. Conjunction blackouts. Launch windows | Deep-space relays, caching/prefetch core loop, edge DCs, constrained brokering, autonomy tiers. **The game becomes itself** |
| 4 | Outer system (Belt, Jupiter, Saturn moons) | Tens of minutes to hours. Sparse demand. Power scarcity, radiation | *(post-1.0)* DTN store-and-forward, predictive replication, nuclear rad-hard DCs, high autonomy, **Level-2 laser backbone matures (§4.3a)**, optional info-economy onset (§4.10) |
| 5 | Beyond (Oort, interstellar) | Hours to years. One-way regimes | *(post-1.0, speculative)* fully autonomous nodes, long-horizon brokering, mature info economy |

The outer tiers lean on **DTN** (delay-tolerant networking): store-and-forward bundles, no end-to-end handshakes. Real, and a fertile gameplay vein — but reserved until the core proves fun.

### 4.9 Economy

- **Primary currency: EUR (€).** All capex, opex, tariffs, settlements, broker trades, insurance, financing. € stays useful for the entire game (§4.10).
- **Capex:** satellites, ground stations, launches, deep-space relays, datacenters, power systems, R&D.
- **Opex:** station-keeping and fuel, power, DC compute and cooling, staff, partner bandwidth, cache storage, maintenance, hardware refresh, deorbit liabilities.
- **Revenue:** coverage and bandwidth tariffs, observation contracts, edge-processing and data-product sales, transit and peering sales, capped broker margins, latency-arbitrage profit, grants.
- **Financing:** retained earnings, debt, equity rounds, milestone government contracts.
- **Markets move.** Demand grows with served regions — this *is* the escalation engine (§3b). Competitor actions shift prices. Macro events shock demand (§3).

**Defeat (v0.9).** Bankruptcy is a real lose condition, and it is the *last* step of a visible ladder:
1. Cash runway shrinks. Breach penalties post. Reputation drops to PROBATION and baseline offers thin out. No sudden game-over.
2. A lost run ends on the parse (§4.12): the same per-contract post-mortem as a won run. Loss teaches, and feeds the re-run hook.
3. **The ladder must be short enough to ride.** The gap from "doomed" to post-mortem is minutes, not sessions. Players abandon saves they know are lost. A parse nobody reaches pays nothing.

The M1 design already carries the primitive: a PROBATION tier with guaranteed baseline offers and a ~2× breach-penalty asymmetry (`m1-redesign.md` §2.5).

**Mainline victory constraints (v0.9, for the design pass after the gate):**
1. Victory is a network property in the game's own idiom.
2. The final state is visible in the orrery.
3. Play continues after it.
4. No win waits on a clock the player sits out.

### 4.10 The Information Economy — Optional Endgame

The potential terminal pivot of the campaign, and its philosophical core. It is an **opt-in victory path with a gradual, foreshadowed, €-preserving transition** — never a mandatory rule-swap that retroactively devalues the player's money.

**Why the caution.** *Universal Paperclips* flips its currency twice and is beloved — but its terminal goal never changes. *Frostpunk*'s final storm inverts the rules — but it is foreshadowed, and it tests what you built rather than negating it. The documented flops are the cases where a late change devalues prior investment or feels arbitrary. Players call that a bait-and-switch. v0.3 changed the resource *and* the win condition at once. No precedent says that is safe.

**The four de-risking commitments:**
1. **Foreshadow it economically from the early game.** Freshness and uniqueness must make you € long before they become currency. The dashboards surface the repricing as it happens: a "freshness premium" line item that quietly grows.
2. **€ stays relevant, permanently.** You always pay € for the comms, power, launches, and hardware that feed the information mints. You cannot win by hoarding €, but your bank never becomes worthless. The two currencies are coupled, not substitutable. The flip is the terminal of the leverage curve (§4.11) — a trend hours old when it formalises, so it reads as arrival, not ambush.
3. **Information dominance is optional.** Modelled on *Stellaris* "Become the Crisis": a player who loves the carrier and coverage fantasy can win on net worth or coverage empire and never engage the flip. The flip is a door, not a wall.
4. **The flip is gradual and legible.** No single moment where the rules invert and the player is confused. The market reprices over time, visibly, and the dashboards explain the new terms as they emerge.

**The thesis.** At solar-system scale, physics makes one thing genuinely scarce: **information that is current and correct at a specific point in spacetime**. Light guarantees that knowledge cannot be everywhere at once, and staleness destroys it. As the economy matures, the scarce asset can become the reserve currency, and the abundant one inflates toward pocket change *for the frontier*. The flip follows from the physics the game already simulates. Done gradually, it can feel earned.

**Datacenters mint information.** A space DC is an information refinery and, late, a mint. Raw signal in; analyses, forecasts, verified datasets, models out. Output value = f(compute, model quality, input freshness and volume). A well-fed frontier DC is the most productive asset you can own.

**The metabolism — the mint must be fed. This is what makes it tense, not idle:**
- **Information is a flow, not a stock.** You cannot hoard it. Every product has a half-life, and staleness revalues it downward.
- **Datacenters starve.** No fresh input and output collapses toward zero. To keep a DC productive you must continuously route fresh comms *into* it. Late game this is overwhelmingly a backbone problem: the laser spine (§4.3a) is the supply line that feeds the mints. Topology robustness *is* information-wealth defence.
- **Your network becomes a circulatory system.** The pipes you built to sell transport become the supply lines that feed your own factories. Same pipes, opposite direction of value. This closes Pillar 1.
- **The core allocation tension.** Every bit that feeds a DC is a bit not sold as transport. **Sell the pipe (€ now) or feed the mint (information later).** One dial ties comms, DCs, and both currencies into one taut system.
- **Wealth that costs work to keep.** The bigger the mint, the more comms throughput you must sustain just to stop decay. Information empires are not banked — they are *run*. (As a DC must radiate heat or cook, information wealth dissipates as staleness if the flow stops.)

**Information as medium of exchange.** Past a maturity threshold, high-tier transactions settle in information: frontier R&D, exclusive long-horizon contracts, acquiring a rival, the best peering deals. A **reserve information asset** emerges — most plausibly *authoritative, verified, current truth* about the solar system: a canonical ephemeris and positional plus observation ledger no one can fake or back-date. (Working name for the unit: *open* — TBD.) € persists for the mundane and the local. It simply cannot buy the frontier.

**What winning becomes, optionally.** Coverage × freshness × uniqueness. A pure score threshold is an anticlimax, so the win must resolve as a *legible, dramatic final state* — for example: the whole system depends on your mint for its truth, and a rival tries, and visibly fails, to starve you.

**The built-in balance check.** An information superpower has a glass jaw. Its wealth depends on continuous comms flow, so it can be starved: cut a rival's feeds, exploit a conjunction blackout, out-compete for fresh raw data. The bigger the empire, the bigger the metabolic surface to attack. This answers "can the information-rich snowball uncatchably?" and pre-loads the post-1.0 multiplayer fantasy: information warfare through denial of fresh data.

### 4.11 The Leverage Curve

Pillar 7 in full. It ties §4.5, §4.6, §4.7, and §4.10 into one arc rather than four separate systems.

**Capability is discovered through operation, never purchased.** No research building, no tech-point currency. A research sink here is dead time — Factorio's labs survive only because making the science packs *is* the game; we have no such cover. Instead, you unlock the next capability by doing the current one. Launch rockets and your launch operation matures. Hold a laser link across a conjunction and link autonomy surfaces. Run a cache hot and the system offers to manage it for you. Progression is a trace of what you actually did, not a menu of what you paid for. The lineage is KSP: you do not research landing — you learn to land.

**The shape: the unit of command rises.** Not "the same action gets cheaper" — that never reaches flow. The atomic action gets *bigger*: earned automation eats the tier below, so one decision commands many.

| | Atomic unit | Texture | What eats the tier below | devops analogue |
|---|---|---|---|---|
| **Early (T1–2)** | the asset | hand-flown, multi-step, every one precious | nothing — you are the control loop | one server, `ssh` in |
| **Mid (T3)** | the standardised group | templated, repeatable, batch | basic autonomy handles per-node routine | Ansible, Docker |
| **Late (T4–5)** | declared intent | you state desired state; the system converges and self-heals | mature autonomy *is* the control loop | Kubernetes |

The late-game pipe-laying flow is **earned** by early-game scarcity, not given. And the late-game action is declarative: you do not fast-drag ten laser links. You declare the topology (§4.3a) and watch the autonomy layer build and heal it across the orbital cycle.

**The micro/macro stack rises, it does not flatten.** If tech dissolves capacity planning into pure pipe-laying, we trade a rich two-layer manager game for a thin one-layer one. Going declarative *moves the work up a level* — Kubernetes did not end ops toil; it relocated it to policies and reconciliation. The macro of yesterday ("can I afford Mars at all?") becomes trivial. Yesterday's tooling becomes today's micro (tuning the autonomy trust dial). A new macro appears above (the §4.10 metabolism: can I keep the empire alive and defended?). The game stays two-layered at every tier. The layers just keep rising.

**One arc, four systems.** The leverage curve, the launch-cost curve (§4.7), the loop's cadence shift (§3), and the €→information flip (§4.10) are one arc seen four ways. This is the strongest de-risking of Risk 3.

**How discovery works — the template.** The failure modes: a fake-discovery tech node ("unlocks foresight"), or a capability that silently switches on with no a-ha. Genuine discovery: **comprehension first, capability as the reward.** The template: **operate → hit a wall → investigate the wall in the diagnostic view → recognise the pattern → the tool that scales past the wall surfaces there.** The tool answers the question you just formed — handed to you where your hand already was. For players who do not connect the dots, the diagnostic view does more of the work: nudged discovery, always framed as information that was already there, never an achievement popup. The first concrete instance is predictive routing (M1 spec §7.5): suffer reactive outages, see in the trace view that they are periodic and predictable, and the forecast tool surfaces there.

One commitment settles the architecture before the code does: **the tool exists from the start; discovery is promotion, never instantiation.** The forecast is in the sim from day one. What the player discovers is that it is there.

**Leverage is sometimes an axis, not an upgrade.** Predictive optimisation buys efficiency at the cost of cascade fragility — the OpenTTD-timetable and Deutsche-Bahn lesson: one late train propagates downstream through the whole schedule. This couples routing, faults, and hardware, because fault rate is player-influenced (overclocking, cheap hardware). So your *hardware philosophy* selects your *operating philosophy*:
- *Premium and conservative* → low perturbation → optimise tightly → efficient, with a rare catastrophic cascade.
- *Aggressive and redundant* → high perturbation → run with slack → less efficient, but anti-fragile.

Neither dominates. The mastery is knowing that **over-optimisation has a fragility cost, and slack has value**.

**The concrete capability list is deferred until after M1.** Designing nodes before the loop is validated is exactly the premature detail this document keeps refusing.

### 4.12 The Legible Record (The Parse)

§3a established the record as the hinge between "make it work" and "make it optimal". This is the **combat log for information delivery** — the WoW parse and the Zachtronics histogram, made native to a network sim.

**Preconditions:**
- **Complete and honest.** Every served, missed, or stale contract. Every cache hit and miss. Every prefetch, timely or wasted. Every link drop, re-route, blackout. Timestamped and truthful. This is cheap here: the sim *is* the truth layer (§4.1), so the record is just the event stream, surfaced. A record that lies or hides makes analysis worthless and breaks the transferable-knowledge pleasure.
- **Measured against a labeled bar.** Not "73% freshness" but "73%. The self-relative bar on your topology was about 91%. The log shows the conjunction window closed 4 hours before the prefetch fired." The bar is always labeled, never "proven". The default is self-relative: the best achievable on your own network, computed by the solver. Two physics bounds hold always and are stated as bounds: the propagation floor (nothing beats light) and the min-cut ceiling (nothing beats the tightest pipe). Both are cheap to compute and unimpeachable. Population histograms — your build against everyone's — exist only if the runs question (§9) resolves toward comparable runs.
- **Slow-loop friendly.** The optimisation happens between and after runs as much as during. The record is reviewable at rest, not only glanceable in play.

**One record, several views:**
- **Per-contract post-mortem** — delivered freshness and bandwidth versus demand versus achievable. The specific miss is called out: "prefetch fired late", "cache evicted the wrong dataset", "routed over a congesting link".
- **Freshness and utilisation timeline** — a replayable, scrubbable trace of every feed and link across the session. Where it decayed, when a cache went stale, which prefetch was mistimed.
- **Efficiency versus the bar** — delivered value per € and per bit, against the labeled bar (self-relative by default, physics bounds always). The headline number the optimiser grinds down.
- **The trace view** (§4.3a) is the live face of the same instrument.

**Relationship to the floor.** The novice never opens the parse and is not punished. They tame to functional through live cues — freshness-as-saturation (§8) is the at-a-glance hint. The parse is dark matter for them and the whole game for the optimiser. That asymmetry *is* "easy to pick up, hard to master", and it is why the economy must log truthfully from day one: the parse needs real data to surface later, and the M1 gate can ask its sharpest question — *did the player finish wanting to do it better?*

---

## 5. Dashboards and UX — The Make-or-Break Pillar

The product is invisible information. **Visualization is not a feature of the game. It is the survival condition of the game.** The cautionary tale is *Cities: Skylines II*: the press attacked its performance first, but players called the result lifeless — the simulation ran, and you rarely saw it work. Parks sat empty. Services did their work off-screen. The economy could not be read. A deep sim the player cannot see working reads as dead. If we cannot make invisible flows viscerally watchable, we inherit that failure wholesale. This section is priority zero.

**The standard is *Mini Metro*:** network health legible at a glance, with no submenu-diving. Audio as a genuine second information channel. A state readable from across the room.

Reference feel: a NOC / mission-control screen in the 1-bit retro-OS aesthetic (§8). The game frames itself as *your operations console*.

**The three things that must be viscerally visible, or the game fails:**
1. **The growing coverage web — the monument (§1).** It must look and feel like something you built and grew.
2. **Packets and light in flight.** Honest compressed propagation, rendered as moving objects. Watch a ping crawl to Mars. Watch a flow re-route the instant a link drops. The primary teacher of light-delay, and the primary "the sim is alive" signal.
3. **Cache hits, misses, and freshness as felt events** — audible and visible. A well-run network sounds and looks healthy. A staling one degrades perceptibly before the numbers go red.

**Primary views (one excellent view per milestone, not all nine up front):**
1. **The Orrery** — the solar system at selectable scale compression. Assets, animated link flows, coverage shells, light-delay isochrones as overlays. The map is the dashboard, and the home of the monument.
2. **Coverage heatmap** — per-body surface grid, coloured by the selected information dimension. Instantly shows gaps.
3. **Network graph / NOC view** — the link graph live: utilisation, latency, dropped links, re-routing events, packet-flow animation.
4. **Trace view** — the `mtr` of the game (§4.3a). First-class, not a sub-tab. Built as TRACE (`routing-screen.md`).
5. **Latency and light-delay panel** — live one-way times to every body and asset, conjunction warnings, cache hit-rates, freshness distributions.
6. **Finance terminal** — P&L, balance sheet, cashflow runway, per-contract margin, peering ledger, broker positions. Late game: the quietly growing freshness-premium line that foreshadows §4.10.
7. **Launch board** — windows, manifests, risk, insurance, countdowns.
8. **Markets and brokerage** — demand by region and product, competitor pricing, the order book, surfaced arbitrage.
9. **The Parse** (§4.12) — the at-rest analysis view. Dark matter for the novice, the whole game for the optimiser.

**UX principles:**
- Everything carries a timestamp with **information age**. The game never shows "the truth". It shows what your network currently *knows*. (Optional hardcore mode: even your own dashboards suffer telemetry delay.)
- **Audio is an information channel**, not decoration (§8). The health of the network is audible. The first health-soundscape build lands at M2, beside the coverage heatmap.
- **Layered disclosure:** glanceable summary → hover detail → click drill. No critical state requires digging.
- **State lives on the thing that owns it.** The orrery and the rows carry the state; panels give depth. (Lean rule, not an absolute — the finance terminal still owns cash runway, because no orrery object can.)
- **Time controls:** pause plus variable acceleration. Waiting must contain decisions (§3).
- **Colour encodes the signal. Chrome stays mono (§8).** Every hue distinction is redundantly encoded (dither, shape, glyph). A pure-1-bit mode is fully playable.
- **Motion budget rules (v0.9).** Motion is the product, not the cost — Factorio belts move, Mini Metro trains move, and players pay for that motion. So the rules allocate motion, they do not minimise it:
  1. Spend one motion variable per data attribute. Pattern or frequency carries link health. Speed carries packet priority or size. Never both for one attribute.
  2. Aggregate by zoom. At sector scale, show one dithered flow line per link. At node scale, show individual packets.
  3. Foreshadow big changes. Before a re-route, thicken and pulse the failing edge once. The re-route then lands as drama on a calm baseline.
  4. The failure mode to design against is the *becalmed* dashboard, not the busy one. A calm network that looks dead is CS2 with better citations. Rules 1 and 4 are a pair: rule 1 sets the budget, rule 4 spends it. Rule 4 alone licenses clutter.
- **The return screen (v0.9, M2+).** A paused single-player sim has no "while you were away" world state. The return problem is the player's memory. On resume, land on **your last session**: last actions taken, open tenders, the thing you were mid-tuning — one click to focus each. This is the parse scoped to one session (§4.12), so it waits for that build.

---

## 6. Technical Architecture

**Stack:** TypeScript, Three.js (WebGL2), Vite. Browser-native, Chromium primary target. No native shell (SD-2). The code uses standard web APIs only, so a Tauri or Electron wrap stays a future option.

**Module layout:**
- `sim/` — headless, deterministic, f64. Bodies, ephemerides, propagators, link budgets, the routing solver, the economy tick. **No DOM, no Three.js, no input.** Pure TypeScript, testable under Vitest with no WebGL setup. Reusable as a future server authority if multiplayer ever happens.
- `orrery/` — the Three.js scene: floating-origin management, LOD and icon collapse, overlay rendering (shells, link flows, isochrones, packets in flight). Disproportionate early attention, per §5.
- `wm/` — the DD-10 tiling window manager: zone-grid model, drag-to-swap, gutter resize, data-driven presets. Always-tiled invariant. Pure DOM and CSS.
- `panels/` — DOM dashboards: SYSTEM.LOG, telemetry, status strip. 1-bit chrome theme.
- `game/` — orchestration: tick scheduling, save/load, contract and market state machines, AI competitors, the emergent-event generator (§3).
- `data/` — content as JSON: bodies, ephemeris constants, contract templates, balance tables, hand-authored flavour templates. Designer-editable without code.

**Key decisions:**
- **No UI framework.** Imperative DOM and Three.js only. Reasons: the orrery is GPU draw calls, which no framework can schedule or diff; the sim updates every frame, so reactive diffing has nothing to skip; and framework allocation churn competes with the sim and orrery for the 16 ms frame budget. Panels are simple enough that `element.textContent = newValue` is faster and clearer.
- **Iteration velocity is a first-class reason.** Vite HMR applies edits in under a second with state preserved. For a make-or-break-on-visualization project, the save-and-see loop compounds directly into the quality of the thing the game lives or dies on.
- **Determinism first.** A fixed-step integer clock (P0-03), decoupled from render framerate. Analytic propagation means any state is reproducible from seed + action log. This is the backbone of save/load and any future netcode.
- **Truth is f64. The render lie is f32.** Sim positions live as native `number`. Conversion happens *only* at the floating-origin rebase in `src/orrery/`. The truth never touches Three.js `Vector3`.
- **Time is a first-class entity.** One authoritative sim clock. All delays, windows, and freshness derive from it. Time acceleration scales the tick count. It never scales physics constants.
- **Graph performance.** Precompute geometric link windows. Re-solve routes on topology-change events, not every tick.
- **Saves:** seed + initial conditions + ordered action log (replayable), plus periodic state snapshots for fast load. JSON-serialisable from the pure sim layer — no DOM or Three.js state in saves.
- **The purity boundary is build-breaking.** `src/sim/` never imports `three`, DOM APIs, or WebGL. Vitest and code review enforce it.

**Mobile companion — demoted to speculative.** At most a lightweight remote-management app: read dashboards, receive alerts, approve autonomy decisions, queue actions. It leans on the headless sim core, which serves state to a thin client for free. No version target. If 1.0 succeeds and its action set stays narrow, maybe. Otherwise it does not exist.

---

## 7. Multiplayer — Affordance Only

Out of scope for v1. The systems are built so multiplayer *can* be added later without a rewrite:
- The sim core is headless and authoritative → it can run server-side.
- Determinism + action log → lockstep and server-authoritative sync are both viable.
- Peering and broker contracts are counterparty-agnostic → an AI faction and a remote player are the same interface.
- Light-delay is uniquely suited to multiplayer: information asymmetry between players separated by light-minutes is emergent and thematically perfect. You genuinely cannot know what your Mars-side rival just did, for 20 minutes.

The research is blunt: EVE-style brokering is fun largely because it is PvP. That argues for the affordance, and against over-investing in single-player brokering balance. v1 ships single-player.

---

## 8. Art and Audio Direction

**Visual tone — 1-bit retro-OS chrome, coloured signal.** The whole game is a vintage operations terminal: a stark white-on-near-black one-bit OS. Zero photoreal assets; all the load on shape, line, and pattern. Precedent that this works commercially and atmospherically: *Duskers*, *Uplink*, the Zachtronics terminal games. The audience already lives in `tmux` and a syntax-highlighted editor.

**The governing rule: *monochrome machine, living signal*.**
- **The machine — OS chrome, windows, panels, icons, cursor, tools, frames, labels — is strictly 1-bit,** white on near-black (#0B0B12, a hair of cool blue). No greys via colour in the chrome. All tonal variation in the machine comes from **dithering** (ordered/Bayer halftone).
- **The signal — everything in game space the player must actually read — is coloured:** the bodies of the orrery, links, coverage, packets, and the live data in the dashboards. Colour is reserved exclusively for *information* — the scarce, perishable, precious thing the whole game is about (§4.10). The dead grey machine frames the glowing coloured signal.

**Core elements:** windowed OS framing with classic pixel chrome (dithered title bars, blocky glyphs, chunky scrollbars, dashed group frames). Bitmap typefaces: one blocky display face, one legible mono for data. Texture as atmosphere — scattered binary, ASCII-glyph runs, halftone smudges — sparingly, never on live data.

**The colour system:**
- **Per-dimension hues.** Each information dimension (§4.2) gets a stable, learnable hue. A colour means the same thing everywhere.
- **Freshness is saturation — plus lightness (v0.9).** Fresh information is hot and saturated. As it stales, it desaturates toward the dead grey of the machine — and **the ramp must also drop lightness and dither density**, so the stale endpoint reads on the luminance channel, not hue alone. Staleness literally drains the colour out of data, until it fades into the 1-bit substrate. A starving datacenter visibly greys out as its mint runs dry.
- **Links and packets** carry utilisation and health colour: calm, then hot as they congest. Packets in flight are coloured by product or contract.
- **Factions get identity colours.** "Whose infrastructure is that" reads instantly.
- **Two currencies, two treatments.** € amounts and information amounts are visually distinct.
- **Critical state still pops — naturally.** The field is calm (mono chrome, mid-saturation signal), so genuine alarms — blackout, link drop, DC starvation — use the hottest end of the palette and stand out without a reserved emergency colour.
- **Palette:** build the signal palette from Okabe-Ito, with blue-orange as the safest pair.
- **Deadlines and age never share iconography.** A tender countdown is a clock. An age stamp rides the freshness ramp. Different shapes, different channels — or the player re-conflates what §3 separated.

**Terminal syntax highlighting (`SYSTEM.LOG`).** The window frame stays 1-bit; the *content* is highlighted per semantic token, like a code editor: severity (info/warn/error/critical), entity identifiers (asset, link, DC, body names), timestamps and age stamps (on the freshness ramp), faction names (in faction colours), currency values (two treatments). Dense machine output becomes scannable.

**Colour-blind safety — a hard requirement:**
- **Redundant encoding, always.** Every colour-coded distinction is also carried by dither pattern, shape, glyph, or position. Colour is an accelerator, never the sole channel. Turn colour off and the game is fully playable in 1-bit.
- **Selectable safe palettes** (deuteranopia, protanopia, tritanopia) and a brightness/contrast pass.
- **A monochrome purist mode** — dither-only, the pure v0.4 look, optionally with a single-hue CRT-phosphor amber or green flavour.
- Dither patterns and colour ramps must stay distinguishable *in motion*.

**Motion and alarm rules (v0.9):**
1. No element flashes faster than 3 Hz (WCAG 2.3.1).
2. Alarms are edge-triggered and decay. A steady alarm means a real, unresolved problem.
3. Motion density becomes a player setting at M2.
4. A reduced-motion mode ships after the gate. Until then, playtest recruits are screened for motion sensitivity.

**Audio.** Lo-fi to match: CRT hum, blocky UI beeps and key-clacks, modem and telemetry chirps, a satisfying *commit* tone for launches and deals, terse alert blips for link drops and blackouts. **The health of the network is audible** — a smoothly running network sounds different from a congesting one. Music: minimal, generative, ambient.

---

## 9. Development Roadmap

The roadmap front-loads one question: *is the core fun?* Everything speculative is out of the critical path.

**Milestone 0 — sim spike + the visible web.** Headless Kepler propagator, floating-origin orrery, honest packet crawl, time controls. Proves the sim/render split and that we can draw the invisible product. **Done.**

**Milestone 1 — the irreducible fun test. FIRST LIGHT** (`m1-redesign.md`, SD-45). An Earth-orbit connectivity game — the RemoteTech / mission-control fantasy — that culminates in a first taste of Mars and light-delay:
- **Chassis: launch-first.** You throw your network into the sky one hand-aimed shot at a time, then live with where it lands.
- **Braid: beam-pointing.** Satellites do not serve automatically. You point the capacity you own. Re-beaming is instant and free, but it un-serves someone: the continuous lever between launches.
- **Two laws.** LAW 1: facts, never verdicts — instruments show physics facts, never a solved answer before commit. LAW 2: goals, never instructions.
- **One screen: MISSION.** The orrery is an input device, not a picture. Tenders, The Wire, and the ledger live around it. Other desktops are secondary instruments.
- **The economy theorem:** one contract can never pay for its own honest provisioning. Sharing is forced from Act 2 on.
- **The four-act hour:** Act 1 first light (~0–10 min), Act 2 the availability wall (~10–30), Act 3 strain, faults, re-taming (~30–50), Act 4 the Mars teaser, fenced (~50–60), ending on "to be continued".
- Freshness, caching, and light-delay appear only in Act 4, as a fenced teaser. **The session is one hour** — long enough for novelty to wear off and the loop to carry it, and long enough for one full tame-outgrow-re-tame cycle. This milestone gates the entire project.

**Onboarding build rules for the scripted hour:**
1. Real systems only. A scripted beat runs on freeplay code. No one-off tutorial objects.
2. One new concept per beat. The player performs a success before the next concept appears.
3. Real stakes are allowed, and framed as the real game — never tutorial unfairness.
4. Teach the time controls in the first minutes.
5. Scripted failures hurt but never kill. The recoverable spiral is what testers re-run to fix.

**The gate — two layers:**
1. Did the hour of Earth connectivity *sustain* past novelty, and did it leave the player **wanting to do it better**?
2. Did the Mars culmination **hook them into the campaign**? When light-delay broke their playbook, did they engage or stop?

If it passes both, there is a game. If not, no downstream content saves it. Pivot the visualization and the core before building anything else.

**The gate protocol (v0.9, fix pass):**
1. **Two pre-registered bits — one per layer.** *Layer 1, the replay bit:* the tester asks, unprompted, to run the hour again — or accepts a scripted neutral offer to replay. The offer script is fixed before round 1 and identical for every tester. *Layer 2, the continue bit:* the tester asks to continue past the Act 4 stop. "Continue" answers the cliffhanger, so it belongs to layer 2 and never counts toward layer 1. This split also gives layer 2 its measure, which the first draft of this protocol omitted.
2. **Bands.** Layer 1 passes at 4 of 5 or better per round. Layer 2 passes at 3 of 5 or better per round. The compulsion claim is the strong one; the hook claim is the softer one.
3. **Rounds, stopping rule, and the middle verdict — all pre-registered.** Two rounds of about five cold testers. Both rounds clear both bands: pass. Both rounds miss a band: fail. Any other result — middle scores, or disagreement between rounds — buys one final round. If the result is still between bands, the pre-registered verdict is **fail-for-sharpness**: the slice is not compelling enough to build on. The claim under test is a compulsion, and a compulsion does not poll at 60%. Iterate and re-run. Hard cap: three rounds per build. More rounds on the same build teach nothing.
4. **Recruiting.** Strangers who play tycoon or automation games. A paid panel or a community call, with screenshare, dev off camera. Never friends. Never say "my game".
5. **Watch the full hour.** Novelty decay is the thing measured. A shorter watch cuts it off.
6. **Exploratory signals, logged but never gating:** debrief specificity (count named systems in "what would you do differently"), self-correction after a failed beat, alt-tab and wiki-escape, pause-before-decision. These diagnose a failure. They do not pass or fail the gate.
7. **No scales.** No GEQ, no SUS, no home-brew questionnaires. Behavior plus four open debrief questions.

**What the gate falsifies — the six load-bearing claims.** The go/no-go rides the two bits alone. The claims below are what the full signal set — the bits plus the exploratory logs — is used to *revise*, through the subtraction rule below. They never pass or fail the gate themselves. Four are testable at this gate. Two belong to later gates:
1. The §3a fun claim. Measure: unprompted specificity of "what I'd do differently".
2. The §3b endogeneity claim. Measure: does the player attribute escalation to their own success, or to the game?
3. The §4.11 discovery claim. Measure: unprompted discovery versus diagnostic-nudged.
4. The §4.12 novice-floor claim. Measure: can testers who never open the parse reach functional on live cues alone?
5. The §4.10 mastery-preservation claim (M6 gate). Measure: does a master carrier feel advantaged or reset at the flip?
6. The §4.3a same-verb claim (M4 gate). Measure: does the novice verb evolve continuously into the master verb, or break?

**The revise-by-subtraction rule.** After the gate, revise this document by *removing* a refuted claim. Never by reframing it into a new form that preserves it.

**One open question, parked with the gate (v0.9):** if the gate passes *because* run-parse-retry is the fun, then "the campaign is the product" is doctrine, not data. The parse's optimum bar is self-relative (it survives a diverging campaign); the population histogram is not. Decide the campaign's shape — continuous or finite runs — from gate data.

**Milestone 2 — Earth tycoon vertical slice.** Full LEO/GEO coverage grid, demand and contracts, ground stations, the € economy, the launch market, the escalation engine, the narrative generator, one beautiful coverage heatmap, and the first health-soundscape. *Is the core loop fun at Tier 1, across a real session?*

**Milestone 3 — cislunar.** Moon and L-points, relays, the first orbital DC, basic autonomy policies, observation contracts. First real light-delay at ~1.3 s — the on-ramp that teaches the concept before Mars makes it bite.

**Milestone 4 — interplanetary.** Mars, launch windows with waiting-as-decisions, deep-space relays, the full caching and prefetch loop, edge-processing DCs, autonomy tiers, constrained brokering. **The game becomes itself.**

**Milestone 5 — outer system + DTN** *(post-1.0).* Belt, Jupiter, Saturn moons. Store-and-forward routing, predictive replication, nuclear rad-hard DCs, high autonomy, the Level-2 laser backbone.

**Milestone 6 — the optional information economy** *(post-1.0).* The §4.10 flip, prototyped no earlier than after the mid-game economy proves fun. Then speculative interstellar reach, long-horizon scoring, balance, accessibility.

**Deferred or cut from the v1 critical path:** multiplayer (affordance only), the mobile companion (no version target), the local LLM (cut), the outer and interstellar tiers (post-1.0), most of the nine dashboards (one excellent view per milestone).

---

## 10. Risks and Open Questions

| # | Risk | Level | Mitigation |
|---|---|---|---|
| 1 | **Scope for a solo dev.** The v0.3 feature set was five games. | Existential | Ruthless resequencing: prove the core (M0/M1), ship Tiers 1–3, defer everything speculative. Managed structurally, not by willpower. |
| 2 | **The product is invisible.** Bandwidth and freshness are not watchable the way Factorio belts are. | Make-or-break | Visualization is priority zero (§5). The web is the monument. Packets and cache events are felt and audible. M1 exists to prove the invisible is fun. |
| 3 | **The currency flip changes the resource and the win condition.** | High | §4.10: optional, gradual, foreshadowed, € preserved. Prototype no earlier than M6. Playtest whether it lands as climax or confusion. |
| 4 | **Brokering becomes the dominant strategy.** | High | Gated behind infrastructure, margins capped and decaying (§4.4). If testers skip construction for brokering, cut margins before new content ships. |
| 5 | **Datacenters become a bolted-on second game.** | Medium | DCs are a few high-impact nodes; every mechanic feeds the network loop (§4.5). |
| 6 | **Dead-air waiting.** Real windows are months; sessions are minutes. | Medium | The wait is the decision space (§3). How aggressively to compress needs M4 prototyping. |
| 7 | **Onboarding wall.** Light-delay is unintuitive. | Medium | Fidelity only where fun (§4.1). Teach light-delay by sight at cislunar's ~1.3 s before Mars bites (§4.8). Own-network omniscience is an optional hard mode. |
| 8 | **Colour-blind safety.** Colour is load-bearing in game space. | Medium | Redundant encoding always; safe palettes; fully playable mono mode (§8). Playtest the colour-off mode at the gate. |

**Open questions:**
- Is the player's *own* network state delayed (hardcore mode), or only in-fiction data? *Leaning: in-fiction data is always delayed; own-network omniscience is the default, delayed-omniscience is optional hard mode.* (M3–M4.)
- Does the gradual, optional flip land as climax or confusion? (M6 playtesting.)
- Time compression versus waiting-tension. (M4 prototyping.)
- Does the narrative generator produce enough stories to give the spreadsheet a soul — the Football Manager test? (M2 — build rivals and news events early enough to judge.)
- What is the *legible, dramatic* final state for an information-dominance win? (Design before M6.)
- The concrete capability list for §4.11. (Post-M1.)

---

## 11. Market Notes (v0.9)

Not design. Context for decisions about effort and positioning.

- **The niche is empty.** No 2020–2026 game does satellite-constellation network operations. Adjacent games teach the same lessons: the mission-control fantasy sells and menu-heavy delivery kills it (*Mars Horizon*); depth without onboarding is commercial struggle (*Stationeers*); broken promises destroy trust (*KSP2*).
- **The automation genre is in a golden age and undersupplied.** Single-player is the safe default: a 2025 Ampere survey (34k gamers, 22 markets) found 56–58% prefer single-player.
- **Demo culture is the discovery engine for sims.** Demo playtime predicts launch conversion better than raw wishlists. One demo slice at a Steam Next Fest after M2.
- **Honesty is the marketing, post-KSP2.** Visible, honest development is itself the pitch — the Kitten Space Agency precedent.
- **No gen-AI badge.** This project's toolchain is LLM-heavy. A "no generative-AI content" pillar next to a transparency play is a trap: store-page discourse will not honour the line between content and tools. If asked in an FAQ, answer in one honest sentence about shipped content.
- **An empty niche is not proof of a hungry niche.** Before betting on positioning, do the demand-side checks: adjacent-title wishlist velocity, community sizes.

---

*End of v0.9. The GDD stays the why-and-feel document; the mechanics live in the M1 family. Git history tracks every revision, including the deleted `signal-horizon-gdd-simple.md`, `gdd-proposal.md`, and `signal-horizon-player-attack.md` (see SD-54).*
