import { describe, it, expect } from "vitest";
import { buildOptimizerInput } from "../bullet-only-optimizer";
import { buildPromptHash } from "../prompt-cache";
import type { ResumeData, JobDescription } from "../types";

// Locked-pipeline retry contract (root cause of repeated
// "0 of 8 actionable JD keywords" UNRECOVERABLE): attempt N+1 must send
// a DIFFERENT prompt carrying the accumulated corrective feedback —
// otherwise the prompt cache serves attempt 1 output again and every
// retry fails identically.
const resume = {
  id: "r1",
  name: "Test Candidate",
  headline: "Crew",
  contact: { email: "t@example.com" },
  summary: "Crew member.",
  experience: [{ id: "e1", title: "Agent", company: "Air", bullets: ["Helped guests"] }],
  education: [],
  skills: [],
  languages: [],
  certifications: [],
  projects: [],
} as unknown as ResumeData;

const jd = { keywords: ["Cabin Crew", "Safety", "Travel"] } as unknown as JobDescription;

describe("locked-pipeline retry feedback contract", () => {
  it("embeds accumulated feedback into the retry prompt", () => {
    const first = buildOptimizerInput(resume, jd, "", null, null, undefined);
    expect(first.userPrompt).not.toContain("CRITICAL FEEDBACK FROM PREVIOUS ATTEMPT");
    const retry = buildOptimizerInput(resume, jd, "", null, null, "0 of 3 keywords integrated: Safety, Travel");
    expect(retry.userPrompt).toContain("CRITICAL FEEDBACK FROM PREVIOUS ATTEMPT");
    expect(retry.userPrompt).toContain("0 of 3 keywords integrated");
  });

  it("retry prompt hashes differently so cache cannot serve the failed output", () => {
    const first = buildOptimizerInput(resume, jd, "", null, null, undefined);
    const retry = buildOptimizerInput(resume, jd, "", null, null, "keyword floor not met");
    const h1 = buildPromptHash({ systemPrompt: first.systemPrompt, userPrompt: first.userPrompt });
    const h2 = buildPromptHash({ systemPrompt: retry.systemPrompt, userPrompt: retry.userPrompt });
    expect(h2).not.toBe(h1);
  });

  it("identical inputs hash identically (cache still works for true repeats)", () => {
    const a = buildOptimizerInput(resume, jd, "", null, null, undefined);
    const b = buildOptimizerInput(resume, jd, "", null, null, undefined);
    expect(buildPromptHash({ systemPrompt: b.systemPrompt, userPrompt: b.userPrompt }))
      .toBe(buildPromptHash({ systemPrompt: a.systemPrompt, userPrompt: a.userPrompt }));
  });
});
