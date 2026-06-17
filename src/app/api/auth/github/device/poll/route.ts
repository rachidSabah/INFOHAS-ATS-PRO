// GitHub Device Flow — Step 2: Poll for access token
// POST /api/auth/github/device/poll
// Body: { device_code: string }
// Polls GitHub until the user authorizes (or timeout/error).
// On success, fetches the real user profile and returns it.
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";
  const body = await req.json().catch(() => ({}));
  const deviceCode = body.device_code;

  if (!deviceCode) {
    return NextResponse.json({ error: "device_code is required" }, { status: 400 });
  }

  if (!clientId) {
    return NextResponse.json({ error: "GitHub OAuth is not configured." }, { status: 503 });
  }

  // Poll GitHub for the access token
  const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Accept: "application/json",
    },
    body: JSON.stringify({
      client_id: clientId,
      device_code: deviceCode,
      grant_type: "urn:ietf:params:oauth:grant-type:device_code",
    }),
    signal: AbortSignal.timeout(10000),
  });

  if (!tokenRes.ok) {
    return NextResponse.json({ error: `Token request failed: ${tokenRes.status}` }, { status: 502 });
  }

  const tokenData = await tokenRes.json();

  if (tokenData.error) {
    return NextResponse.json({ error: tokenData.error, interval: tokenData.interval || 5 }, { status: 202 });
  }

  const accessToken = tokenData.access_token;
  if (!accessToken) {
    return NextResponse.json({ error: "No access token returned" }, { status: 502 });
  }

  // Fetch the user's real profile
  const profileRes = await fetch("https://api.github.com/user", {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/vnd.github+json",
      "User-Agent": "ResumeAI-Pro",
    },
    signal: AbortSignal.timeout(10000),
  });

  if (!profileRes.ok) {
    return NextResponse.json({ error: `Failed to fetch GitHub profile: ${profileRes.status}` }, { status: 502 });
  }

  const profile = await profileRes.json();

  let email = profile.email;
  let name = profile.name || profile.login;

  if (!email) {
    const emailsRes = await fetch("https://api.github.com/user/emails", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ResumeAI-Pro",
      },
      signal: AbortSignal.timeout(10000),
    });
    if (emailsRes.ok) {
      const emails = await emailsRes.json();
      const primary = (emails as any[]).find((e) => e.primary && e.verified);
      if (primary) email = primary.email;
    }
  }

  if (!email) {
    return NextResponse.json({ error: "Could not retrieve a verified email from GitHub." }, { status: 400 });
  }

  return NextResponse.json({
    type: "OAUTH_SUCCESS",
    provider: "github",
    email,
    name: name || email.split("@")[0],
    avatarUrl: profile.avatar_url || "",
  });
}
