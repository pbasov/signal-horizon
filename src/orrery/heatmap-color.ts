/**
 * M2b — the COVERAGE-HEATMAP colour mapping (GDD §5 view #2 + §8 "monochrome
 * machine, living signal" / per-dimension hues + CVD-safe redundant encoding).
 *
 * PURE: a function from a cell's coverage + the selected dimension to an RGB
 * colour + an opacity, with NO three.js / DOM / wall-clock / RNG. It lives in
 * src/orrery (it is render presentation, not sim truth) but is engine-agnostic
 * so it is unit-testable in isolation — the orrery only multiplies these into a
 * preallocated colour buffer per frame.
 *
 * --- THE ENCODING (GDD §8) ---------------------------------------------------
 * The CHROME stays 1-bit; only the COVERAGE SIGNAL carries colour. Each covered
 * cell is tinted on the SELECTED dimension's stable, learnable hue ramp:
 *   - CONNECTIVITY → cyan (the "active link / healthy" hue): more covering
 *     assets ⇒ hotter/brighter.
 *   - BANDWIDTH → green (the "good margin / capacity" hue): more capacity ⇒
 *     hotter/brighter.
 *   - LATENCY → amber, LOWER IS HOTTER (the §5 ask): a near hop glows warm amber,
 *     a far/marginal hop cools toward the machine grey.
 * An UNCOVERED cell (connectivity 0) reads as a near-dark, desaturated hole in
 * the web — it bleeds toward the 1-bit substrate so a coverage GAP is visible as
 * a gap (exactly what §5 view #2 is for).
 *
 * --- CVD SAFETY (GDD §8 hard requirement) ------------------------------------
 * The covered/uncovered distinction and the within-ramp intensity are carried
 * REDUNDANTLY in BRIGHTNESS + OPACITY, not hue alone: a covered cell is brighter
 * and more opaque the better its coverage; an uncovered cell is both dim AND
 * faint. "Colour-off" the heatmap still reads as a brightness/opacity field, so
 * a deuteranope sees the same gaps a trichromat does.
 */

/** The §4.2 information dimensions the heatmap can paint (the M2a-delivered trio). */
export type CoverageDimension = "connectivity" | "bandwidth" | "latency";

/** Cycle order for the dimension key (connectivity → bandwidth → latency → …). */
export const DIMENSION_CYCLE: CoverageDimension[] = ["connectivity", "bandwidth", "latency"];

/** A short, glanceable label for the active dimension (status strip / overlay). */
export function dimensionLabel(d: CoverageDimension): string {
  switch (d) {
    case "connectivity":
      return "CONNECTIVITY";
    case "bandwidth":
      return "BANDWIDTH";
    case "latency":
      return "LATENCY";
  }
}

/** Per-dimension base hue (linear RGB in [0,1]) — the stable, learnable §8 hues. */
const HUE: Record<CoverageDimension, readonly [number, number, number]> = {
  connectivity: [0.27, 0.84, 0.79], // cyan  (#46d6c9): active link / healthy.
  bandwidth: [0.31, 0.85, 0.55], // green (#4fd98b): good margin / capacity.
  latency: [1.0, 0.62, 0.18], // amber (#ff9e2e): a warm, near hop.
};

/** The machine grey an uncovered / cold cell bleeds toward (matches --grey-ish). */
const COLD: readonly [number, number, number] = [0.2, 0.2, 0.24];

/**
 * Normalising scales per dimension — map a raw coverage figure into a [0,1]
 * "warmth" the ramp reads. Placeholders tuned to the M2a link-budget defaults
 * (a handful of LEO/GEO/MEO sats over a level-2 grid):
 *   - CONNECTIVITY: 1 asset is already "covered"; ~3+ overlapping is hot.
 *   - BANDWIDTH: summed inverse-square capacity; a single near sat ≈ a few units,
 *     so ~6 units reads as a strong cell.
 *   - LATENCY: a LEO hop ≈ 2 ms, a GEO hop ≈ 120 ms; below LAT_HOT_S is fully
 *     hot, above LAT_COLD_S fully cold (lower = hotter).
 */
const CONNECTIVITY_HOT = 3; // connectivity at/above this ⇒ warmth 1.
const BANDWIDTH_HOT = 6; // bandwidth at/above this ⇒ warmth 1.
const LATENCY_HOT_S = 0.005; // ≤5 ms one-way ⇒ warmth 1 (a near LEO hop).
const LATENCY_COLD_S = 0.14; // ≥140 ms one-way ⇒ warmth 0 (beyond a GEO hop).

/** Minimal raw coverage a cell needs (per dimension) to count as covered. */
export interface CellCoverageLike {
  connectivity: number;
  bandwidth: number;
  /** Min one-way latency among covering assets (seconds); Infinity if uncovered. */
  latencyS: number;
}

/** Clamp x to [0,1]. */
function clamp01(x: number): number {
  return x < 0 ? 0 : x > 1 ? 1 : x;
}

/**
 * The normalised WARMTH ∈ [0,1] of a cell on the selected dimension. 0 ⇒ cold /
 * uncovered (bleeds to the substrate); 1 ⇒ the hottest the ramp shows. An
 * uncovered cell (connectivity 0) is always 0 regardless of dimension.
 */
export function coverageWarmth(cov: CellCoverageLike, dim: CoverageDimension): number {
  if (cov.connectivity <= 0) return 0;
  switch (dim) {
    case "connectivity":
      return clamp01(cov.connectivity / CONNECTIVITY_HOT);
    case "bandwidth":
      return clamp01(cov.bandwidth / BANDWIDTH_HOT);
    case "latency": {
      if (!Number.isFinite(cov.latencyS)) return 0;
      // Lower latency is hotter: invert the [HOT,COLD] band into [1,0].
      const t = (cov.latencyS - LATENCY_HOT_S) / (LATENCY_COLD_S - LATENCY_HOT_S);
      return clamp01(1 - t);
    }
  }
}

/** An RGB colour (linear, [0,1] per channel) plus an opacity for one cell. */
export interface CellColor {
  r: number;
  g: number;
  b: number;
  /** Opacity ∈ [0,1] — the redundant, colour-off channel (covered ⇒ opaque). */
  a: number;
}

/** Opacity of an uncovered cell — a faint dark wash so the GAP is visible but not loud. */
export const UNCOVERED_OPACITY = 0.16;
/** Opacity of a just-covered (warmth 0) cell — the floor the covered ramp starts at. */
export const COVERED_MIN_OPACITY = 0.42;
/** Opacity of the hottest covered cell. */
export const COVERED_MAX_OPACITY = 0.92;

/**
 * Map one cell's coverage on the selected dimension to a colour + opacity.
 *
 * REDUNDANT (CVD-safe) channels, all monotonic in warmth:
 *   - HUE: the dimension's stable hue, lerped from the cold machine-grey (warmth
 *     0) to the full hue (warmth 1) — so saturation rises with warmth.
 *   - BRIGHTNESS: the colour is additionally scaled by a brightness that climbs
 *     with warmth, so a hot cell is both more saturated AND brighter.
 *   - OPACITY: an uncovered cell is faint ({@link UNCOVERED_OPACITY}); a covered
 *     cell ramps {@link COVERED_MIN_OPACITY}→{@link COVERED_MAX_OPACITY} with warmth.
 * Colour-off, the field still reads as brightness × opacity, so the gaps show.
 */
export function coverageCellColor(cov: CellCoverageLike, dim: CoverageDimension): CellColor {
  const covered = cov.connectivity > 0;
  const warmth = coverageWarmth(cov, dim);
  if (!covered) {
    // A dark, desaturated hole in the web — the 1-bit substrate showing through.
    return { r: COLD[0], g: COLD[1], b: COLD[2], a: UNCOVERED_OPACITY };
  }
  const hue = HUE[dim];
  // Saturation rises with warmth: cold-grey → full hue.
  // Brightness also rises with warmth (redundant), floored so a warmth-0 covered
  // cell is still visibly lit (distinct from an uncovered hole).
  const bright = 0.55 + 0.45 * warmth;
  const r = (COLD[0] + (hue[0] - COLD[0]) * warmth) * bright;
  const g = (COLD[1] + (hue[1] - COLD[1]) * warmth) * bright;
  const b = (COLD[2] + (hue[2] - COLD[2]) * warmth) * bright;
  const a = COVERED_MIN_OPACITY + (COVERED_MAX_OPACITY - COVERED_MIN_OPACITY) * warmth;
  return { r, g, b, a };
}
