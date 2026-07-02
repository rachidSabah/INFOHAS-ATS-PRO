import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

export async function POST(req: NextRequest) {
  const body = ((await req.json().catch(() => ({}))) as any) as any;
  console.log(`[PUTER] Connected: ${body.email}`);
  return NextResponse.json({ ok: true });
}
