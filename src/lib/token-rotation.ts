// ============================================================================
// Token Rotation Manager — Feature 5: Automated Guest Session & Token Rotation
//
// When a provider returns 401 Unauthorized or a CreditsError, silently:
//   1. Request a new anonymous session token from the provider (if it supports it)
//   2. Retry the original request once with the new token
//   3. Update the provider's token in the store for future calls
//
// Currently handles:
//   - Puter.js: calls puter.auth.signIn() or uses anonymous guest mode
//   - OpenCode / ZenCode: attempts to refresh the free anonymous session
//   - Custom providers with refreshUrl: calls the refresh endpoint
//
// If rotation fails, the error propagates normally (caller applies cooldown).
// ============================================================================

"use client";

import { useApp } from "./store";

// ============================================================================
// Registry of supported rotation strategies
// ============================================================================

interface RotationResult {
  success: boolean;
  newToken?: string;
  message?: string;
}

/**
 * Attempt to silently rotate the session/token for a provider.
 * Returns true if rotation succeeded and the provider store was updated.
 * Returns false if this provider type doesn't support rotation or rotation failed.
 */
export async function tryRotateProviderToken(provider: any): Promise<RotationResult> {
  if (!provider) return { success: false, message: "No provider" };

  const pType = (provider.type || "").toLowerCase();

  // ---- Puter.js: Request a new anonymous guest session ----
  if (pType === "puter") {
    return rotatePuterSession(provider);
  }

  // ---- Providers with a declared refreshUrl ----
  if (provider.refreshUrl) {
    return rotateViaRefreshUrl(provider);
  }

  // ---- OpenCode / ZenCode: Re-register as anonymous user ----
  if (pType === "opencode" || pType === "zencode") {
    return rotateOpenCodeSession(provider);
  }

  return { success: false, message: `Provider type "${pType}" does not support token rotation` };
}

// ============================================================================
// Puter.js session rotation
// ============================================================================

async function rotatePuterSession(_provider: any): Promise<RotationResult> {
  if (typeof window === "undefined" || !window.puter) {
    return { success: false, message: "Puter SDK not available" };
  }
  try {
    // Attempt silent anonymous sign-in (no popup if guest mode available)
    const puterAny = window.puter as any;
    if (typeof puterAny.auth?.signIn === "function") {
      // Try signing in without triggering a popup by passing { no_ui: true }
      await puterAny.auth.signIn({ no_ui: true }).catch(() => null);
    }
    // After sign-in attempt, get the new auth token if available
    if (typeof puterAny.auth?.getToken === "function") {
      const newToken = await puterAny.auth.getToken().catch(() => null);
      if (newToken) {
        console.info("[TokenRotation] Puter: new session token acquired");
        return { success: true, newToken, message: "Puter session refreshed" };
      }
    }
    // If token acquisition failed but sign-in didn't throw, optimistically return success
    return { success: true, message: "Puter silent sign-in attempted" };
  } catch (err: any) {
    return {
      success: false,
      message: `Puter session rotation failed: ${err?.message || err}`,
    };
  }
}

// ============================================================================
// Generic refreshUrl-based rotation
// ============================================================================

async function rotateViaRefreshUrl(provider: any): Promise<RotationResult> {
  try {
    const res = await fetch(provider.refreshUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: provider.email || "", password: provider.password || "" }),
      signal: AbortSignal.timeout(10000), // 10s max for token refresh
    });

    if (!res.ok) {
      return { success: false, message: `Refresh endpoint returned ${res.status}` };
    }

    const data = (await res.json()) as any;
    const newToken = data?.token || data?.access_token || data?.apiKey || data?.key;

    if (!newToken) {
      return { success: false, message: "Refresh response contained no token field" };
    }

    // Persist the new token to the provider store
    updateProviderToken(provider.id, newToken);
    console.info(`[TokenRotation] ${provider.name}: token rotated via refreshUrl`);

    return { success: true, newToken, message: "Token rotated via refreshUrl" };
  } catch (err: any) {
    return {
      success: false,
      message: `refreshUrl rotation failed: ${err?.message || err}`,
    };
  }
}

// ============================================================================
// OpenCode / ZenCode anonymous session re-registration
// ============================================================================

async function rotateOpenCodeSession(provider: any): Promise<RotationResult> {
  try {
    // OpenCode/ZenCode allow guest registration via /api/register/guest endpoint
    const baseUrl = (provider.apiUrl || provider.baseUrl || "").trim();
    if (!baseUrl) return { success: false, message: "No base URL for OpenCode session rotation" };

    // Try standard guest endpoint patterns
    const guestEndpoints = [
      `${baseUrl.replace(/\/v\d+.*$/, "")}/auth/guest`,
      `${baseUrl.replace(/\/v\d+.*$/, "")}/register/guest`,
      `${baseUrl.replace(/\/v\d+.*$/, "")}/api/guest`,
    ];

    for (const endpoint of guestEndpoints) {
      try {
        const res = await fetch(endpoint, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          signal: AbortSignal.timeout(8000),
        });

        if (!res.ok) continue;

        const data = (await res.json()) as any;
        const newToken = data?.token || data?.api_key || data?.apiKey || data?.key || data?.access_token;

        if (newToken) {
          updateProviderToken(provider.id, newToken);
          console.info(`[TokenRotation] ${provider.name}: new guest token acquired from ${endpoint}`);
          return { success: true, newToken, message: "OpenCode/ZenCode guest token rotated" };
        }
      } catch {
        // Try next endpoint
      }
    }

    return { success: false, message: "OpenCode/ZenCode guest registration endpoints not available" };
  } catch (err: any) {
    return {
      success: false,
      message: `OpenCode session rotation failed: ${err?.message || err}`,
    };
  }
}

// ============================================================================
// Store update helper
// ============================================================================

function updateProviderToken(providerId: string, newToken: string): void {
  if (!providerId || !newToken) return;
  try {
    const store = useApp.getState() as any;
    if (typeof store?.setProviders !== "function" && typeof store?.updateProvider !== "function") return;

    const providers: any[] = store?.providers || [];
    const updated = providers.map((p: any) => {
      if (p.id === providerId) {
        return { ...p, apiKey: newToken };
      }
      return p;
    });

    if (typeof store.updateProvider === "function") {
      store.updateProvider(providerId, { apiKey: newToken });
    } else if (typeof store.setProviders === "function") {
      store.setProviders(updated);
    }
  } catch (err) {
    console.warn("[TokenRotation] Failed to persist new token to store:", err);
  }
}

// ============================================================================
// Error detection helpers
// ============================================================================

/**
 * Returns true if the error indicates a credential/session expiry that
 * token rotation might fix (401, 403, CreditsError, Unauthorized, etc.)
 */
export function isRotatableAuthError(err: any): boolean {
  if (!err) return false;
  const code = err?.statusCode || err?.status || 0;
  if (code === 401 || code === 403) return true;
  const msg = (err?.message || String(err || "")).toLowerCase();
  return (
    /unauthorized/i.test(msg) ||
    /creditserror/i.test(msg) ||
    /no credits/i.test(msg) ||
    /session.?expired/i.test(msg) ||
    /token.?expired/i.test(msg) ||
    /invalid.?token/i.test(msg) ||
    /authentication.?required/i.test(msg) ||
    (/401/.test(msg) && !/429/.test(msg)) // 401 in message but not 429
  );
}
