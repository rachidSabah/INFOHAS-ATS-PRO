// Regression test for the `cloudApiSafe is not defined` runtime crash.
// Before this fix, the store.ts called `cloudApiSafe(createResume)(r)` but
// `cloudApiSafe` was never imported and `createResume` was never destructured
// from `cloudApi`. The result was a synchronous ReferenceError that crashed
// the page whenever a user uploaded a PDF, created a JD, etc.

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { api, cloudApiSafe } from "./cloud-api";

describe("cloudApiSafe", () => {
  let originalConsoleWarn: typeof console.warn;

  beforeEach(() => {
    originalConsoleWarn = console.warn;
    console.warn = vi.fn();
  });

  afterEach(() => {
    console.warn = originalConsoleWarn;
    vi.restoreAllMocks();
  });

  it("is a function exported from cloud-api", () => {
    expect(typeof cloudApiSafe).toBe("function");
  });

  it("wraps a real async function and forwards its resolution", async () => {
    const fake = vi.fn(async (x: number) => x * 2);
    const wrapped = cloudApiSafe(fake);
    expect(typeof wrapped).toBe("function");
    const result = await wrapped(21);
    expect(result).toBe(42);
    expect(fake).toHaveBeenCalledWith(21);
  });

  it("swallows errors from the wrapped function and resolves to undefined", async () => {
    const failing = vi.fn(async () => {
      throw new Error("network down");
    });
    const wrapped = cloudApiSafe(failing);
    // Must NOT throw — that's the whole point of the wrapper.
    const result = await wrapped();
    expect(result).toBeUndefined();
  });

  it("returns a no-op async function when the input is undefined", async () => {
    const wrapped = cloudApiSafe(undefined as any);
    expect(typeof wrapped).toBe("function");
    const result = await wrapped("any", "args", "ok");
    expect(result).toBeUndefined();
  });

  it("returns a no-op async function when the input is null", async () => {
    const wrapped = cloudApiSafe(null as any);
    const result = await wrapped();
    expect(result).toBeUndefined();
  });

  it("never throws synchronously even if the function throws synchronously", () => {
    const syncThrow = (() => {
      throw new Error("boom");
    }) as unknown as (...args: any[]) => Promise<any>;
    const wrapped = cloudApiSafe(syncThrow);
    // Calling should NOT throw synchronously.
    expect(() => wrapped()).not.toThrow();
  });

  it("all api.* methods are real functions (so cloudApiSafe can wrap them)", () => {
    // These are exactly the methods store.ts destructures and passes to cloudApiSafe.
    // If any is missing, the store would crash at runtime.
    const required = [
      "createResume", "updateResume", "deleteResume",
      "createJobDescription", "deleteJobDescription",
      "createCoverLetter", "updateCoverLetter", "deleteCoverLetter",
      "createInterview", "deleteInterview",
      "createATSReport",
      "createProvider", "updateProvider", "deleteProvider",
      "createPrompt", "updatePrompt", "deletePrompt",
      "updateBranding", "updateFlag", "createAuditLog",
    ] as const;

    for (const name of required) {
      expect(typeof (api as any)[name], `api.${name} must be a function`).toBe("function");
      // cloudApiSafe must accept it without throwing.
      const wrapped = cloudApiSafe((api as any)[name]);
      expect(typeof wrapped).toBe("function");
    }
  });
});
