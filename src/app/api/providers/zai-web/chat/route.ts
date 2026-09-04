// Task 30c — Z.ai Web CHAT endpoint: the web session used as a real API
// channel. The browser calls THIS same-origin route; the edge runtime
// builds the officially-signed v2 request (web-contract.ts, faithful to
// the public chat.z.ai client) with the decrypted D1 session or the
// memory-session token, calls chat.z.ai, and returns the parsed answer.
//
// SECURITY CONTRACT:
//   - The token is ONLY ever the zai_web_session credential; a Z.ai API
//     key is a different integration.
//   - The token never appears in any response; failures are honest states
//     (authentication_required / session_expired / rate_limited /
//     session_invalid / network_error) — never a fabricated success.

import { NextRequest, NextResponse } from "next/server";

export const runtime = "edge";

const ALLOWED_CREDENTIAL_TYPE = "zai_web_session";

interface Env {
  DB?: any;
  ANTIGRAVITY_ENCRYPTION_KEY?: string;
}

/**
 * Resolve the Cloudflare bindings (D1, secrets) for this request.
 * Under @cloudflare/next-on-pages the env lives in the request context
 * (AsyncLocalStorage) — `req.env` is always undefined there, so the
 * server-stored session could never be resolved in production. Falls back
 * to `req.env` / an empty env (memory-token only) elsewhere.
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

interface ChatBody {
  model?: string;
  messages?: Array<{ role: string; content: string }>;
  max_tokens?: number;
  temperature?: number;
  token?: string;
  credential_type?: string;
}

async function resolveToken(
  bodyToken: string | undefined,
  env: Env,
): Promise<{ token: string | null; source: "memory" | "server" | "none"; decryptFailed?: boolean }> {
  if (typeof bodyToken === "string" && bodyToken.trim().length >= 16 && !/[\s{}]/.test(bodyToken)) {
    return { token: bodyToken, source: "memory" };
  }
  const db = env.DB;
  if (db && typeof db.prepare === "function") {
    try {
      const row = (await db
        .prepare(
          `SELECT access_token FROM provider_tokens WHERE user_id = 'zai_web_user' AND provider_id = 'zai-web' LIMIT 1`,
        )
        .first()) as { access_token?: string } | null;
      if (row?.access_token) {
        const { decrypt } = await import("@/lib/providers/antigravity-routes");
        try {
          const token = await decrypt(row.access_token, env.ANTIGRAVITY_ENCRYPTION_KEY);
          return { token, source: "server" };
        } catch {
          return { token: null, source: "server", decryptFailed: true };
        }
      }
    } catch {
      /* fall through — no server copy readable */
    }
  }
  return { token: null, source: "none" };
}

export async function POST(req: NextRequest) {
  let body: ChatBody;
  try {
    body = (await req.json()) as ChatBody;
  } catch {
    return NextResponse.json({ ok: false, state: "session_invalid", message: "Invalid JSON body." }, { status: 400 });
  }

  if (body.credential_type !== undefined && body.credential_type !== ALLOWED_CREDENTIAL_TYPE) {
    return NextResponse.json(
      { ok: false, state: "session_invalid", message: `credential_type must be '${ALLOWED_CREDENTIAL_TYPE}'.` },
      { status: 400 },
    );
  }
  if (!Array.isArray(body.messages) || body.messages.length === 0) {
    return NextResponse.json({ ok: false, state: "session_invalid", message: "messages are required." }, { status: 400 });
  }

  const env = await getCloudEnv(req);
  const resolved = await resolveToken(body.token, env);
  if (!resolved.token) {
    return NextResponse.json(
      {
        ok: false,
        state: resolved.decryptFailed ? "session_invalid" : "authentication_required",
        message: resolved.decryptFailed
          ? "The stored Z.ai web session could not be decrypted. Disconnect, then re-import via the bridge."
          : "No Z.ai web session available. Open Z.ai, sign in with Google, run the Z.ai → ATS Pro bridge, then Test Connection.",
      },
      { status: 200 },
    );
  }

  const lastUser = [...body.messages].reverse().find((m) => m?.role === "user" && typeof m.content === "string");
  const prompt = (lastUser?.content ?? "").trim().slice(0, 8000);

  const { buildZaiWebChatRequest, parseZaiWebChatResponseText } = await import(
    "@/lib/providers/zai-web/web-contract"
  );
  const request = await buildZaiWebChatRequest({
    token: resolved.token,
    model: typeof body.model === "string" && body.model ? body.model : "GLM-4.5",
    messages: body.messages,
    prompt,
    maxTokens: typeof body.max_tokens === "number" ? body.max_tokens : undefined,
    temperature: typeof body.temperature === "number" ? body.temperature : undefined,
  });

  let res: Response;
  try {
    res = await fetch(request.url, {
      method: "POST",
      headers: request.headers,
      body: request.body,
      signal: AbortSignal.timeout(60000),
    });
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    return NextResponse.json(
      { ok: false, state: "network_error", message: `Network failure contacting Z.ai (${message.slice(0, 120)}).` },
      { status: 200 },
    );
  }

  if (res.status === 401 || res.status === 403) {
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    const looksSessionRelated = /auth|token|expire|login|unauthor|signature/i.test(snippet);
    return NextResponse.json(
      {
        ok: false,
        state: looksSessionRelated ? "session_expired" : "blocked",
        message: looksSessionRelated
          ? "Z.ai rejected the web session or signature (expired/revoked). Reconnect: open Z.ai, sign in, re-run the bridge."
          : `Z.ai refused the chat request (HTTP ${res.status}). The session may be fine but Z.ai is rejecting this client.`,
      },
      { status: 200 },
    );
  }
  if (res.status === 429) {
    return NextResponse.json(
      { ok: false, state: "rate_limited", message: "Z.ai is rate-limiting this session. Wait and retry." },
      { status: 200 },
    );
  }
  if (!res.ok) {
    const snippet = (await res.text().catch(() => "")).slice(0, 200);
    return NextResponse.json(
      {
        ok: false,
        state: "session_invalid",
        message: `Unexpected Z.ai chat response (HTTP ${res.status}). ${snippet}`.trim(),
      },
      { status: 200 },
    );
  }

  const text = await res.text().catch(() => "");
  const parsed = parseZaiWebChatResponseText(text);
  if (!parsed || !parsed.content) {
    return NextResponse.json(
      {
        ok: false,
        state: "session_invalid",
        message: "Z.ai chat response does not match the expected web contract (JSON or SSE).",
      },
      { status: 200 },
    );
  }

  return NextResponse.json({
    ok: true,
    state: "connected",
    content: parsed.content,
    model: parsed.model ?? body.model ?? null,
    usage: parsed.usage ?? null,
  });
}
