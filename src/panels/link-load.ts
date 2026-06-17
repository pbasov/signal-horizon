/**
 * net/ M1 — LINK·LOAD (SD-44 PHASE 1, FIRST VERSION): the per-bridging-sat utilisation board for the
 * ROUTING desktop. One row per satellite currently carrying traffic — a 1-bit utilisation BAR, the
 * % load, the contract ids sharing it, and the binding constraint (the §4.3 oversubscription read,
 * now legible at rest). Holds no sim state: main.ts hands it a per-frame {@link LinkLoadState}
 * projected as a PURE read of the live NetSession (loadOnSat + lastSolveFor). With no traffic yet
 * the tile shows a dim "no traffic to route yet" line (Act 1, before any served contract).
 *
 * DD-1: 1-bit MACHINE chrome; COLOUR only on the DATA, and the utilisation reads redundant on the
 * BAR WIDTH + the % number (green headroom / amber tight / red over-cap), not colour alone.
 */
import type { PanelHandle } from "../wm/shell";

/** One sharing contract's slice of a shared sat — the ALLOCATION LEDGER row (§4.3). When the sat is
 * over capacity the link can no longer honor every floor, so capacity is split in PROPORTION to each
 * contract's offered load; this is that contract's resulting served bandwidth vs its committed floor. */
export interface LinkLoadShare {
  /** The sharing contract's region id. */
  contractId: string;
  /** This contract's served bandwidth on the shared sat right now (full demand when under cap; the
   * proportional fair-share `capacity·own/shared` when the sat is over-subscribed). */
  served: number;
  /** The contract's committed bandwidth floor (slaBandwidth; 0 when its bandwidth axis isn't enforced). */
  floor: number;
  /** STARVED: the sat is over-cap AND this contract's fair-share has fallen below its floor — it is
   * breaching, and you must protect it (reroute) or it loses the contract. The loser of the collision. */
  underFloor: boolean;
}

/** One bridging satellite's utilisation, projected for a row. */
export interface LinkLoadRow {
  /** The bridging sat id. */
  satId: string;
  /** Utilisation 0..1+ (load / capacity); >1 is over-subscribed. */
  util: number;
  /** The contract ids sharing this sat (the demand riding it). */
  contracts: string[];
  /** The binding constraint word, or "—" when none binds (room to spare). */
  binding: string;
  /** The per-contract ALLOCATION LEDGER — each sharing contract's served-share vs its floor. The
   * "who do I protect, who do I sacrifice" surface when the sat tips over capacity. */
  shares: LinkLoadShare[];
}

/** The LINK·LOAD render state (a pure projection of the live net session). */
export interface LinkLoadState {
  rows: LinkLoadRow[];
}

export class LinkLoad implements PanelHandle {
  readonly title = "LINK·LOAD";
  readonly content: HTMLElement;

  private rowsHost: HTMLElement;
  private rows = new Map<string, { root: HTMLElement; head: HTMLElement; bar: HTMLElement; fill: HTMLElement; pct: HTMLElement; meta: HTMLElement; ledger: HTMLElement }>();
  private sig = "";
  private emptyLine: HTMLElement;
  private group: HTMLElement;

  private worst: "ok" | "warn" | "crit" = "ok";

  constructor() {
    this.content = el("div", "telem");

    this.group = group("LINK·LOAD · PER SAT");
    this.emptyLine = el("div", "net-hint");
    this.emptyLine.textContent = "no traffic to route yet";
    this.group.append(this.emptyLine);
    this.rowsHost = el("div", "linkload-rows");
    this.group.append(this.rowsHost);
    this.content.append(this.group);
  }

  render(state: LinkLoadState): void {
    if (state.rows.length === 0) {
      this.emptyLine.style.display = "";
      this.rowsHost.style.display = "none";
      this.worst = "ok";
      return;
    }
    this.emptyLine.style.display = "none";
    this.rowsHost.style.display = "";

    const sig = state.rows.map((r) => r.satId).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.rowsHost.replaceChildren();
      this.rows.clear();
      for (const r of state.rows) {
        const root = el("div", "linkload-row");
        const head = el("div", "linkload-head");
        const bar = el("div", "linkload-bar");
        const fill = el("div", "linkload-bar-fill");
        bar.append(fill);
        const pct = el("span", "linkload-pct");
        head.append(el("span", "linkload-id"), pct);
        (head.firstChild as HTMLElement).textContent = r.satId;
        const meta = el("div", "linkload-meta");
        const ledger = el("div", "linkload-ledger");
        root.append(head, bar, meta, ledger);
        this.rowsHost.append(root);
        this.rows.set(r.satId, { root, head, bar, fill, pct, meta, ledger });
      }
    }

    let worst: "ok" | "warn" | "crit" = "ok";
    for (const r of state.rows) {
      const e = this.rows.get(r.satId);
      if (!e) continue;
      const pct = Math.round(r.util * 100);
      const tone = r.util >= 1 ? "red" : r.util >= 0.8 ? "amber" : "green";
      e.fill.style.width = `${Math.min(100, pct)}%`;
      e.fill.className = `linkload-bar-fill ${tone}`;
      e.pct.className = `linkload-pct v ${tone}`;
      setText(e.pct, `${pct}%${r.util >= 1 ? " · OVER" : ""}`);
      setText(e.meta, `shared by ${r.contracts.join(", ") || "—"} · binds ${r.binding}`);
      // ALLOCATION LEDGER — only worth showing when ≥2 contracts contend (a real split). Each line is
      // one contract's served-share vs its floor; the STARVED one (over-cap + under floor) is the loser
      // you must protect (reroute) or sacrifice. Below 2 sharers there is nothing to allocate.
      if (r.shares.length >= 2) {
        e.ledger.style.display = "";
        const lines = r.shares
          .map((s) => {
            const flag = s.underFloor ? " ✕ STARVED" : s.floor > 0 ? " ✓" : "";
            return `${s.contractId}: ${s.served.toFixed(1)}/${s.floor > 0 ? s.floor.toFixed(1) : "—"}${flag}`;
          })
          .join("   ");
        setText(e.ledger, `alloc · ${lines}`);
        e.ledger.className = `linkload-ledger${r.shares.some((s) => s.underFloor) ? " red" : ""}`;
      } else {
        e.ledger.style.display = "none";
      }
      if (r.util >= 1) worst = "crit";
      else if (r.util >= 0.8 && worst !== "crit") worst = "warn";
    }
    this.worst = worst;
  }

  status(): "ok" | "warn" | "crit" {
    return this.worst;
  }

  subtitle(): string {
    return this.worst === "crit" ? "· over-cap" : this.worst === "warn" ? "· tight" : "· headroom";
  }
}

// --- tiny DOM helpers -------------------------------------------------------

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
