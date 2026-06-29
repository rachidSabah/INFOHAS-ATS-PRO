/**
 * antigravity-auth.ts — Antigravity CLI OAuth via Google OAuth 2.0 + PKCE
 *
 * Implements Google OAuth 2.0 Authorization Code flow with PKCE (RFC 7636)
 * for authenticating against Antigravity's Google-managed OAuth app.
 *
 * Architecture:
 *   Pages UI → Connect button → Worker endpoint → Google login → Callback
 *   → Code exchange → Token encryption → D1 storage → Provider registration
 *
 * This mirrors the opencode-antigravity-auth reference implementation
 * (https://github.com/NoeFabris/opencode-antigravity-auth) but uses
 * a hosted Cloudflare Worker callback instead of localhost.
 */

import type { ProviderSession } from "./interface";

// ============================================================================
// Constants (from Antigravity's Google OAuth app)
// ============================================================================
export const ANTIGRAVITY_CLIENT_ID = "1071006060591-tmhssin2h21lcre235vtolojh4g403ep.apps.googleusercontent.com";
export const ANTIGRAVITY_SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
];

export const GOOGLE_AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
export const GOOGLE_TOKEN_URL = "https://oauth2.googleapis.com/token";
export const GOOGLE_USERINFO_URL = "https://www.googleapis.com/oauth2/v1/userinfo";
export const ANTIGRAVITY_API_BASE = "https://cloudcode-pa.googleapis.com";

// ============================================================================
// PKCE (Proof Key for Code Exchange) — RFC 7636
// Uses Web Crypto API (available in Cloudflare Workers + modern browsers)
// ============================================================================

function base64URLEncode(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

export async function generatePKCEChallenge(): Promise<{ verifier: string; challenge: string }> {
  const verifierBytes = new Uint8Array(32);
  crypto.getRandomValues(verifierBytes);
  const verifier = base64URLEncode(verifierBytes.buffer);

  const challengeBytes = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier));
  const challenge = base64URLEncode(challengeBytes);

  return { verifier, challenge };
}

function encodeState(verifier: string): string {
  return btoa(JSON.stringify({ v: verifier, t: Date.now() }));
}

function decodeState(state: string): { verifier: string } {
  try {
    const parsed = JSON.parse(atob(state));
    if (typeof parsed.v !== "string") throw new Error("Missing verifier");
    return { verifier: parsed.v };
  } catch {
    throw new Error("Invalid OAuth state parameter");
  }
}

// ============================================================================
// OAuth Flow
// ============================================================================

export interface AuthorizationURLResult {
  url: string;
  verifier: string;
  state: string;
}

/**
 * Step 1: Build the Google OAuth authorization URL.
 * User will be redirected to Google login, then to the callback.
 */
export async function buildAuthorizationURL(redirectUri: string): Promise<AuthorizationURLResult> {
  const { verifier, challenge } = await generatePKCEChallenge();
  const state = encodeState(verifier);

  const url = new URL(GOOGLE_AUTH_URL);
  url.searchParams.set("client_id", ANTIGRAVITY_CLIENT_ID);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("scope", ANTIGRAVITY_SCOPES.join(" "));
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("prompt", "consent");

  return { url: url.toString(), verifier, state };
}

export interface TokenExchangeResult {
  type: "success" | "failed";
  accessToken?: string;
  refreshToken?: string;
  expiresIn?: number;
  email?: string;
  error?: string;
}

/**
 * Step 2: Exchange authorization code for tokens.
 * Called by the Worker callback endpoint.
 */
export async function exchangeAuthorizationCode(
  code: string,
  state: string,
  redirectUri: string,
  clientId?: string,
): Promise<TokenExchangeResult> {
  try {
    const { verifier } = decodeState(state);

    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId || ANTIGRAVITY_CLIENT_ID,
        code,
        grant_type: "authorization_code",
        redirect_uri: redirectUri,
        code_verifier: verifier,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      return { type: "failed", error: `Token exchange failed: ${errText.slice(0, 300)}` };
    }

    const tokenData = await tokenResponse.json();

    // Fetch user email
    let email: string | undefined;
    try {
      const userRes = await fetch(GOOGLE_USERINFO_URL, {
        headers: {
          "Authorization": "Bearer " + tokenData.access_token,
        },
      });
      if (userRes.ok) {
        const userData = await userRes.json();
        email = userData.email;
      }
    } catch { /* email fetch is optional */ }

    if (!tokenData.refresh_token) {
      return { type: "failed", error: "No refresh_token in response. Ensure access_type=offline and prompt=consent are set." };
    }

    return {
      type: "success",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      expiresIn: tokenData.expires_in,
      email,
    };
  } catch (e: any) {
    return { type: "failed", error: e?.message || "Unknown error during token exchange" };
  }
}

/**
 * Step 3: Refresh an expired access token using the refresh token.
 */
export async function refreshAntigravityToken(
  refreshToken: string,
  clientId?: string,
): Promise<TokenExchangeResult> {
  try {
    const tokenResponse = await fetch(GOOGLE_TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: clientId || ANTIGRAVITY_CLIENT_ID,
        grant_type: "refresh_token",
        refresh_token: refreshToken,
      }),
    });

    if (!tokenResponse.ok) {
      const errText = await tokenResponse.text();
      return { type: "failed", error: `Token refresh failed: ${errText.slice(0, 200)}` };
    }

    const tokenData = await tokenResponse.json();
    return {
      type: "success",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token || refreshToken,
      expiresIn: tokenData.expires_in,
    };
  } catch (e: any) {
    return { type: "failed", error: e?.message || "Token refresh error" };
  }
}

/**
 * Discover available models via Antigravity API.
 * Uses the Antigravity Cloud Code Assist API endpoint.
 */
export async function discoverAntigravityModels(accessToken: string): Promise<string[]> {
  // Antigravity models are defined by the Google Cloud project's AI capabilities.
  // The reference implementation uses a custom endpoint. For now, return known
  // models that are available through Antigravity's Gemini-backed API.
  const knownModels = [
    "gemini-1.5-flash",
    "gemini-1.5-pro",
    "claude-3-opus",
    "claude-3-sonnet",
    "claude-3-5-sonnet",
    "gpt-4o",
    "gpt-4-turbo",
    "deepseek-chat",
  ];

  // Try to fetch models from Antigravity's API
  try {
    const res = await fetch(`${ANTIGRAVITY_API_BASE}/v1/models`, {
      headers: {
        "Authorization": "Bearer " + accessToken,
        "Content-Type": "application/json",
      },
    });
    if (res.ok) {
      const text = await res.text();
      try {
        const data = JSON.parse(text);
        const apiModels = (data.models || data.data || []).map((m: any) =>
          typeof m === "string" ? m : m.name || m.id || m.model || m.modelId
        ).filter(Boolean);
        if (apiModels.length > 0) return apiModels;
      } catch (parseErr) {
        console.warn("[Antigravity] Failed to parse models JSON:", parseErr);
      }
    } else {
      console.warn(`[Antigravity] Models API returned ${res.status}`);
    }
  } catch (e) {
    console.warn("[Antigravity] Models fetch error:", e);
  }

  return knownModels;
}

/**
 * Generate a completion via Antigravity API (OpenAI-compatible).
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

  const res = await fetch(`${ANTIGRAVITY_API_BASE}/v1/chat/completions`, {
    method: "POST",
    headers: {
      "Authorization": "Bearer " + opts.accessToken,
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
  const text = data.choices?.[0]?.message?.content || "";
  return { text, provider: "antigravity", latencyMs };
}

export class AntigravityRateLimitError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AntigravityRateLimitError";
  }
}
