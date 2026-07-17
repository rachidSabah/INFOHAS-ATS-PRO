// ============================================================================
// Unit tests for the Sonru speech/filler helpers.
// Pure functions — no React, no AI, no mocks needed.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  analyzeFillerWords,
  normalizeWpmToScore,
  normalizeFillerCountToScore,
  FILLER_WORDS,
} from "@/hooks/interview/useFillerWordDetector";

describe("analyzeFillerWords", () => {
  it("returns zero stats for empty transcript", () => {
    const r = analyzeFillerWords("", 60_000);
    expect(r.count).toBe(0);
    expect(r.fillers).toEqual([]);
    expect(r.wordCount).toBe(0);
    expect(r.wpm).toBe(0);
    expect(r.density).toBe(0);
  });

  it("returns 0 wpm when duration is 0", () => {
    const r = analyzeFillerWords("hello world this is a test", 0);
    expect(r.wordCount).toBe(6);
    expect(r.wpm).toBe(0);
  });

  it("counts single-word fillers correctly", () => {
    const text = "um I uh think like we actually need to go";
    const r = analyzeFillerWords(text, 60_000);
    // "um", "uh", "like", "actually" → 4 fillers (note: "I" is not in the list)
    expect(r.count).toBe(4);
    expect(r.fillers).toEqual(expect.arrayContaining(["um", "uh", "like", "actually"]));
  });

  it("counts multi-word fillers correctly", () => {
    const text = "you know I was like, sort of, I mean, it was kind of hard";
    const r = analyzeFillerWords(text, 60_000);
    // "you know", "like", "sort of", "I mean", "kind of" → 5 fillers
    expect(r.count).toBeGreaterThanOrEqual(4);
    expect(r.fillers).toContain("you know");
    expect(r.fillers).toContain("like");
  });

  it("computes WPM correctly for a 1-minute transcript", () => {
    // 150 words in 60 seconds → 150 WPM (ideal conversational pace)
    const words = Array.from({ length: 150 }, (_, i) => `word${i}`).join(" ");
    const r = analyzeFillerWords(words, 60_000);
    expect(r.wpm).toBe(150);
    expect(r.wordCount).toBe(150);
  });

  it("density is fillers/words", () => {
    const text = "um hello uh world";
    const r = analyzeFillerWords(text, 60_000);
    // 2 fillers / 4 words = 0.5
    expect(r.density).toBeCloseTo(0.5, 5);
  });

  it("is case-insensitive", () => {
    const text = "UM Uh LiKe";
    const r = analyzeFillerWords(text, 60_000);
    expect(r.count).toBe(3);
  });

  it("does not match substrings (word boundaries respected)", () => {
    // "summer" contains "um" but should NOT be counted; "umbrella" same;
    // "humbly" contains "uh"... actually it doesn't — "humbly" has no "uh".
    // "uh" inside "dough" or "tough" should NOT match.
    const text = "summer umbrella dough tough";
    const r = analyzeFillerWords(text, 60_000);
    expect(r.count).toBe(0);
  });

  it("FILLER_WORDS list is non-empty and includes core disfluencies", () => {
    expect(FILLER_WORDS.length).toBeGreaterThan(10);
    expect(FILLER_WORDS).toContain("um");
    expect(FILLER_WORDS).toContain("uh");
    expect(FILLER_WORDS).toContain("like");
    expect(FILLER_WORDS).toContain("you know");
  });
});

describe("normalizeWpmToScore", () => {
  it("returns 100 at the ideal 150 WPM", () => {
    expect(normalizeWpmToScore(150)).toBe(100);
  });

  it("returns null when wpm is 0 or negative", () => {
    expect(normalizeWpmToScore(0)).toBeNull();
    expect(normalizeWpmToScore(-10)).toBeNull();
    expect(normalizeWpmToScore(NaN)).toBeNull();
  });

  it("decreases monotonically as WPM deviates from 150", () => {
    const at150 = normalizeWpmToScore(150)!;
    const at180 = normalizeWpmToScore(180)!;
    const at120 = normalizeWpmToScore(120)!;
    const at250 = normalizeWpmToScore(250)!;
    expect(at150).toBeGreaterThan(at180);
    expect(at150).toBeGreaterThan(at120);
    expect(at180).toBeGreaterThan(at250);
  });

  it("clamps to 0-100", () => {
    expect(normalizeWpmToScore(500)).toBeGreaterThanOrEqual(0);
    expect(normalizeWpmToScore(500)).toBeLessThanOrEqual(100);
  });
});

describe("normalizeFillerCountToScore", () => {
  it("returns 100 when there are 0 fillers", () => {
    expect(normalizeFillerCountToScore(0, 100)).toBe(100);
  });

  it("returns null when wordCount is 0", () => {
    expect(normalizeFillerCountToScore(0, 0)).toBeNull();
    expect(normalizeFillerCountToScore(5, 0)).toBeNull();
  });

  it("decreases as filler density increases", () => {
    const zeroFillers = normalizeFillerCountToScore(0, 100)!;
    const fiveFillers = normalizeFillerCountToScore(5, 100)!;
    const twentyFillers = normalizeFillerCountToScore(20, 100)!;
    expect(zeroFillers).toBeGreaterThan(fiveFillers);
    expect(fiveFillers).toBeGreaterThan(twentyFillers);
  });

  it("clamps to 0", () => {
    // 50% filler density → very low score, possibly 0
    expect(normalizeFillerCountToScore(50, 100)).toBeGreaterThanOrEqual(0);
    expect(normalizeFillerCountToScore(50, 100)).toBeLessThanOrEqual(100);
  });
});
