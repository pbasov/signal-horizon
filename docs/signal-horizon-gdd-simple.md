# SIGNAL HORIZON
### Game Design Document — Simple English rewrite of v0.8.1

> **About this file.** This is a Simplified Technical English rewrite of `docs/signal-horizon-gdd.md` (v0.8.1). The original GDD is the design authority. This rewrite keeps every fact, number, table, and section reference of the original. It changes the style only: short sentences, active voice, and one term per concept.

> A satellite and information-network tycoon simulation, built in TypeScript + Three.js for the browser.
> Working title: **Signal Horizon**. Genre: economic and management simulation with an orbital-mechanics substrate. Platform: **desktop only for the full experience** (Linux, Windows, macOS). A mobile *companion* application for remote management is a speculative goal after 1.0. It is not a second port of the whole game. Currency: **EUR (€)** in the early and middle game. See §4.10 for the late-game currency flip. The flip is now an *optional* endgame path.

---

## 0. What Changed — and Why (read this first)

**v0.8.1 — a light surgical pass.** The theme of the pass: the early game is connectivity, not caching. The pass also adds concepts from a long design session. This is not a rewrite. The v0.8 concepts all stand and are confirmed by the work below: the parse, the escalation engine, the floor/ceiling pattern, and the leverage curve. The pass has two jobs only.

**First job: a correction.** Earlier drafts implied that the caching, freshness, and light-delay loop is the core that M1 tests. That was wrong, and this pass fixes it. **The early game is a constellation-construction and connectivity puzzle.** This is the RemoteTech / Cisco-Packet-Tracer fantasy. You launch satellites into the correct orbits, you point antennas, and you build a relay network that meets connectivity SLAs while the geometry moves. Freshness, caching, and the information economy are what the game becomes later. In M1, they appear only as a fenced final-act *teaser*.

**Second job: a handful of feel-level concepts from the design session.** They are folded into the existing sections as ideas. The concrete mechanics live in the new companion document `signal-horizon-m1-mechanics.md`:

- **Oversubscription** as the core tension of the early game (§3b). It is the connectivity-era analogue of freshness. It is statistical multiplexing as gameplay.
- The **efficiency-versus-resilience axis** (§4.11). Predictive optimisation buys efficiency at the cost of cascade fragility. It couples routing, faults, and hardware.
- The **capability-discovery template** (§4.11). It finally explains how "discovered through operation" works.
- **GEO and LEO as a permanent strategic axis** (§4.3a). The SLA shape selects the regime. It is not a phase.

**The discipline of this pass.** The GDD stays the "why and feel" document. It does not absorb mechanics detail. The concrete specification — data model, numbers, tick order, the four-act hour — now lives in `signal-horizon-m1-mechanics.md`. This document points to that spec. It does not restate it. That spec is the document that the first prototype lacked. The prototype had the orrery but no gameplay. The reason: every prior document, including this one, described feelings rather than mechanics. The GDD is supposed to describe feelings. The spec is its concrete counterpart.

**v0.8 — naming the fun, and giving the escalation engine a real mechanism.** Two long-missing pieces. Both are foundational.

**First: §3a states what the fun actually is.** The spine is *taming the sprawl*. You move a system from chaos to order. It is visceral, and the game measures it against the bar "does it work?". The mastery layer is *optimising against the parse*. You move a system from order to optimal. It is cerebral, and the game measures it against the bar "how close to the theoretical best?". These are not two activities. They are the same verb held to two different bars. The hinge between them is a legible, honest record — the "combat log for information delivery". This record is the concrete mechanism behind "easy to pick up, hard to master". A novice tames to *functional* and is happy. An optimiser lives in the parse and grinds the gap to *optimal*.

**Second: §3b gives the escalation engine a mechanism.** The engine no longer just asserts "bigger gap". It has three endogenous generators: demand grows where you serve, freshness decays so nothing stays solved, and the leverage curve lets you automate the load. There is also an across-tier rule. Each new tier must invalidate a strategy that worked in the tier before. Otherwise the tier is just a bigger number, and we cut it. Escalation keeps chaos renewing **and** keeps the optimum moving. So neither bar is ever permanently cleared. This promotes the optimisation layer — the §4.2 multi-axis scoring and the §4.3a trace view — from footnote to spine, through the new §4.12 "The Legible Record (The Parse)". It also sharpens the M1 gate to its truest form (§9): *does the player finish a run wanting to look at what happened and do it better?* Pillar 6 now points at the mechanism rather than asserting it.

**v0.7 — the leverage pillar, and the stack is now TypeScript + Three.js.** Two things land together.

**First: a seventh design pillar, "Leverage compounds" (§2).** Section 4.11 specifies it in full. Capability is *discovered through operation, never purchased from a research menu*. There is no research building and no tech-point currency. This is the anti-Factorio-lab stance. The shape of progression: *the unit of command rises*, from asset to fleet to declared intent. Earned automation eats the routine work of the tier below. The late-game "pipe-laying flow" is *earned* by early-game scarcity. The micro/macro stack *rises* rather than flattens. Declarative operations move the work up a level, in the manner of Kubernetes. They do not remove the work. The key insight: the leverage curve, the launch-cost curve (§4.7), the loop's cadence shift (§3), and the €-to-information flip (§4.10) are one arc seen four ways. This de-risks the currency flip (Risk 3). The flip becomes the natural terminal of a curve that began with the first expensive launch of the player. The concrete tech tree is deferred until after M1, by design.

**Second: the project moved off Godot and C#.** The new stack is TypeScript + Three.js + Vite, browser-native (§1, §4.1, §6). A spike proved two things. First, the UX builds at least as naturally, with no loss of numerical fidelity: the spike ported the f64 Kepler truth layer bit-identically to the C# golden master. Second, iteration is dramatically faster: Vite HMR gives a save-and-see cycle in under a second. That speed directly compounds the make-or-break visualization pillar. The earlier WebKitGTK-versus-Chromium parity worry is resolved: the game ships browser-native to Chromium (SD-2). A native wrapper stays a deferred option. It is not a critical-path risk.

**v0.6 — network topology becomes a designed system, with a Level-1 floor and a Level-2 ceiling.** v0.5 and earlier treated routing as substrate (§4.3). The player sets policy intent, the solver routes, and the player watches packets. v0.6 keeps that as the *floor*. It adds §4.3a, which makes the *physical network* a thing that the player can shape.

The hinge is two link types with opposite characters. **RF access links** are forgiving but mediocre, and they are everywhere. **Laser links** are expensive, point-to-point, geometry-fragile, and enormous in bandwidth. They live only on scarce backbone nodes: relays, datacenters, and premium satellites. Optical terminals are finite per node. So you physically cannot mesh everything to everything. The laser backbone is a real allocation problem, not a draw-lines-anywhere sandbox.

This produces a core/edge two-tier network with a real-world shape: a sparse laser-meshed spine, and a dense RF edge that connects to it. There are two levels of player engagement over **one** routing model. **Level 1** is policy intent, the solver, and the diagnostic view. It works with zero laser links, so the M1 gate is untouched. **Level 2** is physical construction of the optical backbone. Level 2 *feeds* the Level-1 solver. It does not bypass it.

The signature payoff is the `mtr` of the game: a **trace view**. It renders the live path of any flow, hop by hop, with delay that accumulates and freshness that drains. Section 5 promotes it to a first-class view. This change is woven through §4.8, §4.10, and §5. In §4.8, the Tier-4 ISL line becomes "the Level-2 system matures here". In §4.10, the backbone is the supply line that feeds the mints. So topology robustness *is* information-wealth defense. Scope discipline holds: Level-1 policy is cheap and can seed at M2. Level-2 laser construction is an M4 system. It gets a placement marker, not a detailed design, until we prove the core (§9). *(Working in-fiction term: "laser link". The spine/lattice metaphor is floated in passing. The diegetic noun is deferred.)*

**v0.5 — colour comes back, with one strict rule: *monochrome machine, living signal*.** v0.4 committed to pure 1-bit everywhere. It then spent a whole risk entry on the legibility cost. v0.5 resolves that tension. It draws a hard line between *the machine* and *the signal*. The operating system — windows, chrome, panels, icons, cursor, tools — stays strictly 1-bit white-on-black. But the contents of game space are coloured: the orrery, coverage, links, packets, and the data that the player must actually read. The terminal (`SYSTEM.LOG`) gets code-editor-style syntax highlighting.

Colour is no longer decoration or a reserved emergency signal. It is the dedicated encoding layer for *information itself*. Information is exactly the precious, scarce, living thing that the whole game is about (§4.10). The dead grey machine frames the glowing coloured signal. This is a stronger thematic statement than pure 1-bit, and it fixes the at-a-glance reading problem that §5 demands. The full specification is in §8. The change ripples into §2 (Pillar 4), §5, and §10. Risk 8 is now largely resolved, and a new colour-blind-safety requirement takes its place.

**v0.4 — the research-driven revision.** We benchmarked the concept against the best games of the genre: Factorio, Dyson Sphere Program, OpenTTD, Mini Metro, Kerbal Space Program, EVE Online, Universal Paperclips, Frostpunk, Per Aspera, and the manager-sim family. The findings forced real design changes, not cosmetic edits. The short version:

1. **The product is invisible, and that is the single make-or-break problem.** Factorio belts and DSP megastructures are viscerally watchable. Bandwidth, latency, and freshness are not. The cautionary tale is *Cities: Skylines II*. Reviewers widely criticised its deep simulation as lifeless, because players **cannot see it working**. So v0.4 promotes visualization from "first-class feature" to **the load-bearing pillar that the whole game lives or dies on** (§2, §5). If we cannot make light-delayed information *physically watchable and satisfying*, no other system matters.

2. **The currency flip (§4.10) changes the resource *and* the win condition at once.** It is the riskiest bet in the document. The celebrated precedents (Universal Paperclips, Frostpunk) kept the *terminal goal constant* while the rules changed. By default, this game does not. So v0.4 re-architects §4.10. The flip is gradual and heavily foreshadowed. € stays useful. "Information dominance" becomes an *optional* victory path, on the *Stellaris* "Become the Crisis" model. It is not a forced rug-pull that ejects players who love the carrier fantasy.

3. **Brokering threatened to eat the game.** If latency arbitrage is the fattest margin, rational players abandon rockets for a market mini-game. So v0.4 gates brokering behind owned infrastructure and caps the margins. It complements the carrier fantasy instead of replacing it (§4.4).

4. **The optional local LLM is cut from v1 entirely.** A late-2025 player survey found roughly 85% negative sentiment toward generative AI in games. The diegetic *autonomy mechanics* (flight software, station agents) stay, and they are good. The embedded text-generating model is high reputational risk for near-zero upside. It moves to "explicitly post-1.0" (§4.6). It can ship after 1.0, or never.

5. **Waiting must *be* gameplay.** Time compression around launch windows risks dead air. The "waiting" is now explicitly filled with caching and prefetch decisions. It is not a fast-forward button that you stare at (§3, §10).

6. **The roadmap is resequenced around one question:** *is watching and optimising light-delayed information flow fun for 30 minutes, with no narrative scaffolding?* Milestones 0 and 1 now exist to answer exactly that question before we build anything else. Multiplayer, the mobile companion, the LLM, and the outer and interstellar tiers are pushed firmly out of the v1 critical path (§9).

Everything below reflects these changes. Detailed rationale and the full risk re-ranking are in §10.

---
## 1. Vision Statement

You are not a rocket company. You are an **information empire**.

Rockets, satellites, and ground stations are *means*. The product that you sell is **knowledge moved across distance**: coverage, bandwidth, latency, observation, and the brokered data that flows over your network. The fantasy is to build from a single ground station and a leased smallsat into a multi-planetary information utility. Its backbone spans the solar system. Eventually, it reaches beyond the solar system.

The signature tension of the game is **physics versus economics**. Light is slow. Mars is far. A customer wants their data *now*. But "now" between Earth and Mars is up to about 22 light-minutes away, one way. The player who masters where to place information wins. That player knows what to cache, what to pre-compute, and with whom to peer. The player who treats the solar system like a terrestrial CDN goes bankrupt.

**The monument.** The product is invisible, so the game needs one thing that the player can *see grow*. It is the equivalent of the DSP megastructure or the Factorio base. Ours is **the living coverage web**: a glowing, expanding lattice of links, shells, and packet flows across the solar system. You watch that web spread from a single dot over the Pacific to a backbone that reaches Saturn. That is the visual fantasy. The empire is invisible. Its *shadow on the orrery* is the trophy. This is not UI. It is the emotional payoff of the game, and §5 treats it as such.

In the long arc, the game keeps its own promise: **information can stop being something that you sell for money, and can become the money itself.** Late in the game, the euro *can* demote to small change. *Fresh, verified knowledge* can become the reserve currency. The flip follows from the physics. It is not scripted. v0.4 makes it an *opt-in terminal path*, not a mandatory rug-pull (§4.10).

**One-line pitch:** *OpenTTD meets a relativistically honest deep-space network. The speed of light is your hardest constraint, and information is the only real currency.*

---

## 2. Design Pillars

1. **Information is the product.** Coverage and data quality are the primary win conditions. Hardware is the cost base. Every system must answer one question: "does this help me know more, sooner, in more places?"

2. **Physics is non-negotiable — but only where it is fun.** The game simulates orbital mechanics, light-speed delay, and link budgets honestly enough to *matter* to decisions. It abstracts them enough to stay fun. We borrow the KSP rule: **fidelity in the dimension that is fun (light-delay, line-of-sight, windows), and abstraction everywhere the physics is a chore.** There are no hand-computed transfer burns. The planner does the math. The simulation never lies to make the player comfortable. It also never makes the player do homework.

3. **Distance creates strategy.** The further you expand, the more latency dominates. Caching, prediction, and brokering are not side features. They are the late game.

4. **The invisible made visible — THE make-or-break pillar.** Information is invisible by nature. So the whole craft of this game is to make it visible, to the standard that *Mini Metro* set: **state legible at a glance, audio as a genuine second information channel, one narrow-but-critical player lever, and network health readable from across the room.** No submenu-diving is necessary. Colour does much of this at-a-glance work in game space. The machine chrome stays 1-bit, and the signal is coloured (§8). This is no longer "UI polish at the end". It is the first thing that we prototype. If it fails, it kills the project. A deep sim that the player cannot *see working* is the *Cities: Skylines II* trap. We treat the avoidance of that trap as priority zero.

5. **Scales gracefully outward.** Earth orbit, then cislunar, then the inner planets, then the outer system, then interstellar. Each tier introduces one new dominant constraint. So the game continues to teach rather than repeat.

6. **Success creates the next problem (the escalation engine).** Borrowed from OpenTTD: a profitable route invites traffic. Traffic creates congestion. Congestion forces you to re-engineer. Every win must visibly *strain* the network and generate the next gap to close. This is not only a feeling. It has a stated mechanism (§3b): three endogenous generators — demand growth, freshness decay, and the automation that you build to hold the load. They renew chaos *and* keep the optimum moving. There is also an across-tier rule: each new tier must invalidate a strategy that worked in the tier before. The loop must escalate, not plateau. And it must escalate *because of the success of the player*, not because the designer placed the next gap.

7. **Leverage compounds.** Capability is *discovered through operation, not purchased from a menu*. There is no research building and no tech-point currency. As you operate something at volume, you *outgrow* hand management of it. Earned automation turns one action into many: a launch becomes a launch campaign, and a launch campaign becomes a self-deploying fleet. A hand-placed link becomes a declared topology that builds and heals itself. The unit of command rises — asset, then fleet, then declared intent — and the same act commands more. This is the curve that the whole campaign rides. It unifies launch economics (§4.7), the micro/macro cadence shift (§3), the automation layer (§4.6), and the €-to-information flip (§4.10) into one arc. Section 4.11 specifies it.

---

## 3. Core Gameplay Loop

**Moment to moment (seconds to minutes):**

Observe the web. Spot a coverage gap, a demand spike, a congesting link, or a staling cache. Decide an action: launch, reposition, lease capacity, sign a peering deal, or place or retune a cache. Commit €. **Watch the network state visibly respond.** A link lights up. A packet flow re-routes. A coverage shell thickens. The visible response is the reward. It is not optional polish.

**Session (tens of minutes):**

Plan a launch campaign or an expansion to a new orbital regime or body. Manage the financing and the risk. Execute. Integrate the new assets into the routing and coverage picture. Service the new contracts that unlock. Discover the new strain that the integration created.

**Campaign (the long arc):**

Grow from single-region terrestrial coverage to global coverage. Grow to cislunar. Grow to an interplanetary backbone. Grow to an information utility that brokers data across the whole solar system. Optionally, grow into the information-economy endgame (§4.10) and speculative interstellar reach.

The loop is always **gap, then asset, then integration, then revenue, then a bigger gap**. The *type* of gap evolves. Early, it is "coverage hole over the Pacific". Late, it is "unservable latency to the asteroid belt". The *cadence* of the loop also evolves. Early, it is slow and deliberate: each launch is a campaign, and the work is capacity planning. Late, it is fast and fluid: you lay backbone in declarative gestures, in pipe-laying flow. The reason is that leverage compounds (Pillar 7, §4.11). The heartbeat speeds up as the unit of command rises.

**Emergent narrative — the manager-sim "stories" hook.** Football Manager and F1 Manager keep players in spreadsheets for thousands of hours, largely through *emergent stories*. Signal Horizon needs its own story generator. Without it, the network is inert optimisation. The generator has three parts. **Rival operators with names and personalities** undercut you and peer with you. **Breaking data-events** happen: a Mars dust storm spikes observation demand, or a science flagship launches and needs backbone *now*. A spectrum auction opens. A relay of a rival fails, and their customers come knocking. **Outages have consequences**: a conjunction blackout starves a region for days. These events are cheap to author. They turn a graph into a place where things *happen to you*.

---
### 3a. What the Fun Is — Taming, Optimising, and the Legible Record

Before the mechanics of the loop, the *pleasure* of the loop. The whole design is downstream of it. A precise name for the pleasure disqualifies a lot of plausible-but-wrong instincts.

**The spine is taming the sprawl.** The most visceral fun in this genre is *creating order from chaos*. A sprawling, straining system that beat you comes under your control. This is the sysadmin and devops pleasure: one server by hand, then ten with Ansible, then a thousand with Kubernetes. The complexity never shrinks. Your *altitude over it* rises. Crucially, **you can only tame complexity that you can see and comprehend**. Incomprehensible complexity is not tamable. It is just suffering (the Aurora-4X failure mode). This is why §5 (visualization) is the make-or-break pillar. It is not UX polish *in service of* the fun. It *is* the delivery mechanism for the fun. Taming is measured against the bar of **functional**: did it become order, and does it work? The test is binary-ish, gut-level, and immediate. This is the floor. Anyone can feel it.

**The mastery layer is optimising against the parse.** Once a system *works*, a second and deeper pleasure opens: you grind it toward *optimal*. This is the WoW combat-log pleasure. You analyse the parse afterwards: where did damage leak, and which cooldown misaligned with which phase? It is also the Zachtronics pleasure: you solved it, here is the histogram of your solution against everyone else's, and now you make it *better*. Optimising is measured against the bar of **optimal**: given that it works, how close is it to the theoretical best? The test is continuous, cerebral, and *deferred*. The fun is in the record, between runs, in the gap between your 73% and the achievable 91%.

**They are the same verb at two bars — and the hinge is the legible record.** Taming to functional and taming to optimal are not two activities. They are one gesture — get the system under control — held to two standards. The thing that converts the first into the second is **an honest, complete, legible record of what happened**. Section 4.12 specifies this "combat log for information delivery". A novice never opens it and tames happily to functional. An optimiser lives in it and grinds toward optimal. This is the concrete mechanism behind *easy to pick up, hard to master*. It is not a casual game with a hardcore mode bolted on. It is one continuous staircase. The optimisation is always one glance at the record away, from the moment a player wonders "can I do better?"

**A design constraint that follows from this:** the floor verb and the ceiling verb must be *the same verb*. Laying one link (floor) and architecting a cycle-robust laser backbone (ceiling) must feel like the same activity at different altitudes: *laying a link, but now you think in topologies*. Otherwise the game is a casual toy with a separate expert game stapled on. The test, applied to every system: is the master's version of this just the novice's version held to a higher bar? Or is it a different thing that the novice never touches? If it is the latter, redesign until it is the former.

**The honest framing of the optimal.** The systems of Signal Horizon are *honest*: real light-delay, real link budgets, real orbital geometry, real DTN. So the knowledge that a player gains by optimising is *transferable*. "Pre-stage the cache before the predictable conjunction blackout, and you beat the light-gap" is a real insight about delayed networks. It is true outside the game too. That is the rarest and most durable pleasure that a sim can offer: comprehension that crosses into exploitation. And it is possible only *because* the sim is the truth layer (§4.1). The design must lavish its attention on the mechanics where optimal play is a *real insight that a player can discover*: conjunction pre-staging, edge-compute-versus-ship-raw, and latency arbitrage. It must not hand the player a number. Those discovery moments are worth the most, because they stay true when the player closes the game.

### 3b. The Escalation Engine — Why the Next Gap Exists

Pillar 6 promises "success creates the next problem". This section says *how*. There are two ways to generate "the next gap". Only one of them works.

**The weak way (rejected): the designer places it.** You reach Mars. The tier table hands you the Belt. The Belt is "bigger" because the latency number is bigger. This is content-tiering. It produces exactly the same-y feeling that kills the genre: the Belt is just Mars with a bigger number, the same game replayed at higher figures. If escalation is only this, the loop does not escalate. It *repeats*.

**The strong way (the design): your own success endogenously degrades your position.** The next gap is *self-generated*. Your solution to the last problem becomes the cause of the next one. It works like the automation of green circuits in Factorio: the automation starves your copper. Three generators, all endogenous:

1. **Demand grows where you serve (the primary generator).** Serve a region well. Its economic weight grows (the §4.9 network effect). Now it demands more than the capacity that you built for it. *The gap that you closed widened itself by being closed.* This is the OpenTTD loop, and it is the heartbeat. Every served gap re-opens one size larger.

2. **Freshness decays, so nothing stays solved (the treadmill).** This generator is unique to the physics of this game. A Factorio belt, once built, stays built. But a freshness contract is *never* done. Stop feeding it and it decays (§8, §4.10). So "the next gap" is often not spatial-and-bigger. It is *temporal-and-recurring*: the same Mars feed goes stale again, because demand rose and your prefetch did not keep up. A *different texture* of gap at the *same* location is itself an antidote to same-y.

3. **The automation that you build to hold the rising load (the leverage curve, §4.11).** Generators 1 and 2 create a rising load. The response is to *automate* it. "How do I stay lazy and make the system run itself" is the purest devops pleasure. But the automation that you build is sized for *today's* scale. Generator 1 guarantees that tomorrow's scale outgrows it. So you build a higher-altitude tool. That tool is itself outgrown later. This is the renewable taming cycle: **tame, then outgrow, then re-tame higher.**

These three are not alternatives. They are **a single three-stroke engine**. Growth raises the load. Decay means that the load is continuous — it is never a one-time build. Automation is you taming the load until growth breaks the scale of your automation. Allocation tension (sell-the-pipe versus feed-the-mint, §4.10) is the *texture* of the hard choices inside the loop.

**The engine of the early game, before freshness exists: oversubscription under moving geometry.** Generator 2 (freshness) is a *late* mechanic. It does not exist in the connectivity-era early game (§4.3a). But the engine still turns, because the early game has its *own* version of "nothing stays solved": **oversubscription**. The offered load of a connectivity contract *varies*, and it can exceed its committed SLA. Your scarce antennas and links cannot honestly cover the peak of every contract at once. So you share infrastructure across contracts whose peaks do not coincide. You cut it as thin as you dare, before a breach costs more than the hardware that you saved. This is **statistical multiplexing as gameplay**. It is real ISP engineering, so it is transferable knowledge (§3a). And it is the tame-the-sprawl tension of the early game: *N contracts, M satellites, honest provisioning needs about 2M satellites — how cleverly do you share?* It is the connectivity-era analogue of the freshness treadmill. The load is continuous and varying. Your solution is always one demand spike away from inadequate. And your own success (generator 1, growth) is what tips a comfortable share into an oversubscribed one. (The concrete mechanics are in the M1 spec, §4.3.)

**Escalation also keeps the optimum moving. This is what makes optimisation (§3a) renewable.** A *static* system gets fully optimised. Then it is solved and dead. (This is why WoW resets the parse every raid tier.) Because demand grows, the optimum that you were grinding toward *shifts*. Your provably near-optimal network is suddenly suboptimal again. A fresh gap between actual and optimal opens, and you re-optimise. So the same engine feeds both bars from §3a. It renews the *chaos* that the tamer fights. It moves the *optimum* that the optimiser chases.

**The across-tier rule (the same-y defense, made into a hard test).** Within a tier, escalation is endogenous — the three generators. *Across* tiers, escalation must be a **new dominant constraint, not a bigger number** (Pillar 5). The hard test: **does the new tier make a strategy from the previous tier stop working?** The Belt is not "Mars but farther". It is where round-trip coherence (viable to Mars) becomes physically impossible. It *forces* pure store-and-forward and predictive replication. That is a different game, not a scaled one. Jupiter is not "the Belt but farther". It is where radiation and one-way DTN break assumptions that held at the Belt. **If a proposed tier does not invalidate a prior strategy, it is just a bigger number. Cut it.**

**The escalation engine, in one paragraph.** Success does not end the loop. It *strains* it. Serving a region grows its demand. A profitable link congests. A winning cache stales faster, as the world that it describes moves. The automation that you built is outgrown. Every solved gap births the next one — *because of your success, not because the designer placed it*. That is what produces the "just one more fix" compulsion, and the emergent "and then this happened" story (§3), with no authored content.

**Waiting is gameplay, not a fast-forward button.** When you wait for a launch window or for a round-trip to the outer system, the *waiting itself* is the decision space. What do you cache? What do you prefetch on a bet? Which consistency level do you pay for? Which feed do you trust to be still fresh on arrival? If "waiting" is ever just a stare at a time-acceleration slider, we failed. We must add a decision there.

---
## 4. Core Systems

### 4.1 Orbital Mechanics and the Sim/Render Split

This is the single most important *architectural* decision. (Visualization, §5, is the most important *design* decision.) There are two decoupled layers:

- **Simulation layer (truth).** The layer propagates all bodies and craft in **real SI units (metres, seconds, kilograms)** with **double-precision (`f64`) Keplerian elements**. It adds optional SGP4-style propagation for Earth-orbit assets. This layer is engine-agnostic pure math. TypeScript `number` is f64 natively. The layer runs headless. That is critical for testing, and it keeps multiplayer *possible* later, without a commitment now.
- **Render layer (lie).** The layer scales positions, rebases them to the floating origin, and renders them in `float32`. The camera defines a local origin. Everything is expressed relative to it. This avoids precision jitter at solar-system scale. Distant objects collapse to icons and labels.

Why this matters: it keeps coverage, link budgets, and revenue *honest*, because they are computed in real units. At the same time, the visuals can cheat freely. It also sidesteps the float32 precision limits of WebGL at solar-system scale. The truth (f64) never touches the Three.js transform (f32).

Orbital model fidelity tiers (invisible to the player, chosen for performance):

- **Tier 0 — two-body Keplerian.** The default for everything. Cheap, deterministic, and analytically propagatable to any time `t`.
- **Tier 1 — patched conics.** For transfer planning: launch windows, Hohmann and bi-elliptic transfers, and gravity assists. **The launch planner uses this tier. The simulation does not run it continuously. The planner does the math, so the player does not.** This is the KSP maneuver-node lesson: expose the *choice* (which window, which trade-off) and hide the *calculus*.
- **Tier 2 — perturbations (J2, drag).** Optional for LEO realism. Orbital decay becomes a maintenance cost and a gameplay pressure. Decay means that a satellite is a depreciating asset. It literally falls from the sky if you stop the station-keeping payments.

We deliberately **do not** simulate n-body gravity. Stability, determinism (important for save and load), and performance all argue against it. Players cannot perceive the difference.

### 4.2 Information and Coverage — The Heart

The game models coverage as a field over a target surface or volume:

- **Terrestrial and body-surface coverage.** A geodesic cell grid (an H3-like hex tiling) covers each body. Each cell has a demand value (population or economic weight). Each cell also has a coverage value. The value derives from which assets currently have line-of-sight and an adequate link budget to that cell.
- **Volumetric coverage (deep space).** To serve craft and stations in transit, coverage is a reachability question over the link graph. It is not a surface grid.

Each cell or target tracks several **information dimensions**, because "coverage" is not one thing:

- **Connectivity** — can data reach this place at all?
- **Bandwidth** — how much data, per unit time?
- **Latency** — how stale, set by light-distance plus queueing plus routing hops?
- **Observation** — earth-observation and sensing coverage (imaging, weather, monitoring). This is a separate product line from comms.
- **Freshness** — for cached or brokered data, how old is it?

**Multi-axis scoring (the optimisation spine, not a footnote).** These dimensions are not just internal state. They are how the game *scores and records* the network of the player, and how the player *grinds toward optimal* (§3a). A solution is rated on competing axes: coverage, latency, freshness, and cost. So there is no single "right" build. There are elegant trade-offs. That is what gives the optimisation layer somewhere to go. The data from these axes is the substance of the legible record, or parse (§4.12). The optimiser analyses it between runs, to find the gap between actual and achievable. Late in the game, the game renders the network of a player as a shareable **"network portrait"**. Its stat histogram stands against the builds of other players. This is the Zachtronics "here is your solution versus everyone else's" hook. If §3a is right that optimisation is a core fun, this is *spine*, not re-engagement garnish.

Demand is generated by **markets**: terrestrial telecom regions, government and observation contracts, deep-space missions (yours and NPC missions), and broker requests. Revenue = demand met × quality × tariff − cost-to-serve, all in €.

### 4.3 Link Budgets, Peering and Routing

The network is a **time-varying directed graph**. Nodes: satellites, ground stations, relays, deep-space stations, and partner or competitor nodes. Edges: feasible links. Each edge has:

- **Capacity** (bps), from a simplified link-budget model: f(antenna gain, Tx power, distance², frequency band, weather and atmosphere loss, pointing).
- **Latency** = propagation (distance ÷ c) + processing and queueing.
- **Availability** — windows open and close as the geometry changes. A satellite sets below the horizon. A planet occults a link. A conjunction blackout happens when the Sun is between Earth and Mars.
- **Cost** — your own links are capex and opex. Partner links cost € per bit, through peering agreements.

**Peering and interconnect** is a core economic system, on the ground and in space:

- **Ground peering.** Interconnect at terrestrial exchanges with telcos and competitors. Buy and sell transit. Settle in €.
- **Space peering.** Cross-link with partner constellations or the relays of another operator. This reaches places that you do not cover. Optical inter-satellite links (ISLs) form the in-space backbone.
- **Partners versus competitors.** The same NPC can be both. You peer with them over the Belt while you undercut them at Earth. Each faction has a relationship state: trust, price, and exclusivity. These NPCs are also the cast of the emergent-narrative generator (§3). The contracts, settlement, and routing are counterparty-agnostic. So a remote human *can* slot in later. But that is a free architectural affordance, **not** a v1 deliverable (§7).

Routing: data flows are routed over the graph by a cost function. The player can *bias* the function (cheapest, lowest-latency, or most-reliable) and can override it with policy. For example: "never route government data over Competitor X". **When a link drops, you watch packets re-route. This is core dashboard theatre.** It is one of the primary ways that the invisible product becomes visible (§5). So it gets real animation budget, not a log line. Section 4.3a below specifies the *physical link substrate* that this routing operates over. This section is the routing *model*: intent in, solver routes, you observe. Section 4.3a is the *graph* that it routes across.

### 4.3a Network Topology and Laser Links — The Network as Built

§4.3 is the routing *model*. The player expresses intent, the solver finds paths, and the player watches. This section is the *physical layer underneath*: the links themselves. It is where players who love building networks get a real construction system. It never forces that depth on players who do not want it. The governing shape is the one that this design uses everywhere: **a Level-1 floor that everyone plays, and a Level-2 ceiling that is available but never required**. (The tiling-WM presets and the orrery viewing presets use the same "curated freedom" principle: present the easy complete path, and leave the deep one open.)

**Orbit altitude is a permanent strategic axis, not a phase (made explicit in v0.8.1).** Before the link types, the *other* physical axis: where you put a satellite is a standing trade-off. The contract selects the regime, and it never stops mattering. Altitude moves several honest-physics properties *together*: footprint, latency, reach, per-user bandwidth, motion, and (later) lifetime. So **GEO and LEO are not early-versus-late tiers. They are specialised tools that you choose between for ever.**

GEO is high, stationary, and sees a third of the planet. It is a superb *broadcaster* and *backbone anchor*: cheap broad coverage, and set-and-forget stability. But its ~240ms round-trip latency floor is a hard physical wall. Its uplink is asymmetric: a cheap fat downlink, and an expensive thin uplink. So it is *useless for low-latency bidirectional service*.

LEO is low and fast-moving, with a small footprint. It is the bidirectional workhorse, with low latency and high per-user bandwidth. *But it moves.* A single LEO satellite cannot hold a region. You need a **constellation** that hands off as satellites rise and set.

**The SLA shape of the contract selects the regime.** A latency-tolerant broadcast wants GEO. A low-latency link wants a LEO constellation. GEO physically cannot help with the second. This is transferable knowledge (§3a: the real trade-offs of real orbital comms). It is also the source of the core *building* puzzle of the early game. (The concrete altitude and regime table, and the launch planner, are in the M1 spec, §2–§3.)

**Two link types, opposite characters.** The graph has two kinds of edge, and they behave in opposite ways:

- **RF access links** — wide beam, forgiving pointing. They depend on ground stations and on the body that you orbit. Bandwidth-limited and range-limited by the inverse-square falloff (§4.3). Cheap, ubiquitous, and robust-but-mediocre. This is the *default plumbing*. The solver routes over it, and the player rarely thinks about an individual RF link. It is the floor.
- **Laser links (optical inter-satellite links)** — point-to-point beams locked between two nodes. Enormous bandwidth, and a negligible per-hop processing penalty. But they are expensive, **finite per node**, and fragile to geometry. This is the *backbone*. It is the part that the player physically builds. (Real-world precedent: the optical inter-satellite mesh that flies today. This is not speculative.)

**Terminals are scarce, and only backbone nodes have them.** A laser link is a committed *pairing*: two nodes lock beams on each other. Each node carries only a small number of optical terminals. Think of a handful, as real spacecraft carry. Crucially, **optical terminals live only on backbone nodes: relays, datacenters, and premium satellites — never on cheap edge smallsats.** Two consequences follow. They are the whole reason that the system is a game rather than a sandbox:

1. **You physically cannot mesh everything to everything.** Every laser link that you commit is a terminal that you cannot point elsewhere. Topology becomes a *resource-allocation* problem: "I have four terminals on this Mars-L-point relay, and six things that I want to reach. What do I give up?" That is exactly the kind of no-free-lunch tension that keeps a build loop alive. The terminal budget is the built-in balancing lever against a single dominant "just full-mesh it" strategy.
2. **The network takes on a real-world core and edge shape.** A sparse **core** of laser-meshed backbone nodes forms a high-bandwidth, low-latency *spine*. A dense **edge** of cheap RF smallsats connects to the nearest core node. This is the actual architecture of real networks: backbone versus access, tier-1 versus eyeball. And the economics of the game *produce* it. The game does not script it. (The spine, viewed whole, reads as a growing **lattice** across the system — a candidate diegetic name, deferred.)

This core and edge structure is also what makes the network *legible*. A flat mesh of everything is unreadable. A two-tier network has an obvious **path shape**. Traffic enters at an edge smallsat. It climbs to its core node over RF. It traverses the laser spine core-to-core. It descends to the destination edge. That climb, traverse, and descend silhouette turns "show me this flow" from noise into a diagnosis. (See the trace view below and in §5.)

**The two levels of engagement — one routing model.**

- **Level 1 (the floor — everyone, from the early game).** The player sets policy *intent* (§4.3). Bias for cheapest, lowest-latency, or most-reliable. Add overrides like "do not route government data over these links" or "balance traffic across these paths". Then lease or peer capacity over RF and partner networks. The solver does path selection. The player *observes and tunes goals*. The player never edits a route. This works with **zero laser links built**. That is why the early game and the M1 fun-gate are untouched by any of this.
- **Level 2 (the ceiling — available, never required, matures at M4).** The player physically *constructs the optical backbone*: which backbone nodes peer with which, where the scarce terminals go, and a topology that survives the orbital cycle. **Level 2 does not bypass Level 1. It feeds it.** You do not hand-route over your laser mesh. You *build* the mesh, and the same Level-1 policy and solver now route over the better graph that you shaped. So a Level-2 player is still playing Level 1. They just improved the substrate. One routing model, one diagnostic view, two depths of authorship. No bifurcation. No "advanced mode" that is secretly a second game.

**Policy gets more expressive as you build more backbone.** The §4.3 policy examples gain physical teeth at Level 2. At Level 1, "do not route government data over these links" is about trust and jurisdiction: whose infrastructure carries your sensitive traffic. At Level 2, you can *satisfy that policy by building your own laser path*. Then the data never transits the node of anyone else. Policy and topology become two routes to the same goal. "Balance traffic" is inert on a flat RF floor. It becomes real once a finite, congestible laser spine exists, with redundant paths to spread the load. The player never writes a next hop. The player shapes the graph and states the intent. The solver does the rest.

**The topology breathes — and the laser spine breathes hardest.** This is the part that no terrestrial network game can have. It follows from the honest orbital mechanics that the game already simulates. An RF link to the ground re-acquires easily. A laser lock between two backbone nodes on divergent orbits must *find and hold* its beam across changing geometry. It **opens and closes predictably as the bodies move**. A cross-link occults. A conjunction blackout severs the Mars segment for days. A topology that is robust *right now* can be broken next orbital season. So the skill in Level 2 is to design a spine that survives the *cycle*. The spine needs enough redundancy that the traffic re-routes over another link when the geometry kills one. And the orrery shows it happening. **The conjunction blackout (§4.4, §4.10) thus becomes the stress-test of a topology that you designed. It is not a random punishment.** Blackouts are geometrically *predictable*. So pre-building the redundant path, or pre-staging the cache, is skill expression, not luck. "I saw the Mars conjunction coming, I built a redundant spine, and my traffic re-routed while the traffic of my rival went dark" is close to the whole game in one sentence.

**The trace view — the `mtr` of the game (first-class, see §5).** The payoff for all of the above is one diagnostic affordance: **pick a flow (a contract, a data product), and the orrery renders its actual current path, hop by hop.** Per-hop delay accumulates. Freshness (§8) drains along the route. A good topology shows a clean climb, traverse, and descend path. A bad one shows traffic that detours across three core hops, because you never built the direct link. This is the build, observe, diagnose, and retune loop made visible. It is the reason that watching the network is fun, at *both* levels. Section 5 names it a primary view. It is not buried in the NOC panel.

**Scope honesty.** Level-1 policy is a light addition on top of routing that the game already needs: the solver from §4.3, plus cost-biasing and overrides, which are cheap. It can seed in around M2. Level-2 laser-backbone construction is a real system: optical terminals as a finite buildable resource, acquisition and tracking geometry, the construction UI, and topology robustness across the cycle. It lands where the game becomes itself (**M4**, alongside the ISL backbone already in the §4.8 Tier-4 row). Per the discipline of this document, it gets a placement marker now. It is not detail-designed until we prove the core loop fun.

---
### 4.4 Light-Speed Delay, Caching and Brokering — The Signature Mechanics

This is the differentiator of the design. It deserves first-class systems, not flavour. **It is also the first thing that we prototype (§9).** If optimising light-delayed information flow is not fun in a 30-minute slice, nothing downstream saves the game.

**Delayed information.** Every piece of data has an **age**. The age equals the light-distance that the data has travelled, plus dwell time in queues and caches. The UI surfaces this everywhere. A Mars telemetry feed is stamped "*as of 14m 22s ago*". Some contracts pay for *freshness*. The late-game economy is largely a fight against staleness. **Make it visible.** You watch a "ping" crawl across the orrery toward Mars. The propagation is a moving object with honest (compressed) travel time. It teaches the entire light-delay concept *by sight*, before the concept ever bites economically. It is the onboarding teacher (§10).

**Caching as a mechanic.** Round-trips to the outer system are catastrophically slow. So the player places **caches and edge nodes** near demand: a cache at a Mars relay, or a Lunar edge node. Then the player runs **prefetch and replication policies**. Mechanics:

- **Cache hit.** You serve locally, with low latency. But the data can be stale. If the contract demands currency, you pay a freshness penalty. **A cache hit is a satisfying, audible and visible event.** This is the Mini Metro "audio as information" principle: you must *hear* and *see* your network work well.
- **Cache miss.** You fetch across the light-gap. You pay the latency. The customer waits.
- **Predictive prefetch.** You spend compute and € to pre-position data that you forecast will be requested. Good prediction is the core skill expression of the late game. Over-prefetch wastes bandwidth and storage. Under-prefetch starves customers. **This is also what fills the "waiting" with decisions (§3).**
- **Coherence cost.** It is expensive to keep a cache fresh across a 22-minute gap. The player chooses a consistency level per dataset: strong, eventual, or best-effort. Each level has a € profile and a latency profile.

**Information brokers — deliberately constrained, so that they do not eat the game.** A market layer sits on top of the network. Brokers buy and sell *data itself*, not just transport. The player can act as a **carrier**, a **broker**, or both. Brokering exploits **latency arbitrage**: the same information has different value at different points in the solar system, purely because of *when* it can arrive.

The research warning is explicit. In EVE Online, brokering is compelling because it is PvP with real stakes and effort. Against AI, an uncapped arbitrage layer becomes a *solved* dominant strategy. It makes building rockets pointless. So, in Signal Horizon, brokering is **a complement to the carrier fantasy, not a replacement**. Three rules enforce this:

1. **You can only broker data that you can actually move.** Brokering is gated behind owned (or peered) infrastructure, with the capacity and reach to carry the trade. No infrastructure, no arbitrage.
2. **Arbitrage margins are capped, and they decay** as a route becomes well-known and competed. So brokering is a *recurring discovery game*, not an infinite money printer.
3. **The highest-value brokering requires the physical network that you built.** The carrier and broker fantasies are coupled, not substitutable.

The litmus test: a player who never wants to broker must be able to win as a pure carrier. And a broker must still need to build. If playtests show players who go straight to brokering and ignore construction, we cut the margins *before* any new content ships (§10).

### 4.5 Orbital and Deep-Space Datacenters — Compute as Infrastructure (force-multiplier, not a second game)

Caching answers *where data lives*. Datacenters answer *where data is processed*. Shipping raw data across the light-gap is ruinous. So the logical move is to **process it near where it is gathered or consumed**: compute in space. This turns the abstract "spend compute" of §4.4 into physical, buildable infrastructure. It gives the player a second capex spine alongside launch.

**The explicit design constraint (from the research):** datacenters must be **a small number of high-impact strategic nodes that you place, power, cool, and upgrade — force-multipliers on the information loop.** They must **not** become a sprawling base-building or city-builder layer bolted onto the network sim. The bolted-on colonies of Per Aspera (where colonists were "just a number") are the cautionary tale: a parallel sub-game that does not talk to the main one. Every DC mechanic below must feed *directly* into the network, coverage, and freshness loop. Otherwise it is cut.

**Why compute-in-space is a real decision, not flavour.** A space datacenter obeys genuinely different constraints. Each constraint is a gameplay lever:

- **Power is the headline cost.** Solar flux falls off with the square of distance from the Sun. A datacenter at Jupiter gets about 4% of the Earth solar power per panel. So outer-system compute is brutally expensive in panel mass, or it forces nuclear and RTG power. The power budget directly caps how much you can process locally.
- **Cooling is radiative only.** In vacuum, you reject heat through radiator area alone. Radiators are heavy and large. Thermal capacity is a hard ceiling on compute density. (The cold-but-empty environment makes cooling *harder*, not easier — a nice "physics surprises you" teaching moment.)
- **Radiation** degrades hardware. Pay for rad-hardened silicon (slower, pricier), or accept a higher failure and refresh rate.
- **Latency-to-value is the entire point.** Compute co-located with a Mars sensor array turns 4 TB of raw imagery into a 4 MB analysis product *before* it crosses the light-gap. This collapses both the bandwidth cost and the effective latency. The player constantly weighs "ship raw and process at Earth" against "process at the edge and ship the answer".

**Gameplay roles of a datacenter node (all feed the network loop):**

- **Edge compute and pre-processing.** Transmit *conclusions*, not *bytes*. This is the core economic justification.
- **Cache and coherence host.** Datacenters are where caches physically live, and where coherence policies (§4.4) execute. A bigger DC means a bigger and fresher cache.
- **Brokerage compute.** The prediction and arbitrage models (§4.4) run here. Better compute gives better forecasts, and better forecasts give better margins.
- **Autonomy host.** This is the substrate that the autonomous agents of §4.6 run on. No local compute means no local intelligence. Distant nodes that lose their DC become "dark and dumb".

**Progression.** Ground DC, then co-located-with-ground-station, then LEO and GEO orbital DC, then Lunar and L-point DC, then Mars-orbit and surface DC, then outer-system DC (nuclear-powered, rad-hard, sparse). Each step trades higher build, power, and cooling cost against dramatically better latency-to-value. Space DCs are heavy payloads. They tie directly into the launch system (§4.7), and they create satisfying multi-launch construction projects.

**The bigger arc.** Datacenters do not just *process* information. They *mint* it. In the *optional* late-game information economy, information can become the dominant currency and can overtake €. But minted information is perishable. You must continuously feed it with fresh communications, or it starves. Section 4.10 specifies this.

### 4.6 Autonomous Edge Intelligence — The Automation Layer (framed as flight software, never "AI")

Light-delay creates a problem that nothing else in the design can solve: **you cannot micromanage what you cannot reach in real time.** Mars is 20 light-minutes away. You see a problem, and your command arrives 40 minutes later. By then, the situation is different. The honest, in-fiction answer — and the answer that real spacecraft use — is **autonomous intelligence that runs locally at the edge**.

**Design philosophy (load-bearing, and now reinforced by data).** The automation is *never* surfaced as "AI". No sparkle icon. No "AI-powered" badge. No chat-assistant mascot. The game frames it entirely diegetically as **flight software, expert systems, station agents, autonomy packages** — the language of a real mission operator. A late-2025 player survey (Quantic Foundry, N ≈ 1,800) found roughly **85% negative sentiment toward generative AI in games**. Negativity toward AI-generated quests and dialogue rises sharply year over year. That data turns "framing matters" into "framing is a commercial necessity". **If a player cannot tell whether it is a clever rules engine or something fancier, we succeeded.**

**As a game mechanic (diegetic — this is the part that we build):**

- **Autonomy policies.** The player configures what distant nodes do on their own when they are out of contact: reprioritise downlinks, reroute around a dropped link, throttle non-critical traffic, safe-mode on fault, and decide *locally* what is worth the bandwidth to send home. You write the standing orders. Then you live with how they play out across the delay.
- **Autonomy tiers tied to DC compute (§4.5).** No local compute means a dumb relay. A real datacenter behind a node means sophisticated local decision-making: triage, bounded peering, and predictive prefetch. Better edge compute gives better autonomous decisions, and less value lost to the light-gap. The automation is *a thing that you build and upgrade*. It is not a given. **This is the engine of the leverage curve (Pillar 7, §4.11).** Each tier of autonomy absorbs the routine of the tier below. That is what lets the unit of command of the player rise, from asset to fleet to declared intent.
- **The trust and risk dial.** More autonomy gives better blackout performance. But it gives less direct control, and it opens the possibility of expensive autonomous mistakes. Tuning how much leash to give distant intelligence is a genuine strategic axis. (Caution: the automation must never *visibly do something stupid*, the way the traffic of CS2 or the drones of Per Aspera did. Visible incompetence in your agents destroys trust in the whole layer.)
- **Information triage as the killer use.** The single most valuable autonomous function is to decide *what is worth sending* across a constrained, slow link. Good triage policy is late-game skill expression.

**The optional local language model — CUT FROM v1.** v0.3 floated a small offline LLM for dynamic flavour text. Per the research, it is **explicitly out of scope for v1. It can ship after 1.0, or never.** Rationale: near-zero gameplay upside, real reputational downside in the current climate, and an added scope and QA burden that a solo developer cannot afford. The diegetic autonomy *mechanics* above need **no** language model. They are rules and policies. All in-world text (SYSTEM.LOG lines, station-agent messages, contract text, broker correspondence) ships **hand-written and templated or procedural**. If — and only if — a local, offline, strictly-cosmetic, un-marketed model ever beats hand-authored content in post-1.0 testing, we can reconsider it. Then it becomes an optional download. Until then, it does not exist. The litmus test holds: a player who hates "AI features" plays the whole game, enjoys the autonomy mechanics as "good automation", and never feels that we sold them a buzzword.

### 4.7 Launch Capabilities

Getting mass to orbit and beyond is the capex spine of expansion.

- **Launch providers.** In the early game, you *buy* launches on the market: rideshare first, then dedicated. Price is in € per kg to a given orbit. Each launch has a **launch window** (transfer geometry) and a **failure probability**. Later, you can vertically integrate: R&D plus fixed infrastructure, with a lower marginal €/kg — but you absorb the failures. This progression is one face of the leverage curve (Pillar 7, §4.11). Launch goes from "buy one seat and hand-fly it" to "operate a reusable fleet on standing orders". The unit of command rises: from the single launch, to the campaign, to the self-deploying constellation.
- **Launch windows are real.** Getting to Mars is cheap only near the synodic window, about every 26 months. Off-window means far more Δv. This makes **timing** a strategic resource. It also creates natural campaign rhythm — *as long as the wait is filled with caching and prefetch decisions (§3), not dead air.*
- **Vehicle and payload planning.** A small planning minigame: pick the window, the vehicle, the payload manifest, and the target orbit. Then accept the risk profile. **The patched-conic planner does all the math (§4.1). The player makes the choice.**
- **Risk.** Launch failure, deployment failure, and infant mortality. Insurance is a € market.

---
### 4.8 Scale Progression (Tech and Map Tiers)

Each tier introduces **one new dominant constraint**, so complexity ramps with reach. **For v1, the critical path is Tiers 1–3.** Tiers 4–5 are post-1.0 content (§9).

| Tier | Reach | New dominant constraint | New systems unlocked |
|---|---|---|---|
| 1 | LEO, MEO, GEO. Single region, then global Earth | Geometry and weather. Orbital decay | Coverage grid, ground peering, ground datacenters, basic launch market, **multi-axis scoring** |
| 2 | Cislunar (Moon, Lagrange points) | First real light-delay (about 1.3s). Relay placement | Lunar edge caches, first orbital datacenters, L-point relays, observation contracts, basic autonomy policies, **Level-1 routing policy and the trace and diagnostic view (§4.3a, §5)** — **the gentle on-ramp where the game teaches light-delay before it bites** |
| 3 | Inner planets (Mars, Venus, NEAs) | Delay at minutes scale. Conjunction blackouts. Launch windows | Deep-space relays, the caching and prefetch core loop, edge pre-processing DCs, **constrained** brokering, autonomy tiers tied to DC compute. **This is where the game becomes itself.** |
| 4 | Outer system (Belt, Jupiter, Saturn moons) | Delay of tens of minutes to hours. Sparse demand. Power scarcity and radiation | *(post-1.0)* DTN store-and-forward, predictive replication, nuclear rad-hard DCs, high-autonomy edge intelligence, **the Level-2 laser-backbone topology system matures (§4.3a): heavy optical spine, terminal-budget allocation, cycle-robust meshing**, **optional information-economy onset (§4.10)** |
| 5 | Beyond (Oort, interstellar probes) | Delay of hours to years. One-way regimes | *(post-1.0, speculative)* fully autonomous nodes, ultra-long-horizon brokering, mature information economy, legacy and heritage scoring |

The outer tiers lean on **DTN (Delay/Disruption-Tolerant Networking)**: store-and-forward bundles, with no end-to-end handshakes. It is both real and a fertile gameplay vein. But it is reserved for after the core proves fun.

### 4.9 Economy

- **Primary currency: EUR (€).** All capex, opex, tariffs, peering settlements, broker trades, insurance, and financing are in €. **€ stays useful for the entire game.** Even in the information-economy endgame, it stays the fuel of the metabolism (§4.10).
- **Capex:** satellites, ground stations, launches, deep-space relays, **datacenters**, power systems (solar arrays, reactors), and R&D.
- **Opex:** station-keeping and fuel, power, **datacenter compute and cooling**, staff, partner bandwidth, cache storage, maintenance, hardware refresh, and deorbit liabilities.
- **Revenue:** coverage and bandwidth tariffs, observation contracts, **edge-processing and data-product sales**, transit and peering sales, **capped** broker margins, latency-arbitrage profit, and government and science grants.
- **Financing:** retained earnings, debt, equity rounds, and milestone-based government contracts. Bankruptcy is a real lose condition.
- **Markets move.** Demand grows with served regions (network effects — this *is* the escalation engine, §3). Competitor actions shift prices. Macro events create demand shocks (the emergent-narrative generator, §3).
- **The currency shift is optional (see §4.10).** € is the only currency in the early and middle game. In the *optional* information-economy endgame, information can overtake money for frontier transactions. But € never becomes pointless. And players who do not want the flip can win without it.

### 4.10 The Information Economy — Optional Endgame, Gradual Flip (the riskiest bet, re-architected)

This is the potential terminal pivot of the campaign, and its philosophical core. v0.4 makes a deliberate change: **it is now an *opt-in* victory path with a *gradual, foreshadowed, €-preserving* transition.** It is not a mandatory rule-swap that retroactively devalues the money of the player.

**Why the change.** The research is clear about when "the rules change late-game" lands, and when it flops. *Universal Paperclips* flips its currency twice and is beloved. But its *terminal goal never changes*: always maximise paperclips. The final storm of *Frostpunk* inverts the rules. But it is foreshadowed, and it *tests* everything that you built rather than negating it. The flops are the cases where a late change *retroactively devalues prior investment* or feels arbitrary. Players call that a "bait-and-switch". The v0.3 flip of Signal Horizon changed *both* the resource *and* the win condition at once. There was no precedent for that being safe. So:

**The four de-risking commitments:**

1. **Foreshadow it economically from the early game.** Freshness and uniqueness must *make you money in €* long before they ever *become* the currency. The player must *feel* information get harder to ignore, for hours, before anything formally flips. The dashboards surface the repricing as it happens: a "freshness premium" line item that quietly grows.
2. **€ stays relevant — permanently.** € remains the fuel of the metabolism. You always pay € for the comms, power, launches, and hardware that *feed* the information mints. You cannot win by hoarding €. But your bank account also never becomes worthless. The two currencies are coupled, not substitutable. *(The flip is the terminal of the leverage curve, §4.11. As capital gets cheap and leveraged, € naturally demotes toward small change the whole time. The flip formalises a trend that started hours earlier. That is the strongest de-risking of all.)*
3. **Information dominance is an *optional* victory path, not a forced ending.** Modelled on the opt-in "Become the Crisis" of *Stellaris*: a player who loves the carrier and coverage fantasy can pursue a classic net-worth or coverage-empire win, and never engage the information-as-currency layer. The flip is a door, not a wall.
4. **The flip is gradual and legible.** There is no single moment where the rules invert and the player is confused. (That is the documented failure point even in the Stage-2 transition of *Paperclips*.) The market reprices over time, visibly, and the dashboards explain the new terms as the terms emerge.

**The thesis (unchanged).** At solar-system scale, the one thing that physics makes genuinely scarce is **information that is current and correct at a specific point in spacetime**. The speed of light guarantees that knowledge cannot be everywhere at once, and staleness destroys it. So, as the economy matures, the scarce asset (fresh information) *can* become a reserve currency. The abundant one (€) inflates toward pocket change *for the frontier*. The flip follows from the physics that the game already simulates. That is exactly why, done gradually, it can feel earned rather than arbitrary.

**Datacenters mint information.** A space datacenter is an information *refinery* and, late in the game, a *mint*. Raw signal goes in. Refined products come out: analyses, forecasts, verified datasets, models. Output value = f(compute, model quality, **freshness and volume of input**). A well-fed frontier DC is the most productive asset that you can own.

**The metabolism — you must feed them continuously. This is what makes it tense, not idle:**

- **Information is a flow, not a stock.** You cannot hoard it. Every product has a **half-life**, and staleness revalues it downward.
- **Datacenters starve.** No fresh input means that output collapses toward zero. To keep a DC productive, you must **continuously route fresh communications *into* it**. Late in the game, this is overwhelmingly a *backbone* problem. The laser spine that you built at Level 2 (§4.3a) is the supply line that feeds the mints. So **topology robustness becomes information-wealth defense**. A conjunction blackout that severs your Mars laser link does not just drop traffic. It starves the mint behind it. The spine that you engineered to survive the orbital cycle is, by the endgame, the thing that keeps your wealth from decay.
- **Your network becomes a circulatory system.** The comms infrastructure that you built to *sell transport for €* becomes the supply line that *feeds your information factories*. Same pipes. Opposite direction of value. This closes Pillar 1: early, you sell the pipe. Late, you spend the pipe to make the thing that is now money.
- **The core allocation tension.** Bandwidth is finite. Every bit that feeds a datacenter is a bit *not* sold as transport revenue. The defining late-game decision: **sell the pipe (€ now) or feed the mint (information later)**. One dial ties comms, datacenters, and both currencies into one taut system.
- **Wealth that costs work to keep.** The bigger your minting operation, the more comms throughput you must sustain, just to stop your wealth from decay. Information empires are not banked. They are *run*. (Thematic rhyme: just as a DC must radiate its heat or it cooks, information wealth dissipates as "staleness heat" if the flow stops.)

**Information as medium of exchange (for those who pursue it).** Past a maturity threshold, the market starts to settle high-tier transactions in information rather than €: frontier R&D, exclusive long-horizon contracts, acquisition of the assets of a rival, and the most valuable peering deals. A **reserve information asset** emerges as the "hard money". Most likely, it is *authoritative, verified, current truth* about the solar system: a canonical ephemeris and positional plus observation ledger that no one can fake or back-date. Whoever mints the most trusted, freshest truth effectively issues the reserve currency. (Working name for the unit: *open* — TBD.) € persists for the mundane and the local. It simply cannot *buy the frontier*.

**What winning becomes (optionally).** For players on this path, the terminal win shifts from net worth (€) to **information dominance**: coverage × freshness × uniqueness across the solar system. Caution from the research: a pure *score victory* (the part of *Stellaris* that players find anticlimactic) is a weak climax. So information dominance must resolve through a *legible, dramatic* final state. For example: the moment when the whole system depends on *your* mint for its truth, and a rival tries — and visibly fails — to starve you. Not a quiet number that crosses a threshold.

**Strategic consequences (the built-in balancing check).** An information superpower has a glass jaw. Its wealth depends on continuous comms flow. So it can be **starved**. Cut the feeds of a rival. Exploit a **conjunction blackout** (genuinely dangerous late in the game: the Sun between you and Mars starves your Mars mint for days). Or out-compete them for fresh raw data. Then their information wealth decays on its own. This is the answer to the question "can the information-rich snowball uncatchably?" The bigger the empire, the bigger the metabolic surface to attack. It also pre-loads the (post-1.0) multiplayer fantasy: information warfare through denial of fresh data.

### 4.11 The Leverage Curve — How Capability Grows (Pillar 7, in full)

This section specifies Pillar 7. It is the spine of progression. Deliberately, it ties §4.5, §4.6, §4.7, and §4.10 into one arc, rather than four separate systems. It is stated at the level of *principle*. The concrete capability list (the "tech tree") is **explicitly deferred** until we prove the core loop fun (post-M1, per §9 and §10). To design nodes before we validate the loop is exactly the premature detail that this document keeps refusing.

**Capability is discovered through operation, not purchased from a menu.** There is no research building where you dump resources into a progress bar (the Factorio lab pattern). That pattern survives in Factorio only because *making* the science packs is the actual game. We have no such cover. A research sink here is pure dead time. There is no tech-point currency. Instead, **you unlock the next capability by doing the current one**. You launch rockets, and your launch operation matures. You hold a laser link across a conjunction, and the autonomy to manage links surfaces. You run a cache hot long enough, and the system offers to manage it for you. Progression is a *trace of what you actually did*, not a menu of what you paid for. The lineage is KSP: you do not research landing — you *learn to land*, and capability follows from where you were and what you did. The anti-pattern is the spend-points-on-a-tree screen. This design rejects it.

**The shape of the curve: the unit of command rises.** The mechanism is not "the same action gets cheaper". That just makes you do expensive deliberate things faster, and you never reach flow. The mechanism is that **the atomic action gets *bigger*: earned automation eats the tier below, so one decision commands many.** Three points on the curve follow. Two analogies make the curve concrete:

| | Atomic unit | Action texture | What eats the tier below | SpaceX analogue | devops analogue |
|---|---|---|---|---|---|
| **Early (T1–2)** | the individual asset | hand-flown. Every one precious. Multi-step | nothing — *you* are the control loop | small rocket, few satellites, hand-positioned | one server. You `ssh` in |
| **Mid (T3)** | the standardised group | templated and repeatable. You operate in batches | basic autonomy handles the per-node routine | reusable launch. Satellite *buses*. Batch deploys | tens of machines. Ansible and Docker — configuration as an artifact |
| **Late (T4–5)** | the declared intent | you state desired state. The system converges and self-heals | mature autonomy *is* the control loop | Starship deploys laser-meshed fleets | hundreds to thousands. Kubernetes — declarative, self-reconciling |

So the late-game "pipe-laying flow state" — the tactile pleasure of laying network and watching pressure relieve (see §3) — is *earned*, not given. It arrives only after the friction of the atomic action collapses enough that you can lay backbone fluidly. Early-game scarcity is not a bug to mitigate. It is the dues that make the later abundance feel like flow. And the late-game action is *declarative*. You do not fast-drag ten laser links. You declare the topology that you want (§4.3a) and watch the autonomy layer build and heal it across the orbital cycle.

**Autonomy (§4.6) is the engine of the curve, not a side feature.** The leverage of each tier comes from the automation layer that absorbs the routine of the tier below. That is exactly why the autonomy tiers of §4.6 are gated on datacenter compute (§4.5). More edge compute means that the system can run more on its own. That means the unit of command can rise higher. The devops parallel is exact. You do not *research* your way to Kubernetes. You *outgrow* Ansible by operating at scale, and the platform that you built notices.

**The micro/macro stack rises — it does not flatten.** The trap to avoid: if tech dissolves capacity planning into pure pipe-laying flow, you trade a rich two-layer manager game for a thin one-layer one. The answer: **going declarative moves the work up a level. It does not remove it.** Kubernetes did not end ops toil. It relocated the toil to policies, reconciliation, and operators. So, at each tier, the whole micro/macro stack lifts. The macro of yesterday ("can I afford to reach Mars at all?") becomes trivial. The tooling of yesterday becomes the micro of today (tuning the risk dial of the autonomy, the §4.6 trust leash). And a *new* macro appears above (the information-dominance metabolism, §4.10: can I keep the empire alive and defended?). The game stays two-layered at every tier. The layers just continue to rise.

**One curve, four systems.** This is the unification, and the payoff for stating leverage as a pillar rather than burying it. Four systems show the same arc from four angles:

- The leverage curve.
- The launch-cost curve (§4.7): capital gets cheap and reusable.
- The micro/macro cadence shift (§3): the heartbeat goes from deliberate provisioning to fluid operation.
- The flip from € to information (§4.10): capital demotes as information ascends. This directly de-risks the scariest bet of the document (Risk 3). The currency flip stops being an isolated late-game rug-pull. It becomes *the natural terminal of a curve that began with the first expensive launch of the player*. The player feels the texture of play get lighter and more leveraged for hours before € formally demotes. So the flip reads as arrival, not ambush.

**How discovery actually works — the template (new in v0.8.1 — the mechanism that §4.11 previously asserted but never specified).** "Discovered through operation" is easy to say and easy to get wrong. The failure modes: a fake-discovery tech node labelled "unlocks foresight". The opposite: a capability that silently switches on, and nobody notices it. Then there is no a-ha. Genuine discovery lives in a narrow band. The design session found its shape: **comprehension comes first. The capability is the reward for comprehending.** The repeatable template: **operate → hit a wall → investigate the wall in a diagnostic view → recognise the pattern → the tool that scales past the wall surfaces *there*.** The tool answers the question that you just formed. The player is not handed foresight from a menu. They are handed the lever *where their hand already was*, at the moment when they ask for it. (This is the dialup-modem arc from §3a, made into a mechanic. Nobody gave you modem-to-modem networking. You *understood* that it was possible, and then you did it.) The honest caveat: the game cannot *guarantee* spontaneous discovery. For players who do not connect the dots, the diagnostic view does more of the work — *nudged* discovery. But the framing must always look like "information that was already there". It must never look like an achievement-unlock popup. **The first concrete instance of this template is predictive routing** (M1 spec §7.5). The player suffers reactive outages. They investigate them in the trace view. They see that the outages are *periodic and predictable* ("it is clockwork"). And the forecast tool surfaces there — the answer to "if I know it is coming, why is my network waiting for it to happen?"

**Leverage is not always a strict upgrade. Sometimes it is an axis (the efficiency-versus-resilience discovery).** A subtler and deeper lesson from the session. It is worth recording at the pillar level, because it is the *texture* of late mastery: some "capabilities" trade one virtue for another. They are not free wins. The sharpest case is **predictive optimisation, which buys efficiency at the cost of fragility to perturbation**. A tightly optimised, interdependent plan *cascades* when something unscheduled hits it. (The OpenTTD-timetable lesson: one late train delays the train that waits for its slot, and the delay propagates downstream through the whole schedule. The Deutsche-Bahn lesson: the same thing, real and painful.) This couples three systems into one web of decisions. The *perturbation* that breaks an over-optimised plan is a **fault**. Fault rate is *player-influenced* (overclocking, cheap hardware — see the M1 spec §5). So **the hardware philosophy of the player determines which operating philosophy is wiser.** Neither dominates:

- *Premium and conservative* → low perturbation → safe to optimise tightly → efficient, but a rare catastrophic cascade.
- *Aggressive and redundant* → high perturbation → run with slack → less efficient, but anti-fragile.

The mastery is to know that **over-optimisation has a fragility cost, and slack has value**. That is true infrastructure-engineering knowledge (§3a), and the deepest expression of "taming complexity" that the routing layer offers. (Concrete in M1 spec §7.5. The capability arc there is reactive now, predictive discovered later, with this axis as its post-gate depth.)

**Scope and open question — the legibility answer (now resolved in principle).** The honest cost of learning-by-doing over a tech tree is *legibility*. Usage-driven unlocks can leave players unsure what to do to progress. They can also leave players grinding the wrong thing. **v0.8.1 resolves the principle.** (The *concrete* capability list is still deferred until after M1.) The legibility answer is the discovery template above: **the next capability always surfaces as the answer to a problem that the player is actively diagnosing.** It surfaces in the diagnostic view where they are already looking, at the moment when the question forms. It is never a hidden trigger. It is never a menu. It is the diagnostic surface that notices: the player has hit the wall that this capability is *for*. "Go to new places" is the legibility cue of KSP. Ours is "the tool appears where you are diagnosing the problem that it solves". The remaining open work is the concrete capability set itself (§10), post-M1.

### 4.12 The Legible Record (The Parse) — The Floor and Ceiling Hinge

§3a established that the mastery fun is *optimising against a record*. It also established that the record is the hinge that converts "make it work" (floor) into "make it optimal" (ceiling). This section specifies that record. It is the **combat log for information delivery** of the game — the WoW parse, the Zachtronics histogram, made native to a network sim.

**What it must be (the preconditions, from §3a):**

- **Complete and honest.** Every served, missed, or stale contract. Every cache hit and miss. Every prefetch, timely or wasted. Every link drop and re-route. Every blackout. All timestamped and truthful. This is *cheap* here, because the sim *is* the truth layer (§4.1). The record is just the event stream of the sim, surfaced. A record that lies or hides things makes analysis worthless. It also breaks the transferable-knowledge pleasure.
- **Measured against an achievable optimum.** The fun is the *gap* between what you did and what was possible. So the record does not just say "73% freshness". It says "73%. The achievable ceiling on your topology was about 91%. You missed the pre-conjunction prefetch window by 4 hours." The solver that routes the network (§4.3) can also compute "what was the best achievable here". That gives the parse *a bar to measure against*, rather than a bare number.
- **Slow-loop friendly.** The optimisation happens *between and after* runs as much as during. Analyse, hypothesise, adjust, re-run. The record must be reviewable at rest, not only glanceable in the heat of play.

**Its forms (one record, several views):**

- **Per-contract post-mortem** — the damage-meter line item: delivered freshness and bandwidth, versus the demand of the contract, versus the achievable optimum. The specific miss is called out: "prefetch fired late", "cache evicted the wrong dataset", "routed over a congesting link".
- **The freshness and utilisation timeline** — a replayable, scrubbable trace of the freshness of every feed and the load of every link, across the session: *where* it decayed, *when* a cache went stale, *which* prefetch was mistimed. The combat-log scrubber.
- **Efficiency versus theoretical** — delivered value per € (and per bit), against the optimum that the solver proves achievable on your actual network. The single headline number that the optimiser grinds down.
- **The trace view (§4.3a) is the live face of this.** "Show me the path of this flow right now" is not only live theatre. It is *the analysis instrument*. The `mtr` and the log-scrubber are the same tool, used live or after the run. Pick a flow. See where the latency and the staleness accumulate along its real path. Find the leak.

**Relationship to the floor.** The novice never opens the parse, and the game does not punish them for it. They tame to functional through the *live* cues (freshness-as-saturation in §8 is the at-a-glance hint of the floor: "you are leaving freshness on the table"). They have a complete game. The parse is dark matter for them, and the whole game for the optimiser. That asymmetry *is* "easy to pick up, hard to master". And it is why the parse must be present from the first playable economy. It underlies M1. Most of its depth stays invisible to most players.

**Scope honesty.** The *live* cues (saturation, the trace view, the status strip) are M1-era and cheap. The *full* post-run parse, with achievable-optimum computation, is an M2+ build. It needs the solver mature enough to compute "best achievable". But the M1 economy must *log truthfully from day one*. Then the parse has real data to surface later, and the M1 gate can ask its sharpest question (§9): *did the player finish wanting to do it better?*

---
## 5. Dashboards and UX — THE Make-or-Break Pillar (not "first-class" — *load-bearing*)

The product is invisible information. So **visualization is not a feature of the game. It is the survival condition of the game.** The lesson from *Cities: Skylines II* is stark. A deep, correct simulation that the player **cannot see working** reads as lifeless and choreless. Reviews punished it for exactly that. The entire product of Signal Horizon is invisible flows. If we cannot make them viscerally watchable, we inherit the failure of CS2 wholesale. So this section is now priority zero, and §9 prototypes it *first*.

**The standard that we hold ourselves to is the standard of *Mini Metro*:**

- Network health legible *at a glance*, with no submenu-diving.
- *Audio as a genuine second information channel.*
- *One narrow-but-critical player lever.*
- A state readable from across the room.

Reference feel: a NOC and mission-control screen, rendered in the 1-bit retro-OS aesthetic (§8): old-OS windows on a near-black field. The game frames itself as *your operations console*. Every dashboard is a window inside it.

**The three things that MUST be viscerally visible (or the game fails):**

1. **The growing coverage web — the monument (§1).** The expanding lattice across the solar system is the trophy of the player, the DSP-megastructure equivalent. It must look and feel like something that you *built and grew*.
2. **Packets and light in flight.** Honest (compressed) propagation, rendered as moving objects. You watch a ping crawl to Mars. You watch a flow re-route the instant that a link drops. This is the primary teacher of light-delay, and the primary "the sim is alive" signal.
3. **Cache hits, misses, and freshness as felt events** — audible and visible. A well-run network *sounds and looks* healthy. A staling one *degrades perceptibly* before the numbers go red.

**Primary views:**

1. **The Orrery (main 3D view).** The solar system at selectable scale compression. Assets, animated link-flows, coverage shells, and light-delay isochrones as overlays. "The map is the dashboard", made literal — and the home of the monument.
2. **Coverage heatmap.** A per-body surface grid, coloured by the chosen information dimension: connectivity, bandwidth, latency, observation, or freshness. It instantly shows gaps.
3. **Network graph / NOC view.** The link graph, live: utilisation, latency, dropped links, re-routing events, and packet-flow animation.
4. **Trace view (the `mtr` of the game).** Pick any flow — a contract, a data product — and the orrery renders its *actual current path*, hop by hop. Per-hop delay accumulates. Freshness drains along the route (§4.3a, §8). A clean climb, traverse, and descend silhouette means a healthy topology. An ugly detour means that you have a network to fix. This is the diagnostic loop made visible. It is first-class, not a sub-tab of the NOC view.
5. **Latency and light-delay panel.** Live one-way times to every body and asset, conjunction warnings, cache hit-rates, and freshness distributions.
6. **Finance terminal.** P&L, balance sheet, cashflow runway (€), per-contract margin, peering ledger, and broker positions. And, late in the game, the quietly growing **freshness-premium and information-balance** lines that foreshadow §4.10.
7. **Launch board.** Windows, manifests, risk, insurance, and countdowns.
8. **Markets and brokerage.** Demand by region and product, competitor pricing, the broker order book, and surfaced arbitrage opportunities.
9. **The Parse (the legible record, §4.12).** The post-run, at-rest analysis view: per-contract post-mortems, the scrubbable freshness and utilisation timeline, and efficiency versus theoretical. Dark matter for the novice. The whole game for the optimiser. The trace view (4 above) is its live face. This view is its reviewable-at-rest face.

**UX principles:**

- Everything carries a timestamp with **information age**. The game never shows "the truth". It shows only what your network currently *knows*. (Optional hardcore mode: even your own dashboards are subject to telemetry delay.)
- **Audio is an information channel,** not decoration (the Mini Metro lesson). The health of the network is audible.
- Layered disclosure: glanceable summary, then hover for detail, then click to drill in. **No critical state must require digging to find.**
- Time controls: pause plus variable acceleration. But remember **that waiting must contain decisions (§3)**. Waiting must not be a slider that you watch.
- **Colour encodes the signal. Chrome stays mono (§8).** Colour is the primary at-a-glance encoding in game space. So it must be colour-blind-safe through *redundant* encoding: every hue distinction is also carried by dither, shape, or glyph. Selectable safe palettes are offered. A pure-1-bit monochrome mode is fully playable. Data-ink maximised, chartjunk minimised (Tufte-flavoured).
- **One excellent view per milestone, not all nine up front (§9, §10).**

---

## 6. Technical Architecture (TypeScript + Three.js, browser)

**Stack:** TypeScript, Three.js (WebGL2), Vite. **Browser-native** — the app runs in Chromium (SD-2). There is no native shell. Gameplay, UI, and the hot sim core (orbital propagation, routing over a large time-varying graph) all live in one language. Three.js WebGL2 renderer.

**Module layout:**

- `sim/` — headless, deterministic, double-precision. Bodies, ephemerides, propagators, the link-budget solver, the routing solver, and the economy tick. **No DOM, no Three.js, no rendering, no input** — plain TypeScript with zero browser dependencies. Testable under Vitest with no WebGL setup. Reusable as a future server authority *if* we ever pursue multiplayer.
- `orrery/` — the Three.js scene: floating-origin scene management, the orrery, LOD and icon collapse, and overlay rendering (coverage shells, link flows, isochrones, **packets in flight**). Given the priority of §5, this module gets disproportionate early attention.
- `wm/` — the DD-10 tiling window manager in the DOM: the zone-grid model, drag-to-swap, gutter resize, and data-driven presets. Always-tiled invariant. Pure DOM and CSS — no canvas.
- `panels/` — DOM dashboards: SYSTEM.LOG, telemetry, and the status strip. Styled in the 1-bit chrome theme.
- `game/` — orchestration: tick scheduling, save and load, contract and market state machines, AI competitors and partners, and the **emergent-event generator (§3)**. It currently lives in `main.ts`. It will expand as M1+ systems land.
- `data/` — content as JSON: bodies, ephemeris constants, the tech tree, contract templates, balance tables, and **hand-authored flavour-text templates (§4.6)** — designer-editable without code.

**Key technical decisions:**

- **No UI framework — imperative DOM and Three.js only.** No React, Vue, Svelte, or any reactive or reconciliation layer. The frame loop is `requestAnimationFrame → sim.tick() → orrery.update(state) → renderer.render()`. No diffing, no virtual DOM, no scheduling, no effect lifecycle. Reasons:
  1. The orrery renders to a WebGL canvas. A framework cannot schedule or diff GPU draw calls. A React-Three-Fiber wrapper just adds JS overhead before the same GL calls.
  2. A real-time sim updates every frame. Position, packets, and freshness all change every tick. Reactive frameworks optimise for "most things did not change, skip work". Here there is nothing to skip. The reconciliation cost is pure overhead.
  3. GC pressure. Each framework render cycle allocates vdom nodes, memo objects, and effect cleanup closures. At 60fps (about 16ms per frame), this competes with the sim and the orrery for the frame budget. The adversarial review already caught about 960 `Vector3` per frame in Three.js. The allocation pattern of a framework compounds this. The panels are simple enough that `element.textContent = newValue` in the frame loop is both faster and more readable. If panel complexity grows later (sortable tables and more), the right answer is still to write that component imperatively — not to introduce a framework.
- **Iteration velocity is a first-class reason for this stack.** Vite HMR applies edits in well under a second, with state preserved. Every polish pass (label offsets, dither cell size, shader stipple, camera framings) is a save-and-see cycle measured in seconds. Full browser DevTools sit on the live WebGL and DOM. No engine build. No scene reload. No editor round-trip. For a make-or-break-on-visualization project (§5), the speed of the see-it-change loop directly compounds the quality of the thing that the game lives or dies on.
- **Determinism first.** A fixed-step sim tick, decoupled from the render framerate. Analytic propagation (Kepler → position at absolute `t`) means that the sim fast-forwards, and any state is reproducible from seed + action log. This is the backbone of save and load (and, if ever needed, netcode). Production uses an integer fixed-step clock (P0-03), not the plain f64 accumulator of the spike.
- **Truth is f64. The render lie is f32.** Sim positions and velocities live as native `number` (f64) in `src/sim/`. Conversion to `Float32Array` happens *only* at the floating-origin rebase boundary in `src/orrery/`. Three.js `Vector3` is f32. The truth never touches it.
- **Floating origin,** rebased to camera focus each frame. The sim stays in absolute coordinates.
- **Time as a first-class entity.** One authoritative sim clock. All delays, windows, and freshness derive from it. Time acceleration scales the tick (more fixed steps per frame). It never scales the physics constants.
- **Graph performance.** Precompute geometric link windows. Re-solve routes only on topology-change events, not every tick.
- **Save format:** seed + initial conditions + ordered action log (replayable), plus periodic state snapshots for fast load. JSON-serialisable from the pure `src/sim/` layer — no DOM or Three.js state in saves.
- **Sim and render purity boundary.** The sim (`src/sim/`) must never import from `three`, DOM APIs, or WebGL. Vitest enforces this (sim tests run without a DOM), and code review enforces it. Any violation is a build-breaking mistake.

**Platform path.** The **full game is desktop-browser** (Chromium primary target, any modern Chromium-based browser). The dense, multi-window operations console (§5, §8) is built for a real screen and pointer. We will not compromise it for a phone. F11 fullscreen gives a bare window with no OS chrome. The code uses only standard web APIs, so a native wrapper (Tauri, Electron) remains a future option. It is not on the critical path (SD-2). *(An earlier spike flagged WebKitGTK-versus-Chromium parity as a migration risk. The browser-native decision of SD-2 removes it from the critical path. The ship target is Chromium.)*

**The mobile companion — demoted to speculative.** It is not a port. At most, it is a lightweight remote-management app: read dashboards, receive pushed alerts, approve or veto autonomy decisions, and queue actions. It leans on the ability of the headless sim core to serve state to a thin client. The architecture already supports that property for free. **It no longer has a version target.** It happens only if 1.0 succeeds, and only if its action set stays narrow. Otherwise, it does not exist.

---

## 7. Multiplayer Readiness (Architectural Affordance Only — Not Built)

Explicitly out of scope. **There is no v1 work beyond keeping the door open cheaply.** The relevant systems are built so that we *can* add multiplayer later, without a rewrite:

- The **sim core is headless and authoritative** → it can run server-side.
- **Determinism + action log** → lockstep and server-authoritative sync are both viable.
- **Peering and broker contracts** are counterparty-agnostic → an AI faction and a remote player are the same interface.
- The light-delay theme is *uniquely* suited to multiplayer. Information asymmetry between players separated by light-minutes is emergent and thematically perfect. (You genuinely cannot know what your Mars-side rival just did, for 20 minutes.)

This is a "design now, build maybe-never" investment. It is cheap to honour up front, and expensive to retrofit. **The research is blunt: EVE-style brokering is fun largely because it is PvP.** That is an argument *for* the affordance, and an argument *against* over-investing in single-player brokering balance. But building multiplayer is a separate project. v1 ships single-player.

---
## 8. Art and Audio Direction (Brief)

**Visual tone — 1-bit retro-OS chrome, coloured signal.** The whole game is a vintage operations terminal: a stark **white-on-near-black, one-bit operating system**, the look of an early bitmap GUI. Strong identity, and a perfect fit for a solo or small developer — *zero* photoreal assets, with all the load on shape, line, and pattern. Precedent that this works commercially and atmospherically: *Duskers*, *Uplink*, and the Zachtronics terminal games. The "old-OS" aesthetic has a proven cult audience that overlaps almost exactly with our systems-thinker target player.

**The governing rule: *monochrome machine, living signal*.** Draw a hard line between *the machine* and *the information that flows through it*. The **machine — the OS chrome, windows, panels, icons, cursor, tools, frames, labels — is strictly 1-bit: dead, cool, white-on-black.** The **signal — everything inside game space that the player must actually read — is coloured**: the bodies of the orrery, links, coverage, packets, and the live data in the dashboards. Colour is reserved exclusively for *information*. Information is precisely the scarce, perishable, precious thing that the entire game is about (§4.10). The dead grey machine frames the glowing coloured signal. Thematically, this is sharper than pure 1-bit. Practically, it fixes the at-a-glance legibility that §5 demands, without diluting the identity. The reason: the *frame* that you see most of the time is still unmistakably 1-bit.

Core elements:

- **Windowed OS framing.** Draggable windows with classic pixel chrome: dithered title bars, blocky glyphs, chunky scrollbars, and dashed-line group frames. The desktop *is* the game UI.
- **1-bit chrome.** The OS layer is pure white on near-black (about #0B0B12 — a hair of cool blue, never dead black). No greys via colour in the chrome. **All tonal variation in the machine comes from dithering** (ordered/Bayer halftone). Title bars, scrollbars, group frames, gauge housings, and table rules: monochrome, always.
- **Coloured signal (game space only).** Inside the orrery and the live data views, colour is the primary information encoding (full system below). Rule of thumb: *if it is part of the computer, it is 1-bit. If it is the information that the computer shows you, it can carry colour.*
- **Bitmap everything.** Pixel-grid icons, a hardware-style pixel cursor, and bitmap typefaces: one blocky display face, and one legible mono for data.
- **Texture as atmosphere.** Scattered binary, ASCII-glyph runs (`▓▒░ ⌗ ·`), and halftone smudges — sparingly, as ambient "machine noise". They never clutter live data.

**The colour system (game space).** Colour does real encoding work. So it is designed, not decorative:

- **Per-dimension hues.** Each information dimension (§4.2) gets a stable, learnable hue: connectivity, bandwidth, latency, observation, and freshness. The coverage heatmap (§5) tints the surface grid in the ramp of the selected dimension. The orrery can tint links and shells the same way. So a colour means the same thing everywhere.
- **Freshness *is* saturation — the signature move.** Fresh information is hot and saturated. As it stales, it *desaturates back toward the dead grey of the machine itself*. Staleness literally drains the colour out of data, until the data fades into the 1-bit substrate. This teaches the core mechanic (§4.4, §4.10) by sight: you *watch* the colour of a Mars feed bleed away over twenty minutes. And it is beautiful. A starving datacenter (§4.10) visibly greys out as its mint runs dry.
- **Links and packets.** Links carry a utilisation and health colour: calm, then hot, as they congest. Packets in flight (§5) are coloured by product type or contract. So you can read what flows where, at a glance. A dropped backbone link and its re-route are a colour event, not a log line.
- **Factions get identity colours.** Each rival or partner operator (§3) has a signature hue. So "whose infrastructure is that" and "whose data am I brokering" are instantly readable on the web.
- **Two currencies, two treatments.** € amounts and information or "open" amounts (§4.10) are visually distinct. This reinforces the late-game flip. The information balance literally has a different colour from the money.
- **Critical state still pops — but naturally now.** The field is calmer: chrome is mono, and most signal sits in mid-saturation. So genuine alarms — conjunction blackout, link drop, DC starvation — can use the hottest end of the palette. They *stand out on their own*, without a reserved emergency colour. The v0.4 "single accent colour for critical state" hack is superseded.

**Terminal syntax highlighting (`SYSTEM.LOG` and comms feeds).** The terminal *window* stays 1-bit (frame, prompt, cursor, scrollbar). But its *content* is syntax-highlighted exactly like a code editor — colour applied per semantic token, not per line:

- **Severity** — info, warn, error, and critical each get a level colour. Your eye jumps straight to the red line in a wall of telemetry.
- **Entities** — asset IDs, link IDs, datacenter names, and body names are coloured as "identifiers", distinct from prose.
- **Time and freshness** — timestamps and information-age stamps share the freshness ramp above. A "14m 22s ago" stamp that went stale reads visibly cooler.
- **Faction names** — in the identity colour of that faction, to match the orrery.
- **Values** — € and information amounts, in their two currency treatments.

This turns dense machine output from an undifferentiated scroll into something scannable. It also makes "the machine talks" feel like a real systems console. (The audience already lives in `tmux` and a syntax-highlighted editor. Lean into that fluency.)

**Colour-blind safety is now a hard requirement, not a footnote.** Colour is load-bearing in game space, so it must never be the *only* channel:

- **Redundant encoding, always.** Every colour-coded distinction is *also* carried by dither pattern, shape, glyph, or position. Colour is an accelerator, not the sole signal. Turn colour off entirely, and the game is still fully playable in pure 1-bit. Dither and shape do the work, as v0.4 specified.
- **Selectable safe palettes** (tuned for deuteranopia, protanopia, and tritanopia) and a brightness and contrast pass.
- **A "monochrome purist" mode** that drops colour back to the pure-1-bit, dither-only look of v0.4. It is both an accessibility option and a deliberate aesthetic choice for players who want it. It is also the home of the optional single-hue CRT-phosphor amber or green flavour. The pure-1-bit look survives intact as a mode. Colour is the default presentation, not the only one.
- Dither patterns and colour ramps must both stay distinguishable *in motion*. A scalable-UI or larger-bitmap mode keeps density from hurting legibility.

**Applied to the hard views:**

- **The orrery.** Bodies as dithered circles (phase via dither gradient) on the 1-bit field. Orbits as dashed vector lines. But **links, coverage shells, isochrones, and packets carry colour**: links tinted by health, shells by the selected dimension, and packets by product. All of them desaturate with staleness. The geometry is still vector + dither (no shaders, cheap, distinctive). Colour rides on top as the information layer.
- **Data dashboards.** Dithered bar and line charts, ASCII-ish tables, and blocky gauges housed in 1-bit chrome. **The data series themselves are coloured** by dimension, faction, or currency. Dense and legible — the monochrome housing makes the coloured data read louder, not quieter.
- **Generated and agent text (§4.6).** Monospace `SYSTEM.LOG`-style window contents, with the **syntax highlighting** described above. The retro frame plus per-token colour makes "the machine talks" feel like a real console. (The LLM is cut from v1, so all of this text is hand-authored or templated.)
- **The shareable network portrait (§4.2).** It works in either presentation: a calm 1-bit "stamp" for the purists, or a colour-signal version that shows freshness and coverage at a glance. Both are postable. The colour one is the better marketing asset.

**Audio.** Lo-fi, to match:

- CRT hum.
- Blocky UI beeps and key-clacks.
- Modem and telemetry chirps.
- A satisfying *commit* tone for launches and deals.
- Terse alert blips for link drops and blackouts. **And per §5, audio is a real information channel.** The health of the network is *audible*: a smoothly running network sounds different from a congesting one. Music: minimal, generative, ambient.

---

## 9. Development Roadmap (Resequenced Around Proving the Core)

The single change from v0.3: the roadmap now front-loads the one question that determines whether the game exists at all. Everything speculative is pushed out of the critical path.

**Milestone 0 — sim spike + the visible web (prove the *technical* hard part).** A headless Kepler propagator, plus floating-origin orrery rendering of Earth and a few satellites at honest scale, with time controls **and packets-in-flight rendering**. It validates the sim/render split, the precision approach, *and* that we can draw the invisible product. Visualization is in M0. It is not bolted on later.

**Milestone 1 — the irreducible fun test (prove the *design* hard part).** An **Earth-orbit constellation-construction and connectivity game** that *culminates* in the first taste of Mars and light-delay. The player launches satellites into orbits with a planner. There is no piloting. The player points antennas and builds a relay network that serves **standing connectivity SLAs** (latency, availability, bandwidth) while the geometry moves. The **routing solver** auto-routes, and the player tunes by exception. The **diagnostic and trace view** is the first-class legibility tool. **Oversubscription under moving geometry** is the core tame-the-sprawl tension (§3b). Faults arrive mid-session as the resilience test (mild first). **This is the RemoteTech / Cisco-Packet-Tracer fantasy — NOT a caching game.**

Freshness, caching, and light-delay appear only in the *final act*, as a deliberately fenced teaser. The player reaches Mars, watches the first signal *crawl*, sees data arrive "old", and places one cache as a breadcrumb. The session stops on a "to be continued". This is the first across-tier *invalidation*, where the Earth playbook breaks (§3b, Pillar 5). It tests the *premise of the whole campaign*, not just the slice.

**The session is one hour, not thirty minutes.** A stronger gate: an hour forces the *loop* (escalation, the optimiser pull) to carry the session once novelty wears off. And it lets one full **tame, outgrow, re-tame** cycle complete.

**The gate has two layers (sharpened by §3a):**

1. Did the hour of Earth connectivity *sustain* past novelty, and did it leave the player **wanting to do it *better***? That is the optimiser hook. A tester who finishes satisfied-and-done built a toy. A tester who wants the re-run felt the pull.
2. Did the Mars culmination *hook them into the campaign*? When light-delay broke their playbook, did they engage, or did they stop?

If it passes both, there is a game. If not, no downstream content saves it. We pivot the visualization and the core before we build anything else. *This milestone gates the entire project. The concrete, buildable specification — data model, the four-act hour, all numbers — is in the companion doc `signal-horizon-m1-mechanics.md`. This paragraph is the why. That doc is the what.*

**Milestone 2 — Earth tycoon vertical slice.** Full LEO and GEO coverage grid, demand and contracts, ground stations, the € economy, and the launch *market*. The slice adds the escalation engine (success → congestion), the emergent-narrative generator (rival operators, news events), and one beautiful coverage heatmap. **Goal: is the core loop fun at Tier 1, across a real session?**

**Milestone 3 — cislunar + first light-delay at gentle scale.** Moon and L-points, relays, the first orbital datacenter, basic autonomy policies, and observation contracts. It introduces the signature delay at about 1.3s — the on-ramp that teaches the concept before Mars makes it bite.

**Milestone 4 — interplanetary + signature systems.** Mars, launch windows (with *waiting filled by caching decisions*), deep-space relays, the full caching and prefetch loop, edge-processing DCs, autonomy tiers, and **constrained** brokering and latency arbitrage. **This is where the game becomes *itself*.**

**Milestone 5 — outer system + DTN** *(post-1.0 candidate).* Belt, Jupiter, and Saturn. Store-and-forward routing, predictive replication, nuclear rad-hard DCs, high-autonomy edge intelligence, and a heavy ISL backbone.

**Milestone 6 — optional information-economy endgame** *(post-1.0).* The §4.10 currency flip. We prototype it no earlier than after we prove the mid-game economy fun. We build it as an *opt-in* victory path. Then the speculative interstellar or Oort tier, long-horizon scoring, the full dashboard suite, balance, and accessibility.

**Explicitly deferred or cut from the v1 critical path:**

- Multiplayer — a separate project. Affordance only (§7).
- The mobile companion — no version target (§6).
- The optional local LLM — cut. It can ship after 1.0, or never (§4.6).
- The outer-system and interstellar tiers — post-1.0.
- Most of the nine dashboards — one excellent view per milestone (§5).

---

## 10. Risks and Open Questions (Re-Ranked by the Research)

**Risk 1 — EXISTENTIAL: scope for a solo or small dev.** The v0.3 feature set was roughly five games: honest orbital mechanics, light-delay economics, a space-datacenter builder, a peering economy, diegetic AI, multiplayer readiness, and a mobile companion. Solo-dev failure data is blunt: the most-cited cause of indie projects that miss deadlines or get abandoned is scope that is too large. **Mitigation (now baked into §9):** ruthless resequencing — prove the core (M0 and M1), ship Tiers 1–3, and defer everything speculative. This is the risk that is most likely to kill the project. It is now managed structurally, not with willpower.

**Risk 2 — MAKE-OR-BREAK: the cerebral and invisible product versus tactile satisfaction.** Factorio belts and DSP megastructures are watchable. Bandwidth and freshness are not. The *Cities: Skylines II* trap is a deep sim that the player cannot *see* working. **Mitigation (now §2 Pillar 4 + §5 + M0 and M1):** visualization is priority zero. The growing web is the monument. Packets in flight and cache events are felt, audible, and animated. M1 exists solely to prove that we can make the invisible fun. If M1 fails this test, the project pivots or stops.

**Risk 3 — HIGH: the currency flip changes the resource *and* the win condition.** The precedents that work (Paperclips, Frostpunk) kept the terminal goal constant. Ours did not. **Mitigation (now §4.10):** the flip is now *optional* (the Stellaris "Become the Crisis" model), *gradual*, and *foreshadowed from the early game*, with *€ permanently relevant*. Prototype no earlier than M6, after we prove the mid-game fun. One open question remains: even when gradual and optional, does the flip read as a satisfying "the rules just changed" climax, or as confusion? It needs dedicated playtesting. The dashboards surface the repricing in real time. That is the planned teacher.

**Risk 4 — HIGH: brokering becomes the single dominant strategy.** If arbitrage is the fattest margin, players abandon the carrier fantasy. EVE shows that brokering is fun mainly because it is PvP with stakes. Against AI, it risks being a solved optimisation. **Mitigation (now §4.4):** gated behind owned infrastructure, margin-capped, with decaying margins. The highest rewards require the physical network. **Playtest benchmark:** if testers go straight to brokering and ignore construction, we cut the margins *before* new content ships.

**Risk 5 — MEDIUM: space datacenters become "a second city-builder bolted on."** A parallel sub-game that does not talk to the network sim (the "colonists are just a number" problem of Per Aspera). **Mitigation (now §4.5):** DCs are a *small number of high-impact strategic nodes* (place, power, cool, upgrade), and every mechanic feeds the network loop directly — force-multipliers, not base-building.

**Risk 6 — MEDIUM: time-scale compression and dead-air waiting.** Real launch windows are months or years. A session is minutes. Paradox-style games solve pacing with player-controlled acceleration and pause. But they suffer late-game "nothing to do while waiting". **Mitigation (now §3, §4.7, §5):** the waiting *is* the decision space (cache, prefetch, and coherence bets). A time slider that you merely watch is a design failure. Open question: how aggressively can we compress, without undermining the "waiting" tension that makes caching matter? It needs prototyping at M4.

**Risk 7 — MEDIUM: onboarding wall.** Light-delay is unintuitive. The signals of OpenTTD and the depth of Aurora 4X are cautionary. KSP is the positive model. **Mitigation (now §2 Pillar 2, §4.1, §4.4, §4.8):** fidelity only where it is fun, and abstraction elsewhere. The planner does the math. The game teaches light-delay *by sight* (watch the ping crawl) at the gentle ~1.3s scale of cislunar, before Mars makes it bite. Difficulty tiers: player-omniscience-of-own-network is an *optional* hard mode, not the default.

**Risk 8 — LARGELY RESOLVED in v0.5: aesthetic versus legibility.** v0.4 worried that pure 1-bit (pattern, not colour, encoding) can hurt the at-a-glance reading that §5 demands. v0.4 reserved a single accent colour as a hedge. v0.5 resolves this structurally with *monochrome machine, living signal* (§8): the OS chrome stays 1-bit (identity preserved), game-space signal is coloured (legibility solved), and the terminal gets syntax highlighting. **The risk that replaces it is colour-blind safety.** Colour is now load-bearing, so it must never be the sole channel. **Mitigation (now §8):** redundant encoding (dither, shape, and glyph carry every distinction), selectable CVD-safe palettes, and a fully playable pure-1-bit monochrome mode. **Playtest benchmark:** verify that the colour-off mode is genuinely playable, and that the freshness-as-saturation cue reads for colour-blind players through its redundant dither and desaturation channel.

**Resolved or closed after v0.3:**

- *Optional local LLM:* **closed — cut from v1** (§4.6). Reputational risk (about 85% negative AI sentiment), near-zero gameplay upside, and scope burden. We can reconsider it after 1.0, as optional, offline, and cosmetic only — or never.
- *Mobile companion:* **demoted** to speculative, with no version target (§6). It holds the "manage remotely, do not play remotely" line, by simply not committing to it until 1.0 succeeds.

**Open questions that still need answers (and where they get them):**

- The default "hardcore" level. Is the awareness of the player's *own* network delayed, or only the in-fiction data products? *Leaning: in-fiction data is always delayed. Own-network omniscience is an optional hard mode.* (Resolve in M3–M4.)
- Does the optional currency flip land as climax or as confusion, even when gradual? (M6 playtesting.)
- Time compression versus waiting-tension balance. (M4 prototyping.)
- Does the emergent-narrative generator produce enough "stories" to give the spreadsheet a soul (the Football Manager test)? (M2 — build the rival-operator and news-event systems early enough to evaluate.)
- What is the *legible, dramatic* final state for an information-dominance win? It must not end on an anticlimactic score threshold (the Stellaris-victory problem). (Design before M6.)
- **Leverage-curve legibility (§4.11).** Learning-by-doing progression risks players who do not know what to do to advance, or who grind the wrong thing. That is the cost of having no tech-tree screen. What is the legibility mechanism that always surfaces the next capability as a near-future consequence of current activity? (Resolve when we design the concrete capability set, post-M1.)

---

*End of v0.8.1. This remains a living document. Git history tracks the revisions. Milestone 0 and the M1 fun-test gate everything else, and they must begin before we lock any further system design.*

*v0.2 added datacenters and the autonomy layer, and locked the 1-bit art direction. v0.3 added the information-economy endgame and reframed mobile as a companion. v0.4 was the research-driven revision. v0.5 reintroduced colour under one rule: *monochrome machine, living signal*. v0.6 made network topology a designed system (§4.3a). v0.7 added the seventh pillar, "Leverage compounds" (§4.11), and recorded the move to TypeScript + Three.js + Vite, browser-native. v0.8 named the fun (§3a): tame the sprawl, and optimise against the parse — the same verb at two bars, hinged on a legible record. It gave escalation a mechanism (§3b): the demand-growth + freshness-decay + automation three-stroke, with the across-tier "must invalidate a prior strategy" test. It also specified the parse (§4.12) and sharpened the M1 gate to "wanting to do it better".*

*v0.8.1 is a light surgical pass with two jobs. First, it corrects a mischaracterisation: the early game is a constellation-construction and connectivity puzzle (RemoteTech / Cisco Packet Tracer), NOT a caching game. Freshness is a fenced final-act teaser (§9). Second, it folds in the feel-level concepts from a long design session:*

- Oversubscription as the core tension of the early game (§3b).
- The efficiency-versus-resilience axis, which couples routing, faults, and hardware (§4.11).
- The capability-discovery template, which finally explains "discovered through operation" and resolves the §4.11 legibility question.
- GEO and LEO as a permanent, SLA-selected strategic axis (§4.3a).

*Crucially, v0.8.1 keeps the GDD a "why and feel" document. The concrete mechanics (data model, numbers, the four-act hour, the routing cost-blend) now live in the companion `signal-horizon-m1-mechanics.md`. This document points to that doc rather than restating it. That deliberate separation fixes the original "prototype had no gameplay because every doc described feelings" problem.*

*The through-line of every change after v0.3: the best games of the genre (Factorio, DSP, OpenTTD, Mini Metro, KSP, EVE, Zachtronics) win by making a system *visible, escalating, legible, and worth optimising*. The single greatest threat to Signal Horizon is that its product is invisible. Everything here bends toward fixing that.*
