# GitHub Branch Protection Setup (P2)

This document describes the recommended branch protection rules for the `main` branch. Configure these in the GitHub repo UI under **Settings → Branches → Branch protection rules → Add rule**.

## Required settings

### Branch name pattern
```
main
```

### Protect matched branches
- ✅ **Require a pull request before merging**
  - Required approving reviews: **1** (or 0 if solo developer)
  - ✅ Dismiss stale pull request approvals when new commits are pushed
  - ✅ Require review from code owners (if you add a CODEOWNERS file)
- ✅ **Require status checks to pass before merging**
  - ✅ Require branches to be up to date before merging
  - Status checks required:
    - `Lint, type-check & test` (from `test` job)
    - `Build Next.js app` (from `build` job)
- ✅ **Require conversation to be resolved before merging**
- ✅ **Do not allow bypassing the above settings** (applies to admins too — recommended for production repos)

### NOT recommended (leave unchecked)
- ❌ Require signed commits — adds friction without much value for solo/small teams
- ❌ Require linear history — nice-to-have, but `Squash and merge` on GitHub already gives linear history

## Required GitHub Secrets

Configure under **Settings → Secrets and variables → Actions → New repository secret**:

| Secret name | Purpose | How to get it |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | Cloudflare API token for Pages + Workers + D1 | Cloudflare dashboard → My Profile → API Tokens → Create Token → "Edit Cloudflare Workers" template, then add D1 edit permission |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare account ID | Cloudflare dashboard → any domain → Overview → right sidebar → "Account ID" |
| `OPENCODE_API_KEY` | OpenCode API key for the app | From your OpenCode dashboard |
| `NEXTAUTH_SECRET` | NextAuth.js secret (random 32-char string) | Generate with `openssl rand -base64 32` |
| `JWT_SECRET` | JWT signing secret for the worker | Generate with `openssl rand -base64 32` |
| `ENCRYPTION_KEY` | Encryption key for stored API keys | Generate with `openssl rand -hex 32` |
| `OPENAI_API_KEY` | OpenAI API key (if using OpenAI provider) | From OpenAI dashboard |
| `ANTHROPIC_API_KEY` | Anthropic API key (if using Claude provider) | From Anthropic dashboard |

## Required GitHub Variables (optional but recommended)

Configure under **Settings → Secrets and variables → Actions → Variables → New repository variable**:

| Variable name | Default | Purpose |
|---|---|---|
| `NEXT_PUBLIC_APP_URL` | `https://resumeai.pro` | The public URL of the deployed app |

## Cloudflare API Token permissions

When creating the Cloudflare API token, ensure it has:

- **Account → Workers Scripts → Edit** (for `wrangler deploy`)
- **Account → Workers KV Storage → Edit** (for KV namespace operations)
- **Account → D1 → Edit** (for migrations)
- **Zone → Cloudflare Pages → Edit** (for Pages deploy)
- **Account → Account Settings → Read** (for account-level operations)

Scope the token to specific resources when possible (this account only, specific zone) to limit blast radius if the token is leaked.

## First deploy after enabling branch protection

1. **Create a PR** with your changes.
2. Wait for the `test` and `build` jobs to pass.
3. Merge the PR.
4. Watch the **Actions** tab — `deploy-pages`, `deploy-workers`, `migrate`, and `smoke-test` will run in sequence.
5. After `smoke-test` passes, the production deploy is complete. Verify at `https://resumeai-pro.pages.dev` and `https://resumeai-pro-api.rachidelsabah.workers.dev/api/health`.

## Rollback

If a deploy is bad:
1. **Worker:** `npx wrangler rollback` (reverts to the previous worker version)
2. **Pages:** In the Cloudflare dashboard → Pages → resumeai-pro-prod → Deployments → Roll back to previous
3. **D1 migrations:** D1 doesn't support rollback migrations. Forward-fix by deploying a new migration that undoes the changes (e.g. drop the column).
