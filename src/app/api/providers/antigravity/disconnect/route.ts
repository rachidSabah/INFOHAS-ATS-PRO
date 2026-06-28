/** POST /api/providers/antigravity/disconnect — Authenticated */
import { NextRequest, NextResponse } from "next/server";
export const runtime = "edge";
export async function POST(req: NextRequest) {
  return NextResponse.json({ status: "disconnected" });
}
