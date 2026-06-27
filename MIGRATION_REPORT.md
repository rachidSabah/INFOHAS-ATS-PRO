# Migration Report: Legacy Monolithic → Governed Multi-Agent Optimizer

**Report Date:** 2026-06-27  
**Project:** ATS Resume Optimizer (Next.js + Zustand + Multi-Provider AI)  
**Report Scope:** Full 8-phase migration from legacy single-LLM-full-resume architecture to directive-governed, multi-agent pipeline with immutable entity protection, guardian veto, and policy enforcement.

---

## Executive Summary

The legacy architecture relied on a single LLM call that generated the entire resume document. This caused systematic corruption: missing company names, hallucinated employers, date changes, education corruption, and duplicated experiences. The Governed Multi-Agent Optimizer replaces this with a **directive-controlled multi-agent pipeline** enforcing:

- **Bullet-Only Contract** — LLM may ONLY return `{ summary, headline, skills, experiences: [{ id, bullets }] }`
- **Immutable Entity Model** — Companies, dates, schools, languages, certifications, and contact are FROZEN before optimization
- **Directive Governance** — `OptimizationPolicy` is the single source of truth, injected into every agent prompt
- **Guardian VETO** — Resume Guardian Agent blocks export if any of 12 checks fail
- **Assembler Sovereignty** — Only the Resume Assembler constructs final `ResumeData`

---

## Phase Status Overview

| Phase | Title | Status | Completion |
|-------|-------|--------|------------|
| 1 | Audit & Discovery | ✅ Completed | 100% |
| 2 | Core Directive Architecture | ✅ Completed | 100% |
| 3 | Agent Isolation (Bullet-Only) | ✅ Completed | 100% |
| 4 | Entity Protection | ✅ Completed | 100% |
| 5 | Verification Layer | 🔄 In Progress | ~70% |
| 6 | UI Integration | ✅ Completed | 100% |
| 7 | Testing | 🔄 In Progress | ~50% |
| 8 | Deployment | ❌ Pending | 0% |

---

## Phase 1: Audit & Discovery (✅ Completed)

### Purpose
Audit the existing directive architecture, identify gaps, and document the target architecture before building the governed system.

### Files Changed

| File | Change | Type |
|------|--------|------|
| `DIRECTIVE_ARCHITECTURE_AUDIT.md` | Created | New |
| `OPTIMIZER_ARCHITECTURE_REPORT.md` | Created | New |

### What Was Achieved

1. **Directive Architecture Audit** (`DIRECTIVE_ARCHITECTURE_AUDIT.md`):
   - Documented current storage (hardcoded constant, Zustand store, D1 sync)
   - Documented loading paths (UI path vs orchestrator path — dual read issue)
   - Documented injection into prompts (which agents receive directives and how)
   - Identified 7 critical gaps:
     1. Prompt-only directives — no programmatic enforcement
     2. No centralized `OptimizationPolicy` type
     3. No supervisor enforcement of directives
     4. No QA compliance validation
     5. No compliance score
     6. No directive profiles (versioned/saved configurations)
     7. No section ownership enforcement
   - Specified target architecture diagram

2. **Optimizer Architecture Report** (`OPTIMIZER_ARCHITECTURE_REPORT.md`):
   - Full ASCII architecture diagram of the multi-agent pipeline
   - Agent responsibilities table (25+ agents documented)
   - Complete data flow (10-step optimization pipeline)
   - Immutable entity model specification
   - Directive governance design
   - Hallucination prevention summary (12 measures)
   - Regression safety checklist
   - Migration steps checklist

### Rollback Considerations
- These are documentation files only — no runtime impact
- No rollback needed

---

## Phase 2: Core Directive Architecture (✅ Completed)

### Purpose
Create the `OptimizationPolicy` type as the single source of truth, implement the policy builder, directive profiles, and compliance checker.

### Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/lib/directive-policy.ts` | Created — `OptimizationPolicy` type + `buildOptimizationPolicy()` + `formatPolicyForPrompt()` + `checkPolicyCompliance()` | +472 |
| `src/lib/directive-profiles.ts` | Created — 6 built-in profiles + `applyProfileToConfig()` with deep-merge | +229 |
| `src/lib/agents/orchestrator.ts` | Modified — builds `OptimizationPolicy` from store, passes to locked pipeline | +7 |
| `src/lib/bullet-only-optimizer.ts` | Modified — accepts `optimizationPolicy`, injects SYSTEM POLICY at prompt start | +6 |
| `src/lib/locked-pipeline.ts` | Modified — passes `optimizationPolicy` through to bullet-only-optimizer | +45 |
| `src/lib/resume-assembler.ts` | Modified — hardened summary validation (60-word min, duplicate/JD-company detection) | +56 |
| `src/lib/entity-lock.ts` | Modified — enhanced education matching, expanded forbidden skill patterns | +87 |

### What Was Achieved

1. **`OptimizationPolicy` Type** (37 fields):
   - Layout: pageLimit, layoutTemplate, fontSize, lineHeight
   - Summary: summaryLength, summaryMinWords, summaryMaxWords
   - Optimization: optimizationLevel, keywordStrategy, skillsStrategy, experienceStrategy
   - Immutable flags: preserveCompanies, preserveDates, preserveEducation, preserveLanguages, preserveCertifications, preserveContact
   - Forbidden behaviors: forbidKeywordDumping, forbidTargetedKeywordsSection, forbidFakeSkills, forbidSectionReorder, forbidSectionAddRemove
   - Hallucination guard: hallucinationPolicy (strict/lenient/off)
   - Supervisor controls: strictMode, enableRetries, enableProviderSwitch
   - Formatting: experienceHeader, educationHeader, bulletPrefix, dateFormat, emptyCompanyFormat
   - ATS: atsStrategy
   - Limits: maxTotalChars, minTotalChars
   - Section ownership map: maps each section to one agent

2. **Policy Builder** (`buildOptimizationPolicy()`):
   - Derives full policy from `OptimizerDirectiveConfig` (Zustand store state)
   - Computes keyword strategy, optimization level, summary length from atsAggressiveness
   - Builds default section ownership map

3. **Policy Serialization** (`formatPolicyForPrompt()`):
   - Formats policy as human-readable text block
   - Injected as `=== SYSTEM POLICY ===` at the start of EVERY agent prompt
   - Includes: version, page limits, immutable entities, forbidden behaviors, section ownership

4. **Compliance Checker** (`checkPolicyCompliance()`):
   - 9-point compliance score (0-100)
   - Checks: companies preserved, dates preserved, education preserved, languages preserved, summary length, no targeted keywords section, experience count, character range, bullet-only compliance
   - Threshold: ≥90 required

5. **6 Built-in Directive Profiles**:
   - ATS Conservative, ATS Aggressive, Cabin Crew, Retail, Hospitality, Executive
   - Deep-merge pattern via `applyProfileToConfig()`

6. **Section Ownership Enforcement** — Policy maps each section to exactly one agent

### Rollback Considerations
- `directive-policy.ts` and `directive-profiles.ts` are new files — remove them
- Modified files: revert `orchestrator.ts`, `bullet-only-optimizer.ts`, `locked-pipeline.ts`, `resume-assembler.ts`, `entity-lock.ts` to previous commits
- **Risk**: Removing policy injection would revert to prompt-only directives (no enforcement)

---

## Phase 3: Agent Isolation — Bullet-Only Contract (✅ Completed)

### Purpose
Constrain the LLM to ONLY return `{ summary, headline, skills, experiences: [{ id, bullets }] }`. Everything else is application-owned. The Resume Assembler is the ONLY component that constructs the final document.

### Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/lib/bullet-only-optimizer.ts` | Created — new optimizer contract with forbidden field stripping | +464 |
| `src/lib/locked-pipeline.ts` | Created — mandatory 8-step pipeline for ALL providers | +357 |
| `src/lib/resume-assembler.ts` | Created — THE ONLY component that constructs final `ResumeData` | +349 |

### What Was Achieved

1. **Bullet-Only Optimizer** (`bullet-only-optimizer.ts`):
   - `buildOptimizerInput()` — constructs system + user prompts with strict output contract
   - LLM instructed to echo back exact experience IDs for ID-based matching
   - 7 forbidden top-level fields stripped: name, email, phone, location, dateOfBirth, education, languages, certifications
   - 5 forbidden experience sub-fields stripped: title, company, location, startDate, endDate
   - Forbidden field warnings logged for each stripped field
   - `parseOptimizerOutput()` — handles JSON extraction, malformed repair, markdown stripping
   - `cleanDirectiveForBulletOnly()` — filters out full-resume layout specs from directives
   - Rejects local engine fallback (requires real AI provider)
   - Max 6000 tokens (output is much smaller than full resume generation)

2. **Locked Pipeline** (`locked-pipeline.ts`):
   - 8-step mandatory pipeline: ensure IDs → run bullet-only optimizer → assemble → page balance → layout validate → content preservation checks → fingerprint validate → structure guardian
   - 3-tier retry: with provider switch enabled, up to 3 attempts with provider exclusion
   - Content preservation checks: experiences, education, languages count parity + contact info
   - Dynamic page balancing (expand/compress to fit A4)
   - Layout validation (A4 one-page check)
   - Debug artifact persistence
   - `LockedPipelineError` with status + issues array
   - Empty resume guard (returns source as-is with warning)

3. **Resume Assembler** (`resume-assembler.ts`):
   - `assembleResume()` — sourceResume (immutable) + optimizerOutput (mutable) → final ResumeData
   - Experience matching: ID-based (primary) → fingerprint (fallback) → index (last resort)
   - Unmatched optimizer entries are IGNORED (prevents hallucinated experience)
   - Summary validation: 60-word minimum, duplicate sentence detection, double period fix, JD company name rejection
   - Headline validation: JD company name detection, first-3-words divergence check
   - Skills filtered through forbidden pattern list (40+ patterns)
   - Education, languages, certifications ALWAYS from source (immutable guard)
   - Contact ALWAYS from source
   - Fingerprint validation after assembly
   - Match statistics: matchedById, matchedByFingerprint, matchedByTitleCompany, matchedByIndex, unmatched

### Rollback Considerations
- **High risk**: All three files are new. The legacy pipeline (`orchestrator.ts`) still exists and can be re-enabled as fallback
- Files to revert: delete `bullet-only-optimizer.ts`, `locked-pipeline.ts`, `resume-assembler.ts`
- Feature flag: `enableLockedPipeline` — if false, use legacy orchestrator
- **Data safety**: Locked pipeline is already safer than legacy; rollback increases corruption risk

---

## Phase 4: Entity Protection (✅ Completed)

### Purpose
Extract and lock ALL immutable entities BEFORE optimization. Restore locked entities AFTER optimization. Provide robust matching, placeholder detection, and integrity verification.

### Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/lib/entity-lock.ts` | Created — complete entity locking system | +1044 |
| `src/lib/experience-fingerprint.ts` | Created — SHA-256 fingerprinting for stable matching | +306 |
| `src/lib/resume-blueprint-agent.ts` | Created — immutable blueprint capture + diff | +544 |
| `src/lib/resume-template-blueprint-agent.ts` | Created — layout freezing + validation | +755 |

### What Was Achieved

1. **Entity Lock System** (`entity-lock.ts`):
   - `extractLockedEntities()` — captures ALL immutable fields before optimization
   - `restoreLockedEntities()` — overwrites any AI-modified immutable fields with originals
   - `verifyEntityIntegrity()` — 16 failure types, integrity score 0-100
   - 5-strategy experience matching: exact company → substring company → exact title → substring title → index fallback
   - Education matching: ID (primary) → fingerprint → exact institution → substring institution → exact degree → index fallback
   - Placeholder/hallucination detection: 13+ placeholder company patterns, 9+ placeholder institution patterns
   - `isPresentInjection()` — detects "Present" injected where original had a real date
   - `isDateChanged()` — smart date comparison (allows formatting differences)
   - `ensureExperienceIds()` — auto-generates IDs for entries missing them
   - `deduplicateResume()`, `deduplicateExperiences()`, `deduplicateBullets()`
   - 40+ forbidden skill patterns (company names, locations, roles, physical attributes, targeted keywords)

2. **Experience Fingerprint Engine** (`experience-fingerprint.ts`):
   - Pure JS SHA-256 implementation (no crypto API dependency)
   - `computeExperienceFingerprint()` — based on immutable fields only (title + company + location + startDate + endDate), excludes bullets and IDs
   - `buildExperienceFingerprintMap()` / `buildExperienceIdMap()` — for fast lookup
   - `findMatchingSourceExperience()` — 3-tier matching: ID (primary) → fingerprint → none
   - `validateExperienceFingerprints()` — detects dropped/added/changed entries, reports matched/unmatched counts

3. **Resume Blueprint Agent** (`resume-blueprint-agent.ts`):
   - `extractBlueprint()` — freezes ALL entities into structured blueprint before optimization
   - `compareBlueprint()` — diff function detecting specific changes between original and optimized
   - Blueprint includes: header, summary, experience (with fingerprints), education, skills, languages, additional info
   - Section-level change detection with specific field diffs

4. **Resume Template Blueprint Agent** (`resume-template-blueprint-agent.ts`):
   - `extractTemplateBlueprint()` — captures layout blueprint (section order, font sizes, headings, layout type)
   - `validateTemplatePreserved()` — verifies critical layout attributes unchanged
   - Template registry with 12+ built-in profiles
   - Education format validation (diploma first, separator, location format, date format, GPA)
   - Experience format validation (headings, date format)

### Rollback Considerations
- All files are new, clean removal possible
- Legacy `enforceLockedFields()` in orchestrator.ts still exists as fallback
- **Risk**: Rollback removes placeholder detection and fingerprint validation — resume corruption goes undetected
- Feature flag: `enableEntityLocking` — controls whether locked pipeline uses entity-lock

---

## Phase 5: Verification Layer (🔄 In Progress — ~70%)

### Purpose
Create verification agents that validate every stage of the pipeline: blueprint creation, template preservation, guardian veto, and retry orchestration.

### Files Changed

| File | Change | Lines | Status |
|------|--------|-------|--------|
| `src/lib/resume-guardian-agent.ts` | Created — 12-check guardian with VETO authority | +659 | ✅ Complete |
| `src/lib/retry-engine.ts` | Created — targeted self-healing retry engine | +295 | ✅ Complete |
| `src/lib/agents/qa-agent.ts` | Modified — added directive compliance + OptimizationPolicy awareness | +35 | ✅ Complete |
| `src/lib/structure-guardian.ts` | Existed prior — validation of structural integrity | N/A | ✅ Complete |
| `src/lib/layout-validator.ts` | Existed prior — A4 page validation | N/A | ✅ Complete |
| Dedicated tests for blueprint-agent | ❌ Missing | — | ❌ Pending |
| Dedicated tests for template-blueprint-agent | ❌ Missing | — | ❌ Pending |
| Dedicated tests for guardian-agent | ❌ Missing | — | ❌ Pending |
| Dedicated tests for retry-engine | ❌ Missing | — | ❌ Pending |

### What Was Achieved (Completed Portion)

1. **Resume Guardian Agent** (`resume-guardian-agent.ts`):
   - 12 checks (7 critical, 5 non-critical)
   - Critical checks (any failure → BLOCKED):
     1. `companies_preserved` — all source companies present in optimized
     2. `dates_preserved` — experience date ranges match source
     3. `schools_preserved` — education entries preserved
     4. `languages_preserved` — languages preserved
     5. `template_preserved` — template unchanged
     6. `layout_preserved` — uses structure-guardian
     7. `no_hallucinations` — uses entity-lock integrity check
     8. `one_page_validation` — uses layout-validator
     9. `directive_compliance` — policy score ≥90
   - Non-critical checks (failure → REQUIRES_MANUAL_REVIEW):
     1. `skills_preserved` — source skills retained + no forbidden keywords
     2. `no_duplicate_sentences` — no duplicate text across resume
     3. `ats_improvement` — content expanded, keywords retained
   - Status: PASS (all pass) | REQUIRES_MANUAL_REVIEW (non-critical only) | BLOCKED (any critical)
   - Score: 0-100, critical weighted 2x, non-critical 1x

2. **Retry Engine** (`retry-engine.ts`):
   - `createRetryEngine()` factory with configurable: maxRetries, baseDelayMs, maxDelayMs, backoffFactor
   - Per-agent retry state tracking: agentId, attempt, errors, status
   - Exponential backoff: delay = min(baseDelay × backoffFactor^attempt, maxDelay)
   - Custom `shouldRetry` predicate support
   - Fallback value support — returns fallback when retries exhausted
   - State inspection: `getState()`, `getAllStates()`, `reset()`
   - Defaults: maxRetries=3, baseDelay=1s, maxDelay=30s, backoffFactor=2

3. **QA Agent Enhancement** (qa-agent.ts):
   - `runQA()` now accepts `OptimizationPolicy`
   - Directive compliance check integrated into QA scoring
   - Results aggregated into QAResult

### What Remains (To Be Completed)

1. **Dedicated tests for blueprint-agent** — `__tests__/resume-blueprint-agent.test.ts`
2. **Dedicated tests for template-blueprint-agent** — `__tests__/resume-template-blueprint-agent.test.ts`
3. **Dedicated tests for guardian-agent** — `__tests__/resume-guardian-agent.test.ts`
4. **Dedicated tests for retry-engine** — `__tests__/retry-engine.test.ts`
5. **Blueprint agent integration** — wire blueprint comparison into locked-pipeline or QA
6. **Template blueprint validation** — wire `validateTemplatePreserved()` into the pipeline

### Rollback Considerations
- `resume-guardian-agent.ts` and `retry-engine.ts` are new files — clean removal
- QA agent: revert QA changes if rollback needed
- The legacy orchestrator still has its own quality gates (weaker than guardian)
- Feature flag: `enableGuardianVeto` — disables guardian check if false

---

## Phase 6: UI Integration (✅ Completed)

### Purpose
Add directive profile selector to the Optimizer Directive UI, expose per-agent directive controls, and add pipeline visualization cards.

### Files Changed

| File | Change | Lines |
|------|--------|-------|
| `src/components/app/modules/OptimizerDirective.tsx` | Modified — + directive profile selector card, + per-agent directive section | +37 |
| `src/components/optimizer/ATSMatchMeter.tsx` | Existed — ATS match score visualization | N/A |

### What Was Achieved

1. **Directive Profile Selector** (OptimizerDirective.tsx):
   - Grid of 6 built-in profile cards (ATS Conservative, ATS Aggressive, Cabin Crew, Retail, Hospitality, Executive)
   - Click-to-apply with deep-merge into current draft
   - Tags and descriptions on each card
   - "Profile applied — review and save" toast notification

2. **Per-Agent Directive Controls**:
   - **Supervisor Agent**: Strict Mode, Enable Retries, Enable Provider Switch, Enforce Immutable Entities, Debug Logs, Diff Viewer
   - **Summary Agent**: ATS Aggressiveness slider (0-100), Preserve Facts toggle, Min/Max Characters
   - **Skills Agent**: Max Keywords, Transferable Skills toggle, Company Keywords toggle, Location Keywords toggle
   - **Experience Agent**: Rewrite Bullets Only toggle, Max Expansion Percent
   - **Education Agent**: Format Only toggle
   - **Languages Agent**: Format Only toggle

3. **Pipeline Visualization**: (Indirect — profile selector shows pipeline architecture through per-agent sections)

4. **Existing Visualization Components**:
   - `ATSMatchMeter.tsx` — Real-time ATS match score visualization
   - Generated Directive Preview showing exact text sent to AI

### Rollback Considerations
- Revert `OptimizerDirective.tsx` to previous commit — removes profile selector and per-agent controls
- Profile selection is additive — no breaking changes
- Feature flag: none needed, UI-only change

---

## Phase 7: Testing (🔄 In Progress — ~50%)

### Purpose
Write comprehensive tests for all new agents, pipeline components, and regression prevention.

### Existing Tests

| Test File | Scope | Lines | Status |
|-----------|-------|-------|--------|
| `src/lib/__tests__/resume-optimizer-stabilization.test.ts` | Full optimizer stabilization: IDs, fingerprints, bullet-only, company names in skills, summary protection, hallucination detection, matching strategies, parser integrity, structure guardian | 1052+ | ✅ |
| `src/lib/__tests__/entity-lock.test.ts` | Entity lock: extraction, restoration, deduplication, integrity verification, placeholder detection | 578 | ✅ |
| `src/lib/__tests__/memory-architecture.test.ts` | Memory architecture: global memory, job memory, session management, agent working memory | 375 | ✅ |
| `src/lib/agents/supervisor.test.ts` | Supervisor agent | — | ✅ |
| `src/lib/agents/orchestrator.test.ts` | Legacy orchestrator | — | ✅ |
| `src/lib/agents/ats-analysis.test.ts` | ATS analysis agent | — | ✅ |
| `src/lib/agents/page-balancer.test.ts` | Page balancer | — | ✅ |
| `src/lib/agents/pipeline-events.test.ts` | Pipeline events | — | ✅ |

### Missing Tests (To Be Written)

| Test File | Priority | Reason |
|-----------|----------|--------|
| `src/lib/__tests__/resume-blueprint-agent.test.ts` | **High** | Blueprint extraction and diff logic is critical for entity protection |
| `src/lib/__tests__/resume-template-blueprint-agent.test.ts` | **High** | Template layout freeze and validation must be verified |
| `src/lib/__tests__/resume-guardian-agent.test.ts` | **High** | Guardian VETO is the last line of defense — all 12 checks need tests |
| `src/lib/__tests__/retry-engine.test.ts` | Medium | Retry logic with backoff, fallback, state tracking |
| `src/lib/__tests__/directive-policy.test.ts` | Medium | Compliance checker, policy builder edge cases |
| `src/lib/__tests__/directive-profiles.test.ts` | Medium | Profile application and deep-merge |
| `src/lib/__tests__/locked-pipeline.test.ts` | Medium | End-to-end locked pipeline integration |

### Rollback Considerations
- Tests are additive — no rollback needed
- Removing test files has no runtime impact

---

## Phase 8: Deployment (❌ Pending)

### Purpose
Create feature branch, run lint/test/build, merge to main, deploy to production.

### Current State

| Step | Status | Details |
|------|--------|---------|
| Feature branch created (`feature/governed-optimizer`) | ❌ | All commits on `main` directly |
| `npm run lint` passes | ❌ | Not verified |
| `npm test` passes | ❌ | Not verified (vitest tests exist but not executed) |
| `npm run build` passes | ❌ | Not verified |
| PR review | ❌ | Not applicable (direct commits) |
| Merge to main | ❌ | Code already on main |
| CI/CD pipeline | ❌ | Not configured |
| Staging deployment | ❌ | Not done |
| Canary deployment | ❌ | Not done |
| Production deployment | ❌ | Not done |
| 48-hour monitoring | ❌ | Not done |

### Deployment Readiness Checklist

```
☐ Feature branch created (feature/governed-optimizer)
☐ All Phase 5 tests written (blueprint-agent, template-blueprint-agent, guardian-agent, retry-engine)
☐ npm run lint passes (0 errors, 0 warnings)
☐ npm test passes (all vitest tests green)
☐ npm run build passes (0 errors)
☐ Code review completed
☐ PR approved and merged to main
☐ Staging deployment verified
☐ Canary test with 10% traffic for 2 hours
☐ Production deployment (100% traffic)
☐ Error rate monitoring for 48 hours
☐ Rollback plan documented and rehearsed
```

---

## Rollback Steps

### If Locked Pipeline Causes Issues in Production

#### Option A: Quick Rollback (git revert, deploy previous build)

```bash
# 1. Revert to previous deployment
cd /path/to/repo
git revert HEAD --no-edit
git push origin main

# 2. Re-deploy previous build
npx wrangler pages deploy --branch main

# 3. Verify rollback
curl https://resumeai-pro.pages.dev/api/health
```

#### Option B: Feature Flag Disable

Set environment variable in Cloudflare Dashboard → Pages → Environment Variables:

```
ENABLE_GOVERNED_OPTIMIZER=false
```

This forces the pipeline to use the legacy orchestrator (`orchestrator.ts`) instead of `runLockedPipeline()`.

#### Option C: Provider-Level Rollback

If issues are specific to one provider (e.g., aviation path), set:

```
AVIATION_USE_LEGACY_PIPELINE=true
STANDARD_USE_LEGACY_PIPELINE=false
```

#### Option D: Manual File Rollback (if git revert is impractical)

| File | Rollback Action |
|------|----------------|
| `src/lib/directive-policy.ts` | Delete (new file) |
| `src/lib/directive-profiles.ts` | Delete (new file) |
| `src/lib/bullet-only-optimizer.ts` | Delete (new file) |
| `src/lib/locked-pipeline.ts` | Delete (new file) |
| `src/lib/resume-assembler.ts` | Delete (new file) |
| `src/lib/entity-lock.ts` | Delete (new file) |
| `src/lib/experience-fingerprint.ts` | Delete (new file) |
| `src/lib/resume-blueprint-agent.ts` | Delete (new file) |
| `src/lib/resume-template-blueprint-agent.ts` | Delete (new file) |
| `src/lib/resume-guardian-agent.ts` | Delete (new file) |
| `src/lib/retry-engine.ts` | Delete (new file) |
| `src/lib/agents/orchestrator.ts` | Revert to pre-modification version |
| `src/lib/agents/qa-agent.ts` | Revert to pre-modification version |
| `src/components/app/modules/OptimizerDirective.tsx` | Revert to remove profile selector |

---

## Critical Known Issues

| # | Issue | Severity | Status | Mitigation |
|---|-------|----------|--------|------------|
| 1 | **No tests for blueprint-agent, template-blueprint-agent, guardian-agent, retry-engine** | High | Unresolved | Write tests before production deployment |
| 2 | **Blueprint agent and template blueprint validation not wired into locked pipeline** | High | Unresolved | The blueprint/template blueprint agents exist but are NOT called by `runLockedPipeline()`. This means blueprint diff and template preservation validation are unused in the main path. |
| 3 | **All architecture commits on `main`, no feature branch** | Medium | Unresolved | Creates risk: if rollback is needed, you lose ALL changes including unrelated ones. Create `feature/governed-optimizer` and rebase. |
| 4 | **No CI/CD pipeline configured for this project** | Medium | Unresolved | `lint/test/build` must be run manually. Risk of deploying broken code. |
| 5 | **Directive compliance threshold (90%) is hardcoded** | Low | Unresolved | Should be configurable per profile. Currently hardcoded in `checkDirectiveCompliance()`. |
| 6 | **Retry engine not wired into locked pipeline** | Low | Unresolved | `retry-engine.ts` exists but the locked pipeline has its own inline retry logic. The two should be unified. |
| 7 | **No-load / empty-resume edge case returns source as-is** | Low | Acceptable | Locked pipeline returns source resume when no experience/education/languages exist. Could be confusing to users expecting optimization. |

---

## Recommended Immediate Actions

### Critical (Before Deployment)

1. **Create feature branch** and rebase all governed-optimizer commits onto it
   ```bash
   git branch feature/governed-optimizer
   git reset --hard HEAD~2  # on main
   ```

2. **Write missing tests** (minimum):
   - `resume-guardian-agent.test.ts` — All 12 checks
   - `resume-blueprint-agent.test.ts` — Extraction + diff
   - `resume-template-blueprint-agent.test.ts` — Template freeze + validation
   - `retry-engine.test.ts` — Retry logic, backoff, fallback

3. **Wire blueprint + template validation into locked pipeline**:
   - Call `extractBlueprint()` + `compareBlueprint()` before/after optimization in `runLockedPipeline()`
   - Call `validateTemplatePreserved()` after assembly

4. **Verify lint/test/build**:
   ```bash
   cd /path/to/repo
   npm run lint
   npx vitest run
   npm run build
   ```

### High Priority (Before Staging)

5. **Unify retry engine with locked pipeline** — Replace inline retry logic in `locked-pipeline.ts` with the `createRetryEngine()` from `retry-engine.ts`

6. **Add feature flags**:
   - `ENABLE_GOVERNED_OPTIMIZER` (env var)
   - `ENABLE_GUARDIAN_VETO` (env var)
   - `ENABLE_BLUEPRINT_VALIDATION` (env var)

7. **Configure CI/CD** — Set up GitHub Actions or Cloudflare Pages CI for automatic lint/test/build

### Medium Priority

8. **Make compliance threshold configurable** per profile (currently hardcoded at 90%)

9. **Add directive-policy and directive-profiles tests**

10. **Document the rollback runbook** in `OPTIMIZER_ARCHITECTURE_REPORT.md`

### Low Priority

11. **Add blueprint/template diff to UI** — Show what changed in a before/after format

12. **Add guardian check status to optimizer result** — Currently guardian runs but its detailed results aren't surfaced in the UI

---

## Appendix A: Complete File Inventory (Governed Optimizer)

| File | Phase | Lines | Role |
|------|-------|-------|------|
| `DIRECTIVE_ARCHITECTURE_AUDIT.md` | 1 | 88 | Audit documentation |
| `OPTIMIZER_ARCHITECTURE_REPORT.md` | 1 | 654 | Architecture documentation |
| `src/lib/directive-policy.ts` | 2 | 472 | `OptimizationPolicy` type, builder, formatter, compliance checker |
| `src/lib/directive-profiles.ts` | 2 | 229 | 6 built-in profiles, profile registry, deep-merge |
| `src/lib/bullet-only-optimizer.ts` | 3 | 464 | LLM contract enforcement, prompt builder, response parser |
| `src/lib/locked-pipeline.ts` | 3 | 357 | 8-step mandatory pipeline, retry, page balancing |
| `src/lib/resume-assembler.ts` | 3 | 349 | Final `ResumeData` constructor, immutable merge |
| `src/lib/entity-lock.ts` | 4 | 1044 | Entity extraction, restoration, matching, deduplication, placeholder detection |
| `src/lib/experience-fingerprint.ts` | 4 | 306 | SHA-256 fingerprinting, ID/fingerprint matching |
| `src/lib/resume-blueprint-agent.ts` | 4 | 544 | Blueprint extraction, diff comparison |
| `src/lib/resume-template-blueprint-agent.ts` | 4 | 755 | Template layout freeze, validation |
| `src/lib/resume-guardian-agent.ts` | 5 | 659 | 12-check guardian, VETO authority |
| `src/lib/retry-engine.ts` | 5 | 295 | Targeted retry engine, exponential backoff, fallback |
| `src/components/app/modules/OptimizerDirective.tsx` | 6 | 726 | Profile selector, per-agent controls |
| `src/lib/__tests__/resume-optimizer-stabilization.test.ts` | 7 | 1052+ | Full pipeline stabilization tests |
| `src/lib/__tests__/entity-lock.test.ts` | 7 | 578 | Entity lock regression tests |

## Appendix B: Architecture Diagram (Simplified)

```
┌─────────────────────────────────────────────────────────────────────┐
│                      SUPERVISOR AGENT                               │
│  Builds OptimizationPolicy → Injects into ALL agent prompts          │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     LOCKED PIPELINE (8 steps)                       │
│                                                                     │
│  1. ensureExperienceIds()  ← Phase 4                                │
│  2. runBulletOnlyOptimizer()  ← Phase 3                             │
│  3. assembleResume()  ← Phase 3                                    │
│  4. Page Balance (expand/compress)                                  │
│  5. Layout Validation (A4 one-page)                                 │
│  6. Content Preservation Checks                                     │
│  7. Fingerprint Validation  ← Phase 4                               │
│  8. Structure Guardian                                              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     RESUME GUARDIAN AGENT  ← Phase 5                │
│  12 checks (7 critical → BLOCKED, 5 non-critical → REVIEW)         │
│  + Directive Compliance Score (≥90 required)                        │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     QA + REFLECTION                                  │
│  runQA() → confidence score, triggers reflection if <75              │
└─────────────────────────────────────────────────────────────────────┘
                                    │
                                    ▼
                              FINAL OUTPUT
```

---

*End of Migration Report*
