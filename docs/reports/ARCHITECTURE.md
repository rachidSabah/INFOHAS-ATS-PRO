# Architecture

ResumeAI Pro is an AI-powered ATS resume intelligence platform. It is a
**Next.js (App Router)** frontend deployed to **Cloudflare Pages** (via
`@cloudflare/next-on-pages`, Edge runtime) with a companion **Cloudflare Worker**
(Hono) that owns the **D1** database and **KV** cache.

## High-level shape

```
┌─────────────────────────┐         ┌──────────────────────────────┐
│  Next.js (Cloudflare     │         │  Cloudflare Worker (Hono)     │
│  Pages, Edge runtime)    │  fetch  │  workers/api/index.ts         │
│  - App Router pages      │ ──────▶ │  - REST API (users, resumes,  │
│  - Edge API routes       │         │    providers, tasks, audits)  │
│  - Client UI (React 19)  │         │  - D1 (Drizzle ORM)           │
│  - Edge middleware       │         │  - KV cache                   │
└─────────────────────────┘         └──────────────────────────────┘
```

## Core principles (enforced in CLAUDE.md)

- **Single AI orchestration pipeline** — every AI call routes through
  `ProviderRouter` (`src/lib/ai/services`). No feature calls a provider adapter
  directly.
- **Single provider abstraction layer** — `src/lib/ai/providers/*` adapters,
  selected by `ProviderFactory`.
- **Single shared memory system** — interview/recruiter state flows through the
  Zustand store (`src/lib/store.ts`) and persisted to localStorage / D1.
- **Single Flight Recorder** — all AI executions emit a structured
  `FlightRecord` (`src/lib/ai/flight-recorder.ts`).
- **Single Decision Engine** — hiring/quality decisions run through
  `src/lib/ai/decision-engine.ts`.

## Frontend (Next.js / Pages)

- **App Router** pages under `src/app`.
- **32 Edge API route handlers** under `src/app/api` (proxy AI, JD scrape, web
  search, provider OAuth, health). All declare `export const runtime = "edge"`.
- **UI** in `src/components` — app shell, resume, interview, analytics,
  recruiter, flight console.
- **State** — Zustand slices: auth, resumes, admin, dev-workspace, flight.
- **Middleware** (`src/middleware.ts`) — Edge: security headers, rate limiting,
  SSRF allowlist, debug-route blocking.

## AI Pipeline

See [AI_PIPELINE.md](AI_PIPELINE.md). In short: `recordAI` → `callAIRaw` →
`ProviderRouter` → adapter. Middleware hooks (Reflection, QA, Validation,
Decision) attach around the pipeline without editing call sites.

## Worker API

- `workers/api/index.ts` — Hono app, `nodejs_compat`, bound to D1 (`DB`) and KV
  (`CACHE`).
- `workers/api/schema.ts` — Drizzle schema.
- Auth: `NEXTAUTH_SECRET` JWT verification, session-token lookup, or
  `X-User-Id` header (development).

## Storage

| Concern        | Technology            |
|--------------- |-----------------------|
| Database       | Cloudflare D1 (Drizzle ORM) |
| Cache          | Cloudflare KV         |
| Object storage | Cloudflare R2 (referenced; wire per deploy) |
| Client state   | Zustand + localStorage |
| Interviews     | IndexedDB (recordings) + D1 metadata |

## Why no Node-only APIs

Cloudflare Pages/Workers run on the WinterCG runtime, not Node. Server/edge code
avoid `fs`, `path`, `process.cwd()`, and native modules. Heavy libs
(`sharp`, `tesseract.js`, `mammoth`, `pdfjs-dist`, `jspdf`, `docx`) are used
**client-side only** (browser PDF/DOCX generation, parsing), never in API
routes.

## Build

- `next build` (or `next-on-pages` for Pages output).
- `images.unoptimized: true` (Cloudflare doesn't support the default loader).
- Type-checking is enforced at build (`typescript.ignoreBuildErrors: false`).
