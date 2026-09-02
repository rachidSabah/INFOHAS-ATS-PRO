// ============================================================================
// Regression Tests — Gate Alignment (production deadlock family #2)
//
// Production trace (2026-09-02, 6/6 attempts exhausted × multiple pipeline
// passes): the optimizer directive tells the AI to "embed missing JD
// keywords"; the AI and the page balancer dutifully add "Qatar Airways"/"Doha"
// as SKILLS, which the Structure Guardian then vetoes as critical
// ("Skill ... is a JD company name/location"). Separately, the page balancer /
// Dynamic Section Engine deterministically add a bullet (3→4) to fill the A4
// page, which the Guardian Agent's bullets_preserved check vetoes as
// "potential hallucination". Both are gate-vs-gate contradictions.
//
// Fixes under test:
//   1. sanitizeSkillsAgainstJd() removes JD-entity skills the ENGINE added,
//      using the Guardian's own predicate (source skills exempt).
//   2. runGuardianValidation() accepts engineBulletCounts /
//      engineHighlightCounts allowlists: extras added AFTER assembly by the
//      deterministic engines pass; LLM-invented extras still VETO.
// ============================================================================

import { describe, it, expect } from "vitest";
import { runStructureGuardian, sanitizeSkillsAgainstJd } from "../structure-guardian";
import { runGuardianValidation } from "../resume-guardian-agent";
import type { ResumeData } from "../types";

// Realistic JD for the production scenario (Qatar Airways cabin crew).
const JD_TEXT =
  "Cabin Crew Recruitment — Qatar Airways. Location: Doha, Qatar. Join our cabin crew team. " +
  "Requirements: safety, passenger service, emergency procedures, in-flight service excellence.";

function makeSource(): ResumeData {
  return {
    id: "res_src",
    name: "Test Candidate",
    headline: "Ground Operations Professional",
    contact: { email: "test@example.com", phone: "+10000000000", location: "Casablanca, Morocco" },
    summary: "Ground service and frontline operations professional.",
    experience: [
      {
        id: "exp_001",
        title: "Ground Service & Frontline Operations Agent",
        company: "BIOLOGIA LABORATORY",
        location: "Casablanca",
        startDate: "Jan 2023",
        endDate: "Mar 2025",
        bullets: [
          "Handled frontline customer requests.",
          "Coordinated daily ground operations.",
          "Resolved service incidents.",
        ],
      },
    ],
    education: [
      {
        id: "ed_001",
        degree: "Professional Diploma",
        institution: "INFOHAS",
        location: "Casablanca",
        startDate: "2021",
        endDate: "2023",
        highlights: ["Graduated with distinction", "Aviation services track"],
      },
    ],
    skills: [], // production source resume has NO skills section
    languages: [],
    certifications: [],
    projects: [],
    template: "ats-professional",
    createdAt: "2026-09-02T00:00:00.000Z",
    updatedAt: "2026-09-02T00:00:00.000Z",
  } as ResumeData;
}

/** Resume as it looks after assembly + page balancer (the failing shape). */
function makeOptimized(): ResumeData {
  const src = makeSource();
  return {
    ...src,
    experience: [
      {
        ...src.experience[0],
        bullets: [...src.experience[0].bullets, "Assisted premium passengers with connections."], // 3→4: engine-added for page fill
      },
    ],
    education: [
      {
        ...src.education[0],
        highlights: [...(src.education[0].highlights ?? []), "Customer service workshop"], // 2→3: engine-added
      },
    ],
    skills: [
      { name: "Qatar Airways" }, // AI debris (directive said "embed missing keywords")
      { name: "Doha" }, // AI debris
      { name: "Customer Service" }, // legitimate
    ],
  } as ResumeData;
}

describe("sanitizeSkillsAgainstJd (gate alignment with Structure Guardian)", () => {
  it("removes AI-added JD company/location skills and keeps legitimate ones", () => {
    const src = makeSource();
    const opt = makeOptimized();
    const result = sanitizeSkillsAgainstJd(opt, src, JD_TEXT);
    expect(result.removedSkills.sort()).toEqual(["Doha", "Qatar Airways"]);
    expect(result.resume.skills.map((s: any) => s.name)).toEqual(["Customer Service"]);
  });

  it("is a no-op when there are no JD-entity skills", () => {
    const src = makeSource();
    const opt = { ...makeOptimized(), skills: [{ name: "Customer Service" }] } as ResumeData;
    const result = sanitizeSkillsAgainstJd(opt, src, JD_TEXT);
    expect(result.removedSkills).toEqual([]);
    expect(result.resume).toBe(opt); // same reference — untouched
  });

  it("preserves Zero Data Loss: skills authored in the SOURCE are never removed", () => {
    const src = makeSource();
    src.skills = [{ name: "Qatar Airways" }] as any; // user-authored (weird, but theirs)
    const opt = makeOptimized();
    const result = sanitizeSkillsAgainstJd(opt, src, JD_TEXT);
    expect(result.removedSkills).toEqual(["Doha"]); // only the engine-added one
    expect(result.resume.skills.map((s: any) => s.name)).toContain("Qatar Airways");
  });

  it("PREDICATE ALIGNMENT: the Structure Guardian flags exactly what the sanitizer removes", () => {
    const src = makeSource();
    const dirty = makeOptimized();
    // Precondition: the Guardian vetoes the dirty resume (production symptom)
    const dirtyResult = runStructureGuardian(dirty, src, JD_TEXT);
    const flagged = dirtyResult.criticalIssues.filter((i) => i.includes("is a JD company name/location"));
    expect(flagged.length).toBeGreaterThan(0);

    // After sanitize: the SAME Guardian (same JD, same predicate) passes
    const clean = sanitizeSkillsAgainstJd(dirty, src, JD_TEXT).resume;
    const cleanResult = runStructureGuardian(clean, src, JD_TEXT);
    const stillFlagged = cleanResult.criticalIssues.filter((i) => i.includes("is a JD company name/location"));
    expect(stillFlagged).toEqual([]);
  });
});

describe("Guardian Agent engine-addition allowlist (gate alignment with page balancer)", () => {
  it("vetoes LLM-invented extra bullets when no allowlist is provided (backwards compatible)", async () => {
    const verdict = await runGuardianValidation(makeOptimized(), makeSource(), undefined);
    const bullets = verdict.checks.find((c) => c.name === "bullets_preserved");
    expect(bullets?.passed).toBe(false);
    expect(bullets?.detail).toContain("potential hallucination");
  });

  it("allows engine-added bullets (3→4 by page balancer) via the allowlist", async () => {
    const engineBulletCounts = new Map([["exp_001", 3]]); // count at ASSEMBLY time
    const engineHighlightCounts = new Map([["ed_001", 2]]);
    const verdict = await runGuardianValidation(makeOptimized(), makeSource(), undefined, {
      engineBulletCounts,
      engineHighlightCounts,
    });
    const bullets = verdict.checks.find((c) => c.name === "bullets_preserved");
    const highlights = verdict.checks.find((c) => c.name === "education_highlights_preserved");
    expect(bullets?.passed).toBe(true);
    expect(highlights?.passed).toBe(true);
  });

  it("still vetoes extras the LLM itself added (assembled count already above source)", async () => {
    // LLM hallucinated the 4th bullet BEFORE assembly → assembled count is 4
    const engineBulletCounts = new Map([["exp_001", 4]]);
    const verdict = await runGuardianValidation(makeOptimized(), makeSource(), undefined, {
      engineBulletCounts,
    });
    const bullets = verdict.checks.find((c) => c.name === "bullets_preserved");
    expect(bullets?.passed).toBe(false);
  });

  it("still vetoes dropped bullets (data loss) regardless of allowlist", async () => {
    const src = makeSource();
    const dropped = {
      ...makeOptimized(),
      experience: [
        { ...src.experience[0], bullets: ["Handled frontline customer requests."] }, // 3→1
      ],
    } as ResumeData;
    const engineBulletCounts = new Map([["exp_001", 1]]);
    const verdict = await runGuardianValidation(dropped, src, undefined, { engineBulletCounts });
    const bullets = verdict.checks.find((c) => c.name === "bullets_preserved");
    expect(bullets?.passed).toBe(false);
  });
});
