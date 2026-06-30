// ============================================================================
// Pipeline Validator — step result validation gates.
//
// Validates individual step outputs and full pipeline results against
// configurable rules:
//   - Minimum content length
//   - Required fields/properties
//   - Custom validation functions
//   - Schema-based validation (optional)
//
// The Validator sits BETWEEN the Coordinator and the Executor.
// After each step executes, the Coordinator calls validateStep() to
// check the output. If validation fails and the step has no fallback,
// the pipeline can either continue (non-fatal) or fail (fatal).
// ============================================================================

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ValidationSeverity = "error" | "warn";

export interface ValidationRule {
  /** Unique rule ID for traceability */
  id: string;
  /** Human-readable description */
  description: string;
  /** Severity: "error" blocks the pipeline, "warn" logs but continues */
  severity: ValidationSeverity;
  /** The validation function. Return null if valid, or an error string. */
  validate: (output: string, context?: Record<string, unknown>) => string | null;
}

export interface ValidationResult {
  ruleId: string;
  description: string;
  severity: ValidationSeverity;
  passed: boolean;
  error?: string;
}

export interface ValidationSet {
  /** All validation results for this step */
  results: ValidationResult[];
  /** True only if ALL error-severity rules passed */
  valid: boolean;
  /** Number of warnings (non-blocking) */
  warnings: number;
  /** Number of errors (blocking) */
  errors: number;
}

// ---------------------------------------------------------------------------
// Built-in Rules
// ---------------------------------------------------------------------------

/**
 * Rule: output must have a minimum length.
 */
export function minLengthRule(minChars: number): ValidationRule {
  return {
    id: `min-length-${minChars}`,
    description: `Output must be at least ${minChars} characters`,
    severity: "error",
    validate(output) {
      return output.trim().length >= minChars ? null : `Output is ${output.trim().length} chars, minimum is ${minChars}`;
    },
  };
}

/**
 * Rule: output must contain all specified substrings.
 */
export function containsAllRule(required: string[]): ValidationRule {
  return {
    id: `contains-all-${required.join("-")}`,
    description: `Output must contain: ${required.join(", ")}`,
    severity: "error",
    validate(output) {
      const missing = required.filter((s) => !output.includes(s));
      return missing.length === 0 ? null : `Missing required content: ${missing.join(", ")}`;
    },
  };
}

/**
 * Rule: output must not be empty after trimming.
 */
export const nonEmptyRule: ValidationRule = {
  id: "non-empty",
  description: "Output must not be empty",
  severity: "error",
  validate(output) {
    return output.trim().length > 0 ? null : "Output is empty";
  },
};

/**
 * Rule: output must have at least N newlines (a rough proxy for structure).
 */
export function minLinesRule(minLines: number): ValidationRule {
  return {
    id: `min-lines-${minLines}`,
    description: `Output must have at least ${minLines} lines`,
    severity: "warn",
    validate(output) {
      const lines = output.split("\n").filter((l) => l.trim().length > 0).length;
      return lines >= minLines ? null : `Output has ${lines} non-empty lines, expected at least ${minLines}`;
    },
  };
}

/**
 * Rule: output must be valid JSON (for steps that return structured data).
 */
export const validJsonRule: ValidationRule = {
  id: "valid-json",
  description: "Output must be valid JSON",
  severity: "error",
  validate(output) {
    try {
      JSON.parse(output);
      return null;
    } catch {
      return "Output is not valid JSON";
    }
  },
};

/**
 * Rule: custom function.
 */
export function customRule(id: string, description: string, fn: (output: string) => string | null): ValidationRule {
  return {
    id,
    description,
    severity: "error",
    validate: fn,
  };
}

// ---------------------------------------------------------------------------
// Validator
// ---------------------------------------------------------------------------

/**
 * Validate a step's output against a set of rules.
 *
 * @param output - The raw text output from the step
 * @param rules - Validation rules to apply
 * @param context - Optional context passed to each rule's validate function
 * @returns ValidationSet with results
 */
export function validateStep(
  output: string,
  rules: ValidationRule[],
  context?: Record<string, unknown>,
): ValidationSet {
  const results: ValidationResult[] = [];
  let valid = true;
  let warnings = 0;
  let errors = 0;

  for (const rule of rules) {
    const errorMsg = rule.validate(output, context);
    const passed = errorMsg === null;

    if (!passed) {
      if (rule.severity === "error") {
        valid = false;
        errors++;
      } else {
        warnings++;
      }
    }

    results.push({
      ruleId: rule.id,
      description: rule.description,
      severity: rule.severity,
      passed,
      error: errorMsg ?? undefined,
    });
  }

  return { results, valid, warnings, errors };
}

/**
 * Validate a full pipeline run by validating each step's output.
 * Returns a map of stepId → ValidationSet.
 *
 * @param stepOutputs - Map of step ID to output text
 * @param stepRules - Map of step ID to array of validation rules
 * @returns Map of step ID to ValidationSet
 */
export function validatePipeline(
  stepOutputs: Map<string, string>,
  stepRules: Map<string, ValidationRule[]>,
): Map<string, ValidationSet> {
  const result = new Map<string, ValidationSet>();

  for (const [stepId, output] of stepOutputs) {
    const rules = stepRules.get(stepId) ?? [];
    result.set(stepId, validateStep(output, rules));
  }

  return result;
}
