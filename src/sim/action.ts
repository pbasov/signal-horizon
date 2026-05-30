/**
 * A single player/system action in the deterministic action log (P0-05 / B2).
 *
 * Plain, serializable data: a `kind` discriminator, the `atTick` it applies at,
 * and a small payload bag. A faithful port of SignalHorizon.Sim/SimAction.cs —
 * lives in the pure sim layer because it is data-only and touches no DOM, no
 * `three`, no wall-clock, no RNG.
 *
 * --- JSON KEY CASING -------------------------------------------------------
 * The in-memory TS shape uses the camelCase convention of src/sim (`atTick`),
 * but the serialized DICT mirrors the C#/GDScript wire format EXACTLY —
 * snake_case keys `kind` / `at_tick` / `payload` — so a save written by either
 * runtime loads in the other. `atTick` is folded into ticks as an integer.
 */

/** JSON-safe scalar/container. Payload values must round-trip through JSON. */
export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

/** Plain dictionary form, matching SimAction.ToDict() / FromDict() in C#. */
export interface SimActionDict {
  kind: string;
  at_tick: number;
  payload: Record<string, JsonValue>;
}

/** The known action kinds (mirrors SimAction.KindNoop / KindSetTimeScale). */
export const KIND_NOOP = "noop";
export const KIND_SET_TIME_SCALE = "set_time_scale";
/**
 * M1-06 — a player-initiated prefetch: pre-position fresh data into the Mars
 * cache. Carries no payload (the target dataset is the standing demand's); the
 * `atTick` is what makes it deterministic on replay.
 */
export const KIND_PREFETCH = "prefetch";
/**
 * E8 (M1-06b) — the player CHANGES the standing prefetch policy (the tame-it
 * lever). The autopilot's PER-STEP choices are a pure function of (policy, state)
 * derived inside step(), so they need no logging; only this CHANGE of intent is a
 * player action. Payload carries the policy knobs the UI can set: `mode`,
 * `freshnessFloor`, `blackoutLeadS`, `maxConcurrentAuto`. Applied at `atTick`.
 */
export const KIND_SET_PREFETCH_POLICY = "set_prefetch_policy";
/**
 * M2c — the player DEPLOYS a GROUND STATION (the build-the-monument loop, GDD §3).
 * Payload carries the candidate SITE index the deploy targets (a deterministic,
 * keyed pick from a fixed candidate list — no globe-raycast UI yet); the session
 * resolves the index to a lat/lon, charges €, and adds the station to the roster.
 * Applied at `atTick` via the shared applier so live + replay agree.
 */
export const KIND_DEPLOY_GROUND = "deploy_ground";
/**
 * M2c — the player LAUNCHES a SATELLITE (GDD §4.7 launch market). Payload carries
 * the launch-preset id (LEO/MEO/GEO). The session charges the preset's €, rolls the
 * deterministic failure chance from the SEEDED splitmix64 PRNG, and on success adds
 * the sat to the roster (a failed launch eats the € and adds nothing). Applied at
 * `atTick` so the recorded roll + outcome replay bit-identically.
 */
export const KIND_LAUNCH_SAT = "launch_sat";

/**
 * A deterministic action. `payload` is deep-copied on construction so mutations
 * never leak across instances (matching the C# DeepCopy semantics).
 */
export interface SimAction {
  kind: string;
  /** The tick this action applies at. Always an integer. */
  atTick: number;
  payload: Record<string, JsonValue>;
}

/** Deep-copy a JSON-safe payload bag (structuredClone is value-only here). */
function deepCopyPayload(src: Record<string, JsonValue> | undefined): Record<string, JsonValue> {
  if (src == null) return {};
  return structuredClone(src);
}

/** Construct a SimAction with a deep-copied payload (mirrors the C# ctor). */
export function simAction(
  kind: string = KIND_NOOP,
  atTick = 0,
  payload?: Record<string, JsonValue>,
): SimAction {
  return { kind, atTick, payload: deepCopyPayload(payload) };
}

/** No-op marker at a tick (determinism breadcrumb / placeholder). */
export function noop(atTick = 0): SimAction {
  return simAction(KIND_NOOP, atTick, {});
}

/**
 * Change the time-scale at a tick. The value is data only here; the scheduler
 * (B3) interprets it on replay. Mirrors SimAction.SetTimeScale.
 */
export function setTimeScale(value: number, atTick = 0): SimAction {
  return simAction(KIND_SET_TIME_SCALE, atTick, { value });
}

/**
 * M1-06 — issue a player prefetch at a tick. No payload: the session prefetches
 * the standing demand's dataset. On replay this is applied at `atTick`, so a
 * recorded prefetch reproduces the exact cache + economy outcome it caused live.
 */
export function prefetch(atTick = 0): SimAction {
  return simAction(KIND_PREFETCH, atTick, {});
}

/**
 * E8 — change the standing prefetch policy at a tick. The knobs round-trip through
 * the JSON payload (all numbers/strings), and applying it at `atTick` on replay
 * sets the policy at the SAME instant it changed live — so the DERIVED autopilot
 * prefetches reproduce bit-identically with no per-step logging.
 */
export function setPrefetchPolicy(
  mode: string,
  freshnessFloor: number,
  blackoutLeadS: number,
  maxConcurrentAuto: number,
  atTick = 0,
): SimAction {
  return simAction(KIND_SET_PREFETCH_POLICY, atTick, {
    mode,
    freshnessFloor,
    blackoutLeadS,
    maxConcurrentAuto,
  });
}

/**
 * M2c — deploy a ground station at a candidate SITE index, at a tick. The session
 * resolves the index to a fixed lat/lon, so recording the index (not the lat/lon)
 * keeps the action small and the resolution deterministic on both paths.
 */
export function deployGround(siteIndex: number, atTick = 0): SimAction {
  return simAction(KIND_DEPLOY_GROUND, atTick, { siteIndex: Math.trunc(siteIndex) });
}

/**
 * M2c — launch a satellite into a preset orbit, at a tick. The preset id round-trips
 * through the payload; the launch's deterministic failure roll is drawn at `atTick`
 * inside the session (from the seeded PRNG), so live + replay reach the same outcome.
 */
export function launchSat(presetId: string, atTick = 0): SimAction {
  return simAction(KIND_LAUNCH_SAT, atTick, { presetId });
}

/** Coerce an arbitrary JSON value to an integer tick (JSON ints arrive as number). */
function toInt(v: JsonValue | undefined): number {
  if (typeof v === "number") return Math.trunc(v);
  if (typeof v === "string") {
    const p = Number.parseInt(v, 10);
    return Number.isNaN(p) ? 0 : p;
  }
  return 0;
}

/**
 * Serialize to a plain dictionary (JSON-safe; payload deep-copied). Wire keys
 * are snake_case to match the C#/GDScript format exactly.
 */
export function actionToDict(a: SimAction): SimActionDict {
  return {
    kind: a.kind,
    at_tick: a.atTick,
    payload: deepCopyPayload(a.payload),
  };
}

/**
 * Rebuild from a dictionary produced by {@link actionToDict}. Tolerant of
 * missing keys so older/newer saves still load (forward/backward friendly).
 */
export function actionFromDict(d: Partial<SimActionDict> | Record<string, JsonValue>): SimAction {
  const raw = d as Record<string, JsonValue>;
  const kind = typeof raw.kind === "string" ? raw.kind : KIND_NOOP;
  const atTick = toInt(raw.at_tick);
  const payload =
    raw.payload != null && typeof raw.payload === "object" && !Array.isArray(raw.payload)
      ? deepCopyPayload(raw.payload as Record<string, JsonValue>)
      : {};
  return simAction(kind, atTick, payload);
}
