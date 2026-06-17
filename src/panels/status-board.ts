/**
 * net/ M1 — STATUS·BOARD (SD-44 PHASE 1): the OVERVIEW triage wall's answer to "is anything wrong
 * right now?". A single bordered banner for the current OBJECTIVE (act + goal), then one row per live
 * contract — its label, its STATE as a colour-redundant word (SERVED ✓ green / UNSERVED amber / OFFERED
 * cyan / DONE green / ENDED red), the live served%, and the € earned. No new sim state: it reads the
 * SAME {@link NetPlannerRenderState} main.ts projects for the launch/contracts tiles, so it is a thin
 * painter (DOM built once, rows rebuilt only on a state-signature change, values updated per frame).
 *
 * DD-1: 1-bit dithered MACHINE chrome (the .telem dashed-group housing); COLOUR only on the DATA, and
 * every colour distinction is redundant on a glyph/word (the state WORD carries the meaning colour-off).
 */
import type { PanelHandle } from "../wm/shell";
import type { NetPlannerRenderState, NetContractRow } from "./net-planner";
import { fmtEuro, fmtPct } from "../format";

export class StatusBoard implements PanelHandle {
  readonly title = "STATUS·BOARD";
  readonly content: HTMLElement;

  // --- OBJECTIVE banner ---
  private objectiveGroup: HTMLElement;
  private objectiveLegend: HTMLElement;
  private vObjTitle: HTMLElement;
  private vObjDetail: HTMLElement;

  // --- the network-health SUMMARY line (the at-a-glance triage header) ---
  private vSummary!: HTMLElement;
  // --- per-contract status rows (rebuilt on a state-signature change) ---
  private rowsHost: HTMLElement;
  private rows = new Map<string, { root: HTMLElement; label: HTMLElement; state: HTMLElement; served: HTMLElement; earned: HTMLElement; reason: HTMLElement }>();
  private sig = "";

  private worst: "ok" | "warn" | "crit" = "ok";

  constructor() {
    this.content = el("div", "telem");

    // GROUP: OBJECTIVE — the per-act goal banner (the green "what is my next move" surface).
    this.objectiveGroup = el("div", "group net-objective");
    this.objectiveLegend = el("div", "legend");
    this.objectiveLegend.textContent = "OBJECTIVE";
    this.vObjTitle = el("div", "net-obj-title");
    this.vObjDetail = el("div", "net-obj-detail");
    this.objectiveGroup.append(this.objectiveLegend, this.vObjTitle, this.vObjDetail);
    this.content.append(this.objectiveGroup);

    // GROUP: STATUS — the network health SUMMARY (the mission-control glance) + one row per demand.
    const statusGroup = group("STATUS · ALL DEMANDS");
    this.vSummary = el("div", "status-summary v");
    statusGroup.append(this.vSummary);
    this.rowsHost = el("div", "status-rows");
    statusGroup.append(this.rowsHost);
    this.content.append(statusGroup);
  }

  render(state: NetPlannerRenderState): void {
    // OBJECTIVE banner.
    const obj = state.objective;
    if (obj) {
      this.objectiveGroup.style.display = "";
      setText(this.objectiveLegend, `OBJECTIVE · ${obj.actLabel}`);
      setText(this.vObjTitle, obj.title);
      setText(this.vObjDetail, obj.detail);
    } else {
      this.objectiveGroup.style.display = "none";
    }

    // SUMMARY — the at-a-glance network health (the mission-control "is anything wrong?" line).
    const active = state.contracts.filter((c) => c.state === "active");
    const servedCount = active.filter((c) => c.served).length;
    const atRisk = active.length - servedCount;
    const offered = state.contracts.filter((c) => c.state === "offered").length;
    const rev = Math.round(state.fleet.revenuePerHr);
    const parts = [
      `FLEET ${state.fleet.satCount} sat${state.fleet.satCount === 1 ? "" : "s"}`,
      active.length > 0 ? `SERVED ${servedCount}/${active.length}` : "no active demand",
      `+${fmtEuro(rev)}/hr`,
      fmtEuro(state.balanceEur),
    ];
    if (atRisk > 0) parts.splice(2, 0, `${atRisk} AT RISK`);
    if (offered > 0) parts.push(`${offered} offered`);
    setText(this.vSummary, parts.join(" · "));
    this.vSummary.className = `status-summary v ${atRisk > 0 ? "amber" : active.length > 0 && servedCount === active.length ? "green" : ""}`;

    this.syncRows(state.contracts);
  }

  /** Map a router binding axis to a short triage phrase (WHY a demand is at risk). */
  private riskWord(reason: string | null): string {
    switch (reason) {
      case "connectivity": return "no path — launch over it";
      case "availability": return "coverage gaps — add a phased sat";
      case "latency": return "too slow — lower the orbit";
      case "bandwidth": return "over-cap — reroute or add capacity";
      default: return "at risk";
    }
  }

  private syncRows(contracts: NetContractRow[]): void {
    const sig = contracts.map((c) => `${c.id}:${c.state}`).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.rowsHost.replaceChildren();
      this.rows.clear();
      if (contracts.length === 0) {
        const empty = el("div", "net-contract-empty");
        empty.textContent = "— no demands yet —";
        this.rowsHost.append(empty);
      }
      for (const c of contracts) {
        const root = el("div", "status-row");
        const top = el("div", "status-row-top");
        const label = el("span", "status-label");
        const stateWord = el("span", "v");
        const served = el("span", "status-served");
        const earned = el("span", "status-earned");
        top.append(label, stateWord, served, earned);
        // The full-width at-risk REASON line (the fix-hint), shown only when an active demand is unserved.
        const reason = el("div", "status-reason");
        root.append(top, reason);
        this.rowsHost.append(root);
        this.rows.set(c.id, { root, label, state: stateWord, served, earned, reason });
      }
    }

    // Per-frame values + the worst-status rollup (warn if any active demand is UNSERVED).
    let worst: "ok" | "warn" | "crit" = "ok";
    for (const c of contracts) {
      const r = this.rows.get(c.id);
      if (!r) continue;
      const stateWord =
        c.state === "offered" ? "OFFERED"
        : c.state === "active" ? (c.served ? "SERVED ✓" : "UNSERVED")
        : c.state === "completed" ? "✓ DONE"
        : "✕ ENDED";
      const tone =
        c.state === "offered" ? "cyan"
        : c.state === "active" ? (c.served ? "green" : "amber")
        : c.state === "completed" ? "green"
        : "red";
      setText(r.label, c.label);
      r.state.className = `v ${tone}`;
      setText(r.state, stateWord);
      // The served slot stays a tight number; the WHY-at-risk phrase goes on its own full-width line.
      const atRisk = c.state === "active" && !c.served;
      setText(r.served, c.state !== "active" ? "—" : c.served ? fmtPct(c.servedFraction) : "0%");
      r.served.className = atRisk ? "status-served amber" : "status-served";
      setText(r.earned, fmtEuro(c.earnedEur));
      if (atRisk) {
        setText(r.reason, `↳ ${this.riskWord(c.bindingReason)}`);
        r.reason.style.display = "";
      } else {
        r.reason.style.display = "none";
      }
      if (atRisk) worst = worst === "crit" ? "crit" : "warn";
      if (c.state === "failed") worst = "crit";
    }
    this.worst = worst;
  }

  status(): "ok" | "warn" | "crit" {
    return this.worst;
  }

  subtitle(): string {
    return this.worst === "ok" ? "· all green" : this.worst === "warn" ? "· a gap" : "· breach";
  }
}

// --- tiny DOM helpers (mirror finance.ts / net-planner.ts) ------------------

function el(tag: string, className: string): HTMLElement {
  const node = document.createElement(tag);
  node.className = className;
  return node;
}

function group(name: string): HTMLElement {
  const g = el("div", "group");
  const legend = el("div", "legend");
  legend.textContent = name;
  g.appendChild(legend);
  return g;
}

function setText(node: HTMLElement, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}
