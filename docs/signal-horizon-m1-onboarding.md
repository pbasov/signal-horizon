# SIGNAL HORIZON — M1 Onboarding Script (The First Hour)
### v0.1 · the director's script · companion to the M1 mechanics spec (`signal-horizon-m1-mechanics.md` §9)

> **What this document is.** The M1 spec (§9) defines the *shape* of the first hour — four acts, four concepts, the two-layer gate. This document defines *how it actually unfolds at the table*: what opens each act, how each concept is taught, and — critically — **how the game knows the player has learned it before introducing the next.** It is the M1-12 ticket ("the scenario") in full.
>
> **It is state-gated, not clock-timed.** There are no minute-by-minute cues. A clock-timed tutorial fires the next beat whether the player is ready or not — it fights them. A **state-gated** one waits until the player has *demonstrated* the current concept, then opens the next. The `~minutes` noted per act are loose orientation (and a pacing smell-test), **not triggers.** This also serves the gate: testers won't all be at the same *minute*, but they pass the same *gates in the same order*, which is what makes their runs comparable.
>
> **The contract is the teacher (no tutorial layer).** The game never shows a "tutorial prompt" or a tooltip lecture. Teaching is diegetic: **a new contract arriving *is* "here is the next thing to learn,"** because its SLA shape forces exactly one new skill. The player learns by trying to fulfill contracts, and the diagnostic view explains shortfalls (M1 spec §7.4). The only authored layer on top of the real systems is the **sequence** in which contracts and faults arrive — the systems themselves (solver, faults, oversubscription) run for real.
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
- **The planner shows the consequence.** As the player confirms (or nudges) the preset orbit, the orrery shows the **footprint** the satellite will cover, overlaid on the contract's highlighted region. The player *sees* "this covers that" before committing. (This is the planner's core promise — M1 spec §3.2 — taught on the gentlest possible case.)
- **Launch → the satellite appears → the region lights up → money starts.** The causal chain is immediate and legible: action → coverage → payment. The status strip ticks from `UNSERVED` to `SERVED`, the region's link glows in the connectivity hue, and the finance panel starts counting up.
- That is the entire Act 1 loop. The player has learned: *I launch, it covers, I'm paid.*

### Completion gate (what proves the concept landed)
**The player has one contract served and is being paid for it.** That's it. The moment the first contract goes `SERVED` and revenue is positive, Act 1's concept is demonstrated and Act 2 may open.

### Failure-to-progress fallback
If the player flounders in the planner (doesn't launch within a generous idle window, or launches into an orbit that *doesn't* cover the region), the diagnostic/shortfall view does the gentle correcting — "footprint does not reach [region]; try a lower inclination / this preset" — pointing at the fix without doing it for them (M1 spec §3.2: the assist never hands over the solution). The cold open is the one place the assist leans *most* helpful; it gets less hand-holding every act after.

> **Design note — why GEO-or-easy-LEO and latency-tolerant.** Act 1 must be winnable with a *single* satellite and *no* concept of motion-management. A latency-tolerant equatorial contract is the only contract shape a lone GEO sat fully solves (M1 spec §2). That is the point: it is the one case where "place one thing" works — so that Act 2 can *break* that intuition on purpose.

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
- **The diagnostic states the fix in constellation terms** (M1 spec §7.4): *"availability breaks ~8 min each orbit: no satellite covers [region] in this window. Coverage requires a constellation — additional satellites phased so one rises as another sets."*
- **The planner assists with phasing** (M1 spec §3.3): when the player goes to add satellites, the planner can suggest *"to hold continuous coverage here you need ≈N evenly-phased satellites — place the set?"* — and gives a **viable-but-imperfect** result (maybe N is slightly too few, or the phasing leaves a small gap), so closing the gap is still the player's act. The launch-as-a-batch verb (M1 spec §3.4) is introduced here naturally: a constellation is one launch of several sats into a plane.
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
**Entry trigger:** the player has stable coverage on two regions (Act 2 complete). Now **demand grows where they've served well** (M1 spec §4 / GDD §3b generator 1): a served region's offered load rises — it now wants more than the constellation was built for — and/or a **third contract** arrives that wants to share the same infrastructure corridor.

**Teaching mechanism — oversubscription bites (finally taught):**
- The shared links start riding near capacity; a peak tips a contract from comfortable into **near-breach**. The player feels their scarce antennas/links can't cover every contract's peak at once.
- The diagnostic surfaces it as a *sharing* problem (M1 spec §4.3): *"this link carries 3 contracts; combined peak exceeds capacity — add a parallel path, a higher-bandwidth antenna, or accept the breach risk on the lowest-value contract."*
- **Latency and/or bandwidth SLA fields now appear** on the new contract (the last two SLA axes, introduced one at a time per M1 spec §4.4): a low-latency contract makes the GEO ceiling *felt* ("this path is 340ms; a shorter LEO route is needed"); a high-bandwidth contract makes antenna/link limits bite.
- The player must **re-engineer**: launch more, re-tune routing priorities (M1 spec §7.3 — the first use of the prefer-latency/bandwidth/stability weight, by exception), or make a *deliberate* oversubscription bet (cut it thin on the lowest-value contract). This is the first full **tame → outgrow → re-tame** cycle (GDD §3b).

### Sub-beat 3B — Faults (the chaos-kitten, mild-first)
**Entry trigger:** the player has re-stabilized after 3A (the strain is back under control). *Now* faults begin — and not before, because faults on top of an unstable network would just be noise (M1 spec §5).

**Teaching mechanism — mild-first, fair (M1 spec §5.1):**
- **First a degradation:** a satellite's antenna underperforms briefly, then recovers. If the player cut oversubscription too thin in 3A, this *bites* (the degrade pushes a near-breach contract over); if they left headroom, they barely notice. **The lesson lands by consequence:** leave headroom. The fault rides the diagnostic view (a node pulses amber; `SYSTEM.LOG` shows the degrade and recovery — M1 spec §5.3). No separate UI.
- **Then a telegraphed failure:** a satellite shows a warning + countdown before it fails (M1 spec §5.1 #3). The player is *warned* — they can launch a replacement or re-route proactively. The player who built redundantly sails through; the brittle builder scrambles. **Resilience becomes visible and tested — fairly.**
- *(Hard random failure stays out, or is vanishingly rare, this hour — M1 spec §5.1.)*

**The optimizer pull appears (the §3a hook, the gate's layer-1 target):**
- Throughout Act 3, the diagnostic/trace view starts showing **where the player is wasteful or brittle** — overprovisioned links (waste), single points of failure (risk), a contract riding closer to breach than it needs to. The seeds logged silently in Act 2 (over-building) and 3A (thin bets) now surface as *legible shortfalls against what was achievable.*
- This is the first taste of "the parse" (the legible record, M1 spec §4.12 seed): the player sees that their network *works* but isn't *optimal*, and the gap is visible and naggable.

### Completion gate
**The player has weathered the strain and at least one fault while keeping their contracts served (or recovering from a breach), AND the diagnostic has surfaced at least one optimization/resilience shortfall to them.** The concept (a working network strains and breaks; build for it) is demonstrated. Act 4 may open. *The richest signal that Act 3 worked: the player proactively adds redundancy or re-tunes **before** the next problem forces them to — that's mastery, not reaction.*

### Failure-to-progress fallback
If the player is drowning (cascading breaches, can't stabilize), the script eases the fault rate and the diagnostic gets more directive ("you have no redundant path to [region]; one more satellite here covers the fault window"). The act is forgiving on *execution* — the goal is that they *understand* strain and faults, not that they play perfectly. A player who breaches, diagnoses, and recovers has learned the lesson better than one who never breached.

---

## ACT 4 — "Distance changes everything" (vertigo) — **the campaign hook, fenced**

**The ONE concept:** *Everything I learned assumes instant response. Across interplanetary distance, that assumption dies — and a whole different game begins.*

This is the **culmination and the gate's layer-2 test**. It is a *teaser*, not a system: it introduces light-delay, freshness, and caching as **concepts felt by sight**, then deliberately stops. **Do not build the freshness economy from this act** (M1 spec §8 — it is post-gate, undesigned). The discipline here is total: introduce the *vertigo*, withhold the *toolkit*.

### Entry trigger
The player has a mature, stable, fault-weathered Earth network (Act 3 complete) — they feel like they've *got this*. That competence is the setup; Act 4 is the reversal. An opportunity appears: **reach Mars** (a high-value contract, or a narrative beat — "establish the first Mars link"). The player does what they've always done: launch toward it, plan to connect it.

### Teaching mechanism — the playbook breaks, by sight
- **The first signal to Mars crawls.** The player sends the first command/signal and **watches the packet travel — and it takes *minutes*.** The same packet-crawl visual they've seen all hour, but now the round-trip is 8–40 minutes (honest light-delay — GDD §4.4). They *feel* the helplessness: **you cannot real-time-tune a topology when your input arrives 8 minutes late.** Every reactive habit Act 3 drilled is suddenly useless. *This is the across-tier invalidation (GDD §3b / Pillar 5) — the Earth playbook physically stops working.*
- **Data arrives old.** The first data back from Mars is **stamped "as of 8m ago."** On Earth, "fresh" and "stale" were never categories — data was just *there*. Now the player sees, for the first time, that **freshness is a thing.** A single contract appears that *cares*: it pays less for stale Mars data. The player feels the *shape* of the future problem without being handed tools to fully solve it.
- **One cache, as a breadcrumb.** The player is given **exactly one cache** to place near Mars — and feels "oh, putting data *closer* helps." That is the entire caching lesson for now: a single breadcrumb pointing at the post-gate game. **They are NOT given prefetch policy, coherence levels, the freshness economy, or the parse** (all M1 spec §8 — fenced, undesigned).

### The ending — stop on "to be continued"
The act does not resolve into a win screen. It **stops on a frontier.** The last beat is not "you won" — it is *"you've reached the edge of the game you know, and past it is a different one: light is slow, distance changes everything, caching is the answer, and freshness is the new currency."* The player should finish **wanting to see where it goes.** A quiet, deliberate "to be continued" — the campaign's promise, not its delivery.

### What Act 4 tests (the gate's layer 2)
Not a completion gate — a **read on the hook.** When light-delay broke their playbook, did the player **lean in** ("I want to see where this goes — how *do* you run a network across that?") or **bounce** ("this is annoying / I'm done")? That read tests the *premise of the whole campaign*, not just the slice (M1 spec §9 gate, layer 2).

---

## The gate (what the whole hour is for)

Run ≥5 testers cold. The hour passes the gate only if **both layers** clear (M1 spec §9):

**Layer 1 — did the Earth hour sustain and create the optimizer pull?**
- The player passed all three Earth-act gates (competence → constellation → weathered strain+fault) without bouncing.
- Past the novelty of the first stretch, the **escalation loop and the resilience/optimization tension kept them engaged** — the hour was carried by the *loop*, not by first-impression novelty (the reason it's an hour, not 30 minutes).
- **The decisive signal:** the player finishes an Earth contract **wanting to do it *better*** — they want another run to fix the wasteful/brittle thing the diagnostics showed them (GDD §3a). A tester who finishes *satisfied-and-done* built a toy; one who wants the re-run felt the optimization pull.

**Layer 2 — did the Mars culmination hook them into the campaign?**
- When light-delay **broke their Earth playbook**, did they **lean in or bounce?**

**FAIL** = bounces in Act 1 (cold open too hard) / never builds a real constellation (Act 2 didn't teach) / drowns or disengages under strain (Act 3 mistuned) / finishes-and-shrugs (no optimizer pull) / bounces off the Mars hook (premise doesn't grab). On fail, iterate **the cold open + the teaching sequence + the difficulty tuning + visualization** only (GDD Risk 2), re-run; 3 failed iterations ⇒ rethink the premise. **A run that passes layer 1 but fails layer 2 means the connectivity game is fun but the interplanetary premise doesn't grab — which you must learn before building M2+.** Do not start M2 until both layers pass.

---

## What this script does NOT do (fences)

- **No minute-by-minute timing.** State-gated only; `~minutes` are orientation, not triggers.
- **No tutorial layer.** Contracts and diagnostics teach; there are no tooltip lectures or coach-marks. (The cold open's assist is the *most* directive moment and is still diegetic — a shortfall diagnostic, not a tutorial popup.)
- **No second concept per act.** The cardinal rule. Latent systems (oversubscription in Act 2, the parse in Act 3) are *seeded* silently and *taught* only in their own act.
- **No freshness economy.** Act 4 is concepts-by-sight + one cache breadcrumb, then stop. The caching/prefetch/coherence/parse/currency systems are post-gate and undesigned (M1 spec §8).
- **No authored narrative beyond the arrival sequence.** The systems run for real; only the *order* contracts and faults arrive is scripted. Post-gate, even that opens to seeded-sandbox generation.

---

*v0.1 of the onboarding script. It is the detailed form of M1 spec §9 / ticket M1-12. The hour is four acts, four concepts, each gated on the previous being *felt*: competence → challenge → mastery-under-pressure → vertigo. The contract is the teacher; the diagnostic explains shortfalls; the systems run for real under a curated arrival sequence. Acts 1–3 are the buildable Earth game; Act 4 is the fenced campaign-hook teaser. The whole hour exists to answer one question in two layers: did the Earth loop make them want to do it better, and did the Mars frontier make them want to see where it goes?*

