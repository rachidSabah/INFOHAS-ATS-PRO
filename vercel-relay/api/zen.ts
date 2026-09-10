// ============================================================================
// ATS Zen Relay — Vercel Edge Function (static mount + rewrite router)
//
// WHAT: A transparent, single-upstream reverse proxy for the OpenCode Zen API.
//   https://<this-deployment>/zen/v1/models            →  https://opencode.ai/zen/v1/models
//   https://<this-deployment>/zen/v1/chat/completions  →  https://opencode.ai/zen/v1/chat/completions
//
// ROUTING: vercel.json rewrites `/zen/:path*` → `/api/zen?zenpath=:path*`.
// Plain (non-framework) Vercel Functions map files to STATIC paths only, so
// the function lives at `api/zen.ts` (exact /api/zen) and receives the Zen
// subpath through the `zenpath` query parameter. Any other query parameters
// of the ORIGINAL request are forwarded upstream.
//
// WHY: ResumeAI Pro's Cloudflare Pages deployment funnels every AI call
// through edge functions that egress from Cloudflare's SHARED IP pool. Zen's
// free-usage limiter is keyed to the REQUESTER'S IP (anomalyco/opencode
// #33318), so every Pages tenant collectively drains ONE quota and Zen is
// painted degraded → down. This relay egresses from Vercel's (AWS) pool — a
// different IP identity entirely — giving the app a second, independent quota
// bucket. See docs/ZEN_SHARED_EGRESS_HEALTH.md in the app repo.
//
// CONTRACT (what the app depends on — do not break):
//   - The app points the Zen provider's Base URL at
//     https://<deployment>/zen/v1 and appends /chat/completions | /models.
//   - Request headers — especially Authorization and x-opencode-session —
//     MUST reach opencode.ai verbatim (session-less completions get HTTP 400
//     MissingSessionID from the free tier).
//   - Responses pass through with upstream status codes and bodies, so the
//     app's health layer keeps seeing real 200/401/404/429/5xx semantics.
//
// SECURITY: fixed single upstream (opencode.ai/zen only) — this is NOT an
// open proxy. Client-IP signals are stripped (never leak them upstream: the
// limiter is IP-keyed), hop-by-hop headers are dropped, and the request body
// is forwarded unchanged.
// ============================================================================

export const config = { runtime: "edge" };
// Reasoning-route Zen models answer in 8–33 s; optimizer calls request up to
// 120 s. 60 s covers the test route (≤60 s) and most chat calls; if the plan
// rejects the value at deploy time, Vercel's plan default applies instead.
export const maxDuration = 60;

const UPSTREAM_ORIGIN = "https://opencode.ai";
const ZEN_ROOT = "/zen"; // the path prefix the app recognizes as a Zen upstream

/** Headers never forwarded upstream (hop-by-hop + client-IP + edge-internal). */
const STRIP_REQUEST_HEADERS = new Set([
  "host", "connection", "content-length", "transfer-encoding", "expect",
  "keep-alive", "te", "trailer", "upgrade", "proxy-authenticate",
  "proxy-authorization", "proxy-connection",
  // Client-IP signals — the Zen limiter is IP-keyed; never whisper them.
  "x-forwarded-for", "x-forwarded-host", "x-forwarded-proto", "x-forwarded-port",
  "x-real-ip", "true-client-ip", "forwarded", "via",
  // Edge-runtime internals of both platforms.
  "cf-connecting-ip", "cf-ipcountry", "cf-ray", "cf-visitor", "cf-worker",
  "cf-trace-id", "x-vercel-id", "x-vercel-forwarded-for", "x-vercel-deployment-url",
  "x-vercel-internal", "x-vercel-ip-city", "x-vercel-ip-country", "x-vercel-ip-latitude",
  "x-vercel-ip-longitude", "x-vercel-ip-timezone", "x-vercel-proxied-for",
  "x-vercel-forward", "x-vercel-cache", "x-zeus-assetproxy",
  // Pointless upstream (the relay owns TLS/host identity).
  "cookie",
]);

/** Upstream response headers that must not be passed through verbatim. */
const STRIP_RESPONSE_HEADERS = new Set([
  // fetch() transparently decodes gzip/br — forwarding these would corrupt the
  // body (decompressed bytes labelled as encoded).
  "content-encoding", "content-length", "transfer-encoding", "connection",
  "keep-alive", "content-security-policy", "x-frame-options",
]);

const CORS_ALLOW_HEADERS =
  "authorization, x-api-key, api-key, content-type, x-opencode-session, x-session-id, x-request-id, accept";

function corsHeaders(): Record<string, string> {
  return {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, PUT, PATCH, DELETE, OPTIONS",
    "Access-Control-Allow-Headers": CORS_ALLOW_HEADERS,
    "Access-Control-Max-Age": "86400",
  };
}

/** Stable relay identity — a fixed UA keeps the relay's egress classifiable
 * upstream instead of looking like random automation noise. */
const RELAY_UA = "ATS-ZenRelay/1.0";

export default async function handler(req: Request): Promise<Response> {
  const url = new URL(req.url);

  // ---- CORS preflight -----------------------------------------------------
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders() });
  }

  // ---- Resolve the Zen subpath --------------------------------------------
  // Primary: `zenpath` query param injected by the /zen/:path* rewrite.
  // Fallback: direct /api/zen/<rest> pathname (defensive; keeps the handler
  // usable even if the rewrite config is ever removed).
  let rest = url.searchParams.get("zenpath") ?? "";
  if (!rest && url.pathname.startsWith("/api/zen/")) {
    rest = url.pathname.slice("/api/zen/".length);
  }
  rest = (safeDecode(rest) ?? "").replace(/^\/+/, "").replace(/\/+$/, "");
  if (!rest) {
    return json({ ok: false, error: "Usage: /zen/<Zen API path>, e.g. /zen/v1/models" }, 404);
  }

  // Path traversal guard — each segment must be plain (decoded "..", "%2e%2e",
  // backslashes and control chars are rejected before any upstream fetch).
  const segments = rest.split("/");
  if (segments.some((s) => s === "" || s === "." || s === ".." || /[\u0000-\u001f\\]/.test(s))) {
    return json({ ok: false, error: "Illegal path segment" }, 400);
  }

  // Forward the ORIGINAL query (minus the internal zenpath param) — e.g.
  // /zen/v1/models?key=… keeps its key upstream.
  const fwdParams = new URLSearchParams(url.searchParams);
  fwdParams.delete("zenpath");
  const fwdQuery = fwdParams.toString();
  const upstreamUrl = `${UPSTREAM_ORIGIN}${ZEN_ROOT}/${rest}${fwdQuery ? `?${fwdQuery}` : ""}`;

  // ---- Forward request headers (minus strip-list) --------------------------
  const headers = new Headers();
  for (const [key, value] of req.headers.entries()) {
    if (!STRIP_REQUEST_HEADERS.has(key.toLowerCase())) headers.set(key, value);
  }
  headers.set("user-agent", RELAY_UA);
  headers.set("x-ats-relay", "1");

  // Small JSON bodies only in this app's traffic (stream:false everywhere);
  // buffering keeps the upstream fetch free of streaming-duplex quirks.
  let body: ArrayBuffer | undefined;
  if (req.method !== "GET" && req.method !== "HEAD") {
    try {
      body = await req.arrayBuffer();
    } catch {
      return json({ ok: false, error: "Failed to read request body" }, 400);
    }
    if (body.byteLength === 0) body = undefined;
  }

  // ---- Upstream fetch ------------------------------------------------------
  let upstream: Response;
  try {
    upstream = await fetch(upstreamUrl, {
      method: req.method,
      headers,
      body,
      redirect: "manual",
    });
  } catch (e: unknown) {
    const msg = e instanceof Error ? e.message : String(e);
    return json(
      { ok: false, error: `Relay could not reach opencode.ai: ${msg.slice(0, 200)}` },
      502,
      { "cache-control": "no-store" }
    );
  }

  // ---- Pass the response through (streaming body preserved) ----------------
  const resHeaders = new Headers();
  for (const [key, value] of upstream.headers.entries()) {
    if (!STRIP_RESPONSE_HEADERS.has(key.toLowerCase())) resHeaders.set(key, value);
  }
  for (const [k, v] of Object.entries(corsHeaders())) resHeaders.set(k, v);
  resHeaders.set("x-ats-relay", "1");
  resHeaders.set("cache-control", "no-store");
  return new Response(upstream.body, { status: upstream.status, statusText: upstream.statusText, headers: resHeaders });
}

function safeDecode(s: string): string | null {
  try {
    return decodeURIComponent(s);
  } catch {
    return null;
  }
}

function json(obj: unknown, status: number, extra?: Record<string, string>): Response {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "content-type": "application/json", ...corsHeaders(), ...(extra ?? {}) },
  });
}
