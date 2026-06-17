// GitHub OAuth — Step 1: Redirect to GitHub authorize
// User clicks "Sign in with GitHub" → this route redirects to GitHub's OAuth page
import { NextResponse } from "next/server";

export const runtime = "edge";

export async function GET() {
  const clientId = process.env.GITHUB_CLIENT_ID || process.env.NEXT_PUBLIC_GITHUB_CLIENT_ID || "";

  if (!clientId) {
    return NextResponse.json(
      {
        error: "GitHub OAuth is not configured.",
        instructions:
          "Super Admin must set GITHUB_CLIENT_ID and GITHUB_CLIENT_SECRET environment variables. " +
          "Create a GitHub OAuth app at https://github.com/settings/developers " +
          "with redirect URI: https://resumeai-pro.pages.dev/api/auth/github/callback",
      },
      { status: 503 }
    );
  }

  const redirectUri = "https://resumeai-pro.pages.dev/api/auth/github/callback";

  const params = new URLSearchParams({
    client_id: clientId,
    redirect_uri: redirectUri,
    scope: "read:user user:email",
    // state is optional but recommended for CSRF protection
  });

  return NextResponse.redirect(`https://github.com/login/oauth/authorize?${params.toString()}`);
}
