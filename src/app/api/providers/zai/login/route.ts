// ResumeAI Pro — Z.ai Provider Login API
// Validates the Z.ai API key and returns session info.
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const apiKey = body.apiKey || process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY || "";

    if (!apiKey) {
      return NextResponse.json({
        ok: false,
        error: "Z.ai API key not provided. Set NEXT_PUBLIC_ZAI_API_KEY or provide apiKey in the request body.",
      }, { status: 400 });
    }

    // Validate the API key
    const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "glm-4.6",
        messages: [{ role: "user", content: "Hello, respond with OK." }],
        max_tokens: 10,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: `Z.ai API key validation failed (${res.status}). Please check your API key.`,
      }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      authenticated: true,
      email: "api-key@z.ai",
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
      models: ["glm-4.6", "glm-5", "glm-5.1", "glm-5.2", "glm-5-air", "glm-5-flash", "codegeex-4"],
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: `Z.ai login failed: ${e?.message || "Unknown error"}`,
    }, { status: 500 });
  }
}
