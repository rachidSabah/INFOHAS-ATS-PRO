# Vercel Deployment — Full Application (resumeai-pro-web)

**Status: LIVE** — https://resumeai-pro-web-woad.vercel.app (production alias)
Deployed 2026-09-10 from `main` @ the vercel-framework fix commit, via CLI.

## Why a second deployment exists

The Cloudflare deployment (Pages + Workers API) egresses every AI provider call
from **Cloudflare's shared edge IPs**. OpenCode Zen's free limiter is keyed per
requester IP (anomalyco/opencode #33318), so all tenants collectively drain one
quota and Zen degrades. The Vercel deployment runs the **same full application**
(UI + all `/api/*` edge routes) with egress from **Vercel's AWS IP pool** — a
second, independent per-IP quota bucket. It complements, not replaces, the
Cloudflare deployment:

| Plane | Cloudflare (canonical, auto) | Vercel (test/parallel, manual CLI) |
|---|---|---|
| UI | Pages `resumeai-pro` (auto on push to main) | `resumeai-pro-web-woad.vercel.app` (CLI) |
| App API routes | Pages edge functions | Vercel Edge Functions |
| Data (D1) | Workers API `resumeai-pro-api.rachidelsabah.workers.dev` | **same worker, same D1** (client sync is hardcoded to the worker URL) |
| AI egress | Cloudflare shared IPs | Vercel AWS IPs |

Because `src/lib/cloud-api.ts` pins `API_BASE` to the workers.dev URL, both
deployments read/write the **same D1 database** through the same Worker — data
created on one is visible on the other. No CORS changes were needed (the worker
defaults to permissive CORS).

## What was deployed (zero app-code changes)

The repo root is a standard Next.js 15 App Router app. All CF bindings
(`getRequestContext()` from `@cloudflare/next-on-pages`) are wrapped in
try/catch with graceful fallbacks (in-memory / localStorage / process.env), so
the app is Vercel-portable as-is:

- `caches.default` (chat proxy cache) → `cacheAvailable()` guard → no-op on Vercel
- `env.CACHE` KV (models/puter accounts/zen eviction) → null → skip
- `env.AI` (Workers AI native) → falls back to the Workers API relay
  (`WORKERSAI_SHARED_SECRET`) or returns 501 when that secret is absent
- `OPENCODE_API_KEY` server-side Zen key → `process.env` fallback (unset today,
  see Keys below)

Only two repo files were needed:

1. **`vercel.json`** (repo root, NEW):
   - `"framework": "nextjs"` — the project was created via CLI (`vercel projects add`)
     which leaves Framework Preset = *Other*; with *Other*, Vercel deploys
     `public/` as a static site → everything 404s. The explicit preset fixes
     routing and functions. (next-on-pages in CF CI wraps `vercel build`, which
     reads the same key harmlessly — it matches what it auto-detects anyway.)
   - `"git": {"deploymentEnabled": false}` — incident-proofing: a stray git
     connection can never silently replace CLI deployments with untested builds
     (this is exactly what broke `ats-zen-relay` on 2026-09-09).
2. **`src/app/r/[id]/` + `scripts/vercel-prebuild.mjs` + `buildCommand`** —
   the share page must be `runtime = "edge"` on Cloudflare (next-on-pages
   refuses non-static routes without it) but must NOT be an Edge Function on
   Vercel: its edge SSR bundle measures **1.51 MB** (the App Router
   client-reference graph pulls the whole store + A4 renderer server-side —
   `next/dynamic ssr:false` does NOT shed that weight), over Vercel Hobby's
   **1 MB Edge Function cap**. Next.js only accepts a **string literal** for
   route segment config (a conditional `export const runtime` fails the
   build), so the divergence is resolved at build time:
   - `vercel.json` sets `"buildCommand": "node scripts/vercel-prebuild.mjs && next build"`.
   - On Vercel (`VERCEL=1`, `CI` unset) the prebuild rewrites the page's
     literal to `"nodejs"` → Node serverless function, no size cap.
   - Everywhere else (GitHub Actions sets `CI=true`; local dev has no
     `VERCEL`) the script is a logged no-op → CF keeps its required edge.
   The page itself also got a light split (`PublicResumeContent.tsx` via
   `next/dynamic ssr:false`) — same UX everywhere, spinner-only SSR shell.

## Verified end-to-end (2026-09-10)

| Check | Result |
|---|---|
| `GET /` | 200, app shell renders |
| `GET /api/health` | 200 (edge) |
| `GET /r/<id>` | 200 (Node function) |
| `POST /api/providers/models` → `opencode.ai/zen/v1` | 200 `{"zenFree":true,"via":"live"}` — catalog fetched from Vercel egress |
| `POST /api/providers/chat` (nemotron-3.5-lightning-free, keyless) | **200 `ok:true`, real completion, 19.4 s** — full-app AI egress now from Vercel IPs |

## Known limits & differences

- **30 s wall-clock cap** on Edge Functions (Vercel Hobby). Upstream calls that
  legitimately need longer (heavy Zen models, big optimizer steps with
  `timeoutMs: 120000`) will fail with `FUNCTION_INVOCATION_TIMEOUT` on Vercel
  while working on Cloudflare. Use fast models on the Vercel deployment, or the
  desktop app for long jobs.
- **No server-side provider keys** are configured (parity with Cloudflare — the
  live Pages bundle also ships `apiKey:""` for the seeded OpenCode provider;
  verified by scanning the deployed chunks). Free Zen models work keyless;
  users' own keys are stored client-side as usual.
- `WORKERSAI_SHARED_SECRET` is not set on Vercel (value lives only in CF/GitHub
  secrets) → the Workers-AI path returns 501 there. Workers AI remains a
  Cloudflare-native feature of the CF deployment.

## Operating it

Deploy (from repo root):

```bash
npx vercel --prod --yes --token "$VERCEL_TOKEN"
```

Both Vercel projects (`resumeai-pro-web`, `ats-zen-relay`) are **CLI-managed
and git-disconnected** on purpose; Cloudflare's GitHub Actions pipeline remains
the only push-triggered deployment. Env vars on the project: `NODE_VERSION=22`.

Relevant projects in `rachidelsabah-8218s-projects`:

- `resumeai-pro-web` — full app (this doc)
- `ats-zen-relay` — managed Zen relay (`vercel-relay/`), restored + verified
  (`/zen/v1/models` → 200, CORS 204) and disconnected from GitHub on 2026-09-10;
  the Feature-Flag `zenRelayEnabled` may now be enabled after re-verification
  per docs/ZEN_SHARED_EGRESS_HEALTH.md (kept OFF by default — strict opt-in).
