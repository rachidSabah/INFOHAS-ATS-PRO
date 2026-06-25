// ============================================================================
// Conversational Debug Chat Interface
//
// Interactive chat window connected to the AI Provider Registry.
// User types a prompt → wrapped in Hermes context + system_health logs →
// sent via selected D1 provider → response rendered with actionable
// inline buttons ([Apply Patch], [Run Query], [Rollback]).
//
// The UI component lives in src/components/app/modules/DebugChat.tsx
// This file provides the service layer.
// ============================================================================

"use client";

import { callAI } from "./ai";
import { getMetricsSnapshot } from "./metrics-service";
import { getRecentIncidents } from "./incident-service";
import { getTelemetrySnapshot } from "./telemetry";
import { audit } from "./audit-service";

export interface ChatMessage {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  timestamp: string;
  actions?: ChatAction[];
  provider?: string;
}

export interface ChatAction {
  id: string;
  label: string;
  type: "apply-patch" | "run-query" | "rollback" | "sync-providers" | "run-health-check" | "clear-cache";
  payload: any;
}

/**
 * Build the system context for the debug chat.
 * Includes current system health, recent incidents, and telemetry.
 */
export function buildSystemContext(): string {
  const metrics = getMetricsSnapshot();
  const incidents = getRecentIncidents(5);
  const telemetry = getTelemetrySnapshot();

  const incidentText = incidents.length > 0
    ? incidents.map((i) => `- [${i.severity}] ${i.rootCause} (${i.timestamp})`).join("\n")
    : "No recent incidents";

  return `You are Hermes, the autonomous debug agent for ResumeAI Pro.

CURRENT SYSTEM STATE:
- Overall health: ${metrics.health.overall ? "HEALTHY" : "ISSUES"}
- Providers: ${metrics.providers.trippedCount} tripped, ${metrics.providers.providerFailures} failures
- Pipeline: ${metrics.pipeline.totalOptimizations} optimizations, ${metrics.pipeline.totalFailures} failures
- Repairs: ${metrics.repairs.totalRepairs} total (${metrics.repairs.repairSuccessRate}% success rate)
- Incidents: ${metrics.incidents.total} total (${metrics.incidents.critical} critical)
- Memory: ${metrics.health.memoryUsedMB}MB

RECENT INCIDENTS:
${incidentText}

TELEMETRY:
- Avg optimizer duration: ${telemetry.performance.avgOptimizerDurationMs}ms
- Avg QA confidence: ${telemetry.performance.avgQAConfidence}/100
- Avg ATS score: ${telemetry.performance.avgAtsScore}/100
- Provider failures: ${telemetry.providerFailures.length}
- Pipeline failures: ${telemetry.pipelineFailures.length}

When you suggest fixes, format them as actionable items that the user can click to execute.
Available actions: [Apply Patch], [Run Query], [Rollback], [Sync Providers], [Run Health Check], [Clear Cache]`;
}

/**
 * Send a debug chat message to the selected AI provider.
 * Wraps the user prompt in the Hermes system context + system health.
 */
export async function sendDebugMessage(
  userPrompt: string,
  providerId?: string,
): Promise<ChatMessage> {
  const systemContext = buildSystemContext();

  audit({
    actor: "user",
    action: "debug-chat.send",
    category: "admin",
    details: userPrompt.slice(0, 200),
    severity: "info",
  });

  try {
    const result = await callAI({
      systemPrompt: systemContext,
      userPrompt: `DEBUG REQUEST: ${userPrompt}

Analyze the issue, identify the root cause, and suggest a fix.
If you recommend code changes, format them as a patch.
If you recommend a database query, format it as SQL.
If you recommend a rollback, specify what to roll back.

Format your response with clear sections:
1. DIAGNOSIS
2. ROOT CAUSE
3. RECOMMENDED FIX
4. ACTION ITEMS (if any)`,
      maxTokens: 2000,
      temperature: 0.3,
      taskCategory: "development",
      ...(providerId ? { timeoutMs: 60000 } : {}),
    });

    // Extract actionable items from the response
    const actions = extractActions(result.text, userPrompt);

    return {
      id: `msg_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      role: "assistant",
      content: result.text,
      timestamp: new Date().toISOString(),
      actions,
      provider: result.provider,
    };
  } catch (e: any) {
    return {
      id: `msg_err_${Date.now()}`,
      role: "assistant",
      content: `Debug request failed: ${e?.message ?? "Unknown error"}. The system is still operational — please try again or check the health monitor.`,
      timestamp: new Date().toISOString(),
      actions: [],
    };
  }
}

/**
 * Extract actionable buttons from the AI response.
 * Looks for keywords like "apply", "rollback", "query", "sync", etc.
 */
function extractActions(response: string, originalPrompt: string): ChatAction[] {
  const actions: ChatAction[] = [];
  const lower = response.toLowerCase();

  if (lower.includes("patch") || lower.includes("apply") || lower.includes("fix")) {
    actions.push({
      id: `act_patch_${Date.now()}`,
      label: "Apply Patch",
      type: "apply-patch",
      payload: { response, prompt: originalPrompt },
    });
  }

  if (lower.includes("rollback") || lower.includes("revert")) {
    actions.push({
      id: `act_rollback_${Date.now()}`,
      label: "Rollback",
      type: "rollback",
      payload: { response, prompt: originalPrompt },
    });
  }

  if (lower.includes("query") || lower.includes("sql") || lower.includes("select")) {
    actions.push({
      id: `act_query_${Date.now()}`,
      label: "Run Query",
      type: "run-query",
      payload: { response },
    });
  }

  if (lower.includes("sync") || lower.includes("provider")) {
    actions.push({
      id: `act_sync_${Date.now()}`,
      label: "Sync Providers",
      type: "sync-providers",
      payload: {},
    });
  }

  if (lower.includes("health") || lower.includes("check")) {
    actions.push({
      id: `act_health_${Date.now()}`,
      label: "Run Health Check",
      type: "run-health-check",
      payload: {},
    });
  }

  if (lower.includes("cache") || lower.includes("clear")) {
    actions.push({
      id: `act_cache_${Date.now()}`,
      label: "Clear Cache",
      type: "clear-cache",
      payload: {},
    });
  }

  return actions;
}

/**
 * Execute a chat action.
 * Routes to the appropriate service based on action type.
 */
export async function executeAction(action: ChatAction): Promise<{ success: boolean; message: string }> {
  audit({
    actor: "user",
    action: `debug-chat.execute.${action.type}`,
    category: "admin",
    details: action.label,
    severity: "info",
  });

  switch (action.type) {
    case "sync-providers": {
      try {
        const { syncProviderConfigs } = await import("./provider-sync");
        const { useApp } = await import("./store");
        const providers = useApp.getState().providers as any[];
        const { result } = syncProviderConfigs(providers);
        return { success: true, message: `Providers synced: ${result.repaired} repaired, ${result.backfilled} backfilled` };
      } catch (e: any) {
        return { success: false, message: `Sync failed: ${e?.message}` };
      }
    }

    case "run-health-check": {
      try {
        const { runHealthCheck } = await import("./health-monitor");
        const result = await runHealthCheck();
        return {
          success: result.overall,
          message: result.overall
            ? "All systems healthy"
            : `Issues found: ${result.providers.issues.join(", ")}`,
        };
      } catch (e: any) {
        return { success: false, message: `Health check failed: ${e?.message}` };
      }
    }

    case "clear-cache": {
      try {
        const { invalidateAllCaches } = await import("./provider-cache");
        invalidateAllCaches();
        return { success: true, message: "All caches cleared" };
      } catch (e: any) {
        return { success: false, message: `Cache clear failed: ${e?.message}` };
      }
    }

    case "rollback": {
      try {
        const { rollbackToLastValidSnapshot } = await import("./agents/pipeline-context");
        const result = rollbackToLastValidSnapshot();
        return {
          success: result !== null,
          message: result ? "Rolled back to last valid snapshot" : "No valid snapshot to roll back to",
        };
      } catch (e: any) {
        return { success: false, message: `Rollback failed: ${e?.message}` };
      }
    }

    case "apply-patch":
      return { success: true, message: "Patch noted — review the AI response for implementation details" };

    case "run-query":
      return { success: true, message: "Query noted — execute in the D1 console" };

    default:
      return { success: false, message: `Unknown action type: ${action.type}` };
  }
}
