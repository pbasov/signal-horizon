/**
 * Sim clock — drives everything on SIM time, never wall time. Mirrors the spirit
 * of SignalHorizon.Sim/SimClock.cs: time acceleration scales how fast sim-seconds
 * accumulate; it never changes physics. (The real sim uses an integer fixed-step
 * tick accumulator for bit-determinism; this spike has no determinism requirement
 * so it accumulates f64 sim-seconds directly — see FINDINGS.md.)
 */

export const TIME_SCALES = [1, 10, 100, 1000] as const;

export class SimClock {
  private _seconds = 0;
  /** index into TIME_SCALES; default 100× so the light-delay packet crawls visibly. */
  scaleIndex = 2;
  paused = false;

  get seconds(): number {
    return this._seconds;
  }

  /** Effective multiplier (0 while paused). */
  get scale(): number {
    return this.paused ? 0 : TIME_SCALES[this.scaleIndex];
  }

  get scaleLabel(): string {
    return this.paused ? "PAUSE" : `${TIME_SCALES[this.scaleIndex]}×`;
  }

  /** Advance sim time by a wall-clock delta (seconds), scaled. No-op while paused. */
  advance(wallDtSeconds: number): void {
    if (this.paused) return;
    // Clamp pathological deltas (tab refocus, GC stall) so we never teleport.
    const dt = Math.min(wallDtSeconds, 0.1);
    this._seconds += dt * TIME_SCALES[this.scaleIndex];
  }

  togglePause(): void {
    this.paused = !this.paused;
  }

  faster(): void {
    this.scaleIndex = Math.min(TIME_SCALES.length - 1, this.scaleIndex + 1);
  }

  slower(): void {
    this.scaleIndex = Math.max(0, this.scaleIndex - 1);
  }

  setSeconds(s: number): void {
    this._seconds = s;
  }
}
