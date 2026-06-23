// ResumeAI Pro — QA Provider Test Suite
// Tests all configured AI providers for reachability, response quality,
// and error conditions. Never swallows failures.
//
// Edge Runtime compatible — no Node.js APIs.

import type { ProviderTestResult, TestSeverity } from "./types";
import { EXPECTED_PROVIDERS } from "./types";

/**
 * Test a single provider by making a real API call through the CORS proxy.
 * Returns structured results — never throws silently.
 */
export async function testProvider(opts: {
  providerId: string;
  providerName: string;
  providerType: string;
  baseUrl?: string;
  apiKey?: string;
  model?: string;
  timeout?: number;
}): Promise<ProviderTestResult> {
  const start = performance.now();
  const result: ProviderTestResult = {
    providerId: opts.providerId,
    providerName: opts.providerName,
    providerType: opts.providerType,
    reachable: false,
    aiResponseReceived: false,
    responseLength: 0,
    responseTimeMs: 0,
    networkErrors: [],
    authErrors: [],
    rateLimitHit: false,
    passed: false,
    message: "Not tested",
  };

  try {
    const controller = new AbortController();
    const timeout = opts.timeout || 15000;
    const timeoutId = setTimeout(() => controller.abort(), timeout);

    // Test via /api/providers/test CORS proxy
    const response = await fetch("/api/providers/test", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      signal: controller.signal,
      body: JSON.stringify({
        providerId: opts.providerId,
        name: opts.providerName,
        type: opts.providerType,
        baseUrl: opts.baseUrl,
        apiKey: opts.apiKey,
        modelName: opts.model || "default",
      }),
    });

    clearTimeout(timeoutId);
    result.responseTimeMs = Math.round(performance.now() - start);

    if (!response.ok) {
      const errorText = await response.text().catch(() => "Unknown error");
      result.networkErrors.push(`HTTP ${response.status}: ${errorText}`);
      if (response.status === 401 || response.status === 403) {
        result.authErrors.push(`Authentication failed: HTTP ${response.status}`);
      }
      if (response.status === 429) {
        result.rateLimitHit = true;
      }
      result.reachable = response.status < 500;
      result.message = `Provider returned HTTP ${response.status}`;
      return result;
    }

    const data = await response.json().catch(() => null);
    if (!data) {
      result.networkErrors.push("Invalid JSON response from test endpoint");
      result.message = "Invalid JSON response";
      return result;
    }

    result.reachable = true;

    if (data.ok) {
      result.aiResponseReceived = true;
      result.responseLength = (data.response || "").length;
      result.passed = result.responseLength >= 500;
      result.message = result.passed
        ? `OK — ${result.responseLength} chars in ${result.responseTimeMs}ms`
        : `Response too short: ${result.responseLength} chars (min 500)`;
    } else {
      result.aiResponseReceived = false;
      result.message = data.message || "Provider test failed";
      if (data.message && /rate|429|quota|limit/i.test(data.message)) {
        result.rateLimitHit = true;
      }
      if (data.message && /auth|401|403|key/i.test(data.message)) {
        result.authErrors.push(data.message);
      }
    }
  } catch (err: unknown) {
    result.responseTimeMs = Math.round(performance.now() - start);
    const errorMsg = err instanceof Error ? err.message : String(err);
    result.networkErrors.push(errorMsg);
    if (errorMsg.includes("abort") || errorMsg.includes("timeout")) {
      result.message = `Timeout after ${opts.timeout || 15000}ms`;
    } else {
      result.message = `Network error: ${errorMsg}`;
    }
  }

  return result;
}

/**
 * Run provider tests for all configured providers in the store.
 * Returns results for each provider — never silently skips.
 */
export async function runProviderTests(
  providers: Array<{
    id: string;
    name: string;
    type: string;
    baseUrl?: string;
    apiKey?: string;
    modelName?: string;
    enabled?: boolean;
  }>
): Promise<ProviderTestResult[]> {
  const results: ProviderTestResult[] = [];

  // Test each provider that has an API key configured
  for (const p of providers) {
    if (!p.apiKey && p.type !== "puter") {
      results.push({
        providerId: p.id,
        providerName: p.name,
        providerType: p.type,
        reachable: false,
        aiResponseReceived: false,
        responseLength: 0,
        responseTimeMs: 0,
        networkErrors: ["No API key configured"],
        authErrors: [],
        rateLimitHit: false,
        passed: false,
        message: "No API key configured — cannot test",
      });
      continue;
    }

    // Puter is browser-auth — test differently
    if (p.type === "puter") {
      results.push({
        providerId: p.id,
        providerName: p.name,
        providerType: p.type,
        reachable: typeof window !== "undefined" && !!(window as any).puter,
        aiResponseReceived: false,
        responseLength: 0,
        responseTimeMs: 0,
        networkErrors: [],
        authErrors: [],
        rateLimitHit: false,
        passed: typeof window !== "undefined" && !!(window as any).puter,
        message: typeof window !== "undefined" && !!(window as any).puter
          ? "Puter.js loaded and available"
          : "Puter.js not loaded — browser-auth providers require client-side testing",
      });
      continue;
    }

    // Test API providers
    const result = await testProvider({
      providerId: p.id,
      providerName: p.name,
      providerType: p.type,
      baseUrl: p.baseUrl,
      apiKey: p.apiKey,
      model: p.modelName,
    });
    results.push(result);
  }

  return results;
}

/**
 * Validate provider configuration coverage.
 * Checks that all expected provider types are at least configured.
 */
export function validateProviderCoverage(
  configuredTypes: string[]
): { missing: string[]; coverage: number; passed: boolean } {
  const expected = [...EXPECTED_PROVIDERS];
  const missing = expected.filter((ep) => !configuredTypes.some((ct) => ct.toLowerCase().includes(ep)));
  const coverage = Math.round(((expected.length - missing.length) / expected.length) * 100);
  return {
    missing,
    coverage,
    passed: coverage >= 50, // At least half of providers should be configured
  };
}
