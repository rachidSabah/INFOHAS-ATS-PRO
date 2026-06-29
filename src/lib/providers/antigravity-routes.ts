/**
 * antigravity-routes.ts — Cloudflare Worker routes for Antigravity CLI
 *
 * Uses Google OAuth 2.0 + PKCE (RFC 7636) via hosted Worker callback.
 * Tokens encrypted at rest in D1.
 *
 * Routes:
 *   GET  /api/providers/antigravity/auth       → Redirect to Google OAuth
 *   GET  /api/providers/antigravity/callback   → OAuth code exchange
 *   POST /api/providers/antigravity/disconnect → Revoke tokens
 *   GET  /api/providers/antigravity/models     → Discovered models
 *   POST /api/providers/antigravity/models/sync → Re-discover models
 *   GET  /api/providers/antigravity/status     → Connection status
 *   POST /api/providers/antigravity/test       → Test connectivity
 */

interface Env {
  DB: any; // D1Database — typed loosely for cross-environment compatibility
  ANTIGRAVITY_ENCRYPTION_KEY?: string;
  ANTIGRAVITY_REDIRECT_URI?: string;
  ANTIGRAVITY_CLIENT_ID?: string;
}

const AUTH_PREFIX = "Bearer";
// ============================================================================
// GET /api/providers/antigravity/auth
// Step 1: Redirect user to Google OAuth with PKCE
// ============================================================================
export async function handleAuth(req: Request, env: Env): Promise<Response> {
  try {
    const redirectUri = env.ANTIGRAVITY_REDIRECT_URI ||
      `${new URL(req.url).origin}/api/providers/antigravity/callback`;

    // Import dynamically to avoid circular deps at module level
    const { buildAuthorizationURL } = await import("./antigravity-auth");
    const { url, verifier, state } = await buildAuthorizationURL(redirectUri);

    // Store PKCE verifier in KV or query param state (state is base64-encoded verifier)
    // Redirect to Google
    return new Response(null, {
      status: 302,
      headers: { Location: url },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Auth initiation failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// GET /api/providers/antigravity/callback
// Step 2: Google redirects here with authorization code + state
// ============================================================================
export async function handleCallback(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");

  if (error) {
    return new Response(
      `<html><body><h1>Authorization Failed</h1><p>${error}</p><p>You can close this window and try again.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  if (!code || !state) {
    return new Response(
      `<html><body><h1>Missing Parameters</h1><p>Authorization code or state missing.</p></body></html>`,
      { status: 400, headers: { "Content-Type": "text/html" } },
    );
  }

  try {
    const redirectUri = env.ANTIGRAVITY_REDIRECT_URI ||
      `${url.origin}/api/providers/antigravity/callback`;
    const clientId = env.ANTIGRAVITY_CLIENT_ID;

    const { exchangeAuthorizationCode, discoverAntigravityModels } = await import("./antigravity-auth");
    const result = await exchangeAuthorizationCode(code, state, redirectUri, clientId);

    if (result.type === "failed") {
      return new Response(
        `<html><body><h1>Token Exchange Failed</h1><p>${result.error}</p><p>Please close this window and try connecting again.</p></body></html>`,
        { status: 400, headers: { "Content-Type": "text/html" } },
      );
    }

    // Encrypt tokens
    const { encrypt } = await import("./antigravity-routes");
    const encryptedAccess = await encrypt(result.accessToken!, env.ANTIGRAVITY_ENCRYPTION_KEY);
    const encryptedRefresh = await encrypt(result.refreshToken!, env.ANTIGRAVITY_ENCRYPTION_KEY);

    // Store in D1
    const userId = "antigravity_user"; // single-user for now; multi-user via cookie/session later
    const tokenId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO provider_tokens (id, user_id, provider_id, access_token, refresh_token, expires_at, metadata)
       VALUES (?, ?, 'antigravity', ?, ?, ?, ?)`
    ).bind(
      tokenId, userId, encryptedAccess, encryptedRefresh,
      Date.now() + (result.expiresIn || 3600) * 1000,
      JSON.stringify({ email: result.email || "" }),
    ).run();

    // Upsert provider connection
    await env.DB.prepare(
      `INSERT INTO provider_connections (id, user_id, provider, provider_name, status, metadata)
       VALUES (?, ?, 'antigravity', 'Antigravity CLI', 'active', ?)
       ON CONFLICT(user_id, provider) DO UPDATE SET status = 'active', updated_at = unixepoch()*1000`
    ).bind(
      crypto.randomUUID(), userId,
      JSON.stringify({ email: result.email, models: [] }),
    ).run();

    // Auto-discover models
    try {
      const models = await discoverAntigravityModels(result.accessToken!);
      for (const modelId of models) {
        await env.DB.prepare(
          `INSERT OR REPLACE INTO provider_models (id, provider_id, model_id, model_name, enabled)
           VALUES (?, 'antigravity', ?, ?, 1)`
        ).bind(crypto.randomUUID(), modelId, modelId).run();
      }
    } catch { /* model discovery non-fatal */ }

    // Return success page — closes OAuth popup
    return new Response(
      `<html><body><script>
        window.opener?.postMessage({ type: "antigravity-auth", status: "success", email: "${result.email || ""}" }, "*");
        document.write('<h1>Authentication Successful!</h1><p>You can close this window now.</p>');
      </script></body></html>`,
      { status: 200, headers: { "Content-Type": "text/html" } },
    );
  } catch (e: any) {
    return new Response(
      `<html><body><h1>Authentication Error</h1><p>${e?.message}</p></body></html>`,
      { status: 500, headers: { "Content-Type": "text/html" } },
    );
  }
}

// ============================================================================
// POST /api/providers/antigravity/disconnect
// ============================================================================
export async function handleDisconnect(req: Request, env: Env): Promise<Response> {
  try {
    const userId = "antigravity_user";
    await env.DB.prepare(
      `DELETE FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity'`
    ).bind(userId).run();
    await env.DB.prepare(
      `UPDATE provider_connections SET status = 'disconnected', updated_at = unixepoch()*1000 WHERE user_id = ? AND provider = 'antigravity'`
    ).bind(userId).run();

    return new Response(JSON.stringify({ status: "disconnected" }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// GET /api/providers/antigravity/models
// ============================================================================
export async function handleGetModels(req: Request, env: Env): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT model_id, model_name, enabled FROM provider_models WHERE provider_id = 'antigravity' ORDER BY model_name ASC`
    ).all();
    return new Response(JSON.stringify({ models: results || [] }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// POST /api/providers/antigravity/models/sync
// ============================================================================
export async function handleSyncModels(req: Request, env: Env): Promise<Response> {
  try {
    const userId = "antigravity_user";
    const tokenRow = await env.DB.prepare(
      `SELECT access_token FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity' ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first() as any;

    if (!tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { decrypt } = await import("./antigravity-routes");
    const accessToken = await decrypt(tokenRow.access_token, env.ANTIGRAVITY_ENCRYPTION_KEY);

    const { discoverAntigravityModels } = await import("./antigravity-auth");
    const models = await discoverAntigravityModels(accessToken);

    for (const modelId of models) {
      await env.DB.prepare(
        `INSERT OR REPLACE INTO provider_models (id, provider_id, model_id, model_name, enabled)
         VALUES (?, 'antigravity', ?, ?, 1)`
      ).bind(crypto.randomUUID(), modelId, modelId).run();
    }

    return new Response(JSON.stringify({ models, count: models.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// GET /api/providers/antigravity/status
// ============================================================================
export async function handleStatus(req: Request, env: Env): Promise<Response> {
  try {
    const userId = "antigravity_user";
    const tokenRow = await env.DB.prepare(
      `SELECT expires_at, metadata FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity' ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first() as any;

    if (!tokenRow) {
      return new Response(JSON.stringify({ connected: false }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    const meta = tokenRow.metadata ? JSON.parse(tokenRow.metadata) : {};
    const expiresAt = tokenRow.expires_at;
    const expired = expiresAt && expiresAt < Date.now();

    return new Response(JSON.stringify({
      connected: !expired,
      email: meta.email || null,
      expiresAt: expiresAt || null,
      expired: !!expired,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// POST /api/providers/antigravity/test
// ============================================================================
export async function handleTest(req: Request, env: Env): Promise<Response> {
  try {
    const userId = "antigravity_user";
    const tokenRow = await env.DB.prepare(
      `SELECT access_token FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity' ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first() as any;

    if (!tokenRow?.access_token) {
      return new Response(JSON.stringify({ ok: false, error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const { decrypt } = await import("./antigravity-routes");
    const accessToken = await decrypt(tokenRow.access_token, env.ANTIGRAVITY_ENCRYPTION_KEY);

    const t0 = Date.now();
    const res = await fetch("https://cloudcode-pa.googleapis.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Authorization": AUTH_PREFIX + " " + accessToken,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "gemini-2.5-flash",
        messages: [{ role: "user", content: "Say OK" }],
        max_tokens: 10,
      }),
    });

    const latencyMs = Date.now() - t0;

    if (res.status === 429) {
      return new Response(JSON.stringify({ ok: false, status: 429, error: "Rate limited", latencyMs }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({ ok: false, status: res.status, error: text.slice(0, 200), latencyMs }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ ok: true, latencyMs }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ ok: false, error: e?.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// Route dispatcher
// ============================================================================
export async function handleAntigravityRoutes(req: Request, env: Env): Promise<Response> {
  const url = new URL(req.url);
  const path = url.pathname;

  if (path === "/api/providers/antigravity/auth") return handleAuth(req, env);
  if (path === "/api/providers/antigravity/callback") return handleCallback(req, env);
  if (path === "/api/providers/antigravity/disconnect" && req.method === "POST") return handleDisconnect(req, env);
  if (path === "/api/providers/antigravity/models" && req.method === "GET") return handleGetModels(req, env);
  if (path === "/api/providers/antigravity/models/sync" && req.method === "POST") return handleSyncModels(req, env);
  if (path === "/api/providers/antigravity/status") return handleStatus(req, env);
  if (path === "/api/providers/antigravity/test" && req.method === "POST") return handleTest(req, env);

  return new Response(JSON.stringify({ error: "Not found" }), { status: 404, headers: { "Content-Type": "application/json" } });
}

// ============================================================================
// Encryption helpers (AES-256-GCM via Web Crypto)
// ============================================================================
async function getEncryptionKey(secret?: string): Promise<CryptoKey> {
  const keyMaterial = secret || "resumeai-pro-antigravity-fallback-key";
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial.padEnd(32, "x").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return baseKey;
}

export async function encrypt(plaintext: string, secret?: string): Promise<string> {
  const key = await getEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Array.from(combined).map(b => b.toString(16).padStart(2, "0")).join("");
}

export async function decrypt(cipherhex: string, secret?: string): Promise<string> {
  const key = await getEncryptionKey(secret);
  const bytes = new Uint8Array(cipherhex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const iv = bytes.slice(0, 12);
  const data = bytes.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}
