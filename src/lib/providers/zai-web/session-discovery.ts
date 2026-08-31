/**
 * Task 30 — ZaiWebSessionDiscovery
 *
 * Discovers the authenticated chat.z.ai WEB SESSION state. This module is
 * ORIGIN-GUARDED by design:
 *
 *  - When executed on https://chat.z.ai (user-initiated, e.g. inside the
 *    ATS Pro browser bridge bookmarklet) it may inspect that origin's own
 *    storage: cookies, localStorage, sessionStorage. This is the user
 *    reading their own session on the page they are already using — no
 *    anti-bot/CAPTCHA/MFA mechanism is touched.
 *  - When executed anywhere else (the ATS Pro web app on Cloudflare Pages,
 *    a Worker, tests) cross-origin storage is UNREADABLE by browser design.
 *    The discovery must then report INACCESSIBLE honestly — it must NEVER
 *    pretend a session exists and must NEVER attempt to bypass origin
 *    isolation, HttpOnly boundaries, or any Z.ai security control.
 *
 * Only Z.ai session state is ever inspected. Google credentials (cookies,
 * tokens, Gmail data) are out of scope and are never requested or stored.
 */

export const ZAI_WEB_ORIGIN = "https://chat.z.ai";
export const ZAI_WEB_PROVIDER_ID = "zai-web";
export const ZAI_WEB_CREDENTIAL_TYPE = "zai_web_session";

export interface ZaiWebSession {
  authenticated: boolean;
  sessionId?: string;
  token?: string;
  expiresAt?: number;
  source: "cookie" | "localStorage" | "sessionStorage" | "other";
}

export type ZaiWebDiscoveryOutcome =
  | { accessible: true; session: ZaiWebSession | null }
  | { accessible: false; reason: "inaccessible-origin" | "non-browser" };

/** Minimal storage surface the discovery needs — injectable for tests. */
export interface ZaiWebStorageSurface {
  origin: string;
  cookie: string | null;
  localStorage: Record<string, string | null>;
  sessionStorage: Record<string, string | null>;
}

export interface ZaiWebDiscoveryOptions {
  /**
   * Storage keys the chat.z.ai web app is known/candidate to use for its
   * session token. Candidates are probed in order; the FIRST non-empty
   * value wins. This list is deliberately NOT a hard assumption: the
   * validator re-verifies whatever is found with a real request.
   */
  candidateTokenKeys?: string[];
  candidateSessionIdKeys?: string[];
}

const DEFAULT_TOKEN_KEYS = [
  "token",
  "access_token",
  "auth_token",
  "session_token",
  "zai_token",
  "satoken",
];

const DEFAULT_SESSION_ID_KEYS = ["session_id", "sessionId", "device_id"];

function parseCookie(name: string, cookie: string): string | null {
  const match = cookie.match(new RegExp(`(?:^|;\\s*)${name}=([^;]*)`));
  return match ? decodeURIComponent(match[1]) : null;
}

function isJwtLike(value: string): boolean {
  // A session token candidate: reasonably long, no whitespace/braces.
  return value.length >= 16 && !/[\s{}]/.test(value);
}

/**
 * Probe the injected storage surface for the Z.ai web session.
 * Runs ONLY when the surface's origin is chat.z.ai; anything else reports
 * an inaccessible origin instead of pretending.
 */
export function discoverZaiWebSession(
  surface: ZaiWebStorageSurface,
  options: ZaiWebDiscoveryOptions = {},
): ZaiWebDiscoveryOutcome {
  if (surface.origin !== ZAI_WEB_ORIGIN) {
    return { accessible: false, reason: "inaccessible-origin" };
  }

  const tokenKeys = options.candidateTokenKeys ?? DEFAULT_TOKEN_KEYS;
  const sessionIdKeys = options.candidateSessionIdKeys ?? DEFAULT_SESSION_ID_KEYS;

  // 1. Cookies (HttpOnly cookies are invisible here by browser design —
  //    that is respected, not bypassed).
  for (const key of tokenKeys) {
    const value = surface.cookie ? parseCookie(key, surface.cookie) : null;
    if (value && isJwtLike(value)) {
      return {
        accessible: true,
        session: {
          authenticated: true,
          token: value,
          source: "cookie",
          sessionId: pickSessionId(sessionIdKeys, surface),
        },
      };
    }
  }

  // 2. localStorage candidates.
  for (const key of tokenKeys) {
    const raw = surface.localStorage[key];
    if (!raw) continue;
    const value = unwrapStoredValue(raw);
    if (value && isJwtLike(value)) {
      return {
        accessible: true,
        session: {
          authenticated: true,
          token: value,
          source: "localStorage",
          expiresAt: readExpiresAt(surface.localStorage),
          sessionId: pickSessionId(sessionIdKeys, surface),
        },
      };
    }
  }

  // 3. sessionStorage candidates.
  for (const key of tokenKeys) {
    const raw = surface.sessionStorage[key];
    if (!raw) continue;
    const value = unwrapStoredValue(raw);
    if (value && isJwtLike(value)) {
      return {
        accessible: true,
        session: {
          authenticated: true,
          token: value,
          source: "sessionStorage",
          sessionId: pickSessionId(sessionIdKeys, surface),
        },
      };
    }
  }

  return { accessible: true, session: null };
}

/** JSON wrappers ({token: "..."} / {value: "..."}) are unwrapped; raw strings pass through. */
function unwrapStoredValue(raw: string): string | null {
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (typeof parsed === "string") return parsed;
    if (parsed && typeof parsed === "object") {
      const obj = parsed as Record<string, unknown>;
      for (const field of ["token", "value", "accessToken", "access_token"]) {
        if (typeof obj[field] === "string") return obj[field] as string;
      }
    }
    return null;
  } catch {
    return raw;
  }
}

function readExpiresAt(storage: Record<string, string | null>): number | undefined {
  for (const key of ["token_expires_at", "expires_at", "expiresAt", "expires"]) {
    const raw = storage[key];
    if (!raw) continue;
    const n = Number(unwrapStoredValue(raw));
    if (Number.isFinite(n) && n > 0) return n;
  }
  return undefined;
}

function pickSessionId(
  keys: string[],
  surface: ZaiWebStorageSurface,
): string | undefined {
  for (const key of keys) {
    const fromLocal = surface.localStorage[key];
    if (fromLocal) return fromLocal.slice(0, 64);
    const fromSession = surface.sessionStorage[key];
    if (fromSession) return fromSession.slice(0, 64);
  }
  return undefined;
}
