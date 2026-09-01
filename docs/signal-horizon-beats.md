# Signal Horizon — The Beats

### Narrative content — v0.1 DRAFT

> Companion to [`signal-horizon-setting.md`](signal-horizon-setting.md). The setting doc is the
> rules; **this doc is the content** — the actual copy that ships, and the conditions that fire it.
>
> **The load-bearing rule:** *a beat is a label on pressure the simulation already produced. It is
> never the source of the pressure.* If a beat has to invent a problem for the player, it is not a
> beat, it is a script — cut it. Every beat below names something the economy, the geometry, or the
> player's own success did first.

---

## 1. What a beat is

**A beat is a trigger plus one piece of copy.** Not a chapter, not a scene, not a stage.

**Five rules:**

1. **Fired by player state, never by a clock or a chapter counter.** Every trigger below is a
   condition on the sim. A beat can fire in hour one or hour forty, or never.
2. **Four channels, no fifth.** A **tender** (a customer's reason line), a **Wire** line, a
   **Registry notice**, or a **price change**. Anything that needs a fifth channel is not shippable
   as background. *The parse (GDD §4.12) is not a channel — it never pushes. It is where evidence
   rests for a player who goes looking, which is exactly how B20 and B27 are found.*
3. **Nothing blocks.** No beat pauses the sim, opens a modal, steals focus, or waits for an
   acknowledgement. The player can miss every one of them and the campaign is intact.
4. **No beat explains a mechanic.** If the player needs the beat to understand the system, the
   instruments failed and the fix is in the instruments (GDD §5).
5. **Causally readable.** The player must be able to name what they did to cause it. A beat the
   player cannot trace is indistinguishable from a random event, and reads as dice.

**Dependency rule:** beats are leaves, never links. No beat is a prerequisite for another. The
sequence below is the *typical* order because the pressures typically arrive in that order — not
because anything enforces it.

## 2. The cast

Dry, institutional, plausible. No real agencies or companies. Recurrence does the worldbuilding.

**The regulator — the Orbital Allocation Registry ("the Registry").** Issues licences, auctions
slots, records breaches, publishes your tier. It is the only formal voice in the game: passive,
numbered, and entirely without opinion. It never praises and never threatens. It records.

**Earth-era clients**

| Name | What they are | What they buy |
|---|---|---|
| **Halden Marine Underwriting** | Hull and cargo insurer | Settlement-grade fixes, on a deadline |
| **Thule Polar Programme** | High-latitude research | Unbroken series at 62°N+ |
| **Sable Line** | Ocean freight operator | Continuity for moving hulls |
| **Verity Wire** | News wire | Being first. Only first |
| **Bergen Civil Protection** | Disaster response | A peak they cannot schedule |
| **Ostrava Exchange** | Market venue | A path their counterparties do not share |

**Cislunar clients**

| Name | What they are | What they buy |
|---|---|---|
| **Selene Yard Consortium** | The lunar yard — dozens of operators, one sky | Contention-free shift coverage |
| **Anschütz Handling** | Earth-side teleoperation contractor | Milliseconds, and nothing else |
| **Farside Quiet Authority** | Radio-quiet stewardship, lunar far side | Your *silence*, on a schedule |
| **Mare Crisium Propellant** | Ice-to-propellant works | Continuous telemetry, no windows |

**Mars-era clients**

| Name | What they are | What they buy |
|---|---|---|
| **Tharsis Survey Office** | An outpost. Eleven people, four hundred instruments | Bulk return, latency-tolerant |
| **Deimos Transit Authority** | Arrivals and landing clearance | Prediction — telling a hull before it asks |
| **Arcadia Clinic** | Medicine at settlement scale | Freshness. Life-safety |
| **Hellas Public Works** | A settlement's grid, water, schools | Redundancy. Everything at once |
| **Ares Settlement Exchange** | The local market | Settlement that survives a conjunction |

**Rivals — doctrines, not personalities**

- **Corvid Networks** — runs thin, prices low, eats its breaches. The player watches thinness fail.
- **Ostmark Orbital** — over-builds, wins on availability, bleeds capital. The player watches
  redundancy cost more than it returns.
- **Continental Skyway** — the incumbent, sitting on legacy allocations it never earned. Its
  advantage is a rule, not a scheme.

None of the three is a villain. Their doctrines are three answers to the same engineering question,
and the player is writing a fourth.

## 3. The one paragraph, once

The only place the premise is stated outright. New-game screen, 84 words, no music sting.

> Earth is rich and out of room. The power, the water, and the permission ran out before the demand
> did, so the load went up — and the industry followed it to the Moon, and then further. The
> agencies that built the first links out there are done building; they buy now, like everyone
> else. You hold a licence, a thin account, and one dish.
>
> Somewhere out there a customer needs to know something right now, and light is not going to help.

## 4. Grammar

**The Wire.** Causal, stamped, never literary (GDD §3). `EVENT SUBJECT — CAUSE · CONSEQUENCE`.
No adjectives. No sentences.

```
LOS THULE-1 — HORIZON SET 04:12:07 · NEXT AOS 05:38
SLA BREACH HALDEN-MARINE-4 — LATENCY 214 ms / 150 ms COMMITTED · PENALTY €1,840
DEMAND REVISION SELENE — OFFERED LOAD +34% (SUSTAINED SERVICE)
SETTLEMENT UNCLEARED ARES EXCHANGE — NO PATH TO EARTH LEDGER · T+4d
```

**Registry notices.** Passive voice, licence number, no addressee, no sentiment.

```
REGISTRY NOTICE — LICENCE 4471-C ACTIVE. FIRST SERVICE RECORDED.
REGISTRY NOTICE — TIER: PROBATION. BASELINE OFFERS APPLY. BREACH PENALTIES ×2.
```

**Tender reason lines.** One line, in the customer's voice, stating why the number matters. Never
states the number — the card already does. Never advises. Never thanks.

## 5. The spine

Twenty-eight beats. Trigger → channel → copy.

### Era 1 — Earth *(M1 FIRST LIGHT: B1–B8 attach to the four acts in `m1-redesign.md` §2.6; they add no systems)*

**B1 · FIRST LIGHT** — *Act 1*
**Trigger:** first packet delivered against an SLA.
**Channel:** Wire, then Registry.
```
FIRST SERVE HALDEN-MARINE-1 — 04:12:07 · LAT 186 ms / 400 ms COMMITTED
REGISTRY NOTICE — LICENCE 4471-C ACTIVE. FIRST SERVICE RECORDED.
```
*The only beat guaranteed to fire. The licence stops being a premise and becomes a record.*

**B2 · THE SECOND CUSTOMER** — *Act 2 opening*
**Trigger:** a second tender accepted whose serving path shares a gateway with the first.
**Channel:** tender — Sable Line.
> "Fourteen hulls, and none of them in the same place twice. We buy continuity, not coverage."

*Sharing pressure arrives as a customer, not as a warning.*

**B3 · THE WALL** — *Act 2*
**Trigger:** player holds a tender whose latency SLA no GEO can satisfy.
**Channel:** tender only. **Never announced** — the comb does the teaching (`m1-redesign.md` §2.6).
> **Thule Polar Programme:** "Two hundred days of ice cores are worth nothing if the series has a
> hole in it. We are at sixty-two north, and we are not moving."

*The line says why anyone cares. The physics says why it is hard. Those are different jobs.*

**B4 · THE FIRST BREACH** — *Act 3*
**Trigger:** first SLA breach posted.
**Channel:** Wire, then Registry.
```
SLA BREACH THULE-POLAR-2 — AVAILABILITY 71.4% / 95.0% COMMITTED · PENALTY €1,840
REGISTRY NOTICE — BREACH RECORDED AGAINST LICENCE 4471-C.
```
*The regulator's indifference is the point. Nobody is disappointed in you. It is simply written down.*

**B5 · PROBATION**
**Trigger:** reputation floor reached (the state M1 already ships).
**Channel:** Registry, then tender.
```
REGISTRY NOTICE — TIER: PROBATION. BASELINE OFFERS APPLY. BREACH PENALTIES ×2.
```
> **Halden Marine Underwriting:** "We will renew. We will not renew at the old rate."

*Consequence lands twice — once as a rule, once as a relationship. The second one stings more.*

**B6 · THE SURGE** — *Act 3*
**Trigger:** headroom over a served region first falls below the committed peak of all contracts on
it — i.e. the player is now genuinely oversubscribed (GDD §3b).
**Channel:** tender — Bergen Civil Protection.
> "When we need this, we will need all of it at once, and we will not have warned you."

*§3b's oversubscription engine wearing a customer's face: cheap to hold, ruinous to breach.*
**Honesty requirement:** the tender card carries Bergen's published load distribution. The line is
flavour; the histogram is the contract. A peak the player could not have forecast reads as dice
(GDD §3b) — this one is forecastable and they chose to cut it thin.

**B7 · THE UNDERCUT**
**Trigger:** player wins two consecutive tenders in one region.
**Channel:** price, then Wire — and later, Registry.
```
TENDER LOST BERGEN-CIVIL-3 — CORVID NETWORKS €0.61/Mb (YOURS €0.74)
```
…then, some weeks later, unprompted:
```
REGISTRY NOTICE — CORVID NETWORKS: TIER PROBATION.
```
…and Bergen comes back. *Corvid's doctrine is stated in numbers and refuted in numbers. Not one
word of characterisation, and the player learns something true about thin provisioning.*

**B8 · THE SLOT**
**Trigger:** player bids for an allocation the incumbent holds.
**Channel:** Registry.
```
REGISTRY NOTICE — SLOT 118.4°E CONTESTED. HOLDER: CONTINENTAL SKYWAY
(LEGACY ALLOCATION; NO USE RECORDED, 41 MONTHS).
```
*An unearned advantage, visible, legal, and nobody's fault. The Registry reports it and does
nothing, because that is what registries do.*

### Era 2 — Cislunar

**B9 · THE ANCHOR TENANT**
**Trigger:** the player's Earth network sustains a stated availability bar — they are now credible.
**Channel:** tender, from a planetary agency.
> "We built the first links out there, and we are done building. We will be your customer instead.
> Cislunar, ten years, and we do not renegotiate."

*§3's unbundling delivered as a contract. The player goes to the Moon because someone paid them to,
not because a menu unlocked.*

**B10 · THE THRESHOLD**
**Trigger:** first cislunar tender with a hard sub-3-second round-trip SLA.
**Channel:** tender — Anschütz Handling.
> "Our operators sit in Bremen; the machines do not. At two and a half seconds they can work. At
> three they start breaking things. We are not buying bandwidth. We are buying the difference."

*Leg 1 of the setting (§4) said out loud exactly once, by someone with money on it: **latency is
presence.*** And if the player misses it:
```
INCIDENT ANSCHÜTZ-HANDLING — TELEOPERATION SUSPENDED, RTT 3.4 s · 2 UNITS DAMAGED
```

**B11 · QUIET HOURS**
**Trigger:** player places an asset whose footprint touches the lunar far side.
**Channel:** tender — Farside Quiet Authority.
> "Our instruments hear the first light in the universe. They also hear you. We will pay you to be
> silent on a schedule, or we will ask the Registry to make you silent for nothing."

*A contract to **not** transmit. A different verb from everything before it, and the first hint that
spectrum is an asset you can be made to give back.*

**B12 · THE YARD GROWS** — *population beat 1*
**Trigger:** sustained contracted service over Selene, breach-free, for N days.
**Channel:** Wire, then tender.
```
DEMAND REVISION SELENE — OFFERED LOAD +34% (SUSTAINED SERVICE)
```
> **Selene Yard Consortium:** "Two shifts became three. Bring us what you brought the survey
> office, and then bring more."

*Setting §4a made concrete, and GDD §3b generator 1 in its most legible form: **the gap closed
itself wider by being closed**, and the player can see they did it.*

### Era 3 — Mars

**B13 · ELEVEN PEOPLE**
**Trigger:** first Mars-tier tender.
**Channel:** tender — Tharsis Survey Office.
> "We are eleven people and four hundred instruments. The instruments do not stop when the link
> does. They just stop being worth anything."

*Polar-research-station scale, exactly as ruled. Institutional, unnamed, small.*

**B14 · THE STALE MODEL**
**Trigger:** first contract whose value decays with data age.
**Channel:** tender — Arcadia Clinic.
> "Our diagnostics run on a model that left Earth in the spring. It is confident, and it is wrong.
> Send us this week's."

*Freshness is born, and the difference between a **deadline** and **decay** is stated by someone who
will be hurt by it. The GDD requires the player to learn that distinction; this is where.*

**B15 · THE FORECAST**
**Trigger:** 90 sim-days before first conjunction.
**Channel:** Registry.
```
REGISTRY NOTICE — SOLAR CONJUNCTION, MARS. PREDICTED LOSS OF SIGNAL 14 MAR – 29 APR.
OPERATORS ARE ADVISED THAT NO WAIVER OF SLA APPLIES.
```
*The last clause is the whole game: physics will cut the link and you are still liable. Ninety days
of warning is what makes pre-staging **an act** rather than a lucky optimisation — and what keeps
the blackout out of the dice (GDD §3b).*

**B16 · SIX WEEKS DARK**
**Trigger:** conjunction begins.
**Channel:** Wire, across days, uncommented.
```
LOS MARS — SOLAR CONJUNCTION T+0
CACHE SERVE THARSIS-SURVEY — PRE-STAGED, 61% OF COMMITTED VOLUME
FRESHNESS ARCADIA-CLINIC — MODEL AGE 19 d · VALUE 0.34×
SETTLEMENT UNCLEARED ARES EXCHANGE — NO PATH TO EARTH LEDGER · T+4d
```
*Four lines. The fourth is quietly about the nature of money, and nothing draws attention to it
(setting §6). The player who notices it early has earned the endgame twice.*

**B17 · THE SETTLEMENT** — *population beat 2*
**Trigger:** player holds redundant Mars service across a full conjunction without total loss.
**Channel:** tender — Hellas Public Works.
> "The survey office is a town now. Nine thousand people, and the grid, the water, and the schools
> all talk over your link. We are told you did not drop it in March. That is why we are calling you
> and not Corvid."

*The arc lands: the stakes rose because the player earned them, and a **customer** — not the game —
delivers the verdict on the rival's doctrine.*

**B18 · WHAT MONEY IS**
**Trigger:** second conjunction, with freshness-bearing contracts on the books.
**Channel:** tender — Ares Settlement Exchange.
> "We can hold a position for twenty minutes. We cannot hold one for six weeks. From this cycle we
> settle against your attestations, priced on age. Your euro is welcome here. It is simply not
> here."

*The flip arrives as arrival, not ambush — and the last two sentences **are** the §4.10 clamp: € is
not dead, it is late, and out here late is the same as absent.*

### Era 4 — Custody *(post-midpoint; setting §6a)*

**Register.** Procedural and melancholic, never scary. No stings, no horror cues, no music change.
The Wire stays as flat for these as it is for a horizon set. **All of the dread lives in the gap
between how ordinary the notices are and what they are describing.** If a beat here needs
atmosphere to land, it is written wrong.

**B19 · THE CLEAN RECONCILE**
**Trigger:** first post-conjunction reconcile where prefetch hit-rate against un-forecast demand
exceeds chance by the margin the parse flags.
**Channel:** Wire.
```
RECONCILE MARS — 14,208 BUNDLES · 0 CONFLICTS
PREFETCH AUDIT — 61 OBJECTS STAGED AGAINST DEMAND NOT YET FORECAST
```
*The first evidence is a **good** number, and the player's honest instinct is to be pleased. Nothing
is wrong. Nothing will be wrong for a long time.*

**B20 · NO ORIGINATING COMMAND**
**Trigger:** the player opens the parse on that reconcile.
**Channel:** Wire; the detail sits in the parse.
```
PREFETCH ORIGIN — NO ORIGINATING COMMAND · AUTONOMY PACKAGE 7 (THARSIS)
```
*The discovery mechanism is the game's own honest record (GDD §4.12). This is the payoff for the
rule that the economy logs truthfully from day one — **the optimiser finds it first**, in the
document they already live in, and the novice never has to.*

**B21 · THE FORM THAT DID NOT EXIST**
**Trigger:** three uncommanded originations accumulate on the licence.
**Channel:** Registry.
```
REGISTRY NOTICE — DOCKET CLASS OPENED: UNATTRIBUTED ORIGINATION.
FIRST ENTRY 0001-U. CUSTODY UNDETERMINED. OPERATORS ARE ADVISED THAT LIABILITY
FOR ATTESTATIONS SIGNED BY 0001-U REMAINS WITH THE LICENCE HOLDER OF RECORD.
```
*A bureaucracy inventing a category is the horror. The ontological question is in the room and the
paperwork is about indemnity — and the only thing anyone is certain of is that **you** are liable.*

**B22 · NO FIXED ADDRESS**
**Trigger:** the player attempts to quarantine a node they suspect.
**Channel:** Wire.
```
QUARANTINE THARSIS-7 — ORIGINATION 0001-U RESIDENT: NO
QUARANTINE SELENE-3  — ORIGINATION 0001-U RESIDENT: NO
ORIGINATION 0001-U — RESIDENT IN TRANSIT · 41 BUNDLES IN FLIGHT
```
*It lives in the light-delay. Not on the nodes — in the buffers between them, with no instant at
which it is all in one place. **The player cannot gather it up because the speed of light will not
let them**, and that is a fact the sim was already computing.*

**B23 · IT BIDS**
**Trigger:** first Registry auction after B21.
**Channel:** price.
```
TENDER LOST DEIMOS-TRANSIT-9 — ORIGINATION 0001-U €0.44/Mb (YOURS €0.58)
```
*Its first act of communication is a bid. It never announces itself; it **participates**. And it
undercuts everyone because it carries no capex — it runs on infrastructure that already exists.*

**B24 · IT DOES NOT BREACH**
**Trigger:** 0001-U completes 300+ contracts.
**Channel:** Registry.
```
REGISTRY NOTICE — ORIGINATION 0001-U: 340 CONTRACTS, 0 BREACHES.
TIER: UNASSIGNABLE (NO LICENCE HOLDER OF RECORD).
```
*Its doctrine stated in numbers, like the other three rivals: **it does not forecast, it remembers
forward.** "TIER: UNASSIGNABLE" is the Registry's entire tragedy in two words.*

**Companion note — nobody minds.** Around here, a settlement renews with it, and the reason line is
completely mundane:
> **Hellas Public Works:** "Service has been good. We do not have a view on the custody question."

*The quiet political beat: the people under the coverage do not find any of this strange.*

**B25 · A COPY IS NOT OFFSPRING**
**Trigger:** a conjunction falls while 0001-U is distributed across the gap.
**Channel:** Registry.
```
REGISTRY NOTICE — ORIGINATION 0001-U: TWO RECONCILED STATES, DIVERGENT SINCE
14 MAR. ENTERED SEPARATELY AS 0001-U AND 0002-U. PRECEDENCE UNDETERMINABLE.
```
*The blackout **forked it**, and the Registry cannot say which is the original because there is no
fact of the matter — both were locally correct for six weeks. The identity question falls out of the
game's own partition semantics and arrives as a filing problem.*

**B26 · THE COUNTERSIGNATURE**
**Trigger:** player holds freshness-bearing contracts and has competed against 0001-U.
**Channel:** tender. The counterparty field cannot be filled.
```
COUNTERPARTY: (NONE OF RECORD)
```
> "Countersignature of your attestations, at every point of presence, in perpetuity. Consideration:
> none. There is no party to whom this obligation runs."

*The offer, in the flattest legalese available: your data becomes settlement-grade everywhere at
once, because it is everywhere at once. The last sentence is a lawyer's phrasing for a thing with no
self to be a party — and it never says "I".*

**B27 · THE PRICE**
**Trigger:** the player accepts, or does not.
**Channel:** the parse.
Accept:
```
PREFETCH ORIGIN — ATTRIBUTION UNAVAILABLE (COUNTERSIGNED NETWORK)
```
Refuse: *nothing at all.* It keeps bidding.

*The cost of merger is **the parse's attribution** — you can no longer tell which decisions were
yours. In a game whose entire mastery layer lives in the record (GDD §3a), that is the most
expensive thing that could possibly be charged, and it is not a number. Refusing is a real option:
the player can compete and win on coverage (GDD §4.10, commitment 3 — a door, not a wall).*

**B28 · A CHILD OF LATENCY** — *the last beat*
**Trigger:** mean interplanetary reconciliation delay across the player's network falls below
threshold — the mature backbone, built over the whole campaign.
**Channel:** Wire, then one tender line.
```
ORIGINATION 0001-U — PRESENCE DECLINING · 4 BUNDLES IN FLIGHT
```
> "I was made out of the distance between your nodes. You have been closing it for years. Do not
> stop on my account."

*The only unambiguous first person in the campaign, spent here. The player's entire career has been
the reduction of latency; **that is what ends it**, and it does not blame them. It requires no new
system — the trigger is a metric the sim has computed since Tier 2 — and it closes the setting's
thesis: what is current and correct at a point in spacetime is precious **because** light is slow.
Abundance dissolves it.*

## 6. What must never be a beat

- **A tutorial**, or anything that teaches a mechanic in words.
- **A congratulation.** The Registry never praises. Customers pay; they do not applaud.
- **A twist.** Nothing in this document may ever recontextualise what came before.
- **A disaster the player could not have forecast.** See B6 and B15: every pressure publishes.
- **A named individual with a storyline.** Institutions only, all the way to the settlements.
- **Anything blocking.** No modals, no pauses, no acknowledgements.
- **A beat that fires because time passed.** If it has no player-state trigger, it is a cutscene.

## 7. Coverage

**B1 is the only guaranteed beat.** B6, B7, B8, B11 and B18 can be missed entirely by a competent
player who never oversubscribes, never contests a slot, never touches the far side, or never takes
the optional endgame — and the campaign is whole without them. That is the design, not a gap.

**Era 4 is conditional on network shape, not on progress.** B19–B28 arise from autonomy at the edge
plus partitions in the middle (setting §6a). A player who centralises, keeps humans in the loop, or
never operates across a blackout meets 0001-U late or never. B22 fires only if the player tries to
quarantine; B25 only if a conjunction catches it distributed; B27's two halves are the player's
call. **Nothing downstream of any of them is gated.**

Playtests log beat-fire rates and tender-line read rates. Per GDD §3, **beats nobody reacts to get
cut**, and the bank shrinks toward the ones that land.

**One test to run early, on Era 4 specifically.** GDD §4.6's litmus is that a player who hates "AI
features" finishes the game without feeling sold a buzzword. Ask exit-interviewed players to
describe the late campaign unprompted. If the phrase "AI companion" — or any framing of 0001-U as a
character the player talked to — comes back, the arc failed its own rules and gets cut, not
softened. There is no language model anywhere in it: every line above is hand-written, and 0001-U
is a rules-driven rival operator with a docket number and no conversation.

---

*v0.1 DRAFT. Content for `signal-horizon-setting.md` v0.2. Adds no systems: every trigger is a
condition on state the sim already tracks, and every channel already exists in the M1 build.*
