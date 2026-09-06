// ============================================================================
// REGRESSION TESTS — "Step 5 (Resume Optimization) always failed at ~50%"
//
// Two independent root causes, both fixed in the router:
//
// 1. SILENT 30s CAP (withAttemptDeadline): adapters abort fetches with
//    `req.signal ?? AbortSignal.timeout(config.timeout)`. The router's
//    withTimeout() is only a Promise.race and never aborts the request, so
//    when callers passed no signal the PROVIDER-ROW timeout (p_mistral =
//    30 000 ms) killed every optimizer attempt mid-generation while the
//    router believed it had granted the full 120s budget.
//
// 2. SILENTLY DISCARDED AGENT ROUTE (selectProviderForAgent): production
//    sets agentRoutes.optimizer = "p_puter", but the routed provider was
//    checked with isAvailableForSelection WITHOUT an emergency exemption —
//    Puter (emergency-only) was rejected and the optimizer fell through to
//    priority order: dead opencode-zen (prio 3) first, 30s-capped mistral
//    second. The user's explicit route never ran.
// ============================================================================

import { describe, it, expect, vi } from "vitest";
import { withAttemptDeadline, isAvailableForSelection } from "./router";

describe("withAttemptDeadline — router-owned attempt deadline", () => {
  it("injects BOTH a deadline AbortSignal and a timeoutMs hint when the caller passed none", () => {
    const req = { messages: [{ role: "user" as const, content: "hi" }] };
    const out = withAttemptDeadline(req as any, 120_000);
    expect(out.signal).toBeInstanceOf(AbortSignal);
    expect(out.timeoutMs).toBe(120_000);
    // The original request object is not mutated.
    expect((req as any).signal).toBeUndefined();
    expect((req as any).timeoutMs).toBeUndefined();
  });

  it("NEVER overrides a caller-provided signal (UI abort buttons keep working)", () => {
    const controller = new AbortController();
    const req = { messages: [], signal: controller.signal };
    const out = withAttemptDeadline(req as any, 120_000);
    expect(out.signal).toBe(controller.signal);
    expect(out.timeoutMs).toBe(120_000); // hint still propagates to the proxy
  });

  it("never overrides an explicit caller timeoutMs hint", () => {
    const req = { messages: [], timeoutMs: 90_000 };
    const out = withAttemptDeadline(req as any, 120_000);
    expect(out.timeoutMs).toBe(90_000);
  });

  it("keeps the injected signal independent per attempt (not a shared timer)", () => {
    const a = withAttemptDeadline({ messages: [] } as any, 1_000);
    const b = withAttemptDeadline({ messages: [] } as any, 1_000);
    expect(a.signal).not.toBe(b.signal);
  });
});

// ============================================================================
// isAvailableForSelection — emergency-only exemption for explicit routes
// ============================================================================

describe("isAvailableForSelection allowEmergency", () => {
  const puter = { id: "p_puter", name: "Puter", type: "puter", isActive: true, priority: 1 };

  it("still EXCLUDES emergency-only providers by default (no behavior change)", () => {
    expect(isAvailableForSelection(puter)).toBe(false);
    expect(isAvailableForSelection(puter, [])).toBe(false);
  });

  it("ALLOWS emergency-only providers with { allowEmergency: true } (explicit routes / rescue)", () => {
    expect(isAvailableForSelection(puter, [], { allowEmergency: true })).toBe(true);
  });

  it("allowEmergency does not admit inactive or local providers", () => {
    expect(isAvailableForSelection({ ...puter, isActive: false }, [], { allowEmergency: true })).toBe(false);
    expect(isAvailableForSelection({ id: "x", name: "X", type: "local", isActive: true }, [], { allowEmergency: true })).toBe(false);
  });
});
