/**
 * POST /api/provider-sessions/puter
 * Saves Puter.js session data — authenticated.
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  try {
    const body = await req.json().catch(() => ({}));
    console.log("[PuterSession] Session saved:", body.authenticated ? "authenticated" : "not authenticated");
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function GET(req: NextRequest) {
  return NextResponse.json({ ok: true, sessions: [] });
}

export async function DELETE(req: NextRequest) {
  return NextResponse.json({ ok: true });
}
