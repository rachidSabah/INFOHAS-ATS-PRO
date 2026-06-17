// GitHub OAuth — Step 2: Callback handler
// GitHub redirects here with ?code=... after user authorizes.
// We exchange the code for an access token, fetch the user's real profile,
// and postMessage it back to the opener window (the AuthModal popup).
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const error = url.searchParams.get("error");

  if (error) {
    return htmlResponse(githubErrorPage(`GitHub returned an error: ${error}`));
  }

  if (!code) {
    return htmlResponse(githubErrorPage("No authorization code received from GitHub."));
  }

  const clientId = process.env.GITHUB_CLIENT_ID || "";
  const clientSecret = process.env.GITHUB_CLIENT_SECRET || "";
  const redirectUri = "https://resumeai-pro.pages.dev/api/auth/github/callback";

  if (!clientId || !clientSecret) {
    return htmlResponse(githubErrorPage("GitHub OAuth is not configured. Missing GITHUB_CLIENT_ID or GITHUB_CLIENT_SECRET."));
  }

  try {
    // Step 1: Exchange authorization code for access token
    const tokenRes = await fetch("https://github.com/login/oauth/access_token", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Accept: "application/json",
      },
      body: JSON.stringify({
        code,
        client_id: clientId,
        client_secret: clientSecret,
        redirect_uri: redirectUri,
      }),
      signal: AbortSignal.timeout(15000),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text().catch(() => "");
      return htmlResponse(githubErrorPage(`Token exchange failed: ${tokenRes.status} ${errText.slice(0, 200)}`));
    }

    const tokenData = await tokenRes.json();
    const accessToken = tokenData.access_token;

    if (!accessToken) {
      const errDesc = tokenData.error_description || tokenData.error || "No access token in GitHub response.";
      return htmlResponse(githubErrorPage(`GitHub did not return an access token: ${errDesc}`));
    }

    // Step 2: Fetch the user's real profile from GitHub
    const profileRes = await fetch("https://api.github.com/user", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        Accept: "application/vnd.github+json",
        "User-Agent": "ResumeAI-Pro",
      },
      signal: AbortSignal.timeout(10000),
    });

    if (!profileRes.ok) {
      return htmlResponse(githubErrorPage(`Failed to fetch GitHub profile: ${profileRes.status}`));
    }

    const profile = await profileRes.json();

    // GitHub profile: { id, login, name, email, avatar_url, ... }
    // Note: email may be null if the user has "Keep my email addresses private" enabled.
    // In that case, we need to fetch emails separately.
    let email = profile.email;
    let name = profile.name || profile.login;

    if (!email) {
      // Fetch emails from /user/emails endpoint
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
        // Find the primary verified email
        const primary = (emails as any[]).find((e) => e.primary && e.verified);
        if (primary) {
          email = primary.email;
        } else {
          // Fall back to the noreply email GitHub provides
          const verified = (emails as any[]).find((e) => e.verified);
          if (verified) email = verified.email;
        }
      }
    }

    if (!email) {
      return htmlResponse(githubErrorPage("Could not retrieve a verified email from GitHub. Please ensure your GitHub account has a verified email at https://github.com/settings/emails"));
    }

    // Step 3: Return HTML that postMessages the user data back to the opener
    const userData = {
      type: "OAUTH_SUCCESS",
      provider: "github",
      email: email,
      name: name || email.split("@")[0],
      avatarUrl: profile.avatar_url || "",
    };

    return htmlResponse(successPage(userData));
  } catch (e: any) {
    return htmlResponse(githubErrorPage(`GitHub OAuth error: ${e?.message || "Unknown error"}`));
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
  <title>GitHub Sign-In Successful</title>
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
    <h1>GitHub Sign-In Successful</h1>
    <p>Signed in as <span class="email">${userData.email}</span></p>
    <p style="margin-top:8px;font-size:12px;">Redirecting you back to ResumeAI Pro…</p>
  </div>
  <script>
    if (window.opener) {
      window.opener.postMessage(${JSON.stringify(userData)}, "*");
      setTimeout(function() { window.close(); }, 1500);
    } else {
      window.location.href = "/";
    }
  </script>
</body>
</html>`;
}

function githubErrorPage(message: string): string {
  return `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <title>GitHub Sign-In Error</title>
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
      window.opener.postMessage({ type: "OAUTH_ERROR", provider: "github", error: ${JSON.stringify(message)} }, "*");
      setTimeout(function() { window.close(); }, 3000);
    }
  </script>
</body>
</html>`;
}
