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
import { KIND_PREFETCH, KIND_SET_PREFETCH_POLICY, type SimAction } from "../action";
import type { M1Session } from "./session";
import type { PrefetchMode, PrefetchPolicy } from "./policy";

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
  if (action.kind === KIND_SET_PREFETCH_POLICY) {
    // E8 — the player CHANGED the standing policy (the tame-it lever). Apply it at
    // the SAME tick in live + replay so the autopilot's DERIVED per-step choices
    // (a pure function of policy + state, run inside step()) reproduce
    // bit-identically with no per-step logging. The mutation always "took", so
    // return true (the live caller treats it as a state change).
    session.setPolicy(policyFromPayload(action));
    return true;
  }
  return false;
}

/** The valid policy modes, used to validate a replayed payload defensively. */
const POLICY_MODES: readonly PrefetchMode[] = ["manual", "freshness", "freshness_blackout"];

/**
 * Read a {@link PrefetchPolicy} out of a set_prefetch_policy action payload.
 * Tolerant of missing/garbage fields (an older or hand-edited save) — it falls
 * back to safe defaults so replay never throws; {@link M1Session.setPolicy}
 * then clamps the numeric knobs.
 */
function policyFromPayload(action: SimAction): PrefetchPolicy {
  const p = action.payload;
  const rawMode = typeof p.mode === "string" ? p.mode : "manual";
  const mode = (POLICY_MODES as readonly string[]).includes(rawMode)
    ? (rawMode as PrefetchMode)
    : "manual";
  return {
    mode,
    freshnessFloor: typeof p.freshnessFloor === "number" ? p.freshnessFloor : 0.6,
    blackoutLeadS: typeof p.blackoutLeadS === "number" ? p.blackoutLeadS : 1200,
    maxConcurrentAuto: typeof p.maxConcurrentAuto === "number" ? p.maxConcurrentAuto : 3,
  };
}
