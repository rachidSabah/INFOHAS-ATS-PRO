// ResumeAI Pro — Z.ai Provider Refresh API
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(_req: NextRequest) {
  const ZAI_API_KEY = process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY || "";

  if (!ZAI_API_KEY) {
    return NextResponse.json({
      ok: false,
      error: "Z.ai API key not configured.",
    }, { status: 401 });
  }

  // Validate the key again
  try {
    const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "Authorization": `Bearer ${ZAI_API_KEY}`,
      },
      body: JSON.stringify({
        model: "glm-4.6",
        messages: [{ role: "user", content: "Ping" }],
        max_tokens: 5,
      }),
      signal: AbortSignal.timeout(10000),
    });

    if (!res.ok) {
      return NextResponse.json({
        ok: false,
        error: "Z.ai API key is no longer valid. Please reconnect.",
      }, { status: 401 });
    }

    return NextResponse.json({
      ok: true,
      authenticated: true,
      expiresAt: Date.now() + 24 * 60 * 60 * 1000,
    });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: `Refresh failed: ${e?.message || "Unknown error"}`,
    }, { status: 500 });
  }
}
