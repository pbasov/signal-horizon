/**
 * X-boot — the ONE retro-OS beat at startup (DD-1, GDD §8 "the frame IS the machine"): a
 * short typed console that prints the machine coming alive and fades INTO the mission. This
 * is the §8 retro identity moment, NOT a loading screen. Never modal-pauses the sim;
 * dismissed by ANY input (Esc/click/key) or a 3.2 s auto-fade. Once per session.
 */
import { MISSION_WELCOME } from "../panels/copy";

const LINE_DELAY_MS = 260;
const HOLD_MS = 900;

/**
 * Mount the boot sequence onto the app root. Returns the dismiss function (for tests).
 *
 * `meta.resumed` (X-04b) is the one-line receipt for a run restored from the vault — when
 * present the console says the campaign came BACK rather than replaying the first-light
 * welcome at someone forty minutes into their hour.
 */
export function runBootSequence(app: HTMLElement, meta: { version: string; seed: string; resumed?: string | null }): () => void {
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
  back.appendChild(box);
  app.appendChild(back);

  const resumed = meta.resumed ?? null;
  const lines = [
    "LINK MARGINS OK · RF SUBSYSTEMS NOMINAL",
    `EPHEMERIS LOADED · seed ${meta.seed}`,
    // A resumed run replaces the cold-open welcome: the player is mid-campaign, and greeting
    // them as a newcomer is the one line that would read as the save having been lost.
    resumed ?? MISSION_WELCOME,
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
