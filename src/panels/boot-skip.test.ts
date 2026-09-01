/**
 * SD-60 — THE INTRO IS SKIPPABLE, AND THE OPT-OUT STICKS.
 *
 * The intro console carries the premise now, and it holds ~2.4 s so ~40 words can be read.
 * That is exactly the change that makes skipping matter: a player who does not want it must
 * never sit through it, and must never have to skip it twice.
 *
 * Pins the prefs half (the DOM half is covered in the boot scene): the stored pref round-trips,
 * a v1 blob written before this field still loads, and — the bug the type checker caught — a
 * partial write from another call site cannot silently wipe it.
 */

import { describe, it, expect, beforeEach } from "vitest";
import { loadPrefs, storePrefs } from "../vault";

const PREFS_KEY = "signalhorizon.prefs.v1";

/** A minimal localStorage stand-in — the module reads globalThis.localStorage lazily. */
function installStore(): Map<string, string> {
  const m = new Map<string, string>();
  (globalThis as unknown as { localStorage: unknown }).localStorage = {
    getItem: (k: string) => (m.has(k) ? m.get(k)! : null),
    setItem: (k: string, v: string) => void m.set(k, v),
    removeItem: (k: string) => void m.delete(k),
  };
  return m;
}

describe("SD-60 — the intro skip preference", () => {
  let store: Map<string, string>;
  beforeEach(() => {
    store = installStore();
  });

  it("defaults to showing the intro", () => {
    expect(loadPrefs().skipIntro).toBe(false);
  });

  it("round-trips the opt-out", () => {
    storePrefs({ ...loadPrefs(), skipIntro: true });
    expect(loadPrefs().skipIntro).toBe(true);
  });

  it("a pre-SD-60 prefs blob still loads, with the intro on", () => {
    // The field did not exist when this was written; absent must read false, not crash.
    store.set(PREFS_KEY, JSON.stringify({ mono: true, muted: true }));
    const p = loadPrefs();
    expect(p.mono).toBe(true);
    expect(p.muted).toBe(true);
    expect(p.skipIntro).toBe(false);
  });

  it("a corrupt blob degrades to defaults rather than throwing", () => {
    store.set(PREFS_KEY, "{not json");
    expect(() => loadPrefs()).not.toThrow();
    expect(loadPrefs().skipIntro).toBe(false);
  });

  it("toggling another preference does NOT wipe the opt-out", () => {
    // The real bug tsc caught: call sites that rebuild the prefs literal instead of spreading
    // the stored one silently drop every field they do not know about. Both mono and mute
    // writers now spread; this pins that they keep doing so.
    storePrefs({ ...loadPrefs(), skipIntro: true });
    storePrefs({ ...loadPrefs(), mono: true, muted: true }); // the mono/mute toggle shape
    expect(loadPrefs().skipIntro).toBe(true);
  });
});
