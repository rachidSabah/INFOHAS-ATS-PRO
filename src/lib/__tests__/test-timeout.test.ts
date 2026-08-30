// ============================================================================
// RED TEST — Task 24①: reasoning-aware test-connection timeouts.
//
// Live evidence (2026-08-30 audit): Zen reasoning-route free models answer in
// 8-33s (nemotron-3-ultra-free: 200 OK at 8.1s / 21s / 33s across probes),
// but every test-connection layer capped at 10-15s (adapter 10s, manager
// proxy body 15s, edge route 15s hard cap, direct client probe 10s). A
// VERIFIED-WORKING provider was therefore declared "down" whenever its
// default model happened to be a reasoning model — the "OpenCode Zen is
// down" false alarm.
//
// Fix contract: model names that indicate a reasoning/thinking route get the
// provider's own generous timeout (floored at 30s, capped at 60s); fast
// models keep today's snappy caps exactly.
// ============================================================================

import { describe, it, expect } from "vitest";
import { isReasoningModelName, resolveTestTimeoutMs } from "../ai/test-timeout";

describe("isReasoningModelName", () => {
  it("detects reasoning-route models by name tokens", () => {
    // The exact production case: p_opencode default model.
    expect(isReasoningModelName("nemotron-3-ultra-free")).toBe(true);
    expect(isReasoningModelName("deepseek-r1")).toBe(true);
    expect(isReasoningModelName("o3-mini")).toBe(true);
    expect(isReasoningModelName("qwen-qwq-32b")).toBe(true);
    expect(isReasoningModelName("model-with-thinking-route")).toBe(true);
  });

  it("does not flag fast models or substring false positives", () => {
    expect(isReasoningModelName("nemotron-3.5-lightning-free")).toBe(false);
    expect(isReasoningModelName("deepseek-v4-flash-free")).toBe(false);
    expect(isReasoningModelName("mimo-v2.5-free")).toBe(false);
    expect(isReasoningModelName("gpt-4o")).toBe(false); // "4o" is not "o4"/"o1"
    expect(isReasoningModelName("gpt-4o-mini")).toBe(false);
    expect(isReasoningModelName("claude-3-opus")).toBe(false);
    expect(isReasoningModelName(undefined)).toBe(false);
    expect(isReasoningModelName("")).toBe(false);
  });
});

describe("resolveTestTimeoutMs", () => {
  it("gives reasoning models the provider's generous timeout — the p_opencode fix", () => {
    // THE BUG: provider.timeout = 60000 but every layer clamped to 10-15s,
    // while nemotron-3-ultra-free answers at 8-33s → false "down".
    expect(
      resolveTestTimeoutMs({ modelName: "nemotron-3-ultra-free", providerTimeoutMs: 60000 })
    ).toBe(60000);
  });

  it("defaults reasoning models to 60s when the provider has no timeout", () => {
    expect(resolveTestTimeoutMs({ modelName: "deepseek-r1", providerTimeoutMs: null })).toBe(60000);
    expect(resolveTestTimeoutMs({ modelName: "o3-mini" })).toBe(60000);
  });

  it("floors reasoning models at 30s even when the provider timeout is tiny", () => {
    expect(
      resolveTestTimeoutMs({ modelName: "nemotron-3-ultra-free", providerTimeoutMs: 8000 })
    ).toBe(30000);
  });

  it("respects the reasoning ceiling", () => {
    expect(
      resolveTestTimeoutMs({ modelName: "deepseek-r1", providerTimeoutMs: 120000 })
    ).toBe(60000);
    expect(
      resolveTestTimeoutMs({ modelName: "deepseek-r1", providerTimeoutMs: 120000, reasoningCapMs: 90000 })
    ).toBe(90000);
  });

  it("keeps fast models on today's caps exactly (no behavior change)", () => {
    // Manager proxy body today: Math.min(provider.timeout || 30000, 15000).
    expect(
      resolveTestTimeoutMs({ modelName: "nemotron-3.5-lightning-free", providerTimeoutMs: 60000 })
    ).toBe(15000);
    expect(resolveTestTimeoutMs({ modelName: "gpt-4o", providerTimeoutMs: 30000 })).toBe(15000);
    expect(resolveTestTimeoutMs({ modelName: "gpt-4o", providerTimeoutMs: 8000 })).toBe(8000);
    expect(resolveTestTimeoutMs({ modelName: "gpt-4o" })).toBe(15000);
  });

  it("supports a tighter fast cap (adapter/direct-probe sites keep their 10s)", () => {
    expect(
      resolveTestTimeoutMs({ modelName: "gpt-4o", providerTimeoutMs: 60000, fastCapMs: 10000 })
    ).toBe(10000);
    // Reasoning is unaffected by the fast cap.
    expect(
      resolveTestTimeoutMs({ modelName: "nemotron-3-ultra-free", providerTimeoutMs: 60000, fastCapMs: 10000 })
    ).toBe(60000);
  });
});
