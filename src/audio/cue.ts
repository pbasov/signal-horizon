/**
 * AUDIO CUE (M1-11, first audio) — "a cache hit is an audible event" (GDD §5/§8).
 *
 * Audio is a genuine SECOND information channel, not decoration: a well-run
 * network SOUNDS healthy and a staling one degrades perceptibly. This module is
 * the make-it-audible half of the E5 visualization pillar.
 *
 * ARCHITECTURE — a strict ONE-WAY event bus so the sim layer stays pure:
 *
 *   src/sim/* (pure) ──emit──▶ CueBus (a tiny queue, NO Web Audio) ──drain──▶ main.ts ──▶ AudioCue (Web Audio)
 *
 * The sim/Mission never touches the Web Audio API: it only pushes semantic
 * {@link CueEvent}s onto a {@link CueBus}. The frame loop in main.ts drains the
 * bus once per frame and forwards each event to {@link AudioCue.play}. That keeps
 * src/sim deterministic + DOM-free (and unit-testable in the node test env), and
 * confines all browser audio state to this presentation module — the same
 * sim→render seam the orrery already respects.
 *
 * AUTOPLAY POLICY: browsers refuse to start an AudioContext until a user gesture.
 * {@link AudioCue} therefore creates the context LAZILY and resumes it on the
 * first keydown/pointerdown; cues fired before the unlock are silently dropped
 * (never queued — stale beeps after a long pause would lie about live state).
 */

/** Semantic cue kinds the sim can emit. Kept tiny and presentation-agnostic. */
export type CueKind =
  /** A demand resolved from the local Mars cache — the satisfying HIT. */
  | "cache_hit"
  /** A fetch crossed the light-gap and landed fresh data in the Mars cache. */
  | "fetch_arrival"
  /** The cached copy decayed below the demand's min-acceptable (it went stale). */
  | "stale"
  /** The link is down with no usable cache — a blackout miss. */
  | "blackout"
  /** E8 — the autopilot fired a blackout PRE-STAGE (the tame-it lever acting). */
  | "prestage";

/** A single cue the sim emits and the audio sink renders. Plain data — no DOM. */
export interface CueEvent {
  kind: CueKind;
  /** Sim-seconds the triggering event occurred (for ordering / future use). */
  tSim: number;
}

/**
 * The one-way cue queue. The sim side {@link emit}s; the render side {@link drain}s
 * once per frame. Pure data — importing this pulls in NO Web Audio, so the sim
 * layer and the unit tests can use it without a browser.
 *
 * The queue is bounded: if the render loop stalls we keep only the most recent
 * {@link cap} events, because a cache-hit chirp is only meaningful when it lands
 * with the event — a backlog of stale beeps would mislead, not inform.
 */
export class CueBus {
  private q: CueEvent[] = [];

  constructor(private readonly cap = 32) {}

  /** Push a cue (sim side). Drops the oldest when the bus is saturated. */
  emit(kind: CueKind, tSim: number): void {
    this.q.push({ kind, tSim });
    if (this.q.length > this.cap) this.q.shift();
  }

  /** Number of queued cues not yet drained (for tests / diagnostics). */
  get pending(): number {
    return this.q.length;
  }

  /**
   * Hand every queued cue to `sink` in emit order and clear the queue. Returns
   * the count drained. The queue array is reused (length reset), so a steady
   * drain allocates nothing per frame after warm-up.
   */
  drain(sink: (e: CueEvent) => void): number {
    const n = this.q.length;
    for (let i = 0; i < n; i++) sink(this.q[i]);
    this.q.length = 0;
    return n;
  }
}

/**
 * The slice of demand state a cue transition reads. Kept structural (not the full
 * DemandReadout) so the sim layer can feed it without an audio import and so this
 * stays trivially unit-testable.
 */
export interface CueDemandSlice {
  /** A data-leg fetch is crawling Earth→Mars. */
  fetchInFlight: boolean;
  /** The latest serve came from the local Mars cache (a hit). */
  viaCache: boolean;
  /** Resolve outcome this step. */
  outcome: "fresh" | "stale" | "miss" | "blackout_miss";
}

/**
 * Derive the cue(s) to emit from one demand-state transition (prev → next),
 * pushing them onto `bus`. PURE of any audio device — this is the seam main.ts
 * runs each sim tick, keeping src/sim free of even the cue vocabulary.
 *
 * Edges fired (rising-edge only, so a steady state is silent):
 *  - fetch_arrival: a fetch was in flight last step and has now landed — the
 *    cache just refilled across the light-gap ("a cache hit is an audible event").
 *  - cache_hit: the serve transitioned INTO serving from cache (miss → hit).
 *  - stale: the served cache copy dropped from the fresh band into the stale band.
 *  - blackout: the link went down with no usable cache (entered blackout_miss).
 */
export function emitCueTransition(
  bus: CueBus,
  prev: CueDemandSlice | null,
  next: CueDemandSlice,
  tSim: number,
): void {
  if (prev && prev.fetchInFlight && !next.fetchInFlight) bus.emit("fetch_arrival", tSim);
  if (next.viaCache && (!prev || !prev.viaCache)) bus.emit("cache_hit", tSim);
  if (next.outcome === "stale" && (!prev || prev.outcome !== "stale")) bus.emit("stale", tSim);
  if (next.outcome === "blackout_miss" && (!prev || prev.outcome !== "blackout_miss"))
    bus.emit("blackout", tSim);
}

/** Tone recipe for one cue: a tiny synthesised blip. */
interface Tone {
  /** Start frequency (Hz). */
  f0: number;
  /** End frequency (Hz) for a glide; equals f0 for a flat tone. */
  f1: number;
  /** Oscillator shape. */
  type: OscillatorType;
  /** Envelope length (seconds). */
  dur: number;
  /** Peak gain (0..1) before the master gain. */
  peak: number;
}

/**
 * Per-cue tone recipes. The HIT is a bright, rising two-note "ping" (the
 * satisfying commit); arrivals share its timbre an octave down; staling/blackout
 * are darker, falling tones so the channel reads health BY EAR (CVD-irrelevant,
 * but the same redundant-encoding spirit — pitch direction encodes good/bad).
 */
const TONES: Record<CueKind, Tone> = {
  cache_hit: { f0: 880, f1: 1320, type: "triangle", dur: 0.12, peak: 0.5 },
  fetch_arrival: { f0: 523.25, f1: 783.99, type: "sine", dur: 0.16, peak: 0.45 },
  stale: { f0: 392, f1: 277.18, type: "sine", dur: 0.18, peak: 0.32 },
  blackout: { f0: 220, f1: 110, type: "sawtooth", dur: 0.3, peak: 0.4 },
  // E8 — a SUBTLE, confident rising blip when the autopilot pre-stages ahead of a
  // forecast blackout: quieter than a hit, a soft "I've got it" the player learns
  // to trust. Keeps the relief audible without nagging.
  prestage: { f0: 659.25, f1: 987.77, type: "sine", dur: 0.1, peak: 0.22 },
};

/**
 * Web Audio sink — lazily owns one AudioContext and renders {@link CueEvent}s as
 * short synthesised blips (no asset files: tiny + instant). All browser audio
 * state lives here; the sim never imports it.
 */
export class AudioCue {
  private ctx: AudioContext | null = null;
  private master: GainNode | null = null;
  private unlocked = false;
  /** Master volume (0..1). Cheap mute lever for a future settings toggle. */
  volume = 0.6;

  /**
   * Arm the gesture-unlock: the first keydown/pointerdown creates + resumes the
   * AudioContext (browsers block audio until then). Call once at boot.
   */
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

  /** Create the AudioContext + master gain on demand. Tolerates SSR/no-Audio. */
  private ensureContext(): void {
    if (this.ctx) return;
    const Ctor: typeof AudioContext | undefined =
      typeof AudioContext !== "undefined"
        ? AudioContext
        : (globalThis as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(this.ctx.destination);
  }

  /**
   * Render a cue as a short blip. A no-op until the context is unlocked by a
   * gesture (so we never violate autoplay policy and never emit a stale beep
   * after a long unfocused pause).
   */
  play(e: CueEvent): void {
    if (!this.unlocked || !this.ctx || !this.master) return;
    if (this.ctx.state !== "running") return;
    const t = this.ctx.currentTime;
    const spec = TONES[e.kind];
    const osc = this.ctx.createOscillator();
    const env = this.ctx.createGain();
    osc.type = spec.type;
    osc.frequency.setValueAtTime(spec.f0, t);
    if (spec.f1 !== spec.f0) osc.frequency.exponentialRampToValueAtTime(spec.f1, t + spec.dur);
    // A short percussive AD envelope: instant attack, exponential decay.
    env.gain.setValueAtTime(0.0001, t);
    env.gain.exponentialRampToValueAtTime(spec.peak, t + 0.008);
    env.gain.exponentialRampToValueAtTime(0.0001, t + spec.dur);
    osc.connect(env);
    env.connect(this.master);
    osc.start(t);
    osc.stop(t + spec.dur + 0.02);
  }

  /** Drain `bus` and play each cue. The render-side glue main.ts calls per frame. */
  pump(bus: CueBus): void {
    bus.drain((e) => this.play(e));
  }
}
