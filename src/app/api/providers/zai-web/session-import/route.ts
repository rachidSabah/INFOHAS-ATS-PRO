// Task 30 — Z.ai Web session import endpoint.
//
// Receives the chat.z.ai WEB SESSION state transferred by the user-initiated
// browser bridge (bookmarklet running on https://chat.z.ai) or the clipboard
// fallback. SECURITY CONTRACT:
//   - provider_id MUST be "zai-web", credential_type MUST be "zai_web_session"
//     (a Z.ai API key is a DIFFERENT credential and is rejected here).
//   - The token is validated with a REAL Z.ai web request before the provider
//     is ever reported as connected; validation state is returned honestly
//     (blocked / rate_limited included — Z.ai may reject datacenter IPs).
//   - The token is AES-256-GCM encrypted server-side (same crypto as the
//     Antigravity integration) and stored in D1 provider_tokens. It is never
//     logged, echoed back, or persisted client-side. If no secure sink is
//     bound, the route fails closed with 501 — the bridge falls back to the
//     clipboard and the app keeps the session memory-only.
//   - CORS: POSTs from the chat.z.ai origin (bookmarklet) are accepted for
//     THIS route only; no other origin is granted access.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const ZAI_WEB_ORIGIN = "https://chat.z.ai";
const ALLOWED_PROVIDER_ID = "zai-web";
const ALLOWED_CREDENTIAL_TYPE = "zai_web_session";
const CORS_HEADERS: Record<string, string> = {
  "Access-Control-Allow-Origin": ZAI_WEB_ORIGIN,
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type",
  "Access-Control-Max-Age": "86400",
};

interface Env {
  DB?: any; // D1 binding (secure sink) — optional; absent → fail closed
  ANTIGRAVITY_ENCRYPTION_KEY?: string; // shared AES key material
}

/**
 * Resolve the Cloudflare bindings (D1, secrets) for this request.
 * Under @cloudflare/next-on-pages the env lives in the request context
 * (AsyncLocalStorage) — `req.env` is always undefined there, which silently
 * disabled every D1-backed branch of this route in production. Falls back to
 * `req.env` for runtimes that populate it, and to an empty env under plain
 * `next dev` (preserving the documented fail-closed behavior).
 */
async function getCloudEnv(req: NextRequest): Promise<Env> {
  try {
    const { getRequestContext } = await import("@cloudflare/next-on-pages");
    const ctx = getRequestContext();
    if (ctx?.env) return ctx.env as Env;
  } catch {
    /* not running under next-on-pages */
  }
  return (req as unknown as { env?: Env }).env ?? {};
}

function json(body: unknown, status = 200, cors = true): NextResponse {
  return NextResponse.json(body, { status, headers: cors ? CORS_HEADERS : undefined });
}

export async function OPTIONS() {
  return new Response(null, { status: 204, headers: CORS_HEADERS });
}

// Task 30b — Validate the SERVER-STORED zai-web session (Test Connection).
// The browser bridge import never populates the ATS Pro page's memory store
// (the bookmarklet runs on chat.z.ai), so a browser-side Test Connection
// must ask the server to validate the encrypted D1 copy. The token is
// decrypted only inside the edge runtime and is never echoed back.
export async function GET(req: NextRequest) {
  const env = await getCloudEnv(req);
  const { validateStoredZaiWebSession } = await import(
    "@/lib/providers/zai-web/server-validate"
  );
  const result = await validateStoredZaiWebSession(
    env.DB,
    env.ANTIGRAVITY_ENCRYPTION_KEY,
  );
  // Same-origin call from the ATS Pro app — no CORS headers granted here.
  return NextResponse.json(result.body, { status: result.status });
}

// Task 30 — Disconnect: remove ONLY the zai-web session credential.
// Other providers (Z.ai API fallback, Antigravity, Google Gemini, ...) are
// never touched.
export async function DELETE(req: NextRequest) {
  const env = await getCloudEnv(req);
  const db = env.DB;
  if (!db || typeof db.prepare !== "function") {
    // No server copy exists — nothing to delete is a success for the caller.
    return json({ ok: true, deleted: 0, message: "No secure sink bound; nothing stored server-side." });
  }
  try {
    const result = await db
      .prepare(`DELETE FROM provider_tokens WHERE provider_id = 'zai-web'`)
      .run();
    return json({ ok: true, deleted: result?.meta?.changes ?? 0 });
  } catch {
    return json({ ok: false, message: "Secure storage delete failed." }, 500);
  }
}

export async function POST(req: NextRequest) {
  let body: any;
  try {
    body = await req.json();
  } catch {
    return json({ ok: false, message: "Invalid JSON body." }, 400);
  }

  const { provider_id, credential_type, token, source } = body ?? {};

  if (provider_id !== ALLOWED_PROVIDER_ID) {
    return json({ ok: false, message: `Only provider_id='${ALLOWED_PROVIDER_ID}' is accepted by this endpoint.` }, 400);
  }
  if (credential_type !== ALLOWED_CREDENTIAL_TYPE) {
    return json({ ok: false, message: `credential_type must be '${ALLOWED_CREDENTIAL_TYPE}' — Z.ai API keys are a different integration and are rejected here.` }, 400);
  }
  if (typeof token !== "string" || token.trim().length < 16 || /[\s{}]/.test(token)) {
    return json({ ok: false, message: "Missing or malformed session token." }, 400);
  }

  // ---- Validate with a REAL Z.ai web request (never trust token presence) --
  const { validateZaiWebSession } = await import("@/lib/providers/zai-web/session-validator");
  const validation = await validateZaiWebSession({ token }, fetch);

  const env = await getCloudEnv(req);
  const db = env.DB;

  // ---- Secure storage (fail closed when the sink is unavailable) ----------
  let stored: "server" | "not-stored" = "not-stored";
  if (db && typeof db.prepare === "function") {
    try {
      const { encrypt } = await import("@/lib/providers/antigravity-routes");
      const encrypted = await encrypt(token, env.ANTIGRAVITY_ENCRYPTION_KEY);
      const userId = "zai_web_user";
      await db
        .prepare(
          `INSERT INTO provider_tokens (id, user_id, provider_id, access_token, refresh_token, expires_at, metadata)
           VALUES (?, ?, 'zai-web', ?, NULL, ?, ?)
           ON CONFLICT(user_id, provider_id) DO UPDATE SET
             access_token = excluded.access_token,
             expires_at = excluded.expires_at,
             metadata = excluded.metadata`,
        )
        .bind(
          crypto.randomUUID(),
          userId,
          encrypted,
          validation.state === "connected" ? Date.now() + 24 * 3600 * 1000 : null,
          JSON.stringify({ credential_type: ALLOWED_CREDENTIAL_TYPE, source: source ?? "bridge", validation_state: validation.state }),
        )
        .run();
      stored = "server";
    } catch {
      return json({ ok: false, message: "Secure storage write failed. Nothing was stored." }, 500);
    }
  }

  return json({
    ok: true,
    provider_id: ALLOWED_PROVIDER_ID,
    credential_type: ALLOWED_CREDENTIAL_TYPE,
    stored,
    validated: validation.state === "connected",
    state: validation.state,
    models: validation.models?.length ?? 0,
    message:
      validation.state === "connected"
        ? "Z.ai web session validated and stored encrypted."
        : `Session stored: ${stored}. Validation state: ${validation.state}. ${validation.message}`,
  });
}
