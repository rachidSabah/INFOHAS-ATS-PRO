// ============================================================================
// Phase 8.1.3.5 — Enterprise Validation Engine tests.
//
// Verifies: exactly one deterministic engine, per-profile rule sets (resume
// builder / optimizer / interview / ats / company / translation / ocr), that
// validation CONSUMES reflection + QA results, never mutates the response, is
// deterministic (same input -> same output), critical-failure + threshold +
// strict-mode handling, disabled parity, and per-scope profile selection.
// Validation does NOT execute AI, so no recordAI mock is required.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import {
  validate,
  getValidationConfig,
  setValidationConfigForScope,
  profileForScope,
  DEFAULT_VALIDATION_CONFIG,
  type FlightReflection,
  type FlightQA,
} from "./validation-engine";

const sampleReflection: FlightReflection = {
  reflectionId: "rfx1",
  enabled: true,
  score: 90,
  confidence: 90,
  outcome: "ok",
  summary: "",
  strengths: [],
  weaknesses: [],
  missingInformation: [],
  instructionViolations: [],
  formatViolations: [],
  reasoningIssues: [],
  hallucinationRisk: 0.1,
  determinismRisk: 0.1,
  suggestedActions: [],
  retryRecommended: false,
  retryReason: "",
  promptVersion: "8.1.3.3",
  errors: [],
};

const sampleQA: FlightQA = {
  qaId: "qfx1",
  enabled: true,
  score: 88,
  confidence: 90,
  outcome: "passed",
  summary: "",
  findings: [],
  hallucinationRisk: 0.1,
  policyRisk: 0.0,
  incompletenessRisk: 0.1,
  passed: true,
  failRecommended: false,
  failReason: "",
  promptVersion: "8.1.3.4",
  errors: [],
};

beforeEach(() => {
  // Clear per-scope overrides between tests.
  setValidationConfigForScope("resume-builder", { validationEnabled: false });
});

describe("Validation Engine — determinism + purity", () => {
  it("is deterministic: same inputs yield identical verdicts", () => {
    const base = {
      executionId: "fx",
      prompt: "Build a resume",
      context: "{}",
      response:
        "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100\nEmail me at a@b.com",
      scope: "resume-builder" as const,
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    };
    const a = validate(base);
    const b = validate(base);
    // The verdict is fully determined by the inputs (no AI, no randomness).
    // durationMs is wall-clock and intentionally excluded from the equality.
    expect(a.validationId).toBe(b.validationId);
    expect(a.score).toBe(b.score);
    expect(a.status).toBe(b.status);
    expect(a.profile).toBe(b.profile);
    expect(a.rules).toEqual(b.rules);
    expect(a.deterministic).toBe(true);
  });

  it("never mutates the response it validates", () => {
    const response = { text: "ORIGINAL" };
    validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: response.text,
      scope: "other",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(response.text).toBe("ORIGINAL");
  });
});

describe("Validation Engine — consumes Reflection + QA", () => {
  it("accepts reflection + qa results and completes without error", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: JSON.stringify({ scope: "resume-builder" }),
      response: "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100",
      scope: "resume-builder",
      reflection: sampleReflection,
      qa: sampleQA,
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.profile).toBe("resume-builder");
    expect(res.status).toBe("passed");
    expect(res.rules.length).toBeGreaterThan(0);
  });

  it("runs even when reflection/qa are absent (pure rule checks)", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100",
      scope: "resume-builder",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.status).toBe("passed");
  });
});

describe("Validation Engine — per-profile rules", () => {
  it("resume-builder fails when required sections are missing", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "Just some random text with no structure",
      scope: "resume-builder",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.status).toBe("failed");
    expect(res.criticalFailures).toBeGreaterThan(0);
  });

  it("resume-optimizer flags critical failure when information was removed", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "Optimized resume text",
      scope: "resume-optimizer",
      metadata: { informationRemoved: true },
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.status).toBe("failed");
    const noInfo = res.rules.find((r) => r.ruleId === "ro.no-info-removed");
    expect(noInfo?.outcome).toBe("fail");
    expect(noInfo?.severity).toBe("critical");
  });

  it("interview flags scenario inconsistency as critical", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "scenario: leadership",
      response: "There is a scenario mismatch and a contradiction in the answer.",
      scope: "interview",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.status).toBe("failed");
    expect(res.rules.find((r) => r.ruleId === "iv.scenario-consistency")?.outcome).toBe("fail");
  });

  it("ats validates score range + evidence", () => {
    const ok = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "breakdown of keyword coverage provided",
      scope: "ats-analysis",
      metadata: { atsScore: 82, evidence: true },
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(ok.profile).toBe("ats");
    expect(ok.status).toBe("passed");

    const bad = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "x",
      scope: "ats-analysis",
      metadata: { atsScore: 150 },
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(bad.status).toBe("failed");
  });

  it("translation fails on empty output", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "   ",
      scope: "translation",
      metadata: { targetLanguage: "fr" },
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.status).toBe("failed");
  });

  it("ocr fails when nothing extracted", () => {
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "",
      scope: "ocr",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true } as any,
    });
    expect(res.status).toBe("failed");
  });
});

describe("Validation Engine — configuration", () => {
  it("is disabled by default and returns early without running rules", () => {
    const res = validate({ executionId: "fx", prompt: "p", context: "{}", response: "x", scope: "resume-builder" });
    expect(res.status).toBe("error");
    expect(res.rules.length).toBe(0);
    expect(res.errors).toContain("validation disabled");
  });

  it("per-scope override enables validation (shared config ownership)", () => {
    setValidationConfigForScope("resume-builder", { validationEnabled: true, minimumScore: 50 });
    const res = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100",
      scope: "resume-builder",
    });
    expect(res.status).toBe("passed");
  });

  it("strict mode escalates warnings to failure", () => {
    const warnResponse =
      "Summary\nExperience\nEducation\nSkills\nContact: a@b.com +1 555 0100\n" + "x".repeat(5000);
    const lenient = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: warnResponse,
      scope: "resume-builder",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true, strictMode: false } as any,
    });
    const strict = validate({
      executionId: "fx",
      prompt: "p",
      context: "{}",
      response: warnResponse,
      scope: "resume-builder",
      config: { ...DEFAULT_VALIDATION_CONFIG, validationEnabled: true, strictMode: true } as any,
    });
    // one-page warning present; lenient => warning, strict => failed
    expect(lenient.status).toBe("warning");
    expect(strict.status).toBe("failed");
  });
});

describe("profileForScope", () => {
  it("maps scopes to the right profile", () => {
    expect(profileForScope("resume-builder")).toBe("resume-builder");
    expect(profileForScope("resume-optimizer")).toBe("resume-optimizer");
    expect(profileForScope("ats-analysis")).toBe("ats");
    expect(profileForScope("interview")).toBe("interview");
    expect(profileForScope("resume-copilot")).toBe("copilot");
    expect(profileForScope("company-intelligence")).toBe("company-intelligence");
    expect(profileForScope("translation")).toBe("translation");
    expect(profileForScope("ocr")).toBe("ocr");
    expect(profileForScope("other")).toBe("default");
  });
});

describe("getValidationConfig", () => {
  it("returns a safe default without overrides", () => {
    const cfg = getValidationConfig();
    expect(cfg.validationEnabled).toBe(false);
    expect(cfg.minimumScore).toBe(60);
    expect(cfg.strictMode).toBe(false);
  });
});
