# Signal Horizon — The Setting

### Story foundation — v0.1 DRAFT (proposed, not yet accepted)

> **This document is scenery, not design.** It answers two questions and no others: *why is anyone
> at the Moon and Mars*, and *why does anyone pay for information*. It has no authority over
> mechanics. The GDD wins on design; this doc only names who is paying and why they care.
>
> **The load-bearing rule:** the story never justifies a mechanic. Physics does. If a system needs
> this document to make sense, the system is wrong. Test: delete this file, and every rule in the
> M1 family still stands on light-delay, link budgets, and geometry alone.

---

## 1. The whole thing in three sentences

Compute left Earth before people did, because Earth ran out of power, cooling, and permission — and
once the load moved up, the mass and the industry followed it out to the Moon and then to Mars.
The agencies built the first links the only way a science programme can, one dish at a time on a
booking schedule, and that model died the moment there were forty operators and a customer who
needed an answer *this hour*; so the network was unbundled into licences, tenders, and penalties,
and you hold one licence.

Out there, light makes presence impossible, and everything anyone owns, insures, ships, or survives
depends on knowing what is true at a place, right now — which is the one thing the universe refuses
to give away for free.

---

## 2. Why anyone is out there

**Earth's ceiling is not chips. It is watts, heat, and consent.** By the game's present, the
information industry has eaten the cheap grid. New heavy compute on Earth needs power that is
spoken for, cooling water that communities will not surrender, and planning consent it will not
win. Orbit has continuous sun, no water table, and no planning authority. So the first thing to
leave Earth in bulk was not people. **It was load.**

**Once load leaves, mass follows, and mass is cheaper anywhere but here.** Every kilogram of
radiator, panel, and structure lifted out of Earth's well is paid for twice. The Moon's well is
shallow. So the Moon became the **yard**: regolith into structure, ice into propellant, a launcher
that throws mass into cislunar space for a fraction of an Earth ascent. The Moon is not a colony.
It is a *supplier*, and it is busy, industrial, and crowded with operators who all need to talk to
Earth. Its far side is also the quietest radio sky in the inner system, which makes it the natural
home of the listening business — and a place where spectrum itself is a licensed, defended asset.

**Mars is the first place off Earth that is not a supplier to Earth.** It has its own weather, its
own industry, its own reasons — and, decisively, it cannot ask Earth a question and get an answer
in a useful time. Mars is where the thesis stops being an argument and becomes a physical
condition: a place that must know things locally or not at all.

The frontier past Mars is prospecting: rocks worth a fortune to whoever can prove what is in them,
from a distance, before anyone else can.

## 3. Why *you* exist

The public agencies built the first deep-space links, and they built them the only way a science
programme can — a handful of enormous dishes, allocated by schedule, booked months ahead, serving
missions. That model has one customer and infinite patience. It does not survive contact with a
lunar yard consortium, a cargo underwriter who needs a settlement-grade fix within the hour, and a
polar station that wants a 150 ms path for a surgeon.

So the network was **unbundled**. Spectrum and orbital slots became licensed and tradable. The
agencies became anchor tenants instead of monopoly builders. The booking schedule became the SLA.

You hold a licence. You bid on tenders, you commit to numbers, and when you miss them you pay. That
is the whole of your authority and the whole of your risk. It is also why the game's economy is
contracts and penalties rather than missions and glory — **you are a utility, not an explorer**,
and the game should never once let you feel otherwise.

## 4. Why information is precious

Three reasons. Each one is already a mechanic; none of them needs to be explained to the player in
words.

**1. Nobody can be present, so presence is something you sell.**
Light turns remote work into a latency budget. Under a second, a human can drive a machine. At the
Moon's ~2.6 s round trip, a human can drive one *badly* — which means the difference between
"someone in a chair on Earth" and "an autonomy package you had to buy, certify, and trust" is
literally the milliseconds on your SLA. At Mars, presence is off the table. Everything runs on a
local model of reality that is exactly as good as its last update.
→ *This is why a latency SLA is not a number on a card. It is whether your customer has to buy a
robot a brain.*

**2. Every contract off Earth settles on data, not on claims.**
Insurance, cargo futures, mining claims, landing clearance, life-safety attestation, treaty
compliance. None of these can settle on somebody's word; they settle on an observation with a time
and a place attached. If the observation is stale, the contract does not clear, and somebody eats
the difference. The market is not buying bandwidth. **It is buying a reduction in staleness.**
→ *This is why freshness earns € for hours of play before §4.10 ever proposes it as currency.*

**3. The sensors and the power are light-minutes apart.**
The sensors are wherever the interesting place is. The power is wherever the sun is bright or the
reactor is. Raw is enormous, the answer is small, and hauling raw across the gap is ruinous. So the
industry pushes refineries out to the data.
→ *This is ship-raw versus edge, and it is why a datacenter is a network asset and not a building.*

## 5. The tiers, as story

Each tier's story beat must kill a habit, matching the GDD's across-tier rule (§3b). If a tier's
fiction is only "farther", it is only a bigger number.

| Tier | The world's reason | The habit it kills |
|---|---|---|
| **Earth** | Terrestrial networks won everything easy. What is left is the hard tenth — polar, ocean, mobile, disaster, and customers who need a path they do not share. And every link above Earth still lands on an Earth ground segment: **your Earth constellation is the on-ramp to the solar system.** | "Coverage is a map problem." Geometry and weather make it a *time* problem. |
| **Moon** | An industrial yard with dozens of operators, running on Earth-side hands that are only *just* fast enough. | "Point an antenna at it." Now milliseconds decide whether a customer needs to hire autonomy. |
| **Mars** | A place that must be its own authority, because asking costs minutes each way, up to twenty-odd at worst — and every 26 months the Sun cuts it off entirely, on a schedule everyone can read. | "A human is in the loop." Now everything is a model, models stale, and a forecastable blackout makes pre-staging a life-safety act rather than a clever optimisation. |
| **Belt and out** *(post-1.0)* | Prospects worth a fortune to whoever can prove what is in them first. | "Confirm before you commit." Round-trip coherence is gone; you bet, and you find out. |

## 6. The endgame flip is physics, not a rule change

Money is a shared, current agreement about who holds what. **Agreement needs a round trip.**

Across a conjunction, Earth's ledger cannot clear at Mars. For weeks, a € is a promise nobody local
can check. What *can* be checked locally is a signed observation carrying a time and a place: it
needs a clock and a key, not a round trip. So at the frontier, the thing that starts behaving like
money is exactly what the game has been simulating all along — information that is current and
verifiable at a point in spacetime.

The flip is not a twist. It is what happens when your network reaches far enough out that the old
money stops arriving in time.

**The clamp (GDD §4.10, commitment 2).** This story is about where € *cannot reach*, never about €
becoming worthless. Earth is still the bank, still the market, still where launches, hardware, and
power are bought — for the whole game. What the frontier lacks is not value, it is *settlement*.
Nothing in this section may ever be written as "money died"; it is "money is late, and out here
late is the same as absent."

**Foreshadowing, concretely:** the player's very first conjunction blackout should include one
settlement that fails to clear. No commentary. The Wire states it causally and moves on. Hours
later, when §4.10 formalises the flip, the player should recognise it rather than be told it.

## 7. The cast

**Naming rules.** No real agencies or companies — legal risk, and it dates the game. Institutional
archetypes with dry, plausible, boring names. Recurrence does the worldbuilding: the same
underwriter appearing across forty tenders builds more world than any codex entry.

- **Clients are institutions with a stated need, one line each.** A cargo underwriter. A lunar yard
  consortium. A polar research programme. A news wire. A settlement's public works. A planetary
  agency, now an anchor tenant rather than a builder.
- **The regulator is indifferent, not hostile.** It issues licences, auctions slots, records
  breaches, and publishes your reputation tier. It is the source of M1's existing PROBATION state.
  It never has an opinion about you.
- **Rivals have doctrines, not personalities.** One runs thin and cheap and eats its breaches. One
  over-builds and beats you on availability while bleeding capital. One is an incumbent carrier
  sitting on legacy slots it did not earn. Their doctrine is what the player learns to read, and it
  is what makes their boards re-set expectations from your delivered performance (GDD §3).
- **There is no villain.** The antagonist is the speed of light. Nothing in this document may ever
  give the player someone to defeat.

## 8. How it reaches the player

The budget is small on purpose. **Background means background.**

1. **Tender reason lines — the main channel.** One line, stating why this customer needs this
   number. *"Underwriter needs a settlement-grade fix inside the hour to close a hull claim."* The
   player learns the world by reading requirements they were going to read anyway.
2. **Recurring names.** Clients, rivals, and the regulator repeat. The world accretes.
3. **The Wire stays causal and never literary** (GDD §3). The story never appears there — only its
   consequences. "SETTLEMENT UNCLEARED — MARS CONJUNCTION, T+4d" is the whole of it.
4. **One paragraph, once.** A single ~80-word framing block on the new-game screen is the only
   place the premise is stated outright.
5. **Zero cutscenes, zero codex, zero intro crawl, zero character dialogue.**

**The hard cap:** a player who never reads a single reason line loses nothing mechanical. If that
ever stops being true, the story has escaped its cage.

## 9. What this setting must never do

- **No Earth collapse, no exodus, no refugees.** It turns the expansion into charity and the player
  into a saviour. This is an industry, and the player is a contractor in it.
- **No war, no aliens, no conspiracy, no chosen one, no villain corporation.**
- **No stated calendar year, ever, in the UI.** Show licence year and mission time. Internally, two
  generations out; on screen, never dated.
- **No lore that a mechanic depends on.** See the rule at the top.
- **No literary voice anywhere in the machine.** The instruments are instruments.

## 10. Open choices — recommendations, for a ruling

1. **Is Earth prosperous or strained?** *Recommend prosperous but capped.* The expansion is growth
   hitting a physical ceiling, not escape. A strained Earth drags the tone toward survival drama
   and undermines "you are a utility." Easy default: prosperous.
2. **Is the player a startup or a spun-off arm of an incumbent?** *Recommend a startup holding one
   licence.* It matches what M1 already built — a thin wallet, PROBATION, baseline offers — and it
   makes the first tender matter.
3. **Are there people at Mars, or mostly machines?** *Recommend few people, and they are customers,
   not characters.* Life-safety stakes need someone to be at risk in a conjunction; a populated
   colony story would pull focus off the network.
4. **Does the player's company get a name?** *Recommend the player names it once, at new-game, and
   the world uses it.* One free line of ownership at zero narrative cost.

---

*v0.1 DRAFT. Proposed as scenery for GDD §1, §3, §3b, §4.8, and §4.10. No mechanic in the M1 family
changes if this is rejected.*
