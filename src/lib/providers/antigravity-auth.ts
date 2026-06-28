/**
 * antigravity-auth.ts — Antigravity CLI Device Authorization Flow
 *
 * Implements the OAuth 2.0 Device Authorization Grant (RFC 8628)
 * for authenticating with Antigravity CLI without exposing email/password.
 *
 * Flow:
 *   1. POST /api/providers/antigravity/connect → Get device_code + user_code
 *   2. User visits verificationUrl and enters user_code
 *   3. POST /api/providers/antigravity/poll → Poll until token granted
 *   4. Token encrypted and stored in D1
 */

import { createEmptySession, type ProviderSession } from "./interface";

const ANTIGRAVITY_AUTH_URL = "https://api.antigravity.io/oauth/device";
const ANTIGRAVITY_TOKEN_URL = "https://api.antigravity.io/oauth/token";
const ANTIGRAVITY_API_BASE = "https://api.antigravity.io/v1";

export interface DeviceCodeResponse {
  deviceCode: string;
  userCode: string;
  verificationUrl: string;
  verificationUri: string;
  verificationUriComplete?: string;
  expiresIn: number;
  interval: number;
}

export interface TokenResponse {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
  scope?: string;
  tokenType?: string;
}

export interface AuthPollResult {
  status: "pending" | "authorized" | "expired" | "error";
  token?: TokenResponse;
  error?: string;
}

/**
 * Initiate the Device Authorization Flow.
 * Returns a device_code + user_code + verification URL.
 * The user must visit the URL and enter the user_code.
 */
export async function initiateDeviceFlow(clientId?: string): Promise<DeviceCodeResponse> {
  const res = await fetch(ANTIGRAVITY_AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId || "resumeai-pro-antigravity",
      scope: "offline_access models.read chat.write",
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Antigravity device auth failed: ${res.status} ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  return {
    deviceCode: data.device_code,
    userCode: data.user_code,
    verificationUrl: data.verification_uri_complete || data.verification_uri,
    verificationUri: data.verification_uri,
    verificationUriComplete: data.verification_uri_complete,
    expiresIn: data.expires_in,
    interval: data.interval || 5,
  };
}

/**
 * Poll for token authorization.
 * Call every `interval` seconds until the user authorizes or the code expires.
 */
export async function pollForToken(
  deviceCode: string,
  interval: number = 5,
  clientId?: string,
  timeoutMs: number = 300_000, // 5 min default
): Promise<AuthPollResult> {
  const startTime = Date.now();
  const maxWait = timeoutMs;

  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, interval * 1000));

    try {
      const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientId || "resumeai-pro-antigravity",
        }),
      });

      if (res.status === 200) {
        const data = await res.json();
        return {
          status: "authorized",
          token: {
            accessToken: data.access_token,
            refreshToken: data.refresh_token || "",
            expiresIn: data.expires_in,
            scope: data.scope,
            tokenType: data.token_type,
          },
        };
      }

      if (res.status === 400) {
        const errorData = await res.json();
        const error = errorData.error;

        if (error === "authorization_pending") {
          continue; // Poll again
        }
        if (error === "slow_down") {
          interval += 5; // Increase poll interval as requested
          continue;
        }
        if (error === "expired_token") {
          return { status: "expired", error: "Device code expired. Please restart the connection process." };
        }
        if (error === "access_denied") {
          return { status: "error", error: "User denied the authorization request." };
        }

        return { status: "error", error: `Unexpected error: ${error}` };
      }

      return { status: "error", error: `HTTP ${res.status}: ${await res.text()}` };
    } catch (e: any) {
      // Network error — retry
      console.warn("[Antigravity Auth] Poll network error, retrying:", e?.message);
    }
  }

  return { status: "expired", error: "Authentication timed out. Please try again." };
}

/**
 * Refresh an expired access token using the refresh token.
 */
export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(ANTIGRAVITY_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: "resumeai-pro-antigravity",
    }),
  });

  if (!res.ok) {
    throw new Error(`Antigravity token refresh failed: ${res.status}`);
  }

  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
}

/**
 * Fetch available models from Antigravity API.
 */
export async function fetchAntigravityModels(accessToken: string): Promise<string[]> {
  const res = await fetch(`${ANTIGRAVITY_API_BASE}/models`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
    },
  });

  if (!res.ok) {
    throw new Error(`Antigravity model fetch failed: ${res.status}`);
  }

  const data = await res.json();
  // Antigravity returns models as array of { id, name, ... } or array of strings
  const models: string[] = (data.data || data.models || data).map((m: any) =>
    typeof m === "string" ? m : m.id || m.name || m.model || m.modelId,
  ).filter(Boolean);

  return models;
}

/**
 * Generate a completion via Antigravity API.
 */
export async function generateAntigravity(
  opts: {
    accessToken: string;
    model: string;
    systemPrompt?: string;
    userPrompt: string;
    maxTokens?: number;
    temperature?: number;
  },
): Promise<{ text: string; provider: string; latencyMs: number }> {
  const t0 = performance.now();

  const messages: { role: string; content: string }[] = [];
  if (opts.systemPrompt) messages.push({ role: "system", content: opts.systemPrompt });
  messages.push({ role: "user", content: opts.userPrompt });

  const res = await fetch(`${ANTIGRAVITY_API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${opts.accessToken}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: opts.model,
      messages,
      max_tokens: opts.maxTokens ?? 4096,
      temperature: opts.temperature ?? 0.7,
    }),
  });

  const latencyMs = Math.round(performance.now() - t0);

  if (!res.ok) {
    const text = await res.text();
    if (res.status === 429) {
      throw new AntigravityRateLimitError(text.slice(0, 200));
    }
    throw new Error(`Antigravity API ${res.status}: ${text.slice(0, 200)}`);
  }

  const data = await res.json();
  const text = data.choices?.[0]?.message?.content || "";

  return { text, provider: "antigravity", latencyMs };
}

export class AntigravityRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AntigravityRateLimitError";
  }
}
