/**
 * Ordered Bayer 4×4 dither tiles, generated at runtime and injected as CSS
 * custom properties. All chrome "tone" (title-bar fill, panel-body depth,
 * scrollbar thumb) comes from these stipple patterns — never flat grey — which
 * is what gives the 1-bit retro-OS feel instead of a flat webpage.
 */

const BAYER4 = [0, 8, 2, 10, 12, 4, 14, 6, 3, 11, 1, 9, 15, 7, 13, 5];

function tile(litCount: number, alpha: number): string {
  const c = document.createElement("canvas");
  c.width = 4;
  c.height = 4;
  const g = c.getContext("2d")!;
  for (let i = 0; i < 16; i++) {
    if (BAYER4[i] < litCount) {
      g.fillStyle = `rgba(255,255,255,${alpha})`;
      g.fillRect(i % 4, (i / 4) | 0, 1, 1);
    }
  }
  return `url(${c.toDataURL()})`;
}

export function applyDither(): void {
  const r = document.documentElement.style;
  r.setProperty("--dither-sparse", tile(2, 0.045)); // panel interiors
  r.setProperty("--dither-dense", tile(5, 0.06)); // title bars / status strip
  r.setProperty("--dither-mid", tile(8, 0.1)); // scrollbar / drop-target
}
