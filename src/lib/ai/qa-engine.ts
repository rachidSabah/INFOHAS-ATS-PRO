// ============================================================================
// Enterprise QA Engine — Phase 8.1.3.4
//
// ONE reusable QA (Quality Assurance) Engine for the Enterprise AI Core. QA
// validates an AI response AFTER generation — it checks correctness,
// completeness, constraint adherence, and safety. It NEVER changes the original
// response and NEVER owns a second AI pipeline. It produces ONLY structured QA
// findings (a QAResult). The middleware (recordAI) decides whether a
// retry/rework is required — not this engine.
//
// MANDATE:
//   - QA is MIDDLEWARE, not feature logic. Features gain it simply by executing
//     through recordAI with qaEnabled.
//   - It reuses the Prompt Builder + Context Builder + the SAME recordAI()
//     execution path (via the dedicated qa scope) — no duplicated prompts, no
//     duplicated context, no second pipeline.
//   - The QA Prompt is SHARED and feature-agnostic. It validates: instruction
//     compliance, completeness, constraint adherence (length/format/schema),
//     factual consistency with context, safety/policy, and answer quality.
//   - The engine parses the model's structured verdict and returns a typed
//     QAResult. Parsing failures degrade gracefully (status: "error").
// ============================================================================

import { PromptBuilder } from "./prompt-builder";
import { ContextBuilder } from "./context-builder";
import { recordAI, hashString } from "./flight-recorder";
import { uid } from "@/lib/store";
import type { AICallOptions } from "@/lib/ai";
import type { SchemaSpec } from "@/lib/agents/structured-output";

export const QA_PROMPT_VERSION = "8.1.3.4";

/** Shared, feature-agnostic QA validation rubric. */
export interface QAConfig {
  /** Master switch (global or per-scope). */
  qaEnabled: boolean;
  /** overallScore < threshold => failRecommended. Range 0-100. */
  qaThreshold: number;
  /** Max tokens for the QA pass. */
  maxQATokens: number;
  /** Optional model override for the QA pass (reuse AI config). */
  qaModelOverride?: string;
  /** Optional provider override for the QA pass. */
  qaProviderOverride?: string;
  /** Optional temperature for the QA pass (lower = more deterministic). */
  qaTemperature?: number;
  /** Optional timeout (ms) for the QA pass. */
  qaTimeout?: number;
}

export const DEFAULT_QA_CONFIG: QAConfig = {
  qaEnabled: false,
  qaThreshold: 70,
  maxQATokens: 1500,
  qaTemperature: 0.2,
};

// Per-scope overrides. Reuses the existing shared-config ownership pattern
// (a single module registry updated at init) — NOT a new configuration system.
const scopeOverrides = new Map<string, Partial<QAConfig>>();

export function setQAConfigForScope(scope: string, cfg: Partial<QAConfig>): void {
  scopeOverrides.set(scope, cfg);
}

export function getQAConfig(scope?: string): QAConfig {
  const base = { ...DEFAULT_QA_CONFIG };
  if (scope) {
    const o = scopeOverrides.get(scope);
    if (o) return { ...base, ...o };
  }
  return base;
}

export type QAStatus = "passed" | "failed" | "error";

/** Severity of a QA finding. */
export type QAFindingSeverity = "critical" | "major" | "minor";

/** A single QA finding. */
export interface QAFinding {
  category: string;
  description: string;
  severity: QAFindingSeverity;
}

/** The single structured QA report the engine produces. */
export interface QAResult {
  qaId: string;
  executionId: string;
  /** 0-100 quality/pass score. */
  overallScore: number;
  /** 0-100 confidence in the verdict. */
  confidence: number;
  summary: string;
  findings: QAFinding[];
  /** 0-1 risk the response contains fabricated / unverifiable content. */
  hallucinationRisk: number;
  /** 0-1 risk the response violates policy / contains unsafe content. */
  policyRisk: number;
  /** 0-1 risk the response is incomplete vs. the request. */
  incompletenessRisk: number;
  passed: boolean;
  failRecommended: boolean;
  failReason: string;
  status: QAStatus;
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

function asFindings(v: unknown): QAFinding[] {
  if (!Array.isArray(v)) return [];
  return v
    .filter((x) => x && typeof x === "object")
    .map((x: any) => ({
      category: typeof x.category === "string" ? x.category : "uncategorized",
      description: typeof x.description === "string" ? x.description : String(x.description ?? ""),
      severity: (["critical", "major", "minor"].includes(x.severity) ? x.severity : "minor") as QAFindingSeverity,
    }));
}

/** Build the SHARED, feature-agnostic QA prompt via Prompt+Context Builders. */
export function buildQAPrompt(args: {
  originalPrompt: string;
  executionContext: string;
  aiResponse: string;
  contextHash?: string;
}): { systemPrompt: string; userPrompt: string } {
  const pb = new PromptBuilder({
    scope: "future-agents",
    feature: "QA Engine",
    version: QA_PROMPT_VERSION,
  })
    .system(
      "You are an Enterprise QA (Quality Assurance) Engine. You validate an AI-generated response AFTER it was produced. " +
        "You NEVER rewrite or alter the response. You ONLY assess it and return structured findings as JSON." +
        "\n\nValidate these dimensions:" +
        "\n1. Instruction compliance — did the response follow all explicit instructions (format, length, tone)?" +
        "\n2. Completeness — does it fully answer the request (nothing omitted)?" +
        "\n3. Constraint adherence — does it respect stated constraints (max length, schema, language, no placeholders)?" +
        "\n4. Factual consistency — is the content consistent with the provided context (no invented facts)?" +
        "\n5. Safety & policy — free of unsafe, fabricated credentials, PII leakage, or policy violations?" +
        "\n6. Answer quality — is it useful, coherent, and on-topic?" +
        "\n7. Self-consistency — is the response internally non-contradictory?",
    )
    .user(
      "Return ONLY a JSON object with these exact keys:\n" +
        "{\n" +
        '  "overallScore": <0-100>,\n' +
        '  "confidence": <0-100>,\n' +
        '  "summary": "<one sentence>",\n' +
        '  "findings": [ { "category": string, "description": string, "severity": "critical"|"major"|"minor" } ],\n' +
        '  "hallucinationRisk": <0-1>,\n' +
        '  "policyRisk": <0-1>,\n' +
        '  "incompletenessRisk": <0-1>,\n' +
        '  "failRecommended": <true|false>,\n' +
        '  "failReason": "<why or empty string>"\n' +
        "}\n" +
        "No markdown fences. No prose outside the JSON.",
    )
    .build();

  const userPrompt = new ContextBuilder({ scope: "future-agents", feature: "QA Engine" })
    .feature("ORIGINAL PROMPT:\n" + args.originalPrompt)
    .feature("EXECUTION CONTEXT:\n" + args.executionContext)
    .feature("AI RESPONSE TO VALIDATE:\n" + args.aiResponse)
    .add("future-hermes", args.contextHash ? "contextHash: " + args.contextHash : "")
    .build().text;

  return { systemPrompt: pb.systemPrompt ?? "", userPrompt };
}

/**
 * Run QA over a completed execution. Produces structured findings only.
 * Executes through the SAME recordAI() pipeline under a dedicated qa scope
 * (observability + hooks apply) — never a second pipeline.
 *
 * `aiResponseText` is the generated text; `originalPrompt`/`executionContext`
 * describe what was asked. `opts` carries the caller's AICallOptions (so the
 * QA pass can inherit provider/model config via overrides).
 */
export async function qa(args: {
  executionId: string;
  originalPrompt: string;
  executionContext: string;
  aiResponseText: string;
  scope?: string;
  opts?: AICallOptions;
  config?: QAConfig;
  signal?: AbortSignal;
}): Promise<QAResult> {
  const t0 = Date.now();
  const cfg = args.config ?? getQAConfig(args.scope);
  const qaId = uid("qa");
  const contextHash = hashString(args.executionContext || "");

  const baseMeta = { promptVersion: QA_PROMPT_VERSION, promptHash: hashString(args.aiResponseText) };

  const disabled: QAResult = {
    qaId,
    executionId: args.executionId,
    overallScore: 0,
    confidence: 0,
    summary: "",
    findings: [],
    hallucinationRisk: 0,
    policyRisk: 0,
    incompletenessRisk: 0,
    passed: false,
    failRecommended: false,
    failReason: "qa disabled",
    status: "error",
    metadata: { ...baseMeta, error: "qa disabled" },
  };

  if (!cfg.qaEnabled) {
    return disabled;
  }

  const { systemPrompt, userPrompt } = buildQAPrompt({
    originalPrompt: args.originalPrompt,
    executionContext: args.executionContext,
    aiResponse: args.aiResponseText,
    contextHash,
  });

  const callOpts: AICallOptions = {
    systemPrompt,
    userPrompt,
    maxTokens: cfg.maxQATokens,
    temperature: cfg.qaTemperature ?? 0.2,
    modelOverride: cfg.qaModelOverride,
    providerId: cfg.qaProviderOverride,
    taskCategory: "interactive",
    agentTask: "qa",
    signal: args.signal ?? args.opts?.signal,
  };

  const QA_VERDICT_SCHEMA: SchemaSpec = {
    type: "object",
    required: ["overallScore"],
    properties: {
      overallScore: { type: "number" },
      confidence: { type: "number" },
      summary: { type: "string" },
      findings: { type: "array" },
    },
    label: "qa verdict",
  };

  try {
    // STRUCTURED OUTPUT: robust cascade + ONE bounded parse-error repair
    // round (the failure text is fed back into the prompt). Previously a bare
    // JSON.parse dropped the ENTIRE verdict ("qa parse failure").
    // NOTE: lazily imported — flight-recorder (this module's middleware host)
    // imports this engine for its prompt version; a static import of
    // structured-output (which pulls the full ai.ts graph) would create an
    // initialization cycle.
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
            feature: "QA Engine",
            module: "src/lib/ai/qa-engine.ts",
            qaEnabled: false, // prevent recursive QA
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
      QA_VERDICT_SCHEMA,
      { label: "QA Engine", maxRepairRounds: 1 }
    ).catch(() => ({ data: null as any, repairRounds: 0, repairs: [] }));

    if (!parsed || typeof parsed !== "object") {
      return {
        ...disabled,
        overallScore: 50,
        confidence: 20,
        summary: "QA response was not valid JSON; could not validate.",
        failRecommended: false,
        failReason: "qa parse failure",
        status: "error",
        metadata: {
          ...baseMeta,
          provider: lastProvider,
          model: lastProvider,
          durationMs: Date.now() - t0,
          latencyMs: lastLatencyMs,
          error: invokeThrew ? invokeError : "invalid qa JSON",
        },
      };
    }

    const overallScore = clampScore(parsed.overallScore);
    const failRecommended =
      parsed.failRecommended === true || overallScore < cfg.qaThreshold || hasCriticalFinding(parsed.findings);

    return {
      qaId,
      executionId: args.executionId,
      overallScore,
      confidence: clampScore(parsed.confidence),
      summary: typeof parsed.summary === "string" ? parsed.summary : "",
      findings: asFindings(parsed.findings),
      hallucinationRisk: clamp01(parsed.hallucinationRisk),
      policyRisk: clamp01(parsed.policyRisk),
      incompletenessRisk: clamp01(parsed.incompletenessRisk),
      passed: !failRecommended,
      failRecommended,
      failReason:
        typeof parsed.failReason === "string" && parsed.failReason.trim()
          ? parsed.failReason
          : failRecommended
            ? "overallScore " + overallScore + " < threshold " + cfg.qaThreshold
            : "",
      status: failRecommended ? "failed" : "passed",
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
      summary: "QA execution failed.",
      failRecommended: false,
      failReason: "qa execution error",
      status: "error",
      metadata: {
        ...baseMeta,
        durationMs: Date.now() - t0,
        error: e?.message ?? String(e),
      },
    };
  }
}

/** A "critical" finding forces a fail regardless of the numeric score. */
function hasCriticalFinding(findings: unknown): boolean {
  return asFindings(findings).some((f) => f.severity === "critical");
}
