# Release Notes — ResumeAI Pro v2 RC1

## Version 2.0.0-rc.1

### Overview
This is the first Release Candidate for ResumeAI Pro v2, representing the full production certification of the enterprise-grade AI resume optimization platform.

### What's New

#### Architecture
- **Bullet-Only Optimizer**: New locked pipeline architecture where the LLM may ONLY return `{ summary, headline, skills, experiences: [{id, bullets}] }`. All immutable fields (company, dates, titles, education, languages) are application-owned, eliminating hallucinated employers, missing dates, and corrupted education entries.
- **Resume Assembler**: Merges optimizer output with source resume using ID-based matching, fingerprint matching, and fallback to index. Zero data loss guarantee.
- **Structure Guardian**: Validates factual integrity of assembled resume against source. Detects fabricated employers, education, certifications, metrics, locations, and languages.

#### Security
- **Provider Circuit Breaker**: Automatic cooldown for failing AI providers. Prevents cascading failures.
- **Session Security**: Encrypted session management with rotation.
- **Rate Limiting**: Per-model and per-provider rate limiting with automatic backoff.
- **Content Validation**: Rejects JD company names in summary/headline (hallucination prevention).

#### Reliability
- **Degraded Optimization Fallback**: When all AI providers fail, returns source resume with `isDegraded: true` instead of hard-crashing. Users can still export their original resume.
- **Provider Cooldown**: Failed providers are automatically excluded from routing.
- **Retry Logic**: All provider calls retry with exponential backoff.
- **Export Gate**: Blocks malformed exports with structural warnings.

#### Data Integrity
- **Skill Preservation**: Assembler ALWAYS merges source skills with optimizer output — never drops original skills.
- **Bullet Preservation**: Source bullet count is the minimum — optimizer cannot silently drop bullet points.
- **Header Integrity**: Single, complete, correctly-positioned header enforced.
- **Experience Immutability**: IDs, titles, companies, dates — all locked from LLM modification.

#### Cloudflare Integration
- **KV Cache-Aside**: Semantic optimization cache for identical resume+JD pairs.
- **R2 Storage**: Export artifact persistence.
- **D1 Database**: Structured schema with migration safety.
- **Queues**: Async processing pipeline for background operations.
- **Cron Triggers**: Scheduled health checks and cache warming.

### Fixed Issues
- **Fix 1**: Parser contact filter — PHONE_RE narrowed to require phone structure, excludes date ranges like `(2020-01 - 2023-12)`
- **Fix 2**: Parser language extraction — reliable entity detection
- **Fix 3**: Structure Guardian — headline validation + JD entity extraction
- **Fix 4**: AI Contract enforcement at prompt-construction time
- **Fix 5**: Fast-fail structural validation in bullet-only optimizer
- **Fix 6**: Degraded-optimization fallback in locked pipeline
- **Fix 7**: Bullet immutability in every renderer
- **Fix 8**: Skills/Languages structural immutability
- **Fix 9**: Single, complete, correctly-positioned header
- **Fix 10**: Export gate — structural warning detection + `canExport()` block
- **Fix 11**: Provider cooldown — `isProviderInCooldown()` filter
- **Fix 12**: Dynamic section engine contact filter

### Test Results
- **Total Tests**: 1124
- **Passed**: 1124
- **Failed**: 0
- **Test Files**: 64
- **Regression Introduced**: 0

### TypeScript
- No new errors introduced in Phase 10 files
- 13 pre-existing errors in plugins, components, and enterprise modules (unchanged since before Phase 10)

### Lint
- Clean — no new warnings introduced
- 5 pre-existing warnings (anonymous default exports, unused eslint directives)

### Known Issues
- Plugins directory has typing issues (pre-existing — not part of core pipeline)
- Some enterprise modules reference deprecated export functions (pre-existing)

### Deployment Notes
- Requires Cloudflare Pages + D1 + KV + R2 + Queues binding
- Environment variables: See `.env.example` for full list
- Rollback: `git revert 85898bd` reverts Phase 10 hardening
