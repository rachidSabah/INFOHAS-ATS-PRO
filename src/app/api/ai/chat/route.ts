// Server-side AI fallback using z-ai-web-dev-sdk
// Used when Puter.js is unavailable or rate-limited.
import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

export const runtime = "nodejs";

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

    const zai = await ZAI.create();
    const messages = [
      { role: "system", content: systemPrompt || "You are ResumeAI Pro, a helpful assistant for resume and career tasks." },
      { role: "user", content: userPrompt },
    ];

    const completion = await zai.chat.completions.create({
      messages,
      temperature,
      max_tokens: maxTokens,
    });

    const text = completion?.choices?.[0]?.message?.content ?? "";
    return NextResponse.json({ text, provider: "z-ai" });
  } catch (e: any) {
    console.error("[/api/ai/chat] error:", e);
    return NextResponse.json({ error: e?.message ?? "AI call failed" }, { status: 500 });
  }
}
