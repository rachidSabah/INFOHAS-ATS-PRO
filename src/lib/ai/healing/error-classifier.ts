// ============================================================================
// Provider Error Classifier — the diagnostic brain of the Auto-Heal system.
//
// Classifies a raw provider/proxy failure into a structured kind, decides
// whether it is TEMPORARY (safe to retry after backoff) and/or HEALABLE
// (safe automatic repair may fix it), and produces both a human-readable
// diagnosis and the untouched technical detail (directive #12: never hide
// real errors behind generic messages).
// ============================================================================

export type FailureKind =
  | "rate_limited"          // 429 / quota — temporary, cooldown + retry later
  | "cooldown"              // local cooldown state (not an API error)
  | "auth_error"            // 401/403/invalid key/credits — manual fix required
  | "model_error"           // invalid/unsupported model id — auto-healable
  | "api_version_error"     // model not found FOR API VERSION X — healable
  | "endpoint_error"        // 404 page/endpoint not found — healable if catalog knows the fix
  | "proxy_error"           // CORS proxy / non-JSON / 525 — infrastructure
  | "network_error"         // fetch failed / DNS / unreachable — temporary
  | "provider_unavailable"  // 5xx / overloaded — temporary
  | "invalid_request"       // 400 without a model cause — not auto-healable
  | "context_overflow"      // prompt too large — caller must shrink, not a provider fault
  | "unknown";              // unclassified — conservative: not temporary, not healable

export interface FailureClassification {
  kind: FailureKind;
  /** Safe to retry the SAME request after a backoff (transient infrastructure). */
  temporary: boolean;
  /** Safe automatic repair may fix this (model/endpoint refresh + validation). */
  healable: boolean;
  /** Short human-readable diagnosis with actionable next steps. */
  humanMessage: string;
  /** The raw error text, preserved for the Technical Details section. */
  technical: string;
  /** True when the error text mentions an API-version mismatch (directive #5). */
  apiVersionMismatch: boolean;
}

const RATE_LIMIT = /429|rate.?limit|too.?many.?requests|FreeUsageLimitError|quota|usage.?limit/i;
const QUOTA_EXHAUSTION = /FreeUsageLimitError|usage.?limit|quota.?exceeded|daily|monthly/i;
const AUTH = /401|403|unauthorized|unauthorised|forbidden|invalid.?api.?key|incorrect.?api.?key|authentication|auth.?fail|insufficient.?credits|credit.?balance|billing/i;
// "model(s) <any id up to 60 chars> not found / does not exist / not supported"
// — the bounded gap lets a specific model id (e.g. `hy3-free`) sit between.
const MODEL_ERR = /model[s]?[\s`"'/.\w-]{0,60}?(?:not.?found|does.?not.?exist|is.?not.?supported|unsupported|error\b)|not.?found.?for.?api.?version|invalid.?model|decommissioned/i;
const ENDPOINT = /404(?! model)|page.?not.?found|endpoint.?not.?found|no.?such.?path|cannot.?post.?to/i;
const API_VERSION = /api.?version|v1main|v1beta|not.?supported.?for.?gener/i;
const NETWORK = /fetch.?failed|network|enotfound|econnrefused|econnreset|dns|socket|unreachable|aborted|aborterror|timed? ?out|timeout/i;
const PROVIDER_DOWN = /50[0234]|bad.?gateway|service.?unavailable|overloaded|internal.?server.?error|capacity/i;
const PROXY = /proxy|non-?json|cloudflare|525|html response/i;
const CONTEXT = /context.?length|maximum.?context|too.?many.?tokens|prompt.?too.?long|max.?tokens.?exceeded|request.?too.?large/i;
const INVALID_REQUEST = /400|invalid.?request|bad.?request|missing.?required|malformed/i;

/**
 * Classify a provider failure from its raw message (and optional status code).
 * Pure function — no store access, no I/O. Safe for unit testing.
 */
export function classifyProviderFailure(
  raw: string,
  hints?: { statusCode?: number; providerType?: string }
): FailureClassification {
  const text = String(raw ?? "");
  const status = hints?.statusCode;
  // Order matters: the most specific pattern wins. A "404: model X not found"
  // is a MODEL error, not an ENDPOINT error; "404 page not found" is an
  // ENDPOINT error. Context-length mentions win over generic 400s.
  const isModelErr = MODEL_ERR.test(text);
  const isEndpointErr = ENDPOINT.test(text) && !isModelErr;
  const apiVersionMismatch = API_VERSION.test(text) && (isModelErr || isEndpointErr);

  const mk = (
    kind: FailureKind,
    temporary: boolean,
    healable: boolean,
    humanMessage: string
  ): FailureClassification => ({
    kind, temporary, healable, humanMessage,
    technical: text.slice(0, 500),
    apiVersionMismatch,
  });

  // --- Context overflow (caller's fault, not the provider's) ---
  if (CONTEXT.test(text)) {
    return mk("context_overflow", false, false,
      "The prompt exceeded the model's context window. Shrink the input (shorter resume/JD excerpt) or select a larger-context model.");
  }

  // --- Rate limit / quota ---
  if (RATE_LIMIT.test(text) || status === 429) {
    return mk("rate_limited", true, false,
      QUOTA_EXHAUSTION.test(text)
        ? "Provider is reachable and the key was accepted, but this account/model has exhausted its usage quota. Wait for the quota window to reset, switch model, or top up. No configuration change is needed."
        : "Temporary rate limit — the provider is reachable and the key was accepted. The router applies cooldown + automatic retry/failover.");
  }

  // --- Auth / credits (never auto-repairable: keys are user assets) ---
  if (AUTH.test(text) || status === 401 || status === 403 || status === 402) {
    return mk("auth_error", false, false,
      "Authentication or billing failure. Verify the API key (and account credits/billing) in the provider settings. Auto-Heal never modifies keys.");
  }

  // --- Model errors (auto-healable: catalog refresh + compatible replacement) ---
  if (isModelErr) {
    return mk(apiVersionMismatch ? "api_version_error" : "model_error", false, true,
      `The configured model id is not supported by this provider${apiVersionMismatch ? " for its current API version" : ""}. Auto-Heal will refresh the provider's model catalog and select a compatible model.`);
  }

  // --- Endpoint errors (healable only when a known-good catalog URL exists) ---
  if (isEndpointErr || status === 404) {
    return mk("endpoint_error", false, true,
      "The API endpoint returned 404. The endpoint path or API version may be stale. Auto-Heal validates the configured Base URL against the provider catalog before any repair.");
  }

  // --- Proxy / CORS infrastructure ---
  if (PROXY.test(text)) {
    return mk("proxy_error", true, false,
      "The request proxy failed (non-JSON/HTML response or TLS issue). Often transient — retry, and check the deployment's proxy routes if it persists.");
  }

  // --- Provider down (5xx) ---
  if (PROVIDER_DOWN.test(text) || (status !== undefined && status >= 500)) {
    return mk("provider_unavailable", true, false,
      "The provider API is temporarily unavailable (server-side 5xx/overload). Safe to retry after backoff; no configuration change is needed.");
  }

  // --- Network ---
  if (NETWORK.test(text)) {
    return mk("network_error", true, false,
      "Network-level failure reaching the API (DNS/socket/timeout). Check connectivity and the Base URL, then retry.");
  }

  // --- Invalid request (400) without a model cause ---
  if (INVALID_REQUEST.test(text) || status === 400) {
    return mk("invalid_request", false, false,
      "The provider rejected the request as malformed (HTTP 400). This is usually a request-shape or parameter issue, not a provider outage — inspect the Technical Details.");
  }

  return mk("unknown", false, false,
    "Unclassified failure. Review the Technical Details; Auto-Heal stays conservative and will not modify the configuration.");
}

/** Map a FailureKind to a compact UI health-state chip. */
export type HealthChip =
  | "HEALTHY" | "DEGRADED" | "COOLDOWN" | "MODEL ERROR" | "ENDPOINT ERROR"
  | "AUTH ERROR" | "HEALING" | "RECOVERED" | "UNAVAILABLE" | "PASS" | "FAIL" | "UNTESTED";

export function chipForClassification(c: FailureClassification): HealthChip {
  switch (c.kind) {
    case "rate_limited": return "COOLDOWN";
    case "cooldown": return "COOLDOWN";
    case "auth_error": return "AUTH ERROR";
    case "model_error":
    case "api_version_error": return "MODEL ERROR";
    case "endpoint_error": return "ENDPOINT ERROR";
    case "proxy_error":
    case "network_error":
    case "provider_unavailable": return "UNAVAILABLE";
    case "context_overflow":
    case "invalid_request":
    case "unknown": return "FAIL";
  }
}
