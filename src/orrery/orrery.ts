/**
 * Three.js orrery — the make-or-break view. Reproduces the design intent of the
 * Godot render/Orrery.cs:
 *   - FLOATING ORIGIN: positions come from the f64 ephemeris in metres; we
 *     subtract the f64 focus-body position BEFORE casting to f32 scene units, so
 *     precision survives at solar-system scale (mirrors FloatingOrigin.ToRender).
 *   - PER-PRESET LOG COMPRESSION: a visual radial fold (logScale·ln(1+d/logK))
 *     applied AFTER rebase so LEO/GEO rings and the Earth↔Mars span both read in
 *     one shot. It never feeds back into distance / light-delay math.
 *   - CONSTANT-SCREEN-SIZE dithered billboards (Bayer 4×4 terminator stipple).
 *   - DASHED orbit rings sampled from the real ephemeris.
 *   - A packet crawling Earth→Mars at honest light speed on SIM time, its colour
 *     desaturating toward machine-grey as freshness drains.
 *   - A BODY-ANCHORED orbit camera (drag az/el, wheel zoom) with four curated,
 *     smoothly-animated presets and an R reset.
 */
import * as THREE from "three";
import type { Ephemeris, Vec3 } from "../sim/ephemeris";

const DEG = Math.PI / 180;

export interface CameraPreset {
  name: string;
  focus: string;
  az: number;
  el: number;
  dist: number;
  fov: number;
  /** compression knee (metres) */
  logK: number;
  /** compression gain (scene units) */
  logScale: number;
}

export const CAMERA_PRESETS: CameraPreset[] = [
  { name: "CISLUNAR", focus: "earth", az: 0 * DEG, el: 22 * DEG, dist: 3.2, fov: 50, logK: 2.0e8, logScale: 1.4 },
  { name: "ORBITS", focus: "earth", az: 35 * DEG, el: 30 * DEG, dist: 5.0, fov: 46, logK: 9.0e6, logScale: 1.15 },
  { name: "SYSTEM", focus: "sun", az: 0 * DEG, el: 24 * DEG, dist: 11, fov: 50, logK: 9.0e10, logScale: 3.6 },
  { name: "TOP-DOWN", focus: "sun", az: 0 * DEG, el: 88 * DEG, dist: 13, fov: 46, logK: 9.0e10, logScale: 3.6 },
];

export interface PacketRenderState {
  fromId: string;
  toId: string;
  progress: number;
  freshness: number;
}

export interface OrreryCtx {
  eph: Ephemeris;
  now(): number;
  packet(): PacketRenderState | null;
}

interface BodySpec {
  id: string;
  px: number;
  color: [number, number, number];
  terminator: boolean;
  glow: boolean;
}

const BODIES: BodySpec[] = [
  { id: "sun", px: 58, color: [1.0, 0.93, 0.8], terminator: false, glow: true },
  { id: "earth", px: 40, color: [0.84, 0.88, 0.98], terminator: true, glow: false },
  { id: "mars", px: 28, color: [0.96, 0.82, 0.74], terminator: true, glow: false },
  { id: "moon", px: 16, color: [0.82, 0.82, 0.88], terminator: true, glow: false },
  { id: "sat_leo", px: 9, color: [1.0, 0.62, 0.18], terminator: false, glow: false },
  { id: "sat_geo", px: 9, color: [1.0, 0.62, 0.18], terminator: false, glow: false },
];

const RING_IDS = ["earth", "mars", "moon", "sat_leo", "sat_geo"];
const RING_SAMPLES = 180;
const FOCUS_ORDER = ["sun", "earth", "mars", "moon"];

const VERT = /* glsl */ `
  out vec2 vUv;
  void main() {
    vUv = uv;
    gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
  }
`;

const FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform vec3 uSunDirView;
  uniform float uTerminator;
  uniform float uCell;
  in vec2 vUv;
  out vec4 fragColor;
  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    vec3 N = vec3(p.x, p.y, sqrt(max(0.0, 1.0 - r * r)));
    float lambert = mix(1.0, clamp(dot(N, normalize(uSunDirView)), 0.0, 1.0), uTerminator);
    float bright = mix(0.10, 0.95, lambert);
    bright = max(bright, smoothstep(0.90, 1.0, r) * lambert * 0.9); // sunlit limb rim
    ivec2 ip = ivec2(mod(gl_FragCoord.xy / uCell, 4.0));
    float threshold = (BAYER[ip.y * 4 + ip.x] + 0.5) / 16.0;
    if (bright < threshold) discard;
    fragColor = vec4(uColor, 1.0);
  }
`;

const HALO_FRAG = /* glsl */ `
  precision highp float;
  uniform vec3 uColor;
  uniform float uCell;
  in vec2 vUv;
  out vec4 fragColor;
  const float BAYER[16] = float[16](
    0.0, 8.0, 2.0, 10.0,
    12.0, 4.0, 14.0, 6.0,
    3.0, 11.0, 1.0, 9.0,
    15.0, 7.0, 13.0, 5.0
  );
  void main() {
    vec2 p = vUv * 2.0 - 1.0;
    float r = length(p);
    if (r > 1.0) discard;
    float bright = pow(max(0.0, 1.0 - r), 2.2);
    ivec2 ip = ivec2(mod(gl_FragCoord.xy / uCell, 4.0));
    float threshold = (BAYER[ip.y * 4 + ip.x] + 0.5) / 16.0;
    if (bright < threshold) discard;
    fragColor = vec4(uColor, 1.0);
  }
`;

interface Frame {
  az: number;
  el: number;
  dist: number;
  fov: number;
  logK: number;
  logScale: number;
}

export class Orrery {
  readonly host: HTMLElement;
  private canvas: HTMLCanvasElement;
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private w = 1;
  private h = 1;

  private cur: Frame;
  private tgt: Frame;
  focusId: string;
  private activePreset = 2; // SYSTEM — the Earth→Mars money shot

  private bodyMeshes = new Map<string, THREE.Mesh>();
  private haloMesh?: THREE.Mesh;
  private rings = new Map<string, { line: THREE.LineSegments; rel: Vec3[] }>();
  private packetMesh: THREE.Mesh;
  private linkLine: THREE.LineSegments;
  private labels = new Map<string, HTMLElement>();
  private labelLayer: HTMLElement;

  private quad = new THREE.PlaneGeometry(1, 1);
  private tmpV = new THREE.Vector3();
  // scratch reused every frame — the hot loop allocates no new Vector3/Color
  private _rp = new THREE.Vector3();
  private _rp2 = new THREE.Vector3();
  private _earthR = new THREE.Vector3();
  private _marsR = new THREE.Vector3();
  private _sunDir = new THREE.Vector3();
  private readonly _amber = new THREE.Color(1.0, 0.62, 0.18);
  private readonly _grey = new THREE.Color(0.36, 0.36, 0.4);
  private readonly _pkColor = new THREE.Color();
  private dragging = false;
  private lastPtr = { x: 0, y: 0 };

  constructor(private ctx: OrreryCtx) {
    this.host = document.createElement("div");
    this.host.className = "orrery-host";
    this.canvas = document.createElement("canvas");
    this.host.appendChild(this.canvas);

    this.labelLayer = document.createElement("div");
    this.labelLayer.className = "orrery-overlay";
    this.host.appendChild(this.labelLayer);
    this.buildOverlayCorners();

    this.renderer = new THREE.WebGLRenderer({ canvas: this.canvas, antialias: true, alpha: false });
    this.renderer.setClearColor(0x0b0b12, 1);
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));

    const p = CAMERA_PRESETS[this.activePreset];
    this.focusId = p.focus;
    this.cur = { az: p.az, el: p.el, dist: p.dist, fov: p.fov, logK: p.logK, logScale: p.logScale };
    this.tgt = { ...this.cur };
    this.camera = new THREE.PerspectiveCamera(p.fov, 1, 0.001, 100000);

    this.buildBodies();
    this.buildRings();
    this.packetMesh = this.buildSignalDisc([1.0, 0.62, 0.18]);
    this.scene.add(this.packetMesh);
    this.linkLine = this.buildLink();
    this.scene.add(this.linkLine);

    this.attachInput();
  }

  // --- construction helpers ------------------------------------------------
  private bodyMaterial(spec: BodySpec): THREE.ShaderMaterial {
    return new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(...spec.color) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uTerminator: { value: spec.terminator ? 1 : 0 },
        uCell: { value: 2.0 },
      },
    });
  }

  private buildSignalDisc(color: [number, number, number]): THREE.Mesh {
    const mat = new THREE.ShaderMaterial({
      glslVersion: THREE.GLSL3,
      vertexShader: VERT,
      fragmentShader: FRAG,
      transparent: true,
      depthWrite: false,
      uniforms: {
        uColor: { value: new THREE.Color(...color) },
        uSunDirView: { value: new THREE.Vector3(0, 0, 1) },
        uTerminator: { value: 0 },
        uCell: { value: 2.0 },
      },
    });
    return new THREE.Mesh(this.quad, mat);
  }

  private buildBodies(): void {
    for (const spec of BODIES) {
      const mesh = new THREE.Mesh(this.quad, this.bodyMaterial(spec));
      mesh.renderOrder = 10;
      this.scene.add(mesh);
      this.bodyMeshes.set(spec.id, mesh);
      if (spec.glow) {
        const halo = new THREE.Mesh(
          this.quad,
          new THREE.ShaderMaterial({
            glslVersion: THREE.GLSL3,
            vertexShader: VERT,
            fragmentShader: HALO_FRAG,
            transparent: true,
            depthWrite: false,
            blending: THREE.AdditiveBlending,
            uniforms: {
              uColor: { value: new THREE.Color(...spec.color) },
              uCell: { value: 3.0 },
            },
          }),
        );
        halo.renderOrder = 9;
        this.scene.add(halo);
        this.haloMesh = halo;
      }
    }
  }

  private buildRings(): void {
    for (const id of RING_IDS) {
      const rel = this.ctx.eph.sampleRelativeOrbit(id, RING_SAMPLES);
      if (!rel.length) continue;
      // dashed: keep only every other segment (i even)
      const segCount = Math.floor(RING_SAMPLES / 2);
      const positions = new Float32Array(segCount * 2 * 3);
      const geo = new THREE.BufferGeometry();
      geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
      const isSat = id.startsWith("sat_");
      const mat = new THREE.LineBasicMaterial({
        color: isSat ? 0xff9e2e : 0xcfcfdb,
        transparent: true,
        opacity: isSat ? 0.55 : 0.42,
      });
      const line = new THREE.LineSegments(geo, mat);
      line.frustumCulled = false;
      this.scene.add(line);
      this.rings.set(id, { line, rel });
    }
  }

  private buildLink(): THREE.LineSegments {
    // Earth↔Mars link as a dashed amber segment set (recomputed each frame).
    const dashes = 22;
    const positions = new Float32Array(dashes * 2 * 3);
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(positions, 3));
    const mat = new THREE.LineBasicMaterial({ color: 0xff9e2e, transparent: true, opacity: 0.5 });
    const line = new THREE.LineSegments(geo, mat);
    line.frustumCulled = false;
    return line;
  }

  private buildOverlayCorners(): void {
    for (const cls of ["tl", "tr", "bl", "br"]) {
      const c = document.createElement("div");
      c.className = `corner ${cls}`;
      c.dataset.k = cls;
      this.labelLayer.appendChild(c);
    }
  }

  // --- public control ------------------------------------------------------
  setPreset(i: number): void {
    if (i < 0 || i >= CAMERA_PRESETS.length) return;
    this.activePreset = i;
    const p = CAMERA_PRESETS[i];
    this.focusId = p.focus;
    this.tgt = { az: p.az, el: p.el, dist: p.dist, fov: p.fov, logK: p.logK, logScale: p.logScale };
  }

  resetCamera(): void {
    this.setPreset(this.activePreset);
  }

  cycleFocus(dir: number): void {
    const i = FOCUS_ORDER.indexOf(this.focusId);
    this.focusId = FOCUS_ORDER[(i + dir + FOCUS_ORDER.length) % FOCUS_ORDER.length];
  }

  presetName(): string {
    return CAMERA_PRESETS[this.activePreset].name;
  }

  subtitle(): string {
    return `${this.presetName()} · ${this.focusId}`;
  }

  resize(w: number, h: number): void {
    if (w <= 0 || h <= 0) return;
    this.w = w;
    this.h = h;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  // --- per-frame -----------------------------------------------------------
  update(dtWall: number): void {
    const k = 1 - Math.exp(-Math.min(dtWall, 0.05) * 9);
    this.cur.az += (this.tgt.az - this.cur.az) * k;
    this.cur.el += (this.tgt.el - this.cur.el) * k;
    this.cur.dist += (this.tgt.dist - this.cur.dist) * k;
    this.cur.fov += (this.tgt.fov - this.cur.fov) * k;
    this.cur.logK += (this.tgt.logK - this.cur.logK) * k;
    this.cur.logScale += (this.tgt.logScale - this.cur.logScale) * k;
    this.applyCamera();

    const t = this.ctx.now();
    const focusAbs = this.ctx.eph.position(this.focusId, t);
    const sunAbs = this.ctx.eph.position("sun", t);

    // bodies
    const worldPerPx = (2 * Math.tan((this.cur.fov * DEG) / 2)) / this.h;
    for (const spec of BODIES) {
      const mesh = this.bodyMeshes.get(spec.id)!;
      const absBody = this.ctx.eph.position(spec.id, t);
      this.renderInto(this._rp, absBody, focusAbs);
      mesh.position.copy(this._rp);
      this.sizeBillboard(mesh, spec.px, worldPerPx);
      if (spec.terminator) {
        // Sun direction from UNCOMPRESSED physical positions — the log-fold is a
        // per-point radial scale and would skew the terminator for off-focus bodies.
        this._sunDir
          .set(sunAbs[0] - absBody[0], sunAbs[2] - absBody[2], -(sunAbs[1] - absBody[1]))
          .normalize()
          .transformDirection(this.camera.matrixWorldInverse);
        (mesh.material as THREE.ShaderMaterial).uniforms.uSunDirView.value.copy(this._sunDir);
      }
      if (spec.glow && this.haloMesh) {
        this.haloMesh.position.copy(this._rp);
        this.sizeBillboard(this.haloMesh, spec.px * 2.8, worldPerPx);
      }
    }

    // rings — write straight into the Float32Array, zero Vector3 per point
    for (const [id, ring] of this.rings) {
      const parent = this.ctx.eph.parentOf(id);
      const parentAbs = this.ctx.eph.position(parent, t);
      const pos = ring.line.geometry.getAttribute("position") as THREE.BufferAttribute;
      const arr = pos.array as Float32Array;
      let w = 0;
      for (let i = 0; i < RING_SAMPLES; i += 2) {
        const a = ring.rel[i];
        const b = ring.rel[(i + 1) % RING_SAMPLES];
        w = this.writeRenderPoint(arr, w, parentAbs[0] + a[0], parentAbs[1] + a[1], parentAbs[2] + a[2], focusAbs);
        w = this.writeRenderPoint(arr, w, parentAbs[0] + b[0], parentAbs[1] + b[1], parentAbs[2] + b[2], focusAbs);
      }
      pos.needsUpdate = true;
    }

    // packet + link
    this.updatePacketAndLink(t, focusAbs, worldPerPx);

    this.renderer.render(this.scene, this.camera);
    this.updateLabels(t, focusAbs);
    this.updateCorners();
  }

  private updatePacketAndLink(t: number, focusAbs: Vec3, worldPerPx: number): void {
    this.renderInto(this._earthR, this.ctx.eph.position("earth", t), focusAbs);
    this.renderInto(this._marsR, this.ctx.eph.position("mars", t), focusAbs);
    const ex = this._earthR.x, ey = this._earthR.y, ez = this._earthR.z;
    const mx = this._marsR.x, my = this._marsR.y, mz = this._marsR.z;

    const pos = this.linkLine.geometry.getAttribute("position") as THREE.BufferAttribute;
    const arr = pos.array as Float32Array;
    const dashes = arr.length / 6;
    let w = 0;
    for (let d = 0; d < dashes; d++) {
      const t0 = d / dashes;
      const t1 = t0 + 0.5 / dashes; // half-on dash
      arr[w++] = ex + (mx - ex) * t0; arr[w++] = ey + (my - ey) * t0; arr[w++] = ez + (mz - ez) * t0;
      arr[w++] = ex + (mx - ex) * t1; arr[w++] = ey + (my - ey) * t1; arr[w++] = ez + (mz - ez) * t1;
    }
    pos.needsUpdate = true;

    const pk = this.ctx.packet();
    if (pk) {
      const from = pk.fromId === "earth" ? this._earthR : this.renderInto(this._rp, this.ctx.eph.position(pk.fromId, t), focusAbs);
      const to = pk.toId === "mars" ? this._marsR : this.renderInto(this._rp2, this.ctx.eph.position(pk.toId, t), focusAbs);
      this.packetMesh.visible = true;
      this.packetMesh.position.copy(this.tmpV.copy(from).lerp(to, pk.progress));
      this.sizeBillboard(this.packetMesh, 13, worldPerPx);
      // freshness-as-saturation: amber → machine-grey
      this._pkColor.copy(this._grey).lerp(this._amber, pk.freshness);
      (this.packetMesh.material as THREE.ShaderMaterial).uniforms.uColor.value.copy(this._pkColor);
    } else {
      this.packetMesh.visible = false;
    }
  }

  private sizeBillboard(mesh: THREE.Mesh, px: number, worldPerPx: number): void {
    const dist = this.camera.position.distanceTo(mesh.position);
    const size = px * worldPerPx * dist;
    mesh.scale.set(size, size, 1);
    mesh.quaternion.copy(this.camera.quaternion);
  }

  /** focus-relative log-compression scale (scene units per metre) for distance d. */
  private compressScale(d: number): number {
    return d > 0 ? (this.cur.logScale * Math.log(1 + d / this.cur.logK)) / d : 0;
  }

  /** Floating-origin rebase (f64 m) → log-compress → ecliptic→three, written into `out`. */
  private renderInto(out: THREE.Vector3, abs: Vec3, focusAbs: Vec3): THREE.Vector3 {
    const fx = abs[0] - focusAbs[0];
    const fy = abs[1] - focusAbs[1];
    const fz = abs[2] - focusAbs[2];
    const s = this.compressScale(Math.sqrt(fx * fx + fy * fy + fz * fz));
    // ecliptic (x, y, z=north) → three (x, up=z, -y)
    return out.set(fx * s, fz * s, -fy * s);
  }

  /** Same transform written straight into a Float32Array at offset `w`; returns the new offset. */
  private writeRenderPoint(arr: Float32Array, w: number, ax: number, ay: number, az: number, focusAbs: Vec3): number {
    const fx = ax - focusAbs[0];
    const fy = ay - focusAbs[1];
    const fz = az - focusAbs[2];
    const s = this.compressScale(Math.sqrt(fx * fx + fy * fy + fz * fz));
    arr[w++] = fx * s;
    arr[w++] = fz * s;
    arr[w++] = -fy * s;
    return w;
  }

  private applyCamera(): void {
    const el = Math.max(-88 * DEG, Math.min(88 * DEG, this.cur.el));
    const ce = Math.cos(el);
    this.camera.position.set(
      this.cur.dist * ce * Math.sin(this.cur.az),
      this.cur.dist * Math.sin(el),
      this.cur.dist * ce * Math.cos(this.cur.az),
    );
    this.camera.up.set(0, 1, 0);
    this.camera.lookAt(0, 0, 0);
    if (Math.abs(this.camera.fov - this.cur.fov) > 1e-3) {
      this.camera.fov = this.cur.fov;
      this.camera.updateProjectionMatrix();
    }
    this.camera.updateMatrixWorld();
  }

  private labelFor(id: string): HTMLElement {
    let el = this.labels.get(id);
    if (!el) {
      el = document.createElement("div");
      el.style.position = "absolute";
      el.style.font = "10px var(--mono)";
      el.style.color = "var(--fg-dim)";
      el.style.letterSpacing = "0.08em";
      el.style.transform = "translate(0, -50%)";
      el.style.whiteSpace = "nowrap";
      this.labelLayer.appendChild(el);
      this.labels.set(id, el);
    }
    return el;
  }

  private updateLabels(t: number, focusAbs: Vec3): void {
    const showSats = this.presetName() === "ORBITS" || this.presetName() === "CISLUNAR";
    for (const spec of BODIES) {
      const isSat = spec.id.startsWith("sat_");
      const el = this.labelFor(spec.id);
      if (isSat && !showSats) {
        el.style.display = "none";
        continue;
      }
      this.renderInto(this._rp, this.ctx.eph.position(spec.id, t), focusAbs);
      this.tmpV.copy(this._rp).project(this.camera);
      if (this.tmpV.z > 1 || this.tmpV.z < -1) {
        el.style.display = "none";
        continue;
      }
      const x = (this.tmpV.x * 0.5 + 0.5) * this.w;
      const y = (-this.tmpV.y * 0.5 + 0.5) * this.h;
      el.style.display = "block";
      el.style.left = `${x + spec.px * 0.5 + 5}px`; // sit just outside the disc edge
      el.style.top = `${y}px`;
      el.style.color = spec.id === this.focusId ? "var(--cyan)" : "var(--fg-dim)";
      el.textContent = spec.id.replace("sat_", "").toUpperCase();
    }
  }

  private updateCorners(): void {
    const set = (k: string, html: string) => {
      const el = this.labelLayer.querySelector(`.corner.${k}`) as HTMLElement;
      if (el) el.innerHTML = html;
    };
    set("tl", `<b>${this.presetName()}</b>\nfocus <span class="k">${this.focusId.toUpperCase()}</span>`);
    set("tr", `fov ${this.cur.fov.toFixed(0)}°\ndist ${this.cur.dist.toFixed(2)}`);
    set("bl", `drag orbit · wheel zoom`);
    set("br", `<span class="k">C O S T</span> presets · <span class="k">R</span> reset · <span class="k">F</span> focus`);
  }

  // --- input (body-anchored orbit) ----------------------------------------
  private attachInput(): void {
    this.canvas.addEventListener("pointerdown", (e) => {
      this.dragging = true;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.canvas.setPointerCapture(e.pointerId);
    });
    this.canvas.addEventListener("pointermove", (e) => {
      if (!this.dragging) return;
      const dx = e.clientX - this.lastPtr.x;
      const dy = e.clientY - this.lastPtr.y;
      this.lastPtr = { x: e.clientX, y: e.clientY };
      this.tgt.az -= dx * 0.006;
      this.tgt.el = Math.max(-88 * DEG, Math.min(88 * DEG, this.tgt.el + dy * 0.006));
    });
    const stop = (e: PointerEvent) => {
      this.dragging = false;
      try {
        this.canvas.releasePointerCapture(e.pointerId);
      } catch {
        /* ignore */
      }
    };
    this.canvas.addEventListener("pointerup", stop);
    this.canvas.addEventListener("pointercancel", stop);
    this.canvas.addEventListener(
      "wheel",
      (e) => {
        e.preventDefault();
        this.tgt.dist = Math.max(0.4, Math.min(60, this.tgt.dist * (1 + Math.sign(e.deltaY) * 0.08)));
      },
      { passive: false },
    );
  }
}
