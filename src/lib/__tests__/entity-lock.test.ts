// ============================================================================
// Entity Lock System — Regression Tests
// ============================================================================

import { describe, it, expect } from "vitest";
import {
  extractLockedEntities,
  restoreLockedEntities,
  deduplicateResume,
  verifyEntityIntegrity,
  sanitizeSkills,
  filterForbiddenSkills,
  isPlaceholderCompany,
  isPlaceholderInstitution,
  isPresentInjection,
  isDateChanged,
  isForbiddenSkill,
  findMatchingExperience,
  findMatchingEducation,
  deduplicateExperiences,
  deduplicateBullets,
} from "../entity-lock";
import type { ResumeData, ResumeExperience, ResumeEducation, ResumeLanguage } from "../types";

// ============================================================================
// Test Fixtures
// ============================================================================

const baseResume: ResumeData = {
  id: "res_1",
  name: "Jane Doe",
  headline: "Software Engineer",
  contact: { email: "jane@example.com", phone: "+1234567890", location: "Doha, Qatar" },
  summary: "Experienced software engineer with 5 years in web development.",
  experience: [
    {
      id: "exp_1", title: "Senior Developer", company: "Qatar Duty Free",
      location: "Doha, Qatar", startDate: "Jan 2020", endDate: "Mar 2024",
      bullets: ["Led team of 5 developers", "Built payment gateway"],
    },
    {
      id: "exp_2", title: "Developer", company: "TechCorp LLC",
      location: "Dubai, UAE", startDate: "Jun 2017", endDate: "Dec 2019",
      bullets: ["Developed web applications", "Improved performance by 30%"],
    },
  ],
  education: [
    {
      id: "edu_1", degree: "Bachelor of Science", institution: "Qatar University",
      field: "Computer Science", location: "Doha, Qatar", startDate: "2013", endDate: "2017",
      highlights: ["Dean's List", "GPA 3.8"],
    },
  ],
  skills: [
    { id: "sk_1", name: "JavaScript", category: "Technical" },
    { id: "sk_2", name: "React", category: "Technical" },
    { id: "sk_3", name: "Node.js", category: "Technical" },
  ],
  languages: [
    { id: "lang_1", name: "English", proficiency: "fluent" },
    { id: "lang_2", name: "Arabic", proficiency: "native" },
  ],
  certifications: [
    { id: "cert_1", name: "AWS Certified Developer" },
  ],
  projects: [],
  template: "infohas-pro",
  accentColor: "#0563C1",
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
  source: "upload",
};

// ============================================================================
// Tests: Placeholder Detection
// ============================================================================

describe("isPlaceholderCompany", () => {
  it("detects 'Unknown' as placeholder", () => {
    expect(isPlaceholderCompany("Unknown")).toBe(true);
    expect(isPlaceholderCompany("unknown")).toBe(true);
  });
  it("detects 'N/A' as placeholder", () => {
    expect(isPlaceholderCompany("N/A")).toBe(true);
    expect(isPlaceholderCompany("n/a")).toBe(true);
  });
  it("detects 'Company Name' as placeholder", () => {
    expect(isPlaceholderCompany("Company Name")).toBe(true);
  });
  it("detects 'Retail Company' as placeholder", () => {
    expect(isPlaceholderCompany("Retail Company")).toBe(true);
  });
  it("allows real company names", () => {
    expect(isPlaceholderCompany("Qatar Duty Free")).toBe(false);
    expect(isPlaceholderCompany("TechCorp LLC")).toBe(false);
    expect(isPlaceholderCompany("Google")).toBe(false);
  });
  it("rejects empty strings", () => {
    expect(isPlaceholderCompany("")).toBe(true);
    expect(isPlaceholderCompany("  ")).toBe(true);
  });
});

describe("isPlaceholderInstitution", () => {
  it("detects placeholder institution names", () => {
    expect(isPlaceholderInstitution("Institution Name")).toBe(true);
    expect(isPlaceholderInstitution("University Name")).toBe(true);
    expect(isPlaceholderInstitution("Unknown")).toBe(true);
  });
  it("allows real institutions", () => {
    expect(isPlaceholderInstitution("Qatar University")).toBe(false);
    expect(isPlaceholderInstitution("MIT")).toBe(false);
  });
});

// ============================================================================
// Tests: Present Injection Detection
// ============================================================================

describe("isPresentInjection", () => {
  it("detects when AI changes a real date to 'Present'", () => {
    expect(isPresentInjection("Mar 2024", "Present")).toBe(true);
    expect(isPresentInjection("2023", "Present")).toBe(true);
    expect(isPresentInjection("Dec 2022", "Present")).toBe(true);
  });
  it("allows 'Present' when original is also 'Present'", () => {
    expect(isPresentInjection("Present", "Present")).toBe(false);
    expect(isPresentInjection("present", "Present")).toBe(false);
  });
  it("allows unchanged dates", () => {
    expect(isPresentInjection("Mar 2024", "Mar 2024")).toBe(false);
    expect(isPresentInjection("", "")).toBe(false);
  });
  it("detects 'Current' injection", () => {
    expect(isPresentInjection("Mar 2024", "Current")).toBe(true);
  });
});

// ============================================================================
// Tests: Date Change Detection
// ============================================================================

describe("isDateChanged", () => {
  it("detects actual date changes", () => {
    expect(isDateChanged("Jan 2020", "Feb 2020")).toBe(true);
    expect(isDateChanged("2020", "2021")).toBe(true);
  });
  it("allows identical dates", () => {
    expect(isDateChanged("Jan 2020", "Jan 2020")).toBe(false);
  });
  it("allows formatting changes (same date)", () => {
    expect(isDateChanged("Jan 2020", "January 2020")).toBe(false);
    expect(isDateChanged("Mar 2024", "March 2024")).toBe(false);
  });
  it("handles empty dates", () => {
    expect(isDateChanged("", "")).toBe(false);
    expect(isDateChanged("Jan 2020", "")).toBe(true);
  });
});

// ============================================================================
// Tests: Forbidden Skill Detection
// ============================================================================

describe("isForbiddenSkill", () => {
  it("rejects company names as skills", () => {
    expect(isForbiddenSkill("Qatar Duty Free")).toBe(true);
    expect(isForbiddenSkill("Qatar Airways")).toBe(true);
    expect(isForbiddenSkill("QDFC")).toBe(true);
  });
  it("rejects locations as skills", () => {
    expect(isForbiddenSkill("Doha")).toBe(true);
    expect(isForbiddenSkill("Qatar")).toBe(true);
    expect(isForbiddenSkill("Dubai")).toBe(true);
  });
  it("allows real skills", () => {
    expect(isForbiddenSkill("JavaScript")).toBe(false);
    expect(isForbiddenSkill("Customer Service")).toBe(false);
    expect(isForbiddenSkill("POS Systems")).toBe(false);
  });
  it("rejects empty skills", () => {
    expect(isForbiddenSkill("")).toBe(true);
  });
});

describe("filterForbiddenSkills", () => {
  it("removes company names and locations from skills list", () => {
    const skills = [
      { name: "JavaScript" },
      { name: "Qatar Duty Free" },
      { name: "React" },
      { name: "Doha" },
      { name: "Node.js" },
    ];
    const { filtered, removed } = filterForbiddenSkills(skills);
    expect(filtered.map((s) => s.name)).toEqual(["JavaScript", "React", "Node.js"]);
    expect(removed).toContain("Qatar Duty Free");
    expect(removed).toContain("Doha");
  });
});

// ============================================================================
// Tests: Entity Extraction
// ============================================================================

describe("extractLockedEntities", () => {
  it("extracts all immutable entities from resume", () => {
    const locked = extractLockedEntities(baseResume);

    expect(locked.contact.name).toBe("Jane Doe");
    expect(locked.contact.email).toBe("jane@example.com");
    expect(locked.contact.phone).toBe("+1234567890");
    expect(locked.contact.location).toBe("Doha, Qatar");

    expect(locked.experiences).toHaveLength(2);
    expect(locked.experiences[0].company).toBe("Qatar Duty Free");
    expect(locked.experiences[1].company).toBe("TechCorp LLC");

    expect(locked.education).toHaveLength(1);
    expect(locked.education[0].institution).toBe("Qatar University");

    expect(locked.languages).toHaveLength(2);
    expect(locked.certifications).toHaveLength(1);

    expect(locked.counts.experience).toBe(2);
    expect(locked.counts.education).toBe(1);
    expect(locked.counts.languages).toBe(2);
  });
});

// ============================================================================
// Tests: Entity Restoration
// ============================================================================

describe("restoreLockedEntities", () => {
  it("restores company names that AI changed", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      experience: baseResume.experience.map((e) => ({
        ...e,
        company: e.company + " Group", // AI modified company name
      })),
    };
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.experience[0].company).toBe("Qatar Duty Free");
    expect(restored.experience[1].company).toBe("TechCorp LLC");
  });

  it("restores dates that AI changed to 'Present'", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      experience: baseResume.experience.map((e) => ({
        ...e,
        endDate: "Present", // AI injected "Present"
      })),
    };
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.experience[0].endDate).toBe("Mar 2024");
    expect(restored.experience[1].endDate).toBe("Dec 2019");
  });

  it("restores education that AI dropped", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      education: [], // AI dropped education
    };
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.education).toHaveLength(1);
    expect(restored.education[0].institution).toBe("Qatar University");
  });

  it("restores languages that AI dropped", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      languages: [], // AI dropped languages
    };
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.languages).toHaveLength(2);
    expect(restored.languages[0].name).toBe("English");
  });

  it("restores contact info that AI changed", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      name: "John Smith", // AI changed name
      contact: { ...baseResume.contact, email: "wrong@email.com" },
    };
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.name).toBe("Jane Doe");
    expect(restored.contact.email).toBe("jane@example.com");
  });

  it("strips hallucinated experience entries", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      experience: [
        ...baseResume.experience,
        {
          id: "exp_fake", title: "Manager", company: "FakeCorp Inc",
          location: "London, UK", startDate: "2020", endDate: "2021",
          bullets: ["Did some work"],
        },
      ],
    };
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.experience).toHaveLength(2);
    expect(restored.experience.some((e) => e.company === "FakeCorp Inc")).toBe(false);
  });

  it("restores dropped experience entries while keeping AI-optimized bullets", () => {
    const locked = extractLockedEntities(baseResume);
    const optimized: ResumeData = {
      ...baseResume,
      experience: [baseResume.experience[0]], // AI dropped second entry
    };
    optimized.experience[0].bullets = ["AI optimized bullet 1", "AI optimized bullet 2"];
    const restored = restoreLockedEntities(optimized, locked);
    expect(restored.experience).toHaveLength(2);
    // First entry keeps AI bullets
    expect(restored.experience[0].bullets).toEqual(["AI optimized bullet 1", "AI optimized bullet 2"]);
    // Second entry gets original bullets (was dropped)
    expect(restored.experience[1].bullets).toEqual(["Developed web applications", "Improved performance by 30%"]);
  });
});

// ============================================================================
// Tests: Entity Integrity Verification (Hard Failure Conditions)
// ============================================================================

describe("verifyEntityIntegrity", () => {
  it("passes when all entities are intact", () => {
    const locked = extractLockedEntities(baseResume);
    const result = verifyEntityIntegrity(baseResume, locked);
    expect(result.passed).toBe(true);
    expect(result.integrityScore).toBe(100);
    expect(result.criticalFailures).toHaveLength(0);
  });

  it("FAILS when company is missing (placeholder)", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      experience: [
        { ...baseResume.experience[0], company: "Unknown" },
        ...baseResume.experience.slice(1),
      ],
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "company_missing")).toBe(true);
  });

  it("FAILS when education is removed", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      education: [],
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "education_missing")).toBe(true);
  });

  it("FAILS when languages are removed", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      languages: [],
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "language_missing")).toBe(true);
  });

  it("FAILS when date is changed to 'Present'", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      experience: baseResume.experience.map((e) => ({
        ...e,
        endDate: "Present",
      })),
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "present_injection")).toBe(true);
  });

  it("FAILS when company count drops", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      experience: [baseResume.experience[0]],
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "company_count_mismatch")).toBe(true);
  });

  it("FAILS when hallucinated employer is added", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      experience: [
        ...baseResume.experience,
        {
          id: "fake", title: "Fake", company: "NonExistent Corp",
          location: "Nowhere", startDate: "2020", endDate: "2021",
          bullets: ["Fake work"],
        },
      ],
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "hallucinated_employer")).toBe(true);
  });

  it("FAILS when name is changed", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      name: "Wrong Name",
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "contact_changed")).toBe(true);
  });

  it("FAILS when summary has duplicate sentences", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      summary: "Experienced engineer. Experienced engineer. Skills in React.",
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "summary_corruption")).toBe(true);
  });

  it("FAILS when summary contains double periods", () => {
    const locked = extractLockedEntities(baseResume);
    const corrupted: ResumeData = {
      ...baseResume,
      summary: "Experienced engineer.. Skills in React.",
    };
    const result = verifyEntityIntegrity(corrupted, locked);
    expect(result.passed).toBe(false);
    expect(result.criticalFailures.some((f) => f.type === "summary_corruption")).toBe(true);
  });
});

// ============================================================================
// Tests: Deduplication
// ============================================================================

describe("deduplicateExperiences", () => {
  it("removes duplicate experience entries", () => {
    const dups: ResumeExperience[] = [
      ...baseResume.experience,
      { ...baseResume.experience[0] }, // duplicate
    ];
    const result = deduplicateExperiences(dups);
    expect(result).toHaveLength(2);
  });
});

describe("deduplicateBullets", () => {
  it("removes duplicate bullets within an experience", () => {
    const exp: ResumeExperience = {
      ...baseResume.experience[0],
      bullets: ["Led team", "Built app", "Led team"], // duplicate "Led team"
    };
    const result = deduplicateBullets(exp);
    expect(result.bullets).toHaveLength(2);
    expect(result.bullets).toEqual(["Led team", "Built app"]);
  });
});

describe("deduplicateResume", () => {
  it("removes all duplicates from resume", () => {
    const corrupted: ResumeData = {
      ...baseResume,
      experience: [
        ...baseResume.experience,
        { ...baseResume.experience[0] }, // duplicate experience
      ],
    };
    corrupted.experience[0].bullets = ["Bullet A", "Bullet B", "Bullet A"]; // duplicate bullet
    const result = deduplicateResume(corrupted);
    expect(result.experience).toHaveLength(2);
    expect(result.experience[0].bullets).toHaveLength(2);
  });
});

// ============================================================================
// Tests: Skill Sanitization
// ============================================================================

describe("sanitizeSkills", () => {
  it("removes company names from skills", () => {
    const corrupted: ResumeData = {
      ...baseResume,
      skills: [
        ...baseResume.skills,
        { id: "sk_bad", name: "Qatar Duty Free", category: "Skills" },
        { id: "sk_bad2", name: "Doha", category: "Location" },
      ],
    };
    const result = sanitizeSkills(corrupted);
    expect(result.skills.some((s) => s.name === "Qatar Duty Free")).toBe(false);
    expect(result.skills.some((s) => s.name === "Doha")).toBe(false);
    expect(result.skills.some((s) => s.name === "JavaScript")).toBe(true);
  });
});

// ============================================================================
// Tests: Experience Matching
// ============================================================================

describe("findMatchingExperience", () => {
  const locked = extractLockedEntities(baseResume);

  it("matches by exact company name", () => {
    const match = findMatchingExperience(
      { ...baseResume.experience[0], company: "Qatar Duty Free" },
      locked.experiences,
    );
    expect(match).not.toBeNull();
    expect(match?.company).toBe("Qatar Duty Free");
  });

  it("matches by substring", () => {
    const match = findMatchingExperience(
      { ...baseResume.experience[0], company: "Duty Free" }, // AI cleaned up
      locked.experiences,
    );
    expect(match).not.toBeNull();
    expect(match?.company).toBe("Qatar Duty Free");
  });

  it("matches by title when company doesn't match", () => {
    const match = findMatchingExperience(
      { ...baseResume.experience[0], company: "WRONG", title: "Senior Developer" },
      locked.experiences,
    );
    expect(match).not.toBeNull();
    expect(match?.title).toBe("Senior Developer");
  });

  it("uses index fallback when nothing matches", () => {
    const match = findMatchingExperience(
      { ...baseResume.experience[0], company: "NOMATCH", title: "NOMATCH" },
      locked.experiences,
      0,
    );
    expect(match).not.toBeNull();
    expect(match?.company).toBe("Qatar Duty Free");
  });
});

describe("findMatchingEducation", () => {
  const locked = extractLockedEntities(baseResume);

  it("matches by exact institution", () => {
    const match = findMatchingEducation(
      { ...baseResume.education[0] },
      locked.education,
    );
    expect(match).not.toBeNull();
    expect(match?.institution).toBe("Qatar University");
  });
});
