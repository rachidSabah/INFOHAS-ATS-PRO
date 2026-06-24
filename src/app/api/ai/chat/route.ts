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

    // Input validation — prevent abuse
    const MAX_PROMPT_LENGTH = 100_000; // 100K chars
    if (userPrompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: "userPrompt too long (max 100K characters)" }, { status: 400 });
    }
    if (systemPrompt && systemPrompt.length > MAX_PROMPT_LENGTH) {
      return NextResponse.json({ error: "systemPrompt too long (max 100K characters)" }, { status: 400 });
    }
    const clampedMaxTokens = Math.min(Math.max(Number(maxTokens) || 4096, 100), 16384);
    const clampedTemperature = Math.min(Math.max(Number(temperature) || 0.7, 0), 2);

    // Call Z.ai API directly via fetch (Edge-compatible)
    // We use the REST API for Edge compatibility.
    // SECURITY: Prefer server-only ZAI_API_KEY over NEXT_PUBLIC_ variant.
    // NEXT_PUBLIC_ keys are exposed to the client bundle — avoid if possible.
    const ZAI_API_KEY = process.env.ZAI_API_KEY || "";

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
        temperature: clampedTemperature,
        max_tokens: clampedMaxTokens,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!res.ok) {
      // Log the real error server-side only — return generic message to client
      const errText = await res.text().catch(() => "");
      if (process.env.NODE_ENV !== "production") {
        console.warn("[/api/ai/chat] Upstream error:", res.status, errText.slice(0, 200));
      }
      return NextResponse.json(
        { error: "AI service temporarily unavailable. Please try again.", fallback: true },
        { status: 502 }
      );
    }

    const data = await res.json();
    const text = data?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text, provider: "z-ai" });
  } catch (e: unknown) {
    const error = e as Error;
    console.warn("[/api/ai/chat] error:", error);
    // Don't leak internal error details in production
    const msg = process.env.NODE_ENV === "production"
      ? "AI service temporarily unavailable. Please try again."
      : (error?.message ?? "AI call failed");
    return NextResponse.json(
      { error: msg, fallback: true },
      { status: 500 }
    );
  }
}
