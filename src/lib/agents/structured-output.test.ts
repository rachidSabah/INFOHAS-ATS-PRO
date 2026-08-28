// ============================================================================
// Structured-output foundation tests — items #1/#3 (structured outputs +
// bounded parse-error repair round). Pure functions — no store, no network.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import {
  parseAgentJSON,
  runWithParseRepair,
  validateAgainstSchema,
  type SchemaSpec,
} from "./structured-output";

const REFLECTION_SCHEMA: SchemaSpec = {
  type: "object",
  required: ["issues", "suggestions", "confidence"],
  properties: {
    issues: { type: "array", items: { type: "string" } },
    suggestions: { type: "array", items: { type: "string" } },
    confidence: { type: "number" },
  },
  label: "reflection verdict",
};

describe("parseAgentJSON", () => {
  it("parses clean JSON without repairs", () => {
    const r = parseAgentJSON('{"issues":[],"suggestions":[],"confidence":90}', REFLECTION_SCHEMA);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.data).toEqual({ issues: [], suggestions: [], confidence: 90 });
      expect(r.repairs).toHaveLength(0);
    }
  });

  it("parses prose-wrapped JSON (the case that killed bare JSON.parse)", () => {
    const raw = `Here is the reflection verdict:\n\n\`\`\`json\n{"issues":["weak summary"],"suggestions":["add metrics"],"confidence":72}\n\`\`\`\n\nLet me know if you need more.`;
    const r = parseAgentJSON(raw, REFLECTION_SCHEMA);
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any).confidence).toBe(72);
  });

  it("repairs truncated JSON (missing closing braces)", () => {
    const raw = '{"issues":["a","b"],"suggestions":["c"],"confidence":6';
    const r = parseAgentJSON(raw, REFLECTION_SCHEMA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repairs.length).toBeGreaterThan(0);
  });

  it("repairs trailing commas", () => {
    const raw = '{"issues":["a"],"suggestions":["b"],"confidence":80,}';
    const r = parseAgentJSON(raw, REFLECTION_SCHEMA);
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.repairs).toContain("Removed trailing comma(s)");
  });

  it("parses a top-level JSON array (interview questions)", () => {
    const r = parseAgentJSON('[{"question":"Q1"},{"question":"Q2"}]', {
      type: "array", minLength: 1, items: { type: "object", required: ["question"] },
    });
    expect(r.ok).toBe(true);
    if (r.ok) expect((r.data as any[]).length).toBe(2);
  });

  it("returns a structured failure (never throws) for garbage", () => {
    const r = parseAgentJSON("The service is temporarily unavailable, please retry.", REFLECTION_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/invalid JSON|schema/);
  });

  it("reports schema violations with field paths", () => {
    const r = parseAgentJSON('{"issues":"not-an-array","confidence":"high"}', REFLECTION_SCHEMA);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.error).toMatch(/schema violations/);
  });

  it("rejects empty input", () => {
    expect(parseAgentJSON("   ", REFLECTION_SCHEMA).ok).toBe(false);
  });
});

describe("validateAgainstSchema", () => {
  it("checks nested property types", () => {
    const schema: SchemaSpec = {
      type: "object", required: ["questions"],
      properties: { questions: { type: "array", minLength: 2, items: { type: "object", required: ["q"] } } },
    };
    const v = validateAgainstSchema({ questions: [{ q: "a" }, { wrong: 1 }] }, schema);
    expect(v).toHaveLength(1);
    expect(v[0]).toMatch(/questions\[1\]\.q/);
  });

  it("honors enum constraints", () => {
    const v = validateAgainstSchema("banana", { type: "string", enum: ["apple", "pear"] });
    expect(v).toHaveLength(1);
  });
});

describe("runWithParseRepair", () => {
  it("returns the first good parse with zero repair rounds", async () => {
    const invoke = vi.fn().mockResolvedValue('{"issues":[],"suggestions":[],"confidence":95}');
    const { data, repairRounds } = await runWithParseRepair(invoke, REFLECTION_SCHEMA, { label: "test" });
    expect(repairRounds).toBe(0);
    expect((data as any).confidence).toBe(95);
    expect(invoke).toHaveBeenCalledTimes(1);
    expect(invoke).toHaveBeenCalledWith(undefined);
  });

  it("repairs once by feeding the parse error back into the invocation", async () => {
    const invoke = vi.fn()
      .mockResolvedValueOnce("Sure! Here is your answer: not-json-at-all")
      .mockResolvedValueOnce('{"issues":["x"],"suggestions":["y"],"confidence":60}');
    const { data, repairRounds } = await runWithParseRepair(invoke, REFLECTION_SCHEMA, { label: "Reflection" });

    expect(repairRounds).toBe(1);
    expect((data as any).issues).toEqual(["x"]);
    expect(invoke).toHaveBeenCalledTimes(2);
    const feedback = invoke.mock.calls[1][0] as string;
    expect(feedback).toMatch(/COULD NOT BE PARSED/);
    expect(feedback).toMatch(/Return ONLY the valid JSON/);
  });

  it("throws honestly after the bounded attempts are exhausted", async () => {
    const invoke = vi.fn().mockResolvedValue("garbage every time");
    await expect(
      runWithParseRepair(invoke, REFLECTION_SCHEMA, { label: "QA", maxRepairRounds: 1 })
    ).rejects.toThrow(/parse failed after 2 attempt/);
    expect(invoke).toHaveBeenCalledTimes(2);
  });

  it("supports zero repair rounds (parse-only hardening)", async () => {
    const invoke = vi.fn().mockResolvedValue("still garbage");
    await expect(
      runWithParseRepair(invoke, REFLECTION_SCHEMA, { maxRepairRounds: 0 })
    ).rejects.toThrow(/after 1 attempt/);
    expect(invoke).toHaveBeenCalledTimes(1);
  });
});
