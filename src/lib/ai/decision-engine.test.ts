// ============================================================================
// Phase8.1.3.6 — Decision Engine unit tests.
//
// Verifies the pure/deterministic `decide()` function: each rule fires on its
// upstream trigger, priority precedence, disabled parity, determinism (same
// input -> same result), config override, strict mode, and confidence gating.
// No network — all inputs are constructed in-process.
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  decide,
  DEFAULT_DECISION_CONFIG,
  DECISION_VERSION,
  profileForScope,
  setDecisionConfigForScope,
  getDecisionConfig,
  type DecisionStatus,
} from "./decision-engine";
import type { FlightReflection } from "./flight-recorder";
import type { FlightQA } from "./flight-recorder";
import type { FlightValidation } from "./flight-recorder";

const enabled = { ...DEFAULT_DECISION_CONFIG, decisionEnabled: true };

function ref(p: Partial<FlightReflection>): FlightReflection {
  return {
    reflectionId: "rfx", enabled: true, score: 90, confidence: 90, summary: "",
    strengths: [], weaknesses: [], missingInformation: [], instructionViolations: [],
    formatViolations: [], reasoningIssues: [], hallucinationRisk: 0.1, determinismRisk: 0.1,
    suggestedActions: [], retryRecommended: false, retryReason: "", outcome: "ok",
    promptVersion: "x", durationMs: 1, latencyMs: 1, provider: "p", model: "m",
    cost: 0, tokens: 1, errors: [], ...p,
  };
}
function qa(p: Partial<FlightQA>): FlightQA {
  return {
    qaId: "qfx", enabled: true, score: 90, confidence: 90, outcome: "passed",
    summary: "", findings: [], hallucinationRisk: 0.1, policyRisk: 0.1,
    incompletenessRisk: 0.1, passed: true, failRecommended: false, failReason: "",
    promptVersion: "x", durationMs: 1, latencyMs: 1, provider: "p", model: "m",
    cost: 0, tokens: 1, errors: [], ...p,
  };
}
function val(p: Partial<FlightValidation>): FlightValidation {
  return {
    validationId: "vfx", enabled: true, score: 90, outcome: "passed", profile: "default",
    rules: [], warnings: [], failures: [], reasons: [], criticalFailures: 0, passed: true,
    failRecommended: false, deterministic: true, version: "8.1.3.5", durationMs: 1, errors: [],
    ...p,
  };
}

describe("decision-engine: disabled parity", () => {
  it("returns continue with no rules when disabled", () => {
    const r = decide({ executionId: "fx1", scope: "resume-builder" });
    expect(r.status).toBe("continue");
    expect(r.rules).toEqual([]);
    expect(r.deterministic).toBe(true);
    expect(r.version).toBe(DECISION_VERSION);
  });
});

describe("decision-engine: rule firing", () => {
  it("validation critical failure → REJECT (highest precedence)", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      validation: val({ outcome: "failed", criticalFailures: 1 }),
    });
    expect(r.status).toBe("reject");
    expect(r.rules.some((x) => x.ruleId === "dec.validation-critical-failure")).toBe(true);
  });

  it("validation failed (non-critical) → REJECT", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      validation: val({ outcome: "failed", criticalFailures: 0 }),
    });
    expect(r.status).toBe("reject");
  });

  it("critical QA failure → RETRY (emit-only)", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      qa: qa({ outcome: "failed", failRecommended: true, findings: [{ category: "x", description: "y", severity: "critical" }] }),
    });
    expect(r.status).toBe("retry");
    expect(r.rules.some((x) => x.ruleId === "dec.critical-qa-failure")).toBe(true);
  });

  it("non-critical QA failure → RETRY", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      qa: qa({ outcome: "failed", failRecommended: true }),
    });
    expect(r.status).toBe("retry");
  });

  it("reflection retry recommended → RETRY", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      reflection: ref({ outcome: "retry", retryRecommended: true, retryReason: "weak" }),
    });
    expect(r.status).toBe("retry");
  });

  it("reflection low confidence → HUMAN_REVIEW", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      reflection: ref({ confidence: 20 }),
    });
    expect(r.status).toBe("human_review");
    expect(r.rules.some((x) => x.ruleId === "dec.reflection-low-confidence")).toBe(true);
  });

  it("policy/hallucination risk → ESCALATE", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      qa: qa({ policyRisk: 0.9 }),
      reflection: ref({ hallucinationRisk: 0.9 }),
    });
    expect(r.status).toBe("escalate");
    expect(r.rules.some((x) => x.ruleId === "dec.policy-conflict")).toBe(true);
  });

  it("all engines pass → ACCEPT", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      reflection: ref({ outcome: "ok" }), qa: qa({ outcome: "passed" }), validation: val({ outcome: "passed" }),
    });
    expect(r.status).toBe("accept");
    expect(r.rules.some((x) => x.ruleId === "dec.all-engines-pass")).toBe(true);
  });

  it("no upstream failures (or no upstream) → ACCEPT via all-engines-pass", () => {
    const r = decide({ executionId: "fx", scope: "default", config: enabled });
    expect(r.status).toBe("accept");
    expect(r.rules.some((x) => x.ruleId === "dec.all-engines-pass")).toBe(true);
  });

  it("stop on repeated failures (history) → STOP", () => {
    const cfg = { ...enabled, stopAfterRepeatedFailures: 2 };
    const history: Array<{ status?: string; decisionStatus?: DecisionStatus }> = [
      { decisionStatus: "reject" },
      { decisionStatus: "reject" },
    ];
    const r = decide({
      executionId: "fx", scope: "default", config: cfg,
      validation: val({ outcome: "failed" }), history,
    });
    // precedence: validation-failed (reject) fires BEFORE stop rule.
    expect(r.status).toBe("reject");
  });

  it("stop fires when no higher-precedence rule triggers", () => {
    const cfg = { ...enabled, stopAfterRepeatedFailures: 2 };
    const history: Array<{ status?: string; decisionStatus?: DecisionStatus }> = [
      { decisionStatus: "reject" },
      { decisionStatus: "reject" },
    ];
    const r = decide({ executionId: "fx", scope: "default", config: cfg, history });
    expect(r.status).toBe("stop");
  });
});

describe("decision-engine: precedence", () => {
  it("validation reject outranks qa retry", () => {
    const r = decide({
      executionId: "fx", scope: "default", config: enabled,
      qa: qa({ outcome: "failed", failRecommended: true }),
      validation: val({ outcome: "failed", criticalFailures: 1 }),
    });
    expect(r.status).toBe("reject");
  });
});

describe("decision-engine: strict mode", () => {
  it("downgrades accept to human_review when an upstream is non-ok", () => {
    const cfg = { ...enabled, strictMode: true };
    // reflection outcome "retry" (but retryRecommended:false) → all-engines-pass
    // still fires ACCEPT; strict mode then downgrades to HUMAN_REVIEW.
    const r = decide({
      executionId: "fx", scope: "default", config: cfg,
      reflection: ref({ outcome: "retry", retryRecommended: false }),
      qa: qa({ outcome: "passed" }),
      validation: val({ outcome: "passed" }),
    });
    expect(r.status).toBe("human_review");
  });

  it("keeps accept when all upstream ok", () => {
    const cfg = { ...enabled, strictMode: true };
    const r = decide({
      executionId: "fx", scope: "default", config: cfg,
      reflection: ref({ outcome: "ok" }), qa: qa({ outcome: "passed" }), validation: val({ outcome: "passed" }),
    });
    expect(r.status).toBe("accept");
  });
});

describe("decision-engine: determinism", () => {
  it("same inputs → same result (status + trace)", () => {
    const args = {
      executionId: "fx", scope: "default" as const, config: enabled,
      reflection: ref({ confidence: 20 }), qa: qa({ outcome: "passed" }), validation: val({ outcome: "passed" }),
    };
    const a = decide(args);
    const b = decide(args);
    expect(a.status).toBe(b.status);
    expect(a.trace).toEqual(b.trace);
    expect(a.reason).toBe(b.reason);
  });
});

describe("decision-engine: profile mapping + config", () => {
  it("maps scope to profile and falls back to default", () => {
    expect(profileForScope("ats-analysis")).toBe("ats");
    expect(profileForScope("interview")).toBe("interview");
    expect(profileForScope(undefined)).toBe("default");
  });

  it("per-scope override applies", () => {
    setDecisionConfigForScope("interview", { confidenceThreshold: 0.9 });
    const c = getDecisionConfig("interview");
    expect(c.confidenceThreshold).toBe(0.9);
    // reset
    setDecisionConfigForScope("interview", {});
  });

  it("profileOverride steers the decision profile", () => {
    const r = decide({
      executionId: "fx", scope: "interview", config: { ...enabled, profileOverride: "ats" },
      validation: val({ outcome: "failed", criticalFailures: 1 }),
    });
    expect(r.profile).toBe("ats");
  });
});
