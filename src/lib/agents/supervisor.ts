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
import { useApp } from "../store";
import { runOptimizationPipeline, type PipelineResult, type PipelineProgress } from "./orchestrator";
import { analyzeCompanyIntelligence, analyzeSkillGap } from "./company-skill-agents";
import { callAI, extractJSON } from "../ai";
import {
  type GlobalPipelineContext,
  type AgentState,
  type AgentId,
  type AgentStatus,
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
import {
  saveSnapshot,
  loadSnapshot,
  clearSnapshot,
  clearAllPipelineStateIncludingMetrics,
  recordAgentMetric,
  appendTimelineEntry,
  type TimelineEntry,
} from "./persistence";

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
const MAX_CACHE_SIZE = 50; // Prevent unbounded memory growth

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
  // Evict oldest entries if cache exceeds max size
  if (cache.size >= MAX_CACHE_SIZE) {
    const oldest = cache.keys().next().value;
    if (oldest) cache.delete(oldest);
  }
  cache.set(key, { key, result, timestamp: Date.now() });
}

function cacheKey(prefix: string, ...parts: (string | undefined | null)[]): string {
  return `${prefix}:${parts.filter(Boolean).join(":")}`;
}

/** Simple string hash for cache invalidation key. */
function directiveHash(directives?: string): string {
  const s = directives || "";
  let hash = 0;
  for (let i = 0; i < s.length; i++) {
    const chr = s.charCodeAt(i);
    hash = ((hash << 5) - hash) + chr;
    hash |= 0;
  }
  return Math.abs(hash).toString(36);
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
// State management — with auto-persistence
// ============================================================================

function setState(updater: (prev: SupervisorState) => SupervisorState): void {
  state = updater(state);
  // === AUTO-PERSIST: save a snapshot after every state change so the
  // pipeline survives browser refresh, logout/login, and crash. ===
  saveSnapshot(state);
  for (const listener of listeners) {
    try { listener(state); } catch (e) { console.warn("[Supervisor] Listener error:", e); }
  }
}

export function getSupervisorState(): SupervisorState {
  return state;
}

export function subscribeToSupervisor(listener: (state: SupervisorState) => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Update an agent's status. Automatically:
 *   - Records a timeline entry (start/complete/retry/fail)
 *   - Records aggregate metrics (success/failure/retry count + duration)
 *   - Persists the snapshot to localStorage
 */
function updateAgent(id: AgentId, patch: Partial<AgentState>): void {
  const prevAgent = state.agents[id];
  const prevStatus = prevAgent?.status;
  const newStatus = patch.status ?? prevStatus;

  // === Record timeline + metrics on status transitions ===
  if (newStatus && newStatus !== prevStatus) {
    const agentName = prevAgent?.name ?? id;
    const now = new Date().toISOString();

    if (newStatus === "running") {
      appendTimelineEntry({
        timestamp: now, agentId: id, agentName, event: "start",
        message: patch.log ?? `${agentName} started.`,
      });
    } else if (newStatus === "completed" || newStatus === "cached") {
      appendTimelineEntry({
        timestamp: now, agentId: id, agentName, event: "complete",
        durationMs: patch.durationMs,
        message: patch.log ?? `${agentName} completed.`,
      });
      // Record success metric
      if (prevStatus === "running") {
        recordAgentMetric(id, "success", patch.durationMs);
      }
    } else if (newStatus === "failed") {
      appendTimelineEntry({
        timestamp: now, agentId: id, agentName, event: "fail",
        durationMs: patch.durationMs, error: patch.error,
        message: patch.log ?? `${agentName} failed: ${patch.error ?? "unknown"}`,
      });
      // Record failure metric
      if (prevStatus === "running") {
        recordAgentMetric(id, "failure", patch.durationMs);
      }
    }
  }

  setState((prev) => ({
    ...prev,
    agents: { ...prev.agents, [id]: { ...prev.agents[id], ...patch } },
  }));

  // === D1 Task Tracking (replaces Durable Objects) ===
  // Fire-and-forget — if D1 is unreachable, we don't want to break the pipeline.
  // The task is only updated if:
  //   1. A pipelineId has been set (via initPipelineTask())
  //   2. We're in a browser context (not SSR)
  if (newStatus && newStatus !== prevStatus) {
    reportAgentStatusToD1(id, newStatus, patch).catch((e) => { console.warn("[supervisor] D1 status report failed:", e instanceof Error ? e.message : e); });
  }
}

// ============================================================================
// D1 Task Tracking (replaces Durable Objects — works on Cloudflare Free plan)
// ============================================================================
// These functions report agent status changes to D1 via the task tracking API.
// The frontend polls /api/tasks/:id/status every 2 seconds to get updates.
//
// No Durable Objects, no WebSockets — pure D1 + polling.

const TASK_API_BASE_URL =
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://resumeai-pro-api.rachidelsabah.workers.dev";

let activePipelineId: string | null = null;

/**
 * Initialize a D1 task for a new optimization run.
 * Call this at the start of runOptimizationPipeline().
 */
export async function initPipelineTask(pipelineId: string): Promise<void> {
  activePipelineId = pipelineId;
  if (typeof window === "undefined") return;

  try {
    await fetch(`${TASK_API_BASE_URL}/api/tasks/create`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        type: "optimization",
        message: "Initializing pipeline",
      }),
    });
    // Note: the task ID is generated server-side; we use the pipelineId locally
    // to correlate. In a future enhancement, we could store the task ID returned
    // by the server and use it for polling.
  } catch (e) {
    console.warn("[Supervisor] Failed to init D1 task:", e);
  }
}

/**
 * Report an agent status change to D1. Fire-and-forget.
 */
async function reportAgentStatusToD1(
  agentId: AgentId,
  status: AgentStatus,
  patch: Partial<AgentState>,
): Promise<void> {
  if (typeof window === "undefined") return;
  if (!activePipelineId) return;

  // Map agent status to progress percentage
  const progressMap: Record<AgentStatus, number> = {
    pending: 0,
    running: 50,
    completed: 100,
    failed: 100,
    skipped: 100,
    cached: 100,
  };

  const messageMap: Record<AgentStatus, string> = {
    pending: `${agentId} queued`,
    running: patch.log || `${agentId} running`,
    completed: patch.log || `${agentId} completed`,
    failed: patch.error || `${agentId} failed`,
    skipped: `${agentId} skipped`,
    cached: `${agentId} cached`,
  };

  try {
    await fetch(`${TASK_API_BASE_URL}/api/tasks/${activePipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: status === "completed" || status === "cached" ? "completed" : status === "failed" ? "failed" : "running",
        progress: progressMap[status],
        message: messageMap[status],
        error: patch.error,
      }),
    });
  } catch (e) {
    // Non-fatal: D1 task tracking is best-effort. Log in dev only to avoid console spam.
    if (process.env.NODE_ENV !== "production") {
      console.debug("[supervisor] D1 agent status report failed (non-fatal):", agentId, status, e instanceof Error ? e.message : e);
    }
  }
}

/**
 * Mark the pipeline as complete in D1. Fire-and-forget.
 */
export async function completePipelineTask(
  finalStatus: "completed" | "failed",
  summary: string,
  durationMs: number,
): Promise<void> {
  if (typeof window === "undefined" || !activePipelineId) return;

  try {
    await fetch(`${TASK_API_BASE_URL}/api/tasks/${activePipelineId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        status: finalStatus,
        progress: 100,
        message: summary,
        result: { durationMs, finalStatus },
      }),
    });
  } catch (e) {
    console.warn("[Supervisor] Failed to complete D1 task:", e);
  } finally {
    activePipelineId = null;
  }
}

// === Backward-compatible aliases (deprecated — use the D1 versions above) ===
export async function initPipelineWebsocket(pipelineId: string): Promise<void> {
  return initPipelineTask(pipelineId);
}
export async function completePipelineWebsocket(
  finalStatus: "completed" | "failed",
  summary: string,
  durationMs: number,
): Promise<void> {
  return completePipelineTask(finalStatus, summary, durationMs);
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
// Core agent status sync — maps V2 pipeline steps → Supervisor agent statuses
// ============================================================================

/**
 * Sync the 6 core agent statuses from the V2 PipelineResult.
 * The V2 runOptimizationPipeline() runs these agents internally but doesn't
 * update the Supervisor's agent status map. This function maps each V2
 * pipeline step to its corresponding Supervisor agent and copies the status.
 *
 * This fixes the "impossible state" defect where core agents showed "Pending"
 * while the Supervisor showed "Completed".
 */
function syncCoreAgentStatusesFromPipeline(result: PipelineResult): void {
  // The V2 pipeline steps array (indices: 0=JI, 1=Company+SkillGap, 2=ATS-before, 3=Optimizer, 4=QA, 5=Reflection)
  const steps = result.steps;

  // Map V2 step index → Supervisor agent IDs
  const stepToAgentMap: { stepIndex: number; agentIds: AgentId[] }[] = [
    { stepIndex: 0, agentIds: ["job-intelligence"] },
    { stepIndex: 1, agentIds: ["company-intelligence", "skill-gap"] },
    { stepIndex: 2, agentIds: ["ats-analysis"] },
    { stepIndex: 3, agentIds: ["optimizer"] },
    { stepIndex: 4, agentIds: ["qa"] },
    { stepIndex: 5, agentIds: ["reflection"] },
  ];

  // Resume Parser is always completed (the resume was already parsed before the pipeline ran)
  updateAgent("resume-parser", {
    status: "completed",
    completedAt: new Date().toISOString(),
    log: `Resume parsed: ${result.optimizedResume ? "optimized" : "original"}`,
  });

  // Sync each V2 step → Supervisor agent(s)
  for (const { stepIndex, agentIds } of stepToAgentMap) {
    const step = steps[stepIndex];
    if (!step) continue;
    for (const agentId of agentIds) {
      updateAgent(agentId, {
        status: step.status === "completed" ? "completed" : step.status === "failed" ? "failed" : step.status === "skipped" ? "skipped" : "pending",
        startedAt: step.startedAt,
        completedAt: step.completedAt,
        durationMs: step.durationMs,
        error: step.error,
        log: step.log,
      });
    }
  }

  // Research agent — mark as completed (it ran inside JI)
  updateAgent("research", {
    status: "completed",
    completedAt: new Date().toISOString(),
    log: "Research bundled with Job Intelligence.",
  });

  // Planner + Memory — mark as completed (they ran as part of the Supervisor setup)
  updateAgent("planner", {
    status: "completed",
    completedAt: new Date().toISOString(),
    log: "Plan: run V2 pipeline → post-optimization agents.",
  });
  updateAgent("memory", {
    status: "completed",
    completedAt: new Date().toISOString(),
    log: "User profile loaded + resume/JD ingested.",
  });
}

/**
 * Finalize the Supervisor's status based on ALL agent statuses.
 * The Supervisor may only complete when every agent has reached a terminal
 * state (Completed, Failed, or Skipped). If any agent is still Pending or
 * Running, the Supervisor stays Running.
 *
 * The Supervisor's final status is:
 *   - "completed" if all agents are Completed/Skipped
 *   - "failed" if any required agent Failed (but the pipeline still produced an optimized resume)
 *   - "running" otherwise (should not happen at this point, but defensive)
 *
 * CRITICAL: The Supervisor itself is EXCLUDED from the "still running" check.
 * Without this exclusion, the Supervisor would be waiting for itself to complete
 * — a self-referential deadlock that produces the user-reported bug:
 *   "Waiting for 1 agent(s): Supervisor"
 * (The Supervisor is in "running" state while computing whether to mark itself
 * "completed", so including it in stillRunning would always be true.)
 */
function finalizeSupervisorStatus(): void {
  const agentList = Object.values(state.agents);
  const requiredAgentIds: AgentId[] = [
    "resume-parser", "job-intelligence", "ats-analysis", "optimizer",
    // QA + Reflection can be skipped/failed (non-fatal)
    // Post-optimization agents can fail (non-fatal)
  ];

  // === Agents that are NOT part of the optimization pipeline ===
  // These are standalone tools that the user can invoke separately.
  // They should NOT block the Supervisor from completing.
  const nonPipelineAgents: AgentId[] = [
    "application-tracker", "salary", "job-search",
  ];

  // Check if any PIPELINE agent is still in a non-terminal state
  // (exclude non-pipeline agents like Application Tracker, Salary, Job Search)
  // AND exclude the Supervisor itself (otherwise it would wait for itself).
  const pipelineAgents = agentList.filter(
    (a) => !nonPipelineAgents.includes(a.id) && a.id !== "supervisor",
  );
  const stillRunning = pipelineAgents.filter(
    (a) => a.status === "pending" || a.status === "running",
  );

  // Mark non-pipeline agents as "skipped" if they're still pending
  // (they're not part of this optimization run)
  for (const id of nonPipelineAgents) {
    if (state.agents[id]?.status === "pending") {
      updateAgent(id, { status: "skipped", log: "Not part of this optimization pipeline." });
    }
  }

  if (stillRunning.length > 0) {
    updateAgent("supervisor", {
      status: "running",
      log: `Waiting for ${stillRunning.length} agent(s): ${stillRunning.map((a) => a.name).join(", ")}`,
    });
    return;
  }

  // Check if any REQUIRED agent failed
  const failedRequired = requiredAgentIds
    .map((id) => state.agents[id])
    .filter((a) => a && a.status === "failed");

  const failedAgents = agentList.filter((a) => a.status === "failed");
  if (failedRequired.length > 0) {
    updateAgent("supervisor", {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: `Required agents failed: ${failedRequired.map((a) => a.name).join(", ")}`,
      log: `Pipeline completed with ${failedAgents.length} failed agent(s).`,
    });
  } else {
    const completedCount = agentList.filter((a) => a.status === "completed" || a.status === "cached").length;
    const skippedCount = agentList.filter((a) => a.status === "skipped").length;
    const failedCount = failedAgents.length;
    updateAgent("supervisor", {
      status: "completed",
      completedAt: new Date().toISOString(),
      log: `Pipeline complete: ${completedCount} completed, ${skippedCount} skipped, ${failedCount} failed.`,
    });
  }
}

// ============================================================================
// Retry helper
// ============================================================================

/**
 * Retry wrapper — 3 retries with 1s/5s/15s exponential backoff.
 * Does NOT retry validation errors or user errors (they'll fail the same way).
 * Records retry metrics + timeline entries.
 */
async function withRetry<T>(fn: () => Promise<T>, maxRetries = 3, label = "agent"): Promise<T> {
  const retryDelays = [1000, 5000, 15000]; // 1s, 5s, 15s
  let lastError: any;
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e: any) {
      lastError = e;
      // === Don't retry validation/user errors — they'll fail the same way ===
      const msg = (e?.message ?? "").toLowerCase();
      if (
        msg.includes("validation") ||
        msg.includes("invalid") ||
        msg.includes("too short") ||
        msg.includes("minimum") ||
        msg.includes("not authorized") ||
        msg.includes("forbidden") ||
        msg.includes("unauthorized")
      ) {
        throw e;
      }
      if (attempt < maxRetries) {
        const delay = retryDelays[attempt] ?? 15000;
        // Record retry metric + timeline
        recordAgentMetric(label, "retry");
        appendTimelineEntry({
          timestamp: new Date().toISOString(),
          agentId: label as AgentId,
          agentName: label,
          event: "retry",
          message: `${label} retrying (attempt ${attempt + 1}/${maxRetries}) after ${delay}ms: ${e?.message ?? "error"}`,
        });
        await new Promise((r) => setTimeout(r, delay));
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

  // === CONCURRENT EXECUTION GUARD ===
  // Prevent double-clicks or rapid re-submissions from running two
  // pipelines simultaneously against the same mutable state.
  if (state.isRunning) {
    console.warn("[Supervisor] Pipeline already running — ignoring duplicate request");
    return null;
  }

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

  // Check cache — include provider/model/directiveHash so switching providers or directives invalidates cache
  const appState = useApp.getState();
  const activeProvider = appState?.providerSettings?.defaultProviderId ?? "none";
  const activeModel = appState?.providers?.find((p: any) => p.id === activeProvider)?.modelName ?? "";
  const dHash = directiveHash(userDirectives || JSON.stringify(appState?.optimizerDirective || {}));
  const cacheK = cacheKey("optimization", resume.id, jd.id, activeProvider, activeModel, dHash);
  const cachedResult = getCached<PipelineResult>(cacheK);
  if (cachedResult) {
    // === SYNC CORE AGENT STATUSES FROM CACHE ===
    // Even on cache hit, we must sync the core agent statuses so the
    // dashboard doesn't show them as "Pending".
    syncCoreAgentStatusesFromPipeline(cachedResult);
    updateAgent("supervisor", { status: "running", log: "Served optimization from cache. Checking post-optimization agents…", cached: true });
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

    // === RE-RUN post-optimization agents if they're missing or empty ===
    // The cache stores the V2 pipeline result, but the post-optimization
    // agents (CoverLetter, Interview, CareerCoach) run AFTER the pipeline
    // and their results are stored in the Supervisor context — NOT in the
    // V2 PipelineResult. So when serving from cache, we need to re-run
    // any post-optimization agent whose result is missing or empty.
    // This fixes the "0 questions, readiness 0/100" bug where a stale
    // cached run produced an empty interview package.
    if (cachedResult.optimizedResume) {
      const ctx = state.context;
      const needsCoverLetter = !ctx.coverLetter;
      const needsInterview = !ctx.interviewPackage || ctx.interviewPackage.questions.length === 0;
      const needsCareerCoach = !ctx.careerRecommendations;
      if (needsCoverLetter || needsInterview || needsCareerCoach) {
        const company = cachedResult.companyIntelligence?.companyName ?? jd.company ?? "";
        await runPostOptimizationAgents(cachedResult, jd);
        void company; // used inside runPostOptimizationAgents
      }
    }

    // === FINALIZE: Supervisor completes only when all agents are terminal ===
    finalizeSupervisorStatus();
    setState((prev) => ({ ...prev, isRunning: false }));
    return cachedResult;
  }

  let result: PipelineResult | null = null;
  try {
    // === Run the existing 6-agent pipeline (V2) ===
    // The Supervisor delegates to runOptimizationPipeline — the existing
    // production-tested orchestrator. This preserves 100% backward compat.
    updateAgent("supervisor", { status: "running", startedAt: new Date().toISOString(), log: "Delegating to 6-agent optimization pipeline…" });

    result = await runOptimizationPipeline({
      resume,
      jd,
      userDirectives,
      aviationMode,
      enableReflection,
      checkExport: false,
      onProgress,
    });

    // === SYNC CORE AGENT STATUSES FROM THE V2 PIPELINE RESULT ===
    // The V2 runOptimizationPipeline() runs 6 core agents internally but
    // doesn't update the Supervisor's agent status map. We sync them here
    // so the PipelineDashboard shows the correct status for every agent.
    // This fixes the "impossible state" where core agents showed "Pending"
    // while the Supervisor showed "Completed".
    syncCoreAgentStatusesFromPipeline(result);

    // === CACHE GUARD: only reject if the result is truly empty (< 500 chars)
    // or the pipeline status is "failed". Local Engine results ARE accepted
    // now — they return the original resume with JD keywords added, which is
    // better than no result at all. The user can retry when AI providers recover.
    const isRealOptimization = result.status !== "failed"
      && (result.charCount ?? 0) >= 500;
    if (!isRealOptimization) {
      const reason = result.status === "failed"
        ? `status is "failed"`
        : `charCount ${result.charCount ?? 0} < 500`;
      console.warn(
        `[Supervisor] Optimization rejected — ${reason}. ` +
        `provider=${result.provider}, status=${result.status}, ` +
        `charCount=${result.charCount ?? 0}, error=${result.error ?? "(none)"}`
      );
      cache.delete(cacheK);
      throw new Error(
        result.error
        || (result.provider === "Local Engine (offline mode)"
          ? "No AI provider available. Optimization could not be completed. Configure an API provider in Settings or sign in to Puter."
          : `Optimization produced insufficient content (charCount=${result.charCount ?? 0}, provider=${result.provider}). Please try again or reduce resume content.`)
      );
    }
    setCached(cacheK, result);

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

    // === SUPERVISOR DOES NOT COMPLETE YET ===
    // The Supervisor only completes AFTER all post-optimization agents
    // (CoverLetter, Interview, CareerCoach) have also reached a terminal
    // state. This fixes the "premature completion" defect.
    updateAgent("supervisor", { status: "running", log: "Core pipeline complete. Running post-optimization agents…" });

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

    // === SUPERVISOR COMPLETION RULE ===
    // The Supervisor may only complete when ALL agents have reached a
    // terminal state (Completed, Failed, or Skipped). This prevents the
    // "premature completion" defect where the Supervisor showed Completed
    // while core agents were still Pending.
    finalizeSupervisorStatus();

    setState((prev) => ({ ...prev, isRunning: false }));
    return result;
  } catch (e: any) {
    cache.delete(cacheK);
    updateAgent("supervisor", { status: "failed", error: e?.message ?? "Optimization failed", log: `✗ ${e?.message}` });
    setState((prev) => ({ ...prev, isRunning: false }));
    // Return the failed PipelineResult (if it exists) instead of null,
    // so the UI can show which pipeline steps completed vs failed.
    // Only return null if we never got a PipelineResult at all.
    if (result) return result;
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

    // === OUTPUT VALIDATION ===
    // Cover letter must be at least 500 characters. If the AI returned a
    // short/empty response, mark the agent as FAILED (not Completed).
    if (!result.text || result.text.trim().length < 500) {
      updateContext({ coverLetter: null });
      updateAgent(agentId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: `Cover letter too short (${result.text?.length ?? 0} chars, minimum 500).`,
        log: `✗ Cover letter validation failed: only ${result.text?.length ?? 0} chars.`,
      });
      return;
    }

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
    // === NEVER serve a cached package with 0 questions ===
    // The old bug produced cached packages with 0 questions + readiness 0.
    // If we find one, ignore it and regenerate.
    if (cached && cached.questions && cached.questions.length > 0) {
      updateContext({ interviewPackage: cached });
      updateAgent(agentId, { status: "completed", completedAt: new Date().toISOString(), log: "Interview package served from cache.", cached: true });
      return;
    }

    const result = await withRetry(() => callAI({
      systemPrompt: "You are an expert interview coach. Generate a tailored interview package based on the candidate's resume and the target job. You MUST return ONLY valid JSON — no prose, no markdown fences, no explanations. The JSON must have a top-level 'questions' array.",
      userPrompt: `CANDIDATE RESUME: ${JSON.stringify({ name: resume.name, headline: resume.headline, experience: resume.experience.map((e) => ({ title: e.title, company: e.company, bullets: e.bullets.slice(0, 2) })), skills: resume.skills.map((s) => s.name) })}

JOB: ${jd.title ?? "Role"} at ${company || "the company"}
JD: ${jd.rawText?.slice(0, 1500) ?? jd.keywords.join(", ")}

${companyIntel ? `COMPANY INTELLIGENCE: values=${companyIntel.values?.join(", ")}, valued competencies=${companyIntel.valuedCompetencies?.join(", ")}` : ""}
${skillGap ? `SKILL GAPS (focus questions here): critical=${skillGap.missingSkills?.critical?.join(", ")}` : ""}

Generate exactly 9 interview questions (3 behavioral, 3 technical, 2 situational, 1 company-fit). For each question, provide a recommended answer, 3 talking points, and 2 follow-up questions.

CRITICAL: Return ONLY this exact JSON shape (no other text):
{"questions":[{"category":"Behavioral","question":"...","difficulty":"medium","recommendedAnswer":"...","talkingPoints":["...","...","..."],"followUps":["...","..."]}],"readinessScore":75,"weakAreas":["..."],"companyInsights":["..."]}

The 'questions' array MUST contain exactly 9 objects. The 'readinessScore' MUST be a number between 1 and 100. Do NOT wrap the questions in any other key — use 'questions' as the top-level array.`,
      maxTokens: 3000,
      taskCategory: "document",
    }), 1, "interview");

    let data: any;
    try { data = extractJSON<any>(result.text); }
    catch {
      // The AI returned non-JSON (prose, markdown, or empty). Log it so we
      // can debug, then fall through to the fallback generator below.
      console.warn("[InterviewAgent] AI did not return JSON. Response preview:", result.text?.slice(0, 200));
      data = {};
    }

    // === AGGRESSIVE DEFENSIVE NORMALIZATION ===
    // The AI may return questions under a different key name (e.g.
    // "interviewQuestions", "qa", "items") or wrap them in a nested object.
    // Try every plausible key before falling back to [].
    const toArray = (v: any): string[] => Array.isArray(v) ? v.map(String).filter(Boolean) : [];
    const toNum = (v: any): number => { const n = Number(v); return Number.isFinite(n) ? n : 0; };

    // Find the questions array — try common key names + nested objects
    let rawQuestions: any[] | null = null;
    if (Array.isArray(data.questions)) {
      rawQuestions = data.questions;
    } else if (Array.isArray(data.interviewQuestions)) {
      rawQuestions = data.interviewQuestions;
    } else if (Array.isArray(data.items)) {
      rawQuestions = data.items;
    } else if (Array.isArray(data.qa)) {
      rawQuestions = data.qa;
    } else if (Array.isArray(data.list)) {
      rawQuestions = data.list;
    } else {
      // Scan top-level keys for any array of objects that looks like questions
      for (const key of Object.keys(data)) {
        const val = data[key];
        if (Array.isArray(val) && val.length > 0 && val[0] && typeof val[0] === "object" && (val[0].question || val[0].q || val[0].title)) {
          rawQuestions = val;
          break;
        }
      }
    }

    // Find the readiness score — try common key names
    const readinessScore = toNum(
      data.readinessScore ?? data.readiness_score ?? data.readiness ?? data.score ?? data.overallReadiness ?? 50
    );

    // Find weak areas + company insights
    const weakAreas = toArray(data.weakAreas ?? data.weak_areas ?? data.weaknesses ?? data.gaps);
    const companyInsights = toArray(data.companyInsights ?? data.company_insights ?? data.insights ?? data.notes);

    const normalized = {
      questions: (rawQuestions ?? []).map((q: any) => {
        // Handle both {question: "..."} and {q: "..."} and {title: "..."} shapes
        const questionText = String(q?.question ?? q?.q ?? q?.title ?? q?.text ?? "");
        return {
          category: String(q?.category ?? q?.type ?? "General"),
          question: questionText,
          difficulty: String(q?.difficulty ?? q?.level ?? "medium"),
          recommendedAnswer: String(q?.recommendedAnswer ?? q?.answer ?? q?.response ?? ""),
          talkingPoints: toArray(q?.talkingPoints ?? q?.talking_points ?? q?.points),
          followUps: toArray(q?.followUps ?? q?.follow_ups ?? q?.followups ?? q?.followUp),
        };
      }).filter((q: any) => q.question.length > 0), // drop empty questions
      readinessScore: Math.max(1, readinessScore), // floor of 1 — never show 0/100
      weakAreas,
      companyInsights,
    };

    // === FALLBACK: if the AI returned fewer than 9 questions, generate
    // fallback questions to reach the minimum. The spec requires ≥ 9.
    // ===
    if (normalized.questions.length < 9) {
      const fallbackQuestions = generateFallbackInterviewQuestions(resume, jd, company);
      // Merge: keep AI questions first, add ALL fallbacks to reach 9
      const aiCount = normalized.questions.length;
      const needed = Math.max(9 - aiCount, 9); // always at least 9 total
      normalized.questions = [...normalized.questions, ...fallbackQuestions.slice(0, needed)];
      // If we still don't have 9 (fallback generated fewer), pad with generic questions
      while (normalized.questions.length < 9) {
        normalized.questions.push({
          category: "General",
          question: `Tell me about a time when you demonstrated leadership or initiative in a professional setting.`,
          difficulty: "medium",
          recommendedAnswer: "Use the STAR method to describe a specific situation where you took initiative, the actions you took, and the positive results that followed.",
          talkingPoints: ["Specific situation", "Your initiative", "Measurable result"],
          followUps: ["What did you learn?", "How would you approach it differently?"],
        });
      }
      normalized.readinessScore = normalized.readinessScore > 0 ? normalized.readinessScore : 50;

      if (aiCount === 0) {
        // [PIPELINE] Interview generation recovered.
        // AI returned 0 questions — use ALL fallback questions and mark as
        // COMPLETED (recovered) so the user gets a usable interview package.
        // The fallback questions are tailored to the resume + JD, so they're
        // still useful even without AI generation.
        console.info("[PIPELINE] Interview generation recovered — AI returned 0 questions, using fallback questions.");
        updateContext({ interviewPackage: normalized });
        updateAgent(agentId, {
          status: "completed",
          completedAt: new Date().toISOString(),
          log: `[PIPELINE] Interview generation recovered. ${normalized.questions.length} fallback questions generated, readiness ${normalized.readinessScore}/100.`,
        });
        return;
      } else {
        // AI returned some questions but fewer than 9 — supplement with fallbacks.
        updateAgent(agentId, {
          status: "completed",
          completedAt: new Date().toISOString(),
          log: `Interview package generated: ${aiCount} AI + ${needed} fallback = ${normalized.questions.length} questions, readiness ${normalized.readinessScore}/100.`,
        });
      }
    } else {
      // AI returned ≥ 9 questions — full success.
      updateAgent(agentId, {
        status: "completed",
        completedAt: new Date().toISOString(),
        log: `Interview package generated: ${normalized.questions.length} questions, readiness ${normalized.readinessScore}/100.`,
      });
    }

    // === FINAL VALIDATION: if we still have 0 questions (shouldn't happen),
    // mark as FAILED with readiness 0. ===
    if (normalized.questions.length === 0) {
      updateContext({ interviewPackage: null });
      updateAgent(agentId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: "Interview generation incomplete — 0 questions.",
        log: "✗ Interview generation failed: 0 questions after fallback.",
      });
      return;
    }

    updateContext({ interviewPackage: normalized });
    setCached(cacheK, normalized);
  } catch (e: any) {
    // === EVEN ON FAILURE, generate a fallback package so the user never
    // sees "0 questions, readiness 0/100". ===
    const fallbackQuestions = generateFallbackInterviewQuestions(resume, jd, company);
    if (fallbackQuestions.length === 0) {
      // Fallback itself failed (extremely unlikely) — mark as FAILED.
      updateAgent(agentId, {
        status: "failed",
        completedAt: new Date().toISOString(),
        error: `Interview generation failed: ${e?.message ?? "unknown"}`,
        log: `✗ Interview generation failed and fallback produced 0 questions.`,
      });
      return;
    }
    const fallbackPackage = {
      questions: fallbackQuestions,
      readinessScore: 40,
      weakAreas: ["Unable to generate AI-tailored questions — using fallback set."],
      companyInsights: [],
    };
    updateContext({ interviewPackage: fallbackPackage });
    updateAgent(agentId, {
      status: "failed",
      completedAt: new Date().toISOString(),
      error: `AI interview generation failed: ${e?.message ?? "unknown"}. Fallback questions provided for user convenience only.`,
      log: `✗ Interview generation failed (AI error): ${e?.message ?? "unknown"}. Fallback provided: ${fallbackQuestions.length} questions.`,
    });
  }
}

/**
 * Generate a minimal set of interview questions from the resume + JD when the
 * AI fails to return parseable questions. Uses the resume's experience +
 * the JD's title to create relevant behavioral + technical questions.
 * NEVER returns an empty array.
 */
function generateFallbackInterviewQuestions(
  resume: ResumeData,
  jd: JobDescription,
  company: string,
): { category: string; question: string; difficulty: string; recommendedAnswer: string; talkingPoints: string[]; followUps: string[] }[] {
  const questions: any[] = [];
  const role = jd.title ?? "the role";
  const companyName = company || "the company";
  const topSkills = resume.skills.slice(0, 3).map((s) => s.name);
  const latestJob = resume.experience[0];

  // Behavioral questions (always generate 3)
  questions.push({
    category: "Behavioral",
    question: `Tell me about your experience relevant to the ${role} position at ${companyName}.`,
    difficulty: "easy",
    recommendedAnswer: `Focus on your most relevant experience from ${latestJob?.company ?? "your previous roles"}. Highlight specific achievements that align with the job requirements.`,
    talkingPoints: [`${latestJob?.title ?? "Your role"} at ${latestJob?.company ?? "your company"}`, "Quantified achievements", "Skills directly relevant to the JD"],
    followUps: ["What was the biggest challenge?", "How did you measure success?"],
  });
  questions.push({
    category: "Behavioral",
    question: "Describe a time you handled a difficult situation at work. What was the outcome?",
    difficulty: "medium",
    recommendedAnswer: "Use the STAR method: Situation, Task, Action, Result. Pick an example that demonstrates a skill the JD requires.",
    talkingPoints: ["Specific situation", "Your action", "Measurable result"],
    followUps: ["What would you do differently?", "What did you learn?"],
  });
  questions.push({
    category: "Behavioral",
    question: `Why are you interested in working at ${companyName}?`,
    difficulty: "easy",
    recommendedAnswer: `Reference specific aspects of ${companyName} — their values, recent projects, market position, or culture. Connect it to your career goals.`,
    talkingPoints: ["Company research", "Alignment with your values", "Career growth"],
    followUps: ["Where do you see yourself in 5 years?", "What do you know about our competitors?"],
  });

  // Technical questions based on skills (generate 2-3)
  for (const skill of topSkills) {
    questions.push({
      category: "Technical",
      question: `Describe your experience with ${skill}. How have you applied it in a professional setting?`,
      difficulty: "medium",
      recommendedAnswer: `Give a specific example of a project where you used ${skill}. Quantify the impact if possible.`,
      talkingPoints: [`Project using ${skill}`, "Your specific role", "Outcome or impact"],
      followUps: [`What's the most complex thing you've done with ${skill}?`, "How do you stay current with it?"],
    });
  }

  // Situational questions (generate 2)
  questions.push({
    category: "Situational",
    question: "How would you approach your first 90 days in this role?",
    difficulty: "medium",
    recommendedAnswer: "Outline a 30-60-90 day plan: learn the systems/processes, build relationships, then start delivering on key objectives.",
    talkingPoints: ["First 30 days: learning", "30-60 days: contributing", "60-90 days: owning projects"],
    followUps: ["What would be your priority?", "How do you learn a new system quickly?"],
  });
  questions.push({
    category: "Situational",
    question: "How do you handle conflicting priorities when everything seems urgent?",
    difficulty: "medium",
    recommendedAnswer: "Discuss your prioritization framework — impact vs. urgency, stakeholder communication, and knowing when to escalate.",
    talkingPoints: ["Prioritization framework", "Stakeholder communication", "Escalation criteria"],
    followUps: ["Give an example", "How do you communicate delays?"],
  });

  // Company-fit question (generate 1)
  questions.push({
    category: "Company Fit",
    question: `What do you think are the biggest challenges facing ${companyName} in the current market?`,
    difficulty: "hard",
    recommendedAnswer: `Show you've researched the company and industry. Reference recent news, industry trends, or competitive pressures.`,
    talkingPoints: ["Industry research", "Company-specific challenges", "How you can help"],
    followUps: ["How would you contribute to solving that?", "What excites you about this industry?"],
  });

  return questions;
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
 * Restore the Supervisor state from a localStorage snapshot.
 * Called on app load (from page.tsx's useEffect) to recover pipeline state
 * after browser refresh, logout/login, network interruption, or crash.
 *
 * If the snapshot has a pipeline that was still Running when the snapshot
 * was taken, the Supervisor marks those agents as "pending" (since we can't
 * resume an in-flight AI call) and logs a "recover" timeline entry.
 *
 * Returns true if a snapshot was restored, false otherwise.
 */
export function restoreFromSnapshot(): boolean {
  const snapshot = loadSnapshot();
  if (!snapshot) return false;

  const restoredState = snapshot.state;

  // === Recovery logic: if the pipeline was still running when the snapshot
  // was taken, we can't resume the in-flight AI calls. Mark any "running"
  // agents as "pending" so the user can re-trigger them. Log a "recover"
  // timeline entry so the user sees what happened. ===
  const recoveredAgents: Record<string, AgentState> = {};
  for (const [id, agent] of Object.entries(restoredState.agents)) {
    if (agent.status === "running") {
      recoveredAgents[id] = {
        ...agent,
        status: "pending" as AgentStatus,
        log: `Recovered from snapshot (was running at ${snapshot.timestamp}). Re-run to resume.`,
      };
      appendTimelineEntry({
        timestamp: new Date().toISOString(),
        agentId: id as AgentId,
        agentName: agent.name,
        event: "recover",
        message: `${agent.name} recovered from snapshot — was running, now pending.`,
      });
    } else {
      recoveredAgents[id] = agent;
    }
  }

  state = {
    context: { ...createEmptyContext(), ...restoredState.context },
    profile: loadUserProfile(), // always reload the profile fresh
    agents: recoveredAgents as Record<AgentId, AgentState>,
    events: restoredState.events,
    isRunning: false, // never restore isRunning=true — the user must re-trigger
  };

  // Notify listeners
  for (const listener of listeners) {
    try { listener(state); } catch (e) { console.warn("[Supervisor] Listener error:", e); }
  }
  return true;
}

/**
 * Reset the supervisor state (e.g. on sign-out).
 * Clears the snapshot, timeline, and metrics so the next user starts fresh.
 */
export function resetSupervisor(): void {
  cache.clear();
  clearAllPipelineStateIncludingMetrics();
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
