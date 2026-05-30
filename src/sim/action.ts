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
 * M2d — the player ACCEPTS an OFFERED contract (the build-the-monument loop earns,
 * GDD §3/§4.9). Payload carries the contract id; the session moves that contract
 * OFFERED → ACTIVE at `atTick` so it begins accruing revenue from the live coverage of
 * its target region. Applied via the shared applier so live + replay agree. The offer
 * GENERATOR (which offers + auto-expires contracts) is deterministic in the session's
 * per-tick step() and needs no action — only the accept/decline are logged player intent.
 */
export const KIND_ACCEPT_CONTRACT = "accept_contract";
/**
 * M2d — the player DECLINES an OFFERED contract. Payload carries the contract id; the
 * session retires that offer (OFFERED → FAILED, i.e. not taken) at `atTick`. Logged so
 * the offer board state reproduces on replay.
 */
export const KIND_DECLINE_CONTRACT = "decline_contract";
/**
 * M3a — the player PLACES an ORBITAL DATACENTER (GDD §4.5 compute as infrastructure). Payload
 * carries the candidate DC SITE index (a deterministic keyed pick from a fixed candidate list —
 * no globe-raycast yet); the session resolves the index to a body + sub-point, charges the DC
 * capex €, and adds the node to the DC roster. Applied at `atTick` via the shared applier so
 * live + replay agree. A DC is a SMALL number of high-impact strategic nodes (Risk-5).
 */
export const KIND_PLACE_DC = "place_dc";

// --- M1-as-one-game (the net/ connectivity game, design §4) ----------------------
// The net/ NetSession's action boundary. These are ADDITIVE — they do not touch any
// existing kind, and the net/ replay carries its OWN golden (the m1/m2 goldens are
// untouched). All net_launch planner params cross the wire as RADIANS + SI METRES.

/**
 * net/ A2 — the player LAUNCHES a satellite via the consequence-preview planner (design
 * §2.3/§4). Payload `{ presetId?: string, semiMajorM, incRad, subLonRad, count, phaseSpreadRad? }`:
 * `semiMajorM` is the semi-major axis in METRES, `incRad`/`subLonRad` are the inclination
 * + desired body-fixed sub-longitude in RADIANS, `count` is the batch size (1 in Act 1).
 * The unit-exact boundary lets the applier recompute the epoch-correct `m0 = subLon + ω·atTick·dt`
 * at apply time (the world.ts resolveOrbit invariant), so the parked longitude is exact at
 * any commit tick. Applied at `atTick` so the launched orbit reproduces on replay.
 *
 * BATCH PHASING (Act 2, §3.4 launch-as-a-batch): `phaseSpreadRad` is the even in-plane
 * mean-anomaly spread between adjacent batch members — member `i` resolves with
 * `m0 += i · phaseSpreadRad`, so ONE launch places `count` phased sats into a plane (a
 * constellation that hands off). DEFAULT 0 ⇒ identical-plane Act-1 behaviour (the m0 term
 * is `+0` ⇒ byte-identical to the pre-Act-2 single launch — golden-safe).
 */
export const KIND_NET_LAUNCH = "net_launch";
/**
 * net/ A2 — the player ACCEPTS an OFFERED net contract by id (design §2.2/§4). Payload
 * `{ contractId }`; the session moves it OFFERED → ACTIVE at `atTick` so it begins accruing
 * router-coverage revenue. The scenario beat that OFFERS contracts is deterministic in the
 * session step + needs no action; only the accept is logged player intent.
 */
export const KIND_NET_ACCEPT = "net_accept";
/**
 * net/ A2 — the player sets a contract's per-contract PREFER weights (the §7.3 tune-by-
 * exception, first used in Act 3). Payload `{ contractId, lat, bw, stab }` (plain numbers).
 * Logged so the routing bias reproduces on replay. `stab` is present but `w_stab` is dormant
 * in M1.
 */
export const KIND_NET_SET_PREFER = "net_set_prefer";
/**
 * net/ A4 — the player PLACES the ONE Act-4 cache breadcrumb (the Mars frontier teaser — "data
 * closer helps"). Payload `{}` (the single dataset is "mars"). The session sets `marsSample`
 * "near Mars" so the freshness readout improves BY SIGHT — a single placeable, NOT the cache
 * economy (NO prefetch policy, NO coherence levels, NO eviction; §8 fenced). Deterministic + no
 * roll; applied at `atTick` via the shared applier so live == replay.
 */
export const KIND_NET_PLACE_CACHE = "net_place_cache";

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

/**
 * M2d — ACCEPT an offered contract by id, at a tick. The contract id round-trips
 * through the payload; the session moves it OFFERED → ACTIVE at `atTick` so live +
 * replay begin accruing its coverage revenue at the same instant.
 */
export function acceptContract(contractId: string, atTick = 0): SimAction {
  return simAction(KIND_ACCEPT_CONTRACT, atTick, { contractId });
}

/**
 * M2d — DECLINE an offered contract by id, at a tick. The session retires the offer at
 * `atTick` (it leaves the open-offer board), so the board state replays from the log.
 */
export function declineContract(contractId: string, atTick = 0): SimAction {
  return simAction(KIND_DECLINE_CONTRACT, atTick, { contractId });
}

/**
 * M3a — place an orbital datacenter at a candidate DC SITE index, at a tick. The session
 * resolves the index to a body + sub-point, so recording the index (not the geometry) keeps
 * the action small and the resolution deterministic on both the live + replay paths.
 */
export function placeDC(siteIndex: number, atTick = 0): SimAction {
  return simAction(KIND_PLACE_DC, atTick, { siteIndex: Math.trunc(siteIndex) });
}

/**
 * net/ A2 — LAUNCH a satellite into a planner orbit, at a tick. The orbit params cross the
 * wire as RADIANS + SI METRES (`semiMajorM` metres, `incRad`/`subLonRad` radians), `count`
 * is the batch size (1 in Act 1), and an optional `presetId` records which preset seeded the
 * draft (for the readout). The applier recomputes the epoch-correct `m0` at `atTick·dt`, so
 * live + replay reach the same parked longitude.
 *
 * BATCH PHASING (Act 2): optional `phaseSpreadRad` is the even in-plane mean-anomaly spread
 * between adjacent batch members (member `i` gets `m0 += i · phaseSpreadRad`). DEFAULT 0 keeps
 * the Act-1 single-plane behaviour byte-identical (the m0 term is `+0`). Only WRITTEN to the
 * payload when non-zero, so an Act-1 launch's wire dict is unchanged (golden-safe).
 */
export function netLaunch(
  params: {
    presetId?: string;
    semiMajorM: number;
    incRad: number;
    subLonRad: number;
    raanRad?: number;
    count?: number;
    phaseSpreadRad?: number;
  },
  atTick = 0,
): SimAction {
  const payload: Record<string, JsonValue> = {
    semiMajorM: params.semiMajorM,
    incRad: params.incRad,
    subLonRad: params.subLonRad,
    count: Math.max(1, Math.trunc(params.count ?? 1)),
  };
  if (params.presetId !== undefined) payload.presetId = params.presetId;
  // RAAN is the planner's fourth draggable parameter (§3.1). Only emit it when the player dragged
  // it off 0 — an undragged launch keeps its exact pre-RAAN wire shape, so the net golden (which
  // never drags RAAN) is byte-identical; the applier defaults a missing key to 0.
  if (params.raanRad !== undefined && params.raanRad !== 0) {
    payload.raanRad = params.raanRad;
  }
  // Only emit a non-zero spread — an Act-1 launch (spread 0) keeps its exact pre-Act-2 wire shape.
  if (params.phaseSpreadRad !== undefined && params.phaseSpreadRad !== 0) {
    payload.phaseSpreadRad = params.phaseSpreadRad;
  }
  return simAction(KIND_NET_LAUNCH, atTick, payload);
}

/**
 * net/ A2 — ACCEPT an offered net contract by id, at a tick. The session moves it OFFERED →
 * ACTIVE at `atTick` so live + replay begin accruing its router-coverage revenue together.
 */
export function netAccept(contractId: string, atTick = 0): SimAction {
  return simAction(KIND_NET_ACCEPT, atTick, { contractId });
}

/**
 * net/ A2 — set a contract's per-contract PREFER weights, at a tick (the §7.3 tune-by-
 * exception). Plain numbers; first used in Act 3, present here so the action boundary is
 * complete from day one.
 */
export function netSetPrefer(
  contractId: string,
  lat: number,
  bw: number,
  stab: number,
  atTick = 0,
): SimAction {
  return simAction(KIND_NET_SET_PREFER, atTick, { contractId, lat, bw, stab });
}

/**
 * net/ A4 — PLACE the ONE Act-4 cache breadcrumb at a tick (the Mars frontier teaser, "data
 * closer helps"). No payload: the single dataset is "mars". The session sets `marsSample` "near
 * Mars" so the freshness readout improves by sight; applying it at `atTick` reproduces the same
 * freshness state on replay. A SINGLE placeable — NOT the cache economy (§8 fenced).
 */
export function netPlaceCache(atTick = 0): SimAction {
  return simAction(KIND_NET_PLACE_CACHE, atTick, {});
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
