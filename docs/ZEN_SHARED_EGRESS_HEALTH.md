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
| **~~`zenRelayEnabled` — Zen Vercel Relay~~ (RETIRED 2026-09-11)** | — | The managed Vercel relay (`ats-zen-relay.vercel.app`, source `vercel-relay/`) is **gone** — the project moved to a Cloudflare-only posture and no Vercel hosting/tokens are maintained. The flag, the `zen-egress.ts` routing layer and the relay source were removed from the codebase. See the self-hosted relay below for the surviving egress lever. |
| **Self-hosted relay (BYO domain)** | AI Providers → edit the Zen provider's **Base URL** | Point the provider at your own relay that serves the API under a `/zen…` path (e.g. `https://relay.yourdomain.com/zen/v1`). Any host with a `/zen` path prefix is detected as a Zen upstream automatically — session headers (`x-opencode-session`), quota grace and the free-model registry all follow. |

## Why "just call it from the browser" doesn't work

`opencode.ai/zen/v1` sends **no `Access-Control-Allow-Origin`** and
`OPTIONS /chat/completions` returns 404 (verified live, see
`src/lib/ai/providers/chat-proxy-cache.ts` header comment). Browser-direct
calls are impossible for Zen; every call must hop a server-side proxy. That
proxy's egress IP is what the limiter keys on — so the only real fix is
changing **whose** IP egresses.

## The managed Vercel relay (RETIRED 2026-09-11)

The managed relay — `vercel-relay/` in the repo root, live at
`ats-zen-relay.vercel.app`, routed by the `zenRelayEnabled` flag through
`zen-egress.ts` — has been **retired** with the Cloudflare-only posture
switch. The relay source, the flag, the routing helper
(`resolveZenEgressBaseUrl` / `zenEgressBaseUrl`) and its allowlist entries
were removed from the codebase, and the Vercel projects/tokens were dropped.

**Why:** maintaining a second full platform (hosting + tokens + CI
coordinates) only to move one provider's egress IP was judged too heavy. The
documented self-hosted relay below is the supported escape hatch if a
different egress IP is ever needed again.

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
| `src/lib/ai/zen-free-models.ts` | `isZenChatUpstream` (host OR `/zen` path), `zenHealthStatusOverride` (pure grace rule), `isRateLimitShaped`, `isZenSharedEgressSymptom` (WAF/edge-symptom detector) |
| `src/lib/ai/services/manager.ts`, `src/lib/ai/providers/openai-compatible.ts`, `src/lib/ai/providers/custom.ts`, `src/lib/model-discovery.ts` | Client call sites — pass the provider baseUrl straight to the `/api/providers/*` proxies (no rerouting layer since the managed relay was retired) |
| `src/lib/ssrf-allowlist.ts` + inlined copies in `/api/providers/{chat,test,models}/route.ts` | Provider host allowlist; path-based Zen detection |
| `wrangler.toml` | `OPENCODE_API_BASE` var — cron prober egress (direct; point at a self-hosted relay if ever needed) |
| `src/lib/provider-health.ts` | `recordFailure` grace branch (quota failures don't poison counters/status) + display override in `getHealthForProvider` |
| `src/lib/types.ts` | `FeatureFlags.enableZenQuotaGrace` (`zenRelayEnabled` removed) |
| `src/components/app/modules/FeatureFlags.tsx` | Flag UI entry ("Zen Shared-Egress Grace") |
| `src/lib/mock-data.ts` | Default ON in `SEED_FLAGS` |
| `src/lib/ai/zen-free-models.test.ts` | Unit tests for detection + grace rule + self-hosted relay path detection |

## Task 38 — WAF challenges and 52x edge errors join the grace (CF-only posture)

The original grace covered only quota-shaped failures (429 family). Live
evidence (2026-09-11) showed a second false-negative channel: when
opencode.ai's own Cloudflare zone challenges or blocks the SHARED egress pool,
the app receives **Cloudflare edge symptoms** — WAF challenge pages
("Just a moment", "Attention Required"), firewall blocks (`error code: 1015` /
`1020`) and 52x edge errors — which every layer used to misread:

| Layer | Old misclassification | Damage |
|---|---|---|
| Routing registry (`ai-health-manager`) | `authentication` | 30-min cooldown + false `not_authenticated` — Zen excluded from routing half an hour |
| Auto-Heal classifier (`error-classifier`) | `auth_error` (temporary=false) | No retry, "verify your API key" advice that cannot help |
| Store health (`provider-health`) | strict failure path | 3 strikes → `status: "down"` (red panel) |

**Fix** — one marker-based detector, `isZenSharedEgressSymptom()` in
`zen-free-models.ts`, applied at all three layers. A challenge page is by
definition not an application-level auth rejection, so the detection is
*provider-agnostic*: any provider behind Cloudflare benefits. The fingerprints
are specific (challenge-page text, `cf-ray`, `error code: 1015/1020`,
`HTTP 5xx` edge family, or a 520–530 status hint) so a **real** Zen
`AuthError` JSON or a bare 403 "invalid api key" still classifies as auth.

The feature flag keeps the name `enableZenQuotaGrace` (shown as **"Zen
Shared-Egress Grace"** in the flags panel) and now covers both evidence
classes. The 60 s routing window is armed only for declared live-traffic rate
limits — probe/healer evidence records diagnostics without blocking traffic
(phantom-cooldown guarantee preserved).

### CF-only deployment posture (why this matters)

Cloudflare offers **no dedicated egress IPs for Workers/Pages** — every fetch
shares the global anycast pool, and no platform configuration changes that.
The grace makes health *truth-seeking* on the shared pool (symptoms of IP
reputation no longer masquerade as provider death); the rotator + KV
model-cache absorb the traffic-level bumps. Since the managed Vercel relay
was retired (same day), the **self-hosted relay** (BYO domain, section above)
is the only lever that actually changes the egress IP — strictly optional,
zero maintenance while unused. Everything in this document works on
Cloudflare alone.
