/**
 * M2b — THE COVERAGE HEATMAP overlay (GDD §5 view #2, the first visible M2 change
 * and the start of the §1 MONUMENT — the growing coverage web).
 *
 * Renders the M2a {@link GeodesicGrid} as a coloured coverage SHELL hugging Earth:
 * one TRIANGLE per cell (its three corner unit-vectors), built into a static mesh
 * ONCE and thereafter only re-COLOURED per frame into a preallocated vertex-colour
 * buffer (X-02 perf discipline — no per-frame geometry rebuild, no per-cell alloc).
 *
 * --- THE f64→f32 BOUNDARY (SD-5 floating origin) -----------------------------
 * The grid geometry is STATIC f32: the cells' corner unit-vectors live in the
 * mesh's local space at radius 1 and never change. The ONLY f64→f32 crossing is
 * the per-frame placement of Earth — the orrery hands us Earth's already-rebased,
 * log-compressed scene position + the apparent shell radius (both computed by the
 * orrery's existing f64 rebase, identical to how the body billboards are placed),
 * and we just set the mesh's position + uniform scale. No metres ever reach here.
 *
 * --- COLOUR (delegated, CVD-safe) --------------------------------------------
 * The per-cell colour + opacity is the PURE {@link coverageCellColor} mapping on
 * the selected dimension (cyan/green/amber hue ramps, brightness+opacity carrying
 * the covered/uncovered distinction redundantly). We write the triangle's three
 * vertices to that one colour (flat-shaded cells), so a coverage GAP is a dark,
 * faint hole in the web.
 */
import * as THREE from "three";
import type { GeodesicGrid } from "../sim/coverage/grid";
import type { CellCoverage } from "../sim/coverage/field";
import {
  type CoverageDimension,
  coverageCellColor,
  UNCOVERED_OPACITY,
} from "./heatmap-color";

/** Vertex shader: pass the per-vertex RGBA colour through; standard MVP transform. */
const SHELL_VERT = /* glsl */ `
  in vec4 cellColor;
  out vec4 vColor;
  void main() {
    vColor = cellColor;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

/**
 * Fragment shader: the cell's colour, premultiplied so the per-cell opacity rides
 * the additive-over-dark blend (a hotter cell glows more). Alpha is the redundant
 * colour-off channel — an uncovered cell arrives near-transparent.
 */
const SHELL_FRAG = /* glsl */ `
  precision highp float;
  in vec4 vColor;
  out vec4 fragColor;
  void main() {
    fragColor = vec4(vColor.rgb, vColor.a);
  }
`;

export class CoverageOverlay {
  /** The shell mesh — added to the scene by the orrery; we never touch the scene. */
  readonly mesh: THREE.Mesh;
  private readonly grid: GeodesicGrid;
  private readonly colorAttr: THREE.BufferAttribute;
  /** Scratch float for the per-frame colour write — no per-cell allocation. */
  private readonly colorArray: Float32Array;
  /** Whether the overlay is shown (the orrery's toggle drives `mesh.visible`). */
  visible = false;

  constructor(grid: GeodesicGrid) {
    this.grid = grid;
    const n = grid.cells.length;
    const vertCount = n * 3; // one flat triangle per cell.

    // --- STATIC geometry: corner unit-vectors at radius 1, built ONCE. -------
    const positions = new Float32Array(vertCount * 3);
    let w = 0;
    for (const cell of grid.cells) {
      for (const v of cell.vertices) {
        positions[w++] = v[0];
        positions[w++] = v[1];
        positions[w++] = v[2];
      }
    }
    // Per-vertex RGBA colour, updated each frame in place.
    this.colorArray = new Float32Array(vertCount * 4);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    this.colorAttr = new THREE.BufferAttribute(this.colorArray, 4);
    this.colorAttr.setUsage(THREE.DynamicDrawUsage);
    geo.setAttribute("cellColor", this.colorAttr);
    geo.computeBoundingSphere();

    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: SHELL_VERT,
      fragmentShader: SHELL_FRAG,
      transparent: true,
      depthWrite: false,
      // Additive over the dark scene so the lit web GLOWS on the globe; uncovered
      // (near-transparent) cells add almost nothing — a visible hole in the web.
      blending: THREE.AdditiveBlending,
      side: THREE.DoubleSide,
    });

    this.mesh = new THREE.Mesh(geo, mat);
    this.mesh.frustumCulled = false;
    this.mesh.renderOrder = 7; // under the body billboards (10), over the rings.
    this.mesh.visible = false;
    // Initialise to an all-uncovered wash so a first frame before any update reads sane.
    this.colorArray.fill(0);
    for (let i = 0; i < vertCount; i++) this.colorArray[i * 4 + 3] = UNCOVERED_OPACITY;
    this.colorAttr.needsUpdate = true;
  }

  /**
   * Place the shell at Earth's rebased scene position + apparent radius (both from
   * the orrery's existing f64 floating-origin rebase — the ONLY f64→f32 crossing,
   * done upstream). Pure transform set; no allocation.
   */
  place(pos: THREE.Vector3, radiusSceneUnits: number): void {
    this.mesh.position.copy(pos);
    // A hair above the surface so the shell reads as ON the globe, not z-fighting.
    this.mesh.scale.setScalar(radiusSceneUnits * 1.012);
  }

  /**
   * Re-colour every cell from this frame's coverage on the selected dimension.
   * Writes straight into the preallocated RGBA buffer (no per-cell allocation,
   * X-02). `coverages` is indexed by cell id (== grid order). Flat-shaded: the
   * triangle's three vertices share the cell colour.
   */
  updateColors(coverages: CellCoverage[], dim: CoverageDimension): void {
    const arr = this.colorArray;
    const cells = this.grid.cells;
    for (let id = 0; id < cells.length; id++) {
      const c = coverageCellColor(coverages[id], dim);
      const base = id * 12; // 3 verts × 4 components.
      for (let k = 0; k < 3; k++) {
        const o = base + k * 4;
        arr[o] = c.r;
        arr[o + 1] = c.g;
        arr[o + 2] = c.b;
        arr[o + 3] = c.a;
      }
    }
    this.colorAttr.needsUpdate = true;
  }

  /** Show/hide the shell (drives `mesh.visible`); returns the new visibility. */
  setVisible(on: boolean): boolean {
    this.visible = on;
    this.mesh.visible = on;
    return on;
  }
}
