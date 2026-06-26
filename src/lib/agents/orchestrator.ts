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
  DirectiveInjectionError,
  withTimeout,
  PIPELINE_TIMEOUT_MS,
  OPTIMIZER_CALL_TIMEOUT_MS,
  PIPELINE_STEP_CALL_TIMEOUT_MS,
} from "../pipeline-watchdog";
// === PRODUCTION HARDENING IMPORTS (v2025.01.15) ===
import {
  extractLockedEntities,
  restoreLockedEntities,
  deduplicateResume,
  verifyEntityIntegrity,
  sanitizeSkills,
} from "../entity-lock";
import { processAIResponseHardened } from "../orchestrator-hardening";
import { computeExperienceFingerprint } from "../experience-fingerprint";

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

  // === Lock experience: ID AND FINGERPRINT matching ===
  // We match each optimized entry back to the original entry using its ID or fingerprint.
  // This ensures that we restore company names, locations, and dates accurately and do not drop entries.
  if (original.experience.length > 0) {
    locked.experience = optimized.experience
      .filter((e) => {
        if (isPlaceholder(e.company)) return false;
        return true;
      })
      .map((e) => {
        let orig = original.experience.find((x) => x.id === e.id);
        if (!orig) {
          const eFp = computeExperienceFingerprint(e);
          orig = original.experience.find((x) => computeExperienceFingerprint(x) === eFp);
        }

        if (!orig) {
          console.warn(`[enforceLockedFields] Removing hallucinated experience: "${e.company}"`);
          return null;
        }

        // Only restore bullets if AI dropped them — keep AI's optimized bullets if they're longer
        const restoredBullets = orig.bullets.length > e.bullets.length
          ? orig.bullets
          : e.bullets;

        return {
          ...e,
          id: orig.id,
          title: cleanTitle(orig.title || e.title || ""),
          company: cleanCompany(orig.company || ""),
          location: orig.location || e.location || "",
          startDate: orig.startDate || "",
          endDate: orig.endDate || "",
          bullets: restoredBullets,
        };
      })
      .filter((x): x is NonNullable<typeof x> => x !== null);

    // Restore missing experiences if dropped by AI
    for (const origExp of original.experience) {
      const hasMatch = locked.experience.some((e) => e.id === origExp.id);
      if (!hasMatch) {
        locked.experience.push({
          ...origExp,
          title: cleanTitle(origExp.title),
          company: cleanCompany(origExp.company),
        });
        console.info(`[enforceLockedFields] Restored dropped experience: ${origExp.title} at ${origExp.company}`);
      }
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
          // STRICT INDEX-BASED matching — never use [0] fallback (causes wrong institution
          // to be assigned to all entries when AI reorders them).
          const orig = original.education.find(
            (o) => o.institution?.toLowerCase().trim() === ed.institution?.toLowerCase().trim()
          ) ?? original.education[i];
          return {
            ...ed,
            // STRICT: institution from source only. If source is empty, use "".
            institution: orig?.institution ?? "",
            degree: orig?.degree ?? ed.degree,
            location: orig?.location ?? ed.location,
            startDate: orig?.startDate ?? "",
            endDate: orig?.endDate ?? "",
          };
        });
    }
    // CRITICAL FIX: Same merge approach as experience — restore MISSING
    // education entries without replacing AI-optimized ones.
    if (locked.education.length < original.education.length) {
      console.warn(`[enforceLockedFields] Restoring missing education entries (AI had ${optimized.education.length}, after filter ${locked.education.length}, original ${original.education.length})`);
      const existingInsts = new Set(locked.education.map((e) => (e.institution || "").toLowerCase().trim()));
      for (const origEdu of original.education) {
        const origInstLower = (origEdu.institution || "").toLowerCase().trim();
        if (origInstLower && !existingInsts.has(origInstLower)) {
          locked.education.push(origEdu);
          console.info(`[enforceLockedFields] Restored dropped education: ${origEdu.degree} at ${origEdu.institution}`);
        }
      }
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
  /** Whether the custom directive was successfully applied */
  customDirectiveApplied?: boolean;
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

    // Run Company Intelligence first (Skill Gap depends on Company result).
    // NOTE: These are sequential by design — analyzeSkillGap takes companyIntelligence
    // as a parameter. True parallelization would require decoupling the dependency.
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

    let optimizeAttempt = 0;
    const maxOptimizeAttempts = 4; // 1 initial + 3 retries
    let success = false;
    let optimizeResult: { resume: ResumeData; provider: string; charCount: number; keywordsAdded: number } | null = null;
    let optimizeError: string | null = null;

    // Load the directive config (for font size, margins, line height)
    let directiveConfig: OptimizerDirectiveConfig | null = null;
    try {
      directiveConfig = (useApp.getState() as any)?.optimizerDirective ?? null;
    } catch (directiveErr2) {
      console.warn("[Orchestrator] Failed to read optimizerDirective:", directiveErr2 instanceof Error ? directiveErr2.message : directiveErr2);
    }

    while (optimizeAttempt < maxOptimizeAttempts) {
      optimizeAttempt++;
      const optHandle = watchdog.startStep(`Resume Optimizer (attempt ${optimizeAttempt})`);
      try {
        // ====================================================================
        // NEW ARCHITECTURE: Locked Pipeline (bullet-only optimizer + assembler)
        //
        // The LLM is NO LONGER allowed to generate an entire resume.
        // It may ONLY return { summary, headline, skills, experiences: [{id, bullets}] }.
        // The Resume Assembler merges this with the source resume (immutable fields).
        //
        // This eliminates: missing company names, missing dates, duplicated
        // experiences, hallucinated employers, education/language corruption.
        // ====================================================================
        const useLockedPipeline = process.env.NEXT_PUBLIC_USE_LOCKED_PIPELINE !== "false"; // default: enabled
        // GUARD: Don't use the locked pipeline if the source resume has NO experience
        // entries. The locked pipeline requires experience IDs to match — if there
        // are none, it will produce an empty resume. Fall back to the legacy path
        // which has more robust handling for edge cases (empty resumes, parser failures).
        const sourceHasContent = resume.experience.length > 0 || resume.education.length > 0 || resume.languages.length > 0;
        const useLockedPipelineEffective = useLockedPipeline && sourceHasContent;
        if (useLockedPipeline && !sourceHasContent) {
          console.warn(`[Pipeline] Source resume has 0 experience, 0 education, 0 languages — falling back to legacy path (locked pipeline requires source content).`);
          log("Resume Optimizer", `Source resume has no content — using legacy path instead of locked pipeline.`);
        }
        if (useLockedPipelineEffective) {
          log("Resume Optimizer", `Locked Pipeline (bullet-only optimizer + assembler) — attempt ${optimizeAttempt}/${maxOptimizeAttempts}.`);
          emitProgress(3, `Running locked pipeline: bullet-only optimizer → assembler → structure guardian…`);

          // Build the intelligence context (same as standard path)
          const intelligenceBlocks: string[] = [];
          if (result.jobIntelligence) {
            intelligenceBlocks.push(`JOB INTELLIGENCE:
Industry: ${result.jobIntelligence.industry}
Business Function: ${result.jobIntelligence.businessFunction}
Recruiter Intent: ${result.jobIntelligence.recruiterIntent}
Priority Keywords: ${result.jobIntelligence.priorityKeywords.join(", ")}
Required Skills: ${result.jobIntelligence.requiredSkills.join(", ")}
Required Competencies: ${result.jobIntelligence.requiredCompetencies.join(", ")}`);
          }
          if (result.companyIntelligence) {
            intelligenceBlocks.push(`COMPANY INTELLIGENCE (${result.companyIntelligence.companyName}):
Culture: ${result.companyIntelligence.culture}
Values: ${result.companyIntelligence.values.join(", ")}
Leadership Principles: ${result.companyIntelligence.leadershipPrinciples.join(", ")}
Hiring Priorities: ${result.companyIntelligence.hiringPriorities.join(", ")}
Valued Competencies: ${result.companyIntelligence.valuedCompetencies.join(", ")}
Company-Specific Priorities: ${result.companyIntelligence.companySpecificPriorities.join(", ")}
Positioning Advice: ${result.companyIntelligence.positioningAdvice}`);
          }
          if (result.skillGap) {
            intelligenceBlocks.push(`SKILL GAP INTELLIGENCE:
Overall Match: ${result.skillGap.overallMatch}%
Missing Skills (CRITICAL — bridge via transferable skills, do NOT fabricate): ${result.skillGap.missingSkills.critical.join(", ") || "(none)"}
Missing Skills (IMPORTANT): ${result.skillGap.missingSkills.important.join(", ") || "(none)"}
Transferable Skills (use these to bridge gaps):
${result.skillGap.transferableSkills.map((t) => `  - ${t.candidateSkill} ≈ ${t.equivalentTo} (${t.rationale})`).join("\n") || "  (none)"}
Bridging Strategy: ${result.skillGap.bridgingStrategy}`);
          }
          const jdKeywords = jd.keywords ?? [];
          const resumeText = JSON.stringify(resume).toLowerCase();
          const missingKeywords = jdKeywords.filter((k) => !resumeText.includes(k.toLowerCase()));
          intelligenceBlocks.push(`MISSING JD KEYWORDS TO EMBED NATURALLY (semantic optimization, NOT stuffing): ${missingKeywords.join(", ") || "(none — focus on rewriting for impact)"}`);

          const intelligenceContext = intelligenceBlocks.join("\n\n");

          // Run the locked pipeline
          // Pass the user-configured per-agent directives from the store
          const { runLockedPipeline } = await import("../locked-pipeline");
          const agentDirectives = (useApp.getState() as any)?.optimizerDirective?.agentDirectives;
          const lockedResult = await runLockedPipeline(resume, jd, intelligenceContext, agentDirectives);

          optimizeResult = {
            resume: lockedResult.resume,
            provider: lockedResult.provider,
            charCount: lockedResult.charCount,
            keywordsAdded: lockedResult.keywordsAdded,
          };

          // Log warnings
          for (const w of lockedResult.warnings) {
            console.warn(`[Locked Pipeline] ${w}`);
          }

          log("Resume Optimizer",
            `✓ Locked pipeline complete: ${lockedResult.charCount} chars, ` +
            `guardian: ${lockedResult.guardianStatus} (${lockedResult.guardianScore}/100), ` +
            `fingerprint: ${lockedResult.fingerprintValid ? "PASS" : "FAIL"}, ` +
            `matched: ${lockedResult.assemblerStats.matchedById} by ID / ${lockedResult.assemblerStats.matchedByTitleCompany} by title / ${lockedResult.assemblerStats.matchedByIndex} by index. ` +
            `Provider: ${lockedResult.provider}`,
          );
          emitProgress(3, `✓ Locked pipeline complete. Guardian: ${lockedResult.guardianScore}/100. ${lockedResult.charCount} chars.`);

          optHandle.complete();
        } else if (aviationMode) {
          log("Resume Optimizer", `Industry ATS mode → ${aviationMode.airlineProfile}. Calling aviationOptimize() with unified directive…`);
          const aviationResult = await aviationOptimize(resume, jd.rawText ?? "", aviationMode.airlineProfile, aviationMode.settings);
          result.optimizedResume = mapAviationResultToResumeData(aviationResult, resume);
          // MANDATORY: Call finalizeResume() — the single shared function ALL providers must use.
          // This runs: cleanupGrammar → restoreLockedEntities → deduplicate → validateImmutableEntities
          try {
            const { finalizeResume } = await import("../unified-pipeline");
            result.optimizedResume = finalizeResume(result.optimizedResume!, resume);
          } catch (finErr: any) {
            console.warn("[finalizeResume] Aviation path failed (non-fatal):", finErr?.message);
            // Fallback: enforceLockedFields
            result.optimizedResume = enforceLockedFields(result.optimizedResume!, resume);
          }
          result.provider = "aviation-ats";
          result.charCount = aviationResult.charCount;
          // Compute the REAL ATS score via analyzeATS (not the AI's self-reported score which can be 0)
          const realAtsScore = analyzeATS(result.optimizedResume!, jd).scores.ats;
          const optLog = `✓ Generated ${aviationResult.charCount} chars (target ~2900). ATS score: ${realAtsScore}/100. ${aviationResult.matched_keywords.length} keywords matched.`;
          log("Resume Optimizer", optLog);
          emitProgress(3, optLog);
          // === INDUSTRY ATS QUALITY GATES — preserve sections ===
          // These mirror the quality gates in optimizeResumeStandard so that
          // the aviation/industry path is equally protected from section loss.
          const avi = result.optimizedResume!;

          if (!avi.experience || avi.experience.length === 0) {
            console.warn("[Industry ATS Quality Gate] Experience missing — restoring original.");
            avi.experience = resume.experience;
          } else if (avi.experience.length < resume.experience.length) {
            console.warn(`[Industry ATS Quality Gate] Experience entries dropped (${avi.experience.length} < ${resume.experience.length}) — restoring original.`);
            avi.experience = resume.experience;
          }
          if (resume.education.length > 0 && (!avi.education || avi.education.length === 0)) {
            console.warn("[Industry ATS Quality Gate] Education missing — restoring original.");
            avi.education = resume.education;
          }
          if (!avi.skills || avi.skills.length === 0) {
            console.warn("[Industry ATS Quality Gate] Skills missing — restoring original.");
            avi.skills = resume.skills;
          }
          if (resume.languages.length > 0 && (!avi.languages || avi.languages.length === 0)) {
            console.warn("[Industry ATS Quality Gate] Languages missing — restoring original.");
            avi.languages = resume.languages;
          }
          if (resume.certifications?.length > 0 && (!avi.certifications || avi.certifications.length === 0)) {
            console.warn("[Industry ATS Quality Gate] Certifications missing — restoring original.");
            avi.certifications = resume.certifications;
          }
          if (!avi.summary || avi.summary.trim().length < 30) {
            console.warn("[Industry ATS Quality Gate] Summary too short — restoring original.");
            avi.summary = resume.summary;
          }
          // Update optimizeResult with the quality-gated resume
          optimizeResult = { resume: avi, provider: "aviation-ats", charCount: result.charCount, keywordsAdded: aviationResult.matched_keywords.length };
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

        // MANDATORY: Call finalizeResume() — the single shared function ALL providers must use.
        // SKIP this when the locked pipeline is active — the locked pipeline already does
        // assembly + cleanup + validation internally. Calling finalizeResume again would
        // re-run restoreLockedEntities on the already-assembled resume, which is redundant
        // and can cause issues (e.g., trying to restore entities on a resume that was
        // already assembled from source).
        if (optimizeResult?.resume && !useLockedPipelineEffective) {
          try {
            const { finalizeResume } = await import("../unified-pipeline");
            optimizeResult.resume = finalizeResume(optimizeResult.resume, resume);
          } catch (finErr: any) {
            console.warn("[finalizeResume] Standard path failed (non-fatal):", finErr?.message);
          }
        }

        optHandle.complete();
      } catch (e: any) {
        optHandle.fail(e);
        if (e instanceof OptimizationProviderExhaustedError) {
          optimizeError = e.message;
          console.warn(`[Pipeline] Resume Optimizer: provider exhausted (non-retryable). ${e.message}`);
          break;
        }
        optimizeError = e?.message || "Unknown error";
        console.warn(`[Pipeline] Resume Optimizer attempt ${optimizeAttempt}/${maxOptimizeAttempts} failed: ${optimizeError}`);
        log("Resume Optimizer", `Attempt ${optimizeAttempt} failed: ${optimizeError}`);
        if (optimizeAttempt < maxOptimizeAttempts) {
          log("Resume Optimizer", "Retrying optimization…");
          emitProgress(3, `Optimization failed (attempt ${optimizeAttempt}). Retrying…`);
        }
        continue;
      }

      if (!optimizeResult) {
        continue;
      }

      result.optimizedResume = optimizeResult.resume;
      result.provider = optimizeResult.provider;
      result.charCount = optimizeResult.charCount;

      // ========================================================================
      // [V3 MULTI-AGENT PIPELINE] Post-optimization agents (ContentExpansionAgent)
      //
      // SKIP V3 pipeline when using the locked pipeline — the locked pipeline
      // already produces a complete, validated resume. V3 agents (Keyword
      // Embedding, Fact Verification, Layout Optimization) were designed for
      // the old architecture where the LLM generated the full resume. Running
      // them on the locked pipeline output would risk re-introducing the
      // corruption we just prevented.
      // ========================================================================
      // Recompute whether the locked pipeline was used (the variable was scoped
      // inside the try block above, so we recompute it here for the V3 decision).
      const _sourceHasContent = resume.experience.length > 0 || resume.education.length > 0 || resume.languages.length > 0;
      const _useLockedPipeline = process.env.NEXT_PUBLIC_USE_LOCKED_PIPELINE !== "false";
      const useLockedPipelineForV3 = _useLockedPipeline && _sourceHasContent;
      if (useLockedPipelineForV3) {
        log("Resume Optimizer", `Skipping V3 pipeline (locked pipeline already produced validated output).`);
      } else {
        try {
          const { runV3PostOptimizationPipeline } = await import("../v3-agents");
          log("Resume Optimizer", `Running V3 post-optimization agents: Keyword Embedding → Fact Verification → Layout Optimization...`);
          emitProgress(3, `V3 agents: embedding keywords, verifying facts, optimizing layout...`);

          const v3Result = runV3PostOptimizationPipeline(result.optimizedResume!, resume, jd, 3);
          result.optimizedResume = v3Result.resume;
          // CRITICAL FIX (Anomaly #2): Re-apply enforceLockedFields after V3 pipeline.
          // V3 agents (Keyword Embedding, Fact Verification, Layout Optimization) may
          // inadvertently modify locked fields (dates, company names). This ensures
          // all locked fields are restored to their original values.
          result.optimizedResume = enforceLockedFields(result.optimizedResume!, resume);
          result.charCount = v3Result.finalCharCount;
          result.metCharTarget = v3Result.finalCharCount >= 2800 && v3Result.finalCharCount <= 3800;

          for (const report of v3Result.agentReports) {
            for (const change of report.changes) {
              console.info(`[V3 ${report.agentName}] ${change}`);
            }
          }

          log("Resume Optimizer",
            `✓ V3 pipeline complete: ${v3Result.totalChanges} total changes, ` +
            `${v3Result.hallucinationsRemoved} hallucinations removed, ` +
            `${v3Result.keywordsEmbedded} keywords embedded, ` +
            `${v3Result.finalCharCount} chars, ` +
            `quality ${v3Result.qualityReport.overallScore}/100`
          );
          emitProgress(3, `✓ V3 agents complete. Quality: ${v3Result.qualityReport.overallScore}/100, ${v3Result.finalCharCount} chars`);
        } catch (v3Err: any) {
          console.warn("[V3 Pipeline] Failed (non-fatal):", v3Err?.message);
        }

        // ====================================================================
        // CRITICAL FIX: Final cleanup pass AFTER V3 + enforceLockedFields.
        //
        // V3 agents (Keyword Embedding, Fact Verification, Layout Optimization)
        // can RE-INTRODUCE corruption that finalizeResume already cleaned:
        //   - Duplicate summary sentences (keyword embedding adds them back)
        //   - JD company names in skills (keyword embedding stuffs them)
        //   - Double periods, filler phrases
        //   - "within <Title>" hallucinations
        //
        // We run finalizeResume ONE MORE TIME after V3 to re-clean.
        // This is the definitive fix for the "3x duplicate sentences" and
        // "Qatar Duty Free in skills" issues observed in production.
        // ====================================================================
        try {
          const { finalizeResume } = await import("../unified-pipeline");
          const beforeClean = JSON.stringify({
            summary: result.optimizedResume?.summary?.slice(0, 100),
            skillsCount: result.optimizedResume?.skills?.length,
            skillsPreview: result.optimizedResume?.skills?.slice(0, 5).map((s: any) => s.name),
          });
          result.optimizedResume = finalizeResume(result.optimizedResume!, resume);
          const afterClean = JSON.stringify({
            summary: result.optimizedResume?.summary?.slice(0, 100),
            skillsCount: result.optimizedResume?.skills?.length,
            skillsPreview: result.optimizedResume?.skills?.slice(0, 5).map((s: any) => s.name),
          });
          if (beforeClean !== afterClean) {
            console.info("[Post-V3 Cleanup] finalizeResume re-cleaned the resume after V3 pipeline");
            log("Resume Optimizer", `✓ Post-V3 cleanup: re-filtered skills, re-deduplicated summary, re-fixed grammar`);
          }
        } catch (cleanErr: any) {
          console.warn("[Post-V3 Cleanup] finalizeResume failed (non-fatal):", cleanErr?.message);
        }
      }

      // === PAGE VALIDATION ===
      // Accept if chars >= 2500 AND pageFill >= 0.70.
      // If chars > 4200 (too long), compress instead of rejecting.
      // If chars < 2500 (too short), expand via V3 pipeline.
      // NEVER reject — always accept best result and fix via V3.
      //
      // LOCKED PIPELINE EXCEPTION: The locked pipeline produces cleaner, more
      // concise output (no padding/filler). Accept >= 1500 chars from the locked
      // pipeline since it doesn't waste tokens on redundant content.
      //
      // SOURCE CONTENT EXCEPTION: If the source resume has very little content
      // (e.g., only 1 short experience entry), the optimized resume will naturally
      // be short. In this case, accept whatever the pipeline produced rather than
      // retrying 4 times and failing. The source content is the limiting factor,
      // not the optimizer.
      const sourceCharCount = JSON.stringify({
        summary: resume.summary, experience: resume.experience,
        skills: resume.skills, education: resume.education, languages: resume.languages,
      }).length;
      const minCharThreshold = useLockedPipelineForV3
        ? Math.min(1500, Math.max(500, sourceCharCount * 0.5))
        : 2500;
      const pageFillVal = validatePageFill(result.optimizedResume!, directiveConfig);
      const pageFill = pageFillVal.pageUsage / 100;

      console.log(`[Pipeline Page Validator] Attempt ${optimizeAttempt}: pageFill = ${pageFill.toFixed(2)} (${pageFillVal.pageUsage}%), charCount = ${result.charCount}, threshold = ${minCharThreshold}, sourceChars = ${sourceCharCount}`);

      // Accept if: chars >= threshold (minimum) — page fill is calculated as min(100, chars/target)
      // so even if chars > target, pageFill = 100% which passes >= 0.70
      // ALSO accept on the LAST attempt regardless — never fail the pipeline just
      // because the output is short (the source may have insufficient content).
      if (result.charCount >= minCharThreshold || optimizeAttempt === maxOptimizeAttempts) {
        if (result.charCount < minCharThreshold) {
          console.warn(`[Pipeline Page Validator] Accepting short output on final attempt (${result.charCount} < ${minCharThreshold}) — source may have insufficient content.`);
        }

        // ====================================================================
        // FINAL SAFETY NET: Run finalizeResume one last time before accepting.
        //
        // This catches ANY remaining corruption regardless of which path was
        // taken (locked pipeline, aviation, standard, V3). This is the
        // definitive cleanup that ensures the output is always clean:
        //   - No duplicate summary sentences
        //   - No JD company names in skills
        //   - No double periods
        //   - No "within <Title>" hallucinations
        //   - No backticks
        //   - Education/languages restored from source
        // ====================================================================
        try {
          const { finalizeResume } = await import("../unified-pipeline");
          result.optimizedResume = finalizeResume(result.optimizedResume!, resume);
          result.charCount = JSON.stringify({
            summary: result.optimizedResume?.summary,
            experience: result.optimizedResume?.experience,
            skills: result.optimizedResume?.skills,
            education: result.optimizedResume?.education,
            languages: result.optimizedResume?.languages,
          }).length;
        } catch (finErr: any) {
          console.warn("[Final Safety Net] finalizeResume failed (non-fatal):", finErr?.message);
        }

        // Warn if the provider is Local Engine (all AI providers failed)
        if (/local\s*engine/i.test(result.provider || "")) {
          log("Resume Optimizer", `⚠ Warning: All AI providers failed. Using local engine output. The resume may not be fully optimized. Please retry when AI providers recover.`);
          emitProgress(3, `⚠ All AI providers failed — using fallback output. Please retry later for full optimization.`);
        }

        success = true;
        const optLog = `✓ Generated ${result.charCount} chars (page fill ${pageFillVal.pageUsage}%) via ${result.provider}. Embedded ${optimizeResult.keywordsAdded} keywords. Attempts: ${optimizeAttempt}.`;
        log("Resume Optimizer", optLog);
        emitProgress(3, optLog);
        break;
      } else {
        console.warn(`[Pipeline Page Validator] Attempt ${optimizeAttempt}: charCount ${result.charCount} < ${minCharThreshold} minimum. Retrying...`);
        optimizeResult = null;
        if (optimizeAttempt < maxOptimizeAttempts) {
          log("Resume Optimizer", `Attempt ${optimizeAttempt} — content too short (${result.charCount} chars). Retrying...`);
          emitProgress(3, `Content too short (${result.charCount} chars). Retrying (attempt ${optimizeAttempt + 1})…`);
        }
      }
    }

    if (!success || !result.optimizedResume) {
      // === GRACEFUL DEGRADATION ===
      // Instead of hard-failing when all AI providers are rate-limited/unavailable,
      // return the ORIGINAL resume with JD keywords added to skills.
      // This ensures the user always gets a usable result and can retry later.
      console.warn(`[Pipeline] All ${maxOptimizeAttempts} optimization attempts failed. Falling back to original resume + JD keywords.`);
      log("Resume Optimizer", `⚠ All AI providers failed after ${maxOptimizeAttempts} attempts. Returning original resume with JD keywords added. Please retry when AI providers recover.`);

      // Add JD keywords to the original resume's skills
      const jdKeywords = jd.keywords ?? [];
      const existingSkillNames = new Set(resume.skills.map((s) => s.name.toLowerCase()));
      const keywordsToAdd: ResumeSkill[] = jdKeywords
        .filter((k) => !existingSkillNames.has(k.toLowerCase()))
        .slice(0, 8)
        .map((name) => ({ id: uid("s"), name, category: "Targeted Keywords" }));

      result.optimizedResume = {
        ...resume,
        skills: [...resume.skills, ...keywordsToAdd],
        updatedAt: new Date().toISOString(),
        source: "ai-optimized-degraded" as any,
      };
      result.provider = "Local Engine (degraded)";
      result.charCount = JSON.stringify({
        summary: result.optimizedResume.summary,
        experience: result.optimizedResume.experience,
        skills: result.optimizedResume.skills,
        education: result.optimizedResume.education,
        languages: result.optimizedResume.languages,
      }).length;
      result.metCharTarget = false;

      // Mark step as COMPLETED (not failed) so the pipeline continues
      step.completedAt = new Date().toISOString();
      step.durationMs = Date.now() - new Date(step.startedAt).getTime();
      step.status = "completed";
      emitProgress(3, `⚠ AI providers unavailable. Original resume + ${keywordsToAdd.length} keywords. Retry later for full optimization.`);
      // Skip the throw — continue to QA step
    }

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

    // === HARDENED QA GATES (v2025.01.15) ===
    // Fabricated employers, education, and certifications are HARD FAILURES.
    // Only minor metric hallucinations are allowed through with warnings.
    if (result.qa.factualConsistency && !result.qa.factualConsistency.passed) {
      const fc = result.qa.factualConsistency;
      const seriousCount =
        fc.fabricatedEmployers.length +
        fc.fabricatedEducation.length +
        fc.fabricatedCertifications.length;
      const minorCount = fc.issueCount - seriousCount;

      if (seriousCount >= 1) {
        // HARD FAILURE: Fabricated employers, education, or certifications
        console.error(
          `[Pipeline] QA HARD FAILURE: ${seriousCount} serious fabrication(s). ` +
          `Employers: [${fc.fabricatedEmployers.join(", ")}], ` +
          `Education: [${fc.fabricatedEducation.join(", ")}], ` +
          `Certs: [${fc.fabricatedCertifications.join(", ")}]. ` +
          `Restoring original resume.`,
        );
        log("Quality Assurance", `✗ HARD FAILURE: ${seriousCount} serious fabrication(s) detected. ` +
          `Fabricated: ${[...fc.fabricatedEmployers, ...fc.fabricatedEducation, ...fc.fabricatedCertifications].join(", ")}. ` +
          `Restoring original resume.`);
        emitProgress(4, `✗ Serious fabrication detected. Restoring original resume.`);

        // FAIL PIPELINE: Restore original resume
        result.optimizedResume = resume;
        result.status = "failed";
        result.error = `Factual integrity violation: ${[...fc.fabricatedEmployers, ...fc.fabricatedEducation].join(", ")}`;
        result.provider = "none";
        return result;
      }

      // Minor issues (metrics, locations) — log warning but allow through
      console.warn(
        `[Pipeline] QA factual consistency WARNING: ${minorCount} minor issues (metrics/locations).`,
      );
      log("Quality Assurance", `⚠ ${minorCount} minor factual issue(s) (metrics/locations).`);
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

    // === HARDENED QUALITY GATES (v2025.01.15) ===
    // Quality gates are now HARD FAILURES, not advisory warnings.
    // Critical issues fail the pipeline. The user gets the ORIGINAL resume,
    // not a corrupted optimization.
    const criticalIssues = qualityErrors.filter((e) =>
      e.includes("Experience section is empty") ||
      e.includes("Education section is empty") ||
      e.includes("company name(s) changed") ||
      e.includes('incorrectly set to "Present"') ||
      e.includes("Duplicated education") ||
      e.includes("placeholder company"),
    );
    const minorIssues = qualityErrors.filter((e) => !criticalIssues.includes(e));

    if (criticalIssues.length > 0) {
      // HARD FAILURE: Critical quality issues fail the pipeline
      console.error(
        `[Pipeline] Quality gates HARD FAILURE: ${criticalIssues.length} critical issues. ` +
        `Failing pipeline and restoring original resume. Issues: ${criticalIssues.join("; ")}`,
      );
      log("Quality Assurance", `✗ HARD FAILURE: ${criticalIssues.length} critical issue(s): ${criticalIssues.join("; ")}. Restoring original resume.`);
      emitProgress(4, `✗ Critical quality issues detected. Restoring original resume.`);

      // Restore original resume and fail the pipeline
      result.optimizedResume = resume;
      result.status = "failed";
      result.error = `Quality gates failed: ${criticalIssues.join("; ")}`;
      result.provider = "none";
      result.charCount = 0;
      return result;
    }

    if (minorIssues.length > 0) {
      // Minor issues are logged as warnings but don't fail
      console.warn(
        `[Pipeline] Quality gates WARNING: ${minorIssues.length} minor issues: ${minorIssues.join("; ")}`,
      );
      log("Quality Assurance", `⚠ ${minorIssues.length} minor issue(s): ${minorIssues.join("; ")}.`);
    }

    if (qualityErrors.length === 0) {
      const qaPassed = result.qa?.checks?.filter((c) => c.passed).length ?? "?";
      const qaTotal = result.qa?.checks?.length ?? "?";
      log("Quality Assurance", `✓ Pipeline quality gates passed. QA checks: ${qaPassed}/${qaTotal}.`);
    }

    // === DYNAMIC PAGE FILL VALIDATION (spec: 90-98% page fill target) ===
    // ADVISORY ONLY: page fill issues are logged as warnings but NEVER block
    // the optimization. The user always gets the optimized resume.
    if (result.optimizedResume) {
      try {
        let directiveConfig: OptimizerDirectiveConfig | null = null;
        try {
          directiveConfig = (useApp.getState() as any)?.optimizerDirective ?? null;
        } catch (directiveErr) { console.warn("[Orchestrator] Failed to read optimizerDirective:", directiveErr instanceof Error ? directiveErr.message : directiveErr); }

        const pageFill = validatePageFill(result.optimizedResume, directiveConfig);
        console.log(`[Pipeline Page Fill] ${pageFill.summary}`);

        if (!pageFill.passesMinimum && originalCharCount >= 2000) {
          log("Page Validation", `⚠ Page usage ${pageFill.pageUsage}% < 85% minimum. Original had enough content (${originalCharCount} chars) but optimizer produced shorter output. Optimization completed — consider retrying for a fuller page.`);
          emitProgress(4, `⚠ Page fill at ${pageFill.pageUsage}%. Optimization completed but could be fuller.`);
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
  // Prepend a strict anti-hallucination guard to the system prompt.
  // Free-tier models (Llama-3.1/3.3-70b) routinely invent metrics and
  // employers when generating large JSON; this preamble reinforces the
  // "never fabricate" rule BEFORE the directive content.
  const antiHallucinationPreamble = `CRITICAL RULES (override everything else):

=== ZERO-HALLUCINATION POLICY ===
1. NEVER invent employers, job titles, schools, degrees, certifications, locations, or languages not in the SOURCE RESUME.
2. NEVER invent percentages, metrics, or numbers. Only reuse numbers that appear VERBATIM in the SOURCE RESUME.
3. NEVER change the candidate's name, email, phone, or contact info.
4. You may REPHRASE existing content and WEAVE IN keywords from the JD, but NEVER fabricate facts.

=== NATURAL KEYWORD INTEGRATION (ANTI-STUFFING) ===
5. NEVER append raw keyword lists to sentences. Do NOT write: "Experience in hospitality, F&B, guest service, customer care, multilingual."
6. Instead, WEAVE keywords naturally into context: "Delivered hospitality excellence through personalized guest service and multilingual F&B operations."
7. Each keyword should appear ONCE, embedded in a relevant sentence — not dumped in a list.

=== ACTION-ORIENTED BULLETS & GRAMMAR ===
8. Start EVERY experience bullet with a strong action verb: Spearheaded, Orchestrated, Streamlined, Facilitated, Coordinated, Delivered, Executed, Managed.
9. Keep sentences under 20 words. Be concise and impactful.
10. NEVER use double periods (..) — always single period at end.
11. NEVER repeat filler phrases like "demonstrating strong attention to detail" or "committed to excellence."
12. Each bullet must be a unique, specific achievement or responsibility.

`;

  let customDirective: string | undefined;
  try {
    const state: any = useApp.getState();
    customDirective = state?.optimizerDirective?.customDirectiveOverride?.trim() || undefined;
  } catch {}

  let systemPromptText = antiHallucinationPreamble + split.system;
  if (customDirective && !systemPromptText.includes(customDirective)) {
    systemPromptText += `\n\n[CUSTOM DIRECTIVE OVERRIDE]\n${customDirective}`;
  }

  const userPromptText = (split.user ? split.user + "\n\n---\n\n" : "") + `SOURCE RESUME (be truthful to this — never invent employers, dates, or metrics):\n${JSON.stringify({
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
  })}\n\nTARGET JOB DESCRIPTION:\n${jd.rawText ?? JSON.stringify({ title: jd.title, company: jd.company, responsibilities: jd.responsibilities, requiredSkills: jd.requiredSkills, keywords: jd.keywords })}\n\n${intelligenceContext}\n\nReturn ONLY the JSON object described in the directive. No prose, no markdown fences.`;

  // Validation: assert prompt includes customDirective
  const fullPromptText = systemPromptText + "\n\n" + userPromptText;
  if (customDirective && !fullPromptText.includes(customDirective)) {
    throw new DirectiveInjectionError("DirectiveInjectionError: Custom directive override not present in the optimization prompt.");
  }

  const result = await callAI({
    systemPrompt: systemPromptText,
    isOptimizerCall: true,
    userPrompt: userPromptText,
    maxTokens: 8000,
    temperature: 0.15,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
  });

  // Process the AI response through the HARDENED leak-prevention pipeline
  // === PRODUCTION HARDENING (v2025.01.15): Entity lock + mandatory pipeline ===
  console.info(`[Optimizer] Provider: ${result.provider}, Response length: ${result.text?.length ?? 0} chars, Tokens est: ${result.tokensEstimate}`);

  // Reject local fallback — no AI provider actually executed
  if (result.isLocalEngine || result.provider === "Local Engine (offline mode)" || (result.text?.length ?? 0) < 500) {
    throw new Error(
      "No AI provider available. Optimization could not be completed. " +
      "Configure an API provider in Settings or sign in to Puter."
    );
  }

  // === HARDENED PIPELINE: Run entity-locked mandatory processing ===
  const hardenedResult = await processAIResponseHardened({
    rawText: result.text,
    provider: result.provider,
    originalResume: resume,
    jobDescription: jd,
    jobIntelligence: ji,
    companyIntelligence: company,
    skillGap,
    attemptNumber: 1, // Will be incremented by caller on retry
    maxAttempts: 4,
  });

  if (hardenedResult.passed && hardenedResult.resume) {
    // Hardened pipeline succeeded — skip legacy processing
    let normalizedResume = hardenedResult.resume;

    // === DYNAMIC PAGE BALANCING ===
    try {
      let directiveConfig: OptimizerDirectiveConfig | null = null;
      try {
        directiveConfig = (useApp.getState() as any)?.optimizerDirective ?? null;
      } catch (directiveErr2) { console.warn("[Orchestrator] Failed to read optimizerDirective:", directiveErr2 instanceof Error ? directiveErr2.message : directiveErr2); }

      const pageFill = validatePageFill(normalizedResume, directiveConfig);
      if (pageFill.action === "expand") {
        const jdKeywords = jd.keywords ?? [];
        const resumeText = JSON.stringify(normalizedResume).toLowerCase();
        const missingKeywords = jdKeywords.filter((k) => !resumeText.includes(k.toLowerCase()));
        normalizedResume = expandResume(normalizedResume, {
          originalResume: resume, jd, targetChars: pageFill.targetChars,
          currentChars: pageFill.charCount, missingKeywords,
        });
      } else if (pageFill.action === "compress") {
        normalizedResume = compressResume(normalizedResume, {
          targetChars: pageFill.targetChars, maxChars: Math.floor(pageFill.targetChars * 1.04), currentChars: pageFill.charCount,
        });
      }
    } catch (e) { console.warn("[Page Balancer] Failed (non-fatal):", e); }

    const finalCharCount = computeResumeCharCount(normalizedResume);
    return {
      resume: normalizedResume,
      provider: result.provider,
      charCount: finalCharCount,
      keywordsAdded: 0,
    };
  }

  // === FALLBACK: Legacy processing if hardened pipeline failed ===
  console.warn(`[Optimizer] Hardened pipeline failed (${hardenedResult.failedStep}): ${hardenedResult.errors.join("; ")}. Falling back to legacy processing.`);
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
      let retrySystem = retrySplit.system + "\n\nThe previous attempt produced an invalid or empty response. Return ONLY a valid JSON object matching the ResumeData schema. No prose, no markdown fences.\n";
      
      if (customDirective && !retrySystem.includes(customDirective)) {
        retrySystem += `\n\n[CUSTOM DIRECTIVE OVERRIDE]\n${customDirective}`;
      }

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
          // If we have a custom directive override, we do not require the standard instructions to be in it
          if (!customDirective) {
            throw new Error("Optimizer directive missing from retry prompt. Aborting.");
          }
        }
      }

      const retryUserPrompt = (retrySplit.user ? retrySplit.user + "\n\n---\n\n" : "") + `SOURCE RESUME:\n${JSON.stringify({ name: resume.name, headline: resume.headline, contact: resume.contact, summary: resume.summary, experience: resume.experience, education: resume.education, skills: resume.skills, languages: resume.languages, certifications: resume.certifications })}\n\nJOB DESCRIPTION:\n${jd.rawText ?? jd.keywords.join(", ")}\n\nOptimize this resume for the job. Return ONLY a JSON object with: name, headline, email, phone, location, summary, skills [{category, items[]}], experience [{title, company, location, startDate, endDate, bullets[]}], education [{degree, institution, field, startDate, endDate, modules}], languages [{name, proficiency}]. No prose, no markdown.`;

      // Validation check
      const retryFullPrompt = retrySystem + "\n\n" + retryUserPrompt;
      if (customDirective && !retryFullPrompt.includes(customDirective)) {
        throw new DirectiveInjectionError("DirectiveInjectionError: Custom directive override not present in the optimization prompt.");
      }
      const retryResult = await callAI({
        systemPrompt: retrySystem,
        isOptimizerCall: true,
        userPrompt: retryUserPrompt,
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
      // Return the original resume instead of throwing — the user always
      // gets a result. They can retry when AI providers recover.
      console.warn("[Optimizer] All AI providers failed — returning original resume with keywords added.");
      const jdKeywords = jd.keywords ?? [];
      const existingSkillNames = new Set(resume.skills.map((s) => s.name.toLowerCase()));
      const keywordsToAdd: ResumeSkill[] = jdKeywords
        .filter((k) => !existingSkillNames.has(k.toLowerCase()))
        .slice(0, 5)
        .map((name) => ({ id: uid("s"), name, category: "Targeted Keywords" }));
      return {
        resume: { ...resume, skills: [...resume.skills, ...keywordsToAdd] },
        provider: "Local Engine (offline mode)",
        charCount: JSON.stringify(resume).length,
        keywordsAdded: keywordsToAdd.length,
      };
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
      ? data.experience.map((e: any, i: number) => {
          // === ID-BASED MATCHING (not index-based) ===
          // Find the matching source experience by ID first, then fallback
          // to index. This is required by the locked pipeline architecture.
          let sourceExp: any = null;
          if (e.id) {
            sourceExp = resume.experience.find((src) => src.id === e.id);
          }
          if (!sourceExp && i < resume.experience.length) {
            // Last-resort index fallback (logged for debugging)
            sourceExp = resume.experience[i];
            console.warn(`[mapAItoResume] Experience entry ${i}: ID "${e.id}" not found in source — using index fallback`);
          }

          return {
            // PRESERVE source ID (immutable) — don't generate a new one
            id: sourceExp?.id || e.id || uid("e"),
            title: String(e.title || sourceExp?.title || ""),
            company: String(sourceExp?.company || e.company || ""),
            location: flattenLocation(e.location) || sourceExp?.location || "",
            // === PRESERVE ORIGINAL DATES — never default to "Present" ===
            // Use ID-matched source dates, not index-based
            startDate: String(sourceExp?.startDate || e.startDate || ""),
            endDate: String(sourceExp?.endDate || e.endDate || ""),
            bullets: Array.isArray(e.bullets) ? e.bullets.map((b: any) => flattenValue(b)) : [],
          };
        })
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
    preservedDates: normalizedResume.experience.every((e) => {
      let orig = resume.experience.find((x) => x.id === e.id);
      if (!orig) {
        const eFp = computeExperienceFingerprint(e);
        orig = resume.experience.find((x) => computeExperienceFingerprint(x) === eFp);
      }
      return orig ? (e.startDate === orig.startDate && e.endDate === orig.endDate) : false;
    }),
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
      ? result.resume.experience.map((e: any, i: number) => {
          // === ID-BASED MATCHING (required by locked pipeline) ===
          // 1. Try ID match (100% reliable)
          // 2. Try fingerprint match (title+company+location+dates hash)
          // 3. Try company/title match (fuzzy fallback)
          // 4. Last resort: index fallback (logged)
          let origMatch: any = null;

          // 1. ID match
          if (e.id) {
            origMatch = original.experience.find((o) => o.id === e.id);
          }

          // 2. Fingerprint match
          if (!origMatch) {
            // Inline fingerprint computation (avoids require() which is forbidden)
            const fpParts = [
              (e.title || "").toLowerCase().trim(),
              (e.company || "").toLowerCase().trim(),
              (e.location || "").toLowerCase().trim(),
              (e.startDate || "").toLowerCase().trim(),
              (e.endDate || "").toLowerCase().trim(),
            ];
            const aiFp = fpParts.join("|");
            origMatch = original.experience.find((o) => {
              const oParts = [
                (o.title || "").toLowerCase().trim(),
                (o.company || "").toLowerCase().trim(),
                (o.location || "").toLowerCase().trim(),
                (o.startDate || "").toLowerCase().trim(),
                (o.endDate || "").toLowerCase().trim(),
              ];
              return oParts.join("|") === aiFp;
            });
          }

          // 3. Company/title match (fuzzy)
          if (!origMatch) {
            const aiCompanyLower = (e.company || "").toLowerCase().trim();
            const aiTitleLower = (e.title || "").toLowerCase().trim();
            origMatch = original.experience.find((o) => {
              const oCompanyLower = (o.company || "").toLowerCase().trim();
              const oTitleLower = (o.title || "").toLowerCase().trim();
              return (oCompanyLower && (oCompanyLower === aiCompanyLower ||
                oCompanyLower.includes(aiCompanyLower) || aiCompanyLower.includes(oCompanyLower))) ||
                (oTitleLower && (oTitleLower === aiTitleLower ||
                oTitleLower.includes(aiTitleLower) || aiTitleLower.includes(oTitleLower)));
            });
          }

          // 4. Index fallback (last resort — logged)
          if (!origMatch && i < original.experience.length) {
            origMatch = original.experience[i];
            console.warn(`[mapAviationResult] Experience entry ${i}: no ID/fingerprint/company match — using index fallback`);
          }

          return {
            // PRESERVE source ID (immutable) — don't generate a new one
            id: origMatch?.id || e.id || uid("e"),
            title: String(origMatch?.title || e.title || ""),
            // STRICT: company ALWAYS from source. If source is empty, use "".
            company: String(origMatch?.company || ""),
            location: origMatch?.location || flattenLocation(e.location) || "",
            // STRICT: dates ALWAYS from source. If source is empty, use "".
            startDate: String(origMatch?.startDate || ""),
            endDate: String(origMatch?.endDate || ""),
            bullets: Array.isArray(e.bullets) ? e.bullets.map((b: any) => flattenValue(b)) : [],
          };
        })
      : original.experience,
    education: (result.resume.education ?? []).length > 0
      ? result.resume.education.map((ed: any, i: number) => {
          // CRITICAL FIX: Match AI education to original by institution or degree.
          // Always use original institution/dates if matched.
          const aiInstLower = (ed.institution || "").toLowerCase().trim();
          const aiDegreeLower = (ed.degree || "").toLowerCase().trim();
          const origEduMatch = original.education.find((o) => {
            const oInstLower = (o.institution || "").toLowerCase().trim();
            const oDegreeLower = (o.degree || "").toLowerCase().trim();
            return (oInstLower && (oInstLower === aiInstLower ||
              oInstLower.includes(aiInstLower) || aiInstLower.includes(oInstLower))) ||
              (oDegreeLower && (oDegreeLower === aiDegreeLower ||
              oDegreeLower.includes(aiDegreeLower) || aiDegreeLower.includes(oDegreeLower)));
          }) ?? original.education[i];

          return {
            id: uid("ed"),
            degree: String(ed.degree || origEduMatch?.degree || ""),
            institution: String(origEduMatch?.institution ?? ed.institution ?? ""),
            field: String(ed.field || origEduMatch?.field || ""),
            location: flattenLocation(ed.location) || origEduMatch?.location || "",
            startDate: String(origEduMatch?.startDate ?? ed.startDate ?? ""),
            endDate: String(origEduMatch?.endDate ?? ed.endDate ?? ""),
            highlights: ed.modules ? [`Modules: ${flattenValue(ed.modules)}`] : ed.highlights || origEduMatch?.highlights || [],
          };
        })
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

    let data: { issues?: string[]; suggestions?: string[]; confidence?: number };
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

    // [PIPELINE] Defensive: AI may return {confidence: 85} without
    // issues/suggestions arrays. Use Array.isArray() BEFORE accessing .length
    // to prevent "Cannot read properties of undefined (reading 'length')" crash.
    const issues = Array.isArray(data.issues) ? data.issues : [];
    const suggestions = Array.isArray(data.suggestions) ? data.suggestions : [];
    const confidence = typeof data.confidence === "number" ? data.confidence : 50;

    return {
      triggered: true,
      reason,
      notes: `Reflected on ${qa.checks.filter((c) => !c.passed).length} failed QA checks. Identified ${issues.length} issues and ${suggestions.length} suggestions.`,
      issues,
      suggestions,
      confidence,
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
