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

import type { ResumeData, JobDescription, OptimizerDirectiveConfig } from "../types";
import type { JobIntelligence } from "../job-intelligence";
import { analyzeJobIntelligence } from "../job-intelligence";
import { callAI, getOptimizerDirective, extractJSON } from "../ai";
import { splitOptimizationDirective } from "../ai-diagnostics";
import { processAIResponse } from "../ai-response-processor";
import { validateResumeContent } from "../ai-error-filter";
import { normalizeResumeObject, normalizeToText } from "../ai-response-normalizer";
import { extractLockedFacts, computeFactDiff, isPlaceholder } from "../locked-facts";
import {
  computePageFillTarget,
  computeResumeCharCount,
  expandResume,
  compressResume,
  validatePageFill,
  type PageFillValidation,
} from "./page-balancer";
import { aviationOptimize, type AviationOptimizeResult } from "../ats-directives";
import type { AppSettings } from "../ats-directives";
import { analyzeATS, type ATSAnalysisResult } from "./ats-analysis";
import { runQA, type QAResult } from "./qa-agent";
import { analyzeCompanyIntelligence, analyzeSkillGap, type CompanyIntelligence, type SkillGapIntelligence } from "./company-skill-agents";
import { uid, useApp } from "../store";
import type { ResumeSkill } from "../types";
import {
  OptimizationWatchdog,
  OptimizationTimeoutError,
  OptimizationProviderExhaustedError,
  withTimeout,
  PIPELINE_TIMEOUT_MS,
  OPTIMIZER_CALL_TIMEOUT_MS,
  PIPELINE_STEP_CALL_TIMEOUT_MS,
} from "../pipeline-watchdog";

// ============================================================================
// AI response normalization helpers
// ============================================================================

/**
 * Enforce locked fields — force-restore factual data from the original resume
 * that the AI may have changed (despite being told not to).
 *
 * LOCKED fields (always restored from original):
 *   - name, email, phone, location (contact info)
 *   - experience[].company (employer names)
 *   - experience[].location (work locations)
 *   - experience[].startDate, endDate (dates)
 *   - education[].institution (school names)
 *   - education[].location
 *   - languages[] (same set as original)
 *   - certifications[] (same set as original)
 *
 * ALLOWED to change (not locked):
 *   - headline, summary (rewritten for ATS)
 *   - experience[].title (can be refined for ATS)
 *   - experience[].bullets (rewritten for impact)
 *   - skills (reordered, categories improved)
 *   - education[].degree, field (minor wording)
 *
 * ADDITIONAL FIXES:
 *   - Strip pipe characters (|) from titles, company names, section headers
 *   - Detects and deduplicates education entries
 *   - Restores any missing bullets (AI must not drop bullets)
 */
function enforceLockedFields(optimized: ResumeData, original: ResumeData): ResumeData {
  // Strip pipe characters from all text fields — pipes break ATS parsing
  const stripPipes = (text: string): string => (text || "").replace(/\|/g, "·");
  const cleanTitle = (title: string): string => stripPipes(title);
  const cleanCompany = (company: string): string => stripPipes(company);

  // Lock contact info
  const locked: ResumeData = {
    ...optimized,
    name: original.name, // NEVER change the name
    contact: {
      ...optimized.contact,
      email: original.contact.email, // NEVER change email
      phone: original.contact.phone, // NEVER change phone
      location: original.contact.location, // NEVER change location
    },
  };

  // === Build lookup sets from original for hallucination detection ===
  const originalCompanies = new Set(
    original.experience.map((e) => e.company?.toLowerCase().trim()).filter(Boolean)
  );
  const originalInstitutions = new Set(
    original.education.map((e) => e.institution?.toLowerCase().trim()).filter(Boolean)
  );

  // === PLACEHOLDER DETECTION — reject AI-invented entries ===
  const PLACEHOLDER_PATTERNS = [
    /projected\s*role/i,
    /previous\s*employer/i,
    /institution\s*name/i,
    /company\s*name/i,
    /xxx/i,
    /^n\/?a$/i,
    /placeholder/i,
    /example\s*company/i,
    /your\s*company/i,
    /sample/i,
  ];
  const isPlaceholder = (text: string): boolean => {
    if (!text) return true;
    return PLACEHOLDER_PATTERNS.some((p) => p.test(text));
  };

  // === Lock experience: filter out hallucinated entries + restore locked fields ===
  // Also restore any experience entries the AI may have dropped.
  if (original.experience.length > 0) {
    if (optimized.experience.length >= original.experience.length) {
      // AI returned at least as many entries — filter + lock them
      locked.experience = optimized.experience
        .filter((e) => {
          if (isPlaceholder(e.company)) return false;
          const companyLower = e.company?.toLowerCase().trim();
          if (companyLower && !originalCompanies.has(companyLower)) {
            const fuzzyMatch = Array.from(originalCompanies).some(
              (orig) => orig.includes(companyLower) || companyLower.includes(orig)
            );
            if (!fuzzyMatch) {
              console.warn(`[enforceLockedFields] Removing hallucinated experience entry: "${e.company}"`);
              return false;
            }
          }
          return true;
        })
        .map((e, i) => {
          // Match by substring — AI may have cleaned up company name
          const eCompanyLower = e.company?.toLowerCase().trim() ?? "";
          const orig = original.experience.find(
            (o) => {
              const oCompanyLower = o.company?.toLowerCase().trim() ?? "";
              return oCompanyLower === eCompanyLower ||
                oCompanyLower.includes(eCompanyLower) ||
                eCompanyLower.includes(oCompanyLower);
            }
          ) ?? original.experience[i] ?? original.experience[0];
          // Restore ALL original bullets for this entry — AI must not drop them
          const restoredBullets = orig && orig.bullets.length > e.bullets.length
            ? orig.bullets
            : e.bullets;
          return {
            ...e,
            title: cleanTitle(e.title || orig?.title || ""),
            company: cleanCompany(orig?.company ?? e.company),
            location: orig?.location ?? e.location,
            startDate: orig?.startDate ?? e.startDate,
            endDate: orig?.endDate ?? e.endDate,
            bullets: restoredBullets,
          };
        });
    }
    // If AI dropped entries OR all were hallucinated, restore original
    if (locked.experience.length < original.experience.length) {
      console.warn(`[enforceLockedFields] Restoring original experience (AI had ${optimized.experience.length}, after filter ${locked.experience.length}, original ${original.experience.length})`);
      locked.experience = original.experience.map((e) => ({
        ...e,
        title: cleanTitle(e.title),
        company: cleanCompany(e.company),
      }));
    }
  }

  // === Lock education: filter out hallucinated entries + restore institution ===
  // ALSO deduplicates education entries that the AI may have doubled.
  if (original.education.length > 0) {
    if (optimized.education.length >= original.education.length) {
      const seenInstitutions = new Set<string>();
      locked.education = optimized.education
        .filter((ed) => {
          if (isPlaceholder(ed.institution)) return false;
          const instLower = ed.institution?.toLowerCase().trim();
          // Deduplication: skip if we've already seen this institution
          if (instLower && seenInstitutions.has(instLower)) {
            console.warn(`[enforceLockedFields] Removing duplicate education entry: "${ed.institution}"`);
            return false;
          }
          if (instLower) seenInstitutions.add(instLower);
          if (instLower && !originalInstitutions.has(instLower)) {
            const fuzzyMatch = Array.from(originalInstitutions).some(
              (orig) => orig.includes(instLower) || instLower.includes(orig)
            );
            if (!fuzzyMatch) {
              console.warn(`[enforceLockedFields] Removing hallucinated education entry: "${ed.institution}"`);
              return false;
            }
          }
          return true;
        })
        .map((ed, i) => {
          const orig = original.education.find(
            (o) => o.institution?.toLowerCase().trim() === ed.institution?.toLowerCase().trim()
          ) ?? original.education[i] ?? original.education[0];
          return {
            ...ed,
            institution: orig?.institution ?? ed.institution,
            location: orig?.location ?? ed.location,
            startDate: orig?.startDate ?? ed.startDate,
            endDate: orig?.endDate ?? ed.endDate,
          };
        });
    }
    if (locked.education.length < original.education.length) {
      console.warn(`[enforceLockedFields] Restoring original education (AI had ${optimized.education.length}, after filter ${locked.education.length}, original ${original.education.length})`);
      locked.education = original.education;
    }
  }

  // Lock languages: use the ORIGINAL set (no additions/removals)
  if (original.languages.length > 0) {
    locked.languages = original.languages; // NEVER change language set
  }

  // Lock certifications: use the ORIGINAL set
  if (original.certifications.length > 0) {
    const origCertNames = new Set(original.certifications.map((c) => c.name.toLowerCase()));
    const aiCerts = optimized.certifications.filter((c) => origCertNames.has(c.name.toLowerCase()));
    locked.certifications = aiCerts.length > 0 ? aiCerts : original.certifications;
  }

  return locked;
}

// ============================================================================
// Factual Diff Engine — compares original vs optimized resume
// ============================================================================

interface FactualDiff {
  /** Number of experience entries in original vs optimized */
  experienceCount: { original: number; optimized: number };
  /** Number of bullets per experience entry (original vs optimized) */
  bulletsPerEntry: { original: number[]; optimized: number[] };
  /** Whether any dates were changed */
  datesChanged: { index: number; field: "startDate" | "endDate"; original: string; optimized: string }[];
  /** Whether any companies were changed */
  companiesChanged: { index: number; original: string; optimized: string }[];
  /** Missing experience entries (entries present in original but not in optimized) */
  missingExperience: string[];
  /** Missing education entries */
  missingEducation: string[];
  /** Character count */
  charCount: { original: number; optimized: number };
  /** Overall verdict */
  hasRegressions: boolean;
  /** Detailed messages */
  messages: string[];
}

function computeFactualDiff(original: ResumeData, optimized: ResumeData): FactualDiff {
  const messages: string[] = [];
  const datesChanged: FactualDiff["datesChanged"] = [];
  const companiesChanged: FactualDiff["companiesChanged"] = [];
  const missingExperience: string[] = [];
  const missingEducation: string[] = [];

  // Compare experience counts
  const originalExpCount = original.experience.length;
  const optimizedExpCount = optimized.experience.length;
  if (optimizedExpCount < originalExpCount) {
    const missing = original.experience
      .filter((oe) => !optimized.experience.some((oe2) => oe.company?.toLowerCase() === oe2.company?.toLowerCase()))
      .map((e) => e.company || e.title);
    missingExperience.push(...missing);
    messages.push(`Missing experience entries: ${missing.join(", ")}`);
  }

  // Compare bullet counts per entry
  const originalBullets = original.experience.map((e) => e.bullets.length);
  const optimizedBullets = optimized.experience.map((e) => e.bullets.length);

  // === Build a fuzzy company lookup from the ORIGINAL resume ===
  // When comparing original vs optimized by index, the AI may have REORDERED
  // entries (e.g. put a more recent role first). Comparing by index would then
  // produce false positives ("company changed from A to B") even when both A
  // and B exist somewhere in the original.
  //
  // To detect a REAL company change, we check whether the optimized entry's
  // company matches ANY original entry by substring. Only if it matches NONE
  // do we flag it as a company change.
  const originalCompaniesList = original.experience
    .map((e) => e.company?.toLowerCase().trim())
    .filter(Boolean);
  const matchesAnyOriginalCompany = (company: string): boolean => {
    const c = company?.toLowerCase().trim();
    if (!c) return true; // empty company — don't flag
    return originalCompaniesList.some(
      (orig) => orig === c || orig.includes(c) || c.includes(orig)
    );
  };

  for (let i = 0; i < Math.min(originalExpCount, optimizedExpCount); i++) {
    if (optimizedBullets[i] < originalBullets[i]) {
      messages.push(`Experience #${i + 1} ("${original.experience[i]?.company}"): ${originalBullets[i]} → ${optimizedBullets[i]} bullets (lost ${originalBullets[i] - optimizedBullets[i]})`);
    }
    // Check dates
    const orig = original.experience[i];
    const opt = optimized.experience[i];
    if (orig && opt) {
      if (opt.startDate && opt.startDate !== orig.startDate) {
        datesChanged.push({ index: i, field: "startDate", original: orig.startDate || "", optimized: opt.startDate });
      }
      if (opt.endDate && opt.endDate !== orig.endDate) {
        // Special case: "Present" when original has a real date
        if (opt.endDate.toLowerCase() === "present" && orig.endDate && orig.endDate.toLowerCase() !== "present") {
          messages.push(`BUG: Experience #${i + 1} ("${orig.company}") endDate changed from "${orig.endDate}" to "Present"`);
        }
        datesChanged.push({ index: i, field: "endDate", original: orig.endDate || "", optimized: opt.endDate });
      }
      if (opt.company && opt.company !== orig.company) {
        // === DON'T FLAG as a company change if:
        //   (a) the optimized company is a SUBSTRING of the original (or vice versa)
        //       — the AI may have cleaned up the company name (e.g. removed
        //       "| Rabat, Morocco" suffix that was accidentally merged into the
        //       company field during parsing).
        //   (b) the optimized company matches ANY original entry's company by
        //       substring — the AI may have REORDERED entries (e.g. put a more
        //       recent role first), so a per-index comparison would produce
        //       false positives.
        // Only flag if the company is COMPLETELY different from ALL original entries.
        const origLower = orig.company?.toLowerCase().trim() ?? "";
        const optLower = opt.company?.toLowerCase().trim() ?? "";
        const isSubstring = origLower.includes(optLower) || optLower.includes(origLower);
        const matchesAny = matchesAnyOriginalCompany(opt.company);
        if (!isSubstring && !matchesAny) {
          companiesChanged.push({ index: i, original: orig.company, optimized: opt.company });
          messages.push(`BUG: Experience #${i + 1} company changed from "${orig.company}" to "${opt.company}"`);
        }
      }
    }
  }

  // Compare education counts
  if (optimized.education.length < original.education.length) {
    const missing = original.education
      .filter((oe) => !optimized.education.some((oe2) => oe.institution?.toLowerCase() === oe2.institution?.toLowerCase()))
      .map((e) => e.institution || e.degree);
    missingEducation.push(...missing);
    messages.push(`Missing education entries: ${missing.join(", ")}`);
  }

  // Char count
  const originalChars = JSON.stringify(original.experience).length + JSON.stringify(original.education).length;
  const optimizedChars = JSON.stringify(optimized.experience).length + JSON.stringify(optimized.education).length;

  return {
    experienceCount: { original: originalExpCount, optimized: optimizedExpCount },
    bulletsPerEntry: { original: originalBullets, optimized: optimizedBullets },
    datesChanged,
    companiesChanged,
    missingExperience,
    missingEducation,
    charCount: { original: originalChars, optimized: optimizedChars },
    hasRegressions: messages.length > 0,
    messages,
  };
}

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
  /** Error message (only if status === "failed") */
  error?: string;
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
  // ============================================================
  // Phase 15-24: Wrap the entire pipeline in a 120s hard timeout
  // and an OptimizationWatchdog for per-step stall detection.
  // ============================================================
  const watchdog = new OptimizationWatchdog({
    onStall: (stepName, elapsedMs) => {
      console.error(
        `[Watchdog] Pipeline STALL: "${stepName}" has been running for ${Math.round(elapsedMs / 1000)}s. This indicates a deadlock.`
      );
    },
  });

  try {
    return await withTimeout(
      _runOptimizationPipelineInner(input, watchdog),
      PIPELINE_TIMEOUT_MS,
      "runOptimizationPipeline"
    );
  } catch (err: any) {
    // Ensure watchdog is always stopped
    watchdog.stop();
    if (err instanceof OptimizationTimeoutError) {
      console.error("[Pipeline] 300s hard timeout reached. Aborting optimization.");
      return {
        optimizedResume: input.resume,
        beforeATS: null,
        afterATS: null,
        jobIntelligence: null,
        companyIntelligence: null,
        skillGap: null,
        qa: null,
        reflection: null,
        steps: [],
        status: "failed",
        error: "Optimization timed out after 300 seconds. Please retry. If the issue persists, check your AI provider connection.",
        provider: "none",
        charCount: 0,
        metCharTarget: false,
      };
    }
    throw err;
  } finally {
    watchdog.stop();
  }
}

/**
 * Inner pipeline (unwrapped). Called by runOptimizationPipeline which provides
 * the 120s timeout and watchdog lifecycle management.
 */
async function _runOptimizationPipelineInner(input: PipelineInput, watchdog: OptimizationWatchdog): Promise<PipelineResult> {
  const { resume, jd, userDirectives, aviationMode, checkExport = false, enableReflection = true } = input;

  // ============================================================
  // Load Optimizer Directive — Single Source of Truth
  // ============================================================
  const directiveText = userDirectives?.trim() || getOptimizerDirective();
  const directiveSource = userDirectives?.trim() ? "custom-override" : "generated";
  console.info("[OptimizationContext] Directive loaded:", { source: directiveSource, length: directiveText.length });

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
    const jiHandle = watchdog.startStep("Job Intelligence");
    try {
      result.jobIntelligence = await analyzeJobIntelligence(jd);
      jiHandle.complete();
    } catch (jiErr: any) {
      jiHandle.fail(jiErr);
      throw jiErr;
    }

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

    // === AUTO-RECOVERY: retry once on failure ===
    let optimizeAttempt = 0;
    const maxOptimizeAttempts = 2;
    let optimizeResult: { resume: ResumeData; provider: string; charCount: number; keywordsAdded: number } | null = null;
    let optimizeError: string | null = null;

    while (optimizeAttempt < maxOptimizeAttempts && !optimizeResult) {
      optimizeAttempt++;
      const optHandle = watchdog.startStep(`Resume Optimizer (attempt ${optimizeAttempt})`);
      try {
        if (aviationMode) {
          log("Resume Optimizer", `Aviation ATS mode → ${aviationMode.airlineProfile}. Calling aviationOptimize() with unified directive…`);
          const aviationResult = await aviationOptimize(resume, jd.rawText ?? "", aviationMode.airlineProfile, aviationMode.settings);
          result.optimizedResume = mapAviationResultToResumeData(aviationResult, resume);
          result.provider = "aviation-ats";
          result.charCount = aviationResult.charCount;
          const optLog = `✓ Generated ${aviationResult.charCount} chars (target ~2900). ATS score: ${aviationResult.score}/100. ${aviationResult.matched_keywords.length} keywords matched.`;
          log("Resume Optimizer", optLog);
          emitProgress(3, optLog);
          optimizeResult = { resume: result.optimizedResume!, provider: "aviation-ats", charCount: result.charCount, keywordsAdded: aviationResult.matched_keywords.length };
        } else {
          log("Resume Optimizer", `Standard optimization mode (attempt ${optimizeAttempt}/${maxOptimizeAttempts}).`);
          const optimizeAttemptResult = await optimizeResumeStandard(
            resume, jd, directiveText,
            result.jobIntelligence,
            result.companyIntelligence,
            result.skillGap,
          );
          optimizeResult = optimizeAttemptResult;
        }
        optHandle.complete();
      } catch (e: any) {
        optHandle.fail(e);
        // Provider exhaustion is a non-retryable fatal error
        if (e instanceof OptimizationProviderExhaustedError) {
          optimizeError = e.message;
          console.warn(`[Pipeline] Resume Optimizer: provider exhausted (non-retryable). ${e.message}`);
          break;
        }
        optimizeError = e?.message || "Unknown error";
        // Surface the failure in the browser console so it's diagnosable
        // without opening DevTools state inspectors. The UI log() call only
        // updates step.log — it does NOT console.log.
        console.warn(`[Pipeline] Resume Optimizer attempt ${optimizeAttempt}/${maxOptimizeAttempts} failed: ${optimizeError}`);
        log("Resume Optimizer", `Attempt ${optimizeAttempt} failed: ${optimizeError}`);
        if (optimizeAttempt < maxOptimizeAttempts) {
          log("Resume Optimizer", "Retrying optimization…");
          emitProgress(3, `Optimization failed (attempt ${optimizeAttempt}). Retrying…`);
        }
      }
    }

    if (!optimizeResult) {
      throw new Error(`Optimization failed after ${maxOptimizeAttempts} attempts: ${optimizeError}`);
    }

    result.optimizedResume = optimizeResult.resume;
    result.provider = optimizeResult.provider;
    result.charCount = optimizeResult.charCount;
    const optLog = `✓ Generated ${optimizeResult.charCount} chars (target ~2900) via ${optimizeResult.provider}. Embedded ${optimizeResult.keywordsAdded} keywords. Attempts: ${optimizeAttempt}.`;
    log("Resume Optimizer", optLog);
    emitProgress(3, optLog);

    result.metCharTarget = result.charCount >= 2500 && result.charCount <= 3100;

    step.completedAt = new Date().toISOString();
    step.durationMs = Date.now() - new Date(step.startedAt).getTime();
    step.status = "completed";
  } catch (e: any) {
    // === AUTO-RECOVERY: restore original resume when optimizer fails ===
    steps[3].status = "failed";
    steps[3].error = e?.message ?? "Optimizer failed";
    log("Resume Optimizer", `✗ Optimizer failed: ${e?.message}. Preserving original resume.`);
    emitProgress(3, `Optimization failed. Original resume preserved.`);
    result.optimizedResume = resume; // Restore original
    result.status = "failed";
    result.error = e?.message ?? "Optimizer failed";
    result.provider = "Local Engine (offline mode)";
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

    // HARDENING: Make QA factual consistency failures fatal
    // If the AI fabricated employers, education, certifications, or metrics,
    // the optimized resume is NOT trustworthy — restore original.
    if (result.qa.factualConsistency && !result.qa.factualConsistency.passed) {
      const issueCount = result.qa.factualConsistency.issueCount;
      if (issueCount >= 3) {
        log("Quality Assurance", `⚠ FATAL: ${issueCount} factual inconsistencies detected. Restoring original resume.`);
        emitProgress(4, `AI hallucinated ${issueCount} facts. Original resume preserved.`);
        result.optimizedResume = resume;
        result.status = "failed";
        result.error = `AI optimization produced ${issueCount} factual inconsistencies (hallucinated content). Original resume preserved. Please retry.`;
      } else {
        log("Quality Assurance", `⚠ WARNING: ${issueCount} minor factual issues. Proceeding but flagging for review.`);
      }
    }

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
    log("Quality Assurance", `⚠ QA CRASHED: ${e?.message}. This is a critical failure — the optimized resume cannot be trusted.`);
    emitProgress(4, `QA crashed: ${e?.message}. Marking optimization as failed.`);
    // QA crash is FATAL — if QA can't even run, we can't trust the output.
    // Restore original resume and mark as failed so UI shows the retry message.
    result.optimizedResume = resume;
    result.status = "failed";
    result.error = `QA validation crashed: ${e?.message}. The optimized resume may be corrupt. Please retry.`;
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

  // ========================================================================
  // FACTUAL DIFF + QUALITY GATES
  // ========================================================================
  if (result.optimizedResume) {
    const diff = computeFactualDiff(resume, result.optimizedResume);

    // Check for regressions
    if (diff.hasRegressions) {
      console.warn("[OptimizationContext] Factual diffs detected:", diff.messages);
    }

    // === QUALITY GATES ===
    const qualityErrors: string[] = [];

    // Gate 1: Experience must not be dropped (only if original had experience)
    if ((!result.optimizedResume.experience || result.optimizedResume.experience.length === 0) && (resume.experience?.length ?? 0) > 0) {
      qualityErrors.push("Experience section is empty");
    }

    // Gate 2: Education must not be dropped (only if original had education)
    if ((!result.optimizedResume.education || result.optimizedResume.education.length === 0) && (resume.education?.length ?? 0) > 0) {
      qualityErrors.push("Education section is empty");
    }

    // Gate 3: Skills must not be dropped (only if original had skills)
    if ((!result.optimizedResume.skills || result.optimizedResume.skills.length === 0) && (resume.skills?.length ?? 0) > 0) {
      qualityErrors.push("Skills section is empty");
    }

    // Gate 4: Character count >= 2400 (only if original was already long enough)
    const originalCharCount = JSON.stringify({
      summary: resume.summary,
      experience: resume.experience,
      skills: resume.skills,
      education: resume.education,
      languages: resume.languages,
    }).length;
    if (result.charCount < 2400 && originalCharCount >= 2000) {
      qualityErrors.push(`Character count ${result.charCount} < 2400 minimum (original was ${originalCharCount})`);
    }

    // Gate 5: No date regressions
    const badDates = diff.datesChanged.filter((d) => d.optimized.toLowerCase() === "present" && d.original.toLowerCase() !== "present");
    if (badDates.length > 0) {
      qualityErrors.push(`${badDates.length} date(s) incorrectly set to "Present": ${badDates.map((d) => `#${d.index + 1} ${d.field}`).join(", ")}`);
    }

    // Gate 6: No company changes
    if (diff.companiesChanged.length > 0) {
      qualityErrors.push(`${diff.companiesChanged.length} company name(s) changed: ${diff.companiesChanged.map((c) => `"${c.original}" → "${c.optimized}"`).join(", ")}`);
    }

    // Gate 7: No pipe characters in job titles or company names
    const pipeInTitle = result.optimizedResume.experience.filter((e) => (e.title || "").includes("|"));
    const pipeInCompany = result.optimizedResume.experience.filter((e) => (e.company || "").includes("|"));
    if (pipeInTitle.length > 0) {
      qualityErrors.push(`${pipeInTitle.length} job title(s) contain pipe character "|": ${pipeInTitle.map((e) => e.title).join(", ")}`);
    }
    if (pipeInCompany.length > 0) {
      qualityErrors.push(`${pipeInCompany.length} company name(s) contain pipe character "|": ${pipeInCompany.map((e) => e.company).join(", ")}`);
    }

    // Gate 8: No section merging — each section must have content distinct from others
    // If the summary bleeds into experience content, or education merges into experience, flag it.
    const allSummary = (result.optimizedResume.summary || "").toLowerCase();
    const allBullets = result.optimizedResume.experience.flatMap((e) => e.bullets.map((b) => b.toLowerCase()));
    const eduText = result.optimizedResume.education.map((ed) => `${ed.degree} ${ed.institution}`).join(" ").toLowerCase();
    // Check if summary contains education content that should be in the education section
    const eduKeywordsInSummary = ["bachelor", "master", "phd", "degree", "diploma", "university", "college"]
      .filter((kw) => allSummary.includes(kw) && !eduText.includes(kw));
    if (eduKeywordsInSummary.length > 2) {
      qualityErrors.push(`Summary may contain education content that should be in the Education section (found: ${eduKeywordsInSummary.join(", ")})`);
    }

    // Gate 9: No education duplication — same institution appearing multiple times
    const eduInstCounts = new Map<string, number>();
    for (const ed of result.optimizedResume.education) {
      const inst = (ed.institution || "").toLowerCase().trim();
      if (inst) eduInstCounts.set(inst, (eduInstCounts.get(inst) || 0) + 1);
    }
    const duplicatedEdu = Array.from(eduInstCounts.entries()).filter(([, count]) => count > 1);
    if (duplicatedEdu.length > 0) {
      qualityErrors.push(`Duplicated education entries: ${duplicatedEdu.map(([inst, count]) => `${inst} (×${count})`).join(", ")}`);
    }

    // Gate 10: Bullet count preservation — every original bullet must be present
    if (diff.bulletsPerEntry.optimized.some((c, i) => c < diff.bulletsPerEntry.original[i])) {
      const missingBullets = diff.bulletsPerEntry.original
        .map((orig, i) => ({ entry: i, original: orig, optimized: diff.bulletsPerEntry.optimized[i] || 0 }))
        .filter((x) => x.optimized < x.original);
      qualityErrors.push(`Bullet count reduced in ${missingBullets.length} experience entr(ies): ${missingBullets.map((x) => `#${x.entry + 1} ${x.original}→${x.optimized}`).join(", ")}`);
    }

    if (qualityErrors.length > 0) {
      console.warn("[OptimizationContext] Quality gates FAILED:", qualityErrors);
      // Per spec: "If AI fails: DO NOT generate fallback resumes. DO NOT generate
      // Summary/Skills/Education only. Display: 'AI optimization failed. Please retry.'
      // Preserve original resume."
      //
      // We restore the original resume (preserve) and mark the optimization as
      // failed so the UI can show the retry message.
      console.warn(
        `[Pipeline] Quality gates failed — marking optimization as FAILED. ` +
        `provider=${result.provider}, charCount=${result.charCount ?? 0}, ` +
        `experience entries=${result.optimizedResume?.experience?.length ?? 0}, ` +
        `education entries=${result.optimizedResume?.education?.length ?? 0}, ` +
        `skills count=${result.optimizedResume?.skills?.length ?? 0}`
      );
      log("Quality Assurance", `⚠ AI optimization failed: ${qualityErrors.join("; ")}. Original resume preserved. Please retry.`);
      emitProgress(4, `AI optimization failed. Original resume preserved. Please retry.`);
      result.optimizedResume = resume;
      result.status = "failed";
      result.error = `AI optimization failed: ${qualityErrors.join("; ")}. Please retry.`;
    } else {
      log("Quality Assurance", `✓ All ${10 - qualityErrors.filter((e) => e.includes("empty")).length}/10 quality gates passed.`);
    }

    // === DYNAMIC PAGE FILL VALIDATION (spec: 90-98% page fill target) ===
    // Hard assertion: reject if page usage < 85% AND original had enough content.
    if (result.status !== "failed" && result.optimizedResume) {
      try {
        let directiveConfig: OptimizerDirectiveConfig | null = null;
        try {
          directiveConfig = (useApp.getState() as any)?.optimizerDirective ?? null;
        } catch (directiveErr) { console.warn("[Orchestrator] Failed to read optimizerDirective:", directiveErr instanceof Error ? directiveErr.message : directiveErr); }

        const pageFill = validatePageFill(result.optimizedResume, directiveConfig);
        console.log(`[Pipeline Page Fill] ${pageFill.summary}`);

        if (!pageFill.passesMinimum && originalCharCount >= 2000) {
          log("Page Validation", `✗ Page usage ${pageFill.pageUsage}% < 85% minimum. Original had enough content (${originalCharCount} chars) but optimizer produced insufficient output.`);
          result.optimizedResume = resume;
          result.status = "failed";
          result.error = `Optimization too short: ${pageFill.pageUsage}% page usage (target: 90-98%). Please retry or add more resume content.`;
        } else if (!pageFill.passesMinimum) {
          console.warn(`[Pipeline Page Fill] WARNING: page usage ${pageFill.pageUsage}% < 85% minimum. Source resume has insufficient content (${originalCharCount} chars).`);
          log("Page Validation", `⚠ Page usage ${pageFill.pageUsage}% — source resume too short to fill the page. Consider adding more experience details.`);
        } else if (!pageFill.inSweetSpot) {
          log("Page Validation", `Page usage ${pageFill.pageUsage}% (target: 90-98%). Acceptable but could be improved.`);
        } else {
          log("Page Validation", `✓ Page usage ${pageFill.pageUsage}% — in the 90-98% sweet spot.`);
        }
      } catch (e) {
        console.warn("[Pipeline Page Fill] Validation failed (non-fatal):", e);
      }
    }

    // === DEBUG LOGGING ===
    console.log({
      directiveLoaded: true,
      directiveSource,
      overrideEnabled: !!userDirectives?.trim(),
      pageTarget: "A4 · 1 page",
      characterTarget: "2,700–3,000",
      characterAchieved: result.charCount,
      pageUtilization: Math.min(100, Math.round((result.charCount / 2900) * 100)) + "%",
      preservedExperience: `${diff.experienceCount.optimized}/${diff.experienceCount.original} entries`,
      preservedBullets: diff.bulletsPerEntry.optimized.map((c, i) => `${c}/${diff.bulletsPerEntry.original[i] || c}`).join(", "),
      preservedDates: diff.datesChanged.length === 0 ? "✓ All preserved" : `✗ ${diff.datesChanged.length} changed`,
      dateRegressions: badDates.length > 0 ? `✗ ${badDates.length} dates set to Present` : "✓ None",
      sectionsRestored: qualityErrors.length > 0 ? "✓ Original restored" : "✓ None needed",
    });
  }

  if (result.status !== "failed") result.status = "completed";

  // Diagnostic: log final pipeline outcome so we can see if it completed
  // successfully or failed, and what the key metrics are.
  console.info(
    `[Pipeline] COMPLETE — status=${result.status}, ` +
    `provider=${result.provider}, ` +
    `charCount=${result.charCount ?? 0}, ` +
    `metCharTarget=${result.metCharTarget}, ` +
    `atsBefore=${result.beforeATS?.scores.ats ?? "?"}, ` +
    `atsAfter=${result.afterATS?.scores.ats ?? "?"}, ` +
    `error=${result.error ?? "(none)"}`
  );

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

  // Assert Quality Gate: status must be completed or failed with non-null error
  if (!(result.status === "completed" || result.error != null)) {
    throw new Error("Quality Gate: Pipeline result must be completed or have a non-null error");
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
- Factually consistent with the source resume (NO fabrication of experience, certs, projects, or metrics)

LOCKED FIELDS (CRITICAL — you may NEVER modify these):
- name: MUST be exactly "${resume.name}"
- email: MUST be exactly "${resume.contact.email}"
- phone: MUST be exactly "${resume.contact.phone}"
- location: MUST be exactly "${resume.contact.location ?? ""}"
- experience[].company: MUST match the original employers exactly
- experience[].location: MUST match the original locations exactly
- experience[].startDate/endDate: MUST match the original dates exactly. If original endDate is "Mar 2024", output "Mar 2024", NOT "Present".
- education[].startDate/endDate: MUST match the original dates exactly. Never use "Present" unless the original truly says "Present".
- education[].institution: MUST match the original institutions exactly
- languages[]: MUST be the same set as the original (same names, same proficiency)
- certifications[]: MUST be the same set as the original

ALLOWED CHANGES (you may only do these):
- Rewrite bullet points (improve wording, add action verbs)
- CRITICAL: NEVER add percentages, metrics, dollar amounts, or numbers that aren't in the original. Only rephrase existing content.
- Improve the summary/headline (better ATS keywords, stronger positioning)
- Reorder skills (put JD-relevant skills first)
- Add JD keywords to bullets naturally (semantic optimization, not stuffing)
- Improve formatting (section headers, bullet structure)

If information is missing from the original, LEAVE IT BLANK. Never invent.
Never change a city, country, employer, school, language, date, email, or phone.

PROHIBITED PHRASES (never use these in any field):
- "Projected Role" — never invent experience entries
- "Previous Employer" — use the actual employer name from the resume
- "Institution Name" — use the actual school name from the resume
- "City, Country" — use the actual location from the resume
- "XXX", "N/A", "Placeholder", "Sample", "Example" — never use these

CONTENT REQUIREMENTS:
- Generate a FULL resume — target 2,700-3,000 characters of body content
- Include ALL experience entries from the original resume (do not drop any)
- Each experience entry MUST have: title, company, startDate, endDate, and at least 2 bullets
- Each bullet should be 110-180 characters with action verbs and metrics
- Include ALL education entries from the original with institution + degree + dates
- Include ALL languages from the original
- Include ALL certifications from the original
- Skills section should have 8-15 skills grouped by category`);

  // Validation: only HARD-FAIL if the directive is clearly truncated or empty.
  // Page format and character target checks are SOFT — they warn but don't abort,
  // because custom directive overrides may intentionally omit these details.
  if (process.env.NODE_ENV !== "test") {
    if (directive.length < 500) {
      // This is a hard failure — the directive is clearly broken/missing
      throw new Error("Optimizer directive missing or truncated from final prompt. Aborting.");
    }
    // Soft checks — warn but don't crash the optimization
    const hasPageRule = directive.includes("ONE PAGE") || directive.includes("ONE A4 PAGE") || directive.includes("EXACTLY 1") || directive.includes("Maximum pages: 1") || directive.includes("one page") || directive.includes("one A4 page");
    const hasCharTarget = /2[,.]?[0-9]{3}|3[,.]?000|character/i.test(directive);
    if (!hasPageRule || !hasCharTarget) {
      console.warn("[Optimizer] Directive validation warning — missing recommended elements:", {
        hasPageRule,
        hasCharTarget,
        directiveLength: directive.length,
        directivePreview: directive.slice(0, 500),
      });
      // Inject missing instructions directly into the prompt so the AI
      // still gets the constraint even if the directive omitted it
      if (!hasPageRule) {
        intelligenceBlocks.push("PAGE CONSTRAINT: The resume MUST fit on exactly ONE A4 page. Never produce a second page.");
      }
      if (!hasCharTarget) {
        intelligenceBlocks.push("CONTENT TARGET: Aim for 2,500–3,000 characters of body content. Under 2,000 is too short; over 3,000 is too long.");
      }
      // DO NOT throw — let the optimization proceed with the injected instructions
    }
  }

  // Join intelligence blocks AFTER validation (validation may inject more blocks)
  const intelligenceContext = intelligenceBlocks.join("\n\n");

  // DEBUG: log directive summary
  console.group("[Optimizer Prompt]");
  console.log("Directive chars:", directive.length);
  console.log("Prompt chars:", intelligenceBlocks.reduce((sum, b) => sum + b.length, 0) + directive.length);
  console.log("One-page constraint:", directive.includes("ONE PAGE") || directive.includes("Maximum pages: 1") || directive.includes("EXACTLY 1"));
  console.log("Character target:", /2[,.]?[0-9]{3}|3[,.]?000|character/i.test(directive));
  console.groupEnd();

  const split = splitOptimizationDirective(directive);
  const result = await callAI({
    systemPrompt: split.system,
    isOptimizerCall: true,
    userPrompt: (split.user ? split.user + "\n\n---\n\n" : "") + `SOURCE RESUME (be truthful to this — never invent employers, dates, or metrics):\n${JSON.stringify({
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
    maxTokens: 8000,
    temperature: 0.4,
    taskCategory: "document",
    // Resume Optimizer ships a ~22k-char directive + 8k output tokens.
    // The default 60s timeout was killing legitimate in-flight requests
    // on free-tier providers (OpenCode free, Nvidia build-free, etc.).
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
  });

  // Process the AI response through the full leak-prevention pipeline
  console.info(`[Optimizer] Provider: ${result.provider}, Response length: ${result.text?.length ?? 0} chars, Tokens est: ${result.tokensEstimate}`);

  // Reject local fallback — no AI provider actually executed
  if (result.isLocalEngine || result.provider === "Local Engine (offline mode)" || (result.text?.length ?? 0) < 500) {
    throw new Error(
      "No AI provider available. Optimization could not be completed. " +
      "Configure an API provider in Settings or sign in to Puter."
    );
  }
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

    // === RETRY with a simpler prompt but STILL includes the directive ===
    if (responseLength < 200) {
      const retrySplit = splitOptimizationDirective(directive);
      const retrySystem = retrySplit.system + "\n\nThe previous attempt produced an invalid or empty response. Return ONLY a valid JSON object matching the ResumeData schema. No prose, no markdown fences.\n";
      console.group("[Optimizer Prompt — Retry]");
      console.log("Directive chars:", directive.length);
      console.log("Prompt chars:", retrySystem.length);
      console.log("Directive included:", retrySystem.includes("PAGE FORMAT"));
      console.log("One-page included:", retrySystem.includes("ONE PAGE"));
      console.log("Target chars included:", retrySystem.includes("2,700"));
      console.groupEnd();
      // hard assertion — only in production
      if (process.env.NODE_ENV !== "test") {
        if (!retrySystem.includes("2,700") || !retrySystem.includes("ONE PAGE")) {
          throw new Error("Optimizer directive missing from retry prompt. Aborting.");
        }
      }
      const retryResult = await callAI({
        systemPrompt: retrySystem,
        isOptimizerCall: true,
        userPrompt: (retrySplit.user ? retrySplit.user + "\n\n---\n\n" : "") + `SOURCE RESUME:\n${JSON.stringify({ name: resume.name, headline: resume.headline, contact: resume.contact, summary: resume.summary, experience: resume.experience, education: resume.education, skills: resume.skills, languages: resume.languages, certifications: resume.certifications })}\n\nJOB DESCRIPTION:\n${jd.rawText?.slice(0, 1500) ?? jd.keywords.join(", ")}\n\nOptimize this resume for the job. Return ONLY a JSON object with: name, headline, email, phone, location, summary, skills [{category, items[]}], experience [{title, company, location, startDate, endDate, bullets[]}], education [{degree, institution, field, startDate, endDate, modules}], languages [{name, proficiency}]. No prose, no markdown.`,
        maxTokens: 8000,
        temperature: 0.4,
        taskCategory: "document",
        // Same extended timeout as the primary optimizer call — the retry
        // payload is just as large.
        timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
      });
      console.info(`[Optimizer] Retry response: Provider: ${retryResult.provider}, Length: ${retryResult.text?.length ?? 0}`);
      if (retryResult.provider === "Local Engine (offline mode)" || (retryResult.text?.length ?? 0) < 500) {
        throw new Error(
          "No AI provider available. Optimization could not be completed. " +
          "Configure an API provider in Settings or sign in to Puter."
        );
      }
      const retryProcessed = processAIResponse<any>(retryResult.text, retryResult.provider, { expectJson: true });
      if (retryProcessed.data) {
        data = retryProcessed.data;
      } else {
        throw new Error(`${errorType} — retry also failed. Provider: ${retryResult.provider}. Please try again or configure an API provider in AI Routing Settings.`);
      }
    } else if (result.provider === "Local Engine (offline mode)") {
      throw new Error(
        "No AI provider available. Optimization could not be completed. " +
        "Configure an API provider in Settings or sign in to Puter."
      );
    } else {
      throw new Error(`${errorType} (response length: ${responseLength}). Provider: ${result.provider}. Please try again or configure an API provider in AI Routing Settings.`);
    }
  }

  // Validate experience count — if AI returned fewer entries than original,
  // or if experience is missing entirely, restore the original experience.
  if (resume.experience.length > 0) {
    const aiCount = Array.isArray(data.experience) ? data.experience.length : 0;
    const origCount = resume.experience.length;
    if (aiCount < origCount) {
      console.warn(`[Optimizer] AI returned ${aiCount} experience entries but original has ${origCount}. Restoring original experience.`);
      data.experience = resume.experience;
    }
  }

  // Validate education count
  if (resume.education.length > 0) {
    const aiCount = Array.isArray(data.education) ? data.education.length : 0;
    const origCount = resume.education.length;
    if (aiCount < origCount) {
      console.warn(`[Optimizer] AI returned ${aiCount} education entries but original has ${origCount}. Restoring original education.`);
      data.education = resume.education;
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
      ? data.experience.map((e: any, i: number) => ({
          id: uid("e"),
          title: String(e.title || ""),
          company: String(e.company || ""),
          location: flattenLocation(e.location) || "",
          // === PRESERVE ORIGINAL DATES — never default to "Present" ===
          // If the AI returned empty dates, use the original resume's dates
          // for this entry (by index). The enforceLockedFields function will
          // also restore by company-name match, but this prevents "Present"
          // from appearing in the intermediate step.
          startDate: String(e.startDate || resume.experience[i]?.startDate || ""),
          endDate: String(e.endDate || resume.experience[i]?.endDate || ""),
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

  // === POST-OPTIMIZATION FACTUAL LOCK ===
  const lockedResume = enforceLockedFields(finalResume, resume);

  // === QUALITY GATES — reject degraded output ===
  const originalCharCount = JSON.stringify({
    summary: resume.summary, experience: resume.experience,
    skills: resume.skills, education: resume.education, languages: resume.languages,
  }).length;

  let charCount = JSON.stringify({
    summary: lockedResume.summary, experience: lockedResume.experience,
    skills: lockedResume.skills, education: lockedResume.education, languages: lockedResume.languages,
  }).length;

  // Gate 1: Experience must not be empty
  if (!lockedResume.experience || lockedResume.experience.length === 0) {
    console.warn("[Quality Gate] REJECTED: experience section empty. Restoring original experience.");
    lockedResume.experience = resume.experience;
  }

  // Gate 2: Experience entries must not be fewer than original
  if (lockedResume.experience.length < resume.experience.length) {
    console.warn(`[Quality Gate] REJECTED: ${resume.experience.length - lockedResume.experience.length} experience entries lost. Restoring original experience.`);
    lockedResume.experience = resume.experience;
  }

  // Gate 3: Each experience entry must have at least 1 bullet
  lockedResume.experience = lockedResume.experience.map((e, i) => {
    const orig = resume.experience[i] ?? resume.experience[0];
    if (!e.bullets || e.bullets.length === 0) {
      console.warn(`[Quality Gate] Experience entry "${e.company}" has no bullets. Restoring original bullets.`);
      return { ...e, bullets: orig?.bullets ?? ["Professional experience in this role."] };
    }
    return e;
  });

  // Gate 4: Skills must not be empty
  if (!lockedResume.skills || lockedResume.skills.length === 0) {
    console.warn("[Quality Gate] REJECTED: skills empty. Restoring original skills.");
    lockedResume.skills = resume.skills;
  }

  // Gate 5: Education must not be empty (if original had education)
  if (resume.education.length > 0 && (!lockedResume.education || lockedResume.education.length === 0)) {
    console.warn("[Quality Gate] REJECTED: education empty. Restoring original education.");
    lockedResume.education = resume.education;
  }

  // Gate 6: Languages must not be empty (if original had languages)
  if (resume.languages.length > 0 && (!lockedResume.languages || lockedResume.languages.length === 0)) {
    console.warn("[Quality Gate] REJECTED: languages empty. Restoring original languages.");
    lockedResume.languages = resume.languages;
  }

  // Gate 7: Summary must not be empty
  if (!lockedResume.summary || lockedResume.summary.trim().length < 30) {
    console.warn("[Quality Gate] REJECTED: summary too short or empty. Restoring original summary.");
    lockedResume.summary = resume.summary;
  }

  // Gate 8: Character count must be >= 70% of original
  if (charCount < originalCharCount * 0.70) {
    console.warn(`[Quality Gate] WARNING: charCount ${charCount} < 70% of original ${originalCharCount}. Output may be degraded.`);
  }

  // Gate 9: No pipe characters in titles/companies
  lockedResume.experience = lockedResume.experience.map((e) => ({
    ...e,
    title: String(e.title || "").replace(/\|/g, "—").trim(),
    company: String(e.company || "").replace(/\|/g, "—").trim(),
  }));
  lockedResume.headline = String(lockedResume.headline || "").replace(/\|/g, "—").trim();

  // === P1.6: Gate 10 — Factual Integrity Score via LockedFacts ===
  // Compare the original resume's locked facts against the optimized resume's
  // locked facts. If the optimization introduced NEW facts (hallucinations)
  // or CHANGED critical fields (name, email, phone, dates), restore the original.
  try {
    const originalFacts = extractLockedFacts(resume);
    const optimizedFacts = extractLockedFacts(lockedResume);
    const factDiff = computeFactDiff(originalFacts, optimizedFacts);

    if (factDiff.factualIntegrityScore < 100) {
      console.warn(
        `[Quality Gate 10] Factual Integrity Score: ${factDiff.factualIntegrityScore}/100. ` +
        `${factDiff.newFacts.length} new fact(s), ${factDiff.changed.length} changed, ${factDiff.missing.length} missing.`,
      );

      // If there are CRITICAL issues, restore the original for the affected fields
      const criticalNewFacts = factDiff.newFacts.filter((f) => f.severity === "critical");
      const criticalChanged = factDiff.changed.filter((c) => c.severity === "critical");

      if (criticalNewFacts.some((f) => f.field === "experience.company") ||
          criticalChanged.some((c) => c.field === "name" || c.field === "email" || c.field === "phone")) {
        console.warn("[Quality Gate 10] CRITICAL: hallucinated companies or changed contact info. Restoring original.");
        lockedResume.name = resume.name;
        lockedResume.contact = resume.contact;
        // If new companies were introduced, restore original experience
        if (criticalNewFacts.some((f) => f.field === "experience.company")) {
          lockedResume.experience = resume.experience;
        }
      }

      // If new metrics were introduced (hallucinated percentages), strip them from bullets
      const hallucinatedMetrics = criticalNewFacts
        .filter((f) => f.field === "metrics")
        .map((f) => f.value);
      if (hallucinatedMetrics.length > 0) {
        console.warn(`[Quality Gate 10] Stripping ${hallucinatedMetrics.length} hallucinated metric(s) from bullets.`);
        lockedResume.experience = lockedResume.experience.map((e) => ({
          ...e,
          bullets: e.bullets.map((b) => {
            let cleaned = b;
            for (const metric of hallucinatedMetrics) {
              // Remove the metric and any surrounding context that doesn't make sense without it
              cleaned = cleaned.replace(new RegExp(`\\s*\\b${metric.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b\\s*`, "gi"), " ");
            }
            return cleaned.replace(/\s+/g, " ").trim();
          }),
        }));
      }
    } else {
      console.log("[Quality Gate 10] ✓ Factual Integrity Score: 100/100");
    }
  } catch (e) {
    console.warn("[Quality Gate 10] LockedFacts check failed (non-fatal):", e);
  }

  // === P1.7: Apply normalizeResumeObject to prevent React Error #31 ===
  // Walks the entire resume object and converts any nested objects to strings.
  // This is the final safety net before the resume reaches React.
  let normalizedResume = normalizeResumeObject(lockedResume);

  // === DYNAMIC PAGE BALANCING (spec: 90-98% page fill target) ===
  // After all the quality gates, check if the resume fills the page properly.
  // If < 90%, EXPAND it intelligently (using JD keywords + inferred bullets).
  // If > 100%, COMPRESS it (remove redundancy, shorten bullets, merge skills).
  // NEVER creates a second page.
  try {
    // Load the directive config (for font size, margins, line height)
    let directiveConfig: OptimizerDirectiveConfig | null = null;
    try {
      directiveConfig = (useApp.getState() as any)?.optimizerDirective ?? null;
    } catch (directiveErr2) { console.warn("[Orchestrator] Failed to read optimizerDirective:", directiveErr2 instanceof Error ? directiveErr2.message : directiveErr2); }

    const pageFill = validatePageFill(normalizedResume, directiveConfig);
    console.log(
      `[Page Balancer] ${pageFill.summary} (action: ${pageFill.action})`,
    );

    if (pageFill.action === "expand") {
      // Compute missing keywords from the JD
      const jdKeywords = jd.keywords ?? [];
      const resumeText = JSON.stringify(normalizedResume).toLowerCase();
      const missingKeywords = jdKeywords.filter((k) => !resumeText.includes(k.toLowerCase()));

      normalizedResume = expandResume(normalizedResume, {
        originalResume: resume,
        jd,
        targetChars: pageFill.targetChars,
        currentChars: pageFill.charCount,
        missingKeywords,
      });

      // Recompute char count after expansion
      const newCharCount = computeResumeCharCount(normalizedResume);
      const newPageFill = validatePageFill(normalizedResume, directiveConfig);
      console.log(
        `[Page Balancer] After expansion: ${newPageFill.summary} (${newCharCount} chars, was ${pageFill.charCount})`,
      );
    } else if (pageFill.action === "compress") {
      normalizedResume = compressResume(normalizedResume, {
        targetChars: pageFill.targetChars,
        maxChars: Math.floor(pageFill.targetChars * 1.04), // 98% cap
        currentChars: pageFill.charCount,
      });

      const newCharCount = computeResumeCharCount(normalizedResume);
      const newPageFill = validatePageFill(normalizedResume, directiveConfig);
      console.log(
        `[Page Balancer] After compression: ${newPageFill.summary} (${newCharCount} chars, was ${pageFill.charCount})`,
      );
    }

    // Update charCount for the return value + debug logging
    charCount = computeResumeCharCount(normalizedResume);
  } catch (e) {
    console.warn("[Page Balancer] Failed (non-fatal):", e);
  }

  // === DEBUG LOGGING ===
  console.log({
    directiveLoaded: !!directive,
    provider: result.provider,
    charCount,
    originalCharCount,
    preservedExperience: normalizedResume.experience.length,
    originalExperience: resume.experience.length,
    preservedDates: normalizedResume.experience.every((e, i) =>
      e.startDate === (resume.experience[i]?.startDate ?? "") &&
      e.endDate === (resume.experience[i]?.endDate ?? "")
    ),
    hasSummary: !!normalizedResume.summary,
    hasSkills: normalizedResume.skills.length > 0,
    hasEducation: normalizedResume.education.length > 0,
    hasLanguages: normalizedResume.languages.length > 0,
  });

  return {
    resume: normalizedResume,
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
      ? result.resume.experience.map((e: any, i: number) => ({
          id: uid("e"),
          title: String(e.title || ""),
          company: String(e.company || ""),
          location: flattenLocation(e.location) || "",
          startDate: String(e.startDate || ""),
          endDate: String(e.endDate || original.experience?.[i]?.endDate || ""),
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
      // Free-tier models can take 40-80s on this prompt.
      timeoutMs: PIPELINE_STEP_CALL_TIMEOUT_MS,
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
