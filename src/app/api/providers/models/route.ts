// Proxy for fetching live models from AI provider APIs
// Solves CORS issues — browser calls this route, Worker calls the provider API
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// SSRF protection — same allowlist as chat route
const ALLOWED_HOSTS = new Set([
  "api.openai.com", "api.anthropic.com", "generativelanguage.googleapis.com",
  "api.groq.com", "api.deepseek.com", "integrate.api.nvidia.com",
  "openrouter.ai", "api.opencode.com", "opencode.ai",
  "api.perplexity.ai", "api.mistral.ai", "api.cohere.com",
  "api.together.xyz", "api.z.ai", "api.aimlapi.com", "api.azure.com",
]);

function isAllowedUrl(urlStr: string): boolean {
  try {
    const url = new URL(urlStr);
    const h = url.hostname.toLowerCase();
    if (h === "localhost" || h === "127.0.0.1" || h.startsWith("192.168.") ||
        h.startsWith("10.") || h.startsWith("172.16.") || h.startsWith("169.254.") ||
        h.endsWith(".local") || h.endsWith(".internal") || h === "0.0.0.0") {
      return false;
    }
    return ALLOWED_HOSTS.has(h);
  } catch { return false; }
}

export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, authType, headersJson } = await req.json();

    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }

    // SSRF check
    if (!isAllowedUrl(baseUrl)) {
      return NextResponse.json(
        { error: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }

    // Build headers — block dangerous overrides
    const BLOCKED_HEADERS = new Set(["host", "cookie", "x-forwarded-for", "x-real-ip"]);
    const headers: Record<string, string> = {};
    if (headersJson) {
      try {
        const parsed = JSON.parse(headersJson);
        for (const [key, value] of Object.entries(parsed)) {
          if (!BLOCKED_HEADERS.has(key.toLowerCase())) {
            headers[key] = String(value);
          }
        }
      } catch (e) { console.warn("[ProviderModels] Invalid headersJson:", e); }
    }
    if (apiKey) {
      if (authType === "header") {
        headers["x-api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    // Build URL — OpenAI-compatible APIs use GET /models
    let url = `${baseUrl.replace(/\/$/, "")}/models`;
    if (authType === "query" && apiKey) {
      url += `?api_key=${encodeURIComponent(apiKey)}`;
    }

    // Special case for Gemini
    if (baseUrl.includes("generativelanguage.googleapis.com")) {
      url = `${baseUrl.replace(/\/$/, "")}/models?key=${encodeURIComponent(apiKey || "")}`;
    }

    // Special case for Anthropic Claude
    if (baseUrl.includes("anthropic.com")) {
      headers["x-api-key"] = apiKey || "";
      headers["anthropic-version"] = "2023-06-01";
    }

    const res = await fetch(url, {
      method: "GET",
      headers: {
        "Content-Type": "application/json",
        ...headers,
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({ error: `${res.status} ${res.statusText}: ${errText.slice(0, 200)}` }, { status: res.status });
    }

    const data = await res.json();

    // Normalize the response — different APIs return different shapes
    let models: string[] = [];
    if (data?.data) {
      // OpenAI-compatible: { data: [{ id: "model-name" }] }
      models = data.data.map((m: any) => m.id).filter(Boolean);
    } else if (data?.models) {
      // Gemini: { models: [{ name: "models/gemini-1.5-pro" }] }
      models = data.models.map((m: any) => m.name?.replace(/^models\//, "") || m.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      // Some APIs return a plain array
      models = data.map((m: any) => typeof m === "string" ? m : (m.id || m.name)).filter(Boolean);
    }

    return NextResponse.json({ models: models.sort() });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Failed to fetch models" }, { status: 500 });
  }
}
