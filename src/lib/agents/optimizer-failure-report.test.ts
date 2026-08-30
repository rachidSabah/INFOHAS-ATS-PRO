/**
 * RED TEST — Truthful optimizer failure diagnosis.
 *
 * Production trace (HEAD 0de936c): a real optimization run failed with the
 * USELESS nested message:
 *   "Optimization could not be completed after 4 validated attempts …
 *    Last error: Optimization could not be completed after 3 validated
 *    attempt(s) (bounded auto-heal ran between attempts). The original
 *    resume was NOT substituted as the result."
 *
 * Root cause: the locked pipeline throws OptimizerUnrecoverableError carrying
 * `attemptErrors: string[]` (one truthful diagnosis per inner attempt —
 * Guardian blocks, output-validation failures, provider classes…), but the
 * orchestrator's catch block stores only `e.message` (the generic wrapper)
 * and the final exhausted block reports THAT. The per-attempt diagnoses are
 * never surfaced — the UI (and the user) cannot see WHY the run failed.
 *
 * The fix composes the final failure report from the inner attemptErrors:
 * the LAST inner diagnosis (most recent, most relevant) becomes the reported
 * error; the fixed "AI providers unavailable" progress string is replaced by
 * a truthful one. These tests pin that behaviour.
 */
import { describe, it, expect } from "vitest";
import { composeOptimizerFailureReport } from "./optimizer-failure-report";

describe("composeOptimizerFailureReport", () => {
  it("surfaces the LAST inner attempt diagnosis instead of the generic nested message", () => {
    const report = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError:
        "Optimization could not be completed after 3 validated attempt(s) (bounded auto-heal ran between attempts). The original resume was NOT substituted as the result.",
      lastFailureReason: null,
      innerAttemptErrors: [
        "Guardian BLOCKED: Experience section is empty",
        "Output validation failed: summary missing required sections",
        "All providers rate-limited (429) — no eligible engine in chain",
      ],
    });

    // The reported error is the most recent INNER diagnosis, not the generic wrapper.
    expect(report.lastErr).toContain("All providers rate-limited (429)");
    expect(report.lastErr).toContain("2 earlier inner attempt failure(s)");
    // Full message keeps the established format but ends with the REAL reason.
    expect(report.message).toContain("after 4 validated attempts");
    expect(report.message).toContain("Original resume NOT substituted");
    expect(report.message).toContain("Last error: All providers rate-limited (429)");
  });

  it("reports a single inner diagnosis without the 'earlier failures' suffix", () => {
    const report = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: "generic inner wrapper message",
      lastFailureReason: null,
      innerAttemptErrors: ["Guardian BLOCKED: Experience section is empty"],
    });

    expect(report.lastErr).toBe("Guardian BLOCKED: Experience section is empty");
    expect(report.lastErr).not.toContain("earlier inner attempt");
  });

  it("falls back to the caught error message when no inner diagnoses exist", () => {
    const report = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: "Guardian BLOCKED (standard path): Experience section is empty",
      lastFailureReason: null,
      innerAttemptErrors: [],
    });

    expect(report.lastErr).toBe("Guardian BLOCKED (standard path): Experience section is empty");
  });

  it("falls back to lastFailureReason when optimizeError is null", () => {
    const report = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: null,
      lastFailureReason: "content too short (412 chars)",
      innerAttemptErrors: [],
    });

    expect(report.lastErr).toBe("content too short (412 chars)");
  });

  it("never reports 'unknown error' when any diagnosis source is non-empty", () => {
    const report = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: null,
      lastFailureReason: null,
      innerAttemptErrors: ["", "  ", "provider timeout after 60s"],
    });

    // Blank strings are filtered; the real diagnosis survives.
    expect(report.lastErr).toContain("provider timeout after 60s");
    expect(report.lastErr).not.toBe("unknown error");
  });

  it("reports 'unknown error' only when every source is empty", () => {
    const report = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: null,
      lastFailureReason: null,
      innerAttemptErrors: [],
    });

    expect(report.lastErr).toBe("unknown error");
  });

  it("progress is truthful — never the fixed 'AI providers unavailable' string", () => {
    const withInner = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: "generic wrapper",
      lastFailureReason: null,
      innerAttemptErrors: ["Structure Guardian found 1 critical issue(s): Experience section is empty"],
    });
    expect(withInner.progress).toContain("Structure Guardian");
    expect(withInner.progress).not.toMatch(/AI providers? unavailable/i);

    const withoutInner = composeOptimizerFailureReport({
      maxOptimizeAttempts: 4,
      optimizeError: "provider chain exhausted",
      lastFailureReason: null,
      innerAttemptErrors: [],
    });
    expect(withoutInner.progress).toContain("provider chain exhausted");
    expect(withoutInner.progress).not.toMatch(/AI providers? unavailable/i);
  });
});
