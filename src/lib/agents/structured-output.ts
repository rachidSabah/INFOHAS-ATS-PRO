// ============================================================================
// Structured-output foundation — DIRECTIVE: agents never free-parse LLM text.
//
// Every agent that expects structured data from an LLM goes through:
//   1. parseAgentJSON()      — robust extraction cascade (extractJSON →
//                              repairMalformedJSON) with a STRUCTURAL schema
//                              check, returning a typed result instead of
//                              throwing.
//   2. runWithParseRepair()  — bounded parse-error repair: when parsing fails,
//                              the model is re-invoked ONCE with the exact
//                              parse error fed back into the prompt (the same
//                              recovery pattern agentic models use for
//                              malformed tool calls). Never unbounded.
//
// Why: five call sites used bare JSON.parse (reflection/QA engines, interview
// plugin, content-expansion agent) — prose-wrapped, truncated or single-syntax-
// error output silently degraded to fallbacks. This module is the single
// repair path; isomorphic (no DOM/store access), fully unit-testable.
// ============================================================================

import { extractJSON } from "../ai";
import { repairMalformedJSON } from "../ai-response-processor";

// ---------------------------------------------------------------------------
// Minimal structural schema (hand-rolled on purpose: the repo's validators are
// dependency-free; zod is unused and wiring it in is a needless risk).
// ---------------------------------------------------------------------------

export interface SchemaSpec {
  /** Expected JSON type of the value. */
  type: "object" | "array" | "string" | "number" | "boolean";
  /** For objects: required property names. */
  required?: string[];
  /** For objects: per-property schemas (optional properties may be absent). */
  properties?: Record<string, SchemaSpec>;
  /** For arrays: schema applied to every element (when present). */
  items?: SchemaSpec;
  /** Allowed values (strings/numbers). */
  enum?: Array<string | number>;
  /** Minimum string length (strings) / array length (arrays). */
  minLength?: number;
  /** Human-readable label used in violation messages. */
  label?: string;
}

/** Validate a parsed value against a SchemaSpec — returns violation strings (empty = valid). */
export function validateAgainstSchema(value: unknown, schema: SchemaSpec, path = "root"): string[] {
  const violations: string[] = [];
  const label = schema.label ? ` (${schema.label})` : "";

  if (schema.type === "object") {
    if (typeof value !== "object" || value === null || Array.isArray(value)) {
      return [`${path}: expected object${label}, got ${Array.isArray(value) ? "array" : typeof value}`];
    }
    for (const key of schema.required ?? []) {
      if (!(key in (value as Record<string, unknown>))) {
        violations.push(`${path}.${key}: missing required property${label}`);
      }
    }
    for (const [key, propSchema] of Object.entries(schema.properties ?? {})) {
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined || v === null) continue; // optional/absent checked via `required`
      violations.push(...validateAgainstSchema(v, propSchema, `${path}.${key}`));
    }
    return violations;
  }

  if (schema.type === "array") {
    if (!Array.isArray(value)) {
      return [`${path}: expected array${label}, got ${typeof value}`];
    }
    if (schema.minLength !== undefined && value.length < schema.minLength) {
      violations.push(`${path}: expected at least ${schema.minLength} items${label}, got ${value.length}`);
    }
    if (schema.items) {
      value.forEach((el, i) => violations.push(...validateAgainstSchema(el, schema.items!, `${path}[${i}]`)));
    }
    return violations;
  }

  if (schema.type === "string") {
    if (typeof value !== "string") {
      violations.push(`${path}: expected string${label}, got ${typeof value}`);
    } else if (schema.minLength !== undefined && value.length < schema.minLength) {
      violations.push(`${path}: string shorter than ${schema.minLength}${label}`);
    } else if (schema.enum && !schema.enum.includes(value)) {
      violations.push(`${path}: value "${value}" not in allowed set${label}`);
    }
    return violations;
  }

  if (schema.type === "number") {
    if (typeof value !== "number" || Number.isNaN(value)) {
      violations.push(`${path}: expected number${label}, got ${typeof value}`);
    } else if (schema.enum && !schema.enum.includes(value)) {
      violations.push(`${path}: value ${value} not in allowed set${label}`);
    }
    return violations;
  }

  // boolean
  if (typeof value !== "boolean") {
    violations.push(`${path}: expected boolean${label}, got ${typeof value}`);
  }
  return violations;
}

// ---------------------------------------------------------------------------
// Robust parse cascade
// ---------------------------------------------------------------------------

export interface ParseSuccess<T> { ok: true; data: T; repairs: string[] }
export interface ParseFailure { ok: false; error: string; repairs: string[] }

/** Last-resort loose parse: returns undefined instead of throwing. */
function extractJSONLoose(text: string): unknown {
  try {
    return JSON.parse(text.trim());
  } catch {
    return undefined;
  }
}

/**
 * Parse an LLM response into structured data — NEVER throws.
 * Cascade: extractJSON (fence strip + brace scan) → repairMalformedJSON
 * (truncation repair) → schema validation. On total failure returns a
 * structured error suitable for feeding back into a repair round.
 */
export function parseAgentJSON<T = unknown>(raw: string, schema?: SchemaSpec): ParseSuccess<T> | ParseFailure {
  const text = String(raw ?? "");
  if (!text.trim()) {
    return { ok: false, error: "empty response", repairs: [] };
  }

  let data: unknown;
  const repairs: string[] = [];

  try {
    data = extractJSON<unknown>(text);
  } catch (extractErr) {
    // Truncated / unbalanced output — attempt deterministic repair.
    const repaired = repairMalformedJSON(text);
    repairs.push(...repaired.repairs);
    if (repaired.json === null) {
      // Last deterministic strategy: strip trailing commas (",}" / ",]")
      // — a frequent single-syntax LLM error no other utility handles.
      const deTrailing = extractJSONLoose(text.replace(/,(\s*[}\]])/g, "$1"));
      if (deTrailing !== undefined) {
        data = deTrailing;
        repairs.push("Removed trailing comma(s)");
      } else {
        return {
          ok: false,
          error: `invalid JSON: ${(extractErr as Error)?.message ?? "unparseable"}`,
          repairs,
        };
      }
    } else {
      data = repaired.json;
    }
  }

  if (data === null || data === undefined) {
    return { ok: false, error: "parsed value is null/undefined", repairs };
  }

  if (schema) {
    const violations = validateAgainstSchema(data, schema);
    if (violations.length > 0) {
      return { ok: false, error: `schema violations: ${violations.slice(0, 5).join("; ")}`, repairs };
    }
  }

  return { ok: true, data: data as T, repairs };
}

// ---------------------------------------------------------------------------
// Bounded parse-error repair round
// ---------------------------------------------------------------------------

export interface ParseRepairOptions {
  /** Max repair re-invocations (default 1 — bounded by design). */
  maxRepairRounds?: number;
  /** Label used in the repair feedback (e.g. "Reflection Agent"). */
  label?: string;
}

/**
 * Invoke an LLM call and parse its output; on parse/schema failure, re-invoke
 * ONCE (bounded) with the exact parse error fed back into the invocation.
 *
 * @param invoke  receives the repair feedback string on repair rounds
 *                (undefined on the first call); returns the RAW response text.
 * @param schema  optional structural schema the parsed data must satisfy.
 */
export async function runWithParseRepair<T>(
  invoke: (repairFeedback: string | undefined) => Promise<string>,
  schema: SchemaSpec | undefined,
  opts: ParseRepairOptions = {}
): Promise<{ data: T; repairRounds: number; repairs: string[] }> {
  const maxRounds = Math.max(0, opts.maxRepairRounds ?? 1);
  const label = opts.label ?? "agent";

  let feedback: string | undefined;
  let lastError = "";
  let allRepairs: string[] = [];

  for (let round = 0; round <= maxRounds; round++) {
    const raw = await invoke(feedback);
    const parsed = parseAgentJSON<T>(raw, schema);
    allRepairs = [...allRepairs, ...parsed.repairs];
    if (parsed.ok) {
      return { data: parsed.data, repairRounds: round, repairs: allRepairs };
    }
    lastError = parsed.error;
    if (round < maxRounds) {
      feedback = [
        `YOUR PREVIOUS RESPONSE COULD NOT BE PARSED as valid JSON${schema?.label ? ` for "${schema.label}"` : ""}.`,
        `Parse error: ${lastError}`,
        `Return ONLY the valid JSON value — no markdown fences, no prose before or after, no trailing commas. Complete every property you started.`,
      ].join("\n");
    }
  }

  throw new Error(`${label} structured-output parse failed after ${maxRounds + 1} attempt(s): ${lastError}`);
}
