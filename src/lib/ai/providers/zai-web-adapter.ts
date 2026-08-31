/**
 * Task 30 — ZaiWebSessionAdapter
 *
 * Bridges the modern AIProviderAdapter contract to the AUTHENTICATED
 * chat.z.ai WEB SESSION. This is NOT the official Z.ai API integration:
 *  - it never calls https://api.z.ai/api/paas/v4 (that belongs to the API
 *    integration),
 *  - it never treats config.apiKey as a Z.ai API key (the credential is
 *    credential_type = zai_web_session, held in the memory session store /
 *    secure server sink),
 *  - its endpoints are RUNTIME-VALIDATED candidates, not guessed truths:
 *    when Z.ai's web contract does not hold, every call fails gracefully
 *    with an explicit state and never fabricates a success.
 *
 * Factory key: "zai-web" (registered in ProviderFactory) — routing,
 * benchmark pings and health probes therefore all use this adapter.
 */

import type {
  AIProviderAdapter,
  ChatRequest,
  ChatResponse,
  ProviderConfig,
} from "./interface";
import { ProviderAuthenticationError } from "../../providers/interface";
import { recallZaiWebSession } from "../../providers/zai-web/credential-store";
import {
  DEFAULT_ZAI_WEB_CONTRACT,
  validateZaiWebSession,
  type ZaiWebContract,
} from "../../providers/zai-web/session-validator";
import { redactZaiSecrets } from "../../providers/zai-web/session-monitor";
import {
  buildZaiWebChatRequest,
  parseZaiWebChatResponseText,
} from "../../providers/zai-web/web-contract";

export interface NormalizedAIResponse {
  content: string;
  model: string;
  provider: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
  finishReason?: string;
  requestId?: string;
}

/** Candidate web-chat contract — validated per call, overridable in tests. */
export const ZAI_WEB_CHAT_CONTRACT: ZaiWebContract & { chatPath: string } = {
  origin: DEFAULT_ZAI_WEB_CONTRACT.origin,
  modelsPath: DEFAULT_ZAI_WEB_CONTRACT.modelsPath,
  chatPath: "/api/chat/completions",
};

/** Same-origin ATS Pro endpoint that imports + validates the web session. */
export const ZAI_WEB_IMPORT_PATH = "/api/providers/zai-web/session-import";

/** Same-origin ATS Pro endpoint that runs the signed v2 chat server-side. */
export const ZAI_WEB_CHAT_PATH = "/api/providers/zai-web/chat";

function resolveSessionToken(config: ProviderConfig): string | null {
  // 1. Runtime session (browser bridge import) — the canonical source.
  const live = recallZaiWebSession();
  if (live?.token) return live.token;
  // 2. A server-injected session copy (config.apiKey carries the SESSION
  //    token in server contexts — it is never a Z.ai API key).
  if (config.apiKey && config.apiKey.trim() !== "") return config.apiKey;
  return null;
}

function isBrowserRuntime(): boolean {
  return typeof window !== "undefined";
}

/** Shape of the session-import route's JSON response (POST import / GET validate). */
interface ImportRouteResponse {
  ok?: boolean;
  stored?: "server" | "not-stored";
  validated?: boolean;
  state?: string;
  models?: string[];
  message?: string;
}

async function readImportResponse(res: Response): Promise<ImportRouteResponse | null> {
  return (await res.json().catch(() => null)) as ImportRouteResponse | null;
}

function importOutcomeMessage(data: ImportRouteResponse | null, resStatus: number): string {
  if (!data) {
    return `ATS Pro validation endpoint returned an unreadable response (HTTP ${resStatus}). The session was not marked connected.`;
  }
  const message = String(data.message ?? "").trim();
  return message || `Validation state: ${data.state ?? "unknown"} (HTTP ${resStatus}).`;
}

/**
 * Browser validation path (Task 30b fix for the "always failing" Test
 * Connection): the bridge import stores the session SERVER-side only, so
 * the browser asks the same-origin import route to validate — POST when a
 * memory token exists (validates + persists it), GET to validate the
 * encrypted D1 copy otherwise. Direct cross-origin calls to chat.z.ai are
 * NOT attempted from the browser here.
 */
async function validateViaImportRoute(
  fetchLike: typeof fetch,
  memoryToken: string | null,
): Promise<{ ok: boolean; latencyMs: number; message: string; state: string; models: string[] }> {
  const t0 = performance.now();
  try {
    const res = memoryToken
      ? await fetchLike(ZAI_WEB_IMPORT_PATH, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            provider_id: "zai-web",
            credential_type: "zai_web_session",
            token: memoryToken,
            source: "test-connection",
          }),
        })
      : await fetchLike(ZAI_WEB_IMPORT_PATH, { method: "GET" });
    const latencyMs = Math.round(performance.now() - t0);
    const data = await readImportResponse(res as Response);
    const message = importOutcomeMessage(data, res.status);
    return {
      ok: data?.validated === true && data?.state === "connected",
      latencyMs,
      message: redactZaiSecrets(message),
      state: String(data?.state ?? "network_error"),
      models: Array.isArray(data?.models) ? data.models : [],
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return {
      ok: false,
      latencyMs: Math.round(performance.now() - t0),
      message: redactZaiSecrets(
        `ATS Pro validation endpoint unreachable (${message.slice(0, 120)}). The session was not marked connected.`,
      ),
      state: "network_error",
      models: [],
    };
  }
}

export class ZaiWebSessionAdapter implements AIProviderAdapter {
  readonly type = "zai-web";

  constructor(
    private contract: ZaiWebContract & { chatPath: string } = ZAI_WEB_CHAT_CONTRACT,
    private fetchLike: typeof fetch = fetch,
  ) {}

  /**
   * Task 30c — chat through the OFFICIALLY-SIGNED v2 web contract so the
   * web session works as a real API channel:
   *   - browser runtime → same-origin /api/providers/zai-web/chat edge
   *     route (token lives server-side after the bridge import);
   *   - node/edge/test runtime → the signed v2 request built by
     *     buildZaiWebChatRequest is issued directly via fetchLike.
   * Failures stay honest: auth errors, rate limits and contract mismatches
   * map to explicit states — never a fabricated answer.
   */
  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const t0 = performance.now();
    const model = (req.model || config.modelName || "GLM-4.5") as string;

    if (isBrowserRuntime()) {
      // Same-origin edge route — it signs the v2 request server-side with
      // the decrypted D1 session (or the passed memory token) and parses
      // the answer. Never a cross-origin browser call to chat.z.ai.
      const res = await this.fetchLike(ZAI_WEB_CHAT_PATH, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model,
          messages: req.messages,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
          ...(resolveSessionToken(config) ? { token: resolveSessionToken(config) } : {}),
        }),
        signal: req.signal ?? AbortSignal.timeout(config.timeout ?? 60000),
      } as RequestInit);
      const latencyMs = Math.round(performance.now() - t0);
      const data = (await (res as Response).json().catch(() => null)) as
        | { ok?: boolean; state?: string; message?: string; content?: string; model?: string; usage?: Record<string, number> | null }
        | null;
      if (!data) {
        throw new Error(`[Z.ai Web] session_invalid: unreadable chat route response (HTTP ${res.status}).`);
      }
      if (!data.ok || typeof data.content !== "string") {
        if (data.state === "authentication_required" || data.state === "session_expired") {
          throw new ProviderAuthenticationError(
            data.state === "session_expired" ? "session_expired" : "auth_required",
            redactZaiSecrets(String(data.message ?? "Z.ai Web session is not connected.")),
            "zai-web",
          );
        }
        throw new Error(`[Z.ai Web] ${data.state ?? "session_invalid"}: ${redactZaiSecrets(String(data.message ?? "chat failed"))}`);
      }
      return {
        text: data.content,
        provider: "zai-web",
        model: (data.model || model) as string,
        latencyMs,
        ...(data.usage?.prompt_tokens !== undefined ? { inputTokens: Number(data.usage.prompt_tokens) } : {}),
        ...(data.usage?.completion_tokens !== undefined ? { outputTokens: Number(data.usage.completion_tokens) } : {}),
      } as ChatResponse;
    }

    const token = resolveSessionToken(config);
    if (!token) {
      throw new ProviderAuthenticationError(
        "auth_required",
        "Z.ai Web is not connected. Open Z.ai, sign in with Google, then run the Z.ai → ATS Pro bridge. (Web-session integration — no API key is used.)",
        "zai-web",
      );
    }

    const promptSource = [...req.messages].reverse().find((m) => m?.role === "user");
    const prompt = String(promptSource?.content ?? "").trim().slice(0, 8000);
    const signed = await buildZaiWebChatRequest({
      token,
      model,
      messages: req.messages,
      prompt,
      maxTokens: req.maxTokens,
      temperature: req.temperature,
    });

    let res: Response;
    try {
      res = await this.fetchLike(signed.url, {
        method: "POST",
        headers: signed.headers,
        body: signed.body,
        signal: req.signal ?? AbortSignal.timeout(config.timeout ?? 60000),
      } as RequestInit);
    } catch (e: unknown) {
      // Network/timeout failures degrade gracefully — never a silent success.
      const message = e instanceof Error ? e.message : String(e);
      throw new Error(`[Z.ai Web] network_error: ${redactZaiSecrets(message)}`);
    }

    const latencyMs = Math.round(performance.now() - t0);

    if (res.status === 401 || res.status === 403) {
      throw new ProviderAuthenticationError(
        "session_expired",
        "Z.ai web session expired or was rejected. Z.ai Web is DEGRADED — reconnect via the browser bridge.",
        "zai-web",
      );
    }
    if (res.status === 429) {
      throw new Error("[Z.ai Web] rate_limited: Z.ai is rate-limiting this session. Failover may try the next provider.");
    }
    if (!res.ok) {
      const body = redactZaiSecrets((await res.text().catch(() => "")).slice(0, 200));
      throw new Error(`[Z.ai Web] session_invalid: HTTP ${res.status} from the Z.ai web contract. ${body}`);
    }

    const text = await res.text().catch(() => "");
    const parsed = parseZaiWebChatResponseText(text);
    if (!parsed || !parsed.content) {
      throw new Error("[Z.ai Web] session_invalid: response does not match the expected web chat shape.");
    }

    return {
      text: parsed.content,
      provider: "zai-web",
      model: (parsed.model || model) as string,
      latencyMs,
      ...(parsed.usage?.prompt_tokens !== undefined ? { inputTokens: Number(parsed.usage.prompt_tokens) } : {}),
      ...(parsed.usage?.completion_tokens !== undefined ? { outputTokens: Number(parsed.usage.completion_tokens) } : {}),
    } as ChatResponse;
  }

  /**
   * Health semantics: the provider is healthy ONLY after a REAL validation
   * request passes. Token presence alone is never "connected".
   *
   * Browser runtime: validation goes through the same-origin ATS Pro import
   * route (POST with the memory token, or GET validating the encrypted
   * server copy) — the bridge flow leaves the browser memory store empty,
   * so a direct browser-to-chat.z.ai check would always fail.
   * Server/test runtime: direct Z.ai validation as before.
   */
  async testConnection(config: ProviderConfig): Promise<{
    ok: boolean;
    latencyMs: number;
    message: string;
    response?: string;
  }> {
    if (isBrowserRuntime()) {
      const outcome = await validateViaImportRoute(
        this.fetchLike,
        resolveSessionToken(config),
      );
      return { ok: outcome.ok, latencyMs: outcome.latencyMs, message: outcome.message };
    }
    const token = resolveSessionToken(config);
    const validation = await validateZaiWebSession(
      token ? { token } : null,
      (url, init) => this.fetchLike(url, init as RequestInit),
      this.contract,
    );
    return {
      ok: validation.state === "connected",
      latencyMs: validation.latencyMs,
      message: redactZaiSecrets(validation.message),
    };
  }

  async listModels(config: ProviderConfig): Promise<string[]> {
    if (isBrowserRuntime()) {
      const outcome = await validateViaImportRoute(
        this.fetchLike,
        resolveSessionToken(config),
      );
      if (outcome.ok && outcome.models.length > 0) return outcome.models;
      const stored = (config.enabledModels || []).filter(
        (m) => typeof m === "string" && m.trim() !== "",
      );
      if (stored.length > 0) return stored;
      throw new Error(
        `[Z.ai Web] ${outcome.state}: no web model catalog available. ${outcome.message}`.slice(0, 300),
      );
    }
    const token = resolveSessionToken(config);
    const validation = await validateZaiWebSession(
      token ? { token } : null,
      (url, init) => this.fetchLike(url, init as RequestInit),
      this.contract,
    );
    if (validation.state === "connected" && validation.models?.length) {
      return validation.models;
    }
    const stored = (config.enabledModels || []).filter(
      (m) => typeof m === "string" && m.trim() !== "",
    );
    if (stored.length > 0) return stored;
    throw new Error(
      `[Z.ai Web] ${validation.state}: no web model catalog available. ${redactZaiSecrets(validation.message)}`,
    );
  }
}


export const zaiWebSessionAdapter = new ZaiWebSessionAdapter();
