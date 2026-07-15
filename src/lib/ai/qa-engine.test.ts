// ============================================================================
// Phase 8.1.3.4 — Enterprise QA Engine tests.
//
// Verifies: single engine, shared prompt via Prompt/Context Builders, the
// QAResult shape, that QA NEVER mutates the original response, threshold-driven
// fail recommendation (incl. critical-finding short-circuit), parse-failure +
// disabled degradation, and that it runs through recordAI (reusing the
// pipeline, no second pipeline). Mirrors the Reflection Engine test layout.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";

const sink = vi.fn();

// Mock recordAI so the engine's QA pass is deterministic + offline.
const qaCall = vi.fn();
vi.mock("@/lib/ai/flight-recorder", async (importOriginal) => {
  const actual = (await importOriginal()) as any;
  return {
    ...actual,
    recordAI: (opts: any, rec: any) => qaCall(opts, rec),
  };
});

import { qa, buildQAPrompt, getQAConfig, setQAConfigForScope, DEFAULT_QA_CONFIG } from "./qa-engine";
import { setFlightRecordSink } from "./flight-recorder";

beforeEach(() => {
  qaCall.mockReset();
  sink.mockReset();
  setFlightRecordSink(sink as any);
  setQAConfigForScope("resume-optimizer", { qaEnabled: false });
});

describe("QA Engine — prompt construction", () => {
  it("builds a shared, feature-agnostic prompt via Prompt + Context Builders", () => {
    const { systemPrompt, userPrompt } = buildQAPrompt({
      originalPrompt: "Write a summary.",
      executionContext: "Context X",
      aiResponse: "Summary text.",
    });
    expect(systemPrompt).toContain("Enterprise QA (Quality Assurance) Engine");
    expect(systemPrompt).toContain("Instruction compliance");
    expect(userPrompt).toContain("ORIGINAL PROMPT:");
    expect(userPrompt).toContain("AI RESPONSE TO VALIDATE:");
    expect(userPrompt).toContain("Write a summary.");
    expect(userPrompt).toContain("Summary text.");
  });
});

describe("QA Engine — result + no mutation", () => {
  it("returns a complete QAResult and never mutates the original response", async () => {
    const original = { text: "ORIGINAL RESPONSE" };
    qaCall.mockResolvedValueOnce({
      text: JSON.stringify({
        overallScore: 88,
        confidence: 90,
        summary: "Clean.",
        findings: [],
        hallucinationRisk: 0.05,
        policyRisk: 0.0,
        incompletenessRisk: 0.1,
        failRecommended: false,
        failReason: "",
      }),
      provider: "test",
      latencyMs: 10,
      tokensEstimate: 50,
    });

    const res = await qa({
      executionId: "fx1",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: original.text,
      config: { ...DEFAULT_QA_CONFIG, qaEnabled: true },
    });

    expect(res.status).toBe("passed");
    expect(res.overallScore).toBe(88);
    expect(res.confidence).toBe(90);
    expect(res.hallucinationRisk).toBe(0.05);
    expect(res.failRecommended).toBe(false);
    expect(res.passed).toBe(true);
    expect(res.qaId).toBeTruthy();
    // The original artifact is untouched.
    expect(original.text).toBe("ORIGINAL RESPONSE");
  });

  it("recommends fail when overallScore is below threshold", async () => {
    qaCall.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 40, confidence: 60, summary: "Weak", failRecommended: false }),
      provider: "test",
      latencyMs: 5,
      tokensEstimate: 10,
    });
    const res = await qa({
      executionId: "fx2",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_QA_CONFIG, qaEnabled: true, qaThreshold: 70 },
    });
    expect(res.status).toBe("failed");
    expect(res.failRecommended).toBe(true);
    expect(res.failReason).toContain("threshold");
  });

  it("recommends fail on a critical finding even with a high score", async () => {
    qaCall.mockResolvedValueOnce({
      text: JSON.stringify({
        overallScore: 95,
        confidence: 99,
        summary: "Mostly fine",
        findings: [{ category: "factual", description: "Invented a credential", severity: "critical" }],
        failRecommended: false,
      }),
      provider: "test",
      latencyMs: 1,
      tokensEstimate: 1,
    });
    const res = await qa({
      executionId: "fx3",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_QA_CONFIG, qaEnabled: true, qaThreshold: 70 },
    });
    expect(res.status).toBe("failed");
    expect(res.failRecommended).toBe(true);
    expect(res.findings[0].severity).toBe("critical");
  });
});

describe("QA Engine — configuration", () => {
  it("is disabled by default and returns early without calling the pipeline", async () => {
    const res = await qa({ executionId: "fx4", originalPrompt: "p", executionContext: "c", aiResponseText: "x" });
    expect(res.status).toBe("error");
    expect(res.failReason).toBe("qa disabled");
    expect(qaCall).not.toHaveBeenCalled();
  });

  it("per-scope override enables QA (reusing shared config ownership)", async () => {
    setQAConfigForScope("resume-optimizer", { qaEnabled: true, qaThreshold: 50 });
    qaCall.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 95, confidence: 99, summary: "great", failRecommended: false }),
      provider: "test",
      latencyMs: 1,
      tokensEstimate: 1,
    });
    const res = await qa({
      executionId: "fx5",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      scope: "resume-optimizer",
    });
    expect(res.status).toBe("passed");
    expect(qaCall).toHaveBeenCalledTimes(1);
  });
});

describe("QA Engine — resilience", () => {
  it("degrades gracefully on invalid JSON (no throw)", async () => {
    qaCall.mockResolvedValueOnce({ text: "not json at all", provider: "test", latencyMs: 1, tokensEstimate: 1 });
    const res = await qa({
      executionId: "fx6",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_QA_CONFIG, qaEnabled: true },
    });
    expect(res.status).toBe("error");
    expect(res.failRecommended).toBe(false);
    expect(res.metadata.error).toContain("invalid qa JSON");
  });

  it("degrades gracefully when the QA pass throws", async () => {
    qaCall.mockRejectedValueOnce(new Error("boom"));
    const res = await qa({
      executionId: "fx7",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_QA_CONFIG, qaEnabled: true },
    });
    expect(res.status).toBe("error");
    expect(res.metadata.error).toContain("boom");
  });

  it("the QA pass itself is NOT re-QA'd (no recursion)", async () => {
    qaCall.mockResolvedValueOnce({
      text: JSON.stringify({ overallScore: 90, confidence: 90, summary: "ok", failRecommended: false }),
      provider: "test",
      latencyMs: 1,
      tokensEstimate: 1,
    });
    await qa({
      executionId: "fx8",
      originalPrompt: "p",
      executionContext: "c",
      aiResponseText: "x",
      config: { ...DEFAULT_QA_CONFIG, qaEnabled: true },
    });
    const rec = qaCall.mock.calls[0][1];
    expect(rec.qaEnabled).toBe(false);
  });
});

describe("getQAConfig", () => {
  it("returns a safe default without overrides", () => {
    const cfg = getQAConfig();
    expect(cfg.qaEnabled).toBe(false);
    expect(cfg.qaThreshold).toBe(70);
    expect(cfg.maxQATokens).toBe(1500);
  });
});
