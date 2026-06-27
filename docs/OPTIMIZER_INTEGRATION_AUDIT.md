# ResumeAI Pro — Optimizer Integration Audit

> **Generated:** 2026-06-27  
> **Audit Type:** Full Integration Trace — 10 Flows  
> **Architecture:** Multi-Agent Optimizer with Locked Pipeline (primary) + Parallel Pipeline (opt-in)  
> **Status:** 8/10 flows fully connected, 2 gaps identified

---

## Architecture Diagram

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                           RESUMEAI PRO ARCHITECTURE                           │
│                     Locked Pipeline + Parallel Pipeline                        │
├──────────────────────────────────────────────────────────────────────────────┤
│                                                                              │
│  ┌──────────┐    ┌─────────────┐    ┌──────────────────┐                     │
│  │   UI     │───▶│  Zustand    │───▶│  Orchestrator    │                     │
│  │(Directive│    │  Store      │    │ (agents/)        │                     │
│  │ Component)│   │ optimizer   │    │ directiveConfig  │                     │
│  └──────────┘    │ Directive   │    │ optimizationPol  │                     │
│                  └─────────────┘    └───────┬──────────┘                     │
│                                             │                                │
│                    ┌────────────────────────┼────────────────────────┐       │
│                    │                        │                        │       │
│                    ▼                        ▼                        ▼       │
│  ┌──────────────────────────────┐ ┌──────────────────────────────┐          │
│  │      LOCKED PIPELINE         │ │    PARALLEL PIPELINE          │          │
│  │      (primary path)          │ │    (opt-in via env var)       │          │
│  │                              │ │                              │          │
│  │ Step 1: entity-lock.ts       │ │ Step 1: Semantic Cache Check │          │
│  │   ensureExperienceIds()      │ │   getCachedOptimization()    │          │
│  │                              │ │                              │          │
│  │ Step 1b: Blueprint Extract   │ │ Step 2: entity-lock          │          │
│  │   extractBlueprint()         │ │   ensureExperienceIds()      │          │
│  │   extractTemplateBlueprint() │ │                              │          │
│  │                              │ │ Step 3: Parallel LLM Calls   │          │
│  │ Step 2: Bullet-Only Optimizer│ │   Promise.all([             │          │
│  │   runBulletOnlyOptimizer()   │ │     runSummaryAgent(),       │          │
│  │   buildOptimizerInput()      │ │     runSkillsAgent(),        │          │
│  │                              │ │     runExperienceAgent()     │          │
│  │ Step 3: Resume Assembler     │ │   ])                         │          │
│  │   assembleResume()           │ │   Each: callAI() →           │          │
│  │   education from source      │ │   recordProviderSuccess()    │          │
│  │   languages from source      │ │                              │          │
│  │                              │ │ Step 4: Assemble             │          │
│  │ Step 4: Fingerprint Validate │ │   assembleResume()           │          │
│  │   validateExperienceFgp()    │ │                              │          │
│  │                              │ │ Step 5: Snapshots            │          │
│  │ Step 5: Structure Guardian   │ │   compareSnapshots()         │          │
│  │   runStructureGuardian()     │ │                              │          │
│  │                              │ │ Step 6: Cache Result         │          │
│  │ Step 5b: Guardian VETO       │ │   setCachedOptimization()    │          │
│  │   runGuardianValidation()    │ │                              │          │
│  │   BLOCKED → throw error      │ └──────────────────────────────┘          │
│  │                              │                                          │
│  │ Step 6-9: Snapshots, Diff,   │                                          │
│  │   Debug Persist, Return      │                                          │
│  └──────────────────────────────┘                                          │
│                                                                              │
│  ┌──────────────────────────────────────────────────────────────────┐       │
│  │                    SHARED SERVICES                                │       │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │       │
│  │  │Snapshots     │ │Provider      │ │Agent Event   │              │       │
│  │  │createSnapshot│ │Health Monitor│ │Bus (global)  │              │       │
│  │  │compareSnpsht │ │recordSuccess │ │emit/listen   │              │       │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │       │
│  │  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐              │       │
│  │  │Retry Engine  │ │Semantic      │ │Directive     │              │       │
│  │  │createRetryEng│ │Cache (parall │ │Policy Builder│              │       │
│  │  │(per-agent)   │ │ pipeline onl)│ │buildOptPolicy│              │       │
│  │  └──────────────┘ └──────────────┘ └──────────────┘              │       │
│  └──────────────────────────────────────────────────────────────────┘       │
└──────────────────────────────────────────────────────────────────────────────┘
```

---

## Flow 1: Resume Blueprint Flow

### Trace Path
```
extractBlueprint()                    [resume-blueprint-agent.ts]
  │  Extracts: header, summary, experience[], education[], skills[],
  │            languages[], additionalInformation
  │
  ▼
locked-pipeline.ts (line ~148)
  │  const blueprint = extractBlueprint(idReadyResume)
  │  const templateBlueprint = extractTemplateBlueprint(idReadyResume)
  │  Purpose: Freeze immutable state BEFORE LLM optimization
  │
  ▼
resume-assembler.ts (line 281)
  │  const education = sourceResume.education.map((ed) => ({ ...ed }))
  │  // Section 5: EDUCATION — ALWAYS from source (immutable)
  │  // Warns if optimizer attempted to return education (defensive check)
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| `extractBlueprint()` extracts complete immutable entity snapshot | ✅ |
| `locked-pipeline.ts` calls `extractBlueprint()` pre-optimization | ✅ Line ~148 |
| `assembleResume()` reads `sourceResume.education` (NOT optimizer output) | ✅ Line 281 |
| Blueprint is used for validation via `validateTemplatePreserved()` | ✅ Post-assembly |
| `compareBlueprint()` exists for post-optimization diff | ✅ In blueprint agent |

---

## Flow 2: Experience Fingerprint Flow

### Trace Path
```
computeExperienceFingerprint()        [experience-fingerprint.ts]
  │  SHA-256 of: title + company + location + startDate + endDate
  │  (bullets excluded — they ARE mutable)
  │
  ▼
entity-lock.ts
  │  ensureExperienceIds() — guarantees every entry has an ID
  │  Called at locked-pipeline.ts line ~93
  │
  ▼
resume-assembler.ts (experience merge section, ~line 110)
  │  computeExperienceFingerprint(srcExp) — used for fallback matching
  │  when ID-based match fails
  │  ▶ matchedByFingerprint counter incremented
  │
  ▼
locked-pipeline.ts (Step 4, ~line 215)
  │  validateExperienceFingerprints(assembleResult.resume, sourceResume)
  │  Checks: ID match, fingerprint match, dropped entries, hallucinated entries
  │  Violations → contentViolations → triggers retry
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| `computeExperienceFingerprint()` defined and exported | ✅ SHA-256 on 5 immutable fields |
| `ensureExperienceIds()` generates IDs for entries missing them | ✅ entity-lock.ts |
| Assembler uses fingerprint for fallback matching (after ID match) | ✅ Line ~125 |
| `validateExperienceFingerprints()` checks both directions (source→opt, opt→source) | ✅ |
| Fingerprint violations bubble up to content validation → retry trigger | ✅ |

---

## Flow 3: Directive Propagation Flow

### Trace Path
```
UI: OptimizerDirective component       [components/*]
  │  User configures sliders: ATS aggressiveness, bullet-only, strict mode
  │
  ▼
Store: Zustand store.ts
  │  State: optimizerDirective: OptimizerDirectiveConfig
  │  setOptimizerDirective(patch) — updates store + cloud sync
  │
  ▼
Orchestrator: orchestrator.ts (line ~816)
  │  directiveConfig = (useApp.getState())?.optimizerDirective ?? null
  │  policy = buildOptimizationPolicy(directiveConfig)     → directive-policy.ts
  │  optimizationPolicy = formatPolicyForPrompt(policy)     → string for LLM
  │
  ▼
Locked Pipeline: locked-pipeline.ts (line ~156)
  │  buildOptimizerInput(idReadyResume, jd, intelligenceContext,
  │                      directiveConfig, optimizationPolicy)
  │
  ▼
Bullet-Only Optimizer: bullet-only-optimizer.ts
  │  buildOptimizerInput() prepends optimizationPolicy to system prompt
  │  agentDirectives from directiveConfig injected as "AGENT DIRECTIVES" block
  │
  ▼
runBulletOnlyOptimizer() calls callAI() with the compiled prompt
  │  Uses agentDirectives.supervisor.temperature, enableRetries, enableProviderSwitch
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| UI writes `optimizerDirective` to Zustand store | ✅ |
| Orchestrator reads `optimizerDirective` from store | ✅ Line 816 |
| `buildOptimizationPolicy()` translates UI state → policy object | ✅ |
| `formatPolicyForPrompt()` serializes policy → LLM prompt string | ✅ |
| Policy flows to both `runLockedPipeline()` and `runParallelOptimizer()` | ✅ |
| Agent directives (temperature, retry, provider switch) reach `callAI()` | ✅ |

---

## Flow 4: Guardian Veto Flow

### Trace Path
```
runGuardianValidation()                [resume-guardian-agent.ts]
  │  Runs 12 checks (companies, dates, education, languages, skills,
  │  template, layout, hallucinations, duplicates, ATS improvement,
  │  one-page validation, directive compliance)
  │
  │  Critical failures exist → status = "BLOCKED", passed = false
  │
  ▼
locked-pipeline.ts (Step 5b, ~line 238)
  │  guardianVerdict = await runGuardianValidation(assembleResult.resume,
  │                                                sourceResume, undefined)
  │  if (guardianVerdict.status === "BLOCKED") {
  │    errObj.provider = optimizerResult.provider;   // tag for exclusion
  │    throw errObj;                                  // triggers retry
  │  }
  │
  ▼
Catch block (locked-pipeline.ts while loop)
  │  excludeProviderIds.push(err.provider)           // blacklist provider
  │  if (attempts >= maxAttempts) → throw LockedPipelineError
  │  else → next while iteration (retry with different provider)
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| `runGuardianValidation()` returns BLOCKED when critical checks fail | ✅ |
| Locked pipeline checks `guardianVerdict.status === "BLOCKED"` | ✅ |
| Error is tagged with provider ID for exclusion in retry | ✅ |
| Exhausted retries → `LockedPipelineError` with "REQUIRES_MANUAL_REVIEW" | ✅ |
| Guardian runs after Structure Guardian (Step 5), before final return | ✅ |
| Policy parameter is `undefined` (not passed through); only source used | ⚠️ Policy not wired for directive compliance check |

---

## Flow 5: Snapshot Flow

### Trace Path
```
createSnapshot()                       [resume-snapshot-engine.ts]
  │  Captures: fullResume (deep clone), blueprint, templateBlueprint,
  │            experienceFingerprints[], label, timestamp
  │  Uses extractBlueprint() + extractTemplateBlueprint() internally
  │
  ▼
locked-pipeline.ts (pre-optimization, ~line 98)
  │  beforeSnapshot = createSnapshot(idReadyResume, "pre-optimization")
  │  Emits "snapshot_created" event to globalEventBus
  │
  ▼  [Pipeline runs: optimize → assemble → guardian]
  │
  ▼
locked-pipeline.ts (post-optimization, ~line 253)
  │  afterSnapshot = createSnapshot(assembleResult.resume, "post-optimization")
  │
  ▼
compareSnapshots(beforeSnapshot, afterSnapshot)    [resume-snapshot-engine.ts]
  │  Checks: summary diff, headline diff, experience count,
  │  hallucinated companies (by company name + fingerprint),
  │  education count, languages count, changed institutions
  │
  ▼
locked-pipeline.ts (~line 255)
  │  snapshotDiff.hallucinations → errors[]
  │  snapshotDiff.summary → warnings[]
  │  Hallucinations detection → globalEventBus "hallucinations_detected"
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| `createSnapshot()` captures complete resume state (deep clone) | ✅ |
| Pre-snapshot taken before any LLM calls | ✅ Line ~98 |
| Post-snapshot taken after assembly + guardian | ✅ Line ~253 |
| `compareSnapshots()` checks structural changes + hallucinations | ✅ |
| Hallucinations added to errors array (user-visible) | ✅ |
| Also used in `parallel-pipeline.ts` (identical pattern) | ✅ |

---

## Flow 6: Retry Flow

### Trace Path
```
createRetryEngine()                    [retry-engine.ts]
  │  Creates RetryEngine with:
  │    maxRetries: 3 (default)
  │    baseDelayMs: 1000, maxDelayMs: 30000
  │    backoffFactor: 2 (exponential backoff)
  │  Per-agent retry: retries only the FAILED AGENT, not entire pipeline
  │
  ▼
locked-pipeline.ts (import line 28)
  │  import { createRetryEngine } from "./retry-engine"
  │  ⚠️ IMPORTED but NEVER CALLED in locked-pipeline.ts!
  │
  ▼
locked-pipeline.ts (OWN while loop, ~line 155)
  │  while (attempts < maxAttempts) {
  │    attempts++
  │    try { ... full pipeline ... }
  │    catch (err) {
  │      excludeProviderIds.push(err.provider)  // blacklist
  │      if (attempts >= maxAttempts) → throw LockedPipelineError
  │    }
  │  }
  │  maxAttempts = agentDirectives?.supervisor?.enableProviderSwitch ? 3 : 1
```

### Verdict: ⚠️ GAP DETECTED — `createRetryEngine` Imported But Unused

| Check | Status |
|-------|--------|
| `createRetryEngine` is imported in `locked-pipeline.ts` | ✅ Line 28 |
| `createRetryEngine` is CALLED anywhere in locked-pipeline.ts | ❌ **NEVER CALLED** |
| Locked pipeline has its OWN while-loop retry mechanism | ✅ (separate implementation) |
| Retry engine is instead used by parallel-pipeline.ts? | ❌ Also not used there |
| Retry engine has full API: run(), reset(), getState(), getAllStates() | ✅ Ready for use |
| Locked pipeline's retry: excludes failed provider, retries up to 3x | ✅ Functional but simple |

**Assessment:** The `createRetryEngine` is a more sophisticated per-agent retry mechanism with exponential backoff, per-agent state tracking, and fallback values. It is imported but never invoked. The locked pipeline uses its own simpler while loop instead. This is a **dead import** — either wire it in or remove the import.

---

## Flow 7: Cache Flow

### Trace Path
```
getCachedOptimization()                [semantic-cache.ts]
  │  Builds key from: resume.id + summary + expCount + jd.title +
  │                   jd.company + requiredSkills + directive
  │  Hash → sem_<base36> lookup in Map
  │  Session-only cache (cleared on page refresh)
  │
  ▼
parallel-pipeline.ts (line ~50)
  │  const cached = getCachedOptimization(resume, jd, directiveConfig)
  │  if (cached) {
  │    return cached;  // SKIPS ALL LLM calls
  │  }
  │
  ▼  [If cache MISS, run all 3 LLM agents in parallel]
  │
  ▼
parallel-pipeline.ts (line ~138)
  │  setCachedOptimization(resume, jd, result, directiveConfig)
  │  Stores result for future identical requests
  │
  ▼
locked-pipeline.ts — ⚠️ Does NOT use semantic cache
  │  No getCachedOptimization() call anywhere
  │  No setCachedOptimization() call anywhere
```

### Verdict: ⚠️ GAP DETECTED — Cache Only Used in Parallel Pipeline

| Check | Status |
|-------|--------|
| `getCachedOptimization()` checks cache before LLM in parallel-pipeline.ts | ✅ Line ~50 |
| `setCachedOptimization()` stores result after optimization | ✅ Line ~138 |
| Semantic cache uses content hash of resume+JD+directive | ✅ |
| Locked pipeline (primary path) uses semantic cache | ❌ **NOT WIRED** |
| Cache statistics available via `getSemanticCacheStats()` | ✅ |
| Cache clear via `clearSemanticCache()` | ✅ |

**Assessment:** The semantic cache is only used by the parallel pipeline (opt-in via `NEXT_PUBLIC_USE_PARALLEL_PIPELINE=true`). The locked pipeline, which is the primary/default path, has no cache integration. This means every locked pipeline run incurs full LLM costs even for identical (resume, JD, directive) inputs. **Recommend wiring cache into locked-pipeline.ts** as the first step after entity lock.

---

## Flow 8: Provider Health Flow

### Trace Path
```
recordProviderSuccess()                [provider-health-monitor.ts]
  │  Tracks: totalCalls, successfulCalls, avgLatencyMs (EMA),
  │          successRate, status (healthy/degraded/unhealthy)
  │  Emits "call_success" to globalEventBus
  │
  ▼
parallel-pipeline.ts — each agent runner:
  │  runSummaryAgent() → recordProviderSuccess(result.provider, duration, tokens)
  │  runSkillsAgent()  → recordProviderSuccess(result.provider, duration, tokens)
  │  runExperienceAgent() → recordProviderSuccess(result.provider, duration, tokens)
  │  3 calls, one per agent (Summary, Skills, Experience)
  │
  ▼
locked-pipeline.ts — via bullet-only-optimizer.ts
  │  runBulletOnlyOptimizer() calls callAI() — single LLM call
  │  callAI() MAY internally record provider success (depends on ai.ts)
  │  ⚠️ No direct recordProviderSuccess() call in locked-pipeline.ts
  │
  ▼
Provider selection:
  │  getBestProvider() — highest success rate, not rate-limited, not unhealthy
  │  Used by supervisor to auto-select or guide manual selection
```

### Verdict: ✅ PARTIALLY CONNECTED — Indirect in Locked Pipeline

| Check | Status |
|-------|--------|
| `recordProviderSuccess()` defined and exports complete health API | ✅ |
| Parallel pipeline calls `recordProviderSuccess()` for all 3 agents | ✅ |
| `getBestProvider()` available for health-based selection | ✅ |
| Locked pipeline calls `recordProviderSuccess()` directly | ❌ Indirect only |
| `recordProviderFailure()` exists for rate-limit and error tracking | ✅ |

**Assessment:** The parallel pipeline explicitly records provider health after each agent call. The locked pipeline relies on `callAI()` possibly recording internally. The health monitor is functional but the locked pipeline should add explicit `recordProviderSuccess()` calls after `runBulletOnlyOptimizer()` for consistent telemetry.

---

## Flow 9: Parallel Execution Flow

### Trace Path
```
parallel-pipeline.ts (line ~94)
  │
  │  const [summaryResult, skillsResult, experienceResult] =
  │    await Promise.all([
  │      runSummaryAgent(sourceContext, jdText, jdKeywords,
  │                      directiveConfig, optimizationPolicy),
  │      runSkillsAgent(sourceContext, resume.skills, jdText, jdKeywords,
  │                     directiveConfig, optimizationPolicy),
  │      runExperienceAgent(sourceContext, resume.experience, jdText,
  │                         jdKeywords, directiveConfig, optimizationPolicy),
  │    ]);
  │
  │  Each agent:
  │    1. Builds system prompt with optimizationPolicy + agent rules
  │    2. Calls callAI({ systemPrompt, userPrompt, maxTokens, temperature, ... })
  │    3. Parses response with extractJSON<...>()
  │    4. Calls recordProviderSuccess(provider, duration, tokens)
  │    5. Emits agent-specific event to globalEventBus
  │
  ▼
Assembly (parallel-pipeline.ts line ~120)
  │  optimizerOutput = { summary, headline, skills, experiences }
  │  assembleResume(idReadyResume, optimizerOutput)
  │
  ▼
Snapshots + Cache (post-assembly)
  │  compareSnapshots(beforeSnapshot, afterSnapshot)
  │  setCachedOptimization(resume, jd, result, directiveConfig)
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| 3 agents launched concurrently via `Promise.all()` | ✅ |
| Each agent has independent `callAI()` with own system prompt | ✅ |
| All 3 receive `optimizationPolicy` (directive-derived) | ✅ |
| All 3 record provider health independently | ✅ |
| Results assembled via `assembleResume()` (same as locked pipeline) | ✅ |
| Timing recorded: `parallelDuration = Date.now() - startTime` | ✅ |
| Environment-gated: `NEXT_PUBLIC_USE_PARALLEL_PIPELINE === "true"` | ✅ |

---

## Flow 10: Assembler Flow

### Trace Path
```
assembleResume(sourceResume, optimizerOutput)    [resume-assembler.ts]
  │
  ├─ Section 1: EXPERIENCE — merge source + optimizer bullets
  │    matching by: ID → fingerprint → index fallback
  │    Immutable: title, company, location, startDate, endDate from SOURCE
  │    Mutable: bullets from optimizer
  │
  ├─ Section 2: SUMMARY — from optimizer, validated
  │    Rejects: <30 chars, <60 words, duplicate sentences, JD company names
  │    Falls back to sourceResume.summary on rejection
  │
  ├─ Section 3: HEADLINE — from optimizer, validated
  │    Rejects: JD company names, first-3-words divergence
  │
  ├─ Section 4: SKILLS — from optimizer, forbidden-pattern filtered
  │
  ├─ Section 5: EDUCATION — ALWAYS from source (immutable) ★ LINE 281
  │    const education = sourceResume.education.map((ed) => ({ ...ed }))
  │    Warns if optimizer attempted to return education entries
  │
  ├─ Section 6: LANGUAGES — ALWAYS from source (immutable) ★ LINE 295
  │    const languages = sourceResume.languages.map((l) => ({ ...l }))
  │
  ├─ Section 7: CERTIFICATIONS — ALWAYS from source (immutable)
  │
  ├─ Section 8: CONTACT — ALWAYS from source (immutable)
  │
  └─ Section 9: ASSEMBLE FINAL RESUME
       Merges all sections → finalResume
       Applies cleanupResumeGrammar()
       Runs validateExperienceFingerprints() (warn-only, not blocking)
```

### Verdict: ✅ FULLY CONNECTED — No Gaps

| Check | Status |
|-------|--------|
| Education deep-cloned from `sourceResume.education` (NOT optimizerOutput) | ✅ Line 281 |
| Languages deep-cloned from `sourceResume.languages` (NOT optimizerOutput) | ✅ Line 295 |
| Immutable guard: warns if optimizer returned education/languages | ✅ |
| Certifications, contact, name, DoB all from source | ✅ |
| Summary, headline, skills, bullets are mutable (from optimizer) | ✅ |
| Experience matching: ID → fingerprint → fallback to source bullets | ✅ |
| Post-assembly fingerprint validation runs (warn-only) | ✅ |

---

## Gap Summary

### Critical Gaps

| # | Gap | Location | Severity | Recommendation |
|---|-----|----------|----------|----------------|
| 1 | **`createRetryEngine` imported but never called** | `locked-pipeline.ts` line 28 | **Medium** | Either wire in the retry engine for per-step retry within the while loop, or remove the dead import. The locked pipeline has its own simpler while loop that accomplishes similar goals but lacks exponential backoff and per-agent state tracking. |
| 2 | **Semantic cache not used in locked pipeline** | `locked-pipeline.ts` | **Medium** | Add `getCachedOptimization()` check before `runBulletOnlyOptimizer()` and `setCachedOptimization()` after successful completion. Currently only the parallel pipeline (opt-in) benefits from caching. Every locked pipeline run incurs full LLM cost. |

### Minor Gaps

| # | Gap | Location | Severity | Recommendation |
|---|-----|----------|----------|----------------|
| 3 | **Guardian directive compliance check receives `undefined` policy** | `locked-pipeline.ts` line ~238 | **Low** | `runGuardianValidation(resume, source, undefined)` — the `policy` parameter is never passed. The directive compliance check (check #12) always returns "No policy provided — skipping". Pass `optimizationPolicy` or `directiveConfig`. |
| 4 | **Locked pipeline does not call `recordProviderSuccess()`** | `locked-pipeline.ts` | **Low** | Provider health monitoring is only explicit in the parallel pipeline. Add a `recordProviderSuccess()` call after `runBulletOnlyOptimizer()` succeeds for consistent telemetry. |

### Architecture Notes

| # | Note |
|---|------|
| 1 | The locked pipeline and parallel pipeline are architecturally sound — both use the same `assembleResume()`, `createSnapshot()`, `compareSnapshots()`, and `ensureExperienceIds()`. The shared layer is correctly extracted. |
| 2 | The directive propagation path (UI → Store → Orchestrator → Pipeline → AI prompt) is well-structured with clear transformation layers: `OptimizerDirectiveConfig` → `buildOptimizationPolicy()` → `formatPolicyForPrompt()`. Agents cannot override because the policy is prepended to every system prompt. |
| 3 | The Guardian VETO mechanism is correctly placed as the LAST gate before export. The BLOCKED→retry→exhausted→LockedPipelineError flow is well-designed. |
| 4 | The assembler's immutable entity protection (education, languages, contact, certifications from source) is enforced at the data level — the LLM's output for these sections is silently discarded even if returned. |

---

## Flow Connectivity Matrix

| Flow | Entry Point | Data Path | Exit Point | Connected? |
|------|------------|-----------|------------|------------|
| 1. Blueprint | `extractBlueprint()` | → locked-pipeline.ts L148 → assembler L281 | `ResumeBlueprint` object | ✅ |
| 2. Fingerprint | `computeExperienceFingerprint()` | → entity-lock.ts → assembler fallback match → validate call | `validateExperienceFingerprints()` | ✅ |
| 3. Directive | UI component | → store.ts → orchestrator L816 → locked-pipeline L156 → `buildOptimizerInput()` | System prompt string | ✅ |
| 4. Guardian Veto | `runGuardianValidation()` | → BLOCKED → throw error → catch → excludeProvider → retry/error | `LockedPipelineError` | ✅ |
| 5. Snapshot | `createSnapshot()` | → before/after → `compareSnapshots()` diff | `SnapshotDiff` (hallucinations → errors) | ✅ |
| 6. Retry | `createRetryEngine()` | → **NOT CALLED** (dead import) | Own while loop instead | ⚠️ GAP |
| 7. Cache | `getCachedOptimization()` | → parallel-pipeline.ts L50 → **NOT in locked-pipeline** | Cache hit → return; miss → LLM → set | ⚠️ GAP |
| 8. Provider | `recordProviderSuccess()` | → parallel-pipeline.ts (3 agents) → **indirect in locked** | Health metrics in global map | ⚠️ Partial |
| 9. Parallel | `Promise.all([3 agents])` | → 3× `callAI()` → `recordProviderSuccess()` | Assemble → snapshots → cache | ✅ |
| 10. Assembler | `assembleResume()` | → education L281 (source) → languages L295 (source) | `AssembleResult` with merged resume | ✅ |

---

*End of Audit Report*
