// ============================================================================
// Phase 8.1.3.3 — Enterprise Reflection Engine tests.
//
// Verifies: single engine, shared prompt via Prompt/Context Builders, the
// ReflectionResult shape, that reflection NEVER mutates the original response,
// threshold-driven retry recommendation, parse-failure + disabled degradation,
// and that it runs through recordAI (reusing the pipeline, no second pipeline).
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const sink = vi.fn();

// Mock recordAI so the engine's reflection pass is deterministic + offline.
const reflectionCall = vi.fn();
vi.mock("@/lib/ai/flight-recorder", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    recordAI: (opts: any, rec: any) => reflectionCall(opts, rec),
  };
});

import { reflect, buildReflectionPrompt, getReflectionConfig, setReflectionConfigForScope, DEFAULT_REFLECTION_CONFIG } from "./reflection-engine";
import { setFlightRecordSink } from "./flight-recorder";

beforeEach(() => {
  reflectionCall.mockReset();
  sink.mockReset();
  setFlightRecordSink(sink as any);
  setReflectionConfigForScope("resume-optimizer", { reflectionEnabled: false });
});

describe("Reflection Engine — prompt construction", () => {
  it("builds a shared, feature-agnostic prompt via Prompt + Context Builders", () => {
    const { systemPrompt, userPrompt } = buildReflectionPrompt({
      originalPrompt: "Write a summary.",
      executionContext: "Context X",
      aiResponse: "Summary text.",
    });
    expect(systemPrompt).toContain("Enterprise Reflection Engine");
    expect(systemPrompt).toContain("Instruction compliance");
    expect(userPrompt).toContain("ORIGINAL PROMPT:");
    expect(userPrompt).toContain("AI RESPONSE TO EVALUATE:");
    expect(userPrompt).toContain("Write a summary.");
    expect(userPrompt).toContain("Summary text.");
  });
});

describe("Reflection Engine — result + no mutation", () => {
  it("returns a complete ReflectionResult and never mutates the original response", async () => {
    const original = { text: "ORIGINAL RESPONSE" };
    reflectionCall.mockResolvedValueOnce({
      text: JSON.stringify({
        overallScore: 82,
        confidence: 90,
        summary: "Good.",
        strengths: ["clear"],
        weaknesses: [],
        missingInformation: [],
        instructionViolations: [],
        formatViolations: [],
        reasoningIssues: [],
        hallucinationRisk: 0.1,
        determinismRisk: 0.05,
        suggestedActions: ["none"],
        retryRecommended: false,
        retryReason: "",
      }),
      provider: "test",
      latencyMs: 10,
      tokensEstimate: 50,
    });

    const res = await reflect({
      executionId: "fx1",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: original.text,
      config: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true },
    });

    expect(res.status).toBe("ok");
    expect(res.overallScore).toBe(82);
    expect(res.confidence).toBe(90);
    expect(res.hallucinationRisk).toBe(0.1);
    expect(res.retryRecommended).toBe(false);
    expect(res.reflectionId).toBeTruthy();
    // The original artifact is untouched.
    expect(original.text).toBe("ORIGINAL RESPONSE");
  });

  it("recommends retry when overallScore is below threshold", async () => {
    reflectionCall.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 40, confidence: 60, summary: "Weak", retryRecommended: false }),
      provider: "test",
      latencyMs: 5,
      tokensEstimate: 10,
    });
    const res = await reflect({
      executionId: "fx2",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true, reflectionThreshold: 70 },
    });
    expect(res.status).toBe("retry");
    expect(res.retryRecommended).toBe(true);
    expect(res.retryReason).toContain("threshold");
  });
});

describe("Reflection Engine — configuration", () => {
  it("is disabled by default and returns early without calling the pipeline", async () => {
    const res = await reflect({ executionId: "fx3", originalPrompt: "p", executionContext: "c", aiResponseText: "x" });
    expect(res.status).toBe("error");
    expect(res.retryReason).toBe("reflection disabled");
    expect(reflectionCall).not.toHaveBeenCalled();
  });

  it("per-scope override enables reflection (reusing shared config ownership)", async () => {
    setReflectionConfigForScope("resume-optimizer", { reflectionEnabled: true, reflectionThreshold: 50 });
    reflectionCall.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 95, confidence: 99, summary: "great", retryRecommended: false }),
      provider: "test",
      latencyMs: 1,
      tokensEstimate: 1,
    });
    const res = await reflect({
      executionId: "fx4",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      scope: "resume-optimizer",
    });
    expect(res.status).toBe("ok");
    expect(reflectionCall).toHaveBeenCalledTimes(1);
  });
});

describe("Reflection Engine — resilience", () => {
  it("degrades gracefully on invalid JSON (no throw)", async () => {
    reflectionCall.mockResolvedValueOnce({ text: "not json at all", provider: "test", latencyMs: 1, tokensEstimate: 1 });
    const res = await reflect({
      executionId: "fx5",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true },
    });
    expect(res.status).toBe("error");
    expect(res.retryRecommended).toBe(false);
    expect(res.metadata.error).toContain("invalid reflection JSON");
  });

  it("degrades gracefully when the reflection pass throws", async () => {
    reflectionCall.mockRejectedValueOnce(new Error("boom"));
    const res = await reflect({
      executionId: "fx6",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true },
    });
    expect(res.status).toBe("error");
    expect(res.metadata.error).toContain("boom");
  });

  it("the reflection pass itself is NOT reflected (no recursion)", async () => {
    reflectionCall.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 90, confidence: 90, summary: "ok", retryRecommended: false }),
      provider: "test",
      latencyMs: 1,
      tokensEstimate: 1,
    });
    await reflect({
      executionId: "fx7",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_REFLECTION_CONFIG, reflectionEnabled: true },
    });
    const rec = reflectionCall.mock.calls[0][1];
    expect(rec.reflectionEnabled).toBe(false);
  });
});

describe("getReflectionConfig", () => {
  it("returns a safe default without overrides", () => {
    const cfg = getReflectionConfig();
    expect(cfg.reflectionEnabled).toBe(false);
    expect(cfg.reflectionThreshold).toBe(70);
    expect(cfg.maxReflectionTokens).toBe(1500);
  });
});
