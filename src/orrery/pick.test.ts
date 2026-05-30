import { describe, it, expect } from "vitest";
import { pickNearest, type PickCandidate } from "./pick";

const C = (id: string, sx: number, sy: number, onScreen = true): PickCandidate => ({ id, sx, sy, onScreen });

describe("pickNearest — click-to-focus screen-space pick", () => {
  it("picks the nearest candidate to the cursor within tolerance", () => {
    const cands = [C("earth", 100, 100), C("mars", 300, 100), C("moon", 110, 105)];
    // Click closer to moon than earth.
    expect(pickNearest(cands, 108, 104, 20)).toBe("moon");
    // Click right on earth.
    expect(pickNearest(cands, 100, 100, 20)).toBe("earth");
  });

  it("returns null when no candidate is inside the tolerance", () => {
    const cands = [C("earth", 100, 100), C("mars", 300, 300)];
    expect(pickNearest(cands, 200, 200, 30)).toBeNull();
  });

  it("skips off-screen (behind-camera / clipped) candidates", () => {
    const cands = [C("hidden", 105, 105, /*onScreen*/ false), C("earth", 130, 130, true)];
    // The nearest by pixels is hidden, but it is off-screen, so the on-screen one wins
    // only if it is within tolerance; here it is not, so null.
    expect(pickNearest(cands, 100, 100, 20)).toBeNull();
    // Widen tolerance so the on-screen earth qualifies.
    expect(pickNearest(cands, 100, 100, 60)).toBe("earth");
  });

  it("resolves ties to the FIRST candidate in draw order (stable / deterministic)", () => {
    const cands = [C("a", 100, 100), C("b", 100, 100)];
    expect(pickNearest(cands, 100, 100, 10)).toBe("a");
  });

  it("treats a candidate exactly at the tolerance edge as a hit", () => {
    const cands = [C("edge", 110, 100)];
    expect(pickNearest(cands, 100, 100, 10)).toBe("edge"); // dist 10 == tol 10
    expect(pickNearest(cands, 100, 100, 9)).toBeNull(); // dist 10 > tol 9
  });
});
