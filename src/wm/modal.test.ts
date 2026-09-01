/**
 * THE OVERLAY LAYER's geometry (modal.ts). The class needs a DOM; the rect solver does not,
 * and the rect is what decides whether a raised panel is actually a bigger reading surface
 * than the tile it came from — which is the entire reason the overlay exists.
 */
import { describe, it, expect } from "vitest";
import { modalRect } from "./modal";

describe("modalRect — the raised window's box", () => {
  it("is centred, and leaves the wall visible around every edge", () => {
    const r = modalRect(1600, 900, "wide");
    expect(r.x).toBe(Math.round((1600 - r.w) / 2));
    expect(r.y).toBe(Math.round((900 - r.h) / 2));
    expect(r.x).toBeGreaterThan(0);
    expect(r.y).toBeGreaterThan(0);
    expect(r.x + r.w).toBeLessThan(1600);
    expect(r.y + r.h).toBeLessThan(900);
  });

  it("beats the tile it came from — a raised panel is a genuinely bigger read", () => {
    // The MISSION desktop's right column at 1600×900 is ~600×500 for the top tile; TRACE
    // summoned there is the cramped case the overlay answers.
    const r = modalRect(1600, 900, "wide");
    expect(r.w).toBeGreaterThan(600 * 1.8);
    expect(r.h).toBeGreaterThan(500 * 1.4);
  });

  it("caps on big screens so the overlay never becomes the wall", () => {
    const r = modalRect(3840, 2160, "wide");
    expect(r.w).toBeLessThanOrEqual(1320);
    expect(r.h).toBeLessThanOrEqual(900);
  });

  it("stays inside a small window instead of hanging off the edge", () => {
    const r = modalRect(520, 300, "wide");
    expect(r.x).toBeGreaterThanOrEqual(0);
    expect(r.y).toBeGreaterThanOrEqual(0);
    expect(r.x + r.w).toBeLessThanOrEqual(520);
    expect(r.y + r.h).toBeLessThanOrEqual(300);
  });

  it("compact is for short decision-shaped content — smaller than wide at the same size", () => {
    const wide = modalRect(1600, 900, "wide");
    const compact = modalRect(1600, 900, "compact");
    expect(compact.w).toBeLessThan(wide.w);
    expect(compact.h).toBeLessThan(wide.h);
  });
});
