/**
 * Mission director — owns the Earth→Mars packet lifecycle and the SYSTEM.LOG
 * feed, all on SIM time.
 *
 * The packet is HONEST: its one-way delay is frozen at launch from the real
 * Ephemeris Earth↔Mars distance (delay = d / c), so its crawl reaches progress
 * 1.0 exactly when (now − launchT) == oneWay — identical to the number the
 * status strip prints. On arrival it relaunches, re-sampling the (changing)
 * distance. Freshness drains as 2^(-age/oneWay).
 *
 * Real solar conjunction is far rarer than a play session, so the log is also
 * fed a deterministic, sim-time-paced flavour stream (the brief explicitly asks
 * for fake log lines timed to sim events) that exercises every severity — while
 * packet launch/arrival and the genuine line-of-sight occult remain real.
 */
import type { Ephemeris } from "./ephemeris";
import type { LogEntry, PacketState, Severity } from "../types";
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

  private launch(t: number, out: LogEntry[]): void {
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
  }

  /** Advance mission state to sim-time t; returns any new log entries. */
  update(t: number): LogEntry[] {
    const out: LogEntry[] = [];

    if (!this.booted) {
      this.booted = true;
      this.nextScriptT = t + SCRIPT_INTERVAL;
      out.push({ tSim: t, sev: "info", entity: "ORRERY", msg: "truth layer online · analytic Kepler · J2000" });
      out.push({ tSim: t, sev: "info", entity: "EARTH→MARS", msg: "link open · monitoring light delay" });
      this.launch(t, out);
    }

    // Honest packet crawl.
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
        this.launch(t, out);
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
}
