# Performance Report (Phase 9.0)

**Date:** 2026-07-16 · Read-only audit + build analysis.

## Bundle / build

- `next build` succeeds; First Load JS shared by all routes ≈ **103 kB**.
- Many routes are statically prerendered (`○`); API routes are dynamic (`ƒ`).
- Route-level code is already split per page.

## Optimizations applied

- `images.unoptimized: true` — required for Cloudflare Pages (no default loader).
- `experimental.optimizePackageImports` extended to
  `lucide-react`, `framer-motion`, `recharts`, `date-fns`,
  `react-syntax-highlighter` — reduces barrel-import bloat.

## Heavy dependencies (client-side, lazy where possible)

| Package | Use | Note |
|---------|-----|------|
| `framer-motion` | animations | static import in many components |
| `recharts` | analytics charts | used in 9 files; in `optimizePackageImports` |
| `tesseract.js` / `mammoth` / `pdfjs-dist` | client parsing | browser-only, not in API routes |
| `jspdf` / `docx` | client PDF/DOCX export | browser-only |
| `sharp` | (unused server-side) | not imported in `src/app/api` |

## Edge runtime

- All API routes are `runtime = "edge"` → fast cold starts, no Node warmup.
- Middleware rate-limit map is per-isolate (lazy cleanup, no `setInterval` in
  global scope — correct for Workers).

## Recommendations (non-blocking)

- Consider `next/dynamic` for the heaviest admin dashboards (`Analytics`,
  `AIProviders`) if First Load on those routes is a concern.
- `recharts` charts could be dynamically imported to keep the initial bundle
  lean on non-analytics pages.

## Verdict

Performance is acceptable for production. Edge runtime + image/content
optimizations are correctly configured. The above are tuning opportunities,
not blockers.
