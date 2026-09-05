/**
 * Task 30c/31 — Z.ai Web v2 chat contract (signed request builder).
 *
 * Reverse-engineered and CALIBRATED against the OFFICIAL chat.z.ai web
 * client production bundle (prod-fe-1.1.93, asset index-hicAZtW-.js) so
 * the user's own web session works as a real API channel — the same
 * requests their browser already makes:
 *
 *   POST {origin}/api/v2/chat/completions?{urlParams}&signature_timestamp={ts}
 *   Headers:
 *     Authorization: Bearer {sessionToken}
 *     Content-Type: application/json
 *     Accept-Language: en-US
 *     X-FE-Version: prod-fe-1.1.93
 *     X-Signature: {signature}
 *     X-Device-ID: {deviceUuid}          (wy() adds it client-side)
 *
 * Signature (two-layer HMAC-SHA256, hex — CONFIRMED identical in 1.1.93):
 *   sortedPayload = entries({timestamp, requestId, user_id}) sorted by key,
 *                   joined as "k1,v1,k2,v2,k3,v3"
 *   h             = sortedPayload | base64(utf8(signature_prompt)) | timestamp
 *   innerKey      = HMAC_SHA256(STATIC_KEY, String(floor(ts / 5min)))  → hex
 *   signature     = HMAC_SHA256(innerKeyHex, h)                        → hex
 *
 * Response (SSE, frames separated by "\n\n", each frame `data: {json}`):
 *   {type:"chat:completion", data:{id, done, content, delta_content,
 *        error, usage, phase("thinking"|"answer"|...), scope, ...}}
 *   {type:"chat:message:delta"|"message", data:{content}}   → append
 *   {type:"chat:message"|"replace",        data:{content}}   → replace
 *   {type:"status"|"source"|"citation"|"chat:title"|"chat:tags"|
 *        "notification"|"conn:heartbeat"}                    → ignore
 *
 * The signing key ships inside the public client bundle; nothing here
 * bypasses any protection — this reimplements exactly what the user's own
 * browser does with their own session.
 */

export const ZAI_WEB_STATIC_SIGNING_KEY = "key-@@@@)))()((9))-xxxx&&&%%%%%";
export const ZAI_WEB_FE_VERSION = "prod-fe-1.1.93";
export const ZAI_WEB_CHAT_V2_PATH = "/api/v2/chat/completions";
export const ZAI_WEB_SIGNATURE_WINDOW_MS = 5 * 60 * 1000;

/** HMAC-SHA256 over strings, returned as lowercase hex (WebCrypto — edge + node + browser). */
export async function sha256HmacHex(key: string, message: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(key),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const mac = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(message));
  return Array.from(new Uint8Array(mac))
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

/** base64(utf8(text)) — the official client's btoa(TextEncoder) chunking, chunk-safe. */
export function base64Utf8(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (let i = 0; i < bytes.length; i += 32768) {
    binary += String.fromCharCode(...Array.from(bytes.slice(i, i + 32768)));
  }
  return btoa(binary);
}

export interface ZaiWebSignatureParts {
  /** Milliseconds since epoch as a string — goes into the payload AND the query. */
  timestamp: string;
  /** UUID-style request id generated per call. */
  requestId: string;
  /** Z.ai user id when known; the official client sends "" when not loaded. */
  userId?: string;
}

/** Object.entries({timestamp, requestId, user_id}) sorted by key, joined "k,v,k,v,...". */
export function buildZaiWebSortedPayload(parts: ZaiWebSignatureParts): string {
  return Object.entries({
    timestamp: parts.timestamp,
    requestId: parts.requestId,
    user_id: parts.userId ?? "",
  })
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0))
    .map(([k, v]) => `${k},${v}`)
    .join(",");
}

export async function buildZaiWebSignature(
  parts: ZaiWebSignatureParts & { prompt: string },
): Promise<{ signature: string; timestamp: string }> {
  const sortedPayload = buildZaiWebSortedPayload(parts);
  const h = `${sortedPayload}|${base64Utf8(parts.prompt)}|${parts.timestamp}`;
  const bucket = Math.floor(Number(parts.timestamp) / ZAI_WEB_SIGNATURE_WINDOW_MS);
  const innerKey = await sha256HmacHex(ZAI_WEB_STATIC_SIGNING_KEY, String(bucket));
  const signature = await sha256HmacHex(innerKey, h);
  return { signature, timestamp: parts.timestamp };
}

/** Synthetic-but-self-consistent browser context for server-side requests. */
export interface ZaiWebDeviceContext {
  userAgent: string;
  language: string;
  /** navigator.languages.join(",") — the official client joins the list. */
  languages: string;
  timezone: string;
  screenWidth: number;
  screenHeight: number;
  viewportWidth: number;
  viewportHeight: number;
  colorDepth: number;
  pixelRatio: number;
  pagePath: string;
  referrer: string;
  pageTitle: string;
  isMobile: boolean;
  isTouch: boolean;
  maxTouchPoints: number;
  browserName: string;
  osName: string;
}

export const SERVER_DEVICE_CONTEXT: ZaiWebDeviceContext = {
  userAgent:
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0.0.0 Safari/537.36",
  language: "en-US",
  languages: "en-US,en",
  timezone: "UTC",
  screenWidth: 1920,
  screenHeight: 1080,
  viewportWidth: 1680,
  viewportHeight: 900,
  colorDepth: 24,
  pixelRatio: 1,
  pagePath: "/",
  referrer: "",
  pageTitle: "Z.ai",
  isMobile: false,
  isTouch: false,
  maxTouchPoints: 0,
  browserName: "Chrome",
  osName: "Windows",
};

function deviceContextFields(ctx: ZaiWebDeviceContext, token: string): Record<string, string> {
  const now = new Date();
  return {
    version: "0.0.1",
    platform: "web",
    token,
    user_agent: ctx.userAgent,
    language: ctx.language,
    languages: ctx.languages,
    timezone: ctx.timezone,
    cookie_enabled: "true",
    screen_width: String(ctx.screenWidth),
    screen_height: String(ctx.screenHeight),
    screen_resolution: `${ctx.screenWidth}x${ctx.screenHeight}`,
    viewport_height: String(ctx.viewportHeight),
    viewport_width: String(ctx.viewportWidth),
    viewport_size: `${ctx.viewportWidth}x${ctx.viewportHeight}`,
    color_depth: String(ctx.colorDepth),
    pixel_ratio: String(ctx.pixelRatio),
    current_url: `https://chat.z.ai${ctx.pagePath}`,
    pathname: ctx.pagePath,
    search: "",
    hash: "",
    host: "chat.z.ai",
    hostname: "chat.z.ai",
    protocol: "https:",
    referrer: ctx.referrer,
    title: ctx.pageTitle,
    timezone_offset: String(now.getTimezoneOffset()),
    local_time: now.toISOString(),
    utc_time: now.toUTCString(),
    is_mobile: ctx.isMobile ? "true" : "false",
    is_touch: ctx.isTouch ? "true" : "false",
    max_touch_points: String(ctx.maxTouchPoints),
    browser_name: ctx.browserName,
    os_name: ctx.osName,
  };
}

export interface ZaiWebChatRequestInput {
  token: string;
  model: string;
  messages: Array<{ role: string; content: string }>;
  /** The prompt text the signature covers — the official client sends the trimmed user prompt. */
  prompt: string;
  requestId?: string;
  userId?: string;
  timestamp?: string;
  /** The official client streams (model params default stream on). Default true. */
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
  /** Stable per-install device id (X-Device-ID header). A UUID is generated when omitted. */
  deviceId?: string;
  /** Z.ai chat/message ids — the web app tracks completions per chat. Fresh UUIDs by default. */
  chatId?: string;
  messageId?: string;
  device?: ZaiWebDeviceContext;
}

export interface ZaiWebSignedChatRequest {
  url: string;
  headers: Record<string, string>;
  body: string;
  signatureTimestamp: string;
}

export async function buildZaiWebChatRequest(
  input: ZaiWebChatRequestInput,
): Promise<ZaiWebSignedChatRequest> {
  const timestamp = input.timestamp ?? String(Date.now());
  const requestId = input.requestId ?? crypto.randomUUID();
  const chatId = input.chatId ?? crypto.randomUUID();
  const messageId = input.messageId ?? crypto.randomUUID();
  const deviceId = input.deviceId ?? crypto.randomUUID();
  const ctx = input.device ?? SERVER_DEVICE_CONTEXT;

  const { signature } = await buildZaiWebSignature({
    timestamp,
    requestId,
    userId: input.userId,
    prompt: input.prompt,
  });

  // urlParams: identity trio first (insertion order, like the official client),
  // then the device fingerprint fields.
  const params = new URLSearchParams();
  params.append("timestamp", timestamp);
  params.append("requestId", requestId);
  params.append("user_id", input.userId ?? "");
  for (const [k, v] of Object.entries(deviceContextFields(ctx, input.token))) {
    params.append(k, v);
  }
  const urlParams = params.toString();

  const headers: Record<string, string> = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json",
    "Accept-Language": ctx.language,
    "X-FE-Version": ZAI_WEB_FE_VERSION,
    "X-Signature": signature,
    "X-Device-ID": deviceId,
  };

  // Payload mirrors the official v2 body: stream + model + messages +
  // signature_prompt + params + features + chat/message ids + the v2
  // message-tree references (null for a fresh conversation).
  const payload: Record<string, unknown> = {
    stream: input.stream ?? true,
    model: input.model,
    messages: input.messages,
    signature_prompt: input.prompt,
    params: {
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    },
    features: {
      image_generation: false,
      web_search: false,
      auto_web_search: false,
      enable_thinking: false,
    },
    chat_id: chatId,
    id: messageId,
    current_user_message_id: null,
    current_user_message_parent_id: null,
  };

  return {
    url: `https://chat.z.ai${ZAI_WEB_CHAT_V2_PATH}?${urlParams}&signature_timestamp=${timestamp}`,
    headers,
    body: JSON.stringify(payload),
    signatureTimestamp: timestamp,
  };
}

/** Parsed completion: content, optional model/usage, and an optional Z.ai-side error. */
export interface ZaiWebChatParseResult {
  content: string;
  model?: string;
  usage?: Record<string, number>;
  /** Human-presentable Z.ai-side failure (error event / quota code), token-free. */
  error?: string;
}

/** Phases that never carry the user-facing answer text. */
const NON_ANSWER_PHASES = new Set(["thinking", "tool_call", "tool_response", "planning"]);

interface CompletionEventData {
  id?: unknown;
  done?: unknown;
  content?: unknown;
  delta_content?: unknown;
  error?: unknown;
  usage?: unknown;
  phase?: unknown;
  status?: unknown;
  model?: unknown;
}

function completionErrorMessage(error: unknown): string | null {
  if (!error || typeof error !== "object") {
    return typeof error === "string" && error.trim() ? error.trim().slice(0, 300) : null;
  }
  const rec = error as Record<string, unknown>;
  const code = typeof rec.code === "number" || typeof rec.code === "string" ? rec.code : null;
  const detail =
    typeof rec.detail === "string"
      ? rec.detail
      : typeof rec.content === "string"
        ? rec.content
        : typeof rec.message === "string"
          ? rec.message
          : "";
  const text = detail.trim();
  if (!text && code === null) return null;
  return code !== null ? `Z.ai completion error ${code}${text ? `: ${text}` : ""}` : text.slice(0, 300);
}

/**
 * Parse a v2 completion response: the CONFIRMED official SSE event protocol
 * ({type, data} frames), legacy JSON shapes (OpenAI choices / flat content),
 * and OpenAI-shaped SSE. Returns null only when NOTHING matches — callers
 * must surface that as an honest contract failure.
 */
export function parseZaiWebChatResponseText(text: string): ZaiWebChatParseResult | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    try {
      const data = JSON.parse(trimmed) as Record<string, unknown>;
      const parsed = fromJsonShape(data);
      if (parsed) return parsed;
    } catch {
      /* fall through to SSE */
    }
  }

  let content = "";
  let fullContent = "";
  let model: string | undefined;
  let usage: Record<string, number> | undefined;
  let error: string | undefined;
  let sawEvent = false;

  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const raw = l.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    let ev: Record<string, unknown>;
    try {
      ev = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      continue; // skip malformed event, like the official reader does
    }
    sawEvent = true;
    const type = typeof ev.type === "string" ? ev.type : null;
    const data = (ev.data ?? null) as Record<string, unknown> | null;

    if (type === "chat:completion" && data && typeof data === "object") {
      const d = data as CompletionEventData;
      if (d.error) {
        const msg = completionErrorMessage(d.error);
        if (msg) error = msg;
      }
      if (d.usage && typeof d.usage === "object") usage = d.usage as Record<string, number>;
      if (typeof d.model === "string" && d.model) model = d.model;
      const phase = typeof d.phase === "string" ? d.phase : "";
      if (typeof d.delta_content === "string" && d.delta_content) {
        if (!NON_ANSWER_PHASES.has(phase)) content += d.delta_content;
      }
      // Full-update events (done/finish) carry the complete answer — they
      // override accumulated deltas, matching the official client's
      // "full update" branch.
      if (
        (d.done === true || phase === "done" || (typeof d.status === "string" && d.status === "finish")) &&
        typeof d.content === "string" &&
        d.content
      ) {
        fullContent = d.content;
      } else if (typeof d.content === "string" && d.content && !d.delta_content && d.done !== true) {
        // Non-delta full content on a streaming event (edit_content-style replace)
        fullContent = d.content;
      }
      continue;
    }

    if (
      (type === "chat:message:delta" || type === "message") &&
      data &&
      typeof (data as { content?: unknown }).content === "string"
    ) {
      content += (data as { content: string }).content;
      continue;
    }

    if (
      (type === "chat:message" || type === "replace") &&
      data &&
      typeof (data as { content?: unknown }).content === "string"
    ) {
      fullContent = (data as { content: string }).content;
      continue;
    }

    if (
      type === "status" ||
      type === "source" ||
      type === "citation" ||
      type === "chat:title" ||
      type === "chat:tags" ||
      type === "notification" ||
      type === "conn:heartbeat"
    ) {
      continue; // metadata events — no completion content
    }

    // Unknown/absent type — try the legacy shapes on the raw event.
    const legacy = fromJsonShape(ev, true);
    if (legacy?.content) content += legacy.content;
    if (legacy?.model) model = legacy.model;
    if (legacy?.usage) usage = legacy.usage;
  }

  if (error && !fullContent && !content) {
    return { content: "", error };
  }
  const finalContent = fullContent || content;
  if (sawEvent && finalContent) return { content: finalContent, model, usage };
  return null;
}

function fromJsonShape(
  data: Record<string, unknown>,
  deltaMode = false,
): { content: string; model?: string; usage?: Record<string, number> } | null {
  const choices = data.choices;
  if (Array.isArray(choices) && choices.length > 0) {
    const choice = choices[0] as Record<string, unknown>;
    const message = (choice.message ?? choice.delta) as Record<string, unknown> | undefined;
    const content = message?.content ?? choice.text;
    if (typeof content === "string") {
      return {
        content,
        model: typeof data.model === "string" ? data.model : undefined,
        usage: (data.usage as Record<string, number>) ?? undefined,
      };
    }
  }
  if (typeof data.content === "string") {
    return {
      content: data.content,
      model: typeof data.model === "string" ? data.model : undefined,
      usage: (data.usage as Record<string, number>) ?? undefined,
    };
  }
  if (deltaMode && typeof data.response === "string") {
    return { content: data.response };
  }
  return null;
}
