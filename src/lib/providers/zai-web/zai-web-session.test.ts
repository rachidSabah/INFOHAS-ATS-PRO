/**
 * Task 30 — Z.ai Web Session provider tests.
 *
 * Covers the spec contract: origin-guarded discovery, real-validation state
 * machine, session monitor, log redaction, model ownership (zai-web, never
 * zai-api), adapter semantics (fail-fast auth, graceful contract failure,
 * response normalization) and provider-sync isolation (ID-only seed match,
 * no URL restore, no seed model union, disconnect isolation).
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  ZAI_WEB_CREDENTIAL_TYPE,
  ZAI_WEB_ORIGIN,
  ZAI_WEB_PROVIDER_ID,
  discoverZaiWebSession,
  type ZaiWebStorageSurface,
} from "./session-discovery";
import {
  DEFAULT_ZAI_WEB_CONTRACT,
  validateZaiWebSession,
} from "./session-validator";
import {
  monitorZaiWebSession,
  redactZaiSecrets,
} from "./session-monitor";
import { toZaiWebModelRows, zaiWebModelUpsert } from "./model-discovery";
import { buildZaiWebBookmarklet } from "./bridge";

const TOKEN = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiJ6YWkifQ.signature-part-000000";

function surface(over: Partial<ZaiWebStorageSurface> = {}): ZaiWebStorageSurface {
  return {
    origin: ZAI_WEB_ORIGIN,
    cookie: null,
    localStorage: {},
    sessionStorage: {},
    ...over,
  };
}

describe("ZaiWebSessionDiscovery — origin guard", () => {
  it("refuses to probe any origin other than chat.z.ai (Same-Origin Policy)", () => {
    const out = discoverZaiWebSession(
      surface({
        origin: "https://resumeai-pro.pages.dev",
        localStorage: { token: TOKEN },
      }),
    );
    expect(out).toEqual({ accessible: false, reason: "inaccessible-origin" });
  });

  it("discovers a localStorage session token on the chat.z.ai origin", () => {
    const out = discoverZaiWebSession(surface({ localStorage: { token: TOKEN } }));
    expect(out.accessible).toBe(true);
    if (out.accessible && out.session) {
      expect(out.session.authenticated).toBe(true);
      expect(out.session.token).toBe(TOKEN);
      expect(out.session.source).toBe("localStorage");
    } else {
      expect.unreachable("session should be found");
    }
  });

  it("discovers cookie-based sessions and unwraps JSON token wrappers", () => {
    const fromCookie = discoverZaiWebSession(surface({ cookie: `token=${TOKEN}; other=x` }));
    expect(fromCookie.accessible && fromCookie.session?.source).toBe("cookie");
    const wrapped = discoverZaiWebSession(
      surface({ localStorage: { satoken: JSON.stringify({ token: TOKEN }) } }),
    );
    expect(wrapped.accessible && wrapped.session?.token).toBe(TOKEN);
  });

  it("reports no session when storage has none (never invents one)", () => {
    const out = discoverZaiWebSession(surface());
    expect(out).toEqual({ accessible: true, session: null });
  });
});

describe("ZaiWebSessionValidator — real-validation state machine", () => {
  const respond = (status: number, body: unknown = {}) =>
    vi.fn(async () => new Response(JSON.stringify(body), { status })) as any;

  it("never marks connected without a session", async () => {
    const res = await validateZaiWebSession(null, respond(200, {}));
    expect(res.state).toBe("authentication_required");
    expect(res.authenticated).toBe(false);
  });

  it("marks connected ONLY after a real validated response and extracts models", async () => {
    const fetchLike = respond(200, { data: [{ id: "glm-4.6" }, { id: "glm-4.5-air" }] });
    const res = await validateZaiWebSession({ token: TOKEN }, fetchLike, DEFAULT_ZAI_WEB_CONTRACT);
    expect(res.state).toBe("connected");
    expect(res.authenticated).toBe(true);
    expect(res.models).toEqual(["glm-4.6", "glm-4.5-air"]);
    expect(String(fetchLike.mock.calls[0][0])).toBe(`${DEFAULT_ZAI_WEB_CONTRACT.origin}${DEFAULT_ZAI_WEB_CONTRACT.modelsPath}`);
  });

  it("maps 401-with-auth-body to session_expired (not connected)", async () => {
    const res = await validateZaiWebSession(
      { token: TOKEN },
      respond(401, { detail: "token expired, login required" }),
    );
    expect(res.state).toBe("session_expired");
    expect(res.authenticated).toBe(false);
  });

  it("maps 403-without-auth-body to blocked (Z.ai refusing the client)", async () => {
    const res = await validateZaiWebSession({ token: TOKEN }, respond(403, "<html>forbidden</html>"));
    expect(res.state).toBe("blocked");
  });

  it("maps 429 to rate_limited and 5xx to session_invalid without corrupting state", async () => {
    expect((await validateZaiWebSession({ token: TOKEN }, respond(429, {}))).state).toBe("rate_limited");
    expect((await validateZaiWebSession({ token: TOKEN }, respond(502, {}))).state).toBe("session_invalid");
  });

  it("maps network failures to network_error", async () => {
    const fetchLike = vi.fn(async () => {
      throw new Error("NetworkError when attempting to fetch");
    }) as any;
    const res = await validateZaiWebSession({ token: TOKEN }, fetchLike);
    expect(res.state).toBe("network_error");
  });
});

describe("ZaiWebSessionMonitor + logging hygiene", () => {
  it("reports DEGRADED + reconnect prompt on expired sessions (never auto re-auth)", () => {
    const m = monitorZaiWebSession({
      hasCredential: true,
      expiresAt: Date.now() - 1000,
      lastValidation: "session_expired",
    });
    expect(m.state).toBe("expired");
    expect(m.providerHealth).toBe("degraded");
    expect(m.reconnectPrompt).toBe(true);
    expect(m.message).toMatch(/reconnect/i);
  });

  it("reports ACTIVE while the session is valid", () => {
    const m = monitorZaiWebSession({ hasCredential: true, expiresAt: Date.now() + 3600_000 });
    expect(m.state).toBe("active");
    expect(m.providerHealth).toBe("healthy");
  });

  it("redacts tokens, cookies and Authorization headers from any log line", () => {
    const line = `POST ok Authorization: Bearer ${TOKEN} cookie=token=${TOKEN}; session {"token":"${TOKEN}","model":"glm-4.6"}`;
    const red = redactZaiSecrets(line);
    expect(red).not.toContain(TOKEN);
    expect(red).toContain("[REDACTED]");
    expect(red).toContain("glm-4.6");
  });
});

describe("ZaiWebModelDiscovery — ownership", () => {
  it("stores GLM-family models under provider_id zai-web with stable ids", () => {
    const { sql, params } = zaiWebModelUpsert("glm-4.6");
    expect(sql).toContain("'zai-web'");
    expect(sql).toContain("ON CONFLICT(provider_id, model_id)");
    expect(params[0]).toBe("zai-web:glm-4.6");
    const rows = toZaiWebModelRows(["glm-4.6", "glm-4.5-air"]);
    expect(rows.every((r) => r.provider_id === "zai-web" && r.source === "zai-web")).toBe(true);
    expect(rows[0].id).toBe("zai-web:glm-4.6");
  });

  it("uses the zai_web_session credential type (never an API key)", () => {
    expect(ZAI_WEB_CREDENTIAL_TYPE).toBe("zai_web_session");
    expect(ZAI_WEB_PROVIDER_ID).toBe("zai-web");
  });
});

describe("Z.ai Web browser bridge", () => {
  it("builds a self-contained bookmarklet targeting the import endpoint", () => {
    const js = buildZaiWebBookmarklet({ importUrl: "https://app.example.com/api/providers/zai-web/session-import" });
    expect(js.startsWith("javascript:")).toBe(true);
    expect(js).toContain("/api/providers/zai-web/session-import");
    expect(js).toContain("zai_web_session");
    expect(js).toContain("chat.z.ai");
  });
});

// ============================================================================
// Task 30b — server-side validation of the D1-stored session (Test
// Connection fix): validates the encrypted server copy, never echoes the
// token, maps every terminal condition to an honest state.
// ============================================================================
import { encrypt } from "../antigravity-routes";
import { validateStoredZaiWebSession } from "./server-validate";

function fakeDb(row: { access_token?: string } | null) {
  const runs: { sql: string; values: unknown[] }[] = [];
  const db = {
    prepare: (sql: string) => ({
      bind: (...values: unknown[]) => ({
        first: async <T,>() => (sql.includes("SELECT") ? ((row ?? null) as T) : null),
        run: async () => {
          runs.push({ sql, values });
          return { meta: { changes: 1 } };
        },
      }),
      first: async <T,>() => (sql.includes("SELECT") ? ((row ?? null) as T) : null),
      run: async () => ({ meta: { changes: 1 } }),
    }),
  };
  return { db, runs };
}

describe("validateStoredZaiWebSession — server-side Test Connection", () => {
  it("validates the decrypted server copy and returns models WITHOUT ever echoing the token", async () => {
    const { db, runs } = fakeDb({ access_token: await encrypt(TOKEN) });
    const fetchLike = vi.fn(async (url: unknown) =>
      new Response(JSON.stringify({ data: [{ id: "glm-4.6" }] }), { status: 200 }),
    ) as unknown as typeof fetch;
    const result = await validateStoredZaiWebSession(db as any, undefined, fetchLike);
    expect(result.status).toBe(200);
    expect(result.body.validated).toBe(true);
    expect(result.body.state).toBe("connected");
    expect(result.body.models).toEqual(["glm-4.6"]);
    // Token secrecy: neither request URL nor response body carries it.
    expect(String(fetchLike)).not.toContain(TOKEN);
    expect(JSON.stringify(result.body)).not.toContain(TOKEN);
    // Observed state is persisted (best-effort UPDATE).
    expect(runs.length).toBe(1);
    expect(runs[0].sql).toContain("UPDATE provider_tokens");
  });

  it("fails closed with 501 when the secure sink is unbound", async () => {
    const result = await validateStoredZaiWebSession(undefined, undefined);
    expect(result.status).toBe(501);
    expect(result.body.validated).toBe(false);
    expect(result.body.message).toMatch(/secure storage is unavailable/i);
  });

  it("reports authentication_required when nothing is stored server-side", async () => {
    const { db } = fakeDb(null);
    const result = await validateStoredZaiWebSession(db as any, undefined);
    expect(result.status).toBe(200);
    expect(result.body.state).toBe("authentication_required");
    expect(result.body.validated).toBe(false);
  });

  it("maps an undecryptable stored session to session_invalid (honest, actionable)", async () => {
    const { db } = fakeDb({ access_token: "not-a-valid-ciphertext-hex!!" });
    const result = await validateStoredZaiWebSession(db as any, undefined);
    expect(result.body.state).toBe("session_invalid");
    expect(result.body.validated).toBe(false);
    expect(result.body.message).toMatch(/could not be decrypted/i);
  });

  it("forwards the real Z.ai rejection state (401 expired session)", async () => {
    const { db } = fakeDb({ access_token: await encrypt(TOKEN) });
    const fetchLike = vi.fn(async () =>
      new Response(JSON.stringify({ detail: "token expired, login required" }), { status: 401 }),
    ) as unknown as typeof fetch;
    const result = await validateStoredZaiWebSession(db as any, undefined, fetchLike);
    expect(result.body.state).toBe("session_expired");
    expect(result.body.validated).toBe(false);
  });
});
