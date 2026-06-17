// GitHub Device Flow — Step 1: Request device code
// POST /api/auth/github/device
// Returns: { device_code, user_code, verification_uri, expires_in, interval }
// The user visits verification_uri and enters user_code to authorize.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST() {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";

  if (!clientId) {
    return NextResponse.json(
      {
        error: "GitHub OAuth is not configured.",
        instructions:
          "Set NEXT_PUBLIC_GITHUB_CLIENT_ID. Create a GitHub OAuth app at https://github.com/settings/developers " +
          "(callback URL: https://resumeai-pro.pages.dev, no client secret needed for device flow).",
      },
      { status: 503 }
    );
  }

  const res = await fetch("https://github.com/login/device/code", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      scope: "read:user user:email",
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!res.ok) {
    const errText = await res.text().catch(() => "");
    return NextResponse.json({ error: `GitHub device code request failed: ${res.status} ${errText.slice(0, 200)}` }, { status: 502 });
  }

  const data = await res.json();
  // data: { device_code, user_code, verification_uri, expires_in, interval }
  return NextResponse.json(data);
}
