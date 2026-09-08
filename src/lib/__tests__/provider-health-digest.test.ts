// Tests for buildProviderHealthDigest — the per-provider failure digest that
// the locked pipeline appends to the UNRECOVERABLE error.
//
// INCIDENT (2026-09-08): the optimizer failed 4 attempts showing only the
// keyword-floor symptom, while the browser console proved the real disease —
// every provider in the rotation failing upstream (401 invalid key, 429
// quota, 400 bad request, 404 model). The digest surfaces that context in
// the failure the user actually sees.

import { describe, it, expect } from "vitest";
import { buildProviderHealthDigest } from "../locked-pipeline";
import type { AICallDiagnostic } from "../ai-diagnostics";

function diag(partial: Partial<AICallDiagnostic>): AICallDiagnostic {
  const endedAt = partial.endedAt ?? new Date().toISOString();
  return {
    requestId: partial.requestId ?? `req_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: partial.startedAt ?? endedAt,
    endedAt,
    provider: partial.provider ?? "TestProvider",
    model: partial.model,
    taskCategory: partial.taskCategory,
    systemPromptSize: partial.systemPromptSize ?? 100,
    userPromptSize: partial.userPromptSize ?? 200,
    promptSize: partial.promptSize ?? 300,
    estimatedInputTokens: partial.estimatedInputTokens ?? 75,
    maxTokens: partial.maxTokens,
    latencyMs: partial.latencyMs,
    finishReason: partial.finishReason,
    rawResponsePreview: partial.rawResponsePreview,
    normalizedResponsePreview: partial.normalizedResponsePreview,
    error: partial.error,
    success: partial.success ?? false,
  };
}

describe("buildProviderHealthDigest", () => {
  it("returns null when there are no recent diagnostics", () => {
    expect(buildProviderHealthDigest([])).toBeNull();
    // Only in-flight calls (no endedAt) → nothing to report.
    expect(buildProviderHealthDigest([{ ...diag({}), endedAt: undefined } as any])).toBeNull();
  });

  it("excludes calls that ended outside the window", () => {
    const stale = diag({ provider: "OldProvider", endedAt: new Date(Date.now() - 30 * 60_000).toISOString(), error: "stale 401" });
    expect(buildProviderHealthDigest([stale])).toBeNull();
  });

  it("aggregates failures per provider with the last error message", () => {
    const diags = [
      diag({ provider: "OpenAI", error: "Invalid API Key. Detail: 401 incorrect key" }),
      diag({ provider: "OpenAI", error: "Invalid API Key. Detail: 401 expired" }),
      diag({ provider: "OpenCode Zen", error: "429 rate limited (retry-after: 3600s)" }),
    ];
    const digest = buildProviderHealthDigest(diags)!;
    expect(digest).toContain("AI PROVIDER HEALTH (last 10 min)");
    expect(digest).toContain("- OpenAI: 2 failed call(s), last error: Invalid API Key. Detail: 401 expired (none succeeded)");
    expect(digest).toContain("- OpenCode Zen: 1 failed call(s), last error: 429 rate limited (retry-after: 3600s)");
    // The LAST error wins (most recent state).
    expect(digest).not.toContain("incorrect key");
  });

  it("distinguishes healthy providers from failing ones", () => {
    const diags = [
      diag({ provider: "Puter.js", success: true }),
      diag({ provider: "Puter.js", success: true }),
      diag({ provider: "Workers AI", error: "daily neurons exhausted" }),
    ];
    const digest = buildProviderHealthDigest(diags)!;
    expect(digest).toContain("- Puter.js: healthy (2 succeeded)");
    expect(digest).toContain("- Workers AI: 1 failed call(s), last error: daily neurons exhausted (none succeeded)");
  });

  it("marks mixed providers with both counts", () => {
    const diags = [
      diag({ provider: "Groq", success: true }),
      diag({ provider: "Groq", error: "model XYZ not found (404)" }),
    ];
    const digest = buildProviderHealthDigest(diags)!;
    expect(digest).toContain("- Groq: 1 failed call(s), last error: model XYZ not found (404) (1 succeeded)");
  });

  it("respects a custom window", () => {
    const nineMinAgo = diag({ provider: "OpenAI", error: "401", endedAt: new Date(Date.now() - 9 * 60_000).toISOString() });
    const elevenMinAgo = diag({ provider: "OpenAI", error: "401 old", endedAt: new Date(Date.now() - 11 * 60_000).toISOString() });
    expect(buildProviderHealthDigest([nineMinAgo])).not.toBeNull();
    expect(buildProviderHealthDigest([elevenMinAgo], 10 * 60_000)).toBeNull();
    expect(buildProviderHealthDigest([elevenMinAgo], 12 * 60_000)).not.toBeNull();
  });

  it("truncates very long error messages to 140 chars", () => {
    const longError = "x".repeat(500);
    const digest = buildProviderHealthDigest([diag({ provider: "P", error: longError })])!;
    expect(digest).toContain("x".repeat(140));
    expect(digest).not.toContain("x".repeat(141));
  });
});
