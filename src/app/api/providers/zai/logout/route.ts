// ResumeAI Pro — Z.ai Provider Logout API
// Edge Runtime compatible.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(_req: NextRequest) {
  // Z.ai logout clears the client-side session
  return NextResponse.json({
    ok: true,
    message: "Z.ai session cleared on client. Use the provider UI to disconnect.",
  });
}
