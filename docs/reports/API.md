# API Reference

ResumeAI Pro exposes two API surfaces:

1. **Edge API routes** (`src/app/api`, Next.js on Cloudflare Pages) — proxy AI,
   JD scraping, web search, provider OAuth, health. All `runtime = "edge"`.
2. **Worker REST API** (`workers/api`, Hono on Cloudflare Workers) — the
   production data API over D1 + KV.

## Edge API routes (Pages)

| Route | Method | Purpose |
|-------|--------|---------|
| `/api/ai/chat` | POST | AI chat via the built-in Z.ai fallback |
| `/api/providers/chat` | POST | Proxy a provider chat (SSRF-allowed hosts only) |
| `/api/providers/models` | GET | List models for a provider |
| `/api/providers/test` | POST | Test a provider config |
| `/api/providers/zai/*` | GET/POST | Z.ai OAuth + key exchange |
| `/api/providers/puter/*` | GET/POST | Puter auth/session management |
| `/api/providers/antigravity/*` | GET/POST | Antigravity OAuth flow |
| `/api/jd-scrape` | POST | Scrape a job description URL (15s timeout) |
| `/api/web-search` | POST | Web search (Google CSE) |
| `/api/qa/run` | POST | Run a QA evaluation |
| `/api/health` | GET | Health check (provider key config status) |
| `/api/debug` | GET | Diagnostics — **blocked in production** |

Security: middleware enforces an SSRF allowlist (`src/lib/ssrf-allowlist.ts`)
on provider proxy routes, rate-limits `/api/*`, and blocks `/api/debug` in
production.

## Worker REST API (Hono)

Base URL: your Worker (`*.workers.dev` or custom domain). Auth:
`NEXTAUTH_SECRET` JWT, session token, or `X-User-Id` (dev).

| Resource | Methods |
|----------|---------|
| `/api/users` | GET, POST, PUT, DELETE |
| `/api/resumes` | GET, POST, PUT, DELETE |
| `/api/cover-letters` | GET, POST, PUT, DELETE |
| `/api/job-descriptions` | GET, POST, DELETE |
| `/api/interviews` | GET, POST, DELETE |
| `/api/ats-reports` | GET, POST |
| `/api/providers` | GET, POST, PUT, DELETE |
| `/api/prompts` | GET, POST, PUT, DELETE |
| `/api/audit-logs` | GET, POST |
| `/api/settings/branding` | GET, PUT |
| `/api/settings/flags` | GET, PUT |
| `/api/downloads` | GET, POST |
| `/api/tasks/*` | task create/status/cancel/events (SSE) |
| `/api/health` | GET |

Provider API keys are encrypted at rest (`ENCRYPTION_KEY`) and never returned
in plaintext.

## Migrations

D1 schema is defined by SQL migrations in `migrations/` (0001–0015), applied
with `wrangler d1 migrations apply resumeai-pro-db --remote`.
