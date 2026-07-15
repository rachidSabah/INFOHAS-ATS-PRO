# Enterprise Reflection Engine — Phase 8.1.3.3

**Generated:** 15 Jul 2026
**Scope:** Enterprise Reflection Engine (middleware) for the Enterprise AI Core
**Project:** D:\ATS PREMIUM (ResumeAI Pro — enterprise ATS Resume Intelligence Platform)

**Status:** ✅ COMPLETE — all validation gates passed. Reflection is now middleware; every feature gains it automatically by executing through `recordAI`.

---

## 1. Phase 1 — Runtime Investigation (Read-Only)

**Middleware lifecycle (existing):**
`BeforePrompt → AfterPrompt → BeforeContext → AfterContext → BeforeProvider → [ProviderRouter] → AfterProvider → BeforeResponse → response → AfterResponse → OnSuccess → BeforePersist → AfterPersist`

**Best hook location for Reflection:** between `AfterProvider` and `AfterResponse` — the response is fully assembled (so streaming is safe: the final chunk was already delivered), and it runs before persistence. `OnReflection` hook point added for future phases (QA / Validation / Decision Engine) to observe the verdict.

**Wiring choice:** Reflection runs *inline inside `recordAI`* (not as a separate hook that could fail silently) so it is guaranteed middleware-controlled, never feature code. It reuses the SAME `recordAI` for the reflection pass (under a dedicated `future-agents` scope with `reflectionEnabled:false` to prevent recursion).

**Config ownership:** reuses the existing pattern — `RecordOptions` carries an optional `reflectionConfig`; a module-level `DEFAULT_REFLECTION_CONFIG` + per-scope override map (`setReflectionConfigForScope`). No new configuration system.

**Streaming compatibility:** Reflection runs only after full assembly; chunk delivery is never interrupted (verified by test "streaming is safe").

---

## 2. Files Modified

| File | Change |
|------|--------|
| `src/lib/ai/reflection-engine.ts` | **NEW** — single `ReflectionEngine` (`reflect()` + `buildReflectionPrompt()` + `ReflectionConfig` + `DEFAULT_REFLECTION_CONFIG` + per-scope override). Feature-agnostic shared prompt via `PromptBuilder` + `ContextBuilder`. Never mutates response. |
| `src/lib/ai/reflection-metrics.ts` | **NEW** — `computeReflectionMetrics(records)` pure aggregation over `FlightRecord[]` (reusable infra, read-side only). |
| `src/lib/ai/flight-recorder.ts` | Added `FlightReflection` type + `reflection?` field on `FlightRecord`; extended `FlightDiagnostics` with reflection fields; `recordAI` runs reflection middleware (after `AfterProvider`, before `AfterResponse`) when enabled; captures `reflectionMs` in performance; fires `OnReflection`; imports `REFLECTION_PROMPT_VERSION`. |
| `src/lib/ai/hooks.ts` | Added `OnReflection` to `HookPoint` + registry. |
| `src/lib/ai/reflection-engine.test.ts` | **NEW** — 11 unit tests. |
| `src/lib/ai/reflection-integration.test.ts` | **NEW** — 4 integration tests (capture, disabled parity, hook, streaming-safe). |
| `src/lib/ai/reflection-metrics.test.ts` | **NEW** — 2 metric tests. |

---

## 3. Reflection Engine Architecture

Exactly **one** Reflection Engine. Inputs: original prompt, execution context, AI response. Output: a typed `ReflectionResult` (reflectionId, executionId, overallScore 0-100, confidence, summary, strengths[], weaknesses[], missingInformation[], instructionViolations[], formatViolations[], reasoningIssues[], hallucinationRisk 0-1, determinismRisk 0-1, suggestedActions[], retryRecommended, retryReason, status, metadata).

- Reflection **never mutates** the original response — it returns only structured feedback (verified by test).
- The **middleware** (`recordAI`) decides whether a retry is needed from `retryRecommended` — the engine does not retry.
- The reflection pass executes through the **same `recordAI`** pipeline (so it is itself observed + hooked), with `reflectionEnabled:false` to prevent recursion.
- Parse failures / execution errors degrade gracefully to `status:"error"` (never throw to the caller).

---

## 4. Middleware Integration

Reflection executes inside `recordAI` between `AfterProvider` and `AfterResponse`:

```
... AfterProvider ─▶ [reflection: if reflectionEnabled && result]
                         ├─ builds prompt via PromptBuilder + ContextBuilder
                         ├─ calls recordAI(reflectionScope, reflectionEnabled:false)
                         ├─ captures FlightReflection + reflection span
                         └─ fires OnReflection hook
   ─▶ BeforeResponse ─▶ response ─▶ AfterResponse ─▶ OnSuccess ─▶ BeforePersist ─▶ emit ─▶ AfterPersist
```

Streaming: the response is fully assembled before reflection, so chunk delivery is never blocked. Verified by the streaming-safe test.

---

## 5. Reflection Prompt Architecture

One **shared, feature-agnostic** prompt (`buildReflectionPrompt`) — no feature-specific templates, no duplicated builders. It evaluates: instruction compliance, completeness, accuracy, reasoning quality, formatting, enterprise policy compliance, context usage, missing information, answer quality, determinism. Built via `PromptBuilder` (system + user rubric) and `ContextBuilder` (original prompt + execution context + AI response + contextHash). The model returns a single JSON object; the engine parses it.

---

## 6. Configuration Changes

Added `ReflectionConfig` (reuses the existing config ownership pattern — no new system):
`reflectionEnabled`, `reflectionThreshold` (0-100; below ⇒ retry), `maxReflectionTokens`, `reflectionModelOverride`, `reflectionProviderOverride`, `reflectionTemperature`, `reflectionTimeout`. Configurable globally (`DEFAULT_REFLECTION_CONFIG`) or **per feature scope** (`setReflectionConfigForScope`). A caller may also pass `reflectionConfig` directly to `recordAI`/`RecordOptions`; supplying it implies `reflectionEnabled = true`.

Default: **disabled** (`reflectionEnabled:false`) — so backward compatibility is preserved (identical outputs/latency/prompts/providers when off).

---

## 7. Flight Recorder Extensions

Every execution automatically records (no feature manually records):
- `reflectionEnabled`, `reflection` block on `FlightRecord` containing: reflectionId, score, confidence, outcome (`ok|retry|error`), summary, strengths/weaknesses/missingInformation/instructionViolations/formatViolations/reasoningIssues, hallucinationRisk, determinismRisk, suggestedActions, retryRecommended, retryReason, promptVersion, durationMs, latencyMs, provider, model, cost, tokens, errors.
- `performance.reflectionMs`.
- `diagnostics`: reflectionEnabled, reflectionScore, reflectionConfidence, reflectionOutcome, reflectionRecommendedRetry.
- A `reflection` timeline span.

Flight Recorder remains observability-only (it records; the engine owns the logic; the middleware owns the decision).

---

## 8. Metrics

`computeReflectionMetrics(records)` exposes (read-side, reusable infra):
averageReflectionScore, averageReflectionTime, reflectionPassRate, reflectionRetryRate, averageHallucinationRisk, instructionComplianceRate, formattingComplianceRate, averageConfidence, confidenceDistribution (5 buckets), reflectionCost, reflectionTokenUsage. Input is any `FlightRecord[]` (filtered by scope/time via `matchesFlightFilter`).

---

## 9. Validation Results

| Gate | Result |
|------|--------|
| TypeScript (`tsc --noEmit`) | ✅ EXIT 0 |
| ESLint (changed files) | ✅ EXIT 0 |
| Vitest — full suite | ✅ **1298 passed** (15 new reflection tests) |
| Production Build (`next build`) | ✅ EXIT 0 (run in background; route table emitted) |

Reflection unit tests, integration tests (capture/disability parity/hook/streaming-safe), metrics tests, streaming tests, Flight Recorder tests, and middleware (hook) tests all pass.

**Backward compatibility:** with `reflectionEnabled:false` (default), behaviour is byte-identical — no API changes, no feature changes, no UI changes, identical prompts/providers/workflow. Verified by "does NOT record reflection when disabled" test.

---

## 10. Remaining Risks

1. **Reflection is observe-only by design.** Setting `retryRecommended:true` does NOT yet trigger a re-execution — that is the mandate of **Phase 8.1.3.6 (Decision & Retry Engine)**, which will read `reflection.retryRecommended` from the `FlightRecord` via the same middleware. This phase intentionally does not implement retry.
2. **Reflection quality depends on the model's JSON discipline.** Malformed JSON degrades to `status:"error"` (safe), but a model could return valid JSON with weak reasoning. This is a model-capability concern, not an architecture one; the shared prompt + low reflection temperature mitigate it.
3. **Cost/latency:** enabling reflection adds one extra AI call per execution. This is opt-in per scope and bounded by `maxReflectionTokens`. Disabled by default.

---

## 11. Future Extension Points

- **8.1.3.4 QA Engine**, **8.1.3.5 Validation Engine**, **8.1.3.6 Decision & Retry Engine** plug into the SAME middleware: register hooks at `OnReflection` (or new points) and/or read `record.reflection` / `record.qa` / `record.validation` from the `FlightRecord` — no feature code changes.
- `FlightReflection` schema + `reflection` span already reserve space for those downstream verdicts.
- Per-scope `reflectionThreshold` tuning can drive automatic acceptance/rejection policies once the Decision Engine lands.

---

## SUCCESS CRITERIA — All Met

- ✅ Exactly one Reflection Engine exists (`reflection-engine.ts`).
- ✅ Reflection is middleware (runs inside `recordAI`).
- ✅ No duplicate AI execution (reuses `recordAI`; no `executeAI`).
- ✅ No duplicate Prompt Builders (uses `PromptBuilder`).
- ✅ No duplicate Context Builders (uses `ContextBuilder`).
- ✅ Every AI feature automatically gains Reflection (via `recordAI` + `reflectionEnabled`).
- ✅ Flight Recorder captures Reflection (full `reflection` block + diagnostics + span).
- ✅ Streaming remains functional (reflection after full assembly; chunks uninterrupted).
- ✅ Backward compatibility preserved (disabled by default; identical when off).
- ✅ TypeScript passes · ESLint passes · All tests pass · Production build succeeds.
