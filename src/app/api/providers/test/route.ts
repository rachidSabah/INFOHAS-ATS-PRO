// CORS proxy for testing AI provider connections
// The browser can't call provider APIs directly due to CORS — this route proxies the request
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// ============================================================================
// SSRF Protection — inlined (avoids @/ import issues on Cloudflare Pages Edge Runtime)
// Must stay in sync with src/lib/ssrf-allowlist.ts
// ============================================================================
const ALLOWED_PROVIDER_HOSTS = new Set([
  "api.openai.com",
  "api.anthropic.com",
  "generativelanguage.googleapis.com",
  "api.groq.com",
  "api.deepseek.com",
  "integrate.api.nvidia.com",
  "openrouter.ai",
  "api.opencode.com",
  "opencode.ai",
  "api.perplexity.ai",
  "api.mistral.ai",
  "api.cohere.com",
  "api.together.xyz",
  "api.z.ai",
  "api.aimlapi.com",
  "api.azure.com",
  "api-inference.huggingface.co",
  "api.puter.com",
  "api.cohere.ai",
  "bedrock-runtime.us-east-1.amazonaws.com",
  "bedrock-runtime.us-west-2.amazonaws.com",
]);

const BLOCKED_PROXY_HEADERS = new Set([
  "host", "cookie", "authorization", "x-forwarded-for", "x-real-ip",
  "proxy-authorization", "connection", "content-length",
]);

function isAllowedProviderUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname.toLowerCase();
    if (
      h === "localhost" || h === "127.0.0.1" || h === "0.0.0.0" ||
      h.startsWith("192.168.") || h.startsWith("10.") ||
      /^172\.(1[6-9]|2[0-9]|3[0-1])\./.test(h) ||
      h.startsWith("169.254.") || h === "metadata.google.internal" ||
      h.endsWith(".local") || h.endsWith(".internal")
    ) {
      return false;
    }
    return ALLOWED_PROVIDER_HOSTS.has(h);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { baseUrl, apiKey, authType, headersJson, model, testPrompt, timeout } = body;

    if (!baseUrl) {
      return NextResponse.json({ ok: false, message: "baseUrl is required" }, { status: 400 });
    }

    // SSRF check — reject requests to non-allowed hosts
    if (!isAllowedProviderUrl(baseUrl)) {
      return NextResponse.json(
        { ok: false, message: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (headersJson) {
      try {
        const parsed = JSON.parse(headersJson);
        for (const [key, value] of Object.entries(parsed)) {
          if (!BLOCKED_PROXY_HEADERS.has(key.toLowerCase())) {
            headers[key] = String(value);
          }
        }
      } catch (e) { console.warn("[ProviderTest] Invalid headersJson:", e); }
    }
    if (apiKey) {
      if (baseUrl.includes("generativelanguage.googleapis.com")) {
        if (baseUrl.includes("/openai/")) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
      } else if (authType === "header") {
        headers["x-api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    // Build URL and body for different provider types
    let url = "";
    let reqBody: Record<string, unknown> = {};

    if (baseUrl.includes("anthropic.com")) {
      headers["x-api-key"] = apiKey || "";
      headers["anthropic-version"] = "2023-06-01";
      url = `${baseUrl.replace(/\/$/, "")}/messages`;
      reqBody = {
        model: model || "claude-3-5-sonnet-20241022",
        max_tokens: 10,
        messages: [{ role: "user", content: testPrompt || "Reply with exactly: OK" }],
      };
    } else if (baseUrl.includes("generativelanguage.googleapis.com")) {
      url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      if (!baseUrl.includes("/openai/")) {
        url += `?key=${encodeURIComponent(apiKey || "")}`;
      }
      reqBody = {
        model: model || "gemini-2.5-flash",
        messages: [{ role: "user", content: testPrompt || "Reply with exactly: OK" }],
        max_tokens: 10,
        temperature: 0,
        stream: false,
      };
    } else {
      // OpenAI-compatible (OpenAI, DeepSeek, Groq, OpenRouter, OpenCode, ZenCode, etc.)
      url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      reqBody = {
        model: model || "gpt-4o-mini",
        messages: [{ role: "user", content: testPrompt || "Reply with exactly: OK" }],
        max_tokens: 10,
        temperature: 0,
        stream: false,
      };
    }

    const controller = new AbortController();
    const timeoutMs = Math.min(timeout || 15000, 15000);
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
      // Try to extract a meaningful error message from various API error formats
      let errorMessage = errText.slice(0, 300);
      try {
        const errJson = JSON.parse(errText);
        if (errJson?.error?.message) {
          // OpenAI format: { error: { message: "..." } }
          // Also handles OpenCode: { type: "error", error: { type: "AuthError", message: "..." } }
          errorMessage = errJson.error.type
            ? `${errJson.error.type}: ${errJson.error.message}`
            : errJson.error.message;
        } else if (errJson?.error?.code && errJson?.error?.message) {
          // Z.ai format: { error: { code: "1000", message: "..." } }
          errorMessage = `Error ${errJson.error.code}: ${errJson.error.message}`;
        } else if (errJson?.message) {
          errorMessage = errJson.message;
        } else if (errJson?.detail) {
          errorMessage = errJson.detail;
        }
      } catch {
        // Not JSON — use raw text
      }

      if (res.status === 401) {
        return NextResponse.json({
          ok: false,
          latencyMs,
          message: `API returned HTTP 401 Unauthorized: Invalid API Key. Please verify that your API key is correct and has the necessary permissions. Detail: ${errorMessage}`,
        });
      }

      return NextResponse.json({
        ok: false,
        latencyMs,
        message: `API returned HTTP ${res.status} ${res.statusText}: ${errorMessage}`,
      });
    }

    // Safely parse the response — handle non-JSON responses
    const responseText = await res.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      return NextResponse.json({
        ok: false,
        latencyMs,
        message: `API returned a non-JSON response: "${responseText.slice(0, 100)}". The API endpoint may not exist at this URL, or the API key may be invalid.`,
      });
    }

    // Extract text from various response formats
    let text = "";
    let inputTokens: number | undefined;
    let outputTokens: number | undefined;

    if (data?.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
      inputTokens = data?.usage?.prompt_tokens;
      outputTokens = data?.usage?.completion_tokens;
    } else if (data?.content?.[0]?.text) {
      text = data.content[0].text;
      inputTokens = data?.usage?.input_tokens;
      outputTokens = data?.usage?.output_tokens;
    } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = data.candidates[0].content.parts[0].text;
      inputTokens = data?.usageMetadata?.promptTokenCount;
      outputTokens = data?.usageMetadata?.candidatesTokenCount;
    } else if (typeof data === "string") {
      text = data;
    } else {
      text = JSON.stringify(data).slice(0, 100);
    }

    return NextResponse.json({
      ok: true,
      latencyMs,
      message: `OK — ${model}`,
      response: text,
      inputTokens,
      outputTokens,
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError"
      ? "Request timed out — the API took too long to respond."
      : e?.message?.includes("fetch")
      ? "Network error — the API URL may be unreachable or blocking requests."
      : e?.message || "Connection failed";
    return NextResponse.json({ ok: false, latencyMs: 0, message: msg });
  }
}
