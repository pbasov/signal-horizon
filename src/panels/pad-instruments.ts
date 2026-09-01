/**
 * THE LAUNCH INSTRUMENTS — the pad's pictures (the launch-interface rewrite).
 *
 * The pad used to be five `<input type=number>` boxes carrying raw orbital elements. Two of
 * them did nothing at all on a first launch (RAAN is meaningless at zero inclination, phase
 * spread is meaningless for a batch of one), the coverage comb was a blank black rectangle,
 * and nothing on screen said what the numbers were FOR. This module is the replacement: a
 * small set of instruments that draw the CONSEQUENCE of each control next to the control.
 *
 * The vocabulary stays real — ALTITUDE, INCLINATION, RAAN — because the terms are part of
 * the fantasy and worth learning. What changes is that you can now SEE what each one does:
 * the altitude profile draws the beam actually widening as you climb, the inclination dial
 * draws the latitude band actually reaching your customer, and the phase ring draws the
 * satellites you already own so a replacement can be dropped into the hole they left.
 *
 * Every widget is a plain DOM/SVG object with a `render(state)` that mutates in place — no
 * per-frame rebuild, so the pad can be re-rendered every tick without churning the DOM.
 * Geometry in, pixels out: none of these compute physics, they are handed numbers the sim
 * already derived (LAW 1 — the instruments show facts, they never decide anything).
 */

const SVG_NS = "http://www.w3.org/2000/svg";

function svg(tag: string, attrs: Record<string, string | number> = {}): SVGElement {
  const e = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v));
  return e;
}

/** Clamp helper — the drag handlers all need it. */
function clamp(v: number, lo: number, hi: number): number {
  return v < lo ? lo : v > hi ? hi : v;
}

/**
 * A DRAG-SCRUB NUMBER. Replaces `<input type=number>`, whose browser spinner arrows are
 * both ugly and useless at this size (the user's words: "number boxes look ugly because of
 * the huge up/down arrows"). Drag left/right to scrub, or click to type an exact value —
 * so the keyboard/bot path the design calls first-class stays intact.
 */
export class ScrubNumber {
  readonly root: HTMLElement;
  private readonly valueEl: HTMLInputElement;
  private dragging = false;
  private dragStartX = 0;
  private dragStartValue = 0;
  private value = 0;

  constructor(
    private readonly opts: {
      label: string;
      unit: string;
      min: number;
      max: number;
      /** Value change per pixel dragged. */
      perPx: number;
      /** Snap the scrubbed value to this step (0 = no snap). */
      step: number;
      title?: string;
      dataNet?: string;
      onChange: (v: number) => void;
    },
  ) {
    this.root = document.createElement("div");
    this.root.className = "pad-scrub";
    if (opts.title !== undefined) this.root.title = opts.title;

    const label = document.createElement("span");
    label.className = "pad-scrub-label";
    label.textContent = opts.label;
    this.root.appendChild(label);

    this.valueEl = document.createElement("input");
    this.valueEl.className = "pad-scrub-value";
    this.valueEl.type = "text";
    this.valueEl.inputMode = "decimal";
    this.valueEl.spellcheck = false;
    if (opts.dataNet !== undefined) this.valueEl.setAttribute("data-net", opts.dataNet);
    this.valueEl.addEventListener("change", () => {
      const n = Number(this.valueEl.value.replace(/[^0-9.+-]/g, ""));
      if (Number.isFinite(n)) this.commit(clamp(n, opts.min, opts.max));
      else this.paint();
    });
    // Drag to scrub. Pointer capture keeps the gesture alive outside the element, and the
    // pointer is only "captured" once it actually moves, so a plain click still focuses the
    // field for typing.
    this.valueEl.addEventListener("pointerdown", (e) => {
      if (this.valueEl === document.activeElement) return; // typing — leave it alone.
      this.dragging = true;
      this.dragStartX = e.clientX;
      this.dragStartValue = this.value;
      this.valueEl.setPointerCapture(e.pointerId);
      e.preventDefault();
    });
    this.valueEl.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.dragStartX;
      let next = this.dragStartValue + dx * opts.perPx;
      if (opts.step > 0) next = Math.round(next / opts.step) * opts.step;
      this.commit(clamp(next, opts.min, opts.max));
    });
    const end = (e: PointerEvent) => {
      if (!this.dragging) return;
      this.dragging = false;
      if (this.valueEl.hasPointerCapture(e.pointerId)) this.valueEl.releasePointerCapture(e.pointerId);
    };
    this.valueEl.addEventListener("pointerup", end);
    this.valueEl.addEventListener("pointercancel", end);
    this.root.appendChild(this.valueEl);

    const unit = document.createElement("span");
    unit.className = "pad-scrub-unit";
    unit.textContent = opts.unit;
    this.root.appendChild(unit);
  }

  private commit(v: number): void {
    if (v === this.value) return;
    this.value = v;
    this.paint();
    this.opts.onChange(v);
  }

  private paint(): void {
    if (document.activeElement === this.valueEl && !this.dragging) return;
    this.valueEl.value = String(Math.round(this.value * 10) / 10);
  }

  render(v: number): void {
    if (this.dragging) return;
    this.value = v;
    this.paint();
  }

  /** Grey the control out when the current design makes it inert (see PadInertReason). */
  setInert(reason: string | null): void {
    this.root.classList.toggle("inert", reason !== null);
    if (reason !== null) this.root.title = reason;
    else if (this.opts.title !== undefined) this.root.title = this.opts.title;
  }
}

/** What the altitude profile draws. */
export interface AltitudeProfileState {
  /** Draft altitude in km above the toy surface. */
  altKm: number;
  /** The altitude band the pad allows. */
  minKm: number;
  maxKm: number;
  /** The GEO/park altitude — drawn as a labelled notch. */
  parkKm: number;
  /** Surface half-angle (degrees) the current loadout paints from this altitude. */
  footprintDeg: number;
  /** One-way light time to the target (ms), or null when there is no target. */
  latencyMs: number | null;
}

/**
 * THE ALTITUDE PROFILE — a side-on cut through the world with the orbit drawn at its real
 * proportional radius and the BEAM drawn as a wedge down onto the surface.
 *
 * This is the instrument the old pad lacked most. "ALTITUDE 535" told a newcomer nothing;
 * this draws the cone opening out and the painted arc growing as the orbit climbs, which is
 * the single most important relationship in the game now that beam cones are real physics.
 */
export class AltitudeProfile {
  readonly root: SVGElement;
  private readonly orbit: SVGElement;
  private readonly sat: SVGElement;
  private readonly beam: SVGElement;
  private readonly arc: SVGElement;
  private readonly parkRing: SVGElement;
  private readonly readout: SVGElement;
  private dragging = false;

  private static readonly W = 250;
  private static readonly H = 150;
  private static readonly CX = 125;
  private static readonly CY = 146;
  /** The body's drawn radius; everything else scales off it. Only its top arc is on
   * canvas — the picture is a horizon, not a planet. */
  private static readonly R = 34;

  constructor(private readonly onAlt: (km: number) => void) {
    const { W, H, CX, CY, R } = AltitudeProfile;
    this.root = svg("svg", { class: "pad-profile", viewBox: `0 0 ${W} ${H}`, width: "100%" });

    // The body first — the beam and the ground it paints go ON TOP of it.
    this.root.appendChild(svg("circle", { class: "pad-profile-body", cx: CX, cy: CY, r: R }));
    // The park (GEO) altitude, as a reference ring you can aim for.
    this.parkRing = svg("circle", { class: "pad-profile-park", cx: CX, cy: CY, r: R });
    this.root.appendChild(this.parkRing);

    this.orbit = svg("circle", { class: "pad-profile-orbit", cx: CX, cy: CY, r: R });
    this.root.appendChild(this.orbit);

    this.beam = svg("path", { class: "pad-profile-beam", d: "" });
    this.root.appendChild(this.beam);
    this.arc = svg("path", { class: "pad-profile-arc", d: "" });
    this.root.appendChild(this.arc);

    this.sat = svg("rect", { class: "pad-profile-sat", x: 0, y: 0, width: 7, height: 7 });
    this.root.appendChild(this.sat);

    this.readout = svg("text", { class: "pad-profile-readout", x: 6, y: 14 });
    this.root.appendChild(this.readout);

    const label = svg("text", { class: "pad-profile-caption", x: 6, y: H - 5 });
    label.textContent = "drag to raise / lower";
    this.root.appendChild(label);

    // Dragging UP raises the orbit. Vertical feels right here because the picture is a
    // side-on elevation — the satellite literally moves up the screen as it climbs.
    this.root.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      (this.root as unknown as HTMLElement).setPointerCapture(e.pointerId);
      this.applyDrag(e);
      e.preventDefault();
    });
    this.root.addEventListener("pointermove", (e) => {
      if (this.dragging) this.applyDrag(e);
    });
    const end = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      const el = this.root as unknown as HTMLElement;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    this.root.addEventListener("pointerup", end);
    this.root.addEventListener("pointercancel", end);
  }

  private last: AltitudeProfileState | null = null;

  private applyDrag(e: PointerEvent): void {
    if (this.last === null) return;
    const rect = (this.root as unknown as HTMLElement).getBoundingClientRect();
    const { H, CY } = AltitudeProfile;
    // Screen y → altitude, using the same normalized scale render() draws with.
    const yView = ((e.clientY - rect.top) / rect.height) * H;
    const frac = clamp((CY - yView) / (CY - 12), 0, 1);
    const km = this.last.minKm + frac * (this.last.maxKm - this.last.minKm);
    this.onAlt(km);
  }

  /** Drawn orbit radius for an altitude — proportional to the real ratio, so a parked GEO
   * really does sit ~2.8× the body radius out and a low pass really does hug the surface. */
  private radiusFor(altKm: number, s: AltitudeProfileState): number {
    const { R, CY } = AltitudeProfile;
    // The toy body is 300 km; keep the ratio honest, then fit the max into the panel.
    const bodyKm = 300;
    const ratio = (bodyKm + altKm) / bodyKm;
    const maxRatio = (bodyKm + s.maxKm) / bodyKm;
    const maxR = CY - 16;
    return R * ratio * Math.min(1, maxR / (R * maxRatio));
  }

  render(s: AltitudeProfileState): void {
    this.last = s;
    const { CX, CY, R } = AltitudeProfile;
    const r = this.radiusFor(s.altKm, s);
    this.orbit.setAttribute("r", String(r));
    this.parkRing.setAttribute("r", String(this.radiusFor(s.parkKm, s)));

    // The satellite rides the top of its ring (the side-on elevation).
    const sx = CX;
    const sy = CY - r;
    this.sat.setAttribute("x", String(sx - 3.5));
    this.sat.setAttribute("y", String(sy - 3.5));

    // The beam: a wedge from the satellite down to the painted arc on the surface.
    const half = clamp(s.footprintDeg, 0, 89) * (Math.PI / 180);
    const ax = CX + R * Math.sin(-half);
    const ay = CY - R * Math.cos(-half);
    const bx = CX + R * Math.sin(half);
    const by = CY - R * Math.cos(half);
    this.beam.setAttribute("d", `M ${sx} ${sy} L ${ax} ${ay} A ${R} ${R} 0 0 1 ${bx} ${by} Z`);
    this.arc.setAttribute("d", `M ${ax} ${ay} A ${R} ${R} 0 0 1 ${bx} ${by}`);

    const lat = s.latencyMs === null ? "" : `  ·  ${s.latencyMs.toFixed(1)} ms each way`;
    this.readout.textContent = `${Math.round(s.altKm)} km  ·  paints ${s.footprintDeg.toFixed(0)}° of ground${lat}`;
  }
}

/** What the inclination dial draws. */
export interface InclinationDialState {
  incDeg: number;
  /** Latitude of the region this launch is aimed at, or null when there is no target. */
  targetLatDeg: number | null;
  targetLabel: string;
  /** Half-angle of the footprint (deg) — the band reaches this far past the track. */
  footprintDeg: number;
}

/**
 * THE INCLINATION DIAL — the globe seen edge-on, with the orbit's tilt drawn as a line and
 * the LATITUDE BAND it can reach drawn as a shaded belt, against a marker for the customer's
 * latitude.
 *
 * "INCLINATION 0" is meaningless to a newcomer. "The belt you can reach stops here, and your
 * customer is up there" is not — and it is the exact fact that makes act 2's high-latitude
 * tender impossible for an equatorial orbit.
 */
export class InclinationDial {
  readonly root: SVGElement;
  private readonly track: SVGElement;
  private readonly band: SVGElement;
  private readonly targetMark: SVGElement;
  private readonly targetText: SVGElement;
  private readonly readout: SVGElement;
  private dragging = false;

  private static readonly W = 250;
  private static readonly H = 150;
  private static readonly CX = 125;
  private static readonly CY = 76;
  private static readonly R = 52;

  constructor(private readonly onInc: (deg: number) => void) {
    const { W, H, CX, CY, R } = InclinationDial;
    this.root = svg("svg", { class: "pad-dial", viewBox: `0 0 ${W} ${H}`, width: "100%" });

    this.band = svg("rect", { class: "pad-dial-band", x: CX - R, y: CY, width: 2 * R, height: 1 });
    this.root.appendChild(this.band);
    this.root.appendChild(svg("circle", { class: "pad-dial-body", cx: CX, cy: CY, r: R }));
    // The equator, for orientation.
    this.root.appendChild(
      svg("line", { class: "pad-dial-equator", x1: CX - R, y1: CY, x2: CX + R, y2: CY }),
    );
    this.track = svg("line", { class: "pad-dial-track", x1: CX - R, y1: CY, x2: CX + R, y2: CY });
    this.root.appendChild(this.track);

    this.targetMark = svg("circle", { class: "pad-dial-target", cx: CX, cy: CY, r: 3.5 });
    this.root.appendChild(this.targetMark);
    this.targetText = svg("text", { class: "pad-dial-targettext", x: CX + R + 6, y: CY });
    this.root.appendChild(this.targetText);

    this.readout = svg("text", { class: "pad-dial-readout", x: 6, y: 14 });
    this.root.appendChild(this.readout);

    const cap = svg("text", { class: "pad-dial-caption", x: 6, y: H - 5 });
    cap.textContent = "drag to tilt";
    this.root.appendChild(cap);

    this.root.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      (this.root as unknown as HTMLElement).setPointerCapture(e.pointerId);
      this.applyDrag(e);
      e.preventDefault();
    });
    this.root.addEventListener("pointermove", (e) => {
      if (this.dragging) this.applyDrag(e);
    });
    const end = (e: PointerEvent): void => {
      if (!this.dragging) return;
      this.dragging = false;
      const el = this.root as unknown as HTMLElement;
      if (el.hasPointerCapture(e.pointerId)) el.releasePointerCapture(e.pointerId);
    };
    this.root.addEventListener("pointerup", end);
    this.root.addEventListener("pointercancel", end);
  }

  private applyDrag(e: PointerEvent): void {
    const rect = (this.root as unknown as HTMLElement).getBoundingClientRect();
    const { W, H, CX, CY } = InclinationDial;
    const x = ((e.clientX - rect.left) / rect.width) * W - CX;
    const y = ((e.clientY - rect.top) / rect.height) * H - CY;
    // Angle off horizontal, folded into 0..90 — inclination past 90 is retrograde, which the
    // M1 planner does not expose.
    const deg = Math.abs(Math.atan2(-y, Math.abs(x) < 1e-3 ? 1e-3 : Math.abs(x)) * (180 / Math.PI));
    this.onInc(clamp(deg, 0, 90));
  }

  render(s: InclinationDialState): void {
    const { CX, CY, R } = InclinationDial;
    const inc = clamp(s.incDeg, 0, 90) * (Math.PI / 180);
    const dx = R * Math.cos(inc);
    const dy = R * Math.sin(inc);
    this.track.setAttribute("x1", String(CX - dx));
    this.track.setAttribute("y1", String(CY + dy));
    this.track.setAttribute("x2", String(CX + dx));
    this.track.setAttribute("y2", String(CY - dy));

    // The reachable belt: the ground track's latitude limit, widened by the footprint.
    const reachDeg = clamp(s.incDeg + s.footprintDeg, 0, 90);
    const bandHalf = (reachDeg / 90) * R;
    this.band.setAttribute("y", String(CY - bandHalf));
    this.band.setAttribute("height", String(Math.max(1, 2 * bandHalf)));

    if (s.targetLatDeg === null) {
      this.targetMark.setAttribute("opacity", "0");
      this.targetText.textContent = "";
    } else {
      const ty = CY - (clamp(s.targetLatDeg, -90, 90) / 90) * R;
      this.targetMark.setAttribute("opacity", "1");
      this.targetMark.setAttribute("cy", String(ty));
      this.targetText.setAttribute("y", String(ty + 3));
      this.targetText.textContent = `${Math.round(s.targetLatDeg)}°`;
    }
    this.readout.textContent = `tilt ${Math.round(s.incDeg)}°  ·  reaches to ${Math.round(reachDeg)}° north and south`;
  }
}

/** One satellite already on the ring the draft is joining. */
export interface RingMember {
  id: string;
  /** Position along the ring, degrees 0..360. */
  phaseDeg: number;
  /** True for the sats this launch would ADD (drawn bright), false for the fleet you own. */
  draft: boolean;
}

export interface PhaseRingState {
  members: RingMember[];
  /** The largest gap on the ring, in degrees — the hole a replacement wants to fill. */
  gapDeg: number;
  /** Where that gap is centred (degrees). */
  gapCentreDeg: number;
  /** How many satellites this launch carries. */
  count: number;
  /** True when the fleet has no sat on this ring yet (nothing to fill). */
  empty: boolean;
}

/**
 * THE PHASE RING — the orbit seen from above, with the satellites you ALREADY OWN on it and
 * the ones this launch would add, plus the biggest gap called out.
 *
 * This exists because of a specific question: a satellite in a working constellation dies —
 * how do you phase the replacement into the hole? Under the old pad you could not, in any
 * practical sense. Co-phasing a later launch with an existing ring means undoing both the
 * body's spin and the ring's own travel since it launched (the canonical script got this
 * wrong for months and nobody noticed, because the old floodlights were wide enough to hide
 * it). No player should do that arithmetic. So the pad shows the ring, marks the hole, and
 * the sim does the conversion.
 */
export class PhaseRing {
  readonly root: SVGElement;
  private readonly gapWedge: SVGElement;
  private readonly markers: SVGElement;
  private readonly readout: SVGElement;

  private static readonly W = 250;
  private static readonly H = 150;
  private static readonly CX = 125;
  private static readonly CY = 76;
  private static readonly R = 48;

  constructor() {
    const { W, H, CX, CY, R } = PhaseRing;
    this.root = svg("svg", { class: "pad-ring", viewBox: `0 0 ${W} ${H}`, width: "100%" });
    this.gapWedge = svg("path", { class: "pad-ring-gap", d: "" });
    this.root.appendChild(this.gapWedge);
    this.root.appendChild(svg("circle", { class: "pad-ring-body", cx: CX, cy: CY, r: 13 }));
    this.root.appendChild(svg("circle", { class: "pad-ring-track", cx: CX, cy: CY, r: R }));
    this.markers = svg("g", {});
    this.root.appendChild(this.markers);
    this.readout = svg("text", { class: "pad-ring-readout", x: 6, y: 14 });
    this.root.appendChild(this.readout);
  }

  private static pos(deg: number): { x: number; y: number } {
    const a = (deg * Math.PI) / 180;
    return { x: PhaseRing.CX + PhaseRing.R * Math.cos(a), y: PhaseRing.CY - PhaseRing.R * Math.sin(a) };
  }

  render(s: PhaseRingState): void {
    const { CX, CY, R } = PhaseRing;
    // The gap wedge.
    if (s.empty || s.gapDeg >= 359) {
      this.gapWedge.setAttribute("d", "");
    } else {
      const a0 = ((s.gapCentreDeg - s.gapDeg / 2) * Math.PI) / 180;
      const a1 = ((s.gapCentreDeg + s.gapDeg / 2) * Math.PI) / 180;
      const p0 = { x: CX + R * Math.cos(a0), y: CY - R * Math.sin(a0) };
      const p1 = { x: CX + R * Math.cos(a1), y: CY - R * Math.sin(a1) };
      const large = s.gapDeg > 180 ? 1 : 0;
      this.gapWedge.setAttribute("d", `M ${CX} ${CY} L ${p0.x} ${p0.y} A ${R} ${R} 0 ${large} 0 ${p1.x} ${p1.y} Z`);
    }

    this.markers.textContent = "";
    for (const m of s.members) {
      const p = PhaseRing.pos(m.phaseDeg);
      const dot = svg("circle", {
        class: m.draft ? "pad-ring-dot draft" : "pad-ring-dot",
        cx: p.x,
        cy: p.y,
        r: m.draft ? 4.5 : 3.5,
      });
      this.markers.appendChild(dot);
    }

    this.readout.textContent = s.empty
      ? `${s.count} on a new ring`
      : `${s.members.filter((m) => !m.draft).length} flying  ·  +${s.count} this launch  ·  widest gap ${Math.round(s.gapDeg)}°`;
  }
}

/** One row of the draft-versus-requirement comparison. */
export interface CompareRow {
  label: string;
  /** What this draft delivers, already formatted. */
  yours: string;
  /** What the tender demands, already formatted (empty = the tender does not enforce it). */
  needs: string;
  /** Bar fill 0..1 for the draft's value; null = not measurable yet. */
  fill: number | null;
  /** Where the requirement sits on the same bar, 0..1; null = no threshold to draw. */
  threshold: number | null;
  title?: string;
}

/**
 * THE COMPARISON — your number beside the tender's number, on a shared bar.
 *
 * The old pad printed the draft's physics and left the requirement on a different screen
 * (the pad REPLACED the tender board, so you could not even see what you were aiming for
 * while you aimed). Facts with nothing to compare them against are not information, which is
 * most of why the pad read as noise. This still prints no verdict: two numbers and a
 * threshold tick, and the player does the comparing.
 */
export class CompareTable {
  readonly root: HTMLElement;
  private rows = new Map<string, { yours: HTMLElement; needs: HTMLElement; fill: HTMLElement; tick: HTMLElement }>();
  private sig = "";

  constructor() {
    this.root = document.createElement("div");
    this.root.className = "pad-compare";
  }

  render(rows: CompareRow[]): void {
    const sig = rows.map((r) => r.label).join("|");
    if (sig !== this.sig) {
      this.sig = sig;
      this.root.textContent = "";
      this.rows.clear();
      const head = document.createElement("div");
      head.className = "pad-compare-head";
      const h1 = document.createElement("span");
      h1.textContent = "THIS DRAFT";
      const h2 = document.createElement("span");
      h2.textContent = "THE TENDER ASKS";
      head.append(h1, h2);
      this.root.appendChild(head);
      for (const r of rows) {
        const row = document.createElement("div");
        row.className = "pad-compare-row";
        if (r.title !== undefined) row.title = r.title;
        const label = document.createElement("div");
        label.className = "pad-compare-label";
        label.textContent = r.label;
        const yours = document.createElement("div");
        yours.className = "pad-compare-yours";
        const bar = document.createElement("div");
        bar.className = "pad-compare-bar";
        const fill = document.createElement("div");
        fill.className = "pad-compare-fill";
        const tick = document.createElement("div");
        tick.className = "pad-compare-tick";
        bar.append(fill, tick);
        const needs = document.createElement("div");
        needs.className = "pad-compare-needs";
        row.append(label, yours, bar, needs);
        this.root.appendChild(row);
        this.rows.set(r.label, { yours, needs, fill, tick });
      }
    }
    for (const r of rows) {
      const els = this.rows.get(r.label);
      if (els === undefined) continue;
      els.yours.textContent = r.yours;
      els.needs.textContent = r.needs;
      els.fill.style.width = r.fill === null ? "0%" : `${clamp(r.fill, 0, 1) * 100}%`;
      if (r.threshold === null) {
        els.tick.style.display = "none";
      } else {
        els.tick.style.display = "";
        els.tick.style.left = `${clamp(r.threshold, 0, 1) * 100}%`;
      }
    }
  }
}
