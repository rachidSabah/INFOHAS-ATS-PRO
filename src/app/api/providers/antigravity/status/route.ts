/** GET /api/providers/antigravity/status — Authenticated */
import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";
export async function GET(req: NextRequest) {
  return NextResponse.json({ connected: false, provider: "antigravity" });
}
