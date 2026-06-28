# ANTIGRAVITY_ARCHITECTURE.md

## Overview
Antigravity CLI is integrated as a first-class AI provider in ResumeAI Pro, following the same patterns as OpenRouter, OpenCode, ZenCode, Gemini, Nvidia, Mistral, Groq, and Puter. The integration is fully compatible with Cloudflare Pages + Workers + D1.

## Architecture

```
Pages UI (Provider Settings)
    │
    ▼
Workers API Gateway
    │
    ├── POST /api/providers/antigravity/connect      → Device Auth Flow
    ├── POST /api/providers/antigravity/poll          → Token Polling
    ├── POST /api/providers/antigravity/disconnect    → Revoke Tokens
    ├── GET  /api/providers/antigravity/models        → Discovered Models
    ├── POST /api/providers/antigravity/models/sync   → Re-discover Models
    ├── GET  /api/providers/antigravity/health        → Health Metrics
    └── POST /api/providers/antigravity/test          → Test Connectivity
         │
         ▼
    Provider Registry (providers/index.ts)
         │
         ├── AntigravityProvider (OAuthAIProvider interface)
         ├── antigravity-auth.ts (Device Flow + API calls)
         ├── antigravity-routes.ts (Worker endpoints)
         └── session-manager.ts (encrypted token storage)
              │
              ▼
         D1 Database (provider_tokens, provider_health, etc.)
              │
              ▼
         Provider Router (router.ts → fallback chain)
              │
              ▼
         Optimization Agents
```

## Authentication Flow
Uses OAuth 2.0 Device Authorization Grant (RFC 8628):
1. User clicks "Connect Antigravity CLI" in Settings
2. Frontend calls POST /connect → receives device_code + user_code + verificationUrl
3. User visits verificationUrl, enters user_code, authorizes the app
4. Frontend polls POST /poll every `interval` seconds
5. On authorization, tokens are encrypted and stored in D1
6. Provider becomes active in the routing engine
7. Models are auto-discovered via GET /v1/models

## Files
| File | Purpose |
|------|---------|
| `src/lib/providers/interface.ts` | Extended ProviderSession with "antigravity" |
| `src/lib/providers/antigravity-auth.ts` | Device auth flow, token refresh, model fetch, completion API |
| `src/lib/providers/antigravity-provider.ts` | Full OAuthAIProvider implementation |
| `src/lib/providers/antigravity-routes.ts` | Cloudflare Worker routes for 7 endpoints |
| `src/lib/providers/index.ts` | Registration + restore + auth checks |
| `D1_MIGRATION.sql` | Schema for 5 tables (tokens, connections, models, health, capabilities) |

## Integration Points
- **ProviderRegistry**: Antigravity registered alongside Puter in index.ts
- **SessionManager**: Tokens encrypted via Web Crypto AES-256-GCM
- **FallbackChain**: Antigravity is part of the fallback chain in selectProvider()
- **Model Discovery**: Dynamic — never hardcoded. Fetched from /v1/models
- **Health Monitoring**: Tracks 429s, timeouts, latency, availability in D1
- **Agent Integration**: All agents (Optimization, Cover Letter, Interview, Career Coach) automatically gain access via ProviderRouter
