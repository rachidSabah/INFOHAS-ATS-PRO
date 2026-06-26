// ============================================================================
// Regression Tests — Resume Optimizer Stabilization
//
// Tests for all the corruption classes that were observed in production:
//   - Missing company names
//   - Missing dates
//   - Duplicated experiences
//   - Hallucinated employers
//   - Hallucinated education
//   - Hallucinated languages
//   - Company names as skills
//   - Keyword stuffing
//   - Malformed summaries
//   - Immutable IDs
//   - Fingerprints
//   - Bullet-only optimization
//   - Assembler rendering
// ============================================================================

import { describe, it, expect, afterEach } from "vitest";
import { finalizeResume, restoreLockedEntities, deduplicateResume } from "../unified-pipeline";
import { computeExperienceFingerprint, validateExperienceFingerprints } from "../experience-fingerprint";
import { assembleResume } from "../resume-assembler";
import { runStructureGuardian } from "../structure-guardian";
import { validateParserIntegrity } from "../production-patch-v1_1-modules";
import { matchExperienceEntry } from "../pipeline-orchestration-modules";
import type { ResumeData } from "../types";
import { enforceLockedFields } from "../agents/orchestrator";
import { buildOptimizerInput } from "../bullet-only-optimizer";
import { isOpenCodeZenFree, getRecommendedFallbacks, getProviderCapabilities } from "../provider-capabilities";
import { parseResumeText } from "../parser";

// ============================================================================
// Test Fixtures
// ============================================================================

const sourceResume: ResumeData = {
  id: "res_test_1",
  name: "Jane Doe",
  headline: "Customer Service Professional",
  contact: { email: "jane@example.com", phone: "+1234567890", location: "Rabat, Morocco" },
  summary: "Experienced customer service professional with 5 years in retail.",
  experience: [
    {
      id: "exp_001",
      title: "Receptionist",
      company: "Hotel Atlas",
      location: "Rabat, Morocco",
      startDate: "Jan 2022",
      endDate: "Mar 2023",
      bullets: [
        "Managed front desk operations.",
        "Handled guest inquiries.",
      ],
    },
    {
      id: "exp_002",
      title: "Intern",
      company: "",
      location: "",
      startDate: "Jun 2021",
      endDate: "Aug 2021",
      bullets: [
        "Assisted with administrative tasks.",
      ],
    },
    {
      id: "exp_003",
      title: "Sales Assistant",
      company: "Madini Perfume Shop",
      location: "Casablanca, Morocco",
      startDate: "Sep 2020",
      endDate: "Dec 2020",
      bullets: [
        "Sold products to customers.",
        "Managed inventory.",
      ],
    },
  ],
  education: [
    {
      id: "ed_001",
      degree: "Hospitality Diploma",
      institution: "INFOHAS",
      location: "Rabat",
      startDate: "2023",
      endDate: "2025",
      highlights: [],
    },
  ],
  skills: [
    { id: "sk_1", name: "Customer Service", category: "General" },
    { id: "sk_2", name: "Communication", category: "General" },
  ],
  languages: [
    { id: "lang_1", name: "English", proficiency: "fluent" },
    { id: "lang_2", name: "French", proficiency: "fluent" },
    { id: "lang_3", name: "Arabic", proficiency: "fluent" },
  ],
  certifications: [],
  projects: [],
  template: "infohas-pro",
  accentColor: "#0563C1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "upload",
};

// ============================================================================
// 1. IMMUTABLE IDs
// ============================================================================

describe("Immutable Experience IDs", () => {
  it("preserves source IDs through finalizeResume", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: sourceResume.experience.map((e) => ({
        ...e,
        id: "WRONG_ID", // AI tried to change the ID
      })),
    };
    const result = finalizeResume(optimized, sourceResume);
    // finalizeResume uses index-based restore, so IDs come from source
    expect(result.experience[0].id).toBe("exp_001");
    expect(result.experience[1].id).toBe("exp_002");
    expect(result.experience[2].id).toBe("exp_003");
  });

  it("preserves source IDs through assembleResume", () => {
    const optimizerOutput = {
      experiences: [
        { id: "exp_001", bullets: ["New bullet 1"] },
        { id: "exp_002", bullets: ["New bullet 2"] },
        { id: "exp_003", bullets: ["New bullet 3"] },
      ],
    };
    const result = assembleResume(sourceResume, optimizerOutput);
    expect(result.resume.experience[0].id).toBe("exp_001");
    expect(result.resume.experience[1].id).toBe("exp_002");
    expect(result.resume.experience[2].id).toBe("exp_003");
  });
});

// ============================================================================
// 2. EXPERIENCE FINGERPRINTS
// ============================================================================

describe("Experience Fingerprints", () => {
  it("computes stable fingerprints", () => {
    const fp1 = computeExperienceFingerprint(sourceResume.experience[0]);
    const fp2 = computeExperienceFingerprint(sourceResume.experience[0]);
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(64); // 64 hex chars (SHA-256)
  });

  it("detects different fingerprints for different entries", () => {
    const fp1 = computeExperienceFingerprint(sourceResume.experience[0]);
    const fp2 = computeExperienceFingerprint(sourceResume.experience[1]);
    expect(fp1).not.toBe(fp2);
  });

  it("validates fingerprints after optimization", () => {
    const optimized = finalizeResume({ ...sourceResume }, sourceResume);
    const validation = validateExperienceFingerprints(optimized, sourceResume);
    expect(validation.valid).toBe(true);
    expect(validation.matched).toBe(3);
  });

  it("detects dropped entries", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: [sourceResume.experience[0]], // dropped 2 entries
    };
    const validation = validateExperienceFingerprints(optimized, sourceResume);
    expect(validation.valid).toBe(false);
    expect(validation.violations.length).toBeGreaterThan(0);
  });
});

// ============================================================================
// 3. BULLET-ONLY OPTIMIZATION
// ============================================================================

describe("Bullet-Only Optimization", () => {
  it("assembler preserves immutable fields, only changes bullets", () => {
    const optimizerOutput = {
      experiences: [
        {
          id: "exp_001",
          bullets: ["REWRITTEN: Managed front desk with 5-star service."],
        },
      ],
    };
    const result = assembleResume(sourceResume, optimizerOutput);
    // Immutable fields from source
    expect(result.resume.experience[0].title).toBe("Receptionist");
    expect(result.resume.experience[0].company).toBe("Hotel Atlas");
    expect(result.resume.experience[0].startDate).toBe("Jan 2022");
    expect(result.resume.experience[0].endDate).toBe("Mar 2023");
    // Bullets from optimizer
    expect(result.resume.experience[0].bullets[0]).toContain("REWRITTEN");
  });
});

// ============================================================================
// 4. COMPANY NAMES NOT IN SKILLS
// ============================================================================

describe("Skills Protection — No Company Names as Skills", () => {
  it("filters JD company names from skills", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      skills: [
        ...sourceResume.skills,
        { id: "sk_bad_1", name: "Qatar Duty Free", category: "Targeted" },
        { id: "sk_bad_2", name: "Qatar Airways Group", category: "Targeted" },
        { id: "sk_bad_3", name: "Hamad International Airport", category: "Targeted" },
        { id: "sk_bad_4", name: "Doha", category: "Targeted" },
        { id: "sk_good", name: "Sales", category: "Retail" },
      ],
    };
    const result = finalizeResume(optimized, sourceResume);
    const skillNames = result.skills.map((s) => s.name);
    expect(skillNames).not.toContain("Qatar Duty Free");
    expect(skillNames).not.toContain("Qatar Airways Group");
    expect(skillNames).not.toContain("Hamad International Airport");
    expect(skillNames).not.toContain("Doha");
    expect(skillNames).toContain("Sales");
    expect(skillNames).toContain("Customer Service");
  });
});

// ============================================================================
// 5. SUMMARY PROTECTION — NO DUPLICATES, NO DOUBLE PERIODS
// ============================================================================

describe("Summary Protection", () => {
  it("removes duplicate sentences from summary", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      summary: "Experienced professional. Experienced professional. Skilled in customer service.",
    };
    const result = finalizeResume(optimized, sourceResume);
    const sentences = result.summary!.split(/(?<=\.)\s+/);
    const seen = new Set(sentences.map((s) => s.toLowerCase().trim()));
    expect(sentences.length).toBe(seen.size);
  });

  it("removes double periods", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      summary: "Experienced professional.. Skilled in customer service.",
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.summary).not.toContain("..");
  });

  it("removes filler phrases", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      summary: "Professional demonstrating strong attention to detail. Committed to excellence in all assigned responsibilities.",
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.summary!.toLowerCase()).not.toContain("demonstrating strong attention to detail");
    expect(result.summary!.toLowerCase()).not.toContain("committed to excellence");
  });

  it("removes 'within <Title>' hallucinations from bullets", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: sourceResume.experience.map((e, i) => ({
        ...e,
        bullets: [
          `Managed front desk operations within Receptionist.`,
          `Assisted guests at Receptionist.`,
        ],
      })),
    };
    const result = finalizeResume(optimized, sourceResume);
    for (const exp of result.experience) {
      for (const bullet of exp.bullets) {
        expect(bullet.toLowerCase()).not.toContain("within receptionist");
        expect(bullet.toLowerCase()).not.toContain("at receptionist");
      }
    }
  });
});

// ============================================================================
// 6. NO HALLUCINATED EMPLOYERS
// ============================================================================

describe("No Hallucinated Employers", () => {
  it("rejects AI-invented company names", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: sourceResume.experience.map((e, i) => ({
        ...e,
        company: i === 1 ? "Beauty Retailer" : e.company, // AI hallucinated
      })),
    };
    const result = finalizeResume(optimized, sourceResume);
    // Company should be restored from source (empty string for exp_002)
    expect(result.experience[1].company).toBe("");
    expect(result.experience[1].company).not.toBe("Beauty Retailer");
  });
});

// ============================================================================
// 7. NO HALLUCINATED EDUCATION
// ============================================================================

describe("No Hallucinated Education", () => {
  it("restores education from source when AI drops it", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [], // AI dropped education
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.education.length).toBe(1);
    expect(result.education[0].institution).toBe("INFOHAS");
  });

  it("strips dates from institution field", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [{
        ...sourceResume.education[0],
        institution: "INFOHAS 2023 – 2025", // dates leaked into institution
      }],
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.education[0].institution).toBe("INFOHAS");
    expect(result.education[0].institution).not.toContain("2023");
  });
});

// ============================================================================
// 8. NO HALLUCINATED LANGUAGES
// ============================================================================

describe("No Hallucinated Languages", () => {
  it("restores languages from source when AI corrupts them", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      languages: [
        { id: "lang_bad", name: "", proficiency: "fluent" }, // corrupted: empty name
        { id: "lang_2", name: "French", proficiency: "fluent" },
      ],
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.languages.length).toBe(3); // restored from source
    expect(result.languages[0].name).toBe("English");
    expect(result.languages[1].name).toBe("French");
    expect(result.languages[2].name).toBe("Arabic");
  });
});

// ============================================================================
// 9. NO DUPLICATED EXPERIENCES
// ============================================================================

describe("No Duplicated Experiences", () => {
  it("removes duplicate experience entries", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: [
        ...sourceResume.experience,
        { ...sourceResume.experience[0] }, // duplicate
      ],
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.experience.length).toBe(3); // not 4
  });

  it("removes duplicate bullets within an entry", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: [{
        ...sourceResume.experience[0],
        bullets: [
          "Managed front desk operations.",
          "Managed front desk operations.", // exact duplicate
          "Handled guest inquiries.",
        ],
      }],
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.experience[0].bullets.length).toBe(2);
  });
});

// ============================================================================
// 10. HYBRID MATCHING
// ============================================================================

describe("Hybrid Matching Strategy", () => {
  it("matches by ID (strict)", () => {
    const result = matchExperienceEntry(
      { id: "exp_001", title: "Receptionist", company: "Hotel Atlas" },
      sourceResume,
      "strict",
      80,
    );
    expect(result.matched).toBe(true);
    expect(result.method).toBe("id");
    expect(result.confidence).toBe(100);
  });

  it("falls back to fingerprint in hybrid mode", () => {
    const result = matchExperienceEntry(
      { id: "WRONG_ID", title: "Receptionist", company: "Hotel Atlas", location: "Rabat, Morocco", startDate: "Jan 2022", endDate: "Mar 2023" },
      sourceResume,
      "hybrid",
      75,
    );
    expect(result.matched).toBe(true);
    expect(result.method).toBe("fingerprint");
  });

  it("falls back to title/company in fuzzy mode", () => {
    const result = matchExperienceEntry(
      { id: "WRONG_ID", title: "Receptionist", company: "Different Company" },
      sourceResume,
      "fuzzy",
      70,
    );
    expect(result.matched).toBe(true);
    expect(result.method).toBe("title-company");
  });
});

// ============================================================================
// 11. PARSER INTEGRITY VALIDATION
// ============================================================================

describe("Parser Integrity Validation", () => {
  it("detects merged language fields", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      languages: [
        { id: "lang_bad", name: "fluent", proficiency: "fluent" }, // name = proficiency
      ],
    };
    const result = validateParserIntegrity(corrupted);
    expect(result.valid).toBe(false);
    expect(result.blockingCount).toBeGreaterThan(0);
  });

  it("detects dates in institution field", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      education: [{
        ...sourceResume.education[0],
        institution: "INFOHAS 2023 – 2025",
      }],
    };
    const result = validateParserIntegrity(corrupted);
    expect(result.issues.some((i) => i.type === "education-corruption")).toBe(true);
  });

  it("passes valid resume", () => {
    const result = validateParserIntegrity(sourceResume);
    expect(result.blockingCount).toBe(0);
  });
});

// ============================================================================
// 12. STRUCTURE GUARDIAN
// ============================================================================

describe("Structure Guardian", () => {
  it("passes a clean resume", () => {
    const result = runStructureGuardian(sourceResume, sourceResume);
    expect(result.passed).toBe(true);
    expect(result.criticalIssues.length).toBe(0);
  });

  it("detects missing company on experience", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      experience: [{
        ...sourceResume.experience[0],
        company: "", // missing
      }],
    };
    const result = runStructureGuardian(corrupted, sourceResume);
    // Should warn about missing company (not critical since source may not have had one)
    expect(result.warnings.some((w) => w.includes("no company"))).toBe(true);
  });

  it("detects duplicate experience fingerprints", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      experience: [
        sourceResume.experience[0],
        { ...sourceResume.experience[0] }, // exact duplicate
      ],
    };
    const result = runStructureGuardian(corrupted, sourceResume);
    expect(result.criticalIssues.some((c) => c.includes("Duplicate experience fingerprint"))).toBe(true);
  });

  it("detects date changes", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      experience: [{
        ...sourceResume.experience[0],
        endDate: "Present", // AI injected "Present"
      }],
    };
    const result = runStructureGuardian(corrupted, sourceResume);
    expect(result.criticalIssues.some((c) => c.includes("endDate injected as"))).toBe(true);
  });
});

// ============================================================================
// 13. RESUME ASSEMBLER
// ============================================================================

describe("Resume Assembler", () => {
  it("merges source immutable + optimizer mutable", () => {
    const optimizerOutput = {
      summary: "New optimized summary with ATS keywords.",
      headline: "New Headline",
      skills: [{ name: "New Skill", category: "Tech" }],
      experiences: [
        { id: "exp_001", bullets: ["Rewritten bullet 1", "Rewritten bullet 2"] },
      ],
    };
    const result = assembleResume(sourceResume, optimizerOutput);

    // Mutable fields from optimizer
    expect(result.resume.summary).toBe("New optimized summary with ATS keywords.");
    expect(result.resume.skills.some((s) => s.name === "New Skill")).toBe(true);
    expect(result.resume.experience[0].bullets[0]).toBe("Rewritten bullet 1");

    // Immutable fields from source
    expect(result.resume.name).toBe("Jane Doe");
    expect(result.resume.experience[0].title).toBe("Receptionist");
    expect(result.resume.experience[0].company).toBe("Hotel Atlas");
    expect(result.resume.education[0].institution).toBe("INFOHAS");
    expect(result.resume.languages.length).toBe(3);
  });

  it("rejects headline with JD company names", () => {
    const optimizerOutput = {
      headline: "Till Assistant | Qatar Duty Free",
      experiences: [],
    };
    const result = assembleResume(sourceResume, optimizerOutput);
    expect(result.resume.headline).not.toContain("Qatar Duty Free");
    expect(result.resume.headline).toBe(sourceResume.headline);
  });

  it("matchedById when IDs match", () => {
    const optimizerOutput = {
      experiences: [{ id: "exp_001", bullets: ["New bullet"] }],
    };
    const result = assembleResume(sourceResume, optimizerOutput);
    expect(result.matchedById).toBe(1);
    // exp_002 and exp_003 weren't in the optimizer output — they get source bullets
    // (matchedByIndex counts entries that had no optimizer match)
    expect(result.matchedById + result.matchedByIndex + result.matchedByTitleCompany).toBeGreaterThanOrEqual(1);
  });
});

// ============================================================================
// 14. DEDUPLICATION
// ============================================================================

describe("Deduplication", () => {
  it("removes duplicate skills", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      skills: [
        { id: "sk_1", name: "Customer Service", category: "General" },
        { id: "sk_1_dup", name: "Customer Service", category: "General" }, // duplicate
        { id: "sk_2", name: "Communication", category: "General" },
      ],
    };
    const result = deduplicateResume(optimized);
    expect(result.resume.skills.length).toBe(2);
  });

  it("removes duplicate education entries", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [
        ...sourceResume.education,
        { ...sourceResume.education[0] }, // duplicate
      ],
    };
    const result = deduplicateResume(optimized);
    expect(result.resume.education.length).toBe(1);
  });
});

// ============================================================================
// 15. PROVIDER ALIAS & EXCLUSION MATCHING
// ============================================================================

import { getOrderedFallbackProviders, selectProvider } from "../ai";
import { useApp } from "../store";

describe("Resilient Provider Aliasing and Exclusion", () => {
  const originalState = useApp.getState();

  afterEach(() => {
    // Restore state after each test
    useApp.setState(originalState);
  });

  it("resolves exact provider ID", () => {
    useApp.setState({
      providers: [
        { id: "p_google_gemini", name: "Google Gemini", type: "google", isActive: true, apiKey: "test-key" }
      ],
      providerSettings: { defaultProviderId: "p_google_gemini" },
      fallbackChain: {
        enabled: true,
        entries: [
          { id: "entry_1", enabled: true, providerId: "p_google_gemini", model: "gemini-1.5-flash" }
        ]
      }
    } as any);

    const chain = getOrderedFallbackProviders();
    expect(chain.length).toBe(1);
    expect(chain[0].provider.id).toBe("p_google_gemini");
  });

  it("resolves provider by alias (e.g. p_google -> p_google_gemini)", () => {
    useApp.setState({
      providers: [
        { id: "p_google_gemini", name: "Google Gemini", type: "google", isActive: true, apiKey: "test-key" }
      ],
      providerSettings: {},
      fallbackChain: {
        enabled: true,
        entries: [
          { id: "entry_1", enabled: true, providerId: "p_google", model: "gemini-1.5-flash" }
        ]
      }
    } as any);

    const chain = getOrderedFallbackProviders();
    expect(chain.length).toBe(1);
    expect(chain[0].provider.id).toBe("p_google_gemini");
  });

  it("resolves provider by type (e.g. p_zencode -> zencode provider)", () => {
    useApp.setState({
      providers: [
        { id: "some_zencode_id", name: "ZenCode AI", type: "zencode", isActive: true, apiKey: "test-key" }
      ],
      providerSettings: {},
      fallbackChain: {
        enabled: true,
        entries: [
          { id: "entry_1", enabled: true, providerId: "p_zencode", model: "zencode-v1" }
        ]
      }
    } as any);

    const chain = getOrderedFallbackProviders();
    expect(chain.length).toBe(1);
    expect(chain[0].provider.type).toBe("zencode");
  });

  it("excludes specific provider IDs from fallback chain", () => {
    useApp.setState({
      providers: [
        { id: "p_google_gemini", name: "Google Gemini", type: "google", isActive: true, apiKey: "test-key" },
        { id: "p_mistral", name: "Mistral Large", type: "mistral", isActive: true, apiKey: "test-key" }
      ],
      providerSettings: {},
      fallbackChain: {
        enabled: true,
        entries: [
          { id: "entry_1", enabled: true, providerId: "p_google_gemini", model: "gemini-1.5-flash" },
          { id: "entry_2", enabled: true, providerId: "p_mistral", model: "mistral-large" }
        ]
      }
    } as any);

    const chain = getOrderedFallbackProviders("p_google_gemini");
    expect(chain.length).toBe(1);
    expect(chain[0].provider.id).toBe("p_mistral");
  });

  it("selectProvider respects excluded provider list", async () => {
    useApp.setState({
      providers: [
        { id: "p_google_gemini", name: "Google Gemini", type: "google", isActive: true, apiKey: "test-key" },
        { id: "p_mistral", name: "Mistral Large", type: "mistral", isActive: true, apiKey: "test-key" }
      ],
      providerSettings: { defaultProviderId: "p_google_gemini" }
    } as any);

    // Without exclusion
    const p1 = await selectProvider();
    expect(p1.id).toBe("p_google_gemini");

    // With exclusion of google_gemini, should return mistral
    const p2 = await selectProvider(["p_google_gemini"]);
    expect(p2.id).toBe("p_mistral");
  });
});

// ============================================================================
// 16. STRICT ID AND FINGERPRINT VALIDATION
// ============================================================================

describe("Strict ID and Fingerprint Validation", () => {
  it("fails validation when experience ID is missing", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: sourceResume.experience.map((e, idx) => ({
        ...e,
        id: idx === 0 ? "" : e.id, // missing ID
      })),
    };
    const validation = validateExperienceFingerprints(optimized, sourceResume);
    expect(validation.valid).toBe(false);
    expect(validation.violations.some((v) => v.includes("missing an ID"))).toBe(true);
  });

  it("fails validation when immutable experience field is changed (changed fingerprint)", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      experience: sourceResume.experience.map((e, idx) => ({
        ...e,
        company: idx === 0 ? "CHANGED COMPANY" : e.company, // changed company -> changed fingerprint
      })),
    };
    const validation = validateExperienceFingerprints(optimized, sourceResume);
    expect(validation.valid).toBe(false);
    expect(validation.violations.some((v) => v.includes("changed fingerprint"))).toBe(true);
  });
});

// ============================================================================
// 17. ENFORCE LOCKED FIELDS BULLET LENGTH FIX & DIRECTIVE CLEANING
// ============================================================================

describe("Enforce Locked Fields Bullet Length & Directive Cleaning", () => {
  it("preserves optimized bullets even when fewer than original", () => {
    const original: ResumeData = {
      ...sourceResume,
      experience: [
        {
          id: "exp_1",
          title: "Receptionist",
          company: "Hotel Atlas",
          location: "Rabat",
          startDate: "Jan 2022",
          endDate: "Mar 2023",
          bullets: ["Bullet 1", "Bullet 2", "Bullet 3", "Bullet 4"],
        },
      ],
    };
    const optimized: ResumeData = {
      ...original,
      experience: [
        {
          id: "exp_1",
          title: "Receptionist",
          company: "Hotel Atlas",
          location: "Rabat",
          startDate: "Jan 2022",
          endDate: "Mar 2023",
          bullets: ["Optimized 1", "Optimized 2"], // fewer bullets
        },
      ],
    };
    const locked = enforceLockedFields(optimized, original);
    expect(locked.experience[0].bullets.length).toBe(2);
    expect(locked.experience[0].bullets[0]).toBe("Optimized 1");
    expect(locked.experience[0].bullets[1]).toBe("Optimized 2");
  });

  it("buildOptimizerInput cleans full JSON output instructions from prompt", () => {
    const directiveConfig = {
      pageSize: "A4",
      marginTopMm: 10,
      marginBottomMm: 10,
      marginLeftMm: 10,
      marginRightMm: 10,
      fontFamily: "Arial",
      bodyFontSizePt: 10,
      sectionTitleSizePt: 12,
      nameSizePt: 14,
      nameColor: "#000",
      sectionTitleColor: "#000",
      bodyTextColor: "#000",
      lineHeight: 1.2,
      sectionGapMm: 4,
      bulletIndentMm: 4,
      photoEnabled: false,
      photoWidthMm: 30,
      photoHeightMm: 40,
      showPlaceholderIfNoPhoto: false,
      summaryMinWords: 50,
      summaryMaxWords: 100,
      skillsMaxGroups: 5,
      experienceMaxEntries: 5,
      experienceBulletsPerEntry: 4,
      educationMaxEntries: 3,
      languagesMaxEntries: 3,
      enforceOnePage: true,
      minFontSizePt: 8,
      sectionLimits: {
        header: { min: 100, max: 200 },
        summary: { min: 200, max: 400 },
        skills: { min: 100, max: 300 },
        experience: { min: 1000, max: 2000 },
        education: { min: 100, max: 300 },
        languages: { min: 50, max: 150 },
        total: { min: 1500, max: 3000 },
      },
      customDirectiveOverride: "",
      agentDirectives: {
        supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: true, enforceImmutableEntities: true, enableDebugLogs: true, enableDiffViewer: true },
        summary: { atsAggressiveness: 50, preserveFacts: true, minCharacters: 100, maxCharacters: 500 },
        skills: { maxKeywords: 10, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
        experience: { rewriteBulletsOnly: true, maxExpansionPercent: 20 },
        education: { formatOnly: true },
        languages: { formatOnly: true },
      },
    } as any;

    const input = buildOptimizerInput(sourceResume, { title: "Manager", company: "Retail" } as any, "Context", directiveConfig);
    expect(input.systemPrompt).toContain("LAYOUT & CONFIGURATION DIRECTIVES");
    expect(input.systemPrompt).not.toContain("OUTPUT FORMAT");
    expect(input.systemPrompt).not.toContain("OUTPUT CONTRACT");
  });
});

// ============================================================================
// 18. FREE PROVIDER STABILIZATION & CAPABILITIES
// ============================================================================

describe("Free Provider Stabilization & Capabilities", () => {
  it("resolves capabilities correctly for nvidia and zencode", () => {
    const nvidiaCaps = getProviderCapabilities("nvidia");
    expect(nvidiaCaps.freeTier).toBe(true);
    expect(nvidiaCaps.thirdPartyLimited).toBe(true);
    expect(nvidiaCaps.maxConcurrentRequests).toBe(1);
    expect(nvidiaCaps.retryable429).toBe(true);

    const zencodeCaps = getProviderCapabilities("zencode");
    expect(zencodeCaps.freeTier).toBe(true);
    expect(zencodeCaps.thirdPartyLimited).toBe(true);
    expect(zencodeCaps.maxConcurrentRequests).toBe(1);
  });

  it("isOpenCodeZenFree matches Nvidia NIM, ZenCode and Mistral free-tier providers", () => {
    const nvidiaProvider = { type: "nvidia", name: "Nvidia NIM", modelName: "meta/llama-3.3-70b-instruct" };
    expect(isOpenCodeZenFree(nvidiaProvider)).toBe(true);

    const zencodeProvider = { type: "zencode", name: "ZenCode", modelName: "deepseek-v4-flash-free" };
    expect(isOpenCodeZenFree(zencodeProvider)).toBe(true);

    const opencodeProvider = { type: "opencode", name: "OpenCode", modelName: "deepseek-v4-flash-free" };
    expect(isOpenCodeZenFree(opencodeProvider)).toBe(true);

    const mistralFreeProvider = { type: "mistral", name: "Mistral Small", modelName: "mistral-small-latest" };
    expect(isOpenCodeZenFree(mistralFreeProvider)).toBe(true);

    const paidProvider = { type: "openai", name: "OpenAI", modelName: "gpt-4o" };
    expect(isOpenCodeZenFree(paidProvider)).toBe(false);
  });

  it("getRecommendedFallbacks prioritizes most reliable free models", () => {
    const providers = [
      { id: "p_gemini", type: "gemini", isActive: true },
      { id: "p_nvidia", type: "nvidia", name: "Nvidia NIM", modelName: "meta/llama-3.3-70b-instruct", isActive: true },
      { id: "p_opencode", type: "opencode", name: "OpenCode Zen", modelName: "deepseek-v4-flash-free", isActive: true },
      { id: "p_mistral", type: "mistral", name: "Mistral Small", modelName: "mistral-small-latest", isActive: true },
    ];

    const fallbacks = getRecommendedFallbacks(providers);
    const types = fallbacks.map((f) => f.type);
    
    // Check that all are present
    expect(types).toContain("gemini");
    expect(types).toContain("nvidia");
    expect(types).toContain("opencode");
    expect(types).toContain("mistral");

    // Check exact reliability priority ordering
    const geminiIndex = types.indexOf("gemini");
    const mistralIndex = types.indexOf("mistral");
    const nvidiaIndex = types.indexOf("nvidia");
    const opencodeIndex = types.indexOf("opencode");

    expect(geminiIndex).toBeLessThan(nvidiaIndex);
    expect(mistralIndex).toBeLessThan(nvidiaIndex);
    expect(nvidiaIndex).toBeLessThan(opencodeIndex);
  });

  it("getOrderedFallbackProviders automatically sorts legacy providers by reliability", () => {
    const originalState = useApp.getState();
    useApp.setState({
      providers: [
        { id: "p_opencode", type: "opencode", isActive: true, modelName: "deepseek-v4-flash-free", apiKey: "key" },
        { id: "p_gemini", type: "gemini", isActive: true, modelName: "gemini-1.5-flash", apiKey: "key" },
        { id: "p_mistral", type: "mistral", isActive: true, modelName: "mistral-small-latest", apiKey: "key" },
      ],
      fallbackChain: { enabled: false, entries: [] }
    } as any);

    const ordered = getOrderedFallbackProviders();
    expect(ordered[0].provider.type).toBe("gemini");
    expect(ordered[1].provider.type).toBe("mistral");
    expect(ordered[2].provider.type).toBe("opencode");

    useApp.setState(originalState);
  });
});

// ============================================================================
// 19. PLAIN TEXT RESUME PARSER
// ============================================================================

describe("Plain Text Resume Parser", () => {
  it("successfully parses plain text resume into structured ResumeData", async () => {
    const rawResumeText = `
Jane Doe
jane@example.com | +1234567890 | Rabat, Morocco

PROFESSIONAL SUMMARY
Experienced customer service professional with 5 years in retail.

PROFESSIONAL EXPERIENCE
Receptionist at Hotel Atlas, Rabat Morocco Jan 2022 - Mar 2023
- Managed front desk operations.
- Handled guest inquiries.

EDUCATION
Hospitality Diploma
INFOHAS
2023 - 2025

LANGUAGES
English: Fluent
French: Fluent
Arabic: Native
    `;

    const parsed = await parseResumeText(rawResumeText);
    expect(parsed.name).toBe("Jane Doe");
    expect(parsed.contact.email).toBe("jane@example.com");
    expect(parsed.contact.phone).toBe("+1234567890");
    expect(parsed.contact.location).toBe("Rabat, Morocco");
    expect(parsed.summary).toContain("Experienced customer service");
    expect(parsed.experience[0].title).toBe("Receptionist");
    expect(parsed.experience[0].company).toBe("Hotel Atlas");
    expect(parsed.education[0].institution).toBe("INFOHAS");
    expect(parsed.languages.length).toBe(3);
  });

  it("throws error for too short or invalid text inputs", async () => {
    await expect(parseResumeText("Too short")).rejects.toThrow("too short");
  });
});
