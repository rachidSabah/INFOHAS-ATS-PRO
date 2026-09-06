// ============================================================================
// TESTS — Puter live-catalog model-id normalization (prefetch fix)
//
// api.puter.com/puterai/chat/models returns ~900 vendor-prefixed ids:
//   "openai:openai/gpt-4o", "openrouter:meta-llama/llama-3.3-70b-instruct", …
// The puter.js chat SDK (and every static list in this repo) uses plain ids.
// normalizePuterModelId collapses FIRST-PARTY vendor+org duplication into the
// doc-verified plain id and keeps third-party orgs intact.
// ============================================================================

import { describe, it, expect, vi } from "vitest";

vi.mock("../../store", () => ({
  useApp: { getState: () => ({ providers: [], providerSettings: {} }) },
  uid: () => "x",
}));

import { normalizePuterModelId } from "./manager";

describe("normalizePuterModelId", () => {
  it("collapses first-party vendor:org/ prefixes to the plain doc-verified id", () => {
    expect(normalizePuterModelId("openai:openai/gpt-4o")).toBe("gpt-4o");
    expect(normalizePuterModelId("anthropic:anthropic/claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    expect(normalizePuterModelId("google:google/gemini-2.5-flash")).toBe("gemini-2.5-flash");
    expect(normalizePuterModelId("deepseek:deepseek/deepseek-chat")).toBe("deepseek-chat");
    expect(normalizePuterModelId("mistralai:mistralai/mistral-large-2512")).toBe("mistral-large-2512");
  });

  it("keeps third-party org ids intact (different upstream route)", () => {
    expect(normalizePuterModelId("openrouter:meta-llama/llama-3.3-70b-instruct")).toBe(
      "meta-llama/llama-3.3-70b-instruct"
    );
    expect(normalizePuterModelId("infron:deepseek/deepseek-chat")).toBe("deepseek/deepseek-chat");
    expect(normalizePuterModelId("azure:x-ai/grok-4-1-fast-reasoning")).toBe("x-ai/grok-4-1-fast-reasoning");
  });

  it("passes plain ids through unchanged", () => {
    expect(normalizePuterModelId("gpt-5-nano")).toBe("gpt-5-nano");
    expect(normalizePuterModelId("claude-sonnet-4-5")).toBe("claude-sonnet-4-5");
    expect(normalizePuterModelId("reka/reka-edge")).toBe("reka/reka-edge");
  });

  it("handles ids with multiple colons (org may contain none, but be safe)", () => {
    // vendor prefix strips at the FIRST colon only
    expect(normalizePuterModelId("openai:openai/o3-mini")).toBe("o3-mini");
  });

  it("rejects non-strings and empties", () => {
    expect(normalizePuterModelId(null)).toBeNull();
    expect(normalizePuterModelId(undefined)).toBeNull();
    expect(normalizePuterModelId(42)).toBeNull();
    expect(normalizePuterModelId("")).toBeNull();
    expect(normalizePuterModelId("   ")).toBeNull();
  });
});
