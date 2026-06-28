# AUTH_ARCHITECTURE.md — Authentication & Provider Architecture

## Overview

INFOHAS-ATS-PRO uses a **multi-layered provider architecture** with:
1. **Tiered provider selection** — assigns the best available AI provider per agent role
2. **Circuit breaker** — prevents cascading failures across providers
3. **Session checkpoints** — stores resume data at each optimization stage for recovery

## Provider Tiers

```
Tier 1 (priority < 35)   → Antigravity (10), OpenCode (20), ZenCode (30) — best quality
Tier 2 (priority 35-65)  → Gemini (40), Nvidia (50), Groq (60) — good quality
Tier 3 (priority 66-200) → OpenRouter (70), Mistral (80) — adequate quality
Tier 4 (priority > 200)  → Puter (999) — emergency only, never selected by default
```

## Agent-to-Tier Mapping

| Agent Type | Tiers Used | Purpose |
|------------|-----------|---------|
| `optimizer` | Tier 1–2 | Main optimization — highest quality required |
| `supervisor` | Tier 2–3 | Validation — reasonable quality, cost-efficient |
| `guardian` | Tier 2–3 | Secret scanning — fast, cost-efficient |
| `assembler` | Tier 2–3 | Final formatting — decent output |
| `emergency` | Tier 4 | Last resort — only Puter |

## Authentication Methods

### Antigravity CLI — Direct Token Paste
```
User runs: agy auth
User runs: cat ~/.antigravity/credentials  → copy accessToken
User pastes token into the ConnectAntigravityDialog textarea
Provider saves via: provider.login(token) / provider.saveRefreshToken()
```

- **Why not OAuth popup?** Antigravity's Google OAuth client ID (`1071006060591-...`) only has its own registered redirect URIs. We cannot register `resumeai-pro.pages.dev` as a redirect URI, so OAuth popup always fails with `redirect_uri_mismatch`.
- **Alternative**: User can configure their own Google OAuth client via AIProviderEditor (type `antigravity`, `authType: "bearer"`).

### Puter.js — Browser-Auth Only
- Authenticated via browser session (window.puter API)
- Marked `emergency_only` and `priority=999` — never used unless all other providers fail
- Circuit breaker filters Puter from `selectProvider()` and `shouldSkipForOptimization()`

### API Key Providers (OpenCode, ZenCode, Gemini, etc.)
- API keys stored in browser localStorage via SessionManager
- Validated via `hasValidApiKey()` before selection
- Alternate keys available for rate-limit fallback

## API Routes

| Route | Method | Auth | Purpose |
|-------|--------|------|---------|
| `/api/providers/antigravity/start` | POST | Yes | Generate OAuth state, return `{authUrl, sessionId}` |
| `/api/providers/antigravity/callback` | GET | No | Google OAuth callback — exchange code for tokens |
| `/api/providers/antigravity/status` | GET | Yes | Check connection status |
| `/api/providers/antigravity/disconnect` | POST | Yes | Revoke/clear tokens |
| `/api/provider-sessions/puter` | POST/GET/DELETE | Yes | Persist Puter session state |
| `/api/optimization/save-checkpoint` | POST | Yes | Persist optimization checkpoint to D1 |

## Circuit Breaker States

```
CONNECTED → [3 failures] → UNHEALTHY → [15 min] → COOLDOWN → [auto-retry] → CONNECTED
                                                                    → [fail again] → UNHEALTHY (cycle)

CONNECTED → [2 successes] → HEALTHY
HEALTHY   → [1 failure]   → DEGRADED
DEGRADED  → [3 failures]  → UNHEALTHY
UNHEALTHY → [15 min]      → COOLDOWN
COOLDOWN  → [success]     → CONNECTED
COOLDOWN  → [3 failures]  → UNHEALTHY (back to cooldown)
```

## Session Checkpoints

```
createSession(userId, resume, jd)
  → parsing stage checkpoint
  → summary stage checkpoint
  → experience stage checkpoint
  → education stage checkpoint
  → skills stage checkpoint
  → languages stage checkpoint
  → assembly stage (final)
  → closeSession(sessionId)

On provider failure:
  resumeFromCheckpoint(sessionId)
    → returns { stage, data }
  getNextIncompleteStage(sessionId, OPTIMIZATION_STAGES)
    → returns next stage to process
```
