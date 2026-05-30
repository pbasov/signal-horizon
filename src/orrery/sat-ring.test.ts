import { describe, it, expect } from "vitest";
import { sampleSatOrbitRelative } from "./orrery";
import { resolveLaunchOrbit, LAUNCH_PRESETS, EARTH_MU } from "../sim/m2/launch";
import type { SatOrbit } from "../sim/m2/roster";

// Fix #2 — the launched-sat orbit rings: a launched sat's Kepler elements must sample to
// a full closed orbital-plane ring in the body-relative frame, exactly like the dataset
// LEO/GEO rings. This is the unit guard that buildRings/rebuildSatRings now drives the
// ROSTER's launched sats (previously only the dataset RING_IDS got rings).

const leoPreset = LAUNCH_PRESETS.find((p) => p.id === "leo_53")!;
const geoPreset = LAUNCH_PRESETS.find((p) => p.id === "geo_eq")!;

describe("sampleSatOrbitRelative — launched-sat orbit-plane rings", () => {
  it("samples a full closed ring of `count` points for a launched LEO orbit", () => {
    const orbit = resolveLaunchOrbit(leoPreset, 0, 1000);
    const ring = sampleSatOrbitRelative(orbit, 96);
    expect(ring.length).toBe(96);
    // Every sample sits at ≈ the orbit's circular radius (e = 0 ⇒ |r| ≈ a) in the
    // parent-relative frame — a closed ring, not a point.
    for (const p of ring) {
      const r = Math.hypot(p[0], p[1], p[2]);
      expect(r).toBeGreaterThan(0.99 * orbit.aM);
      expect(r).toBeLessThan(1.01 * orbit.aM);
    }
  });

  it("the ring radius scales with the orbit (a GEO ring is far larger than a LEO ring)", () => {
    const leo = sampleSatOrbitRelative(resolveLaunchOrbit(leoPreset, 0, 0), 48);
    const geo = sampleSatOrbitRelative(resolveLaunchOrbit(geoPreset, 0, 0), 48);
    const rLeo = Math.hypot(leo[0][0], leo[0][1], leo[0][2]);
    const rGeo = Math.hypot(geo[0][0], geo[0][1], geo[0][2]);
    expect(rGeo).toBeGreaterThan(rLeo * 3); // GEO ≈ 42 164 km vs LEO ≈ 6 771 km.
  });

  it("the ring is independent of the launch EPOCH (a geometric sample, like the dataset rings)", () => {
    const a = sampleSatOrbitRelative(resolveLaunchOrbit(leoPreset, 0, 0), 24);
    const b = sampleSatOrbitRelative(resolveLaunchOrbit(leoPreset, 0, 5_000_000), 24);
    // Same elements, different epoch ⇒ same SET of ring points (the ring is the orbit
    // path, swept from each orbit's own epoch over its period).
    for (let i = 0; i < a.length; i++) {
      expect(a[i][0]).toBeCloseTo(b[i][0], 3);
      expect(a[i][1]).toBeCloseTo(b[i][1], 3);
      expect(a[i][2]).toBeCloseTo(b[i][2], 3);
    }
  });

  it("a degenerate (zero-period) orbit yields a single point, not a crash", () => {
    const bad: SatOrbit = {
      parentId: "earth",
      aM: 0,
      e: 0,
      incRad: 0,
      raanRad: 0,
      argpRad: 0,
      m0Rad: 0,
      epochS: 0,
      muParent: EARTH_MU,
    };
    expect(sampleSatOrbitRelative(bad, 96).length).toBe(1);
  });
});
