import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

export async function GET(req: NextRequest) {
  try {
    const ctx = getRequestContext();
    const userId = req.headers.get("X-User-Id") || "anonymous";
    const cache = ctx?.env?.CACHE;
    if (!cache) return NextResponse.json({ activeAccount: null, accounts: [], autoRotate: true, useGlobally: false });

    const raw = await cache.get(`puter_sessions_${userId}`);
    if (raw) {
       const parsed = JSON.parse(raw);
       const active = parsed.accounts?.find((a: any) => a.active);
       return NextResponse.json({
         activeAccount: active?.email || null,
         accounts: parsed.accounts || [],
         autoRotate: parsed.autoRotate ?? true,
         useGlobally: parsed.useGlobally ?? false
       });
    }
    return NextResponse.json({ activeAccount: null, accounts: [], autoRotate: true, useGlobally: false });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = await req.json();
    const ctx = getRequestContext();
    const userId = req.headers.get("X-User-Id") || "anonymous";
    const cache = ctx?.env?.CACHE;
    if (cache) {
       await cache.put(`puter_sessions_${userId}`, JSON.stringify(body));
    }
    return NextResponse.json({ ok: true });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
