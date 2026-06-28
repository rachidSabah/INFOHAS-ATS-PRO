// ============================================================================
// Regression Tests — Education & Language Preservation
//
// Tests for:
//   - School name extraction and preservation
//   - School name restoration (ID-based, not index-based)
//   - Multiple education entries
//   - Language extraction and restoration
//   - Language proficiency preservation
//   - Assembler restoration
//   - Similarity checks
//   - Fingerprint validation
// ============================================================================

import { describe, it, expect } from "vitest";
import { finalizeResume, restoreEducation, restoreLanguages } from "../unified-pipeline";
import {
  computeEducationFingerprint,
  computeLanguageFingerprint,
  findMatchingSourceEducation,
  findMatchingSourceLanguage,
  validateEducationFingerprints,
  validateLanguageFingerprints,
  calculateEducationSimilarity,
  calculateLanguageSimilarity,
} from "../education-language-fingerprint";
import { runStructureGuardian } from "../structure-guardian";
import type { ResumeData } from "../types";

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
      location: "Rabat",
      startDate: "Jan 2022",
      endDate: "Mar 2023",
      bullets: ["Managed front desk operations."],
    },
  ],
  education: [
    {
      id: "ed_001",
      degree: "Hospitality and Aviation Accredited Diploma",
      institution: "INFOHAS",
      location: "Rabat",
      startDate: "2023",
      endDate: "2025",
      highlights: [],
    },
    {
      id: "ed_002",
      degree: "High School Degree",
      institution: "Lycée Demnate",
      location: "Demnate",
      startDate: "2021",
      endDate: "2022",
      highlights: [],
    },
  ],
  skills: [
    { id: "sk_1", name: "Customer Service", category: "General" },
  ],
  languages: [
    { id: "lang_001", name: "English", proficiency: "fluent" },
    { id: "lang_002", name: "French", proficiency: "fluent" },
    { id: "lang_003", name: "Arabic", proficiency: "native" },
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
// 1. SCHOOL NAME EXTRACTION & PRESERVATION
// ============================================================================

describe("School Name Preservation", () => {
  it("preserves school name through finalizeResume", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: sourceResume.education.map((e) => ({
        ...e,
        institution: "", // AI dropped the school name
      })),
    };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.education[0].institution).toBe("INFOHAS");
    expect(result.education[1].institution).toBe("Lycée Demnate");
  });

  it("preserves school name when AI returns education without school", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [
        {
          id: "ed_001",
          degree: "Hospitality and Aviation Accredited Diploma",
          institution: "", // AI dropped school
          startDate: "2023",
          endDate: "2025",
          highlights: [],
        },
      ],
    };
    const result = restoreEducation(optimized, sourceResume);
    expect(result.resume.education[0].institution).toBe("INFOHAS");
  });

  it("restores school name when AI pollutes it with dates", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [{
        ...sourceResume.education[0],
        institution: "INFOHAS 2023 – 2025", // dates leaked into institution
      }],
    };
    const result = restoreEducation(optimized, sourceResume);
    expect(result.resume.education[0].institution).toBe("INFOHAS");
    expect(result.resume.education[0].institution).not.toContain("2023");
  });
});

// ============================================================================
// 2. ID-BASED EDUCATION RESTORATION (not index-based)
// ============================================================================

describe("ID-Based Education Restoration", () => {
  it("matches education by ID (not index)", () => {
    // AI reorders education entries — ID matching should still find the right source
    const optimized: ResumeData = {
      ...sourceResume,
      education: [
        { ...sourceResume.education[1], institution: "" }, // ed_002 first
        { ...sourceResume.education[0], institution: "" }, // ed_001 second
      ],
    };
    const result = restoreEducation(optimized, sourceResume);
    // Despite reordering, ID matching should restore correct schools
    expect(result.resume.education[0].institution).toBe("Lycée Demnate"); // ed_002
    expect(result.resume.education[1].institution).toBe("INFOHAS");       // ed_001
  });

  it("falls back to fingerprint matching when ID not found", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [{
        id: "WRONG_ID",
        degree: "Hospitality and Aviation Accredited Diploma",
        institution: "INFOHAS",
        startDate: "2023",
        endDate: "2025",
        highlights: [],
      }],
    };
    const result = restoreEducation(optimized, sourceResume);
    // Fingerprint match should find the correct source entry
    expect(result.resume.education[0].institution).toBe("INFOHAS");
  });

  it("restores dropped education entries", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: [sourceResume.education[0]], // AI dropped ed_002
    };
    const result = restoreEducation(optimized, sourceResume);
    expect(result.resume.education.length).toBe(2); // both restored
    expect(result.resume.education[1].institution).toBe("Lycée Demnate");
  });
});

// ============================================================================
// 3. MULTIPLE EDUCATION ENTRIES
// ============================================================================

describe("Multiple Education Entries", () => {
  it("preserves all education entries", () => {
    const optimized: ResumeData = { ...sourceResume };
    const result = finalizeResume(optimized, sourceResume);
    expect(result.education.length).toBe(2);
  });

  it("handles 3+ education entries", () => {
    const sourceWith3: ResumeData = {
      ...sourceResume,
      education: [
        ...sourceResume.education,
        {
          id: "ed_003",
          degree: "Certificate in Customer Service",
          institution: "Online Academy",
          location: "",
          startDate: "2020",
          endDate: "2020",
          highlights: [],
        },
      ],
    };
    const optimized: ResumeData = { ...sourceWith3 };
    const result = finalizeResume(optimized, sourceWith3);
    expect(result.education.length).toBe(3);
    expect(result.education[2].institution).toBe("Online Academy");
  });
});

// ============================================================================
// 4. EDUCATION FINGERPRINTS
// ============================================================================

describe("Education Fingerprints", () => {
  it("computes stable fingerprints", () => {
    const fp1 = computeEducationFingerprint(sourceResume.education[0]);
    const fp2 = computeEducationFingerprint(sourceResume.education[0]);
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(16);
  });

  it("detects different fingerprints for different entries", () => {
    const fp1 = computeEducationFingerprint(sourceResume.education[0]);
    const fp2 = computeEducationFingerprint(sourceResume.education[1]);
    expect(fp1).not.toBe(fp2);
  });

  it("validates fingerprints after optimization", () => {
    const optimized = finalizeResume({ ...sourceResume }, sourceResume);
    const validation = validateEducationFingerprints(optimized, sourceResume);
    expect(validation.valid).toBe(true);
  });
});

// ============================================================================
// 5. LANGUAGE EXTRACTION & RESTORATION
// ============================================================================

describe("Language Restoration", () => {
  it("restores languages when AI drops them", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      languages: [], // AI dropped all languages
    };
    const result = restoreLanguages(optimized, sourceResume);
    expect(result.resume.languages.length).toBe(3);
    expect(result.resume.languages[0].name).toBe("English");
    expect(result.resume.languages[1].name).toBe("French");
    expect(result.resume.languages[2].name).toBe("Arabic");
  });

  it("restores languages when AI corrupts them", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      languages: [
        { id: "lang_bad", name: "", proficiency: "fluent" }, // corrupted
        { id: "lang_002", name: "French", proficiency: "fluent" },
      ],
    };
    const result = restoreLanguages(optimized, sourceResume);
    // ALWAYS uses source languages
    expect(result.resume.languages.length).toBe(3);
    expect(result.resume.languages[0].name).toBe("English");
    expect(result.resume.languages[2].name).toBe("Arabic");
  });

  it("preserves language proficiency", () => {
    const optimized: ResumeData = { ...sourceResume };
    const result = restoreLanguages(optimized, sourceResume);
    expect(result.resume.languages[0].proficiency).toBe("fluent");
    expect(result.resume.languages[2].proficiency).toBe("native"); // Arabic is native
  });
});

// ============================================================================
// 6. LANGUAGE FINGERPRINTS
// ============================================================================

describe("Language Fingerprints", () => {
  it("computes stable fingerprints", () => {
    const fp1 = computeLanguageFingerprint(sourceResume.languages[0]);
    const fp2 = computeLanguageFingerprint(sourceResume.languages[0]);
    expect(fp1).toBe(fp2);
    expect(fp1.length).toBe(16);
  });

  it("validates fingerprints after optimization", () => {
    const optimized = finalizeResume({ ...sourceResume }, sourceResume);
    const validation = validateLanguageFingerprints(optimized, sourceResume);
    expect(validation.dropped).toBe(0);
  });
});

// ============================================================================
// 7. STRUCTURE GUARDIAN VALIDATION
// ============================================================================

describe("Structure Guardian — Education & Languages", () => {
  it("detects missing school name", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      education: [{
        ...sourceResume.education[0],
        institution: "", // school missing
      }],
    };
    const result = runStructureGuardian(corrupted, sourceResume);
    expect(result.criticalIssues.some((c) => c.includes("school name missing"))).toBe(true);
  });

  it("detects changed school name", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      education: [{
        ...sourceResume.education[0],
        institution: "Different School", // school changed
      }],
    };
    const result = runStructureGuardian(corrupted, sourceResume);
    expect(result.criticalIssues.some((c) => c.includes("school name changed"))).toBe(true);
  });

  it("detects dropped languages", () => {
    const corrupted: ResumeData = {
      ...sourceResume,
      languages: [sourceResume.languages[0]], // dropped 2 languages
    };
    const result = runStructureGuardian(corrupted, sourceResume);
    expect(result.criticalIssues.some((c) => c.includes("Languages count mismatch"))).toBe(true);
  });

  it("passes clean resume", () => {
    const result = runStructureGuardian(sourceResume, sourceResume);
    expect(result.criticalIssues.length).toBe(0);
  });
});

// ============================================================================
// 8. SIMILARITY ENGINE
// ============================================================================

describe("Similarity Engine", () => {
  it("calculates 100% education similarity for identical resumes", () => {
    const similarity = calculateEducationSimilarity(sourceResume, sourceResume);
    expect(similarity).toBe(100);
  });

  it("calculates high education similarity when school preserved", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: sourceResume.education.map((e) => ({ ...e })),
    };
    const similarity = calculateEducationSimilarity(sourceResume, optimized);
    expect(similarity).toBeGreaterThanOrEqual(95);
  });

  it("calculates low education similarity when school missing", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      education: sourceResume.education.map((e) => ({ ...e, institution: "" })),
    };
    const similarity = calculateEducationSimilarity(sourceResume, optimized);
    expect(similarity).toBeLessThan(95);
  });

  it("calculates 100% language similarity for identical resumes", () => {
    const similarity = calculateLanguageSimilarity(sourceResume, sourceResume);
    expect(similarity).toBe(100);
  });

  it("calculates 100% language similarity when restored from source", () => {
    const optimized: ResumeData = {
      ...sourceResume,
      languages: [], // AI dropped
    };
    const result = restoreLanguages(optimized, sourceResume);
    const similarity = calculateLanguageSimilarity(sourceResume, result.resume);
    expect(similarity).toBe(100);
  });
});

// ============================================================================
// 9. MATCHING FUNCTIONS
// ============================================================================

describe("Matching Functions", () => {
  it("finds matching education by ID", () => {
    const result = findMatchingSourceEducation(
      { id: "ed_001", institution: "INFOHAS", degree: "Diploma" },
      sourceResume,
    );
    expect(result.match).not.toBeNull();
    expect(result.method).toBe("id");
    expect(result.match?.institution).toBe("INFOHAS");
  });

  it("finds matching education by fingerprint", () => {
    const result = findMatchingSourceEducation(
      { id: "WRONG_ID", institution: "INFOHAS", degree: "Hospitality and Aviation Accredited Diploma", startDate: "2023", endDate: "2025" },
      sourceResume,
    );
    expect(result.match).not.toBeNull();
    expect(result.method).toBe("fingerprint");
  });

  it("finds matching language by ID", () => {
    const result = findMatchingSourceLanguage(
      { id: "lang_001", name: "English", proficiency: "fluent" },
      sourceResume,
    );
    expect(result.match).not.toBeNull();
    expect(result.method).toBe("id");
    expect(result.match?.name).toBe("English");
  });

  it("finds matching language by name", () => {
    // Use different proficiency so fingerprint doesn't match (fingerprint = name + proficiency)
    const result = findMatchingSourceLanguage(
      { id: "WRONG_ID", name: "English", proficiency: "native" },
      sourceResume, // source has English/fluent, so fingerprint won't match
    );
    expect(result.match).not.toBeNull();
    expect(result.method).toBe("name");
  });
});
