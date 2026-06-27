// ============================================================================
// Parallel Pipeline — concurrent summary/skills/experience optimization
//
// Instead of one LLM call doing everything, this splits into three independent
// parallel calls: Summary Agent, Skills Agent, and Experience Agent.
// Education, languages, contact, and certifications ALWAYS come from source.
//
// The assembler merges the parallel results with source data to produce the
// final resume — same architecture as the locked pipeline but with concurrent
// LLM execution for 40-60% speed improvement.
//
// Emits events to globalEventBus for monitoring/debugging.
// Creates pre/post snapshots via the Snapshot Engine for rollback support.
// ============================================================================

import type { ResumeData, JobDescription, OptimizerDirectiveConfig } from "./types";
import { callAI, extractJSON, OPTIMIZER_CALL_TIMEOUT_MS } from "./ai";
import { assembleResume } from "./resume-assembler";
import { ensureExperienceIds } from "./entity-lock";
import { createSnapshot, compareSnapshots } from "./resume-snapshot-engine";
import { globalEventBus } from "./agent-event-bus";
import { getCachedOptimization, setCachedOptimization } from "./semantic-cache";
import { recordProviderSuccess, recordProviderFailure } from "./provider-health-monitor";

export interface ParallelOptimizerInput {
  resume: ResumeData;
  jd: JobDescription;
  directiveConfig?: OptimizerDirectiveConfig | null;
  optimizationPolicy?: string | null;
}

export interface ParallelOptimizerResult {
  resume: ResumeData;
  provider: string;
  charCount: number;
  keywordsAdded: number;
  warnings: string[];
  errors: string[];
}

// ============================================================================
// Main entry point
// ============================================================================

/**
 * Run summary, skills, and experience optimizers in parallel.
 * Education, languages, contact, and certifications always come from source.
 */
export async function runParallelOptimizer(
  input: ParallelOptimizerInput,
): Promise<ParallelOptimizerResult> {
  const { resume, jd, directiveConfig, optimizationPolicy } = input;
  const warnings: string[] = [];
  const errors: string[] = [];

  // === Semantic Cache: skip optimization if identical input was already processed ===
  const cached = getCachedOptimization(resume, jd, directiveConfig);
  if (cached) {
    warnings.push("Semantic cache hit — returning previous optimization result.");
    globalEventBus.emit({
      agent: "SemanticCache",
      action: "cache_hit",
      resumeId: resume.id,
      success: true,
      metadata: { charCount: cached.charCount, provider: cached.provider },
    });
    return cached;
  }
  const idReadyResume = ensureExperienceIds(resume);

  // Take snapshot before optimization
  const beforeSnapshot = createSnapshot(idReadyResume, "pre-optimization");
  globalEventBus.emit({
    agent: "SnapshotEngine",
    action: "snapshot_created",
    resumeId: resume.id,
    success: true,
    metadata: { snapshotId: beforeSnapshot.snapshotId },
  });

  // Build the shared context for all agents
  const jdKeywords = jd.keywords ?? [];
  const jdText = jd.rawText ?? JSON.stringify({
    title: jd.title,
    company: jd.company,
    responsibilities: jd.responsibilities,
    requiredSkills: jd.requiredSkills,
    keywords: jd.keywords,
  });

  const sourceContext = JSON.stringify({
    name: resume.name,
    summary: resume.summary,
    experience: resume.experience.map((e) => ({
      id: e.id, title: e.title, company: e.company,
      location: e.location, startDate: e.startDate, endDate: e.endDate,
      bullets: e.bullets,
    })),
  });

  // ========================================================================
  // Run Summary, Skills, and Experience agents IN PARALLEL
  // ========================================================================
  const startTime = Date.now();

  const [summaryResult, skillsResult, experienceResult] = await Promise.all([
    runSummaryAgent(sourceContext, jdText, jdKeywords, directiveConfig, optimizationPolicy),
    runSkillsAgent(sourceContext, resume.skills, jdText, jdKeywords, directiveConfig, optimizationPolicy),
    runExperienceAgent(sourceContext, resume.experience, jdText, jdKeywords, directiveConfig, optimizationPolicy),
  ]);

  const parallelDuration = Date.now() - startTime;
  warnings.push(`Parallel optimization completed in ${parallelDuration}ms`);

  // ========================================================================
  // Assemble final resume (education + languages from source)
  // ========================================================================
  globalEventBus.emit({
    agent: "ResumeAssembler",
    action: "assemble",
    resumeId: resume.id,
    duration: 0,
  });
  const assembleStart = Date.now();

  const optimizerOutput = {
    summary: summaryResult.summary,
    headline: summaryResult.headline,
    skills: skillsResult.skills,
    experiences: experienceResult.experiences,
  };

  const assembleResult = assembleResume(idReadyResume, optimizerOutput);
  warnings.push(...assembleResult.warnings);

  globalEventBus.emit({
    agent: "ResumeAssembler",
    action: "assemble_complete",
    resumeId: resume.id,
    duration: Date.now() - assembleStart,
    success: true,
  });

  // ========================================================================
  // Compare snapshots for diff / hallucination detection
  // ========================================================================
  const afterSnapshot = createSnapshot(assembleResult.resume, "post-optimization");
  const diff = compareSnapshots(beforeSnapshot, afterSnapshot);
  warnings.push(`Snapshot diff: ${diff.summary}`);
  if (diff.hallucinations.length > 0) {
    errors.push(...diff.hallucinations);
  }

  // ========================================================================
  // Compute metrics
  // ========================================================================
  const charCount = JSON.stringify({
    summary: assembleResult.resume.summary,
    experience: assembleResult.resume.experience,
    skills: assembleResult.resume.skills,
    education: assembleResult.resume.education,
    languages: assembleResult.resume.languages,
  }).length;

  const keywordsAdded = jdKeywords.filter((k) =>
    assembleResult.resume.summary.toLowerCase().includes(k.toLowerCase())
  ).length;

  const result: ParallelOptimizerResult = {
    resume: assembleResult.resume,
    provider: summaryResult.provider,
    charCount,
    keywordsAdded,
    warnings,
    errors,
  };

  // Store in semantic cache for future identical requests
  setCachedOptimization(resume, jd, result, directiveConfig);

  return result;
}

// ============================================================================
// Individual agent runners
// ============================================================================

// --- Summary Agent ---

async function runSummaryAgent(
  sourceContext: string,
  jdText: string,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
): Promise<{ summary: string; headline: string; provider: string }> {
  const startTime = Date.now();
  const systemPrompt = `You are a professional resume summary writer. Optimize the summary to be ATS-friendly.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}
RULES:
- Write 60-90 words
- Use action-oriented language
- Embed target keywords naturally: ${jdKeywords.join(", ")}
- NEVER invent experience, certifications, or metrics
- NEVER use parentheses
Return ONLY JSON: {"summary": "...", "headline": "..."}`;

  const userPrompt = `SOURCE RESUME:\n${sourceContext}\n\nTARGET JOB:\n${jdText}\n\nReturn ONLY valid JSON.`;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 2000,
    temperature: 0.2,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
  });

  const parsed = extractJSON<{ summary?: string; headline?: string }>(result.text);
  const summaryOut = parsed?.summary || "Summary optimization failed.";
  const headlineOut = parsed?.headline || "";

  // Record provider health
  const summaryDuration = Date.now() - startTime;
  recordProviderSuccess(result.provider, summaryDuration, result.tokensEstimate ?? 0);

  globalEventBus.emit({
    agent: "SummaryAgent",
    action: "optimize_summary",
    resumeId: "",
    duration: Date.now() - startTime,
    tokens: result.tokensEstimate ?? 0,
    provider: result.provider,
    success: !!parsed,
  });

  return { summary: summaryOut, headline: headlineOut, provider: result.provider };
}

// --- Skills Agent ---

async function runSkillsAgent(
  sourceContext: string,
  existingSkills: { name: string; category?: string }[],
  jdText: string,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
): Promise<{ skills: { name: string; category: string }[]; provider: string }> {
  const startTime = Date.now();
  const systemPrompt = `You are a skills optimizer. Reorder and enhance skills for ATS compatibility.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}
RULES:
- Keep ALL existing skills
- Reorder: JD-relevant skills FIRST
- Group by category (Languages, Frontend, Backend, Tools, etc.)
- Only add skills that are genuinely present in the experience
- NEVER add skills the candidate doesn't have
- Target keywords: ${jdKeywords.join(", ")}
Return ONLY JSON: {"skills": [{"name": "...", "category": "..."}]}`;

  const existingSkillsJson = JSON.stringify(existingSkills);
  const userPrompt = `SOURCE RESUME:\n${sourceContext}\nEXISTING SKILLS:\n${existingSkillsJson}\n\nTARGET JOB:\n${jdText}\n\nReturn ONLY valid JSON.`;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 1500,
    temperature: 0.15,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
  });

  const parsed = extractJSON<{ skills?: { name: string; category: string }[] }>(result.text);
  const skills = parsed?.skills || existingSkills.map((s) => ({ name: s.name, category: s.category || "General" }));

  // Record provider health
  recordProviderSuccess(result.provider, Date.now() - startTime, result.tokensEstimate ?? 0);

  globalEventBus.emit({
    agent: "SkillsAgent",
    action: "optimize_skills",
    resumeId: "",
    duration: Date.now() - startTime,
    tokens: result.tokensEstimate ?? 0,
    provider: result.provider,
    success: !!parsed,
  });

  return { skills, provider: result.provider };
}

// --- Experience Agent ---

async function runExperienceAgent(
  sourceContext: string,
  experiences: { id: string; title: string; company: string; bullets: string[] }[],
  jdText: string,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
): Promise<{ experiences: { id: string; bullets: string[] }[]; provider: string }> {
  const startTime = Date.now();
  const systemPrompt = `You are a resume bullet optimizer. Rewrite only the bullet points — NEVER change companies, dates, or roles.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}
RULES:
- Rewrite each bullet to be more impactful
- Use strong action verbs: Spearheaded, Orchestrated, Streamlined, Delivered
- Embed keywords naturally: ${jdKeywords.join(", ")}
- NEVER add metrics, percentages, or dollar amounts that aren't in the original
- NEVER change the bullet count (same number of bullets per experience)
- NEVER invent new experience entries
- Return the SAME experience IDs as provided
Return ONLY JSON: {"experiences": [{"id": "exp_1", "bullets": ["...", "..."]}]}`;

  const expJson = JSON.stringify(experiences.map((e) => ({ id: e.id, title: e.title, company: e.company, bullets: e.bullets })));
  const userPrompt = `SOURCE EXPERIENCES:\n${expJson}\n\nTARGET JOB:\n${jdText}\n\nSOURCE RESUME:\n${sourceContext}\n\nReturn ONLY valid JSON.`;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 4000,
    temperature: 0.15,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
  });

  const parsed = extractJSON<{ experiences?: { id: string; bullets: string[] }[] }>(result.text);
  const expOut = parsed?.experiences?.map((e) => ({
    id: e.id,
    bullets: e.bullets || [],
  })) || experiences.map((e) => ({ id: e.id, bullets: e.bullets }));

  // Record provider health
  recordProviderSuccess(result.provider, Date.now() - startTime, result.tokensEstimate ?? 0);

  globalEventBus.emit({
    agent: "ExperienceAgent",
    action: "optimize_bullets",
    resumeId: "",
    duration: Date.now() - startTime,
    tokens: result.tokensEstimate ?? 0,
    provider: result.provider,
    success: !!parsed,
  });

  return { experiences: expOut, provider: result.provider };
}
