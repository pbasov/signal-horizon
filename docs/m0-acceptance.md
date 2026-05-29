# M0 Acceptance — the "money shot" rubric

> The bar M0 must clear before it's called done. Headless smoke (no script errors) is necessary but **not** sufficient — M0 is fundamentally *visual*, so the real gate is a screenshot of the running Ops Console judged against this rubric. This is the checklist I run after the integration workflow (`wd2b092ff`) lands: launch the project, capture `screenshots/latest.png`, and verify each line.

## A. Headless (automated, gate-blocking)
- [ ] `./tools/check_sim_purity.sh` still OK (integration didn't pollute `sim/`).
- [ ] `godot --headless --import` clean (no parse/shader/resource errors).
- [ ] All foundation suites still green (`dotnet test SignalHorizon.Sim.Tests`) — integration didn't regress the truth layer or determinism golden-master.
- [ ] `scenes/ops_console.tscn` loads and runs headless with no SCRIPT ERROR.

## B. Visual (screenshot, the actual money shot)
- [ ] **Tiling shell (DD-8):** non-overlapping tiles fill the screen, 1-bit chrome (white-on-near-black, dithered title bars). Orrery-dominant default preset. Preset switch (keys) re-tiles without overlap.
- [ ] **Monochrome machine, living signal:** chrome is strictly 1-bit; the orrery + data carry colour. No global flatten — the orrery is *not* monochrome.
- [ ] **Orrery driven by the real sim:** Sun + Earth + Moon + Mars (+ sats) as dithered-circle bodies at believable relative positions; dashed orbit rings; starfield; time controls advance them (orbits move, not faked spin).
- [ ] **The packet crawl:** a coloured packet travels Earth→Mars along the link, visibly slowly.
- [ ] **Freshness drains:** the packet (or a sample) desaturates toward machine-grey as it ages.
- [ ] **Always-visible status strip:** links up/total, occult countdown, cash — present in every preset.
- [ ] **LIGHT-DELAY panel** lists MOON/GEO/MARS one-way times with coloured bars.
- [ ] Body labels legible; SYSTEM.LOG cycling; NETWORK·FINANCE present.

## C. The honesty check (make-or-break, GDD §5 / DD-2)
- [ ] **The on-screen packet travel time MATCHES the LIGHT-DELAY · MARS readout.** Both derive from the same `Sim.distance("earth","mars")` → `SignalDelay.one_way_seconds()`. If the crawl and the number disagree, the whole thesis reads as fake — this is the single most important check.
- [ ] Camera fly + click-to-focus a body works; focus rebases the floating origin (no jitter).

## On PASS
Commit + push the integration, flip M0-05..13 / M0-09r/10/11/12 in the backlog, declare **M0 done**, and open the **M1 fun-gate** (the kill-gate: "is optimising light-delayed information flow fun for 30 min?"). M0's visible packet-to-Mars is M1's onboarding teacher.

## On FAIL (visual)
Iterate the visualisation directly (my run→screenshot→fix loop), not a fresh fan-out — per GDD Risk 2, the remedy for a weak money shot is sharpening the *visualisation*, not adding scope.
