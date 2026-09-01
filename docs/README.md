# Signal Horizon — Documentation Index

A satellite & information-network tycoon sim. Working title **Signal Horizon**.
The product you sell is *knowledge moved across distance*; the speed of light is the hardest constraint.

**Stack:** TypeScript + Three.js (WebGL2) + Vite, browser-native (Chromium). Migrated from Godot 4.6 C# — the spike verdict and the migration decision are recorded in `decisions.md` (SD-10).

## Read in this order

| # | Doc | What it is | Status |
|---|---|---|---|
| 1 | [signal-horizon-gdd.md](signal-horizon-gdd.md) | **GDD v0.9** — the *why/feel*. Simple English. The design review (GP items) and the player-attack core are merged in. | Living (v0.9, SD-54) |
| 2 | [signal-horizon-m1.md](signal-horizon-m1.md) | **M1 mechanics** — Part I only (mechanics canon). Parts II–IV were superseded by m1-redesign and pruned (SD-54); git history keeps them. | v0.2 (pruned) |
| 3 | [m1-redesign.md](m1-redesign.md) | **FIRST LIGHT** (SD-45) — the M1 gameplay/launcher/UX authority. LAW 1 + LAW 2 live here. | ACCEPTED |
| 4 | [first-light-integrated-plan.md](first-light-integrated-plan.md) | FL ticket consolidation (4-audit build plan). Its SD-46..50 skeletons are consumed (SD-46..53 recorded); the FL ticket spec still points here. | Partially consumed |
| 5 | [routing-screen.md](routing-screen.md) | **TRACE** (SD-53) — the build design for GDD §5 view #4. | ACCEPTED |
| 6 | [signal-horizon-implementation-plan.md](signal-horizon-implementation-plan.md) | **Implementation Plan** — the *how/when*. Sequencing authority. | v0.2.1 |
| 7 | [backlog.md](backlog.md) | **Ticket Backlog** — trackable checklist. | Living |
| 8 | [decisions.md](decisions.md) | **Decision Log** — DD-N + SD-N, status, rationale. | Living |
| 9 | [sim-render-contract.md](sim-render-contract.md) | **Sim ↔ Render Contract** — the f64-truth / f32-render boundary. | v1 |
| 10 | [tiling-wm-spec.md](tiling-wm-spec.md) | **Tiling WM Spec** (DD-10). | ACCEPTED |

## Reference

- [signal-horizon-setting.md](signal-horizon-setting.md) — **The Setting** v0.4 (SD-58). Scenery only: why anyone is at the Moon and Mars, and why information is precious. Zero authority over mechanics — delete it and every rule still stands. §10 ruled 2026-09-01.
- [signal-horizon-beats.md](signal-horizon-beats.md) — **The Beats** v0.2 DRAFT (SD-58). The narrative *content*: the cast, the four channels, the tender/Wire/Registry grammar, twenty-eight beats across four eras, and the unlicensed P-thread. Eras add no systems; the P-thread does.
- [mockups/](mockups/) — Ops Console visual targets.
- [screenshots/](screenshots/) — Spike verification captures (Chromium headful).

## Doc precedence

GDD wins on design. The implementation plan wins on sequencing. The M1 family (m1 doc Part I + m1-redesign + routing-screen) is the mechanics/build authority for the fun-gate milestone. Backlog and decisions execute and track. When two docs disagree, the higher-precedence one wins and the lower must be updated.

## Current state (2026-09-01)

Pre-production, browser-native TS/Three.js/Vite. M0 spike done. The M2 Earth slice is built (SD-27..34). The first M1 build was condemned and redesigned as FIRST LIGHT (SD-45); the First Light build-out is the live track (SD-46..53, most recent 2026-08-19). No gate-run result is recorded in `decisions.md` — the M1 fun-gate run is the next decision point. See [backlog.md](backlog.md) and [decisions.md](decisions.md) (SD-40+) for the live frontier.

## Deleted docs (SD-54)

- `signal-horizon-gdd-simple.md` — superseded: the GDD itself is now the simple-English version.
- `gdd-proposal.md` — merged into GDD v0.9.
- `signal-horizon-player-attack.md` — the core (six falsifiable claims + revise-by-subtraction) is merged into GDD §9. Git history keeps the full text.
- `FINDINGS.md` (root) and the `docs/progress/` journal — deleted outside SD-54; git history keeps them. The spike verdict lives in `decisions.md` (SD-10).
