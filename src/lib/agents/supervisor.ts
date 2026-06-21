// ============================================================================
// SupervisorAgent — the central orchestrator for the Unified AI Career
// Operating System (V3).
//
// Responsibilities:
//   - Determine which agents should execute (based on the event + context)
//   - Manage dependencies between agents
//   - Prevent duplicate work (cache results within a session)
//   - Reuse cached data across events
//   - Coordinate retries on transient failures
//   - Manage failures gracefully (non-fatal agents don't block the pipeline)
//
// Event-driven execution:
//   - "resume-uploaded"      → Resume Parser → ingest into Memory
//   - "job-url-added"        → Job Intelligence → ATS Analysis → Optimizer → QA → Reflection
//   - "optimization-complete"→ Cover Letter + Interview + Company Intel + Skill Gap (PARALLEL)
//   - "application-submitted"→ Application Tracker
//   - "context-changed"      → re-detect context, invalidate stale caches
//
// The Supervisor does NOT replace the existing runOptimizationPipeline() —
// it wraps it. The existing pipeline is called as a single "macro-step"
// inside the Supervisor's "job-url-added" event handler. This preserves
// 100% backward compatibility.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import { runOptimizationPipeline, type PipelineResult, type PipelineProgress } from "./orchestrator";
import { analyzeCompanyIntelligence, analyzeSkillGap } from "./company-skill-agents";
import { callAI, extractJSON } from "../ai";
import {
  type GlobalPipelineContext,
  type AgentState,
  type AgentId,
  type PipelineEvent,
  createEmptyContext,
} from "./pipeline-context";
import {
  type UserProfile,
  loadUserProfile,
  saveUserProfile,
  ingestResumeIntoMemory,
  ingestJobIntoMemory,
  recordOptimization,
} from "./memory-agent";

// ============================================================================
// Cache (in-memory, per-session)
// ============================================================================

interface CacheEntry {
  key: string;
  result: any;
  timestamp: number;
}

const cache = new Map<string, CacheEntry>();
const CACHE_TTL_MS = 10 * 60 * 1000; // 10 minutes

function getCached<T>(key: string): T | null {
  const entry = cache.get(key);
  if (!entry) return null;
  if (Date.now() - entry.timestamp > CACHE_TTL_MS) {
    cache.delete(key);
    return null;
  }
  return entry.result as T;
}

function setCached<T>(key: string, result: T): void {
  cache.set(key, { key, result, timestamp: Date.now() });
}

function cacheKey(prefix: string, ...parts: (string | undefined | null)[]): string {
  return `${prefix}:${parts.filter(Boolean).join(":")}`;
}

// ============================================================================
// Supervisor state
// ============================================================================

export interface SupervisorState {
  /** The current shared context */
  context: GlobalPipelineContext;
  /** The user profile (persisted by MemoryAgent) */
  profile: UserProfile;
  /** The status of every agent in the system */
  agents: Record<AgentId, AgentState>;
  /** Event log (most recent first) */
  events: PipelineEvent[];
  /** Whether the supervisor is currently running any agents */
  isRunning: boolean;
}

const listeners = new Set<(state: SupervisorState) => void>();

let state: SupervisorState = {
  context: createEmptyContext(),
  profile: loadUserProfile(),
  agents: {} as Record<AgentId, AgentState>,
  events: [],
  isRunning: false,
};

// Initialize agent states
const AGENT_DEFINITIONS: { id: AgentId; name: string; icon: string }[] = [
  { id: "supervisor", name: "Supervisor", icon: "Cpu" },
  { id: "planner", name: "Planner", icon: "ClipboardList" },
  { id: "memory", name: "Memory", icon: "Database" },
  { id: "research", name: "Research", icon: "Search" },
  { id: "resume-parser", name: "Resume Parser", icon: "FileText" },
  { id: "job-intelligence", name: "Job Intelligence", icon: "Briefcase" },
  { id: "company-intelligence", name: "Company Intelligence", icon: "Building2" },
  { id: "skill-gap", name: "Skill Gap", icon: "GitCompare" },
  { id: "ats-analysis", name: "ATS Analysis", icon: "ScanText" },
  { id: "optimizer", name: "Optimizer", icon: "Wand2" },
  { id: "qa", name: "Quality Assurance", icon: "ShieldCheck" },
  { id: "reflection", name: "Reflection", icon: "Brain" },
  { id: "cover-letter", name: "Cover Letter", icon: "Mail" },
  { id: "interview", name: "Interview Prep", icon: "MessageSquare" },
  { id: "career-coach", name: "Career Coach", icon: "Compass" },
  { id: "application-tracker", name: "Application Tracker", icon: "ListChecks" },
  { id: "salary", name: "Salary Insights", icon: "DollarSign" },
  { id: "job-search", name: "Job Search", icon: "Globe" },
];

for (const def of AGENT_DEFINITIONS) {
  state.agents[def.id] = { id: def.id, name: def.name, icon: def.icon, status: "pending" };
}

// ============================================================================
// State management
// ============================================================================

function setState(updater: (prev: SupervisorState) => SupervisorState): void {
  state = updater(state);
  for (const listener of listeners) {
    try { listener(state); } catch {}
  }
}

export function getSupervisorState(): SupervisorState {
  return state;
}

export function subscribeToSupervisor(listener: (state: SupervisorState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function updateAgent(id: AgentId, patch: Partial<AgentState>): void {
  setState((prev) => ({
    ...prev,
    agents: { ...prev.agents, [id]: { ...prev.agents[id], ...patch } },
  }));
}

function logEvent(type: PipelineEvent["type"], payload?: any): void {
  const event: PipelineEvent = { type, timestamp: new Date().toISOString(), payload };
  setState((prev) => ({ ...prev, events: [event, ...prev.events].slice(0, 50) }));
}

function updateContext(patch: Partial<GlobalPipelineContext>): void {
  // === IMMUTABILITY GUARD (V3.0.1) ===
  // Deep-clone any resume/JD objects before storing them in the context,
  // so downstream agents (CoverLetter, Interview, CareerCoach) cannot
  // mutate the original resume/JD references. This prevents the "ATS score
  // changed after Company Research" defect class caused by shared references.
  const safePatch: Partial<GlobalPipelineContext> = { ...patch };
  if (safePatch.originalResume) {
    safePatch.originalResume = deepClone(safePatch.originalResume);
  }
  if (safePatch.optimizedResume) {
    safePatch.optimizedResume = deepClone(safePatch.optimizedResume);
  }
  if (safePatch.jobDescription) {
    safePatch.jobDescription = deepClone(safePatch.jobDescription);
  }
  setState((prev) => ({
    ...prev,
    context: { ...prev.context, ...safePatch, updatedAt: new Date().toISOString() },
  }));
}

/**
 * Deep-clone an object using structuredClone (available in all modern
 * browsers and Node 17+). Falls back to JSON parse/stringify for older
 * environments. Ensures the context never shares references with the
 * original objects.
 */
function deepClone<T>(obj: T): T {
  if (typeof structuredClone === "function") {
    try { return structuredClone(obj); } catch { /* fall through */ }
  }
  return JSON.parse(JSON.stringify(obj));
}

// ============================================================================
// Retry helper
// ============================================================================

async function withRetry<T>(fn: () => Promise<T>, maxRetries = 1, label = "agent"): Promise<T> {
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      if (attempt < maxRetries) {
        await new Promise((r) => setTimeout(r, 1000 * Math.pow(2, attempt)));
      }
    }
  }
  throw lastError;
}

// ============================================================================
// Event handlers
// ============================================================================

/**
 * Set the active resume + JD in the shared context. Called by any module
 * when the user selects a resume or JD. Auto-detects company + industry.
 */
export function setContext(inputs: {
  resume?: ResumeData | null;
  jd?: JobDescription | null;
  optimizedResume?: ResumeData | null;
  companyName?: string | null;
  industry?: string | null;
}): void {
  const patch: Partial<GlobalPipelineContext> = {};
  if (inputs.resume !== undefined) {
    patch.originalResume = inputs.resume;
    patch.resumeId = inputs.resume?.id ?? null;
  }
  if (inputs.jd !== undefined) {
    patch.jobDescription = inputs.jd;
    patch.jobId = inputs.jd?.id ?? null;
    patch.jobUrl = inputs.jd?.url ?? null;
    patch.companyName = inputs.jd?.company ?? patch.companyName ?? null;
    patch.jobTitle = inputs.jd?.title ?? null;
  }
  if (inputs.optimizedResume !== undefined) {
    patch.optimizedResume = inputs.optimizedResume;
  }
  if (inputs.companyName !== undefined) patch.companyName = inputs.companyName;
  if (inputs.industry !== undefined) patch.industry = inputs.industry;

  updateContext(patch);
  logEvent("context-changed", { resumeId: patch.resumeId, jobId: patch.jobId });

  // Ingest into memory profile (keeps skills/certs/target-roles up to date)
  if (inputs.resume) {
    const profile = ingestResumeIntoMemory(state.profile, inputs.resume);
    setState((prev) => ({ ...prev, profile }));
  }
  if (inputs.jd) {
    const profile = ingestJobIntoMemory(state.profile, inputs.jd);
    setState((prev) => ({ ...prev, profile }));
  }
}

/**
 * EVENT: resume-uploaded
 * Runs the Resume Parser (already done by the upload flow) and ingests the
 * result into the Memory profile.
 */
export async function handleResumeUploaded(resume: ResumeData): Promise<void> {
  logEvent("resume-uploaded", { resumeId: resume.id });
  updateAgent("resume-parser", { status: "running", startedAt: new Date().toISOString(), log: `Ingesting resume: ${resume.name}` });

  // Ingest into memory
  const profile = ingestResumeIntoMemory(state.profile, resume);
  setState((prev) => ({ ...prev, profile }));

  updateContext({ originalResume: resume, resumeId: resume.id });
  updateAgent("resume-parser", { status: "completed", completedAt: new Date().toISOString(), log: `Ingested ${profile.skills.length} skills, ${profile.certifications.length} certs into memory.` });
}

/**
 * EVENT: job-url-added / optimization-requested
 * Runs the full existing optimization pipeline (JI → Company+SkillGap → ATS → Optimizer → QA → Reflection)
 * and then triggers the post-optimization agents (CoverLetter + Interview + CareerCoach) in parallel.
 *
 * This wraps the existing runOptimizationPipeline() — 100% backward compatible.
 */
export async function handleOptimizationRequested(
  inputs: {
    resume: ResumeData;
    jd: JobDescription;
    userDirectives?: string;
    aviationMode?: any;
    enableReflection?: boolean;
    onProgress?: (progress: PipelineProgress) => void;
  },
): Promise<PipelineResult | null> {
  const { resume, jd, userDirectives, aviationMode, enableReflection = true, onProgress } = inputs;
  logEvent("job-url-added", { resumeId: resume.id, jobId: jd.id });

  setState((prev) => ({ ...prev, isRunning: true }));
  updateContext({
    originalResume: resume,
    resumeId: resume.id,
    jobDescription: jd,
    jobId: jd.id,
    jobUrl: jd.url ?? null,
    companyName: jd.company ?? null,
    jobTitle: jd.title ?? null,
  });

  // Check cache — if we've optimized this exact resume+JD combo recently, return cached
  const cacheK = cacheKey("optimization", resume.id, jd.id);
  const cachedResult = getCached<PipelineResult>(cacheK);
  if (cachedResult) {
    updateAgent("supervisor", { status: "completed", log: "Served optimization from cache.", cached: true });
    updateContext({
      optimizedResume: cachedResult.optimizedResume,
      beforeATS: cachedResult.beforeATS,
      afterATS: cachedResult.afterATS,
      jobIntelligence: cachedResult.jobIntelligence,
      companyIntelligence: cachedResult.companyIntelligence,
      skillGap: cachedResult.skillGap,
      qa: cachedResult.qa,
      reflection: cachedResult.reflection,
      atsScore: cachedResult.afterATS?.scores.ats ?? null,
    });
    setState((prev) => ({ ...prev, isRunning: false }));
    return cachedResult;
  }

  try {
    // === Run the existing 6-agent pipeline (V2) ===
    // The Supervisor delegates to runOptimizationPipeline — the existing
    // production-tested orchestrator. This preserves 100% backward compat.
    updateAgent("supervisor", { status: "running", startedAt: new Date().toISOString(), log: "Delegating to 6-agent optimization pipeline…" });

    const result = await runOptimizationPipeline({
      resume,
      jd,
      userDirectives,
      aviationMode,
      enableReflection,
      checkExport: false,
      onProgress,
    });

    // Update the shared context with the pipeline results
    updateContext({
      optimizedResume: result.optimizedResume,
      beforeATS: result.beforeATS,
      afterATS: result.afterATS,
      jobIntelligence: result.jobIntelligence,
      companyIntelligence: result.companyIntelligence,
      skillGap: result.skillGap,
      qa: result.qa,
      reflection: result.reflection,
      atsScore: result.afterATS?.scores.ats ?? null,
      matchScore: result.skillGap?.overallMatch ?? null,
      keywords: result.jobIntelligence?.priorityKeywords ?? [],
      missingSkills: result.skillGap?.missingSkills.critical ?? [],
      optimizationId: result.optimizedResume?.id ?? null,
    });

    setCached(cacheK, result);
    updateAgent("supervisor", { status: "completed", completedAt: new Date().toISOString(), log: "Optimization pipeline complete." });

    // Record in memory
    if (result.optimizedResume && result.beforeATS && result.afterATS) {
      const profile = recordOptimization(state.profile, {
        id: result.optimizedResume.id,
        resumeName: resume.name,
        jobTitle: jd.title ?? "Role",
        company: jd.company ?? "",
        atsBefore: result.beforeATS.scores.ats,
        atsAfter: result.afterATS.scores.ats,
        createdAt: new Date().toISOString(),
      });
      setState((prev) => ({ ...prev, profile }));
      saveUserProfile(profile);
    }

    // === Trigger post-optimization agents in PARALLEL ===
    // These are non-fatal — if any fails, the optimization is still valid.
    if (result.optimizedResume) {
      logEvent("optimization-complete", { optimizationId: result.optimizedResume.id });
      await runPostOptimizationAgents(result, jd);
    }

    setState((prev) => ({ ...prev, isRunning: false }));
    return result;
  } catch (e: any) {
    updateAgent("supervisor", { status: "failed", error: e?.message ?? "Optimization failed", log: `✗ ${e?.message}` });
    setState((prev) => ({ ...prev, isRunning: false }));
    return null;
  }
}

/**
 * Post-optimization agents: Cover Letter + Interview + Career Coach run in parallel.
 * Company Intelligence + Skill Gap already ran inside the V2 pipeline, so we
 * skip them here (they're in the context).
 */
async function runPostOptimizationAgents(result: PipelineResult, jd: JobDescription): Promise<void> {
  const optimized = result.optimizedResume;
  if (!optimized) return;

  const company = result.companyIntelligence?.companyName ?? jd.company ?? "";
  const tasks: Promise<void>[] = [];

  // Cover Letter Agent
  tasks.push(runCoverLetterAgent(optimized, jd, company));

  // Interview Agent
  tasks.push(runInterviewAgent(optimized, jd, company, result.companyIntelligence, result.skillGap));

  // Career Coach Agent
  tasks.push(runCareerCoachAgent(optimized, jd, result.jobIntelligence?.industry ?? "Generic"));

  // Run all in parallel — each is non-fatal
  await Promise.allSettled(tasks);
}

// ============================================================================
// Post-optimization agents (lightweight wrappers around callAI)
// ============================================================================

async function runCoverLetterAgent(resume: ResumeData, jd: JobDescription, company: string): Promise<void> {
  const agentId: AgentId = "cover-letter";
  updateAgent(agentId, { status: "running", startedAt: new Date().toISOString(), log: "Generating cover letter…" });
  try {
    const cacheK = cacheKey("cover-letter", resume.id, jd.id);
    const cached = getCached<string>(cacheK);
    if (cached) {
      updateContext({ coverLetter: cached });
      updateAgent(agentId, { status: "completed", completedAt: new Date().toISOString(), log: "Cover letter served from cache.", cached: true });
      return;
    }

    const result = await withRetry(() => callAI({
      systemPrompt: "You are an expert cover letter writer. Write a personalized, recruiter-grade cover letter (~400 words) that aligns the candidate's experience with the company's values and the job's requirements. Plain text only.",
      userPrompt: `CANDIDATE: ${resume.name}, ${resume.headline ?? ""}
EXPERIENCE: ${resume.experience.map((e) => `${e.title} at ${e.company}`).join(", ")}
SKILLS: ${resume.skills.map((s) => s.name).join(", ")}

JOB: ${jd.title ?? "Role"} at ${company || "the company"}
JD SUMMARY: ${jd.rawText?.slice(0, 1000) ?? jd.keywords.join(", ")}

Write the cover letter now. Address it to the hiring team. Be specific to ${company || "the company"} — reference the company's values and the job's requirements.`,
      maxTokens: 1000,
      taskCategory: "document",
    }), 1, "cover-letter");

    updateContext({ coverLetter: result.text });
    setCached(cacheK, result.text);
    updateAgent(agentId, { status: "completed", completedAt: new Date().toISOString(), log: `Cover letter generated (${result.text.length} chars) via ${result.provider}.` });
  } catch (e: any) {
    updateAgent(agentId, { status: "failed", error: e?.message ?? "Cover letter failed", log: `⚠ ${e?.message}` });
  }
}

async function runInterviewAgent(
  resume: ResumeData,
  jd: JobDescription,
  company: string,
  companyIntel: any,
  skillGap: any,
): Promise<void> {
  const agentId: AgentId = "interview";
  updateAgent(agentId, { status: "running", startedAt: new Date().toISOString(), log: "Generating interview package…" });
  try {
    const cacheK = cacheKey("interview", resume.id, jd.id);
    const cached = getCached<any>(cacheK);
    if (cached) {
      updateContext({ interviewPackage: cached });
      updateAgent(agentId, { status: "completed", completedAt: new Date().toISOString(), log: "Interview package served from cache.", cached: true });
      return;
    }

    const result = await withRetry(() => callAI({
      systemPrompt: "You are an expert interview coach. Generate a tailored interview package based on the candidate's resume and the target job. Return ONLY valid JSON.",
      userPrompt: `CANDIDATE RESUME: ${JSON.stringify({ name: resume.name, headline: resume.headline, experience: resume.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets.slice(0, 2) })), skills: resume.skills.map((s) => s.name) })}

JOB: ${jd.title ?? "Role"} at ${company || "the company"}
JD: ${jd.rawText?.slice(0, 1500) ?? jd.keywords.join(", ")}

${companyIntel ? `COMPANY INTELLIGENCE: values=${companyIntel.values?.join(", ")}, valued competencies=${companyIntel.valuedCompetencies?.join(", ")}` : ""}
${skillGap ? `SKILL GAPS (focus questions here): critical=${skillGap.missingSkills?.critical?.join(", ")}` : ""}

Generate 9-12 interview questions (mix of technical, behavioral, situational, company-fit). For each, provide a recommended answer, talking points, and follow-up questions. Also compute a readiness score (0-100), list weak areas, and provide company insights.

Return JSON: { "questions": [{ "category": "...", "question": "...", "difficulty": "easy|medium|hard", "recommendedAnswer": "...", "talkingPoints": ["..."], "followUps": ["..."] }], "readinessScore": <0-100>, "weakAreas": ["..."], "companyInsights": ["..."] }`,
      maxTokens: 3000,
      taskCategory: "document",
    }), 1, "interview");

    let data: any;
    try { data = extractJSON<any>(result.text); }
    catch { data = { questions: [], readinessScore: 0, weakAreas: [], companyInsights: [] }; }

    // Defensive normalization
    const toArray = (v: any): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    const toNum = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };
    const normalized = {
      questions: Array.isArray(data.questions) ? data.questions.map((q: any) => ({
        category: String(q?.category ?? "General"),
        question: String(q?.question ?? ""),
        difficulty: String(q?.difficulty ?? "medium"),
        recommendedAnswer: String(q?.recommendedAnswer ?? ""),
        talkingPoints: toArray(q?.talkingPoints),
        followUps: toArray(q?.followUps),
      })) : [],
      readinessScore: toNum(data.readinessScore),
      weakAreas: toArray(data.weakAreas),
      companyInsights: toArray(data.companyInsights),
    };

    updateContext({ interviewPackage: normalized });
    setCached(cacheK, normalized);
    updateAgent(agentId, { status: "completed", completedAt: new Date().toISOString(), log: `Interview package generated: ${normalized.questions.length} questions, readiness ${normalized.readinessScore}/100.` });
  } catch (e: any) {
    updateAgent(agentId, { status: "failed", error: e?.message ?? "Interview prep failed", log: `⚠ ${e?.message}` });
  }
}

async function runCareerCoachAgent(resume: ResumeData, jd: JobDescription, industry: string): Promise<void> {
  const agentId: AgentId = "career-coach";
  updateAgent(agentId, { status: "running", startedAt: new Date().toISOString(), log: "Generating career recommendations…" });
  try {
    const profile = state.profile;
    const result = await withRetry(() => callAI({
      systemPrompt: "You are an expert career coach. Generate personalized career recommendations based on the candidate's resume, target job, industry, and history. Return ONLY valid JSON.",
      userPrompt: `CANDIDATE: ${resume.name}, ${resume.headline ?? ""}
SKILLS: ${resume.skills.map((s) => s.name).join(", ")}
CERTIFICATIONS: ${resume.certifications.map((c) => c.name).join(", ") || "(none)"}

TARGET JOB: ${jd.title ?? "Role"} at ${jd.company ?? "N/A"}
INDUSTRY: ${industry}

USER PROFILE (from memory):
Target Roles: ${profile.targetRoles.join(", ") || "(none yet)"}
Past Applications: ${profile.applicationHistory.length}
Past Optimizations: ${profile.optimizationHistory.length}

Generate:
1. 3-5 target roles the candidate should consider (based on their skills + history)
2. 3-5 certification recommendations
3. 3-5 learning paths
4. 3 salary recommendations (with min/mid/max in USD)
5. 3-5 next steps

Return JSON: { "targetRoles": ["..."], "certificationRecommendations": ["..."], "learningPaths": ["..."], "salaryRecommendations": [{"role":"...","min":0,"mid":0,"max":0,"currency":"USD"}], "nextSteps": ["..."] }`,
      maxTokens: 2000,
      taskCategory: "document",
    }), 1, "career-coach");

    let data: any;
    try { data = extractJSON<any>(result.text); }
    catch { data = {}; }

    const toArray = (v: any): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    const normalized = {
      targetRoles: toArray(data.targetRoles),
      certificationRecommendations: toArray(data.certificationRecommendations),
      learningPaths: toArray(data.learningPaths),
      salaryRecommendations: Array.isArray(data.salaryRecommendations) ? data.salaryRecommendations.map((s: any) => ({
        role: String(s?.role ?? ""),
        min: Number(s?.min) || 0,
        mid: Number(s?.mid) || 0,
        max: Number(s?.max) || 0,
        currency: String(s?.currency ?? "USD"),
      })) : [],
      nextSteps: toArray(data.nextSteps),
    };

    updateContext({ careerRecommendations: normalized });
    updateAgent(agentId, { status: "completed", completedAt: new Date().toISOString(), log: `Career recommendations generated: ${normalized.targetRoles.length} target roles, ${normalized.certificationRecommendations.length} certs, ${normalized.salaryRecommendations.length} salary ranges.` });
  } catch (e: any) {
    updateAgent(agentId, { status: "failed", error: e?.message ?? "Career coach failed", log: `⚠ ${e?.message}` });
  }
}

// ============================================================================
// Public API: get the current context (for frontend modules to consume)
// ============================================================================

export function getCurrentContext(): GlobalPipelineContext {
  return state.context;
}

export function getCurrentProfile(): UserProfile {
  return state.profile;
}

/**
 * Reset the supervisor state (e.g. on sign-out).
 */
export function resetSupervisor(): void {
  cache.clear();
  state = {
    context: createEmptyContext(),
    profile: loadUserProfile(),
    agents: {} as Record<AgentId, AgentState>,
    events: [],
    isRunning: false,
  };
  for (const def of AGENT_DEFINITIONS) {
    state.agents[def.id] = { id: def.id, name: def.name, icon: def.icon, status: "pending" };
  }
  setState((prev) => prev); // notify listeners
}
