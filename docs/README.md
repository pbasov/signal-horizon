# Signal Horizon — Documentation Index

A satellite & information-network tycoon sim. Working title **Signal Horizon**.
The product you sell is *knowledge moved across distance*; the speed of light is the hardest constraint.

**Stack:** Tauri 2.x + TypeScript + Three.js + Vite. Migrated from Godot 4.6 C# — see `FINDINGS.md` for the spike verdict and `decisions.md` (SD-10) for the migration decision.

## Read in this order

| # | Doc | What it is | Status |
|---|---|---|---|
| 1 | [signal-horizon-gdd-v0.5.md](signal-horizon-gdd-v0.5.md) | **Game Design Document** — the *what/why*. Vision, pillars, systems, art direction. | Current (v0.5) |
| 2 | [signal-horizon-implementation-plan-v0.1.md](signal-horizon-implementation-plan-v0.1.md) | **Implementation Plan** — the *how/when*. Phases, milestones, prose ticket spec. Adapted for TS/Three.js/Tauri stack. | Current (v0.1, stack-adapted) |
| 3 | [signal-horizon-scoping-v0.1.md](signal-horizon-scoping-v0.1.md) | **Engineering Scoping** — gap analysis against the plan, first-work order. Adapted for TS/Three.js/Tauri stack. | Current (v0.1, stack-adapted) |
| 4 | [backlog.md](backlog.md) | **Ticket Backlog** — trackable checklist (P0/M0 detailed, M1–M6 headlines). Merged spike + Godot status. | Living |
| 5 | [decisions.md](decisions.md) | **Decision Log** — design + engineering decisions, status, rationale. Merged spike (SD-N) + design (DD-N). | Living |
| 6 | [sim-render-contract.md](sim-render-contract.md) | **Sim ↔ Render Contract** — the f64-truth / f32-render boundary. Stack-agnostic interface spec. | v0 |
| 7 | [tiling-wm-spec.md](tiling-wm-spec.md) | **Tiling WM Spec (DD-10)** — zone-grid + mouse zone-snapping + presets. | ACCEPTED |
| 8 | [m0-acceptance.md](m0-acceptance.md) · [ui-exploration-v2.md](ui-exploration-v2.md) · [ui-critique-punchlist.md](ui-critique-punchlist.md) | **M0 rubric** + **UI exploration** (phased, not a spec) + **critique punch-list** (ordered fixes). | living |

## Reference

- [mockups/](mockups/) — Ops Console visual targets. **`v3-1..5-*.png` are the definitive target** (the five tiling presets — OVERVIEW/INFRA/MARKETS/LAUNCH/COVERAGE — realized). `explore-v2-*` are earlier exploration.
- [screenshots/](screenshots/) — Spike verification captures (Chromium headful).
- [progress/](progress/) — Development journal.

## Root-level

- [`FINDINGS.md`](../FINDINGS.md) — Spike deliverable: can the UX be built more naturally in TS/Three.js? (Short answer: yes.)

## Doc precedence

GDD wins on design; the implementation plan wins on sequencing; scoping/backlog/decisions are how we execute and track. When two docs disagree, the higher-precedence one wins and the lower should be updated.

## Current state (2026-05-29)

Pre-production, migrated to Tauri + TS + Three.js. The spike proved M0's full visual scope works in the web stack with bit-identical Kepler truth. **Next:** P0-GATE — wrap in Tauri and validate under WebKitGTK — then port the deterministic fixed-tick + save/replay backbone. See [backlog.md](backlog.md).
