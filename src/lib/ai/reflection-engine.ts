// ============================================================================
// Enterprise Reflection Engine — Phase 8.1.3.3
//
// ONE reusable Reflection Engine for the Enterprise AI Core. Reflection
// evaluates an AI response AFTER generation; it NEVER changes the original
// response and NEVER owns a second AI pipeline. It produces ONLY structured
// feedback (a ReflectionResult). The middleware (recordAI) decides whether a
// retry/improvement is required — not this engine.
//
// MANDATE:
//   - Reflection is MIDDLEWARE, not feature logic. Features gain it simply by
//     executing through recordAI with reflectionEnabled.
//   - It reuses the Prompt Builder + Context Builder + the SAME recordAI()
//     execution path (via the dedicated reflection scope) — no duplicated
//     prompts, no duplicated context, no second pipeline.
//   - The Reflection Prompt is SHARED and feature-agnostic. It evaluates
//     instruction compliance, completeness, accuracy, reasoning, formatting,
//     policy, context usage, missing info, answer quality, and determinism.
//   - The engine parses the model's structured verdict and returns a typed
//     ReflectionResult. Parsing failures degrade gracefully (status: "error").
// ============================================================================

import { PromptBuilder } from "./prompt-builder";
import { ContextBuilder } from "./context-builder";
import { recordAI, hashString } from "./flight-recorder";
import { uid } from "@/lib/store";
import type { AICallOptions } from "@/lib/ai";
import type { SchemaSpec } from "@/lib/agents/structured-output";

export const REFLECTION_PROMPT_VERSION = "8.1.3.3";

/** Shared, feature-agnostic reflection verdict rubric. */
export interface ReflectionConfig {
  /** Master switch (global or per-scope). */
  reflectionEnabled: boolean;
  /** overallScore < threshold => retryRecommended. Range 0-100. */
  reflectionThreshold: number;
  /** Max tokens for the reflection pass. */
  maxReflectionTokens: number;
  /** Optional model override for the reflection pass (reuse AI config). */
  reflectionModelOverride?: string;
  /** Optional provider override for the reflection pass. */
  reflectionProviderOverride?: string;
  /** Optional temperature for the reflection pass (lower = more deterministic). */
  reflectionTemperature?: number;
  /** Optional timeout (ms) for the reflection pass. */
  reflectionTimeout?: number;
}

export const DEFAULT_REFLECTION_CONFIG: ReflectionConfig = {
  reflectionEnabled: false,
  reflectionThreshold: 70,
  maxReflectionTokens: 1500,
  reflectionTemperature: 0.2,
};

// Per-scope overrides. Reuses the existing shared-config ownership pattern
// (a single module registry updated at init) — NOT a new configuration system.
const scopeOverrides = new Map<string, Partial<ReflectionConfig>>();

export function setReflectionConfigForScope(scope: string, cfg: Partial<ReflectionConfig>): void {
  scopeOverrides.set(scope, cfg);
}

export function getReflectionConfig(scope?: string): ReflectionConfig {
  const base = { ...DEFAULT_REFLECTION_CONFIG };
  if (scope) {
    const o = scopeOverrides.get(scope);
    if (o) return { ...base, ...o };
  }
  return base;
}

export type ReflectionStatus = "ok" | "retry" | "error";

/** The single structured feedback object Reflection produces. */
export interface ReflectionResult {
  reflectionId: string;
  executionId: string;
  /** 0-100 quality/pass score. */
  overallScore: number;
  /** 0-100 confidence in the verdict. */
  confidence: number;
  summary: string;
  strengths: string[];
  weaknesses: string[];
  missingInformation: string[];
  instructionViolations: string[];
  formatViolations: string[];
  reasoningIssues: string[];
  /** 0-1 risk the response contains fabricated content. */
  hallucinationRisk: number;
  /** 0-1 risk the response is non-deterministic / unstable. */
  determinismRisk: number;
  suggestedActions: string[];
  retryRecommended: boolean;
  retryReason: string;
  status: ReflectionStatus;
  metadata: {
    promptVersion: string;
    promptHash: string;
    provider?: string;
    model?: string;
    durationMs?: number;
    latencyMs?: number;
    tokens?: number;
    cost?: number;
    error?: string;
  };
}

const clamp01 = (n: unknown): number => {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return Math.min(1, Math.max(0, v));
};
const clampScore = (n: unknown): number => {
  const v = typeof n === "number" && isFinite(n) ? n : 0;
  return Math.min(100, Math.max(0, Math.round(v)));
};

function asStringArray(v: unknown): string[] {
  if (Array.isArray(v)) return v.filter((x) => typeof x === "string").map((x) => String(x));
  if (typeof v === "string" && v.trim()) return [v];
  return [];
}

/** Build the SHARED, feature-agnostic reflection prompt via Prompt+Context Builders. */
export function buildReflectionPrompt(args: {
  originalPrompt: string;
  executionContext: string;
  aiResponse: string;
  contextHash?: string;
}): { systemPrompt: string; userPrompt: string } {
  const pb = new PromptBuilder({
    scope: "future-agents",
    feature: "Reflection Engine",
    version: REFLECTION_PROMPT_VERSION,
  })
    .system(
      "You are an Enterprise Reflection Engine. You evaluate an AI-generated response AFTER it was produced. " +
        "You NEVER rewrite or alter the response. You ONLY assess it and return structured feedback as JSON." +
        "\n\nEvaluate these dimensions:" +
        "\n1. Instruction compliance — did the response follow all explicit instructions?" +
        "\n2. Completeness — is the response complete for the request?" +
        "\n3. Accuracy — is the content factually consistent with the provided context?" +
        "\n4. Reasoning quality — is any reasoning sound and non-contradictory?" +
        "\n5. Formatting — does it match the requested format (JSON / markdown / plain)?" +
        "\n6. Enterprise policy compliance — free of fabricated credentials, PII, or unsafe content?" +
        "\n7. Context usage — did it use the provided context appropriately without inventing facts?" +
        "\n8. Missing information — what is absent that should be present?" +
        "\n9. Answer quality — is it useful, coherent, and on-topic?" +
        "\n10. Determinism — is the response stable and not self-contradictory?",
    )
    .user(
      "Return ONLY a JSON object with these exact keys:\n" +
        "{\n" +
        '  "overallScore": <0-100>,\n' +
        '  "confidence": <0-100>,\n' +
        '  "summary": "<one sentence>",\n' +
        '  "strengths": [strings],\n' +
        '  "weaknesses": [strings],\n' +
        '  "missingInformation": [strings],\n' +
        '  "instructionViolations": [strings],\n' +
        '  "formatViolations": [strings],\n' +
        '  "reasoningIssues": [strings],\n' +
        '  "hallucinationRisk": <0-1>,\n' +
        '  "determinismRisk": <0-1>,\n' +
        '  "suggestedActions": [strings],\n' +
        '  "retryRecommended": <true|false>,\n' +
        '  "retryReason": "<why or empty string>"\n' +
        "}\n" +
        "No markdown fences. No prose outside the JSON.",
    )
    .build();

  const userPrompt = new ContextBuilder({ scope: "future-agents", feature: "Reflection Engine" })
    .feature("ORIGINAL PROMPT:\n" + args.originalPrompt)
    .feature("EXECUTION CONTEXT:\n" + args.executionContext)
    .feature("AI RESPONSE TO EVALUATE:\n" + args.aiResponse)
    .add("future-hermes", args.contextHash ? "contextHash: " + args.contextHash : "")
    .build().text;

  return { systemPrompt: pb.systemPrompt ?? "", userPrompt };
}

/**
 * Run Reflection over a completed execution. Produces structured feedback only.
 * Executes through the SAME recordAI() pipeline under a dedicated reflection
 * scope (observability + hooks apply) — never a second pipeline.
 *
 * `aiResponseText` is the generated text; `originalPrompt`/`executionContext`
 * describe what was asked. `opts` carries the caller's AICallOptions (so the
 * reflection pass can inherit provider/model config via overrides).
 */
export async function reflect(args: {
  executionId: string;
  originalPrompt: string;
  executionContext: string;
  aiResponseText: string;
  scope?: string;
  opts?: AICallOptions;
  config?: ReflectionConfig;
  signal?: AbortSignal;
}): Promise<ReflectionResult> {
  const t0 = Date.now();
  const cfg = args.config ?? getReflectionConfig(args.scope);
  const reflectionId = uid("rfx");
  const contextHash = hashString(args.executionContext || "");

  const baseMeta = { promptVersion: REFLECTION_PROMPT_VERSION, promptHash: hashString(args.aiResponseText) };

  const disabled: ReflectionResult = {
    reflectionId,
    executionId: args.executionId,
    overallScore: 0,
    confidence: 0,
    summary: "",
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
    retryReason: "reflection disabled",
    status: "error",
    metadata: { ...baseMeta, error: "reflection disabled" },
  };

  if (!cfg.reflectionEnabled) {
    return disabled;
  }

  const { systemPrompt, userPrompt } = buildReflectionPrompt({
    originalPrompt: args.originalPrompt,
    executionContext: args.executionContext,
    aiResponse: args.aiResponseText,
    contextHash,
  });

  const callOpts: AICallOptions = {
    systemPrompt,
    userPrompt,
    maxTokens: cfg.maxReflectionTokens,
    temperature: cfg.reflectionTemperature ?? 0.2,
    modelOverride: cfg.reflectionModelOverride,
    providerId: cfg.reflectionProviderOverride,
    taskCategory: "interactive",
    agentTask: "reflection",
    signal: args.signal ?? args.opts?.signal,
  };

  const REFLECTION_VERDICT_SCHEMA: SchemaSpec = {
    type: "object",
    required: ["overallScore"],
    properties: {
      overallScore: { type: "number" },
      confidence: { type: "number" },
      summary: { type: "string" },
      strengths: { type: "array", items: { type: "string" } },
      weaknesses: { type: "array", items: { type: "string" } },
    },
    label: "reflection verdict",
  };

  try {
    // STRUCTURED OUTPUT (directive: agents never free-parse): robust cascade
    // + ONE bounded parse-error repair round — the parse failure itself is fed
    // back into the prompt. Previously a bare JSON.parse dropped the ENTIRE
    // verdict on prose-wrapped/truncated output ("reflection parse failure").
    // NOTE: lazily imported — see qa-engine.ts for the cycle rationale.
    const { runWithParseRepair } = await import("@/lib/agents/structured-output");
    let lastProvider = "";
    let lastLatencyMs = 0;
    let lastTokensEstimate = 0;
    let invokeError = "";
    let invokeThrew = false;
    const { data: parsed } = await runWithParseRepair<any>(
      async (repairFeedback) => {
        let res: any;
        try {
          res = (await recordAI(
          repairFeedback
            ? { ...callOpts, userPrompt: `${callOpts.userPrompt ?? ""}\n\n${repairFeedback}` }
            : callOpts,
          {
            scope: "future-agents",
            feature: "Reflection Engine",
            module: "src/lib/ai/reflection-engine.ts",
            reflectionEnabled: false, // prevent recursive reflection
          }
        )) ?? null;
        } catch (e: any) {
          invokeThrew = true;
          invokeError = String(e?.message ?? e);
          throw e; // propagate — counts as a failed attempt in the repair loop
        }
        lastProvider = res?.provider ?? "";
        lastLatencyMs = res?.latencyMs ?? 0;
        lastTokensEstimate = res?.tokensEstimate ?? 0;
        return res?.text ?? "";
      },
      REFLECTION_VERDICT_SCHEMA,
      { label: "Reflection Engine", maxRepairRounds: 1 }
    ).catch(() => ({ data: null as any, repairRounds: 0, repairs: [] }));

    if (!parsed || typeof parsed !== "object") {
      return {
        ...disabled,
        overallScore: 50,
        confidence: 20,
        summary: "Reflection response was not valid JSON; could not assess.",
        retryRecommended: false,
        retryReason: "reflection parse failure",
        status: "error",
        metadata: {
          ...baseMeta,
          provider: lastProvider,
          model: lastProvider,
          durationMs: Date.now() - t0,
          latencyMs: lastLatencyMs,
          error: invokeThrew ? invokeError : "invalid reflection JSON",
        },
      };
    }

    const overallScore = clampScore(parsed.overallScore);
    const retryRecommended = parsed.retryRecommended === true || overallScore < cfg.reflectionThreshold;

    return {
      reflectionId,
      executionId: args.executionId,
      overallScore,
      confidence: clampScore(parsed.confidence),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      strengths: asStringArray(parsed.strengths),
      weaknesses: asStringArray(parsed.weaknesses),
      missingInformation: asStringArray(parsed.missingInformation),
      instructionViolations: asStringArray(parsed.instructionViolations),
      formatViolations: asStringArray(parsed.formatViolations),
      reasoningIssues: asStringArray(parsed.reasoningIssues),
      hallucinationRisk: clamp01(parsed.hallucinationRisk),
      determinismRisk: clamp01(parsed.determinismRisk),
      suggestedActions: asStringArray(parsed.suggestedActions),
      retryRecommended,
      retryReason:
        typeof parsed.retryReason === "string" && parsed.retryReason.trim()
          ? parsed.retryReason
          : retryRecommended
            ? "overallScore " + overallScore + " < threshold " + cfg.reflectionThreshold
            : "",
      status: retryRecommended ? "retry" : "ok",
      metadata: {
        ...baseMeta,
        provider: lastProvider,
        model: lastProvider,
        durationMs: Date.now() - t0,
        latencyMs: lastLatencyMs,
        tokens: lastTokensEstimate,
      },
    };
  } catch (e: any) {
    return {
      ...disabled,
      summary: "Reflection execution failed.",
      retryRecommended: false,
      retryReason: "reflection execution error",
      status: "error",
      metadata: {
        ...baseMeta,
        durationMs: Date.now() - t0,
        error: e?.message ?? String(e),
      },
    };
  }
}
