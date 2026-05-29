/**
 * Fixed-tick sim clock — deterministic backbone (P0-03).
 *
 * Absolute sim-time is an integer `tick`. Each tick is exactly `DT` sim-seconds.
 * `seconds()` is derived as `tick * DT` and is always exact (no drift).
 *
 * The game loop calls `scheduleWall()` with the wall-frame delta (scaled by
 * time-accel), then drains `nextTick()` until it returns `null`. This is the
 * classic fixed-timestep accumulator pattern (cf. "Fix Your Timestep!").
 *
 * Time-acceleration scales how many fixed steps run per wall frame — it never
 * changes DT or any physics constant. Same tick count = same sim state,
 * regardless of hardware or frame rate.
 */

export const TIME_SCALES = [1, 10, 100, 1000] as const;

/** Fixed step size in sim-seconds. Chosen so 1× real-time ≈ 60 ticks/second
 *  (matches the typical refresh rate; the sim doesn't care about the render). */
export const DT = 1 / 60;

/** Maximum ticks per scheduleWall() call — prevents a death spiral if the
 *  browser tab is backgrounded for minutes and then refocused. */
export const MAX_TICKS_PER_FRAME = 600; // 10 sim-seconds at 1×

export class SimClock {
  private _tick = 0;
  /** Accumulator for fractional wall time that hasn't yet consumed a full tick. */
  private _accumulator = 0;
  /** index into TIME_SCALES; default 100× so the light-delay packet crawls visibly. */
  scaleIndex = 2;
  paused = false;

  /** Current tick (integer). This is the canonical sim-time representation. */
  get tick(): number {
    return this._tick;
  }

  /** Current sim-time in seconds — derived exactly as tick * DT. */
  get seconds(): number {
    return this._tick * DT;
  }

  /** Effective multiplier (0 while paused). */
  get scale(): number {
    return this.paused ? 0 : TIME_SCALES[this.scaleIndex];
  }

  get scaleLabel(): string {
    return this.paused ? "PAUSE" : `${TIME_SCALES[this.scaleIndex]}×`;
  }

  /**
   * Feed wall-frame delta (seconds) into the accumulator, scaled by time-accel.
   * Clamps pathological deltas (tab refocus, GC stall) and enforces a tick cap.
   * After calling this, drain `nextTick()` until it returns `null`.
   */
  scheduleWall(wallDtSeconds: number): void {
    if (this.paused) return;
    // Clamp pathological deltas so we never teleport.
    const dt = Math.min(wallDtSeconds, 0.1);
    this._accumulator += dt * TIME_SCALES[this.scaleIndex];
    // Prevent death spiral: don't owe more than MAX_TICKS_PER_FRAME ticks.
    const maxOwed = MAX_TICKS_PER_FRAME * DT;
    if (this._accumulator > maxOwed) {
      this._accumulator = maxOwed;
    }
  }

  /**
   * Drain one fixed tick from the accumulator, if available.
   * Returns the tick number that just ran, or `null` if no tick is due.
   *
   * Usage in the game loop:
   * ```
   * clock.scheduleWall(wallDt);
   * while (clock.nextTick() !== null) { /* sim step *\/ }
   * ```
   */
  nextTick(): number | null {
    if (this._accumulator < DT) return null;
    this._accumulator -= DT;
    this._tick++;
    return this._tick;
  }

  /** Set the clock to an exact tick (for save/load replay). */
  setTick(tick: number): void {
    this._tick = tick;
    this._accumulator = 0;
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
}
