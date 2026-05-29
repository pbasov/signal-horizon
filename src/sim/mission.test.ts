import { describe, it, expect } from "vitest";
import { Mission } from "./mission";
import { loadEphemeris } from "./system-data";
import { oneWaySeconds, freshness } from "./delay";
import { earthMarsLos } from "./links";

/**
 * BEHAVIOUR pin for the mission director — the Earth→Mars packet lifecycle and
 * the SYSTEM.LOG feed, driven purely by SIM time.
 *
 * M1-05: the packet is now LAUNCH-ON-DEMAND. boot() no longer auto-launches and
 * arrival no longer auto-relaunches; the orchestrator calls launch(t) when the
 * M1Session starts a fetch, and the packet CLEARS itself on arrival. These tests
 * are updated from the old auto-relaunch pins to the new gated behaviour.
 *
 * Everything here is a pure function of the explicit t handed to update()/
 * launch(): no wall-clock, no RNG. The ephemeris is the real (deterministic)
 * Kepler truth, so we DERIVE the expected numbers (one-way light delay,
 * freshness) from the same pure helpers the module uses rather than hardcoding
 * magic constants. At the J2000 epoch (t=0) Earth↔Mars is wide open (≈156 solar
 * radii of margin), so no solar-occult event fires and the packet/script
 * behaviour is isolated.
 */

const eph = loadEphemeris();

/** One-way light delay frozen for a packet launched at sim-time t (module's own formula). */
function expectedOneWay(t: number): number {
  return oneWaySeconds(eph.distanceBetween("earth", "mars", t));
}

const SCRIPT_INTERVAL = 540; // sim-seconds between flavour lines (mirrors mission.ts)

describe("Mission — boot sequence (M1-05: gated, no auto-launch)", () => {
  it("a fresh mission has no packet until launch() is called", () => {
    const m = new Mission(eph);
    expect(m.packet).toBeNull();
  });

  it("the first update() boots with orrery-online + link-open and NO packet launch", () => {
    const m = new Mission(eph);
    const log = m.update(0);

    // The boot pair, in order — the packet now appears on demand, not at boot.
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ tSim: 0, sev: "info", entity: "ORRERY" });
    expect(log[1]).toMatchObject({ tSim: 0, sev: "info", entity: "EARTH→MARS" });
    // No PKT line at boot, and no packet in flight.
    expect(log.some((e) => e.entity?.startsWith("PKT-"))).toBe(false);
    expect(m.packet).toBeNull();
  });

  it("launch() starts an Earth→Mars packet: id 1, fresh, progress 0, frozen one-way delay", () => {
    const m = new Mission(eph);
    m.update(0);
    const log = m.launch(0);

    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ tSim: 0, sev: "info", entity: "PKT-0001" });
    expect(log[0].msg).toContain("launched");
    expect(log[0].msg).toContain("EARTH→MARS");

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

  it("boots only once — a second update() does not re-emit the boot pair", () => {
    const m = new Mission(eph);
    m.update(0);
    const again = m.update(1); // 1s later, well before any script line
    expect(again.some((e) => e.entity === "ORRERY")).toBe(false);
    expect(again.some((e) => e.msg.includes("link open"))).toBe(false);
  });

  it("launch() freezes one-way delay at whatever t it is launched at (not assuming t=0)", () => {
    const m = new Mission(eph);
    m.update(10_000);
    const log = m.launch(10_000);
    expect(log[0].tSim).toBe(10_000);
    expect(m.packet!.launchT).toBe(10_000);
    expect(m.packet!.oneWay).toBeCloseTo(expectedOneWay(10_000), 9);
  });
});

describe("Mission — honest packet crawl (progress/freshness derive from t)", () => {
  /** Boot + launch a packet at t=0, returning the mission. */
  function booted(): Mission {
    const m = new Mission(eph);
    m.update(0);
    m.launch(0);
    return m;
  }

  it("progress is 0 at launch and clears exactly at launchT + oneWay (no relaunch)", () => {
    const m = booted();
    const ow = m.packet!.oneWay;

    expect(m.packet!.progress).toBe(0);

    m.update(ow / 2);
    expect(m.packet!.progress).toBeCloseTo(0.5, 12);

    // Drive straight to arrival: the packet hits progress 1 and CLEARS itself.
    m.update(ow);
    expect(m.packet).toBeNull();
  });

  it("progress clamps to [0,1] before arrival and the packet clears past one-way", () => {
    const m = booted();
    const ow = m.packet!.oneWay;
    m.update(ow * 0.5);
    expect(m.packet!.progress).toBeGreaterThanOrEqual(0);
    expect(m.packet!.progress).toBeLessThanOrEqual(1);
    // Ticked past one one-way: the packet has arrived and cleared — no relaunch.
    m.update(ow * 1.5);
    expect(m.packet).toBeNull();
  });

  it("freshness equals the module's 2^(-age/oneWay) decay law (before arrival)", () => {
    const m = booted();
    const ow = m.packet!.oneWay;

    for (const age of [0, ow * 0.25, ow * 0.5, ow * 0.75]) {
      m.update(age);
      expect(m.packet!.freshness).toBeCloseTo(freshness(age, ow), 12);
    }
  });

  it("freshness decays monotonically as sim time advances (before arrival)", () => {
    const m = booted();
    const ow = m.packet!.oneWay;

    let prev = m.packet!.freshness; // 1 at launch
    for (const age of [ow * 0.1, ow * 0.2, ow * 0.4, ow * 0.8]) {
      m.update(age);
      expect(m.packet!.freshness).toBeLessThan(prev);
      prev = m.packet!.freshness;
    }
  });

  it("packet state is a pure function of the final t (path-independent)", () => {
    const a = booted();
    a.update(200);

    const b = booted();
    b.update(50);
    b.update(120);
    b.update(200);

    expect(b.packet!.progress).toBe(a.packet!.progress);
    expect(b.packet!.freshness).toBe(a.packet!.freshness);
    expect(b.packet!.oneWay).toBe(a.packet!.oneWay);
  });
});

describe("Mission — packet arrival and clear (M1-05: no relaunch)", () => {
  it("on arrival emits a stored/arrived line and clears the packet — no relaunch", () => {
    const m = new Mission(eph);
    m.update(0);
    m.launch(0);
    const ow = m.packet!.oneWay;
    const log = m.update(ow);

    const arrived = log.find((e) => e.entity === "PKT-0001");
    expect(arrived).toBeDefined();
    expect(arrived!.msg).toContain("arrived at MARS");

    // No PKT-0002 relaunch line, and the slot is empty until the next launch().
    expect(log.some((e) => e.entity === "PKT-0002")).toBe(false);
    expect(m.packet).toBeNull();
  });

  it("a subsequent launch() at the arrival instant re-samples distance and gets the next id", () => {
    const m = new Mission(eph);
    m.update(0);
    m.launch(0);
    const ow = m.packet!.oneWay;
    m.update(ow); // arrives + clears
    m.launch(ow); // orchestrator launches the next fetch on the next miss

    expect(m.packet!.id).toBe(2);
    expect(m.packet!.launchT).toBe(ow);
    expect(m.packet!.progress).toBe(0);
    expect(m.packet!.freshness).toBe(1);
    // Re-sampled the (changing) distance: the new oneWay is the t=arrival light-time.
    expect(m.packet!.oneWay).toBeCloseTo(expectedOneWay(ow), 9);
  });

  it("a packet arriving exactly at one one-way carries ~0.5 freshness in its arrival line", () => {
    const m = new Mission(eph);
    m.update(0);
    m.launch(0);
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
    m.launch(0); // demand started a fetch
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
    m.launch(0);
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
    original.launch(0); // an in-flight packet to exercise the copy-by-value path
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
