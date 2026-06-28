/**
 * antigravity-auth.ts — Antigravity CLI Device Authorization Flow
 *
 * Implements OAuth 2.0 Device Authorization Grant (RFC 8628).
 * No email/password stored. Tokens encrypted at rest in D1.
 */

import { createEmptySession } from "./interface";

const AUTH_URL = "https://api.antigravity.io/oauth/device";
const TOKEN_URL = "https://api.antigravity.io/oauth/token";
const API_BASE = "https://api.antigravity.io/v1";
const CLIENT_ID = "resumeai-pro-antigravity";

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

const AUTH_PREFIX = "Bearer";

export async function initiateDeviceFlow(clientId?: string): Promise<DeviceCodeResponse> {
  const res = await fetch(AUTH_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId || CLIENT_ID,
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

export async function pollForToken(
  deviceCode: string,
  interval: number = 5,
  clientId?: string,
  timeoutMs: number = 300_000,
): Promise<AuthPollResult> {
  const startTime = Date.now();
  const maxWait = timeoutMs;
  while (Date.now() - startTime < maxWait) {
    await new Promise((r) => setTimeout(r, interval * 1000));
    try {
      const res = await fetch(TOKEN_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          grant_type: "urn:ietf:params:oauth:grant-type:device_code",
          device_code: deviceCode,
          client_id: clientId || CLIENT_ID,
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
        if (error === "authorization_pending") continue;
        if (error === "slow_down") { interval += 5; continue; }
        if (error === "expired_token") return { status: "expired", error: "Device code expired." };
        if (error === "access_denied") return { status: "error", error: "Authorization denied." };
        return { status: "error", error: `Unexpected: ${error}` };
      }
      return { status: "error", error: `HTTP ${res.status}` };
    } catch (e: any) {
      console.warn("[Antigravity] Poll network error:", e?.message);
    }
  }
  return { status: "expired", error: "Authentication timed out." };
}

export async function refreshAccessToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: CLIENT_ID,
    }),
  });
  if (!res.ok) throw new Error(`Antigravity refresh failed: ${res.status}`);
  const data = await res.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token || refreshToken,
    expiresIn: data.expires_in,
  };
}

export async function fetchAntigravityModels(accessToken: string): Promise<string[]> {
  const res = await fetch(`${API_BASE}/models`, {
    headers: {
      "Authorization": AUTH_PREFIX + " " + accessToken,
      "Content-Type": "application/json",
    },
  });
  if (!res.ok) throw new Error(`Antigravity model fetch failed: ${res.status}`);
  const data = await res.json();
  const models: string[] = (data.data || data.models || data).map((m: any) =>
    typeof m === "string" ? m : m.id || m.name || m.model || m.modelId,
  ).filter(Boolean);
  return models;
}

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
  const res = await fetch(`${API_BASE}/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": AUTH_PREFIX + " " + opts.accessToken,
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
    if (res.status === 429) throw new AntigravityRateLimitError(text.slice(0, 200));
    throw new Error(`Antigravity API ${res.status}: ${text.slice(0, 200)}`);
  }
  const data = await res.json();
  return { text: data.choices?.[0]?.message?.content || "", provider: "antigravity", latencyMs };
}

export class AntigravityRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AntigravityRateLimitError";
  }
}
