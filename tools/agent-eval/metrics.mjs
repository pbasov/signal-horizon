/**
 * THE DETERMINISTIC METRICS (SD-55 / AE-04) — no LLM in this file.
 *
 * Pure functions over two immutable inputs: the sim's own ordered action log and the per-turn
 * timeline the driver recorded. Definitions are pre-registered in docs/agent-eval-metrics.md and
 * may not be changed here without a dated amendment there — the whole point of writing them down
 * before the first run was that a number cannot be redefined once it disappoints.
 *
 * Every metric answers "what happened", never "was it good". Reading is docs/agent-eval.md §1.
 */

/** Action kinds that mutate world state. `set_time_scale` is committed but classed as tempo. */
export const COMMITTED_KINDS = [
  "net_launch",
  "net_accept",
  "net_assign_beam",
  "net_set_prefer",
  "net_circularize",
  "net_place_cache",
];

/** The fourteen decision surfaces of m1-redesign.md §2.7. `unavailable` is a third state. */
export const SURFACES = [
  "accept-timing",
  "bus-tier",
  "antenna-cards",
  "batch-size",
  "altitude",
  "inclination",
  "sub-lon",
  "raan",
  "phase",
  "beam-assignment",
  "re-beaming",
  "prefer-weights",
  "overclock",
  "circularize",
  "tempo",
];

/** Surfaces with no shipped verb in this build. Recorded as unavailable, never as untouched. */
export const UNAVAILABLE_SURFACES = ["overclock"];

/** LAW 2, at runtime. The same patterns copy-lint applies to source, applied to rendered text. */
export const BANNED_IMPERATIVE = [
  { name: "press <KEY>", re: /\bpress\s+(the\s+)?[A-Z0-9[\]]/ },
  { name: "click <CONTROL>", re: /\bclick\s+(the\s+)?[A-Z]/ },
  { name: "hit <CONTROL>", re: /\bhit\s+(the\s+)?[A-Z]/ },
  { name: "key <K> reference", re: /\(key\s+[A-Z0-9]\)/i },
  { name: "desktop-number instruction", re: /\bon\s+[A-Z]{3,}\s*\(\d\)/ },
  { name: "the X button", re: /\b[A-Z]{2,}\s+button\b/ },
];

const TICKS_PER_SEC = 60; // DT = 1/60 (src/sim/clock.ts)
/** The game's own tempo controls (src/main.ts net keymap): pause and the two speed steps. */
export const TEMPO_KEYS = [" ", ",", "."];
const HELD_ACCEPT_SEC = 60;

/**
 * Wilson score interval — never Wald, which collapses to zero width at 0/n and n/n, exactly where
 * a five-seed battery lands. At 5/5 this returns a lower bound near 0.57: "five for five" is
 * consistent with a true rate of 57%, and every rate in a report has to say so.
 */
export function wilson(k, n, z = 1.96) {
  if (n === 0) return { p: null, lo: 0, hi: 1, n: 0, k: 0 };
  const p = k / n;
  const z2 = z * z;
  const denom = 1 + z2 / n;
  const centre = (p + z2 / (2 * n)) / denom;
  const halfWidth = (z * Math.sqrt((p * (1 - p)) / n + z2 / (4 * n * n))) / denom;
  return { p, lo: Math.max(0, centre - halfWidth), hi: Math.min(1, centre + halfWidth), n, k };
}

/**
 * @param {object} run
 * @param {{kind:string,at_tick:number,payload:Record<string,any>}[]} run.actions  the sim's log
 * @param {object[]} run.timeline  one record per turn from the driver (see docs/agent-eval-artifacts.md)
 * @param {{persona?:string, withheld?:string[], errors?:number}} [run.meta]
 */
export function computeMetrics({ actions = [], timeline = [], meta = {} }) {
  const committed = actions.filter((a) => COMMITTED_KINDS.includes(a.kind));
  // TEMPO IS READ FROM THE AGENT'S OWN TURNS, NOT FROM THE ACTION LOG. The log's set_time_scale
  // entries are polluted by the harness: PDQ pauses and un-pauses the clock every turn, and
  // main.ts's recordScale() logs each of those as a player action. So tempo counts only what the
  // AGENT did — a tempo key it pressed, or a deliberate spread of dwell lengths. Recorded as an
  // amendment in docs/agent-eval-metrics.md §7, because PDQ changes what "tempo" can even mean.
  const agentTempoKeys = timeline.filter((t) => t.action?.do === "key" && TEMPO_KEYS.includes(t.action.key));
  const dwells = new Set(timeline.filter((t) => t.action?.do === "wait").map((t) => t.action.simMinutes));
  const tempo = { keys: agentTempoKeys.length, distinctDwells: dwells.size };

  // ── act boundary ─────────────────────────────────────────────────────────────
  const act1EndTurn = timeline.find((t) => (t.cursor ?? 0) > 0) ?? null;
  const act1EndTick = act1EndTurn ? act1EndTurn.tick : Infinity;
  const m1 = committed.filter((a) => a.at_tick <= act1EndTick).length;

  // ── decision surfaces ────────────────────────────────────────────────────────
  const touched = new Set();
  // Accept timing: signed at least HELD_ACCEPT_SEC after the offer first became visible.
  for (const a of actions.filter((x) => x.kind === "net_accept")) {
    const id = a.payload?.contractId;
    const firstSeen = timeline.find((t) => (t.offered ?? []).includes(id));
    if (firstSeen && a.at_tick - firstSeen.tick >= HELD_ACCEPT_SEC * TICKS_PER_SEC) touched.add("accept-timing");
  }
  const beamAssigns = actions.filter((a) => a.kind === "net_assign_beam");
  if (beamAssigns.length > 0) touched.add("beam-assignment");
  // Re-beaming: a second assignment for an antenna already assigned.
  const beamSeen = new Set();
  for (const a of beamAssigns) {
    const slot = `${a.payload?.satId ?? "?"}/${a.payload?.antennaIndex ?? a.payload?.antenna ?? "?"}`;
    if (beamSeen.has(slot)) touched.add("re-beaming");
    beamSeen.add(slot);
  }
  if (actions.some((a) => a.kind === "net_set_prefer")) touched.add("prefer-weights");
  if (actions.some((a) => a.kind === "net_circularize")) touched.add("circularize");
  if (tempo.keys > 0 || tempo.distinctDwells >= 2) touched.add("tempo");
  let launchIdx = 0;
  for (const a of actions.filter((x) => x.kind === "net_launch")) {
    if (a.payload?.bus !== undefined) touched.add("bus-tier");
    if ((a.payload?.count ?? 1) !== 1) touched.add("batch-size");
    // Orbit fields + the fit: compare the pad AT COMMIT against the pad the game SEEDED when it
    // opened. Field-to-field, so the harness never converts km→m or deg→rad and can never disagree
    // with the sim about a unit.
    const rec = commitRecordFor(timeline, launchIdx++);
    if (rec?.padSeed && rec?.padAtAction) {
      for (const [field, surface] of Object.entries(FIELD_SURFACE)) {
        if (numChanged(rec.padSeed[field], rec.padAtAction[field])) touched.add(surface);
      }
      if (JSON.stringify(rec.padSeed.slots ?? []) !== JSON.stringify(rec.padAtAction.slots ?? [])) {
        touched.add("antenna-cards");
      }
    }
  }

  // ── legibility rates (no LLM) ────────────────────────────────────────────────
  const acted = timeline.filter((t) => t.action && !t.invalid && !t.invalidShape);
  const invalid = timeline.filter((t) => t.invalid).length; // reached for a control that is not there
  const shapeNoise = timeline.filter((t) => t.invalidShape).length; // the harness's own JSON dialect
  const shapeFixed = timeline.filter((t) => t.shapeFixed).length;
  const noop = acted.filter((t) => t.noop).length;

  // ── LAW 2 at runtime: scan only GAME-rendered text, never the harness's own scaffolding ──
  const leaks = [];
  for (const t of timeline) {
    for (const p of t.panelText ?? []) {
      for (const b of BANNED_IMPERATIVE) {
        const m = p.text.match(b.re);
        if (m) leaks.push({ turn: t.turn, panel: p.title, pattern: b.name, near: m[0] });
      }
    }
  }

  // ── first serve ──────────────────────────────────────────────────────────────
  const firstServed = timeline.find((t) => t.servedAny);

  // ── own-success strain: the load a served region grew, then an action answered it ──
  const strain = respondedToOwnSuccessStrain(timeline, actions);

  // ── softlock: three turns where nothing an affordance did changed the world ──
  let softlockRun = 0;
  let softlocked = false;
  for (const t of acted) {
    softlockRun = t.noop ? softlockRun + 1 : 0;
    if (softlockRun >= 3) softlocked = true;
  }

  const economy = lastOf(timeline, (t) => t.balance !== null && t.balance !== undefined);
  const balances = timeline.map((t) => t.balance).filter((b) => typeof b === "number");

  return {
    m1_committed_actions_act1: m1,
    m2_decision_surfaces: {
      touched: [...touched].sort(),
      count: touched.size,
      of: SURFACES.length,
      unavailable: UNAVAILABLE_SURFACES,
      untouched: SURFACES.filter((s) => !touched.has(s) && !UNAVAILABLE_SURFACES.includes(s)),
    },
    m3_strategy_fork: strategyFork(actions),
    m4_instruction_string_absent: leaks.length === 0,
    m4_leaks: leaks,
    m5_responded_to_own_success_strain: strain,
    m6_completed_without_softlock: !softlocked && (meta.errors ?? 0) === 0,
    m7_novice_floor_reachable:
      meta.persona === "novice-floor"
        ? Boolean(firstServed) && timeline.some((t) => (t.cursor ?? 0) > 0)
        : null,
    m8_invalid_action_rate: acted.length + invalid === 0 ? null : invalid / (acted.length + invalid),
    // HARNESS QUALITY, never a reading of the build: turns lost to the protocol's own JSON shape.
    // The first live run spent seven turns guessing whether a field key was target/name/field/id;
    // that is this file's dialect, not the game's legibility, so it is counted apart from M8.
    m8c_protocol_noise: {
      shape_rejects: shapeNoise,
      shape_repairs: shapeFixed,
      rate: timeline.length === 0 ? null : (shapeNoise + shapeFixed) / timeline.length,
    },
    m8b_no_op_action_rate: acted.length === 0 ? null : noop / acted.length,
    m9_time_to_first_served_s: firstServed?.missionElapsedS ?? null,
    m9b_turns_to_first_served: firstServed?.turn ?? null,
    m10_hand_aimed_before_commit: handAimed(timeline, actions),
    m11_acts_reached: timeline.reduce((mx, t) => Math.max(mx, t.cursor ?? 0), 0),
    m12_economy: {
      final_eur: economy?.balance ?? null,
      min_eur: balances.length ? Math.min(...balances) : null,
      breach_seconds_total: timeline.reduce((mx, t) => Math.max(mx, t.breachSecondsTotal ?? 0), 0),
      ended_net_positive: economy ? economy.balance > 0 : null,
    },
    m13_errors: meta.errors ?? 0,
    committed_actions_total: committed.length,
    tempo: tempo,
  };
}

const FIELD_SURFACE = {
  altKm: "altitude",
  incDeg: "inclination",
  subLonDeg: "sub-lon",
  raanDeg: "raan",
  phaseSpreadDeg: "phase",
};

function numChanged(a, b) {
  if (a === undefined || b === undefined) return false;
  const x = Number(a);
  const y = Number(b);
  if (!Number.isFinite(x) || !Number.isFinite(y)) return String(a) !== String(b);
  return Math.abs(x - y) > 1e-9;
}

/**
 * The turn on which the Nth launch was committed — matched by the COMMIT TURN, not by tick.
 *
 * Ticks cannot identify it: the clock is stopped while the policy thinks, so a run that never spends
 * a `wait` produces a whole timeline at one identical tick. That is exactly what the first live run
 * did, and tick-matching then picked a LATER pad-open whose draft equalled its seed, reporting a
 * hand-aimed launch (sub-lon dragged from −90° to 0°, coverage 0%→100%) as not hand-aimed.
 */
function commitTurns(timeline) {
  return timeline.filter((t) => t.action?.do === "click" && /^(launch|text:LAUNCH)$/i.test(String(t.action.target)));
}

function commitRecordFor(timeline, launchIndex = 0) {
  const turns = commitTurns(timeline);
  return turns[launchIndex] ?? turns.at(-1) ?? null;
}

/** M10 — did any orbit field differ from the seeded draft at the first commit? */
function handAimed(timeline, actions) {
  const first = actions.findIndex((a) => a.kind === "net_launch");
  if (first < 0) return null;
  const rec = commitRecordFor(timeline, 0);
  if (!rec?.padSeed || !rec?.padAtAction) return null;
  return Object.keys(FIELD_SURFACE).some((f) => numChanged(rec.padSeed[f], rec.padAtAction[f]));
}

/**
 * M3 — the consolidate-vs-split fork, per run. Battery-level TRUE needs both values across seeds;
 * a single run only reports which fork it took, and the report is forbidden from reading one run
 * as the metric (docs/agent-eval-metrics.md §2).
 */
export function strategyFork(actions) {
  const launches = actions.filter((a) => a.kind === "net_launch");
  const consolidate = launches.some((a) => a.payload?.bus !== undefined && (a.payload?.loadout ?? []).length >= 2);
  const split = launches.some((a) => (a.payload?.count ?? 1) >= 2 && a.payload?.bus === undefined);
  return { consolidate, split, launches: launches.length };
}

/**
 * M5 — behaviour only. A region the agent served had its offered load grow past its value at
 * first-serve, and a committed action landed within 5 turns of that growth. This is NOT the GDD §9
 * attribution claim: attribution is what the player BELIEVED, which only the judge can read (Q2).
 */
export function respondedToOwnSuccessStrain(timeline, actions) {
  const firstServeAsk = new Map();
  for (const t of timeline) {
    for (const r of t.regions ?? []) {
      if (r.servedFrac > 0 && !firstServeAsk.has(r.id)) firstServeAsk.set(r.id, { ask: r.ask ?? null, turn: t.turn });
    }
  }
  for (const t of timeline) {
    for (const r of t.regions ?? []) {
      const base = firstServeAsk.get(r.id);
      if (!base || base.ask === null || r.ask === null || r.ask === undefined) continue;
      if (r.ask <= base.ask) continue;
      const grewAtTick = t.tick;
      const answered = actions.some(
        (a) => COMMITTED_KINDS.includes(a.kind) && a.at_tick >= grewAtTick && a.at_tick <= grewAtTick + 5 * 60 * TICKS_PER_SEC,
      );
      if (answered) return true;
    }
  }
  return false;
}

function lastOf(arr, pred) {
  for (let i = arr.length - 1; i >= 0; i--) if (pred(arr[i])) return arr[i];
  return null;
}

/** Normalised against the baselines: (agent − random) / |scripted − random|. */
export function normalise(agent, random, scripted) {
  if ([agent, random, scripted].some((v) => typeof v !== "number")) return null;
  const span = Math.abs(scripted - random);
  return span === 0 ? null : (agent - random) / span;
}
