/**
 * Task 30b — Server-side Z.ai Web session validation.
 *
 * WHY THIS EXISTS (the "always failing" fix):
 *   The browser bridge imports the session from chat.z.ai into the ATS Pro
 *   SERVER (encrypted D1). The ATS Pro page's in-memory store is NEVER
 *   populated by that flow (the bookmarklet runs on chat.z.ai, not on ATS
 *   Pro) and is wiped on every reload. A browser-side Test Connection that
 *   only checks memory therefore always reports authentication_required.
 *
 *   This module validates the SERVER-STORED ciphertext instead: decrypt in
 *   the edge runtime, run a REAL Z.ai web request from the server, and
 *   return only the validation outcome. The token itself is never echoed,
 *   logged, or included in any response.
 *
 * Honest-state contract: every terminal condition maps to an explicit
 * ZaiWebSessionState — no fabricated "connected".
 */

import { decrypt } from "../antigravity-routes";
import {
  DEFAULT_ZAI_WEB_CONTRACT,
  validateZaiWebSession,
} from "./session-validator";

/** Minimal D1 surface used here — injectable for tests. */
export interface ZaiWebServerValidateDb {
  prepare(sql: string): {
    bind(...values: unknown[]): { first<T = unknown>(): Promise<T | null>; run(): Promise<{ meta?: { changes?: number } }> };
    first<T = unknown>(): Promise<T | null>;
  };
}

export interface ServerValidationOutcome {
  status: number;
  body: {
    ok: boolean;
    stored?: "server" | "not-stored";
    validated: boolean;
    state: string;
    models: string[];
    message: string;
  };
}

export async function validateStoredZaiWebSession(
  db: ZaiWebServerValidateDb | undefined,
  encryptionKey: string | undefined,
  fetchLike: typeof fetch = fetch,
): Promise<ServerValidationOutcome> {
  // ---- Fail closed: without the secure sink there is nothing to validate.
  if (!db || typeof db.prepare !== "function") {
    return {
      status: 501,
      body: {
        ok: false,
        stored: "not-stored",
        validated: false,
        state: "network_error",
        models: [],
        message:
          "ATS Pro secure storage is unavailable (no D1 binding), so the server-stored session cannot be validated. Re-run the bridge import — it validates before storing.",
      },
    };
  }

  // ---- Load the encrypted session (single row for the zai-web provider).
  let row: { access_token?: string } | null = null;
  try {
    row = await db
      .prepare(
        `SELECT access_token FROM provider_tokens WHERE user_id = 'zai_web_user' AND provider_id = 'zai-web' LIMIT 1`,
      )
      .first<{ access_token?: string }>();
  } catch {
    row = null;
  }

  if (!row?.access_token) {
    return {
      status: 200,
      body: {
        ok: true,
        stored: "not-stored",
        validated: false,
        state: "authentication_required",
        models: [],
        message:
          "No server-stored Z.ai web session yet. Open Z.ai, sign in with Google, run the Z.ai → ATS Pro bridge on chat.z.ai, then Test Connection again.",
      },
    };
  }

  // ---- Decrypt and validate with a REAL Z.ai web request (never trust
  //      token presence; the token never appears in any response).
  let token: string | null = null;
  try {
    token = await decrypt(row.access_token, encryptionKey);
  } catch {
    token = null;
  }
  if (!token) {
    return {
      status: 200,
      body: {
        ok: true,
        stored: "server",
        validated: false,
        state: "session_invalid",
        models: [],
        message:
          "The stored Z.ai web session could not be decrypted — it is unusable. Disconnect, then re-import via the bridge.",
      },
    };
  }

  const validation = await validateZaiWebSession(
    { token },
    ((url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }) =>
      fetchLike(url, init as RequestInit)) as typeof fetch,
    DEFAULT_ZAI_WEB_CONTRACT,
  );

  // ---- Best-effort: persist the observed validation state (never the token).
  try {
    await db
      .prepare(
        `UPDATE provider_tokens
         SET metadata = json_set(COALESCE(metadata, '{}'), '$.validation_state', ?1),
             expires_at = ?2
         WHERE user_id = 'zai_web_user' AND provider_id = 'zai-web'`,
      )
      .bind(
        validation.state,
        validation.state === "connected" ? Date.now() + 24 * 3600 * 1000 : null,
      )
      .run();
  } catch {
    /* state persistence is cosmetic — validation result is authoritative */
  }

  return {
    status: 200,
    body: {
      ok: true,
      stored: "server",
      validated: validation.state === "connected",
      state: validation.state,
      models: validation.models ?? [],
      message: validation.message,
    },
  };
}
