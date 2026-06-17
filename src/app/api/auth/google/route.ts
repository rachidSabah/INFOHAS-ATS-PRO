// Google OAuth — Step 1: Redirect to Google consent screen
// User clicks "Sign in with Google" → this route redirects to Google's OAuth page
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  const clientId = process.env.GOOGLE_CLIENT_ID || process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID || "";
  const clientSecret = process.env.GOOGLE_CLIENT_SECRET || "";

  if (!clientId) {
    return NextResponse.json(
      {
        error: "Google OAuth is not configured.",
        instructions:
          "Super Admin must set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET environment variables. " +
          "Create a Google OAuth app at https://console.cloud.google.com/apis/credentials " +
          "with redirect URI: https://resumeai-pro.pages.dev/api/auth/google/callback",
      },
      { status: 503 }
    );
  }

  // Determine the redirect URI based on the request origin
  // This allows it to work on both pages.dev and custom domains
  const redirectUri = "https://resumeai-pro.pages.dev/api/auth/google/callback";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    response_type: "code",
    scope: "openid email profile",
    access_type: "offline",
    prompt: "consent",
  });

  return NextResponse.redirect(`https://accounts.google.com/o/oauth2/v2/auth?${params.toString()}`);
}
