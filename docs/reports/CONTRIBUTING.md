# Contributing to ResumeAI Pro

Thanks for your interest in contributing! This document explains how to get set
up and the conventions we follow.

## Code of Conduct

By participating, you agree to our [Code of Conduct](CODE_OF_CONDUCT.md).

## Prerequisites

- Node.js 22+ (the CI uses Node 22)
- npm (this repo is canonical with `package-lock.json`)
- A Cloudflare account **only if** you are working on the Worker/Pages deploy

## Local Development

```bash
npm install
cp .env.example .env        # fill in any keys you want to test; empty is fine
npm run dev                 # http://localhost:3000
```

The app runs fully without API keys — Puter.js provides free AI on sign-in.

## Project Layout

```
src/
  app/            Next.js App Router (pages + API route handlers, all edge runtime)
  components/     UI (app shell, resume, interview, analytics, recruiter, flight…)
  lib/            Domain logic: ai pipeline, ats, optimizer, interview, recruiter, store
workers/api/      Cloudflare Worker (Hono) — production API over D1 + KV
migrations/       D1 SQL migrations (applied via `wrangler d1 migrations apply`)
```

## Architecture Principles

These are enforced by `CLAUDE.md` and reviewed in every PR:

1. **Audit before implementation.**
2. **Reuse before rewrite; extend before replace.**
3. **Never duplicate** the AI pipeline, provider layer, shared memory, workflow
   engine, context manager, or Flight Recorder.
4. **Single source of truth** for each concern.
5. **Cloudflare-compatible** — no Node-only APIs in server/edge code
   (`fs`, `path`, `process.cwd()`, native modules). All API routes use the Edge
   runtime.
6. **Validate every change** — tsc, lint, vitest, and build must all pass.

## Before You Open a PR

```bash
npx tsc --noEmit     # type-check (must be 0)
npm run lint         # eslint (must pass)
npx vitest run       # tests (must pass)
npm run build        # production build (must succeed)
```

## Commit & PR Style

- Commits: `type(scope): summary` (e.g. `fix(ai): handle Puter timeout`,
  `feat(interview): add competency radar`).
- PRs must fill the template (`.github/PULL_REQUEST_TEMPLATE.md`) and link any
  related issue.
- Keep PRs focused; large changes should be discussed in an issue first.

## Tests

- Unit/integration tests use **Vitest** (`*.test.ts` colocated with sources).
- Run the full suite with `npx vitest run`.
- Add or update tests for any behavior change.
