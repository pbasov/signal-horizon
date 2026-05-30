/**
 * M2c — SHARED build-action application: the ONE place that turns a recorded
 * {@link SimAction} into a mutation of a {@link BuildSession}. Both the LIVE loop
 * (main.ts) and the REPLAY driver call this so the two paths cannot drift in WHEN
 * or HOW a deploy/launch lands — the same determinism contract M1's
 * applySessionAction holds for prefetch/policy.
 *
 * ORDERING: like the M1 prefetch, a build action is applied AFTER the tick it is
 * recorded at (post-drain — where main.ts's keypress fires). M2d added a per-tick
 * {@link BuildSession.step} (the contract economy), so the ordering is now: each tick
 * step(t) runs first (offers/expires contracts + accrues revenue), THEN any build
 * action recorded at that tick applies post-step. Both the live loop and the replay
 * driver follow that same "step then post-drain action at atTick" order, so a
 * deploy/launch/accept/decline lands at the same instant on both paths.
 *
 * PURE + DETERMINISTIC: a function of (eph, session, action). The launch's failure
 * roll is drawn from the session's SEEDED splitmix64 PRNG (advanced by exactly one
 * u64 per launch), never the unseeded JS random — so a recorded launch reproduces
 * its success/failure outcome on replay.
 */

import type { Ephemeris } from "../ephemeris";
import {
  KIND_ACCEPT_CONTRACT,
  KIND_DECLINE_CONTRACT,
  KIND_DEPLOY_GROUND,
  KIND_LAUNCH_SAT,
  KIND_PLACE_DC,
  type SimAction,
} from "../action";
import type { BuildSession, BuildActionResult } from "./session";

/**
 * Apply a build action recorded at `action.atTick` to `session`. The launch needs
 * the sim-time the sat reaches orbit, derived from the recorded tick: t = atTick·dt
 * (the SAME instant main.ts launches at live), so the orbit epoch is reproducible.
 * Returns the {@link BuildActionResult} (or null for a non-build action), which the
 * live caller uses to decide whether to record the action + surface feedback.
 */
export function applyBuildAction(
  _eph: Ephemeris,
  session: BuildSession,
  action: SimAction,
  dt: number,
): BuildActionResult | null {
  if (action.kind === KIND_DEPLOY_GROUND) {
    const idx = typeof action.payload.siteIndex === "number" ? Math.trunc(action.payload.siteIndex) : 0;
    return session.deployGround(idx);
  }
  if (action.kind === KIND_LAUNCH_SAT) {
    const presetId = typeof action.payload.presetId === "string" ? action.payload.presetId : "";
    return session.launchSat(presetId, action.atTick * dt);
  }
  if (action.kind === KIND_ACCEPT_CONTRACT) {
    const id = typeof action.payload.contractId === "string" ? action.payload.contractId : "";
    // The activation timestamp is the recorded instant (atTick·dt), the SAME sim-time
    // main.ts accepts at live — so the contract begins its term at a reproducible t.
    return session.acceptContract(id, action.atTick * dt);
  }
  if (action.kind === KIND_DECLINE_CONTRACT) {
    const id = typeof action.payload.contractId === "string" ? action.payload.contractId : "";
    return session.declineContract(id);
  }
  if (action.kind === KIND_PLACE_DC) {
    const idx = typeof action.payload.siteIndex === "number" ? Math.trunc(action.payload.siteIndex) : 0;
    return session.placeDatacenter(idx);
  }
  return null;
}
