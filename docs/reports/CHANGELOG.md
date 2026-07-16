# Changelog

All notable changes to ResumeAI Pro are documented here. This project adheres
to [Semantic Versioning](https://semver.org/).

## [1.0.0] — 2026-07-16

### Added
- **Phase 8.1.5 — Interview Experience Platform**: Candidate Live Interview
  Experience, Recruiter Intelligence dashboard, Flight Recorder Console,
  Competency Analytics (radar/heatmap/benchmark/decision distribution),
  Executive Reports (PDF/Word/Markdown/Print/Share), Explainability UI,
  Scenario & Persona Management.
- **Decision Engine** + **Validation Engine** (with metrics + integration tests)
  consumed by Recruiter Intelligence.
- **Recruiter analytics lib** (`src/lib/recruiter`): candidate-intelligence,
  competency-analytics, decision-analytics, benchmark, timeline, executive-report,
  explainability.
- Flight Recorder store slice (`src/lib/store/flight-slice.ts`).
- Production release tooling: 12 OSS docs, `.env.example`, GitHub issue/PR
  templates, `scripts/deploy.sh`, and this changelog.
- Build hardening: `next.config.ts` enforces type-checking at build;
  `optimizePackageImports` extended to `recharts`/`date-fns`.

### Changed
- Canonical package manager standardized to **npm** (`package-lock.json`);
  `bun.lock` / `pnpm-lock.yaml` / `pnpm-workspace.yaml` removed.
- CI D1 migrations now applied via `wrangler d1 migrations apply` (state-tracked)
  instead of per-file `d1 execute` (which skipped migrations 0007–0015).

### Security
- Edge middleware ships security headers, SSRF allowlist, and rate limiting.
- `DEPLOYMENT.md` documents locking `CORS_ORIGIN` to a real domain for prod.

## [8.1.5] — 2026-07-16

Feature-complete Interview Experience Platform (see 1.0.0). Tagged `v8.1.5`
before the production-release finalization.

## Prior phases

Universal AI Pipeline · Enterprise AI Core · Prompt/Context Builders ·
Provider Router · Enterprise Flight Recorder · Reflection Engine · QA Engine ·
Validation Engine · Decision Engine · Adaptive Interview Engine · Recruiter
Intelligence & Analytics Platform. See `docs/reports/` for per-phase audit
reports.
