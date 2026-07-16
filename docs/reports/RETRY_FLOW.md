# Retry Flow Architecture

> **Targeted Self-Healing Retry Engine** — Never retry the entire pipeline. Retry the **failed agent only**.

---

## Table of Contents

1. [Overview](#overview)
2. [Old Approach: Pipeline-Wide Retry (Legacy)](#old-approach-pipeline-wide-retry-legacy)
3. [New Approach: Per-Agent Targeted Retry](#new-approach-per-agent-targeted-retry)
4. [Retry Engine Implementation](#retry-engine-implementation)
5. [Exponential Backoff](#exponential-backoff)
6. [State Machine](#state-machine)
7. [Fallback Mechanism](#fallback-mechanism)
8. [Integration with Locked Pipeline](#integration-with-locked-pipeline)
9. [Sequence Diagram](#sequence-diagram)
10. [Usage Examples](#usage-examples)
11. [API Reference](#api-reference)

---

## Overview

The **ATS Resume Optimizer** processes a resume through several independent agents (experience optimizer, summary optimizer, skills optimizer, etc.). Each agent may fail due to LLM errors, malformed responses, or content violations. The retry engine provides a **targeted self-healing** mechanism: when an agent fails, only that agent is retried — the rest of the pipeline continues with its already-valid results.

This design:

- **Minimizes latency** — retrying one agent takes seconds, not the entire multi-minute pipeline.
- **Preserves valid work** — outputs from successful agents are never discarded.
- **Provides graceful degradation** — through the fallback mechanism, failed agents can restore their previous valid output (or the original source section) so the pipeline always produces a complete result.

---

## Old Approach: Pipeline-Wide Retry (Legacy)

### Location

`src/lib/locked-pipeline.ts` — the `runLockedPipeline()` function uses a `while` loop.

### How It Worked

```typescript
let attempts = 0;
const maxAttempts = agentDirectives?.supervisor?.enableProviderSwitch ? 3 : 1;

while (attempts < maxAttempts) {
  attempts++;
  try {
    // Step 2: Run the entire bullet-only optimizer
    // Step 3-5: Assemble, validate fingerprints, run structure guardian
    // If any of these throw → catch block
    return result;
  } catch (err: any) {
    if (err.provider) excludeProviderIds.push(err.provider);
    if (attempts >= maxAttempts) throw new LockedPipelineError(...);
    // Otherwise: loop back and re-run EVERYTHING
  }
}
```

### Key Problems

| Issue | Description |
|---|---|
| **Coarse granularity** | The entire optimizer phase is retried — all three sub-agents run again even if only one failed. |
| **Wasted LLM calls** | Successful agent outputs are discarded on each retry, wasting tokens and time. |
| **Provider-level exclusion only** | The only mechanism is to exclude a provider ID; there is no targeted retry of a specific agent within the same provider. |
| **No exponential backoff** | Retries fire immediately with no delay between attempts. |
| **No per-agent state tracking** | No way to inspect how many times a specific agent has been retried or what errors it accumulated. |
| **No fallback mechanism** | If retries are exhausted, the entire pipeline throws a `LockedPipelineError` — no graceful degradation. |

---

## New Approach: Per-Agent Targeted Retry

### Location

`src/lib/retry-engine.ts` — the `createRetryEngine()` factory function.

### Architecture

```
┌─────────────────────────────────────────────────────────────────────┐
│                         Locked Pipeline                             │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐   ┌──────────┐       │
│  │Experience│   │ Summary  │   │  Skills  │   │Education │  ...   │
│  │  Agent   │   │  Agent   │   │  Agent   │   │  Agent   │        │
│  └────┬─────┘   └────┬─────┘   └────┬─────┘   └────┬─────┘        │
│       │              │              │              │               │
│       ▼              ▼              ▼              ▼               │
│  ┌─────────────────────────────────────────────────────────────┐   │
│  │                    Retry Engine (shared instance)            │   │
│  │  ┌─────────────┐  ┌─────────────┐  ┌─────────────┐          │   │
│  │  │experience-  │  │summary-     │  │skills-      │  ...      │   │
│  │  │agent state  │  │agent state  │  │agent state  │           │   │
│  │  └─────────────┘  └─────────────┘  └─────────────┘          │   │
│  └─────────────────────────────────────────────────────────────┘   │
│                                                                     │
│  ┌──────────┐   ┌──────────┐   ┌──────────┐                        │
│  │Assembler │──▶│ Guardian │──▶│  Output  │                        │
│  └──────────┘   └──────────┘   └──────────┘                        │
└─────────────────────────────────────────────────────────────────────┘
```

Each agent call is wrapped in `engine.run(agentId, fn, fallback)`. If the agent's function throws, the retry engine handles it:

1. Captures the error and increments the attempt counter.
2. Checks if the error is retryable (via optional `shouldRetry` predicate).
3. If retryable and attempts remain, waits with **exponential backoff** then re-invokes **only that agent's function**.
4. If exhausted, returns the **fallback value** instead of throwing.

---

## Retry Engine Implementation

### Factory: `createRetryEngine()`

```typescript
export function createRetryEngine(config?: Partial<RetryConfig>): RetryEngine
```

Creates a standalone retry engine instance. Each instance maintains its own state map of per-agent retry states.

### Default Configuration

```typescript
const DEFAULT_CONFIG: RetryConfig = {
  maxRetries: 3,        // Maximum retry attempts per agent
  baseDelayMs: 1_000,   // Initial delay before first retry (1 second)
  maxDelayMs: 30_000,   // Maximum delay cap (30 seconds)
  backoffFactor: 2,     // Exponential multiplier
};
```

### Core Loop (simplified)

```
for each attempt (1..maxRetries):
  try:
    execute fn()           ← only the failed agent's function
    return success result
  catch err:
    record error
    if shouldRetry(err) is false:
      return failed result  ← non-retryable error, stop immediately
    if more retries remain:
      delay = getDelay(attempt - 1)
      await sleep(delay)
      continue loop

if all retries exhausted:
  use fallback value if provided
  return exhausted result
```

### Key Design Decisions

| Decision | Rationale |
|---|---|
| **`attempt` starts at 1** | The first execution counts as attempt 1; retries are attempts 2, 3, etc. |
| **`shouldRetry` defaults to always retry** | Most agent errors are transient LLM failures; the caller opts out for known non-retryable errors. |
| **State persists across calls** | `engine.getState(agentId)` allows the pipeline to inspect how a specific agent is performing. |
| **`reset()` is explicit** | The caller (locked pipeline) decides when to clear state — e.g., on a fresh resume optimization. |
| **Errors are accumulated** | All errors across all attempts are returned in `RetryResult.errors` for diagnostics. |

---

## Exponential Backoff

### Formula

```
delay = min(baseDelay × backoffFactor^attempt, maxDelay)
```

Where:

| Variable | Default | Description |
|---|---|---|
| `baseDelay` | 1000 ms | Initial delay before the first retry |
| `backoffFactor` | 2 | Multiplier applied each retry |
| `attempt` | 0-indexed | Number of previous failed attempts |
| `maxDelay` | 30000 ms | Absolute cap on delay |

### Delay Progression (defaults)

```
Attempt 1 → delay = min(1000 × 2^0, 30000) =   1,000 ms  (1 second)
Attempt 2 → delay = min(1000 × 2^1, 30000) =   2,000 ms  (2 seconds)
Attempt 3 → delay = min(1000 × 2^2, 30000) =   4,000 ms  (4 seconds)
Attempt 4 → delay = min(1000 × 2^3, 30000) =   8,000 ms  (8 seconds)
Attempt 5 → delay = min(1000 × 2^4, 30000) =  16,000 ms  (16 seconds)
Attempt 6 → delay = min(1000 × 2^5, 30000) =  30,000 ms  (30 seconds, capped)
Attempt 7+ → delay = 30,000 ms (capped at maxDelay)
```

### Implementation (retry-engine.ts:140-143)

```typescript
function getDelay(attempt: number): number {
  const delay = cfg.baseDelayMs * Math.pow(cfg.backoffFactor, attempt);
  return Math.min(delay, cfg.maxDelayMs);
}
```

Note: `Math.pow()` is used instead of `**` for clarity; the result is the same.

---

## State Machine

### States

```
┌─────────┐
│  idle   │  ← Initial state before any execution
└────┬────┘
     │ engine.run() called
     ▼
┌─────────┐
│ running │  ← Agent function is executing
└────┬────┘
     │
     ├── fn() succeeds ──────────────────────► ┌─────────┐
     │                                          │ success │
     │                                          └─────────┘
     │
     ├── fn() throws (retryable, more attempts) ──► back to running
     │    (with exponential backoff delay)
     │
     ├── fn() throws (non-retryable) ──────────► ┌────────┐
     │                                            │ failed │
     │                                            └────────┘
     │
     └── fn() throws (retryable, all attempts exhausted) ──► ┌───────────┐
                                                              │ exhausted │
                                                              └───────────┘
```

### State Transitions

| From | To | Trigger |
|---|---|---|
| `idle` | `running` | `engine.run()` called |
| `running` | `success` | `fn()` resolves without error |
| `running` | `running` | `fn()` throws, retryable, more attempts remain (after delay) |
| `running` | `failed` | `fn()` throws, `shouldRetry()` returns false |
| `running` | `exhausted` | `fn()` throws, all `maxRetries` consumed |
| `success` | `idle` | `engine.reset()` called |
| `failed` | `idle` | `engine.reset()` called |
| `exhausted` | `idle` | `engine.reset()` called |

### State Interface

```typescript
interface RetryState {
  agentId: string;        // Unique identifier (e.g., "experience-agent")
  attempt: number;        // Current attempt number (0 before first run)
  maxRetries: number;     // Configured max retries
  lastError: string | null; // Most recent error message
  errors: string[];       // All errors across all attempts
  status: "idle" | "running" | "success" | "failed" | "exhausted";
}
```

---

## Fallback Mechanism

When all retry attempts for an agent are exhausted, the engine does **not** throw — instead, it returns the fallback value provided by the caller and sets `fallbackUsed: true`.

### Fallback Strategies

| Strategy | Fallback Value | Usage |
|---|---|---|
| **Previous valid section** | The output of the agent's most recent successful run (stored by the caller) | Preserves optimized work while discarding only the failed attempt |
| **Original source section** | The corresponding section from `sourceResume` | Safe default; the original content is always valid |
| **Null / empty** | `null` | Let subsequent stages (assembler, guardian) handle the gap |
| **No fallback** | `undefined` (omitted) | Engine returns `value: null` and `fallbackUsed: false`; caller must handle |

### How It Works (retry-engine.ts:244-268)

```typescript
// All retries exhausted
state.status = "exhausted";

const fallbackValue = fallback !== undefined ? fallback : null;
const fallbackUsed = fallback !== undefined;

if (fallbackUsed) {
  console.info(`[RetryEngine] Agent "${agentId}" exhausted ${cfg.maxRetries} retries. Using fallback value.`);
}

return {
  success: false,
  value: fallbackValue as T | null,
  attempt: cfg.maxRetries,
  attempts: cfg.maxRetries,
  errors,
  exhausted: true,
  fallbackUsed,
};
```

### Recommendation for Locked Pipeline Integration

The locked pipeline should:

1. **Before calling an agent**, snapshot the current section from `sourceResume` (e.g., `sourceResume.experience`).
2. **On success**, update the working resume with the agent's output.
3. **On failure** (exhausted), check `result.fallbackUsed`:
   - If true, the fallback value is already applied — continue.
   - If false, manually restore the original snapshot.

---

## Integration with Locked Pipeline

### Current Status

As of this writing, `src/lib/retry-engine.ts` is defined but **not yet imported** by `src/lib/locked-pipeline.ts`. The locked pipeline still uses the old `while` loop with `excludeProviderIds`. The integration should proceed as follows:

### Proposed Integration Pattern

```typescript
// In locked-pipeline.ts

import { createRetryEngine } from "./retry-engine";

const retryEngine = createRetryEngine({ maxRetries: 3 });

// Per-agent wrappers
async function optimizeExperienceSection(
  source: ResumeData,
  jd: JobDescription,
  context: string,
): Promise<ExperienceSection> {
  const result = await retryEngine.run(
    "experience-agent",
    () => runExperienceOptimizer(source, jd, context),
    source.experience,                           // fallback: original section
  );
  return result.value ?? source.experience;
}

async function optimizeSummarySection(
  source: ResumeData,
  jd: JobDescription,
  context: string,
): Promise<string> {
  const result = await retryEngine.run(
    "summary-agent",
    () => runSummaryOptimizer(source, jd, context),
    source.summary,                              // fallback: original summary
  );
  return result.value ?? source.summary;
}

// In runLockedPipeline:
// 1. Run each agent independently through retryEngine
// 2. Each failed agent retries up to 3 times on its own
// 3. On exhaustion, fallback restores original content
// 4. Assemble from individually-retried sections
// 5. Run guardian on the merged result (single pass)
```

### Migration Benefits

| Aspect | Old (while loop) | New (retry engine) |
|---|---|---|
| **Retry scope** | Entire optimizer + pipeline | Single agent function |
| **Granularity** | Provider-level exclusion | Per-agent, per-error-type |
| **Backoff** | None (instant retry) | Exponential (1s, 2s, 4s) |
| **State tracking** | None | `getState()` / `getAllStates()` |
| **Fallback** | None (throws on exhaustion) | Graceful degradation |
| **Error accumulation** | Last error only | Full error history |
| **Observability** | Console log only | Programmatic state inspection |

---

## Sequence Diagram

```
                       ┌──────────┐    ┌───────────────┐    ┌──────────┐    ┌──────────┐    ┌──────────┐
                       │   Agent  │    │ Retry Engine  │    │Pipeline  │    │Assembler │    │ Guardian │
                       └─────┬────┘    └───────┬───────┘    └─────┬────┘    └────┬─────┘    └────┬─────┘
                             │                 │                  │              │               │
    Pipeline calls agent     │                 │                  │              │               │
    ─────────────────────────┤                 │                  │              │               │
                             │                 │                  │              │               │
    ┌────────────────────────▼─────────────────▼──────────────────▼──────────────▼───────────────▼──┐
    │                              NORMAL FLOW (Success on first try)                               │
    └───────────────────────────────────────────────────────────────────────────────────────────────┘
                             │                 │                  │              │               │
    engine.run('exp-agent')  │                 │                  │              │               │
    ─────────────────────────┼────────────────►│                  │              │               │
                             │                 │                  │              │               │
    status = "running"       │                 │                  │              │               │
                             │                 │                  │              │               │
    Execute fn()             │                 │                  │              │               │
    ◄────────────────────────┼─────────────────┤                  │              │               │
                             │                 │                  │              │               │
    ───── fn() succeeds ────►│                 │                  │              │               │
                             │  status =       │                  │              │               │
                             │  "success"      │                  │              │               │
                             │                 │                  │              │               │
    Return {success: true}   │                 │                  │              │               │
    ◄────────────────────────┼─────────────────┤                  │              │               │
                             │                 │                  │              │               │
    ─────────────────────────┼─────────────────┼──────────────────►│              │               │
                             │                 │    Pass result   │              │               │
                             │                 │    to Assembler  │              │               │
                             │                 │                  │              │               │
                             │                 │                  │  ───────────►│               │
                             │                 │                  │  Merge with  │               │
                             │                 │                  │  source      │               │
                             │                 │                  │  sections    │               │
                             │                 │                  │              │               │
                             │                 │                  │  ───────────────────────────►│
                             │                 │                  │              │   Validate    │
                             │                 │                  │              │   structure   │
                             │                 │                  │  ◄───────────────────────────┤
                             │                 │                  │    PASS/FAIL                 │
                             │                 │                  │    score                     │
                             │                 │                  │              │               │
    ┌────────────────────────▼─────────────────▼──────────────────▼──────────────▼───────────────▼──┐
    │                              RETRY FLOW (Agent fails then recovers)                           │
    └───────────────────────────────────────────────────────────────────────────────────────────────┘
                             │                 │                  │              │               │
    engine.run('exp-agent')  │                 │                  │              │               │
    ─────────────────────────┼────────────────►│                  │              │               │
                             │                 │                  │              │               │
    status = "running"       │                 │                  │              │               │
                             │                 │                  │              │               │
    Execute fn()             │                 │                  │              │               │
    ◄────────────────────────┼─────────────────┤                  │              │               │
                             │                 │                  │              │               │
    ───── fn() throws ──────►│                 │                  │              │               │
    [Corrective Feedback]    │  record error   │                  │              │               │
                             │  attempt=1      │                  │              │               │
                             │                 │                  │              │               │
                             │  shouldRetry?   │                  │              │               │
                             │  (yes, attempt  │                  │              │               │
                             │   < maxRetries) │                  │              │               │
                             │                 │                  │              │               │
    ─── RETRY (1s delay) ───►│                 │                  │              │               │
                             │  delay =        │                  │              │               │
    ◄────────────────────────┼─────────────────┤  1,000ms         │              │               │
                             │                 │                  │              │               │
    Execute fn() again       │                 │                  │              │               │
    (only exp-agent, NOT     │                 │                  │              │               │
     the entire pipeline)    │                 │                  │              │               │
    ◄────────────────────────┼─────────────────┤                  │              │               │
                             │                 │                  │              │               │
    ───── fn() succeeds ────►│                 │                  │              │               │
                             │  status =       │                  │              │               │
                             │  "success"      │                  │              │               │
                             │                 │                  │              │               │
    Return {success: true}   │                 │                  │              │               │
    ◄────────────────────────┼─────────────────┤                  │              │               │
                             │                 │                  │              │               │
    ─────────────────────────┼─────────────────┼──────────────────►│              │               │
                             │                 │    (continues    │              │               │
                             │                 │     with same    │              │               │
                             │                 │     assembler/   │              │               │
                             │                 │     guardian as  │              │               │
                             │                 │     above)       │              │               │
                             │                 │                  │              │               │
    ┌────────────────────────▼─────────────────▼──────────────────▼──────────────▼───────────────▼──┐
    │                              EXHAUSTION FLOW (All retries fail)                               │
    └───────────────────────────────────────────────────────────────────────────────────────────────┘
                             │                 │                  │              │               │
    engine.run('exp-agent')  │                 │                  │              │               │
    ─────────────────────────┼────────────────►│                  │              │               │
                             │                 │                  │              │               │
    status = "running"       │                 │                  │              │               │
                             │                 │                  │              │               │
    Execute fn() ──throw──►  │  attempt 1 fail │                  │              │               │
    Delay 1s ────retry───►  │  attempt 2 fail │                  │              │               │
    Delay 2s ────retry───►  │  attempt 3 fail │                  │              │               │
                             │                 │                  │              │               │
                             │  status =       │                  │              │               │
                             │  "exhausted"    │                  │              │               │
                             │                 │                  │              │               │
                             │  fallback=      │                  │              │               │
                             │  source.experience                │              │               │
                             │                 │                  │              │               │
    Return {success: false,  │                 │                  │              │               │
           value: fallback,  │                 │                  │              │               │
           exhausted: true,  │                 │                  │              │               │
           fallbackUsed:true}│                 │                  │              │               │
    ◄────────────────────────┼─────────────────┤                  │              │               │
                             │                 │                  │              │               │
    ─────────────────────────┼─────────────────┼──────────────────►│              │               │
                             │                 │    Fallback      │              │               │
                             │                 │    value used    │              │               │
                             │                 │    (original     │              │               │
                             │                 │    section       │              │               │
                             │                 │    preserved)    │              │               │
                             │                 │                  │              │               │
                             │                 │                  │  ───────────►│               │
                             │                 │                  │  Guardian    │               │
                             │                 │                  │  validates   │               │
                             │                 │                  │  structure   │               │
                             │                 │                  │  (should     │               │
                             │                 │                  │   pass since │               │
                             │                 │                  │   original   │               │
                             │                 │                  │   content)   │               │
```

---

## Usage Examples

### Basic Usage

```typescript
import { createRetryEngine } from "@/lib/retry-engine";

const engine = createRetryEngine();

// Run an agent — if it fails, retry up to 3 times with exponential backoff
const result = await engine.run("experience-agent", () =>
  optimizeExperience(source)
);

if (result.success) {
  // Use result.value (the optimized content)
  resume.experience = result.value;
} else {
  // Handle failure (retries exhausted or non-retryable error)
  console.error("Failed after", result.attempts, "attempts:", result.errors);
  resume.experience = source.experience; // manual fallback
}
```

### With Fallback Value

```typescript
const result = await engine.run(
  "summary-agent",
  () => optimizeSummary(source),
  source.summary // fallback to original if all retries fail
);

// result.value is either the optimized summary or the original summary
// result.fallbackUsed tells you which one
if (result.fallbackUsed) {
  warnings.push("Summary optimization failed; using original summary.");
}
```

### With Custom Retry Predicate

```typescript
const result = await engine.run(
  "skills-agent",
  () => optimizeSkills(source),
  null,
  (err) => !(err instanceof NetworkError) // don't retry network errors
);
```

### Inspecting Engine State

```typescript
// After running several agents:
console.log(engine.getState("experience-agent"));
// → { agentId: "experience-agent", attempt: 2, maxRetries: 3,
//     lastError: "LLM response invalid", errors: [...],
//     status: "success" }

console.log(engine.getAllStates());
// → { "experience-agent": {...}, "summary-agent": {...}, ... }

// Reset an agent's state for a fresh start
engine.reset("experience-agent");
```

### Full Pipeline Integration Example

```typescript
const engine = createRetryEngine({ maxRetries: 3, baseDelayMs: 500 });

async function runExperienceAgent(
  source: ResumeData,
  jd: JobDescription,
  context: string,
): Promise<ExperienceSection> {
  const result = await engine.run(
    "experience-agent",
    () => runBulletOnlyOptimizer(source, jd, context),
    source.experience, // fallback: restore original
  );
  return result.value;
}

async function runSummaryAgent(
  source: ResumeData,
  jd: JobDescription,
  context: string,
): Promise<string> {
  const result = await engine.run(
    "summary-agent",
    () => optimizeSummary(source, jd, context),
    source.summary,
  );
  return result.value;
}

// In the pipeline:
const optimizedExperience = await runExperienceAgent(source, jd, context);
const optimizedSummary = await runSummaryAgent(source, jd, context);
// ... other agents ...

// Assemble from individually-retried sections
const assembled = assembleResume(source, {
  experience: optimizedExperience,
  summary: optimizedSummary,
  skills: optimizedSkills,
  // ...
});

// Single pass through guardian
const guardianResult = runStructureGuardian(assembled, source);
```

---

## API Reference

### `createRetryEngine(config?)`

| Parameter | Type | Default | Description |
|---|---|---|---|
| `config.maxRetries` | `number` | `3` | Maximum retry attempts per agent |
| `config.baseDelayMs` | `number` | `1000` | Initial backoff delay in milliseconds |
| `config.maxDelayMs` | `number` | `30000` | Maximum backoff delay cap in milliseconds |
| `config.backoffFactor` | `number` | `2` | Exponential multiplier per retry |

**Returns**: `RetryEngine` instance

### `RetryEngine.run(agentId, fn, fallback?, shouldRetry?)`

| Parameter | Type | Required | Description |
|---|---|---|---|
| `agentId` | `string` | Yes | Unique identifier for the agent |
| `fn` | `() => Promise<T>` | Yes | Async function performing the agent's work |
| `fallback` | `T \| null` | No | Value to return when retries exhausted |
| `shouldRetry` | `(err: unknown) => boolean` | No | Predicate to determine if an error is retryable |

**Returns**: `Promise<RetryResult<T>>`

### `RetryResult<T>`

| Field | Type | Description |
|---|---|---|
| `success` | `boolean` | Whether the function eventually succeeded |
| `value` | `T \| null` | The result value (or fallback, or null) |
| `attempt` | `number` | The attempt number that produced this result |
| `attempts` | `number` | Total attempts made (same as `attempt`) |
| `errors` | `string[]` | All error messages across all attempts |
| `exhausted` | `boolean` | Whether retries were exhausted |
| `fallbackUsed` | `boolean` | Whether the fallback value was used |

### `RetryEngine.reset(agentId)`

Clears retry state for the specified agent, resetting to `idle`.

### `RetryEngine.getState(agentId)`

Returns a **copy** of the current state for the specified agent.

### `RetryEngine.getAllStates()`

Returns a record of all agent states (copies).
