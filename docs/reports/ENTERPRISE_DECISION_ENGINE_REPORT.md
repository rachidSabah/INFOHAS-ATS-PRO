# Enterprise Decision Engine — Phase 8.1.3.6

**Generated:** 16 Jul 2026
**Scope:** Enterprise Decision Engine (deterministic middleware) for the Enterprise AI Core
**Project:** D:\ATS PREMIUM (ResumeAI Pro — enterprise ATS Resume Intelligence Platform)

**Status:** ✅ COMPLETE — all validation gates passed. Decision is now the final deterministic middleware stage; it consumes Reflection + QA + Validation and returns a structured `DecisionResult` (ACCEPT / RETRY / REJECT / ESCALATE / HUMAN_REVIEW / CONTINUE / STOP). Disabled by default → byte-identical output (no behavioral change).

---

## 1. Decision Integration Report (Phase 1 — Read-Only)

**Middleware lifecycle (existing):**
`BeforePrompt → AfterPrompt → BeforeContext → AfterContext → BeforeProvider → [ProviderRouter] → AfterProvider → BeforeResponse → response → AfterResponse → OnSuccess → BeforePersist → AfterPersist`

**Hook location for Decision:** after Validation (and after Reflection/QA) and before `OnSuccess` — the response is fully assembled (streaming-safe: the final chunk already delivered), and it runs before persistence. A dedicated `OnDecision` hook point was added so downstream consumers (the **Retry Engine 8.1.3.7**) can observe the verdict directly. Decision runs AFTER Reflection + QA + Validation when enabled.

**Wiring choice:** Decision runs *inline inside `recordAI`* (not as a separate hook that could fail silently) so it is guaranteed middleware-controlled, never feature code. Crucially, **Decision is PURE + DETERMINISTIC** — it does NOT call `recordAI`, does NOT execute a provider, does NOT generate. There is therefore no recursion risk and no second pipeline; it consumes the already-assembled `flightReflection` / `flightQA` / `flightValidation` results.

**Config ownership:** reuses the existing pattern — `RecordOptions` carries an optional `decisionConfig`; a module-level `DEFAULT_DECISION_CONFIG` (disabled) + per-scope override map (`setDecisionConfigForScope`). No new configuration system.

**Execution context reused:** `merged.scope`, `merged.feature`, `result` (response text/provider/model), and `diagnostics` are all already available in `recordAI`. The Decision Engine needs no new context plumbing.

**Streaming compatibility:** Decision runs only after full assembly; chunk delivery is never interrupted (verified by "streaming is safe" test).

---

## 2. Files Modified / Created

| File | Change |
|------|--------|
| `src/lib/ai/decision-engine.ts` | **NEW** — single `decide()` function (pure/deterministic) + `DecisionConfig` + `DEFAULT_DECISION_CONFIG` + per-scope override map + `DecisionProfile` registry (9 profiles) + deterministic rule library (ONE implementation per concern) + `profileForScope()` mapping + `DECISION_VERSION`. Feature-agnostic. Never mutates the response. |
| `src/lib/ai/decision-metrics.ts` | **NEW** — `computeDecisionMetrics(records)` pure aggregation over `FlightRecord[]` (reusable infra, read-side only). |
| `src/lib/ai/flight-recorder.ts` | Added `FlightDecision` type + `decision?` field on `FlightRecord`; added `decisionEnabled`/`decisionResult` to `FlightRecord`; extended `FlightDiagnostics` with decision fields; `recordAI` runs Decision middleware (after Validation, before `OnSuccess`) when enabled; captures `flightDecision` + decision span + diagnostics; fires `OnDecision`; imports `DECISION_VERSION`. |
| `src/lib/ai/hooks.ts` | Added `OnDecision` to `HookPoint` + registry. |
| `src/lib/ai/decision-engine.test.ts` | **NEW** — unit tests (each rule fires, precedence, disabled parity, determinism, config override, strict mode, confidence gating, profile mapping). |
| `src/lib/ai/decision-metrics.test.ts` | **NEW** — metric aggregation tests. |
| `src/lib/ai/decision-integration.test.ts` | **NEW** — integration tests (capture, disabled parity, hook, streaming-safe, upstream consumption). |

---

## 3. Decision Engine Architecture

Exactly **one** Decision Engine. Inputs: Reflection result, QA result, Validation result, execution context (scope), optional history. Output: a typed `DecisionResult` (decisionId, executionId, profile, status, reason, confidence 0-1, evidence, trace[], rules[], supportingReflection/QA/Validation, deterministic, version, durationMs, errors).

- Decision **never mutates** the original response — it returns only structured verdict (verified by tests).
- It is **PURE + DETERMINISTIC**: no AI call, no random seed, no `Date.now()` influence on the verdict (timestamps captured only for telemetry). Same inputs → same `DecisionResult` (verified by the determinism test).
- **RETRY is EMIT-ONLY this phase.** The engine may return `status:"retry"`, but re-execution is the mandate of **Phase 8.1.3.7 (Retry Engine)**. This engine records + flags; it never retries.
- Rule errors are caught per-rule and degrade gracefully (never throw to the caller).
- Unlike Reflection/QA, Decision does NOT call `recordAI` — it has no recursion guard because it has no AI dependency in the hot path.

---

## 4. Decision Rule Architecture

**One rule implementation per concern — no duplication.** Profiles only SELECT which rules apply (here: all profiles use the standard rule set, since the decision logic is scope-agnostic). A rule is a pure function `(ctx: DecisionInput) => DecisionRuleResult`.

**Evaluation order = precedence** (first triggered rule wins):
1. `validationCriticalFailure` → **REJECT** (validation `criticalFailures > 0`)
2. `validationFailed` → **REJECT** (validation `failed` / `failRecommended`)
3. `criticalQaFailure` → **RETRY** (qa critical finding / critical fail)
4. `qaFailed` → **RETRY** (qa `failRecommended`)
5. `reflectionRetryRecommended` → **RETRY** (reflection `retryRecommended`)
6. `reflectionLowConfidence` → **HUMAN_REVIEW** (reflection confidence < `confidenceThreshold`)
7. `policyConflict` → **ESCALATE** (qa `policyRisk` or reflection `hallucinationRisk` ≥ threshold)
8. `stopOnRepeatedFailure` → **STOP** (config-gated; N consecutive `reject` in history)
9. `allEnginesPass` → **ACCEPT** (all upstream ok/disabled)
10. `defaultContinue` → **CONTINUE** (enabled but nothing triggered)

Rules are **configurable** via `DecisionConfig` (thresholds, strict mode, stop limit, profile override) — no hard-coded business logic in the middleware.

---

## 5. Decision Profiles

Registered profiles (9): `resume-builder`, `resume-optimizer`, `ats`, `interview`, `copilot`, `company-intelligence`, `translation`, `ocr`, `default`. Scope → profile mapping via `profileForScope()` (e.g. `ats-analysis` → `ats`, `resume-parser`/`ocr` → `ocr`, `adaptive-interview`/`evaluation` → `interview`, fallback `default`). All profiles currently share the standard rule set; the registry supports per-profile rule selection for future tuning.

---

## 6. Middleware Integration

Decision executes inside `recordAI` after Reflection + QA + Validation (when enabled) and before `OnSuccess`:

```
... AfterProvider ─▶ [reflection: if reflectionEnabled && result] ─▶ OnReflection
   ─▶ [qa: if qaEnabled && result] ─▶ OnQA
   ─▶ [validation: if validationEnabled && result] ─▶ OnValidation
   ─▶ [decision: if decisionEnabled && result]
        ├─ builds DecisionInput (reflection + qa + validation + scope)
        ├─ calls decide(...) — PURE, no recordAI, no provider
        ├─ captures FlightDecision + decision span + diagnostics
        └─ fires OnDecision hook
   ─▶ OnSuccess ─▶ BeforePersist ─▶ emit ─▶ AfterPersist
```

Streaming: the response is fully assembled before Decision, so chunk delivery is never blocked (verified by the streaming-safe test).

---

## 7. Flight Recorder Extensions

Every execution automatically records (no feature manually records) when Decision is enabled:
- `decisionEnabled`, `decision` block on `FlightRecord` containing: decisionId, enabled, status, reason, confidence, evidence, trace[], rules[], supportingReflection/QA/Validation, deterministic, version, durationMs, errors.
- A `decision` timeline span (with `durationMs`).
- `diagnostics`: decisionEnabled, decisionStatus, decisionReason, decisionConfidence, decisionEvidence, decisionRuleCount.

Flight Recorder remains observability-only (it records; the engine owns the logic; the middleware owns nothing beyond capture).

---

## 8. Metrics

`computeDecisionMetrics(records)` exposes (read-side, reusable infra):
`totalDecisions`, `decisionDistribution` (per status), `acceptanceRate`, `retryRecommendationRate`, `humanReviewRate`, `escalationRate`, `rejectionRate`, `stopRate`, `averageDecisionConfidence`, `averageDecisionTime`, `featureDecisionRate` (per-profile), `providerDecisionRate`, `modelDecisionRate`, `enterpriseDecisionHealth` (acceptanceRate × 100). Input is any `FlightRecord[]` (filtered by scope/time via `matchesFlightFilter`).

---

## 9. Configuration

Added `DecisionConfig` (reuses the existing per-scope override pattern — no new system):
`decisionEnabled`, `strictMode`, `confidenceThreshold` (0-1), `policyRiskThreshold` (0-1), `hallucinationRiskThreshold` (0-1), `stopAfterRepeatedFailures`, `profileOverride?`.

Configurable globally (`DEFAULT_DECISION_CONFIG`) or **per feature scope** (`setDecisionConfigForScope`). A caller may also pass `decisionConfig` directly to `recordAI`/`RecordOptions`; supplying it merges `decisionEnabled:true`.

Default: **disabled** (`decisionEnabled:false`) — so backward compatibility is preserved (identical outputs/latency/prompts/providers when off). Verified by "does NOT record decision when disabled" test.

---

## 10. Performance Impact

- **Zero added AI calls** — Decision is a pure function (no `recordAI`, no provider).
- Overhead is sub-millisecond: a single loop over ~10 rules + one FNV-1a-style id hash. Negligible relative to provider latency.
- Disabled by default → identical latency/behavior.
- No streaming/retry/caching behavior altered.

---

## 11. Validation Results

| Gate | Result |
|------|--------|
| TypeScript (`tsc --noEmit`) | ✅ EXIT 0 |
| ESLint (changed files) | ✅ EXIT 0 |
| Vitest — Decision tests | ✅ 23 passed (engine + metrics + integration) |
| Vitest — full suite | ✅ **1362 passed** (97 → 100 files; +23 new Decision tests) |
| Reflection/QA/Validation regressions | ✅ intact (their tests unchanged) |
| Production Build (`next build`) | ✅ EXIT 0 (route table + Middleware + Static/Dynamic legend, no errors) |
| Runtime smoke (disabled parity + `decide()` determinism) | ✅ covered by committed tests (ad-hoc `.mjs` runner skipped — TS imports won't run under Node, and Vitest already exercises exactly this) |

Decision unit tests, metrics tests, integration tests (capture/disabled-parity/hook/streaming-safe/upstream-consumption), and middleware (hook) tests all pass.

**Backward compatibility:** with `decisionEnabled:false` (default), behaviour is byte-identical — no API changes, no feature changes, no UI changes, identical prompts/providers/workflow. Verified by "does NOT record decision when disabled" test.

---

## 12. Remaining Risks

1. **Emit-only retry:** `status:"retry"` is recorded but no re-execution occurs — that is the mandate of **Phase 8.1.3.7 (Retry Engine)**, which will read `decision.status === "retry"` (and the upstream `qa.failRecommended` / `reflection.retryRecommended`) from the `FlightRecord` and re-run the pipeline. This phase intentionally does not implement retry.
2. **Rule heuristics are deterministic, not semantic.** Confidence/policy/hallucination thresholds come from the upstream engines; they are configurable per-scope without changing the engine.
3. **`STOP` requires history.** The stop-on-repeated-failure rule is config-gated and only triggers when a `history` array of prior `decisionStatus` values is supplied (e.g. by the Retry Engine across attempts). Without history it is a no-op.

---

## 13. Future Extension Points

- **8.1.3.7 Retry Engine** plugs into the SAME middleware: read `record.decision` (and `record.qa`/`record.reflection`) from the `FlightRecord` and/or observe via `OnDecision` — no feature code changes.
- `FlightDecision` schema + `decision` span already reserve space for the downstream Retry verdict (`nextDecision?` on `InterviewContextMeta` is a pre-reserved slot).
- Per-scope threshold tuning can drive automatic accept/reject/escalate policies; `computeDecisionMetrics` feeds an Enterprise Decision Health dashboard directly from persisted `FlightRecord`s.

---

## SUCCESS CRITERIA — All Met

- ✅ Exactly one Decision Engine exists (`decision-engine.ts`).
- ✅ Decision consumes Reflection, QA, and Validation (via `flightReflection`/`flightQA`/`flightValidation`).
- ✅ Decision never executes AI.
- ✅ Decision never retries AI (RETRY is emit-only this phase).
- ✅ Decision integrates through Enterprise AI Core (`recordAI` middleware + `OnDecision` hook).
- ✅ Flight Recorder automatically records decisions (full `decision` block + diagnostics + span).
- ✅ Feature modules remain unchanged (no call-site edits).
- ✅ Backward compatibility preserved (disabled by default; identical when off).
- ✅ All validation gates pass (`tsc` / ESLint / Vitest 1362 / `next build`).
- ✅ Production build succeeds.
- ✅ Runtime smoke (disabled parity + determinism) covered by committed tests.
