// CORS proxy for AI provider chat completions
// Browser cannot call provider APIs directly due to CORS — this route proxies the request server-side
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// SSRF protection — only allow known AI provider hostnames
const ALLOWED_HOSTS = new Set([
  "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com",
  "api.groq.com", "api.deepseek.com", "integrate.api.nvidia.com",
  "openrouter.ai", "api.opencode.com", "api.perplexity.ai",
  "api.mistral.ai", "api.cohere.com", "api.together.xyz",
  "api.z.ai", "api.aimlapi.com", "api.azure.com",
]);

function isAllowedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname.toLowerCase();
    // Block internal/private networks
    if (h === "localhost" || h === "127.0.0.1" || h.startsWith("192.168.") ||
        h.startsWith("10.") || h.startsWith("172.16.") || h.startsWith("169.254.") ||
        h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0") {
      return false;
    }
    return ALLOWED_HOSTS.has(h);
  } catch {
    return false;
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { baseUrl, apiKey, authType, headersJson, model, messages, maxTokens, temperature, responsePath } = body;

    if (!baseUrl) {
      return NextResponse.json({ ok: false, error: "baseUrl is required" }, { status: 400 });
    }

    // SSRF check — reject requests to non-allowed hosts
    if (!isAllowedUrl(baseUrl)) {
      return NextResponse.json(
        { ok: false, error: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }

    // Block dangerous header overrides
    const BLOCKED_HEADERS = new Set(["host", "cookie", "authorization", "x-forwarded-for", "x-real-ip"]);

    // Build headers
    const headers: Record<string, string> = { "Content-Type": "application/json" };
    if (headersJson) {
      try {
        const parsed = JSON.parse(headersJson);
        for (const [key, value] of Object.entries(parsed)) {
          if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
            headers[key] = String(value);
          }
        }
      } catch (e) { console.warn("[ProviderChat] Invalid headersJson:", e); }
    }
    if (apiKey) {
      const isGemini = baseUrl.includes("generativelanguage.googleapis.com");
      const isGeminiOpenAI = isGemini && baseUrl.includes("/openai/");
      if (isGemini) {
        if (isGeminiOpenAI) {
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
      } else if (authType === "header") {
        headers["x-api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    // Build URL
    let url = baseUrl.endsWith("/chat/completions")
      ? baseUrl
      : `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    // Gemini native endpoint: use ?key=
    const isGemini = baseUrl.includes("generativelanguage.googleapis.com");
    if (isGemini && !baseUrl.includes("/openai/") && apiKey) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}key=${encodeURIComponent(apiKey)}`;
    } else if (authType === "query" && apiKey) {
      const sep = url.includes("?") ? "&" : "?";
      url = `${url}${sep}key=${encodeURIComponent(apiKey)}`;
    }

    // Build request body (OpenAI chat completions format)
    const reqBody: Record<string, any> = {
      model: model || "gpt-4o-mini",
      messages: messages || [{ role: "user", content: "Hello" }],
      max_tokens: maxTokens ?? 4096,
      temperature: temperature ?? 0.7,
      stream: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), Math.min((body.timeout || 30) * 1000, 60000));

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
      return NextResponse.json({
        ok: false,
        latencyMs,
        error: `API returned HTTP ${res.status}: ${errText.slice(0, 200)}`,
      }, { status: res.status });
    }

    const data = await res.json();

    // Extract text from common response shapes (same logic as callUserProvider)
    let text = "";
    if (responsePath) {
      text = responsePath.split(".").reduce((acc: any, key: string) => {
        const m = key.match(/^([^\[]+)(?:\[(\d+)\])?$/);
        if (!m) return acc;
        const v = acc?.[m[1]];
        return m[2] !== undefined ? v?.[parseInt(m[2], 10)] : v;
      }, data) ?? "";
    } else if (data?.choices?.[0]?.message?.content) {
      text = data.choices[0].message.content;
    } else if (Array.isArray(data?.content) && data.content[0]?.text) {
      text = data.content[0].text;
    } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      text = data.candidates[0].content.parts[0].text;
    } else if (typeof data?.text === "string") {
      text = data.text;
    } else if (typeof data?.content === "string") {
      text = data.content;
    } else {
      text = JSON.stringify(data);
    }

    return NextResponse.json({ ok: true, latencyMs, text });
  } catch (e: any) {
    const msg = e?.name === "AbortError"
      ? "Request timed out"
      : e?.message?.includes("fetch") || e?.message?.includes("Failed to fetch")
      ? "The provider endpoint is unreachable. Possible causes: wrong URL, CORS blocked, provider offline."
      : e?.message || "Connection failed";
    return NextResponse.json({ ok: false, latencyMs: 0, error: msg });
  }
}
