// Proxy for fetching live models from AI provider APIs
// Solves CORS issues — browser calls this route, Worker calls the provider API
import { NextRequest, NextResponse } from "next/server";
import { isAllowedProviderUrl, BLOCKED_PROXY_HEADERS } from "@/lib/ssrf-allowlist";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, authType, headersJson } = await req.json();

    if (!baseUrl) {
      return NextResponse.json({ error: "baseUrl is required" }, { status: 400 });
    }

    // SSRF check — uses shared module (proper 172.16/12 coverage + all provider hosts)
    if (!isAllowedProviderUrl(baseUrl)) {
      return NextResponse.json(
        { error: "Provider URL not allowed. Only known AI provider APIs are supported." },
        { status: 403 },
      );
    }

    // Build headers — block dangerous overrides (uses shared BLOCKED_PROXY_HEADERS including "authorization")
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
      models = data.data.map((m: { id?: string }) => m.id).filter(Boolean);
    } else if (data?.models) {
      // Gemini: { models: [{ name: "models/gemini-1.5-pro" }] }
      models = data.models.map((m: { name?: string }) => m.name?.replace(/^models\//, "") || m.name).filter(Boolean);
    } else if (Array.isArray(data)) {
      // Some APIs return a plain array
      models = data.map((m: unknown) => typeof m === "string" ? m : ((m as Record<string, string>)?.id || (m as Record<string, string>)?.name)).filter(Boolean);
    }

    return NextResponse.json({ models: models.sort() });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    console.error("[ProviderModels] Unhandled error:", message);
    return NextResponse.json({
      success: false,
      code: "PROVIDER_MODELS_FAILED",
      message,
    }, { status: 500 });
  }
}
