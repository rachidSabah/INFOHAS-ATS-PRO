import { describe, it, expect } from "vitest";
import { validateRealEmail, REAL_EMAIL_PROVIDERS } from "@/lib/email-validation";

describe("validateRealEmail", () => {
  it("accepts real Gmail addresses", () => {
    expect(validateRealEmail("user@gmail.com").valid).toBe(true);
    expect(validateRealEmail("relsabah@gmail.com").valid).toBe(true);
  });

  it("accepts real Outlook addresses", () => {
    expect(validateRealEmail("user@outlook.com").valid).toBe(true);
    expect(validateRealEmail("user@hotmail.com").valid).toBe(true);
  });

  it("accepts real Yahoo, iCloud, Proton addresses", () => {
    expect(validateRealEmail("user@yahoo.com").valid).toBe(true);
    expect(validateRealEmail("user@icloud.com").valid).toBe(true);
    expect(validateRealEmail("user@proton.me").valid).toBe(true);
  });

  it("rejects @example.com / @example.org / @example.net", () => {
    const r1 = validateRealEmail("test@example.com");
    expect(r1.valid).toBe(false);
    expect(r1.error).toContain("example");

    expect(validateRealEmail("test@example.org").valid).toBe(false);
    expect(validateRealEmail("test@example.net").valid).toBe(false);
    expect(validateRealEmail("test@sub.example.com").valid).toBe(false);
  });

  it("rejects @example.* TLD", () => {
    expect(validateRealEmail("test@mydomain.example").valid).toBe(false);
  });

  it("rejects .test, .invalid, .localhost TLDs", () => {
    expect(validateRealEmail("test@mydomain.test").valid).toBe(false);
    expect(validateRealEmail("test@mydomain.invalid").valid).toBe(false);
    expect(validateRealEmail("test@mydomain.localhost").valid).toBe(false);
  });

  it("rejects disposable email services", () => {
    expect(validateRealEmail("user@mailinator.com").valid).toBe(false);
    expect(validateRealEmail("user@guerrillamail.com").valid).toBe(false);
    expect(validateRealEmail("user@10minutemail.com").valid).toBe(false);
    expect(validateRealEmail("user@tempmail.com").valid).toBe(false);
    expect(validateRealEmail("user@yopmail.com").valid).toBe(false);
  });

  it("rejects empty input", () => {
    expect(validateRealEmail("").valid).toBe(false);
    expect(validateRealEmail("   ").valid).toBe(false);
  });

  it("rejects malformed emails", () => {
    expect(validateRealEmail("not-an-email").valid).toBe(false);
    expect(validateRealEmail("missing@domain").valid).toBe(false);
    expect(validateRealEmail("@nodomain.com").valid).toBe(false);
    expect(validateRealEmail("noat.com").valid).toBe(false);
  });

  it("is case-insensitive", () => {
    expect(validateRealEmail("USER@GMAIL.COM").valid).toBe(true);
    expect(validateRealEmail("User@Gmail.Com").valid).toBe(true);
  });

  it("trims whitespace", () => {
    expect(validateRealEmail("  user@gmail.com  ").valid).toBe(true);
  });

  it("allows test@/demo@ prefixes if domain is a real provider", () => {
    // test@gmail.com should pass (it's a real provider)
    expect(validateRealEmail("test@gmail.com").valid).toBe(true);
    expect(validateRealEmail("demo@outlook.com").valid).toBe(true);
  });

  it("rejects test@/demo@ prefixes with non-real domains", () => {
    expect(validateRealEmail("test@somedomain.xyz").valid).toBe(false);
    expect(validateRealEmail("demo@fake.org").valid).toBe(false);
  });
});

describe("REAL_EMAIL_PROVIDERS", () => {
  it("includes gmail.com", () => {
    expect(REAL_EMAIL_PROVIDERS).toContain("gmail.com");
  });
  it("includes outlook.com", () => {
    expect(REAL_EMAIL_PROVIDERS).toContain("outlook.com");
  });
  it("is non-empty", () => {
    expect(REAL_EMAIL_PROVIDERS.length).toBeGreaterThan(5);
  });
});
