/**
 * SYSTEM.LOG — the scrolling event ledger panel.
 *
 * E9 (M1-10b): this panel now renders the TRUTHFUL sim event stream
 * ({@link M1Event} from src/sim/m1/eventlog.ts). Every row is a real
 * edge-triggered sim event — a serve band transition, a fetch launch/arrival, a
 * cache store/evict, a prefetch firing, a policy change, a blackout edge — never a
 * scripted flavour line. The old hand-written severity feed and the stale
 * "PKT 0.50 arrived" mission line are gone; the §4.12 record cannot lie or hide.
 *
 * Rendering follows GDD §8: the window stays 1-bit, the CONTENT is syntax-
 * highlighted per token (severity / entity ids / time+freshness / € values) via
 * {@link formatEvent}. Rows are appended INCREMENTALLY by event seq (no per-frame
 * innerHTML rebuild — only genuinely-new events become new rows), the scroll pins
 * to the bottom, and the DOM list is capped at MAX_LINES (drop oldest).
 *
 * status() reports the worst severity across the recent tail via a small ring, so
 * the titlebar lamp tracks the live feed rather than the whole capped history.
 */
import type { LogEntry, Severity } from "../types";
import type { EventSeverity, EventLog } from "../sim/m1/eventlog";
import type { PanelHandle } from "../wm/shell";
import { fmtTs } from "../format";
import { formatEvent, type LogRow } from "./log-format";

const MAX_LINES = 400;
const STATUS_WINDOW = 12;

const GLYPH: Record<Severity, string> = {
  info: "✓", // ✓
  warn: "▲", // ▲
  error: "×", // ×
  crit: "!",
};

export class SystemLog implements PanelHandle {
  title = "SYSTEM.LOG";
  content: HTMLElement;

  private scroll: HTMLElement;
  private lineCount = 0;

  /** Highest event seq already painted; the incremental cursor (drain only the new tail). */
  private lastSeq = -1;

  /** Fixed-size ring of recent severities feeding status(). */
  private sevRing: Severity[] = new Array(STATUS_WINDOW);
  private ringHead = 0;
  private ringLen = 0;

  constructor() {
    this.content = document.createElement("div");
    this.content.className = "log";

    this.scroll = document.createElement("div");
    this.scroll.className = "log-scroll";

    this.content.appendChild(this.scroll);
  }

  /**
   * E9 — paint the truthful event stream. Drains only the NEW tail (events with
   * seq beyond the cursor) from the session's {@link EventLog}, so a steady-state
   * frame with no new events does no allocation or DOM work, and a busy frame
   * appends a handful of rows (never a full-list rebuild, never a whole-stream
   * copy). Keyed by seq, which is monotonic and survives the ring's drops, so the
   * cursor only ever advances and no row is painted twice.
   */
  render(log: EventLog): void {
    const tail = log.readSince(this.lastSeq + 1);
    for (const ev of tail) {
      if (ev.seq <= this.lastSeq) continue;
      this.lastSeq = ev.seq;
      this.appendRow(formatEvent(ev));
    }
  }

  /** Paint one tokenised, §8-highlighted row (the event slot colours come from CSS). */
  private appendRow(row: LogRow): void {
    const line = document.createElement("div");
    line.className = `log-line ${row.sev}`;

    for (const tok of row.tokens) {
      const span = document.createElement("span");
      span.className = tok.cls ? `${tok.slot} ${tok.cls}` : tok.slot;
      span.textContent = tok.text;
      line.appendChild(span);
    }

    this.scroll.appendChild(line);
    this.lineCount++;
    this.trimAndPin(row.sev);
  }

  /** Drop overflow rows, record severity for status(), pin scroll to the newest. */
  private trimAndPin(sev: EventSeverity | Severity): void {
    while (this.lineCount > MAX_LINES && this.scroll.firstChild) {
      this.scroll.removeChild(this.scroll.firstChild);
      this.lineCount--;
    }
    this.sevRing[this.ringHead] = sev as Severity;
    this.ringHead = (this.ringHead + 1) % STATUS_WINDOW;
    if (this.ringLen < STATUS_WINDOW) this.ringLen++;
    this.scroll.scrollTop = this.scroll.scrollHeight;
  }

  /**
   * Legacy single-entry append (kept for any non-event caller). E9 routes the live
   * feed through {@link render}; this remains so a one-off boot/system line can
   * still be shown if needed.
   */
  append(entry: LogEntry): void {
    const line = document.createElement("div");
    line.className = `log-line ${entry.sev}`;

    const ts = document.createElement("span");
    ts.className = "ts";
    ts.textContent = fmtTs(entry.tSim);
    line.appendChild(ts);

    const sev = document.createElement("span");
    sev.className = "sev";
    sev.textContent = GLYPH[entry.sev];
    line.appendChild(sev);

    if (entry.entity) {
      const ent = document.createElement("span");
      ent.className = "ent";
      ent.textContent = entry.entity;
      line.appendChild(ent);
    }

    if (entry.value) {
      const val = document.createElement("span");
      val.className = "val";
      val.textContent = entry.value;
      line.appendChild(val);
    }

    const msg = document.createElement("span");
    msg.className = "msg";
    msg.textContent = entry.msg;
    line.appendChild(msg);

    this.scroll.appendChild(line);
    this.lineCount++;
    this.trimAndPin(entry.sev);
  }

  status(): "ok" | "warn" | "crit" {
    let warn = false;
    for (let i = 0; i < this.ringLen; i++) {
      const sev = this.sevRing[i];
      if (sev === "crit") return "crit";
      if (sev === "error" || sev === "warn") warn = true;
    }
    return warn ? "warn" : "ok";
  }

  subtitle(): string {
    return `· ${this.lineCount} lines`;
  }
}
