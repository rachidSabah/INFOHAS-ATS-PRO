// ============================================================================
// AI Response Diagnostics — structured logging for every AI call.
//
// PROBLEM (P1.5 — AI Reliability):
//   When an AI call fails or returns garbage, the developer has no visibility
//   into what was sent, what was received, or which provider was used. The
//   only log line is usually "Puter.js failed, trying next provider".
//
// SOLUTION:
//   Every AI call goes through logAICall() which records:
//     - Provider name
//     - Model name
//     - Prompt size (chars)
//     - Estimated tokens (chars / 4)
//     - Max tokens configured
//     - Finish reason (stop, length, content_filter, etc.)
//     - Raw response (first 500 chars)
//     - Normalized response (first 500 chars)
//     - Latency (ms)
//     - Error (if any)
//     - Timestamp
//     - Request ID (correlates across logs)
//
//   The diagnostics are:
//     1. Logged to the console (structured, easy to filter)
//     2. Stored in an in-memory ring buffer (last 100 calls)
//     3. (Optionally) sent to D1 via the audit-logs endpoint
//     4. (Optionally) sent to the Supervisor timeline
//
// USAGE:
//   const diag = startAICall({ provider: "Puter.js", model: "gpt-5-nano", ... });
//   try {
//     const response = await callAI(...);
//     diag.succeed(response, { finishReason: "stop" });
//   } catch (e) {
//     diag.fail(e);
//   }
// ============================================================================

"use client";

export interface AICallDiagnostic {
  /** Unique ID for this call (correlates across logs). */
  requestId: string;
  /** ISO timestamp when the call started. */
  startedAt: string;
  /** ISO timestamp when the call ended (set on succeed/fail). */
  endedAt?: string;
  /** Provider name (e.g. "Puter.js", "OpenAI", "OpenCode Zen"). */
  provider: string;
  /** Model name (e.g. "gpt-5-nano", "claude-3-5-sonnet"). */
  model?: string;
  /** Task category (document, interactive, development). */
  taskCategory?: string;
  /** System prompt size in characters. */
  systemPromptSize: number;
  /** User prompt size in characters. */
  userPromptSize: number;
  /** Total prompt size in characters. */
  promptSize: number;
  /** Estimated input tokens (promptSize / 4). */
  estimatedInputTokens: number;
  /** Max output tokens configured. */
  maxTokens?: number;
  /** Latency in milliseconds. */
  latencyMs?: number;
  /** Finish reason from the AI ("stop", "length", "content_filter", etc.). */
  finishReason?: string;
  /** Raw response (first 500 chars). */
  rawResponsePreview?: string;
  /** Normalized response (first 500 chars). */
  normalizedResponsePreview?: string;
  /** Error message (if the call failed). */
  error?: string;
  /** Whether the call succeeded. */
  success: boolean;
}

/** In-memory ring buffer of the last 100 AI calls. */
const diagnosticBuffer: AICallDiagnostic[] = [];
const MAX_BUFFER_SIZE = 100;

/** Listeners that are notified on every AI call (for the Diagnostics UI). */
const listeners = new Set<(diag: AICallDiagnostic) => void>();

/**
 * Generate a unique request ID. Uses crypto.randomUUID if available,
 * falls back to a timestamp + random string.
 */
function generateRequestId(): string {
  try {
    if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch (cryptoErr) { /* crypto.randomUUID not available — fallback below */ }
  return `req_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
}

/**
 * Start tracking an AI call. Returns a handle that you call .succeed() or
 * .fail() on when the call completes.
 *
 * Usage:
 *   const diag = startAICall({ provider: "Puter.js", model: "gpt-5-nano", ... });
 *   try {
 *     const response = await callAI(...);
 *     diag.succeed(response, { finishReason: "stop" });
 *   } catch (e) {
 *     diag.fail(e);
 *   }
 */
export function startAICall(params: {
  provider: string;
  model?: string;
  taskCategory?: string;
  systemPrompt?: string;
  userPrompt: string;
  maxTokens?: number;
}): {
  succeed: (response: string, opts?: { finishReason?: string; normalizedResponse?: string }) => void;
  fail: (error: unknown) => void;
} {
  const requestId = generateRequestId();
  const startedAt = new Date().toISOString();
  const systemPromptSize = params.systemPrompt?.length ?? 0;
  const userPromptSize = params.userPrompt?.length ?? 0;
  const promptSize = systemPromptSize + userPromptSize;
  const estimatedInputTokens = Math.ceil(promptSize / 4);

  const base: AICallDiagnostic = {
    requestId,
    startedAt,
    provider: params.provider,
    model: params.model,
    taskCategory: params.taskCategory,
    systemPromptSize,
    userPromptSize,
    promptSize,
    estimatedInputTokens,
    maxTokens: params.maxTokens,
    success: false,
  };

  // Log the start of the call (compact, one line)
  console.log(
    `[AI] → ${params.provider}/${params.model ?? "default"} | ` +
    `prompt: ${promptSize.toLocaleString()} chars (~${estimatedInputTokens.toLocaleString()} tokens) | ` +
    `maxTokens: ${params.maxTokens ?? "default"} | ` +
    `req: ${requestId.slice(0, 8)}`,
  );

  return {
    succeed(response: string, opts?: { finishReason?: string; normalizedResponse?: string }) {
      const endedAt = new Date().toISOString();
      const latencyMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
      const rawResponsePreview = (response ?? "").slice(0, 500);
      const normalizedResponsePreview = (opts?.normalizedResponse ?? "").slice(0, 500);

      const diag: AICallDiagnostic = {
        ...base,
        endedAt,
        latencyMs,
        finishReason: opts?.finishReason,
        rawResponsePreview,
        normalizedResponsePreview,
        success: true,
      };

      addDiagnostic(diag);

      // Log success (compact, one line)
      console.log(
        `[AI] ✓ ${params.provider}/${params.model ?? "default"} | ` +
        `latency: ${latencyMs}ms | ` +
        `finish: ${opts?.finishReason ?? "unknown"} | ` +
        `response: ${response?.length ?? 0} chars | ` +
        `req: ${requestId.slice(0, 8)}`,
      );

      // Verbose diagnostics (only if debug mode is on)
      if (typeof window !== "undefined" && window.localStorage?.getItem("resumeai-ai-debug") === "1") {
        console.log("[AI Diagnostics]", {
          provider: params.provider,
          model: params.model,
          promptSize,
          estimatedTokens: estimatedInputTokens,
          maxTokens: params.maxTokens,
          finishReason: opts?.finishReason,
          rawAIResponse: response,
          normalizedResponse: opts?.normalizedResponse,
        });
      }
    },
    fail(error: unknown) {
      const endedAt = new Date().toISOString();
      const latencyMs = new Date(endedAt).getTime() - new Date(startedAt).getTime();
      const errorMsg = error instanceof Error ? error.message : String(error);

      const diag: AICallDiagnostic = {
        ...base,
        endedAt,
        latencyMs,
        error: errorMsg,
        success: false,
      };

      addDiagnostic(diag);

      console.warn(
        `[AI] ✗ ${params.provider}/${params.model ?? "default"} | ` +
        `latency: ${latencyMs}ms | ` +
        `error: ${errorMsg} | ` +
        `req: ${requestId.slice(0, 8)}`,
      );
    },
  };
}

/**
 * Add a diagnostic to the ring buffer and notify listeners.
 */
function addDiagnostic(diag: AICallDiagnostic): void {
  diagnosticBuffer.push(diag);
  if (diagnosticBuffer.length > MAX_BUFFER_SIZE) {
    diagnosticBuffer.shift();
  }
  for (const listener of listeners) {
    try {
      listener(diag);
    } catch (listenerErr) { console.warn("[ai-diagnostics] Diagnostic listener threw:", listenerErr instanceof Error ? listenerErr.message : listenerErr); }
  }
}

/**
 * Get the last N AI call diagnostics (most recent first).
 */
export function getRecentAIDiagnostics(count = 50): AICallDiagnostic[] {
  return diagnosticBuffer.slice(-count).reverse();
}

/**
 * Subscribe to AI call diagnostics. Returns an unsubscribe function.
 */
export function subscribeToAIDiagnostics(
  listener: (diag: AICallDiagnostic) => void,
): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/**
 * Clear all diagnostics (for the Diagnostics UI "clear" button).
 */
export function clearAIDiagnostics(): void {
  diagnosticBuffer.length = 0;
}

// ============================================================================
// Token overflow protection
// ============================================================================

/**
 * The maximum input tokens we'll send to any AI provider.
 * Most providers cap at 8K-128K input tokens; we cap at 8K to be safe
 * (and to avoid burning through the user's quota on retries).
 */
export const MAX_INPUT_TOKENS = 8_000;

/**
 * Estimate the token count for a given text. Uses the standard heuristic
 * of 1 token ≈ 4 characters (works well for English; overestimates for
 * non-Latin scripts which is safer).
 */
export function estimateTokens(text: string): number {
  if (!text) return 0;
  return Math.ceil(text.length / 4);
}

/**
 * Truncate a prompt to fit within the token budget. Tries to truncate at
 * a sentence boundary first, then at a word boundary.
 *
 * @param text The prompt text to truncate
 * @param maxTokens The maximum tokens allowed (default: 8000)
 * @returns The truncated text, with a "..." suffix if truncated
 */
export function truncatePromptToTokenLimit(text: string, maxTokens = MAX_INPUT_TOKENS): string {
  if (!text) return "";
  const estimatedTokens = estimateTokens(text);
  if (estimatedTokens <= maxTokens) return text;

  // Convert tokens back to characters (approximate)
  const maxChars = maxTokens * 4;
  if (text.length <= maxChars) return text;

  // Try to truncate at a sentence boundary (". " or "! " or "? ")
  const sentenceEnd = text.lastIndexOf(". ", maxChars);
  if (sentenceEnd > maxChars * 0.8) {
    return text.slice(0, sentenceEnd + 1) + " [...truncated...]";
  }

  // Try to truncate at a word boundary
  const wordEnd = text.lastIndexOf(" ", maxChars);
  if (wordEnd > maxChars * 0.9) {
    return text.slice(0, wordEnd) + " [...truncated...]";
  }

  // Hard truncate
  return text.slice(0, maxChars) + " [...truncated...]";
}

/**
 * Check if a prompt is within the token limit. Returns { ok, tokens, maxTokens }.
 */
/**
 * Split an optimizer directive into critical (system-level) and auxiliary (user-level) parts.
 *
 * CRITICAL sections (never truncated, always in system prompt):
 *   - PAGE FORMAT / PAGE FORMAT & CONTENT DENSITY
 *   - MARGINS
 *   - FONT RULES
 *   - ATS RULES
 *   - CONTENT COMPRESSION ENGINE / ONE-PAGE COMPRESSION
 *   - VALIDATION / OUTPUT FORMAT (JSON schema)
 *   - ONE-PAGE CONSTRAINT
 *
 * AUXILIARY sections (compressible, may be in user prompt):
 *   - HEADER LAYOUT
 *   - SECTION ORDER
 *   - PROFESSIONAL SUMMARY
 *   - CORE COMPETENCIES & SKILLS
 *   - PROFESSIONAL EXPERIENCE
 *   - EDUCATION
 *   - LANGUAGES
 *   - AI OPTIMIZATION BEHAVIOR
 *   - CONTENT RULES
 *   - COMPANY RESEARCH
 *   - ATS EXPLANATIONS
 *   - REFLECTIONS
 *
 * @param directive The full optimizer directive string
 * @returns { system: string, user: string } — split parts
 */
export function splitOptimizationDirective(directive: string): { system: string; user: string } {
  if (!directive) return { system: "", user: "" };

  const sectionDelimiter = "═══════════════════════════════════════════════════════════════";

  // Section headers that MUST be in system prompt (critical, non-compressible)
  const systemSectionKeywords = [
    "PAGE FORMAT",
    "MARGINS",
    "FONT RULES",
    "ATS RULES",
    "CONTENT COMPRESSION",
    "ONE-PAGE COMPRESSION",
    "OUTPUT FORMAT",
    "VALIDATION",
    "ONE-PAGE CONSTRAINT",
  ];

  // Parse all section start positions
  const sectionStarts: Array<{ index: number; name: string; isCritical: boolean }> = [];
  const sectionRex = new RegExp(
    // ──────── delimiter ──────── \n name \n ──────── delimiter ────────
    "═+\\n([^\\n]+)\\n═+",
    "g"
  );
  let secMatch: RegExpExecArray | null;
  while ((secMatch = sectionRex.exec(directive)) !== null) {
    const name = secMatch[1]?.trim() ?? "";
    if (!name) continue;
    const isCritical = systemSectionKeywords.some((kw) =>
      name.toUpperCase().includes(kw.toUpperCase()),
    );
    sectionStarts.push({ index: secMatch.index, name, isCritical });
  }

  // Build system and user parts
  const systemParts: string[] = [];
  const userParts: string[] = [];

  // Preamble (everything before the first section) always goes in system
  if (sectionStarts.length > 0 && sectionStarts[0].index > 0) {
    systemParts.push(directive.slice(0, sectionStarts[0].index).trim());
  }

  for (let i = 0; i < sectionStarts.length; i++) {
    const sec = sectionStarts[i];
    const end = i + 1 < sectionStarts.length ? sectionStarts[i + 1].index : directive.length;
    const text = directive.slice(sec.index, end).trim();
    if (sec.isCritical) {
      systemParts.push(text);
    } else {
      userParts.push(text);
    }
  }

  // Also search for a trailing ONE-PAGE CONSTRAINT paragraph (may not be a section)
  const onePageMatch = directive.match(/ONE-PAGE CONSTRAINT:[\s\S]*?(?=\n═+|$)/);
  if (onePageMatch && !systemParts.some((p) => p.includes(onePageMatch[0].slice(0, 30)))) {
    systemParts.push(onePageMatch[0]);
  }

  return {
    system: systemParts.join("\n\n").trim(),
    user: userParts.join("\n\n").trim(),
  };
}

export function checkTokenLimit(text: string, maxTokens = MAX_INPUT_TOKENS): {
  ok: boolean;
  tokens: number;
  maxTokens: number;
} {
  const tokens = estimateTokens(text);
  return { ok: tokens <= maxTokens, tokens, maxTokens };
}

// ============================================================================
// JSON Repair Layer
// ============================================================================

/**
 * Attempt to repair a malformed JSON string from an AI response.
 *
 * Common issues:
 *   - Trailing commas: {"a": 1, "b": 2,}
 *   - Single quotes: {'a': 1, 'b': 2}
 *   - Unquoted keys: {a: 1, b: 2}
 *   - Truncated: {"a": 1, "b": [1, 2, 3
 *   - Markdown fences: ```json\n{...}\n```
 *   - Prose prefix: "Here is the JSON:\n{...}"
 *
 * @param raw The raw AI response that should be JSON
 * @returns The repaired JSON string (may still fail to parse — call extractJSON on it)
 */
export function repairJSON(raw: string): string {
  if (typeof raw !== "string") return "";
  let s = raw.trim();

  // 1. Strip markdown fences
  s = s.replace(/```json\s*/gi, "").replace(/```\s*/g, "");

  // 2. Strip prose prefix (everything before the first { or [)
  const firstBrace = s.search(/[{[]/);
  if (firstBrace > 0) {
    s = s.slice(firstBrace);
  }

  // 3. Strip prose suffix (everything after the last } or ])
  const lastBrace = Math.max(s.lastIndexOf("}"), s.lastIndexOf("]"));
  if (lastBrace !== -1 && lastBrace < s.length - 1) {
    s = s.slice(0, lastBrace + 1);
  }

  // 4. Replace single quotes with double quotes (careful: don't break
  //    strings that contain apostrophes)
  // Strategy: only replace single quotes that are around KEYS or VALUES,
  // not inside strings. This is hard to do perfectly with regex, so we
  // only do the simple case: 'key' → "key" at the start of a key.
  s = s.replace(/'([^']*)'\s*:/g, '"$1":');
  s = s.replace(/:\s*'([^']*)'/g, ': "$1"');

  // 5. Quote unquoted keys: {key: "value"} → {"key": "value"}
  // Match word characters followed by a colon, where the word isn't already quoted
  s = s.replace(/([{,]\s*)([a-zA-Z_][a-zA-Z0-9_]*)\s*:/g, '$1"$2":');

  // 6. Remove trailing commas
  s = s.replace(/,\s*([}\]])/g, "$1");

  // 7. Fix truncated arrays/objects — close them
  const openBraces = (s.match(/{/g) ?? []).length;
  const closeBraces = (s.match(/}/g) ?? []).length;
  if (openBraces > closeBraces) {
    s += "}".repeat(openBraces - closeBraces);
  }
  const openBrackets = (s.match(/\[/g) ?? []).length;
  const closeBrackets = (s.match(/\]/g) ?? []).length;
  if (openBrackets > closeBrackets) {
    s += "]".repeat(openBrackets - closeBrackets);
  }

  return s.trim();
}
