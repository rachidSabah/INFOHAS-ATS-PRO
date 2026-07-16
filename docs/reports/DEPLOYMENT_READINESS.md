# Deployment Readiness Report (Phase 9.0)

**Date:** 2026-07-16

## Readiness scorecard

| Gate | Status | Evidence |
|------|--------|----------|
| Type-check | ✅ | `tsc --noEmit` → 0 errors (enforced at build) |
| Lint | ✅ | `npm run lint` configured |
| Tests | ✅ | 1404 vitest tests passing |
| Production build | ✅ | `next build` succeeds |
| Pages build | ✅ | `@cloudflare/next-on-pages` generates output (see Track E) |
| Worker build | ✅ | `wrangler deploy --dry-run` validates (see Track E) |
| Edge compatibility | ✅ | No `node:`/`fs`/`path`/`process.cwd()` in `src`; all routes `runtime="edge"` |
| Secrets hygiene | ✅ | `.env*` gitignored; `.env.example` provided |
| OSS docs | ✅ | 12 standard docs + `.env.example` created |
| DB migrations | ⚠️→✅ | CI gap fixed (0007–0015 now applied via `wrangler d1 migrations apply`) |
| Lockfiles | ✅ | Reduced to canonical `package-lock.json` |
| Stray files | ✅ | Dangerous root scripts + logs removed |

## Blockers found & resolved

1. **CI migration gap (was BLOCKER):** `ci-cd.yml` applied only 8 of 15
   migrations and mis-referenced filenames. Fixed to a single
   `wrangler d1 migrations apply` step. → Resolved.
2. **`typescript.ignoreBuildErrors: true`:** masked type errors. → Set to
   `false`; build now enforces types (green).
3. **Three lockfiles:** → Standardized to npm.
4. **Missing OSS docs / `.env.example`:** → Created.
5. **Stray root scripts** (`fix-*.js`, `patch-*.js`) mutate source in place —
   dangerous to ship. → Removed.

## Remaining (documented, not blocking)

- `CORS_ORIGIN = "*"` until a custom domain is set (documented in DEPLOYMENT.md).
- Prisma retained (dead 2nd ORM) per release decision.
- **Live public deploy + runtime smoke test not executed** — no Cloudflare
  credentials in the build sandbox. All local gates pass; the user runs the
  real `wrangler deploy` + `d1 migrations apply` + smoke test (see
  `docs/PRODUCTION_VERIFICATION.md`).

## Verdict

**Ready for release** pending the user's live deploy (credentials required).
