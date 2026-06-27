// ============================================================================
// Memory Architecture — Multi-Level Memory System
//
// Complements existing memory systems:
//   - src/lib/agents/memory-agent.ts (user profile, localStorage)
//   - src/lib/supervisor-memory.ts (shared execution memory)
//   - src/lib/agents/session-memory.ts (round-tracking)
//
// New levels:
//   1. Global System Memory — persistent, non-PII industry patterns
//   2. Job Memory — cached per job with configurable TTL (7-90 days)
//      Key: SHA256(company + normalizedJobTitle + jobDescription)
//   3. Candidate Session Memory — ephemeral, destroyed after optimization
//   4. Supervisor Memory — persists during batch execution
//   5. Agent Working Memory — temporary, destroyed after agent completes
//
// Safety Rules:
//   ✓ May reduce tokens
//   ✓ May improve consistency
//   ✓ May improve retries
//   ✓ May improve orchestration
//   ✗ Must NEVER self-train
//   ✗ Must NEVER mutate prompts
//   ✗ Must NEVER learn from resumes permanently
//   ✗ Must NEVER autonomously change optimization behavior
// ============================================================================

// ============================================================================
// Types
// ============================================================================

/// ---------- Level 1: Global System Memory ----------

export interface IndustryPattern {
  industry: string;
  topKeywords: string[];
  commonPhrases: string[];
  successfulATSStructures: string[];
}

export interface GlobalMemory {
  industryPatterns: IndustryPattern[];
  lastUpdated: number;
}

/// ---------- Level 2: Job Memory ----------

export interface JobMemoryEntry {
  /** SHA256(company + normalizedTitle + jd) */
  key: string;
  company: string;
  title: string;
  industry?: string;
  priorityKeywords: string[];
  requiredSkills: string[];
  preferredSkills: string[];
  companyPriorities: string[];
  strongPhrases: string[];
  atsKeywords: string[];
  semanticPatterns: string[];
  hiringSignals: string[];
  /** Unix timestamp — when this entry expires */
  expiresAt: number;
  createdAt: number;
}

export interface JobMemoryStore {
  entries: Map<string, JobMemoryEntry>;
  defaultTTLDays: number;
}

/// ---------- Level 3: Candidate Session Memory ----------

export interface RetryAttempt {
  attempt: number;
  step: string;
  provider: string;
  error: string;
  durationMs: number;
}

export interface ProviderAttemptLog {
  provider: string;
  model: string;
  step: string;
  success: boolean;
  durationMs: number;
  error?: string;
}

export interface CandidateSessionMemory {
  parsedResumeId?: string;
  qaFindings: string[];
  retryHistory: RetryAttempt[];
  providerAttempts: ProviderAttemptLog[];
  reflectionNotes: string[];
  startedAt: number;
  completedAt?: number;
}

/// ---------- Level 4: Supervisor Memory ----------

export interface QualityMetrics {
  averageScore: number;
  minScore: number;
  maxScore: number;
  totalOptimized: number;
}

export interface SupervisorBatchMemory {
  batchId: string;
  jobContextId?: string;
  processedResumes: string[];
  failedResumes: string[];
  providerFailures: Record<string, number>;
  tokenUsage: number;
  qualityMetrics: QualityMetrics;
  startedAt: number;
}

/// ---------- Level 5: Agent Working Memory ----------

export interface AgentWorkingMemory {
  agentId: string;
  taskId: string;
  findings: string[];
  decisions: string[];
  output?: unknown;
  createdAt: number;
}

// ============================================================================
// In-Memory Stores
// ============================================================================

let globalMemory: GlobalMemory = { industryPatterns: [], lastUpdated: 0 };
const jobMemoryStore: JobMemoryStore = { entries: new Map(), defaultTTLDays: 14 };
let candidateSession: CandidateSessionMemory | null = null;
let supervisorBatch: SupervisorBatchMemory | null = null;
const agentWorkingMemoryMap = new Map<string, AgentWorkingMemory>();

// ============================================================================
// Level 1: Global System Memory
//
// Persistent (in-memory for client-side, could extend to localStorage).
// Stores only non-PII data: industry patterns, keyword trends.
// NEVER stores resumes, PII, names, emails, or phone numbers.
// ============================================================================

export function getGlobalMemory(): GlobalMemory {
  return globalMemory;
}

export function setIndustryPatterns(patterns: IndustryPattern[]): void {
  globalMemory = { industryPatterns: patterns, lastUpdated: Date.now() };
}

export function getIndustryPatterns(industry?: string): IndustryPattern[] {
  if (!industry) return globalMemory.industryPatterns;
  return globalMemory.industryPatterns.filter(
    (p) => p.industry.toLowerCase() === industry.toLowerCase(),
  );
}

// ============================================================================
// Level 2: Job Memory
//
// Caches job intelligence so multiple resumes for the same job
// don't re-analyze the JD. Keyed by SHA256(company + title + jd).
// Configurable TTL: 7-90 days.
// ============================================================================

/** Simple SHA-256 hash for job memory keys (pure JS, no crypto dependency) */
export async function hashJobKey(company: string, title: string, jd: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(`${company.toLowerCase().trim()}|${title.toLowerCase().trim()}|${jd}`);
  const hashBuffer = await crypto.subtle.digest("SHA-256", data);
  const hashArray = Array.from(new Uint8Array(hashBuffer));
  return hashArray.map((b) => b.toString(16).padStart(2, "0")).join("");
}

export function setJobMemoryTTL(days: number): void {
  jobMemoryStore.defaultTTLDays = Math.max(1, Math.min(90, days));
}

export function getJobMemory(key: string): JobMemoryEntry | undefined {
  const entry = jobMemoryStore.entries.get(key);
  if (!entry) return undefined;
  if (Date.now() > entry.expiresAt) {
    jobMemoryStore.entries.delete(key);
    return undefined;
  }
  return entry;
}

export function setJobMemory(
  key: string,
  data: Omit<JobMemoryEntry, "key" | "createdAt" | "expiresAt">,
): void {
  const now = Date.now();
  jobMemoryStore.entries.set(key, {
    ...data,
    key,
    createdAt: now,
    expiresAt: now + jobMemoryStore.defaultTTLDays * 24 * 60 * 60 * 1000,
  });
}

export function clearExpiredJobMemory(): void {
  const now = Date.now();
  for (const [key, entry] of jobMemoryStore.entries) {
    if (now > entry.expiresAt) jobMemoryStore.entries.delete(key);
  }
}

// ============================================================================
// Level 3: Candidate Session Memory
//
// Ephemeral — created at the start of a candidate optimization,
// destroyed when optimization completes (success or failure).
// NEVER persisted between candidates.
// ============================================================================

export function initCandidateSession(): void {
  candidateSession = {
    qaFindings: [],
    retryHistory: [],
    providerAttempts: [],
    reflectionNotes: [],
    startedAt: Date.now(),
  };
}

export function getCandidateSession(): CandidateSessionMemory | null {
  return candidateSession;
}

/** Destroy session data — call after optimization completes. NEVER persist. */
export function destroyCandidateSession(): void {
  candidateSession = null;
}

export function addRetryAttempt(attempt: RetryAttempt): void {
  if (candidateSession) candidateSession.retryHistory.push(attempt);
}

export function addQAFinding(finding: string): void {
  if (candidateSession) candidateSession.qaFindings.push(finding);
}

export function addProviderAttempt(log: ProviderAttemptLog): void {
  if (candidateSession) candidateSession.providerAttempts.push(log);
}

export function addReflectionNote(note: string): void {
  if (candidateSession) candidateSession.reflectionNotes.push(note);
}

// ============================================================================
// Level 4: Supervisor Batch Memory
//
// Persists during a batch of optimization jobs.
// Tracks which resumes succeeded/failed, provider errors, and quality.
// Bridges with src/lib/supervisor-memory.ts for shared execution state.
// ============================================================================

export function initSupervisorBatch(batchId: string): void {
  supervisorBatch = {
    batchId,
    processedResumes: [],
    failedResumes: [],
    providerFailures: {},
    tokenUsage: 0,
    qualityMetrics: { averageScore: 0, minScore: 100, maxScore: 0, totalOptimized: 0 },
    startedAt: Date.now(),
  };
}

export function getSupervisorBatch(): SupervisorBatchMemory | null {
  return supervisorBatch;
}

export function recordResumeSuccess(resumeId: string, score: number): void {
  if (!supervisorBatch) return;
  supervisorBatch.processedResumes.push(resumeId);
  const m = supervisorBatch.qualityMetrics;
  m.totalOptimized++;
  m.averageScore = (m.averageScore * (m.totalOptimized - 1) + score) / m.totalOptimized;
  m.minScore = Math.min(m.minScore, score);
  m.maxScore = Math.max(m.maxScore, score);
}

export function recordResumeFailure(resumeId: string, error: string): void {
  if (!supervisorBatch) return;
  supervisorBatch.failedResumes.push(resumeId);
}

export function recordProviderFailure(provider: string): void {
  if (!supervisorBatch) return;
  supervisorBatch.providerFailures[provider] =
    (supervisorBatch.providerFailures[provider] || 0) + 1;
}

export function addTokenUsage(tokens: number): void {
  if (supervisorBatch) supervisorBatch.tokenUsage += tokens;
}

// ============================================================================
// Level 5: Agent Working Memory
//
// Temporary — created when an agent starts its task, destroyed on completion.
// Prevents cross-agent contamination and tracks per-agent decisions.
// ============================================================================

export function createAgentWorkingMemory(agentId: string, taskId: string): AgentWorkingMemory {
  const mem: AgentWorkingMemory = {
    agentId,
    taskId,
    findings: [],
    decisions: [],
    createdAt: Date.now(),
  };
  agentWorkingMemoryMap.set(`${agentId}:${taskId}`, mem);
  return mem;
}

export function getAgentWorkingMemory(agentId: string, taskId: string): AgentWorkingMemory | undefined {
  return agentWorkingMemoryMap.get(`${agentId}:${taskId}`);
}

export function setAgentOutput(agentId: string, taskId: string, output: unknown): void {
  const key = `${agentId}:${taskId}`;
  const mem = agentWorkingMemoryMap.get(key);
  if (mem) mem.output = output;
}

export function addAgentFinding(agentId: string, taskId: string, finding: string): void {
  const key = `${agentId}:${taskId}`;
  const mem = agentWorkingMemoryMap.get(key);
  if (mem) mem.findings.push(finding);
}

export function destroyAgentWorkingMemory(agentId: string, taskId: string): void {
  agentWorkingMemoryMap.delete(`${agentId}:${taskId}`);
}

// ============================================================================
// Cleanup
// ============================================================================

/** Full reset — use only in tests or when explicitly requested */
export function clearAllMemory(): void {
  globalMemory = { industryPatterns: [], lastUpdated: 0 };
  jobMemoryStore.entries.clear();
  candidateSession = null;
  supervisorBatch = null;
  agentWorkingMemoryMap.clear();
}
