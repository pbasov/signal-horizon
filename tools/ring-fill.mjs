/**
 * FILLING A HOLE IN A CONSTELLATION — the shared act-2 move (SD-64).
 *
 * Two scenes play the act-2 constellation (`hour`, `trace`), and both used to plug the seeded
 * attrition's hole with a hardcoded launch:
 *
 *     launchDraft(ctx, { altKm: 310, incDeg: 90, subLonDeg: 45, count: 4, spreadDeg: 90 })
 *
 * Every number in that line was a PRE-SD-56 constant, and after the coverage re-scale it was simply
 * a different orbit. Measured at the gate, the fleet read `{310: 4, 402: 7, 535: 1}`: the assist had
 * flown a 402 km ring while the fill put four birds at 310 km — a lower, faster orbit sharing
 * neither plane nor period, so not ring members at all. REGION-1 held 90.6 % against
 * `ACT2_SLA_AVAIL = 0.99`, the act-2 gate never fired, and act3a, the corridor tender and the whole
 * TRACE board fell behind it.
 *
 * Nothing here is written down. Every number is read off the ring that is actually flying, so the
 * next re-scale cannot strand this launch the way the last one did. Four things had to be true
 * before it worked, and each was measured, not reasoned:
 *
 *  1. THE ALTITUDE MUST BE EXACT. The ring flies at 401.7361 km. Read back the ROUNDED 402 and type
 *     it in and you buy a period of 185.104 s against the ring's 185 s — 0.2° of phase drift per
 *     orbit, so the "replacement" walks out of the slot it was placed in. `__netState` exposes
 *     `altKm` unrounded for exactly this.
 *  2. THE PITCH AND THE COUNT COME FROM THE PAD. A ring of N even slots has a 360/N pitch; lose `m`
 *     ADJACENT members and the pad reports one hole of (m+1)·pitch. So "7 flying · widest gap 120°"
 *     pins it: the only integer m that reproduces 120° from 7 survivors is 2, giving N=9 and a 40°
 *     pitch. The old `spreadDeg: 90` was 360/4 from when ACT2_ZERO_GAP_N was 4; left as a literal it
 *     scattered four birds a quarter-ring apart so only ONE could fall inside the hole, and the best
 *     placement merely halved 120° to 60°.
 *  3. THE PHASE IS SEARCHED, NOT COMPUTED. Landing in the hole by arithmetic means undoing both the
 *     body's spin and the ring's own mean motion over the gap between launches (canon.ts's
 *     FILL_PHASE_COMP_RAD). SD-56 is explicit that this is "the sum no player should ever be asked
 *     to do in their head — the reason the pad has to SHOW the ring and let you drop a replacement
 *     into the gap", so this slides the sub-longitude and keeps whichever value leaves the smallest
 *     hole, exactly as a player watches that number shrink. (`subLonDeg` CLAMPS to ±180; sweeping
 *     0..360 saturates at 180 and silently re-tests one point four times over.)
 *  4. THE COMMIT MUST HAPPEN WHILE THE CLOCK IS HELD. `resolveOrbit` sets
 *     `m0Rad = subLonRad + ω·t`, so a sub-longitude is only the phase it previewed AT THE EPOCH IT
 *     WAS CHOSEN FOR. These scenes play at 1000×, where the few hundred milliseconds between
 *     choosing and committing is ~1.6 orbits: the aim was stale before it was bought, and the ring
 *     came out mis-phased however carefully it had been placed. With the same aim committed under
 *     pause, REGION-1 goes to 100 % held and the act-2 gate fires.
 */

/** The EXACT altitude (km, unrounded) of the ring the act-2 batch is flying. */
export async function exactRingAltKm(ctx) {
  return ctx.eval(() => {
    const st = window.__netState?.();
    if (!st) return null;
    // Group by the ROUNDED km — that is what "the same ring" means to the eye — and then return the
    // EXACT altitude of a member, because a rounded altitude is a different PERIOD.
    const counts = new Map();
    for (const x of st.sats) counts.set(x.aKm, (counts.get(x.aKm) ?? 0) + 1);
    let bestAlt = null;
    let bestN = 0;
    for (const [alt, n] of counts) if (n > bestN) { bestN = n; bestAlt = alt; }
    const member = st.sats.find((x) => x.aKm === bestAlt);
    return member?.altKm ?? bestAlt;
  });
}

/** Read the phase-ring instrument's own words: how many fly, the widest hole, what this draft leaves. */
function readRing(ctx) {
  return ctx.eval(() => {
    const t = document.querySelector(".pad-ring-readout")?.textContent ?? "";
    const flying = /^\s*(\d+) flying/.exec(t);
    const gap = /widest gap (\d+(?:\.\d+)?)°/.exec(t);
    const left = /would leave (still open|(\d+(?:\.\d+)?)°)/.exec(t);
    return {
      text: t,
      flying: flying ? Number(flying[1]) : null,
      gapDeg: gap ? Number(gap[1]) : null,
      leftDeg: left ? (left[1] === "still open" ? 360 : Number(left[2])) : null,
    };
  });
}

/**
 * Plug the hole in the flying ring and COMMIT the launch, all with the clock held.
 *
 * @param {object} ctx the scene context
 * @param {object} o
 * @param {number} o.incDeg the ring's inclination (90 for the act-2 polar family)
 * @param {(p: {altKm:number,incDeg:number,subLonDeg:number,count:number,spreadDeg:number}) => Promise<void>} o.launch
 *        the scene's own launch-the-draft routine. It must NOT touch the clock.
 */
export async function fillRingHole(ctx, { incDeg, launch }) {
  const ringAltKm = await exactRingAltKm(ctx);
  ctx.ok(
    "the ring to be filled reports an EXACT altitude (a rounded one is a different period)",
    typeof ringAltKm === "number" && ringAltKm > 0 && Math.abs(ringAltKm - Math.round(ringAltKm)) > 1e-9,
    `${ringAltKm} km`,
  );

  await ctx.eval(() => {
    const t = document.querySelector("[data-net=pad-toggle]");
    if (t && !t.textContent?.includes("BACK")) t.click();
  });
  await ctx.settle(250);
  await ctx.setParam("altKm", ringAltKm);
  await ctx.setParam("incDeg", incDeg);
  await ctx.setParam("raanDeg", 0); // same plane as the ring, or nothing on it counts as a member
  await ctx.settle(250);

  // PAUSE TO LOOK. The ring sweeps, and these scenes play at 1000× — readings taken while time runs
  // compare a different ring at every sample. (`__clock` exists for the agent-eval harness's own
  // pause → observe → act loop, for the same reason.)
  const wasRunning = await ctx.eval(() => window.__clock?.().paused === false);
  if (wasRunning) await ctx.key(" ");
  await ctx.settle(150);
  ctx.ok(
    "the clock holds still while the ring is read",
    await ctx.eval(() => window.__clock?.().paused === true),
    "paused",
  );

  const shape = await readRing(ctx);
  let fillCount = 4;
  let pitchDeg = 90;
  let solved = false;
  if (shape.flying !== null && shape.gapDeg !== null) {
    for (let m = 1; m <= 12; m++) {
      const pitch = 360 / (shape.flying + m);
      if (Math.abs((m + 1) * pitch - shape.gapDeg) <= 2) {
        fillCount = m;
        pitchDeg = pitch;
        solved = true;
        break;
      }
    }
  }
  ctx.ok(
    "the ring's pitch and its missing members are derived from the pad's own readout",
    solved,
    `${shape.flying} flying, widest gap ${shape.gapDeg}° ⇒ ${fillCount} missing on a ${pitchDeg.toFixed(1)}° pitch`,
  );
  const spreadDeg = Math.round(pitchDeg * 10) / 10;

  await ctx.eval((target) => {
    const minus = document.querySelector("[data-net=count-minus]");
    const plus = document.querySelector("[data-net=count-plus]");
    const cur = Number(document.querySelector(".mission-count")?.textContent ?? "1");
    for (let i = cur; i < target; i++) plus?.click();
    for (let i = cur; i > target; i--) minus?.click();
  }, fillCount);
  await ctx.setParam("phaseSpreadDeg", spreadDeg);
  await ctx.settle(200);

  let best = null;
  for (let lon = -180; lon < 180; lon += 10) {
    await ctx.setParam("subLonDeg", lon);
    await ctx.settle(60);
    const r = await readRing(ctx);
    if (r.leftDeg !== null && (best === null || r.leftDeg < best.leftDeg)) best = { subLonDeg: lon, ...r };
  }
  if (best !== null) {
    const base = best.subLonDeg;
    for (let d = -8; d <= 8; d += 2) {
      const lon = base + d;
      if (d === 0 || lon < -180 || lon >= 180) continue;
      await ctx.setParam("subLonDeg", lon);
      await ctx.settle(60);
      const r = await readRing(ctx);
      if (r.leftDeg !== null && r.leftDeg < best.leftDeg) best = { subLonDeg: lon, ...r };
    }
  }
  const subLonDeg = best?.subLonDeg ?? 45;
  ctx.ok(
    "the aim CLOSES the hole (no gap left wider than one slot)",
    best?.leftDeg !== null && best?.leftDeg !== undefined && best.leftDeg <= spreadDeg + 2,
    `widest ${shape.gapDeg}° → ${best?.leftDeg}° with ${fillCount}× at ${spreadDeg}° pitch, subLon ${subLonDeg}°  ["${best?.text ?? ""}"]`,
  );

  // COMMIT WHILE THE CLOCK IS STILL HELD, so the orbit's epoch is the epoch the aim was chosen for.
  await launch({ altKm: ringAltKm, incDeg, subLonDeg, count: fillCount, spreadDeg });

  if (wasRunning) await ctx.key(" "); // now let it fly
  await ctx.settle(200);
  ctx.ok(
    "time is handed back once the fill is committed",
    !wasRunning || (await ctx.eval(() => window.__clock?.().paused === false)),
    "running",
  );
  return { ringAltKm, count: fillCount, spreadDeg, subLonDeg, gapDeg: shape.gapDeg, leftDeg: best?.leftDeg ?? null };
}
