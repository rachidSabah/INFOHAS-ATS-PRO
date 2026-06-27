# ResumeAI Pro — Provider/Routing Architecture Audit

**Generated**: 2026-06-27  
**Repository**: `C:\Users\InGodWeTrust\Downloads\ATS PRO`  
**Scope**: All provider-related files in `src/lib/ai/` and `src/lib/ai.ts`

---

## Executive Summary

The codebase has **two parallel provider routing architectures**:

1. **`callAI()` in `src/lib/ai.ts`** — The **active production router** (~2639 lines). All real AI calls flow through this function. It handles Puter-first selection, cooldowns, alternate key rotation, fallback chains, and a local offline engine. However, it is monolithic, deeply coupled to Zustand, and mixes low-level HTTP logic with routing decisions.

2. **`ProviderRouter.chat()` in `src/lib/ai/services/router.ts`** — A **cleaner, newer abstraction** (~170 lines) with proper separation of concerns (Factory, FallbackManager, adapters). It is referenced only in comments (`// const res = await ProviderRouter.chat(...)`) and one unused import in `skill-router.ts`. It is **not wired into any production code path**.

This dual-architecture creates maintenance risk: improvements to one are not reflected in the other.

---

## 1. Provider Selection Flow

### Active Path: `selectProvider()` → `callAI()`

**File**: `src/lib/ai.ts` (lines 258–315, 1708–2057)

```
callAI(opts)
  ├─ selectProvider(opts.excludeProviderIds)        [L1738]
  │   ├─ 1. Try Puter (if authenticated)            [L273–287]
  │   │     └─ Dynamic import: ./providers/puter-provider
  │   │     └─ puterProvider.tryRefresh() → checks auth
  │   ├─ 2. User-configured default provider         [L297–300]
  │   │     └─ state.providerSettings.defaultProviderId
  │   ├─ 3. First active non-Puter provider          [L300]
  │   └─ 4. Local engine (offline mode)              [L314]
  │
  ├─ If provider.type === "local" → localGenerate()
  ├─ If provider.type === "puter":
  │   ├─ Try puterProvider.generate() with timeout
  │   ├─ If fails → getOrderedFallbackProviders() chain
  │   │   └─ Loop: try each fallback (with cooldown check)
  │   │   └─ On failure → cooldown marks (429/401/timeout)
  │   └─ If all fail → localGenerate() fallback
  │
  └─ If provider.type is API (non-puter):
      ├─ Try primary provider with timeout
      │   ├─ On 429 → try alternateApiKeys[] rotation
      │   └─ On failure → mark cooldowns
      ├─ Try Puter as fallback (if authenticated)
      ├─ Try getOrderedFallbackProviders() chain
      └─ If all fail → localGenerate() fallback
```

**Key observation**: `selectProvider()` and `callAI()` have **partially duplicated logic**. `callAI()` re-checks Puter auth itself and has its own fallback logic that overlaps with what `selectProvider()` already considered.

### Unused Path: `ProviderRouter.chat()`

**File**: `src/lib/ai/services/router.ts` (lines 38–82)

Cleaner flow with `FallbackManager.buildChain()`:
1. Default provider (from settings)
2. Fallback providers (in saved order)
3. Other active providers by priority (excluding "down" status)

This is the **intended architecture** but never called in production.

---

## 2. Rate-Limit Handling

### Provider Cooldown System

**File**: `src/lib/ai.ts` (lines 1132–1192)

| Cooldown Type | Duration | Storage | Trigger |
|---|---|---|---|
| `PROVIDER_429_COOLDOWN_MS` | **3 minutes** | `sessionStorage` | HTTP 429, rate-limit error strings |
| `PROVIDER_401_COOLDOWN_MS` | **30 minutes** | `sessionStorage` | HTTP 401, billing error strings |
| `PROVIDER_TIMEOUT_COOLDOWN_MS` | **90 seconds** (imported from pipeline-watchdog) | `sessionStorage` | AbortError, timeout messages |
| `PUTER_COOLDOWN_MS` | **5 minutes** | `localStorage` | Usage cap / quota errors |

### Key Functions

- **`isProviderInCooldown(providerId)`** (L1138): Checks `sessionStorage` for timestamp; auto-clears expired entries.
- **`markProvider429Cooldown(providerId)`** (L1157): Sets 3-minute cooldown in `sessionStorage`.
- **`markProvider401Cooldown(providerId)`** (L1167): Sets 30-minute cooldown.
- **`markProviderTimeoutCooldown(providerId)`** (L1185): Sets 90-second cooldown.
- **`isPuterInCooldown()`** / **`markPuterCooldown()`**: Separate Puter-only cooldown in `localStorage` (5 min). Not integrated with the generic provider cooldown system.
- **`clearAllProviderCooldowns()`** (L1203): Clears all cooldowns for manual retry.

### Error Detection Helpers
- **`isPuterQuotaError(err)`** (L1249): Detects "No usage left", "usage limit", "quota exceeded", etc.
- **`isFailedToFetchError(err)`** (L1271): Detects CORS/network/fetch errors.
- **`isTimeoutError(err)`** (L1195): Detects AbortError and timeout messages.
- **`isRateLimitError(err)`** (provider-capabilities.ts L129): Detects 429 from status code, error type, or message regex.

### What's Missing
- No per-provider rate-limit budget tracking (tokens/calls per minute). The `rateLimitPerMinute` field exists on `AIProvider` but is never enforced programmatically.
- The cooldown system is purely client-side (`sessionStorage`). No server-side cooldown coordination for multi-browser scenarios.
- The `ProviderRouter` in `services/router.ts` uses `FallbackManager.shouldRetry()` which has its own 429 logic but no cooldown mechanism — just "don't retry, move to next."

---

## 3. Model Detection

### `fetchProviderModels()` — `src/lib/provider-model-detection.ts`

**Primary entry point** (L42–151):
- Routes through CORS proxy `/api/providers/models` for non-local providers
- Direct `fetch()` to `/models` endpoint for localhost providers
- Falls back to `provider.enabledModels` if API unreachable
- Ultimate fallback: `provider.modelName` as a single-entry list

**Return type**: `ModelDetectionResult` with `{ models: DetectedModel[], source: "api" | "configured" | "fallback" }`

### `DetectedModel` structure (L19–28):
```typescript
{ id, name?, contextLength?, maxTokens?, supportsReasoning?, 
  supportsStreaming?, supportsVision?, supportsToolCalling? }
```

### `ProviderManager.fetchModels()` — `src/lib/ai/services/manager.ts` (L185–237)

Separate model-fetching path for the Provider UI:
- **Puter**: Returns hardcoded static list (8 models: deepseek-v4-flash, deepseek-chat, gpt-oss, glm-4, claude-3-5-sonnet, gpt-4o-mini, gpt-4o, o1-mini)
- **Other providers**: Routes through `/api/providers/models` CORS proxy

### `enabledModels` Field

Each provider in `mock-data.ts` has a curated `enabledModels` array (e.g., OpenCode has 5 free models, NVIDIA has 11 models, OpenRouter has 30+ free models). These serve as both:
1. Fallback model lists when API discovery fails
2. Seed defaults that get merged during provider sync

### Per-Adapter `listModels()`:

| Adapter | Implementation |
|---|---|
| `OpenAICompatibleProvider` | GET `{baseUrl}/models` → `data.data[].id` |
| `ClaudeProvider` | GET `{baseUrl}/models` → `data.data[].id` |
| `GeminiProvider` | Native: GET `{baseUrl}/models?key=`; OpenAI-compat: delegates |
| `OllamaProvider` | GET `{baseUrl}/api/tags` → `data.models[].name` |
| `PuterProvider` | Returns `config.enabledModels` or hardcoded default list |

### What's Missing
- No caching of model lists (fetched fresh on every UI open)
- No differentiation between "available" and "recommended" models
- The hardcoded Puter model list in `manager.ts` (L190–199) differs from the one in `puter-provider.ts` (L13–22)

---

## 4. Provider Health

### Dual Health Implementations

#### A. `provider-health-monitor.ts` (In-Memory Runtime Monitor)

**File**: `src/lib/provider-health-monitor.ts` (170 lines)

- In-memory `Map<string, ProviderHealth>` (session-only, clears on page refresh)
- Tracks: `totalCalls`, `successfulCalls`, `failedCalls`, `rateLimitedCalls`, `avgLatencyMs` (EMA), `successRate`, `isRateLimited`, `status`
- Integrated with `globalEventBus` for real-time monitoring
- Rate-limit flag auto-clears after 30 seconds via `setTimeout`
- Status thresholds: `>=90%` healthy, `>=70%` degraded, else unhealthy
- Provides `getBestProvider()` — filters out rate-limited and unhealthy, sorts by success rate

**Used by**: `locked-pipeline.ts` and `parallel-pipeline.ts` via `recordProviderSuccess()` / `recordProviderFailure()`

#### B. `provider-health.ts` (Store-Based Persisted Health)

**File**: `src/lib/provider-health.ts` (172 lines)

- Reads from Zustand store (`provider.health` field + `provider.usage` field)
- Tracks: `consecutiveFailures`, `consecutiveSuccesses`, `lastSuccessAt`, `lastFailureAt`, `lastError`, `rateLimitedUntil`
- Status thresholds: `consecutiveFailures >= 3` → "down", `>=1` → "degraded"
- Auth status detection for Puter (checks if Puter is loaded and signed in)
- Provides `recordSuccess()` / `recordFailure()` that update the store

**Used by**: Not clearly wired into the call flow; appears to be a separate health-tracking mechanism.

### Health in the AIProvider Type

**File**: `src/lib/types.ts` (L409–417):
```typescript
health?: {
  lastSuccessAt?: string;
  lastFailureAt?: string;
  lastError?: string;
  consecutiveFailures: number;
  consecutiveSuccesses: number;
  rateLimitedUntil?: string;
}
```

### How Health Is Used in Routing

- **`FallbackManager.buildChain()`** filters out providers with `status === "down"` (L47)
- **`provider-health.ts`** sets status to "down" after 3 consecutive failures
- However, `callAI()` in `ai.ts` does NOT check `provider.status` or `provider.health.consecutiveFailures` — it only checks cooldowns via `sessionStorage`. This is a gap.

### What's Missing
- The two health systems (`provider-health-monitor` in-memory + `provider-health` store-based) are **not connected**
- `callAI()` doesn't use health data for routing decisions (only cooldowns)
- `consecutiveFailures` is reset to 0 on success but never incremented by the main `callAI()` flow
- No health-aware routing in the active production path

---

## 5. Fallback Chain

### `getOrderedFallbackProviders()` — `src/lib/ai.ts` (L100–256)

This is the **active fallback chain builder** used by `callAI()`.

**Priority order when chain is ENABLED:**
1. Traverse `fallbackChain.entries` in order (user-configured)
2. Per entry: 5-step provider resolution (exact ID → type match → name match → enabled model match → alias match)
3. Skip entries that are: disabled, excluded, inactive, missing API key

**Priority order when chain is DISABLED (legacy):**
1. All active non-Puter, non-local providers with valid API keys
2. Sorted by `reliabilityRank`: gemini(1) > mistral(2) > nvidia(3) > openrouter(4) > zencode(5) > opencode(6)
3. Free providers (`isOpenCodeZenFree`) pushed to end

**Safety net**: If the chain resolves to 0 providers, falls back to ALL active providers (L228–252).

### `FallbackManager.buildChain()` — `src/lib/ai/services/fallback.ts` (L19–54)

**The unused, cleaner version** — used only by `ProviderRouter`:
1. Default provider (by ID from settings)
2. Fallback providers (by IDs from `settings.fallbackProviderIds`, in order)
3. Other active providers (by `priority` field, excluding "down" status)

### `FallbackChainConfig` Type — `src/lib/types.ts` (L481–492)
```typescript
{
  entries: FallbackChainEntry[];
  enabled: boolean;
  includePuterLastResort: boolean;
  includeLocalEngineLastResort: boolean;
  respectPrimarySelection: boolean;
}
```

### What's Happening in `callAI()`

The fallback chain is actually traversed **twice** in some scenarios:
1. **Puter-primary path** (L1765–1863): If Puter fails → `getOrderedFallbackProviders()` → each fallback tried
2. **API-primary path** (L1867–2057): If primary fails → Puter as fallback → `getOrderedFallbackProviders()`

### What's Missing
- `FallbackManager.shouldRetry()` has its own 429 logic (don't retry) but the callAI loop has its own — they disagree on whether to retry 5xx errors (FallbackManager says yes, callAI cooldowns everything)
- The chain config settings `includePuterLastResort` and `includeLocalEngineLastResort` are defined in the type but **not implemented** in `getOrderedFallbackProviders()`
- `respectPrimarySelection` is defined but never checked

---

## 6. Puter Handling

### Selection Priority

Puter is selected as **first priority** in `selectProvider()` (L273–287):
1. Find the `puter`-type provider in the store
2. Check if active and not excluded
3. Dynamic import `./providers/puter-provider`
4. Call `puterProvider.tryRefresh()` to validate authentication

If Puter is authenticated → returned immediately (L285–287). Otherwise, falls through to API providers.

### Authentication Flow

**Files**: `src/lib/ai.ts` (L336–419), `src/lib/providers/puter-provider.ts` (613 lines)

- **`getPuterStatus()`**: Checks `window.puter` exists and `auth.isSignedIn()`
- **`getPuterUser()`**: Gets user info (email, username) from Puter session
- **`signInToPuter()`**: Called only from UI click handlers (popup requirement)
- **`signOutFromPuter()`**: Clears Puter session
- **`PuterProvider.tryRefresh()`**: Attempts silent token refresh, returns auth status

### Puter Cooldown

Separate from the generic provider cooldown system:
- **Key**: `resumeai-puter-cooldown-until` (in `localStorage`, not `sessionStorage`)
- **Duration**: 5 minutes
- **Trigger**: Quota errors ("No usage left", "usage limit exceeded", etc.)
- **Check**: `isPuterInCooldown()` used in `callAI()` to skip Puter on entry

### Puter in callAI()

Puter is tried at **three different points** in the `callAI()` flow:
1. As primary (L1765): if `selectProvider()` returned it
2. As fallback (L1951–1993): if a non-Puter primary failed
3. In the fallback chain: Puter is excluded from `getOrderedFallbackProviders()` (L126: `p.type !== "puter"`)

### What's Missing
- The Puter cooldown is in `localStorage` (persists across sessions) while all other provider cooldowns are in `sessionStorage` — inconsistent
- No Puter account rotation (unlike the `alternateApiKeys` mechanism for API providers)
- The hardcoded model lists differ between `manager.ts` (L190–199) and `puter-provider.ts` (L13–22)

---

## 7. API Key Management

### `hasValidApiKey()` — `src/lib/ai.ts` (L52–66)

Returns `true` for:
- `puter` and `local` types (no key needed)
- `opencode` type (explicitly free)
- `custom` with `authType === "none"`
- Providers with `requiresApiKey === false`
- Providers whose `apiKey` is a non-empty, non-placeholder string

### Alternate Key Rotation

**File**: `src/lib/ai.ts` (L1893–1929)

When the primary provider returns 429:
1. Check `provider.alternateApiKeys` array (TypeScript field: `string[]`, L381 in `types.ts`)
2. Loop through alternate keys in order
3. Try `callUserProvider()` with `{ ...provider, apiKey: altKey }`
4. If any alternate succeeds → return result immediately
5. If all alternates fail → mark provider with `markProvider429Cooldown()`

### API Key in Seed Data

**File**: `src/lib/mock-data.ts`:
- `p_opencode`: `process.env.NEXT_PUBLIC_OPENCODE_API_KEY ?? ""` (active only if env var present)
- `p_nvidia`: `process.env.NEXT_PUBLIC_NVIDIA_API_KEY ?? ""`
- `p_mistral`: `process.env.NEXT_PUBLIC_MISTRAL_API_KEY ?? ""`
- All others: no seeded API key (user must configure)

### What's Missing
- No built-in key rotation for Puter (Puter uses OAuth, not API keys)
- `alternateApiKeys` is defined in the type but no UI to configure it, and no seed data uses it
- The `ProviderConfig` interface in the adapter layer doesn't include `alternateApiKeys` — it's only in `AIProvider`
- No encryption at rest for API keys in the client-side store (keys are in plaintext in Zustand)

---

## 8. Factory Pattern (Provider Adapters)

### Registry

**File**: `src/lib/ai/services/factory.ts` (L18–40)

19 provider types registered:
| Type | Adapter Class | Notes |
|---|---|---|
| `openai` | `OpenAICompatibleProvider("openai")` | Singleton |
| `opencode` | `OpenAICompatibleProvider("opencode")` | Instance |
| `opencode-zen` | `OpenAICompatibleProvider("opencode-zen")` | Instance |
| `zencode` | `OpenAICompatibleProvider("zencode")` | Instance |
| `nvidia` | `OpenAICompatibleProvider("nvidia")` | Instance |
| `deepseek` | `OpenAICompatibleProvider("deepseek")` | Singleton |
| `groq` | `OpenAICompatibleProvider("groq")` | Singleton |
| `openrouter` | `OpenAICompatibleProvider("openrouter")` | Singleton |
| `together` | `OpenAICompatibleProvider("together")` | Singleton |
| `huggingface` | `OpenAICompatibleProvider("huggingface")` | Singleton |
| `mistral` | `OpenAICompatibleProvider("mistral")` | Singleton |
| `cohere` | `OpenAICompatibleProvider("cohere")` | Singleton |
| `perplexity` | `OpenAICompatibleProvider("perplexity")` | Singleton |
| `claude` | `ClaudeProvider` (extends OpenAICompat) | Overrides chat/listModels |
| `azure-openai` | reuses `openaiProvider` | Same adapter |
| `gemini` | `GeminiProvider` (extends OpenAICompat) | Dual-mode: native + OpenAI-compat |
| `ollama` | `OllamaProvider` | Self-hosted |
| `puter` | `PuterProvider` | Browser-only, window.puter |
| `custom` | `CustomProvider` | Template-based |
| `bedrock` | reuses `customProvider` | Falls back to custom |
| `z-ai-fallback` | `ZaiFallbackProvider` | Server-side REST API |

### Adapter Interface

**File**: `src/lib/ai/providers/interface.ts` (L73–78):
```typescript
interface AIProviderAdapter {
  readonly type: string;
  chat(req: ChatRequest, config: ProviderConfig): Promise<ChatResponse>;
  testConnection(config: ProviderConfig): Promise<{ ok, latencyMs, message, response? }>;
  listModels?(config: ProviderConfig): Promise<string[]>;
}
```

### Dual Usage Problem

The adapters are **only used by** `ProviderRouter.chat()` (unused). The production `callAI()` in `ai.ts` has its own **inline HTTP logic** (`callUserProvider()`, ~600 lines starting at L1380) that duplicates all the provider-specific handling (Gemini native vs OpenAI-compat, auth headers, response parsing). This means:

- Fixing a bug in the adapter doesn't fix it in `callUserProvider()`
- Adding a new provider requires changes in TWO places
- The factory registry lists providers that `callAI()` doesn't use through the factory

### What's Missing
- `callAI()` / `callUserProvider()` should be refactored to use `ProviderFactory.get()` instead of inline HTTP logic
- `OpenAICompatibleProvider.chat()` does direct `fetch()` from the browser, but `callAI()` routes through a CORS proxy — different strategies

---

## 9. Provider Sync (D1 Cloud Sync)

### `src/lib/provider-sync.ts` (366 lines)

**Purpose**: Keep local provider config in sync with seed defaults, detect and repair drift.

### Key Functions

| Function | Purpose |
|---|---|
| `mergeProviderWithSeed(d1Provider, seedProvider)` | Merges D1 provider with seed: restores empty API keys, base URLs, fixes model names, restores timeout/maxTokens |
| `findSeedProvider(d1Provider)` | Matches D1 provider to seed by ID, then name (case-insensitive, substring), then hardcoded type mappings |
| `detectProviderDrift(d1Providers)` | Checks for missing seed providers, empty API keys, invalid models |
| `syncProviderConfigs(d1Providers)` | Main entry: detects drift, merges, backfills missing providers |
| `calculateProviderHash(providers)` | Simple hash to detect state changes |
| `validateProviderState(providers)` | Checks for empty keys, empty models, empty base URLs, low timeouts |
| `reconcileProviderState(providers)` | Auto-repairs using seed data |

### Seed Providers

**File**: `src/lib/mock-data.ts` (L23–456)

7 seed providers total (5 inline + 2 pushed):
- `p_puter` — always active, free
- `p_opencode` — active if `NEXT_PUBLIC_OPENCODE_API_KEY` env var set
- `p_openai` — inactive by default
- `p_anthropic` — inactive by default
- `p_deepseek` — inactive by default
- `p_groq` — inactive by default
- `p_openrouter` — inactive by default (30+ free models listed)
- `p_google_gemini` — inactive by default
- `p_nvidia` — active if `NEXT_PUBLIC_NVIDIA_API_KEY` env var set
- `p_mistral` — active if `NEXT_PUBLIC_MISTRAL_API_KEY` env var set

### Drift Detection Rules
- Seed provider missing from D1 → needs backfill
- D1 provider has empty API key but seed has one → needs repair
- D1 model not in seed's `enabledModels` → needs repair
- Explicitly deleted providers (tracked in localStorage `resumeai-deleted-providers`) are NOT backfilled

### What's Missing
- No server-side sync (D1 mentioned in comments but all sync is client-side)
- No conflict resolution for user-modified providers vs seed updates
- `calculateProviderHash()` uses only first 8 chars of API key — low collision resistance

---

## 10. Existing Caches

### A. Semantic Cache — `src/lib/semantic-cache.ts` (125 lines)

**Purpose**: Skip optimization when Resume + JD + Directive are identical.

- **Key construction**: `resume.id + summary preview + experience count + jd.title + jd.company + required skills count + directive hash`
- **Storage**: In-memory `Map<string, CacheEntry>` (clears on page refresh)
- **Entry**: `{ result: ParallelOptimizerResult, cachedAt, hitCount }`
- **Stats**: `{ size, hits, misses }`

**Wired into**:
- `locked-pipeline.ts` (L170, L446): Checks cache before running optimization, stores result after
- `parallel-pipeline.ts` (L57, L179): Same pattern

**Not wired into**:
- `callAI()` — the cache is at the pipeline level, not the AI-call level
- Provider selection — caching is content-based, not provider-aware

### B. Job Memory Cache — `src/lib/job-memory-cache.ts` (88 lines)

**Purpose**: Avoid re-extracting JD intelligence for the same job.

- **Key**: `"${title}:${company}"` (normalized lowercase)
- **Storage**: In-memory `Map<string, CacheEntry>`
- **Entry**: `{ intelligence: JobIntelligence, cachedAt, hitCount }`

**Wired into**: Referenced only in test files (`__tests__/parallel-pipeline.test.ts`). The `getCachedJobIntelligence` and `setCachedJobIntelligence` functions exist but are **not called** from any production pipeline code.

### What's Missing
- Job Memory Cache is defined but **not wired** into any production code
- Semantic Cache is wired but has no TTL/eviction — grows unbounded for long sessions
- Neither cache persists across page refreshes
- No cache invalidation on provider model change (different models may produce different results)
- No cache statistics exposed to UI (though functions exist)

---

## Summary: What's Dynamic vs Hardcoded

| Component | Dynamic | Hardcoded |
|---|---|---|
| Provider selection order | User-configured fallback chain + reliability rank | Fallback chain disabled → hardcoded rank |
| Rate-limit cooldown durations | ✅ All configurable via constants | `PROVIDER_429_COOLDOWN_MS = 3 min`, `PUTER_COOLDOWN_MS = 5 min` |
| Model lists | ✅ `enabledModels` per provider, fetchable via API | Puter list in manager.ts is hardcoded; single-model fallback |
| Provider health | ✅ Runtime EMA + store-based counters | Status thresholds (3 failures = down) are hardcoded |
| API key sources | ✅ Env vars for seed, user-configurable in UI | `alternateApiKeys` field exists but unused in practice |
| Provider adapters | ✅ Factory registry, extensible via `register()` | `callAI()` doesn't use them — inline logic instead |
| Fallback chain | ✅ Fully user-configurable via UI | Legacy reliabilityRank used when chain is disabled |
| Cache behavior | ✅ Keyed on content hash | No TTL, no max size, no persistence |

---

## Critical Findings

1. **Two parallel router systems**: `callAI()` (production, 2600 lines, monolith) vs `ProviderRouter` (unused, clean, 170 lines). This is the single biggest architectural issue.

2. **Duplication of HTTP logic**: `callUserProvider()` in `ai.ts` duplicates all the authentication, request building, and response parsing that the provider adapters already handle. Provider-specific behavior (Gemini native vs OpenAI-compat, auth types) is implemented twice.

3. **Health tracking is disconnected**: `provider-health-monitor.ts` tracks runtime health (in-memory) while `provider-health.ts` tracks persisted health (store). `callAI()` doesn't use either for routing — it only checks `sessionStorage` cooldowns.

4. **Job Memory Cache is unused**: Defined with 88 lines of code but never called in production. The import exists only in test files.

5. **Puter has a parallel implementation**: There are TWO Puter providers — `src/lib/ai/providers/puter.ts` (adapter for the services layer) and `src/lib/providers/puter-provider.ts` (OAuth implementation used by `callAI()`). They have different model lists, different interfaces, and different cooldown logic.

6. **Cooldown inconsistency**: Puter cooldown uses `localStorage` (persists across sessions), while all other providers use `sessionStorage` (clears on page refresh). Different TTLs, different storage mechanisms.

7. **Fallback chain safe-fail**: Good design — if the user-configured chain resolves to 0 providers, it falls back to all active providers rather than failing.

8. **No circuit-breaker pattern**: Consecutive failures are tracked but there's no exponential backoff for retrying a provider after cooldown expires and it fails again.
