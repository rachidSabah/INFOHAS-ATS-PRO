/**
 * Task 29 — Antigravity CLI must route through the Antigravity CLI adapter.
 *
 * Audit finding (2026-08-31): ProviderFactory's REGISTRY had NO "antigravity"
 * key, so ProviderFactory.get("antigravity") silently fell back to the custom
 * adapter — runtime routing, benchmark pings and health probes for the
 * Antigravity CLI provider never touched the Antigravity integration stack
 * (src/lib/providers/antigravity-*), even though a complete one exists.
 *
 * Contract:
 *  1. ProviderFactory.get("antigravity") returns the dedicated adapter
 *     (type "antigravity") — no more silent custom fallback.
 *  2. testConnection uses CLI semantics: token presence in config.apiKey is
 *     sufficient (matches the edge-route's synthetic cloudcode-pa behavior —
 *     inference is handled by the CLI runtime, not a REST probe). It must NOT
 *     declare the provider dead because a REST endpoint 404s.
 *  3. chat() without a token fails fast with an auth error — it must never
 *     fall through to an OpenAI-shaped REST call against cloudcode-pa.
 *  4. Unknown types keep falling back to the custom adapter (regression).
 */

import { describe, it, expect } from "vitest";
import { ProviderFactory } from "../services/factory";
import { antigravityAdapter } from "./antigravity-adapter";

const CLI_CONFIG = {
  id: "p_antigravity",
  name: "Antigravity CLI",
  type: "antigravity",
  apiKey: "ya29.test-token",
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

describe("Task 29: CLI test-connection semantics", () => {
  it("token present in config.apiKey → ok (CLI runtime handles inference)", async () => {
    const res = await antigravityAdapter.testConnection(CLI_CONFIG as any);
    expect(res.ok).toBe(true);
    expect(res.message.toLowerCase()).toContain("cli");
  });

  it("no token → explicit auth guidance, not a fake network failure", async () => {
    const res = await antigravityAdapter.testConnection({ ...CLI_CONFIG, apiKey: "" } as any);
    expect(res.ok).toBe(false);
    expect(res.message.toLowerCase()).toMatch(/connect|token|sign/);
  });
});

describe("Task 29: chat fails fast without a token (never OpenAI-shaped REST)", () => {
  it("throws an auth error mentioning the CLI integration when unauthenticated", async () => {
    await expect(
      antigravityAdapter.chat(
        { messages: [{ role: "user", content: "hi" }], model: "claude-sonnet-4" },
        { ...CLI_CONFIG, apiKey: "" } as any
      )
    ).rejects.toMatchObject({ name: "ProviderAuthenticationError" });
  });
});
