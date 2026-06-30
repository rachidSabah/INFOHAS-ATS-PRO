# ATS Architecture Audit — ResumeAI Pro

> Generated: 2026-06-30
> Phase 6: Enterprise ATS Intelligence & Industry Knowledge Engine

---

## 1. Current Architecture Overview

### Existing Pipeline

```
ResumeData (client)
  │
  ▼
Parser → ResumeData (structured)
  │
  ▼
ResumeBlueprintAgent → Blueprint (immutable snapshot)
  │
  ▼
OptimizerPipeline (Orchestrator + Multi-Agent)
  │
  ▼
ResumeAssembler → OptimizerOutput merged with source ResumeData
  │
  ▼
ResumeGuardianAgent → GuardianVerdict (VETO authority)
  │
  ▼
Preview / Export (DOCX, PDF)
```

### Existing Components

| Component | File | Status |
|-----------|------|--------|
| ATS Scoring | `ats.ts` (264 lines) | ✅ Rule-based, keyword matching + formatting scoring |
| ATS Directives | `ats-directives.ts` | ✅ Optimization directives |
| Industry Mapper | `industry-mapper.ts` (104 lines) | ✅ Maps detected industry → pipeline aviationMode |
| Industry ATS | `industry-ats.ts` (589 lines) | ✅ 35+ industry profiles with keyword banks |
| Keyword Banks | `keyword-banks.ts` | ✅ Per-industry keyword lists |
| Resume Blueprint | `resume-blueprint-agent.ts` (600 lines) | ✅ Immutable entity capture + diff |
| Resume Guardian | `resume-guardian-agent.ts` (1580 lines) | ✅ VETO authority, structure checks |
| Resume Assembler | `resume-assembler.ts` (522 lines) | ✅ Final document construction |
| Dynamic Section Engine | `dynamic-section-engine.ts` | ✅ Unknown section handling |
| Job Intelligence | `job-intelligence.ts` | ✅ JD parsing + skill extraction |
| Optimizer Patch | `optimizer-patch.ts` | ✅ Patch-based optimization |
| Pipeline Orchestration | `pipeline-orchestration-*.ts` | ✅ Orchestrated agent pipeline |

---

## 2. Gap Analysis

### 🟢 Already Strong

- **Industry profiles**: 35+ industries with keyword banks, writing guidance, tone settings
- **Immutable data protection**: Blueprint + Guardian + Assembler = triple protection
- **ATS scoring**: Rule-based with formatting, keywords, content, grammar, completeness
- **Pipeline orchestration**: Multi-agent with supervisor, planner, validator, executor

### 🟡 Existing but Needs Enhancement

| Area | Current | Needed |
|------|---------|--------|
| **Industry Knowledge** | Static keyword lists (industry-ats.ts) | Dynamic industry knowledge engine with skill graphs, synonyms, and role-specific competency trees |
| **Semantic Matching** | Exact keyword matching (`resumeText.includes(k)`) | Semantic proximity matching with synonym groups and role-aware scoring |
| **Keyword Priority** | Single flat keyword list | Critical/Important/Optional/Supporting classification |
| **Content Enhancement** | `optimizer-patch.ts` (bullet-focused) | Dedicated grammar+professionalism enhancement engine for ALL sections |
| **ATS Scoring** | 5 dimensions with static weights | 10+ dimensions with industry-adjusted weights |
| **Explanation** | Basic recommendation list | Diagnostic report with per-dimension breakdown |
| **Summary Generation** | LLM-prompted | JD+Industry-aware summary generation |
| **Skill Enhancement** | Replaced by assembler | Smart expansion (add not replace) |
| **Experience Enhancement** | Patch-based (bullet rewriting) | Full bullet professionalism + action-verb conversion |
| **Dynamic Sections** | Preservation only | Grammar + ATS enhancement for ALL sections |

### 🔴 Missing

| Feature | Criticality | Rationale |
|---------|-------------|-----------|
| Industry Knowledge Engine | 🔴 High | Centralized registry of industry data, skill graphs, competency trees |
| Skill Graph (per industry) | 🔴 High | Enables semantic skill matching and gap analysis |
| Semantic Mapping (synonym groups) | 🔴 High | "Guest Relations" ↔ "Customer Service" ↔ "Passenger Assistance" |
| Keyword Priority Classification | 🟡 Medium | Prevents keyword stuffing; guides natural insertion |
| Content Enhancement Engine | 🟡 Medium | Grammar + professionalism for all sections |
| Smart Summary Engine | 🟡 Medium | JD+Industry-aware summary |
| Smart Experience Enhancement | 🟡 Medium | Weak → professional bullets without inventing facts |
| Skill Enhancement (additive) | 🟡 Medium | Expand skill lists, don't replace |
| Dynamic Section Enhancement | 🟢 Low | Grammar improvement for all dynamic sections |
| ATS Scoring Engine (v2) | 🟡 Medium | 10+ dimensions, industry-weighted |
| Explanation Engine | 🟢 Low | Diagnostic report for users |
| No-Hallucination Policy | 🔴 High | Formalized rules (stated but not enforced programmatically) |
| Multi-Industry Test Suite | 🔴 High | 10+ industry test cases |

---

## 3. Implementation Plan (Phase 6)

### Architecture: Enterprise ATS Intelligence Engine

```
IndustryKnowledgeEngine
  └── IndustryProfile[] (data-driven, extensible)
  └── IndustrySkillGraph (per-industry competency trees)
  └── SkillSynonymGroups (semantic mapping)

JobDescriptionEngine
  └── JD Parser (extended)
  └── Keyword Extractor (weighted)
  └── Competency Extractor

SemanticMatchingEngine
  └── Skill-to-Skill mapper
  └── Synonym resolution
  └── Role-aware proximity scoring

ATSIntelligenceOrchestrator
  └── Pipeline stage: after Blueprint, before Optimizer
  └── Produces: ATSEnhancementContext → feeds Optimizer

ATSKeywordEngine
  └── Priority classification
  └── Natural insertion strategy

ContentEnhancementEngine
  └── Grammar improver
  └── Professional wording
  └── Action-verb converter

ATSReportEngine (v2)
  └── 10-dimension scoring
  └── Industry-adjusted weights
  └── Explanation generator
```

### Data Flow

```
ResumeData + JD
  │
  ▼
IndustryKnowledgeEngine
  ├── detectIndustry() → { industryId, confidence }
  ├── getIndustryProfile() → { keywords, skills, synonyms, tone }
  └── getSkillGraph() → { competencies, relationships }
  │
  ▼
JobDescriptionEngine
  ├── parseJD() → { skills, keywords, responsibilities, requirements }
  └── extractCompetencies() → { required, preferred, optional }
  │
  ▼
SemanticMatchingEngine
  ├── matchSkills() → { matched, missing, partial }
  └── computeSkillGap() → { gapScore, recommendations }
  │
  ▼
ATSKeywordEngine
  ├── classifyKeywords() → { critical, important, optional, supporting }
  └── optimizePlacement() → { insertion strategy }
  │
  ▼
ContentEnhancementEngine
  ├── enhanceBullets() → professional bullets (facts preserved)
  ├── improveGrammar() → all sections
  └── enhanceSummary() → JD+industry-aware summary
  │
  ▼
ATSReportEngine (v2)
  ├── scoreAllDimensions() → { keyword, semantic, skills, experience, ... }
  └── generateExplanation() → { diagnostics report }
  │
  ▼
Guardian → Assembler → Preview/Export
```

---

## 4. File Manifest (New)

| File | Purpose | Depends On |
|------|---------|------------|
| `src/lib/enterprise/industry-knowledge-engine.ts` | Central industry registry, profiles, skill graphs | none |
| `src/lib/enterprise/industry-skill-graph.ts` | Per-industry competency trees | industry-knowledge-engine |
| `src/lib/enterprise/jd-engine.ts` | JD parsing + competency extraction | none |
| `src/lib/enterprise/semantic-matching-engine.ts` | Synonym-based skill matching | industry-knowledge-engine |
| `src/lib/enterprise/keyword-engine.ts` | Priority classification + insertion | semantic-matching-engine |
| `src/lib/enterprise/content-enhancement-engine.ts` | Grammar + professionalism | none |
| `src/lib/enterprise/summary-engine.ts` | JD+Industry-aware summary content | industry-knowledge-engine, jd-engine |
| `src/lib/enterprise/experience-enhancer.ts` | Bullet professionalism | semantic-matching-engine, keyword-engine |
| `src/lib/enterprise/skill-enhancer.ts` | Additive skill expansion | semantic-matching-engine |
| `src/lib/enterprise/dynamic-section-enhancer.ts` | Generic section enhancement | content-enhancement-engine |
| `src/lib/enterprise/ats-report-engine.ts` | 10-dimension scoring + explanation | ALL engines |
| `src/lib/enterprise/hallucination-guard.ts` | Hallucination detection + prevention | none |
| `src/lib/enterprise/pipeline-orchestrator.ts` | Integrates all engines into pipeline | ALL engines |
| `src/lib/enterprise/__tests__/industry-knowledge-engine.test.ts` | Tests | test framework |
| `src/lib/enterprise/__tests__/semantic-matching-engine.test.ts` | Tests | test framework |
| `src/lib/enterprise/__tests__/keyword-engine.test.ts` | Tests | test framework |
| `src/lib/enterprise/__tests__/content-enhancement-engine.test.ts` | Tests | test framework |
| `src/lib/enterprise/__tests__/ats-report-engine.test.ts` | Tests | test framework |
| `src/lib/enterprise/__tests__/hallucination-guard.test.ts` | Tests | test framework |
| `docs/architecture/INDUSTRY_ENGINE.md` | Documentation | — |
| `docs/architecture/SEMANTIC_ENGINE.md` | Documentation | — |
| `docs/architecture/KEYWORD_ENGINE.md` | Documentation | — |
| `docs/architecture/ATS_SCORING_ENGINE.md` | Documentation | — |
| `docs/architecture/NO_HALLUCINATION_POLICY.md` | Documentation | — |

---

## 5. Risk Assessment

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Hallucination (invented facts) | Medium | Critical | HallucinationGuard with strict regex + semantic checks; Guardian VETO as second line |
| Regressions in existing pipeline | Medium | High | Run full suite after each new engine; no existing code changed |
| Keyword stuffing | Medium | Medium | KeywordEngine prioritizes natural density limits; experience enhancer verifies original content retained |
| Missing industry coverage | Low | Low | Industry profiles are additive; default generic fallback always available |
| Performance impact | Low | Medium | All engines are deterministic (no AI calls); synchronous with O(n) complexity |
