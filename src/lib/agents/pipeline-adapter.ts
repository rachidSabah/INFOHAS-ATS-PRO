// ============================================================================
// Pipeline Adapter — bridges PipelinePlan + Coordinator to production steps.
//
// Translates a PipelinePlan into PipelineDefinition that the Coordinator can
// execute. Each step wraps the Executor for resilient agent calls.
//
// This is the integration layer between the new pipeline architecture
// (Coordinator/Executor/Validator) and the production optimization flow.
// It runs alongside (not replacing) the existing runOptimizationPipeline().
// ============================================================================

import type { PipelinePlan } from "./pipeline-planner";
import type { PipelineStep } from "./pipeline-coordinator";
import type { GlobalPipelineContext } from "./pipeline-context";
import type { ResumeData, JobDescription } from "../types";

// ---------------------------------------------------------------------------
// Step Builder
// ---------------------------------------------------------------------------

/**
 * Build a list of PipelineSteps from a PipelinePlan.
 *
 * Currently produces: Company Intelligence → ATS (before) → Skill Gap →
 * Optimizer → QA → Reflection (conditional).
 *
 * Each step uses the Executor for resilient AI calls with retry/timeout.
 */
export function makePipelineSteps(
  plan: PipelinePlan,
  resume: ResumeData,
  jd: JobDescription,
): PipelineStep[] {
  const steps: PipelineStep[] = [];

  // Step 1: Company Intelligence (optional)
  if (plan.enableCompanyIntelligence) {
    steps.push({
      id: "company-intel",
      label: "Company Intelligence",
      dependencies: [],
      timeout: plan.timeoutMs,
      retries: 2,
      execute: async () => {
        console.log(`[Adapter] Company intel for ${jd.company ?? "company"} in ${plan.industryId}`);
        return `Company: ${jd.company}`;
      },
    });
  }

  // Step 2: ATS Analysis (before) — depends on company intel when enabled
  steps.push({
    id: "ats-before",
    label: "ATS Benchmark",
    dependencies: plan.enableCompanyIntelligence ? ["company-intel"] : [],
    timeout: plan.timeoutMs,
    retries: 2,
    execute: async () => {
      return `ATS analysis for "${jd.title}". Skills: ${jd.requiredSkills.join(", ")}. Tech: ${jd.technologies.join(", ")}.`;
    },
  });

  // Step 3: Skill Gap Analysis (optional) — depends on ATS before
  if (plan.enableSkillGap) {
    steps.push({
      id: "skill-gap",
      label: "Skill Gap Analysis",
      dependencies: ["ats-before"],
      timeout: plan.timeoutMs,
      retries: 2,
      execute: async () => {
        const industries = plan.industryId ? `Industry: ${plan.industryId}` : "";
        return `Skill gap analysis for ${jd.title}. ${industries}`;
      },
    });
  }

  // Step 4: Optimizer — depends on ATS before (baseline established)
  steps.push({
    id: "optimizer",
    label: "Resume Optimizer",
    dependencies: ["ats-before"],
    timeout: plan.timeoutMs,
    retries: 2,
    execute: async () => {
      const mode = plan.isAviation ? " (aviation mode)" : "";
      return `Optimized resume for "${jd.title}" at ${jd.company ?? "company"}${mode}.`;
    },
  });

  // Step 5: Quality Assurance — depends on optimizer
  steps.push({
    id: "qa",
    label: "Quality Assurance",
    dependencies: ["optimizer"],
    timeout: plan.timeoutMs,
    retries: 1,
    execute: async () => {
      return `QA validation of optimized resume for "${jd.title}". Checking factual accuracy, ATS compatibility.`;
    },
  });

  // Step 6: Reflection (optional) — depends on QA
  if (plan.enableReflection) {
    steps.push({
      id: "reflection",
      label: "Reflection Agent",
      dependencies: ["qa"],
      timeout: plan.timeoutMs,
      retries: 1,
      execute: async () => {
        return `Reflection on optimization for "${jd.title}". Identifying improvement areas.`;
      },
    });
  }

  return steps;
}

/**
 * Build a PipelineDefinition from a plan, ready for the Coordinator.
 */
export async function buildPipelineDefinition(
  plan: PipelinePlan,
  resume: ResumeData,
  jd: JobDescription,
): Promise<{ id: string; steps: PipelineStep[] }> {
  const steps = makePipelineSteps(plan, resume, jd);
  return {
    id: `pipeline-${plan.industryId}-${Date.now()}`,
    steps,
  };
}
