// ============================================================================
// Error classifier tests — the diagnostic brain must distinguish all 12
// failure kinds correctly (directive #1: classify BEFORE deciding what to do).
// ============================================================================

import { describe, it, expect } from "vitest";
import { classifyProviderFailure, chipForClassification } from "./error-classifier";

describe("classifyProviderFailure", () => {
  it("classifies rate limits as temporary + non-healable", () => {
    const c = classifyProviderFailure("API returned HTTP 429 Too Many Requests: FreeUsageLimitError: Rate limit exceeded. Please try again later.");
    expect(c.kind).toBe("rate_limited");
    expect(c.temporary).toBe(true);
    expect(c.healable).toBe(false);
  });

  it("classifies auth failures as manual-only", () => {
    const c = classifyProviderFailure("API returned HTTP 401 Unauthorized: Invalid API Key");
    expect(c.kind).toBe("auth_error");
    expect(c.temporary).toBe(false);
    expect(c.healable).toBe(false);
    expect(c.humanMessage).toMatch(/API key/i);
  });

  it("classifies model-not-found as a healable MODEL error (not endpoint)", () => {
    const c = classifyProviderFailure("API returned HTTP 404: invalid_request_error: The model `hy3-free` does not exist or you do not have access to it.");
    expect(c.kind).toBe("model_error");
    expect(c.healable).toBe(true);
  });

  it("classifies 'invalid model' 400 as a model error, not invalid_request", () => {
    const c = classifyProviderFailure("API returned HTTP 400: Invalid model: hy3-free");
    expect(c.kind).toBe("model_error");
    expect(c.healable).toBe(true);
  });

  it("detects API-version mismatch (Google v1main style)", () => {
    const c = classifyProviderFailure(`API returned HTTP 404: [{"error":{"code":404,"message":"models/hy3-free is not found for API version v1main, or is not supported for gener..."}}]`);
    expect(c.kind).toBe("api_version_error");
    expect(c.apiVersionMismatch).toBe(true);
    expect(c.healable).toBe(true);
  });

  it("classifies a bare 404 page as an ENDPOINT error", () => {
    const c = classifyProviderFailure("API returned HTTP 404: 404 page not found\n");
    expect(c.kind).toBe("endpoint_error");
    expect(c.healable).toBe(true);
  });

  it("classifies 5xx as temporary provider unavailability", () => {
    const c = classifyProviderFailure("API returned HTTP 503 Service Unavailable: overloaded", { statusCode: 503 });
    expect(c.kind).toBe("provider_unavailable");
    expect(c.temporary).toBe(true);
  });

  it("classifies network failures as temporary", () => {
    const c = classifyProviderFailure("fetch failed: ECONNRESET");
    expect(c.kind).toBe("network_error");
    expect(c.temporary).toBe(true);
  });

  it("classifies context overflow separately from provider faults", () => {
    const c = classifyProviderFailure("This model's maximum context length is 8192 tokens");
    expect(c.kind).toBe("context_overflow");
    expect(c.healable).toBe(false);
  });

  it("never hides the technical detail (directive #12)", () => {
    const raw = "API returned HTTP 404: The model `hy3-free` does not exist";
    const c = classifyProviderFailure(raw);
    expect(c.technical).toContain("hy3-free");
    expect(c.humanMessage).not.toBe(raw); // human layer is a diagnosis, not an echo
  });

  it("maps kinds to UI chips", () => {
    expect(chipForClassification(classifyProviderFailure("429 rate limit"))).toBe("COOLDOWN");
    expect(chipForClassification(classifyProviderFailure("401 invalid api key"))).toBe("AUTH ERROR");
    expect(chipForClassification(classifyProviderFailure("model not found"))).toBe("MODEL ERROR");
    expect(chipForClassification(classifyProviderFailure("404 page not found"))).toBe("ENDPOINT ERROR");
  });
});
