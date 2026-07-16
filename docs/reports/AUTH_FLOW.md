# AUTH_FLOW.md — Antigravity CLI OAuth Device Authorization Flow

## Overview
Antigravity uses OAuth 2.0 Device Authorization Grant (RFC 8628) — no email/password ever stored.

## Flow Diagram

```
User                    ResumeAI Pro               Antigravity API
 │                          │                          │
 ├─Click "Connect"──────────┤                          │
 │                          ├─POST /oauth/device───────┤
 │                          │← { device_code,         │
 │                          │    user_code,            │
 │                          │    verification_uri }    │
 │                          │                          │
 ├─Display URL + code───────┤                          │
 │                          │                          │
 ├─Visit URL───────────────────────────────────────────┤
 ├─Enter code──────────────────────────────────────────┤
 ├─Authenticate with Google────────────────────────────┤
 │                          │                          │
 │                          ├─POST /oauth/token ───────┤
 │                          │  (polling every 5s)     │
 │                          │← { access_token,        │
 │                          │    refresh_token }       │
 │                          │                          │
 ├─"Connected!"─────────────┤                          │
 │                          ├─Encrypt + store in D1────┤
 │                          ├─GET /v1/models ──────────┤
 │                          │← [model list]            │
 │                          ├─Register in ProviderReg  │
 │                          ├─Integrate with Router    │
```

## Step-by-Step

### 1. Initiate Device Flow
`POST /api/providers/antigravity/connect` → returns:
```json
{
  "deviceCode": "ABC123",
  "userCode": "XY-ZK-LM",
  "verificationUrl": "https://antigravity.io/device?code=ABC123",
  "expiresIn": 300,
  "interval": 5
}
```

### 2. Display to User
- Show `verificationUrl` as clickable link + QR code
- Show `userCode` in large monospace font
- Show 5-minute countdown timer
- "Open in browser" button

### 3. User Authenticates
- Opens URL in browser
- Enters user code
- Signs in with Google
- Authorizes ResumeAI Pro access

### 4. Poll for Token
`POST /api/providers/antigravity/poll` every `interval` seconds:
- `200 OK` → `{ accessToken, refreshToken, expiresIn }` → **authorized**
- `400 authorization_pending` → continue polling
- `400 slow_down` → increase interval +5s
- `400 expired_token` → code expired, restart
- `400 access_denied` → user denied

### 5. Store Tokens
- Encrypt access_token + refresh_token via AES-256-GCM
- Store in D1 `provider_tokens` table
- Never store plaintext tokens

### 6. Discover Models
`GET /v1/models` with `Authorization: Bearer <token>`
- Store in D1 `provider_models` table
- Register in Provider Registry as `p_antigravity`

### 7. Token Rotation
- Access tokens expire after `expiresIn` seconds
- Refresh token used to get new access token
- Auto-refresh happens in `tryRefresh()` before any API call
- D1 token store updated on each refresh

### 8. Reconnect Flow
- If refresh fails, session marked `authenticated: false`
- User sees "Connect Antigravity" button again
- Old tokens purged from D1
- New device flow initiated

## Security
- Tokens encrypted with AES-256-GCM using Cloudflare Secret-derived key
- IV (12 bytes) randomly generated per encryption
- Plaintext tokens NEVER stored in localStorage, memory, or logs
- `provider_tokens` table never returns raw tokens via API
- All D1 queries parameterized (no SQL injection)
