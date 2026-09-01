/**
 * ALL player-facing MISSION copy lives here — objectives, briefings, tender fiction —
 * under two structural laws (m1-redesign.md §1, enforced by copy-lint.test.ts):
 *
 *   LAW 2 — GOALS, NEVER INSTRUCTIONS. Copy names a want ("the metro is dark and
 *   paying"), never a control ("press L", "click ACCEPT"). The world teaches; the
 *   instruments show consequences. Control legends live in the status strip, not here.
 *
 *   The lint bans imperative control references in THIS file. Add new player-facing
 *   prose HERE so it stays under the lint.
 */

/** Per-act GOALS (not instructions). Keyed by scenario cursor. */
export const MISSION_OBJECTIVES: readonly { title: string; detail: string }[] = [
  {
    title: "First light",
    detail:
      "The equatorial metro is dark, and its co-op pays for a broadcast feed while signal reaches it. " +
      "Your wallet is finite; a signed deal that goes unserved bleeds twice what it pays.",
  },
  {
    title: "Hold a region that moves",
    detail:
      "The polar metro needs holding, not touching — 99% of the time, as satellites rise and set. " +
      "One moving satellite cannot hold it alone.",
  },
  {
    title: "Your own success congests it",
    detail:
      "Demand grows where you serve well. Two deals now share one pipe, and their peaks don't care about your margins. " +
      "The corridor metro pays for low latency no floodlight can carry — spot beams point at one region at a time.",
  },
  {
    title: "It breaks. Does your network?",
    detail:
      "Hardware degrades, links drop, and one warned failure is counting down. A network that survives is one you shaped that way.",
  },
  {
    title: "The frontier",
    detail:
      "Mars pays for a relay. Light takes minutes each way — watch your first signal crawl and decide what 'now' even means out there.",
  },
];

/**
 * The Act-1 cold-open (SD-60: now carries the PREMISE, not just the mechanic).
 *
 * `docs/signal-horizon-beats.md` §3 asks for one ~84-word framing block, stated once. The
 * build has no new-game screen to put it on: the boot console (panels/boot.ts) auto-fades in
 * ~3.2 s and is dismissed by ANY input, and the Wire must stay causal and never literary. An
 * 84-word paragraph fits none of those, so the premise COMPRESSES to the medium instead of
 * the medium stretching to the paragraph. Two sentences carry three of the four rulings:
 * Earth is prosperous but capped (§10.1), the player is a startup holding one licence
 * (§10.2), and the existing mechanic line survives intact.
 */
export const MISSION_WELCOME =
  "Earth is rich and out of room, so the load went up. You hold a licence, a thin account, and one dish — and dark regions pay when signal reaches them, while hardware and physics decide whether it does.";

/** Tender-row verdict fragments (facts about the OFFER, never solved answers). */
export const TENDER_BET = (payPerHr: string, penaltyPerHr: string): string =>
  `pays ${payPerHr} while served · bleeds ${penaltyPerHr} while signed and dark`;

/** The launch-event WIRE beats (diegetic, no controls). */
export const WIRE_COUNTDOWN = (id: string): string => `${id} — terminal count`;
export const WIRE_LIFTOFF = (id: string): string => `${id} — liftoff`;
export const WIRE_DEPLOY = (satId: string): string => `${satId} separation confirmed`;
export const WIRE_NOSEP = (satId: string): string => `${satId} NO SEP — the slot in your phasing is real`;
export const WIRE_UNDERBURN = (satId: string): string =>
  `${satId} underburn — parked low; a circularization burn would raise it`;
export const WIRE_VEHICLE_LOST = (id: string): string => `${id} VEHICLE LOST — range safety`;
export const WIRE_FIRST_SIGNAL = (satId: string, regionLabel: string): string =>
  `${satId} first signal — ${regionLabel} lit`;

// ── SD-60 — THE REGISTRY (beats B1 / B4) ────────────────────────────────────────
/**
 * The Orbital Allocation Registry is the only formal voice in the game: passive, numbered,
 * and entirely without opinion. It never praises and it never threatens. It records.
 *
 * These are LICENCE-level, once per game — distinct from the per-contract WIRE lines above.
 * B1 is the one beat guaranteed to fire: the licence stops being a premise and becomes a
 * record. B4's whole point is the indifference — nobody is disappointed in you, it is simply
 * written down. Neither carries a verdict, an instruction, or a consequence the player must
 * act on (`docs/signal-horizon-beats.md` §4, §5).
 */
export const NET_LICENCE_ID = "4471-C";
/** The boot-console line that ISSUES the licence — the Registry establishes itself, and the
 * player's standing, before the premise line lands. Zero reading cost; pure scene-setting. */
export const REGISTRY_LICENCE_ISSUED = `LICENCE ${NET_LICENCE_ID} ISSUED · ORBITAL ALLOCATION REGISTRY`;
/** B1 FIRST LIGHT — the first service ever recorded against the licence. */
export const REGISTRY_FIRST_SERVICE = `LICENCE ${NET_LICENCE_ID} ACTIVE. FIRST SERVICE RECORDED.`;
/** B4 THE FIRST BREACH — a contract fell past grace. Stated, not scolded. */
export const REGISTRY_FIRST_BREACH = `BREACH RECORDED AGAINST LICENCE ${NET_LICENCE_ID}.`;

// ── FL-02 copy surface (SD-46/47/49) — the fragments the verb rebuild renders. All
// FACTS about terms/physics, never verdicts, never instructions (LAW 1 + LAW 2). ──

/** FL-07 — a tender's sign-on bonus (the priced WHEN, not a "sign now!"). */
export const TENDER_SIGNON_BONUS = (amountEur: string, windowText: string): string =>
  `sign-on +€${amountEur} — the window closes in ${windowText}`;
/** FL-07 — a tender's decaying pay (the market bids while you wait). */
export const TENDER_PAY_DECAY = (halfLifeText: string): string =>
  `the pay halves every ${halfLifeText} the offer sits unsigned`;
/** FL-07/FL-08 — the breach grace on the terms, printed as a fact. */
export const TENDER_BREACH_GRACE = (graceText: string): string =>
  `pays only while served · a breach counts once you've been dark ${graceText} straight`;
/** FL-10 — the launch risk band on the PAD (ABSENT in Act 1, where failure is silent-zero;
 * never rendered as "0%" — honest silence, not lying reassurance). */
export const PAD_RISK_BAND = (vehiclePct: string, underburnPct: string, noSepPct: string): string =>
  `launch risk — vehicle loss ${vehiclePct} · underburn ${underburnPct}/sat (a burn fixes it) · no separation ${noSepPct}/sat`;
/** FL-11 — the manifest discount on the PAD stack line. */
export const STACK_BATCH_DISCOUNT = (pct: string): string =>
  `2nd+ satellite on the same vehicle −${pct} hardware`;
/** FL-04 — slot-class labels for the bus silhouette (redundant with the slot glyphs). */
export const SLOT_G_LABEL = "GROUND-FACING";
export const SLOT_S_LABEL = "SAT-FACING";

/** R3 — the WIRE act-transition beats (indexed by the NEW scenario cursor; 0 = boot, silent).
 * World-flavor arrivals — facts about what changed, never instructions. */
export const NET_ACT_BEAT: readonly string[] = [
  "",
  "second demand on the board — the polar metro moves, and it pays to be HELD, not visited",
  "the corridor and the backhaul are live — your success just became shared load",
  "the first failure is out there counting down — what survives is what you shaped",
  "Mars is asking — light takes minutes each way; the frontier doesn't do 'now'",
];

/** UX polish — the "can one bird do it" pad fact (availability tenders only): the comb's
 * duty number in plain words. A fact, never a verdict. */
export const PAD_AVAIL_FACT = (dutyPct: string, barPct: string): string =>
  `one bird lights it ${dutyPct}% of the time — the tender asks ${barPct}%`;

// ── SD-53 — THE ROUTING SCREEN (TRACE). Every player string the routing table can render.
// docs/routing-screen.md §8 holds the lawfulness argument row by row. The rule that governs all of
// them: a MEASUREMENT states two raw numbers and their ratio; a POST-HOC DIAGNOSIS is lawful only
// about a solve that already failed, and names a class of hardware or geometry — never a control,
// never the answer. Functions take PRE-FORMATTED display strings; they never format numbers. ──

/** The group legend that DEFINES THE UNIT. An undefined unit on the primary key of the primary
 * table is the largest comprehension failure available here, so it is closed by definition. */
export const TRACE_PIPES_LEGEND =
  "capacity in units · one unit is roughly one region's baseline demand";

/** The honest statement of the sim's own re-solve split: the SOLVER re-runs on a topology-change
 * event, serve/breach is re-evaluated every tick. Unstated, a table that holds a path steady
 * between events looks frozen and gets accused of lying. */
export const TRACE_FRESHNESS_LEGEND = "paths hold until the geometry moves · load is now";

/** The head census — how many promises, and how they stand. */
export const TRACE_CENSUS = (flows: string): string => `WHAT BINDS · ${flows}`;
export const TRACE_CENSUS_BANDS = (dark: string, tight: string, clear: string, asOf: string): string =>
  `${dark} dark · ${tight} tight · ${clear} clear · as of ${asOf}`;
/** Paused: the physics cells are frozen because the sim is, and the readout says so. */
export const TRACE_CENSUS_PAUSED = (asOf: string): string => `held at ${asOf} · paused`;

/** Nothing is carrying traffic yet (Act 1, before the first signature). Names a want, not a key. */
export const TRACE_EMPTY =
  "nothing is carrying traffic yet — a signed tender and a bird in view make the first row.";

/** The path line: which antenna on which satellite lands this flow on which ground. */
export const TRACE_VIA = (satAndAntenna: string, groundId: string): string =>
  `via ${satAndAntenna} → ${groundId}`;
/** The router found no bridge at all — the absence, stated as the measurement it is. */
export const TRACE_NO_BRIDGE = "no bridge — nothing in view closes the link";
/** A pipe that IS aimed at a region it cannot currently reach. Pointing does not bend physics. */
export const TRACE_NO_SIGHT = "NO LINE OF SIGHT";
/** A BROADCAST antenna has no aim to change — it floodlights whatever is under it. */
export const TRACE_FLOODLIGHT = "· floodlight ·";
/** A pointable antenna that is not pointed anywhere. */
export const TRACE_UNAIMED = "· unaimed ·";

/** How long this promise has been dark, and — separately — how long it has been near its edge. */
export const TRACE_DARK_FOR = (mmss: string): string => `dark ${mmss}`;
export const TRACE_TIGHT_FOR = (mmss: string): string => `tight ${mmss}`;
/** A loss that happened: the geometric cause, the mission time, and — once there are enough of
 * them to make a rhythm — how far apart they have been. An OBSERVED spacing, never a forecast. */
export const TRACE_LAST_LOSS = (cause: string, atMmss: string, count: string, spacing: string): string =>
  `${cause} at ${atMmss}${count}${spacing}`;
/** The signed terms, restated: what a dark hour actually costs. */
export const TRACE_BLEEDS = (perHour: string): string => `bleeds ${perHour}/hr while dark`;

/** The Mars leg: one relay, presence-based, and minutes of light each way. */
export const TRACE_MARS_VIA = (relayId: string, groundId: string): string =>
  `via ${relayId} (presence) → ${groundId}`;
export const TRACE_MARS_LIGHT = (delay: string): string =>
  `one-way light ${delay} — the answer is already old when it lands.`;
/** Why the route-bias control is inert on the Mars row — a disabled control always states why. */
export const TRACE_MARS_NO_ALTERNATIVE = "one relay, no alternative";

/** How many OTHER pipes could reach this region right now. The honest answer to "why did nothing
 * move when I re-biased it" — geometry, counted. */
export const TRACE_CANDIDATES = (n: number): string =>
  n === 0 ? "one pipe reaches this region" : `${n + 1} pipes reach this region`;

/** The idle summary — the only waste read M1 will actually have, because diagnose()'s
 * over-provision face requires a concurrently unserved contract to fire at all. */
export const TRACE_IDLE_SUMMARY = (count: string, units: string): string =>
  `${count} idle · ${units} u parked`;

/** A rider's allocation on a shared pipe: what it offered, what it is getting, what it promised. */
export const TRACE_RIDER_NUMS = (offer: string, share: string, floor: string): string =>
  `offer ${offer}  share ${share}  floor ${floor}`;

/** The Σfloor over-promise, stated with both operands. Visible while everything is still green. */
export const TRACE_OVERPROMISED = (sumFloor: string, cap: string): string =>
  `Σfloor ${sumFloor} u > ${cap} u pipe`;
/** A pipe carrying more than it can serve, stated as the overflow amount. */
export const TRACE_OVERFLOW = (excess: string): string => `OVER +${excess} u`;
/** A sat mid-degradation: its antennas are derated, and the number says by how much. */
export const TRACE_DERATED = (nominal: string, factor: string): string => `(${nominal} ×${factor} SICK)`;

/** A sick node and its blast radius. */
export const TRACE_NODE_RECOVERS = (factor: string, mmss: string): string =>
  `capacity ×${factor} · recovers in ${mmss}`;
export const TRACE_NODE_FAILS = (mmss: string): string => `fails in ${mmss}`;
export const TRACE_NODE_CARRYING = (n: string): string => `carrying ${n}`;

/** The hand-route answer — what the game says when a player tries to drag a path. §4.3a's own
 * words: the player shapes the graph and states the intent; the solver picks the path. */
export const TRACE_HAND_ROUTE =
  "the solver picks the path from what can close — you shape what it can pick from.";

/** Tooltips. All fact-form; none names a control (the LEDGER·FLEET gerund pattern). */
export const TRACE_TIP_ELEV =
  "Elevation of the satellite above this endpoint's horizon. Below 5° the link does not close — no aiming changes that.";
export const TRACE_TIP_PIPE =
  "One antenna. Everything riding it shares its capacity in proportion to offered load, so a peak on one rider starves another.";
export const TRACE_TIP_FLOOR =
  "The bandwidth this contract committed to. The notch on the bar is the SUM of every floor promised against this antenna — past it, the promises exceed the hardware.";
export const TRACE_TIP_PREFER =
  "SHORT chases the lowest-latency pipe; SPREAD leaves a congested pipe for a parallel one. It can only move a flow to a pipe that already reaches the region.";
export const TRACE_TIP_LOSS =
  "Every link loss carries the geometry that caused it and the mission time it happened. Repeats on one link are listed with the spacing observed between them.";
export const TRACE_TIP_BAND =
  "Ordered worst-first: unserved promises, then the ones closest to their limit. The order is the physics, not a setting.";

/** SD-53 — a flow's path just MOVED. The row names where it came from for a beat while the globe
 * flashes the new path: a re-route is an event you watch, not a line you find in a log later. */
export const TRACE_REROUTED = (fromPipe: string): string => `re-routed from ${fromPipe}`;

/** SD-53 — the REPOINT picker's per-option FACTS. Each states the consequence of committing this
 * antenna to that target, before the commit — never a ranking, never a recommendation. */
export const TRACE_PICK_CURRENT = "pointed here now";
export const TRACE_PICK_NO_SIGHT = "not in view from this satellite";
export const TRACE_PICK_ALREADY_SERVED = "in view · already carried elsewhere";
export const TRACE_PICK_IN_VIEW = "in view · dark";
export const TRACE_PICK_STOW = "STOW";
export const TRACE_PICK_STOW_IDLE = "points at nothing · nobody riding";
export const TRACE_PICK_STOW_CARRYING = (labels: string): string => `points at nothing · drops ${labels}`;
