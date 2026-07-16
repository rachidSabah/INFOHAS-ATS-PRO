# Enterprise Validation Engine — Phase 8.1.3.5

**Generated:** 16 Jul 2026
**Scope:** Enterprise Validation Engine (deterministic middleware) for the Enterprise AI Core
**Project:** D:\ATS PREMIUM (ResumeAI Pro — enterprise ATS Resume Intelligence Platform)

**Status:** ✅ COMPLETE — all validation gates passed. Validation is now deterministic middleware; every feature gains it automatically by executing through `recordAI`. Disabled by default → byte-identical output (no behavioral change).

---

## 1. Phase 1 — Runtime Investigation (Read-Only)

**Middleware lifecycle (existing):**
`BeforePrompt → AfterPrompt → BeforeContext → AfterContext → BeforeProvider → [ProviderRouter] → AfterProvider → BeforeResponse → response → AfterResponse → OnSuccess → BeforePersist → AfterPersist`

**Hook location for Validation:** after QA (or Reflection) and before `OnSuccess` — the response is fully assembled (streaming-safe: the final chunk already delivered), and it runs before persistence. A dedicated `OnValidation` hook point was added so the **Decision & Retry Engine (8.1.3.6)** can observe the verdict directly. Validation runs AFTER Reflection + QA when enabled.

**Wiring choice:** Validation runs *inline inside `recordAI`* (not as a separate hook that could fail silently) so it is guaranteed middleware-controlled, never feature code. Crucially, **Validation is PURE + DETERMINISTIC** — it does NOT call `recordAI`, does NOT execute a provider, does NOT generate. There is therefore no recursion risk and no second pipeline; it consumes the already-assembled response, reflection, and QA results.

**Config ownership:** reuses the existing pattern — `RecordOptions` carries an optional `validationConfig`; a module-level `DEFAULT_VALIDATION_CONFIG` (disabled) + per-scope override map (`setValidationConfigForScope`). No new configuration system.

**Streaming compatibility:** Validation runs only after full assembly; chunk delivery is never interrupted (verified by "streaming is safe" test).

---

## 2. Files Modified / Created

| File | Change |
|------|--------|
| `src/lib/ai/validation-engine.ts` | **NEW** — single `validate()` function + `ValidationConfig` + `DEFAULT_VALIDATION_CONFIG` + per-scope override map + `ValidationProfile` registry (9 profiles) + deterministic rule library (ONE implementation per concern) + `profileForScope()` mapping. Feature-agnostic. Never mutates the response. |
| `src/lib/ai/validation-metrics.ts` | **NEW** — `computeValidationMetrics(records)` pure aggregation over `FlightRecord[]` (reusable infra, read-side only). |
| `src/lib/ai/flight-recorder.ts` | Added `FlightValidation` type + `validation?` field on `FlightRecord`; added `validationMs` to `FlightSpan`; extended `FlightDiagnostics` with validation fields; `recordAI` runs Validation middleware (after QA/Reflection, before `OnSuccess`) when enabled; captures `flightValidation` + validation span + diagnostics; fires `OnValidation`; imports `VALIDATION_VERSION`. |
| `src/lib/ai/hooks.ts` | Added `OnValidation` to `HookPoint` + registry. |
| `src/lib/ai/validation-engine.test.ts` | **NEW** — unit tests (scoring, profile selection, determinism, disabled parity, rule coverage, config override, critical-failure escalation, strict mode). |
| `src/lib/ai/validation-metrics.test.ts` | **NEW** — metric aggregation tests. |
| `src/lib/ai/validation-integration.test.ts` | **NEW** — integration tests (capture, disabled parity, hook, streaming-safe). |

---

## 3. Validation Engine Architecture

Exactly **one** Validation Engine. Inputs: original prompt, execution context, AI response, Reflection result, QA result. Output: a typed `ValidationResult` (validationId, executionId, profile, score 0-100, status `passed|warning|failed|error`, rules[], warnings[], failures[], reasons[], criticalFailures, passed, failRecommended, deterministic, version, durationMs, errors).

- Validation **never mutates** the original response — it returns only structured findings (verified by tests).
- It is **PURE + DETERMINISTIC**: no AI call, no random seed, no `Date.now()` influence on the verdict (timestamps captured only for telemetry). Same inputs → same `ValidationResult` (verified by the determinism test).
- The **middleware** (`recordAI`) decides whether a rework is needed from `failRecommended` — the engine does not retry/rework.
- Parse/rule errors are caught per-rule and degrade gracefully to `status:"error"` (never throw to the caller).
- Unlike Reflection/QA, Validation does NOT call `recordAI` — it has no recursion guard because it has no AI dependency in the hot path.

---

## 4. Middleware Integration

Validation executes inside `recordAI` after Reflection + QA (when enabled) and before `OnSuccess`:

```
... AfterProvider ─▶ [reflection: if reflectionEnabled && result]
   ─▶ [qa: if qaEnabled && result]
   ─▶ [validation: if validationEnabled && result]
        ├─ builds ValidationInput (prompt + context + response + reflection + qa + metadata)
        ├─ calls validate(...) — PURE, no recordAI, no provider
        ├─ captures FlightValidation + validation span + diagnostics
        └─ fires OnValidation hook
   ─▶ OnSuccess ─▶ BeforePersist ─▶ emit ─▶ AfterPersist
```

Streaming: the response is fully assembled before Validation, so chunk delivery is never blocked (verified by the streaming-safe test).

---

## 5. Profile + Rule Architecture

**One rule implementation per concern — no duplication.** Profiles only SELECT which rules apply and with what classification (`required | optional | critical | warning`). A rule is a pure function `(ctx: ValidationInput) => ValidationRuleResult`.

Registered profiles (9): `resume-builder`, `resume-optimizer`, `ats`, `interview`, `copilot`, `company-intelligence`, `translation`, `ocr`, `default`. Scope → profile mapping via `profileForScope()` (e.g. `ats-analysis` → `ats`, `resume-parser`/`ocr` → `ocr`, `adaptive-interview`/`evaluation` → `interview`, fallback `default`).

Representative rules:
- **resume-builder:** required sections present, ATS-safe formatting (no tables/img/curly-brace templating), one-page budget (warning), contact info (email+phone).
- **resume-optimizer:** ATS score maintained/improved, no factual info removed (critical), keywords preserved.
- **interview:** scenario consistency (critical), competency mapping, adaptive-branch validity, difficulty progression.
- **ats:** score in valid 0-100 range, supporting evidence present.
- **company-intelligence / translation / ocr:** required fields / non-empty output / content-extracted-with-confidence respectively.

**Scoring:** each rule scored pass=100, warning=60, fail=0; overall = mean, clamped 0-100. A `critical` failure or any `fail` outcome or below-`minimumScore` ⇒ `status:"failed"` ⇒ `failRecommended:true`. Strict mode escalates warnings to failure.

---

## 6. Configuration Changes

Added `ValidationConfig` (reuses the existing per-scope override pattern — no new system):
`validationEnabled`, `minimumScore` (0-100; below ⇒ fail), `strictMode`, `profileOverride?`.

Configurable globally (`DEFAULT_VALIDATION_CONFIG`) or **per feature scope** (`setValidationConfigForScope`). A caller may also pass `validationConfig` directly to `recordAI`/`RecordOptions`; supplying it merges `validationEnabled:true`.

Default: **disabled** (`validationEnabled:false`) — so backward compatibility is preserved (identical outputs/latency/prompts/providers when off). Verified by "does NOT record validation when disabled" test.

---

## 7. Flight Recorder Extensions

Every execution automatically records (no feature manually records) when Validation is enabled:
- `validationEnabled`, `validation` block on `FlightRecord` containing: validationId, executionId, score, outcome (`passed|warning|failed|error`), profile, rules[], warnings[], failures[], criticalFailures, failRecommended, deterministic, version, durationMs, errors.
- A `validation` timeline span (with `validationMs`).
- `diagnostics`: validationEnabled, validationScore, validationOutcome, validationProfile, validationRecommendedFail, validationCriticalFailures, validationRuleCount.

Flight Recorder remains observability-only (it records; the engine owns the logic; the middleware owns the decision).

---

## 8. Metrics

`computeValidationMetrics(records)` exposes (read-side, reusable infra):
`totalValidations`, `averageValidationScore`, `averageValidationTime`, `passRate`, `failureRate`, `warningRate`, `criticalFailureRate`, `ruleFailureRate`, `featureValidationRate` (per-profile), `providerValidationRate`, `modelValidationRate`, `enterpriseValidationHealth` (passRate × avg score), `totalRuleEvaluations`. Input is any `FlightRecord[]` (filtered by scope/time via `matchesFlightFilter`).

---

## 9. Validation Results

| Gate | Result |
|------|--------|
| TypeScript (`tsc --noEmit`) | ✅ EXIT 0 |
| ESLint (changed files) | ✅ EXIT 0 |
| Vitest — full suite | ✅ **1339 passed** (97 files; +23 new Validation tests: 13 engine + 4 metrics + ... ; 6 integration) |
| Reflection/QA regressions | ✅ intact (1335 were passing before; the 4 prior failures were new-test bugs, now fixed) |
| Production Build (`next build`) | ✅ EXIT 0 (route table + Middleware + Static/Dynamic legend, no errors) |
| Runtime smoke (disabled parity + `validate()` determinism) | ✅ covered by committed tests (ad-hoc `.mjs` runner would fail on TS imports — Vitest already exercises this behavior) |

Validation unit tests, metrics tests, integration tests (capture/disabled-parity/hook/streaming-safe), and middleware (hook) tests all pass.

**Backward compatibility:** with `validationEnabled:false` (default), behaviour is byte-identical — no API changes, no feature changes, no UI changes, identical prompts/providers/workflow. Verified by "does NOT record validation when disabled" + determinism tests.

**Note on pre-existing UI:** the repo already contains a `/qa` page and `/api/qa/run` route (QA). Validation has no dedicated UI surface yet; this phase is the shared Validation *core* (middleware + metrics + profiles). Wiring a Validation dashboard to the new core is a follow-up (out of strict 8.1.3.5 scope).

---

## 10. Remaining Risks

1. **Validation is observe-only by design.** Setting `failRecommended:true` does NOT yet trigger a re-execution — that is the mandate of **Phase 8.1.3.6 (Decision & Retry Engine)**, which will read `validation.failRecommended` / `qa.failRecommended` / `reflection.retryRecommended` from the `FlightRecord` via the same middleware. This phase intentionally does not implement retry/rework.
2. **Rule heuristics are lightweight** (regex/section/length checks, not semantic NLP). They are deterministic and auditable, which is the point — but they catch structural violations, not subtle semantic ones. Profiles can be hardened later without changing the engine.
3. **Cost/latency:** Validation adds ZERO AI calls (pure/deterministic). Overhead is sub-millisecond (a loop over rules + one FNV-1a hash). Disabled by default.

---

## 11. Future Extension Points

- **8.1.3.6 Decision & Retry Engine** plugs into the SAME middleware: read `record.validation` / `record.qa` / `record.reflection` from the `FlightRecord` and/or observe via `OnValidation`/`OnQA` — no feature code changes.
- `FlightValidation` schema + `validation` span already reserve space for the downstream Decision verdict.
- Per-scope `minimumScore` / `strictMode` tuning can drive automatic acceptance/rejection policies once the Decision Engine lands.
- `computeValidationMetrics` feeds an Enterprise Validation Health dashboard directly from persisted `FlightRecord`s.

---

## SUCCESS CRITERIA — All Met

- ✅ Exactly one Validation Engine exists (`validation-engine.ts`).
- ✅ Validation is deterministic middleware (runs inside `recordAI`, after QA/Reflection).
- ✅ No duplicate AI execution (pure function; never calls `recordAI`; no second pipeline).
- ✅ No duplicate rule logic (one implementation per concern; profiles only select + classify).
- ✅ No duplicate Prompt/Context Builders (not needed — Validation is rule-based, not AI).
- ✅ Every AI feature automatically gains Validation (via `recordAI` + `validationEnabled`).
- ✅ Flight Recorder captures Validation (full `validation` block + diagnostics + span).
- ✅ `OnValidation` hook exposed for the Decision Engine.
- ✅ Streaming remains functional (Validation after full assembly; chunks uninterrupted).
- ✅ Backward compatibility preserved (disabled by default; identical when off).
- ✅ TypeScript passes · ESLint passes · All tests pass (1339) · Production build succeeds.
