// ============================================================================
// Multi-Agent Supervisor — Domain Types
// ============================================================================
// Every agent produces PATCH objects, never full resumes.
// Supervisor is the ONLY orchestration authority.
// ============================================================================

import type { ResumeData } from "../types";

// ── Agent Types ───────────────────────────────────────────────────────────
export type SpecialistAgentType =
  | "resume-analyzer"         // Reads canonical → finds strengths/weaknesses/missing ATS keywords
  | "jd-analyzer"             // Reads JD → extracts structured ATS requirements
  | "ats-optimization"        // Improves ATS score (keywords only, never fabricates)
  | "professional-writing"    // Grammar, readability, professionalism
  | "industry-expert"         // Industry terminology (hospitality/aviation/healthcare/IT/etc)
  | "skills-enhancement"      // Skill wording, grouping, categories
  | "experience-enhancement"  // Bullet descriptions only (company/title/dates UNCHANGED)
  | "education-enhancement"   // Descriptions only (institution/degree/dates UNCHANGED)
  | "dynamic-section"         // Unknown sections — wording only, never delete
  | "resume-preservation"     // Compare canonical vs optimized — detect missing entities
  | "guardian";               // Final validation — no hallucinations, no duplication

// ── Agent Patch ───────────────────────────────────────────────────────────
export interface AgentPatch {
  patchId: string;
  agentId: string;            // Which agent produced this
  agentType: SpecialistAgentType;
  sectionId: string;          // e.g. "experience_2", "summary", "skills", "education_1"
  field: string;              // e.g. "bullet_3", "text", "category", "highlights[0]"
  oldValue: string;
  newValue: string;
  confidence: number;         // 0.0 – 1.0
  reason: string;             // Why this change was made
  metadata?: Record<string, unknown>;
}

// ── Agent Task ────────────────────────────────────────────────────────────
export interface AgentTask {
  taskId: string;
  agentType: SpecialistAgentType;
  priority: number;           // 0 (highest) – 100 (lowest)
  context: AgentContext;
  dependencies: string[];     // Task IDs that must complete first
  parallelGroup?: string;     // Tasks with same group run in parallel
  retryCount: number;
  maxRetries: number;
  status: "pending" | "running" | "completed" | "failed" | "skipped";
}

// ── Agent Context ─────────────────────────────────────────────────────────
export interface AgentContext {
  canonicalResume: ResumeData;
  jobDescription: string;
  atsDirective: string;
  industryContext: IndustryContext;
  memory: SupervisorMemory;
  optimizationRules: string[];
  immutableEntities: ImmutableEntities;
  editableFields: EditableFields;
  dynamicSections: DynamicSectionInfo[];
  previousPatches: AgentPatch[];
}

export interface IndustryContext {
  detectedIndustry: string;
  industryTerminology: string[];
  certifications: string[];
  experienceLevel: string;
}

export interface ImmutableEntities {
  companyNames: string[];
  institutionNames: string[];
  degreeNames: string[];
  languageNames: string[];
  personName: string;
  contactEmail: string;
  contactPhone: string;
  keyDates: Array<{ id: string; date: string }>;
}

export interface EditableFields {
  summary: boolean;
  headline: boolean;
  experienceBullets: boolean;
  educationHighlights: boolean;
  projectBullets: boolean;
  skillWording: boolean;
  skillCategories: boolean;
  certificationWording: boolean;
  dynamicSectionContent: boolean;
}

export interface DynamicSectionInfo {
  sectionId: string;
  normalizedTitle: string;
  rawTitle: string;
  contentCount: number;
}

// ── Agent Result ──────────────────────────────────────────────────────────
export interface AgentResult {
  agentId: string;
  agentType: SpecialistAgentType;
  taskId: string;
  patches: AgentPatch[];
  confidence: number;          // Overall confidence in this round
  qualityScore: QualityScore;
  success: boolean;
  error?: string;
  durationMs: number;
}

export interface QualityScore {
  overall: number;            // 0–100
  ats: number;
  grammar: number;
  readability: number;
  preservation: number;
  industryMatch: number;
  professionalism: number;
}

// ── Supervisor Memory ─────────────────────────────────────────────────────
export interface SupervisorMemory {
  industry: string;
  role: string;
  jobTitle: string;
  atsKeywords: string[];
  optimizationHistory: OptimizationRound[];
  acceptedPatches: AgentPatch[];
  rejectedPatches: AgentPatch[];
  userPreferences: Record<string, string>;
  dynamicSections: DynamicSectionInfo[];
  providerPerformance: Record<string, ProviderStats>;
  agentConfidence: Record<string, number>;
}

export interface OptimizationRound {
  roundId: string;
  timestamp: number;
  patchesCount: number;
  acceptedCount: number;
  rejectedCount: number;
  averageConfidence: number;
  qualityScore: number;
}

export interface ProviderStats {
  successCount: number;
  failureCount: number;
  averageLatencyMs: number;
  lastUsed: number;
}

// ── Conflict Resolution ──────────────────────────────────────────────────
export interface PatchConflict {
  patchA: AgentPatch;
  patchB: AgentPatch;
  sectionId: string;
  field: string;
  resolution: "choose-a" | "choose-b" | "merge" | "reject-both" | "retry";
  resolvedPatch?: AgentPatch;
}

// ── Conflict Resolution Strategy ──────────────────────────────────────────
export type ConflictStrategy = "confidence-wins" | "ats-wins" | "grammar-wins" | "preservation-wins" | "latest-wins" | "retry";

// ── Supervisor Configuration ──────────────────────────────────────────────
export interface SupervisorConfig {
  maxParallelAgents: number;
  defaultMaxRetries: number;
  confidenceThreshold: number;       // Patches below this are rejected
  qualityThreshold: number;          // Minimum quality score to accept round
  conflictStrategy: ConflictStrategy;
  preserveDynamicSections: boolean;
  enableParallelExecution: boolean;
  providerFallbackChain: string[];
}

// ── Supervisor Result ─────────────────────────────────────────────────────
export interface SupervisorResult {
  resume: ResumeData;
  patches: AgentPatch[];
  conflicts: PatchConflict[];
  memory: SupervisorMemory;
  qualityScore: QualityScore;
  success: boolean;
  errors: string[];
  warnings: string[];
  rounds: number;
}

// ── Conflict Resolution Result ───────────────────────────────────────────
export interface ConflictResolutionResult {
  resolved: boolean;
  winner?: AgentPatch;
  merged?: AgentPatch;
  resolution: PatchConflict["resolution"];
  explanation: string;
}
