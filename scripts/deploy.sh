#!/usr/bin/env bash
# =============================================================================
# ResumeAI Pro — one-command production deploy (Cloudflare Pages + Worker + D1)
#
# Package manager is canonical npm. Do NOT use bun/pnpm here.
#
# Prereqs:
#   - Node 22+, npm (canonical), wrangler authenticated (`wrangler login`)
#   - Cloudflare: Pages project, Worker, D1 (resumeai-pro-db), KV (CACHE)
#   - Worker secrets set: NEXTAUTH_SECRET, ENCRYPTION_KEY (wrangler secret put)
#
# Usage:
#   ./scripts/deploy.sh            # full deploy (pages + worker + migrations)
#   ./scripts/deploy.sh pages      # Pages frontend only
#   ./scripts/deploy.sh worker     # Worker + migrations only
#   ./scripts/deploy.sh migrate    # D1 migrations only
#   ./scripts/deploy.sh all        # alias for the default full deploy
#
# Safe to re-run: D1 migrations are state-tracked; deploys are content-addressed.
#
# SECURITY: never commit .env or pass tokens as CLI args. Set Worker secrets
# with `wrangler secret put NEXTAUTH_SECRET` (interactive) — tokens are never
# echoed or written to logs here.
# =============================================================================
set -euo pipefail

PROJECT="resumeai-pro"
WORKER_PROJECT="resumeai-pro-api"
DB="resumeai-pro-db"

DO_PAGES=1
DO_WORKER=1
DO_MIGRATE=1

case "${1:-all}" in
  pages)  DO_WORKER=0; DO_MIGRATE=0 ;;
  worker) DO_PAGES=0 ;;
  migrate) DO_PAGES=0; DO_WORKER=0 ;;
  all)    ;;
  *) echo "Unknown command: $1 (use: all|pages|worker|migrate)"; exit 1 ;;
esac

banner() { echo ""; echo "▶ $1"; }

if [[ "$DO_PAGES" == "1" ]]; then
  banner "[1/4] Installing dependencies (npm ci)"
  npm ci

  banner "[2/4] Building Next.js app"
  npm run build

  banner "[3/4] Building Cloudflare Pages output (next-on-pages)"
  npx @cloudflare/next-on-pages --skip-build

  banner "[4/4] Deploying to Cloudflare Pages"
  npx wrangler pages deploy .vercel/output/static --project-name="$PROJECT"
fi

if [[ "$DO_WORKER" == "1" ]]; then
  banner "Deploying Cloudflare Worker API"
  npx wrangler deploy
fi

if [[ "$DO_MIGRATE" == "1" ]]; then
  banner "Applying D1 migrations (state-tracked, safe to re-run)"
  # Applies migrations/0001..0015 in order, skipping already-applied ones.
  npx wrangler d1 migrations apply "$DB" --remote
fi

echo ""
echo "✓ Deploy complete."
echo "  Health : curl https://${WORKER_PROJECT}.workers.dev/api/health"
echo "  Verify : see docs/PRODUCTION_VERIFICATION.md"
