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
// Phase 8.1.3.2A — middleware hooks + diagnostics. Imported lazily inside the
// try block to avoid a static cycle (see header note on callAIRaw).
import { runHooks } from "./hooks";
// Phase 8.1.3.3 — reflection prompt version constant (no runtime cycle: the
// engine's heavy `recordAI` import is lazy inside recordAI; this is a const).
import { REFLECTION_PROMPT_VERSION } from "./reflection-engine";
// Phase 8.1.3.4 — QA prompt version constant (same lazy-const pattern).
import { QA_PROMPT_VERSION } from "./qa-engine";
// Phase 8.1.3.5 — validation version constant (validation is deterministic and
// imports only types from this module, so a const import is safe; the engine's
// heavy `validate` fn is imported lazily inside recordAI like the others).
import { VALIDATION_VERSION } from "./validation-engine";
import { DECISION_VERSION } from "./decision-engine";

// ----------------------------------------------------------------------------
// Types
// ----------------------------------------------------------------------------

export type ExecutionStatus = "created" | "running" | "completed" | "error" | "retried";

/** Lifecycle span — the timeline. Stored inline for fast replay/render. */
export interface FlightSpan {
  name: "context" | "prompt" | "provider" | "model" | "streaming" | "retry" | "reflection" | "qa" | "validation" | "response" | "persist" | "decision";
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

/**
 * Internal-only diagnostics captured by recordAI (Phase 8.1.3.2A).
 * Exposes prompt/context versioning + assembly metrics + a configuration
 * snapshot. Never includes secrets or full payloads beyond what is already
 * in `prompt`/`cost`. Safe to emit into the audit log.
 */
export interface FlightDiagnostics {
  promptVersion: string;
  promptHash: string;
  contextHash: string;
  promptSize: number;
  contextSize: number;
  promptSource?: string;
  contextSource?: string;
  promptAssemblyMs?: number;
  contextAssemblyMs?: number;
  scope?: string;
  /** Snapshot of the execution-layer configuration actually used. */
  config: {
    temperature?: number;
    topP?: number;
    maxTokens?: number;
    model?: string;
    provider?: string;
    taskCategory?: string;
    streaming: boolean;
    agentTask?: string;
  };
  // Phase 8.1.3.2B — streaming diagnostics (observability only, no UI).
  executionType?: "streaming" | "non-streaming";
  streamingStatus?: "idle" | "streaming" | "completed" | "aborted" | "error";
  chunkCount?: number;
  streamingDurationMs?: number;
  abortReason?: string;
  // Phase 8.1.3.3 — reflection diagnostics (observability only, no UI).
  reflectionEnabled?: boolean;
  reflectionScore?: number;
  reflectionConfidence?: number;
  reflectionOutcome?: "ok" | "retry" | "error";
  reflectionRecommendedRetry?: boolean;
  // Phase 8.1.3.4 — QA diagnostics (observability only, no UI).
  qaEnabled?: boolean;
  qaScore?: number;
  qaConfidence?: number;
  qaOutcome?: "passed" | "failed" | "error";
  qaRecommendedFail?: boolean;
  qaFindings?: number;
  // Phase 8.1.3.5 — validation diagnostics (observability only, no UI).
  validationEnabled?: boolean;
  validationScore?: number;
  validationOutcome?: "passed" | "warning" | "failed" | "error";
  validationProfile?: string;
  validationRecommendedFail?: boolean;
  validationCriticalFailures?: number;
  validationRuleCount?: number;
  // Phase 8.1.3.6 — decision diagnostics (observability only, no UI).
  decisionEnabled?: boolean;
  decisionStatus?: "accept" | "retry" | "reject" | "escalate" | "human_review" | "continue" | "stop";
  decisionReason?: string;
  decisionConfidence?: number;
  decisionEvidence?: string;
  decisionRuleCount?: number;
}

/**
 * Phase 8.1.3.2B — streaming execution metadata captured by the recorder.
 * Recorded EXECUTION METADATA ONLY — never individual tokens. Observability
 * responsibility only; the recorder never performs or alters execution.
 */
export interface FlightStreamMeta {
  /** Number of text chunks delivered to the consumer. */
  chunkCount: number;
  /** Epoch ms when the first chunk was delivered (undefined if none). */
  streamingStartMs?: number;
  /** Epoch ms when streaming finished/aborted. */
  streamingEndMs?: number;
  /** Final streaming status. */
  streamingStatus: "streaming" | "completed" | "aborted" | "error";
  /** Reason when the stream was aborted/cancelled (e.g. AbortSignal). */
  abortReason?: string;
}

/**
 * Phase 8.1.3.3 — reflection captured by the recorder (observability ONLY).
 * The Reflection Engine produces this; the recorder never runs or alters it.
 * Contains the agreed ReflectionResult shape plus the execution metadata the
 * Flight Recorder must surface (provider/model/version/duration/cost/tokens).
 */
export interface FlightReflection {
  reflectionId: string;
  enabled: boolean;
  /** 0-100. */
  score: number;
  /** 0-100. */
  confidence: number;
  /** ok | retry | error. */
  outcome: "ok" | "retry" | "error";
  summary: string;
  strengths: string[];
  weaknesses: string[];
  missingInformation: string[];
  instructionViolations: string[];
  formatViolations: string[];
  reasoningIssues: string[];
  /** 0-1. */
  hallucinationRisk: number;
  /** 0-1. */
  determinismRisk: number;
  suggestedActions: string[];
  retryRecommended: boolean;
  retryReason: string;
  // Enterprise metrics required by the spec:
  promptVersion: string;
  durationMs?: number;
  latencyMs?: number;
  provider?: string;
  model?: string;
  cost?: number;
  tokens?: number;
  errors: string[];
}

/**
 * Phase8.1.3.4 — QA verdict captured by the recorder (observability ONLY).
 * The QA Engine produces this; the recorder never runs or alters it.
 * Mirrors FlightReflection's shape (score/confidence/outcome/findings/risks
 * + the execution metadata the Flight Recorder must surface).
 */
export interface FlightQA {
  qaId: string;
  enabled: boolean;
  /** 0-100. */
  score: number;
  /** 0-100. */
  confidence: number;
  /** passed | failed | error. */
  outcome: "passed" | "failed" | "error";
  summary: string;
  findings: { category: string; description: string; severity: "critical" | "major" | "minor" }[];
  /** 0-1. */
  hallucinationRisk: number;
  /** 0-1. */
  policyRisk: number;
  /** 0-1. */
  incompletenessRisk: number;
  passed: boolean;
  failRecommended: boolean;
  failReason: string;
  promptVersion: string;
  durationMs?: number;
  latencyMs?: number;
  provider?: string;
  model?: string;
  cost?: number;
  tokens?: number;
  errors: string[];
}

/**
 * Phase 8.1.3.5 — Validation verdict captured by the recorder (observability
 * ONLY). The Validation Engine produces this deterministically (no AI); the
 * recorder never runs or alters it. Mirrors FlightReflection/FlightQA shape
 * (score/status/evidence + the metadata the Flight Recorder must surface).
 */
export interface FlightValidation {
  validationId: string;
  enabled: boolean;
  /** 0-100 weighted rule score. */
  score: number;
  /** passed | warning | failed | error. */
  outcome: "passed" | "warning" | "failed" | "error";
  profile: string;
  rules: {
    ruleId: string;
    profile: string;
    kind: "required" | "optional" | "critical" | "warning";
    outcome: "pass" | "warning" | "fail";
    reason: string;
    evidence: string;
    severity: "critical" | "major" | "minor";
  }[];
  warnings: string[];
  failures: string[];
  reasons: string[];
  criticalFailures: number;
  passed: boolean;
  failRecommended: boolean;
  deterministic: true;
  version: string;
  durationMs: number;
  errors: string[];
}

/**
 * Phase 8.1.3.6 — Decision verdict captured by the recorder (observability
 * ONLY). The Decision Engine produces this deterministically (no AI); the
 * recorder never runs or alters it. Mirrors FlightReflection/FlightQA/
 * FlightValidation shape (status/reason/evidence + the rule trace the Flight
 * Recorder must surface).
 */
export interface FlightDecision {
  decisionId: string;
  enabled: boolean;
  /** accept | retry | reject | escalate | human_review | continue | stop. */
  status: "accept" | "retry" | "reject" | "escalate" | "human_review" | "continue" | "stop";
  reason: string;
  /** 0-1 confidence in the decision. */
  confidence: number;
  evidence: string;
  /** Ordered rule trace (ruleId + triggered + status). */
  trace: { ruleId: string; triggered: boolean; status: string }[];
  /** Rules that fired. */
  rules: {
    ruleId: string;
    profile: string;
    status: string;
    confidence: number;
    reason: string;
    evidence: string;
    triggered: boolean;
  }[];
  supportingReflection?: string;
  supportingQA?: string;
  supportingValidation?: string;
  deterministic: true;
  version: string;
  durationMs: number;
  errors: string[];
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
  /** Whether Validation middleware ran for this execution. */
  validationEnabled?: boolean;
  validationResult?: string;
  /** Whether Decision middleware ran for this execution. */
  decisionEnabled?: boolean;
  decisionResult?: string;
  status: ExecutionStatus;
  warnings: string[];
  errors: string[];

  // Domain metadata (one of the two, optional)
  interview?: InterviewContextMeta;
  resumeOpt?: ResumeOptContextMeta;

  // Replay payload — enough to reconstruct the exact call WITHOUT re-executing.
  prompt: { systemPrompt?: string; userPrompt: string; messages?: AICallOptions["messages"] };
  parameters: { temperature?: number; topP?: number; maxTokens?: number; modelOverride?: string; taskCategory?: string };

  // Phase 8.1.3.2A — internal diagnostics (no UI, no secrets). Captures prompt/
  // context versioning + assembly metrics + a configuration snapshot so future
  // phases (Reflection/QA/Validation) can reason about an execution offline.
  diagnostics?: FlightDiagnostics;

  // Phase 8.1.3.2B — streaming execution metadata (observability only).
  streamMeta?: FlightStreamMeta;

  // Phase 8.1.3.3 — reflection captured automatically when enabled
  // (observability only; the Reflection Engine owns the logic).
  reflection?: FlightReflection;

  // Phase 8.1.3.4 — QA verdict captured automatically when enabled
  // (observability only; the QA Engine owns the logic).
  qa?: FlightQA;

  // Phase 8.1.3.5 — Validation verdict captured automatically when enabled
  // (observability only; the Validation Engine — deterministic — owns logic).
  validation?: FlightValidation;

  // Phase 8.1.3.6 — Decision verdict captured automatically when enabled
  // (observability only; the Decision Engine — deterministic — owns logic).
  decision?: FlightDecision;

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
  /** Phase 8.1.3.5 — validation (deterministic) switch. */
  validationEnabled?: boolean;
  promptVersion?: string;
  /** Phase 8.1.3.2B — streaming mode. When true, `onChunk` receives progressive
   *  text and the execution is recorded as streaming. */
  stream?: boolean;
  /** Progressive text delivery callback (streaming mode only). */
  onChunk?: (chunk: string) => void;
  /** Phase 8.1.3.3 — reflection configuration. When set (and merged
   *  reflectionEnabled is true), the Reflection Engine runs as middleware. */
  reflectionConfig?: import("./reflection-engine").ReflectionConfig;
  /** Phase 8.1.3.4 — QA configuration. When set (and merged qaEnabled is true),
   *  the QA Engine runs as middleware. */
  qaConfig?: import("./qa-engine").QAConfig;
  /** Phase 8.1.3.5 — validation configuration. When set (and merged
   *  validationEnabled is true), the Validation Engine runs as middleware. */
  validationConfig?: import("./validation-engine").ValidationConfig;
  /** Phase 8.1.3.6 — decision (deterministic) switch. */
  decisionEnabled?: boolean;
  /** Phase 8.1.3.6 — decision configuration. When set (and merged
   *  decisionEnabled is true), the Decision Engine runs as middleware (after
   *  Validation). */
  decisionConfig?: import("./decision-engine").DecisionConfig;
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
  // Phase 8.1.3.3 — a supplied reflectionConfig implies reflection is desired;
  // normalize so the rest of the pipeline keys off a single boolean.
  if (merged.reflectionConfig?.reflectionEnabled) {
    merged.reflectionEnabled = true;
  }
  if (merged.qaConfig?.qaEnabled) {
    merged.qaEnabled = true;
  }
  if (merged.validationConfig?.validationEnabled) {
    merged.validationEnabled = true;
  }
  if (merged.decisionConfig?.decisionEnabled) {
    merged.decisionEnabled = true;
  }
  const executionId = uid("fx");
  const t0 = Date.now();
  const timeline: FlightSpan[] = [{ name: "context", at: t0 }];

  // Phase 8.1.3.2A — prompt/context diagnostics. Reuses the same hashing the
  // recorder already did; these here additionally capture size + source.
  const promptText = opts.messages
    ? JSON.stringify(opts.messages)
    : `${opts.systemPrompt ?? ""}\n@@@\n${opts.userPrompt ?? ""}`;
  const contextText = JSON.stringify({ resumeId: merged.resumeId, jdId: merged.jdId, interviewSessionId: merged.interviewSessionId });
  const promptHash = hashString(promptText);
  const contextHash = hashString(contextText);
  const promptSize = promptText.length;
  const contextSize = contextText.length;

  const warnings: string[] = [];
  const errors: string[] = [];
  const hookNotes: string[] = [];
  let retryCount = 0;
  let status: ExecutionStatus = "running";
  let result: AICallResult | null = null;
  // Phase 8.1.3.3 — reflection result captured for the record (null when disabled).
  let flightReflection: FlightReflection | null = null;
  // Phase 8.1.3.4 — QA result captured for the record (null when disabled).
  let flightQA: FlightQA | null = null;
  // Phase 8.1.3.5 — Validation result captured for the record (null when disabled).
  let flightValidation: FlightValidation | null = null;
  // Phase 8.1.3.6 — Decision result captured for the record (null when disabled).
  let flightDecision: FlightDecision | null = null;

  // Phase 8.1.3.2B — streaming state (metadata only; never holds tokens).
  const isStreaming = Boolean(merged.stream);
  let chunkCount = 0;
  let streamingStartMs: number | undefined;
  let streamingStatus: "streaming" | "completed" | "aborted" | "error" = "streaming";
  let abortReason: string | undefined;

  // Phase 8.1.3.2A — extension points. Hooks are no-ops unless registered; they
  // cannot change execution (they are observability seams for future phases).
  await runHooks("BeforePrompt", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts });
  await runHooks("AfterPrompt", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts });
  await runHooks("BeforeContext", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts });
  await runHooks("AfterContext", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, notes: hookNotes });

  timeline.push({ name: "prompt", at: Date.now() });

  // Wrapper that counts + timestamps chunks and forwards to the consumer.
  const deliverChunk = (chunk: string) => {
    if (chunk.length === 0) return;
    if (chunkCount === 0) streamingStartMs = Date.now();
    chunkCount++;
    merged.onChunk?.(chunk);
  };

  try {
    // Delegate to the SINGLE existing pipeline — no duplicate execution.
    // `callAIRaw` / `callAIRawStreamed` are imported lazily to avoid a static
    // module-init cycle (see header note). This is the only place that invokes
    // the raw provider, streaming or not. The ONLY difference between the two
    // paths is response delivery — everything else is identical.
    await runHooks("BeforeProvider", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts });
    const { callAIRaw, callAIRawStreamed } = await import("@/lib/ai");
    if (isStreaming) {
      result = await callAIRawStreamed(opts, deliverChunk);
      streamingStatus = "completed";
    } else {
      result = await callAIRaw(opts);
    }
    await runHooks("AfterProvider", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, result });
    timeline.push({ name: "provider", at: Date.now(), detail: result.provider });
    timeline.push({ name: "model", at: Date.now() });
    if (isStreaming) timeline.push({ name: "streaming", at: Date.now(), detail: `${chunkCount} chunks` });
    await runHooks("BeforeResponse", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, result });
    timeline.push({ name: "response", at: Date.now() });
    await runHooks("AfterResponse", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, result });
    status = "completed";

    // Phase 8.1.3.3 — Reflection (MIDDLEWARE, observability only).
    // Runs ONLY after the response is fully assembled (streaming-safe: the
    // final chunk has already been delivered above), and ONLY when reflection is
    // enabled. Reflection NEVER mutates `result` — it produces structured
    // feedback that future phases (Decision/Retry Engine) may act on.
    if (merged.reflectionEnabled && result) {
      const tRef = Date.now();
      timeline.push({ name: "reflection", at: tRef });
      const originalPromptText = opts.messages
        ? JSON.stringify(opts.messages)
        : `${opts.systemPrompt ?? ""}\n@@@\n${opts.userPrompt ?? ""}`;
      const executionContextText = JSON.stringify({
        scope: merged.scope,
        feature: merged.feature,
        resumeId: merged.resumeId,
        jdId: merged.jdId,
      });
      const { reflect } = await import("./reflection-engine");
      try {
        const reflectionResult = await reflect({
          executionId,
          originalPrompt: originalPromptText,
          executionContext: executionContextText,
          aiResponseText: result.text,
          scope: merged.scope,
          opts,
          config: merged.reflectionConfig,
          signal: opts.signal,
        });
        flightReflection = {
          reflectionId: reflectionResult.reflectionId,
          enabled: true,
          score: reflectionResult.overallScore,
          confidence: reflectionResult.confidence,
          outcome: reflectionResult.status,
          summary: reflectionResult.summary,
          strengths: reflectionResult.strengths,
          weaknesses: reflectionResult.weaknesses,
          missingInformation: reflectionResult.missingInformation,
          instructionViolations: reflectionResult.instructionViolations,
          formatViolations: reflectionResult.formatViolations,
          reasoningIssues: reflectionResult.reasoningIssues,
          hallucinationRisk: reflectionResult.hallucinationRisk,
          determinismRisk: reflectionResult.determinismRisk,
          suggestedActions: reflectionResult.suggestedActions,
          retryRecommended: reflectionResult.retryRecommended,
          retryReason: reflectionResult.retryReason,
          promptVersion: reflectionResult.metadata.promptVersion,
          durationMs: reflectionResult.metadata.durationMs,
          latencyMs: reflectionResult.metadata.latencyMs,
          provider: reflectionResult.metadata.provider,
          model: reflectionResult.metadata.model,
          cost: reflectionResult.metadata.cost,
          tokens: reflectionResult.metadata.tokens,
          errors: reflectionResult.metadata.error ? [reflectionResult.metadata.error] : [],
        };
      } catch (re: any) {
        flightReflection = {
          reflectionId: uid("rfx"),
          enabled: true,
          score: 0,
          confidence: 0,
          outcome: "error",
          summary: "Reflection failed.",
          strengths: [],
          weaknesses: [],
          missingInformation: [],
          instructionViolations: [],
          formatViolations: [],
          reasoningIssues: [],
          hallucinationRisk: 1,
          determinismRisk: 1,
          suggestedActions: [],
          retryRecommended: false,
          retryReason: "reflection error",
          promptVersion: REFLECTION_PROMPT_VERSION,
          errors: [re?.message ?? String(re)],
        };
      }
      timeline.push({ name: "reflection", at: Date.now(), detail: flightReflection.outcome });
      await runHooks("OnReflection", {
        executionId,
        scope: merged.scope,
        feature: merged.feature,
        module: merged.module,
        opts,
        result,
        notes: hookNotes,
      });
    }

    // Phase 8.1.3.4 — QA (MIDDLEWARE, observability only).
    // Runs ONLY after the response is fully assembled (streaming-safe: the
    // final chunk has already been delivered above) and ONLY when QA is enabled.
    // QA NEVER mutates `result` — it produces structured findings that future
    // phases (Decision/Retry Engine, Validation) may act on.
    if (merged.qaEnabled && result) {
      const tQA = Date.now();
      timeline.push({ name: "qa", at: tQA });
      const originalPromptText = opts.messages
        ? JSON.stringify(opts.messages)
        : `${opts.systemPrompt ?? ""}\n@@@\n${opts.userPrompt ?? ""}`;
      const executionContextText = JSON.stringify({
        scope: merged.scope,
        feature: merged.feature,
        resumeId: merged.resumeId,
        jdId: merged.jdId,
      });
      const { qa } = await import("./qa-engine");
      try {
        const qaResult = await qa({
          executionId,
          originalPrompt: originalPromptText,
          executionContext: executionContextText,
          aiResponseText: result.text,
          scope: merged.scope,
          opts,
          config: merged.qaConfig,
          signal: opts.signal,
        });
        flightQA = {
          qaId: qaResult.qaId,
          enabled: true,
          score: qaResult.overallScore,
          confidence: qaResult.confidence,
          outcome: qaResult.status,
          summary: qaResult.summary,
          findings: qaResult.findings,
          hallucinationRisk: qaResult.hallucinationRisk,
          policyRisk: qaResult.policyRisk,
          incompletenessRisk: qaResult.incompletenessRisk,
          passed: qaResult.passed,
          failRecommended: qaResult.failRecommended,
          failReason: qaResult.failReason,
          promptVersion: qaResult.metadata.promptVersion,
          durationMs: qaResult.metadata.durationMs,
          latencyMs: qaResult.metadata.latencyMs,
          provider: qaResult.metadata.provider,
          model: qaResult.metadata.model,
          cost: qaResult.metadata.cost,
          tokens: qaResult.metadata.tokens,
          errors: qaResult.metadata.error ? [qaResult.metadata.error] : [],
        };
      } catch (qe: any) {
        flightQA = {
          qaId: uid("qfx"),
          enabled: true,
          score: 0,
          confidence: 0,
          outcome: "error",
          summary: "QA failed.",
          findings: [],
          hallucinationRisk: 0,
          policyRisk: 0,
          incompletenessRisk: 0,
          passed: false,
          failRecommended: false,
          failReason: "qa error",
          promptVersion: QA_PROMPT_VERSION,
          errors: [qe?.message ?? String(qe)],
        };
      }
      timeline.push({ name: "qa", at: Date.now(), detail: flightQA.outcome });
      await runHooks("OnQA", {
        executionId,
        scope: merged.scope,
        feature: merged.feature,
        module: merged.module,
        opts,
        result,
        notes: hookNotes,
      });
    }

    // Phase 8.1.3.5 — Validation (MIDDLEWARE, deterministic, observability only).
    // Runs ONLY after the response is fully assembled AND after Reflection/QA (so
    // it can CONSUME their results) — streaming-safe for the same reason (the
    // final chunk was already delivered). Validation is PURE + DETERMINISTIC: it
    // never executes AI, never mutates `result`, and never retries. It applies the
    // scope's Validation Profile (rule set) and records the verdict.
    if (merged.validationEnabled && result) {
      const tVal = Date.now();
      timeline.push({ name: "validation", at: tVal });
      const originalPromptText = opts.messages
        ? JSON.stringify(opts.messages)
        : `${opts.systemPrompt ?? ""}\n@@@\n${opts.userPrompt ?? ""}`;
      const executionContextText = JSON.stringify({
        scope: merged.scope,
        feature: merged.feature,
        resumeId: merged.resumeId,
        jdId: merged.jdId,
      });
      const { validate } = await import("./validation-engine");
      try {
        const validationResult = validate({
          executionId,
          prompt: originalPromptText,
          context: executionContextText,
          response: result.text,
          scope: merged.scope,
          reflection: flightReflection,
          qa: flightQA,
          config: merged.validationConfig,
        });
        flightValidation = {
          validationId: validationResult.validationId,
          enabled: true,
          score: validationResult.score,
          outcome: validationResult.status,
          profile: validationResult.profile,
          rules: validationResult.rules,
          warnings: validationResult.warnings,
          failures: validationResult.failures,
          reasons: validationResult.reasons,
          criticalFailures: validationResult.criticalFailures,
          passed: validationResult.passed,
          failRecommended: validationResult.failRecommended,
          deterministic: true,
          version: validationResult.version,
          durationMs: validationResult.durationMs,
          errors: validationResult.errors,
        };
      } catch (ve: any) {
        flightValidation = {
          validationId: uid("vfx"),
          enabled: true,
          score: 0,
          outcome: "error",
          profile: merged.scope ?? "default",
          rules: [],
          warnings: [],
          failures: [],
          reasons: [],
          criticalFailures: 0,
          passed: false,
          failRecommended: false,
          deterministic: true,
          version: VALIDATION_VERSION,
          durationMs: Date.now() - tVal,
          errors: [ve?.message ?? String(ve)],
        };
      }
      timeline.push({ name: "validation", at: Date.now(), detail: flightValidation.outcome });
      await runHooks("OnValidation", {
        executionId,
        scope: merged.scope,
        feature: merged.feature,
        module: merged.module,
        opts,
        result,
        notes: hookNotes,
      });
    }

    // Phase8.1.3.6 — Decision (MIDDLEWARE, deterministic, observability only).
    // Runs ONLY after the response is fully assembled AND after Reflection/QA/
    // Validation (so it can CONSUME their verdicts) — streaming-safe for the
    // same reason (the final chunk was already delivered). Decision is PURE +
    // DETERMINISTIC: it never executes AI, never mutates `result`, and never
    // retries. It applies the scope's Decision Profile (rule set) and records
    // the verdict. A "retry" verdict is EMIT-ONLY this phase (re-execution is
    // the mandate of 8.1.3.7).
    if (merged.decisionEnabled && result) {
      const tDec = Date.now();
      timeline.push({ name: "decision", at: tDec });
      const { decide } = await import("./decision-engine");
      try {
        const decisionResult = decide({
          executionId,
          scope: merged.scope,
          reflection: flightReflection,
          qa: flightQA,
          validation: flightValidation,
          config: merged.decisionConfig,
        });
        flightDecision = {
          decisionId: decisionResult.decisionId,
          enabled: true,
          status: decisionResult.status,
          reason: decisionResult.reason,
          confidence: decisionResult.confidence,
          evidence: decisionResult.evidence,
          trace: decisionResult.trace,
          rules: decisionResult.rules,
          supportingReflection: decisionResult.supportingReflection,
          supportingQA: decisionResult.supportingQA,
          supportingValidation: decisionResult.supportingValidation,
          deterministic: true,
          version: decisionResult.version,
          durationMs: decisionResult.durationMs,
          errors: decisionResult.errors,
        };
      } catch (de: any) {
        flightDecision = {
          decisionId: uid("dcx"),
          enabled: true,
          status: "continue",
          reason: "decision error",
          confidence: 0,
          evidence: "",
          trace: [],
          rules: [],
          deterministic: true,
          version: DECISION_VERSION,
          durationMs: Date.now() - tDec,
          errors: [de?.message ?? String(de)],
        };
      }
      timeline.push({ name: "decision", at: Date.now(), detail: flightDecision.status });
      await runHooks("OnDecision", {
        executionId,
        scope: merged.scope,
        feature: merged.feature,
        module: merged.module,
        opts,
        result,
        notes: hookNotes,
      });
    }

    await runHooks("OnSuccess", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, result });
  } catch (e: any) {
    errors.push(e?.message ?? String(e));
    status = "error";
    const isAbort = e?.name === "AbortError" || opts.signal?.aborted;
    if (isStreaming) {
      streamingStatus = isAbort ? "aborted" : "error";
      if (isAbort) abortReason = e?.message || "AbortSignal";
    }
    timeline.push({ name: "response", at: Date.now(), detail: "error" });
    const isTimeout = e?.name === "AbortError" || /timeout|timed? ?out/i.test(e?.message ?? "");
    if (isTimeout) {
      await runHooks("OnTimeout", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, error: e, notes: hookNotes });
    } else {
      await runHooks("OnFailure", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, error: e, notes: hookNotes });
    }
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
      streaming: isStreaming,
      promptVersion: merged.promptVersion ?? INTERVIEW_PROMPT_VERSION,
      promptHash,
      contextHash,
      durationMs: totalMs,
      latencyMs: result?.latencyMs ?? totalMs,
      tokenUsage: inputTokens,
      retryCount,
      reflectionEnabled: merged.reflectionEnabled ?? false,
      qaEnabled: merged.qaEnabled ?? false,
      validationEnabled: merged.validationEnabled ?? false,
      validationResult: merged.interview?.branchReason ?? merged.resumeOpt?.validation,
      decisionEnabled: merged.decisionEnabled ?? false,
      decisionResult: flightDecision?.status,
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
        topP: opts.topP,
        maxTokens: opts.maxTokens,
        modelOverride: opts.modelOverride,
        taskCategory: opts.taskCategory,
      },
      timeline,
      performance: {
        totalMs,
        providerMs: result?.latencyMs,
        reflectionMs: flightReflection?.durationMs,
        qaMs: flightQA?.durationMs,
        validationMs: flightValidation?.durationMs,
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
      // Phase 8.1.3.2A — internal diagnostics (prompt/context versioning,
      // assembly metrics, config snapshot). No UI; safe to emit to the audit log.
      diagnostics: {
        promptVersion: merged.promptVersion ?? INTERVIEW_PROMPT_VERSION,
        promptHash,
        contextHash,
        promptSize,
        contextSize,
        scope: merged.scope,
        config: {
          temperature: opts.temperature,
          topP: opts.topP,
          maxTokens: opts.maxTokens,
          model: opts.modelOverride,
          provider,
          taskCategory: opts.taskCategory,
          streaming: isStreaming,
          agentTask: (opts as any).agentTask,
        },
        // Phase 8.1.3.2B — streaming diagnostics (observability only).
        executionType: isStreaming ? "streaming" : "non-streaming",
        streamingStatus: isStreaming ? streamingStatus : undefined,
        chunkCount: isStreaming ? chunkCount : undefined,
        streamingDurationMs: isStreaming && streamingStartMs ? t1 - streamingStartMs : undefined,
        abortReason: isStreaming ? abortReason : undefined,
        // Phase 8.1.3.3 — reflection diagnostics (observability only).
        reflectionEnabled: merged.reflectionEnabled ?? false,
        reflectionScore: flightReflection?.score,
        reflectionConfidence: flightReflection?.confidence,
        reflectionOutcome: flightReflection?.outcome,
        reflectionRecommendedRetry: flightReflection?.retryRecommended,
        // Phase 8.1.3.4 — QA diagnostics (observability only).
        qaEnabled: merged.qaEnabled ?? false,
        qaScore: flightQA?.score,
        qaConfidence: flightQA?.confidence,
        qaOutcome: flightQA?.outcome,
        qaRecommendedFail: flightQA?.failRecommended,
        qaFindings: flightQA?.findings.length ?? 0,
        // Phase 8.1.3.5 — validation diagnostics (observability only).
        validationEnabled: merged.validationEnabled ?? false,
        validationScore: flightValidation?.score,
        validationOutcome: flightValidation?.outcome,
        validationProfile: flightValidation?.profile,
        validationRecommendedFail: flightValidation?.failRecommended,
        validationCriticalFailures: flightValidation?.criticalFailures ?? 0,
        validationRuleCount: flightValidation?.rules.length ?? 0,
        // Phase 8.1.3.6 — decision diagnostics (observability only).
        decisionEnabled: merged.decisionEnabled ?? false,
        decisionStatus: flightDecision?.status,
        decisionReason: flightDecision?.reason,
        decisionConfidence: flightDecision?.confidence,
        decisionEvidence: flightDecision?.evidence,
        decisionRuleCount: flightDecision?.rules.length ?? 0,
      },
      // Phase 8.1.3.2B — streaming execution metadata (observability only).
      streamMeta: isStreaming
        ? {
            chunkCount,
            streamingStartMs,
            streamingEndMs: t1,
            streamingStatus,
            abortReason,
          }
        : undefined,
      // Phase 8.1.3.3 — reflection (observability only; engine owns logic).
      reflection: flightReflection ?? undefined,
      // Phase 8.1.3.4 — QA verdict (observability only; engine owns logic).
      qa: flightQA ?? undefined,
      // Phase 8.1.3.5 — Validation verdict (observability only; engine owns logic).
      validation: flightValidation ?? undefined,
      // Phase 8.1.3.6 — Decision verdict (observability only; engine owns logic).
      decision: flightDecision ?? undefined,
    };

    await runHooks("BeforePersist", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, result, notes: hookNotes });
    emit(record);
    await runHooks("AfterPersist", { executionId, scope: merged.scope, feature: merged.feature, module: merged.module, opts, result, notes: hookNotes });
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
