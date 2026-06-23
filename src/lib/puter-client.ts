// ResumeAI Pro — Puter Client Provider
// Browser-only execution for Puter.js. NEVER runs on Workers, backend APIs,
// server actions, cron jobs, or scheduled tasks.
//
// This module provides:
//   - Session checking (is the user authenticated?)
//   - Model discovery (dynamically load available models)
//   - Test connection (browser-based, not API-based)
//   - Chat execution (browser-only)

"use client";

declare global {
  interface Window {
    puter?: any;
  }
}

export type PuterAuthStatus = "authenticated" | "not_authenticated" | "session_expired" | "not_loaded";

export interface PuterTestResult {
  success: boolean;
  status: PuterAuthStatus;
  message: string;
  model?: string;
  latencyMs?: number;
  responsePreview?: string;
}

export interface PuterModel {
  id: string;
  label: string;
  provider: string;  // e.g. "OpenAI", "Anthropic", "Google"
}

// Cache for discovered models
let modelCache: PuterModel[] | null = null;
let modelCacheTime = 0;
const MODEL_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

/**
 * Check if Puter.js is loaded in the browser.
 * This is safe to call anytime — does NOT open popups.
 */
export function isPuterLoaded(): boolean {
  return typeof window !== "undefined" && !!window.puter;
}

/**
 * Get the current Puter authentication status.
 * This is safe to call anytime — does NOT open popups.
 */
export function getPuterAuthStatus(): PuterAuthStatus {
  if (!isPuterLoaded()) return "not_loaded";
  try {
    if (window.puter.auth) {
      if (typeof window.puter.auth.isSignedIn === "function") {
        const signedIn = window.puter.auth.isSignedIn();
        return signedIn ? "authenticated" : "not_authenticated";
      }
    }
    return "not_authenticated";
  } catch (err) {
    console.warn("[puterClient] Auth status check failed:", err instanceof Error ? err.message : err);
    return "session_expired";
  }
}

/**
 * Get the signed-in Puter user (or null).
 * Does NOT open a popup.
 */
export async function getPuterUser(): Promise<any | null> {
  if (!isPuterLoaded() || getPuterAuthStatus() !== "authenticated") return null;
  try {
    return await window.puter.auth.getUser();
  } catch (err) {
    console.warn("[puterClient] getUser failed:", err instanceof Error ? err.message : err);
    return null;
  }
}

/**
 * Sign in to Puter — MUST be called from a user click handler.
 * Opens a popup (allowed because it's user-initiated).
 */
export async function signInToPuter(): Promise<{ ok: boolean; user?: any; error?: string }> {
  if (!isPuterLoaded()) {
    return { ok: false, error: "Puter.js is not loaded. Please refresh the page." };
  }
  try {
    await window.puter.auth.signIn();
    const user = await window.puter.auth.getUser().catch(() => null);
    return { ok: true, user };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Puter sign-in was cancelled or failed." };
  }
}

/**
 * Sign out of Puter.
 */
export async function signOutFromPuter(): Promise<{ ok: boolean; error?: string }> {
  if (!isPuterLoaded()) return { ok: false, error: "Puter.js is not loaded." };
  try {
    await window.puter.auth.signOut();
    return { ok: true };
  } catch (e: any) {
    return { ok: false, error: e?.message || "Sign-out failed." };
  }
}

/**
 * Discover available Puter models dynamically.
 * Uses puter.ai.listModels() if available, otherwise returns a curated list
 * of known-good models.
 *
 * Results are cached for 5 minutes to avoid repeated API calls.
 */
export async function discoverPuterModels(): Promise<PuterModel[]> {
  // Check cache
  if (modelCache && Date.now() - modelCacheTime < MODEL_CACHE_TTL) {
    return modelCache;
  }

  const models: PuterModel[] = [];

  // Try to use puter.ai.listModels() if available
  if (isPuterLoaded() && typeof window.puter.ai?.listModels === "function") {
    try {
      const result = await window.puter.ai.listModels();
      if (Array.isArray(result)) {
        for (const m of result) {
          if (typeof m === "string") {
            models.push({ id: m, label: m, provider: inferProvider(m) });
          } else if (m && m.id) {
            models.push({ id: m.id, label: m.label || m.id, provider: m.provider || inferProvider(m.id) });
          }
        }
      }
    } catch (err) {
      console.warn("[puterClient] listModels failed, falling back to curated list:", err instanceof Error ? err.message : err);
      // Fall through to curated list
    }
  }

  // If listModels didn't return anything, use curated list of known-good models
  if (models.length === 0) {
    models.push(...KNOWN_GOOD_PUTER_MODELS);
  }

  // Cache the results
  modelCache = models;
  modelCacheTime = Date.now();

  return models;
}

/**
 * Curated list of models known to work on Puter.js.
 * Updated per https://docs.puter.com/AI/chat/ (2026-06).
 * Puter supports 500+ models from OpenAI, Anthropic, Google, xAI, Mistral,
 * OpenRouter, and DeepSeek.
 */
export const KNOWN_GOOD_PUTER_MODELS: PuterModel[] = [
  // OpenAI models (default is gpt-5-nano per the docs)
  { id: "gpt-5-nano", label: "GPT-5 Nano (Puter default)", provider: "OpenAI" },
  { id: "gpt-5.4-nano", label: "GPT-5.4 Nano", provider: "OpenAI" },
  { id: "gpt-5.4", label: "GPT-5.4", provider: "OpenAI" },
  { id: "gpt-4o-mini", label: "GPT-4o Mini", provider: "OpenAI" },
  { id: "gpt-4o", label: "GPT-4o", provider: "OpenAI" },
  // OpenAI reasoning models (support reasoning_effort: none/minimal/low/medium/high/xhigh)
  { id: "o3-mini", label: "o3-mini (reasoning)", provider: "OpenAI" },
  { id: "o4-mini", label: "o4-mini (reasoning)", provider: "OpenAI" },
  // Anthropic models
  { id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", provider: "Anthropic" },
  { id: "claude-opus-4-8", label: "Claude Opus 4.8", provider: "Anthropic" },
  { id: "claude-3-7-sonnet", label: "Claude 3.7 Sonnet", provider: "Anthropic" },
  // Google models (some support image generation)
  { id: "gemini-2.5-flash", label: "Gemini 2.5 Flash", provider: "Google" },
  { id: "gemini-2.5-flash-lite", label: "Gemini 2.5 Flash Lite", provider: "Google" },
  { id: "gemini-2.0-flash", label: "Gemini 2.0 Flash", provider: "Google" },
  { id: "gemini-2.5-flash-image", label: "Gemini 2.5 Flash (Image Gen)", provider: "Google" },
  // DeepSeek
  { id: "deepseek-chat", label: "DeepSeek Chat", provider: "DeepSeek" },
  // Mistral
  { id: "mistral-large-latest", label: "Mistral Large", provider: "Mistral" },
  // xAI
  { id: "grok-beta", label: "Grok Beta", provider: "xAI" },
  // Reka (video analysis)
  { id: "reka/reka-edge", label: "Reka Edge (Video)", provider: "Reka" },
];

function inferProvider(modelId: string): string {
  const lower = modelId.toLowerCase();
  if (lower.includes("gpt") || lower.includes("o1") || lower.includes("o3") || lower.includes("o4")) return "OpenAI";
  if (lower.includes("claude")) return "Anthropic";
  if (lower.includes("gemini")) return "Google";
  if (lower.includes("deepseek")) return "DeepSeek";
  if (lower.includes("mistral") || lower.includes("mixtral")) return "Mistral";
  if (lower.includes("llama")) return "Meta";
  if (lower.includes("grok")) return "xAI";
  if (lower.includes("reka")) return "Reka";
  return "Unknown";
}

// ============================================================================
// Usage Monitoring (per https://docs.puter.com/Auth/getMonthlyUsage/)
// ============================================================================

export interface PuterMonthlyUsage {
  /** The usage data returned by puter.auth.getMonthlyUsage(). */
  [key: string]: any;
}

/**
 * Get the user's current monthly resource usage in the Puter ecosystem.
 * Usage data is scoped to the calling app only.
 *
 * Per https://docs.puter.com/Auth/getMonthlyUsage/:
 *   "Get the user's current monthly resource usage in the Puter ecosystem.
 *    Usage data is scoped to the calling app only."
 *
 * Returns null if Puter.js isn't loaded or the user isn't signed in.
 */
export async function getPuterMonthlyUsage(): Promise<PuterMonthlyUsage | null> {
  if (!isPuterLoaded()) return null;
  try {
    const authStatus = getPuterAuthStatus();
    if (authStatus !== "authenticated") return null;
    if (typeof window.puter.auth.getMonthlyUsage !== "function") return null;
    return await window.puter.auth.getMonthlyUsage();
  } catch (e) {
    console.warn("[Puter] getMonthlyUsage failed:", e);
    return null;
  }
}

/**
 * Check if the user is likely approaching the Puter free-tier usage cap.
 * Returns { near, remaining, message }.
 *
 * This is a heuristic — Puter's free-tier limits aren't publicly documented
 * in exact numbers, but getMonthlyUsage() returns the data we need to
 * estimate. When usage is high, we warn the user so they can either:
 *   1. Wait for the monthly reset
 *   2. Configure a paid API provider in Settings
 */
export async function checkPuterUsageStatus(): Promise<{
  near: boolean;
  remaining: "unknown" | "low" | "medium" | "high";
  message: string;
  raw: PuterMonthlyUsage | null;
}> {
  const usage = await getPuterMonthlyUsage();
  if (!usage) {
    return {
      near: false,
      remaining: "unknown",
      message: "Puter usage data unavailable. Sign in to Puter to see your usage.",
      raw: null,
    };
  }

  // The exact shape of the usage object isn't fully documented, but it
  // typically includes fields like:
  //   { ai_tokens: number, ai_requests: number, storage: number, ... }
  // We check common fields and estimate remaining capacity.
  const aiTokens = usage.ai_tokens ?? usage.aiTokens ?? usage.tokens ?? 0;
  const aiRequests = usage.ai_requests ?? usage.aiRequests ?? usage.requests ?? 0;

  // Heuristic thresholds (adjust based on observed Puter free-tier limits)
  // These are conservative — we warn early so the user isn't surprised.
  const TOKEN_WARNING_THRESHOLD = 100_000;
  const REQUEST_WARNING_THRESHOLD = 500;

  const nearTokenCap = typeof aiTokens === "number" && aiTokens > TOKEN_WARNING_THRESHOLD;
  const nearRequestCap = typeof aiRequests === "number" && aiRequests > REQUEST_WARNING_THRESHOLD;

  if (nearTokenCap || nearRequestCap) {
    return {
      near: true,
      remaining: "low",
      message: `Puter usage is high (${aiRequests} requests, ${aiTokens} tokens this month). Consider configuring a paid API provider in Settings to avoid hitting the free-tier cap.`,
      raw: usage,
    };
  }

  return {
    near: false,
    remaining: "high",
    message: `Puter usage is healthy (${aiRequests} requests, ${aiTokens} tokens this month).`,
    raw: usage,
  };
}

// ============================================================================
// Streaming Support (per https://docs.puter.com/AI/chat/ — stream: true)
// ============================================================================

export interface PuterStreamChunk {
  type: "text" | "compaction" | "error" | "image";
  text?: string;
  message?: string;
  image?: { type: string; image_url: { url: string } };
  id?: string;
  encrypted_content?: string;
}

/**
 * Stream a chat completion from Puter.js.
 *
 * Per https://docs.puter.com/AI/chat/:
 *   const resp = await puter.ai.chat(messages, { model: 'gpt-5.4', stream: true });
 *   for await (const part of resp) {
 *     if (part.type === 'text') text += part.text;
 *     else if (part.type === 'compaction') compaction = part;
 *     else if (part.type === 'error') console.error('stream error:', part.message);
 *   }
 *
 * @param messages Chat messages (system + user)
 * @param options Model, temperature, etc. (stream: true is added automatically)
 * @param onChunk Callback called for each text chunk
 * @returns The full concatenated text
 */
export async function puterChatStreamed(
  messages: Array<{ role: string; content: string }>,
  options: { model?: string; maxTokens?: number; temperature?: number },
  onChunk: (chunk: string) => void,
): Promise<string> {
  if (!isPuterLoaded()) {
    throw new Error("Puter.js is not loaded. This function can only run in the browser.");
  }

  const authStatus = getPuterAuthStatus();
  if (authStatus !== "authenticated") {
    throw new Error(`Puter authentication required. Current status: ${authStatus}. Please sign in to Puter first.`);
  }

  const model = options.model || "gpt-5.4-nano";
  const response: any = await window.puter.ai.chat(messages, {
    model,
    max_tokens: options.maxTokens ?? 4096,
    temperature: options.temperature ?? 0.7,
    stream: true,
  });

  let fullText = "";
  for await (const part of response as AsyncIterable<any>) {
    if (part?.type === "text" && part.text) {
      fullText += part.text;
      onChunk(part.text);
    } else if (part?.type === "error") {
      throw new Error(part.message || "Puter stream error");
    }
    // 'compaction' and 'image' chunks are handled by the caller if needed
  }

  return fullText;
}

/**
 * Validate that a model is available on Puter.
 * Checks against the discovered model list.
 */
export async function validatePuterModel(modelId: string): Promise<{ valid: boolean; available: string[] }> {
  const models = await discoverPuterModels();
  const valid = models.some((m) => m.id === modelId);
  return { valid, available: models.map((m) => m.id) };
}

/**
 * Test the Puter connection — browser-based, NOT an API call.
 *
 * Workflow:
 *   1. Check if Puter.js is loaded
 *   2. Check if the user is authenticated
 *   3. If not authenticated: return "not_authenticated" (NOT "connection failed")
 *   4. If authenticated: run a simple test prompt
 *   5. Return success/failure with the response preview
 *
 * This replaces the old test that tried to call Puter via the Worker API
 * (which always failed because Puter requires browser auth).
 */
export async function testPuterConnection(model?: string): Promise<PuterTestResult> {
  const startTime = Date.now();

  // Step 1: Check if Puter.js is loaded
  if (!isPuterLoaded()) {
    return {
      success: false,
      status: "not_loaded",
      message: "Puter.js is not loaded. Please refresh the page.",
    };
  }

  // Step 2: Check authentication
  const authStatus = getPuterAuthStatus();
  if (authStatus !== "authenticated") {
    return {
      success: false,
      status: authStatus,
      message: authStatus === "not_authenticated"
        ? "Not authenticated. Click 'Sign in to Puter' to authenticate."
        : authStatus === "session_expired"
        ? "Session expired. Please sign in again."
        : "Authentication required.",
    };
  }

  // Step 3: Run a test prompt
  try {
    const testModel = model || "gpt-5.4-nano";
    const response = await window.puter.ai.chat(
      "Reply with exactly: PUTER_CONNECTION_OK",
      { model: testModel, max_tokens: 20, temperature: 0 },
    );

    const latencyMs = Date.now() - startTime;
    const text = extractPuterText(response);

    return {
      success: true,
      status: "authenticated",
      message: "Puter connection successful. User is authenticated and the AI responded.",
      model: testModel,
      latencyMs,
      responsePreview: text.slice(0, 100),
    };
  } catch (e: any) {
    const latencyMs = Date.now() - startTime;
    const errMsg = e?.message || String(e);

    // Check for auth errors
    if (/auth|sign.?in|unauthor|401|403/i.test(errMsg)) {
      return {
        success: false,
        status: "session_expired",
        message: `Session expired or authentication error: ${errMsg}`,
        latencyMs,
      };
    }

    // Check for model errors
    if (/model|not.found|404/i.test(errMsg)) {
      return {
        success: false,
        status: "authenticated",
        message: `Model "${model}" not available on Puter. Try a different model.`,
        latencyMs,
      };
    }

    return {
      success: false,
      status: "authenticated",
      message: `Test prompt failed: ${errMsg}`,
      latencyMs,
    };
  }
}

/**
 * Execute a Puter chat call — browser-only.
 * This MUST NOT be called from server-side code.
 */
export async function puterChat(
  messages: Array<{ role: string; content: string }>,
  options?: { model?: string; maxTokens?: number; temperature?: number },
): Promise<{ text: string; model: string }> {
  if (!isPuterLoaded()) {
    throw new Error("Puter.js is not loaded. This function can only run in the browser.");
  }

  const authStatus = getPuterAuthStatus();
  if (authStatus !== "authenticated") {
    throw new Error(`Puter authentication required. Current status: ${authStatus}. Please sign in to Puter first.`);
  }

  const model = options?.model || "gpt-5.4-nano";
  const response = await window.puter.ai.chat(messages, {
    model,
    max_tokens: options?.maxTokens ?? 4096,
    temperature: options?.temperature ?? 0.7,
  });

  const text = extractPuterText(response);
  return { text, model };
}

/**
 * Extract text from a Puter response (handles different shapes).
 */
function extractPuterText(resp: any): string {
  if (typeof resp === "string") return resp;
  if (resp?.message?.content) {
    return Array.isArray(resp.message.content)
      ? resp.message.content.map((c: any) => c?.text ?? "").join("")
      : String(resp.message.content);
  }
  if (resp?.text) return resp.text;
  if (resp?.message?.role === "assistant" && typeof resp.message.content === "string") {
    return resp.message.content;
  }
  try { return JSON.stringify(resp); } catch (err) { console.warn("[puterClient] extractPuterText JSON.stringify failed:", err instanceof Error ? err.message : err); return String(resp ?? ""); }
}

/**
 * CRITICAL: Verify we're in a browser context.
 * Puter MUST NEVER execute on Workers, backend APIs, server actions,
 * cron jobs, or scheduled tasks.
 */
export function assertBrowserOnly(): void {
  if (typeof window === "undefined") {
    throw new Error("FATAL: Puter.js can only execute in the browser. This function was called from a server context. " +
      "Puter MUST NOT run on Cloudflare Workers, backend APIs, server actions, cron jobs, or scheduled tasks. " +
      "Use an API provider instead for server-side execution.");
  }
}
