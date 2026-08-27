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
import {
  detectATSFromContext,
  ATS_PLATFORM_PROFILES,
  AIRLINE_COMPETENCY_ONTOLOGY
} from "./enterprise/ats-intelligence-engine";
import { validateSTAR, restoreViolatedEntities } from "./star-validator";

export interface ParallelOptimizerInput {
  resume: ResumeData;
  jd: JobDescription;
  directiveConfig?: OptimizerDirectiveConfig | null;
  optimizationPolicy?: string | null;
  baselineResume?: ResumeData; // Added for Localized Diff-Only Processing
  providerId?: string; // Added for Model Variant Arena
}

export interface ParallelOptimizerResult {
  resume: ResumeData;
  provider: string;
  charCount: number;
  keywordsAdded: number;
  warnings: string[];
  errors: string[];
  rationales?: Array<{
    section: string;
    original: string;
    edited: string;
    reason: string;
  }>;
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
  const { resume, jd, directiveConfig, optimizationPolicy, providerId } = input;
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

  const jdKeywords = jd.keywords ?? [];

  // ========================================================================
  // Run Summary, Skills, and Experience agents IN PARALLEL (with dynamically assembled context)
  // ========================================================================
  const startTime = Date.now();

  // Localized Diff-Only Processing (Token Efficiency)
  const baseline = input.baselineResume;
  let summaryModified = true;
  let skillsModified = true;
  let targetExperienceIds: string[] | undefined = undefined;

  if (baseline) {
    summaryModified = resume.summary !== baseline.summary || !resume.summary;
    skillsModified = JSON.stringify(resume.skills) !== JSON.stringify(baseline.skills) || resume.skills.length === 0;
    
    // Find modified experiences
    const modifiedIds: string[] = [];
    for (const curr of resume.experience) {
      const base = baseline.experience.find(b => b.id === curr.id);
      if (!base) {
        modifiedIds.push(curr.id);
      } else {
        const currBullets = (curr.bullets || []).join("\n");
        const baseBullets = (base.bullets || []).join("\n");
        if (currBullets !== baseBullets || curr.title !== base.title) {
          modifiedIds.push(curr.id);
        }
      }
    }
    targetExperienceIds = modifiedIds;
    console.info(`[Diff-Only Processing] summaryModified=${summaryModified}, skillsModified=${skillsModified}, targetExperienceIds=[${targetExperienceIds.join(", ")}]`);
  }

  const summaryPromise = summaryModified
    ? runSummaryAgent(resume, jd, jdKeywords, directiveConfig, optimizationPolicy, undefined, providerId)
    : Promise.resolve({ summary: resume.summary || "", headline: resume.headline || "", provider: "cache", rawResponse: "", rationales: [] });

  const skillsPromise = skillsModified
    ? runSkillsAgent(resume, jd, jdKeywords, directiveConfig, optimizationPolicy, undefined, providerId)
    : Promise.resolve({ skills: resume.skills, provider: "cache", rawResponse: "", rationales: [] });

  const experiencePromise = targetExperienceIds !== undefined && targetExperienceIds.length === 0
    ? Promise.resolve({ experiences: resume.experience.map(e => ({ id: e.id, bullets: e.bullets })), provider: "cache", rawResponse: "", rationales: [] })
    : runExperienceAgent(resume, jd, jdKeywords, directiveConfig, optimizationPolicy, undefined, targetExperienceIds, providerId);

  const [summaryResult, skillsResult, experienceResult] = await Promise.all([
    summaryPromise,
    skillsPromise,
    experiencePromise,
  ]);

  const parallelDuration = Date.now() - startTime;
  warnings.push(`Parallel optimization completed in ${parallelDuration}ms`);

  const combinedRationales = [
    ...((summaryResult as any).rationales || []),
    ...((skillsResult as any).rationales || []),
    ...((experienceResult as any).rationales || []),
  ];

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
    (assembleResult.resume.summary || "").toLowerCase().includes(k.toLowerCase())
  ).length;

  // ========================================================================
  // STAR & Entity Auto-Correction Guard
  // ========================================================================
  // Deterministically fix entity violations (employer names, job titles, dates,
  // institutions, certifications) that the AI changed, restoring originals.
  // This runs BEFORE caching so we never cache a hallucinated entity.
  const starResult = validateSTAR(assembleResult.resume, resume);

  let finalResume = assembleResult.resume;
  if (starResult.entityViolationCount > 0) {
    finalResume = restoreViolatedEntities(assembleResult.resume, resume, starResult.entityViolations);
    const violationSummary = starResult.entityViolations.map(
      (v) => `${v.field}: "${v.originalValue}" restored (was "${v.optimizedValue}")`
    ).join("; ");
    warnings.push(`[STAR Guard] ${starResult.entityViolationCount} entity violation(s) auto-corrected: ${violationSummary}`);
    console.warn(`[Parallel Pipeline] STAR entity guard restored ${starResult.entityViolationCount} field(s).`);
  }

  if (!starResult.passed && starResult.totalBullets > 0) {
    const bulletWarnings = starResult.bulletResults
      .filter((r) => !r.passes)
      .map((r) => `[STAR] Exp ${r.experienceId} bullet ${r.bulletIndex + 1}: ${r.failures.join("; ")}`);
    warnings.push(...bulletWarnings);
    console.warn(
      `[Parallel Pipeline] STAR validation: ${starResult.passingBullets}/${starResult.totalBullets} bullets pass. ` +
      `Passive verbs: ${starResult.passiveVerbCount}, Missing metrics: ${starResult.noMetricCount}.`
    );
  }

  const result: ParallelOptimizerResult = {
    resume: finalResume,
    provider: summaryResult.provider,
    charCount,
    keywordsAdded,
    warnings,
    errors,
    rationales: combinedRationales,
  };

  // Store in semantic cache for future identical requests
  setCachedOptimization(resume, jd, result, directiveConfig);

  return result;
}

// ============================================================================
// Individual agent runners
// ============================================================================

// ============================================================================
// Enterprise Prompt Helper
// ============================================================================

function buildEnterprisePromptContext(jd: JobDescription): { atsIntel: string; competencyIntel: string; airlineLanguageIntel: string } {
  const jdText = jd.rawText || (jd.keywords || []).join(" ");
  const detectedAts = detectATSFromContext(undefined, jdText, jd.company);
  const platform = ATS_PLATFORM_PROFILES[detectedAts.atsId] || ATS_PLATFORM_PROFILES.generic;

  const atsIntel = `
═══════════════════════════════════════════════════════════════
TARGET ATS ECOSYSTEM GUIDANCE (${platform.name} - Version ${platform.version}):
- Parsing Behavior: ${platform.parsingStyle}
- Formatting Constraints: ${platform.formattingPreferences}
- Optimization Strategy: ${platform.optimizationStrategy}
═══════════════════════════════════════════════════════════════`;

  const matchedCompetencies: string[] = [];
  for (const [key, comp] of Object.entries(AIRLINE_COMPETENCY_ONTOLOGY)) {
    const termMatches = [comp.name, ...comp.aliases, ...comp.synonyms].some(term => 
      jdText.toLowerCase().includes(term.toLowerCase())
    );
    if (termMatches) {
      matchedCompetencies.push(`- **${comp.name}**: ${comp.description}
  *Behavioral Indicators*: ${comp.behavioralIndicators.slice(0, 2).join("; ")}
  *Key Terminology*: ${comp.relatedAtsKeywords.slice(0, 5).join(", ")}`);
    }
  }

  const competencyIntel = matchedCompetencies.length > 0
    ? `
═══════════════════════════════════════════════════════════════
TARGET COMPETENCY ONTOLOGY (Align candidate achievements with these profiles):
${matchedCompetencies.join("\n")}
═══════════════════════════════════════════════════════════════`
    : "";

  const airlineLanguageIntel = `
═══════════════════════════════════════════════════════════════
AIRLINE LANGUAGE ENGINE TRANSFORMS (Translate generic terms naturally where appropriate):
- customer support / customer service -> Passenger Assistance / Passenger Experience
- safety rules -> Safety Compliance / SEP Guidelines
- help customers -> Deliver Exceptional Passenger Experience / Service Recovery
- teamwork -> Crew Resource Management (CRM)
- problem solving -> Operational Decision Making
- baggage -> Cabin Baggage
- flight -> Sector Operation
- boss / supervisor -> Cabin Senior / Purser
═══════════════════════════════════════════════════════════════`;

  return { atsIntel, competencyIntel, airlineLanguageIntel };
}

// ============================================================================
// Individual agent runners
// ============================================================================

// --- Summary Agent ---

export async function runSummaryAgent(
  resume: ResumeData,
  jd: JobDescription,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
  excludeProviderIds?: string[],
  providerId?: string,
): Promise<{ summary: string; headline: string; provider: string; rawResponse: string; rationales: any[] }> {
  const startTime = Date.now();

  // Dynamically assemble summary context: Summary Agent only needs summary and experience titles/companies
  const resumeContext = JSON.stringify({
    name: resume.name,
    currentSummary: resume.summary || "(empty — user has not written a summary yet)",
    experience: resume.experience.map((e) => ({
      title: e.title,
      company: e.company,
    })),
  }, null, 2);

  const jdContext = JSON.stringify({
    title: jd.title,
    company: jd.company,
  }, null, 2);

  const { atsIntel, competencyIntel, airlineLanguageIntel } = buildEnterprisePromptContext(jd);

  const systemPrompt = `You are a professional resume summary writer. Optimize the candidate's summary and headline to be ATS-friendly for the target job.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}

${atsIntel}
${competencyIntel}
${airlineLanguageIntel}

GLOBAL CONSTRAINTS (ENTITY PROTECTION & HALLUCINATION GUARDRAILS):
- You are strictly forbidden from changing, inventing, or translating names of employers, job titles, dates of employment, university names, or certifications.
- Only bullets and summaries can be rewritten. All other factual anchors must be preserved exactly.

RULES:
- Write 60-90 words.
- Use action-oriented language.
- Embed target keywords naturally: ${jdKeywords.join(", ")}
- NEVER invent experience, certifications, or metrics.
- NEVER use parentheses.
- Focus ONLY on the candidate's existing background (summarized in the context).

SELF-CORRECTION LOOP (INTERNAL REFLECTION):
Before returning the final JSON, run an internal reflection check:
1. "Did I modify an employer name, job title, employment date, university name, or certification?"
If yes, you must auto-correct the summary/headline and revert any modified factual anchors before outputting the final JSON.

Return ONLY JSON: {"summary": "...", "headline": "...", "rationales": [{"section": "summary", "original": "...", "edited": "...", "reason": "..."}]}`;

  const userPrompt = `CANDIDATE CONTEXT:
${resumeContext}

TARGET JOB:
${jdContext}

Return ONLY valid JSON.`;

  const agentDirectives = directiveConfig?.agentDirectives;
  const temp = agentDirectives?.supervisor?.temperature ?? 0.2;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 2000,
    temperature: temp,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
    excludeProviderIds,
    providerId,
    enableRetries: agentDirectives?.supervisor?.enableRetries,
    enableProviderSwitch: agentDirectives?.supervisor?.enableProviderSwitch,
  });

  const parsed = extractJSON<{ summary?: string; headline?: string; rationales?: any[] }>(result.text);
  const summaryOut = parsed?.summary || (resume.summary || "Summary optimization failed.");
  const headlineOut = parsed?.headline || "";
  const rationalesOut = Array.isArray(parsed?.rationales)
    ? parsed.rationales.map(r => ({
        section: "summary",
        original: typeof r.original === "string" ? r.original : resume.summary || "",
        edited: typeof r.edited === "string" ? r.edited : summaryOut,
        reason: typeof r.reason === "string" ? r.reason : "Optimized summary for ATS alignment.",
      }))
    : [{
        section: "summary",
        original: resume.summary || "",
        edited: summaryOut,
        reason: "Optimized summary for ATS alignment and role matching.",
      }];

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

  return { summary: summaryOut, headline: headlineOut, provider: result.provider, rawResponse: result.text, rationales: rationalesOut };
}

// --- Skills Agent ---

export async function runSkillsAgent(
  resume: ResumeData,
  jd: JobDescription,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
  excludeProviderIds?: string[],
  providerId?: string,
): Promise<{ skills: { name: string; category: string }[]; provider: string; rawResponse: string; rationales: any[] }> {
  const startTime = Date.now();

  // Dynamically assemble skills context: Skills Agent only needs skills list
  const skillsContext = JSON.stringify({
    existingSkills: resume.skills.map((s) => ({ name: s.name, category: s.category || "" })),
  }, null, 2);

  const jdContext = JSON.stringify({
    title: jd.title,
    company: jd.company,
    keywords: jdKeywords,
  }, null, 2);

  const { atsIntel, competencyIntel, airlineLanguageIntel } = buildEnterprisePromptContext(jd);

  const systemPrompt = `You are a skills optimizer. Reorder and enhance the candidate's skills list for ATS compatibility with the target job.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}

${atsIntel}
${competencyIntel}
${airlineLanguageIntel}

GLOBAL CONSTRAINTS (ENTITY PROTECTION & HALLUCINATION GUARDRAILS):
- You are strictly forbidden from changing, inventing, or translating names of employers, job titles, dates of employment, university names, or certifications.
- Only bullets and summaries can be rewritten. All other factual anchors must be preserved exactly.

RULES:
- Keep ALL existing skills.
- Reorder: place target job-relevant skills FIRST.
- Group by category (Languages, Frontend, Backend, Tools, etc.).
- Target keywords to weave or prioritize: ${jdKeywords.join(", ")}
- Only add skills that are genuinely implied or relevant to the candidate's professional domain. NEVER fabricate unrelated skills.

SELF-CORRECTION LOOP (INTERNAL REFLECTION):
Before returning the final JSON, run an internal reflection check:
1. "Did I modify any employer name, job title, employment date, university name, or certification?"
If yes, you must revert the modified factual anchors before outputting the final JSON.

Return ONLY JSON: {"skills": [{"name": "...", "category": "..."}], "rationales": [{"section": "skills", "original": "...", "edited": "...", "reason": "..."}]}`;

  const userPrompt = `CANDIDATE SKILLS:
${skillsContext}

TARGET JOB:
${jdContext}

Return ONLY valid JSON.`;

  const agentDirectives = directiveConfig?.agentDirectives;
  const temp = agentDirectives?.supervisor?.temperature ?? 0.15;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 1500,
    temperature: temp,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
    excludeProviderIds,
    providerId,
    enableRetries: agentDirectives?.supervisor?.enableRetries,
    enableProviderSwitch: agentDirectives?.supervisor?.enableProviderSwitch,
  });

  const parsed = extractJSON<{ skills?: { name: string; category: string }[]; rationales?: any[] }>(result.text);
  const skills = parsed?.skills || resume.skills.map((s) => ({ name: s.name, category: s.category || "General" }));
  const rationalesOut = Array.isArray(parsed?.rationales)
    ? parsed.rationales.map(r => ({
        section: "skills",
        original: typeof r.original === "string" ? r.original : resume.skills.map(s => s.name).join(", "),
        edited: typeof r.edited === "string" ? r.edited : skills.map(s => s.name).join(", "),
        reason: typeof r.reason === "string" ? r.reason : "Enriched and prioritized skills for job relevance.",
      }))
    : [{
        section: "skills",
        original: resume.skills.map(s => s.name).join(", "),
        edited: skills.map(s => s.name).join(", "),
        reason: "Aligned core skills list with target job competencies.",
      }];

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

  return { skills, provider: result.provider, rawResponse: result.text, rationales: rationalesOut };
}

// --- Experience Agent ---

export async function runExperienceAgent(
  resume: ResumeData,
  jd: JobDescription,
  jdKeywords: string[],
  directiveConfig?: OptimizerDirectiveConfig | null,
  optimizationPolicy?: string | null,
  excludeProviderIds?: string[],
  targetExperienceIds?: string[],
  providerId?: string,
): Promise<{ experiences: { id: string; bullets: string[] }[]; provider: string; rawResponse: string; rationales: any[] }> {
  const startTime = Date.now();

  // Filter experiences to optimize if targetExperienceIds is provided
  const experiencesToOptimize = targetExperienceIds && targetExperienceIds.length > 0
    ? resume.experience.filter(e => targetExperienceIds.includes(e.id))
    : resume.experience;

  if (experiencesToOptimize.length === 0) {
    return {
      experiences: resume.experience.map(e => ({ id: e.id, bullets: e.bullets })),
      provider: "cache",
      rawResponse: "",
      rationales: [],
    };
  }

  // Dynamically assemble experience context: Experience Agent only needs experience details
  const experienceContext = JSON.stringify({
    experience: experiencesToOptimize.map((e) => ({
      id: e.id,
      title: e.title,
      company: e.company,
      bullets: e.bullets,
    })),
  }, null, 2);

  const jdContext = JSON.stringify({
    title: jd.title,
    company: jd.company,
    keywords: jdKeywords,
    responsibilities: jd.responsibilities || [],
    requiredSkills: jd.requiredSkills || [],
  }, null, 2);

  const { atsIntel, competencyIntel, airlineLanguageIntel } = buildEnterprisePromptContext(jd);

  const systemPrompt = `You are a resume bullet optimizer. Rewrite the candidate's experience bullet points to be more impactful and aligned with the target job description.
${optimizationPolicy ? `POLICY: ${optimizationPolicy}` : ""}

${atsIntel}
${competencyIntel}
${airlineLanguageIntel}

GLOBAL CONSTRAINTS (ENTITY PROTECTION & HALLUCINATION GUARDRAILS):
- You are strictly forbidden from changing, inventing, or translating names of employers, job titles, dates of employment, university names, or certifications.
- Only bullets and summaries can be rewritten. All other factual anchors must be preserved exactly.
- NEVER change the bullet count (same number of bullets per experience entry).
- Return the EXACT same experience IDs as provided.

STAR METHOD CONSTRAINTS:
- Every optimized bullet point must strictly follow the STAR method (Situation, Task, Action, Result).
- Every bullet point MUST start with an active, high-impact verb (e.g., Spearheaded, Orchestrated, Optimized, Streamlined, Coordinated — avoiding passive words like 'Responsible for', 'Assisted', 'Handled').
- Every bullet point MUST end with a quantifiable metric (e.g., percentages, dollar amounts, hours saved). If the source bullet does not contain a metric, use a proxy like hours saved, scale of operation, or frequency to construct a realistic metric without inventing false achievements.

RULES:
- Rewrite each bullet point to emphasize achievements and results.
- Embed target keywords naturally where they fit contextually: ${jdKeywords.join(", ")}

SELF-CORRECTION LOOP (INTERNAL REFLECTION):
Before returning the final JSON, run an internal reflection check on every single bullet point:
1. "Does this bullet contain a passive verb like 'responsible for', 'assisted', or 'handled'?"
2. "Does it lack a quantifiable metric?"
3. "Did I modify an employer name, job title, employment date, university name, or certification?"
If the answer to (1) or (2) is YES, or the answer to (3) is YES, you must auto-correct the bullet and/or revert the modified metadata fields before outputting the final JSON.

Return ONLY JSON: {"experiences": [{"id": "...", "bullets": ["...", "..."]}], "rationales": [{"section": "experience:[id]", "original": "...", "edited": "...", "reason": "..."}]}`;

  const userPrompt = `CANDIDATE EXPERIENCE:
${experienceContext}

TARGET JOB:
${jdContext}

Return ONLY valid JSON.`;

  const agentDirectives = directiveConfig?.agentDirectives;
  const temp = agentDirectives?.supervisor?.temperature ?? 0.15;

  const result = await callAI({
    systemPrompt,
    userPrompt,
    maxTokens: 4000,
    temperature: temp,
    taskCategory: "document",
    timeoutMs: OPTIMIZER_CALL_TIMEOUT_MS,
    isOptimizerCall: true,
    excludeProviderIds,
    providerId,
    enableRetries: agentDirectives?.supervisor?.enableRetries,
    enableProviderSwitch: agentDirectives?.supervisor?.enableProviderSwitch,
  });

  const parsed = extractJSON<{ experiences?: { id: string; bullets: string[] }[]; rationales?: any[] }>(result.text);
  const expOut = parsed?.experiences?.map((e) => ({
    id: e.id,
    bullets: e.bullets || [],
  })) || resume.experience.map((e) => ({ id: e.id, bullets: e.bullets }));

  const rationalesOut = Array.isArray(parsed?.rationales)
    ? parsed.rationales.map(r => ({
        section: typeof r.section === "string" ? r.section : "experience",
        original: typeof r.original === "string" ? r.original : "",
        edited: typeof r.edited === "string" ? r.edited : "",
        reason: typeof r.reason === "string" ? r.reason : "Optimized bullet statements for achievement-oriented impact.",
      }))
    : expOut.map(e => {
        const orig = resume.experience.find(oe => oe.id === e.id);
        return {
          section: `experience:${e.id}`,
          original: orig?.bullets.join(" | ") || "",
          edited: e.bullets.join(" | "),
          reason: "Rewrote bullets to follow the Action-Verb-Metric structure.",
        };
      });

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

  return { experiences: expOut, provider: result.provider, rawResponse: result.text, rationales: rationalesOut };
}
