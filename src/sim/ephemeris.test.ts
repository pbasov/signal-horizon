import { describe, it, expect } from "vitest";
import { type Vec3, AU_M } from "./ephemeris";
import { loadEphemeris, SYSTEM } from "./system-data";

/**
 * GOLDEN MASTER from the REAL C# SignalHorizon.Sim.Ephemeris.
 *
 * The xunit suite (OrbitalTests.cs) deliberately asserts only self-consistency
 * and magnitude sanity — "NEVER external JPL state vectors". So there is no
 * hardcoded vector to copy. Instead these values were emitted by compiling the
 * UNMODIFIED Ephemeris.cs/OrbitalBody.cs sources against the same data/system.json
 * (see tools/golden/) and printing G17 round-trip doubles. They ARE the C#
 * implementation's bit-level output — the truth this port must reproduce.
 *
 * J2000 epoch == t=0 in this sim: epoch_seconds defaults to 0 and m0 mean
 * anomalies are defined at t=0 (system.json _comment).
 */
const GOLDEN = {
  earth_t0_pos: [-26503030304.566952, 144693318282.63062, 119321.63383873618] as Vec3,
  earth_t0_vel: [-29786.488870741297, -5478.5694165343129, -0.009764752764521812] as Vec3,
  mars_t0_pos: [208037589893.24326, -2062514710.2959595, -5158888731.6775341] as Vec3,
  moon_t0_pos: [-26795557927.257793, 144422927292.50308, 35665868.597464398] as Vec3,
  earth_t123456_pos: [-30171541012.761703, 143971055401.42346, 118078.33309119155] as Vec3,
  mars_t123456_pos: [208158959699.4137, 1184112687.4928284, -5093879974.3267841] as Vec3,
  sat_leo_t1500_pos: [-26548579413.076031, 144689134705.88947, 5481980.2117230622] as Vec3,
  sat_geo_t21600_pos: [-27146340337.017303, 144615737846.49905, 119109.55530638878] as Vec3,
};

const GOLDEN_DERIVED = {
  earth: { a_m: 149597887155.76578, n: 1.990983346076685e-7, period: 31558201.225343559 },
  mars: { a_m: 227942275585.59, n: 1.0585673572630055e-7, period: 59355555.072330676 },
  moon: { a_m: 384400000, n: 2.6490723481625844e-6, period: 2371843.604625464 },
  sat_leo: { a_m: 6771000, n: 0.0011331559073083758, period: 5544.8550959807926 },
  sat_geo: { a_m: 42164000, n: 7.2921598617960447e-5, period: 86163.570550578283 },
};

/** Worst relative component error vs the C# golden vector. */
function relErr(actual: Vec3, golden: Vec3): number {
  // Scale by the vector magnitude so near-zero components don't blow up.
  const mag = Math.hypot(golden[0], golden[1], golden[2]);
  let worst = 0;
  for (let i = 0; i < 3; i++) {
    worst = Math.max(worst, Math.abs(actual[i] - golden[i]) / mag);
  }
  return worst;
}

// Cross-implementation libm (Node V8 vs .NET) differs by a few ULP in trig, so
// require agreement to better than 1 part in 1e9 (≈ sub-metre at 1.5e11 m).
// The build logs the ACTUAL worst-case so the true fidelity is on record.
const REL_TOL = 1e-9;

const eph = loadEphemeris();

describe("Kepler ephemeris port — golden master vs C# SignalHorizon.Sim", () => {
  it("pins Earth's position at the J2000 epoch (t=0) to the C# golden vector", () => {
    const p = eph.position("earth", 0);
    const err = relErr(p, GOLDEN.earth_t0_pos);
    // eslint-disable-next-line no-console
    console.log(`Earth@J2000 worst rel err vs C#: ${err.toExponential(3)}  pos=[${p.join(", ")}]`);
    expect(err).toBeLessThan(REL_TOL);
  });

  it("reproduces Earth's J2000 velocity vector", () => {
    expect(relErr(eph.velocity("earth", 0), GOLDEN.earth_t0_vel)).toBeLessThan(REL_TOL);
  });

  it("reproduces Mars (heliocentric) at t=0 and t=123456", () => {
    expect(relErr(eph.position("mars", 0), GOLDEN.mars_t0_pos)).toBeLessThan(REL_TOL);
    expect(relErr(eph.position("mars", 123456), GOLDEN.mars_t123456_pos)).toBeLessThan(REL_TOL);
  });

  it("reproduces the Moon (recursive parent composition earth→sun) at t=0", () => {
    expect(relErr(eph.position("moon", 0), GOLDEN.moon_t0_pos)).toBeLessThan(REL_TOL);
  });

  it("reproduces Earth at t=123456", () => {
    expect(relErr(eph.position("earth", 123456), GOLDEN.earth_t123456_pos)).toBeLessThan(REL_TOL);
  });

  it("reproduces inclined LEO and equatorial GEO satellite positions", () => {
    expect(relErr(eph.position("sat_leo", 1500), GOLDEN.sat_leo_t1500_pos)).toBeLessThan(REL_TOL);
    expect(relErr(eph.position("sat_geo", 21600), GOLDEN.sat_geo_t21600_pos)).toBeLessThan(REL_TOL);
  });

  it("reproduces derived scalars (semi-major axis, mean motion, period)", () => {
    for (const [id, g] of Object.entries(GOLDEN_DERIVED)) {
      const b = eph.bodies.get(id)!;
      expect(Math.abs(b.a - g.a_m) / g.a_m).toBeLessThan(REL_TOL);
      expect(Math.abs(b.n - g.n) / g.n).toBeLessThan(REL_TOL);
      expect(Math.abs(b.periodSeconds() - g.period) / g.period).toBeLessThan(REL_TOL);
    }
  });
});

describe("Kepler ephemeris port — structural invariants (mirror OrbitalTests.cs)", () => {
  it("loads exactly the eight expected bodies with correct parents", () => {
    expect(eph.bodyIds().sort()).toEqual(
      ["earth", "mars", "moon", "sat_geo", "sat_leo", "sat_meo_inc", "sat_meo_polar", "sun"],
    );
    expect(eph.parentOf("moon")).toBe("earth");
    expect(eph.parentOf("earth")).toBe("sun");
    expect(eph.parentOf("sun")).toBe("");
    expect(eph.parentOf("sat_geo")).toBe("earth");
  });

  it("places the Sun at the origin and gives it zero mean motion", () => {
    expect(eph.position("sun", 0)).toEqual([0, 0, 0]);
    expect(eph.bodies.get("sun")!.n).toBe(0);
    expect(eph.bodies.get("sun")!.isRoot()).toBe(true);
  });

  it("is bit-identical across repeated calls (pure function of (id,t))", () => {
    expect(eph.position("mars", 123456)).toEqual(eph.position("mars", 123456));
    expect(eph.position("moon", 987654)).toEqual(eph.position("moon", 987654));
  });

  it("keeps Earth within 5% of 1 AU and Mars within heliocentric bounds", () => {
    const earthR = Math.hypot(...eph.position("earth", 0));
    expect(Math.abs(earthR - AU_M) / AU_M).toBeLessThan(0.05);
    const marsR = Math.hypot(...eph.position("mars", 0));
    expect(marsR).toBeGreaterThan(1.38e11);
    expect(marsR).toBeLessThan(2.49e11);
  });

  it("closes Earth's orbit after one period (drift < 1% of a)", () => {
    const earth = eph.bodies.get("earth")!;
    const p0 = eph.position("earth", 0);
    const pT = eph.position("earth", earth.periodSeconds());
    const drift = Math.hypot(p0[0] - pT[0], p0[1] - pT[1], p0[2] - pT[2]);
    expect(drift).toBeLessThan(0.01 * earth.a);
  });

  it("GEO sits near 42164 km and a sidereal-day period; LEO matches Kepler's third law", () => {
    const MU_EARTH = 3.986004418e14;
    const geo = eph.bodies.get("sat_geo")!;
    expect(Math.abs(geo.a - 4.2164e7)).toBeLessThan(5.0e4);
    expect(Math.abs(geo.periodSeconds() - 86164.0) / 86164.0).toBeLessThan(0.01);
    const leo = eph.bodies.get("sat_leo")!;
    const expected = 2 * Math.PI * Math.sqrt((leo.a * leo.a * leo.a) / MU_EARTH);
    expect(Math.abs(leo.periodSeconds() - expected) / expected).toBeLessThan(0.01);
  });

  it("loads the same dataset the C# layer loads (epoch + frame)", () => {
    expect(SYSTEM.frame).toBe("ecliptic_j2000");
    expect(eph.epochJd).toBe(2451545.0);
  });
});
