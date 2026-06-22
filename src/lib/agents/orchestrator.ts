// ============================================================================
// Agent Orchestrator — coordinates the 5-agent resume optimization pipeline.
//
// Pipeline:
//   1. Resume Parser Agent      — parses uploaded file → ResumeData
//   2. Job Intelligence Agent   — scrapes URL / analyzes JD → JobIntelligence
//   3. ATS Analysis Agent       — scores resume against JD → ATSAnalysisResult
//   4. Resume Optimizer Agent   — rewrites resume for ATS + JD → optimized ResumeData
//   5. Quality Assurance Agent  — validates optimized resume → QAResult
//   6. Reflection Agent (opt.)  — triggered when QA confidence < 80 → reflection notes
//
// This is a COMPOSITION layer over the existing agents — no rewrites.
// Each step calls into the existing modules (parser.ts, job-intelligence.ts,
// ats.ts, ai.ts, output-validator.ts) and the new agent modules
// (ats-analysis.ts, qa-agent.ts).
//
// Designed for Cloudflare Pages Free (Edge Runtime compatible):
//   - No external queues, no message buses, no long-running state
//   - Each step is an async function that completes in < 30s
//   - Intermediate artifacts are returned to the caller (UI) for persistence
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import type { JobIntelligence } from "../job-intelligence";
import { analyzeJobIntelligence } from "../job-intelligence";
import { callAI, getOptimizerDirective, extractJSON } from "../ai";
import { processAIResponse } from "../ai-response-processor";
import { validateResumeContent } from "../ai-error-filter";
import { aviationOptimize, type AviationOptimizeResult } from "../ats-directives";
import type { AppSettings } from "../ats-directives";
import { analyzeATS, type ATSAnalysisResult } from "./ats-analysis";
import { runQA, type QAResult } from "./qa-agent";
import { analyzeCompanyIntelligence, analyzeSkillGap, type CompanyIntelligence, type SkillGapIntelligence } from "./company-skill-agents";
import { uid } from "../store";
import type { ResumeSkill } from "../types";

// ============================================================================
// AI response normalization helpers
// ============================================================================

/**
 * Flatten a value that might be an object into a string.
 * Handles: strings, numbers, booleans, null/undefined, arrays, objects.
 * - { city: "Doha", country: "Qatar" } → "Doha, Qatar"
 * - ["React", "Node.js"] → "React, Node.js"
 * - 42 → "42"
 * - null/undefined → ""
 * This prevents React error #31 ("Objects are not valid as a React child")
 * when the AI returns an object where a string is expected.
 */
function flattenValue(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "number" || typeof v === "boolean") return String(v);
  if (Array.isArray(v)) return v.map((x) => flattenValue(x)).filter(Boolean).join(", ");
  if (typeof v === "object") {
    // If it's a location-like object { city, country }, join the values
    const values = Object.values(v).filter((x) => x !== null && x !== undefined && x !== "");
    if (values.length > 0) return values.map((x) => flattenValue(x)).join(", ");
    return "";
  }
  return String(v);
}

/**
 * Flatten a location field that might be a string or an object.
 * - "Doha, Qatar" → "Doha, Qatar"
 * - { city: "Doha", country: "Qatar" } → "Doha, Qatar"
 * - { city: "Doha" } → "Doha"
 * - null/undefined → ""
 */
function flattenLocation(v: any): string {
  if (v === null || v === undefined) return "";
  if (typeof v === "string") return v;
  if (typeof v === "object") {
    // Try common location field names: city, country, state, region, address
    const parts = [v.city, v.state, v.region, v.country, v.address].filter((x) => x && typeof x === "string");
    if (parts.length > 0) return parts.join(", ");
    // Fallback: join all string values
    return flattenValue(v);
  }
  return String(v);
}

// ============================================================================
// Types
// ============================================================================

export interface PipelineInput {
  /** The user's uploaded resume (already parsed) */
  resume: ResumeData;
  /** The target job description (already parsed) */
  jd: JobDescription;
  /** Optional user override directives (from Optimizer Directive settings) */
  userDirectives?: string;
  /** Optional: run in Aviation ATS Mode (uses aviation-specific directive + airline profile) */
  aviationMode?: {
    airlineProfile: string;
    settings: AppSettings;
  };
  /** Optional: run the export quality check (slow, renders a PDF). Default: false. */
  checkExport?: boolean;
  /** Optional: enable the Reflection Agent (triggers when QA confidence < 75 or ATS improvement < 5). Default: true. */
  enableReflection?: boolean;
  /** Optional: real-time progress callback. Fired after each step completes. */
  onProgress?: (progress: PipelineProgress) => void;
}

export interface PipelineProgress {
  /** 0-based index of the current step */
  stepIndex: number;
  /** Total number of steps (5) */
  totalSteps: number;
  /** 1-based step number (for display) */
  stepNumber: number;
  /** Human-readable step name */
  stepName: string;
  /** Completion percentage (0-100) */
  percent: number;
  /** Estimated time remaining in seconds (based on elapsed time) */
  etaSeconds: number;
  /** Latest log line */
  log: string;
}

export interface PipelineStep {
  name: string;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
  startedAt?: string;
  completedAt?: string;
  durationMs?: number;
  error?: string;
  /** Human-readable log line for the UI */
  log?: string;
}

export interface PipelineResult {
  /** The optimized resume (null if optimization failed) */
  optimizedResume: ResumeData | null;
  /** ATS analysis of the original resume (before optimization) */
  beforeATS: ATSAnalysisResult | null;
  /** ATS analysis of the optimized resume (after optimization) */
  afterATS: ATSAnalysisResult | null;
  /** Job intelligence extracted from the JD */
  jobIntelligence: JobIntelligence | null;
  /** Company intelligence (Step 3 — runs in parallel with Skill Gap) */
  companyIntelligence: CompanyIntelligence | null;
  /** Skill gap intelligence (Step 4 — runs in parallel with Company Intelligence) */
  skillGap: SkillGapIntelligence | null;
  /** QA validation result */
  qa: QAResult | null;
  /** Reflection notes (only if Reflection Agent triggered) */
  reflection: ReflectionResult | null;
  /** Per-step execution status (for the UI pipeline visualization) */
  steps: PipelineStep[];
  /** Overall pipeline status */
  status: "running" | "completed" | "failed";
  /** Provider that generated the optimized resume */
  provider: string;
  /** Character count of the optimized resume body content */
  charCount: number;
  /** Whether the optimization met the ~2900 char target */
  metCharTarget: boolean;
}

export interface ReflectionResult {
  triggered: boolean;
  reason: string;
  /** AI-generated reflection on the optimization quality */
  notes: string;
  /** Identified issues */
  issues: string[];
  /** Suggested improvements */
  suggestions: string[];
  /** Confidence in the reflection (0-100) */
  confidence: number;
}

// ============================================================================
// Main orchestrator
// ============================================================================

/**
 * Run the full 5-agent optimization pipeline.
 *
 * This is the single entry point for resume optimization. It coordinates:
 *   1. Job Intelligence Agent (analyze the JD)
 *   2. ATS Analysis Agent (score the original resume — "before")
 *   3. Resume Optimizer Agent (rewrite the resume)
 *   4. Quality Assurance Agent (validate the optimized resume)
 *   5. Reflection Agent (optional — triggers when QA confidence < 80)
 *
 * The Resume Parser Agent is NOT called here — the caller passes an already-parsed
 * ResumeData. Parsing happens at upload time (see parser.ts → Optimizer.tsx).
 *
 * @returns A PipelineResult with all intermediate artifacts + the optimized resume.
 */
export async function runOptimizationPipeline(input: PipelineInput): Promise<PipelineResult> {
  const { resume, jd, userDirectives, aviationMode, checkExport = false, enableReflection = true } = input;

  // === Upgraded 7-step pipeline (V2) ===
  //   1. Job Intelligence
  //   2. Company Intelligence + Skill Gap (PARALLEL)
  //   3. ATS Analysis (Before)
  //   4. Resume Optimizer (now consumes Company + SkillGap intelligence)
  //   5. Quality Assurance
  //   6. Reflection (optional)
  const steps: PipelineStep[] = [
    { name: "Job Intelligence", status: "pending" },
    { name: "Company + Skill Gap (parallel)", status: "pending" },
    { name: "ATS Analysis (Before)", status: "pending" },
    { name: "Resume Optimizer", status: "pending" },
    { name: "Quality Assurance", status: "pending" },
    { name: "Reflection", status: "pending" },
  ];

  const result: PipelineResult = {
    optimizedResume: null,
    beforeATS: null,
    afterATS: null,
    jobIntelligence: null,
    companyIntelligence: null,
    skillGap: null,
    qa: null,
    reflection: null,
    steps,
    status: "running",
    provider: "unknown",
    charCount: 0,
    metCharTarget: false,
  };

  const log = (stepName: string, message: string) => {
    const step = steps.find((s) => s.name === stepName);
    if (step) step.log = message;
  };

  // === Progress emitter ===
  const pipelineStartTime = Date.now();
  const emitProgress = (stepIndex: number, message: string) => {
    if (!input.onProgress) return;
    const step = steps[stepIndex];
    const elapsedMs = Date.now() - pipelineStartTime;
    const percent = Math.round(((stepIndex) / steps.length) * 100);
    // ETA: extrapolate based on elapsed time per completed step
    const completedSteps = steps.filter((s) => s.status === "completed").length;
    const avgPerStep = completedSteps > 0 ? elapsedMs / completedSteps : 8000;
    const remainingSteps = steps.length - completedSteps;
    const etaSeconds = Math.round((avgPerStep * remainingSteps) / 1000);
    input.onProgress({
      stepIndex,
      totalSteps: steps.length,
      stepNumber: stepIndex + 1,
      stepName: step?.name ?? `Step ${stepIndex + 1}`,
      percent,
      etaSeconds,
      log: message,
    });
  };

  // ========================================================================
  // Step 1: Job Intelligence Agent
  // ========================================================================
  try {
    const step = steps[0];
    step.status = "running";
    step.startedAt = new Date().toISOString();
    log("Job Intelligence", "Analyzing job description for skills, keywords, and industry context…");
    emitProgress(0, "Analyzing job description…");

    result.jobIntelligence = await analyzeJobIntelligence(jd);

    step.completedAt = new Date().toISOString();
    step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = "completed";
    const jiLog = `Extracted ${result.jobIntelligence.priorityKeywords.length} priority keywords, ${result.jobIntelligence.requiredSkills.length} required skills. Industry: ${result.jobIntelligence.industry ?? "unknown"}.`;
    log("Job Intelligence", jiLog);
    emitProgress(0, jiLog);
  } catch (e: any) {
    steps[0].status = "failed";
    steps[0].error = e?.message ?? "Job Intelligence failed";
    log("Job Intelligence", `⚠ Job Intelligence failed: ${e?.message}. Continuing without JI.`);
    emitProgress(0, `Job Intelligence failed: ${e?.message}. Continuing…`);
    // Non-fatal — continue without JI
  }

  // ========================================================================
  // Step 2: Company Intelligence + Skill Gap (PARALLEL)
  // ========================================================================
  // These two agents run concurrently via Promise.all — they're independent
  // (Company Intel uses JD + JI; Skill Gap uses Resume + JD + JI + Company).
  // We pass Company Intel into Skill Gap via a sequential dependency inside
  // the parallel block (Company first, then Skill Gap with Company result).
  // In practice both still complete in ~1 AI round-trip each since Skill Gap
  // can proceed even if Company Intel is null.
  try {
    const step = steps[1];
    step.status = "running";
    step.startedAt = new Date().toISOString();
    log("Company + Skill Gap (parallel)", "Generating company intelligence + skill gap analysis in parallel…");
    emitProgress(1, "Analyzing company + skill gaps in parallel…");

    // Run Company Intelligence first (Skill Gap benefits from Company result).
    // If Company Intel fails, Skill Gap still proceeds (degraded but functional).
    try {
      result.companyIntelligence = await analyzeCompanyIntelligence(jd, result.jobIntelligence);
      const ciLog = result.companyIntelligence
        ? `Company: ${result.companyIntelligence.companyName} · ${result.companyIntelligence.valuedCompetencies.length} valued competencies · ATS: ${result.companyIntelligence.likelyAtsSystem} · ${result.companyIntelligence.companySpecificPriorities.length} company-specific priorities`
        : "No company identifiable — skipping company-specific optimization.";
      log("Company + Skill Gap (parallel)", `Company Intel: ${ciLog}`);
    } catch (e: any) {
      log("Company + Skill Gap (parallel)", `⚠ Company Intel failed: ${e?.message}. Continuing without it.`);
    }

    // Run Skill Gap (uses Company Intel if available)
    try {
      result.skillGap = await analyzeSkillGap(resume, jd, result.jobIntelligence, result.companyIntelligence);
      const sgLog = result.skillGap
        ? `Skill Gap: ${result.skillGap.overallMatch}% overall match · ${result.skillGap.missingSkills.critical.length} critical / ${result.skillGap.missingSkills.important.length} important / ${result.skillGap.missingSkills.optional.length} optional gaps · ${result.skillGap.transferableSkills.length} transferable · ${result.skillGap.adjacentSkills.length} adjacent`
        : "Skill Gap analysis unavailable — continuing without it.";
      log("Company + Skill Gap (parallel)", `Skill Gap: ${sgLog}`);
      emitProgress(1, result.skillGap ? `Skill match: ${result.skillGap.overallMatch}%. Bridging ${result.skillGap.missingSkills.critical.length} critical gaps.` : "Skill gap analysis done.");
    } catch (e: any) {
      log("Company + Skill Gap (parallel)", `⚠ Skill Gap failed: ${e?.message}. Continuing without it.`);
    }

    step.completedAt = new Date().toISOString();
    step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = "completed";
  } catch (e: any) {
    steps[1].status = "failed";
    steps[1].error = e?.message ?? "Company + Skill Gap failed";
    log("Company + Skill Gap (parallel)", `⚠ Both failed: ${e?.message}. Continuing without intelligence.`);
    emitProgress(1, `Company + Skill Gap failed: ${e?.message}. Continuing…`);
    // Non-fatal — optimizer will work with just JI + ATS
  }

  // ========================================================================
  // Step 3: ATS Analysis Agent (Before)
  // ========================================================================
  try {
    const step = steps[2];
    step.status = "running";
    step.startedAt = new Date().toISOString();
    log("ATS Analysis (Before)", "Scoring original resume against job description…");
    emitProgress(2, "Calculating ATS match score…");

    result.beforeATS = analyzeATS(resume, jd);

    step.completedAt = new Date().toISOString();
    step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = "completed";
    const atsLog = `ATS score: ${result.beforeATS.scores.ats}/100 (keyword: ${result.beforeATS.scores.keywordMatch}, semantic: ${result.beforeATS.scores.semanticSimilarity}, readability: ${result.beforeATS.scores.readability}). Missing ${result.beforeATS.missingKeywords.length} keywords.`;
    log("ATS Analysis (Before)", atsLog);
    emitProgress(2, atsLog);
  } catch (e: any) {
    steps[2].status = "failed";
    steps[2].error = e?.message ?? "ATS Analysis failed";
    log("ATS Analysis (Before)", `⚠ ATS Analysis failed: ${e?.message}.`);
    emitProgress(2, `ATS Analysis failed: ${e?.message}`);
    // Fatal — can't optimize without a baseline score
    result.status = "failed";
    return result;
  }

  // ========================================================================
  // Step 4: Resume Optimizer Agent
  // ========================================================================
  try {
    const step = steps[3];
    step.status = "running";
    step.startedAt = new Date().toISOString();
    emitProgress(3, aviationMode ? `Optimizing for ${aviationMode.airlineProfile}…` : "Optimizing resume with full intelligence context…");

    if (aviationMode) {
      log("Resume Optimizer", `Aviation ATS mode → ${aviationMode.airlineProfile}. Calling aviationOptimize() with unified directive…`);
      const aviationResult = await aviationOptimize(resume, jd.rawText ?? "", aviationMode.airlineProfile, aviationMode.settings);
      result.optimizedResume = mapAviationResultToResumeData(aviationResult, resume);
      result.provider = "aviation-ats";
      result.charCount = aviationResult.charCount;
      const optLog = `✓ Generated ${aviationResult.charCount} chars (target ~2900). ATS score: ${aviationResult.score}/100. ${aviationResult.matched_keywords.length} keywords matched.`;
      log("Resume Optimizer", optLog);
      emitProgress(3, optLog);
    } else {
      log("Resume Optimizer", "Standard optimization mode. Building directive from super-admin config + JD + Company + SkillGap context…");
      const directive = userDirectives?.trim() || getOptimizerDirective();
      const optimizeResult = await optimizeResumeStandard(
        resume, jd, directive,
        result.jobIntelligence,
        result.companyIntelligence,
        result.skillGap,
      );
      result.optimizedResume = optimizeResult.resume;
      result.provider = optimizeResult.provider;
      result.charCount = optimizeResult.charCount;
      const optLog = `✓ Generated ${optimizeResult.charCount} chars (target ~2900) via ${optimizeResult.provider}. Embedded ${optimizeResult.keywordsAdded} keywords. Used ${result.companyIntelligence ? "Company+" : ""}${result.skillGap ? "SkillGap+" : ""}JI intelligence.`;
      log("Resume Optimizer", optLog);
      emitProgress(3, optLog);
    }

    result.metCharTarget = result.charCount >= 2500 && result.charCount <= 3100;

    step.completedAt = new Date().toISOString();
    step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = "completed";
  } catch (e: any) {
    steps[3].status = "failed";
    steps[3].error = e?.message ?? "Optimizer failed";
    log("Resume Optimizer", `✗ Optimizer failed: ${e?.message}`);
    emitProgress(3, `Optimizer failed: ${e?.message}`);
    result.status = "failed";
    return result;
  }

  // ========================================================================
  // Step 5: Quality Assurance Agent
  // ========================================================================
  try {
    const step = steps[4];
    step.status = "running";
    step.startedAt = new Date().toISOString();
    log("Quality Assurance", "Validating optimized resume: factual consistency, professional tone, ATS compatibility, export quality…");
    emitProgress(4, "Verifying quality and consistency…");

    result.qa = await runQA(
      result.optimizedResume!,
      jd,
      result.jobIntelligence,
      resume, // original — for factual consistency check
      { checkExport }
    );

    step.completedAt = new Date().toISOString();
    step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = "completed";

    const passedChecks = result.qa.checks.filter((c) => c.passed).length;
    const totalChecks = result.qa.checks.length;
    const qaLog = `${passedChecks}/${totalChecks} checks passed. Confidence: ${result.qa.confidence}/100. ${result.qa.factualConsistency?.passed ? "No fabrication detected." : `⚠ ${result.qa.factualConsistency?.issueCount} factual issues.`}`;
    log("Quality Assurance", qaLog);
    emitProgress(4, qaLog);

    // === ATS Analysis (After) ===
    result.afterATS = analyzeATS(result.optimizedResume!, jd);
    const beforeScore = result.beforeATS.scores.ats;
    const afterScore = result.afterATS.scores.ats;
    const afterLog = `After-optimization ATS score: ${afterScore}/100 (was ${beforeScore}, +${afterScore - beforeScore} pts).`;
    log("Quality Assurance", afterLog);
    emitProgress(4, afterLog);
  } catch (e: any) {
    steps[4].status = "failed";
    steps[4].error = e?.message ?? "QA failed";
    log("Quality Assurance", `⚠ QA failed: ${e?.message}. Optimized resume may still be usable.`);
    emitProgress(4, `QA failed: ${e?.message}. Continuing…`);
    // Non-fatal — return the optimized resume even if QA failed
  }

  // ========================================================================
  // Step 6: Reflection Agent (optional — triggers when confidence < 75
  //         OR ATS score improvement < 5 points)
  // ========================================================================
  const reflectionStep = steps[5];
  const atsImprovement = result.beforeATS && result.afterATS
    ? result.afterATS.scores.ats - result.beforeATS.scores.ats
    : 0;
  const shouldTriggerReflection = enableReflection && result.qa && (
    result.qa.shouldReflect || // confidence < 75 OR critical check failed
    atsImprovement < 5 // optimization didn't meaningfully improve ATS score
  );

  if (shouldTriggerReflection && result.qa) {
    try {
      reflectionStep.status = "running";
      reflectionStep.startedAt = new Date().toISOString();
      const reason = result.qa.shouldReflect
        ? `QA confidence is ${result.qa.confidence}/100 (below 75 threshold)`
        : `ATS score improvement was only ${atsImprovement} pts (below 5-pt threshold)`;
      log("Reflection", `${reason} — triggering Reflection Agent…`);
      emitProgress(5, "Reflecting on optimization quality…");

      result.reflection = await runReflectionAgent(
        resume,
        result.optimizedResume!,
        jd,
        result.qa
      );

      reflectionStep.completedAt = new Date().toISOString();
      reflectionStep.durationMs = Date.now() - new Date(reflectionStep.startedAt).getTime();
      reflectionStep.status = "completed";
      const reflLog = `Reflection complete: ${result.reflection.issues.length} issues identified, ${result.reflection.suggestions.length} suggestions. Confidence: ${result.reflection.confidence}/100.`;
      log("Reflection", reflLog);
      emitProgress(5, reflLog);
    } catch (e: any) {
      reflectionStep.status = "failed";
      reflectionStep.error = e?.message ?? "Reflection failed";
      log("Reflection", `⚠ Reflection failed: ${e?.message}`);
      emitProgress(5, `Reflection failed: ${e?.message}`);
    }
  } else {
    reflectionStep.status = "skipped";
    log("Reflection", enableReflection
      ? `Skipped — QA confidence ${result.qa?.confidence ?? "?"}/100 ≥ 75 and ATS improved ${atsImprovement} pts ≥ 5. No reflection needed.`
      : "Skipped — Reflection Agent disabled.");
  }

  result.status = "completed";
  // Final 100% progress emission
  if (input.onProgress) {
    input.onProgress({
      stepIndex: steps.length,
      totalSteps: steps.length,
      stepNumber: steps.length,
      stepName: "Complete",
      percent: 100,
      etaSeconds: 0,
      log: "Pipeline complete.",
    });
  }
  return result;
}

// ============================================================================
// Standard Resume Optimizer (extracted from Optimizer.tsx inline logic)
// ============================================================================

async function optimizeResumeStandard(
  resume: ResumeData,
  jd: JobDescription,
  directive: string,
  ji: JobIntelligence | null,
  company: CompanyIntelligence | null = null,
  skillGap: SkillGapIntelligence | null = null,
): Promise<{ resume: ResumeData; provider: string; charCount: number; keywordsAdded: number }> {
  // Compute missing keywords from the JD
  const jdKeywords = jd.keywords ?? [];
  const resumeText = JSON.stringify(resume).toLowerCase();
  const missingKeywords = jdKeywords.filter((k) => !resumeText.includes(k.toLowerCase()));

  // === Build the multi-source intelligence context for the optimizer ===
  // The optimizer now reasons about: what the company values, which skills
  // are missing + how to bridge them via transferable skills, and the JD's
  // priority keywords — instead of just keyword-stuffing.
  const intelligenceBlocks: string[] = [];

  if (ji) {
    intelligenceBlocks.push(`JOB INTELLIGENCE:
Industry: ${ji.industry}
Business Function: ${ji.businessFunction}
Recruiter Intent: ${ji.recruiterIntent}
Priority Keywords: ${ji.priorityKeywords.join(", ")}
Required Skills: ${ji.requiredSkills.join(", ")}
Required Competencies: ${ji.requiredCompetencies.join(", ")}`);
  }

  if (company) {
    intelligenceBlocks.push(`COMPANY INTELLIGENCE (${company.companyName}):
Culture: ${company.culture}
Values: ${company.values.join(", ")}
Leadership Principles: ${company.leadershipPrinciples.join(", ")}
Hiring Priorities: ${company.hiringPriorities.join(", ")}
Valued Competencies: ${company.valuedCompetencies.join(", ")}
Company-Specific Priorities (MUST reflect in resume): ${company.companySpecificPriorities.join(", ")}
Likely ATS System: ${company.likelyAtsSystem}
Interview Focus Areas: ${company.interviewFocusAreas.join(", ")}
Positioning Advice: ${company.positioningAdvice}`);
  }

  if (skillGap) {
    intelligenceBlocks.push(`SKILL GAP INTELLIGENCE:
Overall Match: ${skillGap.overallMatch}%
Missing Skills (CRITICAL — bridge via transferable skills, do NOT fabricate): ${skillGap.missingSkills.critical.join(", ") || "(none)"}
Missing Skills (IMPORTANT): ${skillGap.missingSkills.important.join(", ") || "(none)"}
Missing Skills (OPTIONAL): ${skillGap.missingSkills.optional.join(", ") || "(none)"}
Transferable Skills (use these to bridge gaps):
${skillGap.transferableSkills.map((t) => `  - ${t.candidateSkill} ≈ ${t.equivalentTo} (${t.rationale})`).join("\n") || "  (none)"}
Adjacent Skills (candidate likely has but didn't list — surface these): ${skillGap.adjacentSkills.join(", ") || "(none)"}
Bridging Strategy: ${skillGap.bridgingStrategy}`);
  }

  intelligenceBlocks.push(`MISSING JD KEYWORDS TO EMBED NATURALLY (semantic optimization, NOT stuffing): ${missingKeywords.join(", ") || "(none — focus on rewriting for impact)"}`);

  intelligenceBlocks.push(`OPTIMIZER REASONING (do this BEFORE rewriting):
1. What does ${company?.companyName ?? "this company"} value most? → ${company?.companySpecificPriorities.join("; ") ?? "industry-standard priorities"}
2. Which of the candidate's experiences are MOST relevant to these values?
3. Which achievements should be EMPHASIZED to align with company priorities?
4. Which keywords should be INTRODUCED (from priority keywords + missing keywords)?
5. Which TRANSFERABLE skills should be HIGHLIGHTED to bridge missing skills? (Never fabricate — only reframe existing experience.)
6. How to improve ATS compatibility (keyword coverage, formatting, section structure)?
7. How to improve RECRUITER appeal (quantified impact, action verbs, company-aligned language)?

Produce a one-page A4 resume (~2,700-3,000 chars) that is:
- ATS compliant (keywords embedded semantically, not stuffed)
- Recruiter optimized (quantified, action-verb-led bullets)
- Industry aligned
- Company aligned (reflects the company-specific priorities above)
- Factually consistent with the source resume (NO fabrication of experience, certs, projects, or metrics)`);

  const intelligenceContext = intelligenceBlocks.join("\n\n");

  const result = await callAI({
    systemPrompt: directive,
    userPrompt: `SOURCE RESUME (be truthful to this — never invent employers, dates, or metrics):\n${JSON.stringify({
      name: resume.name,
      headline: resume.headline,
      contact: resume.contact,
      dateOfBirth: resume.dateOfBirth,
      summary: resume.summary,
      experience: resume.experience.map((e) => ({ title: e.title, company: e.company, location: e.location, startDate: e.startDate, endDate: e.endDate, bullets: e.bullets })),
      education: resume.education.map((ed) => ({ degree: ed.degree, field: ed.field, institution: ed.institution, location: ed.location, startDate: ed.startDate, endDate: ed.endDate, highlights: ed.highlights })),
      skills: resume.skills.map((s) => ({ name: s.name, category: s.category })),
      languages: resume.languages,
      certifications: resume.certifications,
    })}\n\nTARGET JOB DESCRIPTION:\n${jd.rawText ?? JSON.stringify({ title: jd.title, company: jd.company, responsibilities: jd.responsibilities, requiredSkills: jd.requiredSkills, keywords: jd.keywords })}\n\n${intelligenceContext}\n\nReturn ONLY the JSON object described in the directive. No prose, no markdown fences.`,
    maxTokens: 4000,
    temperature: 0.4,
    taskCategory: "document",
  });

  // Process the AI response through the full leak-prevention pipeline
  console.info(`[Optimizer] Provider: ${result.provider}, Response length: ${result.text?.length ?? 0} chars, Tokens est: ${result.tokensEstimate}`);
  const processed = processAIResponse<any>(result.text, result.provider, { expectJson: true });
  let data: any;
  if (processed.data) {
    data = processed.data;
  } else {
    // === ERROR CLASSIFICATION + RETRY ===
    const responseLength = result.text?.trim().length ?? 0;
    let errorType = "Unknown";
    if (responseLength === 0) errorType = "Provider Returned Empty Response";
    else if (responseLength < 50) errorType = "Response Truncated";
    else if (result.text.includes("```")) errorType = "Markdown Wrapped JSON";
    else errorType = "Invalid JSON";

    console.warn(`[Optimizer] AI response failed parsing (${errorType}). Length: ${responseLength}. Retrying with simpler prompt...`);
    console.warn(`[Optimizer] Raw response preview: ${result.text?.slice(0, 200) ?? "(empty)"}`);

    // === RETRY with a simpler prompt ===
    if (responseLength < 200) {
      const retryResult = await callAI({
        systemPrompt: "You are a resume optimizer. Return ONLY a valid JSON object. No prose, no markdown fences, no explanations.",
        userPrompt: `SOURCE RESUME:\n${JSON.stringify({ name: resume.name, headline: resume.headline, contact: resume.contact, summary: resume.summary, experience: resume.experience, education: resume.education, skills: resume.skills, languages: resume.languages, certifications: resume.certifications })}\n\nJOB DESCRIPTION:\n${jd.rawText?.slice(0, 1500) ?? jd.keywords.join(", ")}\n\nOptimize this resume for the job. Return ONLY a JSON object with: name, headline, email, phone, location, summary, skills [{category, items[]}], experience [{title, company, location, startDate, endDate, bullets[]}], education [{degree, institution, field, startDate, endDate, modules}], languages [{name, proficiency}]. No prose, no markdown.`,
        maxTokens: 4000,
        temperature: 0.4,
        taskCategory: "document",
      });
      console.info(`[Optimizer] Retry response: Provider: ${retryResult.provider}, Length: ${retryResult.text?.length ?? 0}`);
      const retryProcessed = processAIResponse<any>(retryResult.text, retryResult.provider, { expectJson: true });
      if (retryProcessed.data) {
        data = retryProcessed.data;
      } else {
        throw new Error(`${errorType} — retry also failed. Provider: ${retryResult.provider}. Please try again or configure an API provider in AI Routing Settings.`);
      }
    } else {
      throw new Error(`${errorType} (response length: ${responseLength}). Provider: ${result.provider}. Please try again or configure an API provider in AI Routing Settings.`);
    }
  }

  // Map AI JSON → ResumeData
  const aiSkills: ResumeSkill[] = (data.skills ?? []).flatMap((g: any) =>
    (g.items ?? []).map((name: string) => ({ id: uid("s"), name, category: g.category || "General" }))
  );
  const skills: ResumeSkill[] = aiSkills.length > 0
    ? aiSkills
    : [...resume.skills, ...missingKeywords.map((k) => ({ id: uid("s"), name: k, category: "Skills" }))].filter((s, idx, arr) => arr.findIndex((x) => x.name.toLowerCase() === s.name.toLowerCase()) === idx);

  const optimized: ResumeData = {
    id: uid("r"),
    name: String(data.name || resume.name || ""),
    headline: String(data.headline || resume.headline || ""),
    contact: {
      email: String(data.email || resume.contact.email || ""),
      phone: String(data.phone || resume.contact.phone || ""),
      location: flattenLocation(data.location) || resume.contact.location,
      website: resume.contact.website,
      linkedin: resume.contact.linkedin,
      github: resume.contact.github,
    },
    dateOfBirth: data.dateOfBirth || resume.dateOfBirth,
    summary: String(data.summary || ""),
    experience: (data.experience ?? []).length > 0
      ? data.experience.map((e: any) => ({
          id: uid("e"),
          title: String(e.title || ""),
          company: String(e.company || ""),
          location: flattenLocation(e.location) || "",
          startDate: String(e.startDate || ""),
          endDate: String(e.endDate || "Present"),
          bullets: Array.isArray(e.bullets) ? e.bullets.map((b: any) => flattenValue(b)) : [],
        }))
      : resume.experience,
    education: (data.education ?? []).length > 0
      ? data.education.map((ed: any) => ({
          id: uid("ed"),
          degree: String(ed.degree || ""),
          institution: String(ed.institution || ""),
          field: String(ed.field || ""),
          location: flattenLocation(ed.location) || "",
          startDate: String(ed.startDate || ""),
          endDate: String(ed.endDate || ""),
          highlights: ed.modules ? [`Modules: ${ed.modules}`] : ed.highlights || [],
        }))
      : resume.education,
    skills,
    projects: resume.projects,
    certifications: resume.certifications,
    languages: (data.languages ?? []).length > 0
      ? data.languages.map((l: any) => ({
          id: uid("l"),
          name: l.name || "",
          proficiency: (l.proficiency || "fluent").toLowerCase() as any,
          ...(l.note ? { note: l.note } : {}),
        })) as any
      : resume.languages,
    template: "infohas-pro",
    accentColor: "#0563C1",
    photoUrl: resume.photoUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "ai-optimized",
    fileName: resume.fileName,
  };

  // Run content validation + leak cleaning
  const contentCheck = validateResumeContent(optimized);
  const finalResume = contentCheck.cleanedResume ?? optimized;

  // Compute char count
  const charCount = JSON.stringify({
    summary: finalResume.summary,
    experience: finalResume.experience,
    skills: finalResume.skills,
    education: finalResume.education,
    languages: finalResume.languages,
  }).length;

  return {
    resume: finalResume,
    provider: result.provider,
    charCount,
    keywordsAdded: data.missingKeywordsAdded?.length ?? 0,
  };
}

// ============================================================================
// Helper: map AviationOptimizeResult → ResumeData
// ============================================================================

function mapAviationResultToResumeData(result: AviationOptimizeResult, original: ResumeData): ResumeData {
  const aiSkills: ResumeSkill[] = (result.resume.skills ?? []).flatMap((g: any) =>
    (g.items ?? []).map((name: string) => ({ id: uid("s"), name: flattenValue(name), category: flattenValue(g.category) || "General" }))
  );

  return {
    id: uid("r"),
    name: String(result.resume.name || original.name || ""),
    headline: String(result.resume.headline || original.headline || ""),
    contact: {
      email: String(result.resume.email || original.contact.email || ""),
      phone: String(result.resume.phone || original.contact.phone || ""),
      location: flattenLocation(result.resume.location) || original.contact.location,
      website: original.contact.website,
      linkedin: original.contact.linkedin,
      github: original.contact.github,
    },
    dateOfBirth: result.resume.dateOfBirth || original.dateOfBirth,
    summary: String(result.resume.summary || ""),
    experience: (result.resume.experience ?? []).length > 0
      ? result.resume.experience.map((e: any) => ({
          id: uid("e"),
          title: String(e.title || ""),
          company: String(e.company || ""),
          location: flattenLocation(e.location) || "",
          startDate: String(e.startDate || ""),
          endDate: String(e.endDate || "Present"),
          bullets: Array.isArray(e.bullets) ? e.bullets.map((b: any) => flattenValue(b)) : [],
        }))
      : original.experience,
    education: (result.resume.education ?? []).length > 0
      ? result.resume.education.map((ed: any) => ({
          id: uid("ed"),
          degree: String(ed.degree || ""),
          institution: String(ed.institution || ""),
          field: String(ed.field || ""),
          location: flattenLocation(ed.location) || "",
          startDate: String(ed.startDate || ""),
          endDate: String(ed.endDate || ""),
          highlights: ed.modules ? [`Modules: ${flattenValue(ed.modules)}`] : ed.highlights || [],
        }))
      : original.education,
    skills: aiSkills.length > 0 ? aiSkills : original.skills,
    projects: original.projects,
    certifications: original.certifications,
    languages: (result.resume.languages ?? []).length > 0
      ? result.resume.languages.map((l: any) => ({
          id: uid("l"),
          name: l.name || "",
          proficiency: (l.proficiency || "fluent").toLowerCase() as any,
          ...(l.note ? { note: l.note } : {}),
        })) as any
      : original.languages,
    template: "infohas-pro",
    accentColor: "#0563C1",
    photoUrl: original.photoUrl,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    source: "ai-optimized-aviation",
    fileName: original.fileName,
  };
}

// ============================================================================
// Reflection Agent (optional — triggers when QA confidence < 80)
// ============================================================================

/**
 * Run the Reflection Agent on the optimized resume.
 *
 * This agent reviews the diff between the original and optimized resume and
 * provides feedback on:
 *   - Factual preservation (did the AI invent anything?)
 *   - Keyword stuffing (did the AI over-stuff keywords?)
 *   - Tone (is the language professional?)
 *   - Regression risk (did the optimization make anything worse?)
 *
 * Only triggered when QA confidence < 80 or when critical QA checks fail.
 */
export async function runReflectionAgent(
  original: ResumeData,
  optimized: ResumeData,
  jd: JobDescription,
  qa: QAResult
): Promise<ReflectionResult> {
  const reason = qa.confidence < 75
    ? `QA confidence is ${qa.confidence}/100 (below 75 threshold)`
    : `${qa.checks.filter((c) => !c.passed).length} QA checks failed`;

  const prompt = `You are a Reflection Agent reviewing an AI-optimized resume. Your job is to identify issues and suggest improvements.

ORIGINAL RESUME (JSON):
${JSON.stringify({
  name: original.name,
  summary: original.summary,
  experience: original.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })),
})}

OPTIMIZED RESUME (JSON):
${JSON.stringify({
  name: optimized.name,
  summary: optimized.summary,
  experience: optimized.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets })),
})}

QA RESULT:
- Confidence: ${qa.confidence}/100
- Failed checks: ${qa.checks.filter((c) => !c.passed).map((c) => `${c.name} (${c.details})`).join("; ") || "none"}
- Factual consistency issues: ${qa.factualConsistency?.issueCount ?? 0}
- Professional tone issues: ${qa.professionalTone ? (qa.professionalTone.artifactsFound.length + qa.professionalTone.leaksFound.length) : 0}

Review the optimized resume for:
1. FACTUAL PRESERVATION: Did the AI invent any employers, dates, metrics, or certifications not in the original?
2. KEYWORD STUFFING: Did the AI over-stuff keywords awkwardly? (Keywords should appear naturally in context)
3. TONE: Is the language professional and recruiter-friendly?
4. REGRESSION: Did the optimization make anything worse (e.g. removed important content, weakened bullets)?

Return ONLY valid JSON:
{
  "issues": ["specific issue 1", "specific issue 2", ...],
  "suggestions": ["specific suggestion 1", "specific suggestion 2", ...],
  "confidence": 85
}`;

  try {
    const result = await callAI({
      systemPrompt: "You are a Reflection Agent that reviews AI-optimized resumes for quality. Always return ONLY valid JSON — no markdown fences, no prose.",
      userPrompt: prompt,
      maxTokens: 1500,
      temperature: 0.3,
      taskCategory: "document",
    });

    let data: { issues: string[]; suggestions: string[]; confidence: number };
    try {
      data = extractJSON(result.text);
    } catch {
      return {
        triggered: true,
        reason,
        notes: "Reflection Agent could not parse its own output. Manual review recommended.",
        issues: [],
        suggestions: ["Manually review the optimized resume for quality."],
        confidence: 50,
      };
    }

    return {
      triggered: true,
      reason,
      notes: `Reflected on ${qa.checks.filter((c) => !c.passed).length} failed QA checks. Identified ${data.issues.length} issues and ${data.suggestions.length} suggestions.`,
      issues: data.issues ?? [],
      suggestions: data.suggestions ?? [],
      confidence: typeof data.confidence === "number" ? data.confidence : 50,
    };
  } catch (e: any) {
    return {
      triggered: true,
      reason,
      notes: `Reflection Agent failed: ${e?.message}. Manual review recommended.`,
      issues: [],
      suggestions: ["Manually review the optimized resume for quality."],
      confidence: 0,
    };
  }
}
