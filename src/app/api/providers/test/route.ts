// CORS proxy for testing AI provider connections
// The browser can't call provider APIs directly due to CORS — this route proxies the request
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const { baseUrl, apiKey, authType, headersJson, model, testPrompt, timeout } = await req.json();

    if (!baseUrl) {
      return NextResponse.json({ ok: false, message: "baseUrl is required" }, { status: 400 });
    }

    // Build headers
    const headers: Record<string, string> = {
      "Content-Type": "application/json",
    };
    if (headersJson) {
      try { Object.assign(headers, JSON.parse(headersJson)); } catch {}
    }
    if (apiKey) {
      if (authType === "header") {
        headers["x-api-key"] = apiKey;
      } else {
        headers["Authorization"] = `Bearer ${apiKey}`;
      }
    }

    // Special case for Anthropic Claude
    if (baseUrl.includes("anthropic.com")) {
      headers["x-api-key"] = apiKey || "";
      headers["anthropic-version"] = "2023-06-01";
    }

    const url = `${baseUrl.replace(/\/$/, "")}/chat/completions`;

    const body: any = {
      model: model || "gpt-4o-mini",
      messages: [{ role: "user", content: testPrompt || "Reply with exactly: OK" }],
      max_tokens: 10,
      temperature: 0,
      stream: false,
    };

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeout || 15000);

    const t0 = performance.now();
    const res = await fetch(url, {
      method: "POST",
      headers,
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const latencyMs = Math.round(performance.now() - t0);

    if (!res.ok) {
      const errText = await res.text().catch(() => "");
      return NextResponse.json({
        ok: false,
        latencyMs,
        message: `API returned ${res.status} ${res.statusText}: ${errText.slice(0, 200)}`,
      });
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? data?.content?.[0]?.text ?? "";
    const inputTokens = data?.usage?.prompt_tokens ?? data?.usage?.input_tokens;
    const outputTokens = data?.usage?.completion_tokens ?? data?.usage?.output_tokens;

    return NextResponse.json({
      ok: true,
      latencyMs,
      message: `OK — ${model}`,
      response: text,
      inputTokens,
      outputTokens,
    });
  } catch (e: any) {
    const msg = e?.name === "AbortError" ? "Request timed out" : e?.message || "Connection failed";
    return NextResponse.json({ ok: false, latencyMs: 0, message: msg });
  }
}
