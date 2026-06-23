// CORS proxy for testing AI provider connections
// The browser can't call provider APIs directly due to CORS — this route proxies the request
import { NextRequest, NextResponse } from "next/server";
import { isAllowedProviderUrl, BLOCKED_PROXY_HEADERS } from "@/lib/ssrf-allowlist";

export const runtime = "edge";

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
      // === GOOGLE GEMINI ===
      // Two endpoint types, different auth methods:
      //   1. OpenAI-compatible (/v1beta/openai/...): Authorization: Bearer
      //   2. Native API (/v1/models/...): ?key= query param
      // The x-goog-api-key header works but can be stripped by some edge runtimes.
      if (baseUrl.includes("generativelanguage.googleapis.com")) {
        if (baseUrl.includes("/openai/")) {
          // OpenAI-compatible endpoint: use Bearer token
          headers["Authorization"] = `Bearer ${apiKey}`;
        }
        // Native endpoint: key appended as ?key= below — no auth header
      } else if (authType === "header") {
        headers["x-api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    // Special case for Anthropic Claude — different endpoint
    let url = "";
    let reqBody: any = {};

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
      // Google Gemini
      // OpenAI-compatible endpoint (/v1beta/openai/): uses Bearer token (set above)
      // Native endpoint: uses ?key= query parameter
      url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;
      // Only append ?key= for native endpoint (not OpenAI-compatible)
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
    const timeoutId = setTimeout(() => controller.abort(), Math.min(timeout || 15000, 15000));

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
        message: `API returned HTTP ${res.status} ${res.statusText}${errText ? `: ${errText.slice(0, 150)}` : ""}`,
      });
    }

    // Safely parse the response — handle non-JSON responses
    const responseText = await res.text();
    let data: any;
    try {
      data = JSON.parse(responseText);
    } catch {
      // Response is not JSON — probably an error page or "Not Found" text
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
      // OpenAI-compatible
      text = data.choices[0].message.content;
      inputTokens = data?.usage?.prompt_tokens;
      outputTokens = data?.usage?.completion_tokens;
    } else if (data?.content?.[0]?.text) {
      // Anthropic
      text = data.content[0].text;
      inputTokens = data?.usage?.input_tokens;
      outputTokens = data?.usage?.output_tokens;
    } else if (data?.candidates?.[0]?.content?.parts?.[0]?.text) {
      // Gemini
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
