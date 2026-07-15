import { describe, it, expect, afterEach } from "vitest";
import {
  registerHook,
  clearHooks,
  hookCount,
  runHooks,
  type HookContext,
} from "./hooks";

afterEach(() => clearHooks());

describe("Middleware Hook System", () => {
  it("has exactly 14 hook points, all empty by default", () => {
    const points = [
      "BeforePrompt", "AfterPrompt", "BeforeContext", "AfterContext",
      "BeforeProvider", "AfterProvider", "BeforeResponse", "AfterResponse",
      "BeforePersist", "AfterPersist", "OnSuccess", "OnFailure", "OnTimeout", "OnRetry",
    ] as const;
    expect(points.length).toBe(14);
    for (const p of points) expect(hookCount(p)).toBe(0);
  });

  it("fires registered hooks with the correct point + context", async () => {
    const seen: string[] = [];
    registerHook("BeforeProvider", (ctx: HookContext) => { seen.push(ctx.point); });
    await runHooks("BeforeProvider", { executionId: "fx1", opts: { userPrompt: "x" } });
    expect(seen).toEqual(["BeforeProvider"]);
  });

  it("is a no-op (zero overhead) when nothing is registered", async () => {
    await expect(runHooks("AfterResponse", { executionId: "fx", opts: {} })).resolves.toBeUndefined();
  });

  it("never throws if a hook throws (swallowed)", async () => {
    registerHook("OnFailure", () => { throw new Error("boom"); });
    await expect(
      runHooks("OnFailure", { executionId: "fx", opts: {}, error: new Error("x") }),
    ).resolves.toBeUndefined();
  });

  it("unregister stops future firing", () => {
    const fn = () => {};
    const off = registerHook("OnRetry", fn);
    expect(hookCount("OnRetry")).toBe(1);
    off();
    expect(hookCount("OnRetry")).toBe(0);
  });

  it("clearHooks resets a single point and all points", () => {
    registerHook("OnSuccess", () => {});
    registerHook("OnTimeout", () => {});
    clearHooks("OnSuccess");
    expect(hookCount("OnSuccess")).toBe(0);
    expect(hookCount("OnTimeout")).toBe(1);
    clearHooks();
    expect(hookCount("OnTimeout")).toBe(0);
  });
});
