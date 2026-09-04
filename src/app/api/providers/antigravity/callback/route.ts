/**
 * GET /api/providers/antigravity/callback
 * Google OAuth callback — exchanges authorization code for tokens.
 * Returns an HTML page that posts the result to the parent window via postMessage.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";

/**
 * Escape a value for safe interpolation into an HTML text context.
 * The `error` / provider messages below were previously interpolated raw,
 * allowing reflected XSS via crafted query parameters.
 */
function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/**
 * Serialize a value for safe embedding inside a single-quoted JS string in
 * an inline <script>. JSON.stringify escapes quotes/newlines so the value
 * can never break out of the string literal.
 */
function jsStr(value: unknown): string {
  return JSON.stringify(String(value ?? ""));
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // PKCE verifier
  const error = url.searchParams.get("error");
  // postMessage target origin: the opener is this app's own window (the
  // OAuth popup was opened by the app), so restricting to our own origin
  // still delivers the message while never broadcasting tokens elsewhere.
  const openerOrigin = url.origin;

  if (error) {
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: ${jsStr(error)} }, ${jsStr(openerOrigin)});
        document.write('<h1>Authorization Denied</h1><p>${escapeHtml(error)}</p><p>You can close this window.</p>');
       </script></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code || !state) {
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: "Missing code or state parameter" }, ${jsStr(openerOrigin)});
       </script><h1>Missing Parameters</h1><p>Authorization code or state missing.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  try {
    const redirectUri = `${url.origin}/api/providers/antigravity/callback`;

    // Exchange authorization code for tokens
    const tokenRes = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com",
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: state,
      }),
    });

    if (!tokenRes.ok) {
      const errText = await tokenRes.text();
      const errExcerpt = errText.slice(0, 300);
      return new NextResponse(
        `<html><body><script>
          window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: "Token exchange failed" }, ${jsStr(openerOrigin)});
         </script><h1>Token Exchange Failed</h1><p>${escapeHtml(errExcerpt)}</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    const tokenData: any = (await tokenRes.json()) as any;

    // Fetch user email
    let email = "";
    try {
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { "Authorization": `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData: any = (await userRes.json()) as any;
        email = userData.email || "";
      }
    } catch { /* non-fatal */ }

    // Post success to parent window
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({
          type: "antigravity-auth",
          status: "success",
          email: ${JSON.stringify(email)},
          accessToken: ${JSON.stringify(tokenData.access_token)},
          refreshToken: ${JSON.stringify(tokenData.refresh_token)},
          expiresIn: ${tokenData.expires_in || 3600}
        }, ${jsStr(openerOrigin)});
        document.write('<h1>Authentication Successful!</h1><p>You can close this window now.</p>');
       </script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (e: any) {
    const message = e?.message || "Unknown error";
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: ${jsStr(message)} }, ${jsStr(openerOrigin)});
       </script><h1>Authentication Error</h1><p>${escapeHtml(message)}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}
