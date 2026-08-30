// ============================================================================
// P4 ProgressiveGenerator (ACTIVATED) tests — section-by-section generation,
// structured-output parse with repair rounds, patch-contract compliance.
// Pure injected-deps tests — no network, no store.
// ============================================================================

import { describe, it, expect } from "vitest";
import { ProgressiveGenerator, runProgressiveOptimization, describeSalvageStageFailures } from "./progressive-generator";
import type { ResumeData, JobDescription } from "../types";

function makeResume(): ResumeData {
  return {
    id: "res_1",
    name: "Aya Chabaki",
    headline: "Data Analyst",
    summary: "Original summary text that is reasonably long.",
    contact: { email: "a@b.c", phone: "+1", location: "Dubai" },
    skills: [{ name: "SQL" }, { name: "Python" }],
    experience: [
      { id: "exp_1", title: "Analyst", company: "ACME", location: "DXB", startDate: "2021", endDate: "2023", bullets: ["Did analysis", "Built dashboards"] },
      { id: "exp_2", title: "Intern", company: "BETA", location: "DXB", startDate: "2020", endDate: "2021", bullets: ["Supported team"] },
    ],
    education: [],
  } as unknown as ResumeData;
}

const jd: JobDescription = { title: "Senior Data Analyst", company: "Gulf Air", keywords: ["sql", "dashboards"] } as unknown as JobDescription;

describe("ProgressiveGenerator", () => {
  it("generates summary + per-experience bullets and composes an ID-matched patch", async () => {
    const calls: string[] = [];
    const gen = new ProgressiveGenerator(makeResume(), jd, "directive", async ({ systemPrompt }) => {
      calls.push(systemPrompt);
      if (systemPrompt.includes("professional summary")) {
        return "Optimized summary positioning the candidate for senior data analysis roles with SQL and dashboards expertise across aviation.";
      }
      return '["Led analysis", "Built dashboards improved"]';
    });

    await gen.generateSummary();
    await gen.generateExperienceBullets();

    const stages = gen.getStageResults();
    expect(stages.filter((s) => s.success).length).toBe(3); // summary + 2 experiences

    const patch = gen.composePatch();
    expect(patch.summary).toMatch(/Optimized summary/);
    // exp_1 keeps both rewrites; exp_2 (1 source bullet) is truncated to source count.
    expect(patch.experiences).toEqual([
      { id: "exp_1", bullets: ["Led analysis", "Built dashboards improved"] },
      { id: "exp_2", bullets: ["Led analysis"] },
    ]);
  });

  it("reconciles bullet counts to the patch contract (fewer → pad with originals)", async () => {
    const gen = new ProgressiveGenerator(makeResume(), jd, "", async ({ systemPrompt }) => {
      if (systemPrompt.includes("professional summary")) return "A good optimized summary that is long enough to pass validation checks.";
      return '["Only one rewritten bullet"]'; // source has 2 bullets
    });
    await gen.generateSummary();
    await gen.generateExperienceBullets();

    const stage = gen.getStageResults().find((s) => s.stage === "experience[0]");
    expect(stage?.success).toBe(true);
    expect(stage?.note).toMatch(/remainder kept original/);

    const patch = gen.composePatch();
    expect(patch.experiences![0].bullets).toEqual(["Only one rewritten bullet", "Built dashboards"]);
  });

  it("preserves ORIGINAL bullets IN THE PATCH for an entry whose generation fails after the repair round", async () => {
    const gen = new ProgressiveGenerator(makeResume(), jd, "", async ({ systemPrompt }) => {
      if (systemPrompt.includes("professional summary")) return "A good optimized summary that is long enough to pass validation checks.";
      return "garbage not json at all"; // fails parse + repair round
    });
    await gen.generateSummary();
    await gen.generateExperienceBullets();

    const failed = gen.getStageResults().filter((s) => s.stage.startsWith("experience[") && !s.success);
    expect(failed.length).toBe(2);
    // REGRESSION (production trace ec799db diagnosis): the patch must include
    // EVERY source experience entry — rewritten when the stage succeeded,
    // ORIGINAL bullets when it failed. The previous contract omitted failed
    // entries entirely, so a salvage with all bullet stages failing produced
    // `{ summary }` and the OptimizerOutputValidator rejected it with
    // "0 experience rewrites for N source entries — incomplete coverage",
    // dooming every retry. "Failed stage keeps original content" must hold at
    // the PATCH level, not only at assembly.
    expect(gen.composePatch().experiences).toEqual([
      { id: "exp_1", bullets: ["Did analysis", "Built dashboards"] },
      { id: "exp_2", bullets: ["Supported team"] },
    ]);
    expect(gen.hasAnySuccess()).toBe(true); // summary survived
  });

  it("reports failure when NOTHING succeeds", async () => {
    const gen = new ProgressiveGenerator(makeResume(), jd, "", async () => {
      throw new Error("provider down");
    });
    await gen.generateSummary();
    await gen.generateExperienceBullets();
    expect(gen.hasAnySuccess()).toBe(false);
  });

  it("feeds the parse error back on the repair round", async () => {
    let capturedRepairFeedback: string | undefined;
    const gen = new ProgressiveGenerator(makeResume(), jd, "", async ({ userPrompt }) => {
      if (!userPrompt.includes("COULD NOT BE PARSED")) {
        return "prose-wrapped garbage"; // first attempt per entry fails
      }
      if (!capturedRepairFeedback) capturedRepairFeedback = userPrompt;
      return '["Rewritten bullet one", "Rewritten bullet two"]';
    });
    // Only run experience[0] via the full flow
    await gen.generateExperienceBullets();
    expect(capturedRepairFeedback).toBeTruthy();
    expect(capturedRepairFeedback).toMatch(/COULD NOT BE PARSED/);
  });
});

describe("runProgressiveOptimization", () => {
  it("returns a BulletOnlyOptimizerResult-compatible salvage or null", async () => {
    // Full success path
    const ok = await runProgressiveOptimization(makeResume(), jd, {
      callAI: async ({ systemPrompt }) => {
        if (systemPrompt.includes("professional summary")) return "Salvaged summary for the senior data analyst target role with keywords.";
        return '["Rewritten bullet A", "Rewritten bullet B"]';
      },
    });
    expect(ok).not.toBeNull();
    expect(ok!.provider).toBe("progressive-sections");
    expect(ok!.output.experiences![0].id).toBe("exp_1");
    expect(ok!.warnings).toHaveLength(0);

    // Total failure path
    const none = await runProgressiveOptimization(makeResume(), jd, {
      callAI: async () => { throw new Error("all providers down"); },
    });
    expect(none).toBeNull();
  });

  it("collects warnings for failed stages while keeping successful ones", async () => {
    let n = 0;
    const result = await runProgressiveOptimization(makeResume(), jd, {
      callAI: async ({ systemPrompt }) => {
        if (systemPrompt.includes("professional summary")) return "Salvaged summary for the senior data analyst target role with keywords.";
        n++;
        if (n === 1) throw new Error("exp1 failed"); // experience[0] fails
        return '["Rewritten bullet A"]'; // experience[1] succeeds (1 bullet, source has 1)
      },
    });
    expect(result).not.toBeNull();
    expect(result!.warnings.length).toBe(1); // only the failed stage
    expect(result!.warnings[0]).toMatch(/experience\[0\]/);
    // REGRESSION: partial salvage keeps FULL entry coverage — failed exp_1
    // ships its original bullets, successful exp_2 ships the rewrite.
    expect(result!.output.experiences!.length).toBe(2);
    expect(result!.output.experiences![0]).toEqual({ id: "exp_1", bullets: ["Did analysis", "Built dashboards"] });
    expect(result!.output.experiences![1]).toEqual({ id: "exp_2", bullets: ["Rewritten bullet A"] });
  });

  it("exposes salvageStages so the pipeline can explain WHY stages failed", async () => {
    const result = await runProgressiveOptimization(makeResume(), jd, {
      callAI: async ({ systemPrompt }) => {
        if (systemPrompt.includes("professional summary")) return "Salvaged summary for the senior data analyst target role with keywords.";
        throw new Error("429 quota window — all providers limited");
      },
    });
    expect(result).not.toBeNull();
    expect(result!.salvageStages!.length).toBe(3); // summary + 2 experiences
    const failedStages = result!.salvageStages!.filter((s) => !s.success);
    expect(failedStages.length).toBe(2);
    expect(failedStages[0].error).toMatch(/429 quota window/);
  });
});

describe("describeSalvageStageFailures", () => {
  it("renders a compact per-stage failure summary for the validation error", async () => {
    const { describeSalvageStageFailures } = await import("./progressive-generator");
    const result = await runProgressiveOptimization(makeResume(), jd, {
      callAI: async ({ systemPrompt }) => {
        if (systemPrompt.includes("professional summary")) return "Salvaged summary for the senior data analyst target role with keywords.";
        throw new Error("AI call timed out after 60000ms");
      },
    });
    const summary = describeSalvageStageFailures(result!.salvageStages!);
    expect(summary).toContain("experience[0]");
    expect(summary).toContain("timed out");
    expect(summary).toContain("experience[1]");
    expect(summary).not.toContain("summary"); // succeeded stage is not listed
  });

  it("returns an empty string when every stage succeeded", () => {
    expect(describeSalvageStageFailures([
      { stage: "summary", success: true, provider: "progressive" },
      { stage: "experience[0]", success: true, provider: "progressive" },
    ])).toBe("");
  });
});
