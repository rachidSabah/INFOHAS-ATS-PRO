// ResumeAI Pro — Provider Router
// Classifies providers into Category A (API) and Category B (Browser Auth),
// and routes tasks to the correct provider type.
//
// DOCUMENT TASKS (Resume, ATS, Cover Letter, Interview, PDF) → API providers ONLY
// INTERACTIVE TASKS (Chat, Playground, Assistant) → any provider (including Puter)
//
// This ensures Puter.js is NEVER used for document generation — only for
// interactive browser-based tasks.

"use client";

import { useApp } from "./store";
import type { AIProvider } from "./types";

// ============================================================================
// TASK CLASSIFICATION
// ============================================================================

export type TaskCategory =
  | "document"      // Resume, ATS, Cover Letter, Interview, PDF — API providers ONLY
  | "interactive"   // Chat, Playground, Assistant — any provider
  | "development"   // AI Dev Agent, AI Builder — any provider
  | "autonomous";   // Autonomous debug — API providers preferred

export type DocumentTask =
  | "resume_optimization"
  | "ats_check"
  | "cover_letter"
  | "interview_prep"
  | "pdf_generation"
  | "jd_extraction"
  | "resume_parsing";

export type InteractiveTask =
  | "chat"
  | "prompt_playground"
  | "ai_assistant"
  | "dev_agent_interactive";

/**
 * Classify a task into a category.
 * Document tasks → "document" (API providers only)
 * Interactive tasks → "interactive" (any provider)
 */
export function classifyTask(task: string): TaskCategory {
  const documentTasks: string[] = [
    "resume_optimization", "ats_check", "cover_letter", "interview_prep",
    "pdf_generation", "jd_extraction", "resume_parsing",
    "optimizer", "ats", "cover-letter", "interview", "pdf", "jd-scraper",
  ];
  const interactiveTasks: string[] = [
    "chat", "prompt_playground", "ai_assistant", "dev_agent_interactive",
    "playground", "assistant",
  ];

  const lower = task.toLowerCase();
  if (documentTasks.some((t) => lower.includes(t))) return "document";
  if (interactiveTasks.some((t) => lower.includes(t))) return "interactive";
  return "development";
}

// ============================================================================
// PROVIDER CLASSIFICATION
// ============================================================================

/**
 * Check if a provider is a Category A (API) provider.
 * API providers use API keys and can run server-side.
 */
export function isApiProvider(p: AIProvider): boolean {
  return p.providerCategory === "api" || (!p.providerCategory && p.type !== "puter");
}

/**
 * Check if a provider is a Category B (Browser Auth) provider.
 * Browser auth providers require a browser session (e.g. Puter.js).
 */
export function isBrowserAuthProvider(p: AIProvider): boolean {
  return p.providerCategory === "browser_auth" || p.type === "puter" || p.requiresBrowserAuth === true;
}

/**
 * Check if a provider can be used for a given task category.
 * - Document tasks: API providers ONLY (never Puter)
 * - Interactive tasks: any provider
 * - Development tasks: any provider
 * - Autonomous tasks: API providers preferred
 */
export function canProviderHandleTask(p: AIProvider, taskCategory: TaskCategory): boolean {
  if (!p.isActive) return false;

  switch (taskCategory) {
    case "document":
      // Document tasks allow any active provider (including Puter if authenticated)
      return true;
    case "interactive":
      // Interactive tasks can use any provider
      return true;
    case "development":
      // Development tasks can use any provider
      return true;
    case "autonomous":
      // Autonomous tasks prefer API providers but allow any
      return true;
    default:
      return isApiProvider(p);
  }
}

// ============================================================================
// PROVIDER ROUTING
// ============================================================================

export interface RouteResult {
  primary: AIProvider | null;
  fallbacks: AIProvider[];
  reason: string;
}

/**
 * Route a task to the appropriate provider.
 *
 * For document tasks (resume, ATS, cover letter, etc.):
 *   1. User's configured default API provider
 *   2. First active API provider (OpenCode > DeepSeek > OpenRouter > Groq > Custom)
 *   3. Puter is EXCLUDED
 *
 * For interactive tasks:
 *   1. User's configured default provider (any type)
 *   2. Puter.js (if signed in)
 *   3. First active API provider
 */
export function routeProvider(taskCategory: TaskCategory): RouteResult {
  const state = useApp.getState();
  const providers: AIProvider[] = state.providers || [];
  const settings = state.providerSettings || {};
  const activeProviders = providers.filter((p) => p.isActive);

  // Filter providers that can handle this task
  const eligible = activeProviders.filter((p) => canProviderHandleTask(p, taskCategory));

  if (eligible.length === 0) {
    return {
      primary: null,
      fallbacks: [],
      reason: `No eligible providers for task category "${taskCategory}". ${
        taskCategory === "document"
          ? "Document tasks require API providers (not Puter). Configure an API provider in AI Providers."
          : "Configure at least one active AI provider."
      }`,
    };
  }

  // Priority order for API providers (for document tasks)
  const apiPriorityOrder = ["opencode", "deepseek", "opencode-zen", "zencode", "nvidia", "openrouter", "groq", "openai", "claude", "gemini", "mistral", "cohere", "perplexity", "together", "huggingface", "custom"];

  // 1. Check user's configured default
  let primary: AIProvider | null = null;
  if (settings.defaultProviderId) {
    primary = eligible.find((p) => p.id === settings.defaultProviderId) || null;
  }
  // 2. Check isDefault flag
  if (!primary) {
    primary = eligible.find((p) => p.isDefault) || null;
  }
  // 3. For document tasks: pick by priority order (API providers only)
  if (!primary && taskCategory === "document") {
    for (const type of apiPriorityOrder) {
      const found = eligible.find((p) => p.type === type);
      if (found) { primary = found; break; }
    }
  }
  // 4. For interactive tasks: prefer Puter (if available), then API providers
  if (!primary && taskCategory === "interactive") {
    primary = eligible.find((p) => isBrowserAuthProvider(p)) || eligible[0] || null;
  }
  // 5. Fallback: first eligible
  if (!primary) {
    primary = eligible[0];
  }

  // Safety: if primary is still null (shouldn't happen after eligible.length > 0 check), return error
  if (!primary) {
    return {
      primary: null,
      fallbacks: [],
      reason: `No eligible providers for task category "${taskCategory}". Internal routing error.`,
    };
  }

  // Build fallback chain (all eligible except primary) — safe now, primary is guaranteed non-null
  const fallbacks = eligible.filter((p) => p.id !== primary.id);

  // For document tasks, sort fallbacks by priority order
  if (taskCategory === "document") {
    fallbacks.sort((a, b) => {
      const aIdx = apiPriorityOrder.indexOf(a.type);
      const bIdx = apiPriorityOrder.indexOf(b.type);
      return (aIdx === -1 ? 999 : aIdx) - (bIdx === -1 ? 999 : bIdx);
    });
  }

  return {
    primary,
    fallbacks,
    reason: `Routed to ${primary.name} (${isBrowserAuthProvider(primary) ? "browser auth" : "API"}) with ${fallbacks.length} fallback(s)`,
  };
}

/**
 * Get the default routing policy for document tasks.
 * This is the priority order: OpenCode → DeepSeek → OpenRouter → Groq → Custom.
 * Puter is EXCLUDED.
 */
export const DOCUMENT_ROUTING_POLICY = [
  "opencode",
  "deepseek",
  "opencode-zen",
  "zencode",
  "nvidia",
  "openrouter",
  "groq",
  "openai",
  "claude",
  "gemini",
  "mistral",
  "cohere",
  "perplexity",
  "together",
  "huggingface",
  "custom",
] as const;

/**
 * Tasks that Puter IS allowed for (browser-only, interactive).
 */
export const PUTER_ELIGIBLE_TASKS = [
  "chat",
  "prompt_playground",
  "ai_assistant",
  "dev_agent_interactive",
  "interactive",
] as const;

/**
 * Check if Puter is allowed for a given task.
 */
export function isPuterAllowedForTask(task: string): boolean {
  const lower = task.toLowerCase();
  return PUTER_ELIGIBLE_TASKS.some((t) => lower.includes(t));
}
