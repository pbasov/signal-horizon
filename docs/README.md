# Signal Horizon — Documentation Index

A satellite & information-network tycoon sim. Working title **Signal Horizon**.
The product you sell is *knowledge moved across distance*; the speed of light is the hardest constraint.

**Stack:** TypeScript + Three.js (WebGL2) + Vite, browser-native (Chromium). Migrated from Godot 4.6 C# — see `FINDINGS.md` for the spike verdict and `decisions.md` (SD-10) for the migration decision.

## Read in this order

| # | Doc | What it is | Status |
|---|---|---|---|
| 1 | [signal-horizon-gdd.md](signal-horizon-gdd.md) | **Game Design Document** — the *what/why*. Vision, pillars, systems, art direction. | Living (v0.8.1) |
| 2 | [signal-horizon-m1.md](signal-horizon-m1.md) | **M1 — The Fun-Gate** — the concrete mechanics + build design + onboarding script for the Earth-orbit connectivity game. Part I mechanics spec, Part II build-ready design, Part III acts 3–4 design, Part IV onboarding script. | Current (v0.2) |
| 3 | [signal-horizon-implementation-plan.md](signal-horizon-implementation-plan.md) | **Implementation Plan** — the *how/when*. Phases, milestones, prose ticket spec. | Current (v0.2.1) |
| 4 | [backlog.md](backlog.md) | **Ticket Backlog** — trackable checklist (P0/M0 detailed, M1–M6 headlines). | Living |
| 5 | [decisions.md](decisions.md) | **Decision Log** — design (DD-N) + engineering (SD-N) decisions, status, rationale. | Living |
| 6 | [sim-render-contract.md](sim-render-contract.md) | **Sim ↔ Render Contract** — the f64-truth / f32-render boundary. Stack-agnostic interface spec. | v1 |
| 7 | [tiling-wm-spec.md](tiling-wm-spec.md) | **Tiling WM Spec (DD-10)** — zone-grid + mouse zone-snapping + presets. | ACCEPTED |
| 8 | [m1-redesign.md](m1-redesign.md) | **M1 Redesign — FIRST LIGHT** — the from-scratch gameplay/launcher/UX redesign (supersedes M1 Parts II–IV's presentation layer). LAW 1 + LAW 2 live here. | ACCEPTED (SD-45) |
| 9 | [routing-screen.md](routing-screen.md) | **The Routing Screen — TRACE** — GDD §5 view #4 built: the two-level FLOWS/PIPES routing table, its levers, its orrery coupling, and its build ramp. | ACCEPTED (SD-53) |

## Reference

- [mockups/](mockups/) — Ops Console visual targets. **`v3-1..5-*.png` are the definitive target** (the five tiling presets — OVERVIEW/INFRA/MARKETS/LAUNCH/COVERAGE — realized). `explore-v2-*` are earlier exploration.
- [screenshots/](screenshots/) — Spike verification captures (Chromium headful).
- [progress/](progress/) — Development journal.

## Root-level

- [`FINDINGS.md`](../FINDINGS.md) — Spike deliverable: can the UX be built more naturally in TS/Three.js? (Short answer: yes.)

## Doc precedence

GDD wins on design; the implementation plan wins on sequencing; the M1 doc is the mechanics/build authority for the fun-gate milestone; backlog/decisions are how we execute and track. When two docs disagree, the higher-precedence one wins and the lower should be updated.

## Current state (2026-06-17)

Pre-production, browser-native TS/Three.js/Vite. M0 spike done; M2 Earth slice built (SD-27..SD-34); M1 (the net/ connectivity game, Acts 1–4 + P0–P4 remediation) built and green (697 tests). The M1 fun-gate is built and waiting to be run. See [backlog.md](backlog.md) and [decisions.md](decisions.md) (SD-40 series) for the live frontier.
