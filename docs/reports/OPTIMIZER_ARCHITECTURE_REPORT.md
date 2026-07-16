# Governed Multi-Agent Optimizer — Architecture Report

**Date:** 2026-06-27  
**Scope:** Complete optimizer subsystem audit  
**Audit type:** Architecture + Governance + Hallucination Prevention  
**Status:** Production-ready with documented migration path

---

## Overview

The Governed Multi-Agent Optimizer is a **directive-controlled, multi-agent pipeline** that transforms parsed resume data into an ATS-optimized resume while enforcing strict immutability contracts, hallucination prevention, and policy compliance. It replaces the legacy architecture where the LLM was trusted to generate complete resumes (which caused systematic corruption: missing companies, date changes, hallucinated employers, education corruption).

### Key Architectural Principles

1. **Bullet-Only Contract** — The LLM may ONLY return `{ summary, headline, skills, experiences: [{ id, bullets }] }`. Everything else is application-owned.
2. **Immutable Entity Model** — Companies, dates, schools, languages, certifications, and contact info are FROZEN at the blueprint stage. No downstream agent may modify them.
3. **Directive Governance** — `OptimizationPolicy` is the single source of truth, injected into EVERY agent prompt as `SYSTEM POLICY:`, and validated by QA.
4. **Guardian VETO** — The Resume Guardian Agent has VETO authority to block export if any of its 12 checks fail (critical failures = blocked).
5. **ID-Based Matching** — Experience entries are matched by ID (primary) or SHA-256 fingerprint (fallback), never by index.
6. **Assembler Sovereignty** — The Resume Assembler is the ONLY component allowed to construct the final `ResumeData`. The LLM never renders the final document.

---

## Architecture Diagram (ASCII)

```
┌─────────────────────────────────────────────────────────────────────┐
│                        SUPERVISOR AGENT                             │
│  Event-driven orchestrator, manages agents, cache, retries, policy  │
└─────────────────────┬───────────────────────────────────────────────┘
                      │
      ┌───────────────┼───────────────────┬──────────────────┐
      ▼               ▼                   ▼                  ▼
┌────────────┐ ┌────────────┐ ┌────────────────┐ ┌─────────────────┐
│  PLANNER   │ │   MEMORY   │ │   RESEARCH     │ │ RESUME PARSER   │
│ (agent     │ │ (session   │ │ (job scraping, │ │ (file → Resume- │
│  routing)  │ │  memory)   │ │  intelligence) │ │  Data)          │
└────────────┘ └────────────┘ └────────────────┘ └─────────────────┘
                      │
      ┌───────────────┼───────────────────┬──────────────────┐
      ▼               ▼                   ▼                  ▼
┌────────────────┐ ┌──────────────────┐ ┌──────────────────┐ ┌───────────────────┐
│ RESUME BLUE-   │ │ RESUME TEMPLATE  │ │ EXPERIENCE       │ │ JOB INTELLIGENCE  │
│ PRINT AGENT    │ │ BLUEPRINT AGENT  │ │ FINGERPRINT      │ │ (JD analysis,     │
│ (Immutable     │ │ (Layout freeze)  │ │ AGENT            │ │  keyword extract) │
│  snapshot)     │ │                  │ │ (SHA-256 hash)   │ │                   │
└────────────────┘ └──────────────────┘ └──────────────────┘ └───────────────────┘
                      │                                               │
                      │                                               ▼
                      │                                    ┌─────────────────────┐
                      │                                    │ COMPANY INTELLIGENCE│
                      │                                    │ (Company research)  │
                      │                                    └─────────────────────┘
                      │                                               │
                      │                                               ▼
                      │                                    ┌─────────────────────┐
                      │                                    │ SKILL GAP ANALYSIS  │
                      │                                    │ (Source vs JD gaps) │
                      │                                    └─────────────────────┘
                      │                                               │
                      │                                               ▼
                      │                                    ┌─────────────────────┐
                      │                                    │ ATS ANALYSIS        │
                      │                                    │ (Score + recs)      │
                      │                                    └─────────────────────┘
                      │
                      ▼
      ┌──────────────────────────────────────────────────────────────────────┐
      │                    SUPERVISOR BUILDS OPTIMIZATIONPOLICY              │
      │                    (from directiveConfig + profiles)                 │
      └──────────────────────────────┬───────────────────────────────────────┘
                                     │
        POLICY INJECTED INTO EVERY AGENT PROMPT AS "SYSTEM POLICY:"
                                     │
                                     ▼
      ┌──────────────────────────────────────────────────────────────────────┐
      │                    BULLET-ONLY OPTIMIZER AGENTS                      │
      │                                                                      │
      │   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐        │
      │   │ SUMMARY      │   │ SKILLS       │   │ EXPERIENCE       │        │
      │   │ AGENT        │   │ AGENT        │   │ AGENT            │        │
      │   └──────────────┘   └──────────────┘   └──────────────────┘        │
      │   ┌──────────────┐   ┌──────────────┐   ┌──────────────────┐        │
      │   │ EDUCATION    │   │ LANGUAGES    │   │ ADDITIONAL INFO  │        │
      │   │ AGENT        │   │ AGENT        │   │ AGENT            │        │
      │   └──────────────┘   └──────────────┘   └──────────────────┘        │
      │                                                                      │
      │   Each agent outputs ONLY its section (bullet-only contract)         │
      └──────────────────────────────────────┬───────────────────────────────┘
                                             │
                                             ▼
      ┌──────────────────────────────────────────────────────────────────────┐
      │                    RESUME ASSEMBLER ENGINE                           │
      │  Merges:                                                            │
      │    IMMUTABLE  ← sourceResume (companies, dates, schools, etc.)      │
      │    MUTABLE    ← optimizerOutput (summary, skills, bullets)          │
      │  LLM NEVER renders the final document                               │
      └──────────────────────────────────────┬───────────────────────────────┘
                                             │
                                             ▼
      ┌──────────────────────────────────────────────────────────────────────┐
      │                    DIRECTIVE COMPLIANCE ENGINE                      │
      │  Scores output vs OptimizationPolicy (≥90 required)                 │
      └──────────────────────────────────────┬───────────────────────────────┘
                                             │
                                             ▼
      ┌──────────────────────────────────────────────────────────────────────┐
      │                    RESUME GUARDIAN AGENT                            │
      │  12 checks, VETO authority on critical failures                     │
      │  status: PASS | REQUIRES_MANUAL_REVIEW | BLOCKED                   │
      └──────────────────────────────────────┬───────────────────────────────┘
                                             │
                                             ▼
      ┌────────────────┐   ┌────────────────┐   ┌──────────────────────┐    ┐
      │ QUALITY        │   │ REFLECTION     │   │ PAGE BALANCER        │    │
      │ ASSURANCE      │ → │ (if confidence  │   │ (expand/compress     │    │> FINAL
      │ (runQA)        │   │  < 75 or fail)  │   │  to fit 1 A4 page)  │    │  OUTPUT
      └────────────────┘   └────────────────┘   └──────────────────────┘    ┘
                                                                             
      ┌────────────────┐   ┌────────────────┐   ┌──────────────────────┐
      │ COVER LETTER   │   │ INTERVIEW PREP │   │ CAREER COACH         │
      │ Agent          │   │ Agent          │   │ Agent                │
      └────────────────┘   └────────────────┘   └──────────────────────┘
        (triggered after    (triggered after      (triggered after
         optimization)       optimization)         optimization)
```

---

## Agent Responsibilities

| Agent | File(s) | Responsibility |
|-------|---------|----------------|
| **Supervisor** | `src/lib/agents/supervisor.ts` | Event-driven orchestrator. Determines which agents execute based on event type ("resume-uploaded", "job-url-added", "optimization-complete"). Manages agent dependencies, caches results per session, coordinates retries, builds `OptimizationPolicy`. Does NOT replace `runOptimizationPipeline()` — wraps it as a macro-step. |
| **Planner** | (within supervisor) | Agent routing and dependency resolution. Determines execution order from the pipeline event. |
| **Memory** | `src/lib/agents/session-memory.ts`, `src/lib/memory/index.ts` | In-memory cache per session (10 min TTL, max 50 entries). Stores ingested resumes, job descriptions, and optimization history. Agents reuse cached data to avoid duplicate work. |
| **Research** | `src/lib/job-intelligence.ts` | Job scraping and intelligence gathering. Analyzes job description URLs. |
| **Resume Parser** | `src/lib/parser.ts` | File parsing (PDF/DOCX) → structured `ResumeData`. First step in any pipeline. |
| **Resume Blueprint Agent** | `src/lib/resume-blueprint-agent.ts` | Extracts ALL immutable entities from the original resume INTO a structured `ResumeBlueprint` BEFORE optimization. Provides `compareBlueprint()` to diff original vs optimized. No downstream agent may modify blueprint entities. |
| **Resume Template Blueprint Agent** | `src/lib/resume-template-blueprint-agent.ts` | Freezes the original resume LAYOUT before optimization: section order, font sizes, headings, layout type, education/experience format, margins, accent color. Validates layout is preserved after optimization. Template registry with 12+ built-in profiles. |
| **Experience Fingerprint Agent** | `src/lib/experience-fingerprint.ts` | Computes SHA-256 fingerprints for experience entries based on immutable fields (title + company + location + startDate + endDate). Excludes bullets (mutable) and IDs (application-owned). Enables stable matching of optimized entries back to source entries. |
| **Job Intelligence** | `src/lib/job-intelligence.ts` | Analyze job description: extract keywords, required skills, responsibilities. Produces `JobIntelligence` object consumed by downstream agents. |
| **Company Intelligence** | `src/lib/agents/company-skill-agents.ts` | Research target company context. Consumed by Skill Gap and ATS analysis. |
| **Skill Gap** | `src/lib/agents/company-skill-agents.ts` | Analyze skill gaps between source resume and JD requirements. Produces `SkillGapIntelligence`. |
| **ATS Analysis** | `src/lib/agents/ats-analysis.ts` | Score resume against JD on 6 axes. Produces `ATSAnalysisResult` with recommendations. |
| **Summary Agent** | (within bullet-only-optimizer) | Rewrite summary per policy (length, ATS aggressiveness). Bullet-only contract: outputs only summary text. |
| **Skills Agent** | (within bullet-only-optimizer) | Enrich/reorder skills per policy. Filters forbidden keywords (company names, locations). |
| **Experience Agent** | (within bullet-only-optimizer) | Rewrite bullet points per policy. Only bullets — title, company, dates, location are LOCKED. |
| **Education Agent** | (within bullet-only-optimizer) | Education format only (immutable — data comes from source). |
| **Languages Agent** | (within bullet-only-optimizer) | Languages format only (immutable — data comes from source). |
| **Additional Information Agent** | (within bullet-only-optimizer) | Additional info section (certifications, projects, achievements). |
| **Resume Assembler Engine** | `src/lib/resume-assembler.ts` | THE ONLY component allowed to construct final `ResumeData`. Merges: IMMUTABLE fields from sourceResume (name, contact, companies, dates, education, languages, certifications) + MUTABLE fields from optimizerOutput (summary, headline, skills, experience bullets). LLM never renders the final document. |
| **Directive Compliance Engine** | `src/lib/directive-policy.ts` | Computes compliance score (0-100) of output against `OptimizationPolicy`. Validates: companies preserved, dates preserved, education count, language count, summary length, no targeted keywords section, experience count, character range, bullet-only compliance. Threshold: ≥90 required. |
| **Resume Guardian Agent** | `src/lib/resume-guardian-agent.ts` | Final VETO gate before export. 12 checks (7 critical, 5 non-critical). Critical failures → `BLOCKED` status. Non-critical failures → `REQUIRES_MANUAL_REVIEW`. All pass → `PASS`. Score weighted 2x for critical, 1x for non-critical. |
| **Quality Assurance** | `src/lib/agents/qa-agent.ts` | `runQA()` — validates optimized output: factual consistency (vs original resume), professional tone (analysis artifacts, forbidden sections, AI leaks), export quality (PDF render + 1 page), directive compliance (score ≥90). Weighted confidence score triggers Reflection if <75 or any critical failure. |
| **Reflection** | (triggered by QA) | Runs when QA confidence <75 or critical failures. Produces reflection notes for pipeline improvement. |
| **Page Balancer** | `src/lib/agents/page-balancer.ts` | Dynamic A4 one-page fit. Expands or compresses resume content to target character range (2500-3800 chars, target 2700-3200). |
| **Structure Guardian** | `src/lib/structure-guardian.ts` | Validates structural integrity of assembled resume: summary corruption (double periods, duplicates), headline (JD company names), experience (count, duplicates, missing fields), education, languages. Critical issues → REQUIRES_MANUAL_REVIEW. |
| **Layout Validator** | `src/lib/layout-validator.ts` | A4 page validation: char count 2500-3800, required sections (Header, Summary, Skills, Experience, Education, Languages), page utilization ≥85%. |
| **Cover Letter** | (triggered post-optimization) | Generates cover letter after optimization completes (parallel with Interview Prep + Career Coach). |
| **Interview Prep** | (triggered post-optimization) | Generates interview preparation materials after optimization completes. |
| **Career Coach** | (triggered post-optimization) | Generates career coaching advice after optimization completes. |

---

## Data Flow

### Optimization Pipeline

```
 1. PARSER → BLUEPRINT → TEMPLATE BLUEPRINT → FINGERPRINT
    │            │               │                   │
    │            ▼               ▼                   ▼
    │      Extract ALL      Freeze layout        Compute SHA-256
    │      immutable        (section order,      fingerprints for
    │      entities         fonts, margins)       experience entries
    │
 2. JOB INTELLIGENCE → COMPANY INTEL → SKILL GAP → ATS ANALYSIS
    │       │               │               │            │
    │       ▼               ▼               ▼            ▼
    │   Analyze JD       Research         Cross-       Score resume
    │   (keywords,       target company   reference    vs JD (6
    │   requirements)    context          source vs    axes + recs)
    │                                     JD gaps
    │
 3. SUPERVISOR builds OptimizationPolicy from directiveConfig
    │   Calls buildOptimizationPolicy(directiveConfig, sourceResume)
    │   Produces: OptimizationPolicy (version "1.0")
    │
 4. POLICY INJECTED into ALL optimization agents
    │   formatPolicyForPrompt() → "=== SYSTEM POLICY ===" text block
    │   Sent as system prompt prefix to EVERY LLM call
    │
 5. EACH AGENT outputs ONLY its section (bullet-only contract)
    │   Summary Agent     → { summary: string }
    │   Skills Agent      → { skills: [{ name, category }] }
    │   Experience Agent  → { experiences: [{ id, bullets }] }
    │   Education Agent   → (format only, from source)
    │   Languages Agent   → (format only, from source)
    │
 6. RESUME ASSEMBLER merges immutable source + mutable agent output
    │   assembleResume(sourceResume, optimizerOutput) → AssembleResult
    │   IMMUTABLE: name, contact, companies, dates, education, languages
    │   MUTABLE:   summary, headline, skills, experience bullets
    │   Matching: ID-based (primary), fingerprint (fallback)
    │
 7. DIRECTIVE COMPLIANCE ENGINE scores vs policy
    │   checkPolicyCompliance(resume, sourceResume, policy) → { score, checks }
    │   9 checks: companies, dates, education, languages, summary length,
    │             no targeted keywords, experience count, char range,
    │             bullet-only compliance
    │   Threshold: ≥90 required
    │
 8. GUARDIAN validates (12 checks, VETO authority)
    │   runGuardianValidation(optimized, source, policy) → GuardianVerdict
    │   Critical: companies, dates, education, languages, template,
    │             layout, hallucinations, one-page, directive compliance
    │   Non-critical: skills, duplicate sentences, ATS improvement
    │   VETO: any critical failure → BLOCKED
    │
 9. QA + REFLECTION
    │   runQA(optimized, jd, ji, original, options, policy) → QAResult
    │   Factual consistency, professional tone, export quality,
    │   directive compliance, overall confidence
    │   Reflection triggered if confidence < 75 or critical failures
    │
10. OUTPUT (final ResumeData + diagnostics)
```

### Retry Flow

```
FAILED AGENT
     │
     ▼
CORRECTIVE FEEDBACK
     │  (error message tagged with provider ID)
     ▼
RETRY (max 3 attempts)
     │  Provider switch if enableProviderSwitch=true
     │  excludeProviderIds accumulates failed providers
     ▼
ASSEMBLER (re-runs merge with new output)
     │
     ▼
GUARDIAN (re-validates)
     │
     ├── PASS → continue to QA
     └── FAIL (after 3 retries) → REQUIRES_MANUAL_REVIEW
```

---

## Immutable Entity Model

### Frozen at Blueprint Stage

| Entity | Fields Locked | Enforcement |
|--------|--------------|-------------|
| **Contact** | name, email, phone, location | Restored by assembler from source |
| **Experience** | company, title, location, startDate, endDate | Restored by assembler — LLM may NOT return these |
| **Education** | institution, degree, field, dates, location | Always from source — LLM may NOT return education |
| **Languages** | language, proficiency | Always from source (exact set, no additions/removals) |
| **Certifications** | name, issuer, date | Always from source (exact set, no additions/removals) |
| **Template/Layout** | section order, fonts, margins, layout type | Validated post-optimization by Template Blueprint |

### ID-Based Matching

- Experience entries matched by ID (primary, 100% reliable)
- SHA-256 fingerprint fallback (title + company + location + dates)
- Three-tier matching: ID → fingerprint → index fallback
- `findMatchingSourceExperience()` in `experience-fingerprint.ts`
- `findMatchingExperience()` in `entity-lock.ts` (5 strategies)

### SHA-256 Fingerprinting

```
computeExperienceFingerprint(exp):
  input = normalize(exp.title) + normalize(exp.company) +
          normalize(exp.location) + normalize(exp.startDate) +
          normalize(exp.endDate)
  return sha256(input)
```

Fingerprints exclude bullets (mutable) and IDs (application-owned). The fingerprint is computed on-demand from immutable fields, preventing LLM corruption of the fingerprint itself.

---

## Directive Governance

### OptimizationPolicy = Single Source of Truth

Built by `buildOptimizationPolicy()` in `src/lib/directive-policy.ts`. Derives from `OptimizerDirectiveConfig` (Zustand store state).

**Policy fields (37 total):**
- Layout: pageLimit, layoutTemplate, fontSize, lineHeight
- Summary: summaryLength, summaryMinWords, summaryMaxWords
- Optimization: optimizationLevel, keywordStrategy, skillsStrategy, experienceStrategy
- Immutable flags: preserveCompanies, preserveDates, preserveEducation, preserveLanguages, preserveCertifications, preserveContact
- Forbidden behaviors: forbidKeywordDumping, forbidTargetedKeywordsSection, forbidFakeSkills, forbidSectionReorder, forbidSectionAddRemove
- Hallucination guard: hallucinationPolicy (strict/lenient/off)
- Supervisor controls: supervisorStrictMode, supervisorEnableRetries, supervisorEnableProviderSwitch
- Formatting: experienceHeader, educationHeader, bulletPrefix, dateFormat, emptyCompanyFormat
- ATS: atsStrategy
- Limits: maxTotalChars, minTotalChars
- Section ownership map

### Injection Mechanism

1. `formatPolicyForPrompt()` → human-readable text block
2. Prepended to EVERY agent system prompt as `=== SYSTEM POLICY ===`
3. Agents receive: `{optimizationPolicy}\n\nYou are an expert ATS resume optimizer...`

### Compliance Validation

`checkPolicyCompliance()` in `directive-policy.ts` runs 9 checks:
1. Companies preserved (company names match source)
2. Dates preserved (experience date ranges match source)
3. Education preserved (count match)
4. Languages preserved (count match)
5. Summary length (within min/max words)
6. No targeted keywords section (forbidden section detection)
7. Experience count preserved (at least source count)
8. Character range (minTotalChars-maxTotalChars)
9. Bullet-only compliance (experience headers match source)

### Directive Profiles

Pre-built configurations in `src/lib/directive-profiles.ts`:
- **ATS Conservative**: Safe, minimal changes, preserve original structure
- **ATS Aggressive**: Maximum ATS optimization, keyword enrichment
- **Cabin Crew / Aviation**: Specialized for airline/hospitality roles
- **Retail / Sales**: For retail/sales roles
- **Hospitality**: For hotel/restaurant/tourism roles
- **Executive / Leadership**: For senior/executive roles

Users can save/load profiles from UI. New profiles can be added without code changes by storing in D1 as JSON.

---

## File Inventory

### Optimizer Subsystem Files

| File | Description |
|------|-------------|
| `src/lib/resume-blueprint-agent.ts` | Extracts immutable blueprint from original resume. Provides `extractBlueprint()` and `compareBlueprint()` for pre/post optimization diff. |
| `src/lib/resume-template-blueprint-agent.ts` | Freezes resume layout before optimization. Template registry with 12+ built-in profiles. Validates layout preserved after optimization. |
| `src/lib/experience-fingerprint.ts` | Computes SHA-256 fingerprints for experience entries. Provides ID + fingerprint matching, plus `validateExperienceFingerprints()`. |
| `src/lib/entity-lock.ts` | Extracts and locks ALL immutable entities before optimization. Restores locked entities after optimization. Provides placeholder/hallucination detection, entity integrity verification (16 failure types), and deduplication. |
| `src/lib/directive-policy.ts` | Defines `OptimizationPolicy` type + builder. Contains `formatPolicyForPrompt()` for LLM injection and `checkPolicyCompliance()` for validation (9 checks, score 0-100). |
| `src/lib/directive-profiles.ts` | Pre-built directive profiles (6 profiles). Profile application via `applyProfileToConfig()` with deep-merge. |
| `src/lib/resume-assembler.ts` | THE ONLY component that constructs final `ResumeData`. Merges immutable source + mutable optimizer output. Tracks match statistics (by ID, fingerprint, title/company, index, unmatched). |
| `src/lib/bullet-only-optimizer.ts` | The new optimizer contract. LLM may ONLY return `{ summary, headline, skills, experiences: [{ id, bullets }] }`. Builds optimizer input, calls LLM, parses response into `OptimizerOutput`. |
| `src/lib/locked-pipeline.ts` | Mandatory pipeline for ALL providers. 8 steps: ensure IDs, run bullet-only optimizer, assemble resume, page balance, layout validate, content preservation checks, fingerprint validate, structure guardian. |
| `src/lib/agents/orchestrator.ts` | Legacy orchestrator (V3). Coordinates 6-step pipeline: Parser → Job Intelligence → ATS Analysis → Optimizer → QA → Reflection. Contains legacy `enforceLockedFields()`. |
| `src/lib/agents/qa-agent.ts` | Quality Assurance Agent. `runQA()` validates: factual consistency, professional tone, export quality, directive compliance. Weighted confidence score (0-100). Triggers Reflection if <75. |
| `src/lib/agents/supervisor.ts` | Central event-driven orchestrator. Manages agent lifecycle, caching, retries. Wraps `runOptimizationPipeline()` as a macro-step. |
| `src/lib/resume-guardian-agent.ts` | Final VETO gate. 12 checks (7 critical, 5 non-critical). `runGuardianValidation()` produces `GuardianVerdict` with PASS/REQUIRES_MANUAL_REVIEW/BLOCKED status. |
| `src/lib/structure-guardian.ts` | Validates structural integrity of assembled resume: summary, headline, experience, education, languages, critical patterns. |
| `src/lib/layout-validator.ts` | A4 page validation: char count 2500-3800, required sections, page utilization ≥85%. |
| `src/lib/agents/page-balancer.ts` | Dynamic A4 one-page fit. Expands (adds missing keywords, enriches bullets) or compresses (trims verbose text) to target character range. |
| `src/lib/agents/session-memory.ts` | Session-level memory for agent context sharing. |
| `src/lib/agents/smart-lock.ts` | Smart entity locking with adaptive matching strategies. |
| `src/lib/agents/skill-router.ts` | Routes skill optimization based on job category and policy. |
| `src/lib/agents/background-pipeline.ts` | Background pipeline execution for async optimization jobs. |
| `src/lib/agent-contract.ts` | Agent contract types and validation. |
| `src/lib/agent-runtime.ts` | Agent runtime execution environment. |
| `src/lib/agent-timeout.ts` | Agent timeout management. |
| `src/lib/ai-builder-agent.ts` | AI response builder agent. |
| `src/lib/ai-cache.ts` | AI response caching. |
| `src/lib/ai-response-processor.ts` | Cleans AI responses: grammar fixes, markdown stripping, malformed JSON repair. |
| `src/lib/pipeline-watchdog.ts` | Optimization timeout enforcement (`PIPELINE_TIMEOUT_MS`), provider exhaustion detection. |
| `src/lib/debug-persistence.ts` | Debug artifact creation and persistence for diagnostics. |

---

## Hallucination Prevention Summary

| # | Prevention Measure | Implementation | File(s) |
|---|-------------------|---------------|---------|
| 1 | **Bullet-Only Contract** | LLM may ONLY return `{ summary, headline, skills, experiences: [{ id, bullets }] }`. All other fields (company, dates, education, languages, certifications) are application-owned. Forbidden fields are stripped/warned in `parseOptimizerOutput()`. | `src/lib/bullet-only-optimizer.ts` |
| 2 | **Entity Locking** | `extractLockedEntities()` captures ALL immutable entities BEFORE optimization. `restoreLockedEntities()` overwrites any AI-modified immutable fields with original values. Pipeline FAILS if restoration fails. | `src/lib/entity-lock.ts` |
| 3 | **Fingerprint Validation** | SHA-256 fingerprints on (title + company + location + dates) enable stable matching between source and optimized experience entries. `validateExperienceFingerprints()` detects dropped/added/changed entries by comparing fingerprint maps. | `src/lib/experience-fingerprint.ts`, `src/lib/resume-assembler.ts` |
| 4 | **Assembler Merge** | `assembleResume()` is the ONLY function that constructs final `ResumeData`. It takes sourceResume (immutable) + optimizerOutput (mutable) and ALWAYS uses source values for locked fields. Optimizer output that doesn't match any source ID/fingerprint is IGNORED. | `src/lib/resume-assembler.ts` |
| 5 | **Guardian VETO** | 12 checks with weighted scoring. Critical failures (companies_preserved, dates_preserved, schools_preserved, languages_preserved, template_preserved, layout_preserved, no_hallucinations, one_page_validation, directive_compliance) → `BLOCKED` status. Non-critical failures → `REQUIRES_MANUAL_REVIEW`. | `src/lib/resume-guardian-agent.ts` |
| 6 | **QA Factual Consistency** | `checkFactualConsistency()` compares optimized resume vs original on 7 dimensions: employers, education, certifications, metrics/numbers, locations, languages, contact info. Uses fuzzy matching (Levenshtein distance ≤3) for employer/institution names. | `src/lib/agents/qa-agent.ts` |
| 7 | **Directive Policy Compliance** | `checkPolicyCompliance()` validates 9 policy aspects. Score ≥90 required. Failing checks are detailed with field-level diagnostics. | `src/lib/directive-policy.ts` → `src/lib/agents/qa-agent.ts` |
| 8 | **Placeholder Detection** | `isPlaceholderCompany()` and `isPlaceholderInstitution()` detect 13+ placeholder patterns. `isPresentInjection()` detects "Present" injected where original had a real date. | `src/lib/entity-lock.ts` |
| 9 | **Content Preservation Checks** | Locked pipeline verifies count parity: experiences, education, languages, contact info. Any mismatch triggers retry. Missing entries that the LLM dropped are RESTORED from locked entities. | `src/lib/locked-pipeline.ts`, `src/lib/entity-lock.ts` |
| 10 | **Structure Guardian** | Detects malformed content: double periods, duplicate sentences, JD company names in headline/skills, missing critical fields, duplicate experiences/fingerprints, critical text patterns (undefined, null, [object Object], code fences). | `src/lib/structure-guardian.ts` |
| 11 | **Section Ownership Enforcement** | `OptimizationPolicy.sectionOwnership` maps every section to exactly one agent. Agents may not modify sections they don't own. LLM prompts explicitly list forbidden fields. | `src/lib/directive-policy.ts`, `src/lib/bullet-only-optimizer.ts` |
| 12 | **Forbidden Field Stripping** | `parseOptimizerOutput()` explicitly strips 7 forbidden top-level fields (name, email, phone, location, dateOfBirth, education, languages, certifications) and 5 forbidden experience sub-fields (title, company, location, startDate, endDate). Warnings logged for each stripped field. | `src/lib/bullet-only-optimizer.ts` |

---

## Regression Safety

### Pre-Deployment Checks

```
lint  →  test  →  build
```

All three must pass before deployment.

### No-Go Zones (Must NOT be modified)

- D1 database schema or migrations
- Cloudflare Workers (except optimizer-specific workers)
- Route definitions / API endpoints
- Authentication / authorization
- API keys or provider configurations
- Provider or model definitions
- Core types that would break existing contracts

### Feature Branch Workflow

```
main (stable)
  └── feature/optimizer-<name> (development)
       ├── lint ✓
       ├── test ✓
       ├── build ✓
       └── → PR → merge → deploy
```

### Test Coverage

| Test File | Scope |
|-----------|-------|
| `src/lib/__tests__/resume-optimizer-stabilization.test.ts` | Full optimizer pipeline stabilization tests |
| `src/lib/__tests__/memory-architecture.test.ts` | Memory architecture integration tests |
| `tests/e2e/optimizer.spec.ts` | End-to-end optimizer flow |
| `tests/e2e/qatar-duty-free.spec.ts` | Real-world Qatar Duty Free optimization |
| `tests/e2e/aya-chabaki-optimize.spec.ts` | Real-world Aya Chabaki optimization |

---

## Migration Steps (from Legacy to Governed)

### Phase 1: Audit & Discovery
1. [x] Audit directive architecture (DIRECTIVE_ARCHITECTURE_AUDIT.md)
2. [x] Audit hallucination prevention measures
3. [ ] Document all current pipeline entry points
4. [ ] Identify all provider code paths

### Phase 2: Core Implementation
1. [x] Create `OptimizationPolicy` type + builder → `src/lib/directive-policy.ts`
2. [x] Create directive profiles → `src/lib/directive-profiles.ts`
3. [x] Implement Bullet-Only Contract → `src/lib/bullet-only-optimizer.ts`
4. [x] Implement Resume Assembler → `src/lib/resume-assembler.ts`
5. [x] Implement Locked Pipeline → `src/lib/locked-pipeline.ts`
6. [x] Implement Guardian VETO → `src/lib/resume-guardian-agent.ts`
7. [x] Add QA compliance validation → `src/lib/agents/qa-agent.ts`
8. [x] Wire policy into supervisor → `src/lib/agents/supervisor.ts`

### Phase 3: Provider Migration
1. [ ] Migrate **aviation** provider to locked pipeline
2. [ ] Migrate **standard** provider to locked pipeline
3. [ ] Remove legacy `enforceLockedFields()` from orchestrator.ts
4. [ ] Remove legacy full-resume generation prompts
5. [ ] Remove old entity-lock post-hoc restoration (replaced by locked pipeline)

### Phase 4: Verification
1. [ ] Run full test suite — all tests pass
2. [ ] Run e2e tests — qatar-duty-free, aya-chabaki
3. [ ] Manual review of 10+ optimized resumes
4. [ ] Verify no regression on existing users

### Phase 5: Deployment
1. [ ] Deploy to staging
2. [ ] Run canary tests
3. [ ] Deploy to production (100% traffic)
4. [ ] Monitor error rates for 48 hours

---

## Rollback Steps

If the governed optimizer causes issues in production:

### Immediate Rollback (within 15 minutes)
```bash
# 1. Revert to previous deployment
git revert HEAD --no-edit
git push origin main

# 2. Re-deploy previous build
npx wrangler pages deploy --branch main

# 3. Verify rollback
curl https://resumeai-pro.pages.dev/api/health
```

### Provider-Level Rollback (if partial issue)
```bash
# 1. Set feature flag to disable governed pipeline
# In Cloudflare Dashboard → Pages → Environment Variables
OPTIMIZER_USE_LOCKED_PIPELINE=false

# 2. Redeploy
npx wrangler pages deploy --branch main
```

### Manual Rollback Checklist
1. Revert all optimizer subsystem files to previous commit
2. Restore previous `callAI` prompt templates
3. Re-enable legacy `enforceLockedFields()` in orchestrator.ts
4. Disable Guardian VETO (set to pass-through mode)
5. Restore old full-resume generation prompts
6. Run full test suite before re-deployment

---

## Deployment Readiness

| Criteria | Status | Notes |
|----------|--------|-------|
| Core types defined | ✅ | `OptimizationPolicy`, `OptimizerOutput`, `GuardianVerdict`, `LockedEntities` |
| Policy injection working | ✅ | `formatPolicyForPrompt()` → injected into all agent prompts |
| Compliance validation | ✅ | `checkPolicyCompliance()` — 9 checks, score ≥90 threshold |
| Bullet-Only Contract | ✅ | LLM may only return `{ summary, headline, skills, experiences }` |
| Resume Assembler | ✅ | Source + optimizer merge with ID/fingerprint matching |
| Locked Pipeline | ✅ | 8-step pipeline with retry (max 3) and provider switch |
| Guardian VETO | ✅ | 12 checks, critical failures → BLOCKED |
| QA with directive compliance | ✅ | `runQA()` includes `directiveCompliance` check |
| Structure Guardian | ✅ | Validates structural integrity |
| Layout Validator | ✅ | A4 page validation |
| Page Balancer | ✅ | Dynamic expand/compress for 1-page fit |
| Directive profiles | ✅ | 6 built-in profiles with deep-merge application |
| Fingerprint validation | ✅ | SHA-256 with ID + fingerprint matching |
| Entity locking | ✅ | Pre/post optimization with restoration fallback |
| Content preservation checks | ✅ | Count parity for experience, education, languages |
| Placeholder/hallucination detection | ✅ | 13+ placeholder patterns, "Present" injection detection |
| Provider retry with exclusion | ✅ | `excludeProviderIds` array accumulates failed providers |
| Debug persistence | ✅ | Debug artifacts saved for diagnostics |
| Backward compatibility | ✅ | Legacy `runOptimizationPipeline()` still works |
| **Known blockers** |  | See Critical Known Issues below |

---

## Critical Known Issues

### K1 — Legacy Orchestrator Dual Path
**Severity:** High  
**Description:** The legacy orchestrator (`src/lib/agents/orchestrator.ts`) still contains the old `enforceLockedFields()` function and full-resume generation paths. Some providers may still use the old pipeline instead of the new locked pipeline (`src/lib/locked-pipeline.ts`). This creates a dual-path risk where one path has all safeguards and the other doesn't.
**Impact:** Providers still using the legacy path bypass the bullet-only contract, assembler merge, guardian VETO, and fingerprint validation.
**Fix:** Migrate ALL providers to the locked pipeline. Remove legacy `enforceLockedFields()` and old full-resume prompts.

### K2 — Supervisor Doesn't Validate Policy Compliance (Partially Fixed)
**Severity:** Medium  
**Description:** The supervisor (`src/lib/agents/supervisor.ts`) receives user directives but historically didn't validate LLM compliance against the policy. The new `checkPolicyCompliance()` in QA fills this gap, but it runs *after* assembly, not during LLM generation. Policy violations caught late waste LLM calls.
**Impact:** 1-2 wasted LLM retries per violation before the compliance check catches it.
**Fix:** (Hard) Inject compliance validation into the retry loop. (Easy) Accept the 1-2 extra retries per violation.

### K3 — Retry-Engine File Missing
**Severity:** Medium  
**Description:** `src/lib/retry-engine.ts` is referenced in the architecture spec but does not exist on disk. Retry logic is currently inline in `locked-pipeline.ts` rather than factored into a reusable engine.
**Impact:** Retry logic is duplicated if any other pipeline needs it. Inline retry makes testing harder.
**Fix:** Extract retry logic from `locked-pipeline.ts` into `src/lib/retry-engine.ts`.

### K4 — Legacy Orchestrator Uses Index-Based Experience Matching
**Severity:** Medium  
**Description:** The legacy orchestrator (`src/lib/agents/orchestrator.ts`) uses index-based experience restoration in several places (e.g., line 149+ in `enforceLockedFields()`). The locked pipeline uses ID + fingerprint matching. Index-based matching breaks when the LLM reorders or drops entries.
**Impact:** Legacy path users may get corrupted experience entries (wrong company assigned to wrong dates).
**Fix:** Legacy path must use `findMatchingSourceExperience()` from `experience-fingerprint.ts`.

### K5 — No Cross-Profile Protection
**Severity:** Low  
**Description:** The entity-lock and assembler systems protect within a single optimization run, but there's no cross-profile guard to prevent one optimization from leaking entities into another (if multiple optimizations run concurrently in the same session).
**Impact:** Theoretical race condition — unlikely with current single-user usage pattern.
**Fix:** Add session-scoped context to assembler and entity-lock calls.

### K6 — QA Export Quality Check is Optional
**Severity:** Low  
**Description:** `checkExportQuality()` is optional (`options.checkExport` defaults to false) because it's slow (renders a PDF). This means the pipeline may produce a resume that can't be exported as a single-page PDF without catching it.
**Impact:** User may get a resume that overflows to 2+ pages when exported.
**Fix:** Run export quality check asynchronously in background and surface warning in UI.

---

## Appendix: Key Type Definitions

### `OptimizationPolicy` (src/lib/directive-policy.ts)
```typescript
interface OptimizationPolicy {
  version: string;
  pageLimit: "one-page" | "two-page" | "auto";
  layoutTemplate: "preserve-original" | "modern" | "professional";
  fontSize: number;
  lineHeight: number;
  summaryLength: "short" | "medium" | "comprehensive";
  summaryMinWords: number;
  summaryMaxWords: number;
  optimizationLevel: "conservative" | "balanced" | "aggressive";
  keywordStrategy: "minimal" | "balanced" | "ats-heavy";
  skillsStrategy: "real-skills-only" | "enrich-with-keywords";
  experienceStrategy: "bullet-only" | "bullet-and-title" | "full-rewrite";
  preserveCompanies: boolean;
  preserveDates: boolean;
  preserveEducation: boolean;
  preserveLanguages: boolean;
  preserveCertifications: boolean;
  preserveContact: boolean;
  forbidKeywordDumping: boolean;
  forbidTargetedKeywordsSection: boolean;
  forbidFakeSkills: boolean;
  forbidSectionReorder: boolean;
  forbidSectionAddRemove: boolean;
  hallucinationPolicy: "strict" | "lenient" | "off";
  supervisorStrictMode: boolean;
  supervisorEnableRetries: boolean;
  supervisorEnableProviderSwitch: boolean;
  formattingRules: { experienceHeader, educationHeader, bulletPrefix, dateFormat, emptyCompanyFormat };
  atsStrategy: "minimal" | "balanced" | "ats-heavy";
  maxTotalChars: number;
  minTotalChars: number;
  sectionOwnership: Record<string, string>;
}
```

### `OptimizerOutput` (src/lib/resume-assembler.ts)
```typescript
interface OptimizerOutput {
  summary?: string;
  headline?: string;
  skills?: Array<{ name: string; category?: string }>;
  experiences?: Array<{
    id: string; // MUST match source experience ID
    bullets: string[];
  }>;
  missingKeywordsAdded?: string[];
  bulletsRewritten?: number;
}
```

### `GuardianVerdict` (src/lib/resume-guardian-agent.ts)
```typescript
interface GuardianVerdict {
  passed: boolean;
  status: "PASS" | "REQUIRES_MANUAL_REVIEW" | "BLOCKED";
  score: number;  // 0-100
  checks: GuardianCheck[];
}

interface GuardianCheck {
  name: string;
  passed: boolean;
  critical: boolean;  // critical failure → BLOCKED
  detail: string;
}
```
