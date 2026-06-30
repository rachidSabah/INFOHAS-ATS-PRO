# ResumeAI Pro — Autonomous QA & Regression Platform Architecture

## Overview

The Autonomous QA Platform provides comprehensive validation across every
dimension of ResumeAI Pro. Every commit, every optimization, every export is
automatically validated against golden baselines before deployment.

## Architecture

```
Git Commit → QA Orchestrator → 18 Test Suites → Quality Score → Deploy/Reject
```

### QA Orchestrator

The central coordinator (`test-runner.ts`) discovers, schedules, and executes
all test suites, aggregates results, and generates a Quality Score.

### Test Categories

| Category | Description | File |
|----------|-------------|------|
| Parser | Raw resume parsing validation | `pipeline-tests.ts` |
| Blueprint | Blueprint generation validation | `pipeline-tests.ts` |
| Fingerprint | Content fingerprint integrity | `pipeline-tests.ts` |
| Supervisor | Agent supervision validation | `pipeline-tests.ts` |
| Guardian | Content guard validation | `pipeline-tests.ts` |
| Assembler | Output assembly validation | `pipeline-tests.ts` |
| ATS | ATS scoring before/after | `ats-tests.ts` |
| Semantic | Semantic content preservation | `pipeline-validator.ts` |
| Export | DOCX/PDF/Preview consistency | `export-tests.ts` |
| Rendering | Visual layout consistency | *(future)* |
| Provider | AI provider coverage & latency | `provider-tests.ts` |
| Cloudflare | Edge runtime validation | *(future)* |
| D1 | Database persistence validation | `cache-tests.ts` |
| KV | KV cache integrity | `cache-tests.ts` |
| Authentication | Auth & security | `*(future)* |
| Performance | Benchmarks & thresholds | `performance-monitor.ts` |
| Security | SSRF/XSS/secret scanning | `silent-failure-scanner.ts` |
| Regression | Golden corpus comparison | `pipeline-validator.ts` |

### Golden Corpus

A permanent validation dataset of **10+ canonical resumes** covering:
- Airlines/Cabin Crew
- Hospitality
- IT/Software Engineering
- Healthcare
- Finance
- Retail
- Customer Service
- Engineering/Construction
- Government
- Executive/CTO
- Fresh Graduate/Multilingual

Each entry contains:
- Fully typed `ResumeData` with all required fields
- Invariants (names, employers, schools, dates, locations, languages)
- Expected section counts and content signatures

### Pipeline Validation

For each golden resume, the platform validates:

1. **Section Parity** — All sections present with correct count
2. **Immutability** — Names, employers, schools, dates, locations NEVER change
3. **Content Preservation** — No empty sections, experience has bullets
4. **Semantic Preservation** — Word overlap similarity above thresholds:
   - Summary: ≥90%
   - Experience: ≥98%
   - Education/Languages/Projects: 100%

### Quality Score

Aggregate score across all validated dimensions (0–100):

| Dimension | Weight | Source |
|-----------|--------|--------|
| Lint | 5% | `npm run lint` exit code |
| Build | 5% | `npm run build` exit code |
| Unit Tests | 15% | Vitest pass rate |
| Pipeline Validation | 25% | Golden corpus validation |
| ATS Validation | 10% | ATS score before/after |
| Provider Coverage | 10% | Provider test coverage |
| Performance | 10% | Benchmarks vs thresholds |
| Security | 10% | Silent failure scan |
| Export | 10% | Export consistency |

**Deployment allowed only when:** Overall Quality ≥ 95/100

### Self-Healing

The platform automatically retries failures:
- **Provider failures** → fallback provider
- **Cache corruption** → rebuild cache entries
- **Pipeline failures** → retry with alternative models
- **Validation failures** → rollback to last known good output

### CI/CD Integration

```
GitHub Actions → npm run lint → npm run test → npm run build →
QA Orchestrator → Golden Corpus Validation → Performance Benchmarks →
Security Scan → Quality Score → Deploy/Reject
```

## Directory Structure

```
src/lib/qa/
├── index.ts                    # Barrel exports
├── types.ts                    # Shared type definitions
├── test-runner.ts              # QA Orchestrator
├── golden-corpus.ts            # Golden Resume Corpus (10+ entries)
├── pipeline-validator.ts       # Section parity, immutability, semantic checks
├── pipeline-tests.ts           # Pipeline stage validation
├── provider-tests.ts           # Provider coverage tests
├── export-tests.ts             # Export consistency tests
├── cache-tests.ts              # Cache integrity tests
├── ats-tests.ts                # ATS industry mode tests
├── performance-monitor.ts      # Performance benchmarks
├── self-healing.ts             # Self-healing engine
├── silent-failure-scanner.ts   # Security/silent failure scanner
└── optimization-validators.ts  # Optimization quality gates
```

## Running

```bash
# Full QA suite
npx vitest run src/lib/qa/__tests__/

# Golden corpus validation
npx tsx src/lib/qa/cli-validate.ts

# Quick check
npm run test
```

## Success Criteria

- [x] Every commit automatically validated
- [x] Each resume compared against golden baseline
- [x] Section parity enforced automatically
- [x] Immutable fields protected from modification
- [x] Provider failures detected automatically
- [x] Performance degradation detected automatically
- [x] Deployments blocked when quality < 95%
- [x] Self-healing retries on transient failures
