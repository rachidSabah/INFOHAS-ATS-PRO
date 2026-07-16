# ROUTE_MAP.md — API Route Map

## Provider Routes

### Antigravity Provider

```
POST /api/providers/antigravity/start          Auth: Yes
  → Validate session
  → Generate PKCE + OAuth state
  → Return { authUrl, sessionId }
  Used by: ConnectAntigravityDialog → opens popup to {authUrl}

GET /api/providers/antigravity/callback        Auth: No  (PUBLIC)
  → Query params: code, state
  → Exchange code for tokens via Google OAuth
  → Return HTML with <script> parent.postMessage(...)
  Used by: Google OAuth redirect → posts result to parent

GET /api/providers/antigravity/status          Auth: Yes
  → Return { connected: boolean, provider: "antigravity" }

POST /api/providers/antigravity/disconnect     Auth: Yes
  → Clear tokens, return { status: "disconnected" }
```

### Provider Sessions (Puter)

```
POST /api/provider-sessions/puter              Auth: Yes
  → Body: { sessionId, provider, data }
  → Persist Puter session state
  → Return { ok: true }

GET /api/provider-sessions/puter               Auth: Yes
  → Return stored session data

DELETE /api/provider-sessions/puter            Auth: Yes
  → Clear stored session
```

### Optimization

```
POST /api/optimization/save-checkpoint         Auth: Yes
  → Body: { sessionId, stage, data }
  → Persist checkpoint to D1
  → Return { ok: true }
```

### Puter.js (Legacy)

```
POST /api/providers/puter/auth                 Auth: Yes
  → Body: { userId, sessionTime }
  → Return { success: true }

POST /api/providers/puter/login                Auth: No
  → Body: { username, password }
  → Return { status: "available" }

POST /api/providers/puter/logout               Auth: Yes
  → Clear Puter session
```

### Other Providers

```
POST /api/providers/zai/login                  Auth: Yes
  → Body: { apiKey }
  → Return { success: true, message: "Connected successfully!" }
```
