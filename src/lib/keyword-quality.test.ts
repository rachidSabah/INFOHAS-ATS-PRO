// Unit tests for the shared keyword-quality filter.
//
// Regression context: JD keyword extraction (AI + heuristic fallback) emitted
// junk tokens ("Go", "Basic", "Job", "Company", "Group", "Ensure") which the
// pipeline then (a) reported as "missing keywords" recommendations and
// (b) injected as fake skills during degraded page-fill expansion
// ("Job-Relevant: Duty, Free, Ensure, Till, Assistant.").

import { describe, it, expect } from "vitest";
import { isJunkKeyword, filterJunkKeywords } from "./keyword-quality";

describe("keyword-quality (junk keyword filter)", () => {
  it("filters the junk tokens observed in production", () => {
    const input = ["Go", "Basic", "Job", "Airways", "Group", "Company", "Ensure", "Duty", "Free"];
    const output = filterJunkKeywords(input);
    // "airways" is meaningful (Qatar Airways) — kept as a standalone token.
    expect(output).toEqual(["Airways"]);
  });

  it("keeps meaningful single-word keywords", () => {
    const input = ["communication", "POS", "cash handling", "Till", "Assistant", "Qatar", "Excel"];
    const output = filterJunkKeywords(input);
    expect(output).toEqual(["communication", "POS", "cash handling", "Till", "Assistant", "Qatar", "Excel"]);
  });

  it("always keeps multi-word phrases, even with junk words inside", () => {
    expect(isJunkKeyword("duty free")).toBe(false);
    expect(isJunkKeyword("cash handling")).toBe(false);
    expect(isJunkKeyword("group work")).toBe(false);
    expect(isJunkKeyword("quality assurance")).toBe(false);
  });

  it("filters short, numeric, and non-string inputs", () => {
    expect(isJunkKeyword("go")).toBe(true);
    expect(isJunkKeyword("a")).toBe(true);
    expect(isJunkKeyword("123")).toBe(true);
    expect(isJunkKeyword(42)).toBe(true);
    expect(isJunkKeyword(null)).toBe(true);
    expect(isJunkKeyword(undefined)).toBe(true);
  });

  it("is case-insensitive and deduplicates, preserving first-seen order", () => {
    const output = filterJunkKeywords(["React", "react", "REACT", "Node.js", "job", "Node.js"]);
    expect(output).toEqual(["React", "Node.js"]);
  });

  it("returns an empty array for non-array input", () => {
    expect(filterJunkKeywords(null)).toEqual([]);
    expect(filterJunkKeywords(undefined)).toEqual([]);
    expect(filterJunkKeywords("not an array" as any)).toEqual([]);
  });

  it("trims whitespace before evaluating", () => {
    expect(filterJunkKeywords(["  React  ", " job "])).toEqual(["React"]);
  });
});
