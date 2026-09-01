/**
 * THE SHARED ACTION VOCABULARY (SD-55 / AE-02).
 *
 * One verb set, two callers: the scripted playtest scenes (`tools/scenes/*.mjs`, which call these
 * helpers directly) and the agent-eval driver (`tools/agent-eval/`, whose brain emits a JSON action
 * that maps 1:1 onto `click` / `key` / `setParam` / `wait`). Sharing the vocabulary is what makes a
 * scripted trajectory and an agent trajectory the SAME format — see docs/agent-eval.md §2.
 *
 * Extracted verbatim from tools/playtest.mjs (behaviour unchanged; `ok`/`shot` keep the runner's
 * bookkeeping shape). The only addition is `changed()`, the observation-digest helper the driver's
 * no-op detection needs (M8b) — scenes are free to ignore it.
 */

/**
 * @param {object} o
 * @param {import("playwright-core").Page} o.page
 * @param {string} o.base            base URL the caller navigates to
 * @param {string} o.shotsDir        directory screenshots land in
 * @param {string} o.tag             filename prefix for screenshots (the scene/run name)
 * @param {{label:string,pass:boolean,detail:string}[]} [o.results]  assertion sink (scenes only)
 */
export function makeCtx({ page, base, shotsDir, tag, results = [] }) {
  return {
    page,
    base,
    results,
    ok(label, cond, detail = "") {
      results.push({ label, pass: !!cond, detail: String(detail) });
    },
    async shot(shotTag) {
      const out = `${shotsDir}/${tag}-${shotTag}.png`;
      await page.screenshot({ path: out });
      return out;
    },
    eval: (fn, ...evalArgs) => page.evaluate(fn, ...evalArgs),
    key: (k) => page.evaluate((kk) => window.dispatchEvent(new KeyboardEvent("keydown", { key: kk, bubbles: true })), k),
    /** TRUSTED input (autoplay-safe): real device-level key/mouse via CDP. */
    async pressKey(k) {
      await page.keyboard.press(k);
    },
    /**
     * Click a control the way a HAND does: SCROLL IT INTO VIEW, then a real device-level click at
     * its centre. Unlike `click` (DOM `.click()`), this is subject to the layout — that is the point.
     *
     * It returns `{ ok, reason }` (SD-64). It used to return a bare `false` that its only caller
     * ignored, and it did not scroll. At 1920×1080 the MISSION panel's scroll viewport is 562 px
     * while the pad's content is 1043 px, so ARM and LAUNCH sit BELOW THE PANEL FOLD: the click was
     * dispatched at y≈1118 in a 1080-tall window, hit nothing, and the scene carried on as though
     * the launch had been committed. A human scrolls the panel and clicks; so does this now. When a
     * control genuinely cannot be reached, the reason is reported instead of swallowed.
     */
    async realClick(sel) {
      const box = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return { reason: "no such element" };
        // What a hand does first. The pad is taller than its panel's scroll viewport.
        el.scrollIntoView({ block: "center", inline: "nearest" });
        const r = el.getBoundingClientRect();
        const x = r.left + r.width / 2;
        const y = r.top + r.height / 2;
        if (r.width === 0 || r.height === 0) return { reason: "zero-size box" };
        if (x < 0 || y < 0 || x > innerWidth || y > innerHeight) {
          return { reason: `centre (${Math.round(x)},${Math.round(y)}) is outside the ${innerWidth}×${innerHeight} viewport even after scrolling it into view` };
        }
        const top = document.elementFromPoint(x, y);
        if (top !== el && !el.contains(top)) {
          return { reason: `covered by ${top ? top.tagName + "." + (top.className || "(none)") : "nothing"}` };
        }
        if (el.disabled) return { reason: "disabled" };
        return { x, y };
      }, sel);
      if (box.reason !== undefined) return { ok: false, reason: box.reason };
      await page.mouse.click(box.x, box.y);
      return { ok: true, reason: "" };
    },
    async click(sel) {
      const found = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return false;
        el.click();
        return true;
      }, sel);
      return found;
    },
    async clickText(text) {
      return page.evaluate((t) => {
        const b = [...document.querySelectorAll("button, .tab")].find((x) => (x.textContent ?? "").includes(t));
        if (!b) return false;
        b.click();
        return true;
      }, text);
    },
    /**
     * Click by VISIBLE LABEL (SD-55 / AE-03 — additive; the scenes' `clickText` is untouched).
     * `clickText` matches raw textContent, which runs the rail buttons together as "▸TRACE";
     * the agent addresses controls by what it read on screen ("▸ TRACE"), so this matches against
     * innerText collapsed to one line, and only among elements it can actually see.
     */
    clickLabel(label) {
      return page.evaluate((want) => {
        const norm = (s) => (s ?? "").replace(/\s+/g, " ").trim();
        const target = norm(want);
        const vis = (el) =>
          typeof el.checkVisibility === "function"
            ? el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true })
            : !!(el.offsetParent || el.getClientRects().length);
        const cands = [...document.querySelectorAll("button, .tab, [data-contract], [role=button]")].filter(vis);
        const hit =
          cands.find((el) => norm(el.innerText) === target) ??
          cands.find((el) => norm(el.innerText).startsWith(target)) ??
          cands.find((el) => norm(el.innerText).includes(target));
        if (!hit) return false;
        hit.click();
        return true;
      }, label);
    },
    setParam(name, v) {
      return page.evaluate(
        ([n, val]) => {
          const inp = document.querySelector(`[data-net=param-${n}]`);
          if (!inp) return false;
          inp.value = String(val);
          inp.dispatchEvent(new Event("change", { bubbles: true }));
          return true;
        },
        [name, v],
      );
    },
    wait: (ms) => page.waitForTimeout(ms),
    settle: (ms = 350) => page.waitForTimeout(ms),
    /**
     * WAIT OUT THE COLD OPEN (SD-64). SD-60's boot sequence mounts `.boot-seq` as a FULL-WINDOW
     * overlay that types four lines (260 ms each) and then holds 2400 ms before fading over 320 ms
     * — about 3.8 s in total, comfortably longer than the 2 s most scenes settle for.
     *
     * It matters because the overlay dismisses on the FIRST `pointerdown` and CONSUMES it. So any
     * scene whose first gesture is a REAL pointer event spends that gesture skipping the intro and
     * never reaches the game. `ctx.click` (DOM `.click()`) tunnels straight through the overlay,
     * which is why this stayed invisible: in act1 the ring drag was the only real-mouse gesture in
     * the scene, and its assertion could not fail.
     *
     * Call this after `goto` in any scene that uses `page.mouse`, `realClick`, or `ctx.key`.
     */
    async bootDone(timeoutMs = 8000) {
      try {
        await page.waitForFunction(() => !document.querySelector(".boot-seq"), undefined, { timeout: timeoutMs });
        return true;
      } catch {
        return false; // let the scene's own assertions report the consequence
      }
    },
    probe: (name, ...args) => page.evaluate(([n, a]) => window[`__${n}`]?.(...a), [name, args]),
  };
}
