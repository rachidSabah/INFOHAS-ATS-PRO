// CORS proxy for AI provider chat completions
// Browser cannot call provider APIs directly due to CORS — this route proxies the request server-side
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// ============================================================================
// SSRF Protection — inlined (avoids @/ import issues on Cloudflare Pages Edge Runtime)
// Must stay in sync with src/lib/ssrf-allowlist.ts
// ============================================================================
const ALLOWED_PROVIDER_HOSTS = new Set([
  "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com",
  "api.groq.com", "api.deepseek.com", "integrate.api.nvidia.com",
  "openrouter.ai", "api.opencode.com", "opencode.ai",
  "api.perplexity.ai", "api.mistral.ai", "api.cohere.com",
  "api.together.xyz", "api.z.ai", "api.aimlapi.com", "api.azure.com",
  "api-inference.huggingface.co", "api.puter.com", "api.cohere.ai",
  "bedrock-runtime.us-east-1.amazonaws.com", "bedrock-runtime.us-west-2.amazonaws.com",
]);

const BLOCKED_PROXY_HEADERS = new Set([
  "host", "cookie", "authorization", "x-forwarded-for", "x-real-ip",
  "proxy-authorization", "connection", "content-length",
]);

function isAllowedProviderUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" ||
      h.startsWith("192.168.") || h.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
      h.startsWith("169.254.") || h === "metadata.google.internal" ||
      h.endsWith(".local") || h.endsWith(".internal")) {
      return false;
    }
    return ALLOWED_PROVIDER_HOSTS.has(h);
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { baseUrl, apiKey, authType, headersJson, model, messages, maxTokens, temperature, responsePath } = body;

    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "baseUrl is required" }, { status: 400 });
    }

    if (!isAllowedProviderUrl(baseUrl)) {
      return NextResponse.json(
        { ok: false, error: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }

    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (headersJson) {
      try {
        const parsed = JSON.parse(headersJson);
        for (const [key, value] of Object.entries(parsed)) {
          if (!BLOCKED_PROXY_HEADERS.has(key.toLowerCase())) {
            headers[key] = String(value);
          }
        }
      } catch (e) { console.warn("[ProviderChat] Invalid headersJson:", e); }
    }
    if (apiKey) {
      const isGemini = baseUrl.includes("generativelanguage.googleapis.com");
      const isGeminiOpenAI = isGemini && baseUrl.includes("/openai/");
      if (isGemini) {
        if (isGeminiOpenAI) { headers["Authorization"] = `Bearer ${apiKey}`; }
      } else if (authType === "header") { headers["x-api-key"] = apiKey; }
      else { headers["Authorization"] = `Bearer ${apiKey}`; }
    }

    let url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    const isGemini = baseUrl.includes("generativelanguage.googleapis.com");
    if (isGemini && !baseUrl.includes("/openai/") && apiKey) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}key=${encodeURIComponent(apiKey)}`;
    } else if (authType === "query" && apiKey) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}key=${encodeURIComponent(apiKey)}`;
    }

    const reqBody: Record<string, unknown> = {
      model: model || "gpt-4o-mini",
      messages: messages || [{ role: "user", content: "Hello" }],
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? 0.7,
      stream: false,
    };

    const controller = new AbortController();
    const timeoutMs = Math.min((body.timeout || 30) * 1000, 60000);
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const t0 = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(reqBody),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      let errorMessage = errText.slice(0, 300);
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.error?.message) {
          errorMessage = errJson.error.type
            ? `${errJson.error.type}: ${errJson.error.message}`
            : errJson.error.message;
        } else if (errJson?.error?.code && errJson?.error?.message) {
          errorMessage = `Error ${errJson.error.code}: ${errJson.error.message}`;
        } else if (errJson?.message) { errorMessage = errJson.message; }
      } catch { /* not JSON */ }
      return NextResponse.json({
        ok: false, latencyMs,
        error: `API returned HTTP ${res.status}: ${errorMessage}`,
      }, { status: res.status });
    }

    const data = await res.json();

    let text = "";
    if (responsePath) {
      text = responsePath.split(".").reduce((acc: unknown, key: string) => {
        const m = key.match(/^([^\[]+)(?:\[(\d+)\])?$/);
        if (!m) return acc;
        const v = (acc as Record<string, unknown>)?.[m[1]];
        return m[2] !== undefined ? (v as unknown[])?.[parseInt(m[2], 10)] : v;
      }, data) ?? "";
    } else if (data?.choices?.[0]?.message?.content) { text = data.choices[0].message.content; }
    else if (Array.isArray(data?.content) && data.content[0]?.text) { text = data.content[0].text; }
    else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) { text = data.candidates[0].content.parts[0].text; }
    else if (typeof data?.text === "string") { text = data.text; }
    else if (typeof data?.content === "string") { text = data.content; }
    else { text = JSON.stringify(data); }

    return NextResponse.json({ ok: true, latencyMs, text });
  } catch (e: unknown) {
    const isAbort = e instanceof Error && e.name === "AbortError";
    const isFetchFail = e instanceof Error && (e.message.includes("fetch") || e.message.includes("Failed to fetch"));
    const msg = isAbort
      ? "Request timed out"
      : isFetchFail
      ? "The provider endpoint is unreachable. Possible causes: wrong URL, CORS blocked, provider offline."
      : (e instanceof Error ? e.message : "Connection failed");
    console.error("[ProviderChat] Unhandled error:", msg);
    return NextResponse.json({
      ok: false, success: false, code: "PROVIDER_CHAT_FAILED",
      message: msg, latencyMs: 0,
    });
  }
}
