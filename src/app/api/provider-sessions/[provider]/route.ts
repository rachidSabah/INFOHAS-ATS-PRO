/**
 * Provider session lifecycle (directive #39) — /api/provider-sessions/[provider]
 *
 * Dynamic route so every provider (puter, antigravity, …) gets the same real
 * lifecycle — previously only a hardcoded /puter stub existed, so antigravity
 * session persistence 404'd as well.
 *
 * The client SessionManager persists provider sessions (Puter / Antigravity)
 * to the cloud so authentication state survives restore. This route mirrors
 * the worker's D1-backed lifecycle for local/self-hosted deployments:
 *   PUT    — upsert session (the previously-missing method that 404'd)
 *   POST   — upsert alias
 *   GET    — load persisted session
 *   DELETE — clear session
 * Session payloads are encrypted client-side by the SessionManager; tokens
 * are never logged here (directive #43).
 */
import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

// Edge-safe in-memory mirror (per-isolate). The authoritative store is the
// Cloudflare Worker's D1 `provider_sessions` table; this mirror keeps the
// contract functional in local/dev mode where the worker is unreachable.
const sessions = new Map<string, { session: unknown; updatedAt: string }>();

async function upsert(provider: string, body: unknown) {
  const now = new Date().toISOString();
  sessions.set(provider, { session: body ?? {}, updatedAt: now });
  console.log(
    `[ProviderSessions] Session persisted for ${provider} (authenticated=${!!(body as any)?.authenticated})`,
  );
  return NextResponse.json({ ok: true, success: true, provider, updatedAt: now });
}

export async function PUT(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    return await upsert(provider, body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function POST(req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  try {
    const { provider } = await ctx.params;
    const body = await req.json().catch(() => ({}));
    return await upsert(provider, body);
  } catch (e: any) {
    return NextResponse.json({ ok: false, error: e?.message }, { status: 500 });
  }
}

export async function GET(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  const entry = sessions.get(provider);
  return NextResponse.json({
    ok: true,
    session: entry?.session ?? null,
    sessions: entry ? [entry.session] : [],
  });
}

export async function DELETE(_req: NextRequest, ctx: { params: Promise<{ provider: string }> }) {
  const { provider } = await ctx.params;
  sessions.delete(provider);
  return NextResponse.json({ ok: true });
}
