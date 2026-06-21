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
