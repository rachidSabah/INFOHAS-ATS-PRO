// ============================================================================
// ProviderRouter.perAttemptTimeoutMs — per-attempt failover slice tests.
//
// Regression tests for the Step-5 "always failing at ~50%" bug: the router
// used to hard-cap EVERY provider attempt at 25s whenever the fallback chain
// had 2+ providers — including calls that explicitly budgeted more time
// (the optimizer's 120s OPTIMIZER_CALL_TIMEOUT_MS). A full resume rewrite
// generates for 60–120s, so every healthy attempt died mid-generation with
// "timed out after 25s" and Step 5 could never complete.
//
// Contract:
//   - single-provider chain  → full remaining budget
//   - default budget, 2+ providers → 25s failover slice (unchanged behavior)
//   - explicit LONG budget (timeoutMs > AI_CALL_TIMEOUT_MS), 2+ providers →
//     full remaining budget (the fix)
//   - never exceeds the remaining budget; never negative
// ============================================================================

import { describe, it, expect } from "vitest";
import { ProviderRouter } from "./router";
import { AI_CALL_TIMEOUT_MS, OPTIMIZER_CALL_TIMEOUT_MS, PIPELINE_STEP_CALL_TIMEOUT_MS } from "../../pipeline-watchdog";

describe("ProviderRouter.perAttemptTimeoutMs — per-attempt failover slice", () => {
  it("caps each attempt at 25s for the default 60s budget with 2+ providers", () => {
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 0, 2)).toBe(25000);
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 0, 3)).toBe(25000);
  });

  it("gives the full remaining budget when only one provider is chained", () => {
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 0, 1)).toBe(AI_CALL_TIMEOUT_MS);
    expect(ProviderRouter.perAttemptTimeoutMs(OPTIMIZER_CALL_TIMEOUT_MS, 0, 1)).toBe(OPTIMIZER_CALL_TIMEOUT_MS);
  });

  it("scales with an explicit long optimizer budget (120s) even with 2+ providers — the Step 5 fix", () => {
    expect(
      ProviderRouter.perAttemptTimeoutMs(OPTIMIZER_CALL_TIMEOUT_MS, 0, 2, OPTIMIZER_CALL_TIMEOUT_MS)
    ).toBe(OPTIMIZER_CALL_TIMEOUT_MS);
  });

  it("scales with the explicit pipeline-step budget (90s)", () => {
    expect(
      ProviderRouter.perAttemptTimeoutMs(PIPELINE_STEP_CALL_TIMEOUT_MS, 0, 2, PIPELINE_STEP_CALL_TIMEOUT_MS)
    ).toBe(PIPELINE_STEP_CALL_TIMEOUT_MS);
  });

  it("explicit budget at or below the default keeps the 25s failover slice", () => {
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 0, 3, AI_CALL_TIMEOUT_MS)).toBe(25000);
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 0, 3, 30000)).toBe(25000);
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 0, 3, undefined)).toBe(25000);
  });

  it("never returns more than the remaining budget", () => {
    expect(
      ProviderRouter.perAttemptTimeoutMs(OPTIMIZER_CALL_TIMEOUT_MS, 100_000, 2, OPTIMIZER_CALL_TIMEOUT_MS)
    ).toBe(20_000);
    expect(ProviderRouter.perAttemptTimeoutMs(AI_CALL_TIMEOUT_MS, 70_000, 2)).toBe(0);
  });

  it("clamps negative remaining budgets to zero", () => {
    expect(ProviderRouter.perAttemptTimeoutMs(60_000, 120_000, 2, 120_000)).toBe(0);
    expect(ProviderRouter.perAttemptTimeoutMs(60_000, 120_000, 1)).toBe(0);
  });
});
