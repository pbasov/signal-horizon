# FIRST LIGHT — Integrated Build Plan (4-audit consolidation)

Combines: LAUNCH audit, CONTRACT audit, LOADOUT audit, UI/style audit.
Ordering rule: **blockers → loadout (biggest verb win) → contract texture → launch embodiment → style
overhaul once verb surfaces are final** (styling is applied once, not re-done per verb).

Every commit: `npm test && npx tsc --noEmit && npm run build`, backlog.md + decisions.md updated
in the SAME commit, pushed immediately. Every frontend step gets `tools/shoot.mjs` (or a scripted
Playwright run) — not just a compile. Sim steps get Vitest first (test red → impl → green).

Golden policy: exactly **two deliberate net-golden re-pins** in this plan — **P1-C1** (exploit fix
changes charged €) and **P3-C1** (contract pricing/tender terms change act-1 hash). Collect every
other economics-relevant change earlier so the re-pins stay bunched there; P2–P5 must prove
golden-clean or the plan breaks.

Ticket ids used below: **FL-01 … FL-15** (drafts at §4). Decision ids: **SD-46 … SD-50** (§3).

---

## P1 — Blockers: exploit fix + copy-lint coverage

### P1-C1 · Default-priced loadout, always validate (FL-01)
- **Changes:** `src/sim/net/apply-action.ts` (~L100): remove the `if (cardIds.length > 0)` guard —
  default empty/absent wire loadout to `DEFAULT_LOADOUT_CARD_IDS = ["BROADCAST"]` and ALWAYS
  `validateLoadout` + price via `launchStackCost(bus, defaultedCards, …)`. `src/sim/net/sat.ts`:
  export the default. `src/sim/action.ts#netLaunch`: stop erasing empty loadout arrays (emit the
  default instead).
- **Test first (Vitest):** `apply-action.test.ts` — regression test: a wire launch with absent and
  with `[]` loadout is charged for BROADCAST (€2.5k) and fails validation if the bus can't fit the
  defaulted card. Asserts the exploit is closed both ways.
- **Screenshot:** none (sim-only).
- **Golden:** RE-PIN net-replay (+€2,500 per lean launch in the canonical arc) — its own commit,
  expected drift note in the commit message + decisions.
- **Risk:** LOW sim / MED golden (canonical arc economics shift; gate ticks should hold — verify).

### P1-C2 · Extend copy-lint to new ticket surface + CI lint for hardcoded hex (FL-02)
- **Changes:** `src/panels/copy.ts` — add the copy fragments everything below will need
  (`TENDER_BONUS/TENDER_DECAY/TENDER_GRACE`, pad `RISK_BAND` fact string, batch-discount stack row,
  loadout slot labels); extend `copy-lint.test.ts` lists to cover the new keys so LAW
  (facts-never-verdicts / goals-never-instructions) is enforced BEFORE the strings ship. Add a
  style lint (grep test) banning raw `#[0-9a-f]{6}` in `src/panels/` CSS-in-JS going forward —
  tokens only (existing violations allowlisted in one list so the lint is green on day one, and
  P5 shrinks the allowlist mechanically).
- **Test first:** lint tests themselves (fail without the allowlist / new keys).
- **Screenshot:** none (no visual change yet).
- **Risk:** LOW. Foundation — unblocks every later panel change to stay lawful.

---

## P2 — LOADOUT: the biggest verb win (loadout editor rebuild)

### P2-C1 · Slot-indexed loadout state + draft sync (FL-03)
- **Changes:** `src/main.ts`: replace the card set-model with slot-indexed
  `(string|null)[]` sized by bus `gSlots/sSlots`; sync `netDraft.loadout` from `r1Cards` on every
  edit (dye at ~L378 — `onEditDraft` must preserve the live loadout). Selection flow: pick slot →
  legal-card menu; supports duplicates (two ACCESS-S in two G slots).
- **Test first (Vitest):** pure reducer test for the slot model (duplicate allowed, slot count
  clamped by bus, switching bus truncates legally) — put the reducer in a pure module
  (`src/panels/loadout-state.ts` logic-only part, no DOM).
- **Screenshot:** PAD short + after a slot swap (same shot set as P2-C2, fine to batch).
- **Risk:** LOW-MED. Frontend state touching main.ts; no sim.
- **Dependency:** this is what makes the comb reactive — see Cross-verb deps.

### P2-C2 · Slot-aware editor DOM (silhouette + slots) (FL-04)
- **Changes:** `src/panels/mission-top.ts` PAD: replace the flat `.mission-card` toggle grid with a
  bus silhouette row of named slots (G1/G2/S1/S2), each slot a chooser with per-card facts
  (pipe capacity + €). vSlots text line dies. Slot/role glyphs redundant-encode (shape + label,
  not colour). Uses P2-C1's pure state module + copy from P1-C2.
- **Test first:** DOM test isn't a Vitest job — this is the **scripted Playwright** step:
  `tools/` script opens pad, fills both G slots with ACCESS-S duplicates, asserts the stack line
  updates and the two pipes appear post-launch.
- **Screenshot:** before/after PAD; validate tokens-only (no hardcoded hex) via the P1-C2 lint.
- **Risk:** MED — biggest panel surface change; keep the arm/launch chrome byte-identical.

### P2-C3 · Antenna-reactive footprint + comb truth (FL-05)
- **Changes:** `src/sim/net/world.ts` (or `endpoint.ts`): new pure `footprintRadiusRad(card, altM)`
  (BROADCAST = LoS-horizon cone at min elevation; ACCESS/GATEWAY = antenna cone ∩ horizon) and
  wire it into `previewLaunch`'s draft slice so the draft disc sized from region radius
  (main.ts:1582) becomes sized from the ACTUAL drafted antenna. `draftToSat(draft, t, id, bus,
  loadout)` takes bus+loadout (kills the hardcoded `smallsat`, world.ts:372). main.ts passes
  bus/cards through.
- **Test first (Vitest):** footprint pins (GEO horizon, LEO cone < horizon clip, altitude
  monotonicity); extend the consequence-truth invariant test to a **comsat draft with ACCESS cards**
  — preview == post-commit solve, bit-truthful.
- **Screenshot:** draft disc before/after at same aim with BROADCAST vs ACCESS (disc visibly
  shrinks); shot of comb unchanged-under-edit.
- **Golden:** golden-clean required (preview-only + member-marker geometry; nothing folds).
- **Risk:** MED — first launch-audit item merged here (preview truthfulness); largest sim surface
  in P2.

### P2-C4 · `suggestLoadout` — legal, not optimal (FL-06)
- **Changes:** `src/sim/net/world.ts`: pure `suggestLoadout(bus, contractAxes)` returning a
  VIABLE-BUT-IMPERFECT card set (locked shape: planner suggests legality, never the answer);
  PAD button "FIT" fills slots with it. Facts-only caption.
- **Test first (Vitest):** returned loadout always validates for every bus; latency-active SLA →
  includes a spot beam; never returns GATEWAY where unnecessary (greedy legality pin).
- **Screenshot:** PAD with suggestion applied.
- **Risk:** LOW. Explicitly bounded to honour the planner lock.

---

## P3 — CONTRACT: texture + stakes on the tender board

### P3-C1 · Contract fields + accept pricing + ACT1 multi-tender (FL-07) — audit steps T-C1+T-C2+T-C4 fused
- **Changes:** `src/sim/net/contract.ts`: additive fields `offeredAtS`, `signOnBonusEur`,
  `signOnBonusUntilS`, `payDecayHalfLifeS` + pure helpers `decayedPayAtS`/`signOnBonusAtS`.
  `session.acceptContract(id, t)`: freeze pay at `decayedPayAtS`, penalty 2× asymmetry preserved,
  wallet += `signOnBonusAtS`. `apply-action.ts:140` threads `t`. `scenario.ts ACT1.emit`:
  `ACT1_OFFER_WINDOW_S = 2h`; REGION-0 keeps id + sign-on bonus €2,000 within a 900 s window; new
  REGION-C (equatorial transit metro, lon 5°E, pay 1.6× base with `payDecayHalfLifeS = 1200 s`) —
  the act-1 Infinity exemption dies; gate unchanged (any active+served). `state-hash`: mix the 3
  new f64s after the `offerExpiresAtS` line.
- **Test first (Vitest):** `contract.test.ts` new pins: decayedPayAtS monotone decreasing, exact
  half-life point, bonus inside/outside window, Infinity-decay contract == flat pay; lapse-replay
  test (offered window expires deterministically in replay); fold mix pinned in the golden test.
- **Golden:** RE-PIN #2 (act-1 hash + balance move: +bonus, canonical accept ~24 s; act2–4 hashes
  move from the extra folded tender; gate ticks / TICK_BATCH=1441 hold — verify). All three sub-steps
  land together so there is ONE golden churn, not three.
- **Screenshot:** none (sim) — UI lands next commit.
- **Risk:** MED-HIGH (second and last golden churn; accept-pricing touches the economy theorem —
  re-run `economy.test.ts` assertions: theorem must still hold UNDER decayed REGION-C pay).
- **Open decision → SD-49:** does the 2× penalty ALSO decay symmetrically or stay bound to the
  signed (decayed) pay? Plan default: penalty = 2× frozen pay (both scale; asymmetry preserved).

### P3-C2 · Tender-board fact rows (FL-08) — audit step T-C3
- **Changes:** `src/panels/mission-top.ts` (~L360, `NetContractRow`): additive fact rows only —
  bonus line ("+€2,000 if signed within 15:00"), decay note ("offer pay −50% by 20:00"),
  breach-grace fact (500 s → printed from `BREACH_GRACE_SECONDS`), using P1-C2's copy fragments +
  `expiresInS` machinery already live. Facts, never verdicts.
- **Test first:** copy-lint covers the new keys (already P1-C2); add a row-shape DOM assertion in
  the Playwright script.
- **Screenshot:** tender board with bonus counting down; colour-off check (shape/position, not hue).
- **Risk:** LOW.
- **Dependency:** P5-C2 typography restyles these rows — no separate text polish here; rows land in
  existing styles and inherit the overhaul.

### P3-C3 · Act-4 offer-window decision (FL-09) — audit step T-C5
- **Changes:** decision only (Mars relay tender: patient or clocked?) + the one-line scenario edit.
- **Test first:** replay test if a window is set.
- **Screenshot:** n/a or one board shot if a clock ships.
- **Risk:** trivial. Recorded in SD-47.

---

## P4 — LAUNCH: embodiment (risk band, batch discount, drag-the-ring)

### P4-C1 · `launchFailureRates` + pad risk band (FL-10) — launch audit step 1
- **Changes:** `world.ts`: pure `launchFailureRates(count, armed)` → `{vehicleLoss, perMemberLoss,
  anyMemberLoss}` from existing constants. `session.ts`: public `get failuresArmed()`
  (`scenarioCursor > 0`). `mission-top.ts`: `MissionTopState.riskBand: string|null`, rendered under
  the stack line (fact-only copy from P1-C2); main.ts projects `null` while not armed (act 1 = the
  silent zero, shown as nothing).
- **Test first (Vitest):** arithmetic pins (`1-(1-nosep)^count` etc.); session test: `failuresArmed`
  flips exactly at cursor 0→1.
- **Screenshot:** PAD act-1 (no band) vs act-2 (band) — two shots.
- **Risk:** LOW on its own; see note.

### P4-C2 · Batch manifest discount — **merge into P1-C1's re-pin** (FL-11) — launch audit step 2 (re-sequenced)
- **Changes:** `world.ts`: `NET_BATCH_MEMBER_DISCOUNT = 0.15`; rework `launchStackCost` (member 1
  full hardware, 2+ discounted; vehicle shared — already amortized); delete legacy
  `launchDraftCost`/`previewLaunch.costEur` math so panel price == charged price (single function,
  preview and applier). PAD manifest row "2nd+ sat hardware −15%".
- **Test first (Vitest):** pricing tests (count=1 unchanged, discount at ≥2, vehicle shared once).
- **⚠ RESEQUENCING vs the launch audit:** the audit scheduled this alone because it moves the
  golden — but P1-C1 moves the golden anyway (lean-launch pricing). **Land the discount math in
  P1-C2's shadow right after P1-C1** (before the re-pin stabilises downstream work) so BOTH cost
  changes ride re-pin #1; P4 then contains no €-changing code. If the discount tuning wants to
  move later, re-doing the re-pin is cheap only before P3 builds on the hash. (Documented as the
  plan's one intentional deviation; see SD-48.)
- **Screenshot:** PAD stack line count=1 vs count=2.
- **Risk:** MED (golden); the rest of P4 is golden-clean.

### P4-C3 · `timeToServiceS` + pad facts (FL-12) — launch audit step 4
- **Changes:** `world.ts`: pure `timeToServiceS(eph, draft, region, grounds, t, horizonS)` —
  forward-scan `isPointServed` to first serve (GEO-parked ⇒ 0). `MissionTopState.facts +=
  timeToServeS`.
- **Test first (Vitest):** parked GEO-over-region = 0; LEO sweep positive & ≤ period; never-served
  ⇒ Infinity (rendered "—").
- **Screenshot:** pad facts line at a mis-aimed vs aimed draft.
- **Risk:** LOW.

### P4-C4 · Ring-grab orbit drag on the orrery (FL-13) — launch audit step 5
- **Changes:** `src/orrery/orrery.ts`: public `onNetDragOrbit((altM)=>void)`; pointer priority while
  `plannerActive`: draft-ring hit-test (nearest `netDraftRing` sample vs ray, `PICK_TOLERANCE_PX`)
  → `ringDragging` (vertical delta → altitude within `NET_DRAFT_BOUNDS.semiMajorM`) → else aim-drag
  (globe) → else camera. Dev probe `__dragOrbitProbe`. main.ts wires to `netEditDraft("semiMajorM",
  A1_BODY_RADIUS_M + altM)`; budget-check: per-frame `previewLaunch` is a full router solve — add a
  drag-debounce (e.g. resolve at pointermove, throttle router solve to 15 Hz during drag).
- **Test first:** scripted Playwright `tools/` script: programmatic ring drag, assert
  `[data-net="draft"][data-draft="altitude"]` moved + `preview.costEur` changed; probe assert.
- **Screenshot:** drag mid-gesture + ring at two altitudes.
- **Risk:** HIGH — the only real renderer work; input-mode ambiguity (ring vs globe vs camera) must
  not regress drag-to-aim or wheel zoom. Mitigation: strict pointer-priority order + probe tests of
  all three modes.
- **Cross-verb dep:** hit-test precision depends on P2-C3's footprint-disc placement staying off
  the ring raypath (disc is surface-anchored, ring is a polyline — verify no pick-order fight).

### P4-C5 · Live readout pinned to the ring + launch-arcs-for-all + deploy pops (FL-14) — launch audit steps 6+7
- **Changes:** `NetRenderState.draft.readout {costEur, periodS, timeToServeS}` projected per frame
  in `netDraftSlice`, drawn in the existing pad-open readout corner (facts-only). `updateNetLinks`:
  pooled `Line`s for ALL `launchArcs` (not just `arcs[0]`); per-member deploy pop = scale bump in
  the existing `fresh` sat-marker pulse path.
- **Test first:** Playwright script: two batches → two arcs on screen; deploy pops visible during
  the 3 s fresh window; readout changes during a ring drag.
- **Screenshot:** before/after multi-launch; readout shot.
- **Risk:** MED. Pure render layer; no sim.

---

## P5 — STYLE OVERHAUL (once verb surfaces are final)

Palette first, then type, then spacing, then dither, then affordances, then cursor+boot. Each step
is palette/lint-safe and screenshot-compared against its OWN before (P1–P4 shots are the baselines).
**Hands-off per audit:** always-tiled invariant, canvas reparenting, live orrery ramps,
colour-meaning map, sim purity, keymap semantics.

### P5-C1 · Palette unification (FL-15a)
- **Changes:** `src/panels/mission-top.ts` + `ledger-fleet.ts` CSS: replace every hardcoded hex
  with `--*` tokens (`#49d7c9→--cyan` etc.); allowlist from P1-C2 goes empty for these two files.
- **Test:** the P1-C2 hex lint allowlist shrinks; visual diff screenshots before/after (tone should
  be nearly identical — any colour *meaning* change is a bug).
- **Risk:** LOW.

### P5-C2 · Bundled fonts + 4-step type scale
- **Changes:** `index.html`/`src/style.css`: `@font-face` (blocky display + legible mono, bundled);
  replace the 10 ad-hoc sizes (9→15 px incl. 11.5 half-pixel) with `cap9/ui11/body13/head16`.
- **Test:** screenshot A/B of MISSION + PAD + board; eyeball line-wrap regressions on tender rows.
- **Risk:** MED — 100% guaranteed wrap/overflow regressions on dense rows; budget a fix-up pass.

### P5-C3 · 4px spacing rhythm + gutter/rail geometry consolidation
- **Changes:** `shell.ts`: parameterize the hardcoded `GUTTER=4`, reconcile the 3 geometry
  authorities (`--gutter` token, reservedRightPx, hardcoded topbar/statusstrip heights); rail
  34→44 px with `writing-mode: vertical-rl` always-on labels; kill the two dead fake controls
  (topbar ●⛶✕, titlebar ⛶✕ — no handlers, cursor:default = affordance lie); add px min-size floor
  under the 12%/88% weight clamps.
- **Test:** WM layout unit tests (min-size floor, always-tiled under resize) + screenshots.
- **Risk:** MED — geometry-authority consolidation touches every preset; always-tiled invariant
  must be asserted in the tests.

### P5-C4 · Visible dither + focus affordances + preset-tab CSS
- **Changes:** `dither.ts`: dial sparse alphas 0.045→0.09/0.13/0.16 (or 8×8 Bayer); focused tile gets
  dither-heavy titlebar + focus glyph (redundant with border colour — CVD law); give `.tabs .tab`
  real CSS (currently zero — preset tabs render as bare inline text).
- **Test:** screenshot A/B incl. a colour-off purist shot (CVD exit check).
- **Risk:** LOW-MED (taste knob; keep alphas in a constants block for one-line tuning).

### P5-C5 · Hardware pixel cursor + boot sequence
- **Changes:** `style.css`/boot module: custom cursor asset (cursor: url, small hot-spot grid) +
  a short boot sequence on first paint (desktop mount, §8 retro-OS beat).
- **Test:** Playwright cold-load shot of boot frames; cursor hover state shots over pad/globe.
- **Risk:** LOW. Last because everything else must be final.

---

## Cross-verb dependency map

1. **P1-C2 copy/hex lint gates P2-C2, P3-C2, P4-C1, P4-C2** — every new surface string lands in
   `copy.ts` or the lint fails.
2. **P2-C1 slot state → the two-row comb reacts to loadout** (launch audit's "comb is not
   antenna-reactive" is closed by P2-C1+P2-C3, not by the launch phase).
3. **P2-C3 draftToSat(bus, loadout) → P4-C4 ring-drag live price** uses the truthful preview; do
   not build drag live-price before the preview is bus/card-truthful.
4. **Tender list changes pane layout** (P3-C2 adds rows to `NetContractRow` on the MISSION face —
   the same flex column the PAD shares with the rail; rail width touches P5-C3. Order P3 before P5
   so the rail is sized for the final row heights. This is the flagged "tender list vs layout"
   dependency.
5. **P4-C2 merged into re-pin #1**, NOT scheduled after P3 (the deviating resequencing — keeps
   total net-golden churn at two pins: P1-C1(+discount) and P3-C1; nothing else may move charged €).
6. **"Power" sim model:** flagged by the loadout audit as needing explicit user approval (AGENTS.md
   §1, `BusSpec.massKg` is dead data only). **Not in this plan** — a proposal goes to the user as
   SD-50 (PROPOSED), no code.
7. **Legacy rollback hazard:** `launchSat()`/`rollNetLaunch`/flat `NET_LAUNCH_FAILURE_CHANCE` still
   exist beside `launchBatch`; P4-C1 documents batch as authoritative in its decision entry; removal
   is a follow-up ticket (added to backlog, not in plan scope).

---

## 3. decisions.md entry skeletons (next free id: SD-46)

```markdown
## SD-46 — LOADOUT verb rebuilt: slot model, exploit fix, antenna-truthful preview
Status: ACCEPTED / Context: T1/T2 buses shipped G/S slots (R0) but the PAD editor kept a flat
set-model fallback; empty wire loadout fitted a FREE BROADCAST charged at €0 (apply-action guard);
comb + draft disc ignored the antenna. / Decision: slot-indexed (string|null)[] state + a
silhouette editor; default wire empty → priced BROADCAST, always validate; footprintRadiusRad +
draftToSat(bus, loadout) make preview bit-truthful for non-smallsat; suggestLoadout returns LEGAL
never optimal (planner lock). / Consequences: net-golden re-pin #1 (priced lean launches; with
SD-48 discount riding the same pin); consequence-truth invariant extended to comsat+ACCESS;
"power" explicitly NOT added (SD-50).

## SD-47 — CONTRACT texture: decaying pay, sign-on bonus, offer windows in Act 1
Status: ACCEPTED / Context: tenders were static steady-state rows; audit showed the machinery
(offerExpiresAtS, stepOfferedContract) already universal — Act 1 simply never armed it. /
Decision: additive fields offeredAtS/signOnBonusEur/signOnBonusUntilS/payDecayHalfLifeS;
acceptContract freezes decayedPayAtS(t); ACT1 gains a 2 h window, REGION-0 a €2,000/900 s sign-on,
and REGION-C (equatorial, pay 1.6×, half-life 1200 s). Penalty = 2× FROZEN pay (decays with pay;
asymmetry preserved — the audit's open question resolved pay-side-symmetric). Act-4 relay window:
{TBD — one line}. / Consequences: net-golden re-pin #2 (all act hashes); fold mixes 3 f64s after
offerExpiresAtS; economy theorem re-verified under decay; act-1 Infinity exemption dead.

## SD-48 — Batch manifest discount + single pricing function (resequenced onto re-pin #1)
Status: ACCEPTED / Context: launchStackCost amortized the vehicle implicitly; launch audit priced
this as a standalone commit moving the golden alone after other cost changes. / Decision:
NET_BATCH_MEMBER_DISCOUNT = 0.15 on hardware for members 2+, one function for preview AND applier
(preview.costEur legacy math deleted). Shipped INSIDE the SD-46 exploit-fix commit so both €
changes ride net-golden re-pin #1; later phases are golden-clean by construction. /
Consequences: deliberate deviation from the launch audit's step-2 ordering; two total re-pins for
the whole R-block, not three; pricing truth: PAD line == charged line (verified by test).

## SD-49 — LAUNCH embodiment: honest risk band, time-to-service, ring-grab aiming
Status: ACCEPTED / Context: failure rates (2/8/3%) were computed but never shown; no
time-to-service quantity existed; the draft ring was render-only while aim-drag already proved the
interaction. / Decision: pure launchFailureRates(count, armed) → PAD fact row, act-1 silent-zero
shown as NOTHING (never as "0%" — honesty ≠ noise); timeToServiceS forward-scans isPointServed
(Infinity renders "—"); pointer priority while pad open: draft-ring grab (vertical drag → altitude
inside NET_DRAFT_BOUNDS) → globe aim-drag → camera orbit; router solve throttled to 15 Hz during
drag. Batch pipeline declared the ONLY authoritative failure economics; legacy flat launchSat path
deprecated (removal: follow-up ticket). / Consequences: input-mode regression risk documented +
probe-tested (__dragOrbitProbe / __aimProbe); deploy payoff = pooled multi-arc + fresh-marker pop.

## SD-50 — PROPOSED: satellite power model (needs user approval — DO NOT BUILD)
Status: PROPOSED / Context: loadout editor's third trade-off axis would be power; BusSpec.massKg
is dead data, no power field exists anywhere in the sim. / Decision required from USER: wire
bus power budget vs card draw (ACCESS-L/GATEWAY throttling on T1?) or keep slots as the only
budget. Blocked: any code until explicitly approved (AGENTS.md §1 — never invent requirements).
```

## 4. backlog.md ticket drafts (append under the R3-follow-up block)

- [ ] **FL-01 — loadout exploit fix: priced default + always validate** · remove `cardIds.length>0`
  guard; `DEFAULT_LOADOUT_CARD_IDS=["BROADCAST"]`; `netLaunch` emits the default · net-golden
  re-pin #1 (with FL-11) · regression test assert €2,500 charged for absent/`[]` wire. (P1-C1)
- [ ] **FL-02 — copy-lint coverage + hardcoded-hex lint** · copy.ts fragments (tender bonus/decay/
  grace, risk band, discount row, slot labels); panels hex allowlist lint. (P1-C2)
- [ ] **FL-03 — slot-indexed loadout state + draft sync** · `(string|null)[]` per bus; duplicates
  legal; `netDraft.loadout` syncs from r1Cards (kills stale comb). (P2-C1)
- [ ] **FL-04 — PAD silhouette slot editor** · G1/G2/S1/S2 named slots replace flat card grid;
  Playwright drag/dup-fill script; redundant shape encoding. (P2-C2)
- [ ] **FL-05 — antenna-truthful preview** · `footprintRadiusRad(card,altM)`; `draftToSat(bus,
  loadout)`; consequence-truth invariant × comsat+ACCESS; draft disc sized by antenna not region.
  (P2-C3, golden-clean)
- [ ] **FL-06 — suggestLoadout (viable, never optimal)** · greedy legal fit per contract axes; FIT
  button on PAD. (P2-C4)
- [ ] **FL-07 — contract fields + ACT1 multi-tender** · offeredAtS/signOnBonusEur/
  signOnBonusUntilS/payDecayHalfLifeS + decayedPayAtS/signOnBonusAtS + acceptContract freeze;
  ACT1 2 h window + REGION-0 bonus + REGION-C; fold mix after offerExpiresAtS · net-golden re-pin
  #2 + lapse-replay test + economy theorem re-verified under decay. (P3-C1)
- [ ] **FL-08 — tender-board fact rows** · bonus countdown / decay note / breach-grace fact in
  NetContractRow; facts-only copy; colour-off shot. (P3-C2)
- [ ] **FL-09 — act-4 offer-window decision** · Mars relay tender clock yes/no; one-line scenario
  change + decisions note. (P3-C3)
- [ ] **FL-10 — honest launch risk band** · launchFailureRates(count, armed) + session
  failuresArmed getter + PAD fact row, act-1 = absent. (P4-C1)
- [ ] **FL-11 — batch manifest discount (−15% hardware, member 2+)** · rides FL-01's golden pin in
  commit P1-C1/P4-C2-merged; preview==applier single function; manifest row on PAD. (P4-C2)
- [ ] **FL-12 — timeToServiceS + pad facts** · forward-scan isPointServed; 0/positive/∞ pins. (P4-C3)
- [ ] **FL-13 — ring-grab orbit drag** · onNetDragOrbit + ring hit-test + pointer priority
  (ring → globe aim → camera) + 15 Hz solve throttle + __dragOrbitProbe; scripted pointer test.
  (P4-C4)
- [ ] **FL-14 — ring-pinned live readout + multi-arc launches + deploy pops** ·
  NetRenderState.draft.readout; pooled arcs for all events; fresh-marker pop. (P4-C5)
- [ ] **FL-15 — style overhaul (post-verbs)** · a) palette → tokens; b) bundled fonts + cap9/ui11/
  body13/head16 scale; c) gutter/rail/min-size geometry consolidation + kill fake controls; d)
  visible dither + redundant focus + preset-tab CSS; e) pixel cursor + boot. Hands-off: always-
  tiled, canvas reparenting, orrery ramps, colour-meaning map, sim, keymap. (P5)
- [ ] Follow-up (out of plan scope): retire legacy `launchSat()`/flat `NET_LAUNCH_FAILURE_CHANCE`
  path; power-model decision (SD-50, PROPOSED — needs user); WM minimize/collapse op.

---

*Plan of record for the 2026-07-03 audit consolidation. Deviations recorded: launch-audit step 2
(discount) resequenced into FL-01's commit; T-C1/T-C2/T-C4 fused into one golden-pin commit; launch
steps 3 (preview truth) absorbed by FL-05 in the loadout phase so the drag phase builds on a
truthful preview.*
