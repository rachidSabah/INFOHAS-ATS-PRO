// ============================================================================
// PatchEngine — Unit Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import type { ResumeData } from "../../types";
import {
  applyPatches,
  validatePatch,
  detectConflicts,
  resolveConflict,
  rollbackPatches,
  computeQualityScore,
  createPatchId,
} from "../patch-engine";
import type {
  AgentPatch,
  PatchConflict,
  ConflictResolutionResult,
} from "../types";

// ── Helpers ───────────────────────────────────────────────────────────────
function makePatch(overrides: Partial<AgentPatch> & { sectionId: string; field: string; oldValue: string; newValue: string }): AgentPatch {
  return {
    patchId: createPatchId("test"),
    agentId: "test-agent",
    agentType: "professional-writing",
    confidence: 0.95,
    reason: "test improvement",
    ...overrides,
  };
}

function makeResume(): ResumeData {
  return {
    id: "test-resume-1",
    name: "John Doe",
    summary: "Experienced professional with skills in management.",
    headline: "Senior Manager",
    contact: { email: "john@example.com", phone: "+1234567890" },
    experience: [
      {
        id: "exp-1",
        company: "Acme Corp",
        title: "Manager",
        startDate: "2020-01",
        endDate: "2023-06",
        bullets: [
          "Led a team of 10 engineers.",
          "Improved efficiency by 20%.",
        ],
      },
      {
        id: "exp-2",
        company: "Beta Inc",
        title: "Senior Developer",
        startDate: "2018-03",
        endDate: "2020-01",
        bullets: [
          "Built REST API.",
          "Reduced deployment time.",
        ],
      },
    ],
    education: [
      {
        id: "edu-1",
        institution: "MIT",
        degree: "BS Computer Science",
        startDate: "2014-09",
        endDate: "2018-06",
        highlights: [
          "Dean's List",
          "AI Research Project",
        ],
      },
    ],
    skills: [
      { id: "skill-1", name: "JavaScript", category: "Programming" },
      { id: "skill-2", name: "Python", category: "Programming" },
      { id: "skill-3", name: "Project Management", category: "Management" },
    ],
    languages: [
      { id: "lang-1", name: "English", proficiency: "native" },
      { id: "lang-2", name: "French", proficiency: "fluent" },
    ],
    certifications: [],
    projects: [
      {
        id: "proj-1",
        name: "ResumeAI Pro",
        url: "https://github.com/example",
        bullets: ["Built ATS optimizer", "Multi-agent architecture"],
      },
    ],
    template: "ats-professional",
    createdAt: "2026-01-01",
    updatedAt: "2026-06-30",
  };
}

// ═══════════════════════════════════════════════════════════════════════════
// validatePatch
// ═══════════════════════════════════════════════════════════════════════════
describe("validatePatch", () => {
  it("returns no errors for a valid patch", () => {
    const patch = makePatch({
      sectionId: "experience_0",
      field: "bullet_0",
      oldValue: "Old text",
      newValue: "New improved text",
    });
    const errors = validatePatch(patch);
    expect(errors).toHaveLength(0);
  });

  it("rejects patch with missing patchId", () => {
    const patch = { ...makePatch({ sectionId: "summary", field: "text", oldValue: "old", newValue: "new" }), patchId: "" };
    const errors = validatePatch(patch);
    expect(errors).toContain("Missing patchId");
  });

  it("rejects patch with missing agentId", () => {
    const patch = { ...makePatch({ sectionId: "summary", field: "text", oldValue: "old", newValue: "new" }), agentId: "" };
    const errors = validatePatch(patch);
    expect(errors).toContain("Missing agentId");
  });

  it("rejects patch with no actual change", () => {
    const patch = makePatch({
      sectionId: "summary",
      field: "text",
      oldValue: "same text",
      newValue: "same text",
    });
    const errors = validatePatch(patch);
    expect(errors).toContain("Patch makes no change");
  });

  it("rejects patch with confidence out of range", () => {
    const patch = makePatch({
      sectionId: "summary",
      field: "text",
      oldValue: "old",
      newValue: "new",
      confidence: 1.5,
    });
    const errors = validatePatch(patch);
    expect(errors).toContain("Confidence out of range [0,1]");
  });

  it("rejects patch with missing reason", () => {
    const patch = {
      ...makePatch({ sectionId: "summary", field: "text", oldValue: "old", newValue: "new" }),
      reason: "",
    };
    const errors = validatePatch(patch);
    expect(errors).toContain("Missing reason");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Summary
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Summary", () => {
  it("updates summary text", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "summary",
      field: "text",
      oldValue: "Experienced professional with skills in management.",
      newValue: "Accomplished professional with expertise in strategic management and leadership.",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.resume.summary).toBe("Accomplished professional with expertise in strategic management and leadership.");
  });

  it("updates headline", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "headline",
      field: "text",
      oldValue: "Senior Manager",
      newValue: "Senior Engineering Manager",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.resume.headline).toBe("Senior Engineering Manager");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Experience Bullets
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Experience", () => {
  it("updates an experience bullet", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "experience_0",
      field: "bullet_0",
      oldValue: "Led a team of 10 engineers.",
      newValue: "Directed and mentored a cross-functional team of 10 engineers to deliver 15% faster product releases.",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(0);
    expect(result.resume.experience![0].bullets[0]).toBe("Directed and mentored a cross-functional team of 10 engineers to deliver 15% faster product releases.");
    // Ensure other bullets unchanged
    expect(result.resume.experience![0].bullets[1]).toBe("Improved efficiency by 20%.");
  });

  it("rejects patch if oldValue doesn't match current content", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "experience_1",
      field: "bullet_0",
      oldValue: "Different text that doesn't match",
      newValue: "Should not apply",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
    expect(result.resume.experience![1].bullets[0]).toBe("Built REST API.");
  });

  it("rejects company name changes as immutable", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "experience_0",
      field: "company",
      oldValue: "Acme Corp",
      newValue: "New Company Name",
      agentType: "ats-optimization",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });

  it("rejects title changes as immutable", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "experience_1",
      field: "title",
      oldValue: "Senior Developer",
      newValue: "Lead Engineer",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Education
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Education", () => {
  it("updates education highlights", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "education_0",
      field: "highlights[0]",
      oldValue: "Dean's List",
      newValue: "Dean's List — Top 5% of graduating class",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.resume.education![0].highlights![0]).toBe("Dean's List — Top 5% of graduating class");
  });

  it("rejects institution changes as immutable", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "education_0",
      field: "institution",
      oldValue: "MIT",
      newValue: "Stanford",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });

  it("rejects degree changes as immutable", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "education_0",
      field: "degree",
      oldValue: "BS Computer Science",
      newValue: "MS Computer Science",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Skills
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Skills", () => {
  it("updates skill category", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "skill_0",
      field: "category",
      oldValue: "Programming",
      newValue: "Programming Languages",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.resume.skills![0].category).toBe("Programming Languages");
  });

  it("updates skill name", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "skill_1",
      field: "name",
      oldValue: "Python",
      newValue: "Python (Django, FastAPI)",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.resume.skills![1].name).toBe("Python (Django, FastAPI)");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Languages (immutable)
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Languages", () => {
  it("rejects language patches as immutable", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "language_0",
      field: "language",
      oldValue: "English",
      newValue: "English (Native)",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(0);
    expect(result.failed).toHaveLength(1);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Projects
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Projects", () => {
  it("updates project bullet", () => {
    const resume = makeResume();
    const patch = makePatch({
      sectionId: "project_0",
      field: "bullet_0",
      oldValue: "Built ATS optimizer",
      newValue: "Engineered a comprehensive ATS optimization engine with multi-agent architecture",
    });

    const result = applyPatches(resume, [patch]);
    expect(result.applied).toHaveLength(1);
    expect(result.resume.projects![0].bullets[0]).toBe("Engineered a comprehensive ATS optimization engine with multi-agent architecture");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// applyPatches — Multiple patches
// ═══════════════════════════════════════════════════════════════════════════
describe("applyPatches — Multiple", () => {
  it("applies multiple valid patches", () => {
    const resume = makeResume();
    const patches = [
      makePatch({
        sectionId: "summary",
        field: "text",
        oldValue: "Experienced professional with skills in management.",
        newValue: "Accomplished professional with expertise in management.",
      }),
      makePatch({
        sectionId: "experience_0",
        field: "bullet_0",
        oldValue: "Led a team of 10 engineers.",
        newValue: "Directed a team of 10 engineers.",
      }),
      makePatch({
        sectionId: "education_0",
        field: "highlights[0]",
        oldValue: "Dean's List",
        newValue: "Dean's List honoree",
      }),
    ];

    const result = applyPatches(resume, patches);
    expect(result.applied).toHaveLength(3);
    expect(result.failed).toHaveLength(0);
    expect(result.resume.summary).toBe("Accomplished professional with expertise in management.");
    expect(result.resume.experience![0].bullets[0]).toBe("Directed a team of 10 engineers.");
    expect(result.resume.education![0].highlights![0]).toBe("Dean's List honoree");
  });

  it("applies only valid patches and returns failed ones", () => {
    const resume = makeResume();
    const patches = [
      makePatch({
        sectionId: "summary",
        field: "text",
        oldValue: "Experienced professional with skills in management.",
        newValue: "Improved summary.",
      }),
      makePatch({
        sectionId: "experience_0",
        field: "company", // immutable — will fail
        oldValue: "Acme Corp",
        newValue: "New Corp",
      }),
    ];

    const result = applyPatches(resume, patches);
    expect(result.applied).toHaveLength(1);
    expect(result.failed).toHaveLength(1);
    expect(result.resume.summary).toBe("Improved summary.");
    expect(result.resume.experience![0].company).toBe("Acme Corp"); // unchanged
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// detectConflicts
// ═══════════════════════════════════════════════════════════════════════════
describe("detectConflicts", () => {
  it("returns empty for patches on different fields", () => {
    const patches = [
      makePatch({ sectionId: "summary", field: "text", oldValue: "a", newValue: "b" }),
      makePatch({ sectionId: "experience_0", field: "bullet_0", oldValue: "c", newValue: "d", agentId: "ats" }),
    ];

    const conflicts = detectConflicts(patches);
    expect(conflicts).toHaveLength(0);
  });

  it("detects conflict when two agents patch same field", () => {
    const patches = [
      makePatch({ sectionId: "summary", field: "text", oldValue: "Original", newValue: "ATS version", agentId: "ats-1", agentType: "ats-optimization" }),
      makePatch({ sectionId: "summary", field: "text", oldValue: "Original", newValue: "Grammar version", agentId: "grammar-1", agentType: "professional-writing" }),
    ];

    const conflicts = detectConflicts(patches);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].sectionId).toBe("summary");
    expect(conflicts[0].field).toBe("text");
  });

  it("does not conflict when same agent patches same field (shouldn't happen but safe)", () => {
    const patches = [
      makePatch({ sectionId: "summary", field: "text", oldValue: "Original", newValue: "Version 1", agentId: "same-agent" }),
      makePatch({ sectionId: "summary", field: "text", oldValue: "Original", newValue: "Version 2", agentId: "same-agent" }),
    ];

    const conflicts = detectConflicts(patches);
    expect(conflicts).toHaveLength(0);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// resolveConflict
// ═══════════════════════════════════════════════════════════════════════════
describe("resolveConflict", () => {
  function makeConflict(): PatchConflict {
    return {
      patchA: makePatch({
        sectionId: "summary",
        field: "text",
        oldValue: "Original",
        newValue: "ATS optimized summary with keywords",
        agentId: "ats-1",
        agentType: "ats-optimization",
        confidence: 0.85,
      }),
      patchB: makePatch({
        sectionId: "summary",
        field: "text",
        oldValue: "Original",
        newValue: "Grammatically improved summary",
        agentId: "grammar-1",
        agentType: "professional-writing",
        confidence: 0.95,
      }),
      sectionId: "summary",
      field: "text",
      resolution: "reject-both",
    };
  }

  it("confidence-wins: selects patch with higher confidence", () => {
    const conflict = makeConflict();
    const result = resolveConflict(conflict, "confidence-wins");
    expect(result.resolved).toBe(true);
    expect(result.winner!.agentId).toBe("grammar-1"); // 0.95 > 0.85
  });

  it("ats-wins: prefers ATS optimization agent", () => {
    const conflict = makeConflict();
    const result = resolveConflict(conflict, "ats-wins");
    expect(result.resolved).toBe(true);
    expect(result.winner!.agentType).toBe("ats-optimization");
  });

  it("grammar-wins: prefers professional writing agent", () => {
    const conflict = makeConflict();
    const result = resolveConflict(conflict, "grammar-wins");
    expect(result.resolved).toBe(true);
    expect(result.winner!.agentType).toBe("professional-writing");
  });

  it("preservation-wins: prefers the patch with smaller content change", () => {
    const conflict = makeConflict();
    const result = resolveConflict(conflict, "preservation-wins");
    // "Grammatically improved summary" (29 chars) is closer to "Original" (8 chars)
    // than "ATS optimized summary with keywords" (35 chars)
    expect(result.resolved).toBe(true);
    // B has smaller length change: |29-8|=21 vs |35-8|=27
    expect(result.winner!.agentId).toBe("grammar-1");
  });

  it("latest-wins: selects patchB", () => {
    const conflict = makeConflict();
    const result = resolveConflict(conflict, "latest-wins");
    expect(result.resolved).toBe(true);
    expect(result.winner!.agentId).toBe("grammar-1");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// rollbackPatches
// ═══════════════════════════════════════════════════════════════════════════
describe("rollbackPatches", () => {
  it("reverses a set of patches", () => {
    const resume = makeResume();
    const patches = [
      makePatch({
        sectionId: "summary",
        field: "text",
        oldValue: "Experienced professional with skills in management.",
        newValue: "Rolled forward text.",
      }),
    ];

    // Apply
    const applied = applyPatches(resume, patches);
    expect(applied.resume.summary).toBe("Rolled forward text.");

    // Rollback
    const rolled = rollbackPatches(applied.resume, patches);
    expect(rolled.resume.summary).toBe("Experienced professional with skills in management.");
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// computeQualityScore
// ═══════════════════════════════════════════════════════════════════════════
describe("computeQualityScore", () => {
  it("returns 100 for empty patches (no changes needed)", () => {
    const resume = makeResume();
    const score = computeQualityScore(resume, []);
    expect(score).toBe(100);
  });

  it("returns higher score for more high-confidence patches", () => {
    const resume = makeResume();
    const highConfPatches = [
      makePatch({ sectionId: "summary", field: "text", oldValue: "a", newValue: "b", confidence: 0.98 }),
      makePatch({ sectionId: "experience_0", field: "bullet_0", oldValue: "c", newValue: "d", confidence: 0.97 }),
    ];
    const lowConfPatches = [
      makePatch({ sectionId: "summary", field: "text", oldValue: "a", newValue: "b", confidence: 0.72 }),
      makePatch({ sectionId: "experience_0", field: "bullet_0", oldValue: "c", newValue: "d", confidence: 0.68 }),
    ];

    const highScore = computeQualityScore(resume, highConfPatches);
    const lowScore = computeQualityScore(resume, lowConfPatches);
    expect(highScore).toBeGreaterThan(lowScore);
  });
});
