// ResumeAI Pro — Z.ai Provider Status API
// Returns Z.ai authentication status.
// Edge Runtime compatible.
// OPTIMIZED: Caches validation result to avoid paid API calls per request.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Cache the key validation result for 5 minutes
let cachedValidation = { valid: false, checkedAt: 0 };
const VALIDATION_CACHE_TTL = 5 * 60 * 1000; // 5 minutes

export async function GET(_req: NextRequest) {
  const ZAI_API_KEY = process.env.ZAI_API_KEY || process.env.NEXT_PUBLIC_ZAI_API_KEY || "";
  const hasKey = !!ZAI_API_KEY;

  // Use cached validation if recent enough
  let keyValid = false;
  if (hasKey) {
    const now = Date.now();
    if (now - cachedValidation.checkedAt < VALIDATION_CACHE_TTL) {
      keyValid = cachedValidation.valid;
    } else {
      // Validate with a minimal API call (cheapest model, 1 token)
      try {
        const res = await fetch("https://api.z.ai/api/paas/v4/chat/completions", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "Authorization": `Bearer ${ZAI_API_KEY}`,
          },
          body: JSON.stringify({
            model: "glm-5-flash", // Lightest model
            messages: [{ role: "user", content: "Hi" }],
            max_tokens: 1, // Minimal tokens
          }),
          signal: AbortSignal.timeout(10000),
        });
        keyValid = res.ok;
        cachedValidation = { valid: keyValid, checkedAt: now };
      } catch {
        keyValid = false;
        cachedValidation = { valid: false, checkedAt: now };
      }
    }
  }

  return NextResponse.json({
    connected: hasKey && keyValid,
    authenticated: hasKey && keyValid,
    email: hasKey ? "api-key@z.ai" : null,
    expiresAt: hasKey ? Date.now() + 24 * 60 * 60 * 1000 : null,
    models: hasKey ? ["glm-4.6", "glm-5", "glm-5.1", "glm-5.2", "glm-5-air", "glm-5-flash", "glm-5-long", "glm-5-thinking", "codegeex-4"] : [],
    sharedAdminAccount: false,
  });
}
