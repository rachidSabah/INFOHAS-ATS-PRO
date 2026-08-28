// ============================================================================
// Agent AI Config — makes the Agent Configuration Center LIVE at runtime.
//
// Directive (Task 7): per-agent configuration (provider, model, temperature,
// retry, fallback) from the Agent Configuration Center must actually drive
// agent AI calls — WITHOUT violating the AI Readiness Gate's exclusive
// supervisor control (directive #31): when a job AI lock is active, the
// locked provider+model ALWAYS win; agent config may only contribute
// generation parameters (temperature / maxTokens / timeout).
//
// Resolution order enforced by callAIRaw / callAIRawStreamed:
//   1. Explicit per-call pinning (providerId / modelOverride)   — e.g. Arena
//   2. Job AI configuration lock (readiness gate, optimizer jobs)
//   3. Agent Configuration Center config (this module)          — no lock only
//   4. App default provider chain
// ============================================================================

import { useApp } from "../store";
import type { AgentConfig } from "../pipeline-orchestration-types";

export interface AgentAIDefaults {
  temperature?: number;
  maxTokens?: number;
  timeoutMs?: number;
}

export interface AgentAIResolution extends AgentAIDefaults {
  /** Provider the agent PREFERS (empty under an active job lock). */
  providerId?: string;
  /** Model the agent PREFERS (empty under an active job lock). */
  model?: string;
  /** Where the provider/model decision came from (observability). */
  source: "job-lock" | "agent-config" | "none";
}

/** The stored Agent Configuration Center config for one agent (null-safe). */
export function getAgentConfig(agentType: string): AgentConfig | null {
  try {
    const state = useApp.getState();
    return state?.agentConfigs?.find((a) => a.agentType === agentType) ?? null;
  } catch {
    return null;
  }
}

/**
 * Resolve an agent's AI configuration contribution.
 *
 * @param agentType   pipeline agent type ("job-intelligence", "reflection", …)
 * @param hasExplicit true when the call site pinned providerId/modelOverride
 * @param lockActive  true when a job AI configuration lock is active
 *                    (optimizer calls under the readiness gate)
 */
export function resolveAgentAIOptions(
  agentType: string,
  hasExplicit: boolean,
  lockActive: boolean,
): AgentAIResolution {
  const cfg = getAgentConfig(agentType);
  const genDefaults: AgentAIDefaults = cfg
    ? {
        temperature: typeof cfg.temperature === "number" ? cfg.temperature : undefined,
        maxTokens: typeof cfg.maxTokens === "number" && cfg.maxTokens > 0 ? cfg.maxTokens : undefined,
        timeoutMs: typeof cfg.requestTimeoutMs === "number" && cfg.requestTimeoutMs > 0 ? cfg.requestTimeoutMs : undefined,
      }
    : {};

  // DIRECTIVE #31 — supervisor-exclusive AI config: under an active job lock,
  // the agent may NOT contribute a provider/model. Generation parameters are
  // quality knobs, not provider selection, and are still honoured.
  if (lockActive) {
    return { ...genDefaults, source: "job-lock" };
  }

  // Explicit per-call pinning wins over agent config (Arena / AI Workspace).
  if (hasExplicit) {
    return { ...genDefaults, source: "none" };
  }

  const cfgProviderId = cfg?.providerId?.trim() || undefined;
  const cfgModel = cfg?.model?.trim() || undefined;
  if (cfgProviderId) {
    return { ...genDefaults, providerId: cfgProviderId, model: cfgModel, source: "agent-config" };
  }

  return { ...genDefaults, source: "none" };
}

/** True when the stored config enables the agent (default ON when missing). */
export function isAgentEnabled(agentType: string): boolean {
  const cfg = getAgentConfig(agentType);
  return cfg ? cfg.enabled : true;
}

/**
 * Cheap signature of all agent configs — used by the Supervisor's
 * optimization cache key so config edits invalidate cached results
 * immediately ("changes take effect immediately — no restart required").
 */
export function agentConfigSignature(): string {
  try {
    const configs = useApp.getState()?.agentConfigs ?? [];
    let hash = 0;
    for (const c of configs) {
      const material = `${c.agentType}|${c.enabled}|${c.providerId}|${c.model}|${c.temperature}|${c.maxTokens}|${c.maxRetryCount}|${c.requestTimeoutMs}|${c.onFailureAction}`;
      for (let i = 0; i < material.length; i++) {
        hash = ((hash << 5) - hash + material.charCodeAt(i)) | 0;
      }
    }
    return `ac${(hash >>> 0).toString(36)}`;
  } catch {
    return "ac0";
  }
}
