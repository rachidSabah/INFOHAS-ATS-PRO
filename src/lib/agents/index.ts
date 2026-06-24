// ============================================================================
// Agents module — barrel export for the Unified AI Career Operating System (V3).
//
// V3 adds a Supervisor + Memory + post-optimization agents on top of the
// existing V2 6-agent pipeline. The existing runOptimizationPipeline() is
// preserved unchanged — the Supervisor wraps it.
//
// Agents:
//   - Supervisor           — supervisors.ts (V3) — orchestrates everything
//   - Memory               — memory-agent.ts (V3) — persists user profile
//   - Resume Parser        — parser.ts (existing)
//   - Job Intelligence     — job-intelligence.ts (existing)
//   - Company Intelligence — company-skill-agents.ts (V2)
//   - Skill Gap            — company-skill-agents.ts (V2)
//   - ATS Analysis         — ats-analysis.ts (existing)
//   - Resume Optimizer     — orchestrator.ts (existing V2 6-agent pipeline)
//   - Quality Assurance    — qa-agent.ts (existing)
//   - Reflection           — orchestrator.ts (existing)
//   - Cover Letter         — supervisor.ts (V3, post-optimization)
//   - Interview            — supervisor.ts (V3, post-optimization)
//   - Career Coach         — supervisor.ts (V3, post-optimization)
// ============================================================================

export { analyzeATS, type ATSAnalysisResult, type ATSRecommendation, type ATSScoreBreakdown } from "./ats-analysis";
export { runQA, type QAResult, type FactualConsistencyResult, type ExportQualityResult, type ProfessionalToneResult } from "./qa-agent";
export { runOptimizationPipeline, runReflectionAgent, type PipelineInput, type PipelineResult, type PipelineStep, type PipelineProgress, type ReflectionResult } from "./orchestrator";

// V2 agents
export { analyzeCompanyIntelligence, analyzeSkillGap, type CompanyIntelligence, type SkillGapIntelligence } from "./company-skill-agents";

// V3 — Supervisor + Memory + shared context
export {
  getSupervisorState,
  subscribeToSupervisor,
  setContext,
  handleResumeUploaded,
  handleOptimizationRequested,
  getCurrentContext,
  getCurrentProfile,
  resetSupervisor,
  type SupervisorState,
} from "./supervisor";
export {
  loadUserProfile,
  saveUserProfile,
  ingestResumeIntoMemory,
  ingestJobIntoMemory,
  recordOptimization,
  recordApplication,
  recordInterview,
  type UserProfile,
  type ApplicationEntry,
  type OptimizationEntry,
  type InterviewEntry,
} from "./memory-agent";
export {
  createEmptyContext,
  serializeContext,
  type GlobalPipelineContext,
  type AgentState,
  type AgentId,
  type AgentStatus,
  type PipelineEvent,
  type PipelineEventType,
  type InterviewPackage,
  type CareerRecommendations,
} from "./pipeline-context";

// Re-export existing agents for convenience
export { parseResumeFile, extractResumeFromText, blankResume } from "../parser";
export { analyzeJobIntelligence, type JobIntelligence } from "../job-intelligence";
