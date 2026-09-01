/**
 * ACTION-SHAPE NORMALISATION (SD-55 / AE-06). Its own module so it can be unit-tested without
 * launching a browser — run.mjs opens chromium on import.
 */

/**
 * Accept the action however the model spelled the WRAPPER, then validate what it actually asked for.
 *
 * The first live run spent seven turns guessing whether the field key was `target`, `name`, `field`
 * or `id`. That is this harness's JSON dialect, not the game's legibility — and M8's invalid-action
 * rate exists to measure a policy reaching for controls that are not on screen. Letting protocol
 * noise into that number would have measured this file. So synonyms are coerced here, and shape
 * repairs are counted apart (m8c) as harness quality, never as a reading of the build.
 */
export function normalizeAction(raw) {
  if (!raw || typeof raw !== "object") return { action: null, shapeFixed: false };
  const a = { ...raw };
  const before = JSON.stringify(a);
  const pick = (...keys) => keys.map((k) => a[k]).find((v) => v !== undefined && v !== null && v !== "");
  a.do = String(a.do ?? a.action ?? a.type ?? "").trim();
  if (a.do === "press") a.do = "key";
  if (a.do === "type" || a.do === "input") a.do = "set";
  if (a.do === "click") a.target = pick("target", "id", "control", "button", "label", "name");
  if (a.do === "key") a.key = pick("key", "target", "k", "name");
  if (a.do === "set") {
    // Also catches the shapes the first run tried: {"do":"set","altKm":35786} and "altKm=35786".
    const fieldish = Object.keys(a).find((k) => /^(alt|inc|subLon|raan|phaseSpread)/i.test(k));
    let param = pick("param", "target", "name", "field", "id", "parameter") ?? fieldish;
    let value = pick("value", "number", "text", "amount", "to") ?? (fieldish ? a[fieldish] : undefined);
    if (typeof param === "string" && param.includes("=") && value === undefined) {
      const [p, v] = param.split("=");
      param = p.trim();
      value = v.trim();
    }
    a.param = typeof param === "string" ? param.replace(/^param-/, "").trim() : param;
    a.value = value;
  }
  if (a.do === "wait") a.simMinutes = Number(pick("simMinutes", "minutes", "simMin", "min", "value", "duration"));
  return { action: a, shapeFixed: JSON.stringify(a) !== before };
}
