# REGRESSION_REPORT.md — Regression Test Report

**Generated:** 28 Jun 2026  
**Commit:** b921ed8  
**Status:** ✅ ALL 593 TESTS PASSING — ZERO REGRESSIONS

## Test Suite Summary

| Suite | Tests | Status |
|-------|-------|--------|
| **Total** | **593** | **✅ 593 passed, 0 failed** |
| Test Files | 34 | ✅ All 34 suites passed |

## Changes Since Last Green Build

### New Files
- `src/lib/circuit-breaker.ts` — Provider state machine (CONNECTED/HEALTHY/DEGRADED/UNHEALTHY/COOLDOWN)
- `src/lib/session-checkpoint.ts` — Optimization checkpoint & recovery system
- `src/app/api/providers/antigravity/start/route.ts` — POST /start (authenticated OAuth init)
- `src/app/api/providers/antigravity/callback/route.ts` — GET /callback (public OAuth exchange)
- `src/app/api/providers/antigravity/status/route.ts` — GET /status
- `src/app/api/providers/antigravity/disconnect/route.ts` — POST /disconnect
- `src/app/api/provider-sessions/puter/route.ts` — POST/GET/DELETE /api/provider-sessions/puter (fixes 404)
- `src/app/api/optimization/save-checkpoint/route.ts` — POST /api/optimization/save-checkpoint
- `D1_MIGRATION.sql` — Updated with providers, optimization_sessions, optimization_checkpoints tables
- `AUTH_ARCHITECTURE.md` — Architecture documentation
- `ROUTE_MAP.md` — Route documentation
- `SESSION_FLOW.md` — Session flow documentation
- `REGRESSION_REPORT.md` — This file

### Modified Files
- `src/lib/ai.ts` — Tiered `selectProvider()`, new `selectProviderForAgent()`, circuit breaker integration
- `src/lib/types.ts` — Added `OptimizationStage` type
- `src/components/app/modules/ConnectAntigravityDialog.tsx` — Token paste UI (replaced broken OAuth popup)
- `src/lib/providers/antigravity-provider.ts` — Added `saveRefreshToken()` method

### Removed Files
- `trace_pipeline.py` — Development debug script (committed as cleanup)

### Configuration Changes
- None (no new dependencies)

## Architecture Compliance

### 1️⃣ Circuit Breaker ✅
- 3 consecutive failures → UNHEALTHY → 15-min cooldown → auto-retry
- `circuitBreakerSuccess()` / `circuitBreakerFailure()` called in `callAI()`
- `shouldSkipForOptimization()` filters unhealthy providers in `selectProvider()`

### 2️⃣ Puter Lock-out ✅
- `EMERGENCY_ONLY_PROVIDERS` = new Set(["puter", "p_puter"])
- Filtered in `selectProvider()`, `isAvailableForSelection()`, `shouldSkipForOptimization()`
- `priority=999` in D1 seed data
- Never a primary provider; only used in `selectProviderForAgent("emergency")`

### 3️⃣ Session Checkpoints ✅
- `createSession()` returns sessionId
- `saveCheckpoint(stage, data) persists at each optimization stage
- `resumeFromCheckpoint()` returns last completed stage
- `getNextIncompleteStage()` calculates resume point
- 5-minute memory TTL + optional D1 persistence

### 4️⃣ D1 Schema ✅
- `providers` — registry with priority, tier, emergency_only
- `optimization_sessions` — session state tracking
- `optimization_checkpoints` — per-stage snapshots
- 9 providers seeded with correct tiers

### 5️⃣ Tiered Provider Selection ✅
- `selectProvider()` sorts by priority (lowest = best)
- `selectProviderForAgent()` maps agent types to tier ranges

### 6️⃣ Antigravity Auth Routes ✅
- POST /start — authenticated, returns {authUrl, sessionId}
- GET /callback — public, OAuth code exchange via postMessage
- GET /status — authenticated
- POST /disconnect — authenticated
- Direct token paste in dialog (primary method)

### 7️⃣ Puter Session Routes ✅
- POST /api/provider-sessions/puter — New route (was 404)
- GET /api/provider-sessions/puter — New route
- DELETE /api/provider-sessions/puter — New route

## Known Limitations

1. **Antigravity Google OAuth popup** — `redirect_uri_mismatch` because the client ID belongs to Antigravity. We cannot register our Pages domain. The primary auth method is **direct token paste** (user runs `agy auth` locally and pastes the token).

2. **Cloudflare Pages build** — Uses `@cloudflare/next-on-pages@1.13.16` (deprecated). The build command `npm install --legacy-peer-deps && npx @cloudflare/next-on-pages@1.13.16` was the Cloudflare-configured command. If build issues arise, the fix is to update to `@opennext/cloudflare`.

3. **D1 persistence** — The checkpoint save route exists but D1 integration requires proper binding configuration in `wrangler.toml`. In-memory checkpoints work without D1.

## CI/CD

- **Deployment**: Cloudflare Pages auto-deploys from `origin/main`
- **Build Command**: `npm install --legacy-peer-deps && npx @cloudflare/next-on-pages@1.13.16`
- **Test Command**: `npx vitest run`
- **Local Dev**: `npm run dev`
