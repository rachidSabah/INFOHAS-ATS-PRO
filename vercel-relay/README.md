# ATS Zen Relay

A single-upstream Vercel Edge relay for the **OpenCode Zen API**
(`https://opencode.ai/zen/*`). Deployed to give ResumeAI Pro's Cloudflare
Pages deployment a second, independent egress identity: Zen's free-usage
limiter is keyed to the **requester's IP**, and every Cloudflare Pages edge
function egresses from Cloudflare's shared IP pool. This relay egresses from
Vercel's (AWS) pool instead.

- Live URL: `https://ats-zen-relay.vercel.app`
- Mounted paths: `https://ats-zen-relay.vercel.app/zen/<path>` → `https://opencode.ai/zen/<path>`
- Headers (Authorization, `x-opencode-session`, …) and bodies pass through untouched
- Client-IP signals (`x-forwarded-*`, `cf-*`, …) are stripped upstream
- CORS enabled (browser-direct calls to the relay are possible, unlike opencode.ai)

## Deploy

```bash
cd vercel-relay
npx vercel link --yes --project ats-zen-relay --scope <team-slug> --token <VERCEL_TOKEN>
npx vercel deploy --prod --yes --token <VERCEL_TOKEN>
```

## Verify

```bash
curl -s https://ats-zen-relay.vercel.app/zen/v1/models | head -c 400
curl -s -o /dev/null -w '%{http_code}\n' -X OPTIONS https://ats-zen-relay.vercel.app/zen/v1/chat/completions
```

See `docs/ZEN_SHARED_EGRESS_HEALTH.md` in the app repo for how the app
consumes this relay (feature flag `zenRelayEnabled` → provider Base URL
rewrite) and why a 429 from Zen is capacity, not health.
