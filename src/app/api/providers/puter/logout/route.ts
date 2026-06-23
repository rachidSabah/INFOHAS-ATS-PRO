// ResumeAI Pro — Puter Provider Logout API
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(_req: NextRequest) {
  // Puter sign-out is handled client-side
  return NextResponse.json({
    ok: true,
    message: "Puter logout handled client-side. Use puter.auth.signOut() from the UI.",
    clientAction: "puter.auth.signOut()",
  });
}
