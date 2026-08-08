# KIMI WORKLOG — what the agent built, in order

Working mode: autonomous, every change committed + pushed, tests/analysis gates green per commit
(`npm test`, `npx tsc --noEmit`, `npm run build`, `npm run smoke`, `npm run playtest`).

All of this traces to unlocked ground truth in the repo docs (GDD v0.8.1, m1-redesign, the fields
below). Every substantive design move has an SD number recorded in `docs/decisions.md`.

---

## Phase 0 — Grounding + the audit (before building)

- **Repo knowledge.** Read the GDD (541 lines, v0.8.1), the sim↔render contract, backlog,
  decisions log, M1 spec, tiling-WM spec, five implementation-plan companions, and walked
  src/sim (56 modules, purity-checked), src/orrery, src/wm, src/panels, tests.
- **The first acts-1-to-4 audit verdict** (4 angents + big-tier synthesis): the M1 slice was
  vending-machine design. Filed as `docs/first-light-integrated-plan.md` (P1–P5 phases):
  blockers first, then verbs, then style. That's what got built.

## Phase 1 — The verbs, rebuilt (the FL series)

- **FL-01 (exploit).** A wire launch with an absent/empty loadout flew the standard broadcast
  antenna but was charged for zero cards — free hardware. Fixed: the priced default is applied
  before validate; the pad previews the same effective fit. One of two intentional golden re-pins.
- **FL-11 (batch pricing).** −15% hardware on members 2+ of a launch; preview == applier price.
- **FL-02 (law enforcement).** The copy lint now covers all 17 copy-bearing panels, and a second
  lint bans new hardcoded hex in panels (the allowlist shrinks, never grows).
- **FL-03/04 (the physical assembly).** Slot-indexed loadout state (duplicates legal, legal
  truncation on bus switch) + the PAD silhouette editor — named G/S slots ("G1 ▣ BROADCAST" /
  "S1 ▢ —"), class-correct chooser, EMPTY clears. The flat toggle grid is gone.
- **FL-05.** The footprint disc is sized by the drafted antennas (BROADCAST = the LoS horizon
  cap at the elevation floor; spot beams = cone-clipped), not the target region's radius.
- **FL-06.** FIT — a planner assist that returns the cheapest LEGAL loadout, never the optimal
  one (the locked vending-machine ban). Latency-active ⇒ spot beam; bandwidth-active ⇒ bigger
  spot; else floodlight; never fills a second slot.

## Phase 2 — Contracts as a market (the hour gets teeth)

- **FL-07.** The tender is a live market object: offeredAtS / sign-on bonus / bonus lapse /
  pay-halving decay. Accepting freezes the board price and rebinds the penalty (2× asymmetry
  preserved). Act 1 now opens on TWO clocked tenders (the bonus-window opener + the decaying
  rival), and the patient-Infinity exception is dead. Golden re-pin #2.
- **FL-08.** Tender rows show the live texture: board price ticking, bonus countdown, decay
  note, breach-grace fact, lapse clock. History (failed/completed) collapses to a dim strip.
- **FL-09.** Decision: the act-4 Mars relay tender stays patient (a signal, not a gap — the
  frontier doesn't run on market clocks; one concept per act).

## Phase 3 — The launch embodiment + the pad as an instrument

- **FL-10.** The risk band: shown only once failures are armed (act 1 shows NOTHING — never a
  "0%" lie), honest vehicle-loss/underburn/no-sep rates from the actually-rolled constants.
- **FL-12.** `timeToServiceS` — a forward scan of the same gate the router runs, on the pad:
  "serving NOW / first serve in Ns / never serves this orbit".
- **FL-13.** Ring-grab — with the pad open, grabbing the draft ring directly edits altitude
  (vertical pull, pointer priority ring → globe aim → camera). Scripted-pointer verified.
- **FL-14.** Ring-pinned draft chip (cost · period · time-to-service · batch), pooled launch
  arcs (one per in-flight event), per-member deploy pops (quadratic flash at separation).

## Phase 4 — The style overhaul (FL-15)

- Palette unification: everything tokens (the two divergent legacy palettes died), the hex
  allowlist in the lint went empty. 4-step type scale. The dead ● ⛶ ✕ affordance lies are
  gone from the topbar AND every titlebar. Dither made visible (alphas 0.045/0.06/0.10 →
  0.09/0.13/0.16). Focused tile gains a shape channel (▸ in the titlebar) beside the colour.
  Preset tabs are real buttons (same action as keys 1–5). 48px zone-edge floor under the
  weight clamps. Crosshair cursor on the signal surface.

## Phase 5 — R3, the hour + the economy

- **SD-51 economy balance.** Canonical hour opened at −€83.6k; now closes +€3.5k (floor −€1.2k),
  gates at identical ticks. Terms 7200→480s so renewals cycle in-session (margins ARE the point).
  The one hinge fix: renewals INHERIT the customer's diurnal phase (a renewal's silent re-phase
  was silently desyncing the act-3 squeeze). `canon.ts` extracted as the single source shared by
  the golden pin and the balance measurement; golden re-pin #3.
- Shortfall assists have a MISSION surface; all four fallbacks reworded lawful (facts, never
  instructions; no API names). The scenario file itself is now under the copy lint.
- WIRE beats on act transitions; the net REVIEW desktop mounts THE PARSE (fold-derived run
  at rest; mission-elapsed stamps).
- SD-50 power model deferred to M2 (user call; `massKg` is the anchor). SD-52 fixed ground
  stations accepted (user call).

## Phase 6 — The machine layer of the gate (tooling)

- `tools/playtest.mjs` — headless scene runner over system chromium; scenes as modules with
  an ok/shot/eval/probe vocabulary. Ten scenes exist: boot / act1 / hour (the full UI-driven
  gate-1+gate-2 playthrough) / frontier (debug-seeded acts 3–4) / vault / audio / mono /
  perf / prefs / fuzz. 64+ assertions, ~2 minutes.
- The probe contract: `__aimProbe` `__dragOrbitProbe` `__launchTheatre` `__netState`
  `__regionProbe` `__perf` `__audio`. New visuals ship with a probe or the first flakey
  run teaches why.
- `npm run test:fast` skips the heavy goldens for the inner loop; `npm run playtest` is the
  pre-gate machine pass. Per-AGENTS §7 the full gates remain: test + tsc + build + smoke.

## Phase 7 — The X-backlog, crossed off

- **X-02 perf.** Instrumented (`__perf` p50/p95 + per-section rings); under full load
  (1000×, mature seeded net) frame p95 ≈ 1.3 ms — 13× under the 16.6 ms budget. Hottest
  sections: panels + orrery (~0.5 ms each); the sim drain is sub-ms. Perf scene re-proves
  it on demand.
- **X-03 accessibility v1.** 1-bit purist mode on M: tokens rebind to machine-whites AND the
  canvas runs grayscale+contrast. Computed-style asserted both ways. (Selectable CVD palettes
  owed; see backlog.)
- **X-04 the vault.** Browser-storage savegame (localStorage slots: quick + autosave), V/v keys,
  fold-hash receipts on the wire ("the fold hash proves the restore is the run"). Envelope
  JSON-safe with two traps pinned: Set↔array on activeAxes and Infinity→null canonicalization.
  Autosave cadence on sim time (paused clocks pause saves). Prefs shelf: mono + mute survive reload.
- **X-05 the audio engine.** Everything procedural; the plate reverb's IR is seeded-deterministic
  (the reverb is an identity, not fuzz). The cue grammar is signed: rising pitch for good news,
  falling for bad. Health bed = the network's calm (strain detunes it). Ambient generative layer.
  All beats wired: commit, deploy pops, no-sep clunk, underburn growl, sign/renewal cues, act
  bells, amber/telegraph fault tones, prefer sweeps, Mars relay/first-signal/breadcrumb,
  vault save/load, and per-click micro-tick.

## Bugs the loop caught (the record matters more than the fixes)

- The free-BROADCAST exploit (FL-01).
- The C key unreachable behind an early return (the act-2 documented verb was dead for humans).
- The act-3 debug seed never deployed (its step loops ran at a frozen sim time).
- The idle assist fired at cold boot (session epoch-clock vs idle window).
- JSON's silent murders: Set→{} on `activeAxes`, Infinity→null on the offer clocks.
- Tender rows persistently re-rendered with stale numbers after gate transitions (signature
  coverage was thin — the row signature carries the fact fields now).
- My own tooling mistakes are recorded too (arg-less eval proxies, edit batches that half-applied,
  a `git checkout` reverting uncommitted probe wiring). The counter-measures are now the
  loop's defaults: probes-first, scene-as-code, commit-before-debug-probe edits.

## What I did NOT touch (by rule)

- `docs/signal-horizon-gdd.md` — the player's design authority, untouched.
- The three replay goldens except at the three documented intentional re-pins (each with a
  fold-hash-equality proof + a decisions entry).
- Sim purity (no three/DOM/wall-clock/randomness), the always-tiled invariant, the f64→f32
  single-crossing rule, copy laws (goals-never-instructions / facts-never-verdicts).

## Open threads the user owns

- The M1 gate itself: ≥5 cold testers, the two layers (does the hour sustain past novelty,
  and does the Mars tip make them lean in).
- X-03 next: the selectable deuteranopia/protanopia/tritan palettes (purist is v1).
- Follow-ups: WM split/tab gestures, ephemeris pool, cache-mode vault port, a bundled pixel
  cursor + offline-bundled fonts (no asset pipeline in the repo yet).
- The human interface directions the machine can't write: is the hour *fun*. The machine can
  only prove it runs true.
