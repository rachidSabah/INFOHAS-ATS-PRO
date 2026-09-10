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
signal. Two levers now separate the two:

| Lever | Where | Effect |
|---|---|---|
| **`enableZenQuotaGrace`** (flag, default ON) | Super Admin → Feature Flags | Quota-shaped failures (429 / `FreeUsageLimitError` / "quota" / "rate limit") on Zen upstreams never demote health below **healthy**; the panel shows green with the rate-limited badge. Routing cooldowns still apply, so the router still backs off for the 60 s window — grace only fixes the *display*, not the traffic policy. |
| **Zen relay (egress bypass)** | AI Providers → edit the Zen provider's **Base URL** | Point the provider at your own relay that serves the API under a `/zen…` path (e.g. `https://relay.yourdomain.com/zen/v1`). Any host with a `/zen` path prefix is detected as a Zen upstream automatically — session headers (`x-opencode-session`), quota grace and the free-model registry all follow. The relay's IP — not Cloudflare's shared pool — is what Zen's limiter sees. |

## Why "just call it from the browser" doesn't work

`opencode.ai/zen/v1` sends **no `Access-Control-Allow-Origin`** and
`OPTIONS /chat/completions` returns 404 (verified live, see
`src/lib/ai/providers/chat-proxy-cache.ts` header comment). Browser-direct
calls are impossible for Zen; every call must hop a server-side proxy. That
proxy's egress IP is what the limiter keys on — so the only real fix is
changing **whose** IP egresses.

## The relay escape hatch (recommended for real traffic)

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
| `src/lib/ai/zen-free-models.ts` | `isZenChatUpstream` (host OR `/zen` path), `zenHealthStatusOverride` (pure grace rule), `isRateLimitShaped` |
| `src/lib/provider-health.ts` | `recordFailure` grace branch (quota failures don't poison counters/status) + display override in `getHealthForProvider` |
| `src/lib/types.ts` | `FeatureFlags.enableZenQuotaGrace` |
| `src/components/app/modules/FeatureFlags.tsx` | Flag UI entry ("Zen Quota Grace") |
| `src/lib/mock-data.ts` | Default ON in `SEED_FLAGS` |
| `src/lib/ai/zen-free-models.test.ts` | Unit tests for detection + grace rule |
