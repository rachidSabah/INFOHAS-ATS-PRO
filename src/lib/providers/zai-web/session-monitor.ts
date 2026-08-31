/**
 * Task 30 — ZaiWebSessionMonitor
 *
 * Session lifecycle monitor for the Z.ai Web provider:
 *
 *   ACTIVE      — session validated and not near expiry
 *   EXPIRING    — validated but expires within the warning window
 *   EXPIRED     — past expiresAt (or validator says session_expired)
 *   INVALID     — validator rejected the session outright
 *
 * An expired/invalid session maps the PROVIDER to DEGRADED and prompts the
 * user to reconnect (open Z.ai → bridge). It NEVER triggers automatic
 * Google re-authentication and never fabricates a success.
 */

export type ZaiWebMonitorState = "active" | "expiring" | "expired" | "invalid";

export interface ZaiWebMonitorInput {
  hasCredential: boolean;
  expiresAt?: number;
  lastValidation?: "connected" | "session_expired" | "session_invalid" | "rate_limited" | "blocked" | "authentication_required" | "network_error";
  now?: number;
}

export const EXPIRY_WARNING_WINDOW_MS = 30 * 60 * 1000; // 30 minutes

export function monitorZaiWebSession(input: ZaiWebMonitorInput): {
  state: ZaiWebMonitorState;
  providerHealth: "healthy" | "degraded" | "unavailable";
  reconnectPrompt: boolean;
  message: string;
} {
  const now = input.now ?? Date.now();

  if (!input.hasCredential) {
    return {
      state: "invalid",
      providerHealth: "unavailable",
      reconnectPrompt: false,
      message: "Z.ai Web has no stored session. Connect via the browser bridge.",
    };
  }

  if (input.lastValidation === "session_expired" || (input.expiresAt !== undefined && input.expiresAt <= now)) {
    return {
      state: "expired",
      providerHealth: "degraded",
      reconnectPrompt: true,
      message: "Z.ai session expired — Z.ai Web is DEGRADED. Reconnect: open Z.ai, sign in, re-run the bridge.",
    };
  }

  if (input.lastValidation === "session_invalid" || input.lastValidation === "authentication_required") {
    return {
      state: "invalid",
      providerHealth: "degraded",
      reconnectPrompt: true,
      message: "Z.ai session is no longer valid — Z.ai Web is DEGRADED. Reconnect via the browser bridge.",
    };
  }

  if (input.expiresAt !== undefined && input.expiresAt - now <= EXPIRY_WARNING_WINDOW_MS) {
    return {
      state: "expiring",
      providerHealth: "healthy",
      reconnectPrompt: false,
      message: "Z.ai session expires soon — reconnect at your convenience.",
    };
  }

  return {
    state: "active",
    providerHealth: "healthy",
    reconnectPrompt: false,
    message: "Z.ai web session active.",
  };
}

/**
 * Logging helper — Task 30: session tokens, cookies, Authorization headers
 * and any Z.ai/Google credential material NEVER reach logs. Anything that
 * looks like credential material becomes [REDACTED].
 */
const REDACTED = "[REDACTED]";

export function redactZaiSecrets(input: string): string {
  return input
    // Authorization / Cookie header values (JSON or plain)
    .replace(/"(authorization|cookie|set-cookie|x-api-key)"\s*:\s*"[^"]*"/gi, `$1":"${REDACTED}"`)
    .replace(/(authorization|cookie|x-api-key):\s*\S+/gi, `$1: ${REDACTED}`)
    // Bearer tokens anywhere
    .replace(/bearer\s+[A-Za-z0-9\-_.~+/=]{8,}/gi, `bearer ${REDACTED}`)
    // Long JWT-ish values
    .replace(/\beyJ[A-Za-z0-9\-_.]{16,}/g, REDACTED)
    // Session storage keys the discovery probes
    .replace(/"(token|access_token|auth_token|session_token|zai_token|satoken)"\s*:\s*"[^"]*"/gi, `$1":"${REDACTED}"`);
}
