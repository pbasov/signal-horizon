/**
 * M2f — NAMED RIVAL OPERATORS (GDD §3 the emergent-narrative cast, §8 faction colours).
 *
 * GDD §3 names the story generator's cast: "rival operators with names and personalities
 * who undercut and peer with you". §8 (the colour system) gives each rival/partner operator
 * a stable IDENTITY HUE so "whose infrastructure / whose event is this" reads at a glance on
 * the web + in the SYSTEM.LOG ("Faction names — rendered in that faction's identity colour").
 *
 * For M2f V1 the rivals are the EVENT SOURCE + an identity colour: the event generator
 * attributes RIVAL_ACTION events to one of these operators, and the log paints the rival's
 * name in its hue. DEEP competition AI — rivals building their own coverage, bidding the same
 * contracts, holding per-faction trust/price/exclusivity state (§3b "partners vs. competitors",
 * §4.10 information warfare) — is explicitly DEFERRED to M3+. V1 is the story/shock layer that
 * makes the network a place where things HAPPEN; the strategic rival AI sits on top later.
 *
 * --- PURITY -----------------------------------------------------------------
 * Fixed data only: stable ids, display names, and identity hues. No three / DOM / wall-clock /
 * RNG. The hues are §8 SIGNAL colours (the same palette the orrery + log tokens draw from),
 * chosen DISTINCT from the per-dimension freshness/coverage ramps (green/cyan/amber/grey) so a
 * faction hue never reads as a freshness value. The CSS class names map to style.css faction
 * rules. Numbers/names are sane placeholders — tune later.
 */

/** A rival operator's identity hue (§8). A CSS class the log paints the faction name with;
 * the literal hex is the source-of-truth colour (so a non-DOM consumer can read it too). */
export interface FactionHue {
  /** CSS class on the faction-name token (style.css `.faction.<cls>`). */
  cls: string;
  /** The literal signal hue (the §8 palette value the class resolves to). */
  hex: string;
}

/** A named rival operator: the emergent-narrative cast (§3) + a §8 identity colour. */
export interface Rival {
  /** Stable id (the RIVAL_ACTION event payload carries this; folds into the state-hash). */
  id: string;
  /** Display name, painted in {@link hue} in the log (the faction-name token, §8). */
  name: string;
  /** A one-word personality tag (§3 "names and personalities") — flavour for the log line. */
  personality: string;
  /** The §8 faction identity hue. */
  hue: FactionHue;
}

/**
 * The fixed rival cast. THREE operators, each with a DISTINCT §8 identity hue chosen apart
 * from the freshness/coverage ramps (so a faction colour can't be mistaken for a data value):
 *   - HELIX RELAY    → violet  (#8e84ff, the §8 "infrastructure" hue) — aggressive undercut.
 *   - MERIDIAN LINK  → orange  (#ff7a1a) — a steady incumbent peer.
 *   - PALE BLUE NET  → blue    (#5aa9ff) — a fragile upstart whose relays fail.
 * The personalities seed the flavour of their RIVAL_ACTION lines (undercut / peer / failure).
 */
export const RIVALS: Rival[] = [
  {
    id: "helix",
    name: "HELIX RELAY",
    personality: "aggressive",
    hue: { cls: "helix", hex: "#8e84ff" },
  },
  {
    id: "meridian",
    name: "MERIDIAN LINK",
    personality: "incumbent",
    hue: { cls: "meridian", hex: "#ff7a1a" },
  },
  {
    id: "paleblue",
    name: "PALE BLUE NET",
    personality: "upstart",
    hue: { cls: "paleblue", hex: "#5aa9ff" },
  },
];

/** Look up a rival by id (null if unknown — keeps consumers total). */
export function rivalById(id: string): Rival | null {
  return RIVALS.find((r) => r.id === id) ?? null;
}
