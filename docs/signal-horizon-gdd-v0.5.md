# SIGNAL HORIZON
### Game Design Document — v0.5 (Pre-Production)

> A satellite & information-network tycoon simulation built in TypeScript + Three.js (browser).
> Working title: **Signal Horizon**. Genre: economic/management sim with orbital-mechanics substrate. Platform: **Desktop-only for the full experience** (Linux/Windows/macOS); a mobile *companion* app for remote management is a speculative, far-post-1.0 goal, not a second port of the whole game. Currency: **EUR (€)** early/mid game — see §4.10 for the late-game currency flip, now reframed as an *optional* endgame path.

---

## 0. What Changed — and Why (read this first)

**v0.5 (this revision) — colour comes back, with one strict rule: *monochrome machine, living signal*.** v0.4 committed to pure 1-bit everywhere and then had to spend a whole risk entry apologising for the legibility cost. v0.5 resolves that tension cleanly by drawing a hard line between *the machine* and *the signal*. The **operating system — windows, chrome, panels, icons, cursor, tools — stays strictly 1-bit white-on-black.** But the **contents of game space (the orrery, coverage, links, packets, the data the player actually has to read) are coloured,** and the **terminal/`SYSTEM.LOG` gets code-editor-style syntax highlighting.** Colour is no longer decoration or a reserved emergency flare — it is the dedicated encoding layer for *information itself*, which is exactly the precious, scarce, living thing the whole game is about (§4.10). The dead grey machine frames the glowing coloured signal. This is a stronger thematic statement than pure 1-bit *and* it fixes the at-a-glance-reading problem §5 demands. Full spec in §8; this change ripples into §2 (Pillar 4), §5, and §10 (Risk 8 is now largely resolved, and a new colour-blind-safety requirement takes its place).

**v0.4 — the research-driven revision.** After benchmarking the concept against the genre's best (Factorio, Dyson Sphere Program, OpenTTD, Mini Metro, Kerbal Space Program, EVE Online, Universal Paperclips, Frostpunk, Per Aspera, the manager-sim family), a handful of findings forced real design changes rather than cosmetic edits. The short version:

1. **The product is invisible, and that is the single make-or-break problem.** Factorio belts and DSP megastructures are *viscerally watchable*; bandwidth, latency, and freshness are not. The cautionary tale is *Cities: Skylines II*, whose deep simulation was widely criticised as lifeless because players **couldn't see it working**. Visualization is therefore promoted from "first-class feature" to **the load-bearing pillar the whole game lives or dies on** (§2, §5). If we can't make light-delayed information *physically watchable and satisfying*, no other system matters.
2. **The currency flip (§4.10) flips both the resource *and* the win condition at once — the riskiest bet in the doc.** The celebrated precedents (Universal Paperclips, Frostpunk) kept the *terminal goal constant* while changing the rules. We don't, by default. So §4.10 is re-architected to be **gradual, heavily foreshadowed, € stays useful, and "information dominance" becomes an *optional* victory path** (the *Stellaris* "Become the Crisis" model) rather than a forced rug-pull that ejects players who love the carrier fantasy.
3. **Brokering threatened to eat the game.** If latency arbitrage is the fattest margin, rational players abandon rockets for a market mini-game. Brokering is now **gated behind owned infrastructure and margin-capped** so it complements the carrier fantasy instead of replacing it (§4.4).
4. **The optional local LLM is cut from v1 entirely.** A late-2025 player survey found ~85% negative sentiment toward generative AI in games. The diegetic *autonomy mechanics* (flight software, station agents) stay and are great; the embedded text-generating model is high reputational risk for near-zero upside and moves to "explicitly post-1.0, may never ship" (§4.6).
5. **Waiting must *be* gameplay.** Time-compression around launch windows risks dead air. The "waiting" is now explicitly filled with caching/prefetch decisions, not a fast-forward button you stare at (§3, §10).
6. **The roadmap is resequenced around one question:** *is watching and optimising light-delayed information flow fun for 30 minutes with no narrative scaffolding?* Milestone 0/1 now exist to answer exactly that before anything else is built. Multiplayer, the mobile companion, the LLM, and the outer/interstellar tiers are pushed firmly out of the v1 critical path (§9).

Everything below reflects these changes. Detailed rationale and the full risk re-ranking are in §10.

---

## 1. Vision Statement

You are not a rocket company. You are an **information empire**.

Rockets, satellites, and ground stations are *means*; the product you sell is **knowledge moved across distance** — coverage, bandwidth, latency, observation, and the brokered data that flows over your network. The fantasy is building from a single ground station and a leased smallsat into a multi-planetary information utility whose backbone spans the solar system and, eventually, reaches beyond it.

The game's signature tension is **physics versus economics**. Light is slow. Mars is far. A customer wants their data *now*, but "now" between Earth and Mars is up to ~22 minutes away one-way. The player who masters where to place information — what to cache, what to pre-compute, whom to peer with — wins. The player who naively treats the solar system like a terrestrial CDN goes bankrupt.

**The monument.** Because the product is invisible, the game needs one thing the player can *see growing* — the equivalent of DSP's megastructure or Factorio's sprawling base. Ours is **the living coverage web**: a glowing, expanding lattice of links, shells, and packet-flows across the solar system. Watching that web spread from a single dot over the Pacific to a backbone that reaches Saturn is the visual fantasy. The empire is invisible; its *shadow on the orrery* is the trophy. This is not UI — it is the game's emotional payoff, and §5 treats it as such.

And in the long arc, the game makes good on its own premise: **information can stop being something you sell for money and become the money itself.** Late-game, the euro *can* demote to small change and *fresh, verified knowledge* becomes the reserve currency — a flip that falls out of the physics rather than being scripted. v0.4 makes this an *opt-in terminal path* rather than a mandatory rug-pull (§4.10).

**One-line pitch:** *OpenTTD meets a relativistically-honest deep-space network, where the speed of light is your hardest constraint and information is the only real currency.*

---

## 2. Design Pillars

1. **Information is the product.** Coverage and data quality are the primary win conditions; hardware is the cost base. Every system ultimately answers "does this help me know more, sooner, in more places?"
2. **Physics is non-negotiable — but only where it's fun.** Orbital mechanics, light-speed delay, and link budgets are simulated honestly enough to *matter* to decisions, abstracted enough to stay fun. We borrow KSP's rule: **fidelity in the dimension that's fun (light-delay, line-of-sight, windows), abstraction everywhere it's a chore (no hand-computed transfer burns — the planner does the math).** The simulation never lies to make the player comfortable; it just doesn't make them do homework.
3. **Distance creates strategy.** The further you expand, the more latency dominates. Caching, prediction, and brokering are not side-features — they are the late-game.
4. **The invisible made visible — THE make-or-break pillar.** Information is invisible by nature, so the game's entire craft is *visualizing* it to the standard *Mini Metro* set: **state legible at a glance with no submenu-diving, audio as a genuine second information channel, one narrow-but-critical player lever, and the network's health readable from across the room.** Colour does much of this at-a-glance work in game space (the machine chrome stays 1-bit; the signal is coloured — §8). This is no longer "UI polish at the end" — it is the first thing we prototype and the thing that, if it fails, kills the project. A deep sim the player can't *see working* is the *Cities: Skylines II* trap, and we treat avoiding it as priority zero.
5. **Scales gracefully outward.** Earth orbit → cislunar → inner planets → outer system → interstellar. Each tier introduces one new dominant constraint, so the game keeps teaching rather than repeating.
6. **Success creates the next problem (the escalation engine).** Borrowed from OpenTTD: a profitable route invites traffic; traffic creates congestion; congestion forces you to re-engineer. Every win should visibly *strain* the network and generate the next gap to close. The loop must escalate, not plateau.

---

## 3. Core Gameplay Loop

**Moment-to-moment (seconds–minutes):**
Observe the web → spot a coverage gap, demand spike, congesting link, or staling cache → decide an action (launch, reposition, lease capacity, sign a peering deal, place/retune a cache) → commit € → *watch the network state visibly respond* (a link lights up, a packet-flow re-routes, a coverage shell thickens). The visible response is the reward; it is not optional polish.

**The escalation engine.** Crucially, success doesn't end the loop — it *strains* it. Serving a region grows its demand (network effects); a profitable link congests; a winning cache stales faster as the world it describes moves. Every solved gap should birth the next one. This is the OpenTTD "your own success is your antagonist" loop, and it is what produces the "just one more fix" compulsion.

**Waiting is gameplay, not a fast-forward button.** When you're waiting out a launch window or a round-trip to the outer system, the *waiting itself* is the decision space: what do you cache, what do you prefetch on a bet, which consistency level do you pay for, which feed do you trust to be still-fresh on arrival? If "waiting" is ever just staring at a time-acceleration slider, we have failed and must add a decision there.

**Session (tens of minutes):**
Plan a launch campaign or expansion to a new orbital regime/body → manage the financing and risk → execute → integrate new assets into the routing/coverage picture → service the new contracts that unlock → discover the new strain that integration created.

**Campaign (the long arc):**
Grow from single-region terrestrial coverage to global → to cislunar → to interplanetary backbone → to an information utility that brokers data across the whole solar system → optionally, to the information-economy endgame (§4.10) and speculative interstellar reach.

The loop is always **gap → asset → integration → revenue → bigger gap**, and the *type* of gap evolves from "coverage hole over the Pacific" early to "unservable latency to the asteroid belt" late.

**Emergent narrative — the manager-sim "stories" hook.** Football Manager and F1 Manager keep players in spreadsheets for thousands of hours largely through *emergent stories*. Signal Horizon needs its own story generator so the network isn't an inert optimisation: **rival operators with names and personalities** who undercut and peer with you, **breaking data-events** (a Mars dust storm spikes observation demand; a science flagship launches and needs backbone *now*; a spectrum auction; a rival's relay fails and their customers come knocking), and **outages with consequences** (a conjunction blackout starves a region for days). These are cheap to author and turn a graph into a place where things *happen to you*.

---

## 4. Core Systems

### 4.1 Orbital Mechanics & The Sim/Render Split

The single most important *architectural* decision (visualization, §5, is the most important *design* decision). Two decoupled layers:

- **Simulation layer (truth):** All bodies and craft are propagated in **real SI units (metres, seconds, kilograms)** using **double-precision (`f64`) Keplerian elements** plus optional SGP4-style propagation for Earth-orbit assets. This layer is engine-agnostic pure math (TypeScript `number` is f64 natively) and runs headless (critical for testing and for keeping multiplayer *possible* later without committing to it now).
- **Render layer (lie):** Positions are scaled, floating-origin-rebased, and rendered in `float32`. The camera defines a local origin; everything is expressed relative to it to avoid precision jitter at solar-system scale. Distant objects collapse to icons/labels.

Why this matters: it keeps coverage, link budgets, and revenue *honest* (computed in real units) while letting the visuals cheat freely. It also sidesteps WebGL's float32 precision limits at solar-system scale — the truth (f64) never touches the Three.js transform (f32).

Orbital model fidelity tiers (player-invisible, perf-driven):
- **Tier 0 — Two-body Keplerian:** default for everything. Cheap, deterministic, analytically propagatable to any time `t`.
- **Tier 1 — Patched conics:** for transfer planning (launch windows, Hohmann/bi-elliptic, gravity assists). **Used by the *launch planner*, not simulated continuously — and the planner does the math so the player never has to.** This is the KSP maneuver-node lesson: expose the *choice* (which window, which trade-off), hide the *calculus*.
- **Tier 2 — Perturbations (J2, drag):** optional for LEO realism (orbital decay as a maintenance cost / gameplay pressure). Decay = a satellite is a depreciating asset that literally falls out of the sky if you stop paying station-keeping.

We deliberately **do not** n-body simulate. Stability, determinism (important for save/load), and performance all argue against it, and players cannot perceive the difference.

### 4.2 Information & Coverage — The Heart

Coverage is modelled as a field over a target surface or volume:

- **Terrestrial / body-surface coverage:** geodesic cell grid (an H3-like hex tiling) over each body. Each cell has demand (population/economic weight), and a coverage value derived from which assets currently have line-of-sight + adequate link budget to it.
- **Volumetric coverage (deep space):** for serving craft/stations in transit, coverage is a reachability question over the link graph rather than a surface grid.

Each cell/target tracks several **information dimensions**, because "coverage" is not one thing:
- **Connectivity** — can data reach here at all?
- **Bandwidth** — how much, per unit time?
- **Latency** — how stale, set by light-distance + queueing + routing hops?
- **Observation** — earth-observation / sensing coverage (imaging, weather, monitoring), a separate product line from comms.
- **Freshness** — for cached/brokered data, how old is it?

**Multi-axis scoring (the Zachtronics lesson).** These dimensions are not just internal state — they are how the player's network is *scored and compared*. A solution is rated on competing axes (coverage / latency / freshness / cost), so there is no single "right" build, just elegant trade-offs. Late-game, the game should be able to render a player's network as a shareable, beautiful **1-bit "network portrait"** with its stat histogram against other players' builds (the Opus Magnum "show your friends the GIF" re-engagement hook, adapted to monochrome).

Demand is generated by **markets**: terrestrial telecom regions, government/observation contracts, deep-space missions (yours and NPCs'), and broker requests. Revenue = demand met × quality × tariff − cost-to-serve, all in €.

### 4.3 Link Budgets, Peering & Routing

The network is a **time-varying directed graph**. Nodes: satellites, ground stations, relays, deep-space stations, partner/competitor nodes. Edges: feasible links, each with:

- **Capacity** (bps) from a simplified link-budget model: f(antenna gain, Tx power, distance², frequency band, weather/atmospheric loss, pointing).
- **Latency** = propagation (distance ÷ c) + processing/queueing.
- **Availability** — windows open and close as geometry changes (a satellite sets below the horizon; a planet occults a link; conjunction blackout when the Sun is between Earth and Mars).
- **Cost** — your own links are capex/opex; partner links cost € per bit via peering agreements.

**Peering & interconnect** is a core economic system, both ground and space:
- **Ground peering:** interconnect at terrestrial exchanges with telcos/competitors. Buy/sell transit, settle in €.
- **Space peering:** cross-link with partner constellations or another operator's relays to reach places you don't cover. Optical inter-satellite links (ISLs) for in-space backbone.
- **Partners vs. competitors:** the same NPC can be both — you peer with them over the Belt while undercutting them at Earth. Relationship state per faction (trust, price, exclusivity). These NPCs are also the cast for the emergent-narrative generator (§3). The contracts/settlement/routing are designed counterparty-agnostically so a remote human *could* slot in later — but that is a free architectural affordance, **not** a v1 deliverable (§7).

Routing: data flows are routed over the graph by a cost function the player can *bias* (cheapest / lowest-latency / most-reliable) and override with policy (e.g., "never route government data over Competitor X"). **Watching packets actually re-route when a link drops is core dashboard theatre — it is one of the primary ways the invisible product becomes visible (§5), so it gets real animation budget, not a log line.**

### 4.4 Light-Speed Delay, Caching & Brokering — The Signature Mechanics

This is the design's differentiator and deserves first-class systems, not flavour. **It is also the first thing we prototype (§9), because if optimising light-delayed information flow isn't fun in a 30-minute slice, nothing downstream saves the game.**

**Delayed information.** Every piece of data has an **age** equal to the light-distance it has travelled plus dwell time in queues/caches. The UI surfaces this everywhere: a Mars telemetry feed is stamped "*as of 14m 22s ago*." Some contracts pay for *freshness*; the late-game economy is largely a fight against staleness. **Make it visible:** a "ping" you can watch crawl across the orrery toward Mars — the propagation rendered as a moving object with honest (compressed) travel time — teaches the entire light-delay concept *by sight*, before it ever bites economically. This is the onboarding teacher (§10).

**Caching as a mechanic.** Because round-trips to the outer system are catastrophically slow, the player places **caches/edge nodes** near demand (a cache at a Mars relay, a Lunar edge node) and runs **prefetch/replication policies**. Mechanics:
- Cache hit → serve locally, low latency, but data may be stale (freshness penalty if the contract demands currency). **A cache hit is a satisfying, audible/visible event** — the Mini Metro "audio as information" principle: you should *hear* and *see* your network working well.
- Cache miss → fetch across the light-gap, pay the latency, the customer waits.
- **Predictive prefetch:** spend compute/€ to pre-position data you forecast will be requested. Good prediction = the core skill expression of the late-game. Over-prefetch wastes bandwidth/storage; under-prefetch starves customers. **This is also what fills the "waiting" with decisions (§3).**
- **Coherence cost:** keeping a cache fresh across a 22-minute gap is expensive; the player chooses per-dataset consistency levels (strong/eventual/best-effort), each with a € and latency profile.

**Information brokers — deliberately constrained so they don't eat the game.** A market layer sitting on top of the network. Brokers buy and sell *data itself*, not just transport. The player can act as a **carrier**, a **broker**, or both. Brokering exploits **latency arbitrage**: the same information has different value at different points in the solar system purely because of *when* it can arrive.

The research warning is explicit: in EVE Online, brokering is compelling because it's PvP with real stakes and effort; against AI, an uncapped arbitrage layer becomes a *solved* dominant strategy that makes building rockets pointless. So in Signal Horizon, brokering is **a complement to the carrier fantasy, not a replacement**, enforced three ways:
1. **You can only broker data you can actually move.** Brokering is gated behind owned (or peered) infrastructure with the capacity and reach to carry the trade. No infrastructure, no arbitrage.
2. **Arbitrage margins are capped and decay** as a route becomes well-known/competed, so it's a *recurring discovery game*, not an infinite money printer.
3. **The highest-value brokering requires the physical network** you built — the carrier and broker fantasies are coupled, not substitutable.

The litmus test: a player who never wants to broker should be able to win as a pure carrier, and a broker should still need to build. If playtests show players beelining to brokering and ignoring construction, margins get cut *before* any new content ships (§10).

### 4.5 Orbital & Deep-Space Datacenters — Compute as Infrastructure (force-multiplier, NOT a second game)

Caching answers *where data lives*; datacenters answer *where data is processed*. Once you accept that shipping raw data across the light-gap is ruinous, the logical move is to **process it near where it's gathered or consumed** — compute in space. This turns §4.4's abstract "spend compute" into physical, buildable infrastructure and gives the player a second capex spine alongside launch.

**The explicit design constraint (per the research):** datacenters must be **a small number of high-impact strategic nodes you place, power, cool, and upgrade — force-multipliers on the information loop — and must NOT become a sprawling base-building / city-builder layer bolted onto the network sim.** Per Aspera's bolted-on colonies (where colonists were "just a number") are the cautionary tale: a parallel sub-game that doesn't talk to the main one. Every DC mechanic below must feed *directly* into the network/coverage/freshness loop, or it's cut.

**Why compute-in-space is a real decision, not flavour.** A space datacenter is governed by genuinely different constraints, each a gameplay lever:
- **Power** is the headline cost. Solar flux falls off with distance² from the Sun — a datacenter at Jupiter gets ~4% of Earth's solar power per panel, so outer-system compute is brutally expensive in panel mass (or forces nuclear/RTG power). Power budget directly caps how much you can process locally.
- **Cooling is radiative only.** In vacuum you reject heat through radiator area alone — heavy and large. Thermal capacity is a hard ceiling on compute density. (The cold-but-empty environment makes cooling *harder*, not easier — a nice "physics surprises you" teaching moment.)
- **Radiation** degrades hardware; pay for rad-hardened silicon (slower, pricier) or accept a higher failure/refresh rate.
- **Latency-to-value:** the entire point. Compute co-located with a Mars sensor array turns 4 TB of raw imagery into a 4 MB analysis product *before* it crosses the light-gap — collapsing both bandwidth cost and effective latency. The player constantly weighs "ship raw and process at Earth" vs. "process at the edge and ship the answer."

**Gameplay roles of a datacenter node (all feed the network loop):**
- **Edge compute / pre-processing:** transmit *conclusions*, not *bytes*. The core economic justification.
- **Cache + coherence host:** datacenters are where caches physically live and where coherence policies (§4.4) execute; bigger DC = bigger/fresher cache.
- **Brokerage compute:** runs the prediction/arbitrage models (§4.4). Better compute → better forecasts → better margins.
- **Autonomy host:** the substrate the autonomous agents in §4.6 run on. No local compute, no local intelligence — distant nodes that lose their DC go "dark and dumb."

**Progression:** ground DC → co-located-with-ground-station → LEO/GEO orbital DC → Lunar/L-point DC → Mars-orbit & surface DC → outer-system DC (nuclear-powered, rad-hard, sparse). Each step trades higher build/power/cooling cost against dramatically better latency-to-value. Space DCs are heavy payloads — they tie directly into the launch system (§4.7) and create satisfying multi-launch construction projects.

**The bigger arc:** datacenters don't just *process* information, they *mint* it — and in the *optional* late-game information economy, information can become the dominant currency, overtaking €. But minted information is perishable and must be continuously fed with fresh communications or it starves. This is specified in §4.10.

### 4.6 Autonomous Edge Intelligence — The Automation Layer (framed as flight software, never "AI")

Light-delay creates a problem nothing else in the design can solve: **you cannot micromanage what you cannot reach in real time.** When Mars is 20 light-minutes away, by the time you see a problem and your command arrives, 40 minutes have passed and the situation has changed. The honest, in-fiction answer — and the one real spacecraft use — is **autonomous intelligence running locally at the edge.**

**Design philosophy (load-bearing, and now reinforced by data).** The automation is *never* surfaced as "AI." No sparkle icon, no "✨ AI-powered" badge, no chat-assistant mascot. It is framed entirely diegetically as **flight software, expert systems, station agents, autonomy packages** — the language a real mission operator uses. A late-2025 player survey (Quantic Foundry, N≈1,800) found roughly **85% negative sentiment toward generative AI in games**, with negativity toward AI-generated quests/dialogue rising sharply year-over-year. That data turns "framing matters" into "framing is a commercial necessity." **If a player can't tell whether it's a clever rules engine or something fancier, we've succeeded.**

**As a game mechanic (diegetic — this is the part we build):**
- **Autonomy policies.** The player configures what distant nodes do on their own when out of contact: reprioritise downlinks, reroute around a dropped link, throttle non-critical traffic, safe-mode on fault, decide *locally* what's worth the bandwidth to send home. You write the standing orders, then live with how they play out across the delay.
- **Autonomy tiers tied to DC compute (§4.5).** No local compute → dumb relay. A real datacenter behind a node → sophisticated local decision-making (triage, bounded peering, predictive prefetch). Better edge compute → better autonomous decisions → less value lost to the light-gap. The automation is *a thing you build and upgrade*, not a given.
- **The trust/risk dial.** More autonomy = better blackout performance but less direct control and the possibility of expensive autonomous mistakes. Tuning how much leash to give distant intelligence is a genuine strategic axis. (Caution: the AI must never *visibly do something stupid* the way CS2's traffic or Per Aspera's drones did — visible incompetence in your agents destroys trust in the whole layer.)
- **Information triage as the killer use.** The single most valuable autonomous function: deciding *what's worth sending* across a constrained, slow link. Good triage policy is late-game skill expression.

**The optional local language model — CUT FROM v1.** v0.3 floated shipping a small offline LLM for dynamic flavour text. Per the research, this is **explicitly out of scope for v1 and may never ship.** Rationale: near-zero gameplay upside, real reputational downside in the current climate, and added scope/QA burden a solo dev can't afford. The diegetic autonomy *mechanics* above need **no** language model — they're rules and policies. All in-world text (SYSTEM.LOG lines, station-agent messages, contract text, broker correspondence) ships **hand-written and templated/procedural**. If — and only if — a local, offline, strictly-cosmetic, un-marketed model ever clearly beats hand-authored content in post-1.0 testing, it can be reconsidered as an optional download. Until then it doesn't exist. The litmus test holds: a player who hates "AI features" plays the whole game, enjoys the autonomy mechanics as "good automation," and never feels a buzzword was sold to them.

### 4.7 Launch Capabilities

Getting mass to orbit (and beyond) is the capex spine of expansion.

- **Launch providers:** early game you *buy* launches on the market (rideshare → dedicated), priced in € per kg to a given orbit, with a **launch window** (transfer geometry) and a **failure probability**. Later you can vertically integrate (R&D + fixed infrastructure, lower marginal €/kg, but you eat the failures).
- **Launch windows** are real: getting to Mars is cheap only near the synodic window (~every 26 months); off-window means far more Δv. This makes **timing** a strategic resource and creates natural campaign rhythm — *as long as the wait is filled with caching/prefetch decisions (§3), not dead air.*
- **Vehicle/payload planning:** a small planning minigame — pick window, vehicle, payload manifest, target orbit; accept the risk profile. **The patched-conic planner does all the math (§4.1); the player makes the choice.**
- **Risk:** launch failure, deployment failure, infant mortality. Insurance is a € market.

### 4.8 Scale Progression (Tech & Map Tiers)

Each tier introduces **one new dominant constraint**, so complexity ramps with reach. **For v1, the critical path is Tiers 1–3.** Tiers 4–5 are post-1.0 content (§9).

| Tier | Reach | New dominant constraint | New systems unlocked |
|---|---|---|---|
| 1 | LEO/MEO/GEO, single region → global Earth | Geometry & weather; orbital decay | Coverage grid, ground peering, ground datacenters, basic launch market, **multi-axis scoring** |
| 2 | Cislunar (Moon, Lagrange points) | First real light-delay (~1.3s); relay placement | Lunar edge caches, first orbital datacenters, L-point relays, observation contracts, basic autonomy policies — **the gentle on-ramp where light-delay is taught before it bites** |
| 3 | Inner planets (Mars, Venus, NEAs) | Minutes-scale delay; conjunction blackouts; launch windows | Deep-space relays, caching/prefetch core loop, edge pre-processing DCs, **constrained** brokering, autonomy tiers tied to DC compute. **This is where the game becomes *itself*.** |
| 4 | Outer system (Belt, Jupiter, Saturn moons) | Tens of minutes–hours delay; sparse demand; power scarcity & radiation | *(post-1.0)* DTN store-and-forward, predictive replication, nuclear rad-hard DCs, high-autonomy edge intelligence, heavy ISL backbone, **optional information-economy onset (§4.10)** |
| 5 | Beyond (Oort, interstellar probes) | Hours–years delay; one-way regimes | *(post-1.0, speculative)* fully autonomous nodes, ultra-long-horizon brokering, mature information economy, legacy/heritage scoring |

The outer tiers lean on **DTN (Delay/Disruption-Tolerant Networking)** — store-and-forward bundles, no end-to-end handshakes — both real and a fertile gameplay vein, but reserved for after the core proves fun.

### 4.9 Economy

- **Primary currency: EUR (€).** All capex, opex, tariffs, peering settlements, broker trades, insurance, and financing are in €. **€ remains useful for the entire game** — even in the information-economy endgame it stays the fuel of the metabolism (§4.10).
- **Capex:** satellites, ground stations, launches, deep-space relays, **datacenters**, power systems (solar arrays, reactors), R&D.
- **Opex:** station-keeping/fuel, power, **datacenter compute & cooling**, staff, partner bandwidth, cache storage, maintenance, hardware refresh, deorbit liabilities.
- **Revenue:** coverage/bandwidth tariffs, observation contracts, **edge-processing / data-product sales**, transit/peering sales, **(capped) broker margins**, latency-arbitrage profit, government/science grants.
- **Financing:** retained earnings, debt, equity rounds, milestone-based government contracts. Bankruptcy is a real lose condition.
- **Markets move:** demand grows with served regions (network effects — this *is* the escalation engine, §3), competitor actions shift prices, macro events create demand shocks (the emergent-narrative generator, §3).
- **The currency shift is optional (see §4.10).** € is the only currency early and mid game. In the *optional* information-economy endgame, information can overtake money for frontier transactions — but € never becomes pointless, and players who don't want the flip can win without it.

### 4.10 The Information Economy — Optional Endgame, Gradual Flip (the riskiest bet, re-architected)

This is the campaign's potential terminal pivot and the philosophical core. v0.4 makes a deliberate change: **it is now an *opt-in* victory path with a *gradual, foreshadowed, €-preserving* transition, not a mandatory rule-swap that retroactively devalues the player's money.**

**Why the change.** The research is clear about when "the rules change late-game" lands versus flops. *Universal Paperclips* flips its currency twice and is beloved — but the *terminal goal never changes* (always maximise paperclips). *Frostpunk*'s final storm inverts the rules but is foreshadowed and *tests* everything you built rather than negating it. The flops are the cases where a late change *retroactively devalues prior investment* or feels arbitrary — what players call a "bait-and-switch." Signal Horizon's v0.3 flip changed *both* the resource *and* the win condition at once, with no precedent for that being safe. So:

**The four de-risking commitments:**
1. **Foreshadow it economically from early game.** Freshness and uniqueness should *make you money in €* long before they ever *become* the currency. The player should *feel* information getting harder to ignore for hours before anything formally flips. The dashboards surface the repricing as it happens (a "freshness premium" line item that quietly grows).
2. **€ stays relevant — permanently.** € remains the fuel of the metabolism: you always pay € for the comms, power, launches, and hardware that *feed* the information mints. You cannot win by hoarding €, but you also never wake up to find your bank account worthless. The two currencies are coupled, not substitutive.
3. **Information dominance is an *optional* victory path, not a forced ending.** Modelled on *Stellaris*'s opt-in "Become the Crisis": a player who loves the carrier/coverage fantasy can pursue a classic net-worth / coverage-empire win and never engage the information-as-currency layer. The flip is a door, not a wall.
4. **The flip is gradual and legible.** No single moment where the rules invert and the player is confused (the documented failure point even in *Paperclips*' Stage-2 transition). The market reprices over time, visibly, with the dashboards explaining the new terms as they emerge.

**The thesis (unchanged).** At solar-system scale, the one thing physics makes genuinely scarce is **information that is current and correct at a specific point in spacetime** — because the speed of light guarantees knowledge can't be everywhere at once, and staleness destroys it. So as the economy matures, the scarce asset (fresh information) *can* become a reserve currency and the abundant one (€) inflates toward pocket change *for the frontier*. The flip falls out of the physics the game already simulates — which is exactly why, done gradually, it can feel earned rather than arbitrary.

**Datacenters mint information.** A space datacenter is an information *refinery* and, late-game, a *mint*. Raw signal in → refined products out (analyses, forecasts, verified datasets, models). Output value = f(compute, model quality, **freshness and volume of input**). A well-fed frontier DC is the most productive asset you can own.

**The metabolism — you must keep feeding them (this is what makes it tense, not idle):**
- **Information is a flow, not a stock.** You cannot hoard it. Every product has a **half-life** and is revalued downward by staleness.
- **Datacenters starve.** No fresh input → output collapses toward zero. To keep a DC productive you must **continuously route fresh communications *into* it.**
- **Your network becomes a circulatory system.** The comms infrastructure you built to *sell transport for €* becomes the supply line that *feeds your information factories*. Same pipes; opposite direction of value. This closes Pillar 1: early you sell the pipe, late you spend the pipe to make the thing that is now money.
- **The core allocation tension.** Bandwidth is finite. Every bit feeding a datacenter is a bit *not* sold as transport revenue. The defining late-game decision: **sell the pipe (€ now) vs. feed the mint (information later)** — one dial tying comms, datacenters, and both currencies into one taut system.
- **Wealth that costs work to keep.** The bigger your minting operation, the more comms throughput you must sustain just to stop your wealth decaying. Information empires are not banked; they are *run*. (Thematic rhyme: just as a DC's heat must be radiated or it cooks, information wealth dissipates as "staleness heat" if the flow stops.)

**Information as medium of exchange (for those who pursue it).** Past a maturity threshold, the market starts settling high-tier transactions in information rather than €: frontier R&D, exclusive long-horizon contracts, acquiring a rival's assets, the most valuable peering deals. A **reserve information asset** emerges as the "hard money" — most likely *authoritative, verified, current truth* about the solar system (a canonical ephemeris/positional + observation ledger no one can fake or back-date). Whoever mints the most trusted, freshest truth effectively issues the reserve currency. (Working name for the unit: *open* — TBD.) € persists for the mundane and local; it simply can't *buy the frontier*.

**What winning becomes (optionally).** For players on this path, the terminal win shifts from net worth (€) to **information dominance**: coverage × freshness × uniqueness across the solar system. Caution from the research: a pure *score victory* (the part of *Stellaris* players find anticlimactic) is a weak climax. So information dominance should resolve through a *legible, dramatic* final state — the moment the whole system depends on *your* mint for its truth and a rival tries (and visibly fails) to starve you — not a quiet number crossing a threshold.

**Strategic consequences (the built-in balancing check).** An information superpower has a glass jaw: its wealth depends on continuous comms flow, so it can be **starved**. Cut a rival's feeds, exploit a **conjunction blackout** (genuinely dangerous late-game — the Sun between you and Mars starves your Mars mint for days), or out-compete them for fresh raw data, and their information wealth decays on its own. This is the answer to "won't the information-rich snowball uncatchably?" — the bigger the empire, the bigger the metabolic surface to attack. It also pre-loads the (post-1.0) multiplayer fantasy: information warfare via denial of fresh data.

---

## 5. Dashboards & UX — THE Make-or-Break Pillar (not "first-class," *load-bearing*)

Because the product is invisible information, **visualization is not a feature of the game — it is the game's survival condition.** The lesson from *Cities: Skylines II* is stark: a deep, correct simulation that the player **cannot see working** reads as lifeless and choreless, and reviews punished it for exactly that. Signal Horizon's entire product is invisible flows; if we can't make them viscerally watchable, we inherit CS2's failure wholesale. So this section is now priority zero, and §9 prototypes it *first*.

**The standard we hold ourselves to is *Mini Metro*'s:** network health legible *at a glance* with no submenu-diving, *audio as a genuine second information channel*, *one narrow-but-critical player lever*, and a state readable from across the room. Reference feel: a NOC + mission-control screen, rendered in the 1-bit retro-OS aesthetic (§8) — old-OS windows on a near-black field. The game is framed as *your operations console*; every dashboard is a window inside it.

**The three things that MUST be viscerally visible (or the game fails):**
1. **The growing coverage web — the monument (§1).** The expanding lattice across the solar system is the player's trophy, the DSP-megastructure equivalent. It must look and feel like something you *built and grew*.
2. **Packets/light in flight.** Honest (compressed) propagation rendered as moving objects — you watch a ping crawl to Mars; you watch a flow re-route the instant a link drops. This is the primary teacher of light-delay and the primary "the sim is alive" signal.
3. **Cache hits/misses and freshness as felt events** — audible and visible, so a well-run network *sounds and looks* healthy and a staling one *degrades perceptibly* before the numbers go red.

**Primary views:**
1. **The Orrery (main 3D view):** the solar system at selectable scale compression. Assets, animated link-flows, coverage shells, and light-delay isochrones as overlays. "The map is the dashboard" made literal — and the home of the monument.
2. **Coverage Heatmap:** per-body surface grid coloured by the chosen information dimension (connectivity / bandwidth / latency / observation / freshness). Instantly shows gaps.
3. **Network Graph / NOC view:** the link graph live — utilisation, latency, dropped links, re-routing events, packet-flow animation.
4. **Latency / Light-Delay panel:** live one-way times to every body and asset, conjunction warnings, cache hit-rates, freshness distributions.
5. **Finance terminal:** P&L, balance sheet, cashflow runway (€), per-contract margin, peering ledger, broker positions — and, late-game, the quietly-growing **freshness-premium / information-balance** lines that foreshadow §4.10.
6. **Launch board:** windows, manifests, risk, insurance, countdowns.
7. **Markets & Brokerage:** demand by region/product, competitor pricing, broker order book, surfaced arbitrage opportunities.

**UX principles:**
- Everything timestamped with **information age** — the game never shows "the truth," only what your network currently *knows*. (Optional hardcore mode: even your own dashboards are subject to telemetry delay.)
- **Audio is an information channel,** not decoration (the Mini Metro lesson): the network's health is audible.
- Layered disclosure: glanceable summary → hover for detail → click to drill in. **No critical state should require digging to find.**
- Time controls: pause + variable acceleration — but remember **waiting must contain decisions (§3),** not be a slider you watch.
- **Colour encodes the signal; chrome stays mono (§8).** Colour is the primary at-a-glance encoding in game space, so it must be colour-blind-safe by *redundant* encoding — every hue distinction is also carried by dither/shape/glyph, selectable safe palettes are offered, and a pure-1-bit monochrome mode is fully playable. Data-ink-maximised, chartjunk-minimised (Tufte-flavoured).
- **One excellent view per milestone, not all seven up front (§9, §10).**

---

## 6. Technical Architecture (TypeScript + Three.js, browser)

**Stack:** TypeScript, Three.js (WebGL2), Vite. **Browser-native** — the app runs in Chromium (SD-2); no native shell. Gameplay, UI, and the hot sim core (orbital propagation, routing over a large time-varying graph) all in one language. Three.js WebGL2 renderer.

**Module layout:**
- `sim/` — headless, deterministic, double-precision. Bodies, ephemerides, propagators, link-budget solver, routing solver, economy tick. **No DOM, no Three.js, no rendering, no input** — plain TypeScript with zero browser dependencies. Testable under Vitest with no WebGL setup, and reusable as a future server authority *if* multiplayer is ever pursued.
- `orrery/` — Three.js scene: floating-origin scene management, orrery, LOD/icon collapse, overlay rendering (coverage shells, link flows, isochrones, **packets-in-flight**). Given §5's priority, this module gets disproportionate early attention.
- `wm/` — DD-10 tiling window manager in the DOM: zone-grid model, drag-to-swap, gutter resize, data-driven presets. Always-tiled invariant. Pure DOM + CSS — no canvas.
- `panels/` — DOM dashboards: SYSTEM.LOG, telemetry, status strip. Styled in the 1-bit chrome theme.
- `game/` — orchestration: tick scheduling, save/load, contract & market state machines, AI competitors/partners, **emergent-event generator (§3)**. Currently lives in `main.ts`; will expand as M1+ systems land.
- `data/` — content as JSON: bodies, ephemeris constants, tech tree, contract templates, balance tables, **hand-authored flavour-text templates (§4.6)** — designer-editable without code.

**Key technical decisions:**
- **Determinism first.** Fixed-step sim tick decoupled from render framerate. Analytic propagation (Kepler → position at absolute `t`) means the sim fast-forwards and any state is reproducible from seed + action log. Backbone of save/load (and, if ever needed, netcode). The spike used a plain f64 accumulator; production replaces it with an integer fixed-step clock (P0-03).
- **Truth is f64; the render lie is f32.** Sim positions/velocities live as native `number` (f64) in `src/sim/`. Conversion to `Float32Array` happens *only* at the floating-origin rebase boundary in `src/orrery/`. Three.js `Vector3` is f32 — the truth never touches it.
- **Floating origin** rebased to camera focus each frame; sim stays in absolute coords.
- **Time as a first-class entity.** A single authoritative sim-clock; all delays, windows, and freshness derive from it. Time-acceleration scales the tick (more fixed steps per frame), never the physics constants.
- **Graph performance:** precompute geometric link windows; re-solve routes only on topology-change events, not every tick.
- **Save format:** seed + initial conditions + ordered action log (replayable) plus periodic state snapshots for fast load. JSON-serialisable from the pure `src/sim/` layer — no DOM/Three.js state in saves.
- **Sim/render purity boundary.** The sim (`src/sim/`) must never import from `three`, DOM APIs, or WebGL. This is enforced by Vitest (sim tests run without a DOM) and by code review. Any violation is a build-breaking mistake.

**Platform path:** the **full game is desktop-browser** (Chromium primary target, any modern Chromium-based browser) — the dense, multi-window operations console (§5, §8) is built for a real screen and pointer, and we are not compromising it for a phone. F11 fullscreen gives a bare, OS-chrome-free window. The code uses only standard web APIs so a native wrapper (Tauri, Electron) remains a future option, but is not on the critical path (SD-2).

**The mobile companion — demoted to speculative.** Not a port; at most a lightweight remote-management app (check dashboards, get pushed alerts, approve/veto autonomy decisions, queue actions). It leans on the headless sim core being able to serve state to a thin client — a property the architecture already supports for free. **It is no longer assigned a version target.** It happens only if 1.0 succeeds and only if its action set can be held narrow; otherwise it doesn't exist.

---

## 7. Multiplayer Readiness (Architectural Affordance Only — Not Built)

Explicitly out of scope, with **no v1 work beyond keeping the door open cheaply.** The relevant systems are built so multiplayer *could* be added later without a rewrite:
- The **sim core is headless and authoritative** → it can run server-side.
- **Determinism + action log** → lockstep or server-authoritative sync are both viable.
- **Peering/broker contracts** are counterparty-agnostic → an AI faction and a remote player are the same interface.
- The light-delay theme is *uniquely* suited to multiplayer: information asymmetry between players separated by light-minutes is emergent and thematically perfect (you genuinely can't know what your Mars-side rival just did for 20 minutes).

This is a "design now, build maybe-never" investment: cheap to honour up front, expensive to retrofit. **The research is blunt that EVE-style brokering is fun largely because it's PvP** — which is an argument *for* the affordance and *against* over-investing in single-player brokering balance. But building multiplayer is a separate project; v1 ships single-player.

---

## 8. Art & Audio Direction (Brief)

**Visual tone — 1-bit retro-OS chrome, coloured signal.** The whole game is a vintage operations terminal: a stark **white-on-near-black, one-bit operating system**, the look of an early bitmap GUI. Strong identity and a perfect fit for a solo/small dev — *zero* photoreal assets, leaning on shape, line, and pattern. Precedent that this works commercially and atmospherically: *Duskers*, *Uplink*, the Zachtronics terminal games — the "old-OS" aesthetic has a proven cult audience that overlaps almost exactly with our systems-thinker target player.

**The governing rule: *monochrome machine, living signal*.** Draw a hard line between *the machine* and *the information flowing through it*. The **machine — the OS chrome, windows, panels, icons, cursor, tools, frames, labels — is strictly 1-bit, dead, cool, white-on-black.** The **signal — everything inside game space that the player must actually read: the orrery's bodies, links, coverage, packets, and the live data in the dashboards — is coloured.** Colour is reserved exclusively for *information*, which is precisely the scarce, perishable, precious thing the entire game is about (§4.10). The dead grey machine frames the glowing coloured signal. Thematically this is sharper than pure 1-bit; practically it fixes the at-a-glance legibility §5 demands without diluting the identity — because the *frame* you see most of the time is still unmistakably 1-bit.

Core elements:
- **Windowed OS framing.** Draggable windows with classic pixel chrome — dithered title bars, blocky glyphs, chunky scrollbars, dashed-line group frames. The desktop *is* the game UI.
- **1-bit chrome.** The OS layer is pure white on near-black (#0B0B12-ish — a hair of cool blue, never dead black). No greys via colour in the chrome — **all tonal variation in the machine comes from dithering** (ordered/Bayer halftone). Title bars, scrollbars, group frames, gauges' housings, table rules: monochrome, always.
- **Coloured signal (game space only).** Inside the orrery and the live data views, colour is the primary information encoding (full system below). The rule of thumb: *if it's part of the computer, it's 1-bit; if it's the information the computer is showing you, it can carry colour.*
- **Bitmap everything.** Pixel-grid icons, hardware-style pixel cursor, bitmap typefaces (one blocky display face, one legible mono for data).
- **Texture as atmosphere.** Scattered binary, ASCII-glyph runs (`▓▒░ ⌗ ·`), halftone smudges — sparingly, as ambient "machine noise," never cluttering live data.

**The colour system (game space).** Colour does real encoding work, so it is designed, not decorative:
- **Per-dimension hues.** Each information dimension (§4.2) gets a stable, learnable hue — connectivity, bandwidth, latency, observation, freshness. The coverage heatmap (§5) tints the surface grid in the selected dimension's ramp; the orrery can tint links and shells the same way, so a colour means the same thing everywhere.
- **Freshness *is* saturation — the signature move.** Fresh information is hot and saturated; as it stales it *desaturates back toward the dead grey of the machine itself*. Staleness literally drains the colour out of data until it fades into the 1-bit substrate. This teaches the game's core mechanic (§4.4, §4.10) by sight — you *watch* a Mars feed's colour bleed away over twenty minutes — and it's beautiful. A starving datacenter (§4.10) visibly greys out as its mint runs dry.
- **Links & packets.** Links carry a utilisation/health colour (calm → hot as they congest); packets-in-flight (§5) are coloured by product type or contract, so you can read what's flowing where at a glance. A dropped backbone link and its re-route are a colour event, not a log line.
- **Factions get identity colours.** Each rival/partner operator (§3) has a signature hue, so "whose infrastructure is that" and "whose data am I brokering" are instantly readable on the web.
- **Two currencies, two treatments.** € amounts and information/"open" amounts (§4.10) are visually distinct, reinforcing the late-game flip — the information balance literally has a different colour from the money.
- **Critical state still pops — but naturally now.** Because the field is calmer (chrome is mono, most signal sits in mid-saturation), genuine alarms — conjunction blackout, link drop, DC starvation — can use the hottest end of the palette and *break out on their own* without a reserved emergency colour. v0.4's "single accent colour for critical state" hack is superseded.

**Terminal syntax highlighting (`SYSTEM.LOG` and comms feeds).** The terminal *window* stays 1-bit (frame, prompt, cursor, scrollbar), but its *content* is syntax-highlighted exactly like a code editor — colour applied per semantic token, not per line:
- **Severity** — info / warn / error / critical each get a level colour, so your eye jumps straight to the red line in a wall of telemetry.
- **Entities** — asset IDs, link IDs, datacenter names, body names are coloured as "identifiers," distinct from prose.
- **Time & freshness** — timestamps and information-age stamps share the freshness ramp above (a "14m 22s ago" that's gone stale reads visibly cooler).
- **Faction names** — rendered in that faction's identity colour, matching the orrery.
- **Values** — € and information amounts in their two currency treatments.
This turns dense machine output from an undifferentiated scroll into something scannable, and it makes "the machine talking" feel like a real systems console (the audience already lives in `tmux` and a syntax-highlighted editor — lean into that fluency).

**Colour-blind-safety is now a hard requirement, not a footnote** (colour is load-bearing in game space, so it must never be the *only* channel):
- **Redundant encoding always.** Every colour-coded distinction is *also* carried by dither pattern, shape, glyph, or position — colour is an accelerator, not the sole signal. Turn colour off entirely and the game is still fully playable in pure 1-bit (dither + shape do the work, as v0.4 specced).
- **Selectable safe palettes** (deuteranopia / protanopia / tritanopia-tuned) and a brightness/contrast pass.
- **A "monochrome purist" mode** that drops colour back to v0.4's pure-1-bit dither-only look — both an accessibility option and a deliberate aesthetic choice for players who want it (and the home of the optional single-hue CRT-phosphor amber/green flavour). The pure-1-bit look survives intact as a mode; colour is the default, not the only, presentation.
- Dither patterns and colour ramps must both stay distinguishable *in motion*, and a scalable-UI / larger-bitmap mode keeps density from hurting legibility.

**Applying it to the hard views:**
- **The orrery:** bodies as dithered circles (phase via dither gradient) on the 1-bit field, orbits as dashed vector lines — but **links, coverage shells, isochrones, and packets carry colour**: links tinted by health, shells by the selected dimension, packets by product, all desaturating with staleness. The geometry is still vector + dither (no shaders, cheap, distinctive); colour rides on top as the information layer.
- **Data dashboards:** dithered bar/line charts, ASCII-ish tables, and blocky gauges housed in 1-bit chrome, with **the data series themselves coloured** by dimension/faction/currency. Dense and legible — the monochrome housing makes the coloured data read louder, not quieter.
- **Generated/agent text (§4.6):** monospace `SYSTEM.LOG`-style window contents with the **syntax highlighting** described above — the retro frame plus per-token colour makes "the machine talking" feel like a real console (and, since the LLM is cut from v1, this is all hand-authored/templated).
- **The shareable network portrait (§4.2):** works in either presentation — a calm 1-bit "stamp" for the purists, or a colour-signal version that shows freshness/coverage at a glance. Both are postable; the colour one is the better marketing asset.

**Audio:** lo-fi to match — CRT hum, blocky UI beeps and key-clacks, modem/telemetry chirps, a satisfying *commit* tone for launches/deals, terse alert blips for link drops and blackouts. **And per §5, audio is a real information channel:** the network's health is *audible* — a smoothly-running network sounds different from a congesting one. Music: minimal, generative, ambient.

---

## 9. Development Roadmap (Resequenced Around Proving the Core)

The single change from v0.3: the roadmap now front-loads the one question that determines whether the game exists at all, and pushes everything speculative out of the critical path.

**Milestone 0 — Sim spike + the visible web (prove the *technical* hard part):** headless Kepler propagator + floating-origin orrery rendering Earth + a few satellites at honest scale, with time controls **and packets-in-flight rendering**. Validates the sim/render split, the precision approach, *and* that we can draw the invisible product. Visualization is in M0, not bolted on later.

**Milestone 1 — The irreducible fun test (prove the *design* hard part):** Earth-orbit + a single relay to Mars, **honest light-delay, and the caching/prefetch decision loop**, with one glanceable map (the growing web + packets) and one finance panel. Multi-axis scoring stub. **The only question this milestone answers: *is watching and optimising light-delayed information flow fun for 30 minutes with no narrative scaffolding?*** If yes, there is a game. If no, no amount of downstream content saves it, and we pivot the visualization/core before building anything else. *This milestone gates the entire project.*

**Milestone 2 — Earth tycoon vertical slice:** full LEO/GEO coverage grid, demand/contracts, ground stations, € economy, launch *market*, the escalation engine (success → congestion), the emergent-narrative generator (rival operators, news events), one beautiful coverage heatmap. **Goal: is the core loop fun at Tier 1 across a real session?**

**Milestone 3 — Cislunar + first light-delay at gentle scale:** Moon/L-points, relays, first orbital datacenter + basic autonomy policies, observation contracts. Introduces the signature delay at ~1.3s — the on-ramp that teaches the concept before Mars makes it bite.

**Milestone 4 — Interplanetary + signature systems:** Mars, launch windows (with *waiting filled by caching decisions*), deep-space relays, full caching/prefetch loop, edge-processing DCs, autonomy tiers, **constrained** brokering and latency arbitrage. **This is where the game becomes *itself*.**

**Milestone 5 — Outer system + DTN** *(post-1.0 candidate):* Belt/Jupiter/Saturn, store-and-forward routing, predictive replication, nuclear rad-hard DCs, high-autonomy edge intelligence, heavy ISL backbone.

**Milestone 6 — Optional information-economy endgame** *(post-1.0):* the §4.10 currency flip, prototyped no earlier than after the mid-game economy is proven fun, built as an *opt-in* victory path. Then interstellar/Oort speculative tier, long-horizon scoring, full dashboard suite, balance, accessibility.

**Explicitly deferred / cut from the v1 critical path:** multiplayer (separate project; affordance only, §7); the mobile companion (no version target, §6); the optional local LLM (cut, may never ship, §4.6); the outer-system and interstellar tiers (post-1.0); five-of-seven dashboards (one excellent view per milestone, §5).

---

## 10. Risks & Open Questions (Re-Ranked by the Research)

**Risk 1 — EXISTENTIAL: scope for a solo/small dev.** The v0.3 feature set was roughly five games (honest orbital mechanics + light-delay economics + space-datacenter builder + peering economy + diegetic AI + multiplayer-ready + mobile companion). Solo-dev failure data is blunt: the most-cited cause of indie projects missing deadlines or being abandoned is scope being too large. **Mitigation (now baked into §9):** ruthless resequencing — prove the core (M0–M1), ship Tiers 1–3, defer everything speculative. This is the risk most likely to kill the project, and it's now managed structurally rather than with willpower.

**Risk 2 — MAKE-OR-BREAK: the cerebral/invisible product vs. tactile satisfaction.** Factorio belts and DSP megastructures are watchable; bandwidth and freshness are not. The *Cities: Skylines II* trap is a deep sim the player can't *see* working. **Mitigation (now §2 Pillar 4 + §5 + M0–M1):** visualization is priority zero; the growing web is the monument; packets-in-flight and cache events are felt, audible, and animated; M1 exists solely to prove the invisible can be made fun. If M1 fails this test, the project pivots or stops.

**Risk 3 — HIGH: the currency flip changes resource *and* win condition.** Precedents that work (Paperclips, Frostpunk) kept the terminal goal constant; ours didn't. **Mitigation (now §4.10):** made *optional* (Stellaris "Become the Crisis" model), *gradual*, *foreshadowed from early game*, with *€ permanently relevant*. Prototype no earlier than M6, after the mid-game is proven fun. Open question that remains: even gradual and optional, does the flip read as a satisfying "the rules just changed" climax, or as confusing? Needs dedicated playtesting; the dashboards surfacing the repricing in real time is the planned teacher.

**Risk 4 — HIGH: brokering becomes the single dominant strategy.** If arbitrage is the fattest margin, players abandon the carrier fantasy. EVE shows brokering is fun mainly because it's PvP-with-stakes; against AI it risks being a solved optimisation. **Mitigation (now §4.4):** gated behind owned infrastructure, margin-capped, decaying margins, highest rewards require the physical network. **Playtest benchmark:** if testers beeline to brokering and ignore construction, margins get cut *before* new content ships.

**Risk 5 — MEDIUM: space datacenters become "a second city-builder bolted on."** A parallel sub-game that doesn't talk to the network sim (Per Aspera's "colonists are just a number"). **Mitigation (now §4.5):** DCs are a *small number of high-impact strategic nodes* (place/power/cool/upgrade), every mechanic feeding the network loop directly — force-multipliers, not base-building.

**Risk 6 — MEDIUM: time-scale compression / dead-air waiting.** Real launch windows are months/years; a session is minutes. Paradox-style games solve pacing with player-controlled acceleration + pause but suffer late-game "nothing to do while waiting." **Mitigation (now §3, §4.7, §5):** the waiting *is* the decision space (cache/prefetch/coherence bets); a time slider you merely watch is treated as a design failure. Open question: how aggressively to compress without undermining the "waiting" tension that makes caching matter? Needs prototyping at M4.

**Risk 7 — MEDIUM: onboarding wall.** Light-delay is unintuitive; OpenTTD's signals and Aurora 4X's depth are cautionary. KSP is the positive model. **Mitigation (now §2 Pillar 2, §4.1, §4.4, §4.8):** fidelity only where fun + abstraction elsewhere; the planner does the math; light-delay is *taught by sight* (watch the ping crawl) at cislunar's gentle ~1.3s scale before Mars makes it bite; difficulty tiers (player-omniscience-of-own-network is an *optional* hard mode, not default).

**Risk 8 — LARGELY RESOLVED in v0.5: aesthetic vs. legibility.** v0.4 worried that pure 1-bit (pattern-not-colour encoding) could hurt the at-a-glance reading §5 demands, and reserved a single accent colour as a hedge. v0.5 resolves this structurally with *monochrome machine, living signal* (§8): the OS chrome stays 1-bit (identity preserved) while game-space signal is coloured (legibility solved), and the terminal gets syntax highlighting. **The risk that replaces it is colour-blind-safety:** because colour is now load-bearing, it must never be the sole channel. **Mitigation (now §8):** redundant encoding (dither/shape/glyph carry every distinction), selectable CVD-safe palettes, and a fully-playable pure-1-bit monochrome mode. **Playtest benchmark:** verify the colour-off mode is genuinely playable, and that the freshness-as-saturation cue reads for colour-blind players via its redundant dither/desaturation channel.

**Resolved/closed since v0.3:**
- *Optional local LLM:* **closed — cut from v1** (§4.6). Reputational risk (≈85% negative AI sentiment), near-zero gameplay upside, scope burden. May reconsider post-1.0 as optional/offline/cosmetic only, or never.
- *Mobile companion:* **demoted** to speculative, no version target (§6). Holds the "manage remotely, don't play remotely" line by simply not committing to it until 1.0 succeeds.

**Open questions that still need answers (and where they get them):**
- The default "hardcore" level — is the player's *own* network awareness delayed, or only in-fiction data products? *Leaning: in-fiction data always delayed; own-network omniscience is an optional hard mode.* (Resolve in M3–M4.)
- Does the optional currency flip land as climax or confusion even when gradual? (M6 playtesting.)
- Time-compression vs. waiting-tension balance. (M4 prototyping.)
- Does the emergent-narrative generator produce enough "stories" to give the spreadsheet a soul (the Football Manager test)? (M2 — build the rival-operator + news-event systems early enough to evaluate.)
- What is the *legible, dramatic* final state for an information-dominance win, so it doesn't end on an anticlimactic score threshold (the Stellaris-victory problem)? (Design before M6.)

---

*End of v0.5. This remains a living document; Milestone 0 + the M1 fun-test gate everything else and should begin before any further system design is locked. v0.2 added datacenters and the autonomy/AI layer and locked the 1-bit art direction. v0.3 added the information-economy endgame and reframed mobile as a companion. v0.4 was the research-driven revision: it promoted visualization to the make-or-break pillar, made the currency flip optional/gradual/€-preserving, constrained brokering so it can't eat the carrier fantasy, fenced datacenters off from becoming a second city-builder, cut the optional LLM from v1, turned "waiting" into gameplay, added the escalation engine and an emergent-narrative generator, and resequenced the roadmap so the irreducible fun question is answered first. **v0.5 reintroduces colour under one rule — *monochrome machine, living signal*: the OS chrome stays strictly 1-bit, while game-space signal (orrery links/coverage/packets and live dashboard data) is coloured, freshness is encoded as saturation that drains to grey as data stales, and the terminal gets code-editor syntax highlighting. This resolves v0.4's aesthetic-vs-legibility risk and replaces it with a colour-blind-safety requirement (redundant encoding + a fully-playable pure-1-bit mode).** The through-line of every change since v0.3: the genre's best games (Factorio, DSP, OpenTTD, Mini Metro, KSP) win by making a system *visible, escalating, and legible* — and the single greatest threat to Signal Horizon is that its product is invisible. Everything here bends toward fixing that, and colour is now one of the sharpest tools for it.*
