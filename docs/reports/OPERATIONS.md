# Operations

Operational guidance for running ResumeAI Pro in production on Cloudflare.

## Components

| Component | Where | Notes |
|-----------|-------|-------|
| Frontend | Cloudflare Pages | Next.js, Edge runtime, `.vercel/output/static` |
| API | Cloudflare Worker | Hono, `nodejs_compat`, D1 + KV bindings |
| Database | Cloudflare D1 | `resumeai-pro-db` |
| Cache | Cloudflare KV | `CACHE` |
| Object store | Cloudflare R2 | referenced; configure per deploy |
| CI/CD | GitHub Actions | `.github/workflows/ci-cd.yml` |

## Health

- Worker: `GET /api/health` → `{"ok":true}` (also reports provider-key config).
- Pages: the `/api/health` Edge route mirrors this.
- CI smoke test hits `/api/health` and retries up to 5 times post-deploy.

## Rollback

Deployments are content-addressed; to roll back:

1. **Worker:** `wrangler deploy --oldest` or redeploy a prior tag's build.
2. **Pages:** promote a previous deployment in the Cloudflare Pages dashboard,
   or re-run the CI for the last good Git tag.
3. **DB migrations** are additive where possible; a breaking migration requires
   a planned forward-fix migration (never edit an applied migration file).

## Monitoring

- Worker observability is enabled (`wrangler.toml` `[observability]`).
- Flight Recorder captures per-execution latency/tokens/cost client-side
  (see `FLIGHT_RECORDER.md`); surface via the in-app Flight Recorder Console.
- Logs: `wrangler tail` for the Worker; Pages function logs in the dashboard.

## Secrets rotation

Rotate `NEXTAUTH_SECRET` / `ENCRYPTION_KEY` with `wrangler secret put …`.
Provider API keys are managed in-app (Super Admin → AI Providers) and encrypted
at rest; rotating a key updates the D1 row, no redeploy needed.

## Rate limiting

Edge middleware rate-limits `/api/*` to 30 req/min/IP (in-memory per isolate;
best-effort on the edge). For enforced limits, add a Cloudflare WAF / KV-backed
rate limit in front of the Worker.

## Backup

`scripts/backup.sh` backs up D1 + R2. Schedule it (e.g. Cloudflare Cron or
external scheduler) for regular snapshots.

## Troubleshooting

| Symptom | Check |
|---------|-------|
| `/api/health` fails | Worker deployed? D1 binding correct? Secrets set? |
| AI calls hang | Puter/OAuth popup blocked; timeouts fall through to next provider |
| Provider proxy 403 | Request URL not on the SSRF allowlist |
| Pages 404 on API | `public/_routes.json` must exclude `/api/*` |
| Type errors in build | `next.config.ts` enforces types; run `npx tsc --noEmit` |
