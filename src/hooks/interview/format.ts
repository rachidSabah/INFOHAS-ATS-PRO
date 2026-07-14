// ============================================================================
// Small formatting helpers for the interview media UI (countdowns, durations).
// ============================================================================

/** Format milliseconds as M:SS (or H:MM:SS for >= 1h). */
export function formatDuration(ms: number): string {
  if (!Number.isFinite(ms) || ms < 0) ms = 0;
  const totalSec = Math.floor(ms / 1000);
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  const ss = String(s).padStart(2, "0");
  if (h > 0) return `${h}:${String(m).padStart(2, "0")}:${ss}`;
  return `${m}:${ss}`;
}

/** Remaining time for a countdown, clamped at 0. */
export function formatRemaining(remainingMs: number): string {
  return formatDuration(Math.max(0, remainingMs));
}
