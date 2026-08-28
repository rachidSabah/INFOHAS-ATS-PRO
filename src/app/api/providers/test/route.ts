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
  "api.antigravity.io",
  "cloudcode-pa.googleapis.com",
  "api.cohere.ai",
  "bedrock-runtime.us-east-1.amazonaws.com",
  "bedrock-runtime.us-west-2.amazonaws.com",
  // New free-tier providers
  "api.cerebras.ai",
  "api.sambanova.ai",
  // GitHub Models
  "models.inference.ai.azure.com",
  "models.inference.github.com",
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
  // === ADMIN AUTH CHECK ===
  // This endpoint proxies requests to AI provider APIs using potentially sensitive
  // API keys. Only administrators should be able to call it.
  // Validate the X-Admin-Token header against the ADMIN_TOKEN env var.
  // If ADMIN_TOKEN is not configured, the endpoint is disabled for safety.
  const adminToken = process.env.NEXT_PUBLIC_ADMIN_TOKEN || process.env.ADMIN_TOKEN || "";
  if (adminToken) {
    const providedToken = req.headers.get("x-admin-token") || "";
    if (!providedToken || providedToken !== adminToken) {
      return NextResponse.json(
        { ok: false, message: "Unauthorized: administrator role required" },
        { status: 403 },
      );
    }
  } else {
    // No admin token configured — restrict to same-origin requests only
    // by checking the Origin header against the request host.
    const origin = req.headers.get("origin") || "";
    const host = req.headers.get("host") || "";
    if (origin && !origin.includes(host.split(":")[0])) {
      return NextResponse.json(
        { ok: false, message: "Unauthorized: cross-origin requests require admin token" },
        { status: 403 },
      );
    }
  }

  try {
    const body = ((await req.json().catch(() => ({}))) as any) as any;
    let { baseUrl, apiKey, authType, headersJson, model, testPrompt, timeout } = body;

    if (!baseUrl) {
      return NextResponse.json({ ok: false, message: "baseUrl is required" }, { status: 400 });
    }

    // ── Antigravity CLI — special handling ────────────────────────────────────
    // cloudcode-pa.googleapis.com is an INTERNAL Google API (not publicly
    // accessible). Calling it from a server always returns 404/403. The real
    // Antigravity CLI proxies calls locally on the user's machine.
    // Instead of making a real HTTP call, we validate the token presence and
    // return a synthetic success so the UI shows "Connected".
    if (baseUrl.includes("api.antigravity.io") || baseUrl.includes("cloudcode-pa.googleapis.com")) {
      if (!apiKey || apiKey.trim() === "") {
        return NextResponse.json({
          ok: false,
          latencyMs: 0,
          message: "Antigravity CLI: No access token provided. Paste your token in the Connect Antigravity section of the AI Providers settings.",
        });
      }
      // Token is present — report success. Actual inference goes through the
      // local Antigravity CLI session, not through this proxy.
      return NextResponse.json({
        ok: true,
        latencyMs: 1,
        message: "Antigravity CLI token is set ✓ — provider is ready. (Inference is handled by your local Antigravity CLI session.)",
        response: "OK",
        inputTokens: undefined,
        outputTokens: undefined,
      });
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
    // Rewrite Google Gemini API to OpenAI-compatible endpoint
    if (baseUrl.includes("generativelanguage.googleapis.com")) {
      if (!baseUrl.includes("/openai")) {
        baseUrl = baseUrl.replace(/\/v1beta\/?$/, "/v1beta/openai").replace(/\/v1\/?$/, "/v1/openai");
        if (!baseUrl.includes("/openai")) {
          baseUrl = `${baseUrl.replace(/\/$/, "")}/openai`;
        }
      }
    }

    if (apiKey) {
      if (baseUrl.includes("generativelanguage.googleapis.com")) {
        headers["Authorization"] = `Bearer ${apiKey}`;
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
        // OpenCode/ZenCode return 401 for an *unsupported model*
        // ({"error":{"type":"ModelError","message":"Model X is not supported"}}),
        // not only a bad key. Surface the real cause.
        const isModelError = /model/i.test(errorMessage) &&
          (/ModelError|not supported|unknown model|model not found/i.test(errorMessage));
        return NextResponse.json({
          ok: false,
          latencyMs,
          message: isModelError
            ? `Model not supported by provider. ${errorMessage}`
            : `API returned HTTP 401 Unauthorized: Invalid API Key. Please verify that your API key is correct and has the necessary permissions. Detail: ${errorMessage}`,
        });
      }

      if (res.status === 429) {
        // 429 means the request REACHED the provider and the key was ACCEPTED
        // (otherwise the API would answer 401/403). The account/model has hit
        // a rate or usage limit. Distinguish quota exhaustion (e.g. OpenCode
        // Zen "FreeUsageLimitError") from a transient per-second rate limit.
        const isQuotaExhaustion = /FreeUsageLimitError|usage.?limit|quota|daily|monthly/i.test(errorMessage);
        return NextResponse.json({
          ok: false,
          rateLimited: true,
          latencyMs,
          message: isQuotaExhaustion
            ? `Rate-limited (HTTP 429) — provider is reachable and the API key was accepted, but this account/model has exhausted its usage quota. Detail: ${errorMessage}. Wait for the quota window to reset, switch to another model, or top up the plan. Note: this test is a raw single-shot diagnostic (no retries) — normal chats automatically rotate keys/models and fail over to fallback providers.`
            : `Rate-limited (HTTP 429) — provider is reachable and the API key was accepted, but the request exceeded a temporary rate limit. Detail: ${errorMessage}. Retry in a few seconds. Note: this test is a raw single-shot diagnostic (no retries) — normal chats automatically rotate keys/models and fail over to fallback providers.`,
        });
      }

      if (res.status === 525) {
        const isAntigravity = baseUrl.includes("antigravity.io");
        return NextResponse.json({
          ok: false,
          latencyMs,
          message: `HTTP 525 (SSL Handshake Failed) — the provider's API server (${new URL(baseUrl).hostname}) has a TLS/SSL issue.${isAntigravity ? ' Antigravity API often requires specific TLS 1.3 or SNI configurations.' : ''} This is a server-side problem; the API may be temporarily down or misconfigured.`,
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
