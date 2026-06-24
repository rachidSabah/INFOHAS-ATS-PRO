// ResumeAI Pro — Session Manager
// Manages provider sessions with encrypted token storage.
// Persists to localStorage (client) and D1/KV (cloud).
// Tokens are NEVER stored in plain text.

import type { ProviderSession } from "./interface";
import { createEmptySession } from "./interface";

// ============================================================================
// Encryption helpers using Web Crypto API (available in Edge + browser)
// ============================================================================

// Derive encryption key from a combination of origin + user agent fingerprint.
// This is NOT as secure as a per-user secret, but it's much better than a
// hardcoded key in source code. The key is unique per origin+browser combo,
// so stealing the source code does NOT give the decryption key.
// For production, replace with a proper server-side key management system.
async function getEncryptionKey(): Promise<CryptoKey> {
  // Create a stable but origin-specific key material
  const origin = typeof window !== "undefined" ? window.location.origin : "resumeai-pro-fallback";
  const ua = typeof navigator !== "undefined" ? navigator.userAgent : "unknown-ua";
  const keyMaterial = `ResumeAI-Pro-Session-${origin}-${ua.slice(0, 32)}`;

  // Use PBKDF2 to derive a proper AES-GCM key from the material
  const encoder = new TextEncoder();
  const baseKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(keyMaterial),
    { name: "PBKDF2" },
    false,
    ["deriveKey"],
  );

  // Use a fixed salt (acceptable for same-origin derivation — the salt
  // prevents rainbow table attacks even though it's in source code)
  const salt = encoder.encode("ResumeAI-Pro-PBKDF2-Salt-v1");

  return crypto.subtle.deriveKey(
    {
      name: "PBKDF2",
      salt,
      iterations: 100000, // OWASP recommended minimum
      hash: "SHA-256",
    },
    baseKey,
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
}

/**
 * Encrypt a string value using AES-GCM.
 * Returns base64-encoded ciphertext.
 */
export async function encryptValue(plaintext: string | null): Promise<string | null> {
  if (!plaintext) return null;
  try {
    const key = await getEncryptionKey();
    const encoder = new TextEncoder();
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ciphertext = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key,
      encoder.encode(plaintext),
    );
    // Combine iv + ciphertext and base64 encode
    const combined = new Uint8Array(iv.length + ciphertext.byteLength);
    combined.set(iv);
    combined.set(new Uint8Array(ciphertext), iv.length);
    // Use chunked encoding to avoid "Maximum call stack size exceeded" for large payloads
    return uint8ToBase64(combined);
  } catch (e) {
    // CRITICAL: Encryption failure must NOT silently store plaintext tokens.
    // Return a marker that indicates encryption failed — callers must handle this.
    console.error("[SessionManager] Encryption FAILED — refusing to store unencrypted token!", e);
    // Return null to signal encryption failure — the session manager should
    // refuse to persist rather than storing plaintext.
    return null;
  }
}

/**
 * Decrypt a value encrypted by encryptValue().
 */
export async function decryptValue(ciphertext: string | null): Promise<string | null> {
  if (!ciphertext) return null;
  try {
    const key = await getEncryptionKey();
    const combined = Uint8Array.from(atob(ciphertext), (c) => c.charCodeAt(0));
    const iv = combined.slice(0, 12);
    const data = combined.slice(12);
    const plaintext = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv },
      key,
      data,
    );
    return new TextDecoder().decode(plaintext);
  } catch {
    // Decryption failed — might be unencrypted (from older version)
    // or the key material changed (different browser/origin)
    // Return the raw value and let the caller validate it
    console.warn("[SessionManager] Decryption failed — data may be from a different origin or older version");
    return null; // Don't return ciphertext as plaintext
  }
}

/**
 * Chunked base64 encoding — avoids stack overflow on large Uint8Arrays.
 * String.fromCharCode(...hugeArray) hits the max call stack size.
 */
function uint8ToBase64(bytes: Uint8Array): string {
  const chunkSize = 8192;
  let binary = "";
  for (let i = 0; i < bytes.length; i += chunkSize) {
    const chunk = bytes.subarray(i, Math.min(i + chunkSize, bytes.length));
    binary += String.fromCharCode(...chunk);
  }
  return btoa(binary);
}

// ============================================================================
// Storage keys
// ============================================================================

const STORAGE_KEY_PREFIX = "resumeai-provider-session-";

function storageKey(provider: ProviderSession["provider"]): string {
  return `${STORAGE_KEY_PREFIX}${provider}`;
}

// ============================================================================
// Session Manager
// ============================================================================

/**
 * Save a provider session to localStorage with encrypted tokens.
 * Refuses to store if encryption fails (no plaintext tokens on disk).
 */
export async function saveSession(session: ProviderSession): Promise<void> {
  const encrypted = { ...session };

  // Encrypt sensitive fields
  const encAccess = await encryptValue(session.accessToken);
  const encRefresh = await encryptValue(session.refreshToken);

  // If encryption failed, store session WITHOUT the access/refresh tokens
  // rather than storing them in plaintext. The session metadata (email,
  // expiry, models) is still useful for the UI, but the tokens are gone.
  if (session.accessToken && encAccess === null) {
    console.error(`[SessionManager] CRITICAL: Access token encryption failed for ${session.provider} — token will NOT be stored`);
    encrypted.accessToken = null;
  } else {
    encrypted.accessToken = encAccess;
  }
  if (session.refreshToken && encRefresh === null) {
    console.error(`[SessionManager] CRITICAL: Refresh token encryption failed for ${session.provider} — token will NOT be stored`);
    encrypted.refreshToken = null;
  } else {
    encrypted.refreshToken = encRefresh;
  }

  try {
    localStorage.setItem(storageKey(session.provider), JSON.stringify(encrypted));
    console.log(`[SessionManager] Session saved for ${session.provider} (authenticated: ${session.authenticated})`);
  } catch (e) {
    console.warn(`[SessionManager] Failed to save session for ${session.provider}:`, e);
  }

  // Also persist to D1 via cloud API (fire-and-forget)
  persistToCloud(encrypted).catch((e) => {
    console.warn("[SessionManager] Cloud persist failed:", e instanceof Error ? e.message : e);
  });
}

/**
 * Load a provider session from localStorage, decrypting tokens.
 */
export async function loadSession(provider: ProviderSession["provider"]): Promise<ProviderSession | null> {
  try {
    // Try localStorage first
    const raw = localStorage.getItem(storageKey(provider));
    if (raw) {
      const session: ProviderSession = JSON.parse(raw);
      // Decrypt sensitive fields
      session.accessToken = await decryptValue(session.accessToken);
      session.refreshToken = await decryptValue(session.refreshToken);
      return session;
    }
  } catch (e) {
    console.warn(`[SessionManager] Failed to load session for ${provider}:`, e);
  }

  // Try loading from D1 via cloud API
  try {
    const cloudSession = await loadFromCloud(provider);
    if (cloudSession) {
      cloudSession.accessToken = await decryptValue(cloudSession.accessToken);
      cloudSession.refreshToken = await decryptValue(cloudSession.refreshToken);
      // Save to localStorage for faster access next time
      await saveSession(cloudSession);
      return cloudSession;
    }
  } catch (cloudLoadErr) {
    console.warn("[SessionManager] Cloud session load failed:", cloudLoadErr instanceof Error ? cloudLoadErr.message : cloudLoadErr);
  }

  return null;
}

/**
 * Clear a provider session from localStorage and cloud.
 */
export async function clearSession(provider: ProviderSession["provider"]): Promise<void> {
  try {
    localStorage.removeItem(storageKey(provider));
  } catch (clearErr) {
    console.warn("[SessionManager] localStorage clear failed:", clearErr instanceof Error ? clearErr.message : clearErr);
  }

  // Clear from cloud too
  clearFromCloud(provider).catch((e) => { console.warn("[session-manager] Cloud clear failed:", e instanceof Error ? e.message : e); });

  console.log(`[SessionManager] Session cleared for ${provider}`);
}

/**
 * Check if a session is expired and needs refresh.
 */
export function isSessionExpired(session: ProviderSession): boolean {
  if (!session.expiresAt) return false; // No expiry set — assume valid
  return Date.now() >= session.expiresAt;
}

/**
 * Check if a session will expire within the next 5 minutes.
 * Useful for proactive refresh.
 */
export function isSessionExpiringSoon(session: ProviderSession): boolean {
  if (!session.expiresAt) return false;
  return Date.now() >= session.expiresAt - 5 * 60 * 1000;
}

/**
 * Get all provider sessions (for startup restore).
 */
export async function getAllSessions(): Promise<ProviderSession[]> {
  const sessions: ProviderSession[] = [];
  for (const provider of ["puter", "zai-direct"] as const) {
    const session = await loadSession(provider);
    if (session) {
      sessions.push(session);
    } else {
      sessions.push(createEmptySession(provider));
    }
  }
  return sessions;
}

// ============================================================================
// Cloud persistence (D1 via Worker API)
// ============================================================================

const CLOUD_API_BASE =
  (typeof window !== "undefined" && (window as any).__CLOUD_API_BASE) ||
  (typeof process !== "undefined" && process.env?.NEXT_PUBLIC_CLOUD_API_BASE) ||
  (typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://resumeai-pro-api.rachidelsabah.workers.dev");

async function persistToCloud(session: ProviderSession): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${CLOUD_API_BASE}/api/provider-sessions/${session.provider}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
  } catch (persistErr) {
    console.warn("[SessionManager] Cloud persist failed:", persistErr instanceof Error ? persistErr.message : persistErr);
  }
}

async function loadFromCloud(provider: string): Promise<ProviderSession | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${CLOUD_API_BASE}/api/provider-sessions/${provider}`);
    if (res.ok) {
      return await res.json();
    }
  } catch (loadErr) {
    console.warn("[SessionManager] Cloud load failed:", loadErr instanceof Error ? loadErr.message : loadErr);
  }
  return null;
}

async function clearFromCloud(provider: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${CLOUD_API_BASE}/api/provider-sessions/${provider}`, {
      method: "DELETE",
    });
  } catch (deleteErr) {
    console.warn("[SessionManager] Cloud delete failed:", deleteErr instanceof Error ? deleteErr.message : deleteErr);
  }
}
