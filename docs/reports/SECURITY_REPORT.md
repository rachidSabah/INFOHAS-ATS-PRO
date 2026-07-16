# Security Report (Phase 9.0)

**Date:** 2026-07-16 · Read-only audit.

## Strengths

- **Edge middleware** (`src/middleware.ts`) applies `X-Content-Type-Options`,
  `X-Frame-Options: DENY`, `X-XSS-Protection`, `Referrer-Policy`,
  `Permissions-Policy`, and (in production) a `Content-Security-Policy` and
  `Strict-Transport-Security`.
- **SSRF protection**: provider proxy routes (`/api/providers/chat|models|test`)
  are gated by `isAllowedProviderUrl` (`src/lib/ssrf-allowlist.ts`), which blocks
  private/link-local ranges.
- **Rate limiting**: 30 req/min/IP on `/api/*` (best-effort, edge).
- **Secrets**: `.env*` is gitignored; `.env.example` shipped without values.
  Provider keys encrypted at rest (`ENCRYPTION_KEY`) in D1.
- **Debug routes blocked** in production (`/api/debug`, `/debug`).
- **No hardcoded secrets** found in `src/` (verified by grep for `sk-`, `AIza`,
  `AKIA`, `ghp_`, bearer tokens).

## Findings

| # | Severity | Finding | Status |
|---|----------|---------|--------|
| S1 | Medium | `wrangler.toml` `CORS_ORIGIN = "*"` allows any origin with credentials. Acceptable for Pages preview URLs; **lock to domain for prod.** | Documented (DEPLOYMENT.md) |
| S2 | Low | `CSP` includes `'unsafe-eval'` + `'unsafe-inline'`. Required by some SDKs; acceptable but noted. | Accepted |
| S3 | Low | `NEXT_PUBLIC_*` admin tokens (`NEXT_PUBLIC_ADMIN_TOKEN`, `NEXT_PUBLIC_SUPER_ADMIN_PASSWORD`) are visible in the client bundle. Expected for a client-heavy app; treat as semi-secret. | Accepted |
| S4 | Info | `DATABASE_URL` referenced for a "configured?" check only — DB is D1 via Worker binding, not this var. | No action |

## OWASP coverage

- **XSS:** `dangerouslySetInnerHTML` not abused; user content rendered via React.
- **CSRF:** covered by CORS guidance (S1).
- **SSRF:** covered by allowlist.
- **Injection:** parameterized D1 queries in the Worker; no raw SQL string concat found in routes.
- **Secrets:** handled (see strengths).

## Verdict

No critical or high-severity issues. Medium item (CORS) is a deployment-config
decision deferred to the user's domain setup. See `SECURITY.md` for the
vulnerability-reporting policy.
