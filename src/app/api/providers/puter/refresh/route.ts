// ResumeAI Pro — Puter Provider Refresh API
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(_req: NextRequest) {
  // Puter session refresh is handled client-side via puter.auth
  return NextResponse.json({
    ok: false,
    message: "Puter session refresh requires client-side interaction. Use the provider UI to refresh.",
    clientAction: "puter.auth.getUser()",
  });
}
