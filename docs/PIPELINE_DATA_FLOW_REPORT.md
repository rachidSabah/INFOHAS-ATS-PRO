# Pipeline Data Flow Audit Report

**Repository**: `C:\Users\InGodWeTrust\Downloads\ATS PRO`
**Date**: 2026-06-27
**Scope**: Full data flow trace: Parser → Blueprint → Optimizer → Assembler → QA → Guardian → Export

---

## Executive Summary

The pipeline has **two distinct paths**:

1. **Locked Pipeline** (default, recommended): The LLM returns ONLY mutable fields (summary, skills, bullets). The application-owned `ResumeAssembler` merges them with immutable source data. This path has the strongest integrity guarantees.

2. **Standard/Legacy Path** (fallback when source has no content): The LLM generates a full resume. Locked fields are restored after the fact via `enforceLockedFields` / `finalizeResume`, which is less reliable.

Both paths share the same QA → Guardian → Export stages after optimization.

---

## Stage 1: Parser

**File**: `src/lib/parser.ts`
**Function chain**: `parseResumeFile` → `extractResumeFromText` (primary) → `secondaryParser` → `heuristicParser` (fallbacks)

### Input
- Raw text from PDF (pdfjs-dist), DOCX (mammoth), or TXT files
- File name for metadata

### Output: `ResumeData`
| Field | Shape | Source |
|-------|-------|--------|
| `id` | `string` (uid `r_*`) | Generated |
| `name` | `string` | `extractNameFromLines()` from header |
| `headline` | `string?` | Not extracted by parser (always `undefined`) |
| `contact` | `ContactInfo` | email regex, phone regex, URL regex, location regex from first 15 lines |
| `summary` | `string?` | Regex match on SUMMARY/PROFILE/OBJECTIVE section |
| `experience[]` | `ResumeExperience[]` | `parseExperiences()` — regex-based, heuristic |
| `education[]` | `ResumeEducation[]` | `parseEducation()` — regex-based, heuristic |
| `skills[]` | `ResumeSkill[]` | Comma/semicolon split, filtered: `< 40 chars`, not forbidden |
| `languages[]` | `ResumeLanguage[]` | `detectLanguage()` — dictionary-based detection from LANGUAGES section |
| `projects[]` | `ResumeProject[]` | `parseProjects()` |
| `certifications[]` | `ResumeCertification[]` | Line-by-line from CERTIFICATIONS section |
| `template` | `"ats-professional"` (fixed) | Hardcoded |
| `source` | `"upload"` | Hardcoded |
| `createdAt`/`updatedAt` | ISO string | `new Date()` |

### Key Behaviors & Risks
- **Skills**: Filtered by `isForbiddenSkill()` — skills matching forbidden patterns (company names, placeholder text) are silently dropped
- **Languages**: Uses a dictionary-based `detectLanguage()` — unrecognized languages are silently dropped
- **Experience IDs**: Each entry gets a `uid("e")` — guaranteed unique but not stable across re-parses
- **Education IDs**: Each entry gets a `uid("ed")` — same as above
- **Header extraction**: `extractNameFromLines()` is heuristic — may fail on non-standard formats
- **Dates**: Extracted from raw text with regex — may include trailing characters (e.g., "2018 - 2022 | Rabat" where "| Rabat" leaks into company name)

---

## Stage 2: Blueprint (Entity Freeze)

**File**: `src/lib/resume-blueprint-agent.ts`
**Functions**: `extractBlueprint()`, `compareBlueprint()`

### Input
- `ResumeData` from Parser

### Output: `ResumeBlueprint`
This is a **read-only snapshot** — no ResumeData is modified.

| Field | Notes |
|-------|-------|
| `header` | name, title (headline), phone, email, location, links |
| `summary` | Original summary text (verbatim) |
| `experience[]` | id, role (title), company, location, startDate, endDate, bullets, highlights (old_bullets) |
| `education[]` | id, institution, degree, field, startDate, endDate, gpa |
| `skills[]` | name, level, keywords (name as keyword) |
| `languages[]` | language (name), proficiency |
| `additionalInformation` | certifications, projects, achievements, source, template, dateOfBirth |

### Purpose
The blueprint is extracted **before optimization** and used for:
1. **Diff comparison** (`compareBlueprint`) after optimization to detect hallucinated employers, hallucinated schools, date changes, education corruption, language corruption
2. **Template validation** (`validateTemplatePreserved`) to detect layout/section order changes

### Immutability Contract
The `extractBlueprint` comment states: "No downstream agent may modify these entities." This is enforced by convention (the blueprint is a separate data structure, not a reference to the original).

---

## Stage 3: Optimizer

There are **three optimizer paths**, gated by environment flags and source content:

### 3a. Locked Pipeline (DEFAULT, recommended)

**File**: `src/lib/locked-pipeline.ts`
**Trigger**: `NEXT_PUBLIC_USE_LOCKED_PIPELINE !== "false"` AND source has content (`experience.length > 0 || education.length > 0 || languages.length > 0`)

**Pipeline steps within locked pipeline:**

1. `ensureExperienceIds(resume)` — generates IDs for entries missing them
2. `extractBlueprint(resume)` — freeze immutable state
3. `extractTemplateBlueprint(resume)` — freeze template/layout state
4. **[Semantic cache check]** — returns cached result if identical input was processed
5. `runBulletOnlyOptimizer(resume, jd, intelligenceContext)` — LLM returns:
   ```typescript
   {
     summary: string,      // mutable
     headline: string,     // mutable (protected)
     skills: Skill[],      // mutable
     experiences: [{        // ONLY id + bullets
       id: string,
       bullets: string[]
     }],
     missingKeywordsAdded: string[]  // logging only
   }
   ```
6. `assembleResume(sourceResume, optimizerOutput)` — **application-owned merge** (see Stage 4)
7. Page balancing (`expandResume` / `compressResume`)
8. Layout validation
9. Content preservation checks — **FAILS if**: experience count < source, education count < source, language count < source, missing contact info
10. `validateExperienceFingerprints` — fingerprint-based integrity check
11. `runStructureGuardian` — detects corruption, malformed fragments
12. `runGuardianValidation` — 12 checks with VETO authority (see Stage 6)
13. Snapshot diff comparison — detects hallucinations

### 3b. Parallel Pipeline (opt-in)

**File**: `src/lib/parallel-pipeline.ts`
**Trigger**: `NEXT_PUBLIC_USE_PARALLEL_PIPELINE === "true"`

Three parallel LLM calls:
- **Summary Agent**: Returns `{ summary, headline }` — 60-90 words target
- **Skills Agent**: Returns `{ skills: [{ name, category }] }` — "Keep ALL existing skills", reorder by JD relevance
- **Experience Agent**: Returns `{ experiences: [{ id, bullets }] }` — "NEVER change companies, dates, or roles"

Then calls the same `assembleResume()` function. Education, languages, contact, and certifications ALWAYS come from source.

### 3c. Standard/Legacy Path (fallback)

**File**: `src/lib/agents/orchestrator.ts` (standard optimization)
**Trigger**: When source has no content OR locked pipeline is disabled

The LLM generates a full resume. Locked fields are restored after the fact:
- `finalizeResume()` runs: `cleanupGrammar` → `restoreLockedEntities` → `deduplicate` → `validateImmutableEntities`
- `enforceLockedFields()` is called as a safety net

**This path is less reliable** because the LLM has more freedom to hallucinate before restoration.

### Optimizer Output Summary

| Field | Locked Pipeline | Parallel Pipeline | Standard Path |
|-------|:---:|:---:|:---:|
| `summary` | LLM (bullet-only) | LLM (60-90 words) | LLM (full resume) |
| `headline` | LLM (protected) | LLM | LLM |
| `experience[].company` | **SOURCE** | **SOURCE** | LLM → restored |
| `experience[].title` | **SOURCE** | **SOURCE** | LLM → restored |
| `experience[].startDate` | **SOURCE** | **SOURCE** | LLM → restored |
| `experience[].endDate` | **SOURCE** | **SOURCE** | LLM → restored |
| `experience[].location` | **SOURCE** | **SOURCE** | LLM → restored |
| `experience[].bullets` | LLM (by ID match) | LLM (by ID match) | LLM |
| `education[]` | **SOURCE** | **SOURCE** | LLM → restored |
| `skills[]` | LLM | LLM | LLM |
| `languages[]` | **SOURCE** | **SOURCE** | LLM → restored |
| `certifications[]` | **SOURCE** | **SOURCE** | LLM → restored |
| `contact` | **SOURCE** | **SOURCE** | LLM → restored |

---

## Stage 4: Assembler

**File**: `src/lib/resume-assembler.ts`
**Function**: `assembleResume(sourceResume, optimizerOutput)`
**Status**: The SINGLE component allowed to construct the final ResumeData. No provider may bypass this.

### Input
- `sourceResume`: ResumeData (source of truth, immutable fields)
- `optimizerOutput`: `{ summary?, headline?, skills?, experiences?: [{id, bullets}], missingKeywordsAdded?, bulletsRewritten? }`

### Output: `AssembleResult`
```typescript
{
  resume: ResumeData,           // The assembled final resume
  warnings: string[],
  errors: string[],
  matchedById: number,          // Experience matching stats
  matchedByFingerprint: number,
  matchedByTitleCompany: number,
  matchedByIndex: number,
  unmatched: number             // Should be 0
}
```

### Field-by-Field Assembly

#### Experience (merged)
- **Matching strategy** (in order): ID → fingerprint → title/company → index fallback
- **From source** (ALWAYS): `id`, `title`, `company`, `location`, `startDate`, `endDate`
- **From optimizer** (ONLY): `bullets` — but falls back to source bullets if empty
- **Hallucinated entries**: Optimizer entries with no matching source ID/fingerprint are **IGNORED** (unmatched counter incremented)
- **Missing entries**: Source entries with no optimizer match keep original bullets

#### Summary (mutable, protected)
- From optimizer, with strict validation:
  1. Must be ≥ 30 characters (else fallback to source)
  2. Must be ≥ 60 words (else fallback to source)
  3. Duplicate sentences detected (each sentence ≥ 10 chars, normalized) → fallback to source
  4. JD company names in summary (e.g., "Qatar Duty Free") → fallback to source
  5. Double periods fixed (`..` → `.`)
- Grammar cleanup applied

#### Headline (mutable, protected)
- From optimizer, but **rejected** if:
  - Contains JD company names (hardcoded Gulf-region list: Qatar Airways, Dubai, Riyadh, etc.)
  - First 3 words differ from original headline (detects role/title drift)
  - Is empty
- Falls back to source headline

#### Skills (mutable)
- From optimizer, filtered through `filterForbiddenSkills()`
- Falls back to source skills if optimizer returns none
- Forbidden patterns are removed (same patterns as parser)

#### Education (IMMUTABLE — from source)
```typescript
const education = sourceResume.education.map((ed) => ({ ...ed }));
```
- Deep-copied from source
- Warns if optimizer attempted to return education entries (defensive check)

#### Languages (IMMUTABLE — from source)
```typescript
const languages: ResumeLanguage[] = sourceResume.languages.map((l) => ({ ...l }));
```
- Deep-copied, never modified

#### Certifications (IMMUTABLE — from source)
- Deep-copied from source

#### Contact (IMMUTABLE — from source)
- Shallow copy of source contact

#### Final Resume Metadata
- `source`: set to `"ai-optimized"`
- `updatedAt`: current ISO timestamp
- `...sourceResume`: preserves `id`, `template`, `accentColor`, `photoUrl`, `fileName`, `dateOfBirth`, `projects`, `achievements`

#### Post-Assembly
- `cleanupResumeGrammar()` applied to entire resume
- `validateExperienceFingerprints()` called for final check (warnings only)

---

## Stage 5: QA (Quality Assurance)

**File**: `src/lib/agents/qa-agent.ts`
**Function**: `runQA(optimizedResume, jd, jobIntelligence, originalResume, options, policy)`

### Input
- Optimized ResumeData (from Assembler or Standard path)
- Original ResumeData (for factual consistency)
- JobDescription (for ATS checks)
- Options: `{ checkExport?: boolean }` (default: false)

### Checks Performed

| Check | Critical? | What it detects |
|-------|:---:|-------|
| Base Pipeline (7 checks) | Mixed | ATS formatting, grammar, keyword coverage, completeness |
| Factual Consistency | **YES** | Fabricated employers, education, metrics, certifications |
| Professional Tone | No | Analysis artifacts ("The original resume lacks…"), leaks, forbidden sections |
| Directive Compliance | No | Policy compliance score ≥ 90 |
| Export Quality (optional) | No | PDF renders successfully, exactly 1 page |

### Hard Failure Gate
If `factualConsistency` fails with any of:
- **≥ 1 fabricated employer** (company in optimized but not in original)
- **≥ 1 fabricated education** (institution in optimized but not in original)
- **≥ 1 fabricated certification**

Then: **Pipeline FAILS → original resume restored, result.status = "failed"**

Minor issues (fabricated metrics, fabricated locations) are allowed through with warnings.

### Confidence & Reflection
- `confidence`: overall score 0-100
- `shouldReflect`: true if confidence < 75 (triggers Reflection Agent)
- `checkExport`: if enabled, renders PDF and validates 1 page

---

## Stage 6: Guardian

**File**: `src/lib/resume-guardian-agent.ts`
**Function**: `runGuardianValidation(optimized, source, policy?)`
**Authority**: **VETO** — can block export

### 12 Guardian Checks

| # | Check Name | Critical | Description |
|---|-----------|:---:|---|
| 1 | `companies_preserved` | **YES** | All source companies exist in optimized (fuzzy match) |
| 2 | `dates_preserved` | **YES** | All date ranges preserved (set-based comparison) |
| 3 | `schools_preserved` | **YES** | Education count ≥ source, all institutions match |
| 4 | `languages_preserved` | **YES** | Language count ≥ source, all names match |
| 5 | `skills_preserved` | No | Source skills still present, no forbidden keywords in skills |
| 6 | `template_preserved` | **YES** | Template name unchanged |
| 7 | `layout_preserved` | **YES** | Structure Guardian finds no critical issues |
| 8 | `no_hallucinations` | **YES** | Entity integrity verified (extractLockedEntities + verifyEntityIntegrity) |
| 9 | `no_duplicate_sentences` | No | No duplicate sentences (≥ 4 words) in summary + bullets |
| 10 | `ats_improvement` | No | Optimized content expanded by > 20 chars OR keyword retention ≥ 80% |
| 11 | `one_page_validation` | No | Layout validator checks page utilization |
| 12 | `directive_compliance` | **YES** | Policy compliance score ≥ 90 (if policy provided) |

### VETO Rules
- **Any critical check fails** → `status = "BLOCKED"`, `passed = false` → Pipeline retries (up to 3 attempts)
- **Only non-critical fails** → `status = "REQUIRES_MANUAL_REVIEW"`, `passed = true` → Export allowed with warnings
- **All pass** → `status = "PASS"`, `passed = true`

### Called In Two Places
1. **Inside Locked Pipeline** — after assembly, before returning result
2. **Inside Orchestrator** — for standard/aviation paths, after `finalizeResume`

---

## Stage 7: Export (PDF/DOCX)

**File**: `src/lib/exporter.ts`
**Functions**: `exportResumePDF()`, `exportResumeDOCX()`, `buildResumeHtml()`

### Input
- `ResumeData` (final optimized resume)
- `ResumeLayoutModel` (from settings/optimizer directive)

### Sections Rendered (in order)

| Section | Fields Used | Constraints |
|---------|------------|-------------|
| **NAME** | `resume.name` | Uppercased |
| **Headline** | `resume.headline` | Optional, displayed below name |
| **Contact** | `email`, `phone`, `location`, `linkedin`, `github`, `website` | Pipe-separated |
| **Summary** | `resume.summary` | Full text rendered as `<p>` |
| **Experience** | For each: `title` — `company`, date range, `bullets` | Date formatted: YYYY – YYYY (or "Present") |
| **Education** | For each: `degree` \| `institution` \| `location`, date range, `field`, `highlights` | Same date formatting |
| **Skills** | Categorized by `category`, skill `name` | Grouped: "**Category:** skill1, skill2" |
| **Projects** | `name`, `description` | **Limited to 2** (`projects.slice(0, 2)`) |
| **Certifications** | `name`, `issuer`, `date` | **Limited to 4** (`certifications.slice(0, 4)`) |
| **Languages** | `name`, `proficiency`, optional `note` | One per line |

### One-Page Enforcement
- `enforceOnePage: true` by default
- jsPDF with A4 format (210×297 mm)
- Configurable margins, fonts, spacing via `ResumeLayoutModel`
- If content overflows: PDF export returns `{ ok: false, pages: >1, error }`

### Data Truncation Risks in Export
1. **Projects limited to 2** — extra projects silently dropped
2. **Certifications limited to 4** — extra certifications silently dropped
3. No visible truncation of summary, experience bullets, or skills in the HTML template

---

## Specific Field Survival Analysis

### 1. `education.institution`
| Stage | Survives? | Mechanism |
|-------|:---:|---|
| Parser | ✅ | Extracted by regex from EDUCATION section |
| Blueprint | ✅ | Copied verbatim to `blueprint.education[].institution` |
| Locked Pipeline | ✅ | Assembler deep-copies education from source |
| Parallel Pipeline | ✅ | Same assembler, same deep-copy |
| Standard Path | ✅ | `enforceLockedFields` → `restoreLockedEntities` restores institution |
| QA | ⚠️ Checked | `checkFactualConsistency` flags fabricated institutions |
| Guardian | ✅ | `checkEducationPreserved` (critical) — blocks if institutions missing |
| Export | ✅ | Rendered as `degree \| institution \| location` |

**Verdict: STRONGLY PROTECTED** — multiple layers of defense, critical guardian check.

**Risk**: In standard path, the `enforceLockedFields` education restoration uses **index-based fallback** (`original.education[i]`) when institution name doesn't fuzzy-match. If the AI reorders education entries, this could assign the wrong institution to an entry.

### 2. `resume.languages`
| Stage | Survives? | Mechanism |
|-------|:---:|---|
| Parser | ⚠️ Partial | Dictionary-based `detectLanguage()` — unrecognized languages silently dropped |
| Blueprint | ✅ | Copied verbatim |
| Locked Pipeline | ✅ | Assembler deep-copies, content preservation check fails if count drops |
| Parallel Pipeline | ✅ | Same assembler |
| Standard Path | ✅ | `enforceLockedFields`: `locked.languages = original.languages` |
| QA | N/A | Languages not explicitly in factual consistency check |
| Guardian | ✅ | `checkLanguagesPreserved` (critical) — blocks if count drops or names missing |
| Export | ✅ | Rendered as `name: proficiency` |

**Verdict: PROTECTED** downstream, but can be lost at parsing stage if language name isn't in the detection dictionary.

**Risk**: If the parser drops a language (e.g., "Tamazight"), it's gone forever — no downstream stage can recover it.

### 3. `experience.company` / `experience.role` / `experience.date`
| Stage | Survives? | Mechanism |
|-------|:---:|---|
| Parser | ✅ | Extracted by `parseExperiences()` |
| Blueprint | ✅ | Copied verbatim |
| Locked Pipeline | ✅ | Assembler: `...srcExp` preserves all metadata; only bullets from LLM |
| Parallel Pipeline | ✅ | Experience agent returns ONLY `{id, bullets}` — metadata from source |
| Standard Path | ✅ | `enforceLockedFields` restores by ID/fingerprint match |
| QA | ✅ | `checkFactualConsistency` flags fabricated employers |
| Guardian | ✅ | `checkCompaniesPreserved` + `checkDatesPreserved` (both critical) |
| Export | ✅ | Rendered: title — company, date range, bullets |

**Verdict: STRONGLY PROTECTED** — two critical guardian checks, assembler enforces source-only for locked/parallel paths.

**Risk**: In standard path, `enforceLockedFields` experience locking has a subtle issue: it uses `cleanTitle(orig.title || e.title || "")` — if the original title is empty but the AI added a better title, the source title (empty) wins. Similarly for location (`orig.location || e.location || ""`).

### 4. Summary Length
| Stage | Behavior |
|-------|----------|
| Parser | Raw text, no length constraint |
| Parallel Summary Agent | System prompt: "Write 60-90 words" |
| Locked Pipeline (bullet-only) | LLM returns summary, no explicit word limit in optimizer |
| Assembler | **Validates**: < 30 chars → reject, < 60 words → reject, duplicate sentences → reject |
| Export | Rendered in full, no truncation |

**Verdict: ACTIVE LENGTH ENFORCEMENT** — assembler rejects summaries under 60 words, falls back to source. Summary can be rewritten but never truncated to below minimum.

**Risk**: If the source summary is also under 60 words, the assembler uses it anyway (no further fallback). There's no upper-bound enforcement in assembler (parallel agent says 90 words max, but assembler only checks minimum).

### 5. Skills vs Keywords
| Aspect | Detail |
|--------|--------|
| Parser | Skills are split from comma/semicolon-separated text, filtered by `isForbiddenSkill()` and length < 40 |
| Skills Agent (Parallel) | "Keep ALL existing skills", "Reorder: JD-relevant skills FIRST", "ONLY add skills genuinely present in experience", "NEVER add skills the candidate doesn't have" |
| Locked Pipeline | LLM returns skills, assembler filters through `filterForbiddenSkills()` |
| Assembler | Falls back to source skills if optimizer returns none |
| Guardian | `checkSkillsPreserved` (non-critical) — verifies source skills still exist, checks for forbidden keywords |
| Forbidden patterns | `qatar`, `dubai`, `abu dhabi`, `riyadh`, `kuwait`, `bahrain`, `oman`, `muscat`, `unknown`, `n/a`, `placeholder`, `company name`, `your company`, `previous employer` |

**Verdict: SKILLS ARE SKILLS, NOT KEYWORDS** — The pipeline distinguishes between:
- **Skills** (candidate's actual abilities, preserved from source)
- **Keywords** (JD terms that are naturally embedded in summary/bullets, tracked as `keywordsAdded`/`missingKeywordsAdded`)

Forbidden company/location names are filtered from skills. JD keywords are embedded in summary and bullet text, not added as fake skills.

**Risk**: In standard path, `sanitizeSkills()` may not catch all keyword contamination. The `filterForbiddenSkills` list is Gulf-region focused — other regional company/location names could slip through.

### 6. Chronology Preservation
| Stage | Behavior |
|-------|----------|
| Parser | Experience/education entries extracted in document order |
| Blueprint | Preserves original order in arrays |
| Locked Pipeline | Assembler iterates `sourceResume.experience` in order; each entry keeps source `startDate`/`endDate` |
| Parallel Pipeline | Same assembler, same order preservation |
| Standard Path | `enforceLockedFields` restores dates; entries may be reordered by LLM but dates are locked per-entry |
| Similarity Engine | `chronologyScore` (0-15) — penalizes date changes |
| Guardian | `checkDatesPreserved` (critical) — set-based date comparison |
| Export | Rendered in array order (same as source order in locked/parallel paths) |

**Verdict: CHRONOLOGY PRESERVED** — In locked/parallel paths, experience order is strictly source order. In standard path, dates are locked per-entry but order may shift.

---

## Known Gaps & Data Loss Risks

### 🔴 Critical Risks

1. **Parser → Language Loss**
   - `detectLanguage()` uses a hardcoded dictionary — if a language isn't recognized, it's silently dropped
   - **No downstream recovery possible** — assembler, guardian, and exporter can't restore what was never parsed

2. **Parser → Experience/Education Parsing**
   - Regex-based parsers may misparse non-standard resume formats
   - Date strings may leak into company names (e.g., "Company Name | 2018")
   - The orchestrator's `stripPipes` function addresses this for the locked pipeline but not in the parser itself

3. **Standard Path → Education Reordering**
   - `enforceLockedFields` uses index-based fallback (`original.education[i]`) for education matching
   - If LLM reorders education entries, wrong institution could be assigned

### 🟡 Moderate Risks

4. **Summary Too Short (Source)**
   - If source summary is < 60 words AND optimizer summary is rejected, no further fallback exists
   - Result: short summary passes through

5. **Projects/Certifications Truncation in Export**
   - Projects: silently limited to 2
   - Certifications: silently limited to 4
   - No warning emitted to user

6. **Parser → Skills Filtering**
   - `isForbiddenSkill()` and length < 40 filter applied at parse time
   - Skills matching forbidden patterns are silently dropped, never recoverable

7. **Standard Path → Title Override**
   - `enforceLockedFields` uses `cleanTitle(orig.title || e.title || "")` 
   - If original title is empty, AI's improved title is preserved — **GOOD**
   - But if original title is malformed, it overrides AI's cleaned version — **could be BAD**

### 🟢 Low Risks

8. **Export → All-or-nothing one-page enforcement**
   - PDF export fails if content overflows one page
   - No automatic font-size reduction or content trimming

9. **Semantic Cache**
   - Locked pipeline caches results by `(sourceResume, jd, directiveConfig)` hash
   - If source resume has same content but different formatting, cache hit could return stale result
   - This is by design (performance optimization) but worth noting

---

## Pipeline Integrity Summary

| Entity | Parser | Locked/Parallel | Standard | QA | Guardian | Export |
|--------|:---:|:---:|:---:|:---:|:---:|:---:|
| Name | ✅ Extracted | ✅ Source | ✅ Restored | ✅ Checked | N/A | ✅ Rendered |
| Contact (email/phone/location) | ✅ Regex | ✅ Source | ✅ Restored | ✅ Checked | N/A | ✅ Rendered |
| Headline | ❌ Not parsed | ⚠️ Protected | ⚠️ Restored | N/A | N/A | ✅ Rendered |
| Summary | ✅ Raw text | ✅ LLM (validated) | ✅ LLM (validated) | N/A | N/A | ✅ Full render |
| Experience Company | ✅ Regex | ✅ SOURCE | ⚠️ Restored | ✅ Factual check | ✅ Critical check | ✅ Rendered |
| Experience Title | ✅ Regex | ✅ SOURCE | ⚠️ Restored | N/A | N/A | ✅ Rendered |
| Experience Dates | ✅ Regex | ✅ SOURCE | ⚠️ Restored | N/A | ✅ Critical check | ✅ Formatted |
| Experience Bullets | ✅ Raw | ✅ LLM (ID-matched) | ✅ LLM | N/A | N/A | ✅ Rendered |
| Education Institution | ✅ Regex | ✅ SOURCE | ⚠️ Restored* | ✅ Factual check | ✅ Critical check | ✅ Rendered |
| Education Degree/Field | ✅ Regex | ✅ SOURCE | ⚠️ Restored* | ✅ Factual check | N/A | ✅ Rendered |
| Education Dates | ✅ Regex | ✅ SOURCE | ⚠️ Restored* | N/A | N/A | ✅ Formatted |
| Skills | ⚠️ Filtered | ✅ LLM (filtered) | ✅ LLM (filtered) | N/A | ✅ Non-critical | ✅ Categorized |
| Languages | ⚠️ Dictionary | ✅ SOURCE | ✅ Restored | N/A | ✅ Critical check | ✅ Rendered |
| Certifications | ✅ Raw | ✅ SOURCE | ✅ Restored | ✅ Factual check | N/A | ⚠️ Limited to 4 |
| Projects | ✅ Raw | ✅ SOURCE | ✅ Preserved | N/A | N/A | ⚠️ Limited to 2 |
| Template | ✅ Fixed "ats-professional" | ✅ Preserved | ✅ Restored | N/A | ✅ Critical check | N/A |
| Chronology/Order | ✅ Document order | ✅ Source order | ⚠️ May shift | N/A | N/A | ✅ Array order |

**Legend**: ✅ = Safe, ⚠️ = Conditional/risky, ❌ = Not preserved, N/A = Not applicable

---

## Key Files Audited

| File | Lines | Role |
|------|-------|------|
| `src/lib/parser.ts` | ~800+ | Resume parsing (PDF/DOCX/TXT → ResumeData) |
| `src/lib/resume-blueprint-agent.ts` | ~500+ | Entity freeze + diff engine |
| `src/lib/locked-pipeline.ts` | ~400+ | Locked pipeline orchestrator |
| `src/lib/parallel-pipeline.ts` | ~275+ | Parallel summary/skills/experience pipeline |
| `src/lib/resume-assembler.ts` | ~285+ | Application-owned resume assembly |
| `src/lib/agents/orchestrator.ts` | 2648 | Main pipeline orchestrator |
| `src/lib/agents/qa-agent.ts` | ~400+ | Quality assurance agent |
| `src/lib/resume-guardian-agent.ts` | 662 | Final guardian with VETO authority |
| `src/lib/entity-lock.ts` | ~500+ | Entity extraction, restoration, integrity |
| `src/lib/similarity-engine.ts` | ~400+ | Similarity scoring + confidence |
| `src/lib/exporter.ts` | ~1000+ | PDF/DOCX/HTML export |
| `src/lib/types.ts` | ~225+ | Core domain types |
