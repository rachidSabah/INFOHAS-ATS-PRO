/**
 * Task 28 — Routing Chain Diagnostics fidelity contract.
 *
 * "Test Entire Chain" (AIProviderSettings.tsx) probes every link of the
 * routing chain through ProviderManager.testConnection → the
 * /api/providers/test edge route. The route already returns an actionable
 * diagnosis AND the round-trip latency even on failure; before Task 28 the
 * chain UI zeroed the latency and hid the message behind a hover-only title,
 * so users saw a bare "Unhealthy" with no way to act.
 *
 * This module is the pure mapping layer: raw test result → display state.
 * Classification mirrors the edge route's own error vocabulary (HTTP status
 * prefixes, "Rate-limited (HTTP 429) — provider is reachable and the API key
 * was accepted", ModelError, "Request timed out", etc.).
 */

export type ChainLinkState = "testing" | "healthy" | "rate-limited" | "unhealthy";

export type ChainFailureClass =
  | "auth"
  | "quota"
  | "model"
  | "timeout"
  | "network"
  | "server"
  | "other";

/** Raw per-link result as stored by handleTestChain (superset of the manager return). */
export interface ChainLinkTestResult {
  ok: boolean;
  latencyMs: number;
  /** Failure message from the provider / edge route — ProviderManager.testConnection returns this field name. */
  message?: string;
  /** Legacy field name used by the pre-Task-28 chainResults store; still accepted. */
  error?: string;
  /** Edge route sets this on HTTP 429 — provider reachable, key accepted. */
  rateLimited?: boolean;
  /** Explicit phase marker; replaces the old string-sentinel check. */
  phase?: "testing" | "done";
}

export interface ChainLinkDisplay {
  state: ChainLinkState;
  /** Round-trip latency — preserved for failures too (0 only if none was measured). */
  latencyMs: number;
  /** Short badge text: "Healthy" / "Rate-limited" / "Unhealthy" / "Checking…". */
  headline: string;
  /** Compact inline diagnosis (empty when healthy/testing): status · latency · hint · message excerpt. */
  detailLine: string;
  /** Complete provider message for tooltip / screen readers ("" when none). */
  fullMessage: string;
  /** Tailwind text color for the headline badge. */
  toneClass: string;
}

const TESTING_SENTINEL = "Testing...";

/** Token-based failure classification (order matters: auth before server, model before server). */
export function classifyChainFailure(message: string): ChainFailureClass {
  const m = message || "";
  if (/401|403|unauthorized|invalid.{0,12}(api.?key|key|token)|administrator role required/i.test(m)) return "auth";
  if (/429|rate.?limit|quota|usage.?limit|freeusagelimit/i.test(m)) return "quota";
  if (/model.{0,24}(not supported|not found|unknown|does not exist|invalid)|unknown model|modelerror|404/i.test(m)) return "model";
  if (/timed? ?out|abort/i.test(m)) return "timeout";
  if (/network|fetch|unreachable|cors|socket|dns|failed to connect/i.test(m)) return "network";
  if (/http ?5\d\d|500|502|503|504|525|bad gateway|service unavailable|internal server error|ssl/i.test(m)) return "server";
  return "other";
}

/** Actionable next-step hint per failure class. */
export function describeChainFailureClass(cls: ChainFailureClass): string {
  switch (cls) {
    case "auth":
      return "Key rejected — verify the API key and its permissions for this model.";
    case "quota":
      return "Provider reachable, key accepted — quota/rate window hit. Failover engages; retry after the window resets.";
    case "model":
      return "Model rejected by this provider — pick one from 'Fetch models'.";
    case "timeout":
      return "No answer inside the timeout window — reasoning models may need longer; retry once.";
    case "network":
      return "Endpoint unreachable from the app runtime — check the Base URL / provider status page.";
    case "server":
      return "Provider-side outage (5xx) — retry or let failover take over.";
    default:
      return "Unrecognized failure — see the full message for details.";
  }
}

/** Extract the first HTTP status token for the compact line (e.g. "HTTP 401"). */
function statusToken(message: string): string {
  const m = message.match(/HTTP ?(\d{3})/i);
  return m ? `HTTP ${m[1]}` : "";
}

export function truncateMessage(msg: string, max = 160): string {
  if (!msg) return "";
  if (msg.length <= max) return msg;
  return `${msg.slice(0, Math.max(0, max - 1))}…`;
}

/**
 * Raw test result → render contract. Never produces a bare "Unhealthy":
 * every non-healthy, non-testing state carries a non-empty detailLine.
 */
export function chainLinkDisplay(result: Partial<ChainLinkTestResult> | null | undefined): ChainLinkDisplay {
  if (
    !result ||
    result.phase === "testing" ||
    result.error === TESTING_SENTINEL ||
    result.message === TESTING_SENTINEL
  ) {
    return {
      state: "testing",
      latencyMs: 0,
      headline: "Checking…",
      detailLine: "",
      fullMessage: "",
      toneClass: "text-amber-500 animate-pulse font-medium",
    };
  }

  const ok = result.ok === true;
  const latencyMs = typeof result.latencyMs === "number" && Number.isFinite(result.latencyMs)
    ? Math.max(0, Math.round(result.latencyMs))
    : 0;
  const message = result.message ?? result.error ?? "";

  if (ok) {
    return {
      state: "healthy",
      latencyMs,
      headline: "Healthy",
      detailLine: "",
      fullMessage: message,
      toneClass: "text-emerald-500 font-bold",
    };
  }

  const cls = classifyChainFailure(message);
  const isRateLimited = result.rateLimited === true || cls === "quota";
  const hint = describeChainFailureClass(cls);
  const token = statusToken(message);
  const excerpt = truncateMessage(message);

  const parts = [
    token,
    latencyMs > 0 ? `${latencyMs}ms` : "",
    hint,
    excerpt && excerpt !== token ? excerpt : "",
  ].filter(Boolean);

  return {
    state: isRateLimited ? "rate-limited" : "unhealthy",
    latencyMs,
    headline: isRateLimited ? "Rate-limited" : "Unhealthy",
    detailLine: parts.join(" · "),
    fullMessage: message,
    toneClass: isRateLimited ? "text-amber-500 font-bold" : "text-red-500 font-bold",
  };
}
