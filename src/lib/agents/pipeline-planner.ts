// ============================================================================
// Pipeline Planner — analyzes inputs and decides which pipeline steps to run.
//
// The Planner sits between the Supervisor and the Orchestrator. It receives
// the JD + resume and returns a PipelinePlan: a comprehensive configuration
// that controls which steps run, what profiles to use, and how to configure
// each step.
//
// Currently the orchestrator always runs all 6 core steps unconditionally.
// The Planner makes explicit what was previously hardcoded — the industry
// detection, step selection, and configuration decisions.
//
// Future enhancements: conditionally skip steps based on JD analysis
// (e.g., skip skill-gap when there's no skill gap to analyze).
// ============================================================================

import type { AppSettings } from "../ats-directives";
import { mapToIndustryMode } from "../industry-mapper";
import type { JobDescription } from "../types";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PipelinePlan {
  /** Detected industry ID (from INDUSTRY_PROFILES) */
  industryId: string;
  /** Whether the pipeline has detected an aviation-adjacent industry */
  isAviation: boolean;
  /** Aviation mode to pass to the orchestrator (only for aviation-adjacent industries) */
  aviationMode?: {
    airlineProfile: string;
    settings: AppSettings;
  };
  /** Whether to run the Reflection agent after QA */
  enableReflection: boolean;
  /** Whether to run Company Intelligence (always true for now) */
  enableCompanyIntelligence: boolean;
  /** Whether to run Skill Gap analysis (always true for now) */
  enableSkillGap: boolean;
  /** Suggested timeout in ms for the full pipeline */
  timeoutMs: number;
  /** Optional user directives to inject into the optimizer prompt */
  userDirectives?: string;
  /** Human-readable summary of the plan for debugging */
  summary: string;
}

export interface PlanInput {
  resumeText: string;
  jd: JobDescription;
  employer?: string;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 180_000; // 3 minutes

// ---------------------------------------------------------------------------
// Planner
// ---------------------------------------------------------------------------

/**
 * Analyze inputs and produce a PipelinePlan.
 *
 * Currently always runs all 6 core steps. The Planner makes the industry
 * detection and aviation mode decisions explicit, and provides a foundation
 * for future conditional step skipping based on JD analysis.
 */
export async function createPlan(input: PlanInput): Promise<PipelinePlan> {
  const { resumeText, jd, employer } = input;

  const jdText = jd.rawText || (jd.keywords ?? []).join(" ");

  // === Step 1: Industry detection ===
  const mapperResult = mapToIndustryMode(jdText, resumeText);

  // === Step 2: Build the plan ===
  const industryId = mapperResult.detection.industryId;
  const isAviation = mapperResult.aviationMode != null;
  const enableReflection = true; // always on — QA will gate it internally

  const plan: PipelinePlan = {
    industryId,
    isAviation,
    aviationMode: mapperResult.aviationMode,
    enableReflection,
    enableCompanyIntelligence: true,
    enableSkillGap: true,
    timeoutMs: DEFAULT_TIMEOUT_MS,
    summary: `Industry: ${industryId} | Aviation mode: ${isAviation ? "ON" : "OFF"} | Steps: all 6 core + ${enableReflection ? "Reflection" : "no Reflection"}`,
  };

  return plan;
}
