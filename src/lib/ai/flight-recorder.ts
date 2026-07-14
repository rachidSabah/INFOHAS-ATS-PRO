// ============================================================================
// AI Flight Recorder — Phase 8.1.3 / 8.1.3.1 (UNIVERSAL observability layer)
//
// Relocated from src/lib/interview/ to src/lib/ai/ so it is shared AI
// infrastructure, not interview-specific.
//
// MANDATE:
//   - It MUST NEVER own execution. It only records execution.
//   - Recording happens AUTOMATICALLY inside the SINGLE AI execution pipeline.
//   - No feature manually creates records.
//   - Reuse the existing pipeline; no second provider/orchestrator/prompt.
//
// UNIVERSAL PIPELINE (8.1.3.1):
//   AI Feature → recordAI() → callAIRaw() → ProviderRouter → Provider
//   The public `callAI` in @/lib/ai now delegates to `recordAI`, so EVERY AI
//   execution app-wide is recorded automatically — even callers that still
//   reference `callAI`. `recordAI` is the ONLY function that invokes the raw
//   provider call (`callAIRaw`), preventing duplicate execution paths.
//
//   A FlightRecord captures metadata ONLY: execution id, timestamps, entity
//   references (never payloads), provider/model/params, duration/latency/
//   tokens, status, warnings, errors. Secrets are NEVER stored. Replay is
//   deterministic (stored prompt + params, no business-logic re-run).
// ============================================================================

// NOTE: `callAIRaw` is NOT imported statically here. A static import would
// create a module-init cycle (flight-recorder → @/lib/ai → optimizer-directive-engine
// → flight-recorder), which leaves `_moduleContext` in the TDZ when a feature
// calls `setFlightScope()` at top level. We lazily import inside `recordAI()`
// instead (see Phase 8.1.3.1 mandate: recordAI is the ONLY caller of callAIRaw).
import { type AICallOptions, type AICallResult } from "@/lib/ai";
import { uid, useApp } from "@/lib/store";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ExecutionStatus = "created" | "running" | "completed" | "error" | "retried";

/** Lifecycle span — the timeline. Stored inline for fast replay/render. */
export interface FlightSpan {
  name: "context" | "prompt" | "provider" | "model" | "streaming" | "retry" | "reflection" | "qa" | "validation" | "response" | "persist";
  at: number; // epoch ms
  ms?: number; // duration of this phase
  detail?: string;
}

export interface FlightPerformance {
  contextBuildMs?: number;
  promptBuildMs?: number;
  providerMs?: number;
  modelMs?: number;
  reflectionMs?: number;
  qaMs?: number;
  validationMs?: number;
  totalMs: number;
}

export interface FlightCost {
  inputTokens: number;
  outputTokens: number;
  cachedTokens: number;
  estimatedCost: number; // USD, best-effort
  provider: string;
  model: string;
}

export interface InterviewContextMeta {
  questionId?: string;
  questionType?: string;
  difficulty?: string;
  competency?: string;
  branch?: string;
  branchReason?: string;
  persona?: string;
  company?: string;
  interviewState?: string;
  overallScore?: number;
  confidence?: number;
  missingCompetencies?: string[];
  nextDecision?: string;
}

export interface ResumeOptContextMeta {
  atsScore?: number;
  keywordCoverage?: number;
  missingSkills?: string[];
  promptVersion?: string;
  reflection?: boolean;
  qualityScore?: number;
  validation?: string;
  exportResult?: string;
}

/**
 * A single Flight Record. References entities by id (never duplicates resume
 * or JD data — they are already stored elsewhere).
 */
export interface FlightRecord {
  executionId: string;
  timestamp: string;
  /** Human feature label, e.g. "Resume Optimizer" (universal, Phase 8.1.3.1). */
  feature?: string;
  /** Source module path, e.g. "src/lib/optimizer" (universal). */
  module?: string;
  sessionId?: string;
  userId?: string;
  resumeId?: string;
  resumeVersion?: string;
  jdId?: string;
  interviewSessionId?: string;
  scenarioId?: string;
  personaId?: string;
  company?: string;

  // AI execution metadata
  provider: string;
  model: string;
  temperature?: number;
  topP?: number;
  maxTokens?: number;
  streaming: boolean;
  promptVersion: string;
  promptHash: string;
  contextHash: string;

  // Execution lifecycle
  durationMs: number;
  latencyMs: number;
  tokenUsage: number;
  retryCount: number;
  reflectionEnabled: boolean;
  qaEnabled: boolean;
  validationResult?: string;
  status: ExecutionStatus;
  warnings: string[];
  errors: string[];

  // Domain metadata (one of the two, optional)
  interview?: InterviewContextMeta;
  resumeOpt?: ResumeOptContextMeta;

  // Replay payload — enough to reconstruct the exact call WITHOUT re-executing.
  prompt: { systemPrompt?: string; userPrompt: string; messages?: AICallOptions["messages"] };
  parameters: { temperature?: number; maxTokens?: number; modelOverride?: string; taskCategory?: string };

  // Timeline + perf + cost
  timeline: FlightSpan[];
  performance: FlightPerformance;
  cost: FlightCost;

  // Retention
  scope: FlightScope;
}

// ----------------------------------------------------------------------------
// Universal scopes (Phase 8.1.3.1) — one shared enum for the whole app.
// Every AI feature reuses this; no duplicated metadata builders.
// ----------------------------------------------------------------------------

export type FlightScope =
  | "resume-builder"
  | "resume-optimizer"
  | "resume-copilot"
  | "resume-parser"
  | "ocr"
  | "ats-analysis"
  | "company-intelligence"
  | "job-intelligence"
  | "cover-letter"
  | "translation"
  | "interview"
  | "adaptive-interview"
  | "evaluation"
  | "future-mcp"
  | "future-hermes"
  | "future-agents"
  | "other";

/** Map a call-site feature label to a canonical scope. Defaults to "other". */
export const FEATURE_SCOPE: Record<string, FlightScope> = {
  "resume-builder": "resume-builder",
  "resume-optimizer": "resume-optimizer",
  "resume-copilot": "resume-copilot",
  "resume-parser": "resume-parser",
  ocr: "ocr",
  "ats-analysis": "ats-analysis",
  "company-intelligence": "company-intelligence",
  "job-intelligence": "job-intelligence",
  "cover-letter": "cover-letter",
  translation: "translation",
  interview: "interview",
  "adaptive-interview": "adaptive-interview",
  evaluation: "evaluation",
  "future-mcp": "future-mcp",
  "future-hermes": "future-hermes",
  "future-agents": "future-agents",
};

/** Shared metadata builder — the single way features describe their context to
 *  the recorder. Reused by every AI feature (no per-module duplicates). */
export interface FlightMetadata {
  feature?: string; // human label, e.g. "Resume Optimizer"
  module?: string; // source module, e.g. "src/lib/optimizer"
  scope?: FlightScope;
  sessionId?: string;
  userId?: string;
  resumeId?: string;
  resumeVersion?: string;
  jdId?: string;
  company?: string;
  interviewSessionId?: string;
  scenarioId?: string;
  personaId?: string;
  workflow?: string;
  interview?: InterviewContextMeta;
  resumeOpt?: ResumeOptContextMeta;
}

// ----------------------------------------------------------------------------
// Hashing (stable, dependency-free) — for prompt/context dedup & replay identity
// ----------------------------------------------------------------------------

export function hashString(input: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    h ^= input.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  // unsigned 32-bit hex
  return (h >>> 0).toString(16).padStart(8, "0");
}

// ----------------------------------------------------------------------------
// Prompt version — pinned constant so replay can detect drift.
// Bump when the Interview/Adaptive prompt templates change.
// ----------------------------------------------------------------------------

export const INTERVIEW_PROMPT_VERSION = "8.1.3";

// ----------------------------------------------------------------------------
// Cost model (best-effort, USD). Rates are illustrative per-1k-tokens and can
// be tuned centrally. Provider/model are matched by substring.
// ----------------------------------------------------------------------------

const RATE_PER_1K: Record<string, { in: number; out: number }> = {
  "gpt-4": { in: 0.03, out: 0.06 },
  "gpt-3.5": { in: 0.0015, out: 0.002 },
  "claude": { in: 0.003, out: 0.015 },
  "deepseek": { in: 0.00027, out: 0.0011 },
  "gemini": { in: 0.0005, out: 0.0015 },
  "groq": { in: 0.0002, out: 0.0002 },
  "openrouter": { in: 0.002, out: 0.006 },
};

function estimateCost(provider: string, model: string, inputTokens: number, outputTokens: number): number {
  const key = Object.keys(RATE_PER_1K).find((k) => (provider + " " + model).toLowerCase().includes(k)) ?? "openrouter";
  const r = RATE_PER_1K[key];
  return Number(((inputTokens / 1000) * r.in + (outputTokens / 1000) * r.out).toFixed(6));
}

// ----------------------------------------------------------------------------
// Sink — reuse the existing store `log()` action (category "ai").
// The recorder does NOT own persistence; it only emits a structured record
// that the store already knows how to store + cloud-sync.
// ----------------------------------------------------------------------------

type LogFn = (entry: {
  actor: string;
  action: string;
  category: "ai";
  details: string;
  severity: "info" | "warning" | "error";
}) => void;

let _logSink: LogFn | null = null;

/** Wire to the store's `log` action. Called once at app init (interview module mount). */
export function setFlightRecordSink(fn: LogFn): void {
  _logSink = fn;
}

// ----------------------------------------------------------------------------
// Module-scope context (Phase 8.1.3.1)
//
// Major AI features call `recordAI` without per-call metadata. To give every
// execution a correct scope WITHOUT editing 101 call-sites' arguments, a
// feature sets its module context ONCE at import time. The recorder reads it
// for each call. This keeps a SINGLE metadata path (no duplication) and means
// even legacy `callAI` delegations inherit the right scope.
// ----------------------------------------------------------------------------

let _moduleContext: Partial<FlightMetadata> = {};

export function setFlightScope(ctx: Partial<FlightMetadata>): void {
  _moduleContext = ctx;
}

/** Reset (primarily for tests). */
export function resetFlightScope(): void {
  _moduleContext = {};
}

/**
 * Lazily bind the sink to the shared store's `log` action so recording works
 * automatically without forcing a specific mount order. Idempotent.
 */
function ensureSink(): void {
  if (_logSink) return;
  try {
    const log = useApp.getState().log;
    if (typeof log === "function") _logSink = log;
  } catch {
    /* store unavailable (SSR/tests) — emit becomes a no-op */
  }
}

function emit(record: FlightRecord): void {
  ensureSink();
  if (!_logSink) return; // no-op if sink not wired (safe in tests/SSR)
  _logSink({
    actor: record.userId ?? "system",
    action: `FlightRecord ${record.status} · ${record.scope} · ${record.provider}/${record.model}`,
    category: "ai",
    details: JSON.stringify(record),
    severity: record.status === "error" ? "error" : record.warnings.length ? "warning" : "info",
  });
}

// ----------------------------------------------------------------------------
// Context-agnostic automatic recorder
// ----------------------------------------------------------------------------

export interface RecordOptions extends FlightMetadata {
  scope?: FlightScope;
  /** Optional caller-supplied phase timings (ms) for perf breakdown. */
  perf?: Partial<FlightPerformance>;
  reflectionEnabled?: boolean;
  qaEnabled?: boolean;
  promptVersion?: string;
}

/**
 * Wraps the existing `callAI`. Observes the execution and emits a FlightRecord
 * via the store sink. It NEVER changes the result or owns any logic — the AI
 * call is delegated verbatim to the single pipeline.
 */
export async function recordAI(
  opts: AICallOptions,
  rec: RecordOptions = {}
): Promise<AICallResult> {
  // Merge module-level context (set once per feature) when the caller did not
  // supply explicit metadata. Single metadata path — no duplication.
  const merged: RecordOptions = { ..._moduleContext, ...rec };
  const executionId = uid("fx");
  const t0 = Date.now();
  const timeline: FlightSpan[] = [{ name: "context", at: t0 }];

  const promptText = opts.messages
    ? JSON.stringify(opts.messages)
    : `${opts.systemPrompt ?? ""}\n@@@\n${opts.userPrompt ?? ""}`;
  const contextText = JSON.stringify({ resumeId: merged.resumeId, jdId: merged.jdId, interviewSessionId: merged.interviewSessionId });
  const promptHash = hashString(promptText);
  const contextHash = hashString(contextText);

  const warnings: string[] = [];
  const errors: string[] = [];
  let retryCount = 0;
  let status: ExecutionStatus = "running";
  let result: AICallResult | null = null;

  timeline.push({ name: "prompt", at: Date.now() });

  try {
    // Delegate to the SINGLE existing pipeline — no duplicate execution.
    // `callAIRaw` is imported lazily to avoid a static module-init cycle
    // (see header note). This is the only place that invokes the raw provider.
    const { callAIRaw } = await import("@/lib/ai");
    result = await callAIRaw(opts);
    timeline.push({ name: "provider", at: Date.now(), detail: result.provider });
    timeline.push({ name: "model", at: Date.now() });
    timeline.push({ name: "response", at: Date.now() });
    status = "completed";
  } catch (e: any) {
    errors.push(e?.message ?? String(e));
    status = "error";
    timeline.push({ name: "response", at: Date.now(), detail: "error" });
    throw e;
  } finally {
    const t1 = Date.now();
    const totalMs = t1 - t0;
    timeline.push({ name: "persist", at: t1, ms: totalMs });

    const inputTokens = result?.tokensEstimate ?? estTokens(opts.userPrompt ?? JSON.stringify(opts.messages ?? ""));
    const outputTokens = result ? Math.max(0, Math.round((result.text?.length ?? 0) / 4)) : 0;
    const cachedTokens = 0; // unknown from this layer; kept for schema completeness
    const provider = result?.provider ?? "unknown";
    const model = opts.modelOverride ?? provider;

    const record: FlightRecord = {
      executionId,
      timestamp: new Date(t0).toISOString(),
      feature: merged.feature,
      module: merged.module,
      sessionId: merged.sessionId,
      userId: merged.userId,
      resumeId: merged.resumeId,
      resumeVersion: merged.resumeVersion,
      jdId: merged.jdId,
      interviewSessionId: merged.interviewSessionId,
      scenarioId: merged.scenarioId,
      personaId: merged.personaId,
      company: merged.company,
      provider,
      model,
      temperature: opts.temperature,
      topP: (opts as any).topP,
      maxTokens: opts.maxTokens,
      streaming: Boolean((opts as any).streaming),
      promptVersion: merged.promptVersion ?? INTERVIEW_PROMPT_VERSION,
      promptHash,
      contextHash,
      durationMs: totalMs,
      latencyMs: result?.latencyMs ?? totalMs,
      tokenUsage: inputTokens,
      retryCount,
      reflectionEnabled: merged.reflectionEnabled ?? false,
      qaEnabled: merged.qaEnabled ?? false,
      validationResult: merged.interview?.branchReason ?? merged.resumeOpt?.validation,
      status,
      warnings,
      errors,
      interview: merged.interview,
      resumeOpt: merged.resumeOpt,
      prompt: {
        systemPrompt: opts.systemPrompt,
        userPrompt: opts.userPrompt ?? "",
        messages: opts.messages,
      },
      parameters: {
        temperature: opts.temperature,
        maxTokens: opts.maxTokens,
        modelOverride: opts.modelOverride,
        taskCategory: opts.taskCategory,
      },
      timeline,
      performance: {
        totalMs,
        providerMs: result?.latencyMs,
        ...merged.perf,
      },
      cost: {
        inputTokens,
        outputTokens,
        cachedTokens,
        estimatedCost: estimateCost(provider, model, inputTokens, outputTokens),
        provider,
        model,
      },
      scope: merged.scope ?? "interview",
    };

    emit(record);
  }

  return result!;
}

// ----------------------------------------------------------------------------
// Replay — reconstruct the exact call WITHOUT executing business logic.
// Returns the stored prompt + parameters so a caller can deterministically
// re-issue (or simply display) the original execution.
// ----------------------------------------------------------------------------

export interface ReplayPlan {
  executionId: string;
  provider: string;
  model: string;
  parameters: FlightRecord["parameters"];
  prompt: FlightRecord["prompt"];
  contextHash: string;
  promptHash: string;
  promptVersion: string;
}

export function buildReplayPlan(record: FlightRecord): ReplayPlan {
  return {
    executionId: record.executionId,
    provider: record.provider,
    model: record.model,
    parameters: record.parameters,
    prompt: record.prompt,
    contextHash: record.contextHash,
    promptHash: record.promptHash,
    promptVersion: record.promptVersion,
  };
}

// ----------------------------------------------------------------------------
// Filtering / search helpers (read-side; operate on already-persisted records)
// ----------------------------------------------------------------------------

export interface FlightFilter {
  resumeId?: string;
  jdId?: string;
  provider?: string;
  model?: string;
  interviewSessionId?: string;
  scenarioId?: string;
  executionId?: string;
  hasErrors?: boolean;
  hasWarnings?: boolean;
  minLatencyMs?: number;
  minTokens?: number;
  from?: string; // ISO date
  to?: string; // ISO date
}

/** Pure predicate over a parsed FlightRecord (the `details` of an audit log). */
export function matchesFlightFilter(record: FlightRecord, f: FlightFilter): boolean {
  if (f.resumeId && record.resumeId !== f.resumeId) return false;
  if (f.jdId && record.jdId !== f.jdId) return false;
  if (f.provider && record.provider !== f.provider) return false;
  if (f.model && record.model !== f.model) return false;
  if (f.interviewSessionId && record.interviewSessionId !== f.interviewSessionId) return false;
  if (f.scenarioId && record.scenarioId !== f.scenarioId) return false;
  if (f.executionId && record.executionId !== f.executionId) return false;
  if (f.hasErrors && record.errors.length === 0) return false;
  if (f.hasWarnings && record.warnings.length === 0) return false;
  if (f.minLatencyMs != null && record.latencyMs < f.minLatencyMs) return false;
  if (f.minTokens != null && record.tokenUsage < f.minTokens) return false;
  if (f.from && record.timestamp < f.from) return false;
  if (f.to && record.timestamp > f.to) return false;
  return true;
}

// ----------------------------------------------------------------------------
// Retention / cleanup policy (configurable). Records live in the store's log
// ring (capped at 500 by the store). This helper enforces an additional
// age-based retention for downstream export/pruning.
// ----------------------------------------------------------------------------

export interface RetentionPolicy {
  maxAgeDays: number;
  maxCount: number; // per scope
}

export const DEFAULT_RETENTION: RetentionPolicy = { maxAgeDays: 30, maxCount: 1000 };

export function isExpired(record: FlightRecord, policy: RetentionPolicy = DEFAULT_RETENTION): boolean {
  const ageMs = Date.now() - new Date(record.timestamp).getTime();
  return ageMs > policy.maxAgeDays * 86_400_000;
}

// ----------------------------------------------------------------------------
// helpers
// ----------------------------------------------------------------------------

function estTokens(s: string): number {
  return Math.ceil((s?.length ?? 0) / 4);
}
