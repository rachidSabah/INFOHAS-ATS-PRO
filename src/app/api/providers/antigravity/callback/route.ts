/**
 * GET /api/providers/antigravity/callback
 * Google OAuth callback — exchanges authorization code for tokens.
 * Returns an HTML page that posts the result to the parent window via postMessage.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state"); // PKCE verifier
  const error = url.searchParams.get("error");

  if (error) {
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: "${error}" }, "*");
        document.write('<h1>Authorization Denied</h1><p>${error}</p><p>You can close this window.</p>');
       </script></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } }
    );
  }

  if (!code || !state) {
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: "Missing code or state parameter" }, "*");
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
      return new NextResponse(
        `<html><body><script>
          window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: "Token exchange failed" }, "*");
         </script><h1>Token Exchange Failed</h1><p>${errText.slice(0, 300)}</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } }
      );
    }

    const tokenData: any = await tokenRes.json();

    // Fetch user email
    let email = "";
    try {
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: { "Authorization": `Bearer ${tokenData.access_token}` },
      });
      if (userRes.ok) {
        const userData: any = await userRes.json();
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
        }, "*");
        document.write('<h1>Authentication Successful!</h1><p>You can close this window now.</p>');
       </script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } }
    );
  } catch (e: any) {
    return new NextResponse(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "error", error: ${JSON.stringify(e?.message || "Unknown error")} }, "*");
       </script><h1>Authentication Error</h1><p>${e?.message}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}
