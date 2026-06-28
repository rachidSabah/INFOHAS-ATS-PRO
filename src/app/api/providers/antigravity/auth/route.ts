/**
 * GET /api/providers/antigravity/auth
 * Initiate Google OAuth flow for Antigravity CLI.
 * Redirects user to Google login page with PKCE challenge.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export async function GET(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const redirectUri = `${url.origin}/api/providers/antigravity/callback`;

    // Generate PKCE
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", verifier); // encode verifier in state

    return NextResponse.redirect(authUrl.toString());
  } catch (e: any) {
    return new NextResponse(
      `<html><body><h1>Auth Error</h1><p>${e?.message}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } }
    );
  }
}

// PKCE helpers
function generateCodeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let verifier = "";
  const bytes = crypto.getRandomValues(new Uint8Array(43));
  for (let i = 0; i < bytes.length; i++) {
    verifier += chars[bytes[i] % chars.length];
  }
  return verifier;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  return btoa(String.fromCharCode(...new Uint8Array(hash)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
