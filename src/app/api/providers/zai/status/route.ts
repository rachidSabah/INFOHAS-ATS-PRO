// ResumeAI Pro — Z.ai Provider Status API
// Returns Z.ai authentication status.
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(_req: NextRequest) {
  const ZAI_API_KEY = process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY || "";
  const hasKey = !!ZAI_API_KEY;

  // Try to validate the key with a lightweight call
  let keyValid = false;
  if (hasKey) {
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
      keyValid = res.ok;
    } catch {
      keyValid = false;
    }
  }

  return NextResponse.json({
    connected: hasKey && keyValid,
    authenticated: hasKey && keyValid,
    email: hasKey ? "api-key@z.ai" : null,
    expiresAt: hasKey ? Date.now() + 24 * 60 * 60 * 1000 : null,
    models: hasKey ? ["glm-4.6", "glm-5", "glm-5.1", "glm-5.2", "glm-5-air", "glm-5-flash", "codegeex-4"] : [],
    sharedAdminAccount: false,
  });
}
