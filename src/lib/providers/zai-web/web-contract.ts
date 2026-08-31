/**
 * Task 30c — Z.ai Web v2 chat contract (signed request builder).
 *
 * Reverse-engineered from the OFFICIAL chat.z.ai web client (public
 * production bundle) so the user's own web session can be used as a real
 * API channel — the same requests their browser already makes:
 *
 *   POST {origin}/api/v2/chat/completions?{urlParams}&signature_timestamp={ts}
 *   Headers:
 *     Authorization: Bearer {sessionToken}
 *     Content-Type: application/json
 *     Accept-Language: en-US
 *     X-FE-Version: prod-fe-1.1.92
 *     X-Signature: {signature}
 *
 * Signature (two-layer HMAC-SHA256, hex):
 *   sortedPayload = entries({timestamp, requestId, user_id}) sorted by key,
 *                   joined as "k1,v1,k2,v2,k3,v3"
 *   h             = sortedPayload | base64(utf8(signature_prompt)) | timestamp
 *   innerKey      = HMAC_SHA256(STATIC_KEY, String(floor(ts / 5min)))
 *   signature     = HMAC_SHA256(innerKey, h)
 *
 * The signing key ships inside the public client bundle; nothing here
 * bypasses any protection — this reimplements exactly what the user's own
 * browser does with their own session.
 */

export const ZAI_WEB_STATIC_SIGNING_KEY = "key-@@@@)))()((9))-xxxx&&&%%%%%";
export const ZAI_WEB_FE_VERSION = "prod-fe-1.1.92";
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
    languages: ctx.language,
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
  stream?: boolean;
  maxTokens?: number;
  temperature?: number;
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

  const headers = {
    Authorization: `Bearer ${input.token}`,
    "Content-Type": "application/json",
    "Accept-Language": ctx.language,
    "X-FE-Version": ZAI_WEB_FE_VERSION,
    "X-Signature": signature,
  };

  const payload: Record<string, unknown> = {
    stream: input.stream ?? false,
    model: input.model,
    messages: input.messages,
    signature_prompt: input.prompt,
    params: {
      ...(input.maxTokens ? { max_tokens: input.maxTokens } : {}),
      ...(input.temperature !== undefined ? { temperature: input.temperature } : {}),
    },
  };

  return {
    url: `https://chat.z.ai${ZAI_WEB_CHAT_V2_PATH}?${urlParams}&signature_timestamp=${timestamp}`,
    headers,
    body: JSON.stringify(payload),
    signatureTimestamp: timestamp,
  };
}

/**
 * Parse a v2 completion response: JSON (stream:false) or an SSE stream
 * (some deployments ignore stream:false). Returns null when neither shape
 * matches — callers must surface that as an honest contract failure.
 */
export function parseZaiWebChatResponseText(
  text: string,
): { content: string; model?: string; usage?: Record<string, number> } | null {
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
  // SSE: "data: {json}" lines, delta.content or message.content per event.
  let content = "";
  let model: string | undefined;
  let usage: Record<string, number> | undefined;
  for (const line of trimmed.split("\n")) {
    const l = line.trim();
    if (!l.startsWith("data:")) continue;
    const raw = l.slice(5).trim();
    if (!raw || raw === "[DONE]") continue;
    try {
      const ev = JSON.parse(raw) as Record<string, unknown>;
      const delta = fromJsonShape(ev, true);
      if (delta?.content) content += delta.content;
      if (typeof ev.model === "string") model = ev.model;
      if (ev.usage && typeof ev.usage === "object") usage = ev.usage as Record<string, number>;
    } catch {
      /* skip malformed event */
    }
  }
  if (content) return { content, model, usage };
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
