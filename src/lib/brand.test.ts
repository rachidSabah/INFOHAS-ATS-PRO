import { describe, it, expect } from "vitest";
import { getRoleForEmail, isSuperAdmin, SUPER_ADMIN_EMAILS } from "@/lib/brand";

describe("getRoleForEmail", () => {
  it("returns super_admin for relsabah@gmail.com", () => {
    expect(getRoleForEmail("relsabah@gmail.com")).toBe("super_admin");
  });

  it("is case-insensitive", () => {
    expect(getRoleForEmail("RELSABAH@GMAIL.COM")).toBe("super_admin");
    expect(getRoleForEmail("Relsabah@gmail.com")).toBe("super_admin");
  });

  it("trims whitespace", () => {
    expect(getRoleForEmail("  relsabah@gmail.com  ")).toBe("super_admin");
  });

  it("returns 'user' for non-allowlisted emails", () => {
    expect(getRoleForEmail("random.user@example.com")).toBe("user");
    expect(getRoleForEmail("hacker@evil.com")).toBe("user");
    expect(getRoleForEmail("admin@gmail.com")).toBe("user"); // not in allowlist
  });

  it("returns 'user' for empty or invalid input", () => {
    expect(getRoleForEmail("")).toBe("user");
    expect(getRoleForEmail("not-an-email")).toBe("user");
  });
});

describe("isSuperAdmin", () => {
  it("returns true for relsabah@gmail.com", () => {
    expect(isSuperAdmin("relsabah@gmail.com")).toBe(true);
  });

  it("returns false for other emails", () => {
    expect(isSuperAdmin("someone.else@example.com")).toBe(false);
  });

  it("returns false for undefined/null", () => {
    expect(isSuperAdmin(undefined)).toBe(false);
    expect(isSuperAdmin(null)).toBe(false);
    expect(isSuperAdmin("")).toBe(false);
  });
});

describe("SUPER_ADMIN_EMAILS", () => {
  it("contains relsabah@gmail.com", () => {
    expect(SUPER_ADMIN_EMAILS).toContain("relsabah@gmail.com");
  });

  it("is a non-empty array", () => {
    expect(Array.isArray(SUPER_ADMIN_EMAILS)).toBe(true);
    expect(SUPER_ADMIN_EMAILS.length).toBeGreaterThan(0);
  });
});
