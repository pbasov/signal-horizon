import { describe, it, expect } from "vitest";
import {
  BODY_FRAMING_HOME,
  BODY_FRAMING_MOON,
  BODY_FRAMING_SYSTEM,
  BODY_NAV_GLYPH,
  type BodyPresence,
  bodyNavSignature,
  bodyNavTier,
  buildBodyNav,
  cycleBodyNav,
  fmtSignalDelay,
  framingForBody,
  lightDelaySeconds,
} from "./body-nav";
import { AU_M, C_LIGHT } from "../sim/ephemeris";

/** A presence with everything empty — each test overrides only the field it is about. */
function presence(over: Partial<BodyPresence> & { id: string }): BodyPresence {
  return {
    label: over.id,
    parentId: "sun",
    distanceFromHomeM: 0,
    contracts: 0,
    assets: 0,
    served: false,
    dark: false,
    ...over,
  };
}

const HOME = "earth";

describe("body-nav: the framing a jump to a body uses is derived from the body GRAPH", () => {
  it("the HOME body frames near-body (its own orbits are the game)", () => {
    expect(framingForBody("earth", "sun", HOME)).toBe(BODY_FRAMING_HOME);
  });

  it("a MOON OF HOME frames cislunar (home + its moon both in frame)", () => {
    expect(framingForBody("moon", "earth", HOME)).toBe(BODY_FRAMING_MOON);
  });

  it("another PLANET frames heliocentric — the only fold that shows an interplanetary gap", () => {
    expect(framingForBody("mars", "sun", HOME)).toBe(BODY_FRAMING_SYSTEM);
  });

  it("the STAR itself frames heliocentric (it is the system anchor)", () => {
    expect(framingForBody("sun", "", HOME)).toBe(BODY_FRAMING_SYSTEM);
  });

  it("generic in the graph: a FUTURE mission to another planet's moon frames heliocentric", () => {
    // No case per body — a Jovian moon needs no new code, which is the point of the derivation.
    expect(framingForBody("europa", "jupiter", HOME)).toBe(BODY_FRAMING_SYSTEM);
  });

  it("the home body is whatever the caller says it is (never hardcoded 'earth')", () => {
    // A later milestone operating FROM Mars: Mars frames near-body, Earth becomes the far planet.
    expect(framingForBody("mars", "sun", "mars")).toBe(BODY_FRAMING_HOME);
    expect(framingForBody("earth", "sun", "mars")).toBe(BODY_FRAMING_SYSTEM);
    expect(framingForBody("phobos", "mars", "mars")).toBe(BODY_FRAMING_MOON);
  });
});

describe("body-nav: the tier is worst-first — a bleeding body is never quieter than a healthy one", () => {
  it("DARK wins over everything (signed demand here is unserved)", () => {
    const p = presence({ id: "earth", dark: true, served: true, assets: 4, contracts: 2 });
    expect(bodyNavTier(p, HOME)).toBe("dark");
  });

  it("SERVED reads served while nothing is dark", () => {
    expect(bodyNavTier(presence({ id: "earth", served: true, assets: 4 }), HOME)).toBe("served");
  });

  it("assets or contracts with nothing live reads PRESENT", () => {
    expect(bodyNavTier(presence({ id: "mars", assets: 1 }), HOME)).toBe("present");
    expect(bodyNavTier(presence({ id: "mars", contracts: 1 }), HOME)).toBe("present");
  });

  it("the empty HOME body still reads home (the anchor is never 'nothing here')", () => {
    expect(bodyNavTier(presence({ id: "earth" }), HOME)).toBe("home");
  });

  it("the root STAR reads star, and an untouched body reads REACHABLE (the frontier)", () => {
    expect(bodyNavTier(presence({ id: "sun", parentId: "" }), HOME)).toBe("star");
    expect(bodyNavTier(presence({ id: "mars" }), HOME)).toBe("reachable");
  });

  it("every tier has a distinct redundant GLYPH — §8 colour-off must stay readable", () => {
    const glyphs = Object.values(BODY_NAV_GLYPH);
    expect(new Set(glyphs).size).toBe(glyphs.length);
  });
});

describe("body-nav: the light-delay badge is the honest d / c, never a decoration", () => {
  it("the delay is distance / c", () => {
    expect(lightDelaySeconds(C_LIGHT)).toBeCloseTo(1, 12);
    expect(lightDelaySeconds(0)).toBe(0);
    expect(lightDelaySeconds(-5)).toBe(0); // a negative distance is nonsense, not a negative delay.
  });

  it("1 AU reads ~8m19s — the number a player can check against the real solar system", () => {
    expect(fmtSignalDelay(lightDelaySeconds(AU_M))).toBe("8m19s");
  });

  it("the MOON keeps its decimal (1.3 s is a felt difference from 0, and rounding kills it)", () => {
    expect(fmtSignalDelay(lightDelaySeconds(384_400_000))).toBe("1.3s");
  });

  it("past 10 s it reads minutes + zero-padded seconds", () => {
    expect(fmtSignalDelay(9.94)).toBe("9.9s");
    expect(fmtSignalDelay(42)).toBe("42s");
    expect(fmtSignalDelay(60)).toBe("1m00s");
    expect(fmtSignalDelay(1322)).toBe("22m02s");
  });
});

describe("body-nav: the built bar answers 'which bodies do I serve, and how far are they?'", () => {
  const bodies: BodyPresence[] = [
    presence({ id: "earth", label: "earth", distanceFromHomeM: 0, assets: 4, served: true }),
    presence({ id: "moon", label: "moon", parentId: "earth", distanceFromHomeM: 384_400_000 }),
    presence({ id: "mars", label: "mars", distanceFromHomeM: 2.2e11, contracts: 1, dark: true }),
  ];

  it("row order is the caller's, and the ACTIVE row is the camera's focus", () => {
    const nav = buildBodyNav(bodies, HOME, "mars");
    expect(nav.map((e) => e.id)).toEqual(["earth", "moon", "mars"]);
    expect(nav.map((e) => e.active)).toEqual([false, false, true]);
  });

  it("home badges HOME; every other body badges its one-way signal delay", () => {
    const nav = buildBodyNav(bodies, HOME, "earth");
    expect(nav[0].badge).toBe("HOME");
    expect(nav[1].badge).toBe("1.3s");
    expect(nav[2].badge).toBe(fmtSignalDelay(2.2e11 / C_LIGHT));
  });

  it("the tier + glyph carry the state (served earth, reachable moon, DARK mars)", () => {
    const nav = buildBodyNav(bodies, HOME, "earth");
    expect(nav.map((e) => e.tier)).toEqual(["served", "reachable", "dark"]);
    expect(nav[2].glyph).toBe(BODY_NAV_GLYPH.dark);
  });

  it("each row carries the framing its jump uses (so a click cannot land in a void)", () => {
    const nav = buildBodyNav(bodies, HOME, "earth");
    expect(nav.map((e) => e.framing)).toEqual([
      BODY_FRAMING_HOME,
      BODY_FRAMING_MOON,
      BODY_FRAMING_SYSTEM,
    ]);
  });

  it("the hover title names what you hold there AND what it costs to reach (layered disclosure)", () => {
    const nav = buildBodyNav(bodies, HOME, "earth");
    expect(nav[2].title).toContain("DARK");
    // Distance AND delay: the two facts a mission to another body is planned against.
    expect(nav[2].title).toContain("AU");
    expect(nav[2].title).toContain("one-way signal");
    expect(nav[0].title).toContain("home body");
    expect(nav[0].title).not.toContain("one-way signal"); // home has no signal cost to itself.
    expect(nav[1].title).toContain("nothing here yet");
    expect(nav[1].title).toContain("Mkm"); // the Moon is sub-0.01 AU, so it reads in Mkm.
  });

  it("an empty roster builds an empty bar (no invented bodies)", () => {
    expect(buildBodyNav([], HOME, "earth")).toEqual([]);
  });
});

describe("body-nav: cycling the bar always moves, and wraps", () => {
  const nav = buildBodyNav(
    [presence({ id: "earth" }), presence({ id: "moon", parentId: "earth" }), presence({ id: "mars" })],
    HOME,
    "earth",
  );

  it("forward and back step one row, wrapping at both ends", () => {
    expect(cycleBodyNav(nav, "earth", 1)).toBe("moon");
    expect(cycleBodyNav(nav, "mars", 1)).toBe("earth");
    expect(cycleBodyNav(nav, "earth", -1)).toBe("mars");
    expect(cycleBodyNav(nav, "moon", -1)).toBe("earth");
  });

  it("an UNKNOWN current focus still moves (the key never silently does nothing)", () => {
    expect(cycleBodyNav(nav, "sat_leo", 1)).toBe("earth");
    expect(cycleBodyNav(nav, "sat_leo", -1)).toBe("mars");
  });

  it("an empty bar returns the current focus unchanged", () => {
    expect(cycleBodyNav([], "earth", 1)).toBe("earth");
  });
});

describe("body-nav: the repaint signature changes only on a VISIBLE change (X-02, no per-frame DOM)", () => {
  const base: BodyPresence[] = [
    presence({ id: "earth", distanceFromHomeM: 0, served: true }),
    presence({ id: "mars", distanceFromHomeM: 2.2e11 }),
  ];

  it("identical rows produce an identical signature", () => {
    expect(bodyNavSignature(buildBodyNav(base, HOME, "earth"))).toBe(
      bodyNavSignature(buildBodyNav(base, HOME, "earth")),
    );
  });

  it("a tier flip, a focus change, or a badge change all move the signature", () => {
    const sig = bodyNavSignature(buildBodyNav(base, HOME, "earth"));
    const dark = [presence({ id: "earth", distanceFromHomeM: 0, dark: true }), base[1]];
    expect(bodyNavSignature(buildBodyNav(dark, HOME, "earth"))).not.toBe(sig);
    expect(bodyNavSignature(buildBodyNav(base, HOME, "mars"))).not.toBe(sig);
    const moved = [base[0], presence({ id: "mars", distanceFromHomeM: 3.3e11 })];
    expect(bodyNavSignature(buildBodyNav(moved, HOME, "earth"))).not.toBe(sig);
  });

  it("a sub-badge distance wobble does NOT repaint (the bar is quiet while nothing reads different)", () => {
    // Mars drifts a few thousand km between frames; the badge (rounded to the second) is unchanged,
    // so the signature must not move — otherwise the bar rebuilds DOM every frame.
    const drift = [base[0], presence({ id: "mars", distanceFromHomeM: 2.2e11 + 1e6 })];
    expect(bodyNavSignature(buildBodyNav(drift, HOME, "earth"))).toBe(
      bodyNavSignature(buildBodyNav(base, HOME, "earth")),
    );
  });
});
