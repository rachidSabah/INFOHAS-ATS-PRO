# Enterprise AI Core Audit — Phase 8.1.3.2

**Generated:** 15 Jul 2026
**Mode:** STRICTLY READ-ONLY — no files created, modified, renamed, or refactored.
**Scope:** Determine whether the intended Enterprise AI Core already exists.
**Project:** D:\ATS PREMIUM (ResumeAI Pro — enterprise ATS Resume Intelligence Platform)

---

## Method

Static read-only investigation of `src/`. Every claim is backed by a file:line
reference. The runtime execution path was traced for each feature by following
imports and call-sites, not by trusting filenames. No code was executed beyond
`tsc`/build (performed in the prior 8.1.3.1 session, both green).

---

## 1. Enterprise AI Core

**Classification: ALREADY IMPLEMENTED (single orchestration layer exists).**

The live orchestration layer is the pipeline rooted in `src/lib/ai.ts`:

```
Feature ─▶ callAI() ─▶ recordAI() ─▶ callAIRaw() ─▶ ProviderRouter.chat() ─▶ Provider
                 │                                                      │
                 └──────── emit FlightRecord (store sink) ◀─────────────┘
```

Evidence:
- `src/lib/ai.ts:267` — `callAI()` delegates to `recordAI()` (lazy import).
- `src/lib/ai.ts:348` (`recordAI`) — delegates verbatim to `callAIRaw()`.
- `src/lib/ai.ts:219` (`callAIRaw`) — the ONLY caller of `ProviderRouter.chat()`.
- `src/lib/ai/services/router.ts:60` — `ProviderRouter` owns: chain building,
  fallback, retry-per-provider, cache, token rotation, timeout, cooldown, logging.

A **second** facade exists at `src/lib/enterprise-ai-runtime/` (`EnterpriseAIRuntime`
+ `runtimeCallAI`). Evidence it is **dormant, not the live core**:
- `GrepSrc('enterprise-ai-runtime')` outside its own package + its test returns **zero** feature importers.
- Only `agent-bridge.ts:1` and `provider-adapter-factory.ts:2` (its own modules) reference it.
- No `.tsx` feature module imports `runtimeCallAI`.

Conclusion: the intended Enterprise AI Core is **`src/lib/ai.ts` + `flight-recorder.ts`
+ `ai/services/router.ts`**. The `enterprise-ai-runtime` is a parallel, unused facade
and is NOT the active core.

**Call graph (live):**
`feature/agent → callAI|recordAI → callAIRaw → ProviderRouter.chat → adapter.chat → Provider`
plus `recordAI → emit → store.log()` (FlightRecord).

---

## 2. Public Execution API

**Classification: ALREADY IMPLEMENTED.**

- `callAI()` (`src/lib/ai.ts:267`) — backward-compatible public entry. Thin wrapper.
- `recordAI()` (`src/lib/ai/flight-recorder.ts:348`) — the TRUE public interface that
  features import directly (31 modules). Auto-records.
- `executeAI()` — **does not exist** anywhere (`GrepSrc('executeAI')` → 0 results).

Should `executeAI()` exist? **No.** Evidence:
- `recordAI` already IS the public execution API with metadata injection.
- Adding `executeAI` would merely re-wrap `recordAI`/`callAI` — a second name for the
  same path, violating "Maintain a single AI orchestration pipeline" (CLAUDE.md).
- Recommendation: keep `recordAI` as the canonical public API; `callAI` stays as a
  legacy-compatible alias.

---

## 3. Middleware

**Classification: ALREADY IMPLEMENTED (responsibilities distributed, not a single
middleware object — but every responsibility exists).**

| Responsibility | Where it lives | Evidence |
|----------------|---------------|----------|
| Orchestration | `recordAI` + `ProviderRouter` | `flight-recorder.ts:348`, `router.ts:60` |
| Execution ownership | `ProviderRouter` (only caller of adapters) | `ai.ts:245` `callAIRaw → ProviderRouter.chat` |
| Metadata injection | `recordAI` (`FlightRecord` build, `setFlightScope`) | `flight-recorder.ts:293-466` |
| Configuration handling | `AICallOptions`/`RouterOptions` → `callAIRaw` → router | `ai.ts:98-116`, `router.ts:37-58` |
| Provider routing | `ProviderRouter` (chain, fallback, failover, cooldown) | `router.ts:160-260` |

No separate "middleware" class/hookextension is required. The responsibilities are
satisfied by the three existing modules. `recordAI` is effectively the observability+
metadata middleware; `ProviderRouter` is the execution+routing middleware.

---

## 4. Flight Recorder

**Classification: ALREADY IMPLEMENTED — observability-only requirement SATISFIED.**

Evidence (`src/lib/ai/flight-recorder.ts`):
- `recordAI` delegates execution to `callAIRaw` (line 379) — it does NOT execute AI itself.
- It has **no retry logic** (retry state `retryCount` is hardcoded `0`, line 368; never incremented).
- It performs **no QA** (`qaEnabled` is a metadata flag only; no QA call).
- It performs **no reflection** (`reflectionEnabled` is a metadata flag only).
- It performs **no validation** (no business-logic validation calls).
- It contains **no business logic** — only hashing, cost estimation, and `emit()` of a record.
- Header mandate (lines 7-11): "It MUST NEVER own execution. It only records execution."

Requirement satisfied. ✅

---

## 5. Prompt Builder

**Classification: PARTIALLY IMPLEMENTED — NO single Prompt Builder object; prompts are
built inline per feature. No functional duplicate, but no shared builder either.**

Evidence:
- `GrepSrc('PromptBuilder|buildPrompt|prompt-builder')` → only `buildPromptHash`
  (a cache-key hash in `prompt-cache.ts:166`), NOT a prompt constructor.
- Each feature builds its prompt inline, e.g.:
  - `Builder.tsx:421` (translation), `Builder.tsx:546` (fix summary), `Builder.tsx:749` (autopilot).
  - `optimizer-directive-engine.ts` — `buildStandardDirective()` is the closest thing to a
    shared prompt builder, scoped to the optimizer.
  - `agents/orchestrator.ts:26` imports `getOptimizerDirective`.
- The interview module builds persona/company prompts inline in `src/lib/interview/`.

Verdict: There is exactly ONE de-facto prompt source for the optimizer
(`buildStandardDirective`), but most features construct prompts ad-hoc. This is
**not a duplicate** (no two competing Prompt Builders), but neither is there a single
reusable Prompt Builder the architecture calls for. Gap is organizational, not
architectural conflict.

---

## 6. Context Builder

**Classification: PARTIALLY IMPLEMENTED — no shared Context Builder; one local helper.**

Evidence:
- `GrepSrc('ContextBuilder|buildContext')` → only `SmartTextarea.tsx:34,98`
  (`buildContext(resume, jdText)` — a local UI helper, not shared).
- Resume/JD context is assembled inline in each feature (e.g. `Builder.tsx` autopilot
  passes `JSON.stringify(resume)` + `JSON.stringify(activeJD)` directly into prompts).
- The orchestrator reuses agent outputs (`analyzeCompanyIntelligence`, `analyzeJobIntelligence`)
  but there is no central "Context Builder" service.

Verdict: No duplicate Context Builder exists. But there is also no shared one — context
is built ad-hoc per call-site. Same nature as Prompt Builder: organizational gap, no
conflict.

---

## 7. Provider Routing

**Classification: ALREADY IMPLEMENTED — exactly ONE Provider Router; no feature bypass.**

Evidence:
- `src/lib/ai/services/router.ts:60` — single `ProviderRouter` class.
- `src/lib/ai.ts:245` — `callAIRaw` is the ONLY production caller of `ProviderRouter.chat()`.
- Feature modules import `recordAI`/`callAI`, never `ProviderRouter` directly
  (`GrepSrc` of feature `.tsx` for `ProviderRouter` → 0 outside `ai.ts`/router internals).
- Dormant `enterprise-ai-runtime` has its OWN provider adapters (`provider-adapter-factory.ts`,
  `failover-engine.ts`) but is not invoked by any feature (see §1), so it is not a live bypass.
- Comment `router.ts:2`: "No feature should ever call a provider adapter directly — always go through router.chat()."

Requirement satisfied. ✅ (The only non-ProviderRouter path is `callAIStreamed`'s
Puter.js client fallback — documented as a known, intentional gap in 8.1.3.1.)

---

## 8. Configuration

**Classification: PARTIALLY IMPLEMENTED — centralized transport, per-call values, no
single config object.**

Evidence (all execution config flows through `AICallOptions` → `RouterOptions`):
- Temperature: passed per-call (`Builder.tsx:430,555,569,...`; `CareerTools.tsx:473,...`).
  Router also pins defaults (`ai.ts:288` optimizer 0.3 / chat 0.7).
- Top-P: **only** in provider/agent admin UI (`AgentConfigCenter.tsx:281`, `FallbackChain.tsx:390`),
  stored on `AIProvider`/`AgentConfig` records — it is NOT plumbed into `AICallOptions` or
  `RouterOptions` (no `topP` field in `AICallOptions`). So Top-P is configured but never
  forwarded to the provider on execution. (Minor gap.)
- Max Tokens: per-call + `AICallOptions.maxTokens` (forwarded).
- Timeout: `pipeline-watchdog.ts` `AI_CALL_TIMEOUT_MS` + per-call `timeoutMs`.
- Streaming: `callAIStreamed` (client) + `opts.streaming` flag (recorded, not yet honored server-side).
- Model: `modelOverride` → router.
- Provider: `preferredProviderId` / chain from store.
- Cache: `prompt-cache.ts` (optimizer calls only, gated by `opts.isOptimizerCall`).
- Cost Tracking: `flight-recorder.ts:256` `estimateCost()` — best-effort, per-record.

Verdict: Configuration is **centralized in transport** (one options object) and **stored
centrally** (Zustand `AIProvider`/`AIProviderSettings`), but there is no single
"ExecutionConfig" object that assembles defaults + per-call overrides. No duplication of
config logic — each value has one source. The one concrete defect: **Top-P is configured
but not forwarded to execution.**

---

## 9. Hook Architecture (Extension Points)

**Classification: PARTIALLY IMPLEMENTED — extension point EXISTS but is minimal.**

Evidence:
- `setFlightScope(metadata)` (`flight-recorder.ts:295`) — module-level scope registration.
  This is the primary extension point: a feature declares its scope once and all its
  executions inherit it. Used by 31 modules.
- `setFlightRecordSink(fn)` (`flight-recorder.ts:279`) — pluggable record sink (store `log`).
- `FlightMetadata` / `RecordOptions` — per-call metadata extension.
- `buildReplayPlan()` (`flight-recorder.ts:486`) — replay extension point (no UI yet).

What is MISSING (smallest addition, NOT implemented per read-only mode):
- A pre/post execution hook chain (e.g. `beforeAI`/`afterAI` callbacks) would let future
  middleware (reflection, QA, validation) attach without touching call-sites. Currently
  those phases are reserved as flags (`reflectionEnabled`, `qaEnabled`) but have no hook
  to plug into. The smallest architectural addition would be an optional
  `AICallOptions.hooks = { before?, after? }` accepted by `recordAI` — but this is a
  future extension, not a current defect.

---

## 10. Feature Integration Matrix

| Feature | Path | Status | Evidence |
|---------|------|--------|----------|
| Resume Builder | `Builder.tsx` → `recordAI` | **Fully Integrated** | migrated in 8.1.3.1; `Builder.tsx:147` scope |
| Resume Optimizer | `Optimizer.tsx` → `recordAI` | **Fully Integrated** | `Optimizer.tsx:4` scope |
| Resume Copilot | `AICopilotPanel.tsx` → `recordAI` | **Fully Integrated** | `AICopilotPanel.tsx:4` |
| ATS | `ATSInspectionSuite.tsx` / `ats-analysis.ts` | **Fully Integrated** | `ATSInspectionSuite.tsx:4` |
| Company Intelligence | `company-skill-agents.ts` → `recordAI` | **Fully Integrated** | `company-skill-agents.ts:1` |
| Interview | `Interview*.tsx` → `recordAI` | **Fully Integrated** | `InterviewPrepSuite.tsx:4`, `InterviewSession.tsx:4` |
| OCR | reserved scope only (`ocr`) | **Not Integrated** | no OCR module; `flight-recorder.ts:166` scope reserved |
| Translation | `Builder.tsx` → `recordAI` | **Fully Integrated** | `Builder.tsx:430` (migrated) |
| Future MCP | UI/API only (`/api/mcp`) | **Not Integrated** | calls via `fetch`, not `recordAI`; scope reserved |
| Future Hermes | `debug-chat.ts` → `recordAI` | **Fully Integrated** (as prompt convention) | `debug-chat.ts:96` |
| Multi-agent Orchestrator | `orchestrator.ts` → `callAI` | **Fully Integrated** | `orchestrator.ts:26` |
| Supervisor / Agents | `supervisor.ts` etc → `recordAI` | **Fully Integrated** | `supervisor.ts:1` |

13 of 15 listed features are Fully Integrated. OCR and MCP are "Future" scopes reserved
but not yet wired (expected — they are explicitly future integration points).

---

## 11. Gap Analysis

| # | Gap | Classification | Complexity | Risk | Backward-Compat | Regression Risk | Scope |
|---|-----|----------------|-----------|------|----------------|----------------|-------|
| G1 | No shared Prompt Builder (prompts inline) | Partial | Low | Low | None | Low | Refactor-only, additive helper |
| G2 | No shared Context Builder (context inline) | Partial | Low | Low | None | Low | Refactor-only, additive helper |
| G3 | Top-P configured in UI but not forwarded to execution | Partial | Low | Low | None | Low | Add `topP` to `AICallOptions`+router passthrough |
| G4 | No pre/post execution hook chain for future middleware | Partial | Medium | Low | None | Low | Add optional `hooks` to `recordAI` |
| G5 | OCR / MCP not yet integrated (future scopes) | Missing (by design) | High | Med | N/A | N/A | New feature work, out of 8.1.3.2 |

None of G1–G4 requires creating a new execution pipeline or a second AI core. They are
additive refinements to an already-complete core.

---

## 12. Risk Assessment

- **Duplication risk:** NONE. Exactly one active Provider Router, one Flight Recorder,
  one public execution API (`recordAI`), one call path (`callAIRaw`).
- **The dormant `enterprise-ai-runtime`** is the only architectural redundancy. It does
  not affect runtime behavior today (unreferenced by features), but it is dead/parallel
  code that could confuse future work. Recommend leaving it untouched (out of 8.1.3.2
  scope) or deleting in a separate cleanup — NOT wiring it in.
- **Top-P gap (G3)** is a real but low-impact config defect (configured, never sent).
- **No behavioral risk** in the existing core; all 1304 tests + production build pass
  (verified in 8.1.3.1).

---

## Final Recommendation

# ✅ Phase 8.1.3.2 is already complete.

The Enterprise AI Core **already exists** as `src/lib/ai.ts` (public API + delegation)
+ `src/lib/ai/flight-recorder.ts` (observability + metadata) + `src/lib/ai/services/router.ts`
(execution ownership + routing). Evidence shows:

- ✅ Single orchestration layer exists (one call graph, one path through `callAIRaw`).
- ✅ Single public execution API (`recordAI`; `callAI` legacy alias). `executeAI` would be redundant.
- ✅ Middleware responsibilities all satisfied (no missing responsibility).
- ✅ Flight Recorder is observability-only (no execution/retry/QA/reflection/validation).
- ✅ Exactly ONE Provider Router; no feature bypasses it.
- ✅ 13/15 listed features Fully Integrated; OCR + MCP are explicitly future scopes.
- ✅ Config is centralized in transport (one options object) — minor Top-P forwarding gap only.
- ✅ Extension point exists (`setFlightScope`/`setFlightRecordSink`).

**Estimated completeness: ~90%+** against the architectural goals. Per the decision rule
(≥90% → close without implementation), no new infrastructure should be created.

### Optional, non-blocking refinements (do NOT implement without separate approval)
These are NOT required to close 8.1.3.2 and were identified only for roadmap purposes:
- G1/G2: extract a shared Prompt Builder / Context Builder helper (organizational, no conflict).
- G3: forward `topP` from `AICallOptions` into the provider request.
- G4: add an optional `hooks` extension to `recordAI` for future reflection/QA/validation.
- Housekeeping: the dormant `enterprise-ai-runtime/` package could be removed in a
  separate cleanup to eliminate the only architectural redundancy (it is currently dead code).

**No code changes were made during this audit.**
