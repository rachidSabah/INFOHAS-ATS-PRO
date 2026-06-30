// ============================================================================
// Pipeline Validator Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  validateStep,
  validatePipeline,
  minLengthRule,
  containsAllRule,
  nonEmptyRule,
  minLinesRule,
  validJsonRule,
  customRule,
  type ValidationRule,
} from "./pipeline-validator";

describe("validateStep", () => {
  it("passes when all rules pass", () => {
    const result = validateStep("Hello world", [nonEmptyRule, minLengthRule(3)]);
    expect(result.valid).toBe(true);
    expect(result.errors).toBe(0);
    expect(result.warnings).toBe(0);
    expect(result.results).toHaveLength(2);
    expect(result.results.every((r) => r.passed)).toBe(true);
  });

  it("fails when a required rule fails", () => {
    const result = validateStep("", [nonEmptyRule]);
    expect(result.valid).toBe(false);
    expect(result.errors).toBe(1);
    expect(result.results[0].passed).toBe(false);
    expect(result.results[0].error).toContain("empty");
  });

  it("produces warnings for severity=warn rules", () => {
    const result = validateStep("Hello", [minLinesRule(5)]);
    expect(result.valid).toBe(true); // warn doesn't block
    expect(result.warnings).toBe(1);
    expect(result.errors).toBe(0);
  });

  it("validates minLengthRule correctly", () => {
    const rule = minLengthRule(10);
    expect(rule.validate("short")).toContain("minimum");
    expect(rule.validate("exactly 10 chars")).toBeNull();
  });

  it("validates containsAllRule correctly", () => {
    const rule = containsAllRule(["skill", "experience"]);
    expect(rule.validate("I have skill and experience")).toBeNull();
    expect(rule.validate("I have skill")).toContain("experience");
  });

  it("validates validJsonRule correctly", () => {
    expect(validJsonRule.validate('{"key": "value"}')).toBeNull();
    expect(validJsonRule.validate("{invalid}")).toContain("not valid JSON");
  });

  it("validates customRule correctly", () => {
    const rule = customRule("no-foo", "Must not contain foo", (o) =>
      o.includes("foo") ? "Contains foo" : null,
    );
    expect(rule.validate("bar")).toBeNull();
    expect(rule.validate("foo bar")).toContain("foo");
  });

  it("collects multiple rule failures", () => {
    const result = validateStep("", [nonEmptyRule, minLengthRule(100)]);
    expect(result.valid).toBe(false);
    expect(result.errors).toBe(2);
    expect(result.results.filter((r) => !r.passed)).toHaveLength(2);
  });

  it("passes context to validation function", () => {
    const ctxRule: ValidationRule = {
      id: "ctx-test",
      description: "Check context",
      severity: "error",
      validate(_output, ctx) {
        return ctx?.expectedValue === "hello" ? null : "Missing context";
      },
    };
    const result = validateStep("output", [ctxRule], { expectedValue: "hello" });
    expect(result.valid).toBe(true);
  });
});

describe("validatePipeline", () => {
  it("validates multiple step outputs", () => {
    const outputs = new Map([
      ["step-a", "valid output"],
      ["step-b", ""],
    ]);
    const rules = new Map([
      ["step-a", [nonEmptyRule]],
      ["step-b", [nonEmptyRule]],
    ]);

    const results = validatePipeline(outputs, rules);
    expect(results.get("step-a")!.valid).toBe(true);
    expect(results.get("step-b")!.valid).toBe(false);
  });

  it("returns empty validation for steps with no rules", () => {
    const outputs = new Map([["step-a", "anything"]]);
    const results = validatePipeline(outputs, new Map());
    expect(results.get("step-a")!.valid).toBe(true);
    expect(results.get("step-a")!.results).toHaveLength(0);
  });
});
