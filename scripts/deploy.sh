#!/usr/bin/env bash
# ============================================================
# ResumeAI Pro — Secure deployment helper
# ============================================================
# This script helps you push to GitHub and deploy to Cloudflare.
#
# ⚠️  DO NOT put real API tokens in this file or pass them as
#     command-line arguments. They will be visible in process
#     listings and shell history.
#
# ✅  Instead, this script reads from your local .env file
#     (which is gitignored) OR from environment variables you
#     export in your shell session.
#
# Usage:
#   1. Copy .env.example to .env and fill in your values.
#   2. Revoke the tokens that were shared in chat — they are
#      compromised. Create fresh ones at:
#        - https://github.com/settings/tokens (classic PAT, repo scope)
#        - https://dash.cloudflare.com/profile/api-tokens
#          (use the "Edit Cloudflare Workers" template)
#   3. Run:  ./scripts/deploy.sh setup       (one-time: configures git remote)
#   4. Run:  ./scripts/deploy.sh push        (commits + pushes to GitHub)
#   5. Run:  ./scripts/deploy.sh migrate     (applies D1 migrations)
#   6. Run:  ./scripts/deploy.sh workers     (deploys Workers API)
#   7. Run:  ./scripts/deploy.sh pages       (deploys Pages frontend)
#   8. Run:  ./scripts/deploy.sh secrets     (sets Worker secrets)
#   9. Run:  ./scripts/deploy.sh all         (does 4-8 in order)
# ============================================================

set -euo pipefail

# --- Load .env if present ---
if [ -f .env ]; then
  set -a
  # shellcheck disable=SC1091
  source .env
  set +a
fi

REPO_URL="${GITHUB_REPOSITORY:-rachidSabah/INFOHAS-ATS-PRO}"
REPO_FULL="https://github.com/${REPO_URL}.git"
DB_NAME="resumeai-pro-db"

cmd="${1:-help}"

banner() {
  echo ""
  echo "┌──────────────────────────────────────────────┐"
  echo "│  $1"
  echo "└──────────────────────────────────────────────┘"
}

require() {
  local var="$1"
  if [ -z "${!var:-}" ]; then
    echo "✗ Missing required env var: $var"
    echo "  Set it in .env or:  export $var=..."
    exit 1
  fi
}

case "$cmd" in
  setup)
    banner "Setup — configure git remote"
    # Use HTTPS URL without embedding the token (git will prompt for credentials,
    # or you can use a credential helper / GitHub CLI).
    git remote remove origin 2>/dev/null || true
    git remote add origin "$REPO_FULL"
    echo "✓ Git remote 'origin' set to $REPO_FULL"
    echo ""
    echo "Next steps:"
    echo "  1. Install GitHub CLI:  https://cli.github.com/"
    echo "  2. Run:  gh auth login"
    echo "  3. Run:  ./scripts/deploy.sh push"
    ;;

  push)
    banner "Push to GitHub"
    require GITHUB_TOKEN
    # Use the token in the URL ONLY for the duration of this push.
    # The token is NOT committed to .git/config — we use a one-shot URL.
    git push "https://x-access-token:${GITHUB_TOKEN}@github.com/${REPO_URL}.git" HEAD:main || {
      echo "✗ Push failed. Possible causes:"
      echo "  - Token expired or revoked (create a new one at https://github.com/settings/tokens)"
      echo "  - Repo doesn't exist yet (create at https://github.com/new)"
      echo "  - Branch protection rules blocking direct push to main"
      exit 1
    }
    echo "✓ Pushed to https://github.com/${REPO_URL}"
    ;;

  migrate)
    banner "Apply D1 migrations"
    require CLOUDFLARE_API_TOKEN
    require CLOUDFLARE_ACCOUNT_ID
    echo "→ Applying 0001_init.sql..."
    npx wrangler d1 execute "$DB_NAME" --file=migrations/0001_init.sql --remote
    echo "→ Applying 0002_ai_providers_enhanced.sql..."
    npx wrangler d1 execute "$DB_NAME" --file=migrations/0002_ai_providers_enhanced.sql --remote
    echo "✓ Migrations applied"
    ;;

  workers)
    banner "Deploy Cloudflare Workers"
    require CLOUDFLARE_API_TOKEN
    require CLOUDFLARE_ACCOUNT_ID
    npx wrangler deploy --env production
    echo "✓ Workers deployed"
    ;;

  pages)
    banner "Build & deploy to Cloudflare Pages"
    require CLOUDFLARE_API_TOKEN
    require CLOUDFLARE_ACCOUNT_ID
    echo "→ Building Next.js app..."
    bun run build
    echo "→ Deploying to Pages (project: resumeai-pro-prod)..."
    npx wrangler pages deploy .next/standalone --project-name=resumeai-pro-prod
    echo "✓ Pages deployed"
    ;;

  secrets)
    banner "Set Worker secrets"
    require CLOUDFLARE_API_TOKEN
    require CLOUDFLARE_ACCOUNT_ID
    echo "→ Setting required secrets (you'll be prompted for each value)..."
    for secret in NEXTAUTH_SECRET JWT_SECRET ENCRYPTION_KEY; do
      if [ -z "${!secret:-}" ]; then
        echo "  $secret not in .env — prompting..."
        npx wrangler secret put "$secret" --env production
      else
        echo "${!secret}" | npx wrangler secret put "$secret" --env production
      fi
    done
    echo "→ Setting optional provider secrets (only if present in .env)..."
    for secret in OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY DEEPSEEK_API_KEY GROQ_API_KEY MISTRAL_API_KEY COHERE_API_KEY PERPLEXITY_API_KEY OPENROUTER_API_KEY TOGETHER_API_KEY HUGGINGFACE_API_KEY PUTER_CLIENT_ID PUTER_APP_ID; do
      if [ -n "${!secret:-}" ]; then
        echo "  Setting $secret..."
        echo "${!secret}" | npx wrangler secret put "$secret" --env production
      fi
    done
    echo "✓ Secrets set"
    ;;

  github-secrets)
    banner "Sync .env to GitHub Actions secrets"
    require GITHUB_TOKEN
    if ! command -v gh >/dev/null 2>&1; then
      echo "✗ GitHub CLI (gh) not installed. Install: https://cli.github.com/"
      exit 1
    fi
    for secret in CLOUDFLARE_API_TOKEN CLOUDFLARE_ACCOUNT_ID NEXTAUTH_SECRET JWT_SECRET ENCRYPTION_KEY OPENAI_API_KEY ANTHROPIC_API_KEY GEMINI_API_KEY DEEPSEEK_API_KEY GROQ_API_KEY MISTRAL_API_KEY COHERE_API_KEY PERPLEXITY_API_KEY OPENROUTER_API_KEY TOGETHER_API_KEY HUGGINGFACE_API_KEY PUTER_CLIENT_ID PUTER_APP_ID; do
      if [ -n "${!secret:-}" ]; then
        echo "  Setting $secret..."
        echo "${!secret}" | gh secret set "$secret" --repo "$REPO_URL"
      fi
    done
    echo "✓ GitHub secrets synced"
    ;;

  all)
    "$0" push
    "$0" migrate
    "$0" workers
    "$0" secrets
    "$0" pages
    banner "✅ Deployment complete"
    echo "  Frontend: https://resumeai-pro-prod.pages.dev (or your custom domain)"
    echo "  API:      https://api.resumeai.pro (or your workers.dev URL)"
    ;;

  *)
    cat <<EOF
ResumeAI Pro — deployment helper

Usage: ./scripts/deploy.sh <command>

Commands:
  setup            Configure git remote origin (one-time)
  push             Commit & push to GitHub main
  migrate          Apply D1 SQL migrations to Cloudflare D1
  workers          Deploy Cloudflare Workers (Hono API)
  pages            Build Next.js & deploy to Cloudflare Pages
  secrets          Set Worker secrets from .env (interactive for missing)
  github-secrets   Sync .env values to GitHub Actions secrets
  all              Run push → migrate → workers → secrets → pages

Required env vars (in .env):
  GITHUB_TOKEN             GitHub PAT (classic, repo scope)
  CLOUDFLARE_API_TOKEN     Cloudflare API token ("Edit Workers" template)
  CLOUDFLARE_ACCOUNT_ID    Cloudflare account ID (hex string, NOT the dashboard URL)
  NEXTAUTH_SECRET          Random 32+ char string (openssl rand -base64 32)
  JWT_SECRET               Random 32+ char string
  ENCRYPTION_KEY           Random 32+ char string

Optional (only if you want server-side AI providers):
  OPENAI_API_KEY, ANTHROPIC_API_KEY, GEMINI_API_KEY, DEEPSEEK_API_KEY,
  GROQ_API_KEY, MISTRAL_API_KEY, COHERE_API_KEY, PERPLEXITY_API_KEY,
  OPENROUTER_API_KEY, TOGETHER_API_KEY, HUGGINGFACE_API_KEY,
  PUTER_CLIENT_ID, PUTER_APP_ID

⚠️  SECURITY: never commit .env. Never pass tokens as CLI args.
    The tokens shared in the original spec are compromised — revoke
    and recreate them before running this script.

EOF
    ;;
esac
