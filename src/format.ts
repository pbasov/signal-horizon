/** Shared formatting for sim-time, light-delay, and distances (instrument style). */

const AU_M = 1.495978707e11;

function pad2(n: number): string {
  return String(n).padStart(2, "0");
}

/** Full sim clock since J2000: "Dd HH:MM:SS". */
export function fmtClock(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  return `${d}d ${pad2(h)}:${pad2(m)}:${pad2(s % 60)}`;
}

/** Short timestamp for log lines: "HH:MM:SS". */
export function fmtTs(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  return `${pad2(Math.floor((s % 86400) / 3600))}:${pad2(Math.floor((s % 3600) / 60))}:${pad2(s % 60)}`;
}

/** Light delay as a duration: "14m22s" (or "48s"). */
export function fmtDuration(sec: number): string {
  const s = Math.max(0, Math.round(sec));
  const m = Math.floor(s / 60);
  return m > 0 ? `${m}m${pad2(s % 60)}s` : `${s}s`;
}

/** Light delay in light-seconds: "864 ls". */
export function fmtLightSeconds(sec: number): string {
  return `${sec.toFixed(0)} ls`;
}

/** Distance in AU (or Mkm when very small). */
export function fmtDistance(m: number): string {
  const au = m / AU_M;
  if (au >= 0.01) return `${au.toFixed(3)} AU`;
  return `${(m / 1e9).toFixed(2)} Mkm`;
}

/** Percentage from a 0..1 fraction: "50%". */
export function fmtPct(frac: number): string {
  return `${Math.round(frac * 100)}%`;
}
