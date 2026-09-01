# THE AGENT-EVAL HARNESS
### v1.0 · 2026-09-01 · an LLM agent plays FIRST LIGHT cold, and the run is scored twice

> **Status:** PRE-REGISTRATION. This document, `agent-eval-metrics.md`, and `agent-eval-judge.md`
> are written and committed **before** the first agent run, so no metric can be defined after
> seeing a result that flatters the build. Changing a definition here requires a dated amendment
> in this file plus a decisions.md entry — never a silent edit.
>
> Ticket epic: SD-55 (`backlog.md`). Design authority for the game itself stays the GDD, the M1
> spec, and `m1-redesign.md`. **This harness never earns the M1 gate.** See §1.

---

## 1. What this is, and the one thing it can never do

The M1 gate (GDD §9) is two behavioural bits measured on **five cold human testers**, and it is
the user's to run. Nothing in this directory changes that.

What the harness does is cheaper and narrower: it drives the real game with an LLM agent that has
**never read the design docs**, records everything, and scores the run **twice** —

1. **Deterministic metrics** (`agent-eval-metrics.md`) computed from the ordered `SimAction` log
   and the probe snapshots. No LLM in the loop. These inherit the sim's determinism guarantees and
   are hard to game, because the action log is written by the sim, not by the scorer.
2. **A blind judge** (`agent-eval-judge.md`) that reads only the observation stream the agent saw
   plus the agent's own words, and answers pre-registered yes/no questions with a mandatory quote.
   **P1 — deferred, and gated:** it gets built only once we hold a legibility question the action
   log provably cannot answer. See §9.

**The industry line, adopted verbatim as policy:** AI playtesting is trustworthy for reachability,
softlocks, regressions, exploits and balance sweeps. It is *not* evidence about fun, pacing, or
comprehension. Every legibility reading this harness emits is a **lead for human playtesting**,
never a verdict.

**The agent is not a novice about the domain — only about the interface.** An LLM already knows that
GEO sits near 35,786 km, that a polar region needs inclination, that light-delay scales with
distance. The first live run typed the GEO altitude before it had opened the coverage comb. A cold
human tester has none of that. So every discoverability number this harness produces is an **upper
bound**: it says what a player who already knows the physics can find in this UI. When the agent
cannot find something, that is strong evidence; when it can, it is weak evidence.

**The Goodhart clause — the standing prohibition.** The game is never tuned so that the *agent*
completes it. An agent has perfect text comprehension, no visual attention, infinite patience and
no boredom: the inverse of the target player. Tuning toward agent success would optimise FIRST
LIGHT for the wrong species. The harness exists to find **defects and unreachable states cheaply
and repeatably**. Any change justified only by "the agent did better" is a bug in the process.

---

## 2. Substrate — and where we deviate from the brief

| Layer | Choice | Why |
|---|---|---|
| Server | **its own `vite` per run**, on its own port, serving the tree it measures | Worktrees under `.claude/worktrees/` are a standing part of how this repo is worked on, and several agents run at once. A shared `:5173` is a shared fate: a concurrent session's worktree made vite force a full reload and re-booted the app mid-run. `vite.config.ts` now excludes worktrees and artifacts from the dev watcher (which protects human sessions too), and a run never borrows someone else's server unless `--base` says so. Generalised in SD-59: the server helper moved to `tools/serve.mjs`, every checkout now owns a dev port, and `npm run playtest` takes a repo-wide lock — agent-eval runs stay unlocked, since they already serve their own port and are meant to run several at a time. |
| Browser | **playwright-core**, headless chromium (`/usr/bin/chromium`) | Byte-stable observations, deterministic replay, CI-friendly, no per-turn token cost. The Playwright **MCP** server (`.mcp.json`) stays the *interactive* debugging path — its accessibility snapshots are token-expensive and vary turn to turn, it has no cost ceiling and no transcript. |
| Action vocabulary | **The existing `ctx` helpers**, extracted to `tools/ctx.mjs` | One verb set shared by the scripted scenes (`tools/scenes/`) and the agent driver, so a scripted trajectory and an agent trajectory are the same format. The agent's tool schema maps 1:1 onto `click` / `key` / `setParam` / `wait`. |
| Observation channel | **Rendered DOM text + the probe JSON.** Not screenshots. | BALROG (arXiv:2411.13543) reports multimodal agents do *worse* given an image than a textual observation, and the weakness is precisely spatial/geometric reasoning — which is all this game is. Orbital geometry is exposed numerically (`__aimProbe`, `__satScreenPos`, the draft chip, the coverage comb) rather than as pixels. Screenshots are captured every turn for the *human* reviewing the bundle, and for the reject-only perception probe (§10). |
| Agent loop | **A tool-less `claude -p` subprocess seat**, resumed by `--session-id` / `--resume` | Deviation from the brief, deliberate. The brief prefers the Claude Agent SDK for its tool loop, hooks and session resumption. But this agent needs **no tools** — the driver is the actuator; the brain only emits one JSON action per turn. Running it with `--tools ""` `--setting-sources ""` `--strict-mcp-config --mcp-config '{"mcpServers":{}}'` makes the design-free boundary **structural**: the brain physically cannot read the repo, the GDD, or the golden path, so no `PreToolUse` hook has to be trusted to deny it. Measured: 309 input tokens on turn 1 (vs 11k+ with the default Claude Code system prompt), and `--resume` demonstrably carries memory between turns. Zero new dependencies. If the SDK later buys something this cannot (parallel seats, structured output enforcement), revisit and record it. |
| Judge model | Different family/tier from the agent | Self-preference bias runs 10–25% (Panickssery et al.; Wataoka et al., arXiv:2410.21819). Agent = Sonnet (the driving task is easy); judge = Opus or a cross-family ensemble (the comprehension calls are the hard part). The pairing is recorded in `run.json` as a named confound either way. |

---

## 3. The clock artifact — declared, not hidden

The harness runs in **PDQ mode (Paused During Query)**: sim-time is paused while the agent thinks,
then the agent's chosen dwell is fast-forwarded. Measured think latency is 2.8–3.3 s per turn on
Sonnet with a warm session; a 60-minute mission at 1× would otherwise be unplayable by an LLM.

**PDQ deletes real-time pressure from the measurement by construction.** Every report says so.
Consequences to hold in mind when reading any run:

- The agent never suffers a link loss *while* deciding, so "did they notice in time" is untestable.
- Tempo (one of the fourteen decision surfaces, `m1-redesign.md` §2.7) becomes a free choice
  rather than a pressured one, which flatters the build.
- Nothing in a PDQ run can falsify or confirm the §5 "becalmed dashboard" failure mode.

**P2 — LCRT (Latency-Controlled Real-Time), recorded now, built later.** Inject the measured
decision latency back into sim-time before applying the action: `clock.advance(latency_ms × scale)`.
Cheap here because the clock is an integer fixed-step (`SimClock`, `TIME_SCALES`) we already
fast-forward, and it converts the caveat from hand-waving into a number. `run.json` carries
`clock_mode: "PDQ" | "LCRT"` and `injected_latency_ms_total` from day one so PDQ and LCRT runs never
get silently pooled.

---

## 4. Personas are policy coverage, not people

Persona prompting produces real, measurable behavioural shifts, but persona expression drifts over
long conversations and self-reports dissociate from behaviour (*The Personality Illusion*,
arXiv:2509.03730). So the harness claims **only** that a persona generates a distinct trajectory
through the rules from a stated decision stance. No persona is ever described as a player archetype,
and no report may say a persona "predicts" what a kind of human would do.

| Persona | Stance | What it is for |
|---|---|---|
| `optimizer` | Minimise decisions to completion; exploit anything that works | Shortcut and exploit reachability |
| `satisficer` | Stop at good enough; never tune what already pays | Whether the build over-rewards grinding |
| `literalist` | Do exactly what the last on-screen text says, nothing more | **The instruction-leak detector.** If a literalist can complete an act, imperative copy leaked past the LAW-2 lint |
| `impatient` | Skip time, ignore hints, act on the first affordance | The cold-player floor. (Impatience is a documented agent stressor — arXiv:2510.04491) |
| `novice-floor` | As `impatient`, **plus a capability restriction**: the observation omits TRACE, the parse, and `__regionProbe`-class diagnosis | GDD §9 claim 4 — can a player who never opens the advanced instruments reach functional on live cues alone? If only the full-observation personas progress, the novice floor fails |

The restriction for `novice-floor` is enforced in the **driver's observation builder** (the withheld
panels are never rendered into the observation, and the summon verbs for them are absent from the
affordance list), not by asking the brain to abstain.

---

## 5. Baselines — no LLM number is readable without them

Every scoreboard row carries three reference points, all of which already exist:

- **Random floor** — `tools/scenes/fuzz.mjs` (220 sprayed inputs). Promote its outcome into the
  scoreboard as the random policy.
- **Scripted ceiling** — the authored scenes (`act1`, `hour`, `trace`, `frontier`). These are
  expert play with foreknowledge: the upper bound on the behavioural metrics.
- **Human ceiling** — the one-hour human session at the M1 gate, when it runs. Until then the cell
  reads `not measured`, never a guess.

Normalisation, reported alongside the raw value:
`(agent − random) / |scripted − random|`.

---

## 6. Budgets, stalls, and clean landings

Hard ceilings, all recorded in `run.json` and all producing a *clean landing* (a terminated run with
a reason), never a crash:

- `maxTurns` (default 40) · wall-clock (default 20 min) · USD (default $2.00 per run).
- **Stall detection:** if the observation digest hash is unchanged for 2 consecutive turns, the run
  escalates through *distinct* strategies — never the same prompt into the same context. Escalation
  order: (1) tell the agent its last action changed nothing, (2) drop the history and re-observe
  cold, (3) terminate with `reason: "stall"`.
- Invalid actions get a **fallback**: the driver replies with the schema and the affordance list and
  does not advance sim-time. Invalid-action count is itself a legibility metric (M7).

---

## 7. Reproducibility

The LLM is not deterministic and no flag makes it so. Everything around it is:

- **Run key:** `{build_hash, seed, model_id, model_version, params_hash, prompt_version, persona,
  clock_mode}`. `build_hash` is a content hash of the **game's** sources (`src/`, `data/`,
  `index.html`, `vite.config.ts`), never git HEAD — otherwise a harness commit invalidates a pinned
  baseline for a build whose game code did not change. The git sha rides in `run.json` as provenance. `prompt_version` is the sha256 of the persona file plus the observation-schema
  version, so a prompt edit can never masquerade as a build regression.
- **Record–replay:** every brain request and response is logged to `transcript.jsonl`. A replay mode
  feeds the recorded responses back so a failed run is re-inspectable without spending a token —
  the same LIVE==REPLAY discipline the sim already holds, extended to the agent.
- **Judge determinism:** temperature 0 and a pinned model *version* for any gate; the version is an
  artifact, and the calibration set is re-run whenever it bumps.

---

## 8. The artifact bundle

One directory per run: `tools/agent-eval/runs/<build>/<persona>/<seed>/` (gitignored). Schema in
`agent-eval-artifacts.md`. Contents: `run.json` (the key + termination), `actions.jsonl` (the sim's
own action log — the crown jewel), `transcript.jsonl` (every brain request/response with usage and
cost), `observations.jsonl` (**the design-free stream, and the only thing the judge is ever given**),
`probes.jsonl`, `metrics.json`, `shots/*.png`, and `report.md`.

---

## 9. The judge is gated, on purpose

`agent-eval-judge.md` is written now (pre-registration) but **not built until the deterministic half
is exhausted**. The gate, stated as a falsifiable condition:

> Build the judge when we hold a legibility question that matters and the action log provably cannot
> answer it — i.e. the deterministic metrics fail to separate a known-good build from a known-bad one
> that a human read as illegible.

If the random and scripted baselines already separate cleanly, and the `literalist` persona already
catches instruction leaks, the nightly regression gate needs no judge at all. Building it earlier
buys flakiness we would then have to calibrate away.

**When it is built, it does not ship until calibrated:** 100–150 hand-labelled transcripts, two
annotators, inter-annotator Cohen's κ ≥ 0.6 (the rubric is ambiguous below 0.4), then judge-to-human
κ ≥ 0.5. κ, not raw agreement — a judge that always says PASS scores 90% raw and κ≈0 on a 90%-pass
set, which is exactly the class imbalance a legibility question has.

---

## 10. Perception probe — reject-only (P2)

A VLM may be run over the rendered frame, and over Brettel/Viénot CVD-simulated variants, to answer
the same legibility questions. The result is **asymmetric by rule**: a VLM *failing* to read a
critical cue is evidence of a defect worth a human check; a VLM *passing* proves nothing, because
VLMs are unreliable at exactly this kind of spatial reading. It can reject. It can never accept.
This is the machine layer of the X-03 "colour-off fully playable" exit check, not a replacement for it.

---

## 11. Statistics — what n=5 can and cannot say

- Report **every** rate with a **Wilson 95% interval**, never Wald. At 5/5 the Wilson lower bound is
  ≈0.57: "five for five" is consistent with a true rate of 57%.
- n=5 supports **existence and regression claims** ("this build exhibits failure mode X"; "the metric
  moved against the pinned baseline"). It does **not** support ranking or "the build passes".
- Sequential rule: run 5 seeds; add seeds only where the interval straddles the decision threshold
  (escalate when the interval width exceeds 0.3 around the line).
- Any comparative claim in a report must print its interval next to it or be struck.

---

## 12. Cost

Measured, not modelled: the driver records real `total_cost_usd` per turn from the brain's JSON
output, and `report.md` prints the run total. First measurements (Sonnet, tool-less seat): 309 input
tokens and $0.0017 on the opening turn; ~$0.02 per resumed turn early in a session. A 40-turn run is
expected in the $0.30–1.00 band and is capped by the USD budget regardless. A 5-persona × 5-seed
sweep is therefore tens of dollars at most, and the Batch API (50%, stacks with cache pricing) is the
lever if a nightly sweep ever needs it. **Re-verify pricing before budgeting; model lineups move.**
