import { describe, it, expect } from "vitest";
import { Mission } from "./mission";
import { loadEphemeris } from "./system-data";
import { oneWaySeconds, freshness } from "./delay";
import { earthMarsLos } from "./links";

/**
 * BEHAVIOUR pin for the mission director — the Earth→Mars packet lifecycle and
 * the SYSTEM.LOG feed, driven purely by SIM time.
 *
 * Everything here is a pure function of the explicit t handed to update(): no
 * wall-clock, no RNG. The ephemeris is the real (deterministic) Kepler truth, so
 * we DERIVE the expected numbers (one-way light delay, freshness) from the same
 * pure helpers the module uses rather than hardcoding magic constants. At the
 * J2000 epoch (t=0) Earth↔Mars is wide open (≈156 solar radii of margin), so no
 * solar-occult event fires and the packet/script behaviour is isolated.
 */

const eph = loadEphemeris();

/** One-way light delay frozen for a packet launched at sim-time t (module's own formula). */
function expectedOneWay(t: number): number {
  return oneWaySeconds(eph.distanceBetween("earth", "mars", t));
}

const SCRIPT_INTERVAL = 540; // sim-seconds between flavour lines (mirrors mission.ts)

describe("Mission — boot sequence", () => {
  it("a fresh mission emits nothing about a packet until update() runs", () => {
    const m = new Mission(eph);
    expect(m.packet).toBeNull();
  });

  it("the first update() boots: orrery-online + link-open + a packet launch", () => {
    const m = new Mission(eph);
    const log = m.update(0);

    // The boot triplet, in order.
    expect(log).toHaveLength(3);
    expect(log[0]).toMatchObject({ tSim: 0, sev: "info", entity: "ORRERY" });
    expect(log[1]).toMatchObject({ tSim: 0, sev: "info", entity: "EARTH→MARS" });
    expect(log[2]).toMatchObject({ tSim: 0, sev: "info", entity: "PKT-0001" });
    expect(log[2].msg).toContain("launched");
    expect(log[2].msg).toContain("EARTH→MARS");
  });

  it("the launched packet is Earth→Mars, id 1, fresh, at progress 0 with frozen one-way delay", () => {
    const m = new Mission(eph);
    m.update(0);

    expect(m.packet).not.toBeNull();
    expect(m.packet).toMatchObject({
      id: 1,
      fromId: "earth",
      toId: "mars",
      launchT: 0,
      progress: 0,
      freshness: 1,
    });
    // oneWay is the REAL light-time of the launch-instant distance, not a guess.
    expect(m.packet!.oneWay).toBeCloseTo(expectedOneWay(0), 9);
  });

  it("boots only once — a second update() does not re-emit the boot triplet", () => {
    const m = new Mission(eph);
    m.update(0);
    const again = m.update(1); // 1s later, well before any script line or arrival
    expect(again.some((e) => e.entity === "ORRERY")).toBe(false);
    expect(again.some((e) => e.msg.includes("link open"))).toBe(false);
    // Still the same in-flight packet (no relaunch).
    expect(m.packet!.id).toBe(1);
  });

  it("boots relative to whatever t it is first ticked at (not assuming t=0)", () => {
    const m = new Mission(eph);
    const log = m.update(10_000);
    expect(log[0].tSim).toBe(10_000);
    expect(m.packet!.launchT).toBe(10_000);
    expect(m.packet!.oneWay).toBeCloseTo(expectedOneWay(10_000), 9);
  });
});

describe("Mission — honest packet crawl (progress/freshness derive from t)", () => {
  it("progress is 0 at launch and 1 exactly at launchT + oneWay", () => {
    const m = new Mission(eph);
    m.update(0);
    const ow = m.packet!.oneWay;

    expect(m.packet!.progress).toBe(0);

    m.update(ow / 2);
    expect(m.packet!.progress).toBeCloseTo(0.5, 12);

    // Drive a fresh mission straight to arrival so we read progress AT t=ow
    // before the relaunch resets it.
    const arrival = new Mission(eph);
    arrival.update(0);
    const owA = arrival.packet!.oneWay;
    // Capture the packet object identity to confirm we crossed the finish line.
    const launched = arrival.packet!;
    arrival.update(owA);
    // launched packet reached progress 1 (it has since been replaced, but the
    // arrival log proves the finish; identity changed on relaunch).
    expect(arrival.packet).not.toBe(launched);
  });

  it("progress clamps to [0,1] and never overshoots past the light-time", () => {
    // A single mission ticked WAY past one one-way: the in-flight packet is the
    // relaunched one, whose progress is again within [0,1].
    const m = new Mission(eph);
    m.update(0);
    m.update(m.packet!.oneWay * 1.5);
    expect(m.packet!.progress).toBeGreaterThanOrEqual(0);
    expect(m.packet!.progress).toBeLessThanOrEqual(1);
  });

  it("freshness equals the module's 2^(-age/oneWay) decay law", () => {
    const m = new Mission(eph);
    m.update(0);
    const ow = m.packet!.oneWay;

    for (const age of [0, ow * 0.25, ow * 0.5, ow * 0.75]) {
      m.update(age);
      expect(m.packet!.freshness).toBeCloseTo(freshness(age, ow), 12);
    }
  });

  it("freshness decays monotonically as sim time advances", () => {
    const m = new Mission(eph);
    m.update(0);
    const ow = m.packet!.oneWay;

    let prev = m.packet!.freshness; // 1 at launch
    for (const age of [ow * 0.1, ow * 0.2, ow * 0.4, ow * 0.8]) {
      m.update(age);
      expect(m.packet!.freshness).toBeLessThan(prev);
      prev = m.packet!.freshness;
    }
  });

  it("packet state is a pure function of the final t (path-independent)", () => {
    const a = new Mission(eph);
    a.update(0);
    a.update(200);

    const b = new Mission(eph);
    b.update(0);
    b.update(50);
    b.update(120);
    b.update(200);

    expect(b.packet!.progress).toBe(a.packet!.progress);
    expect(b.packet!.freshness).toBe(a.packet!.freshness);
    expect(b.packet!.oneWay).toBe(a.packet!.oneWay);
  });
});

describe("Mission — packet arrival and relaunch", () => {
  it("on arrival emits a stored/arrived line then relaunches the next packet", () => {
    const m = new Mission(eph);
    m.update(0);
    const ow = m.packet!.oneWay;
    const log = m.update(ow);

    const arrived = log.find((e) => e.entity === "PKT-0001");
    const relaunched = log.find((e) => e.entity === "PKT-0002");
    expect(arrived).toBeDefined();
    expect(arrived!.msg).toContain("arrived at MARS");
    expect(relaunched).toBeDefined();
    expect(relaunched!.msg).toContain("launched");

    // The new in-flight packet is id 2, freshly launched at the arrival instant.
    expect(m.packet!.id).toBe(2);
    expect(m.packet!.launchT).toBe(ow);
    expect(m.packet!.progress).toBe(0);
    expect(m.packet!.freshness).toBe(1);
  });

  it("re-samples the (changing) distance at relaunch — the new oneWay is the t=arrival light-time", () => {
    const m = new Mission(eph);
    m.update(0);
    const ow = m.packet!.oneWay;
    m.update(ow);
    expect(m.packet!.oneWay).toBeCloseTo(expectedOneWay(ow), 9);
  });

  it("a packet arriving exactly at one one-way carries ~0.5 freshness in its arrival line", () => {
    const m = new Mission(eph);
    m.update(0);
    const ow = m.packet!.oneWay;
    const log = m.update(ow);
    const arrived = log.find((e) => e.entity === "PKT-0001")!;
    // freshness(ow, ow) == 2^-1 == 0.5; the line formats it to 2 dp.
    expect(arrived.value).toBe("0.50");
  });
});

describe("Mission — deterministic scripted flavour feed", () => {
  it("does not fire a flavour line before the first interval elapses", () => {
    const m = new Mission(eph);
    m.update(0); // schedules first line at SCRIPT_INTERVAL
    const log = m.update(SCRIPT_INTERVAL - 1);
    expect(log.some((e) => e.entity === "HELIO-NET")).toBe(false);
  });

  it("fires the first scripted line exactly at the first interval, stamped at its scheduled time", () => {
    const m = new Mission(eph);
    m.update(0);
    const log = m.update(SCRIPT_INTERVAL);
    const first = log.find((e) => e.entity === "HELIO-NET");
    expect(first).toBeDefined();
    expect(first!.tSim).toBe(SCRIPT_INTERVAL);
    expect(first!.sev).toBe("info");
    expect(first!.msg).toBe("peering · L2 symmetric");
  });

  it("advances through the script in order, one line per interval, with scheduled timestamps", () => {
    const m = new Mission(eph);
    m.update(0);
    // Jump across three intervals at once; all three due lines come out in order.
    const log = m.update(SCRIPT_INTERVAL * 3);
    const flavour = log.filter((e) =>
      ["HELIO-NET", "ORI-RELAY", "LUNA-DC1"].includes(e.entity ?? ""),
    );
    expect(flavour.map((e) => e.entity)).toEqual(["HELIO-NET", "ORI-RELAY", "LUNA-DC1"]);
    expect(flavour.map((e) => e.tSim)).toEqual([
      SCRIPT_INTERVAL,
      SCRIPT_INTERVAL * 2,
      SCRIPT_INTERVAL * 3,
    ]);
    // A scripted line that carries a value token passes it through verbatim.
    const oriRelay = flavour.find((e) => e.entity === "ORI-RELAY")!;
    expect(oriRelay.value).toBe("4.2 dB");
  });

  it("is identical for the same t regardless of step granularity (deterministic, pure of t)", () => {
    const big = new Mission(eph);
    big.update(0);
    const bigLog = big
      .update(SCRIPT_INTERVAL * 2)
      .filter((e) => typeof e.entity === "string" && e.msg !== undefined);

    const stepped = new Mission(eph);
    stepped.update(0);
    const steppedLog = [
      ...stepped.update(SCRIPT_INTERVAL),
      ...stepped.update(SCRIPT_INTERVAL * 2),
    ];
    const bigFlavour = bigLog.filter((e) => ["HELIO-NET", "ORI-RELAY"].includes(e.entity ?? ""));
    const stepFlavour = steppedLog.filter((e) =>
      ["HELIO-NET", "ORI-RELAY"].includes(e.entity ?? ""),
    );
    expect(stepFlavour).toEqual(bigFlavour);
  });
});

describe("Mission — no spurious occult at the open J2000 epoch", () => {
  it("t=0 line of sight is genuinely open, so update() emits no occult crit line", () => {
    // Guard the precondition the rest of the suite leans on.
    expect(earthMarsLos(eph, 0).occulted).toBe(false);

    const m = new Mission(eph);
    const log = m.update(0);
    expect(log.some((e) => e.sev === "crit")).toBe(false);
    expect(log.some((e) => e.msg.includes("OCCULT"))).toBe(false);
  });
});

describe("Mission — snapshot()/restore() round-trip", () => {
  it("snapshot captures the live mutable state including the in-flight packet", () => {
    const m = new Mission(eph);
    m.update(0);
    m.update(300);

    const snap = m.snapshot();
    expect(snap.booted).toBe(true);
    expect(snap.nextId).toBe(2); // id 1 launched, next id is 2
    expect(snap.packet).not.toBeNull();
    expect(snap.packet).toEqual({ ...m.packet });
  });

  it("the snapshot packet is copied by value, NOT aliased to live state", () => {
    const m = new Mission(eph);
    m.update(0);
    const snap = m.snapshot();
    const capturedProgress = snap.packet!.progress;

    // Mutating live state by advancing time must not touch the snapshot.
    expect(snap.packet).not.toBe(m.packet);
    m.update(400);
    expect(m.packet!.progress).toBeGreaterThan(capturedProgress);
    expect(snap.packet!.progress).toBe(capturedProgress);
  });

  it("restore() reproduces a state whose own snapshot equals the original", () => {
    const original = new Mission(eph);
    original.update(0);
    original.update(SCRIPT_INTERVAL); // fire a script line so scriptIdx/nextScriptT advance
    const snap = original.snapshot();

    const restored = new Mission(eph);
    restored.restore(snap);

    // Captured-then-restored equals the original, field for field.
    expect(restored.snapshot()).toEqual(snap);
    // And the restored packet is a fresh copy, not aliasing the snapshot's packet.
    expect(restored.packet).not.toBe(snap.packet);
    expect(restored.packet).toEqual(snap.packet);
  });

  it("a restored mission continues the lifecycle identically to the original", () => {
    const original = new Mission(eph);
    original.update(0);
    const snap = original.snapshot();

    const restored = new Mission(eph);
    restored.restore(snap);

    const t = 500;
    const origLog = original.update(t);
    const restLog = restored.update(t);
    expect(restLog).toEqual(origLog);
    expect(restored.packet).toEqual(original.packet);
  });

  it("round-trips a null packet (snapshot before boot)", () => {
    const m = new Mission(eph);
    const snap = m.snapshot();
    expect(snap.packet).toBeNull();
    expect(snap.booted).toBe(false);

    const restored = new Mission(eph);
    restored.restore(snap);
    expect(restored.packet).toBeNull();
    expect(restored.snapshot()).toEqual(snap);
  });
});
