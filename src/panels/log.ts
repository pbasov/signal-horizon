/**
 * SYSTEM.LOG — the scrolling event ledger panel.
 *
 * One dense single-line row per event: a cyan sim-timestamp, a severity glyph,
 * an optional violet entity token, an optional amber value token, then the
 * message. Rows are appended in place (never an innerHTML rebuild), the scroll
 * is pinned to the bottom, and the buffer is capped at MAX_LINES.
 *
 * status() reports the worst severity seen across the most recent appends via
 * a tiny fixed-size severity ring buffer, so the titlebar lamp tracks the live
 * tail of the feed rather than the whole (capped) history.
 */
import type { LogEntry, Severity } from "../types";
import type { PanelHandle } from "../wm/shell";
import { fmtTs } from "../format";

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

    // Cap the buffer: drop the oldest rows when over the limit.
    while (this.lineCount > MAX_LINES && this.scroll.firstChild) {
      this.scroll.removeChild(this.scroll.firstChild);
      this.lineCount--;
    }

    // Record severity in the ring for status().
    this.sevRing[this.ringHead] = entry.sev;
    this.ringHead = (this.ringHead + 1) % STATUS_WINDOW;
    if (this.ringLen < STATUS_WINDOW) this.ringLen++;

    // Pin to the bottom (newest visible).
    this.scroll.scrollTop = this.scroll.scrollHeight;
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
