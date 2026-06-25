// ============================================================================
// GlobalPipelineContext — the shared state object for the Unified AI Career
// Operating System (V3).
//
// All agents in the system consume and/or produce fields on this context.
// The Supervisor Agent owns the context and passes it to each agent as needed.
//
// Persistence:
//   - The context is persisted to localStorage (`resumeai-pipeline-context`)
//     so it survives refresh / logout / login cycles.
//   - The MemoryAgent also reads/writes a user-profile slice of this context.
//
// Cloudflare compatibility:
//   - No server-side state — the context lives in the browser (Zustand store
//     + localStorage). The Supervisor coordinates agents client-side.
//   - Vector search (Vectorize) is a future enhancement; for now we use
//     keyword-based matching which is sufficient for the Free tier.
// ============================================================================

import type { ResumeData, JobDescription } from "../types";
import type { JobIntelligence } from "../job-intelligence";
import type { ATSAnalysisResult } from "./ats-analysis";
import type { QAResult } from "./qa-agent";
import type { ReflectionResult } from "./orchestrator";
import type { CompanyIntelligence, SkillGapIntelligence } from "./company-skill-agents";

// ============================================================================
// Context shape
// ============================================================================

export interface GlobalPipelineContext {
  // === Identifiers ===
  userId: string | null;
  resumeId: string | null;
  jobId: string | null;
  optimizationId: string | null; // ties together a single optimization run

  // === Source data ===
  originalResume: ResumeData | null;
  optimizedResume: ResumeData | null;
  jobDescription: JobDescription | null;
  jobUrl: string | null;
  companyName: string | null;
  jobTitle: string | null;
  industry: string | null;

  // === Pipeline intelligence (produced by agents) ===
  jobIntelligence: JobIntelligence | null;
  companyIntelligence: CompanyIntelligence | null;
  skillGap: SkillGapIntelligence | null;
  beforeATS: ATSAnalysisResult | null;
  afterATS: ATSAnalysisResult | null;
  qa: QAResult | null;
  reflection: ReflectionResult | null;

  // === Career services intelligence (produced by post-optimization agents) ===
  coverLetter: string | null;
  interviewPackage: InterviewPackage | null;
  careerRecommendations: CareerRecommendations | null;

  // === Scores (denormalized for quick UI access) ===
  atsScore: number | null;
  matchScore: number | null;
  keywords: string[];
  missingSkills: string[];

  // === Metadata ===
  createdAt: string;
  updatedAt: string;
}

export interface InterviewPackage {
  questions: { category: string; question: string; difficulty: string; recommendedAnswer: string; talkingPoints: string[]; followUps: string[] }[];
  readinessScore: number; // 0-100
  weakAreas: string[];
  companyInsights: string[];
}

export interface CareerRecommendations {
  targetRoles: string[];
  certificationRecommendations: string[];
  learningPaths: string[];
  salaryRecommendations: { role: string; min: number; mid: number; max: number; currency: string }[];
  nextSteps: string[];
}

// ============================================================================
// Agent status tracking (for the pipeline visualization UI)
// ============================================================================

export type AgentStatus = "pending" | "running" | "completed" | "failed" | "skipped" | "cached";

export interface AgentState {
  /** Agent identifier (matches the agent name in the Supervisor) */
  id: AgentId;
  /** Human-readable name */
  name: string;
  /** Icon name (from the shared Icon component) */
  icon: string;
  /** Current status */
  status: AgentStatus;
  /** When this agent started (ISO string) */
  startedAt?: string;
  /** When this agent completed (ISO string) */
  completedAt?: string;
  /** Duration in milliseconds */
  durationMs?: number;
  /** Error message (if status === "failed") */
  error?: string;
  /** Last log line */
  log?: string;
  /** Whether the result was served from cache (no AI call made) */
  cached?: boolean;
}

export type AgentId =
  | "supervisor"
  | "planner"
  | "memory"
  | "research"
  | "resume-parser"
  | "job-intelligence"
  | "company-intelligence"
  | "skill-gap"
  | "ats-analysis"
  | "optimizer"
  | "qa"
  | "reflection"
  | "cover-letter"
  | "interview"
  | "career-coach"
  | "application-tracker"
  | "salary"
  | "job-search";

// ============================================================================
// Event types (event-driven execution)
// ============================================================================

export type PipelineEventType =
  | "resume-uploaded"
  | "job-url-added"
  | "optimization-complete"
  | "application-submitted"
  | "context-changed";

export interface PipelineEvent {
  type: PipelineEventType;
  timestamp: string;
  payload?: any;
}

// ============================================================================
// Factory + helpers
// ============================================================================

export function createEmptyContext(): GlobalPipelineContext {
  const now = new Date().toISOString();
  return {
    userId: null,
    resumeId: null,
    jobId: null,
    optimizationId: null,
    originalResume: null,
    optimizedResume: null,
    jobDescription: null,
    jobUrl: null,
    companyName: null,
    jobTitle: null,
    industry: null,
    jobIntelligence: null,
    companyIntelligence: null,
    skillGap: null,
    beforeATS: null,
    afterATS: null,
    qa: null,
    reflection: null,
    coverLetter: null,
    interviewPackage: null,
    careerRecommendations: null,
    atsScore: null,
    matchScore: null,
    keywords: [],
    missingSkills: [],
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Serialize a context to a localStorage-safe object (strips any non-serializable
 * fields like functions). Used by the MemoryAgent.
 */
export function serializeContext(ctx: GlobalPipelineContext): any {
  return JSON.parse(JSON.stringify(ctx));
}

// ============================================================================
// CONTEXT SNAPSHOT ENGINE
//
// Before every agent: createSnapshot()
// After every agent: createSnapshot()
// On failure: rollbackToLastValidSnapshot()
//
// Snapshots are immutable deep clones of the GlobalPipelineContext.
// They allow the pipeline to roll back to a known-good state when an
// agent produces invalid output.
// ============================================================================

export interface ContextSnapshot {
  id: string;
  timestamp: string;
  agentName: string;
  context: GlobalPipelineContext;
  label: string; // e.g., "before-optimizer", "after-qa"
}

const snapshots: ContextSnapshot[] = [];
const MAX_SNAPSHOTS = 50; // prevent memory leaks

/**
 * Create an immutable snapshot of the current context.
 * Called before and after every agent runs.
 */
export function createSnapshot(
  context: GlobalPipelineContext,
  agentName: string,
  label: string,
): ContextSnapshot {
  const snapshot: ContextSnapshot = {
    id: `snap_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    timestamp: new Date().toISOString(),
    agentName,
    label,
    context: JSON.parse(JSON.stringify(context)), // deep clone — immutable
  };

  snapshots.push(snapshot);

  // Prune old snapshots to prevent memory leaks
  if (snapshots.length > MAX_SNAPSHOTS) {
    snapshots.shift();
  }

  console.info(`[Snapshot Engine] Created snapshot: ${label} (${agentName}) — ${snapshots.length} total`);
  return snapshot;
}

/**
 * Roll back to the last valid snapshot.
 * Called when an agent produces invalid output or fails.
 *
 * @returns The context from the last valid snapshot, or null if none exist.
 */
export function rollbackToLastValidSnapshot(): GlobalPipelineContext | null {
  if (snapshots.length === 0) {
    console.warn("[Snapshot Engine] No snapshots to roll back to");
    return null;
  }

  // Find the last snapshot that has valid output (optimizedResume with experience)
  for (let i = snapshots.length - 1; i >= 0; i--) {
    const snap = snapshots[i];
    if (snap.context.optimizedResume && (snap.context.optimizedResume.experience?.length ?? 0) > 0) {
      console.info(`[Snapshot Engine] Rolling back to: ${snap.label} (${snap.agentName}) at ${snap.timestamp}`);
      // Return a deep clone so the caller can't mutate the snapshot
      return JSON.parse(JSON.stringify(snap.context));
    }
  }

  // No snapshot with valid output — return the earliest snapshot
  const earliest = snapshots[0];
  console.warn(`[Snapshot Engine] No valid snapshot found — rolling back to earliest: ${earliest.label}`);
  return JSON.parse(JSON.stringify(earliest.context));
}

/**
 * Get the most recent snapshot (without rolling back).
 */
export function getLastSnapshot(): ContextSnapshot | null {
  return snapshots.length > 0 ? snapshots[snapshots.length - 1] : null;
}

/**
 * Get all snapshots (for debugging / UI display).
 */
export function getAllSnapshots(): ContextSnapshot[] {
  return [...snapshots];
}

/**
 * Clear all snapshots — called when a new optimization run starts.
 */
export function clearSnapshots(): void {
  snapshots.length = 0;
  console.info("[Snapshot Engine] All snapshots cleared");
}
