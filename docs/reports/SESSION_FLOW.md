# SESSION_FLOW.md — Authentication & Optimization Session Flows

## 1. Antigravity Token Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant C as Cloudflare Pages
    participant G as Google OAuth
    participant Provider as AntigravityProvider

    U->>F: Click "Connect Antigravity"
    F->>C: POST /api/providers/antigravity/start
    C-->>F: { authUrl, sessionId }
    F->>F: window.open(authUrl, "antigravity-auth")
    F->>G: Google login page (in popup)
    U->>G: Sign in with Google
    G->>C: Redirect to /api/providers/antigravity/callback?code=...
    C->>C: Exchange code for tokens
    C-->>F: HTML with postMessage({ accessToken, refreshToken, email, expiresIn })
    F->>F: Receive postMessage
    F->>Provider: provider.login(accessToken)
    F->>Provider: provider.saveRefreshToken(refreshToken, expiresIn)
    F-->>U: Toast: "Antigravity connected successfully!"

    alt Token Paste (Primary Method)
        U->>F: Paste token from CLI into textarea
        F->>Provider: provider.login(pastedToken)
        F-->>U: Toast: "Antigravity connected successfully!"
    end
```

## 2. Optimization Session Flow

```mermaid
sequenceDiagram
    participant U as User
    participant F as Frontend
    participant Checkpoint as Session Checkpoint
    participant Provider as AI Provider
    participant D1 as Cloudflare D1

    U->>F: Upload resume + job description
    F->>Checkpoint: createSession(userId, resume, jd)
    Checkpoint-->>F: sessionId

    Note over F,Provider: Stage 1: Parsing
    F->>Checkpoint: saveCheckpoint(sessionId, "parsing", parsedData)
    Checkpoint->>D1: POST /api/optimization/save-checkpoint

    Note over F,Provider: Stage 2: Summary
    F->>Provider: Call AI for summary
    Provider-->>F: Generated summary
    F->>Checkpoint: saveCheckpoint(sessionId, "summary", data)

    Note over F,Provider: Stage 3-N: Experience, Education, Skills, Languages
    F->>Provider: Call AI for each stage
    Provider-->>F: Generated section
    F->>Checkpoint: saveCheckpoint(sessionId, stage, data)

    Note over F,Provider: Stage 7: Assembly
    F->>Provider: Call AI for assembly
    Provider-->>F: Final DOCX/HTML
    F->>Checkpoint: closeSession(sessionId)

    alt Provider Fails at Stage N
        Provider--xF: Error / 429 / timeout
        F->>F: circuitBreakerFailure(providerId, errorType)
        F->>Checkpoint: resumeFromCheckpoint(sessionId)
        Checkpoint-->>F: { stage: "education", data: {...} }
        F->>F: getNextIncompleteStage(sessionId, stages)
        F->>Provider: selectProviderForAgent("optimizer", [failedProvider])
        F->>Provider: Resume from "education" with new provider
        Provider-->>F: Generated section
    end
```

## 3. Circuit Breaker Flow

```mermaid
stateDiagram-v2
    [*] --> CONNECTED: Provider registered
    CONNECTED --> UNHEALTHY: 3 consecutive failures
    CONNECTED --> HEALTHY: 2 consecutive successes
    HEALTHY --> DEGRADED: 1 failure
    DEGRADED --> UNHEALTHY: 3 consecutive failures
    DEGRADED --> CONNECTED: 2 consecutive successes
    UNHEALTHY --> COOLDOWN: 15 minute timer
    COOLDOWN --> CONNECTED: 1 success
    COOLDOWN --> UNHEALTHY: 1 failure (back to cooldown)
    UNHEALTHY --> [*]: selectProvider filters out
```

## 4. Provider Selection Flow

```mermaid
flowchart TD
    A[Request AI call] --> B{Agent type?}
    B -->|optimizer| C[Filter: Tier 1-2 available providers]
    B -->|supervisor/guardian/assembler| D[Filter: Tier 2-3 available providers]
    B -->|emergency| E[Filter: Tier 4 only]

    C --> F{User default provider set?}
    D --> F
    E --> F

    F -->|Yes| G[Use default]
    F -->|No| H[Pick highest priority (lowest number)]

    G --> I{Provider healthy?}
    H --> I

    I -->|Yes| J[Call AI]
    I -->|No| K[Skip to next available]

    K --> L{More providers?}
    L -->|Yes| M[Pick next highest priority]
    M --> I
    L -->|No| N[Fallback: local engine]
    N --> O[Return degraded result]
```
