// ============================================================================
// Middleware Hook System — Phase 8.1.3.2A
//
// Lightweight, OPTIONAL extension points around the single AI execution
// pipeline (recordAI → callAIRaw → ProviderRouter).
//
// MANDATE:
//   - Hooks are no-ops by default. Registering none changes NOTHING.
//   - Hooks MUST NOT change runtime behaviour in this phase. They exist so that
//     future phases (Reflection, QA, Validation, Retry, Metrics, Decision
//     Engine) can attach WITHOUT editing call-sites or the core pipeline.
//   - Hook failures are swallowed (logged to console) so an errant observer can
//     never break an AI execution. This is an observability seam, not control
//     flow.
//   - There is exactly ONE hook registry (module singleton). No duplication.
//
// The 14 supported hook points map onto the pipeline lifecycle:
//   BeforePrompt / AfterPrompt      — prompt assembly boundary
//   BeforeContext / AfterContext    — context assembly boundary
//   BeforeProvider / AfterProvider  — provider execution boundary
//   BeforeResponse / AfterResponse  — response handling boundary
//   BeforePersist / AfterPersist    — flight-record persistence boundary
//   OnSuccess / OnFailure / OnTimeout / OnRetry — terminal outcomes
// ============================================================================

import type { AICallOptions, AICallResult } from "@/lib/ai";

export type HookPoint =
  | "BeforePrompt"
  | "AfterPrompt"
  | "BeforeContext"
  | "AfterContext"
  | "BeforeProvider"
  | "AfterProvider"
  | "BeforeResponse"
  | "AfterResponse"
  | "BeforePersist"
  | "AfterPersist"
  | "OnSuccess"
  | "OnFailure"
  | "OnTimeout"
  | "OnRetry"
  | "OnReflection"
  | "OnQA"
  | "OnValidation"
  | "OnDecision";

/**
 * The context object passed to every hook. It is READ-MOSTLY: hooks may read
 * everything and may attach diagnostic notes to `notes`, but in this phase they
 * MUST NOT mutate `opts` or `result` in ways that change execution. Future
 * phases that need to transform requests will introduce a dedicated,
 * explicitly-typed transform API — not this observability hook.
 */
export interface HookContext {
  point: HookPoint;
  executionId: string;
  scope?: string;
  feature?: string;
  module?: string;
  opts: AICallOptions;
  /** Present from AfterProvider onward. */
  result?: AICallResult | null;
  /** Present on OnFailure / OnTimeout. */
  error?: unknown;
  /** Retry attempt index on OnRetry. */
  attempt?: number;
  /** Free-form diagnostic notes hooks may append (non-behavioural). */
  notes?: string[];
  /** Epoch ms when the hook fired. */
  at: number;
}

export type HookFn = (ctx: HookContext) => void | Promise<void>;

// ----------------------------------------------------------------------------
// Registry (single module singleton)
// ----------------------------------------------------------------------------

const registry: Record<HookPoint, HookFn[]> = {
  BeforePrompt: [],
  AfterPrompt: [],
  BeforeContext: [],
  AfterContext: [],
  BeforeProvider: [],
  AfterProvider: [],
  BeforeResponse: [],
  AfterResponse: [],
  BeforePersist: [],
  AfterPersist: [],
  OnReflection: [],
  OnQA: [],
  OnValidation: [],
  OnDecision: [],
  OnSuccess: [],
  OnFailure: [],
  OnTimeout: [],
  OnRetry: [],
};

/** Register a hook. Returns an unregister function. */
export function registerHook(point: HookPoint, fn: HookFn): () => void {
  registry[point].push(fn);
  return () => {
    const arr = registry[point];
    const i = arr.indexOf(fn);
    if (i >= 0) arr.splice(i, 1);
  };
}

/** Remove all hooks (primarily for tests). */
export function clearHooks(point?: HookPoint): void {
  if (point) {
    registry[point] = [];
  } else {
    (Object.keys(registry) as HookPoint[]).forEach((k) => (registry[k] = []));
  }
}

/** Number of hooks registered at a point (diagnostics/tests). */
export function hookCount(point: HookPoint): number {
  return registry[point].length;
}

/**
 * Fire all hooks at a point. NEVER throws — a hook error is caught and logged,
 * so observers can never break execution. When no hooks are registered this is
 * effectively free (an empty-array check).
 */
export async function runHooks(
  point: HookPoint,
  ctx: Omit<HookContext, "point" | "at">,
): Promise<void> {
  const fns = registry[point];
  if (fns.length === 0) return; // fast path — zero overhead when unused
  const full: HookContext = { ...ctx, point, at: Date.now() };
  for (const fn of fns) {
    try {
      await fn(full);
    } catch (e) {
      console.warn(`[AI hooks] "${point}" hook threw (ignored):`, e);
    }
  }
}
