# Deployment

ResumeAI Pro deploys to **Cloudflare** in two parts:

- **Frontend** → Cloudflare **Pages** (Next.js via `@cloudflare/next-on-pages`,
  Edge runtime).
- **API** → Cloudflare **Worker** (Hono, `nodejs_compat`) over **D1** + **KV**.

Package manager is **npm** (`package-lock.json` is canonical).

## Prerequisites

- Node.js 22+
- `wrangler` (installed as a dev dependency; or `npx wrangler`)
- A Cloudflare account with:
  - A Pages project (`resumeai-pro`, or `-preview` for develop)
  - A Worker (`resumeai-pro-api`)
  - A D1 database (`resumeai-pro-db`, id in `wrangler.toml`)
  - A KV namespace (`CACHE`, id in `wrangler.toml`)

## 1. Configure secrets

```bash
# Worker secrets (never commit)
wrangler secret put NEXTAUTH_SECRET
wrangler secret put ENCRYPTION_KEY
wrangler secret put JWT_SECRET        # optional

# Build-time / Pages env (set in the Pages project dashboard or CI vars)
#   NEXT_PUBLIC_APP_URL, NEXT_PUBLIC_ZAI_API_KEY, NEXT_PUBLIC_GOOGLE_CLIENT_ID, …
```

## 2. One-command deploy

```bash
./scripts/deploy.sh
```

This runs: `npm ci` → `npm run build` → `next-on-pages` →
`wrangler pages deploy .vercel/output/static` → `wrangler deploy` →
`wrangler d1 migrations apply resumeai-pro-db --remote`.

## 3. Apply database migrations

Migrations are state-tracked — safe to run repeatedly:

```bash
wrangler d1 migrations apply resumeai-pro-db --remote
```

> The CI (`ci-cd.yml`) runs this as a single step. **Do not** use the old
> per-file `d1 execute` steps — they skipped migrations 0007–0015.

## 4. Verify

```bash
curl https://<your-worker>/api/health      # expect {"ok":true}
```

Then follow `docs/PRODUCTION_VERIFICATION.md` for the full smoke-test checklist.

## Cloudflare compatibility notes

- All Pages API routes use the **Edge** runtime (no Node APIs in server code).
- `images.unoptimized: true` (Cloudflare doesn't support the Next image loader).
- Heavy libs (`sharp`, `tesseract.js`, `mammoth`, `pdfjs-dist`, `jspdf`,
  `docx`) are **client-side only**.
- `public/_routes.json` excludes `/api/*` from the static cache so the Pages
  Functions runtime (or the Worker) serves them.

## Production recommendation: lock CORS

`wrangler.toml` ships `CORS_ORIGIN = "*"` so Cloudflare Pages **preview**
URLs (which are random subdomains) work. **Before a custom-domain launch, set
`CORS_ORIGIN` to your real origin** to reduce CSRF/credential-leak surface.

## Alternative: Docker (self-host)

A `Dockerfile` and `docker-compose.yml` exist for a self-hosted / Ollama +
MinIO stack. Use `npm run build:standalone` for a Node server build
(`output: "standalone"`). This path is not the primary Cloudflare target.
