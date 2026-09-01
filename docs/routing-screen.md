# THE ROUTING SCREEN — TRACE
### v1.0 · 2026-08-19 · the build-ready design for §5 primary view #4 and its routing table

> **Status: design accepted direction, pending build.** This document specifies the panel `trace`
> (title **TRACE**), its two-level routing table, its levers, and its build ramp. It **supersedes the
> retired SD-44 `ROUTING` desktop** (`LINK·LOAD` + `ROUTING·PREFER`, condemned in SD-45 for showing
> "a 30 px globe and no routes") and it **absorbs** those two dead panels rather than reviving them.
> It answers to: **GDD §4.3** (the four edge properties; "real animation budget, not a log line"),
> **§4.3a** (the trace is the game's `mtr`, first-class, rendered on the orrery; the player never
> writes a next-hop), **§5** (view #4; the six UX principles; one excellent view per milestone),
> **§8/DD-1** (monochrome machine, living signal), **§4.12** (the trace is the live face of the
> Parse), **M1 §7.2–§7.6** (the cost blend, the three control tiers, the self-diagnosing shortfall,
> the predictability seed, OSPF-now/BGP-later), **M1 §4.4** (the SLA-axis ramp), **M1 §5.3** (faults
> ride this view — no separate fault UI), and **m1-redesign LAW 1 (facts, never verdicts) + LAW 2
> (goals, never instructions)**. Produced by a 3-vision × 3-judge design workflow over the live
> source; every source claim below was read out of the repo, not remembered.
>
> **The one-sentence shape:** the routing table has **two levels — FLOWS over PIPES.** A flow row is
> a promise you made (one active contract, ranked by how close it is to breaking, with its binding
> constraint readable without a click). A pipe row is one antenna and everyone riding it, with the
> sum of promises drawn as a notch on its capacity bar. The flow level is §5 view #4's "pick a flow";
> the pipe level is where the oversubscription bet lives. Neither alone is the screen.

---

## 1. The decision this screen serves

**"Of everything short of its SLA right now — or closest to it — which one do I act on with a free
lever, and which do I let bleed until the next launch?"** That is one decision, made by exception,
with a real cost either way: **re-beaming is instant and free but un-serves whoever the antenna was
on**; **re-biasing a flow** only moves a path when a second pipe can actually reach the region, and
the screen shows you whether one exists. Everything on the surface exists to make that trade legible
and to show its consequence one frame later. The preset principle (DD-10) is satisfied because the
two free levers **live on the rows that justify pulling them** — this is a decision surface, not a
dashboard with a label. The floor player never comes here: MISSION keeps the DARK count, the
shortfall line and the ROUTE toggle, and **no loop beat requires opening TRACE** (m1-redesign §2.1,
GDD §4.12 — "the novice never opens the parse and is not punished for it").

---

## 2. Why the last ROUTING desktop died, and how this one is different

SD-45's playtest verdict on the SD-44 `ROUTING` desktop was four words: *"a 30 px globe and no
routes."* Three specific failures, and the three specific answers:

| SD-44 ROUTING failed because | TRACE answers |
|---|---|
| The globe was a token — no path was ever drawn on it. | The traced flow's real path renders on the orrery at full brightness with per-leg hop pips while every other path dims; hovering a loss line draws the link that **isn't** there as a dashed ghost. The globe is the thing you look at; the table is the thing you read. |
| `LINK·LOAD` was per-**sat** and denominated against a uniform capacity constant. | The contention ledger is per-**pipe** (`satId:slotIdx` — one antenna) denominated against that antenna's own `capacityUnits`, which is what the router actually uses (`router.ts:203, :311`). Rows key on `contract.id`, not `region.id` — the retired projection's renewal-generation collision is fixed by construction. |
| `ROUTING·PREFER` was a third representation of `net_set_prefer` on its own desktop, and the answer was pre-computed for you ("REROUTE PREVIEW"). | The prefer lever is the **same two-state SHORT/SPREAD verb already shipped on MISSION's tender rows**, same action, same `data-net` selectors. There is **no pre-commit reroute preview** — see §6. |

And the deeper failure the redesign named: **the diagnostic existed but had no view.** `src/sim/net/trace.ts`
implements `diagnose()` in full today, and `src/main.ts:1366-1390` drains all of it — every shortfall,
every `renderLossStamp(loss)` — into `SYSTEM.LOG`. That is literally the log line GDD §4.3 forbids
("it gets real animation budget, **not a log line**"). **This screen is where that output goes
instead.**

---

## 3. The screen

### 3.1 Mount, in two stages — panel first, desktop later `▸ LOCKED`

**Stage A (Phase 1–3): `trace` ships as a rail-summonable panel with NO new preset and NO `3` key.**
The player swaps it into any tile; the natural home is MISSION's `ledger-fleet` zone. This satisfies
DD-10's own merge test without an argument, satisfies "no loop beat requires leaving MISSION", costs
zero keymap/legend/rail-test work, and — decisively — it is shippable in days rather than a week.
**Where the judges disagreed on desktop-vs-panel, the panel wins, because the panel is the part that
has to be right and the preset is a mount point we can add after a playtest proves the full-height
globe is needed.**

**Stage B (Phase 4, GATED): the TRACE desktop, key `3`.** Ships **only** if a playtest shows the
panel-in-a-tile cannot carry the spatial read (candidate arcs and ghost links illegible at
MISSION's orrery size). Exact grid, ready to paste into `NET_PRESET_SPECS`:

```ts
{
  name: "TRACE",
  columns: [
    { weight: 0.44, rows: [{ weight: 1.0, host: "trace" }] },
    { weight: 0.56, rows: [
        { weight: 2.0, host: "orrery" },
        { weight: 1.0, host: "system-log" },
    ] },
  ],
}
```

Two columns, three zones, three panels, always-tiled, no duplicate hosts, inside the ≤3×3 ceiling.
At 1920×1080 (canvas ≈ 1886×1030 after the 34 px rail and the strips, 4 px gutters):

- **`trace` — 830 × 1030. The hero.** It earns the largest single zone from the task: reading a
  ranked list of 1–8 multi-line rows and picking one. The flow row's PATH line needs ~100 monospace
  characters at `--ts-ui` before it wraps.
- **`orrery` — 1050 × 685.** Not a token globe: bigger than MISSION's WIRE-plus-pad stack and only
  ~12 % smaller in area than MISSION's own orrery. Camera: reuse the dormant hook at
  `src/main.ts:3118`, renaming `"ROUTING"` → `"TRACE"` → `orrery.setPreset(2)` (ORBITS), where a
  path's climb and descend legs read rather than foreshorten. **In the same commit, delete the two
  genuinely dead branches** (`"OVERVIEW"` / `"CONNECTIVITY"` — those preset names no longer exist in
  `NET_PRESET_SPECS`).
- **`system-log` — 1050 × 341.** The WIRE stays under the globe exactly as on MISSION so the
  eye-line habit transfers. It is not a duplicate of the loss roll: the WIRE is chronological ("a
  thing just happened"), the roll is grouped-by-link ("this pair, N times, these spacings").

**Responsive floor:** below 560 px panel width the `CARRIED / ASKED` cell moves from line 1 to the
head of line 2. Below 420 px the row collapses to one line (glyph · label · BINDS) and the WM
tab-stacks `trace` with `system-log` rather than shrinking. Never shrink into illegibility.

### 3.2 What the orrery does while TRACE is up `▸ LOCKED`

- **The traced flow's path** (`solve.path` resolved to world points) renders at 2.5× width with hop
  pips marching along it; pip spacing per leg is proportional to that leg's share of the total
  one-way delay. Every other served path drops to 0.35 alpha.
- **Arc colour stays utilisation.** `Orrery.utilColor` already drives per-vertex arc colour from
  load/capacity (green → amber → red) and `orrery-net-mode.test.ts:158-186` pins that ramp.
  **The contract identity hue must NOT be moved onto the arc body** — it would break a pinned test
  and destroy the congestion read. Identity hue rides the **flow-row left rule, the region fill, the
  hop pips, and the pipe-bar segments**. This is a hard constraint no earlier design caught.
- **Ghost links:** hovering a loss-roll line draws a dashed machine-grey segment between the two
  named nodes for the duration of the hover — the path that isn't there, drawn where it would be.
- **Candidate arcs:** selecting a flow or a pipe draws a dashed `--violet` region→sat arc for every
  *other* serving pipe in the fleet whose link to that region **closes right now**. Geometry, not a
  solver preview (see §6.3).
- **Faults** keep their existing amber pulse and telegraph ring. The camera **never moves** on
  selection (the fleet-chip precedent); only the explicit `⌖` control flies it.

### 3.3 Reaching it, and being reached `▸ LOCKED`

The behavioural falsifier for this whole surface (player-attack Adjustment 11) is *does a tester open
the trace before a shortfall fires*. That cannot be measured if there is no path to the screen, so
the pull is specified, not assumed:

- **MISSION's `.mission-shortfall` line becomes clickable** → summons `trace` into the focused tile
  with that flow selected and expanded. This is the hand-off from "a red thing appeared" to "here is
  why", and it also preserves §5's "no critical state should require digging" (the shortfall is
  still legible on MISSION; TRACE deepens it).
- **A dark region or a serving sat clicked on the orrery** selects the corresponding flow in TRACE
  if TRACE is mounted; it never forces a mount.
- **The rail** (`NET_RAIL_PANELS`) gains `{ host: "trace", label: "TRACE" }` inserted after MISSION.
- **REVIEW** is unchanged. The Parse is TRACE's at-rest twin, not its home; §7.6 below locks the
  shared vocabulary so the two never disagree about what a word means.

---

## 4. THE ROUTING TABLE

### 4.0 What it is NOT `▸ LOCKED`

It is **not a FIB.** No destination prefix, no next-hop, no admin metric, no interface, no AS path.
M1 §7.1 rejects daemon fidelity as "fidelity the player can't perceive". The transferable-knowledge
payoff (§3a) here is **QoS-class allocation over shared, capacity-limited links** — real traffic
engineering — not a router dump.

> **AMENDED (SD-57, 2026-09-01).** This section previously also rested on "the M1 path is always
> exactly three nodes … with `CROSSLINK` structurally unable to route". That was a statement about
> the Act-1 bent-pipe STUB, not about the design: SD-39 always locked a multi-hop graph solver, and
> M1-SLV-1 has now built it. A path is `region → serving sat → [relay hops] → landing sat → ground`
> and is three nodes only when the fleet flies no CROSSLINK. Nothing on this screen breaks — the
> `via A · TYPE → B` grammar was chosen to grow (see 11.6) — but the claim above was false and is
> withdrawn rather than reworded.

### 4.1 Two levels, and why

- **A FLOW row is a promise** — one **active** contract, keyed `contract.id`. This is §5 #4's unit
  ("pick a flow"), it is what `bindingConstraint` is a property of, and it is what the prefer lever
  binds to. **WHO IS HURT.**
- **A PIPE row is one antenna** — one serving slot on one sat, keyed `pipeKey(satId, slotIdx)`, with
  every flow riding it and the sum of their committed floors notched on its bar. This is where
  capacity, congestion, beams and fair-share actually live. **WHAT IS HURTING THEM.**

The two are explicitly linked, not two adjacent groups the player must correlate by reading satellite
ids: a dark flow's PATH cell **is** the link to its pipe row (click it, the pipe row scrolls in and
takes `.sel`), and hovering a pipe row puts a left rule on every flow riding it.

Offered / completed / failed contracts are **not** rows (`lastSolveFor` returns null for them
forever, and printing a would-be route for an unsigned tender is a pre-commit verdict). The Mars flow
**is** a row, with pipe/capacity cells special-cased per §4.9.

### 4.2 Panel anatomy

Inside `.telem trace`, top to bottom. Every group after the first is **absent** (`display:none`) when
it has nothing to say — honest silence, never an empty column.

1. `.trace-head` — the census line (§4.3).
2. `.trace-flows` — **the flow board** (§4.4). Always present; carries the empty state.
3. `.trace-pipes` — **the contention ledger** (§4.6). Present once ≥1 pipe carries traffic.
4. `.trace-losses` — **the grouped loss roll** (§7). Present once ≥1 loss stamp exists.
5. `.trace-nodes` — **sick nodes** (§4.8). Present once ≥1 `FaultState` exists — i.e. structurally
   invisible for the first ~30 minutes, exactly like the SLA axes.

`status()` → `crit` if any flow is DARK or any rider is under floor; `warn` if any flow is TIGHT, any
pipe ≥ 0.80, or any fault is live; else `ok`. `subtitle()` → `· 2 dark · 1 tight`. **MissionTop and
LedgerFleet both leave the titlebar lamp permanently grey; this panel uses the free signal**, so the
across-the-room read survives the panel being off-screen.

### 4.3 The head census

```
WHAT BINDS · 5 flows                    2 dark · 1 tight · 2 clear · as of 12:41
```

`as of {mm:ss}` is mission-elapsed sim time. **When the clock is paused it reads `held at 12:41 ·
paused`** — the physics cells are frozen because the sim is frozen, and saying so is the difference
between an honest instrument and one accused of lying.

### 4.4 The FLOW row — exact columns

**Line 1 — the scan line** (`--ts-body` 13 px, ~16 px tall):

| # | header | width | content | format | non-colour channel | source |
|---|---|---|---|---|---|---|
| 1 | `⌗` | 2 ch | band glyph | `✕` DARK · `▲` TIGHT · `·` CLEAR · `◷` stale solve · `†` served by a sick sat · plus a 400 ms `↑`/`↓` on a rank change | glyph | derived |
| 2 | `FLOW` | 20 ch | contract label + renewal generation | `corridor metro` · `equatorial metro ⟲1` | the word; 3 px identity-hue left rule (position) | `Contract.label`, gen parsed off `Contract.id` (`REGION-0+R1`) |
| 3 | `BINDS` | 9 ch | the axis that decides this row | `LATENCY ✕` `AVAIL ✕` `BW ✕` `CONN ✕` when unserved (caps + `✕`); `lat` `avail` `bw` `conn` dim-lowercase when it is merely the *nearest* axis; `—` when one axis and clear | caps-vs-lowercase + `✕` | `SolveResult.bindingConstraint`, else the argmin axis |
| 4 | `CARRIED / ASKED` | 26 ch | the two raw numbers for the BINDS axis, in that axis's own units, plus their ratio | see §4.5 | the numerals themselves | see §4.5 |
| 5 | trend | 2 ch | `↗` improving · `↘` worsening · blank | sign of the headroom change over the last 30 frames | glyph | render-only ring |

**Line 2 — the path line** (`--ts-ui` 11 px, `--fg-dim`, indented 3 ch). *This is the trace.* It
prints the path in path order, so the climb–traverse–descend silhouette is text; it grows more
segments unchanged when M4 adds a spine (§11.6).

```
via NET-SAT-2 · GATEWAY  ⑂×3  ▓▓▓▓▓▓▓▓▒ 4.60/4.00 u OVER  → GROUND-0        [SHORT][spread]
```

- **`NET-SAT-2 · GATEWAY`**, never `NET-SAT-2:1`. The colon-index reads as a port number to an
  engineer and as noise to everyone else. Two same-type serving antennas on one bus disambiguate
  with a letter (`ACCESS-L a` / `ACCESS-L b`); the raw pipe key lives in `data-pipe` for Playwright.
- **`⑂×3`** appears only when ≥2 active flows share this pipe. Hovering it hairlines the siblings.
- **The load bar** is 8 cells, width `sharedLoad / effCap` capped at 8; over 1.0 the overflow cells
  render `▒` and the numeral gains the word `OVER`. Bar width + numeral + word = three channels.
  **There is exactly ONE bar semantic on this screen: fullness.** (No headroom gauge — see §4.10.)
- **`→ GROUND-0`** from `path[path.length-1]`, resolved against `session.grounds` and guarded for
  `undefined`.
- The whole pipe cell is a button (§6.1). The `[SHORT][spread]` pair is the prefer lever (§6.2); the
  active stop **inverts** (`.net-btn.active`), it is not merely recoloured.

**Line 3 — the why-now line** (`--ts-cap` 9 px, DARK and TIGHT rows only):

```
dark 0:47 · out of link budget at 12:38 (×4, ~1m02s apart) · bleeds €2,400/hr while dark
```

`dark m:ss` is the render-only clock (§9.3). The cause and time come from `SolveResult.losses`,
phrased not enum'd (§8). The € clause is `Contract.penaltyPerSecond × 3600`, DARK rows only, and it
is the reason a cold player cares. **No €-per-unit-of-capacity anywhere** (m1-redesign §2.4).

**Line 4 — the binding line** (`--ts-cap` 9 px, `--amber`, `└` rule, DARK rows only, **on the
collapsed row**):

```
!  4.6 ms carried against a 3.0 ms budget — a shorter LEO or relay route cuts it.
```

§5's "no critical state should require digging" is not satisfied by a disclosure triangle. **The
binding sentence is never behind an expansion.** The numbers are the panel's own live per-pipe
reads; the fix clause is the §7.4 kind-of-fix, rendered from `FIX_CLAUSE` (§8), never from
`TraceShortfall.message` verbatim (§9.2 explains why, and P0 fixes the sim so the two can never drift
again). Optimisation/resilience shortfalls use the same line with `?  IDLE ·` / `?  SINGLE PATH ·`.

> **BUILD CORRECTION (2026-08-19).** `? SINGLE PATH` is **gated on faults being live**
> (`session.faultsEnabled`, i.e. act 3b onward). Before a fault can happen, "one sat carries it — a
> second bridge survives a fault" is a warning about nothing, and it fired on the Act-1 opener's
> single satellite — noise in the deliberately gentle first ten minutes. Same principle as the SLA
> axes: **absent until the mechanic exists, never greyed.**

### 4.5 `CARRIED / ASKED` — exact number formats per axis `▸ LOCKED`

The measured value and the promised value, adjacent, in that axis's own units, with the ratio that
needs no referent. This is the discipline that structurally prevents the condemned "the UI lied"
bug: **every derived judgement is printed next to the two raw numbers that produced it, so the
player can check the arithmetic.**

| axis | format | example | notes |
|---|---|---|---|
| connectivity | `{elev}° / 5.0° gate` | `18.4° / 5.0° gate` | when the link budget is the tighter gate: `budget ×2.4 / ×1.0`. No bridge at all: `no bridge / —` |
| availability | `{held}% held / {bar}% asked` | `96.2% held / 99.0% asked` | one decimal |
| latency | `{ms} ms / {ms} ms budget  ({pct}%)` | `4.6 ms / 3.0 ms budget  (153%)` | one decimal, matching `trace.ts`'s `(latencyS*1000).toFixed(1)`. **This world's honest values are 2–8 ms against a 3.0 ms Act-3 SLA** (`NET_ACT3A_LOW_LATENCY_S = 0.003`, a 300 km toy body) — do not design against real-world 340 ms figures |
| bandwidth | `{share} / {floor} u  ({pct}% of floor)` | `0.53 / 0.60 u  (88% of floor)` | two decimals |

**The unit `u` is defined once, on screen, in the PIPES group legend** — `capacity in units · one
unit is roughly one region's baseline demand` — and again in the `PIPE_SHARE_TIP` tooltip. An
undefined unit on the primary key of the primary table is the largest comprehension failure available
here; it is closed by definition plus the always-present ratio percentage.

Other formats: money `€{Math.round(v).toLocaleString("en-US")}`; signed rates prefix `+`/`−`
(U+2212, not a hyphen); mission time `mm:ss`; intervals `~1m02s`; separators ` · `; Mars delay
`15m 25s`.

### 4.6 The PIPE row — the contention ledger

Group legend, always present when the group is:

```
PIPES · ALLOCATION   capacity in units · paths hold until the geometry moves · load is now
```

That legend line is the honest resolution of the sim's own split: **Dijkstra re-runs only on a
topology-change event; serve/breach is re-evaluated every tick.** Without stating it, a table that
holds a path steady between events looks frozen and gets accused of lying.

Enumerate `session.sats × sat.loadout`, keep slots where `isServingType(antenna)`. **CROSSLINK rows
are excluded by construction** — `pipeEligible` returns false for it, and a permanently-inert row is
a lie by implication.

**(a) Head line** (`--ts-ui`, ~15 px):

| cell | content | example |
|---|---|---|
| `.pipe-id` | sat + antenna, never the slot index | `NET-SAT-2 · GATEWAY` |
| `.pipe-type` | type glyph | `✳` BROADCAST · `◆` GATEWAY · `●` ACCESS-L · `○` ACCESS-S |
| `.pipe-target` | beam target **label** (not id), or the honest absence | `→ corridor metro` · `· floodlight ·` · `· unaimed ·` · `→ polar metro · NO LINE OF SIGHT` |
| `.pipe-load` | load / effective capacity | `4.60 / 4.00 u` |
| `.pipe-derate` | only while degrading | `(4.00 ×0.50 SICK)` |
| `.pipe-pct` | integer utilisation | `115%` |
| `.pipe-state` | the **word** | `HEADROOM` <0.80 · `TIGHT` 0.80–1.0 · `OVER` ≥1.0 · `IDLE` load 0 · `BLIND` aimed with no line of sight; any rider under floor appends `· STARVING` |

**(b) Bar line** (6 px tall, 1-bit housing: `--bg-2`, 1 px `--line-dim`, hard edges):

- **Segmented fill** — one `.pipe-seg` per rider, width `share / effCap`, in that contract's identity
  hue, **in the same order as the rider lines below**. Three redundant channels so the segments stay
  attributable with colour off: (1) order matches the rider-line order, (2) each segment carries a
  cycling dither density (`--dither-sparse` / `--dither-mid` / `--dither-dense`) as a texture channel,
  (3) segments ≥20 % width print the flow's 3-char tag inline.
- **`.pipe-floor-notch`** — a 1 px `--line` tick at `Σfloor / effCap`. **The promise line.** This is
  the single most important widget on the screen: it renders the §4.3 statistical-overprovisioning
  *bet* — "cut it as thin as you dare" — **before the peak bites**, which is the mandate M1 §4.3
  gives this surface verbatim. When `Σfloor > effCap` the notch pins to the right edge as a `▶` and
  the numeral reads `Σfloor 4.60 u > 4.00 u pipe`: you have promised more than the antenna can carry,
  and you can see it while everything is still green.
- **Overflow** — util > 1 draws `▶` past the right edge plus `OVER +0.60 u`.

**(c) Rider lines** (10 px, one per contract riding the pipe):

```
▸ corridor metro     ·lat  offer 1.60  share 1.39  floor 0.60   ✓ 232%        [SHORT|spread]
▸ coastal backhaul   ·bw   offer 0.40  share 0.35  floor 0.30   △ TIGHT 116%  [short|SPREAD]
▸ equatorial metro   ·bw   offer 2.60  share 2.26  floor 2.40   ✕ STARVED 94% [SHORT|spread]
```

`✕ STARVED` when `floor > 0 && share < floor`. `△ TIGHT` when `share/floor < 1.15` **(TUNABLE)**.
When the bandwidth axis is inactive for that contract there is no floor and the flag is a bare `·` —
**inactive axes are absent, never greyed** (M1 §4.4).

**(d) Idle summary** — everything idle collapses to one always-visible line at the foot of the group:

```
· 3 pipes idle · 4.10 u parked                                                   [ SHOW ]
```

The number is **shown, not hidden** — idle capacity is exactly the §4.12 waste read, and it is the
only waste signal M1 will actually have, because `diagnose`'s over-provision face requires a
concurrently unserved contract (`trace.ts:243`) and so is silent in the ordinary Act-2 over-build
case. Collapse on **idle alone**, regardless of aim; aimed-but-idle pipes are counted separately in
the expanded list so a mis-aimed antenna is still findable.

### 4.7 Sort order and grouping `▸ LOCKED`

Three named bands, printed as the `⌗` glyph, so the top-level order is reproducible in the player's
head:

1. **DARK** (`✕`) — unserved. Ordered by `SLA_AXIS_ORDINAL(bindingConstraint)` (connectivity →
   availability → latency → bandwidth), then longest-dark first, then `contract.id`.
2. **TIGHT** (`▲`) — served, but headroom on some active axis is below `TRACE_TIGHT_BAND = 0.15`
   **(TUNABLE)**. Ordered by headroom ascending.
3. **CLEAR** (`·`) — everything else. Ordered by headroom ascending.

**Headroom is computed and never printed** (§4.10). A row overtakes its neighbour **only by beating
it by more than `TRACE_RANK_HYSTERESIS` (0.05)** — a margin between the PAIR, evaluated against the
previous frame's order as the seed.

> **BUILD CORRECTION (2026-08-19).** The first implementation instead quantised both keys onto a
> 0.05 grid and tie-broke on the previous rank. That is not hysteresis: two rows straddling a
> bucket boundary flip on an arbitrarily small move, and the playtest caught it within minutes
> (`[REGION-2,BACKHAUL-3] → [BACKHAUL-3,REGION-2]` on a 0.02 wobble). A pairwise margin has no
> boundary to straddle. The bucket survives only as the coarse seed for a row nobody has seen yet. `offeredLoad` oscillates continuously on the diurnal curve
(`burstyOfferedLoad`, ±45 % of baseline), so without this the list shuffles every frame and becomes
unclickable. **A row that does change rank flashes `↑`/`↓` for 400 ms** so the reorder is an event
you *see*, not a jump you discover.

Pipe rows use two buckets — **CONTENDED** (any rider under floor, or util ≥ 1.0) then **REST** — with
the same 0.05-band hysteresis on the util crossing (enter at 1.00, leave at 0.94), then `satId` then
`slotIdx`. Bucketing on discrete events means the ledger only reorders when a pipe actually tips
over, and that jump is the event you want.

No sort-by-column UI, no filters, no pagination. **The table has exactly one correct order and it is
the one the physics dictates.** A reconfigurable table is a spreadsheet, which is the M1 gate's own
named FAIL condition.

### 4.8 Sick nodes — `NODES` group (M1 §5.3, no separate fault UI)

```
NODES · sick
† NET-SAT-2   DEGRADED (lowOrbit)         capacity ×0.50 · recovers in 0:12   carrying 3 flows
† NET-SAT-4   FAILURE WARNING (age)       fails in 0:31                       carrying 1 flow
```

Glyph (`~` degraded · `◌` transient · `⚠` warning · `✕` dead) **plus the word plus the countdown** —
composed in-panel from `FaultState` + `telegraphedCountdownRemainingS`, **not** from
`renderFaultLine` (which prints raw seconds and cannot put load on the same line). The rightmost cell
is the blast radius, and every flow row served by a sick sat carries `†` in its `⌗` column — the
Act-3 telegraphed fault targets the highest-load sat, so the countdown and its victims read together
by design.

### 4.9 Mars — one rule, applied everywhere `▸ LOCKED`

`region.bodyId === "mars"` ⇒ `pipe === null`, `path = [regionId, MARS-RELAY-n, groundId]`,
`latencyS ≈ 925 s`, presence-based solve. **Every pipe/capacity/utilisation/share cell renders `—`,
never `0`.** The path line reads `via MARS-RELAY-0 (presence) → GROUND-0`. `CARRIED / ASKED` reads
`15m 25s / —`. The prefer buttons render **disabled with a stated reason** (tooltip:
`one relay, no alternative`); the pipe button is absent. Line 3 carries
`one-way light 15m 25s — the answer is already old when it lands.` Mars never appears in the PIPES
group at all.

### 4.10 Why there is no printed "margin" scalar `▸ LOCKED`

An earlier design ranked rows by a signed composite headroom fraction and printed it. **The scalar
dies; the ordering it produces survives.** Normalising elevation, availability, a latency ratio and a
share ratio onto one number with admittedly-placeholder divisors is a designer's opinion wearing two
decimals of authority — the player cannot audit it, and §3a is explicit that you can only tame
complexity you can *see and comprehend*. The three named bands give a reproducible top-level order;
the two adjacent raw numbers give the audit; the internal index only breaks ties inside a band.
**Equally: there is no headroom gauge.** One bar semantic on this screen — fullness — because a
"more filled = better" gauge on line 1 above a "more filled = worse" load bar on line 2 is a trap.

### 4.11 The expansion (click a flow row; exactly one at a time)

The binding sentence is *not* here (§4.4). The expansion holds the drill-down only, each block
omitted when empty:

1. **`geometry`** — `elev 41.7° · budget ×3.1 · dist 588 km · up 1.9 ms + down 2.7 ms`, re-derived
   with two `evaluateLink` calls on the chosen legs. The "why is that number that number" answer.
2. **`alloc`** — the full rider ledger for this flow's pipe, listing every sharer whether or not it
   is adjacent in the sort (the collision read must survive two colliding flows ranking far apart
   because only one of them is starving).
3. **`losses`** — the last up to 8 stamps for *this flow's* link pairs with their observed spacing.
4. **`hardware`** — the fault fact for the serving sat plus its countdown.

If the panel's re-derived leg sum disagrees with `SolveResult.latencyS` — which happens routinely,
because `resolveTick` returns the cached result for a still-unserved contract
(`router.ts:455-462`) — **the panel prints the router's `latencyS` as truth and stamps the geometry
block `as of {mm:ss}`.** Never two silently different numbers, never a `≈`.

### 4.12 Empty state

Zero active flows (Act 1 before the first signature). One dim `.net-hint` line inside the flows
group; the column-header rule stays visible so the board announces its shape before it has content.
All other groups absent. `status()` → `idle`, `subtitle()` → `""`.

```
nothing is carrying traffic yet — a signed tender and a bird in view make the first row.
```

### 4.13 The Act-1 read — one satellite, one contract, connectivity only

```
┌─ ● TRACE · 1 clear ────────────────────────────────────────────────────────────────────────┐
│  WHAT BINDS · 1 flow                                    0 dark · 0 tight · 1 clear · 04:12  │
│ ┌────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ⌗  FLOW               BINDS     CARRIED / ASKED                                         │ │
│ ├────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │ ·  equatorial metro   conn      7.2° / 5.0° gate                                     ↘  │ │
│ │      via NET-SAT-0 · BROADCAST  ▓▓▓▓▓░░░ 1.00/1.50 u  → GROUND-0                        │ │
│ └────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ PIPES · ALLOCATION  capacity in units · paths hold until the geometry moves · load is now┐│
│ │ NET-SAT-0 · BROADCAST ✳  · floodlight ·          1.00 / 1.50 u    67%   HEADROOM         ││
│ │  [███████████████████████████┊                    ]                                     ││
│ │   ▸ equatorial metro   ·avl  offer 1.00  share 1.00  floor —      ·                     ││
│ └─────────────────────────────────────────────────────────────────────────────────────────┘│
│  (LOSSES absent — nothing has dropped yet.  NODES absent — faults cannot exist before act3b)│
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

**This is not embarrassing, because the needle moves.** `7.2° / 5.0° gate` is falling toward the
horizon as the LEO sweeps off; it will cross, the link will drop, and a loss stamp will appear
2:30 later and again 2:30 after that. It is the only surface in the game that shows a link
approaching its gate. No `HELD` cell (availability axis inactive), no `floor` (bandwidth inactive),
no `NODES` group. **Absent, not greyed.**

### 4.14 The Act-3 read — a dozen sats, five flows, faults live

```
┌─ ● TRACE · 2 dark · 1 tight ────────────────────────────────────────────────────────────────────┐
│  WHAT BINDS · 5 flows                                 2 dark · 1 tight · 2 clear · as of 12:41   │
│ ┌─────────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ ⌗  FLOW                BINDS      CARRIED / ASKED                                            │ │
│ ├─────────────────────────────────────────────────────────────────────────────────────────────┤ │
│ │▐✕  corridor metro      LATENCY ✕  4.6 ms / 3.0 ms budget  (153%)                          ↘  │ │
│ │      via NET-SAT-2 · GATEWAY  ⑂×3  ▓▓▓▓▓▓▓▓▒ 4.60/4.00 u OVER → GROUND-0    [SHORT][spread]  │ │
│ │      dark 0:47 · out of link budget at 12:38 (×4, ~1m02s apart) · bleeds €2,400/hr while dark│ │
│ │   !  4.6 ms carried against a 3.0 ms budget — a shorter LEO or relay route cuts it.          │ │
│ │                                                                                              │ │
│ │▐✕  polar metro         AVAIL ✕    96.2% held / 99.0% asked                                ↘  │ │
│ │      no bridge — nothing in view closes the link                            [SHORT][spread]  │ │
│ │      dark 2:05 · set below the horizon at 12:29 (×9, ~2m10s apart) · bleeds €2,400/hr        │ │
│ │   !  no sat covers it in this window — one more phased in this plane holds it across the gap.│ │
│ │                                                                                              │ │
│ │▐▲† equatorial metro⟲1  bw         2.26 / 2.40 u  (94% of floor)                           ↘  │ │
│ │      via NET-SAT-2 · GATEWAY  ⑂×3  ▓▓▓▓▓▓▓▓▒ 4.60/4.00 u OVER → GROUND-0    [SHORT][spread]  │ │
│ │      tight 0:12 · share fell under the floor at 12:40                                        │ │
│ │                                                                                              │ │
│ │▐·  coastal backhaul    bw         0.35 / 0.30 u  (116% of floor)                          ↘  │ │
│ │      via NET-SAT-2 · GATEWAY  ⑂×3  ▓▓▓▓▓▓▓▓▒ 4.60/4.00 u OVER → GROUND-0    [short][SPREAD]  │ │
│ │                                                                                              │ │
│ │▐·  Mars colony         conn       15m 25s / —                                                │ │
│ │      via MARS-RELAY-0 (presence) → GROUND-0                                 [short][spread]  │ │
│ │      one-way light 15m 25s — the answer is already old when it lands.                        │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ PIPES · ALLOCATION   capacity in units · paths hold until the geometry moves · load is now   ┐ │
│ │▸NET-SAT-2 · GATEWAY  ◆  → corridor metro         4.60 / 4.00 u   115%  OVER · STARVING       │ │
│ │  [██COR███████████████EQM██████████████████bkh██┊]▶                       OVER +0.60 u       │ │
│ │   ▸ corridor metro     ·lat  offer 1.60  share 1.39  floor 0.60   ✓ 232%      [SHORT|spread] │ │
│ │   ▸ equatorial metro⟲1 ·bw   offer 2.60  share 2.26  floor 2.40   ✕ STARVED 94% [SHORT|sprd] │ │
│ │   ▸ coastal backhaul   ·bw   offer 0.40  share 0.35  floor 0.30   △ TIGHT 116% [short|SPREAD]│ │
│ │                                                                                              │ │
│ │ NET-SAT-4 · ACCESS-L ●  → polar metro · NO LINE OF SIGHT                                     │ │
│ │            (2.40 ×0.50 SICK)                     0.00 / 1.20 u     0%  BLIND    [ REPOINT ]  │ │
│ │  [                                                ]                                          │ │
│ │                                                                                              │ │
│ │ NET-SAT-7 · ACCESS-S ○  → equatorial transit     0.90 / 1.20 u    75%  HEADROOM               │ │
│ │  [██████████████████████████████████┊             ]                                          │ │
│ │   ▸ equatorial transit ·lat  offer 0.90  share 0.90  floor 0.60   ✓ 150%      [SHORT|spread] │ │
│ │                                                                                              │ │
│ │ · 3 pipes idle · 4.10 u parked                                                    [ SHOW ]   │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ LOSSES · BY LINK · geometry and the mission clock ──────────────────────────────────────────┐ │
│ │ REGION-1 ↔ GROUND-1    set below the horizon   ×9   08:09 · 10:19 · 12:29        ~2m10s      │ │
│ │ REGION-2 ↔ NET-SAT-2   out of link budget      ×4   10:33 · 11:36 · 12:38        ~1m02s      │ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
│ ┌ NODES · sick ───────────────────────────────────────────────────────────────────────────────┐ │
│ │ ~ NET-SAT-4   DEGRADED (lowOrbit)        capacity ×0.50 · recovers in 0:12   carrying 0 flows│ │
│ │ ⚠ NET-SAT-2   FAILURE WARNING (age)      fails in 0:31                       carrying 3 flows│ │
│ └─────────────────────────────────────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────────────────────────────────────┘

  ▐ = the flow's identity hue as a 3 px left rule (position channel — survives colour-off)
  ┊ = the Σfloor notch: the sum of promises against this pipe   ▶ = overflow past capacity
  ⑂×N = N flows share this pipe   † = served by a sick sat   ⟲1 = renewal generation
```

**The whole read is available in one glance with colour off:** two `✕` at the top with their axes in
caps, one `OVER` word, one `✕ STARVED` word, one `⚠` with a countdown, and the notch pinned to the
right edge of the pipe everyone is fighting over. At ~5 flows and ~4 carrying pipes the content is
roughly 420 px in an 1030 px tile — no scroll, and room for Act-3 escalation. **Row ceiling: if the
carrying set ever exceeds 5 flow rows, the CLEAR band collapses to a summary line
(`· 4 clear`, expandable).** Five is what a person reads at once.

---

### 4.15 TUNABLE numbers — every threshold on this screen, in one place

None of these is a LOCKED shape; all of them are play-tuning knobs. Keep them as named consts in
`src/panels/trace-derive.ts` so a playtest can move them without a hunt.

| const | value | what it does |
|---|---|---|
| `TRACE_TIGHT_BAND` | **0.15** *(TUNABLE)* | headroom below which a served flow enters the TIGHT band |
| `TRACE_RANK_HYSTERESIS` | **0.05** *(TUNABLE)* | how much lower a headroom must be before a row overtakes its neighbour |
| `TRACE_RANK_BUCKET` | **0.05** *(TUNABLE)* | quantisation applied before comparing headrooms |
| `TRACE_PIPE_TIGHT_UTIL` | **0.80** *(TUNABLE)* | pipe reads `TIGHT` (and the warn cue arms) at this utilisation |
| `TRACE_PIPE_OVER_UTIL` / `_LEAVE` | **1.00 / 0.94** *(TUNABLE)* | the CONTENDED bucket's enter/leave pair — hysteresis against diurnal oscillation |
| `TRACE_RIDER_TIGHT_RATIO` | **1.15** *(TUNABLE)* | `share/floor` below which a rider reads `△ TIGHT` |
| `TRACE_CLEAR_ROW_CEILING` | **5** *(TUNABLE)* | flow rows shown before the CLEAR band collapses to a summary line |
| `TRACE_ROLL_LINKS` / `_STAMPS` | **12 / 8** *(TUNABLE)* | loss-roll retention: distinct link+cause keys, and `atS` values per key |
| `TRACE_ROLL_MIN_FOR_INTERVAL` | **3** *(TUNABLE)* | stamps required before the observed mean spacing renders at all |
| `TRACE_REROUTE_FLASH_MS` | **600** *(TUNABLE)* | how long the path cell shows `← old pipe` |
| `TRACE_RANK_FLASH_MS` | **400** *(TUNABLE)* | how long a rank-change `↑`/`↓` glyph holds |
| `TRACE_TREND_SAMPLE_FRAMES` | **30** *(TUNABLE)* | headroom sampling period behind the `↗`/`↘` arrow |
| `TRACE_SEG_LABEL_MIN_FRAC` | **0.20** *(TUNABLE)* | bar-segment width above which the flow's 3-char tag prints inline |
| `TRACE_HANDROUTE_NOTE_S` | **4** *(TUNABLE)* | how long the hand-route fact line stays up |
| `TRACE_PROJECTION_BUDGET_MS` | **1.5** *(TUNABLE, but treat as a gate)* | p95 ceiling for `traceState()` in the `panels` perf bucket |

---

## 5. Cross-highlight, interaction, keyboard, audio

### 5.1 The cross-highlight contract `▸ LOCKED`

m1-redesign §2.1 makes this structural: *"each contract owns a hue shared by its tender row, region
fill, flow pulses, and capacity-bar segments. Selection anywhere lights everywhere."* TRACE adds two
members to that set — the **flow-row left rule** and the **pipe-bar segment**. Hue assignment is
deterministic: index by position in `session.contracts` into
`[--cyan, --amber, --green, --violet, --faction-blue, --orange]`.

Single source of truth: one module-level `selectedFlowId: string | null` in `main.ts`, written by the
flow board, the orrery pick, the WIRE's click-to-fly and the fleet chips; everything else reads it.
No event bus — the panel reports clicks through a narrow `TraceActions` interface, exactly like
`MissionTopActions`.

### 5.2 Mouse

| gesture | table | orrery |
|---|---|---|
| hover flow row | 6 % cyan wash + left rule brightens (`.clickable` idiom — a *position* channel) | that path + region fill brighten |
| click flow row | selects + expands; previous collapses | traced path full-bright with hop pips; others to 0.35 alpha; region disc rings. **Camera does not move** |
| click the PATH cell's pipe name | scrolls its pipe row in, `.sel` | selects the sat; existing coverage blob draws |
| hover a rider line | that bar segment brightens, siblings to 40 % | only that contract's path + particles light |
| hover the Σfloor notch | tooltip `promised 4.60 u of a 4.00 u pipe` | — |
| hover a pipe row | left rule on every flow riding it — **this is how you see who a re-beam would un-serve, before clicking** | that sat haloes; its cone brightens; its paths light |
| hover a loss-roll line | timestamps brighten | **dashed ghost segment** drawn between the two named nodes for the hover's duration |
| click `REPOINT` | opens the target picker (§6.1) | cone swings on commit |
| click `SHORT` / `SPREAD` | the stop inverts | path animates to the new pipe if the pick moves (§6.2) |
| click a NODES line | selects the sat | sat frames its pulse / telegraph ring |
| click `⌖` (row's right edge) | — | **the only affordance that flies the camera** |
| drag a row onto a pipe, or drag a path on the globe | nothing moves; the head shows one fact line for 4 s | — |

That last row matters: a cold player's first instinct on a routing screen is to hand-route. The game
answers with a fact about its own model, not a refusal —
`the solver picks the path from what can close — you shape what it can pick from.`

### 5.3 Keyboard

**Stage A adds no global key.** Stage B adds exactly one: `3` for the TRACE desktop — which touches
four unlinked places (`src/main.ts:3324`'s `if (k === "1" || k === "2")` **inside a net branch that
ends in an unconditional `return`** — this exact structure already hid the `C` shortcut for a whole
release; `NET_PRESET_SPECS`; `NET_RAIL_PANELS`; and the status-strip legend at
`src/panels/status.ts:109`, the **only** lawful home for a control instruction). No arrow-key row
cursor: it is new focus machinery in a codebase with zero focus management and `*:focus{outline:none}`,
and the screen is fully usable with the mouse. If it is ever added it goes behind the three-way guard
(pad closed AND `shell.focusedHost === "trace"` AND no input focused) and into `fuzz.mjs`'s `KEYS`.

### 5.4 Audio — a real second channel, not a notification system

The engine already has a `NET_CUES: Record<NetCueKind, Recipe>` book (`src/audio/engine.ts:14`), so
adding a kind is a union entry plus a recipe — cheap, verified. Existing cues reused:
`prefer_reroute` (a prefer applied), `fault_amber`, `fault_telegraph`, `serve_locked`,
`foul_brewing`, `key_click`.

Three additions, all edge-triggered from state transitions in `main.ts`, never per frame:

1. **`link_lost`** — a new loss stamp lands in the roll. The §8 "terse alert blip".
2. **`rider_starved`** — a rider crosses under its floor. Distinct pitch: the *someone is starving*
   sound, and the only one that fires before anything goes dark.
3. **`beam_committed`** — a re-beam lands. The commit tone.

And the one §5 actually asks for, which two of three designs nominated as a scope cut and which is
therefore specified here as **not** optional: **the health bed already detunes under strain**
(`src/audio/engine.ts`, shipped X-05). TRACE's contribution is to make the bed track **max pipe
utilisation** rather than only fault state, so "a smoothly-running network sounds different from a
congesting one" is true continuously. One line in the bed's drive input.

---

## 6. The levers

Cost order (m1-redesign §2.6): **re-beam (free) → prefer weights (free) → overclock (risky) → aimed
relief launch (capex).** The two free levers live on this screen. Overclock and the pad do not: capex
is MISSION's verb.

### 6.1 RE-BEAM — repoint an antenna

- **Invoked:** the `[ REPOINT ]` button on a pipe row, or the pipe cell on a flow's path line.
- **Not a blind cycle.** `r1CycleBeam` (`main.ts:2188`) rotates through targets with no visible
  order; on a screen where the act un-serves someone, that is a footgun. TRACE opens a **target
  picker**: one line per live demand region plus `stow`, each showing what that region currently
  carries and whether this pipe's link to it **closes right now** —
  `polar metro · dark 2:05 · link closes` / `equatorial transit · carrying 0.90 u · no line of sight`.
  Present-tense facts, no preview of the resulting allocation.
- **Action:** `netAssignBeam(satId, slotIdx, regionId, clock.tick)` → `applyAndRecordNetAction` →
  `applyNetAction` → `session.assignBeam`. **Never call the session mutator from a click handler** —
  `assignBeam` clears the router cache and stamps `lastPlayerTopoActionS`, which feeds a folded gate
  witness. Pre-flight disabling uses the pure `validateBeamAssign(sats, satId, slotIdx, regionId)`.
- **What the player sees:** the cone swings; the commit tone fires; **one frame later** the dropped
  rider's segment vanishes from the bar, its particles gutter on the globe, and its name appears in
  the DARK band with a `dark 0:00` clock starting. The cost of the decision, measured, in the same
  eye-line. Beam reassignment is a topology change, so the router genuinely re-solves.

### 6.2 PREFER — re-bias a flow (M1 §7.3's "first thing the player tunes")

- **Invoked:** `[SHORT][SPREAD]` on the flow row and on the rider line. **Same verb, same action,
  same selectors as MISSION's tender rows** (`data-net="route-short"|"route-spread"` +
  `data-contract`) — reconciled, not tripled. `onRoute(contractId, pos)` → `netSetPrefer` →
  `KIND_NET_SET_PREFER`, `pos` 0 = shortest hop, 0.5 = spread off congestion.
- **Two stops, not three.** `w_stab` multiplies a hard-zero term (`router.ts:204`, pinned by
  `traffic-class.test.ts`), and its slider stop works in M1 only by leaning `w_lat` down to 0.2.
  **A control whose end does nothing measurable, on a screen whose entire claim is that its numbers
  are true, is the sharpest LAW-1 risk in this design.** The control is present (canon's
  requirement); the dormant term is simply never claimed. Reasoning goes in a code comment so it is
  not relitigated.
- **`preferSliderPos` is a lossy inverse** — used only to decide which button carries `.active`,
  never round-tripped into stored weights.

### 6.3 The reroute preview — what it is, and what it is not `▸ LOCKED`

**There is no pre-commit reroute preview.** No "prefer-bw would move this to NET-SAT-4 and hold". No
second `bridgeForPoint` call with alternative weights rendered as a suggestion. No ranked candidate
list with costs (`bridgeForPoint` discards every rival's cost and margin anyway, `router.ts:199-216`).
That was the condemned SD-44 pattern and it is a LAW-1 violation: solved answers before commit.

**What ships in its place, in two halves:**

**(a) The candidate read — pre-commit, and lawful because it is geometry, not a solve.** Selecting a
flow or pipe draws a dashed `--violet` arc for every *other* serving pipe whose link to that region
closes this frame, and the row prints the count as a fact: `2 pipes reach this region` /
`one pipe reaches this region`. This is the honest answer to the §7.3 ceiling example being a no-op
whenever only one pipe can reach — which is most of Acts 1–2. **Without it the canonical "first
thing the player tunes" reads as a broken button**, and a control that silently no-ops teaches the
player the game is broken. It never says which one the solver would pick.

**(b) The re-route event — post-commit, and this is where the animation budget goes.** When a flow's
`solve.pipe` changes: the path polyline animates from old arc to new over ~500 ms, the existing
white-hot `rerouteAge` flash fires, the `prefer_reroute` cue lands with it, and the row's path cell
shows `NET-SAT-4 · ACCESS-L ← NET-SAT-2 · GATEWAY` for 600 ms. GDD §8: *"a dropped backbone link and
its re-route are a colour event, not a log line."* The player flips a stop and **watches** — which
costs them nothing (the flip is free and instantly reversible) and buys the game its honesty.

### 6.4 The success moment

Every failure state on this screen is specified in detail; recovery is what makes a player come back,
so it is specified too. When a flow leaves DARK: the `⌗` glyph flips `✕`→`·` with a one-frame invert
(hard-edged, no fade — house style); the row **falls through the ranking with the `↓` glyph held
400 ms**; the head census recounts; `serve_locked` fires; the particles resume on the globe and the
bar segment reappears. When a rider comes back over its floor, `✕ STARVED` → `✓` and the pipe's
`· STARVING` suffix drops.

---

## 7. The predictability seed

M1 §7.5 makes this **REQUIRED in M1 even though prediction is not**: *"the trace/diagnostic view
stamps every link loss with its geometric cause and time — `link SAT-7↔SAT-12 lost: SAT-12 set below
horizon at 14:32`. A time, a cause: geometry, not gremlins."*

### 7.1 Where it lives, and why it is not a duplicate of the WIRE

The WIRE already prints link losses chronologically, de-duped on `${aId}|${bId}|${cause}` with `atS`
**deliberately dropped** so a persistently-down link logs once (`main.ts:1379-1389`). That policy is
right for a log and fatally wrong for the seed: the seed's whole purpose is that the player can *see
the periodicity*, which requires the **repeats and their spacing**. So TRACE keeps its own roll with
a different retention policy — grouped by `(aId, bId, cause)`, retaining up to 8 `atS` values:

```
LOSSES · BY LINK · geometry and the mission clock
REGION-1 ↔ GROUND-1    set below the horizon   ×9   08:09 · 10:19 · 12:29        ~2m10s
REGION-2 ↔ NET-SAT-2   out of link budget      ×4   10:33 · 11:36 · 12:38        ~1m02s
```

- **Causes are phrased, never enum'd.** `renderLossStamp` ships `set_below_horizon` and raw seconds
  (`at 137.5`); it stays as the test/debug formatter and **never reaches a player again**.
- Times are `mm:ss` mission-elapsed; timestamps ride the `warmthOf` freshness ramp so an old stamp
  reads visibly cooler, desaturating toward `--grey` — §8's saturation channel, wired correctly and
  honestly rather than padded with invented data.
- **The observed mean interval `~2m10s` renders only at ≥3 stamps**, and it is a measured property of
  what already happened. The even spacing *is* the LEO period (150 s). Nothing on screen says so.

### 7.2 What is deliberately absent `▸ LOCKED`

**No forecast. No "next loss: 14:32, in 6m". No countdown to a set. No "route around it ahead of
time" affordance.** That is the post-M1 discovery beat, and the capability-discovery template is
verbatim *"operate → hit a wall → investigate the wall in a diagnostic view → recognize the pattern →
the tool that scales past the wall surfaces there."* Printing the forecast here burns the a-ha the
seed exists to grow. The elevation cell (`7.2° / 5.0° gate`) is a present-tense fact, not a
prediction; the trend arrow is the sign of a derivative over 30 frames, never a time-to-event.

### 7.3 How it is measured

The falsifier is behavioural (player-attack Adjustment 11): *does a tester name the periodicity
before any forecast appears?* `window.__trace()` exposes the roll's grouped counts and observed
intervals so a scene can assert the evidence was on screen and readable — the claim being tested is
about a number the probe must expose.

**Honest limitation, carried openly:** the roll is render-only and resets on reload. On restore it is
**seeded from `session.trace.losses`** where available, and the empty case renders as **absence** —
never as `×1`, which would imply a link had dropped once when it had dropped nine times.

---

## 8. LAW 1 / LAW 2 — every string the screen can render

All player prose lives as exported consts in `src/panels/copy.ts` (never in `main.ts`, which is
outside the lint). Functions receive **pre-formatted display strings** and never format numbers
themselves — house convention.

| # | string | kind | why it is lawful |
|---|---|---|---|
| 1 | `WHAT BINDS · 5 flows` | census | a count of rows |
| 2 | `2 dark · 1 tight · 2 clear · as of 12:41` | census | counts of present-tense states + the snapshot time |
| 3 | `held at 12:41 · paused` | state | the sim is frozen and the readout says so |
| 4 | `corridor metro`, `equatorial metro ⟲1` | identity | `Contract.label` + the generation off `Contract.id` |
| 5 | `LATENCY ✕` / `bw` | measurement | `SolveResult.bindingConstraint`, or the argmin over active axes; caps = the router's own verdict on a solve that ran |
| 6 | `4.6 ms / 3.0 ms budget  (153%)` | measurement | `solve.latencyS` vs `Contract.slaLatencyS` and their ratio |
| 7 | `0.53 / 0.60 u  (88% of floor)` | measurement | the router's own fair-share expression vs `slaBandwidth` |
| 8 | `96.2% held / 99.0% asked` | measurement | `Contract.lastAvailability` vs `slaAvail` |
| 9 | `7.2° / 5.0° gate` | measurement | `evaluateLink(...).elevationRad` vs the 5° floor |
| 10 | `via NET-SAT-2 · GATEWAY → GROUND-0` | measurement | `solve.path` + `sat.loadout[slot].type` |
| 11 | `4.60/4.00 u OVER` | measurement | live load vs effective capacity; `OVER` restates `≥1.0` |
| 12 | `Σfloor 4.60 u > 4.00 u pipe` | measurement | a sum of committed floors vs a capacity |
| 13 | `✕ STARVED 94%` | measurement | restates `share < floor` with both operands on the line |
| 14 | `⑂×3`, `2 pipes reach this region` | measurement | counts of live geometry |
| 15 | `dark 0:47` | measurement | elapsed since `served` went false |
| 16 | `out of link budget at 12:38 (×4, ~1m02s apart)` | record | stamps that happened, their count and observed mean spacing |
| 17 | `bleeds €2,400/hr while dark` | measurement | `penaltyPerSecond × 3600`, the contract's own signed terms |
| 18 | `NET-SAT-2 DEGRADED (lowOrbit) capacity ×0.50 · recovers in 0:12` | measurement | `FaultState` fields |
| 19 | `4.6 ms carried against a 3.0 ms budget — a shorter LEO or relay route cuts it.` | **post-hoc diagnosis** | LAW 1's own carve-out: *"solved diagnoses exist only post-hoc, about a network that actually ran — earned, after the wound."* The solve already failed. Names a *class* of geometry, not a control |
| 20 | `no sat covers it in this window — one more phased in this plane holds it across the gap.` | post-hoc | §7.4's own register: named binding quantity → kind of hardware/positioning |
| 21 | `a parallel path or a wider antenna carries it` | post-hoc | ditto; replaces the shipped `set prefer-bw on X`, which names a control |
| 22 | `3 pipes idle · 4.10 u parked` | measurement | a count and a sum |
| 23 | `nothing is carrying traffic yet — a signed tender and a bird in view make the first row.` | goal | names a want, no control |
| 24 | `no bridge — nothing in view closes the link` | measurement | `bridgeForPoint` returned no sat |
| 25 | `polar metro · NO LINE OF SIGHT` | measurement | the pipe is aimed and the link does not close |
| 26 | `· floodlight ·` / `one relay, no alternative` | measurement | BROADCAST has no aim; Mars has one relay. **A disabled control always states its reason** |
| 27 | `one-way light 15m 25s — the answer is already old when it lands.` | measurement | the Mars leg's own delay |
| 28 | `paths hold until the geometry moves · load is now` | model statement | states the sim's re-solve split |
| 29 | `capacity in units · one unit is roughly one region's baseline demand` | definition | defines the unit once |
| 30 | `the solver picks the path from what can close — you shape what it can pick from.` | model statement | the hand-route answer; §4.3a's own words |
| 31 | tooltips: `elevation of the sat above this endpoint's horizon; below 5° the link does not close` · `one antenna — everything riding it shares its capacity in proportion to offered load` · `SHORT chases the lowest-latency pipe; SPREAD leaves a congested pipe for a parallel one` | fact | all fact-form; the last is MISSION's shipped string verbatim |

**Absent by law:** `WILL SERVE`, `NEED N`, `HOLDS ✓`, `RECOMMENDED`, `BEST`, any pre-commit
servability claim, any reroute preview, any achievable-optimum column, any forecast, any
€-per-unit-of-capacity, any redundancy verdict not backed by the honest check (§9.2).

**Mechanics, all mandatory:**
- **`src/panels/trace.ts` MUST be added to the `FILES` array in `src/panels/copy-lint.test.ts:25-45`**
  ("Add new panels HERE"). A new panel file is silently unlinted until that line exists — "the lint
  passes" is otherwise zero evidence.
- **Add `../sim/net/trace.ts` to the lint's `SIM_FILES`.** It today ships the player-visible,
  unlinted control reference `set prefer-bw on {label}` straight into `SYSTEM.LOG`.
- **Zero hex literals** in `trace.ts` (FL-02; the allowlist is empty and may only shrink). Bars are
  DOM divs with token-backed classes (`.hue-0`…`.hue-5`, defined in `style.css`), never inline
  styles, never canvas — so no `getComputedStyle` token dance.
- Watch two regexes in particular: `/\b[A-Z]{2,}\s+button\b/` (never write "the REPOINT button", even
  in a tooltip) and `/\bclick\s+(the\s+)?[A-Z]/`. LEDGER·FLEET's beam tooltip is the safe pattern:
  gerund, no capitalised control name.
- **Delete the pre-existing lint hole while here:** `src/panels/howto.ts` still contains
  *"On ROUTING (3) read the LINK·LOAD allocation ledger … PREFER bandwidth to reroute"*, which slips
  only because the desktop-number regex is case-sensitive on lower-case `on`. That panel is retired;
  the string goes with `link-load.ts`.

**Monochrome-purist (`M`) exit check** — every distinction doubled: utilisation = bar width + integer
% + the word; starvation = `✕` + `STARVED` + both operands; antenna type = glyph + type name; rider
identity = segment order + dither density + inline tag + the label on the line; fault = glyph + word
+ numeral; selection = `▾`/`▸` + inverted fill; band = `✕`/`▲`/`·` + caps-vs-lowercase BINDS; traced
vs dimmed on the globe = brightness and dash pattern, not hue. Asserted in `tools/scenes/mono.mjs`,
one assertion per row of that list.

---

## 9. Data contract

### 9.1 The per-frame projection (real TypeScript)

One pure function `traceState(): TraceState` in `src/main.ts`, painted in the existing `panels` perf
section beside `missionTopState()`. **Zero new sim state. `NetSnapshot` is untouched. The replay
golden does not move.** The panel holds no sim state; it renders what it is handed.

```ts
// ── src/panels/trace.ts — the state the panel renders (display units only) ─────────

export type FlowBand = "dark" | "tight" | "clear";
export type SlaAxisTag = "conn" | "avail" | "lat" | "bw";

/** The measured/promised pair every row leads with (§4.5). Nulls render as "—". */
export interface AxisRead {
  axis: SlaAxisTag;
  carried: string;        // "4.6 ms" · "0.53 u" · "96.2%" · "7.2°"
  asked: string | null;   // "3.0 ms budget" · "0.60 u" · "99.0% asked" · "5.0° gate"
  ratioPct: number | null;// 153 · 88 · null (availability needs no ratio)
}

export interface TraceHop {
  node: string;           // "REGION-2 · corridor metro" | "NET-SAT-2 · GATEWAY" | "GROUND-0"
  kind: "origin" | "relay" | "ground";
  legMs: number | null;   // null on hop 1
  cumMs: number;
  elevDeg: number | null;
  distKm: number | null;
}

export interface TraceRider {
  contractId: string;
  label: string;
  hue: number;            // 0..5 — index into the identity-hue token list
  classTag: SlaAxisTag;   // "lat" | "bw" | "avail"
  offer: number;
  share: number;
  floor: number | null;   // null ⇒ bandwidth axis inactive ⇒ no flag
  flag: "ok" | "tight" | "starved" | "none";
  sharePctOfFloor: number | null;
  preferShort: boolean;   // which stop is .active
}

export interface TracePipe {
  pipe: string;                       // "NET-SAT-2:1" — data-pipe only, never displayed
  satId: string;
  slotIdx: number;
  displayId: string;                  // "NET-SAT-2 · GATEWAY" (+ " a"/" b" when ambiguous)
  typeGlyph: "✳" | "◆" | "●" | "○";
  targetLabel: string | null;         // region LABEL, null ⇒ unaimed
  floodlight: boolean;                // BROADCAST
  blind: boolean;                     // aimed, no line of sight
  load: number;
  capNominal: number;
  effCap: number;                     // capNominal × degradation factor
  derated: boolean;
  util: number;
  state: "headroom" | "tight" | "over" | "idle" | "blind";
  sumFloor: number;
  overPromised: boolean;              // sumFloor > effCap
  riders: TraceRider[];               // bar segment order == this order
  sickSatId: string | null;
}

export interface TraceFlow {
  contractId: string;
  label: string;
  generation: number;                 // 0 = original; 1+ renders "⟲N"
  hue: number;
  band: FlowBand;
  rankDelta: -1 | 0 | 1;              // drives the 400 ms ↑/↓ glyph
  bindsAxis: SlaAxisTag | null;
  bindsIsRouterVerdict: boolean;      // caps + ✕ vs dim lowercase
  read: AxisRead;
  trend: -1 | 0 | 1;
  staleSolve: boolean;                // ◷ — resolveTick returned a cached result
  servedBySickSat: boolean;           // †
  // path line
  pipe: TracePipe | null;             // null ⇒ no bridge, or Mars
  pathNote: string | null;            // "no bridge — nothing in view closes the link" | Mars note
  groundId: string | null;
  shareCount: number;                 // ⑂×N (0 or 1 ⇒ no glyph)
  candidateCount: number;             // other pipes whose link to this region closes NOW
  preferShort: boolean;
  preferEnabled: boolean;             // false on Mars — with a stated reason
  preferDisabledReason: string | null;
  rerouteFrom: string | null;         // 600 ms "← NET-SAT-2 · GATEWAY"
  // why-now line
  darkForS: number | null;
  lastLoss: { causeText: string; atText: string; count: number; intervalText: string | null } | null;
  penaltyPerHrText: string | null;    // dark rows only
  // the binding line (collapsed row, dark only)
  bindingLine: string | null;
  bindingSeverity: "bind" | "note";   // "!" vs "?"
  // expansion
  expanded: boolean;
  hops: TraceHop[];
  geometryAsOf: string | null;        // "as of 12:38" when the solve is stale
  lossesForFlow: TraceLossGroup[];
}

export interface TraceLossGroup {
  key: string;                        // "aId|bId|cause" — data-link
  aId: string;
  bId: string;
  causeText: string;                  // phrased, never the enum
  count: number;
  times: string[];                    // mm:ss, oldest→newest, ≤8
  intervalText: string | null;        // "~2m10s", only at ≥3 stamps
  ageWarmth: "good" | "watch" | "warn" | "dead"; // warmthOf on the newest stamp
}

export interface TraceNode {
  satId: string;
  glyph: "~" | "◌" | "⚠" | "✕";
  kindWord: string;                   // "DEGRADED" | "TRANSIENT OUTAGE" | "FAILURE WARNING" | "HARD FAILURE"
  cause: string;                      // FaultCause
  detail: string;                     // "capacity ×0.50 · recovers in 0:12" | "fails in 0:31"
  carryingCount: number;
}

export interface TraceState {
  mounted: boolean;                   // false ⇒ panel early-outs (hidden-tile perf gate)
  paused: boolean;
  asOfText: string;                   // "12:41"
  counts: { dark: number; tight: number; clear: number };
  flows: TraceFlow[];
  clearCollapsed: number;             // >0 ⇒ CLEAR band summarised
  pipes: TracePipe[];
  idle: { count: number; parkedUnits: number; expanded: boolean };
  losses: TraceLossGroup[];
  nodes: TraceNode[];
  selectedFlowId: string | null;
  handRouteNote: string | null;       // the 4 s fact line after a drag attempt
}

export interface TraceActions {
  onSelectFlow(contractId: string): void;
  onSelectPipe(pipe: string): void;
  onRoute(contractId: string, pos: number): void;          // reuses MissionTopActions' verb
  onRepointOpen(satId: string, slotIdx: number): void;
  onRepointPick(satId: string, slotIdx: number, regionId: string): void; // "" = stow
  onFlyTo(contractId: string): void;
  onHoverLoss(key: string | null): void;                   // drives the ghost link
  onHoverPipe(pipe: string | null): void;
  onToggleIdle(): void;
  onHandRouteAttempt(): void;
}
```

### 9.2 Existing accessors it reads (all pure, all per frame)

`session.contracts` · `session.sats` · `session.grounds` · `session.beams` · `session.faults` ·
`session.nowS` · `session.lastSolveFor(id)` · `session.pipeCapacity(pipe)` · `session.contractById(id)` ·
`Contract.{label,id,region,activeAxes,trafficClass,prefer,slaAvail,slaLatencyS,slaBandwidth,offeredLoad,lastAvailability,penaltyPerSecond,state}` ·
`SolveResult.{served,path,pipe,latencyS,bindingConstraint,losses}` ·
`AntennaSpec.{type,cardId,capacityUnits,eirp,rangeRefM}` ·
`FaultState.{satId,kind,cause,degradedCapacityFactor,failsAtS,recoversAtS}` ·
`telegraphedCountdownRemainingS` · `parsePipeKey` · `pipeKey` · `isServingType` · `validateBeamAssign` ·
`bridgeForPoint` · `evaluateLink` · `surfacePointRelative` · `surfaceNormalRelative` ·
`satPositionRelative` · `preferSliderPos` · `preferFromSliderPos` · `SLA_AXIS_ORDINAL` · `warmthOf` ·
`diagnose`.

**Derived in the projection, because the sim computes and discards them:**

| # | derivation | why | cost |
|---|---|---|---|
| D1 | `loadByPipe` map, built **once** at the top | No batched getter exists, and `session.loadOnPipe()` rebuilds the whole map on **every call** (`session.ts:991,1015`) — per-row calls are O(rows × contracts) | O(active contracts), one pass |
| D2 | pipe → riders reverse index | No such index exists | same pass |
| D3 | **fair share** = `shared <= effCap ? own : effCap * own / shared` | `router.ts:314` computes exactly this and **throws it away**; only the boolean breach survives. Use the identical expression or the table can disagree with the breach flag | O(1)/rider |
| D4 | **`effCap`** = `capacityUnits × (degradation ? degradedCapacityFactor : 1)` | Fixes a live divergence: `applyDegradationHaircut` scales *load* by `1/factor` into a throwaway map (`session.ts:1185-1202`) while `loadOnPipe` returns raw. `raw/(cap×f)` is algebraically the router's own ratio. Rendered visibly as `(4.00 ×0.50 SICK)` — derate seen, not silent | O(1)/pipe |
| D5 | `Σfloor` per pipe | the notch | trivial |
| D6 | per-leg `evaluateLink` (up: region point+normal → sat; down: ground point+normal → same sat, same antenna) | `SolveResult.latencyS` is the **sum**; `distanceM`/`elevationRad`/`received`/`cause` are discarded. Needed for the connectivity read and the geometry block | 2 calls per flow, **only when expanded or when connectivity is the binding axis** |
| D7 | **line-of-sight memo** `Map<satId, Map<regionId, boolean>>` | `ledgerFleetState` (`main.ts:2931`), the beam-sight code (`main.ts:1856`) and this panel all want it. **Hoist once per frame and share** — net cost is negative | one memo, fewer solves overall |
| D8 | **redundancy** — one `bridgeForPoint` per served flow **excluding the chosen sat** | the honest SPOF check (§9.3) | O(served flows) |
| D9 | `diagnose()` called **directly** with a hand-built `TraceInput` | `session.trace` is null until `enableFaults` fires (`session.ts:1234`); the board needs shortfall kinds from Act 1. The pure call adds no sim state — the sanctioned route | O(flows) |

### 9.3 What the sim must change — a short, honest list

Four changes, all pure, none folded, none moving the golden hash.

| # | change | file | cost | why it is not optional |
|---|---|---|---|---|
| **S1** | **`TraceInput` gains `loadByPipe?: ReadonlyMap<string,number>` and `capByPipe?: ReadonlyMap<string,number>`; `bindingConstraintMessage` and the over-provision threshold use the *pipe's own* capacity, falling back to `NET_LINK_CAPACITY_UNITS` only when absent** | `src/sim/net/trace.ts` | ~15 lines | **This is a shipping bug, not a display choice.** `bindingConstraintMessage` prints `capacity ${NET_LINK_CAPACITY_UNITS.toFixed(2)}` (1.50) while the router uses per-antenna capacity 1.2–4.0. A GATEWAY at 3.0 u is 75 % full to the router and "exceeds capacity 1.50" to the trace. Two surfaces would state different capacities for the same antenna, adjacent, on one row. §4.12: a record that lied would make analysis worthless. The fallback keeps every existing test green |
| **S2** | reword the bandwidth tail from `…add a parallel path or set prefer-bw on {label}.` to `…add a parallel path or a wider antenna.` | `src/sim/net/trace.ts` | 1 line | `set prefer-bw on X` names a control and leaks solver-parameter vocabulary at the player. **`trace.test.ts:177` pins `/parallel path|prefer-bw/i` — "parallel path" survives, so the pin holds.** Add `../sim/net/trace.ts` to the lint's `SIM_FILES` in the same commit |
| **S3** | **`TraceInput` gains `redundantById?: ReadonlySet<string>`**; the SPOF face uses it when present and falls back to the `sats.length <= 1` heuristic when absent | `src/sim/net/trace.ts` | ~6 lines | `trace.ts:282`'s check is literally `sats.length <= 1`. On a 12-sat fleet where exactly one bird reaches a region — **the commonest real SPOF** — it is silent. An under-firing risk warning is worse than none. The projection computes the set with D8; the session's own call passes nothing and is byte-unchanged |
| **S4** | `FIX_CLAUSE: Record<ShortfallFixKind, string>` exported | `src/sim/net/trace.ts` | ~8 lines | The binding line composes panel-side numbers with a canonical fix clause, so the sentence can never drift from the numbers above it. Values in §8 rows 19–21 |

**Explicitly NOT added to the sim:** no new folded field, no `session.pipes` getter, no served-bandwidth
field on `SolveResult`, no history ring, no candidate list. Everything else is derived in the render
layer, which is where it belongs (GDD §6, `purity.test.ts`).

### 9.4 Render-only state in `main.ts` (module scope, not folded, not in the vault)

Precedent: `netLinkLastSat` / `netLinkReroute` (`main.ts:1753-1756`) and the documented
"`lastTrace` is NOT folded" note (`session.ts:467-469`).

| state | shape | size |
|---|---|---|
| `traceLossRoll` | `Map<"aId\|bId\|cause", number[]>`, ≤8 × ≤12 — **keeps `atS`**, unlike the WIRE's dedupe | ~100 numbers |
| `traceDarkSince` | `Map<contractId, number>` | ≤10 |
| `traceRank` | `Map<contractId, number>` — hysteresis | ≤10 |
| `traceTrend` | `Map<contractId, number>` — headroom sampled every 30 frames | ≤10 |
| `traceReroute` | `Map<contractId, {from: string, age: number}>` | ≤10 |
| `tracePrevUtil` | `Map<pipeKey, number>` — audio edge-triggering | ≤60 |
| `selectedFlowId` | `string \| null` | 1 |

**Renewal boundary** (`renewalOffer` mints `REGION-0+R1` while `region.id` stays `REGION-0`): when a
contract completes and a new one appears with the same `region.id`, the loss roll, the dark clock and
the selection **carry across**, and the row renders `⟲N`. Otherwise the selection clears to `null` —
it never dangles at a dead contract.

### 9.5 Performance `▸ LOCKED`

- **Hidden-tile gate:** the projection returns `{ mounted: false }` when
  `!shell.visibleHosts().includes("trace")`, and the panel early-outs. Panels render every frame even
  when hidden; without this, TRACE becomes a permanent tax on MISSION.
- **Hoist first, build second:** the `loadByPipe` map and the LOS memo are hoisted in their own
  commit (P0) and shared with `netServedLinksSlice` — which today calls `session.loadOnPipe()` once
  per served contract, each call rebuilding the entire map. That is an existing O(n²) in the shipping
  build; the routing screen must not compound it.
- **Never per row:** `session.snapshot()` (deep copy), `windowAvailability()` (32 full point-served
  solves — read `Contract.lastAvailability` instead), `session.loadOnPipe()`.
- **`lastAvailability` is only written when the availability axis is active** (`session.ts:975`, after
  an early return). Read it only when `activeAxes.has("availability")`; otherwise the field is stale
  or never initialised.
- **Budget:** `traceState()` p95 ≤ **1.5 ms** in the `panels` bucket, against the p95 < 16.6 ms frame
  gate in `tools/scenes/perf.mjs` at 1000×. Measure with `window.__perf()` before and after every
  phase.
- **Churn:** add `window.__panelChurn()` (rebuilds/sec per panel) and gate at **< 1 rebuild/sec at
  30× with 6 flows**. Otherwise "the sig-based no-churn idiom survives escalation" is an assertion,
  not a fact.

### 9.6 Testability

- **Stable selectors:** `[data-net=trace-flow][data-contract]`, `[data-net=trace-pipe][data-pipe]`,
  `[data-net=trace-rider][data-contract][data-pipe]`, `[data-net=trace-loss][data-link]`,
  `[data-net=trace-node][data-sat]`, `[data-net=repoint][data-sat][data-slot]`,
  `[data-net=repoint-pick][data-region]`, `[data-net=trace-fly][data-contract]`,
  `[data-net=idle-expand]`, plus the **reused** `[data-net=route-short|route-spread][data-contract]`.
- **Read-out classes** scenes assert textContent on: `.trace-head`, `.trace-flow`, `.trace-binds`,
  `.trace-read`, `.trace-path`, `.trace-whynow`, `.trace-binding`, `.pipe-id`, `.pipe-load`,
  `.pipe-pct`, `.pipe-state`, `.pipe-floor-notch`, `.rider-nums`, `.rider-flag`, `.roll-row`,
  `.trace-node`, `.pipes-idle`.
- **Probe:** `window.__trace()` → `{ counts, order: [{id, band, bindsAxis, carried, asked}],
  pipes: [{pipe, effCap, load, sumFloor, riders:[{id, offer, share, floor, starved}]}],
  roll: [{key, count, times, meanGapS}], candidates: {contractId: n} }`. It must expose the
  **ordering** and the **observed periodicity numbers** — those are exactly the Adjustment-11
  falsifier's subject.
- **Unit tests, not just a scene.** The pure arithmetic is extracted into
  `src/panels/trace-derive.ts` (fair share, `effCap`, `Σfloor`, band assignment, sort + hysteresis,
  loss-roll grouping + mean gap, generation parsing) and tested headlessly in vitest. **This is the
  cheapest correctness insurance available, and its absence is how the retired LinkLoad shipped with
  both the region-id key collision and the wrong capacity denominator.**

---

## 10. Build plan

Each phase is independently shippable, ends green on `npm test && npx tsc --noEmit && npm run build
&& npm run smoke && node tools/playtest.mjs`, and updates `backlog.md` + `decisions.md` in the same
commit.

### P0 · Sim truth + the hoist (no UI)
- **Files:** `src/sim/net/trace.ts` (S1–S4), `src/sim/net/trace.test.ts`,
  `src/panels/copy-lint.test.ts` (`SIM_FILES` += `../sim/net/trace.ts`), `src/main.ts` (hoist
  `loadByPipe` + the LOS memo; route `netServedLinksSlice` and `ledgerFleetState` through them).
- **Falsifier:** a unit test proves a GATEWAY pipe at 3.0 u reports 75 %, not "exceeds capacity
  1.50"; a unit test proves the SPOF face fires on a 3-sat fleet where one bird reaches the region
  and stays silent when two do; `__perf()`'s `panels` p95 does **not** rise; the net golden hash is
  **unchanged** (nothing folded).

### P1 · The flow board (rail-summonable panel, no preset, no key)
- **Files:** new `src/panels/trace.ts` + `src/panels/trace-derive.ts` + `trace-derive.test.ts`;
  `src/style.css` (`.trace-*`, `.hue-0..5`); `src/panels/copy.ts` (all §8 strings);
  `src/panels/copy-lint.test.ts` (`FILES` += `trace.ts`); `src/main.ts` (`traceState()`, registry,
  the MISSION shortfall click-through); `src/wm/window-rail.ts` (`NET_RAIL_PANELS`);
  `src/wm/window-rail.test.ts` (**add the missing net-side coverage assertions** — the existing test
  pins cache mode only, so a net host with no rail button passes `npm test` today).
- **Ships:** head census, `status()`/`subtitle()`, the three bands with hysteresis, `CARRIED/ASKED`,
  the path line, the why-now line, the binding line on the collapsed row, the prefer lever, the
  empty state, Mars, pause.
- **Falsifier:** new `tools/scenes/trace.mjs` at `?netact=3` — summon TRACE, assert ≥1 DARK row whose
  **binding sentence is visible without any click**; assert the band order; assert the row order does
  not change across 200 frames of steady state; assert the head census matches `__trace().counts`;
  zero console errors.

### P2 · The contention ledger, the loss roll, re-beam
- **Files:** `src/panels/trace.ts`, `trace-derive.ts`, `src/style.css`, `src/main.ts` (the loss roll
  ring, the dark clock, the repoint picker wiring; **remove the shortfall drain at `main.ts:1366-1378`
  and halve the loss drain at `1379-1390`** so the WIRE keeps only the *first* occurrence per
  `aId|bId|cause`), `tools/scenes/{act1,hour}.mjs` (**WIRE expectations must be updated here — two
  WIRE behaviours change at once and `npm test` will not catch it**).
- **Falsifier:** `share === effCap*own/shared` for every over-cap pipe (asserted against `__trace()`);
  a `✕ STARVED` rider exists at act3a; the Σfloor notch pins right when `Σfloor > effCap`; the roll
  shows ≥3 stamps on one link with mean gap within 10 % of 150 s; `REPOINT` changes the rider set
  within 2 s of sim time and the dropped rider appears in DARK; full `playtest.mjs` green.

### P3 · The globe coupling, faults, audio
- **Files:** `src/orrery/orrery.ts` (`tracedContractId`, hop pips, ghost link, candidate arcs,
  dashed unserved-with-path arcs), `src/main.ts` (render slice + the three cue edges + the bed's
  util drive), `src/audio/engine.ts` (`link_lost`, `rider_starved`, `beam_committed`),
  `src/panels/trace.ts` (NODES group), `tools/scenes/{trace,mono}.mjs`.
- **Falsifier:** hovering a loss row draws exactly one ghost segment and removes it on mouseout;
  a re-route fires exactly one `prefer_reroute` cue (not per frame); `M` leaves `STARVED`, `OVER`,
  the band glyphs and the three-rider bar attributable (asserted, not eyeballed); **arc colour is
  still driven by utilisation** (`orrery-net-mode.test.ts` unchanged and green).

### P4 · The TRACE desktop — GATED, ship only if P1–P3 playtest says the globe is too small
- **Files:** `src/wm/presets.ts`, `src/wm/presets.test.ts`, `src/main.ts` (key `3`; rename the
  `"ROUTING"` camera branch to `"TRACE"`; **delete the two dead `"OVERVIEW"`/`"CONNECTIVITY"`
  branches**), `src/panels/status.ts` (legend `1 2 3 desktops · …`), `tools/scenes/fuzz.mjs`.
- **Falsifier:** `presets.test.ts` validates the new grid; a rail button exists for every net preset
  host; `fuzz.mjs` sprays `3` with zero page errors; the M1-gate hour scene still passes.

---

## 11. Scope fences — explicitly NOT in this screen

| # | fenced | authority |
|---|---|---|
| 11.1 | **Laser terminals / Level-2 topology construction.** No optical-terminal inventory, no acquisition/tracking geometry, no construction UI, no cycle-robustness read; `LASER` stays greyed in the builder. **Amended (SD-57):** `CROSSLINK` is no longer inert — it is a live routing-graph edge — but it is still AUTO-MESHED, so there is no construction verb and it still never appears as a pipe row. | GDD §4.3a Scope honesty → **M4** |
| 11.2 | **BGP / peering / inter-operator anything.** No AS numbers, no peer or transit columns, no trust scores, no rival-operator hops, no "never route over Competitor X". One autonomous system: your own fleet. | M1 §7.6, §8; `backlog.md:172` → **M2+** |
| 11.3 | **`w_stab` / the instability term.** No instability value, no remaining-in-view-time, no third STABILITY stop on the prefer control. The term multiplies out to exactly 0 and is pinned so. | M1 §7.5 LOCKED; `router.ts:204`; `traffic-class.test.ts` |
| 11.4 | **Predictive routing.** No forecast column, no "next loss: 14:32, in 6m", no "route around it ahead of time". The stamped cause + time is here; the prediction is the post-gate a-ha. | M1 §7.5 → **M2+** |
| 11.5 | **Per-link cost overrides / the power-user terminal tier.** No `set latency-weight 100 on contract-7`, no text config, no per-link admin metric. M1 §7.5 requires "at least floor + basic ceiling"; the terminal tier is optional and is not built here. | M1 §7.3, §7.5 |
| 11.6 | **A hop-count column, a next-hop column, or anything FIB-shaped.** Still fenced. **But the premise changed (SD-57):** `path` is no longer always 3 nodes — a relayed route reads `via NET-SAT-2 · ACCESS-L ↗ NET-SAT-5 ↘ NET-SAT-8 · GATEWAY → GROUND-0`, which is exactly the growth the `via A · TYPE → B` grammar was chosen for. The PATH cell renders the real chain; what stays fenced is a hop-count/next-hop COLUMN. | M1 §7.1; SD-57 |
| 11.7 | **An achievable-optimum column.** "You got 73 %, the ceiling was 91 %" needs a solver mature enough to prove best-achievable. Log truthfully now; fabricate nothing. | GDD §4.12 Scope honesty → **M2+** |
| 11.8 | **A cost column.** The blend only engages when prefer is non-default **or** the load map is non-empty (`router.ts:153-158`); otherwise the router picks **max signal margin**. A "cost" number would be fabricated in Acts 1–2, and `NET_BANDWIDTH_CLASS_W_BW = 4.0e-4` would make it meaningless anyway. The screen prints the **terms** (latency, load/capacity), which are physics and always true. | `router.ts` |
| 11.9 | **A ranked candidate list with costs.** `bridgeForPoint` returns only the winner; every rival's cost and margin is discarded. Candidate *arcs* (geometry that closes) ship; candidate *rankings* (a solver-internal number that would also be a pre-commit hint) do not. | `router.ts:199-216`; LAW 1 |
| 11.10 | **Invented freshness data.** Freshness does not exist on Earth in M1. The saturation channel is wired and correct on loss-stamp ages and nothing else. | M1 §4.2, §8 |
| 11.11 | **A separate fault panel, ever.** Faults ride this view. | M1 §5.3 LOCKED |
| 11.12 | **A fourth net desktop.** If P4 ships, **TRACE is the last net desktop before the M1 gate.** Panel count freezes at orrery + mission-top + ledger-fleet + system-log + finance + parse + trace, minus the two dead files this deletes. | GDD §5, §9; player-attack Adjustment 13 |

**What this deletes:** `src/panels/link-load.ts` (absorbed — its `LinkLoadRow`/`LinkLoadShare` model
is the proven skeleton, ported as `TracePipe`/`TraceRider` with both known bugs fixed) and
`ROUTING·PREFER` inside `src/panels/net-planner.ts` plus `netPreferControl()` (`main.ts:1089-1119`,
including its second per-frame `bridgeForPoint` and its uniform-capacity math). Plus `howto.ts`'s
retired ROUTING string. **The surface displaces; it does not append.**

---

## 12. Risks, carried openly

| # | risk | mitigation | falsifier |
|---|---|---|---|
| R1 | **"It reads as a spreadsheet"** — the M1 gate's own named FAIL condition, and a table is one careless step from it. | Every row clicks into the world; both free levers sit on the rows; the sort is fixed and unreconfigurable; the bar segments are the same hues as the flow particles; the CLEAR band collapses past 5 rows. | A playtester reads the board and then does *nothing* on it. **If that happens, cut columns — `⑂×N` and the trend arrow first — never add a chart.** |
| R2 | **The prefer lever is a no-op whenever one pipe reaches a region** — most of Acts 1–2. | The candidate count is a fact on the row (`one pipe reaches this region`) and the candidate arcs make the absence spatial. | A tester who taps SHORT/SPREAD with one candidate says *"nothing happened"* rather than *"there's nowhere else"*. If the former, strengthen the absent-state (a dim fact line on the rider). |
| R3 | **The discovery/tutorial knife-edge** (player-attack §181): if the diagnostic does the comprehension, there is no discovery — only a tutorial with a detective theme; if it doesn't, nobody opens it. | The board shows raw pairs and lets the player read the periodicity; the pull comes from MISSION's clickable shortfall line, not from a more directive trace. | Behavioural, per Adjustment 11: does a tester open TRACE **before** a shortfall fires, and name the 2:30 periodicity **before** any forecast exists? `__trace()` makes both measurable. |
| R4 | **The loss roll dies on reload** and is not in the vault. | Seed from `session.trace.losses` on restore; render the empty case as **absence**, never `×1`. Folding it would move the golden hash for purely presentational history — not worth it. | Save mid-Act-3, resume, confirm the roll shows absence and refills, and that no row claims a count it cannot evidence. |
| R5 | **Two WIRE behaviours change at once in P2** (shortfalls removed, repeat loss stamps removed) and `npm test` cannot catch it — `act1.mjs`/`hour.mjs` assert on `.log-line .msg`. | Update both scenes in the same commit; run `node tools/playtest.mjs` in full. | Full playtest green, not `npm test` green. |
| R6 | **The act-3B gate witness must stay sim-side.** Removing the log drain is safe only because `traceSurfacedShortfall` is latched inside the session from its own `diagnose()` call. | Do **not** re-key it to "the panel rendered a shortfall row while visible" — that would make a folded gate depend on render state and on whether the player ever opened TRACE. Add a test asserting the witness fires with the panel unmounted. | The hour scene's gate ticks are unchanged at 24.0 / 661 / 938.4 / 968.4. |
| R7 | **Per-frame cost compounds** — `diagnose()` allocating fresh arrays, `evaluateLink` pairs, the redundancy `bridgeForPoint`, all on a panel that renders while hidden. | The hidden-tile gate; the hoisted maps; D6 restricted to expanded/connectivity rows; the 1.5 ms p95 budget. | `__perf()` `panels` p95 before/after each phase; `perf.mjs` still green at 1000×. |
| R8 | **DD-10's merge test is arguable** for the P4 desktop (TRACE's orrery at 0.56w vs MISSION's 0.60w). | This is exactly why P4 is gated and why the panel is designed to work rail-summoned. The design does not depend on the preset. | If a reviewer rejects the preset, nothing in P0–P3 changes. |
| R9 | **The idle-collapse rule could still let the ledger grow long** at a dozen sats (24 serving slots). | Collapse on **idle alone**, regardless of aim, with aimed-idle counted separately; CONTENDED always sorts first so the read is O(contracts), not O(sats). | A 12-sat act-3 save renders ≤ 6 pipe rows plus one summary line. |
| R10 | **Identity hues flatten in `cvd-mono`**, so segment attribution rests on convention. | Three channels: order, dither density, inline tag ≥20 % width. | `mono.mjs` asserts a three-rider bar is still attributable. |
| R11 | **Scope-creep magnet.** Every deferred system has an obvious-looking home on this board. | §11 is the fence. **Any addition to it requires a `decisions.md` entry, not a UI tweak.** | A PR adding a column without a decision record. |

---

## 13. `decisions.md` — ready to paste

```markdown
### SD-53 — THE ROUTING SCREEN: TRACE, a two-level flow/pipe table (supersedes the SD-44 ROUTING desktop)

**Status: ACCEPTED (design), 2026-08-19.** Full spec: `docs/routing-screen.md`. GDD §5 primary view #4
("the game's mtr") has been sim-truth and no view since the solver landed: `diagnose()` is fully
implemented in `src/sim/net/trace.ts` and `src/main.ts:1366-1390` drains all of it — every shortfall,
every `renderLossStamp` — into SYSTEM.LOG, which is exactly the "log line" GDD §4.3 forbids. Meanwhile
M1 §7.3's "first thing the player tunes" reaches the player only as MISSION's two-state ROUTE toggle,
with no surface that explains why moving it would help. SD-53 builds the missing view.

**The decision it serves:** "of everything short of its SLA right now — or closest to it — which do I
act on with a free lever, and which do I let bleed until the next launch?"

**Shape (the resolution of the three-vision workflow):** a TWO-LEVEL table, not one.
- **FLOWS** — one row per active contract (keyed `contract.id`, never `region.id`), ranked into three
  named bands DARK → TIGHT → CLEAR, each row showing the binding axis and the two raw numbers that
  decide it (`4.6 ms / 3.0 ms budget (153%)`), the real path (`via NET-SAT-2 · GATEWAY → GROUND-0`),
  the why-now line, and — **on the collapsed row, never behind a disclosure** — the §7.4 binding
  constraint + kind of fix. This is §5 #4's "pick a flow".
- **PIPES** — one row per serving antenna with every rider's fair-share against its committed floor,
  and **the Σfloor notch on the capacity bar**: the sum of promises, visible *before* the peak bites
  (M1 §4.3's explicit mandate for this surface).

**Six load-bearing calls:**
1. **No printed composite "margin" scalar and no headroom gauge.** The band ordering survives; the
   invented number dies. One bar semantic on the screen: fullness.
2. **No pre-commit reroute preview** (the condemned SD-44 pattern). Its lawful replacement is the
   *candidate read* — dashed arcs for every other pipe whose link closes **right now**, plus the count
   as a fact — and the *re-route event* after commit, with real animation budget.
3. **Arc colour stays utilisation.** `Orrery.utilColor` is pinned by `orrery-net-mode.test.ts`;
   contract identity hue rides the row rule, region fill, hop pips and bar segments instead.
4. **Two prefer stops, not three.** `w_stab` is hard-zero; a STABILITY stop that does nothing
   measurable is the sharpest LAW-1 risk on a screen whose claim is that its numbers are true.
5. **Panel first, desktop later.** `trace` ships rail-summonable with no preset and no `3` key; the
   TRACE desktop is P4 and gated on a playtest proving the full-height globe is needed.
6. **The unit `u` is defined on screen** and every axis pair carries its ratio percentage.

**Four sim changes (pure, unfolded, golden-neutral):** per-pipe capacity threaded into `diagnose`'s
bandwidth message and over-provision threshold (a real bug — a GATEWAY at 3.0 u is 75 % full to the
router and "exceeds capacity 1.50" to the trace); the `set prefer-bw on X` tail reworded (it names a
control) with `../sim/net/trace.ts` added to the copy-lint SIM_FILES; `redundantById` accepted so the
SPOF face stops resting on `sats.length <= 1`; and an exported `FIX_CLAUSE` map.

**Consequences:** `src/panels/link-load.ts` and `ROUTING·PREFER`/`netPreferControl()` are deleted
(absorbed); the shortfall drain into SYSTEM.LOG is removed and the loss drain halved to first-occurrence
only; `howto.ts`'s retired ROUTING string goes with them; `loadByPipe` and the line-of-sight solve are
hoisted into per-frame memos shared with `netServedLinksSlice` and `ledgerFleetState` (fixing an existing
O(n²)); net-side rail/preset coverage assertions are added to `window-rail.test.ts`, which today pins
cache mode only. Net panel count 6 → 7 hosts, two dead files deleted. **TRACE is the last net desktop
before the M1 gate.**
```

---

## 14. `backlog.md` — ready to paste

```markdown
### EPIC — SD-53 · THE ROUTING SCREEN (TRACE) · closes M1-SLV-3 / M1-SLV-4 / M1-SLV-5

> Spec: `docs/routing-screen.md`. Builds §5 primary view #4 as a two-level FLOWS/PIPES table plus its
> orrery coupling. Absorbs the retired LINK·LOAD + ROUTING·PREFER; removes the §4.3-forbidden drain of
> the diagnostic into SYSTEM.LOG. Panel-first (rail-summonable); the desktop is gated at RT-08.

- [ ] **RT-01** Per-pipe capacity into `diagnose` + the `prefer-bw` reword + trace.ts under the sim copy-lint — *S* · `▸ LOCKED (fixes a shipping contradiction)`: `TraceInput` gains `loadByPipe`/`capByPipe`; `bindingConstraintMessage` and `TRACE_OVERPROVISION_FRACTION` denominate against the pipe's own `capacityUnits`, falling back to `NET_LINK_CAPACITY_UNITS` when absent (existing tests stay green); tail becomes "…add a parallel path or a wider antenna." (keeps the `/parallel path/` pin); `../sim/net/trace.ts` added to copy-lint `SIM_FILES`. · Dep: none. · Verify: a GATEWAY pipe at 3.0 u reports 75 %; net golden UNCHANGED.
- [ ] **RT-02** Honest SPOF: `TraceInput.redundantById` + exported `FIX_CLAUSE` — *S* · replaces the `sats.length <= 1` heuristic when the caller supplies the set; the projection computes it with one `bridgeForPoint` per served flow excluding the chosen sat. · Dep: RT-01. · Verify: fires on a 3-sat fleet where one bird reaches the region, silent when two do; session's own call byte-unchanged.
- [ ] **RT-03** Hoist `loadByPipe` + the line-of-sight memo in main.ts — *S* · one map + one `Map<satId,Map<regionId,bool>>` per frame, shared by `netServedLinksSlice`, `ledgerFleetState`, the beam-sight code and the new projection. Fixes an existing O(n²) (`loadOnPipe` rebuilds the whole map every call). Add `window.__panelChurn()`. · Dep: none. · Verify: `__perf()` panels p95 does not rise; ideally falls.
- [ ] **RT-04** `src/panels/trace-derive.ts` + unit tests — *M* · pure: fair share, `effCap` under degradation, `Σfloor`, band assignment, sort + 0.05 hysteresis, loss-roll grouping + mean gap, renewal-generation parsing. Headless vitest. · Dep: RT-01. · Verify: `share === effCap*own/shared`; the sort is stable under a ±45 % load oscillation.
- [ ] **RT-05** THE FLOW BOARD — panel P1 — *L* · `src/panels/trace.ts` (+ `copy.ts` strings, `style.css`, `copy-lint.test.ts` FILES, registry, `NET_RAIL_PANELS`, net-side `window-rail.test.ts` assertions, the MISSION shortfall click-through). Head census, `status()`/`subtitle()`, three bands, CARRIED/ASKED, path line, why-now line, **binding line on the collapsed row**, prefer lever (reuses `onRoute`/`net_set_prefer`), empty state, Mars rule, pause read. · Dep: RT-03, RT-04. · Verify: `tools/scenes/trace.mjs` — a DARK row's binding sentence is visible with zero clicks; band order correct; no reorder across 200 steady frames.
- [ ] **RT-06** THE CONTENTION LEDGER + THE LOSS ROLL + RE-BEAM — *L* · pipe rows, segmented bar with the **Σfloor notch**, rider lines with STARVED/TIGHT flags, idle summary, the grouped loss roll (phrased causes, mm:ss, mean gap at ≥3), the REPOINT target picker (facts per option, `net_assign_beam`), the dark clock. **Removes the shortfall drain (main.ts:1366-1378) and halves the loss drain (1379-1390); updates `act1.mjs` + `hour.mjs` WIRE expectations in the same commit.** · Dep: RT-05. · Verify: full `node tools/playtest.mjs`; a starved rider at act3a; ≥3 stamps on one link with mean gap within 10 % of 150 s.
- [ ] **RT-07** THE GLOBE COUPLING + FAULTS + AUDIO — *L* · traced-path brightening + hop pips, dimmed siblings, dashed unserved-with-path arcs, ghost-link on loss hover, candidate arcs, re-route flash + cell `← old`, the NODES sick group, three new cues (`link_lost`, `rider_starved`, `beam_committed`) + the health bed driven by max pipe utilisation. **Arc colour stays utilisation (`orrery-net-mode.test.ts` must stay green).** · Dep: RT-06. · Verify: `mono.mjs` per-distinction assertions; exactly one reroute cue per event.
- [ ] **RT-08** THE TRACE DESKTOP (key 3) — *S* · **GATED**: ship only if the RT-05..07 playtest shows the rail-summoned panel cannot carry the spatial read. `NET_PRESET_SPECS` + `presets.test.ts`, the net keydown branch, the status-strip legend, rename the `"ROUTING"` camera branch to `"TRACE"` and **delete the dead `"OVERVIEW"`/`"CONNECTIVITY"` branches**, `fuzz.mjs` KEYS. · Dep: RT-07. · Verify: preset validates; every net preset host has a rail button; fuzz sprays `3` with zero page errors.
- [ ] **RT-09** Delete the absorbed panels — *S* · remove `src/panels/link-load.ts`, `ROUTING·PREFER` + `netPreferControl()` from `net-planner.ts`/`main.ts`, and `howto.ts`'s retired "On ROUTING (3) …" string (a case-sensitivity lint hole). Shrink `copy-lint.test.ts` FILES accordingly. · Dep: RT-06. · Verify: build + full playtest green; no dangling registry/rail/preset references.
```
