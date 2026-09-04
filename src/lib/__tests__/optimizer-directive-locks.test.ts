import { describe, it, expect } from "vitest";
import { SEED_OPTIMIZER_DIRECTIVE } from "../mock-data";

// Locked directive invariants: these six switches must stay OFF.
// - Company/location names as skills trip a Structure Guardian veto and stall
//   optimization (Keyword-Guardian deadlock fix d29cde78).
// - Rewriting title/company/dates/location breaks entity integrity in the
//   locked pipeline (only bullet text may change).
// The UI renders them as locked (aria-disabled + explanation), never toggleable.
describe("optimizer directive locked invariants", () => {
  it("company/location keyword switches stay OFF in seed", () => {
    expect(SEED_OPTIMIZER_DIRECTIVE.agentDirectives.skills.allowCompanyKeywords).toBe(false);
    expect(SEED_OPTIMIZER_DIRECTIVE.agentDirectives.skills.allowLocationKeywords).toBe(false);
  });

  it("immutable-field switches stay OFF in seed", () => {
    const exp = SEED_OPTIMIZER_DIRECTIVE.agentDirectives.experience;
    expect(exp.rewriteTitle).toBe(false);
    expect(exp.rewriteCompany).toBe(false);
    expect(exp.rewriteDates).toBe(false);
    expect(exp.rewriteLocation).toBe(false);
  });

  it("functional neighbours stay ON (no collateral change)", () => {
    expect(SEED_OPTIMIZER_DIRECTIVE.agentDirectives.skills.allowTransferableSkills).toBe(true);
    expect(SEED_OPTIMIZER_DIRECTIVE.agentDirectives.experience.rewriteBulletsOnly).toBe(true);
  });
});
