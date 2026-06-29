// Proxy for fetching live models from AI provider APIs
// Solves CORS issues — browser calls this route, Worker calls the provider API
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
  "api-inference.huggingface.co", "api.puter.com", "api.antigravity.io", "api.cohere.ai",
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
    const { baseUrl, apiKey, authType, headersJson } = await req.json();

    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }

    if (!isAllowedProviderUrl(baseUrl)) {
      return NextResponse.json(
        { error: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }

    const headers: Record<string, string> = {};
    if (headersJson) {
      try {
        const parsed = JSON.parse(headersJson);
        for (const [key, value] of Object.entries(parsed)) {
          if (!BLOCKED_PROXY_HEADERS.has(key.toLowerCase())) {
            headers[key] = String(value);
          }
        }
      } catch (e) { console.warn("[ProviderModels] Invalid headersJson:", e); }
    }
    if (apiKey) {
      if (authType === "header") { headers["x-api-key"] = apiKey; }
      else { headers["Authorization"] = `Bearer ${apiKey}`; }
    }

    let url = `${baseUrl.replace(/\/$/, "")}/models`;
    if (authType === "query" && apiKey) {
      url += `?api_key=${encodeURIComponent(apiKey)}`;
    }
    if (baseUrl.includes("generativelanguage.googleapis.com")) {
      url = `${baseUrl.replace(/\/$/, "")}/models?key=${encodeURIComponent(apiKey || "")}`;
    }
    if (baseUrl.includes("anthropic.com")) {
      headers["x-api-key"] = apiKey || "";
      headers["anthropic-version"] = "2023-06-01";
    }

    const res = await fetch(url, {
      method: "GET",
      headers: { "Content-Type": "application/json", ...headers },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      const isCloudflare525 = res.status === 525;
      const explanation = isCloudflare525
        ? `HTTP 525 (SSL Handshake Failed) — the provider's API server (${new URL(baseUrl).hostname}) has a TLS/SSL issue. This is a server-side problem, not a configuration issue.`
        : `${res.status} ${res.statusText}: ${errText.slice(0, 200)}`;
      return NextResponse.json({ error: explanation }, { status: res.status });
    }

    const data = await res.json();

    let models: string[] = [];
    if (data?.data) {
      models = data.data.map((m: { id?: string }) => m.id).filter(Boolean);
    } else if (data?.models) {
      models = data.models.map((m: { name?: string }) => m.name?.replace(/^models\//, "") || m.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      models = data.map((m: unknown) => typeof m === "string" ? m : ((m as Record<string, string>)?.id || (m as Record<string, string>)?.name)).filter(Boolean);
    }

    return NextResponse.json({ models: models.sort() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.warn("[ProviderModels] Unhandled error:", message);
    return NextResponse.json({
      success: false, code: "PROVIDER_MODELS_FAILED", message,
    }, { status: 500 });
  }
}
