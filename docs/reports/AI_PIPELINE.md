# AI Pipeline

ResumeAI Pro has a **single** AI orchestration pipeline. Every AI feature
(optimizer, ATS, interview, recruiter intelligence) calls it through one
entrypoint — there is no duplicated execution logic.

## Entrypoint

`src/lib/ai.ts` exports `recordAI(...)` and `callAIRaw(...)`. The public,
high-level call is `recordAI`, which:

1. Wraps the call in the Flight Recorder scope.
2. Delegates to `ProviderRouter.chat(...)`.
3. Emits a `FlightRecord` (persisted client-side + optionally to the Worker).

## Layers

```
callAI / recordAI
      │
      ▼
ProviderRouter (src/lib/ai/services/router.ts)   ← single entrypoint
      │  builds provider chain: default → fallbacks → others by priority
      ▼
FallbackManager (services/fallback.ts)            ← retry policy
      │
      ▼
ProviderFactory (services/factory.ts)            ← type string → adapter
      │
      ▼
Provider adapters (providers/*)                   ← one per type
   openai-compatible · claude · gemini · ollama · puter · zai-fallback · custom
```

## Provider abstraction

- Each adapter implements `AIProviderAdapter` (`providers/interface.ts`).
- `ProviderFactory` maps a `type` string → adapter; unknown types fall back to
  `CustomProvider` (request/response templates from the DB row).
- New providers are added by inserting a row in `ai_providers` — **no code
  change** required.

## Middleware hooks (observability, not control flow)

`src/lib/ai/hooks.ts` defines a hook registry around the pipeline lifecycle:
`BeforePrompt`, `AfterPrompt`, `BeforeContext`, `AfterContext`,
`BeforeProvider`, `AfterProvider`, `BeforeResponse`, `AfterResponse`,
`BeforePersist`, `AfterPersist`, `OnSuccess`, `OnFailure`, `OnTimeout`,
`OnRetry`, `OnReflection`, `OnQA`, `OnValidation`, `OnDecision`.

Hooks are **no-ops by default** and can never break execution (errors are
swallowed). Engines attach here:

- **Reflection Engine** — scores/improves the response.
- **QA Engine** — validates output quality.
- **Validation Engine** — schema/constraint validation.
- **Decision Engine** — hiring/quality decisions from the outcome.

## Guarantees (per CLAUDE.md + engineering standards)

Every AI feature supports: provider abstraction, structured logging, retry
logic, timeouts, streaming, reflection, QA validation, Flight Recorder, and
developer diagnostics mode.

## Timeouts

`src/lib/ai.ts` wraps external calls with `AbortSignal.timeout` (Puter sign-in
8s, Puter chat 30s, server `/api/jd-scrape` 15s). On timeout the router falls
through to the next provider instead of hanging.

## Adding a feature

Call `recordAI({ systemPrompt, userPrompt, maxTokens, temperature,
taskCategory })` — do **not** instantiate an adapter directly.
