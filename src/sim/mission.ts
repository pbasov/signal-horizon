/**
 * Mission director — owns the Earth→Mars packet lifecycle and the SYSTEM.LOG
 * feed, all on SIM time.
 *
 * The packet is HONEST: its one-way delay is frozen at launch from the real
 * Ephemeris Earth↔Mars distance (delay = d / c), so its crawl reaches progress
 * 1.0 exactly when (now − launchT) == oneWay — identical to the number the
 * status strip prints. Freshness drains as 2^(-age/oneWay).
 *
 * M1-05 — LAUNCH-ON-DEMAND. The packet no longer auto-launches on boot or
 * auto-relaunches on arrival; it now represents the {@link M1Session}'s in-flight
 * fetch. The orchestrator calls {@link Mission.launch} when the session STARTS a
 * data-leg fetch (a cache miss), and the packet crawls Earth→Mars at honest light
 * speed; on arrival it emits a "stored" line and CLEARS itself (no relaunch). The
 * NEXT packet appears only when the session's cache decays into another miss — so
 * the on-screen crawl IS the visible pending wait, and the loop breathes.
 *
 * Real solar conjunction is far rarer than a play session, so the log is also
 * fed a deterministic, sim-time-paced flavour stream (the brief explicitly asks
 * for fake log lines timed to sim events) that exercises every severity — while
 * packet launch/arrival and the genuine line-of-sight occult remain real.
 */
import type { Ephemeris } from "./ephemeris";
import type { LogEntry, PacketState, Severity } from "../types";
import type { MissionSnapshot } from "./save";
import { oneWaySeconds, freshness } from "./delay";
import { earthMarsLos } from "./links";
import { fmtDuration, fmtLightSeconds } from "../format";

const SCRIPT_INTERVAL = 540; // sim-seconds between flavour lines

interface ScriptLine {
  sev: Severity;
  entity?: string;
  value?: string;
  msg: string;
}

const SCRIPT: ScriptLine[] = [
  { sev: "info", entity: "HELIO-NET", msg: "peering · L2 symmetric" },
  { sev: "info", entity: "ORI-RELAY", value: "4.2 dB", msg: "handshake · margin nominal" },
  { sev: "warn", entity: "LUNA-DC1", value: "71%", msg: "thermal rising · throttling cold cache" },
  { sev: "info", entity: "GEO-WX", msg: "prefetch ok · staging nearside-tx" },
  { sev: "warn", entity: "EARTH→MARS", msg: "conjunction approach · LOS margin tightening" },
  { sev: "error", entity: "GEO-WX", msg: "packet dropped · retransmit queued" },
  { sev: "info", entity: "LUNA-IMG", msg: "cache evict · cold slot reclaimed" },
  { sev: "warn", entity: "FRESHNESS", value: "▼1.2%", msg: "premium softening · market repricing" },
  { sev: "info", entity: "EM-L1", value: "1.19s", msg: "keepalive · rtt nominal" },
  { sev: "crit", entity: "EARTH-L2", msg: "farside occult · LINK LOST · store-and-forward ENGAGED" },
  { sev: "info", entity: "EARTH-L2", msg: "reacquired · resyncing buffer" },
];

function pktId(n: number): string {
  return `PKT-${String(n).padStart(4, "0")}`;
}

export class Mission {
  packet: PacketState | null = null;
  private nextId = 1;
  private occulted = false;
  private scriptIdx = 0;
  private nextScriptT = 0;
  private booted = false;

  constructor(private eph: Ephemeris) {}

  /**
   * Launch a data-leg packet at sim-time t (called by the orchestrator when the
   * session STARTS a fetch on a cache miss). Replaces whatever was in flight and
   * returns the launch log entry. The packet's one-way delay is frozen from the
   * real Earth↔Mars distance at t, so its crawl + ETA match the session's
   * fetchArrivalT exactly.
   */
  launch(t: number): LogEntry[] {
    const out: LogEntry[] = [];
    const d = this.eph.distanceBetween("earth", "mars", t);
    const ow = oneWaySeconds(d);
    this.packet = { id: this.nextId++, fromId: "earth", toId: "mars", launchT: t, oneWay: ow, progress: 0, freshness: 1 };
    out.push({
      tSim: t,
      sev: "info",
      entity: pktId(this.packet.id),
      value: fmtLightSeconds(ow),
      msg: `launched · EARTH→MARS · ETA ${fmtDuration(ow)}`,
    });
    return out;
  }

  /** Advance mission state to sim-time t; returns any new log entries. */
  update(t: number): LogEntry[] {
    const out: LogEntry[] = [];

    if (!this.booted) {
      this.booted = true;
      this.nextScriptT = t + SCRIPT_INTERVAL;
      out.push({ tSim: t, sev: "info", entity: "ORRERY", msg: "truth layer online · analytic Kepler · J2000" });
      out.push({ tSim: t, sev: "info", entity: "EARTH→MARS", msg: "link open · awaiting demand" });
      // M1-05: no boot launch — the packet appears on the first cache miss.
    }

    // Honest packet crawl. On arrival the packet CLEARS (no relaunch); the next
    // one is launched on demand by the session's next miss.
    if (this.packet) {
      const age = t - this.packet.launchT;
      this.packet.progress = Math.max(0, Math.min(1, age / this.packet.oneWay));
      this.packet.freshness = freshness(age, this.packet.oneWay);
      if (this.packet.progress >= 1) {
        out.push({
          tSim: t,
          sev: "info",
          entity: pktId(this.packet.id),
          value: this.packet.freshness.toFixed(2),
          msg: `arrived at MARS · freshness ${this.packet.freshness.toFixed(2)} · stored`,
        });
        this.packet = null;
      }
    }

    // Real line-of-sight occult (rare; genuine geometry).
    const los = earthMarsLos(this.eph, t);
    if (los.occulted && !this.occulted) {
      out.push({ tSim: t, sev: "crit", entity: "EARTH→MARS", msg: "SOLAR OCCULT · LINK LOST" });
    } else if (!los.occulted && this.occulted) {
      out.push({ tSim: t, sev: "info", entity: "EARTH→MARS", msg: "occult cleared · link reacquired" });
    }
    this.occulted = los.occulted;

    // Deterministic flavour feed, paced on sim time.
    while (t >= this.nextScriptT) {
      const line = SCRIPT[this.scriptIdx % SCRIPT.length];
      this.scriptIdx++;
      this.nextScriptT += SCRIPT_INTERVAL;
      out.push({ tSim: this.nextScriptT - SCRIPT_INTERVAL, ...line });
    }

    return out;
  }

  /**
   * Capture the mutable mission state for a fast-load snapshot (P0-05 / B2).
   * The packet is copied by value so the snapshot never aliases live state.
   */
  snapshot(): MissionSnapshot {
    return {
      nextId: this.nextId,
      occulted: this.occulted,
      scriptIdx: this.scriptIdx,
      nextScriptT: this.nextScriptT,
      booted: this.booted,
      packet: this.packet == null ? null : { ...this.packet },
    };
  }

  /** Restore mutable mission state from a snapshot (the ephemeris is unchanged). */
  restore(s: MissionSnapshot): void {
    this.nextId = s.nextId;
    this.occulted = s.occulted;
    this.scriptIdx = s.scriptIdx;
    this.nextScriptT = s.nextScriptT;
    this.booted = s.booted;
    this.packet = s.packet == null ? null : { ...s.packet };
  }
}
