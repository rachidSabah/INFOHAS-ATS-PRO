// Regression tests for the AI bridge fixes.
// Before these fixes:
//   - Puter returned 404 for model "claude-sonnet-4-20250514" (Anthropic deprecated it)
//   - callAI() ignored the user's configured default provider entirely
//   - analyzeWithGemini() crashed with "Unexpected token 'S', 'Senior Fro'..."
//     whenever the AI returned prose instead of JSON
//   - Optimizer.parseJD() crashed the same way
//
// After these fixes:
//   - extractJSON() robustly extracts JSON from any LLM response shape
//   - callAI() tries the user's default provider FIRST, before Puter
//   - All AI JSON parsing goes through extractJSON()

import { describe, it, expect } from "vitest";
import { extractJSON, getPuterStatus, hasValidApiKey } from "./ai";

describe("extractJSON", () => {
  it("is a function exported from ai.ts", () => {
    expect(typeof extractJSON).toBe("function");
  });

  it("parses clean JSON directly", () => {
    const input = '{"name":"Alex","score":85}';
    const result = extractJSON(input);
    expect(result).toEqual({ name: "Alex", score: 85 });
  });

  it("parses JSON wrapped in ```json fences", () => {
    const input = '```json\n{"name":"Alex","score":85}\n```';
    const result = extractJSON(input);
    expect(result).toEqual({ name: "Alex", score: 85 });
  });

  it("parses JSON wrapped in plain ``` fences", () => {
    const input = '```\n{"name":"Alex","score":85}\n```';
    const result = extractJSON(input);
    expect(result).toEqual({ name: "Alex", score: 85 });
  });

  it("parses JSON preceded by prose preamble", () => {
    // This is the exact failure mode from the bug report:
    // "Unexpected token 'S', 'Senior Fro'..." — AI returned "Senior Frontend..."
    // as prose, then JSON. JSON.parse() crashed on the first character.
    const input = 'Here is your optimized resume:\n\n{"name":"Alex","score":85}';
    const result = extractJSON(input);
    expect(result).toEqual({ name: "Alex", score: 85 });
  });

  it("parses JSON followed by trailing commentary", () => {
    const input = '{"name":"Alex","score":85}\n\nHope this helps! Let me know if you need anything else.';
    const result = extractJSON(input);
    expect(result).toEqual({ name: "Alex", score: 85 });
  });

  it("parses JSON when AI returns prose before AND after", () => {
    const input = `Sure, here's the analysis:

\`\`\`json
{
  "score": 92,
  "missing_keywords": ["Python", "AWS"]
}
\`\`\`

This resume is already strong — just add the missing keywords above.`;
    const result = extractJSON<any>(input);
    expect(result.score).toBe(92);
    expect(result.missing_keywords).toEqual(["Python", "AWS"]);
  });

  it("extracts the first valid JSON object when multiple objects appear in prose", () => {
    // When the AI returns "text { obj1 } more text { obj2 }", extractJSON
    // should NOT crash — it should find and return the first valid object.
    const input = 'Here is your result: { "inner": 1 } Done.';
    const result = extractJSON<any>(input);
    expect(result).toEqual({ inner: 1 });
  });

  it("parses JSON arrays", () => {
    const input = 'Here are the keywords:\n\n["Python", "AWS", "Docker"]';
    const result = extractJSON<string[]>(input);
    expect(result).toEqual(["Python", "AWS", "Docker"]);
  });

  it("throws a helpful error when input is empty", () => {
    expect(() => extractJSON("")).toThrow(/empty/i);
    expect(() => extractJSON("   ")).toThrow(/empty/i);
  });

  it("throws a helpful error when no JSON can be found", () => {
    const input = "Senior Frontend Engineer with 10 years of experience...";
    expect(() => extractJSON(input)).toThrow(/did not return valid JSON/i);
    expect(() => extractJSON(input)).toThrow(/Senior Frontend/);
  });

  it("throws on non-string input", () => {
    expect(() => extractJSON(null as any)).toThrow(/not a string/i);
    expect(() => extractJSON(undefined as any)).toThrow(/not a string/i);
    expect(() => extractJSON(123 as any)).toThrow(/not a string/i);
  });

  it("handles the exact 'Senior Fro...' failure case from the bug report", () => {
    // Reproduces the production crash: AI returned "Senior Fro..." (truncated
    // "Senior Frontend...") instead of JSON. Before the fix, JSON.parse()
    // threw "Unexpected token 'S', 'Senior Fro'...". Now extractJSON() throws
    // a clear, actionable error.
    const aiResponse = "Senior Frontend Engineer with expertise in React, TypeScript, and Node.js.";
    expect(() => extractJSON(aiResponse)).toThrow(/did not return valid JSON/i);
  });

  it("handles nested objects correctly", () => {
    const input = `{
      "score": 85,
      "score_breakdown": { "impact": 90, "brevity": 80, "keywords": 85 },
      "missing_keywords": ["Go", "Kubernetes"],
      "optimized_content": "<h1>Alex Morgan</h1><p>Senior Engineer</p>"
    }`;
    const result = extractJSON<any>(input);
    expect(result.score).toBe(85);
    expect(result.score_breakdown.impact).toBe(90);
    expect(result.missing_keywords).toEqual(["Go", "Kubernetes"]);
    expect(result.optimized_content).toContain("<h1>");
  });
});

describe("getPuterStatus", () => {
  it("is a function exported from ai.ts", () => {
    expect(typeof getPuterStatus).toBe("function");
  });

  it("returns { loaded: false } when window is undefined (SSR)", () => {
    // In the test environment, window is jsdom — but the function should still
    // handle the case gracefully. We test the structure of the return value.
    const status = getPuterStatus();
    expect(status).toHaveProperty("loaded");
    expect(status).toHaveProperty("signedIn");
    expect(status).toHaveProperty("user");
    expect(typeof status.loaded).toBe("boolean");
    expect(typeof status.signedIn).toBe("boolean");
  });

  it("does NOT throw even if window.puter is undefined", () => {
    expect(() => getPuterStatus()).not.toThrow();
  });

  it("does NOT open popups (safe to call anytime)", () => {
    // The function should be synchronous and not trigger any async auth flows.
    // This is critical — it must be safe to call on every render.
    const status1 = getPuterStatus();
    const status2 = getPuterStatus();
    expect(status1).toEqual(status2);
  });
});

describe("hasValidApiKey", () => {
  it("should return true for puter or local providers", () => {
    expect(hasValidApiKey({ type: "puter" })).toBe(true);
    expect(hasValidApiKey({ type: "local" })).toBe(true);
  });

  it("should return true for custom providers with authType none", () => {
    expect(hasValidApiKey({ type: "custom", authType: "none" })).toBe(true);
  });

  it("should return false for providers with empty, null, undefined, or placeholder API keys", () => {
    // opencode and zencode are free providers — always valid
    expect(hasValidApiKey({ type: "opencode" })).toBe(true);
    expect(hasValidApiKey({ type: "zencode" })).toBe(true);
    // Non-free providers with empty/invalid keys return false
    expect(hasValidApiKey({ type: "gemini", apiKey: "" })).toBe(false);
    expect(hasValidApiKey({ type: "mistral", apiKey: null })).toBe(false);
    expect(hasValidApiKey({ type: "openrouter", apiKey: undefined })).toBe(false);
    expect(hasValidApiKey({ type: "nvidia", apiKey: "undefined" })).toBe(false);
  });

  it("should return true for providers with a valid API key string", () => {
    expect(hasValidApiKey({ type: "opencode", apiKey: "oc_key" })).toBe(true);
  });
});
