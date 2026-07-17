// ============================================================================
// useFillerWordDetector — count filler words in a transcript and estimate WPM.
//
// Pure utility. The "filler word" set covers the most common English disfluencies.
// WPM (words per minute) is derived from the transcript length and the recording
// duration. Both feed into `evaluateAnswer`'s `videoMetrics` so the AI gets
// real signals for the `speakingSpeed` and `fillerWords` dimensions.
// ============================================================================

import { useMemo } from "react";

/** Common English filler words. Case-insensitive, word-boundary matched. */
export const FILLER_WORDS: readonly string[] = [
  "um",
  "uh",
  "umm",
  "uhh",
  "er",
  "err",
  "ah",
  "ahh",
  "like",
  "you know",
  "actually",
  "basically",
  "literally",
  "so",
  "right",
  "okay",
  "ok",
  "well",
  "i mean",
  "sort of",
  "kind of",
  "you see",
];

export interface FillerStats {
  /** Total filler-word occurrences in the transcript. */
  count: number;
  /** Each individual filler occurrence (useful for surfacing in UI). */
  fillers: string[];
  /** Words-per-minute estimate. 0 when durationMs is 0. */
  wpm: number;
  /** Total word count. */
  wordCount: number;
  /** Filler density = count / max(wordCount,1). */
  density: number;
}

/**
 * Count filler words in `transcript` and derive WPM from `durationMs`.
 *
 * Pure function — also exported for unit tests.
 */
export function analyzeFillerWords(
  transcript: string,
  durationMs: number
): FillerStats {
  const text = (transcript ?? "").toLowerCase();
  const wordCount = text ? text.trim().split(/\s+/).filter(Boolean).length : 0;
  const fillers: string[] = [];
  if (text) {
    for (const f of FILLER_WORDS) {
      // Escape regex special chars (defensive; current set has none).
      const escaped = f.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
      const re = new RegExp(`\\b${escaped}\\b`, "g");
      const matches = text.match(re);
      if (matches) fillers.push(...matches);
    }
  }
  const count = fillers.length;
  const minutes = durationMs > 0 ? durationMs / 60_000 : 0;
  const wpm = minutes > 0 ? Math.round(wordCount / minutes) : 0;
  const density = wordCount > 0 ? count / wordCount : 0;
  return { count, fillers, wpm, wordCount, density };
}

/**
 * React hook variant. Recomputes whenever `transcript` or `durationMs` change.
 */
export function useFillerWordDetector(
  transcript: string,
  durationMs: number
): FillerStats {
  return useMemo(
    () => analyzeFillerWords(transcript, durationMs),
    [transcript, durationMs]
  );
}

/**
 * Map a raw WPM value to a 0-100 normalized score. Ideal conversational WPM is
 * ~140-160; faster or slower reduces the score. Returns null when wpm <= 0.
 */
export function normalizeWpmToScore(wpm: number): number | null {
  if (!Number.isFinite(wpm) || wpm <= 0) return null;
  const ideal = 150;
  const deviation = Math.abs(wpm - ideal);
  // 0 deviation = 100; 100 deviation = ~0
  const score = Math.max(0, Math.round(100 - deviation * 1.0));
  return Math.min(100, Math.max(0, score));
}

/**
 * Map a raw filler-count to a 0-100 score. 0 fillers = 100; degrades
 * gracefully so a long answer with 5 fillers still scores ~70.
 */
export function normalizeFillerCountToScore(
  count: number,
  wordCount: number
): number | null {
  if (!Number.isFinite(count) || count < 0) return null;
  if (wordCount <= 0) return null;
  // Density-based: 0% = 100; 5% = ~50; 10%+ = 0.
  const density = count / wordCount;
  const score = Math.max(0, Math.round(100 - density * 1000));
  return Math.min(100, Math.max(0, score));
}
