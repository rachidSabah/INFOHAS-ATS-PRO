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

  async chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse> {
    const token = resolveSessionToken(config);
    if (!token) {
      throw new ProviderAuthenticationError(
        "auth_required",
        "Z.ai Web is not connected. Open Z.ai, sign in with Google, then run the Z.ai → ATS Pro bridge. (Web-session integration — no API key is used.)",
        "zai-web",
      );
    }

    const t0 = performance.now();
    let res: Response;
    try {
      res = await this.fetchLike(`${this.contract.origin}${this.contract.chatPath}`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${token}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: req.model || config.modelName,
          messages: req.messages,
          stream: false,
          ...(req.maxTokens ? { max_tokens: req.maxTokens } : {}),
          ...(req.temperature !== undefined ? { temperature: req.temperature } : {}),
        }),
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

    const data = (await res.json().catch(() => null)) as Record<string, unknown> | null;
    const content = extractContent(data);
    if (content === null) {
      throw new Error("[Z.ai Web] session_invalid: response does not match the expected web chat shape.");
    }

    const usage = extractUsage(data);
    return {
      text: content,
      provider: "zai-web",
      model: (req.model || config.modelName || "zai-web") as string,
      latencyMs,
      ...(usage?.inputTokens !== undefined ? { inputTokens: usage.inputTokens } : {}),
      ...(usage?.outputTokens !== undefined ? { outputTokens: usage.outputTokens } : {}),
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

function extractContent(data: Record<string, unknown> | null): string | null {
  if (!data) return null;
  // OpenAI-shaped web response (candidate contract)
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = choice.message as Record<string, unknown> | undefined;
    const content = message?.content;
    if (typeof content === "string") return content;
    if (typeof choice.text === "string") return choice.text as string;
  }
  if (typeof data.content === "string") return data.content;
  if (typeof data.response === "string") return data.response;
  return null;
}

function extractUsage(
  data: Record<string, unknown> | null,
): NormalizedAIResponse["usage"] | undefined {
  if (!data || typeof data.usage !== "object" || data.usage === null) return undefined;
  const usage = data.usage as Record<string, unknown>;
  const inputTokens = typeof usage.prompt_tokens === "number" ? usage.prompt_tokens : undefined;
  const outputTokens = typeof usage.completion_tokens === "number" ? usage.completion_tokens : undefined;
  if (inputTokens === undefined && outputTokens === undefined) return undefined;
  return {
    inputTokens,
    outputTokens,
    totalTokens:
      inputTokens !== undefined || outputTokens !== undefined
        ? (inputTokens ?? 0) + (outputTokens ?? 0)
        : undefined,
  };
}

export const zaiWebSessionAdapter = new ZaiWebSessionAdapter();
