// ============================================================================
// Agents module — barrel export for the 5-agent pipeline.
//
// Agents:
//   1. Resume Parser Agent    — src/lib/parser.ts (existing, unchanged)
//   2. Job Intelligence Agent — src/lib/job-intelligence.ts (existing, unchanged)
//   3. ATS Analysis Agent     — src/lib/agents/ats-analysis.ts (upgraded)
//   4. Resume Optimizer Agent — src/lib/agents/orchestrator.ts (new, unified)
//   5. Quality Assurance Agent — src/lib/agents/qa-agent.ts (upgraded)
//   + Reflection Agent (optional) — src/lib/agents/orchestrator.ts (new)
//
// The orchestrator (src/lib/agents/orchestrator.ts) coordinates all 5 agents
// as a pipeline. It's the single entry point for resume optimization.
// ============================================================================

export { analyzeATS, type ATSAnalysisResult, type ATSRecommendation, type ATSScoreBreakdown } from "./ats-analysis";
export { runQA, type QAResult, type FactualConsistencyResult, type ExportQualityResult, type ProfessionalToneResult } from "./qa-agent";
export { runOptimizationPipeline, runReflectionAgent, type PipelineInput, type PipelineResult, type PipelineStep, type PipelineProgress, type ReflectionResult } from "./orchestrator";

// Re-export existing agents for convenience
export { parseResumeFile, extractResumeFromText, blankResume } from "../parser";
export { analyzeJobIntelligence, type JobIntelligence } from "../job-intelligence";
