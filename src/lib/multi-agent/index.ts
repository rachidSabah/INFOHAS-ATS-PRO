// ============================================================================
// Multi-Agent Supervisor — Public API
// ============================================================================

export { DynamicMultiAgentSupervisor, runDynamicMultiAgentOptimization } from "./dynamic-supervisor";
export { getSpecialistAgent, getAllAgentTypes } from "./specialist-agents";
export type { SpecialistAgent } from "./specialist-agents";
export {
  applyPatches,
  validatePatch,
  detectConflicts,
  resolveConflict,
  rollbackPatches,
  computeQualityScore,
  createPatchId,
} from "./patch-engine";

export type {
  // Core types
  AgentPatch,
  AgentTask,
  AgentResult,
  AgentContext,
  QualityScore,
  
  // Agent types
  SpecialistAgentType,
  
  // Context types
  IndustryContext,
  ImmutableEntities,
  EditableFields,
  DynamicSectionInfo,
  SupervisorMemory,
  
  // Supervisor
  SupervisorConfig,
  SupervisorResult,
  
  // Conflict resolution
  PatchConflict,
  ConflictResolutionResult,
  ConflictStrategy,
  
  // Iteration
  OptimizationRound,
  ProviderStats,
} from "./types";
