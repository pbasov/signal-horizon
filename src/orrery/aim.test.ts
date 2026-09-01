import { describe, it, expect } from "vitest";
import { aimAnglesForRelDir, unwrapAz } from "./aim";

/** The camera placement the orrery uses, so the test asserts the ROUND TRIP, not the algebra. */
function cameraDir(azRad: number, elRad: number): [number, number, number] {
  const ce = Math.cos(elRad);
  return [ce * Math.sin(azRad), Math.sin(elRad), ce * Math.cos(azRad)];
}
/** The renderer's world→scene axis swap (x, z, -y). */
function toScene(v: readonly [number, number, number]): [number, number, number] {
  const m = Math.hypot(v[0], v[1], v[2]);
  return [v[0] / m, v[2] / m, -v[1] / m];
}

describe("aimAnglesForRelDir", () => {
  it("puts the camera ON the outward normal of the aimed point", () => {
    for (const latDeg of [-60, -20, 0, 35, 70]) {
      for (const lonDeg of [-174, -90, -6, 0, 3, 88, 179]) {
        const lat = (latDeg * Math.PI) / 180;
        const lon = (lonDeg * Math.PI) / 180;
        const rel: [number, number, number] = [
          Math.cos(lat) * Math.cos(lon),
          Math.cos(lat) * Math.sin(lon),
          Math.sin(lat),
        ];
        const a = aimAnglesForRelDir(rel);
        expect(a).not.toBeNull();
        const cam = cameraDir(a!.azRad, a!.elRad);
        const want = toScene(rel);
        for (let i = 0; i < 3; i++) expect(cam[i]).toBeCloseTo(want[i], 9);
      }
    }
  });

  it("clamps elevation to the orbit camera's own +/-88 degree pole guard", () => {
    const cap = (88 * Math.PI) / 180;
    expect(aimAnglesForRelDir([0, 0, 1])!.elRad).toBeCloseTo(cap, 12);
    expect(aimAnglesForRelDir([0, 0, -1])!.elRad).toBeCloseTo(-cap, 12);
  });

  it("returns null for a zero-length direction (nothing to aim at)", () => {
    expect(aimAnglesForRelDir([0, 0, 0])).toBeNull();
  });

  it("ignores magnitude - only the direction matters", () => {
    const a = aimAnglesForRelDir([1, 2, 3]);
    const b = aimAnglesForRelDir([1e7, 2e7, 3e7]);
    expect(a!.azRad).toBeCloseTo(b!.azRad, 12);
    expect(a!.elRad).toBeCloseTo(b!.elRad, 12);
  });
});

describe("unwrapAz", () => {
  it("takes the short way around the wrap seam", () => {
    const out = unwrapAz(3.1, -3.1);
    expect(out - 3.1).toBeCloseTo(2 * Math.PI - 6.2, 12);
    expect(Math.abs(out - 3.1)).toBeLessThan(Math.PI);
  });

  it("is the identity (mod 2pi) on the target angle", () => {
    for (const cur of [-7, -1.2, 0, 2.5, 9]) {
      for (const want of [-3, -0.4, 0.9, 3.0]) {
        const out = unwrapAz(cur, want);
        const diff = (((out - want) % (2 * Math.PI)) + 2 * Math.PI) % (2 * Math.PI);
        expect(Math.min(diff, 2 * Math.PI - diff)).toBeLessThan(1e-9);
        expect(Math.abs(out - cur)).toBeLessThanOrEqual(Math.PI + 1e-9);
      }
    }
  });

  it("does not move a camera already on target", () => {
    expect(unwrapAz(1.234, 1.234)).toBeCloseTo(1.234, 12);
  });
});
