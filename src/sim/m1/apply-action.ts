/**
 * M1-06 — SHARED action application: the ONE place that turns a recorded
 * {@link SimAction} into a mutation of the live ({@link M1Session}, clock-tick)
 * pair. Both the LIVE loop (main.ts) and the REPLAY driver call this so the two
 * paths cannot drift in WHEN or HOW an action lands.
 *
 * ORDERING CONTRACT (E3 determinism fix): a prefetch is applied AFTER the tick's
 * {@link M1Session.step} — i.e. post-drain, exactly where main.ts's keypress
 * fires (the player presses P after the frame's ticks have drained, at the
 * current clock tick) and matching the existing set_time_scale "apply after the
 * step" convention in save-replay.test.ts. Applying it BEFORE the step would
 * diverge whenever step(T) itself would start a miss-fetch: the gate
 * "one fetch in flight at a time" makes the prefetch a no-op in one ordering but
 * not the other. Anchoring BOTH to post-step makes a prefetch recorded live at
 * tick T and the same action replayed produce bit-identical state.
 *
 * PURE + DETERMINISTIC: a pure function of (eph, session, action, dt). No three /
 * DOM / wall-clock / RNG.
 */
import type { Ephemeris } from "../ephemeris";
import { KIND_PREFETCH, type SimAction } from "../action";
import type { M1Session } from "./session";

/**
 * Apply any session-mutating action recorded at `tick` to `session`, AFTER that
 * tick's {@link M1Session.step} has already run. Returns true iff the action
 * actually mutated the session (e.g. a prefetch that launched + charged) — the
 * caller (live) uses this to decide whether to launch the visible Mission packet.
 *
 * `set_time_scale` / `noop` are NOT handled here: the time-scale acts on the
 * CLOCK's fill rate (it is applied by the loop's own scale bookkeeping), not on
 * the session, so this helper is the single point only for session-state actions.
 */
export function applySessionAction(
  eph: Ephemeris,
  session: M1Session,
  action: SimAction,
  dt: number,
): boolean {
  if (action.kind === KIND_PREFETCH) {
    // The prefetch fires at the action's recorded tick, in sim-seconds. main.ts
    // records at_tick = clock.tick (the last drained tick) and prefetches at
    // clock.seconds = tick · dt, so replay must use the identical instant. The
    // multi-feed session returns the TARGETED feed id (or null when nothing is
    // eligible); coerce to the boolean "did it mutate" the caller expects.
    return session.prefetch(eph, action.atTick * dt) !== null;
  }
  return false;
}
