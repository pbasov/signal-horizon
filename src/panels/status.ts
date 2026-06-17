/**
 * The always-visible bottom status strip — chrome, not a tiled PanelHandle.
 *
 * A single dense NOC-telemetry line: preset tabs on the left, a run of labelled
 * value cells (TILED state, play/pause, SCALE, Earth→Mars light delay, FOCUS,
 * CAM), an elastic spacer, the global key-hint legend, and — only while the
 * Sun blocks the Earth→Mars line of sight — a trailing red SOLAR OCCULT alarm.
 *
 * The DOM is built ONCE in the constructor; update() rewrites text and toggles
 * classes in place. The only structural churn is the alarm cell, which is
 * created/removed as state.losOcculted flips.
 */
import type { FrameState } from "../types";
import { fmtDuration } from "../format";

/** One labelled value cell: <div class="cell"><span class="lab">…</span><span class="val">…</span></div>. */
interface LabelCell {
  cell: HTMLElement;
  lab: HTMLElement;
  val: HTMLElement;
}

function makeLabelCell(extra: string, label: string): LabelCell {
  const cell = document.createElement("div");
  cell.className = extra ? `cell ${extra}` : "cell";
  const lab = document.createElement("span");
  lab.className = "lab";
  lab.textContent = label;
  const val = document.createElement("span");
  val.className = "val";
  cell.append(lab, val);
  return { cell, lab, val };
}

export class StatusStrip {
  readonly element: HTMLElement;

  /** Left cell holding the per-preset tab tokens; tokens are (re)built by setPresetTabs. */
  private readonly tabsCell: HTMLElement;
  /** name → its token span, so update() can highlight the active preset. */
  private readonly tabTokens = new Map<string, HTMLElement>();

  private readonly tiled: LabelCell;
  private readonly play: HTMLElement;
  private readonly playVal: HTMLElement;
  private readonly scale: LabelCell;
  private readonly em: LabelCell;
  private readonly focus: LabelCell;
  private readonly cam: LabelCell;
  /** E8 — the prefetch-policy readout cell: "AUTO 70%" / "AUTO+BLK 70%" / "MANUAL". */
  private readonly policy: LabelCell;

  /** The trailing alarm cell, present in the DOM only while occulted. */
  private alarm: HTMLElement | null = null;

  /**
   * @param netMode — net/ Act-1: when true the bottom key-hint legend shows the CONNECTIVITY
   * game's keymap (planner-drag + launch/accept/cache verbs), and the PREFETCH-policy cell is
   * dropped (no prefetch economy in the net game). When false it is the M1-cache keymap, exactly
   * as before (fix #2 — the bottom HUD must match the mode, not show "P prefetch · A policy").
   */
  constructor(private netMode = false) {
    this.element = document.createElement("div");
    this.element.className = "statusstrip";

    // --- preset tabs (left) ---
    this.tabsCell = document.createElement("div");
    this.tabsCell.className = "cell tabs";

    // --- TILED indicator ---
    this.tiled = makeLabelCell("", "TILED");

    // --- play / pause ---
    this.play = document.createElement("div");
    this.play.className = "cell play";
    this.playVal = document.createElement("span");
    this.playVal.className = "val";
    this.play.appendChild(this.playVal);

    // --- SCALE ---
    this.scale = makeLabelCell("", "SCALE");

    // --- E→M light delay (amber) ---
    this.em = makeLabelCell("", "E→M");
    this.em.val.className = "val amber";

    // --- FOCUS ---
    this.focus = makeLabelCell("", "FOCUS");

    // --- CAM ---
    this.cam = makeLabelCell("", "CAM");

    // --- PREFETCH policy (E8 — the tame-it lever) ---
    this.policy = makeLabelCell("", "PREFETCH");

    // --- elastic spacer ---
    const spacer = document.createElement("div");
    spacer.className = "cell spacer";

    // --- key-hint legend ---
    const keys = document.createElement("div");
    keys.className = "cell keys";
    if (netMode) {
      // net/ M1 (SD-44) — THE CLEAN NET KEYMAP (the legend shows ONLY keys that work in net mode;
      // accept / constellation / prefer are panel BUTTONS now, the camera is set by the desktop, and
      // every cache-era key is cut — see the main.ts net key handler). Reads as one short row.
      appendKeys(keys, "1-5");
      keys.append(" desktops ");
      appendKeys(keys, "0");
      keys.append(" reset ");
      appendKeys(keys, "Space");
      keys.append(" pause ");
      appendKeys(keys, ",", ".");
      keys.append(" speed ");
      appendKeys(keys, "↑", "↓");
      keys.append(" alt ");
      appendKeys(keys, "←", "→");
      keys.append(" inc ");
      appendKeys(keys, "[", "]");
      keys.append(" phase ");
      appendKeys(keys, "L");
      keys.append(" launch ");
      appendKeys(keys, "R");
      keys.append(" cam");
    } else {
      // M1-cache verbs (unchanged).
      appendKeys(keys, "1-3");
      keys.append(" presets ");
      appendKeys(keys, "0");
      keys.append(" reset ");
      appendKeys(keys, "E", "C", "O", "S", "T");
      keys.append(" cam ");
      appendKeys(keys, "R");
      keys.append(" reset ");
      appendKeys(keys, "Space");
      keys.append(" pause ");
      appendKeys(keys, ",", ".");
      keys.append(" speed ");
      appendKeys(keys, "F");
      keys.append(" focus ");
      appendKeys(keys, "P");
      keys.append(" prefetch ");
      appendKeys(keys, "A");
      keys.append(" policy ");
      appendKeys(keys, "[", "]");
      keys.append(" floor ");
      appendKeys(keys, "G");
      keys.append(" parse");
    }

    // net/ Act-1 — the PREFETCH-policy cell is a CACHE-game readout (no prefetch economy in the
    // net game), so it mounts only in cache mode (fix #2 — the strip carries only mode-relevant cells).
    const cells: HTMLElement[] = [
      this.tabsCell,
      this.tiled.cell,
      this.play,
      this.scale.cell,
    ];
    // E→M is the Earth↔Mars light-delay (a CACHE-game readout). The connectivity game is an
    // Earth-orbit puzzle, so the strip drops it in net mode (it would surface "Mars" at the
    // cold open). It returns in ?mode=cache, where the Earth↔Mars delay IS the core constraint.
    if (!netMode) cells.push(this.em.cell);
    cells.push(this.focus.cell, this.cam.cell);
    if (!netMode) cells.push(this.policy.cell);
    cells.push(spacer, keys);
    this.element.append(...cells);
  }

  /**
   * Render the preset tab tokens: for each name at index i, a token reading
   * "<i+1> NAME" (e.g. "1 OVERVIEW  2 OPS  …"). References are kept so update()
   * can highlight whichever preset is active.
   */
  setPresetTabs(names: string[]): void {
    this.tabsCell.replaceChildren();
    this.tabTokens.clear();
    names.forEach((name, i) => {
      const token = document.createElement("span");
      token.className = "tab";
      const key = document.createElement("span");
      key.className = "lab";
      key.textContent = String(i + 1);
      const label = document.createElement("span");
      label.className = "val";
      label.textContent = name;
      token.append(key, label);
      this.tabsCell.appendChild(token);
      this.tabTokens.set(name, token);
    });
  }

  /** Per-frame refresh: text + classes only, no structural rebuild (save the alarm). */
  update(state: FrameState): void {
    // Highlight the active preset tab.
    for (const [name, token] of this.tabTokens) {
      const active = name === state.wmPreset;
      token.classList.toggle("active", active);
      const val = token.lastElementChild as HTMLElement;
      val.className = active ? "val cyan" : "val";
    }

    // TILED · <wmPreset> · <cameraPreset>
    setText(this.tiled.val, `${state.wmPreset} · ${state.cameraPreset}`);

    // play / pause
    this.play.className = state.paused ? "cell paused" : "cell play";
    setText(this.playVal, state.paused ? "❚❚" : "▶");

    // SCALE
    setText(this.scale.val, state.scaleLabel);

    // E→M light delay
    setText(this.em.val, fmtDuration(state.oneWaySeconds));

    // FOCUS
    setText(this.focus.val, state.focusBody.toUpperCase());

    // CAM
    setText(this.cam.val, state.cameraPreset);

    // PREFETCH policy (E8 — the tame-it lever). MANUAL is the hand-crank baseline
    // (neutral); AUTO @ floor% is the autopilot ON (cyan = under control); the +BLK
    // suffix marks blackout pre-staging armed, and the cell flashes cyan-bright the
    // step a pre-stage actually FIRES (the relief you can see). Skipped in net mode —
    // the cell is not mounted there (no prefetch economy in the connectivity game).
    const d = state.demand;
    if (this.netMode) {
      // no prefetch cell in net mode.
    } else if (d.policyMode === "manual") {
      setText(this.policy.val, "MANUAL");
      this.policy.val.className = "val";
    } else {
      const floorPct = Math.round(d.policyFloor * 100);
      const tag = d.policyMode === "freshness_blackout" ? "AUTO+BLK" : "AUTO";
      setText(this.policy.val, `${tag} ${floorPct}%`);
      this.policy.val.className = d.autoPrefetched.length > 0 ? "val green" : "val cyan";
    }

    // solar-occult alarm (created/removed dynamically)
    if (state.losOcculted && !this.alarm) {
      this.alarm = document.createElement("div");
      this.alarm.className = "cell alarm";
      this.alarm.textContent = "✕ SOLAR OCCULT";
      this.element.appendChild(this.alarm);
    } else if (!state.losOcculted && this.alarm) {
      this.alarm.remove();
      this.alarm = null;
    }
  }
}

/** Append one or more <kbd> chips to a hint cell. */
function appendKeys(host: HTMLElement, ...labels: string[]): void {
  for (const label of labels) {
    const kbd = document.createElement("kbd");
    kbd.textContent = label;
    host.appendChild(kbd);
  }
}

/** Set textContent only when it actually changed (avoids needless layout churn). */
function setText(el: HTMLElement, text: string): void {
  if (el.textContent !== text) el.textContent = text;
}
