/**
 * Task 28 — Routing Chain Diagnostics must show WHY a link failed.
 *
 * Live evidence (2026-08-31 user report): "Test Entire Chain" rendered a bare
 * red "Unhealthy" for the Google primary and the NVIDIA NIM fallback while
 * Puter.js showed "Healthy (1468ms)". The actual per-link diagnosis existed —
 * the /api/providers/test edge route returns an actionable message AND the
 * round-trip latency even on failure (HTTP 401 invalid key vs HTTP 429
 * quota-exhausted vs model-not-supported vs timeout, each with provider
 * detail) — but AIProviderSettings.handleTestChain threw both away:
 *
 *   { ok: res.ok, latencyMs: res.ok ? res.latencyMs : 0, error: res.ok ? undefined : res.message }
 *   → render: <span title={error}>Unhealthy</span>   // reason hover-only, latency zeroed
 *
 * Contract (pure module, mirrors the Task 25 diagnosis-fidelity doctrine):
 *  1. Failure latency is PRESERVED, never zeroed.
 *  2. Every failure classifies into an actionable class (auth / quota / model
 *     / timeout / network / server / other) with a short next-action hint.
 *  3. HTTP 429 is its own amber "Rate-limited" state — the edge route already
 *     established that semantics: 429 means the provider is reachable and the
 *     key was ACCEPTED; failover engages; it is not a dead link.
 *  4. The compact inline line carries status token + latency + hint; the full
 *     provider message stays available for the tooltip / screen readers.
 */

import { describe, it, expect } from "vitest";
import {
  classifyChainFailure,
  chainLinkDisplay,
  describeChainFailureClass,
  truncateMessage,
  type ChainLinkTestResult,
} from "./routing-chain-diagnostics";

describe("classifyChainFailure (edge-route message vocabulary)", () => {
  it("classifies invalid-key / 401 / unauthorized messages as auth", () => {
    expect(classifyChainFailure("API returned HTTP 401 Unauthorized: Invalid API Key. Please verify that your API key is correct...")).toBe("auth");
    expect(classifyChainFailure("Unauthorized: administrator role required")).toBe("auth");
  });

  it("classifies 429 / quota / rate-limit messages as quota", () => {
    expect(classifyChainFailure("Rate-limited (HTTP 429) — provider is reachable and the API key was accepted...")).toBe("quota");
    expect(classifyChainFailure("Error 1000: FreeUsageLimitError — monthly usage limit reached")).toBe("quota");
  });

  it("classifies model-rejection messages as model", () => {
    expect(classifyChainFailure("Model not supported by provider. ModelError: Model X is not supported")).toBe("model");
    expect(classifyChainFailure("API returned HTTP 404 Not Found: model gemini-x does not exist")).toBe("model");
  });

  it("classifies timeout/abort messages as timeout", () => {
    expect(classifyChainFailure("Request timed out — the API took too long to respond.")).toBe("timeout");
  });

  it("classifies network-level failures as network", () => {
    expect(classifyChainFailure("Network error — the API URL may be unreachable or blocking requests.")).toBe("network");
  });

  it("classifies 5xx provider outages as server", () => {
    expect(classifyChainFailure("API returned HTTP 503 Service Unavailable: upstream overloaded")).toBe("server");
    expect(classifyChainFailure("HTTP 525 (SSL Handshake Failed) — the provider's API server has a TLS/SSL issue.")).toBe("server");
  });

  it("falls back to other for unrecognized messages", () => {
    expect(classifyChainFailure("something completely unexpected")).toBe("other");
  });
});

describe("describeChainFailureClass (actionable next-step hints)", () => {
  it("maps every class to a non-empty hint", () => {
    for (const cls of ["auth", "quota", "model", "timeout", "network", "server", "other"] as const) {
      expect(describeChainFailureClass(cls).length, cls).toBeGreaterThan(10);
    }
  });

  it("quota hint states the established 429 semantics (reachable, key accepted)", () => {
    expect(describeChainFailureClass("quota").toLowerCase()).toContain("reachable");
  });
});

describe("chainLinkDisplay (the render contract)", () => {
  it("healthy result: state healthy, latency preserved, no detail line", () => {
    const d = chainLinkDisplay({ ok: true, latencyMs: 1468, message: "OK — gpt-5.4-nano" });
    expect(d.state).toBe("healthy");
    expect(d.latencyMs).toBe(1468);
    expect(d.detailLine).toBe("");
  });

  it("unhealthy result: failure latency is PRESERVED (was zeroed before Task 28)", () => {
    const d = chainLinkDisplay({ ok: false, latencyMs: 812, message: "API returned HTTP 401 Unauthorized: Invalid API Key" });
    expect(d.state).toBe("unhealthy");
    expect(d.latencyMs).toBe(812);
  });

  it("429 failure with rateLimited flag: amber rate-limited state, not unhealthy", () => {
    const d = chainLinkDisplay({ ok: false, latencyMs: 640, rateLimited: true, message: "Rate-limited (HTTP 429) — reachable, key accepted..." });
    expect(d.state).toBe("rate-limited");
    expect(d.headline).toMatch(/rate-limited/i);
  });

  it("429-classified message counts as rate-limited even without the flag", () => {
    const d = chainLinkDisplay({ ok: false, latencyMs: 640, message: "Rate-limited (HTTP 429) — provider is reachable" });
    expect(d.state).toBe("rate-limited");
  });

  it("unhealthy inline detail carries the HTTP status token, latency and hint", () => {
    const d = chainLinkDisplay({ ok: false, latencyMs: 812, message: "API returned HTTP 401 Unauthorized: Invalid API Key. Detail: bad key" });
    expect(d.detailLine).toContain("401");
    expect(d.detailLine).toContain("812ms");
    expect(d.detailLine.toLowerCase()).toContain("key");
  });

  it("full provider message is preserved for tooltip / screen readers", () => {
    const msg = "API returned HTTP 401 Unauthorized: Invalid API Key. Please verify that your API key is correct and has the necessary permissions. Detail: API key not valid";
    const d = chainLinkDisplay({ ok: false, latencyMs: 812, message: msg });
    expect(d.fullMessage).toBe(msg);
  });

  it("testing phase renders the checking state", () => {
    const d = chainLinkDisplay({ ok: false, latencyMs: 0, phase: "testing" });
    expect(d.state).toBe("testing");
  });

  it("missing/empty message still renders a diagnosis (never a bare Unhealthy)", () => {
    const d = chainLinkDisplay({ ok: false, latencyMs: 0 });
    expect(d.detailLine.length).toBeGreaterThan(0);
  });
});

describe("truncateMessage", () => {
  it("keeps short messages intact", () => {
    expect(truncateMessage("short", 160)).toBe("short");
  });

  it("truncates long messages with an ellipsis inside the cap", () => {
    const long = "x".repeat(400);
    const out = truncateMessage(long, 160);
    expect(out.length).toBeLessThanOrEqual(160);
    expect(out.endsWith("…")).toBe(true);
  });
});

describe("regression guard: the exact user-reported pair", () => {
  it("Google primary (whatever the real error) and NVIDIA fallback both produce actionable lines, Puter stays healthy", () => {
    const google = chainLinkDisplay({ ok: false, latencyMs: 903, message: "API returned HTTP 400 Bad Request: Unknown name 'gemini-flash-lite-latest'" } as ChainLinkTestResult);
    expect(google.state).toBe("unhealthy");
    expect(google.detailLine).toContain("903ms");

    const nvidia = chainLinkDisplay({ ok: false, latencyMs: 1204, rateLimited: true, message: "Rate-limited (HTTP 429) — provider is reachable and the API key was accepted" } as ChainLinkTestResult);
    expect(nvidia.state).toBe("rate-limited");

    const puter = chainLinkDisplay({ ok: true, latencyMs: 1468, message: "OK — gpt-5.4-nano" });
    expect(puter.state).toBe("healthy");
    expect(puter.headline).toBe("Healthy");
  });
});
