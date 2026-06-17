// Google OAuth — Step 2: Callback handler
// Google redirects here with ?code=... after user consents.
// We exchange the code for an access token, fetch the user's real profile,
// and postMessage it back to the opener window (the AuthModal popup).
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse(googleErrorPage(`Google returned an error: ${error}`));
  }

  if (!code) {
    return htmlResponse(googleErrorPage("No authorization code received from Google."));
  }

  const clientId = process.env.GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";
  const redirectUri = "https://resumeai-pro.pages.dev/api/auth/google/callback";

  if (!clientId || !clientSecret) {
    return htmlResponse(googleErrorPage("Google OAuth is not configured. Missing GOOGLE_CLIENT_ID or GOOGLE_CLIENT_SECRET."));
  }

  try {
    // Step 1: Exchange authorization code for access token
    const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
        grant_type: "authorization_code",
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      return htmlResponse(googleErrorPage(`Token exchange failed: ${tokenRes.status} ${errText.slice(0, 200)}`));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      return htmlResponse(googleErrorPage("No access token in Google response."));
    }

    // Step 2: Fetch the user's real profile from Google
    const profileRes = await fetch("https://www.googleapis.com/oauth2/v2/userinfo", {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal: AbortSignal.timeout(10000),
    });

    if (!profileRes.ok) {
      return htmlResponse(googleErrorPage(`Failed to fetch Google profile: ${profileRes.status}`));
    }

    const profile = await profileRes.json();

    // profile contains: { id, email, verified_email, name, given_name, family_name, picture, locale }
    if (!profile.email) {
      return htmlResponse(googleErrorPage("Google did not return an email address. Make sure your Google account has a verified email."));
    }

    if (!profile.verified_email) {
      return htmlResponse(googleErrorPage("Your Google email is not verified. Please verify it at https://myaccount.google.com and try again."));
    }

    // Step 3: Return HTML that postMessages the user data back to the opener
    const userData = {
      type: "OAUTH_SUCCESS",
      provider: "google",
      email: profile.email,
      name: profile.name || profile.given_name || profile.email.split("@")[0],
      avatarUrl: profile.picture || "",
    };

    return htmlResponse(successPage(userData));
  } catch (e: any) {
    return htmlResponse(googleErrorPage(`Google OAuth error: ${e?.message || "Unknown error"}`));
  }
}

function htmlResponse(html: string): NextResponse {
  return new NextResponse(html, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

function successPage(userData: { type: string; provider: string; email: string; name: string; avatarUrl: string }): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Sign-In Successful</title>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
    .card { background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); padding: 40px; text-align: center; max-width: 400px; }
    .check { width: 64px; height: 64px; background: #10b981; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; color: white; }
    h1 { font-size: 20px; margin: 0 0 8px; color: #0b1f3a; }
    p { color: #64748b; font-size: 14px; margin: 0; }
    .email { font-weight: 600; color: #1154a3; }
  </style>
</head>
<body>
  <div class="card">
    <div class="check">✓</div>
    <h1>Google Sign-In Successful</h1>
    <p>Signed in as <span class="email">${userData.email}</span></p>
    <p style="margin-top:8px;font-size:12px;">Redirecting you back to ResumeAI Pro…</p>
  </div>
  <script>
    // Send the user data back to the opener window (the AuthModal)
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify(userData)}, "*");
      setTimeout(function() { window.close(); }, 1500);
    } else {
      // If no opener (direct navigation), redirect to the app
      window.location.href = "/";
    }
  </script>
</body>
</html>`;
}

function googleErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>Google Sign-In Error</title>
  <style>
    body { font-family: 'Inter', system-ui, sans-serif; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; background: #f8fafc; }
    .card { background: white; border-radius: 16px; box-shadow: 0 4px 24px rgba(0,0,0,0.1); padding: 40px; text-align: center; max-width: 400px; }
    .x { width: 64px; height: 64px; background: #dc2626; border-radius: 50%; display: flex; align-items: center; justify-content: center; margin: 0 auto 20px; font-size: 32px; color: white; }
    h1 { font-size: 20px; margin: 0 0 8px; color: #0b1f3a; }
    p { color: #64748b; font-size: 14px; margin: 0; word-break: break-word; }
  </style>
</head>
<body>
  <div class="card">
    <div class="x">✕</div>
    <h1>Sign-In Failed</h1>
    <p>${message}</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage({ type: "OAUTH_ERROR", provider: "google", error: ${JSON.stringify(message)} }, "*");
      setTimeout(function() { window.close(); }, 3000);
    }
  </script>
</body>
</html>`;
}
