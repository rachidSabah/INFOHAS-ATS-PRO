// ============================================================================
// Supervisor Memory — Shared Structured Memory
//
// Replaces repeated prompt context with a single shared memory object.
// Each agent reads only the sections it needs and appends its own output.
//
// Benefits:
//   - Reduces token usage (don't resend full resume + JD to every agent)
//   - Reduces latency (agents share state without re-prompting)
//   - Reduces inconsistency (all agents see the same data)
//   - Enables targeted regeneration (only failed sections are re-run)
// ============================================================================

"use client";

import type { SupervisorMemory, AgentExecutionRecord, AgentType } from "./pipeline-orchestration-types";

/**
 * Create a new Supervisor Memory instance for a pipeline execution.
 */
export function createSupervisorMemory(executionId?: string): SupervisorMemory {
  return {
    executionId: executionId || `exec_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
    startedAt: new Date().toISOString(),
    agentExecutions: [],
    scratchpad: {},
  };
}

/**
 * Read a section from shared memory.
 * Agents should call this to get only the data they need.
 */
export function readMemory<T = any>(
  memory: SupervisorMemory,
  section: keyof SupervisorMemory | string,
): T | undefined {
  // Check scratchpad first (for custom keys)
  if (typeof section === "string" && !(section in memory)) {
    return memory.scratchpad[section] as T;
  }
  return memory[section as keyof SupervisorMemory] as T;
}

/**
 * Write a section to shared memory.
 * Agents append their output here for other agents to read.
 */
export function writeMemory(
  memory: SupervisorMemory,
  section: keyof SupervisorMemory | string,
  value: any,
): void {
  // Custom keys go to scratchpad
  if (typeof section === "string" && !(section in memory)) {
    memory.scratchpad[section] = value;
  } else {
    (memory as any)[section] = value;
  }
}

/**
 * Record an agent execution in the memory's execution log.
 */
export function recordAgentExecution(
  memory: SupervisorMemory,
  record: AgentExecutionRecord,
): void {
  // Replace existing record for the same agent, or append
  const existingIndex = memory.agentExecutions.findIndex(
    (e) => e.agentId === record.agentId && e.status === "running",
  );
  if (existingIndex >= 0) {
    memory.agentExecutions[existingIndex] = record;
  } else {
    memory.agentExecutions.push(record);
  }
}

/**
 * Update an agent's execution status.
 */
export function updateAgentExecution(
  memory: SupervisorMemory,
  agentId: string,
  status: AgentExecutionRecord["status"],
  updates?: Partial<AgentExecutionRecord>,
): void {
  const record = memory.agentExecutions.find((e) => e.agentId === agentId);
  if (record) {
    record.status = status;
    if (status === "completed" || status === "failed") {
      record.completedAt = new Date().toISOString();
    }
    Object.assign(record, updates);
  }
}

/**
 * Get all executions for a specific agent type.
 */
export function getExecutionsByType(
  memory: SupervisorMemory,
  agentType: AgentType,
): AgentExecutionRecord[] {
  return memory.agentExecutions.filter((e) => e.agentType === agentType);
}

/**
 * Get the latest execution for an agent.
 */
export function getLatestExecution(
  memory: SupervisorMemory,
  agentId: string,
): AgentExecutionRecord | undefined {
  const executions = memory.agentExecutions.filter((e) => e.agentId === agentId);
  return executions[executions.length - 1];
}

/**
 * Mark the pipeline as completed.
 */
export function completeMemory(memory: SupervisorMemory): void {
  memory.completedAt = new Date().toISOString();
}

/**
 * Get a summary of the memory for logging/debugging.
 */
export function getMemorySummary(memory: SupervisorMemory): Record<string, any> {
  return {
    executionId: memory.executionId,
    startedAt: memory.startedAt,
    completedAt: memory.completedAt,
    hasResume: !!memory.resumeJson,
    hasJobDescription: !!memory.jobDescriptionJson,
    hasCompanyIntelligence: !!memory.companyIntelligence,
    hasJobIntelligence: !!memory.jobIntelligence,
    hasSkillGap: !!memory.skillGapAnalysis,
    hasAtsKeywords: !!memory.atsKeywords?.length,
    hasOptimizerOutput: !!memory.optimizerOutput,
    hasAssembledResume: !!memory.assembledResume,
    hasQaResults: !!memory.qaResults,
    hasReflectionNotes: !!memory.reflectionNotes,
    hasFactualConsistency: !!memory.factualConsistency,
    hasStructureGuardian: !!memory.structureGuardianResult,
    layoutMetadata: memory.layoutMetadata,
    exportMetadata: memory.exportMetadata,
    agentExecutionCount: memory.agentExecutions.length,
    scratchpadKeys: Object.keys(memory.scratchpad),
  };
}

/**
 * Build a compact context object for an agent prompt.
 * Instead of sending the full resume + JD, send only what the agent needs.
 */
export function buildAgentContext(
  memory: SupervisorMemory,
  requiredSections: string[],
): Record<string, any> {
  const context: Record<string, any> = {};
  for (const section of requiredSections) {
    const value = readMemory(memory, section);
    if (value !== undefined) {
      context[section] = value;
    }
  }
  return context;
}
