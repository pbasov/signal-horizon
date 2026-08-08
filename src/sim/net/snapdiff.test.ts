import { it } from "vitest";
import { loadEphemeris } from "/home/basov/Games/signal-horizon/src/sim/system-data";
import { NetSession } from "/home/basov/Games/signal-horizon/src/sim/net/session";
import { act4Log, GOLDEN_DT } from "/home/basov/Games/signal-horizon/src/sim/net/canon";
import { applyNetAction } from "/home/basov/Games/signal-horizon/src/sim/net/apply-action";

it("DIFF", () => {
  const eph = loadEphemeris();
  const sg = act4Log();
  const byTick = new Map<number, typeof sg.actions>();
  for (const a of sg.actions) { const l = byTick.get(a.atTick) ?? []; l.push(a); byTick.set(a.atTick, l); }
  const s = new NetSession();
  for (let tick = 0; tick <= Math.round(150 / GOLDEN_DT); tick++) {
    const t = tick * GOLDEN_DT;
    s.step(eph, t, GOLDEN_DT);
    const l = byTick.get(tick);
    if (l) for (const a of l) applyNetAction(eph, s, a, GOLDEN_DT);
  }
  const snap = s.snapshot();
  const restored = new NetSession();
  restored.restore(snap);
  const a = JSON.stringify(snap, (_k, v) => (v instanceof Set ? [...(v as Set<unknown>)] : v));
  const b = JSON.stringify(restored.snapshot(), (_k, v) => (v instanceof Set ? [...(v as Set<unknown>)] : v));
  if (a !== b) {
    let i = 0; while (a[i] === b[i]) i++;
    console.log("DIFF@", i, "\nA:", a.slice(i - 400, i + 160), "\nB:", b.slice(i - 400, i + 160));
  } else {
    console.log("snapshots identical — divergence is in un-snapshotted derived state");
  }
});
