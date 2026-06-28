/**
 * POST /api/providers/antigravity/start
 * Authenticated — called from frontend before opening OAuth popup.
 * Generates PKCE state, builds Google OAuth URL, returns authUrl + sessionId.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export async function POST(req: NextRequest) {
  try {
    const url = new URL(req.url);
    const redirectUri = `${url.origin}/api/providers/antigravity/callback`;

    // Generate PKCE
    const verifier = generateCodeVerifier();
    const challenge = await generateCodeChallenge(verifier);

    // Build Google OAuth URL
    const authUrl = new URL("https://accounts.google.com/o/oauth2/v2/auth");
    authUrl.searchParams.set("client_id", CLIENT_ID);
    authUrl.searchParams.set("response_type", "code");
    authUrl.searchParams.set("redirect_uri", redirectUri);
    authUrl.searchParams.set("scope", SCOPES.join(" "));
    authUrl.searchParams.set("code_challenge", challenge);
    authUrl.searchParams.set("code_challenge_method", "S256");
    authUrl.searchParams.set("access_type", "offline");
    authUrl.searchParams.set("prompt", "consent");
    authUrl.searchParams.set("state", verifier);

    // Generate a session ID for tracking this auth attempt
    const sessionId = crypto.randomUUID();

    return NextResponse.json({
      authUrl: authUrl.toString(),
      sessionId,
      expiresIn: 600, // 10 minutes
    });
  } catch (e: any) {
    return NextResponse.json({ error: e?.message || "Auth start failed" }, { status: 500 });
  }
}

// PKCE helpers
function generateCodeVerifier(): string {
  const chars = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~";
  let result = "";
  const bytes = new Uint8Array(43);
  crypto.getRandomValues(bytes);
  for (let i = 0; i < bytes.length; i++) {
    result += chars[bytes[i] % chars.length];
  }
  return result;
}

async function generateCodeChallenge(verifier: string): Promise<string> {
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest("SHA-256", data);
  const bytes = Array.from(new Uint8Array(hash));
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
