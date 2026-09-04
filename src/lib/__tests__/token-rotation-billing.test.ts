import { describe, it, expect } from "vitest";
import { isBillingError, isRotatableAuthError } from "../token-rotation";

// Billing/entitlement failures must NEVER trigger silent token rotation:
// a fresh token on the same workspace hits the same billing wall, and the
// guest-endpoint rotation calls are CORS-blocked from the browser anyway.
const billing401 = {
  statusCode: 401,
  message: "API returned HTTP 401: Invalid API Key. Detail: CreditsError: No payment method. Add a payment method here: https://opencode.ai/workspace/wrk_01/billing",
};

describe("token rotation billing guard", () => {
  it("detects billing failures from the exact production shape", () => {
    expect(isBillingError(billing401)).toBe(true);
    expect(isBillingError({ message: "insufficient credits on this account" })).toBe(true);
    expect(isBillingError({ message: "quota exceeded for free tier" })).toBe(true);
    expect(isBillingError(null)).toBe(false);
  });

  it("refuses rotation for billing failures even with a 401 status", () => {
    expect(isRotatableAuthError(billing401)).toBe(false);
  });

  it("refuses rotation for entitlement opt-in errors", () => {
    expect(isRotatableAuthError({
      statusCode: 403,
      message: "API returned HTTP 403: DataPolicyError: This model collects data and requires explicit opt in",
    })).toBe(false);
  });

  it("still rotates genuine session/key failures", () => {
    expect(isRotatableAuthError({ statusCode: 401, message: "session expired, please re-login" })).toBe(true);
    expect(isRotatableAuthError({ message: "Invalid token provided" })).toBe(true);
    expect(isRotatableAuthError({ statusCode: 401, message: "Unauthorized" })).toBe(true);
    expect(isRotatableAuthError(null)).toBe(false);
  });
});
