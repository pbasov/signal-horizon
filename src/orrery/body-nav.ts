/**
 * CELESTIAL BODY NAVIGATION (pure, render-free) — SD-63 / GDD §5 view #1 ("the Orrery — the solar
 * system at selectable scale compression") + the layered-disclosure principle ("glanceable
 * summary → hover detail → click drill … one click to focus each").
 *
 * The orrery had exactly two ways to change the camera's SUBJECT: a blind `F` cycle through a
 * hardcoded list, and a click on a body glyph that net mode immediately stomped back to the
 * operated body. Neither answered the two questions a multi-body operator actually asks —
 * "which bodies do I serve?" and "how do I get there?" — so this module is the model behind a
 * real BODY BAR: one row per body, each carrying what you have there, how far the signal has
 * to crawl, and which camera framing a jump to it should use.
 *
 * PURE (no three / no DOM / no wall-clock): the orrery is the painter, main.ts assembles the
 * presence facts from the live session, and every verdict here is unit-tested in isolation.
 * Kept out of `src/sim/` on purpose — this is a VIEW model (what the camera should do), never
 * sim truth, and it never feeds the fold/snapshot/hash.
 */

import { C_LIGHT } from "../sim/ephemeris";
import { fmtDistance } from "../format";

/**
 * What the sim knows about one navigable body, assembled by the caller. Distances are METRES
 * from the player's HOME body (the one their business runs from) — the nav's own light-delay
 * is derived from it, never passed in pre-computed, so the badge can never disagree with the
 * geometry.
 */
export interface BodyPresence {
  /** Ephemeris body id ("earth", "moon", "mars", …). */
  id: string;
  /** Display label (uppercased by the painter). */
  label: string;
  /** Parent body id; "" for the root star. Decides which framing a jump uses. */
  parentId: string;
  /** Straight-line metres from the HOME body (0 for home itself). */
  distanceFromHomeM: number;
  /** Live contracts whose demand rides this body's surface. */
  contracts: number;
  /** The player's own assets (satellites + ground stations) at this body. */
  assets: number;
  /** True while at least one live contract on this body is SERVED right now. */
  served: boolean;
  /** True while at least one SIGNED contract on this body is dark (bleeding). */
  dark: boolean;
}

/**
 * The state a nav row reads at a glance. Ordered worst-first for the painter's tone map, so a
 * bleeding body is never quieter than a healthy one:
 *   dark      — signed demand here is UNSERVED right now (the alarm)
 *   served    — demand here is being served (the working body)
 *   present   — you hold assets or an offer here, nothing live
 *   home      — the body your business runs from (the anchor, always reachable)
 *   star      — the system's root (a navigation anchor, never a customer)
 *   reachable — a body you can look at but do not operate yet (the frontier)
 */
export type BodyNavTier = "dark" | "served" | "present" | "home" | "star" | "reachable";

/** Redundant (colour-off) glyph channel per tier — §8 CVD safety: never colour alone. */
export const BODY_NAV_GLYPH: Record<BodyNavTier, string> = {
  dark: "▲",
  served: "●",
  present: "◍",
  home: "◉",
  star: "✳",
  reachable: "·",
};

/** One painted nav row. */
export interface BodyNavEntry {
  id: string;
  label: string;
  tier: BodyNavTier;
  /** The tier's redundant glyph (§8). */
  glyph: string;
  /** One-way light delay from home (seconds); 0 for home itself. */
  lightDelayS: number;
  /** The short right-hand badge: "HOME", or the one-way signal delay ("4m22s"). */
  badge: string;
  /** True when this body is the camera's current focus. */
  active: boolean;
  /** The camera-preset NAME a jump to this body should frame with. */
  framing: string;
  /** Hover detail (layered disclosure): what you have here + what the signal costs. */
  title: string;
}

/** The camera-preset names the nav can ask for. Kept as strings so this module never imports
 * the (three-dependent) preset table; the orrery resolves the name to its index. */
export const BODY_FRAMING_HOME = "EARTH";
export const BODY_FRAMING_MOON = "CISLUNAR";
export const BODY_FRAMING_SYSTEM = "SYSTEM";

/**
 * Which camera framing a JUMP to `bodyId` should use. Generic in the body graph, so a future
 * mission to a Jovian moon needs no new case:
 *   - the HOME body itself → the near-body framing (its orbits + constellation are the game);
 *   - a satellite OF home (our Moon) → the cislunar framing (home + its moon both in frame);
 *   - anything else (another planet, another planet's moon) → the heliocentric SYSTEM framing,
 *     the only one whose fold shows an interplanetary gap without crushing it.
 */
export function framingForBody(bodyId: string, parentId: string, homeId: string): string {
  if (bodyId === homeId) return BODY_FRAMING_HOME;
  if (parentId === homeId) return BODY_FRAMING_MOON;
  return BODY_FRAMING_SYSTEM;
}

/** The nav tier for one body (worst-first: a bleeding body wins over a served one). */
export function bodyNavTier(p: BodyPresence, homeId: string): BodyNavTier {
  if (p.dark) return "dark";
  if (p.served) return "served";
  if (p.assets > 0 || p.contracts > 0) return "present";
  if (p.id === homeId) return "home";
  if (p.parentId === "") return "star";
  return "reachable";
}

/** One-way light delay (seconds) over a straight-line distance. The honest number — d / c. */
export function lightDelaySeconds(distanceM: number): number {
  return Math.max(0, distanceM) / C_LIGHT;
}

/**
 * The signal delay as a badge. Sub-10 s keeps one decimal (the Moon's 1.3 s is a real, felt
 * difference from 0 — rounding it to "1s" throws the only interesting digit away); past that
 * it reads as minutes and seconds. Never "0s": home is labelled HOME by the caller.
 */
export function fmtSignalDelay(sec: number): string {
  const s = Math.max(0, sec);
  if (s < 10) return `${s.toFixed(1)}s`;
  const whole = Math.round(s);
  const m = Math.floor(whole / 60);
  return m > 0 ? `${m}m${String(whole % 60).padStart(2, "0")}s` : `${whole}s`;
}

/**
 * The hover detail for one row: what you hold here, then what it costs to reach — the DISTANCE
 * and the one-way SIGNAL DELAY, the two facts any mission to another body is planned against.
 */
function navTitle(p: BodyPresence, tier: BodyNavTier, delayS: number, homeId: string): string {
  const held: string[] = [];
  if (p.contracts > 0) held.push(`${p.contracts} contract${p.contracts === 1 ? "" : "s"}`);
  if (p.assets > 0) held.push(`${p.assets} asset${p.assets === 1 ? "" : "s"}`);
  const what =
    tier === "dark"
      ? "DARK — signed demand here is unserved"
      : tier === "served"
        ? "served now"
        : held.length > 0
          ? held.join(" · ")
          : tier === "star"
            ? "the system anchor"
            : "nothing here yet";
  const where =
    p.id === homeId
      ? "home body"
      : `${fmtDistance(p.distanceFromHomeM)} out · one-way signal ${fmtSignalDelay(delayS)}`;
  return `focus ${p.label.toUpperCase()} — ${what} · ${where}`;
}

/**
 * Build the nav rows. Order is the caller's — main.ts orders by ROLE (home, then home's moons,
 * then the star, then the other planets by semi-major axis) rather than by live distance, because
 * a navigation bar whose buttons re-shuffle as the planets swing is a bar you cannot learn.
 * `focusId` marks the active row. Bodies the caller cannot resolve should simply be omitted —
 * this never invents one.
 */
export function buildBodyNav(
  bodies: readonly BodyPresence[],
  homeId: string,
  focusId: string,
): BodyNavEntry[] {
  return bodies.map((p) => {
    const tier = bodyNavTier(p, homeId);
    const lightDelayS = lightDelaySeconds(p.distanceFromHomeM);
    return {
      id: p.id,
      label: p.label,
      tier,
      glyph: BODY_NAV_GLYPH[tier],
      lightDelayS,
      badge: p.id === homeId ? "HOME" : fmtSignalDelay(lightDelayS),
      active: p.id === focusId,
      framing: framingForBody(p.id, p.parentId, homeId),
      title: navTitle(p, tier, lightDelayS, homeId),
    };
  });
}

/**
 * The next body id when cycling the bar by `dir` (+1 forward, −1 back). Wraps; returns the
 * current id unchanged when the bar is empty. An unknown current id starts the cycle at the
 * first row going forward and the last going back (so the key always does something).
 */
export function cycleBodyNav(
  entries: readonly BodyNavEntry[],
  currentId: string,
  dir: number,
): string {
  if (entries.length === 0) return currentId;
  const i = entries.findIndex((e) => e.id === currentId);
  if (i < 0) return dir >= 0 ? entries[0].id : entries[entries.length - 1].id;
  const step = dir >= 0 ? 1 : -1;
  return entries[(i + step + entries.length) % entries.length].id;
}

/**
 * A change signature for the painted bar. The orrery repaints DOM only when this changes
 * (X-02 — never per frame): the rows' identity, tier, badge, and which one is active.
 */
export function bodyNavSignature(entries: readonly BodyNavEntry[]): string {
  return entries.map((e) => `${e.id}:${e.tier}:${e.badge}:${e.active ? 1 : 0}`).join("|");
}
