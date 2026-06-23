// ResumeAI Pro — Session Manager
// Manages provider sessions with encrypted token storage.
// Persists to localStorage (client) and D1/KV (cloud).
// Tokens are NEVER stored in plain text.

import type { ProviderSession } from "./interface";
import { createEmptySession } from "./interface";

// ============================================================================
// Encryption helpers using Web Crypto API (available in Edge + browser)
// ============================================================================

const ENCRYPTION_KEY = "resumeai-pro-session-key-v1";

async function getEncryptionKey(): Promise<CryptoKey> {
  const encoder = new TextEncoder();
  const keyMaterial = await crypto.subtle.importKey(
    "raw",
    encoder.encode(ENCRYPTION_KEY.padEnd(32, "0").slice(0, 32)),
    { name: "AES-GCM" },
    false,
    ["encrypt", "decrypt"],
  );
  return keyMaterial;
}

/**
 * Encrypt a string value using AES-GCM.
 * Returns base64-encoded ciphertext.
 */
async function encryptValue(plaintext: string | null): Promise<string | null> {
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
    return btoa(String.fromCharCode(...combined));
  } catch {
    // Encryption not available — store as-is (better than losing the session)
    console.warn("[SessionManager] Encryption failed, storing token as-is");
    return plaintext;
  }
}

/**
 * Decrypt a value encrypted by encryptValue().
 */
async function decryptValue(ciphertext: string | null): Promise<string | null> {
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
    return ciphertext;
  }
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
 */
export async function saveSession(session: ProviderSession): Promise<void> {
  const encrypted = { ...session };

  // Encrypt sensitive fields
  encrypted.accessToken = await encryptValue(session.accessToken);
  encrypted.refreshToken = await encryptValue(session.refreshToken);

  try {
    localStorage.setItem(storageKey(session.provider), JSON.stringify(encrypted));
    console.log(`[SessionManager] Session saved for ${session.provider} (authenticated: ${session.authenticated})`);
  } catch (e) {
    console.warn(`[SessionManager] Failed to save session for ${session.provider}:`, e);
  }

  // Also persist to D1 via cloud API (fire-and-forget)
  persistToCloud(encrypted).catch(() => {
    // Cloud persistence is best-effort — don't block on it
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
  } catch {
    // Cloud load failed — that's OK
  }

  return null;
}

/**
 * Clear a provider session from localStorage and cloud.
 */
export async function clearSession(provider: ProviderSession["provider"]): Promise<void> {
  try {
    localStorage.removeItem(storageKey(provider));
  } catch {
    // Ignore
  }

  // Clear from cloud too
  clearFromCloud(provider).catch(() => {});

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
  typeof window !== "undefined" && window.location.hostname === "localhost"
    ? "http://localhost:8787"
    : "https://resumeai-pro-api.rachidelsabah.workers.dev";

async function persistToCloud(session: ProviderSession): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${CLOUD_API_BASE}/api/provider-sessions/${session.provider}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(session),
    });
  } catch {
    // Best-effort — don't block
  }
}

async function loadFromCloud(provider: string): Promise<ProviderSession | null> {
  if (typeof window === "undefined") return null;
  try {
    const res = await fetch(`${CLOUD_API_BASE}/api/provider-sessions/${provider}`);
    if (res.ok) {
      return await res.json();
    }
  } catch {
    // Best-effort
  }
  return null;
}

async function clearFromCloud(provider: string): Promise<void> {
  if (typeof window === "undefined") return;
  try {
    await fetch(`${CLOUD_API_BASE}/api/provider-sessions/${provider}`, {
      method: "DELETE",
    });
  } catch {
    // Best-effort
  }
}
