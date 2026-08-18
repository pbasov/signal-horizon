/**
 * TRACE-DERIVE — the pure arithmetic behind the ROUTING SCREEN (docs/routing-screen.md §9.6).
 *
 * Everything the routing table computes that is NOT a DOM operation lives here: fair-share,
 * effective capacity under a degradation fault, Σfloor, headroom, the three bands, the stable
 * order, the loss-roll grouping and its observed spacing, and every number format. It is a plain
 * module — no DOM, no three, no session, no wall-clock — so it is unit-testable headlessly.
 *
 * WHY IT EXISTS AS ITS OWN FILE: the retired `link-load.ts` shipped two arithmetic bugs (it keyed
 * rows on `region.id`, which collides across renewal generations, and it denominated utilisation
 * against a uniform constant the router does not use) precisely because its arithmetic was welded
 * into its render method and nothing could test it. This is the cheapest correctness insurance
 * available.
 *
 * LAW 1 (facts, never verdicts): every function here turns numbers into numbers or into a literal
 * reading of numbers. Nothing here decides what the player should do.
 *
 * @see docs/routing-screen.md §4.5 (formats), §4.6 (the ledger), §4.7 (order), §7 (the loss roll).
 */

// ── TUNABLE thresholds (docs/routing-screen.md §4.15 — every knob on the screen, in one place) ──

/** Headroom below which a SERVED flow enters the TIGHT band. TUNABLE. */
export const TRACE_TIGHT_BAND = 0.15;
/** Headroom quantisation applied before comparing two rows — the anti-shuffle band. TUNABLE. */
export const TRACE_RANK_BUCKET = 0.05;
/** Utilisation at which a pipe reads TIGHT. TUNABLE. */
export const TRACE_PIPE_TIGHT_UTIL = 0.8;
/** Utilisation at which a pipe ENTERS the CONTENDED bucket. TUNABLE. */
export const TRACE_PIPE_OVER_UTIL = 1.0;
/** Utilisation at which a pipe LEAVES it again (hysteresis against the diurnal curve). TUNABLE. */
export const TRACE_PIPE_OVER_LEAVE = 0.94;
/** `share / floor` below which a rider reads `TIGHT`. TUNABLE. */
export const TRACE_RIDER_TIGHT_RATIO = 1.15;
/** Flow rows shown before the CLEAR band collapses to a summary line. TUNABLE. */
export const TRACE_CLEAR_ROW_CEILING = 5;
/** Distinct link+cause keys the loss roll retains. TUNABLE. */
export const TRACE_ROLL_LINKS = 12;
/** Stamps retained per link+cause key. TUNABLE. */
export const TRACE_ROLL_STAMPS = 8;
/** Stamps required before the OBSERVED spacing renders at all. TUNABLE. */
export const TRACE_ROLL_MIN_FOR_INTERVAL = 3;
/** The elevation span (degrees) above the gate that reads as full connectivity headroom. TUNABLE. */
export const TRACE_ELEV_HEADROOM_SPAN_DEG = 25;

// ── the vocabulary ────────────────────────────────────────────────────────────────

/** The three named bands. The order IS the sort's top level, and it is printed as a glyph so the
 * player can reproduce the ordering in their head (§4.7). */
export type FlowBand = "dark" | "tight" | "clear";

/** The SLA axis tags the table prints. Mirrors the sim's `SlaAxis` / `RouterAxis` vocabulary
 * ("connectivity" is tagged `conn` on screen for width). */
export type SlaAxisTag = "conn" | "avail" | "lat" | "bw";

/** The band glyph — the non-colour channel for the band (DD-1: colour is never the only carrier). */
export function bandGlyph(band: FlowBand): string {
  return band === "dark" ? "✕" : band === "tight" ? "▲" : "·";
}

/** Band ordinal for the sort (dark first — worst-first triage). */
export function bandOrdinal(band: FlowBand): number {
  return band === "dark" ? 0 : band === "tight" ? 1 : 2;
}

/** The band a flow sits in, from the router's verdict + the computed headroom. An unserved flow is
 * ALWAYS dark regardless of headroom — the router's verdict outranks any derived number. */
export function bandFor(served: boolean, headroom: number): FlowBand {
  if (!served) return "dark";
  return headroom < TRACE_TIGHT_BAND ? "tight" : "clear";
}

// ── capacity, load, and the allocation ledger ─────────────────────────────────────

/**
 * THE FAIR SHARE — the bandwidth this contract is actually getting on its pipe right now.
 *
 * This mirrors `router.ts`'s own expression EXACTLY (`servedBandwidth = capacity * ownLoad /
 * sharedLoad` when `sharedLoad > capacity`, else the full offer). It must stay identical or the
 * table's number and the router's breach flag disagree on the same row, which is the "the UI lied"
 * bug in its purest form.
 */
export function fairShare(own: number, shared: number, capacity: number): number {
  if (!(capacity > 0)) return 0;
  if (shared <= capacity || shared <= 0) return own;
  return (capacity * own) / shared;
}

/**
 * THE EFFECTIVE CAPACITY of a pipe — the antenna's own rating, derated by an active degradation
 * fault on its satellite.
 *
 * The sim models the haircut on the other side of the ratio: `applyDegradationHaircut` scales the
 * pipe's *load* up by `1/factor` and leaves capacity alone. `raw / (cap × factor)` is algebraically
 * `(raw / factor) / cap` — the same ratio the router routed against — so deriving it this way lets
 * the panel print a capacity the player can read ("4.00 ×0.50 SICK") instead of an inflated load.
 */
export function effectiveCapacity(nominalUnits: number, degradeFactor: number): number {
  const f = degradeFactor > 0 && degradeFactor < 1 ? degradeFactor : 1;
  return nominalUnits * f;
}

/** Utilisation of a pipe ∈ [0, ∞). 0 when the pipe has no capacity (a defensive read). */
export function utilisation(load: number, effCap: number): number {
  return effCap > 0 ? load / effCap : 0;
}

/** The state WORD a pipe reads (the redundant text channel beside the bar width and the numeral). */
export type PipeState = "headroom" | "tight" | "over" | "idle" | "blind";

export function pipeState(opts: {
  load: number;
  util: number;
  blind: boolean;
}): PipeState {
  if (opts.blind) return "blind";
  if (opts.load <= 0) return "idle";
  if (opts.util >= TRACE_PIPE_OVER_UTIL) return "over";
  if (opts.util >= TRACE_PIPE_TIGHT_UTIL) return "tight";
  return "headroom";
}

/** The rider flag: is this contract's fair share honouring the floor it committed to? `none` means
 * the bandwidth axis is not active for it, so there IS no floor — absent, never greyed (M1 §4.4). */
export type RiderFlag = "none" | "ok" | "tight" | "starved";

export function riderFlag(share: number, floor: number | null): RiderFlag {
  if (floor === null || floor <= 0) return "none";
  if (share < floor) return "starved";
  return share / floor < TRACE_RIDER_TIGHT_RATIO ? "tight" : "ok";
}

/** Σ of the committed floors riding one pipe — THE PROMISE LINE, drawn as a notch on the bar. */
export function sumFloors(floors: readonly (number | null)[]): number {
  let s = 0;
  for (const f of floors) if (f !== null && f > 0) s += f;
  return s;
}

// ── headroom: computed, ordered by, and never printed (§4.10) ─────────────────────

/**
 * HEADROOM on one axis ∈ (−∞, 1]: the fraction of the promise still unspent. 1 = untouched,
 * 0 = exactly at the limit, negative = past it.
 *
 * **This number is never rendered.** It exists only to give the TIGHT/CLEAR bands a reproducible
 * internal order. An earlier design printed a composite of exactly these terms as a "margin"
 * scalar; it died because normalising four different physical quantities onto one signed fraction
 * with placeholder divisors is a designer's opinion wearing two decimals of authority, and the
 * player cannot audit it (§4.10). What the player sees is the two raw numbers instead.
 */
export function axisHeadroom(
  axis: SlaAxisTag,
  read: { carried: number; asked: number | null },
): number {
  const { carried, asked } = read;
  switch (axis) {
    case "conn": {
      // carried = elevation° of the serving link, asked = the elevation gate°.
      if (asked === null) return 1;
      if (!Number.isFinite(carried)) return -1;
      return clamp1((carried - asked) / TRACE_ELEV_HEADROOM_SPAN_DEG);
    }
    case "avail": {
      // carried = held fraction, asked = the SLA bar. Normalised by the room above the bar.
      if (asked === null || asked >= 1) return carried >= 1 ? 1 : -1;
      return clamp1((carried - asked) / (1 - asked));
    }
    case "lat": {
      // carried = realised one-way seconds, asked = the budget. Under budget ⇒ positive.
      if (asked === null || !(asked > 0)) return 1;
      if (!Number.isFinite(carried)) return -1;
      return clamp1((asked - carried) / asked);
    }
    case "bw": {
      // carried = the fair share, asked = the committed floor.
      if (asked === null || !(asked > 0)) return 1;
      return clamp1((carried - asked) / asked);
    }
  }
}

function clamp1(v: number): number {
  return Number.isFinite(v) ? Math.min(1, v) : -1;
}

// ── the stable order (§4.7) ───────────────────────────────────────────────────────

/** One row's ordering inputs. `sortKey` is the headroom for a served row, or a dark-severity key. */
export interface RankInput {
  id: string;
  band: FlowBand;
  /** Lower sorts first. Headroom for TIGHT/CLEAR; axis-ordinal-then-age for DARK. */
  sortKey: number;
}

/**
 * THE ORDER — band first, then quantised sort key, then **the previous rank**, then id.
 *
 * The previous-rank tie-break IS the hysteresis, and it is what makes the list clickable:
 * `offeredLoad` oscillates continuously on the diurnal curve, so a raw comparison reshuffles the
 * table every frame. Quantising to {@link TRACE_RANK_BUCKET} means a row must improve or worsen by
 * a whole band before it can overtake a neighbour; inside a bucket, whoever was higher stays
 * higher. Total, deterministic, and reproducible — no float ordering, no frame-to-frame churn.
 *
 * Returns the ids in display order.
 */
export function rankFlows(items: readonly RankInput[], prevRank: ReadonlyMap<string, number>): string[] {
  const bucket = (v: number): number =>
    Number.isFinite(v) ? Math.round(v / TRACE_RANK_BUCKET) : -1_000_000;
  return [...items]
    .sort((a, b) => {
      const ba = bandOrdinal(a.band);
      const bb = bandOrdinal(b.band);
      if (ba !== bb) return ba - bb;
      const qa = bucket(a.sortKey);
      const qb = bucket(b.sortKey);
      if (qa !== qb) return qa - qb;
      const pa = prevRank.get(a.id) ?? Number.MAX_SAFE_INTEGER;
      const pb = prevRank.get(b.id) ?? Number.MAX_SAFE_INTEGER;
      if (pa !== pb) return pa - pb;
      return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
    })
    .map((r) => r.id);
}

/** −1 = the row moved UP the board, +1 = it moved DOWN, 0 = it held (or is new). Drives the
 * 400 ms ↑/↓ glyph so a reorder is an event you SEE, not a jump you discover. */
export function rankDelta(id: string, newRank: number, prevRank: ReadonlyMap<string, number>): -1 | 0 | 1 {
  const prev = prevRank.get(id);
  if (prev === undefined || prev === newRank) return 0;
  return newRank < prev ? -1 : 1;
}

/** Pipe bucket with hysteresis: once a pipe tips OVER it stays contended until it falls below the
 * leave threshold, so a pipe oscillating around 1.0 does not jump the ledger every frame. */
export function pipeContended(util: number, anyStarved: boolean, wasContended: boolean): boolean {
  if (anyStarved) return true;
  return wasContended ? util >= TRACE_PIPE_OVER_LEAVE : util >= TRACE_PIPE_OVER_UTIL;
}

// ── the loss roll: grouped by link, keeping every stamp (§7) ──────────────────────

/** One link+cause pair and the sim-times it lost at, oldest → newest. */
export interface LossRollGroup {
  key: string;
  aId: string;
  bId: string;
  cause: string;
  times: number[];
}

/** The roll's key: the link pair AND the cause. Two different geometric causes on the same pair
 * are two different stories and must not be merged into one spacing. */
export function lossKey(aId: string, bId: string, cause: string): string {
  return `${aId}|${bId}|${cause}`;
}

/**
 * Record one loss stamp into the roll.
 *
 * **This keeps `atS`, unlike the WIRE's dedupe** (`main.ts` de-dupes on link+cause and deliberately
 * drops the time so a persistently-down link logs once). That is the right policy for a
 * chronological log and exactly the wrong one here: the whole point of the §7.5 predictability seed
 * is that the *spacing between repeats* is visible, and you cannot see a spacing with one sample.
 *
 * A repeat inside `minSpacingS` of the newest stamp is treated as the SAME event still in progress
 * (the router re-stamps an unserved link on every solve) and is dropped.
 */
export function pushLoss(
  roll: Map<string, LossRollGroup>,
  loss: { aId: string; bId: string; cause: string; atS: number },
  minSpacingS: number,
): void {
  const key = lossKey(loss.aId, loss.bId, loss.cause);
  const existing = roll.get(key);
  if (existing === undefined) {
    roll.set(key, { key, aId: loss.aId, bId: loss.bId, cause: loss.cause, times: [loss.atS] });
    // Retention: drop the least-recently-touched key when the roll is full.
    if (roll.size > TRACE_ROLL_LINKS) {
      const oldest = [...roll.values()].sort(
        (a, b) => (a.times[a.times.length - 1] ?? 0) - (b.times[b.times.length - 1] ?? 0),
      )[0];
      if (oldest !== undefined && oldest.key !== key) roll.delete(oldest.key);
    }
    return;
  }
  const newest = existing.times[existing.times.length - 1];
  if (loss.atS - newest < minSpacingS) return; // the same outage, still in progress.
  existing.times.push(loss.atS);
  if (existing.times.length > TRACE_ROLL_STAMPS) existing.times.shift();
}

/**
 * The OBSERVED mean spacing between repeats, or null below {@link TRACE_ROLL_MIN_FOR_INTERVAL}
 * stamps.
 *
 * This is the whole predictability seed: a LEO setting below the horizon does it once per orbit,
 * so three stamps on one link make a rhythm the player can notice. It is deliberately the
 * *observed* mean of times that already happened — **never a forecast of the next one** (M1 §7.5
 * fences prediction to post-M1; pre-empting it burns the game's designed a-ha).
 */
export function meanGapS(times: readonly number[]): number | null {
  if (times.length < TRACE_ROLL_MIN_FOR_INTERVAL) return null;
  let sum = 0;
  for (let i = 1; i < times.length; i++) sum += times[i] - times[i - 1];
  const gaps = times.length - 1;
  return gaps > 0 ? sum / gaps : null;
}

// ── identity ──────────────────────────────────────────────────────────────────────

/**
 * The RENEWAL GENERATION of a contract id. `renewalOffer` mints `REGION-0+R1` while the region id
 * stays `REGION-0`, so a table keyed on the region collides across generations (the retired
 * LinkLoad's bug). Rows key on the contract id and print the generation as `⟲N`.
 */
export function generationOf(contractId: string): number {
  const m = /\+R(\d+)$/.exec(contractId);
  return m === null ? 0 : Number(m[1]);
}

/** The stem a contract id shares with its renewals (`REGION-0+R2` → `REGION-0`) — the key that
 * carries the loss roll, the dark clock and the selection across a renewal boundary. */
export function contractStem(contractId: string): string {
  const i = contractId.indexOf("+R");
  return i > 0 ? contractId.slice(0, i) : contractId;
}

/** A stable 0..N-1 identity-hue index for a contract, from its stem — so a renewal keeps the hue
 * its region had, and the hue survives a reload. */
export function hueIndexFor(contractId: string, hues: number): number {
  const stem = contractStem(contractId);
  let h = 0;
  for (let i = 0; i < stem.length; i++) h = (h * 31 + stem.charCodeAt(i)) >>> 0;
  return h % Math.max(1, hues);
}

// ── formats (§4.5) ────────────────────────────────────────────────────────────────

/** `mm:ss` from sim seconds. Negative and non-finite clamp to `0:00`. */
export function mmss(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return "0:00";
  const s = Math.floor(seconds);
  return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
}

/** `~1m02s` / `~48s` — an observed interval, always prefixed `~` because it is a measured mean. */
export function intervalText(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds <= 0) return "~0s";
  const s = Math.round(seconds);
  if (s < 60) return `~${s}s`;
  return `~${Math.floor(s / 60)}m${String(s % 60).padStart(2, "0")}s`;
}

/** `15m 25s` — a long one-way light time (the Mars read). */
export function longDelayText(seconds: number): string {
  if (!Number.isFinite(seconds)) return "—";
  const s = Math.round(seconds);
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${String(s % 60).padStart(2, "0")}s`;
}

/** One-way latency in ms, one decimal — the same precision `trace.ts` prints. */
export function msText(seconds: number): string {
  return Number.isFinite(seconds) ? `${(seconds * 1000).toFixed(1)} ms` : "∞";
}

/** Capacity units, two decimals — the denomination of the whole ledger. */
export function unitsText(u: number): string {
  return Number.isFinite(u) ? u.toFixed(2) : "—";
}

/** A percentage as an integer with no space before the sign. */
export function pctText(fraction: number): string {
  return Number.isFinite(fraction) ? `${Math.round(fraction * 100)}%` : "—";
}

/** Elevation in degrees, one decimal. */
export function degText(deg: number): string {
  return Number.isFinite(deg) ? `${deg.toFixed(1)}°` : "—";
}

/** Whole euros with thousands separators (the house money format). */
export function eurText(v: number): string {
  return `€${Math.round(v).toLocaleString("en-US")}`;
}

/**
 * The geometric cause of a link loss, PHRASED. `renderLossStamp` prints the raw enum
 * (`set_below_horizon`) and raw seconds; the spec's exemplar is human ("SAT-12 set below horizon at
 * 14:32"). The enum never reaches a player from this screen.
 */
export function causeText(cause: string): string {
  switch (cause) {
    case "set_below_horizon":
      return "set below the horizon";
    case "out_of_budget":
      return "out of link budget";
    case "occluded":
      return "occluded by the body";
    default:
      return cause.replace(/_/g, " ");
  }
}

/** The axis tag a `RouterAxis` / `SlaAxis` string prints as. */
export function axisTag(axis: string): SlaAxisTag {
  switch (axis) {
    case "latency":
      return "lat";
    case "bandwidth":
      return "bw";
    case "availability":
      return "avail";
    default:
      return "conn";
  }
}

/** The axis word in caps (an unserved row) — the redundant channel beside the `✕`. */
export function axisWord(tag: SlaAxisTag): string {
  switch (tag) {
    case "lat":
      return "LATENCY";
    case "bw":
      return "BW";
    case "avail":
      return "AVAIL";
    case "conn":
      return "CONN";
  }
}
