/**
 * antigravity-routes.ts — Cloudflare Worker routes for Antigravity CLI Provider
 *
 * These routes handle the Device Authorization Flow + model management.
 * All token data is encrypted before storage in D1/KV.
 *
 * Routes:
 *   POST /api/providers/antigravity/connect    — Initiate device auth flow
 *   POST /api/providers/antigravity/poll        — Poll for token authorization
 *   POST /api/providers/antigravity/disconnect  — Disconnect and revoke
 *   GET  /api/providers/antigravity/models      — Fetch discovered models
 *   POST /api/providers/antigravity/models/sync — Re-discover models
 *   GET  /api/providers/antigravity/health      — Get health metrics
 *   POST /api/providers/antigravity/test        — Test provider connectivity
 */

import { v4 as uid } from "uuid"; // or use crypto.randomUUID()

interface Env {
  DB: D1Database;
  ANTIGRAVITY_CLIENT_ID?: string;
  ANTIGRAVITY_ENCRYPTION_KEY?: string; // Cloudflare Secret
}

// ============================================================================
// POST /api/providers/antigravity/connect
// Initiates the Device Authorization Flow.
// ============================================================================
export async function handleConnect(req: Request, env: Env): Promise<Response> {
  try {
    const clientId = env.ANTIGRAVITY_CLIENT_ID || "resumeai-pro-antigravity";

    const res = await fetch("https://api.antigravity.io/v1/device/authorize", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        client_id: clientId,
        scope: "offline_access models.read chat.write",
      }),
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: "Device auth initiation failed", status: res.status }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    return new Response(JSON.stringify({
      deviceCode: data.device_code,
      userCode: data.user_code,
      verificationUrl: data.verification_uri_complete || data.verification_uri,
      verificationUri: data.verification_uri,
      expiresIn: data.expires_in,
      interval: data.interval || 5,
    }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// POST /api/providers/antigravity/poll
// Polls for token after user authorizes via device flow.
// ============================================================================
export async function handlePoll(req: Request, env: Env): Promise<Response> {
  try {
    const { deviceCode } = await req.json() as { deviceCode: string };
    if (!deviceCode) {
      return new Response(JSON.stringify({ error: "deviceCode required" }), {
        status: 400,
        headers: { "Content-Type": "application/json" },
      });
    }

    const clientId = env.ANTIGRAVITY_CLIENT_ID || "resumeai-pro-antigravity";
    const res = await fetch("https://api.antigravity.io/v1/device/token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        grant_type: "urn:ietf:params:oauth:grant-type:device_code",
        device_code: deviceCode,
        client_id: clientId,
      }),
    });

    if (res.status === 200) {
      const data = await res.json();
      // Encrypt tokens before storing
      const encryptedToken = await encrypt(data.access_token, env.ANTIGRAVITY_ENCRYPTION_KEY);
      const encryptedRefresh = data.refresh_token
        ? await encrypt(data.refresh_token, env.ANTIGRAVITY_ENCRYPTION_KEY)
        : null;

      // Store in D1
      const userId = req.headers.get("X-User-Id") || "anonymous";
      const tokenId = crypto.randomUUID();
      await env.DB.prepare(
        `INSERT INTO provider_tokens (id, user_id, provider_id, access_token, refresh_token, expires_at)
         VALUES (?, ?, 'antigravity', ?, ?, ?)`
      ).bind(tokenId, userId, encryptedToken, encryptedRefresh, Date.now() + data.expires_in * 1000).run();

      // Upsert provider connection
      await env.DB.prepare(
        `INSERT INTO provider_connections (id, user_id, provider, status, metadata)
         VALUES (?, ?, 'antigravity', 'active', ?)
         ON CONFLICT(user_id, provider) DO UPDATE SET status = 'active', updated_at = unixepoch()*1000`
      ).bind(crypto.randomUUID(), userId, JSON.stringify({ models: [] })).run();

      return new Response(JSON.stringify({
        accessToken: data.access_token,
        expiresIn: data.expires_in,
        tokenId,
      }), {
        headers: { "Content-Type": "application/json" },
      });
    }

    if (res.status === 400) {
      const errorData = await res.json();
      const error = errorData.error;
      if (error === "authorization_pending") {
        return new Response(JSON.stringify({ status: "pending" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error === "slow_down") {
        return new Response(JSON.stringify({ status: "slow_down" }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error === "expired_token") {
        return new Response(JSON.stringify({ status: "expired", error: "Code expired. Restart connection." }), {
          headers: { "Content-Type": "application/json" },
        });
      }
      if (error === "access_denied") {
        return new Response(JSON.stringify({ status: "denied", error: "Authorization denied by user." }), {
          headers: { "Content-Type": "application/json" },
        });
      }
    }

    return new Response(JSON.stringify({ status: "error", error: `HTTP ${res.status}` }), {
      status: 502,
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Internal error" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// POST /api/providers/antigravity/disconnect
// Disconnects the provider and revokes tokens.
// ============================================================================
export async function handleDisconnect(req: Request, env: Env): Promise<Response> {
  try {
    const userId = req.headers.get("X-User-Id") || "anonymous";

    // Delete tokens
    await env.DB.prepare(
      `DELETE FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity'`
    ).bind(userId).run();

    // Mark connection as disconnected
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
// Returns discovered models for the user's antigravity connection.
// ============================================================================
export async function handleGetModels(req: Request, env: Env): Promise<Response> {
  try {
    const userId = req.headers.get("X-User-Id") || "anonymous";

    const { results } = await env.DB.prepare(
      `SELECT model_id, model_name, context_window, capabilities, enabled
       FROM provider_models
       WHERE provider_id = 'antigravity'
       ORDER BY model_name ASC`
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
// Re-discover models from Antigravity API and store in D1.
// ============================================================================
export async function handleSyncModels(req: Request, env: Env): Promise<Response> {
  try {
    // Get the user's access token
    const userId = req.headers.get("X-User-Id") || "anonymous";
    const tokenRow = await env.DB.prepare(
      `SELECT access_token FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity' ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first() as any;

    if (!tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "Not authenticated. Connect Antigravity first." }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    // Decrypt token
    const accessToken = await decrypt(tokenRow.access_token, env.ANTIGRAVITY_ENCRYPTION_KEY);

    // Fetch models
    const res = await fetch("https://api.antigravity.io/v1/models", {
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
    });

    if (!res.ok) {
      return new Response(JSON.stringify({ error: `Model fetch failed: ${res.status}` }), {
        status: 502,
        headers: { "Content-Type": "application/json" },
      });
    }

    const data = await res.json();
    const models: any[] = (data.data || data.models || data).map((m: any) => ({
      id: typeof m === "string" ? m : m.id || m.model || m.modelId,
      name: typeof m === "string" ? m : m.name || m.model || m.id,
    })).filter((m: any) => m.id);

    // Store models in D1
    const insertStmt = env.DB.prepare(
      `INSERT OR REPLACE INTO provider_models (id, provider_id, model_id, model_name, enabled)
       VALUES (?, 'antigravity', ?, ?, 1)`
    );

    for (const model of models) {
      await insertStmt.bind(crypto.randomUUID(), model.id, model.name).run();
    }

    return new Response(JSON.stringify({ models: models.map((m: any) => m.id), count: models.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e: any) {
    return new Response(JSON.stringify({ error: e?.message || "Sync failed" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
}

// ============================================================================
// GET /api/providers/antigravity/health
// Returns health metrics for the antigravity provider.
// ============================================================================
export async function handleHealth(req: Request, env: Env): Promise<Response> {
  try {
    const { results } = await env.DB.prepare(
      `SELECT model_id, latency, success_count, failure_count, rate_limit_count, health_score
       FROM provider_health
       WHERE provider_id = 'antigravity'
       ORDER BY health_score DESC`
    ).all();

    return new Response(JSON.stringify({ health: results || [] }), {
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
// Tests provider connectivity by making a small chat request.
// ============================================================================
export async function handleTest(req: Request, env: Env): Promise<Response> {
  try {
    const userId = req.headers.get("X-User-Id") || "anonymous";
    const tokenRow = await env.DB.prepare(
      `SELECT access_token FROM provider_tokens WHERE user_id = ? AND provider_id = 'antigravity' ORDER BY created_at DESC LIMIT 1`
    ).bind(userId).first() as any;

    if (!tokenRow?.access_token) {
      return new Response(JSON.stringify({ error: "Not authenticated" }), {
        status: 401,
        headers: { "Content-Type": "application/json" },
      });
    }

    const accessToken = await decrypt(tokenRow.access_token, env.ANTIGRAVITY_ENCRYPTION_KEY);

    const t0 = Date.now();
    const res = await fetch("https://api.antigravity.io/v1/chat/completions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: "claude-sonnet-4",
        messages: [{ role: "user", content: "Say OK and nothing else." }],
        max_tokens: 10,
      }),
    });

    const latencyMs = Date.now() - t0;

    if (!res.ok) {
      const text = await res.text();
      return new Response(JSON.stringify({
        ok: false,
        status: res.status,
        latencyMs,
        error: text.slice(0, 200),
      }), { headers: { "Content-Type": "application/json" } });
    }

    const data = await res.json();
    return new Response(JSON.stringify({
      ok: true,
      latencyMs,
      model: data.model || "unknown",
    }), { headers: { "Content-Type": "application/json" } });
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

  // POST /connect
  if (path === "/api/providers/antigravity/connect" && req.method === "POST") {
    return handleConnect(req, env);
  }

  // POST /poll
  if (path === "/api/providers/antigravity/poll" && req.method === "POST") {
    return handlePoll(req, env);
  }

  // POST /disconnect
  if (path === "/api/providers/antigravity/disconnect" && req.method === "POST") {
    return handleDisconnect(req, env);
  }

  // GET /models
  if (path === "/api/providers/antigravity/models" && req.method === "GET") {
    return handleGetModels(req, env);
  }

  // POST /models/sync
  if (path === "/api/providers/antigravity/models/sync" && req.method === "POST") {
    return handleSyncModels(req, env);
  }

  // GET /health
  if (path === "/api/providers/antigravity/health" && req.method === "GET") {
    return handleHealth(req, env);
  }

  // POST /test
  if (path === "/api/providers/antigravity/test" && req.method === "POST") {
    return handleTest(req, env);
  }

  return new Response(JSON.stringify({ error: "Not found" }), {
    status: 404,
    headers: { "Content-Type": "application/json" },
  });
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

async function encrypt(plaintext: string, secret?: string): Promise<string> {
  const key = await getEncryptionKey(secret);
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const encrypted = await crypto.subtle.encrypt(
    { name: "AES-GCM", iv },
    key,
    new TextEncoder().encode(plaintext),
  );
  // Combine IV + ciphertext as hex
  const combined = new Uint8Array(iv.length + encrypted.byteLength);
  combined.set(iv);
  combined.set(new Uint8Array(encrypted), iv.length);
  return Array.from(combined).map(b => b.toString(16).padStart(2, "0")).join("");
}

async function decrypt(cipherhex: string, secret?: string): Promise<string> {
  const key = await getEncryptionKey(secret);
  const combined = new Uint8Array(cipherhex.match(/.{1,2}/g)!.map(b => parseInt(b, 16)));
  const iv = combined.slice(0, 12);
  const data = combined.slice(12);
  const decrypted = await crypto.subtle.decrypt({ name: "AES-GCM", iv }, key, data);
  return new TextDecoder().decode(decrypted);
}
