# Dependency Report (Phase 9.0)

**Date:** 2026-07-16 · Read-only audit of `package.json` + lockfiles.

## Package manager

- **Canonical: npm** (`package-lock.json`). `bun.lock` and `pnpm-lock.yaml`
  (with `pnpm-workspace.yaml`) were **removed** for release to avoid ambiguity.
- `package.json` keeps a `pnpm.onlyBuiltDependencies` block (harmless dead
  config under npm; left to minimize churn).

## Used vs unused

| Dependency | Status | Note |
|-----------|--------|------|
| `next`, `react`, `react-dom` | ✅ Used | v15 / v19 |
| `drizzle-orm` + `drizzle-kit` | ✅ Used | Canonical ORM (Worker + D1) |
| `@prisma/client` + `prisma` | ⚠️ Present, unused at runtime | Retained per release decision; no runtime path |
| `next-auth` | ⚠️ Present | Worker verifies its JWT; client uses session/store auth |
| `hono` | ✅ Used | Worker framework |
| `zustand` | ✅ Used | Client store |
| `framer-motion`, `recharts`, `lucide-react` | ✅ Used | UI/analytics |
| `jspdf`, `docx`, `file-saver` | ✅ Used | Client export |
| `mammoth`, `pdfjs-dist`, `tesseract.js` | ✅ Used | Client parsing |
| `sharp` | ⚠️ Present | Build-time dep; not imported in `src/app/api` |
| `next-intl` | ⚠️ Present | Not wired (English-only); retained |
| `uuid` | ⚠️ Present | `crypto.randomUUID()` used instead in most places |

## Version notes

- `next@^15.1.0`, `react@^19`, `react-dom@^19` — current major lines.
- `wrangler@^4`, `drizzle-orm@^0.45`, `zod@^4`, `vitest@^4` — current.
- No end-of-life or famously-vulnerable packages identified at the pinned
  ranges. Run `npm audit` in CI for continuous monitoring.

## Known install caveat

Native build deps (`sharp`, `@prisma/engines`, `tesseract.js` workers) require
build scripts. Under npm, ensure `npm rebuild` runs where needed; on Cloudflare
Pages these are not server-side, so they don't affect the deploy.

## Verdict

Dependencies are reasonable for the feature set. Redundancies (Prisma, next-intl,
uuid) are intentional retainments; no removal required. No critical supply-chain
risk found.
