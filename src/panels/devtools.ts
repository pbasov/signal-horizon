/**
 * SD-56 — THE DEV CONSOLE. A summonable panel (host `devtools`, rail button `DEV`, key `\`)
 * that collapses the slow parts of a playtest into single clicks: SKIP ACT, warp sim-time,
 * top up the wallet, collapse the launch pipeline, freeze the tender clock, arm or clear
 * faults, and jump straight to a seeded bench state.
 *
 * WHAT THIS PANEL IS. A tile like any other — it lives in the tiling grid, obeys the
 * always-tiled invariant, and carries §8 1-bit chrome (dashed groups, bordered buttons; the
 * only colour is the amber DEBUG banner and the green/amber gate glyphs, each redundant with
 * a WORD so it reads colour-off). `main.ts` constructs it only under `import.meta.env.DEV`
 * OR an explicit `?dev=1`, so an ordinary production run registers no host, no rail button
 * and no key — the console is DORMANT, not absent. `?dev=1` deliberately still opens it in a
 * built bundle, because the screenshot harness runs `vite preview` against production and a
 * prod-only bug needs the same console a dev run gets.
 *
 * THE HONESTY RULE. A cheat is not a player action, so nothing here is recorded to the
 * SaveGame action log and a cheated run does NOT replay. The panel says exactly that on its
 * face, every cheat writes an amber DEBUG line to the WIRE, and the state block always shows
 * whether the run has been touched — so a cheated run can never be mistaken for real play,
 * or its screenshot for evidence.
 *
 * RENDER/UI ONLY. The panel owns no state except its own toggle chrome; every verb is a
 * callback in {@link DevHooks} that `main.ts` fulfils, and every readout arrives in
 * {@link DevViewState}. Built ONCE (X-02); the per-frame `render` writes text into existing
 * nodes and never rebuilds DOM.
 *
 * @see src/sim/net/devtools.ts (the pure cheat engine) · docs/decisions.md SD-56
 */
import type { PanelHandle } from "../wm/shell";
import { DEV_ACT_LABELS, type BeatDescription } from "../sim/net/devtools";

/** The console's TURBO steps — extra sim ticks drained per frame beyond the clock's own
 * time-accel, so a run can be pushed past the `MAX_TICKS_PER_FRAME` ceiling. ×1 = off. */
export const DEV_TURBO_STEPS = [1, 4, 16, 64] as const;

/** The console's WARP buttons: label + sim-seconds stepped synchronously on click. */
export const DEV_WARP_STEPS: { label: string; seconds: number }[] = [
  { label: "+10 s", seconds: 10 },
  { label: "+1 m", seconds: 60 },
  { label: "+10 m", seconds: 600 },
  { label: "+1 h", seconds: 3600 },
];

/** The console's wallet buttons: label + € delta (null = set to zero, the broke bench). */
export const DEV_MONEY_STEPS: { label: string; deltaEur: number | null }[] = [
  { label: "+€10k", deltaEur: 10_000 },
  { label: "+€100k", deltaEur: 100_000 },
  { label: "+€1M", deltaEur: 1_000_000 },
  { label: "BROKE", deltaEur: null },
];

/** One gate-blocker row: the predicate the CURRENT act's gate is waiting on, and whether
 * it is met. The console prints the word (MET / WAITING) beside the glyph so the state reads
 * colour-off (DD-1). */
export interface DevGateRow {
  label: string;
  met: boolean;
}

/** Everything the console prints. A pure read assembled by `main.ts` each frame. */
export interface DevViewState {
  /** Cursor index + the beat id, and how many beats the scenario has. */
  cursor: number;
  actId: string;
  actCount: number;
  /** The current beat's gate predicates (empty on act4 — a read, not a gate). */
  gateRows: DevGateRow[];
  tick: number;
  simSeconds: number;
  speedLabel: string;
  turbo: number;
  balanceEur: number;
  sats: number;
  pending: number;
  underburn: number;
  offered: number;
  active: number;
  completed: number;
  failed: number;
  escalation: boolean;
  faultsArmed: boolean;
  /** A one-line fault summary ("—" when none active). */
  faultLine: string;
  /** How many cheats have been fired this run (0 ⇒ the run is still clean). */
  cheatCount: number;
  /** The last cheat's WIRE note (""  before the first cheat). */
  lastCheat: string;
  /** Live toggle states the console lights. */
  solventLock: boolean;
  safeLaunchLock: boolean;
  /** SANDBOX MODE — the one-switch sightseeing state (all acts, all missions, ∞ money, no
   * expiry). Standing, not one-shot: it keeps holding as new offers arrive. */
  sandbox: boolean;
  /** Which authored contract ids are on the board right now, so the mission browser can say
   * which missions are already up. */
  onBoard: ReadonlySet<string>;
}

/** Every verb the console offers. `main.ts` supplies them; the panel only wires clicks. */
export interface DevHooks {
  /** THE ONE SWITCH: unlock every act, put every authored mission on the board, hold the
   * wallet, and stop everything expiring. Toggles SANDBOX MODE off again. */
  toggleSandbox(): void;
  /** Put ONE beat's authored demand on the board WITHOUT moving the scenario cursor — the
   * "let me just look at this mission" verb. */
  offerBeat(cursor: number): void;
  /** Advance ONE beat (fences armed, the new beat's emit fired). */
  skipAct(): void;
  /** Step back ONE beat so its gate can be re-driven by hand. */
  rewindAct(): void;
  /** Jump to a beat by cursor index (forward walks every beat so each arrival fires). */
  jumpToAct(cursor: number): void;
  /** Step the sim forward by `seconds` synchronously (the loop's own tick path). */
  warp(seconds: number): void;
  /** Set the extra-ticks-per-frame multiplier (1 = off). */
  setTurbo(mult: number): void;
  /** Credit € (null ⇒ set the wallet to zero). */
  money(deltaEur: number | null): void;
  /** Keep the wallet topped up every frame. */
  toggleSolventLock(): void;
  /** Accept every OFFERED contract on the board. */
  signAllOffers(): void;
  /** Stop the lapse clock + pay decay on every offer. */
  freezeOffers(): void;
  /** Put untouched lapsed tenders back on the board. */
  reopenLapsed(): void;
  /** Zero the breach windows + restart the availability clean streak. */
  clearBreach(): void;
  /** Collapse the countdown/ascent so the batch separates now. */
  deployNow(): void;
  /** Force every in-flight member to a clean outcome. */
  safeLaunch(): void;
  /** Keep forcing clean launch outcomes every frame. */
  toggleSafeLaunchLock(): void;
  /** Free bulk circularize of every underburned sat. */
  circularizeAll(): void;
  /** Arm the fault generator and queue the mild-first trio. */
  armFaults(): void;
  /** Wipe active + queued faults (the generator stays armed). */
  clearFaults(): void;
  /** Wipe faults AND close the generator. */
  disarmFaults(): void;
  /** Seed the multi-sat served network (the `?netview=net` bench). */
  seedLiveNetwork(): void;
  /** Seed the Act-4 Mars frontier (the `?netview=mars` bench). */
  seedMarsFrontier(): void;
  quickSave(): void;
  quickLoad(): void;
  /** Reload the page for a clean, uncheated run. */
  restartRun(): void;
  /** Copy the net snapshot as JSON to the clipboard. */
  copyState(): void;
  /** Print the recorded action log to the console. */
  logActions(): void;
}

export class DevConsole implements PanelHandle {
  readonly title = "DEV CONSOLE";
  readonly content: HTMLElement;

  private readonly vals = new Map<string, HTMLElement>();
  private readonly gateHost: HTMLElement;
  private readonly gateRows: { root: HTMLElement; glyph: HTMLElement; label: HTMLElement; word: HTMLElement }[] = [];
  private readonly actBtns: HTMLButtonElement[] = [];
  private readonly turboBtns: HTMLButtonElement[] = [];
  private readonly solventBtn: HTMLButtonElement;
  private readonly safeLaunchBtn: HTMLButtonElement;
  private readonly sandboxBtn: HTMLButtonElement;
  private readonly sandboxState: HTMLElement;
  private readonly missionRows: { root: HTMLElement; btn: HTMLButtonElement; state: HTMLElement; ids: string[] }[] = [];
  private readonly cheatNote: HTMLElement;
  private lastSig = "";

  /**
   * @param hooks the verbs `main.ts` fulfils
   * @param beats what each authored beat emits — DERIVED at boot by
   *        {@link import("../sim/net/devtools").describeBeats}, never hand-listed here, so
   *        the mission browser cannot drift from `scenario.ts`.
   */
  constructor(
    private hooks: DevHooks,
    private beats: BeatDescription[] = [],
  ) {
    this.content = el("div", "telem dev-console");

    // --- the DEBUG banner: the first thing read, and the reason the panel is trustworthy.
    const banner = el("div", "dev-banner");
    banner.textContent =
      "DEBUG · cheats are NOT recorded to the action log — a cheated run does not replay, and its screenshot is not evidence.";
    this.content.append(banner);

    // --- SANDBOX — THE ONE SWITCH -------------------------------------------------
    // Top of the panel because it is the answer to "I just want to look at the missions":
    // one click (or one key) replaces jump-to-act-4 + freeze + top-up + un-lapse, and unlike
    // those one-shots it KEEPS holding as the run goes on.
    const sandbox = group("SANDBOX · THE ONE SWITCH");
    this.sandboxBtn = btn("UNLOCK EVERYTHING", () => this.hooks.toggleSandbox());
    this.sandboxBtn.classList.add("dev-big");
    sandbox.append(buttons([this.sandboxBtn]));
    this.sandboxState = el("div", "net-hint dev-sandbox-state");
    sandbox.append(this.sandboxState);
    sandbox.append(
      hint(
        "All acts unlocked · every authored mission on the board · wallet topped up · offers never lapse, pay never decays, and a signed mission can't breach out from under you. A term can still COMPLETE — finishing is a result worth seeing, not a way to die. Key: \\ opens this panel, | is the switch.",
      ),
    );
    this.content.append(sandbox);

    // --- MISSIONS — the browser ----------------------------------------------------
    // One row per authored beat, naming the demands its emit puts on the board. OFFER fires
    // exactly that beat's own `emit` at the current sim-time and does NOT move the cursor —
    // so a mission can be inspected outside the act that would normally gate it.
    const missions = group("MISSIONS · PUT ANY ON THE BOARD");
    for (const b of this.beats) {
      const row = el("div", "dev-mission");
      const head = el("div", "dev-mission-head");
      const act = el("span", "dev-mission-act");
      act.textContent = DEV_ACT_LABELS[b.cursor] ?? b.actId;
      const what = el("span", "dev-mission-what");
      const demands = b.labels.length > 0 ? b.labels.join(" + ") : "no demand";
      what.textContent = b.effects.length > 0 ? `${demands} · arms ${b.effects.join(" + ")}` : demands;
      const state = el("span", "dev-mission-state");
      const go = btn(b.labels.length > 0 ? "OFFER" : "ARM", () => this.hooks.offerBeat(b.cursor));
      go.classList.add("dev-mission-btn");
      head.append(act, what, state, go);
      row.append(head);
      missions.append(row);
      this.missionRows.push({ root: row, btn: go, state, ids: b.contractIds });
    }
    missions.append(
      hint(
        "OFFER fires that beat's own authored arrival at the current sim-time and leaves the cursor where it is — the mission lands on the board outside its act, which is the point. Idempotent: the board de-dupes by id.",
      ),
    );
    this.content.append(missions);

    // --- RUN STATE ----------------------------------------------------------------
    const state = group("RUN STATE");
    this.row(state, "act", "ACT");
    this.gateHost = el("div", "dev-gates");
    state.append(this.gateHost);
    this.row(state, "tick", "TICK");
    this.row(state, "sim", "SIM T");
    this.row(state, "speed", "SPEED");
    this.row(state, "wallet", "WALLET");
    this.row(state, "fleet", "FLEET");
    this.row(state, "demand", "DEMAND");
    this.row(state, "systems", "SYSTEMS");
    this.row(state, "faults", "FAULTS");
    this.row(state, "cheats", "CHEATS FIRED");
    this.content.append(state);

    // --- SCENARIO — the headline verb ---------------------------------------------
    const scen = group("SCENARIO · SKIP ACTS");
    scen.append(
      buttons([
        btn("SKIP ACT ▸", () => this.hooks.skipAct()),
        btn("◂ REWIND", () => this.hooks.rewindAct()),
      ]),
    );
    const jump = el("div", "net-buttons dev-wrap");
    for (let i = 0; i < DEV_ACT_LABELS.length; i++) {
      const b = btn(DEV_ACT_LABELS[i], () => this.hooks.jumpToAct(i));
      this.actBtns.push(b);
      jump.append(b);
    }
    scen.append(jump);
    scen.append(
      hint(
        "A jump ARMS the witnesses the beats' own fences assert (act3b throws without the act3a re-tame) and steps once per beat, so every act's authored demand actually lands on the board.",
      ),
    );
    this.content.append(scen);

    // --- TIME ---------------------------------------------------------------------
    const time = group("TIME");
    time.append(buttons(DEV_WARP_STEPS.map((w) => btn(w.label, () => this.hooks.warp(w.seconds)))));
    const turbo = el("div", "net-buttons");
    const turboCap = el("span", "dev-cap");
    turboCap.textContent = "TURBO";
    turbo.append(turboCap);
    for (const mult of DEV_TURBO_STEPS) {
      const b = btn(`×${mult}`, () => this.hooks.setTurbo(mult));
      this.turboBtns.push(b);
      turbo.append(b);
    }
    time.append(turbo);
    time.append(
      hint(
        "WARP steps the sim synchronously (the frame stalls for it, so the big jumps take a moment). TURBO drains extra ticks every frame past the clock's own ceiling, under a wall-time budget so the UI stays alive.",
      ),
    );
    this.content.append(time);

    // --- MONEY --------------------------------------------------------------------
    const money = group("MONEY");
    money.append(buttons(DEV_MONEY_STEPS.map((m) => btn(m.label, () => this.hooks.money(m.deltaEur)))));
    this.solventBtn = btn("∞ MONEY", () => this.hooks.toggleSolventLock());
    money.append(buttons([this.solventBtn]));
    this.content.append(money);

    // --- DEMAND -------------------------------------------------------------------
    const demand = group("DEMAND · TENDERS");
    demand.append(
      buttons([
        btn("SIGN ALL OFFERS", () => this.hooks.signAllOffers()),
        btn("FREEZE OFFERS", () => this.hooks.freezeOffers()),
      ]),
    );
    demand.append(
      buttons([
        btn("RE-OFFER LAPSED", () => this.hooks.reopenLapsed()),
        btn("CLEAR BREACH", () => this.hooks.clearBreach()),
      ]),
    );
    demand.append(
      hint(
        "FREEZE is the one to reach for while poking at the pad — a tender's window lapses long before a hand-driven experiment finishes.",
      ),
    );
    this.content.append(demand);

    // --- FLEET --------------------------------------------------------------------
    const fleet = group("FLEET · LAUNCH PIPELINE");
    fleet.append(
      buttons([
        btn("DEPLOY NOW", () => this.hooks.deployNow()),
        btn("SAFE LAUNCH", () => this.hooks.safeLaunch()),
      ]),
    );
    this.safeLaunchBtn = btn("NO FAILURES", () => this.hooks.toggleSafeLaunchLock());
    fleet.append(buttons([this.safeLaunchBtn, btn("CIRCULARIZE ALL", () => this.hooks.circularizeAll())]));
    this.content.append(fleet);

    // --- FAULTS -------------------------------------------------------------------
    const faults = group("FAULTS");
    faults.append(
      buttons([
        btn("ARM + QUEUE TRIO", () => this.hooks.armFaults()),
        btn("CLEAR", () => this.hooks.clearFaults()),
        btn("DISARM", () => this.hooks.disarmFaults()),
      ]),
    );
    faults.append(
      hint(
        "ARM flips the generator on and queues the mild-first trio (degradation → transient → telegraphed). They fire off the seeded roll over the following ticks, sequenced in time — warp or turbo to reach them.",
      ),
    );
    this.content.append(faults);

    // --- BENCH --------------------------------------------------------------------
    const bench = group("BENCH · SEEDS + PROBES");
    bench.append(
      buttons([
        btn("SEED LIVE NET", () => this.hooks.seedLiveNetwork()),
        btn("SEED MARS", () => this.hooks.seedMarsFrontier()),
      ]),
    );
    bench.append(
      buttons([
        btn("QUICK SAVE", () => this.hooks.quickSave()),
        btn("QUICK LOAD", () => this.hooks.quickLoad()),
        btn("RESTART RUN", () => this.hooks.restartRun()),
      ]),
    );
    bench.append(
      buttons([
        btn("COPY STATE", () => this.hooks.copyState()),
        btn("LOG ACTIONS", () => this.hooks.logActions()),
      ]),
    );
    this.cheatNote = el("div", "net-hint dev-note");
    bench.append(this.cheatNote);
    this.content.append(bench);
  }

  /** Titlebar dot: the console is ALWAYS a warning — its presence means the run is
   * debuggable, and it goes red once a cheat has actually been fired. */
  status(): "ok" | "warn" | "crit" | "idle" {
    return this.lastSig.startsWith("dirty") ? "crit" : "warn";
  }

  subtitle(): string {
    return "· debug · not a play path";
  }

  /** Per-frame repaint, dirty-checked on a signature of everything printed, so an open
   * console on a paused run costs one string compare. */
  render(s: DevViewState): void {
    const sig = [
      s.cheatCount > 0 ? "dirty" : "clean",
      s.sandbox,
      [...s.onBoard].sort().join(","),
      s.cursor,
      s.gateRows.map((g) => `${g.label}${g.met ? 1 : 0}`).join("|"),
      s.tick,
      s.speedLabel,
      s.turbo,
      Math.round(s.balanceEur),
      s.sats,
      s.pending,
      s.underburn,
      s.offered,
      s.active,
      s.completed,
      s.failed,
      s.escalation,
      s.faultsArmed,
      s.faultLine,
      s.cheatCount,
      s.lastCheat,
      s.solventLock,
      s.safeLaunchLock,
    ].join("~");
    if (sig === this.lastSig) return;
    this.lastSig = sig;

    this.set("act", `${s.actId}  ·  ${s.cursor + 1} of ${s.actCount}`, s.cursor >= s.actCount - 1 ? "watch" : "");
    this.set("tick", s.tick.toLocaleString("en-GB").replace(/,/g, " "));
    this.set("sim", `${s.simSeconds.toFixed(1)} s`);
    this.set("speed", s.turbo > 1 ? `${s.speedLabel} · turbo ×${s.turbo}` : s.speedLabel, s.turbo > 1 ? "warn" : "");
    this.set("wallet", fmtEur(s.balanceEur), s.balanceEur < 0 ? "red" : "");
    this.set(
      "fleet",
      `${s.sats} live · ${s.pending} in flight · ${s.underburn} underburn`,
      s.underburn > 0 ? "warn" : "",
    );
    this.set("demand", `${s.active} active · ${s.offered} offered · ${s.completed} done · ${s.failed} lapsed`);
    this.set("systems", `escalation ${s.escalation ? "ON" : "off"} · faults ${s.faultsArmed ? "ARMED" : "off"}`);
    this.set("faults", s.faultLine, s.faultLine === "—" ? "" : "warn");
    this.set(
      "cheats",
      s.cheatCount === 0 ? "0 · run is CLEAN" : `${s.cheatCount} · run is CHEATED`,
      s.cheatCount === 0 ? "green" : "red",
    );

    this.renderGates(s.gateRows);

    for (let i = 0; i < this.actBtns.length; i++) this.actBtns[i].classList.toggle("active", i === s.cursor);
    for (let i = 0; i < this.turboBtns.length; i++) {
      this.turboBtns[i].classList.toggle("active", DEV_TURBO_STEPS[i] === s.turbo);
    }
    this.solventBtn.classList.toggle("active", s.solventLock);
    this.safeLaunchBtn.classList.toggle("active", s.safeLaunchLock);

    // SANDBOX: the switch reads its own state as a WORD, and spells out the four holds so
    // nobody has to remember what "unlocked" covered (it also reads colour-off).
    this.sandboxBtn.classList.toggle("active", s.sandbox);
    this.sandboxBtn.textContent = s.sandbox ? "SANDBOX ON — CLICK TO RESTORE" : "UNLOCK EVERYTHING";
    const allUp = this.beats.every((b) => b.contractIds.every((id) => s.onBoard.has(id)));
    this.sandboxState.textContent = s.sandbox
      ? `▣ acts unlocked  ▣ missions ${allUp ? "all on the board" : "landing"}  ▣ ∞ money  ▣ no expiry`
      : "▢ off — the run gates, prices and expires normally";
    this.sandboxState.className = `net-hint dev-sandbox-state${s.sandbox ? " warn" : ""}`;

    // MISSIONS: mark the rows whose demand is already up, so the browser reads as a checklist.
    for (const row of this.missionRows) {
      const up = row.ids.length > 0 && row.ids.every((id) => s.onBoard.has(id));
      row.state.textContent = row.ids.length === 0 ? "" : up ? "ON BOARD" : "";
      row.root.classList.toggle("up", up);
      row.btn.textContent = row.ids.length === 0 ? "ARM" : up ? "RE-OFFER" : "OFFER";
    }
    this.cheatNote.textContent = s.lastCheat === "" ? "No cheat fired yet — this run still replays." : `↳ ${s.lastCheat}`;
    this.cheatNote.className = `net-hint dev-note${s.lastCheat === "" ? " good" : " warn"}`;
  }

  /** The CURRENT act's gate predicates, grown/reused in place (never rebuilt). */
  private renderGates(rows: DevGateRow[]): void {
    while (this.gateRows.length < rows.length) {
      const root = el("div", "dev-gate");
      const glyph = el("span", "dev-gate-glyph");
      const label = el("span", "dev-gate-label");
      const word = el("span", "dev-gate-word");
      root.append(glyph, label, word);
      this.gateHost.append(root);
      this.gateRows.push({ root, glyph, label, word });
    }
    for (let i = 0; i < this.gateRows.length; i++) {
      const view = this.gateRows[i];
      const row = rows[i];
      if (row === undefined) {
        view.root.style.display = "none";
        continue;
      }
      view.root.style.display = "";
      view.root.className = `dev-gate${row.met ? " met" : ""}`;
      view.glyph.textContent = row.met ? "✓" : "·";
      view.label.textContent = row.label;
      view.word.textContent = row.met ? "MET" : "WAITING";
    }
  }

  private row(host: HTMLElement, key: string, label: string): void {
    const r = el("div", "row");
    const l = el("span", "label");
    l.textContent = label;
    const v = el("span", "v");
    r.append(l, v);
    host.append(r);
    this.vals.set(key, v);
  }

  private set(key: string, text: string, tone = ""): void {
    const v = this.vals.get(key);
    if (v === undefined) return;
    v.textContent = text;
    v.className = tone === "" ? "v" : `v ${tone}`;
  }
}

// --- € + DOM helpers (the panel-local idiom used across src/panels) -----------

/** Round FIRST, then take the sign — otherwise a wallet sitting at −€0.4 (one tick of opex
 * past zero) prints the nonsense "−€0". */
function fmtEur(n: number): string {
  const whole = Math.round(n);
  const sign = whole < 0 ? "−" : "";
  return `${sign}€${Math.abs(whole)
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, " ")}`;
}

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

function btn(label: string, onClick: () => void): HTMLButtonElement {
  const b = document.createElement("button");
  b.className = "net-btn dev-btn";
  b.type = "button";
  b.textContent = label;
  b.addEventListener("click", onClick);
  return b;
}

function buttons(kids: HTMLElement[]): HTMLElement {
  const row = el("div", "net-buttons");
  row.append(...kids);
  return row;
}

function hint(text: string): HTMLElement {
  const h = el("div", "net-hint");
  h.textContent = text;
  return h;
}
