# Directive Architecture Audit

## Current State

### Storage
- **Fallback**: Hardcoded constant in `src/lib/ai.ts` (line 720)
- **Default seed**: `SEED_OPTIMIZER_DIRECTIVE` in `src/lib/mock-data.ts` (line 703)
- **Runtime state**: Zustand store `state.optimizerDirective` in `src/lib/store.ts` (line 102)
- **Cloud sync**: Every `updateOptimizerDirective()` syncs to D1 via `cloudApi.updateBranding()`

### Loading
- **UI path**: `Optimizer.tsx` (line 333) reads `directiveConfig` from store → extracts `customDirectiveOverride` → passes as `userDirectives` string to supervisor
- **Orchestrator path**: `orchestrator.ts` (line 812) independently re-reads full `OptimizerDirectiveConfig` object from store
- **Dual read**: Two independent reads from Zustand store — one string, one object

### Injection into Prompts
- `locked-pipeline.ts` (line 76): Extracts `agentDirectives` from `directiveConfig`
- `bullet-only-optimizer.ts` (line 171): Injects agent directives as a text section in LLM system prompt via `buildAgentDirectiveSection()`
- `bullet-only-optimizer.ts` (line 173): Injects layout config via `getOptimizerDirective()`

### Which Agents Receive Them
| Agent | Receives directives? | How? |
|-------|---------------------|------|
| LLM (bullet-only) | ✅ | System prompt text |
| Page balancer | ✅ | `directiveConfig` parameter |
| Structure guardian | ✅ | Via `directiveConfig` |
| Supervisor | ⚠️ | Receives `userDirectives` string only (may not have full context) |
| QA | ❌ | No directive-aware validation |
| Locked pipeline | ✅ | Full `directiveConfig` object |

### Can Agents Ignore Them?
| Mechanism | Enforcement |
|-----------|------------|
| **LLM prompt text** | ❌ — Suggestion only, no programmatic validation |
| **`supervisor.strictMode`** | ✅ — Hard-fails on critical entity violations |
| **`enableProviderSwitch`** | ✅ — Controls retry logic |
| **Experience match verification** | ✅ — Pipeline verifies count parity |
| **Immutable entity assembler** | ✅ — Source resume fields override LLM output |

### Does Supervisor Validate Compliance?
**No.** The supervisor gets `userDirectives` as a string but never:
- Checks if the LLM followed them
- Rejects output that violates them
- Provides corrective feedback
- Computes a compliance score

### Gaps Identified

1. **Prompt-only directives**: Agent behavior knobs (`atsAggressiveness`, `preserveFacts`, etc.) are injected into text prompts but never programmatically enforced
2. **No policy object**: No centralized `OptimizationPolicy` type that consolidates all directive knobs
3. **No supervisor enforcement**: Supervisor doesn't validate directive compliance
4. **No QA compliance**: QA validates ATS readiness but not directive adherence
5. **No compliance score**: No metric for directive compliance
6. **No directive profiles**: No versioned/saved directive configurations
7. **No section ownership enforcement**: LLM is trusted not to touch immutable sections

## Target Architecture

```
SYSTEM CONFIG (store + D1)
    ↓
Supervisor (Policy Enforcement Engine)
    ↓ builds
OptimizationPolicy
    ↓ injects into
┌─────────────────────────────────┐
│  EVERY AGENT PROMPT             │
│  "SYSTEM POLICY: <policy>"      │
└─────────────────────────────────┘
    ↓
QA Validation (check policy compliance)
    ↓
Reflection (DIRECTIVE_COMPLIANCE_REPORT.md)
    ↓
Pipeline success if compliance ≥ 90
```

## Recommended Changes

| # | Change | File |
|---|--------|------|
| 1 | Create `OptimizationPolicy` type + builder | `src/lib/directive-policy.ts` |
| 2 | Create directive profiles | `src/lib/directive-profiles.ts` |
| 3 | Add `OptimizationPolicy` to `OptimizerDirectiveConfig` | `src/lib/types.ts` |
| 4 | Refactor supervisor as policy enforcement engine | `src/lib/agents/supervisor.ts` |
| 5 | Add QA compliance validation | `src/lib/agents/qa-agent.ts` |
| 6 | Wire profiles into UI | `src/components/...` |
| 7 | Write directive compliance tests | `src/lib/__tests__/` |
