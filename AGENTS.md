# AGENTS.md — Rules for Automated Contributors

These rules are **mandatory** for every change to this codebase, whether by a human or an AI agent. Violating any rule is a bug.

---

## 1. Ground yourself in the design document

- The **GDD** (`docs/signal-horizon-gdd.md`) is the design authority. Every feature, behavior, and naming convention traces back to it.
- The **sim↔render contract** (`docs/sim-render-contract.md`) is the single boundary that keeps the truth layer pure and the render layer honest. Read it before touching anything in `src/sim/` or `src/orrery/`.
- The **backlog** (`docs/backlog.md`) tracks what's done and what's next. The **decisions log** (`docs/decisions.md`) records why. Read both before starting any ticket.
- The **implementation plan** (`docs/signal-horizon-implementation-plan.md`) is the sequencing authority and defines milestones and acceptance criteria. Where the backlog and plan disagree on build order, the plan wins. The **scoping doc** (`docs/signal-horizon-scoping-v0.1.md`) is historical context, superseded by the implementation plan.
- **Never invent requirements.** If the GDD doesn't call for it, don't build it. If you're unsure, say so and ask.
- **Never modify the GDD without explicit user instruction.** The game design document is the user's domain. Autonomous agents may propose changes (suggest, don't edit) but must not alter GDD content unless the user explicitly approves each change.

---

## 2. Always write tests

- Every new module in `src/sim/` **must** have a corresponding Vitest test file. Pure sim code is engine-agnostic and must be unit-tested in isolation.
- Every bugfix **must** include a test that fails without the fix and passes with it.
- Golden-master pins (e.g. `ephemeris.test.ts`, `rng.test.ts`) are non-negotiable — they prove bit-identity against the C# reference implementation.
- Test behavior, not implementation. Assert invariants and outputs, not internal state.
- Run `npm test` before declaring any change done. All existing tests must pass.

---

## 3. Use Playwright for frontend changes

- Any change to `src/orrery/`, `src/wm/`, `src/panels/`, `src/style.css`, or `index.html` is a **frontend change**.
- Frontend changes **must** be verified with a Playwright screenshot using `tools/shoot.mjs` or a headful test. "It compiles" is not sufficient.
- Visual regressions are bugs. Compare screenshots before and after when changing rendering, layout, or styling.
- The app runs at `http://localhost:5173` via `npm run dev`. Start it before shooting.
- For complex UI changes, write a Playwright test script, not just a one-off screenshot.

---

## 4. UX is paramount

- Signal Horizon is a **desktop-only** experience. No mobile layouts, no responsive breakpoints.
- The 1-bit chrome aesthetic is intentional. Chrome uses dither for tonal variation, never colour. Signal uses colour with redundant shape/dither encoding (CVD-safe).
- The tiling WM shell means **every pixel is occupied**. No dead space, no collapsing panels. Always-tiled invariant.
- Keyboard-first interaction (preset keys 1–5, camera keys C/O/S/T, time controls Space/,/. ). Mouse is secondary.
- The speed of light is the central constraint. Any display of light-delay, freshness, or packet progress **must** be physically honest — no faked animations.
- Before changing any visual or interaction, re-read the GDD §8 (styling), the tiling-WM spec (`docs/tiling-wm-spec.md`), and the UI critique (`docs/ui-critique-punchlist.md`).
- **CVD safety:** every colour encoding must have a redundant channel (shape, dither density, or glyph). "Colour-off fully playable" is a per-milestone exit check.

---

## 5. Architecture rules

- `src/sim/` is **pure TypeScript** with zero DOM or Three.js imports. The sim never returns a `Vector3` (that's 32-bit). It returns `number[]` or plain `double`.
- `src/orrery/` owns the **only** f64→f32 crossing (floating-origin rebase). Nowhere else converts.
- `src/wm/` owns the tiling window manager. Panels are DOM; the orrery is Three.js canvas. They share the zone grid, not the rendering.
- Deterministic code uses `SimClock` (integer tick × DT) and `SimRng` (splitmix64 bigint). Never `Date.now()` or `Math.random()` in `src/sim/`.
- No premature abstraction. Delete code that isn't pulling its weight.

---

## 6. Always update backlog.md and decisions.md

- **Every completed ticket** must be ticked `[x]` in `docs/backlog.md`. Every started ticket must be marked `[~]`.
- **Every architectural or design decision** must be recorded in `docs/decisions.md` — status (PROPOSED / ACCEPTED / SUPERSEDED / DEPRECATED), context, rationale, and consequences.
- If a ticket's scope changed during implementation, update its description in the backlog to match what was actually built.
- If a new cross-cutting concern or follow-up emerged, add it to the backlog.
- If a spike or experiment produced a decision, record it in decisions.md with the relevant SD/D label.
- **Do this as part of the same commit** as the code change, not as a separate cleanup later. Stale docs are bugs.

---

## 7. Commit discipline

- One logical change per commit. Don't bundle unrelated refactors with feature work.
- Commit messages must reference the ticket (e.g. `P0-05: Add action-log save format`).
- Run `npm test && npx tsc --noEmit && npm run build` before every push.
- **Always push immediately after committing.** Do not batch commits locally — push after each commit so the remote stays current and work is never lost.