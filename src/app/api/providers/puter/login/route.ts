// ResumeAI Pro — Puter Provider Login API
// Initiates Puter.js authentication from the server side.
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(_req: NextRequest) {
  // Puter authentication must happen client-side (it opens a popup).
  // This endpoint exists for API consistency but returns instructions.
  return NextResponse.json({
    ok: false,
    message: "Puter authentication requires client-side interaction (OAuth popup). Use the provider UI to sign in.",
    clientAction: "puter.auth.signIn()",
  });
}
