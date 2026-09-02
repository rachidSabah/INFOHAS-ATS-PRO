// ============================================================================
// Antigravity adapter — Task 29 registration contract + HONEST probe semantics.
//
// Task 29 (2026-08-31): ProviderFactory must route "antigravity" to the
// dedicated adapter — never the silent custom fallback.
//
// CONTRACT CHANGE (2026-09-02, directive #48 + production evidence): the old
// "token presence is sufficient" CLI semantics reported ok:true with NO
// network call while every real browser request 404'd through
// cloudcode-pa.googleapis.com (dozens of 404s per optimization run in live
// console logs). testConnection now REQUIRES a real probe to answer before
// declaring the provider usable. No fabricated ONLINE state.
// ============================================================================

import { describe, it, expect, vi, beforeEach } from "vitest";
import { ProviderFactory } from "../services/factory";
import { antigravityAdapter } from "./antigravity-adapter";

const mockProvider = {
  isAuthenticated: vi.fn(),
  login: vi.fn(),
  restore: vi.fn(),
  generate: vi.fn(),
};

vi.mock("../../providers/antigravity-provider", () => ({
  getAntigravityProvider: () => mockProvider,
}));

const CLI_CONFIG = {
  id: "p_antigravity",
  name: "Antigravity CLI",
  type: "antigravity",
  apiKey: "ya29....en",
  modelName: "claude-sonnet-4",
  timeout: 30000,
  maxTokens: 4096,
  temperature: 0.7,
};

describe("Task 29: antigravity adapter registration", () => {
  it("ProviderFactory.get('antigravity') returns the dedicated antigravity adapter", () => {
    const adapter = ProviderFactory.get("antigravity");
    expect(adapter.type).toBe("antigravity");
  });

  it("the registered adapter IS the antigravity adapter module (same instance)", () => {
    expect(ProviderFactory.get("antigravity")).toBe(antigravityAdapter);
  });

  it("unknown provider types still fall back to the custom adapter (regression)", () => {
    expect(ProviderFactory.get("totally-unknown-type").type).toBe("custom");
  });
});

describe("Task 29 (UPDATED 2026-09-02): honest test-connection semantics", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("no auth anywhere → explicit auth guidance, not a fake network failure", async () => {
    mockProvider.isAuthenticated.mockReturnValue(false);
    mockProvider.restore.mockResolvedValue({ authenticated: false });
    const res = await antigravityAdapter.testConnection({ ...CLI_CONFIG, apiKey: "" } as any);
    expect(res.ok).toBe(false);
    expect(res.message.toLowerCase()).toMatch(/connect|token|sign/);
  });

  it("REFUSES to report ok on token presence alone — a REAL probe must answer (directive #48)", async () => {
    // Old contract: token present → ok:true with zero network calls. That
    // fabricated ONLINE while the endpoint 404'd on every real request.
    mockProvider.isAuthenticated.mockReturnValue(true);
    mockProvider.generate.mockRejectedValue(
      new Error("Antigravity proxy error 404: API returned HTTP 404: <!DOCTYPE html>")
    );
    const res = await antigravityAdapter.testConnection(CLI_CONFIG as any);
    expect(res.ok).toBe(false); // token alone is NO LONGER sufficient
    expect(mockProvider.generate).toHaveBeenCalledTimes(1); // probe was real
    expect(res.message).toContain("404");
  });

  it("reports ok:true only when the probe actually answers", async () => {
    mockProvider.isAuthenticated.mockReturnValue(true);
    mockProvider.generate.mockResolvedValue({ text: "OK", provider: "antigravity", latencyMs: 120 });
    const res = await antigravityAdapter.testConnection(CLI_CONFIG as any);
    expect(res.ok).toBe(true);
    expect(res.response).toBe("OK");
  });

  it("falls back to the configured token when the browser session is empty", async () => {
    mockProvider.isAuthenticated.mockReturnValueOnce(false).mockReturnValueOnce(true);
    mockProvider.login.mockResolvedValue(undefined);
    mockProvider.generate.mockResolvedValue({ text: "OK", provider: "antigravity", latencyMs: 90 });
    const res = await antigravityAdapter.testConnection(CLI_CONFIG as any);
    expect(mockProvider.login).toHaveBeenCalledWith(CLI_CONFIG.apiKey);
    expect(res.ok).toBe(true);
  });
});

describe("Task 29: chat fails fast without a token (never OpenAI-shaped REST)", () => {
  it("throws an auth error mentioning the CLI integration when unauthenticated", async () => {
    mockProvider.isAuthenticated.mockReturnValue(false);
    mockProvider.restore.mockResolvedValue({ authenticated: false });
    await expect(
      antigravityAdapter.chat(
        { messages: [{ role: "user", content: "hi" }], model: "claude-sonnet-4" },
        { ...CLI_CONFIG, apiKey: "" } as any
      )
    ).rejects.toMatchObject({ name: "ProviderAuthenticationError" });
  });
});
