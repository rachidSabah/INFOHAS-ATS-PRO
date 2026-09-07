import { NextRequest, NextResponse } from "next/server";
import { getRequestContext } from "@cloudflare/next-on-pages";

export const runtime = "edge";

/**
 * Puter account store (per end-user, keyed by X-User-Id, default "anonymous").
 *
 * SHAPE CONTRACT (Task 19): when NOTHING is stored (missing KV binding, no
 * entry yet) the GET response carries `accounts: null` — NEVER an empty
 * array. An empty array is truthy in JS and the client used to treat it as
 * authoritative "this user has no accounts", which shadowed (and effectively
 * wiped) the locally-persisted copy on every page refresh.
 */
export async function GET(req: NextRequest) {
  try {
    const ctx = getRequestContext();
    const userId = req.headers.get("X-User-Id") || "anonymous";
    const cache = (ctx?.env as any)?.CACHE;
    if (!cache) {
      return NextResponse.json({ activeAccount: null, accounts: null, autoRotate: true, useGlobally: false, storage: "unavailable" });
    }

    const raw = await cache.get(`puter_sessions_${userId}`);
    if (raw) {
       const parsed = JSON.parse(raw);
       const active = parsed.accounts?.find((a: any) => a.active);
       return NextResponse.json({
         activeAccount: active?.email || null,
         accounts: Array.isArray(parsed.accounts) && parsed.accounts.length > 0 ? parsed.accounts : null,
         autoRotate: parsed.autoRotate ?? true,
         useGlobally: parsed.useGlobally ?? false,
         storage: "kv"
       });
    }
    return NextResponse.json({ activeAccount: null, accounts: null, autoRotate: true, useGlobally: false, storage: "kv" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest) {
  try {
    const body = (await req.json()) as any;
    const ctx = getRequestContext();
    const userId = req.headers.get("X-User-Id") || "anonymous";
    const cache = (ctx?.env as any)?.CACHE;
    if (cache) {
       await cache.put(`puter_sessions_${userId}`, JSON.stringify(body));
       return NextResponse.json({ ok: true, storage: "kv" });
    }
    // Honest no-op: the client logs this and keeps localStorage as the
    // source of truth (self-heal re-pushes when the binding appears).
    return NextResponse.json({ ok: false, error: "no_cache_binding", storage: "unavailable" });
  } catch (e: any) {
    return NextResponse.json({ error: e.message }, { status: 500 });
  }
}
