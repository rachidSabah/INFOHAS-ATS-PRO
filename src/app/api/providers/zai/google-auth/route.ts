// ResumeAI Pro — Z.ai Google OAuth Verification API
// Verifies a Google ID token server-side before trusting it.
// Edge Runtime compatible.
//
// This route validates that a Google OAuth token was issued for our app
// and hasn't been tampered with. It uses Google's public tokeninfo endpoint
// which doesn't require a server-side Google SDK.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    const { idToken, accessToken } = body;

    if (!idToken && !accessToken) {
      return NextResponse.json({
        ok: false,
        error: "No Google token provided. Send idToken or accessToken in the request body.",
      }, { status: 400 });
    }

    const clientId = process.env.NEXT_PUBLIC_GOOGLE_CLIENT_ID;
    if (!clientId) {
      return NextResponse.json({
        ok: false,
        error: "Google OAuth is not configured on the server. Set NEXT_PUBLIC_GOOGLE_CLIENT_ID.",
      }, { status: 500 });
    }

    // If we have an access token, verify it and get user info
    if (accessToken) {
      try {
        const userInfoRes = await fetch("https://www.googleapis.com/oauth2/v3/userinfo", {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(10000),
        });

        if (!userInfoRes.ok) {
          return NextResponse.json({
            ok: false,
            error: `Google access token validation failed (${userInfoRes.status}).`,
          }, { status: 401 });
        }

        const userInfo = await userInfoRes.json();

        return NextResponse.json({
          ok: true,
          verified: true,
          userInfo: {
            sub: userInfo.sub,
            email: userInfo.email,
            email_verified: userInfo.email_verified,
            name: userInfo.name,
            picture: userInfo.picture,
          },
        });
      } catch (e: any) {
        return NextResponse.json({
          ok: false,
          error: `Google access token verification failed: ${e?.message || "Unknown error"}`,
        }, { status: 401 });
      }
    }

    // If we have an ID token, verify it via Google's tokeninfo endpoint
    if (idToken) {
      try {
        const tokenInfoRes = await fetch(
          `https://oauth2.googleapis.com/tokeninfo?id_token=${encodeURIComponent(idToken)}`,
          { signal: AbortSignal.timeout(10000) },
        );

        if (!tokenInfoRes.ok) {
          return NextResponse.json({
            ok: false,
            error: `Google ID token validation failed (${tokenInfoRes.status}). The token may be expired or invalid.`,
          }, { status: 401 });
        }

        const payload = await tokenInfoRes.json();

        // Verify audience matches our client ID
        if (payload.aud !== clientId) {
          return NextResponse.json({
            ok: false,
            error: "Token audience mismatch. This token was not issued for this application.",
          }, { status: 401 });
        }

        // Verify token is not expired
        if (payload.exp && Date.now() / 1000 > payload.exp) {
          return NextResponse.json({
            ok: false,
            error: "Google ID token has expired. Please sign in again.",
          }, { status: 401 });
        }

        return NextResponse.json({
          ok: true,
          verified: true,
          userInfo: {
            sub: payload.sub,
            email: payload.email,
            email_verified: payload.email_verified,
            name: payload.name,
            picture: payload.picture,
          },
        });
      } catch (e: any) {
        return NextResponse.json({
          ok: false,
          error: `Google ID token verification failed: ${e?.message || "Unknown error"}`,
        }, { status: 401 });
      }
    }

    return NextResponse.json({
      ok: false,
      error: "Invalid request.",
    }, { status: 400 });
  } catch (e: any) {
    return NextResponse.json({
      ok: false,
      error: `Google OAuth verification failed: ${e?.message || "Unknown error"}`,
    }, { status: 500 });
  }
}
