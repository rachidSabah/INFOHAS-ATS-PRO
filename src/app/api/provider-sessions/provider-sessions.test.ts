// ============================================================================
// Provider session lifecycle tests (directive #39, #44)
//
// The client SessionManager issues PUT /api/provider-sessions/:provider —
// previously neither the Next.js route nor the worker implemented PUT (the
// production 404). These tests verify the Next.js dynamic route contract:
// PUT upserts, GET restores (auth state survives restore), DELETE clears.
// ============================================================================

import { describe, it, expect, beforeEach } from "vitest";
import { NextRequest } from "next/server";
import { PUT, POST, GET, DELETE } from "./[provider]/route";

function req(method: string, body?: any): NextRequest {
  return new NextRequest(`http://localhost/api/provider-sessions/puter`, {
    method,
    body: body !== undefined ? JSON.stringify(body) : undefined,
    headers: { "content-type": "application/json" },
  });
}

async function routeParams(provider: string) {
  return { params: Promise.resolve({ provider }) };
}

const session = {
  provider: "puter",
  authenticated: true,
  email: "user@example.com",
  accessToken: "enc:xxx", // encrypted client-side by SessionManager
  expiresAt: new Date(Date.now() + 3600_000).toISOString(),
};

describe("provider-sessions route (directive #39)", () => {
  beforeEach(() => {
    // clean isolate state per test
  });

  it("PUT persists a session (the previously-missing method that 404'd)", async () => {
    const res = await PUT(req("PUT", session), await routeParams("puter"));
    expect(res.status).toBe(200);
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.provider).toBe("puter");
    expect(json.updatedAt).toBeTruthy();
  });

  it("POST behaves as an upsert alias (legacy clients)", async () => {
    const res = await POST(req("POST", session), await routeParams("puter"));
    const json: any = await res.json();
    expect(json.ok).toBe(true);
  });

  it("GET restores the persisted session — auth state survives restore", async () => {
    await PUT(req("PUT", session), await routeParams("puter"));
    const res = await GET(req("GET"), await routeParams("puter"));
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.session).not.toBeNull();
    expect(json.session.authenticated).toBe(true);
    expect(json.session.email).toBe("user@example.com");
    expect(json.sessions).toHaveLength(1);
  });

  it("GET returns null session for unknown providers (not an error)", async () => {
    const res = await GET(req("GET"), await routeParams("antigravity"));
    const json: any = await res.json();
    expect(json.ok).toBe(true);
    expect(json.session).toBeNull();
    expect(json.sessions).toEqual([]);
  });

  it("DELETE clears the session", async () => {
    await PUT(req("PUT", session), await routeParams("puter"));
    const del = await DELETE(req("DELETE"), await routeParams("puter"));
    expect(del.status).toBe(200);
    const res = await GET(req("GET"), await routeParams("puter"));
    const json: any = await res.json();
    expect(json.session).toBeNull();
  });

  it("handles non-authenticated sessions (authenticated=false)", async () => {
    await PUT(req("PUT", { ...session, authenticated: false }), await routeParams("puter"));
    const res = await GET(req("GET"), await routeParams("puter"));
    const json: any = await res.json();
    expect(json.session.authenticated).toBe(false);
  });
});
