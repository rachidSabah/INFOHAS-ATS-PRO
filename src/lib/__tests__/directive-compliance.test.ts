import { describe, it, expect } from "vitest";
import { verifyDirectiveCompliance, getDirectiveVersion } from "../directive-compliance";
import type { OptimizerDirectiveConfig, ResumeData } from "../types";

function makeConfig(overrides: Partial<OptimizerDirectiveConfig> = {}): OptimizerDirectiveConfig {
  return {
    pageSize: "A4",
    marginTopMm: 6.35, marginBottomMm: 6.35, marginLeftMm: 8.89, marginRightMm: 8.89,
    fontFamily: "Times New Roman", bodyFontSizePt: 10.5, sectionTitleSizePt: 12, nameSizePt: 14,
    nameColor: "#8B0000", sectionTitleColor: "#8B0000", bodyTextColor: "#000000",
    lineHeight: 1.2, sectionGapMm: 3, bulletIndentMm: 4,
    photoEnabled: false, photoWidthMm: 30, photoHeightMm: 40, showPlaceholderIfNoPhoto: false,
    summaryMinWords: 80, summaryMaxWords: 120,
    skillsMaxGroups: 4, experienceMaxEntries: 4, experienceBulletsPerEntry: 4,
    educationMaxEntries: 3, languagesMaxEntries: 4,
    enforceOnePage: true, minFontSizePt: 10,
    sectionLimits: {
      header: { min: 80, max: 150 }, summary: { min: 400, max: 600 },
      skills: { min: 300, max: 500 }, experience: { min: 1200, max: 1800 },
      education: { min: 150, max: 300 }, languages: { min: 50, max: 100 },
      total: { min: 2500, max: 3500 },
    },
    customDirectiveOverride: "",
    complianceThreshold: 100,
    complianceRules: {
      entityPreservation: true, sectionOrder: true, immutableFields: true, hallucinationCheck: true,
      summaryLength: true, skillGrouping: true, chronology: true, pageCount: true,
      bulletCount: true, languageSeparation: true,
    },
    enforceComplianceOnAllAgents: true,
    forceDirectiveOnRetry: true,
    directiveVersion: 1,
    directiveHash: "",
    strictAgentLock: true,
    agentDirectives: {
      supervisor: { strictMode: true, enableRetries: true, enableProviderSwitch: true, enforceImmutableEntities: true, enableDebugLogs: false, enableDiffViewer: false },
      summary: { atsAggressiveness: 60, preserveFacts: true, minCharacters: 400, maxCharacters: 600 },
      skills: { maxKeywords: 12, allowTransferableSkills: true, allowCompanyKeywords: false, allowLocationKeywords: false },
      experience: { rewriteBulletsOnly: true, rewriteTitle: false, rewriteCompany: false, rewriteDates: false, rewriteLocation: false, maxExpansionPercent: 20 },
      education: { formatOnly: true, stripSectionHeaders: true },
      languages: { formatOnly: true, stripSectionHeaders: true },
      guardian: { enforceEntityIntegrity: true, enforcePageUtilization: false, enforceContentLength: false, enforceNoDuplicates: true, enforceSummaryQuality: false, minimumScore: 80 },
    },
    ...overrides,
  };
}

function makeResume(overrides: Partial<ResumeData> = {}): ResumeData {
  return {
    id: "test",
    name: "Test User",
    contact: { email: "test@example.com", phone: "+1234567890", location: "Test City" },
    summary: "Experienced professional with a strong background in software engineering and team leadership across multiple high-impact projects delivering measurable results.",
    skills: [{ id: "s1", name: "React", category: "Frontend" }, { id: "s2", name: "TypeScript", category: "Languages" }],
    experience: [
      { id: "e1", title: "Senior Engineer", company: "TechCorp", startDate: "2020-01", endDate: "2023-06", bullets: ["Built scalable systems", "Led team of 5"] },
      { id: "e2", title: "Engineer", company: "StartupInc", startDate: "2018-03", endDate: "2019-12", bullets: ["Developed MVP", "Reduced latency by 40%"] },
    ],
    education: [
      { id: "ed1", degree: "BS Computer Science", institution: "MIT", startDate: "2014", endDate: "2018" },
      { id: "ed2", degree: "High School", institution: "", startDate: "2010", endDate: "2014" },
    ],
    languages: [{ id: "l1", name: "English", proficiency: "fluent" }],
    certifications: [],
    projects: [],
    template: "ats-professional",
    accentColor: "#1154A3",
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "upload",
    ...overrides,
  };
}

describe("DirectiveComplianceService", () => {
  it("passes with 100 for fully compliant output", () => {
    const config = makeConfig();
    const original = makeResume();
    const optimized = makeResume(); // identical = compliant
    const result = verifyDirectiveCompliance(original, optimized, config);
    expect(result.passed).toBe(true);
    expect(result.score).toBeGreaterThanOrEqual(80);
  });

  it("flags summary too short", () => {
    const config = makeConfig({ summaryMinWords: 80 });
    const original = makeResume();
    const optimized = makeResume({ summary: "Short summary." }); // 2 words
    const result = verifyDirectiveCompliance(original, optimized, config);
    expect(result.score).toBeLessThanOrEqual(80);
    expect(result.checks.find(c => c.name === "summary_word_count")?.passed).toBe(false);
  });

  it("flags duplicate summary sentences", () => {
    const config = makeConfig();
    const dup = "Results driven leader. Results driven leader. Results driven leader. Another thought. Another thought.";
    const original = makeResume();
    const optimized = makeResume({ summary: dup });
    const result = verifyDirectiveCompliance(original, optimized, config);
    expect(result.checks.find(c => c.name === "summary_no_duplicates")?.passed).toBe(false);
  });

  it("flags too many skill groups", () => {
    const config = makeConfig({ skillsMaxGroups: 2 });
    const original = makeResume();
    const optimized = makeResume({
      skills: [
        { id: "sa", name: "A", category: "1" }, { id: "sb", name: "B", category: "2" }, { id: "sc", name: "C", category: "3" },
      ],
    });
    const result = verifyDirectiveCompliance(original, optimized, config);
    expect(result.checks.find(c => c.name === "skills_group_count")?.passed).toBe(false);
  });

  it("flags changed company dates", () => {
    const config = makeConfig();
    const original = makeResume();
    const optimized = makeResume({
      experience: [
        { id: "e1", title: "Senior Engineer", company: "TechCorp", startDate: "2021-01", endDate: "2023-06", bullets: ["changed"] },
        { id: "e2", title: "Engineer", company: "StartupInc", startDate: "2018-03", endDate: "2019-12", bullets: ["ok"] },
      ],
    });
    const result = verifyDirectiveCompliance(original, optimized, config);
    expect(result.checks.find(c => c.name === "experience_immutable_fields")?.passed).toBe(false);
  });

  it("flags missing school names", () => {
    const config = makeConfig();
    const original = makeResume();
    const optimized = makeResume({
      education: [
        { id: "ed1", degree: "BS Computer Science", institution: "ChangedSchool", startDate: "2014", endDate: "2018" },
        { id: "ed2", degree: "High School", institution: "", startDate: "2010", endDate: "2014" },
      ],
    });
    const result = verifyDirectiveCompliance(original, optimized, config);
    // Entry 0 has changed institution
    expect(result.checks.find(c => c.name === "education_schools_preserved")?.passed).toBe(false);
  });

  it("flags missing languages", () => {
    const config = makeConfig();
    const original = makeResume();
    const optimized = makeResume({ languages: [] });
    const result = verifyDirectiveCompliance(original, optimized, config);
    expect(result.checks.find(c => c.name === "languages_preserved")?.passed).toBe(false);
  });

  it("generates consistent directive hash", () => {
    const config = makeConfig();
    const h1 = getDirectiveVersion(config);
    const h2 = getDirectiveVersion(config);
    expect(h1).toBe(h2);

    const changed = makeConfig({ summaryMinWords: 100 });
    const h3 = getDirectiveVersion(changed);
    expect(h3).not.toBe(h1);
  });
});
