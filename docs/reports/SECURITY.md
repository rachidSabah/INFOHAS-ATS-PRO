# Security Policy

## Supported Versions

| Version | Supported |
|---------|-----------|
| `v1.0.x` (latest) | ✅ |
| `< v1.0.0` | ❌ |

## Reporting a Vulnerability

We take security seriously. If you discover a security vulnerability in
ResumeAI Pro, **please do not open a public GitHub issue.**

Instead, report it privately by emailing the maintainers or using GitHub's
private vulnerability reporting (Security → Report a vulnerability) on the
repository.

Please include:
- A description of the vulnerability and its impact.
- Steps to reproduce (proof-of-concept if possible).
- Affected version(s).

We aim to acknowledge reports within **72 hours** and provide a remediation
timeline within **7 days** for confirmed critical issues.

## Security Model

ResumeAI Pro is a client-heavy, privacy-first application:

- **Primary AI is free and user-authenticated** (Puter.js, loaded from CDN).
  User AI calls run under the user's own provider account — the app owner
  never sees user AI content.
- **API keys are encrypted at rest** in Cloudflare D1 (Worker `ENCRYPTION_KEY`)
  and are never returned to the browser in plaintext.
- **Edge security middleware** (`src/middleware.ts`) adds security headers,
  per-IP rate limiting, and an SSRF allowlist (`src/lib/ssrf-allowlist.ts`) that
  blocks requests to private/link-local addresses for the provider proxy routes.
- **CSP / HSTS / X-Frame-Options** are applied in production (see middleware).
- **Secrets** (API keys, `NEXTAUTH_SECRET`, `ENCRYPTION_KEY`) are injected via
  Cloudflare Secrets / CI variables — never committed. See `.env.example`.

## Known Production Notes

- `wrangler.toml` ships `CORS_ORIGIN = "*"` to support Cloudflare Pages preview
  URLs. **Before a custom-domain production launch, set `CORS_ORIGIN` to your
  real origin** to reduce CSRF/credential-leak surface.
- The debug route (`/api/debug`) and `/debug` page are blocked in production by
  the middleware.
