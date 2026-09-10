# OpenCode Zen health vs. Cloudflare shared egress — why Zen shows "unhealthy" and the levers that fix it

## TL;DR

OpenCode Zen (`opencode.ai/zen`) is **not** sick — it is **throttled**. On the
Cloudflare Pages deployment every AI call funnels through the edge functions
(`/api/providers/chat`, `/api/providers/test`), so requests egress from
Cloudflare's **shared IP pool**. Zen's free-usage limiter is keyed to the
**requester's IP** (upstream: anomalyco/opencode #33318 — a fresh key or new
account does **not** lift it), so every Pages tenant collectively drains one
quota. The resulting 429 `FreeUsageLimitError` responses were being recorded
as health failures, which painted Zen degraded → down (red) in the health
panels.

A 429 is *proof the upstream answers*. It is a capacity signal, not a health
signal. Three levers now separate the two:

| Lever | Where | Effect |
|---|---|---|
| **`enableZenQuotaGrace`** (flag, default ON) | Super Admin → Feature Flags | Quota-shaped failures (429 / `FreeUsageLimitError` / "quota" / "rate limit") on Zen upstreams never demote health below **healthy**; the panel shows green with the rate-limited badge. Routing cooldowns still apply, so the router still backs off for the 60 s window — grace only fixes the *display*, not the traffic policy. |
| **`zenRelayEnabled` — Zen Vercel Relay (STRICT opt-in flag)** | Super Admin → Feature Flags | BUILT & LIVE-VERIFIED (2026-09-10): routes all canonical Zen traffic through the managed **Vercel relay** `https://ats-zen-relay.vercel.app/zen/v1` (source: `vercel-relay/` in the repo root). The relay egresses from **Vercel's (AWS) IP pool**, not Cloudflare's shared edge pool — Zen's per-IP limiter sees a second, independent quota bucket. Verified live at deploy time: `/zen/v1/models` 200, CORS preflight 204, free-model chat completion 200 with a real completion. **Enable it ONLY after re-verifying the URL** (the project auto-linked to the GitHub repo and a push rebuilt it from the repo root — see `vercel-relay/README.md` for the fix). 2026-09-11: relay runtime switched edge → **Node** (`maxDuration: 150`) — Hobby Edge functions die at ~30 s wall clock (ignoring `maxDuration`), which killed reasoning-model calls (`nemotron-3-ultra-free` answers in 8–33 s+) with `FUNCTION_INVOCATION_TIMEOUT`. |
| **Self-hosted relay (BYO domain)** | AI Providers → edit the Zen provider's **Base URL** | Point the provider at your own relay that serves the API under a `/zen…` path (e.g. `https://relay.yourdomain.com/zen/v1`). Any host with a `/zen` path prefix is detected as a Zen upstream automatically — session headers (`x-opencode-session`), quota grace and the free-model registry all follow. |

## Why "just call it from the browser" doesn't work

`opencode.ai/zen/v1` sends **no `Access-Control-Allow-Origin`** and
`OPTIONS /chat/completions` returns 404 (verified live, see
`src/lib/ai/providers/chat-proxy-cache.ts` header comment). Browser-direct
calls are impossible for Zen; every call must hop a server-side proxy. That
proxy's egress IP is what the limiter keys on — so the only real fix is
changing **whose** IP egresses.

## The managed Vercel relay (deployed — zero self-hosting)

`vercel-relay/` in the repo root is a two-file Vercel Edge project
(`api/zen.ts` + a `/zen/:path*` rewrite in `vercel.json`) that transparently
forwards `/zen/*` to `https://opencode.ai/zen/*`: request headers
(`Authorization`, `x-opencode-session`, …) and bodies pass through verbatim,
client-IP signals (`x-forwarded-*`, `cf-*`) are stripped upstream, and
response status codes/bodies pass through untouched so the health layer keeps
seeing real 200/401/404/429/5xx semantics. It is a **single-upstream** proxy —
not an open relay.

When `zenRelayEnabled` is **explicitly on** (strict `=== true` opt-in — see
`zen-egress.ts`; a rerouting flag must never silently become the default
path), every client call site
(`manager.ts` test/models, `openai-compatible.ts` and `custom.ts` chat,
`model-discovery.ts`) swaps the canonical `https://opencode.ai/zen/v1` for
`https://ats-zen-relay.vercel.app/zen/v1` before handing the URL to the
`/api/providers/*` edge proxies (pure helper: `resolveZenEgressBaseUrl` in
`zen-free-models.ts`; flag-reading wrapper: `src/lib/ai/zen-egress.ts`). The
edge proxies allowlist the relay host (`ssrf-allowlist.ts` + the inlined
copies) and detect it as a Zen upstream by its `/zen` path. The Workers API
cron prober can egress through the relay too via the `OPENCODE_API_BASE` var
in `wrangler.toml` (currently commented out until the alias is stable).

Redeploying the relay after editing it:

```bash
cd vercel-relay
npx vercel link --yes --project ats-zen-relay --scope <team-slug> --token <VERCEL_TOKEN>
npx vercel deploy --prod --yes --token <VERCEL_TOKEN>
```

## The self-hosted relay escape hatch (BYO domain)

1. Run a tiny reverse proxy on any non-Cloudflare host you control (VPS, home
   lab, or the desktop app's local server — the Electron build already runs
   the Next server locally, so desktop egress is your own IP and Zen is
   naturally greener there).
2. Forward `/zen/*` to `https://opencode.ai/zen/*`, preserving headers and
   the request body. Caddy example:

   ```
   relay.yourdomain.com {
       reverse_proxy /zen/* https://opencode.ai {
           header_up Host opencode.ai
       }
   }
   ```
3. In **AI Providers**, set the Zen provider's Base URL to
   `https://relay.yourdomain.com/zen/v1`. Nothing else changes: detection,
   session headers and quota grace are keyed off the `/zen` path prefix.

Caveats: the relay must not strip `x-opencode-session`; HTTPS is required by
browser mixed-content policy; and the relay's own IP now carries your Zen
quota — one relay per household/team is usually plenty.

## What the flag does *not* do

- It does not bypass the limiter or fake success — real requests still get
  429s, and routing/backoff layers still react to them (`rateLimitedUntil`,
  Rate Governor, upstream-domain diversion in `upstream-domain.ts`).
- It does not mask genuine failures: the latest error decides. A 401 (bad
  key), 404 (model gone) or 5xx outage on a Zen provider still degrades it
  under the normal rules (`zenHealthStatusOverride` in
  `src/lib/ai/zen-free-models.ts`).
- It never claims an *untested* provider is verified — untested stays
  untested.

## Implementation map

| File | Role |
|---|---|
| `src/lib/ai/zen-free-models.ts` | `isZenChatUpstream` (host OR `/zen` path), `zenHealthStatusOverride` (pure grace rule), `isRateLimitShaped`, `ZEN_RELAY_BASE_URL` + `isCanonicalZenBaseUrl` + `resolveZenEgressBaseUrl` (pure relay routing) |
| `src/lib/ai/zen-egress.ts` | Flag-aware async wrapper (`zenEgressBaseUrl`) — lazy store import, no adapter→store cycle |
| `src/lib/ai/services/manager.ts`, `src/lib/ai/providers/openai-compatible.ts`, `src/lib/ai/providers/custom.ts`, `src/lib/model-discovery.ts` | Client call sites applying the relay swap before the `/api/providers/*` proxies |
| `src/lib/ssrf-allowlist.ts` + inlined copies in `/api/providers/{chat,test,models}/route.ts` | Allowlist the relay host; path-based Zen detection |
| `vercel-relay/` | The deployed Vercel Edge relay (`api/zen.ts` + rewrite; see its README) |
| `wrangler.toml` | `OPENCODE_API_BASE` var — cron prober egress through the relay |
| `src/lib/provider-health.ts` | `recordFailure` grace branch (quota failures don't poison counters/status) + display override in `getHealthForProvider` |
| `src/lib/types.ts` | `FeatureFlags.enableZenQuotaGrace`, `FeatureFlags.zenRelayEnabled` |
| `src/components/app/modules/FeatureFlags.tsx` | Flag UI entries ("Zen Quota Grace", "Zen Vercel Relay") |
| `src/lib/mock-data.ts` | Default ON in `SEED_FLAGS` |
| `src/lib/ai/zen-free-models.test.ts` | Unit tests for detection + grace rule + relay routing |
