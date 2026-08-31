/**
 * Task 30 — ZaiWebSessionValidator
 *
 * A discovered token-like value is NEVER proof of a working session ("do
 * not mark the provider Connected merely because a token-like value was
 * found"). The validator performs an ACTUAL authenticated Z.ai web-session
 * request and maps the outcome onto an explicit state machine:
 *
 *   connected | authentication_required | session_expired |
 *   session_invalid | rate_limited | blocked | network_error
 *
 * Contract handling: the Z.ai web contract (paths) is a CANDIDATE default
 * validated at runtime — never a hard assumption. Z.ai can reject datacenter
 * IPs (rate_limited/blocked) or change its internal API (session_invalid);
 * every failure degrades gracefully and never corrupts provider state.
 */

import {
  ZAI_WEB_ORIGIN,
  ZAI_WEB_PROVIDER_ID,
  type ZaiWebSession,
} from "./session-discovery";

export type ZaiWebSessionState =
  | "connected"
  | "authentication_required"
  | "session_expired"
  | "session_invalid"
  | "rate_limited"
  | "blocked"
  | "network_error";

export interface ZaiWebContract {
  origin: string;
  /** Candidate models endpoint used for the validation request. */
  modelsPath: string;
}

export const DEFAULT_ZAI_WEB_CONTRACT: ZaiWebContract = {
  origin: ZAI_WEB_ORIGIN,
  modelsPath: "/api/models",
};

export interface ZaiWebValidationResult {
  state: ZaiWebSessionState;
  providerId: string;
  /** True ONLY for state === "connected". */
  authenticated: boolean;
  /** Discovered model ids when the validation response carried them. */
  models?: string[];
  /** Human-presentable, token-free explanation for the UI. */
  message: string;
  latencyMs: number;
}

export interface ValidatorFetchLike {
  (url: string, init?: { headers?: Record<string, string>; signal?: AbortSignal }):
    | Promise<{ ok: boolean; status: number; text: () => Promise<string>; json: () => Promise<unknown> }>
    | Promise<Response>;
}

/** Exported for the Task 30c models/base fallback — tolerant id/name extraction. */
export function extractModelIds(data: unknown): string[] | undefined {
  if (!data || typeof data !== "object") return undefined;
  const obj = data as Record<string, unknown>;
  const list = Array.isArray(obj.data) ? obj.data : Array.isArray(obj.models) ? obj.models : undefined;
  if (!list) return undefined;
  const ids = list
    .map((m) => {
      if (typeof m === "string") return m;
      if (m && typeof m === "object") {
        const rec = m as Record<string, unknown>;
        return typeof rec.id === "string" ? rec.id : typeof rec.name === "string" ? rec.name : "";
      }
      return "";
    })
    .filter(Boolean);
  return ids.length > 0 ? ids : undefined;
}

export async function validateZaiWebSession(
  session: Pick<ZaiWebSession, "token"> | null | undefined,
  fetchLike: ValidatorFetchLike,
  contract: ZaiWebContract = DEFAULT_ZAI_WEB_CONTRACT,
): Promise<ZaiWebValidationResult> {
  const t0 = Date.now();
  const base = { providerId: ZAI_WEB_PROVIDER_ID, latencyMs: 0 };

  if (!session?.token) {
    return {
      ...base,
      state: "authentication_required",
      authenticated: false,
      message:
        "No Z.ai web session found. Open Z.ai, sign in with Google, then run the Z.ai → ATS Pro bridge while on chat.z.ai.",
    };
  }

  try {
    const res = await fetchLike(`${contract.origin}${contract.modelsPath}`, {
      headers: { Authorization: `Bearer ${session.token}` },
      signal: AbortSignal.timeout(10000),
    });
    const latencyMs = Date.now() - t0;

    if (res.status === 401 || res.status === 403) {
      // 401 = token rejected; 403 MAY be an expired session or a block.
      // Distinguish conservatively: a JSON body mentioning auth/quota/expiry
      // keeps session semantics; anything else is treated as blocked.
      const body = await res.text().catch(() => "");
      const looksSessionRelated = /auth|token|expire|login|unauthor/i.test(body.slice(0, 500));
      return {
        ...base,
        latencyMs,
        state: res.status === 401 && looksSessionRelated ? "session_expired" : "blocked",
        authenticated: false,
        message:
          res.status === 401 && looksSessionRelated
            ? "Z.ai rejected the web session (expired or revoked). Reconnect: open Z.ai, sign in, re-run the bridge."
            : "Z.ai refused the validation request (HTTP " + res.status + "). The session may be fine but Z.ai is rejecting this client — retry from your browser via the bridge, or try later.",
      };
    }

    if (res.status === 429) {
      return {
        ...base,
        latencyMs,
        state: "rate_limited",
        authenticated: false,
        message: "Z.ai is rate-limiting the session. Wait and retry — the session itself is still valid.",
      };
    }

    if (!res.ok) {
      return {
        ...base,
        latencyMs,
        state: "session_invalid",
        authenticated: false,
        message: `Unexpected Z.ai response (HTTP ${res.status}). The web contract may have changed — the adapter fails gracefully until re-validated.`,
      };
    }

    const data = (await res.json().catch(() => null)) as unknown;
    const models = extractModelIds(data);
    return {
      ...base,
      latencyMs,
      state: "connected",
      authenticated: true,
      models,
      message: "Z.ai web session validated against the live web contract.",
    };
  } catch (e: unknown) {
    const message = e instanceof Error ? e.message : String(e);
    const timedOut = /timeout|abort/i.test(message);
    return {
      ...base,
      latencyMs: Date.now() - t0,
      state: timedOut ? "network_error" : "network_error",
      authenticated: false,
      message: timedOut
        ? "Z.ai did not answer in time (network). The session was not marked connected."
        : `Network failure contacting Z.ai (${message.slice(0, 120)}).`,
    };
  }
}
