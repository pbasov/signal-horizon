/**
 * Unit pins for the audio engine's PURE parts (no AudioContext in node):
 * the plate IR is deterministic and decays; the recipes table is a real grammar
 * (attacking envelopes, positive frequencies, modest gains).
 */

import { describe, it, expect } from "vitest";
import { buildPlateIR, NET_CUES } from "./engine";

describe("audio engine — deterministic plate IR", () => {
  it("same seed ⇒ bit-identical IR (the reverb is an identity, not fuzz)", () => {
    const a = buildPlateIR(2, 44100, 0.2);
    const b = buildPlateIR(2, 44100, 0.2);
    expect(a.length).toBe(2);
    for (let ch = 0; ch < 2; ch++) expect(Array.from(a[ch])).toEqual(Array.from(b[ch]));
  });

  it("decays in mass (the tail is quieter than the body) and has no DC bias", () => {
    const d = buildPlateIR(1, 44100, 0.2)[0];
    const front = Math.hypot(...Array.from(d.slice(0, 2000))) / 2000;
    const tail = Math.hypot(...Array.from(d.slice(-2000))) / 2000;
    expect(tail).toBeLessThan(front);
    const mean = d.reduce((s, v) => s + v, 0) / d.length;
    expect(Math.abs(mean)).toBeLessThan(0.02);
  });

  it("identical params minus seed ⇒ different realisation (the seed is the only variance)", () => {
    const a = buildPlateIR(1, 44100, 0.2, 0x5eed)[0];
    const b = buildPlateIR(1, 44100, 0.2, 0x5eef)[0];
    expect(Array.from(a)).not.toEqual(Array.from(b));
  });
});

describe("audio engine — the cue book is a real grammar", () => {
  it("every recipe has parts, positive frequencies, and musical peaks", () => {
    for (const [kind, r] of Object.entries(NET_CUES)) {
      expect(r.parts.length).toBeGreaterThan(0);
      for (const p of r.parts) {
        expect(p.f0).toBeGreaterThan(30);
        expect(p.f0).toBeLessThan(4000);
        expect(p.peak).toBeLessThanOrEqual(0.45);
        expect(p.dur).toBeGreaterThan(0.01);
      }
      void kind;
    }
  });

  it("the 'good' cues rise in pitch and the 'bad' ones fall (avocad CVD-of-the-ear)", () => {
    const up = (k: keyof typeof NET_CUES) => (NET_CUES[k].parts[0].f1 ?? NET_CUES[k].parts[0].f0);
    const f0 = (k: keyof typeof NET_CUES) => NET_CUES[k].parts[0].f0;
    expect(up("credit_committed")).toBeGreaterThan(f0("credit_committed"));
    expect(up("serve_locked")).toBeGreaterThan(f0("serve_locked"));
    expect(up("no_sep")).toBeLessThan(f0("no_sep"));
    expect(up("tender_lapsed")).toBeLessThan(f0("tender_lapsed"));
  });
});
