/**
 * X-boot — the ONE retro-OS beat at startup (DD-1, GDD §8 "the frame IS the machine"): a
 * short typed console that prints the machine coming alive and fades INTO the mission. This
 * is the §8 retro identity moment, NOT a loading screen. Never modal-pauses the sim;
 * dismissed by ANY input (Esc/click/key) or a 3.2 s auto-fade. Once per session.
 */
import { MISSION_WELCOME, REGISTRY_LICENCE_ISSUED } from "../panels/copy";

const LINE_DELAY_MS = 260;
/** SD-58 — the last line is now the PREMISE, not a status stub, so the hold has to be long
 * enough to actually read ~40 words. Four lines × 260 ms + this ≈ 3.4 s total, which is the
 * ~3.2 s the header always claimed. Any input still dismisses instantly, so an impatient
 * player is never held — the sim is never modal-paused either way. */
const HOLD_MS = 2400;

/**
 * Mount the boot sequence onto the app root. Returns the dismiss function (for tests).
 *
 * SKIPPABLE, THREE WAYS (SD-58) — the intro must never be something a player sits through:
 *   1. Any key or click dismisses it instantly (this was always true; it is now VISIBLE,
 *      which is the part that matters — an undiscoverable skip is not a skip).
 *   2. "never show this again" persists to prefs, so a returning player never sees it.
 *   3. The caller can decline to mount it at all (`?intro=0`, or the stored pref).
 * It never modal-pauses the sim, so skipping costs the player nothing either way.
 */
export function runBootSequence(
  app: HTMLElement,
  meta: { version: string; seed: string },
  opts?: { onNeverShowAgain?: () => void },
): () => void {
  if (document.querySelector(".boot-seq")) return () => {};
  const back = document.createElement("div");
  back.className = "boot-seq";
  const box = document.createElement("div");
  box.className = "boot-box";
  const title = document.createElement("div");
  title.className = "boot-title";
  title.textContent = "SIGNAL HORIZON";
  const sub = document.createElement("div");
  sub.className = "boot-sub";
  sub.textContent = meta.version;
  const log = document.createElement("div");
  log.className = "boot-log";
  box.append(title, sub, log);
  // SD-58 — the skip affordances, dim and out of the way. Chrome, not mission copy.
  const foot = document.createElement("div");
  foot.className = "boot-foot";
  const hint = document.createElement("span");
  hint.className = "boot-hint";
  hint.textContent = "any key skips";
  const never = document.createElement("button");
  never.className = "boot-never";
  never.type = "button";
  never.textContent = "never show this again";
  foot.append(hint, never);
  box.appendChild(foot);
  back.appendChild(box);
  app.appendChild(back);

  const lines = [
    "LINK MARGINS OK · RF SUBSYSTEMS NOMINAL",
    `EPHEMERIS LOADED · seed ${meta.seed}`,
    // SD-58 — the Registry issues the licence before the premise line lands, so the regulator
    // and the player's standing are established in the world's own voice at no reading cost.
    REGISTRY_LICENCE_ISSUED,
    MISSION_WELCOME,
  ];
  let i = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const dismiss = () => {
    for (const t of timers) clearTimeout(t);
    back.classList.add("done");
    setTimeout(() => back.remove(), 320);
    window.removeEventListener("keydown", dismiss);
    window.removeEventListener("pointerdown", dismiss);
  };
  window.addEventListener("keydown", dismiss);
  window.addEventListener("pointerdown", dismiss);
  // Stop the pointerdown here so the window-level dismiss does not also fire and race the
  // persist. This handler owns both the remembering and the dismissing.
  never.addEventListener("pointerdown", (e) => {
    e.stopPropagation();
    opts?.onNeverShowAgain?.();
    dismiss();
  });
  const step = () => {
    if (i >= lines.length) {
      timers.push(setTimeout(dismiss, HOLD_MS));
      return;
    }
    const ln = document.createElement("div");
    ln.className = "boot-line";
    ln.textContent = `› ${lines[i++]}`;
    log.appendChild(ln);
    timers.push(setTimeout(step, LINE_DELAY_MS));
  };
  step();
  return dismiss;
}
