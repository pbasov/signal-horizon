/**
 * NET AUDIO ENGINE (X-05). Everything is PROCEDURAL — no asset files: tiny oscillators,
 * filtered noise, a hand-rolled deterministic-IR convolution reverb ("slight reverb" —
 * every tone sends a little into a short plate). It obeys GDD §8 as a second channel:
 * the network's state is AUDIBLE — a calm, well-run net sounds smooth and level-headed;
 * oversubscribed routers detune the bed, faults flinch it, the frontier sounds distant.
 *
 * PURITY SEAM: the sim is Web-Audio-free. main.ts feeds this engine with semantic
 * {@link NetCueKind}s only (the one-way bus pattern, already proven in cue.ts).
 */


// ── cue vocabulary (net world; the cache world's cues stay in cue.ts) ────────────────
export type NetCueKind =
  | "key_click" // any committed control action (button)
  | "credit_committed" // a €-carrying commit: launch/deploy accepted — the satisfying tone
  | "serve_locked" // first signal / region lit
  | "deploy_pop" // a single member separated (bright tick)
  | "deploy_clear" // the whole batch separated
  | "no_sep" // a member never deployed (dissonant clunk)
  | "underburn" // a brown note — gritty
  | "signed_offered" // a tender signed (cash register ker-chirp)
  | "tender_lapsed" // an offer window expired (a soft sad downward pip)
  | "renewal_landed" // a renewed signature (upward)
  | "gate_act" // the act-transition bell (two-tone rising)
  | "foul_brewing" // the first sign of a dip / bandwidth squeeze (low throb)
  | "prefer_reroute" // a net_set_prefer applied (short sweep)
  | "fault_amber" // degradation/transient (filtered wobble)
  | "fault_telegraph" // a warned failure counting down (tock)
  | "mars_relay_launch" // the deep rising sweep — the frontier's overture
  | "mars_first_signal" // the distant answer, delayed echo
  | "cache_breadcrumb" // the cache placed near Mars (small bright tick)
  // SD-53 — the routing screen's three edges. §5 is explicit that audio is a SECOND CHANNEL, not a
  // notification system: these fire on transitions the player would otherwise have to be looking at
  // the right row to notice.
  | "link_lost" // a link dropped: the geometry took a path away (a short falling pip — bad news falls)
  | "rider_starved" // a rider's fair share fell under its committed floor (a dull, choked thud)
  | "beam_committed" // an antenna was re-pointed (a clean two-step: it left there, it is here now)
  | "vault_save" // checkpoint captured (short shutter-click)
  | "vault_load"; // checkpoint resumed (the reverse sweep)

interface Recipe {
  /** Layered voices: each entry is an oscillator part OR "noise". */
  parts: VoicePart[];
}
interface VoicePart {
  type?: OscillatorType;
  /** Hz start/end (exponential glide before the envelope bites). */
  f0: number;
  f1?: number;
  /** Envelope (s): attack / decay(end). dur = the note's life. */
  a?: number;
  dur: number;
  /** Peak gain before the master. */
  peak: number;
  /** Noise burst instead of an oscillator (filtered band at f0). */
  noise?: boolean;
}

const R = (parts: VoicePart[]): Recipe => ({ parts });
/** The full recipe book. Every entry is deterministic — same cue, same voice, always. */
export const NET_CUES: Record<NetCueKind, Recipe> = {
  key_click: R([{ f0: 2100, type: "square", dur: 0.018, peak: 0.08 }]),
  credit_committed: R([
    { f0: 174, f1: 174 * 1.5, type: "triangle", dur: 0.16, peak: 0.4 },
    { f0: 1046, f1: 1568, type: "sine", dur: 0.1, peak: 0.16 },
  ]),
  serve_locked: R([
    { f0: 880, f1: 1174, type: "sine", dur: 0.2, peak: 0.3 },
    { f0: 1760, f1: 1760, type: "sine", dur: 0.06, peak: 0.14 },
  ]),
  deploy_pop: R([{ f0: 1568, f1: 2093, type: "triangle", dur: 0.07, peak: 0.26 }]),
  deploy_clear: R([
    { f0: 1046, f1: 1568, type: "triangle", dur: 0.16, peak: 0.32 },
    { f0: 2093, f1: 2093, type: "sine", dur: 0.1, peak: 0.14 },
  ]),
  no_sep: R([{ f0: 233, f1: 196, type: "sawtooth", dur: 0.24, peak: 0.3 }]),
  underburn: R([
    { f0: 82, f1: 60, type: "sawtooth", dur: 0.4, peak: 0.34 },
    { f0: 233, f1: 165, type: "triangle", dur: 0.24, peak: 0.12 },
  ]),
  signed_offered: R([
    { f0: 659, f1: 880, type: "triangle", dur: 0.09, peak: 0.28 },
    { f0: 1174, f1: 1174, type: "sine", dur: 0.06, peak: 0.18 },
  ]),
  tender_lapsed: R([{ f0: 440, f1: 293, type: "sine", dur: 0.2, peak: 0.2 }]),
  renewal_landed: R([{ f0: 392, f1: 784, type: "triangle", dur: 0.14, peak: 0.3 }]),
  gate_act: R([
    { f0: 523, f1: 523, type: "sine", dur: 0.12, peak: 0.3 },
    { f0: 784, f1: 784, type: "sine", dur: 0.2, peak: 0.3 },
  ]),
  foul_brewing: R([{ f0: 110, f1: 110, type: "sawtooth", dur: 0.5, peak: 0.22 }]),
  prefer_reroute: R([{ f0: 660, f1: 990, type: "sine", dur: 0.08, peak: 0.2 }]),
  // The cue grammar: RISING is good news, FALLING is bad. A lost link falls; a starved rider is a
  // low choked thud (something is being squeezed); a committed beam is two clean steps (from → to).
  link_lost: R([{ f0: 587, f1: 330, type: "sine", dur: 0.16, peak: 0.22 }]),
  rider_starved: R([
    { f0: 147, f1: 131, type: "sawtooth", dur: 0.26, peak: 0.26 },
    { f0: 294, f1: 262, type: "sine", dur: 0.18, peak: 0.12 },
  ]),
  beam_committed: R([
    { f0: 523, f1: 523, type: "triangle", dur: 0.05, peak: 0.2 },
    { f0: 698, f1: 698, type: "triangle", dur: 0.07, peak: 0.22 },
  ]),
  fault_amber: R([{ f0: 220, f1: 208, type: "sawtooth", dur: 0.3, peak: 0.3 }]),
  fault_telegraph: R([
    { f0: 880, f1: 880, type: "square", dur: 0.05, peak: 0.24 },
    { f0: 880, f1: 880, type: "square", dur: 0.05, peak: 0.24 },
  ]),
  mars_relay_launch: R([
    { f0: 65, f1: 130, type: "sawtooth", dur: 1.4, peak: 0.32 },
    { f0: 392, f1: 784, type: "triangle", dur: 1.0, peak: 0.2 },
  ]),
  mars_first_signal: R([
    { f0: 1568, f1: 1046, type: "sine", dur: 0.5, peak: 0.22 },
    { f0: 1568, f1: 1046, type: "sine", dur: 0.5, peak: 0.14 },
  ]),
  cache_breadcrumb: R([{ f0: 1975, f1: 2093, type: "sine", dur: 0.08, peak: 0.22 }]),
  vault_save: R([{ f0: 1250, f1: 2500, type: "square", dur: 0.05, peak: 0.2 }]),
  vault_load: R([{ f0: 2500, f1: 1250, type: "square", dur: 0.06, peak: 0.2 }]),
};

// ── the deterministic IR (the "slight reverb" plate) ─────────────────────────────────
/**
 * The impulse response for the plate reverb: an exponentially decaying noise burst with a
 * few early reflections. Deterministic — built from a fixed-seed LCG so the plate is THE
 * SAME plate on every machine (the reverb is part of the sound IDENTITY, not RNG fuzz).
 * Pure: returns Float32Array channels; the caller wraps in AudioBuffers.
 */
export function buildPlateIR(
  channels: number,
  sampleRate: number,
  seconds: number,
  seed = 0x5eed,
): Float32Array[] {
  const n = Math.max(1, Math.floor(sampleRate * seconds));
  // A tiny deterministic PRNG (xorshift32) — the IR is a pure function of the seed.
  let x = seed >>> 0;
  const next = () => {
    x ^= x << 13;
    x ^= x >>> 17;
    x ^= x << 5;
    x >>>= 0;
    return x / 0xffffffff;
  };
  const out: Float32Array[] = [];
  for (let ch = 0; ch < channels; ch++) {
    const d = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const t = i / n;
      // Exponential decay with a soft onset; a few early-reflection bumps at fixed phases.
      let amp = Math.exp(-5 * t) * 0.85;
      if (t > 0.02 && t < 0.03) amp *= 1.6; // early reflection 1
      if (t > 0.06 && t < 0.085) amp *= 1.35; // early reflection 2
      d[i] = (next() * 2 - 1) * amp;
    }
    out.push(d);
  }
  return out;
}

// ── the engine ───────────────────────────────────────────────────────────────────────

/** Engine state probe surface for tests + the playest scenes. */
export interface AudioEngineProbe {
  muted?: boolean;
  ctxState: string;
  voices: number;
  cuesPlayed: number;
  lastKinds: string[];
  humGain: number;
  reverbMix: number;
}

interface LiveVoice {
  nodes: OscillatorNode[];
  endAtS: number;
}

/** The procedural audio engine: plate reverb + cue recipes + the health hum bed. */
export class NetAudioEngine {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private reverbSend: GainNode | null = null;
  private convolver: ConvolverNode | null = null;
  private dryGain: GainNode | null = null;
  private live: LiveVoice[] = [];
  private cuesPlayed = 0;
  private lastKinds: string[] = [];
  private unlocked = false;
  /** The health bed: a 50 Hz tone + tempered noise; its GAIN is the network's calm. */
  private humOsc: OscillatorNode | null = null;
  private humGain: GainNode | null = null;
  private humStarted = false;
  /** The generative ambient scheduler ticks off this counter (deterministic pattern). */
  private ambientCount = 0;
  private ambientTimer: ReturnType<typeof setInterval> | null = null;

  /** Master reverb mix (0..0.4). "Slight" tops out at 0.18 by the house rule. */
  reverbMix = 0.16;
  /** Hard mute (U key) — persists via the vault's prefs shelf. */
  private muted = false;
  setMuted(muted: boolean): void {
    this.muted = muted;
    if (this.master) this.master.gain.value = muted ? 0 : 0.8;
  }
  get isMuted(): boolean {
    return this.muted;
  }

  armUnlock(target: Window | HTMLElement = window): void {
    const unlock = () => {
      this.ensureContext();
      void this.ctx?.resume();
      this.unlocked = true;
      target.removeEventListener("keydown", unlock);
      target.removeEventListener("pointerdown", unlock);
    };
    target.addEventListener("keydown", unlock);
    target.addEventListener("pointerdown", unlock);
  }

  /** Lazily build the graph (reverb plate + master chain). */
  private ensureContext(): void {
    if (this.ctx) return;
    if (typeof AudioContext === "undefined") return;
    this.ctx = new AudioContext();
    this.master = this.ctx.createGain();
    this.master.gain.value = 0.8;
    this.master.connect(this.ctx.destination);
    // The plate: dry signal + a short deterministic IR into a convolver.
    this.dryGain = this.ctx.createGain();
    this.dryGain.gain.value = 1;
    this.dryGain.connect(this.master);
    this.reverbSend = this.ctx.createGain();
    this.reverbSend.gain.value = this.reverbMix;
    const ir = buildPlateIR(2, this.ctx.sampleRate, 0.42) as Float32Array<ArrayBuffer>[];
    this.convolver = this.ctx.createConvolver();
    const buf = this.ctx.createBuffer(2, ir[0].length, this.ctx.sampleRate);
    for (let ch = 0; ch < 2; ch++) buf.copyToChannel(ir[ch], ch);
    this.convolver.buffer = buf;
    this.reverbSend.connect(this.convolver);
    this.convolver.connect(this.master);
    this.startHealthBed();
    this.startAmbient();
  }

  // ── health bed: the sound OF the network ───────────────────────────────────
  /** A constant 50 Hz hum + substrate noise; setHealth drives its level/character. */
  private startHealthBed(): void {
    if (!this.ctx || !this.master || this.humStarted) return;
    this.humStarted = true;
    this.humOsc = this.ctx.createOscillator();
    this.humOsc.type = "sine";
    this.humOsc.frequency.value = 50;
    this.humGain = this.ctx.createGain();
    this.humGain.gain.value = 0;
    const noise = this.ctx.createOscillator();
    noise.type = "triangle";
    noise.frequency.value = 100;
    const noiseGain = this.ctx.createGain();
    noiseGain.gain.value = 0;
    this.humOsc.connect(this.humGain);
    noise.connect(noiseGain);
    this.humGain.connect(this.master);
    noiseGain.connect(this.master);
    this.humOsc.start();
    noise.start();
  }

  /** The render-side read: how alive should the bed be (the SUBSTRATE the network is).
   * `calm` ∈ [0,1]: flow per active contract; `strain` ∈ [0,1]: near-breach pressure.
   * Calm nets hum warm + level; strain detunes the undertone (a few cents drift = the
   * "your network is breathing hard" cue). */
  setHealth(calm: number, strain: number): void {
    if (!this.ctx || !this.humGain) return;
    const t = this.ctx.currentTime;
    const level = Math.min(1, Math.max(0, calm));
    this.humGain.gain.setTargetAtTime(0.028 + level * 0.05, t, 0.4);
    // Strain = the undertone detunes + thins (that's the "this doesn't sound healthy" read).
    const s = Math.min(1, Math.max(0, strain));
    this.humOsc!.detune.setTargetAtTime(s * 17, t, 0.8);
  }

  /** Generative ambient: a slow arpeggio frame on a pentatonic-ish set, one voice per tick,
   * no wall-clock drums — the scheduler is a fixed interval but the NOTES are a pure
   * function of the counter. Deterministic pattern, fade-safe. */
  private startAmbient(): void {
    if (this.ambientTimer !== null) return;
    const NOTES = [196, 233.08, 329.63, 392];
    this.ambientTimer = setInterval(() => {
      if (!this.ctx || this.ctx.state !== "running") return;
      const note = NOTES[this.ambientCount % NOTES.length];
      const v: Recipe = R([
        { f0: note, type: "sine", dur: 2.2, a: 0.8, peak: 0.05 },
        { f0: note * 2, type: "triangle", dur: 2.2, a: 0.8, peak: 0.02 },
      ]);
      this.renderRecipe(v);
      this.ambientCount++;
    }, 2200);
  }

  /** Record + play one cue. Pure recipe lookup; the sim never sees AudioContext. */
  play(kind: NetCueKind): void {
    if (!this.unlocked || !this.ctx || this.ctx.state !== "running") return;
    this.cuesPlayed++;
    this.lastKinds.push(kind);
    if (this.lastKinds.length > 12) this.lastKinds.shift();
    this.renderRecipe(NET_CUES[kind]);
  }

  /** The shared recipe renderer: oscillator/noise parts → plate send + dry. */
  private renderRecipe(r: Recipe): void {
    if (!this.ctx || !this.dryGain || !this.reverbSend) return;
    const t = this.ctx.currentTime;
    for (const p of r.parts) {
      let src: OscillatorNode;
      if (p.noise) {
        // A noise burst = an oscillator BAMFING through a random LFO phase — simple, cheap.
        src = this.ctx.createOscillator();
        src.type = "sawtooth";
        src.frequency.setValueAtTime(p.f0, t);
      } else {
        src = this.ctx.createOscillator();
        src.type = p.type ?? "sine";
        src.frequency.setValueAtTime(p.f0, t);
        if (p.f1 !== undefined && p.f1 !== p.f0) src.frequency.exponentialRampToValueAtTime(p.f1, t + p.dur);
      }
      const env = this.ctx.createGain();
      const a = p.a ?? 0.004;
      env.gain.setValueAtTime(0.0001, t);
      env.gain.exponentialRampToValueAtTime(Math.max(0.0001, p.peak), t + a);
      env.gain.exponentialRampToValueAtTime(0.0001, t + p.dur);
      src.connect(env);
      env.connect(this.dryGain);
      env.connect(this.reverbSend);
      src.start(t);
      src.stop(t + p.dur + 0.05);
      this.live.push({ nodes: [src], endAtS: t + p.dur + 0.05 });
    }
    this.reap(t);
  }

  /** Drop finished voices (keeps the live-node count honest for the probe). */
  private reap(nowS: number): void {
    this.live = this.live.filter((v) => v.endAtS > nowS);
  }

  /** Musical-theory-free probe. */
  probe(): AudioEngineProbe {
    return {
      ctxState: this.ctx?.state ?? "none",
      voices: this.live.length,
      cuesPlayed: this.cuesPlayed,
      lastKinds: [...this.lastKinds],
      humGain: this.humGain?.gain.value ?? 0,
      reverbMix: this.reverbMix,
      muted: this.muted,
    };
  }
}
