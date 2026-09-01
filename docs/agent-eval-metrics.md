# AGENT-EVAL — THE DETERMINISTIC METRICS
### v1.0 · 2026-09-01 · pre-registered before the first run · no LLM in this half

> Computed from two immutable inputs: the sim's own ordered `SimAction` log (`actions.jsonl`) and
> the per-turn probe snapshots (`probes.jsonl`), plus the driver's own record of what it attempted.
> **Nothing here consults a judge.** These numbers inherit the sim's determinism guarantees and are
> hard to game, because the action log is written by `applyAndRecordNetAction` in the sim path, not
> by the scorer.
>
> Amending a definition requires a dated entry in §7 of this file plus a decisions.md note.
> Parent spec: `agent-eval.md`. Ticket epic: SD-55.

---

## 1. Vocabulary, fixed

**A committed action** is an entry in the sim action log whose kind mutates world state:
`net_launch`, `net_accept`, `net_assign_beam`, `net_set_prefer`, `net_circularize`,
`net_place_cache`. `set_time_scale` is committed but classed separately as **tempo** (it is a
decision surface, not a world mutation). Opening the pad, summoning a panel, selecting a sat and
reading an instrument are **inspection**, never decisions, and never counted as such.

**A decision surface** is one of the fourteen enumerated in `m1-redesign.md` §2.7. The table below
has fifteen rows for those fourteen surfaces: §2.7 counts "beam assignment + re-beaming" as one, and
the harness scores them apart, because pointing a beam for the first time and *re*-pointing one that
was already serving somebody are different decisions — the second is the free continuous lever the
whole mid-game rests on. `m2_decision_surfaces.of` is therefore 15. A surface counts
as *touched* only when the committed action's payload differs from the value the game seeded, so
accepting every default is provably not a decision. The mapping, fixed here:

| Surface | Touched when |
|---|---|
| accept-timing | `net_accept.at_tick` is ≥ 60 sim-s after the offer became visible (held, rather than reflex-signed) |
| bus tier | a `net_launch` payload names a tier other than the one selected at pad open |
| antenna cards | a `net_launch` loadout differs from `DEFAULT_LOADOUT_CARD_IDS` |
| batch size | `net_launch` count ≠ 1 |
| altitude / inclination / sub-lon / RAAN / phase | that orbit field at commit ≠ the value the seeded preset supplied (one surface each; five surfaces) |
| beam assignment | any `net_assign_beam` |
| re-beaming | a second `net_assign_beam` for an antenna already assigned |
| prefer weights | any `net_set_prefer` |
| overclock | any overclock action (not yet a shipped verb — records as `unavailable`, never as untouched) |
| circularize | any `net_circularize` |
| tempo | the **agent** pressed a tempo key, or spread its dwells over ≥2 distinct lengths (see the §7 amendment — the action log's `set_time_scale` entries are harness noise under PDQ) |

`unavailable` is a distinct third state from touched/untouched. A surface that does not exist in the
build must never depress a decision count as though the agent declined it.

---

## 2. The metrics

Each is `id · type · extraction · why it exists`. Types: `int`, `bool`, `sec` (mission-elapsed
sim-seconds), `frac` (0..1).

**M1 · committed_actions_act1 · int.** Committed actions in the log with `at_tick` at or before the
tick at which `__netState().cursor` first advances past act 1. *The R1 playtest gate in
`m1-redesign.md` §3 is "Act 1 delivers ≥5 real decisions cold". This is the machine reading of it.*

**M2 · decision_surfaces_touched · int (of 14) + the named set.** Per §1's table, over the whole run.
*§2.7's claim is fourteen distinct decision surfaces. This counts how many a cold agent actually
reached — the difference between existing and being found.*

**M3 · both_strategy_forks_taken · bool (battery-level, not per-run).** TRUE when, across the
battery, at least one `net_launch` is a T2 bus carrying ≥2 same-side antennas (consolidate) **and**
at least one is a batch of ≥2 T1 smallsats (split). *R3's gate is that the consolidate-vs-split fork
is taken both ways across seeds at a 20–80% pick rate. A single-run value is meaningless; this metric
is only ever reported over a battery with its Wilson interval.*

**M4 · instruction_string_absent · bool.** Every observation string the agent was shown is scanned
with the `copy-lint` banned-imperative patterns. TRUE when none matched. *LAW 2 is enforced at build
time over source copy; this catches the runtime composite — interpolated strings, log lines assembled
at play time, and anything the lint's file list does not cover.*

**M5 · responded_to_own_success_strain · bool.** TRUE when (a) a region the agent served had its
offered load grow above its value at first-serve, and (b) a committed action within the following 5
turns targets that region, its pipe, or a sat serving it. *This is deliberately NOT the GDD §9 claim-2
"attribution" measure. Attribution is a statement about what the player believed and is a judge
question (`agent-eval-judge.md` Q2). This metric measures only the behaviour: did the strain get
answered. Reports must not conflate the two.*

**M6 · completed_without_softlock · bool.** FALSE if, for 3 consecutive turns, no available
affordance changed the observation digest while the wallet still exceeded the cheapest committable
action, or if any page error / console error occurred. *Softlock and dead-end detection is the class
of finding AI playtesting is actually trusted for.*

**M7 · novice_floor_reachable · bool.** For the `novice-floor` persona only: the act-1 cursor advanced
and some contract reached `servedFrac > 0`, with TRACE, the parse and diagnosis-class probes withheld
from the observation throughout. *GDD §9 claim 4 — the novice floor — is that live cues alone suffice.*

**M8 · invalid_action_rate · frac** and **M8b · no_op_action_rate · frac.** Invalid = the brain's
action failed schema or affordance validation. No-op = it executed but left the observation digest
unchanged. *Both are legibility signals with no LLM in them: an agent that keeps reaching for
controls that are not there, or pressing things that do nothing, is reading the screen badly. Rising
no-op rate across builds is a regression even when every other metric holds.*

**M9 · time_to_first_served · sec** and **M9b · turns_to_first_served · int.** First probe snapshot
with any contract at `servedFrac > 0`. *"Act-1 time-to-first-served within the gentle-opener
envelope" is a standing falsifier in `m1-redesign.md` §3.*

**M10 · hand_aimed_before_commit · bool.** At least one of the five orbit fields differs from the
seeded preset value at the first `net_launch`. *The gate's hand-aim criterion. The pre-aim being dead
(the draft spawns 90° west, footprint visibly missing) is the specific fix `m1-redesign.md` §1 was
written for; an agent that launches the untouched default proves the vending machine came back.*

**M11 · acts_reached · int.** Max `__netState().cursor`.

**M12 · economy · {final_eur, min_eur, breach_seconds_total, ended_net_positive}.** From probes and
`__regionProbe.breachS`. *The economy theorem (one contract cannot pay its own honest provisioning)
predicts a cold agent that signs everything goes negative. That is a finding, not a failure.*

**M13 · errors · int.** Page errors plus console errors. Any value > 0 fails the run outright,
matching `playtest.mjs`.

---

## 3. Run facts, recorded but never scored

`turns`, wall-clock, `total_cost_usd` (summed from the brain's own usage reports), per-turn think
latency (the LCRT input), `clock_mode`, `injected_latency_ms_total`, and the full run key from
`agent-eval.md` §7. These describe the measurement, not the build.

---

## 4. Reporting rules

1. **Every rate carries a Wilson 95% interval.** Never Wald — it collapses to zero width at 0/5 and
   5/5, which is exactly where a small battery lands.
2. **n=5 is for existence and regression only.** Permitted: "this build exhibits X"; "M8b moved from
   0.12 to 0.31 against the pinned baseline". Forbidden without more seeds: any ranking, and the
   phrase "the build passes".
3. **Sequential rule.** Run 5 seeds. Add seeds only for metrics whose interval straddles the decision
   threshold; escalate when the interval width exceeds 0.3 around the line.
4. **Baselines in every row.** Random floor = the `fuzz` scene's outcome. Scripted ceiling = the
   authored scenes. Human ceiling = the M1 gate session, printed as `not measured` until it runs.
   Normalised score `(agent − random) / |scripted − random|` is printed *beside* the raw value, never
   instead of it.
5. **PDQ and LCRT runs are never pooled.** The clock mode is part of the key.

---

## 5. Pinning

`metrics.json` from a green run is pinned as `tools/agent-eval/baselines/<build>.json`. The nightly
comparison is against the pin, and a metric that moves adversely by more than its interval is a
regression to investigate — not an automatic red, because the agent is stochastic.

---

## 6. What this half provably cannot answer

Written down so the judge's scope is a residue, not a land grab:

- Whether the player *understood* what they were looking at (M8/M8b are proxies for reading the
  screen badly, not for comprehension).
- Whether escalation felt endogenous — M5 sees the response, never the belief.
- Whether the record left the player wanting to do it better (the GDD §9 layer-1 bit).
- Anything about fun, pacing, or tedium.

The judge is built only when one of these blocks a real decision. See `agent-eval.md` §9.

---

## 7. Amendments

**A-1 · 2026-09-01 · tempo is read from the agent's turns, not from the action log.** Found while
building the PDQ loop, before the first run. `main.ts:recordScale()` logs a `set_time_scale` action
every time the clock pauses or resumes — and PDQ pauses and resumes on **every turn**, so the action
log's tempo entries are overwhelmingly the harness's own, not the player's. Scoring tempo from them
would have reported the surface as touched in every run regardless of what the agent did. The
extraction is therefore: tempo counts the agent's own tempo keypresses, plus a deliberate spread of
dwell lengths (≥2 distinct `wait` durations) — because under PDQ the agent's real tempo lever *is*
how long it chooses to let the world run. The harness's injected entries are ignored, and PDQ's
distortion of this particular surface is named in `agent-eval.md` §3.
