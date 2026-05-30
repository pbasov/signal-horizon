/**
 * E9 (M1-10b) — SYSTEM.LOG render formatter: turn a truthful {@link M1Event} into
 * §8-syntax-highlighted display tokens.
 *
 * GDD §8 says the terminal WINDOW stays 1-bit but its CONTENT is highlighted like
 * a code editor, colour applied PER SEMANTIC TOKEN: severity (info/warn/error/
 * critical), entities (feed/dataset ids), time + freshness (timestamps + info-age
 * stamps share the freshness ramp — a stale "14m ago" reads cooler), and values
 * (€ amounts). This module is the pure mapping from event → tokens; {@link
 * SystemLog} paints the tokens into the existing log CSS. DOM-FREE + side-effect
 * free, so it is unit-testable and the panel stays thin.
 *
 * It does NOT invent severities or text — every token is derived from the event's
 * own truthful payload (the §4.12 honesty precondition). The freshness "warmth"
 * bucket is the SAME ramp the orrery saturation + readout use, so a number means
 * the same thing everywhere.
 */
import type { M1Event, EventSeverity } from "../sim/m1/eventlog";
import { fmtTs, fmtDuration, fmtEuro, fmtPct } from "../format";

/** A freshness warmth bucket → a CSS class on the freshness/value token (§8 ramp). */
export type Warmth = "good" | "watch" | "warn" | "dead";

/** One highlighted token in a rendered log row. `cls` is an extra CSS modifier. */
export interface LogToken {
  text: string;
  /** Which token slot: drives the base colour (ts/sev/ent/val/msg). */
  slot: "ts" | "sev" | "ent" | "val" | "msg";
  /** Optional modifier class (a freshness warmth, or "stale" for a cooled time). */
  cls?: Warmth | "stale";
}

/** A fully-tokenised log row ready to paint: severity (for the row class) + tokens. */
export interface LogRow {
  /** Monotonic event ordinal — a stable DOM key (survives the ring's drops). */
  seq: number;
  sev: EventSeverity;
  tokens: LogToken[];
}

/** Severity glyphs (mirrors the panel's existing GLYPH map). */
const GLYPH: Record<EventSeverity, string> = { info: "✓", warn: "▲", error: "×", crit: "!" };

/** The §8 freshness ramp, bucketed: warm (fresh) → cool (stale) → dead (gone). */
export function warmthOf(freshness: number): Warmth {
  if (freshness >= 0.75) return "good"; // fresh band — hot/saturated.
  if (freshness >= 0.5) return "watch"; // usable.
  if (freshness > 0.0) return "warn"; // staling — cooling off.
  return "dead"; // gone / absent — machine-grey.
}

/** A serve band maps to a severity for the eye-jump colour (worse band = hotter). */
function serveSeverity(band: string): EventSeverity {
  switch (band) {
    case "fresh":
      return "info";
    case "stale":
      return "warn";
    case "miss":
      return "warn";
    case "blackout_miss":
      return "crit";
    default:
      return "info";
  }
}

/** A human band word for the message prose. */
function bandWord(band: string): string {
  switch (band) {
    case "fresh":
      return "FRESH";
    case "stale":
      return "STALE";
    case "miss":
      return "MISS";
    case "blackout_miss":
      return "BLACKOUT";
    default:
      return band.toUpperCase();
  }
}

/** A prefetch cause → scannable label. */
function prefetchLabel(cause: string): string {
  switch (cause) {
    case "manual":
      return "prefetch MANUAL";
    case "auto":
      return "prefetch AUTO · floor top-up";
    case "prestage":
      return "prefetch PRE-STAGE · ahead of blackout";
    default:
      return "prefetch";
  }
}

/**
 * Format an {@link M1Event} into a {@link LogRow}: severity for the row, plus the
 * per-token slots §8 highlights. Pure — same event → same row.
 */
export function formatEvent(ev: M1Event): LogRow {
  // The timestamp token is shared by every row; its warmth comes from any
  // freshness the event carries (a cooled "stored 0.42" reads visibly cooler).
  const ts: LogToken = { text: fmtTs(ev.tSim), slot: "ts" };

  switch (ev.kind) {
    case "serve": {
      const sev = serveSeverity(ev.band);
      const fresh = ev.viaCache && ev.freshness > 0;
      return {
        seq: ev.seq,
        sev,
        tokens: [
          ts,
          { text: GLYPH[sev], slot: "sev" },
          { text: ev.feedId, slot: "ent" },
          ...(fresh ? [{ text: fmtPct(ev.freshness), slot: "val", cls: warmthOf(ev.freshness) } as LogToken] : []),
          {
            text:
              ev.from === null
                ? `serving ${bandWord(ev.band)}`
                : `${bandWord(ev.from)} → ${bandWord(ev.band)}`,
            slot: "msg",
          },
        ],
      };
    }
    case "fetch_launch":
      return {
        seq: ev.seq,
        sev: "info",
        tokens: [
          ts,
          { text: GLYPH.info, slot: "sev" },
          { text: ev.feedId, slot: "ent" },
          { text: fmtDuration(ev.etaSeconds), slot: "val" },
          { text: `fetch launched · EARTH→MARS · ETA`, slot: "msg" },
        ],
      };
    case "fetch_arrive": {
      const w = warmthOf(ev.landedFreshness);
      return {
        seq: ev.seq,
        sev: "info",
        tokens: [
          ts,
          { text: GLYPH.info, slot: "sev" },
          { text: ev.feedId, slot: "ent" },
          { text: fmtPct(ev.landedFreshness), slot: "val", cls: w },
          { text: `arrived at MARS · landed freshness`, slot: "msg" },
        ],
      };
    }
    case "cache_store":
      return {
        seq: ev.seq,
        sev: "info",
        tokens: [
          ts,
          { text: GLYPH.info, slot: "sev" },
          { text: ev.datasetId, slot: "ent" },
          { text: `${ev.slotsUsed}/${ev.slotCapacity}`, slot: "val" },
          { text: `cache store · slots`, slot: "msg" },
        ],
      };
    case "cache_evict": {
      const w = warmthOf(ev.freshness);
      return {
        seq: ev.seq,
        sev: "warn",
        tokens: [
          ts,
          { text: GLYPH.warn, slot: "sev" },
          { text: ev.datasetId, slot: "ent" },
          { text: fmtPct(ev.freshness), slot: "val", cls: w },
          { text: `cache EVICT · lowest-freshness · for ${ev.forBy}`, slot: "msg" },
        ],
      };
    }
    case "prefetch": {
      const isPrestage = ev.cause === "prestage";
      const sev: EventSeverity = isPrestage ? "warn" : "info";
      return {
        seq: ev.seq,
        sev,
        tokens: [
          ts,
          { text: GLYPH[sev], slot: "sev" },
          { text: ev.feedId, slot: "ent" },
          { text: `−${fmtEuro(ev.costEur)}`, slot: "val" },
          { text: prefetchLabel(ev.cause), slot: "msg" },
        ],
      };
    }
    case "policy":
      return {
        seq: ev.seq,
        sev: "info",
        tokens: [
          ts,
          { text: GLYPH.info, slot: "sev" },
          { text: "AUTOPILOT", slot: "ent" },
          { text: fmtPct(ev.floor), slot: "val" },
          {
            text:
              ev.from === null || ev.from === ev.mode
                ? `policy ${ev.mode} · floor`
                : `policy ${ev.from} → ${ev.mode} · floor`,
            slot: "msg",
          },
        ],
      };
    case "blackout": {
      const sev: EventSeverity = ev.edge === "enter" ? "crit" : "info";
      return {
        seq: ev.seq,
        sev,
        tokens: [
          ts,
          { text: GLYPH[sev], slot: "sev" },
          { text: ev.feedId, slot: "ent" },
          {
            text: ev.edge === "enter" ? `LINK LOST · conjunction blackout` : `link reacquired`,
            slot: "msg",
          },
        ],
      };
    }
  }
}
