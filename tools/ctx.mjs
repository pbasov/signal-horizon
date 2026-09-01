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
    async realClick(sel) {
      const box = await page.evaluate((s) => {
        const el = document.querySelector(s);
        if (!el) return null;
        const r = el.getBoundingClientRect();
        return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      }, sel);
      if (!box) return false;
      await page.mouse.click(box.x, box.y);
      return true;
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
    probe: (name, ...args) => page.evaluate(([n, a]) => window[`__${n}`]?.(...a), [name, args]),
  };
}
