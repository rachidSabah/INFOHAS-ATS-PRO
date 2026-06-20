// Server-side AI fallback — Edge Runtime compatible for Cloudflare Pages
// Uses the Z.ai API directly via fetch (no SDK dependency).
// Used when Puter.js is unavailable or rate-limited.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { systemPrompt, userPrompt, maxTokens = 4096, temperature = 0.7 } = body as {
      systemPrompt?: string;
      userPrompt?: string;
      maxTokens?: number;
      temperature?: number;
    };

    if (!userPrompt || typeof userPrompt !== "string") {
      return NextResponse.json({ error: "userPrompt is required" }, { status: 400 });
    }

    // Call Z.ai API directly via fetch (Edge-compatible)
    // The z-ai-web-dev-sdk isn't Edge-compatible, so we use the REST API.
    // In dev, this falls back to the local engine on the client side if this fails.
    const ZAI_API_KEY = process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY || "";

    // If no key, return a helpful error — the client will fall back to local engine
    if (!ZAI_API_KEY) {
      return NextResponse.json(
        { error: "ZAI_API_KEY not configured. Falling back to client-side engine.", fallback: true },
        { status: 503 }
      );
    }

    const messages = [
      { role: "system", content: systemPrompt || "You are ResumeAI Pro, a helpful assistant for resume and career tasks." },
      { role: "user", content: userPrompt },
    ];

    const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "glm-4.6",
        messages,
        temperature,
        max_tokens: maxTokens,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      // Log the real error server-side only — return generic message to client
      const errText = await res.text().catch(() => "");
      if (process.env.NODE_ENV !== "production") {
        console.error("[/api/ai/chat] Upstream error:", res.status, errText.slice(0, 200));
      }
      return NextResponse.json(
        { error: "AI service temporarily unavailable. Please try again.", fallback: true },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text, provider: "z-ai" });
  } catch (e: any) {
    console.error("[/api/ai/chat] error:", e);
    return NextResponse.json(
      { error: e?.message ?? "AI call failed", fallback: true },
      { status: 500 }
    );
  }
}
